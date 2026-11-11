'use strict';

// Outils communs aux tests : localisation de FFmpeg, génération de médias de test et analyse des sorties
// (sans ffprobe : on lit la sortie de `ffmpeg -i`).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { locateFfmpeg } = require('../../lib/ffmpeg-locate');

let ffmpegPromise;
/** Chemin du FFmpeg utilisé par l'application (null si introuvable). */
const getFfmpeg = () => (ffmpegPromise ??= locateFfmpeg());

function tmpDir(t, prefix = 'kinoshift-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(ffmpeg, args) {
  const res = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} : ${res.stderr}`);
}

const VIDEO_ENC = ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'];

/** Génère les médias de test demandés dans `dir`. Retourne { nom: chemin }. */
function makeFixtures(ffmpeg, dir, names) {
  const out = {};
  const p = (file) => path.join(dir, file);
  const src = (size, dur) => ['-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=25:duration=${dur}`];
  const tone = (freq, dur) => ['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`];

  const builders = {
    // Audio : 2 s de sinus, stéréo 44,1 kHz.
    'tone.wav': () => run(ffmpeg, [...tone(440, 2), '-ac', '2', '-ar', '44100', p('tone.wav')]),
    'tone.mp3': () => run(ffmpeg, [...tone(440, 2), '-c:a', 'libmp3lame', p('tone.mp3')]),
    // Vidéo : 3 s, 320x240, 25 i/s, avec son.
    'clip.mp4': () => run(ffmpeg, [...src('320x240', 3), ...tone(440, 3), ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('clip.mp4')]),
    'clip.mov': () => run(ffmpeg, [...src('320x240', 3), ...tone(440, 3), ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('clip.mov')]),
    // Deux pistes audio (440 Hz puis 880 Hz).
    'multitrack.mkv': () => run(ffmpeg, [
      ...src('320x240', 3), ...tone(440, 3), ...tone(880, 3),
      '-map', '0:v', '-map', '1:a', '-map', '2:a', ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('multitrack.mkv'),
    ]),
    // Vidéo sans piste audio.
    'silent.mp4': () => run(ffmpeg, [...src('320x240', 2), ...VIDEO_ENC, p('silent.mp4')]),
    // Vidéo verticale.
    'vertical.mp4': () => run(ffmpeg, [...src('240x320', 2), ...tone(440, 2), ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('vertical.mp4')]),
    // Plus grande, pour les tests de résolution.
    'wide.mp4': () => run(ffmpeg, [...src('1280x720', 2), ...tone(440, 2), ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('wide.mp4')]),
    // Longue (pour l'annulation) : 40 s en 640x360.
    'long.mp4': () => run(ffmpeg, [...src('640x360', 40), ...tone(440, 40), ...VIDEO_ENC, '-c:a', 'aac', '-shortest', p('long.mp4')]),
    // Fichiers invalides.
    'empty.mp3': () => fs.writeFileSync(p('empty.mp3'), ''),
    'text.mp4': () => fs.writeFileSync(p('text.mp4'), 'ceci n\'est pas une vidéo\n'.repeat(50)),
    'corrupt.mp4': () => {
      run(ffmpeg, [...src('320x240', 2), ...VIDEO_ENC, p('full.mp4')]);
      fs.writeFileSync(p('corrupt.mp4'), fs.readFileSync(p('full.mp4')).subarray(0, 1500)); // moov manquant
      fs.rmSync(p('full.mp4'));
    },
  };

  for (const name of names) {
    if (!builders[name]) throw new Error(`média de test inconnu : ${name}`);
    builders[name]();
    out[name] = p(name);
  }
  return out;
}

/** Analyse un fichier : { duration, video: {codec,width,height,fps,pixFmt}|null, audio: [{codec,rate,channels}] }. */
function probe(ffmpeg, file) {
  const res = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const text = res.stderr;
  const info = { duration: null, video: null, audio: [], text };

  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  if (d) info.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);

  for (const line of text.split('\n')) {
    const v = /Stream #\d+:\d+.*: Video: (\w+).*?, (\w+)(?:\([^)]*\))?(?:, [^,]*)?, (\d+)x(\d+)/.exec(line);
    if (v && !info.video && !/attached pic/.test(line)) {
      const fps = /([\d.]+) fps/.exec(line);
      info.video = {
        codec: v[1], pixFmt: v[2], width: Number(v[3]), height: Number(v[4]), fps: fps ? Number(fps[1]) : null,
      };
      continue;
    }
    const a = /Stream #\d+:\d+.*: Audio: (\w+).*?, (\d+) Hz, ([^,]+)/.exec(line);
    if (a) info.audio.push({ codec: a[1], rate: Number(a[2]), layout: a[3].trim() });
  }
  return info;
}

module.exports = { getFfmpeg, tmpDir, makeFixtures, probe };
