'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { groups, getPreset } = require('../lib/presets');
const { buildArgs, uniqueOutputPath, parseDuration, parseProgressTime } = require('../lib/converter');
const { locateFfmpeg } = require('../lib/ffmpeg-locate');
const { parseTime, normalizeAdvanced } = require('../lib/advanced');

test('parseTime : secondes, mm:ss et hh:mm:ss', () => {
  assert.equal(parseTime('90'), 90);
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('01:02:03.5'), 3723.5);
  assert.equal(parseTime('  '), null);
  assert.equal(parseTime(null), null);
  assert.throws(() => parseTime('abc'));
  assert.throws(() => parseTime('-5'));
  assert.throws(() => parseTime('1:2:3:4'));
});

test('options avancées : validation', () => {
  assert.throws(() => normalizeAdvanced({ fps: 7 }));
  assert.throws(() => normalizeAdvanced({ shortSide: 999 }));
  assert.throws(() => normalizeAdvanced({ quality: 'ultra' }));
  assert.throws(() => normalizeAdvanced({ audioTrack: 99 }));
  assert.throws(() => normalizeAdvanced({ start: '30', end: '10' }));
  assert.equal(normalizeAdvanced(null).quality, 'normal');
});

test('options avancées : arguments FFmpeg', () => {
  const val = (args, flag) => args[args.indexOf(flag) + 1];

  // Vidéo : qualité (CRF), images/s, résolution, piste audio, découpe.
  const v = buildArgs('/a/b.mov', '/a/b.mp4', 'mp4', null, {
    quality: 'low', fps: 30, shortSide: 720, audioTrack: 1, start: '5', end: '15',
  });
  assert.equal(val(v, '-crf'), '26');
  assert.match(val(v, '-vf'), /^scale=.*720.*,fps=30$/);
  assert.ok(v.includes('0:a:1?'));
  assert.ok(v.indexOf('-ss') < v.indexOf('-i'));
  assert.equal(val(v, '-t'), '10');

  // Preset legacy avec fps déjà fixé : remplacé, pas doublé.
  const p = buildArgs('/a/b.mov', '/a/b.mp4', 'psp', null, { fps: 15 });
  assert.equal((val(p, '-vf').match(/fps=/g) || []).length, 1);
  assert.match(val(p, '-vf'), /fps=15/);

  // Sans audio.
  const m = buildArgs('/a/b.mov', '/a/b.mp4', 'mp4', null, { mute: true });
  assert.ok(m.includes('-an'));
  assert.ok(!m.includes('0:a:0?'));

  // Audio : qualité MP3 / M4A, options vidéo ignorées.
  const a = buildArgs('/a/b.wav', '/a/b.mp3', 'mp3', null, { quality: 'high', fps: 30, mute: true });
  assert.equal(val(a, '-q:a'), '0');
  assert.ok(!a.includes('-vf') && !a.includes('-an'));
  assert.equal(val(buildArgs('/a/b.wav', '/a/b.m4a', 'm4a', null, { quality: 'high' }), '-b:a'), '288k');

  // Par défaut : aucun changement par rapport au preset.
  assert.deepEqual(buildArgs('/a/b.mov', '/a/b.mp4', 'mp4').slice(5, 5 + getPreset('mp4').args.length), getPreset('mp4').args);
});

test('presets : ids uniques et champs requis', () => {
  const ids = groups.flatMap((g) => g.presets).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const g of groups) {
    for (const p of g.presets) {
      assert.ok(p.label && p.extension && Array.isArray(p.args), p.id);
    }
  }
  assert.throws(() => getPreset('nope'));
});

test('OGG : repli sur l\'encodeur Vorbis natif sans libvorbis', () => {
  const val = (args, flag) => args[args.indexOf(flag) + 1];
  const withLib = buildArgs('/a/b.mp3', '/a/b.ogg', 'ogg', null, null, new Set(['libvorbis']));
  assert.equal(val(withLib, '-c:a'), 'libvorbis');
  const without = buildArgs('/a/b.mp3', '/a/b.ogg', 'ogg', null, null, new Set(['aac']));
  assert.equal(val(without, '-c:a'), 'vorbis');
  assert.equal(val(without, '-strict'), '-2');
  assert.equal(val(without, '-b:a'), '192k');
  assert.equal(val(without, '-ac'), '2');
});

test('buildArgs : entrée, sortie et progression', () => {
  const args = buildArgs('/a/b.mov', '/a/b.mp3', 'mp3');
  assert.deepEqual(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2), ['-i', '/a/b.mov']);
  assert.equal(args.at(-1), '/a/b.mp3');
  assert.ok(args.includes('-vn'));
  assert.ok(args.includes('pipe:1'));
});

test('buildArgs : fréquence d’échantillonnage', () => {
  const args = buildArgs('/a/b.wav', '/a/b.mp3', 'mp3', 44100);
  assert.deepEqual(args.slice(args.indexOf('-ar'), args.indexOf('-ar') + 2), ['-ar', '44100']);
  assert.ok(!buildArgs('/a/b.wav', '/a/b.mp3', 'mp3').includes('-ar'));
  assert.throws(() => buildArgs('/a/b.wav', '/a/b.mp3', 'mp3', 96000)); // MP3 limité à 48 kHz
  assert.throws(() => buildArgs('/a/b.mov', '/a/b.mp4', 'mp4', 44100)); // pas un format audio
});

test('uniqueOutputPath : n’écrase jamais un fichier existant', () => {
  const taken = new Set(['/out/a.mp3', '/out/a (1).mp3']);
  assert.equal(uniqueOutputPath('/in/a.wav', '/out', 'mp3', (p) => taken.has(p)), '/out/a (2).mp3');
  assert.equal(uniqueOutputPath('/in/a.wav', '/out', 'mp3', () => false), '/out/a.mp3');
  // Même dossier et même extension que la source : pas d'écrasement de l'entrée.
  assert.equal(uniqueOutputPath('/in/a.mp3', null, 'mp3', () => false), '/in/a (1).mp3');
});

test('parsing de la durée et de la progression', () => {
  assert.equal(parseDuration('  Duration: 00:01:02.50, start'), 62.5);
  assert.equal(parseDuration('rien'), null);
  assert.equal(parseProgressTime('out_time_us=1500000'), 1.5);
  assert.equal(parseProgressTime('out_time_ms=2000000'), 2);
  assert.equal(parseProgressTime('progress=continue'), null);
});

test('conversion réelle avec ffmpeg (ignoré si absent)', async (t) => {
  const ffmpeg = await locateFfmpeg();
  if (!ffmpeg) return t.skip('ffmpeg introuvable');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'tone.wav');
  const gen = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=d=1', input]);
  assert.equal(gen.status, 0);

  const { convert } = require('../lib/converter');
  let last = 0;
  for (const id of ['mp3', 'flac']) {
    const job = convert({ ffmpegPath: ffmpeg, input, outputDir: dir, presetId: id, onProgress: (p) => { last = p; } });
    const { output } = await job.promise;
    assert.ok(fs.statSync(output).size > 0, id);
  }
  assert.equal(last, 1);

  const job = convert({ ffmpegPath: ffmpeg, input, outputDir: dir, presetId: 'mp3', sampleRate: 22050 });
  const { output } = await job.promise;
  const info = spawnSync(ffmpeg, ['-hide_banner', '-i', output], { encoding: 'utf8' });
  assert.match(info.stderr, /22050 Hz/);
});
