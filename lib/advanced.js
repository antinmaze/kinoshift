'use strict';

const { MessageError } = require('./i18n');

// Options avancées (appliquées par-dessus un preset) : fréquence d'images, résolution,
// qualité, piste audio, découpe. Toutes les valeurs sont validées ici (frontière IPC).

const ALLOWED_FPS = [10, 12, 15, 24, 25, 30, 50, 60];
const ALLOWED_SHORT_SIDE = [2160, 1440, 1080, 720, 480, 360];
const QUALITIES = ['low', 'normal', 'high'];
const MAX_AUDIO_TRACK = 7;

/** `90`, `1:30` ou `01:02:03.5` -> secondes. Retourne null si vide, lève une erreur si invalide. */
function parseTime(value, label = { key: 'time.duration' }) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new MessageError('err.time.invalid', { label });
  const text = value.trim();
  if (text === '') return null;
  const parts = text.split(':');
  if (parts.length > 3 || !parts.every((p) => /^\d+(?:\.\d+)?$/.test(p))) {
    throw new MessageError('err.time.format', { label, text });
  }
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

function normalizeAdvanced(raw) {
  const adv = raw && typeof raw === 'object' ? raw : {};

  const fps = adv.fps == null ? null : Number(adv.fps);
  if (fps !== null && !ALLOWED_FPS.includes(fps)) throw new MessageError('err.fps');

  const shortSide = adv.shortSide == null ? null : Number(adv.shortSide);
  if (shortSide !== null && !ALLOWED_SHORT_SIDE.includes(shortSide)) throw new MessageError('err.size');

  const quality = adv.quality == null ? 'normal' : adv.quality;
  if (!QUALITIES.includes(quality)) throw new MessageError('err.quality');

  const audioTrack = adv.audioTrack == null ? 0 : adv.audioTrack;
  if (!Number.isInteger(audioTrack) || audioTrack < 0 || audioTrack > MAX_AUDIO_TRACK) {
    throw new MessageError('err.audioTrack');
  }

  const start = parseTime(adv.start, { key: 'time.start' }) ?? 0;
  const end = parseTime(adv.end, { key: 'time.end' });
  if (end !== null && end <= start) throw new MessageError('err.endBeforeStart');

  return { fps, shortSide, quality, audioTrack, mute: adv.mute === true, start, end };
}

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
}

function setValue(args, flag, value) {
  const i = args.indexOf(flag);
  if (i !== -1) args[i + 1] = String(value);
}

function applyQuality(args, quality) {
  if (quality === 'normal') return;
  const low = quality === 'low';

  const crf = valueOf(args, '-crf');
  if (crf !== null) {
    const max = valueOf(args, '-c:v') === 'libvpx-vp9' ? 63 : 51;
    setValue(args, '-crf', clamp(Number(crf) + (low ? 4 : -4), 0, max));
  }

  const abr = /^(\d+)k$/.exec(valueOf(args, '-b:a') ?? '');
  if (abr) setValue(args, '-b:a', `${Math.round(Number(abr[1]) * (low ? 0.75 : 1.5))}k`);

  const q = valueOf(args, '-q:a');
  if (q !== null) {
    // MP3 : 0 (meilleur) à 9 ; Vorbis : 0 (pire) à 10.
    if (valueOf(args, '-c:a') === 'libmp3lame') setValue(args, '-q:a', clamp(Number(q) + (low ? 3 : -2), 0, 9));
    else setValue(args, '-q:a', clamp(Number(q) + (low ? -2 : 2), 0, 10));
  }
}

function applyAudioTrack(args, { audioTrack, mute }, audioOnly) {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== '-map') continue;
    const m = /^0:a:0(\??)$/.exec(args[i + 1]);
    if (!m) continue;
    if (mute && !audioOnly) {
      args.splice(i, 2);
      i -= 1;
    } else {
      args[i + 1] = `0:a:${audioTrack}${m[1]}`;
    }
  }
  if (mute && !audioOnly) args.push('-an');
}

function applyVideoFilters(args, preset, { fps, shortSide }) {
  const isGif = preset.id === 'gif';
  const parts = [];

  // Réduit le petit côté à `shortSide` au plus (jamais d'agrandissement), dimensions paires.
  if (shortSide && !isGif) {
    const r = `min(1,${shortSide}/min(iw,ih))`;
    parts.push(`scale='trunc(iw*${r}/2)*2':'trunc(ih*${r}/2)*2'`);
  }

  let vf = valueOf(args, '-vf') ?? '';
  if (fps) {
    if (/fps=\d+/.test(vf)) vf = vf.replace(/fps=\d+/, `fps=${fps}`);
    else vf = vf ? `${vf},fps=${fps}` : `fps=${fps}`;
  }
  if (vf) parts.push(vf);

  if (parts.length === 0) return;
  const joined = parts.join(',');
  if (args.includes('-vf')) setValue(args, '-vf', joined);
  else args.push('-vf', joined);
}

/**
 * Retourne { inputArgs, outputArgs } : options à placer avant `-i` (début de découpe)
 * et arguments de sortie modifiés à partir de ceux du preset.
 */
function applyAdvanced(preset, raw) {
  const adv = normalizeAdvanced(raw);
  const args = [...preset.args];

  applyQuality(args, adv.quality);
  applyAudioTrack(args, adv, preset.audioOnly);
  if (!preset.audioOnly) applyVideoFilters(args, preset, adv);

  const inputArgs = adv.start > 0 ? ['-ss', String(adv.start)] : [];
  if (adv.end !== null) args.push('-t', String(adv.end - adv.start));

  return { inputArgs, outputArgs: args, advanced: adv };
}

module.exports = { applyAdvanced, normalizeAdvanced, parseTime, ALLOWED_FPS, ALLOWED_SHORT_SIDE };
