'use strict';

const $ = (id) => document.getElementById(id);
const dropzone = $('dropzone');
const queueEl = $('queue');
const formatEl = $('format');
const rateEl = $('samplerate');
const startBtn = $('start');
let presetsById = {};

// ---------- Langue ----------
let locale = 'en';
let messages = {};
const t = (key) => messages[key] ?? key;

function applyTranslations() {
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
}

const items = []; // { id, input, name, status, progress, output, error, presetId }
let outputDir = null;
let running = false;
let currentId = null;
let ffmpegOk = false;
let nextId = 1;

// ---------- FFmpeg ----------
function applyFfmpegStatus(status) {
  ffmpegOk = status.found;
  $('ffmpeg-banner').hidden = ffmpegOk;
  updateControls();
}

$('ffmpeg-retry').addEventListener('click', async () => applyFfmpegStatus(await api.ffmpegStatus()));
$('ffmpeg-choose').addEventListener('click', async () => applyFfmpegStatus(await api.chooseFfmpeg()));

// ---------- Formats ----------
async function loadPresets() {
  const groups = await api.listPresets();
  for (const group of groups) {
    const og = document.createElement('optgroup');
    og.label = group.label;
    for (const p of group.presets) {
      presetsById[p.id] = p;
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      og.appendChild(opt);
    }
    formatEl.appendChild(og);
  }
  formatEl.value = 'mp4';
  updateSampleRates();
  updateAdvanced();
}

// Le sélecteur de fréquence n'apparaît que pour les formats audio.
function updateSampleRates() {
  const rates = presetsById[formatEl.value]?.sampleRates;
  $('samplerate-row').hidden = !rates;
  const options = [['', t('samplerate.same')]];
  const khz = new Intl.NumberFormat(locale);
  for (const r of rates || []) options.push([String(r), `${khz.format(r / 1000)} kHz`]);
  rateEl.replaceChildren(
    ...options.map(([value, text]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = text;
      return opt;
    }),
  );
  rateEl.value = rates?.includes(44100) ? '44100' : '';
}

formatEl.addEventListener('change', updateSampleRates);
formatEl.addEventListener('change', updateAdvanced);

// ---------- Options avancées ----------
// Images/s, résolution et « Sans audio » n'ont de sens que pour les formats vidéo.
function updateAdvanced() {
  const audioOnly = Boolean(presetsById[formatEl.value]?.audioOnly);
  for (const el of document.querySelectorAll('.adv-video')) el.hidden = audioOnly;
  for (const el of document.querySelectorAll('.adv-video-opt')) el.disabled = audioOnly;
  if (audioOnly && $('adv-audio').value === 'mute') $('adv-audio').value = '0';
}

function readAdvanced() {
  const audio = $('adv-audio').value;
  return {
    quality: $('adv-quality').value,
    fps: $('adv-fps').value ? Number($('adv-fps').value) : null,
    shortSide: $('adv-size').value ? Number($('adv-size').value) : null,
    audioTrack: audio === 'mute' ? 0 : Number(audio),
    mute: audio === 'mute',
    start: $('adv-start').value,
    end: $('adv-end').value,
  };
}

// ---------- Fichiers ----------
function addFiles(paths) {
  for (const input of paths) {
    if (!input || items.some((i) => i.input === input && (i.status === 'queued' || i.status === 'running'))) continue;
    items.push({
      id: `job-${nextId++}`,
      input,
      name: input.split(/[\\/]/).pop(),
      status: 'queued',
      progress: 0,
    });
  }
  render();
}

dropzone.addEventListener('click', async () => addFiles(await api.chooseFiles()));
dropzone.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    addFiles(await api.chooseFiles());
  }
});

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (e) => {
    e.preventDefault();
    dropzone.classList.add('over');
  });
}
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropzone.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  const paths = [...e.dataTransfer.files].map((f) => api.pathForFile(f)).filter(Boolean);
  addFiles(paths);
});

