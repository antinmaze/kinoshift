'use strict';

// Options avancées appliquées pour de vrai : découpe, images/s, résolution, qualité, piste audio, sans audio.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { convert } = require('../lib/converter');
const { MessageError } = require('../lib/i18n');
const { ALLOWED_FPS, ALLOWED_SHORT_SIDE } = require('../lib/advanced');
const { getFfmpeg, makeFixtures, probe } = require('./helpers/media');

let ffmpeg;
let dir;
let fx;

before(async () => {
  ffmpeg = await getFfmpeg();
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-adv-'));
  fx = makeFixtures(ffmpeg, dir, ['tone.wav', 'clip.mp4', 'wide.mp4', 'vertical.mp4', 'multitrack.mkv', 'silent.mp4']);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function run(presetId, input, advanced, extra = {}) {
  const job = convert({ ffmpegPath: ffmpeg, input, outputDir: dir, presetId, advanced, ...extra });
  return (await job.promise).output;
}

/** Fréquence dominante (Hz) d'un fichier audio, estimée par passages à zéro. */
function dominantFrequency(file) {
  const res = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'], { maxBuffer: 1 << 26 });
  const pcm = res.stdout;
  let crossings = 0;
  let prev = pcm.readInt16LE(0);
  for (let i = 2; i < pcm.length - 1; i += 2) {
    const cur = pcm.readInt16LE(i);
    if ((prev < 0) !== (cur < 0)) crossings++;
    prev = cur;
  }
  return crossings / 2 / (pcm.length / 2 / 8000);
}

const skipIfNoFfmpeg = (t) => {
  if (ffmpeg) return false;
  t.skip('ffmpeg introuvable');
  return true;
};

test('découpe : début seul, fin seule, début + fin, formats de temps', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const cases = [
    [{ start: '1' }, 2],
    [{ end: '1' }, 1],
    [{ start: '1', end: '2' }, 1],
    [{ start: '0:00:01.5', end: '0:00:02.5' }, 1],
    [{ start: '', end: '' }, 3],
    [{ start: '   ' }, 3],
  ];
  for (const [adv, expected] of cases) {
    const info = probe(ffmpeg, await run('mp4', fx['clip.mp4'], adv));
    assert.ok(Math.abs(info.duration - expected) < 0.25, `${JSON.stringify(adv)} -> ${info.duration}s (attendu ${expected}s)`);
  }
  // Audio aussi.
  const mp3 = probe(ffmpeg, await run('mp3', fx['tone.wav'], { start: '0.5', end: '1.5' }));
  assert.ok(Math.abs(mp3.duration - 1) < 0.15, `mp3 ${mp3.duration}`);
});

test('découpe : la progression reste dans [0, 1], croissante, et finit à 1', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const seen = [];
  await run('mp4', fx['wide.mp4'], { start: '0.5', end: '1.5' }, { onProgress: (p) => seen.push(p) });
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((p) => p >= 0 && p <= 1), 'bornée');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'croissante');
  assert.equal(seen.at(-1), 1);
});

test('découpe : un début après la fin du fichier est refusé, sans fichier laissé', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const names = () => fs.readdirSync(dir).sort().join();
  const before = names();
  for (const [preset, input] of [['mp4', fx['clip.mp4']], ['mp3', fx['tone.wav']]]) {
    await assert.rejects(run(preset, input, { start: '60' }), (err) => err instanceof MessageError && err.key === 'err.startAfterEnd');
  }
  assert.equal(names(), before);
});

test('découpe invalide : refusée avant tout lancement de FFmpeg', (t) => {
  if (skipIfNoFfmpeg(t)) return;
  for (const adv of [{ start: 'abc' }, { end: '1:2:3:4' }, { start: '-5' }, { start: '30', end: '10' }, { start: '5', end: '5' }, { start: 12 }]) {
    assert.throws(() => convert({ ffmpegPath: ffmpeg, input: fx['clip.mp4'], outputDir: dir, presetId: 'mp4', advanced: adv }), MessageError, JSON.stringify(adv));
  }
});

test('images/s : toutes les valeurs proposées', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  for (const fps of ALLOWED_FPS) {
    const info = probe(ffmpeg, await run('mp4', fx['clip.mp4'], { fps }));
    assert.equal(info.video.fps, fps, `fps ${fps}`);
  }
  // Sans option : fréquence de la source (25).
  assert.equal(probe(ffmpeg, await run('mp4', fx['clip.mp4'], {})).video.fps, 25);
  // Un préréglage qui impose déjà 30 i/s (iPod) : l'option prend le dessus.
  assert.equal(probe(ffmpeg, await run('ipod', fx['clip.mp4'], { fps: 15 })).video.fps, 15);
});

