'use strict';

// Détection de FFmpeg : ordre de priorité, binaires invalides, liste des encodeurs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { locateFfmpeg, listEncoders } = require('../lib/ffmpeg-locate');
const { requiredEncoders } = require('../lib/presets');

const isWin = process.platform === 'win32';
const bundled = path.join(
  __dirname, '..', 'vendor', 'ffmpeg',
  `${{ darwin: 'mac', win32: 'win' }[process.platform] ?? process.platform}-${process.arch}`,
  isWin ? 'ffmpeg.exe' : 'ffmpeg',
);

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-locate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function script(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test('FFmpeg fourni : trouvé en priorité, avant celui du PATH', async (t) => {
  if (!fs.existsSync(bundled)) return t.skip('pas de FFmpeg fourni pour cette plateforme');
  if (isWin) return t.skip('scripts shell');
  const dir = tmp(t);
  script(dir, 'ffmpeg', 'echo "ffmpeg version 0.0-faux"');
  const savedPath = process.env.PATH;
  const savedEnv = process.env.FFMPEG_PATH;
  delete process.env.FFMPEG_PATH;
  process.env.PATH = `${dir}${path.delimiter}${savedPath}`;
  t.after(() => { process.env.PATH = savedPath; if (savedEnv !== undefined) process.env.FFMPEG_PATH = savedEnv; });
  assert.equal(await locateFfmpeg(), bundled);
});

test('chemin choisi par l\'utilisateur : prioritaire s\'il est valide, ignoré sinon', async (t) => {
  if (isWin) return t.skip('scripts shell');
  const dir = tmp(t);
  const fake = script(dir, 'mon-ffmpeg', 'echo "ffmpeg version 99.0-test"');
  assert.equal(await locateFfmpeg(fake), fake);

  // Chemins invalides : on retombe sur un autre FFmpeg (fourni ou installé) ou null, jamais sur le chemin invalide.
  const notFfmpeg = script(dir, 'autre-programme', 'echo "hello"');
  const notExecutable = path.join(dir, 'pas-executable');
  fs.writeFileSync(notExecutable, 'ffmpeg version 1', { mode: 0o644 });
  for (const bad of [notFfmpeg, notExecutable, dir, path.join(dir, 'absent'), 'ffmpeg', '../ffmpeg', '', null, undefined]) {
    const found = await locateFfmpeg(bad);
    assert.notEqual(found, bad || '__aucun__', `chemin invalide accepté : ${bad}`);
    assert.ok(found === null || path.isAbsolute(found));
  }
});

test('variable FFMPEG_PATH : prise en compte', async (t) => {
  if (isWin) return t.skip('scripts shell');
  const dir = tmp(t);
  const fake = script(dir, 'ffmpeg-env', 'echo "ffmpeg version 98.0-env"');
  const saved = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = fake;
  t.after(() => { if (saved === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = saved; });
  assert.equal(await locateFfmpeg(), fake);
});

test('un faux FFmpeg qui ne répond pas est abandonné au bout de quelques secondes', async (t) => {
  if (isWin) return t.skip('scripts shell');
  const dir = tmp(t);
  const hang = script(dir, 'ffmpeg-bloque', 'sleep 30');
  const started = Date.now();
  const found = await locateFfmpeg(hang);
  assert.notEqual(found, hang);
  assert.ok(Date.now() - started < 15000, 'ne bloque pas le démarrage');
});

test('listEncoders : tous les encodeurs requis par les préréglages sont listés', async (t) => {
  const bin = await locateFfmpeg();
  if (!bin) return t.skip('ffmpeg introuvable');
  const encoders = await listEncoders(bin);
  assert.ok(encoders instanceof Set && encoders.size > 20);
  assert.deepEqual(requiredEncoders().filter((e) => !encoders.has(e)), []);
});

test('listEncoders : binaire absent ou invalide -> ensemble vide, sans exception', async (t) => {
  const dir = tmp(t);
  assert.equal((await listEncoders(path.join(dir, 'absent'))).size, 0);
  assert.equal((await listEncoders(dir)).size, 0);
  const text = path.join(dir, 'texte');
  fs.writeFileSync(text, 'pas un binaire');
  assert.equal((await listEncoders(text)).size, 0);
  if (!isWin) {
    const fake = script(dir, 'faux', 'echo "rien d\'utile"');
    assert.equal((await listEncoders(fake)).size, 0);
  }
});

test('requiredEncoders : liste stable et complète', () => {
  const list = requiredEncoders();
  for (const e of ['libx264', 'libx265', 'libvpx-vp9', 'libopus', 'libmp3lame', 'aac', 'flac', 'pcm_s16le', 'libvorbis', 'gif']) {
    assert.ok(list.includes(e), e);
  }
  assert.deepEqual(list, [...list].sort());
});
