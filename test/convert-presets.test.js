'use strict';

// Conversion réelle de CHAQUE préréglage, avec contrôle du résultat (codec, résolution, fréquence, profil).

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { groups } = require('../lib/presets');
const { convert } = require('../lib/converter');
const { getFfmpeg, makeFixtures, probe } = require('./helpers/media');

let ffmpeg;
let dir;
let fx;
let outDir;

before(async () => {
  ffmpeg = await getFfmpeg();
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-presets-'));
  outDir = path.join(dir, 'out');
  fs.mkdirSync(outDir);
  fx = makeFixtures(ffmpeg, dir, ['tone.wav', 'clip.mp4', 'wide.mp4', 'silent.mp4']);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const val = (args, flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const VIDEO_CODEC = { libx264: 'h264', libx265: 'hevc', 'libvpx-vp9': 'vp9' };
const AUDIO_CODEC = { aac: 'aac', libopus: 'opus', libmp3lame: 'mp3', pcm_s16le: 'pcm_s16le', flac: 'flac', libvorbis: 'vorbis', vorbis: 'vorbis' };

async function run(presetId, input, extra = {}) {
  const job = convert({ ffmpegPath: ffmpeg, input, outputDir: outDir, presetId, ...extra });
  const { output } = await job.promise;
  assert.ok(fs.statSync(output).size > 0, `${presetId} : sortie vide`);
  return output;
}

for (const group of groups) {
  for (const preset of group.presets) {
    test(`préréglage ${preset.id} (${preset.label})`, async (t) => {
      if (!ffmpeg) return t.skip('ffmpeg introuvable');

      if (preset.audioOnly) {
        // Depuis un fichier audio, puis depuis une vidéo (extraction de la bande son).
        for (const source of [fx['tone.wav'], fx['clip.mp4']]) {
          const output = await run(preset.id, source);
          assert.equal(path.extname(output), `.${preset.extension}`);
          const info = probe(ffmpeg, output);
          assert.equal(info.video, null, 'aucune vidéo dans un format audio');
          assert.equal(info.audio.length, 1);
          const codec = val(preset.args, '-c:a');
          assert.equal(info.audio[0].codec, AUDIO_CODEC[codec], `codec audio ${codec}`);
          assert.ok(info.duration > 1.5, `durée ${info.duration}`);
        }
        return;
      }

      const vcodec = val(preset.args, '-c:v');
      const output = await run(preset.id, fx['clip.mp4']);
      assert.equal(path.extname(output), `.${preset.extension}`);
      const info = probe(ffmpeg, output);

      // Vidéo
      assert.ok(info.video, 'piste vidéo présente');
      assert.ok(info.duration > 2.5 && info.duration < 3.6, `durée ${info.duration}`);
      if (preset.extension === 'gif') {
        assert.equal(info.video.codec, 'gif');
        assert.equal(info.audio.length, 0, 'un GIF n\'a pas de son');
        return;
      }
      assert.equal(info.video.codec, VIDEO_CODEC[vcodec], `codec vidéo ${vcodec}`);
      if (val(preset.args, '-tag:v') === 'hvc1') assert.match(info.text, /hvc1/, 'tag hvc1 (lecture Apple)');
      if (vcodec !== 'libvpx-vp9') assert.equal(info.video.pixFmt, 'yuv420p');

      const profile = val(preset.args, '-profile:v');
      if (profile) assert.match(info.text, new RegExp(`\\((Constrained )?${profile}`, 'i'), `profil ${profile}`);
      const fps = /fps=(\d+)/.exec(val(preset.args, '-vf') ?? '');
      if (fps && preset.id !== 'gif') assert.equal(info.video.fps, Number(fps[1]), 'images/s imposées');

      // Source en 320x240 : jamais agrandie, même pour les appareils 4K.
      assert.ok(info.video.width <= 320 && info.video.height <= 240, `${info.video.width}x${info.video.height} dépasse la source`);

      // Audio
      assert.equal(info.audio.length, 1);
      assert.equal(info.audio[0].codec, AUDIO_CODEC[val(preset.args, '-c:a')]);
    });
  }
}

test('préréglages « appareil » : la résolution est plafonnée sans changer le ratio', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  // Source 1280x720 : on vérifie le plafond de chaque préréglage qui en impose un plus petit.
  for (const preset of groups.flatMap((g) => g.presets)) {
    const m = /scale='min\((\d+),iw\)':'min\((\d+),ih\)'/.exec(val(preset.args, '-vf') ?? '');
    if (!m || Number(m[1]) >= 1280) continue;
    const output = await run(preset.id, fx['wide.mp4']);
    const { video } = probe(ffmpeg, output);
    assert.ok(video.width <= Number(m[1]) && video.height <= Number(m[2]), `${preset.id} : ${video.width}x${video.height}`);
    assert.equal(video.width % 2, 0, `${preset.id} : largeur paire`);
    assert.equal(video.height % 2, 0, `${preset.id} : hauteur paire`);
    assert.ok(Math.abs(video.width / video.height - 16 / 9) < 0.03, `${preset.id} : ratio conservé`);
  }
});

test('fréquences d\'échantillonnage : toutes celles proposées par chaque format audio', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  for (const preset of groups.flatMap((g) => g.presets).filter((p) => p.audioOnly)) {
    for (const rate of preset.sampleRates) {
      const output = await run(preset.id, fx['tone.wav'], { sampleRate: rate });
      assert.equal(probe(ffmpeg, output).audio[0].rate, rate, `${preset.id} @ ${rate} Hz`);
    }
  }
});

test('une vidéo sans piste audio se convertit (MP4, MKV, WebM)', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  for (const id of ['mp4', 'mkv', 'webm', 'android-720']) {
    const info = probe(ffmpeg, await run(id, fx['silent.mp4']));
    assert.ok(info.video, id);
    assert.equal(info.audio.length, 0, id);
  }
});

test('un fichier audio ne peut pas devenir une vidéo : erreur explicite, aucun fichier laissé', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  const before = fs.readdirSync(outDir).length;
  await assert.rejects(run('mp4', fx['tone.wav']), (err) => err.message.length > 0);
  assert.equal(fs.readdirSync(outDir).length, before, 'pas de fichier partiel');
});

test('sans dossier de sortie : le fichier est créé à côté de la source', async (t) => {
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  const { output } = await convert({ ffmpegPath: ffmpeg, input: fx['tone.wav'], presetId: 'flac' }).promise;
  assert.equal(path.dirname(output), path.dirname(fx['tone.wav']));
  assert.equal(path.basename(output), 'tone.flac');
});
