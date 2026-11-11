'use strict';

// Robustesse du convertisseur : annulation, fichiers invalides, noms de fichiers piégeux, dossiers de sortie,
// jamais d'écrasement, aucun processus orphelin.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { convert } = require('../lib/converter');
const { MessageError } = require('../lib/i18n');
const { getFfmpeg, makeFixtures, probe } = require('./helpers/media');

let ffmpeg;
let dir;
let fx;
let outDir;

before(async () => {
  ffmpeg = await getFfmpeg();
  if (!ffmpeg) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-robust-'));
  fx = makeFixtures(ffmpeg, dir, ['tone.wav', 'tone.mp3', 'clip.mp4', 'long.mp4', 'empty.mp3', 'text.mp4', 'corrupt.mp4']);
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const skip = (t) => {
  if (ffmpeg) return false;
  t.skip('ffmpeg introuvable');
  return true;
};

const freshDir = (name) => {
  const d = path.join(dir, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

const ffmpegProcessesUsing = (marker) => {
  if (process.platform === 'win32') return [];
  const ps = spawnSync('ps', ['-axo', 'command='], { encoding: 'utf8' }).stdout;
  return ps.split('\n').filter((l) => l.includes(marker) && l.includes('-progress'));
};

test('annulation : le job est rejeté « canceled », le fichier partiel est supprimé, aucun processus ne reste', async (t) => {
  if (skip(t)) return;
  const out = freshDir('cancel');
  const progress = [];
  let job;
  const started = new Promise((resolve) => {
    job = convert({
      ffmpegPath: ffmpeg, input: fx['long.mp4'], outputDir: out, presetId: 'webm', onProgress: (p) => { progress.push(p); resolve(); },
    });
    setTimeout(resolve, 3000);
  });
  await started;
  job.cancel();
  await assert.rejects(job.promise, (err) => err.canceled === true && err instanceof MessageError && err.key === 'err.canceled');
  assert.deepEqual(fs.readdirSync(out), [], 'fichier partiel supprimé');
  assert.ok(progress.every((p) => p < 1), 'jamais 100 % après annulation');
  assert.deepEqual(ffmpegProcessesUsing(out), [], 'processus FFmpeg terminé');

  // On peut relancer le même fichier juste après.
  const { output } = await convert({ ffmpegPath: ffmpeg, input: fx['clip.mp4'], outputDir: out, presetId: 'mp4' }).promise;
  assert.ok(fs.existsSync(output));
});

test('annulation immédiate et annulation répétée', async (t) => {
  if (skip(t)) return;
  const out = freshDir('cancel2');
  const job = convert({ ffmpegPath: ffmpeg, input: fx['long.mp4'], outputDir: out, presetId: 'webm' });
  job.cancel();
  job.cancel();
  await assert.rejects(job.promise, (err) => err.canceled === true);
  assert.deepEqual(fs.readdirSync(out), []);
});

test('annulation d\'un seul job parmi plusieurs jobs simultanés', async (t) => {
  if (skip(t)) return;
  const out = freshDir('cancel3');
  const a = convert({ ffmpegPath: ffmpeg, input: fx['long.mp4'], outputDir: freshDir('cancel3/a'), presetId: 'webm' });
  const b = convert({ ffmpegPath: ffmpeg, input: fx['clip.mp4'], outputDir: freshDir('cancel3/b'), presetId: 'mp4' });
  a.cancel();
  await assert.rejects(a.promise, (err) => err.canceled === true);
  const { output } = await b.promise;
  assert.ok(fs.statSync(output).size > 0);
  assert.deepEqual(fs.readdirSync(out).sort(), ['a', 'b']);
});

test('fichiers invalides : erreur lisible, aucun fichier de sortie laissé', async (t) => {
  if (skip(t)) return;
  const out = freshDir('invalid');
  const cases = {
    'fichier vide': [fx['empty.mp3'], 'mp3'],
    'texte nommé .mp4': [fx['text.mp4'], 'mp4'],
    'mp4 tronqué': [fx['corrupt.mp4'], 'mp4'],
    'fichier inexistant': [path.join(dir, 'nexiste-pas.mov'), 'mp3'],
    'dossier à la place d\'un fichier': [dir, 'mp3'],
  };
  for (const [label, [input, presetId]] of Object.entries(cases)) {
    await assert.rejects(
      convert({ ffmpegPath: ffmpeg, input, outputDir: out, presetId }).promise,
      (err) => typeof err.message === 'string' && err.message.length > 0 && !err.canceled,
      label,
    );
  }
  assert.deepEqual(fs.readdirSync(out), [], 'aucun fichier partiel');
});

test('FFmpeg introuvable ou non exécutable : le job est rejeté sans planter', async (t) => {
  if (skip(t)) return;
  const out = freshDir('badffmpeg');
  await assert.rejects(convert({ ffmpegPath: path.join(dir, 'absent'), input: fx['tone.wav'], outputDir: out, presetId: 'mp3' }).promise);
  const notExec = path.join(dir, 'pas-un-binaire');
  fs.writeFileSync(notExec, 'hello', { mode: 0o644 });
  await assert.rejects(convert({ ffmpegPath: notExec, input: fx['tone.wav'], outputDir: out, presetId: 'mp3' }).promise);
  assert.deepEqual(fs.readdirSync(out), []);
});

test('format inconnu : erreur immédiate', (t) => {
  if (skip(t)) return;
  assert.throws(() => convert({ ffmpegPath: ffmpeg, input: fx['tone.wav'], presetId: 'nope' }), (err) => err instanceof MessageError && err.key === 'err.unknownFormat');
});

test('noms de fichiers piégeux : espaces, accents, emoji, apostrophes, caractères de shell, tiret initial', async (t) => {
  if (skip(t)) return;
  const names = [
    'avec des espaces',
    'éàüç ñ ß',
    'emoji 🎵 test',
    'l\'apostrophe',
    'guillemets "doubles"',
    '#hash %percent & esperluette',
    '--version',
    '-i',
    'a    b',
    `${'très long '.repeat(15)}nom`.slice(0, 200),
    '日本語のファイル',
  ];
  if (process.platform !== 'win32') names.push('inj; touch PWNED; $(touch PWNED2) `touch PWNED3` | x');

  const src = freshDir('names-src');
  const out = freshDir('names-out');
  for (const name of names) {
    const input = path.join(src, `${name}.wav`);
    fs.copyFileSync(fx['tone.wav'], input);
    const { output } = await convert({ ffmpegPath: ffmpeg, input, outputDir: out, presetId: 'mp3' }).promise;
    assert.equal(output, path.join(out, `${name}.mp3`), name);
    assert.ok(probe(ffmpeg, output).audio.length === 1, name);
  }
  // Rien n'a été exécuté par un shell.
  for (const dirToCheck of [src, out, process.cwd()]) {
    assert.ok(!fs.readdirSync(dirToCheck).some((f) => /^PWNED/.test(f)), `injection dans ${dirToCheck}`);
  }
});

test('fichier sans extension et extension en majuscules', async (t) => {
  if (skip(t)) return;
  const src = freshDir('ext-src');
  const out = freshDir('ext-out');
  fs.copyFileSync(fx['tone.wav'], path.join(src, 'sans-extension'));
  fs.copyFileSync(fx['tone.wav'], path.join(src, 'MAJUSCULES.WAV'));
  const a = await convert({ ffmpegPath: ffmpeg, input: path.join(src, 'sans-extension'), outputDir: out, presetId: 'mp3' }).promise;
  const b = await convert({ ffmpegPath: ffmpeg, input: path.join(src, 'MAJUSCULES.WAV'), outputDir: out, presetId: 'flac' }).promise;
  assert.equal(path.basename(a.output), 'sans-extension.mp3');
  assert.equal(path.basename(b.output), 'MAJUSCULES.flac');
});

test('jamais d\'écrasement : « (1) », « (2) »… et la source reste intacte', async (t) => {
  if (skip(t)) return;
  const src = freshDir('over-src');
  const input = path.join(src, 'son.mp3');
  fs.copyFileSync(fx['tone.mp3'], input);
  const original = fs.readFileSync(input);

  // Même dossier, même format que la source : la source n'est pas écrasée.
  const first = await convert({ ffmpegPath: ffmpeg, input, presetId: 'mp3' }).promise;
  assert.equal(path.basename(first.output), 'son (1).mp3');
  const second = await convert({ ffmpegPath: ffmpeg, input, presetId: 'mp3' }).promise;
  assert.equal(path.basename(second.output), 'son (2).mp3');
  assert.deepEqual(fs.readFileSync(input), original, 'source inchangée');

  // Fichier existant dans le dossier de sortie : il n'est pas modifié.
  const out = freshDir('over-out');
  fs.writeFileSync(path.join(out, 'son.flac'), 'DONNÉES PRÉCIEUSES');
  const { output } = await convert({ ffmpegPath: ffmpeg, input, outputDir: out, presetId: 'flac' }).promise;
  assert.equal(path.basename(output), 'son (1).flac');
  assert.equal(fs.readFileSync(path.join(out, 'son.flac'), 'utf8'), 'DONNÉES PRÉCIEUSES');
});

test('dossier de sortie : inexistant, fichier, lecture seule', async (t) => {
  if (skip(t)) return;
  const input = fx['tone.wav'];
  await assert.rejects(convert({ ffmpegPath: ffmpeg, input, outputDir: path.join(dir, 'absent', 'sous-dossier'), presetId: 'mp3' }).promise, 'dossier inexistant');
  await assert.rejects(convert({ ffmpegPath: ffmpeg, input, outputDir: fx['tone.mp3'], presetId: 'mp3' }).promise, 'dossier = fichier');

  const readOnly = freshDir('readonly');
  fs.chmodSync(readOnly, 0o555);
  t.after(() => fs.chmodSync(readOnly, 0o755));
  const canWrite = (() => { try { fs.writeFileSync(path.join(readOnly, 'x'), ''); return true; } catch { return false; } })();
  if (canWrite) return; // exécuté en root / sous Windows : le test n'a pas de sens
  await assert.rejects(convert({ ffmpegPath: ffmpeg, input, outputDir: readOnly, presetId: 'mp3' }).promise, 'dossier en lecture seule');
  assert.deepEqual(fs.readdirSync(readOnly), []);
});

test('plusieurs conversions de suite : toutes réussissent, la progression finit à 1 à chaque fois', async (t) => {
  if (skip(t)) return;
  const out = freshDir('sequence');
  for (let i = 0; i < 12; i++) {
    let last = 0;
    const { output } = await convert({
      ffmpegPath: ffmpeg, input: fx['clip.mp4'], outputDir: out, presetId: i % 2 ? 'mp3' : 'mp4', onProgress: (p) => { last = p; },
    }).promise;
    assert.ok(fs.existsSync(output));
    assert.equal(last, 1);
  }
  assert.equal(fs.readdirSync(out).length, 12);
  assert.deepEqual(ffmpegProcessesUsing(out), []);
});

test('un fichier source supprimé pendant la conversion : erreur ou sortie, jamais de blocage', async (t) => {
  if (skip(t)) return;
  const src = freshDir('vanish-src');
  const input = path.join(src, 'long.mp4');
  fs.copyFileSync(fx['long.mp4'], input);
  const job = convert({ ffmpegPath: ffmpeg, input, outputDir: freshDir('vanish-out'), presetId: 'mp4' });
  fs.rmSync(input); // le fichier ouvert reste lisible sous macOS/Linux
  const result = await Promise.race([
    job.promise.then(() => 'ok', () => 'erreur'),
    new Promise((resolve) => setTimeout(() => resolve('bloqué'), 60000)),
  ]);
  assert.notEqual(result, 'bloqué');
});