// ---------- Dossier de sortie ----------
$('output-choose').addEventListener('click', async () => {
  const dir = await api.chooseFolder();
  if (dir) setOutputDir(dir);
});
$('output-reset').addEventListener('click', () => setOutputDir(null));

// ---------- Menu de l'application ----------
api.onMenuAction(async (action) => {
  if (action === 'add-files') addFiles(await api.chooseFiles());
  else if (action === 'choose-folder') $('output-choose').click();
  else if (action === 'start') startBtn.click();
  else if (action === 'clear') $('clear').click();
});

function setOutputDir(dir) {
  outputDir = dir;
  $('output-label').textContent = dir || t('output.same');
  $('output-reset').hidden = !dir;
}

// ---------- Conversion ----------
async function runQueue() {
  if (running) return;
  running = true;
  updateControls();
  try {
    let item;
    while ((item = items.find((i) => i.status === 'queued'))) {
      item.status = 'running';
      item.presetId = formatEl.value;
      item.sampleRate = rateEl.value ? Number(rateEl.value) : null;
      item.progress = 0;
      currentId = item.id;
      render();

      const res = await api.convert({
        jobId: item.id,
        input: item.input,
        outputDir,
        presetId: item.presetId,
        sampleRate: item.sampleRate,
        advanced: readAdvanced(),
      });

      currentId = null;
      if (res.ok) {
        item.status = 'done';
        item.output = res.output;
        item.progress = 1;
      } else if (res.canceled) {
        item.status = 'canceled';
      } else {
        item.status = 'error';
        item.error = res.error;
      }
      render();
    }
  } finally {
    running = false;
    updateControls();
  }
}

startBtn.addEventListener('click', runQueue);

$('clear').addEventListener('click', () => {
  for (let i = items.length - 1; i >= 0; i--) {
    if (['done', 'error', 'canceled'].includes(items[i].status)) items.splice(i, 1);
  }
  render();
});

api.onProgress(({ jobId, progress }) => {
  const item = items.find((i) => i.id === jobId);
  if (!item) return;
  item.progress = progress;
  const li = queueEl.querySelector(`[data-id="${jobId}"] progress`);
  if (li) li.value = progress;
  const st = queueEl.querySelector(`[data-id="${jobId}"] .status`);
  if (st) st.textContent = `${Math.round(progress * 100)} %`;
});

// ---------- Rendu ----------
const statusLabel = (status) => t(`status.${status}`);

function button(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function render() {
  queueEl.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      li.className = `item ${item.status}`;
      li.dataset.id = item.id;

      const top = document.createElement('div');
      top.className = 'top';

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = item.name;
      name.title = item.input;

      const status = document.createElement('span');
      status.className = 'status';
      status.textContent = item.status === 'running'
        ? `${Math.round(item.progress * 100)} %`
        : statusLabel(item.status);

      top.append(name, status);

      if (item.status === 'running') {
        top.append(button(t('item.cancel'), () => api.cancel(item.id)));
      } else if (item.status === 'done') {
        top.append(button(t('item.reveal'), () => api.reveal(item.output)));
      } else {
        top.append(button(t('item.remove'), () => {
          items.splice(items.indexOf(item), 1);
          render();
        }));
      }
      li.append(top);

      if (item.status === 'running') {
        const bar = document.createElement('progress');
        bar.max = 1;
        bar.value = item.progress;
        li.append(bar);
      }
      if (item.status === 'error' && item.error) {
        const p = document.createElement('p');
        p.className = 'detail';
        p.textContent = item.error;
        li.append(p);
      }
      return li;
    }),
  );
  updateControls();
}

function updateControls() {
  const hasQueued = items.some((i) => i.status === 'queued');
  startBtn.disabled = running || !ffmpegOk || !hasQueued;
  $('clear').disabled = !items.some((i) => ['done', 'error', 'canceled'].includes(i.status));
}

// ---------- Init ----------
(async () => {
  try {
    ({ locale, messages } = await api.getI18n());
    applyTranslations();
  } finally {
    document.documentElement.classList.add('ready');
  }
  await loadPresets();
  applyFfmpegStatus(await api.ffmpegStatus());
  render();
})();