test('résolution : plafond sur le petit côté, jamais d\'agrandissement', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  for (const side of ALLOWED_SHORT_SIDE) {
    const { video } = probe(ffmpeg, await run('mp4', fx['wide.mp4'], { shortSide: side })); // source 1280x720
    const expectedH = Math.min(720, side);
    assert.equal(video.height, expectedH, `plafond ${side}`);
    assert.equal(video.width, Math.floor((expectedH * 16) / 9 / 2) * 2, `largeur pour ${side}`);
  }
  // Vidéo verticale 240x320 : le petit côté est la largeur.
  const vertical = probe(ffmpeg, await run('mp4', fx['vertical.mp4'], { shortSide: 360 })).video;
  assert.deepEqual([vertical.width, vertical.height], [240, 320]);
  // WebM aussi.
  assert.equal(probe(ffmpeg, await run('webm', fx['wide.mp4'], { shortSide: 360 })).video.height, 360);
});

test('qualité : économique < équilibrée < haute (taille du fichier)', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  for (const [preset, input] of [['mp4', fx['wide.mp4']], ['webm', fx['wide.mp4']], ['mp3', fx['tone.wav']], ['m4a', fx['tone.wav']]]) {
    const sizes = [];
    for (const quality of ['low', 'normal', 'high']) {
      sizes.push(fs.statSync(await run(preset, input, { quality })).size);
    }
    assert.ok(sizes[0] < sizes[1] && sizes[1] < sizes[2], `${preset} : ${sizes.join(' < ')}`);
  }
});

test('piste audio : choix de la piste, piste absente, sans audio', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  // multitrack.mkv : piste 1 = 440 Hz, piste 2 = 880 Hz.
  const f0 = dominantFrequency(await run('wav', fx['multitrack.mkv'], { audioTrack: 0 }));
  const f1 = dominantFrequency(await run('wav', fx['multitrack.mkv'], { audioTrack: 1 }));
  assert.ok(Math.abs(f0 - 440) < 25, `piste 1 : ${f0} Hz`);
  assert.ok(Math.abs(f1 - 880) < 40, `piste 2 : ${f1} Hz`);
  // Dans une vidéo aussi.
  const video = await run('mkv', fx['multitrack.mkv'], { audioTrack: 1 });
  assert.equal(probe(ffmpeg, video).audio.length, 1);
  assert.ok(Math.abs(dominantFrequency(video) - 880) < 40);

  // Piste inexistante : audio seul = erreur ; vidéo = sortie sans son (la piste est facultative).
  await assert.rejects(run('wav', fx['multitrack.mkv'], { audioTrack: 3 }));
  assert.equal(probe(ffmpeg, await run('mp4', fx['multitrack.mkv'], { audioTrack: 3 })).audio.length, 0);

  // Sans audio : MP4, WebM, appareil ; sans effet sur un format audio.
  for (const id of ['mp4', 'webm', 'iphone-1080']) {
    assert.equal(probe(ffmpeg, await run(id, fx['clip.mp4'], { mute: true })).audio.length, 0, id);
  }
  assert.equal(probe(ffmpeg, await run('mp3', fx['clip.mp4'], { mute: true })).audio.length, 1);
});

test('GIF : les options de résolution et d\'images/s ne cassent pas la conversion', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const info = probe(ffmpeg, await run('gif', fx['clip.mp4'], { fps: 24, shortSide: 360, start: '0.5', end: '1.5' }));
  assert.equal(info.video.codec, 'gif');
  assert.ok(Math.abs(info.duration - 1) < 0.3, `durée ${info.duration}`);
});

test('toutes les options en même temps', async (t) => {
  if (skipIfNoFfmpeg(t)) return;
  const output = await run('mkv', fx['multitrack.mkv'], {
    quality: 'high', fps: 15, shortSide: 360, audioTrack: 1, start: '0.5', end: '2.5',
  });
  const info = probe(ffmpeg, output);
  assert.equal(info.video.fps, 15);
  assert.equal(info.audio.length, 1);
  assert.ok(Math.abs(info.duration - 2) < 0.25, `durée ${info.duration}`);
});

test('valeurs hors liste refusées (frontière IPC)', (t) => {
  if (skipIfNoFfmpeg(t)) return;
  for (const adv of [{ fps: 7 }, { fps: '30; rm -rf /' }, { shortSide: 1 }, { quality: 'ultra' }, { audioTrack: -1 }, { audioTrack: 1.5 }, { audioTrack: 99 }]) {
    assert.throws(() => convert({ ffmpegPath: ffmpeg, input: fx['clip.mp4'], outputDir: dir, presetId: 'mp4', advanced: adv }), MessageError, JSON.stringify(adv));
  }
});
