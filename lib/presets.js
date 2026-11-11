'use strict';

const { MessageError } = require('./i18n');

// Chaque preset : { id, label, extension, args, audioOnly }
// `args` est une liste d'arguments FFmpeg (jamais passés à un shell).

const scaleFit = (w, h) =>
  `scale='min(${w},iw)':'min(${h},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`;

const H264_AAC = [
  '-map', '0:v:0', '-map', '0:a:0?',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-ac', '2',
  '-movflags', '+faststart',
];

// Preset « appareil » : MP4 H.264 ou H.265 (HEVC), 8 bits, 4:2:0, réduit sans jamais agrandir.
// `profile`/`level` limitent le flux pour les anciens appareils ; `maxrate` (kbit/s) borne le débit.
const device = (id, label, w, h, opts = {}) => {
  const {
    codec = 'h264', crf, profile, level, maxrate, audioBitrate = '160k', fps,
  } = opts;
  const hevc = codec === 'hevc';
  const vf = fps ? `${scaleFit(w, h)},fps=${fps}` : scaleFit(w, h);
  return {
    id,
    label,
    extension: 'mp4',
    audioOnly: false,
    args: [
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', hevc ? 'libx265' : 'libx264', '-preset', 'medium',
      '-crf', String(crf ?? (hevc ? 24 : 22)), '-pix_fmt', 'yuv420p',
      ...(hevc ? ['-tag:v', 'hvc1'] : []),
      ...(profile ? ['-profile:v', profile] : []),
      ...(level ? ['-level', level] : []),
      ...(maxrate ? ['-maxrate', `${maxrate}k`, '-bufsize', `${maxrate * 2}k`] : []),
      '-vf', vf,
      '-c:a', 'aac', '-b:a', audioBitrate, '-ac', '2',
      '-movflags', '+faststart',
    ],
  };
};

// Fréquences d'échantillonnage (Hz) proposées ; MP3 est limité à 48 kHz.
const RATES_MP3 = [22050, 32000, 44100, 48000];
const RATES_HI = [22050, 32000, 44100, 48000, 88200, 96000];

const audio = (id, label, extension, args, sampleRates, extra = {}) => ({
  id,
  label,
  extension,
  audioOnly: true,
  sampleRates,
  args: ['-vn', '-map', '0:a:0', ...args],
  ...extra,
});

const groups = [
  {
    id: 'audio',
    label: 'Audio',
    presets: [
      audio('mp3', 'MP3', 'mp3', ['-c:a', 'libmp3lame', '-q:a', '2'], RATES_MP3),
      audio('m4a', 'AAC (M4A)', 'm4a', ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'], RATES_HI),
      audio('wav', 'WAV', 'wav', ['-c:a', 'pcm_s16le'], RATES_HI),
      audio('flac', 'FLAC', 'flac', ['-c:a', 'flac'], RATES_HI),
      // Beaucoup de builds FFmpeg (Homebrew récent) n'ont pas libvorbis : repli sur l'encodeur Vorbis natif.
      audio('ogg', 'OGG Vorbis', 'ogg', ['-c:a', 'libvorbis', '-q:a', '5'], RATES_HI, {
        requires: 'libvorbis',
        fallbackArgs: ['-vn', '-map', '0:a:0', '-c:a', 'vorbis', '-strict', '-2', '-b:a', '192k', '-ac', '2'],
      }),
    ],
  },
  {
    id: 'video',
    label: 'Vidéo',
    presets: [
      {
        id: 'mp4',
        label: 'MP4 (H.264)',
        extension: 'mp4',
        audioOnly: false,
        args: H264_AAC,
      },
      {
        id: 'webm',
        label: 'WebM (VP9)',
        extension: 'webm',
        audioOnly: false,
        args: [
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1',
          '-c:a', 'libopus', '-b:a', '128k',
        ],
      },
      {
        id: 'mkv',
        label: 'MKV (H.264)',
        extension: 'mkv',
        audioOnly: false,
        args: [
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '160k',
        ],
      },
      {
        id: 'gif',
        label: 'GIF animé',
        extension: 'gif',
        audioOnly: false,
        args: [
          '-map', '0:v:0', '-an',
          '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
          '-loop', '0',
        ],
      },
    ],
  },
  {
    id: 'apple-recent',
    label: 'Apple : récents',
    presets: [
      device('iphone-4k', 'iPhone 12 à 17 : 4K (HEVC)', 3840, 2160, { codec: 'hevc', audioBitrate: '256k' }),
      device('iphone-1080', 'iPhone 12 à 17 : 1080p (HEVC)', 1920, 1080, { codec: 'hevc' }),
      device('ipad-pro', 'iPad Pro / Air (HEVC)', 2752, 2064, { codec: 'hevc', audioBitrate: '256k' }),
      device('ipad-1080', 'iPad / iPad mini : 1080p', 1920, 1080, { profile: 'high', level: '4.1' }),
      device('appletv-4k', 'Apple TV 4K (HEVC)', 3840, 2160, { codec: 'hevc', audioBitrate: '256k' }),
      device('appletv-hd', 'Apple TV HD : 1080p', 1920, 1080, { profile: 'high', level: '4.1' }),
    ],
  },
  {
    id: 'apple-legacy',
    label: 'Apple : anciens (legacy)',
    presets: [
      device('iphone-6-8', 'iPhone 6 à 8 / SE : 750p', 1334, 750, { profile: 'high', level: '4.1', maxrate: 8000 }),
      device('iphone-5', 'iPhone 5 / 5s / SE 1', 1136, 640, { profile: 'main', level: '3.1', crf: 23, maxrate: 4000 }),
      device('iphone-4', 'iPhone 4 / 4S', 960, 640, { profile: 'main', level: '3.1', crf: 23, maxrate: 3000, fps: 30 }),
      device('ipod', 'iPod classic / nano / touch', 640, 480, { profile: 'baseline', level: '3.0', crf: 24, maxrate: 1500, fps: 30, audioBitrate: '128k' }),
      device('appletv-2-3', 'Apple TV 2 / 3 : 720p', 1280, 720, { profile: 'main', level: '3.1', crf: 23, maxrate: 5000, fps: 30 }),
      device('ipad-legacy', 'iPad 1 à 4 / mini 1', 1024, 768, { profile: 'main', level: '3.1', crf: 23, maxrate: 4000, fps: 30 }),
    ],
  },
  {
    id: 'android',
    label: 'Android',
    presets: [
      device('android-4k', 'Android récent : 4K (HEVC)', 3840, 2160, { codec: 'hevc', audioBitrate: '256k' }),
      device('android-1440', 'Android récent : 1440p', 2560, 1440),
      device('android-1080', 'Android : 1080p', 1920, 1080),
      device('android-720', 'Android legacy : 720p', 1280, 720, { profile: 'main', level: '3.1' }),
      device('android-480', 'Android legacy : 480p', 854, 480, { profile: 'baseline', level: '3.0', crf: 23 }),
    ],
  },
  {
    id: 'other',
    label: 'Autres appareils',
    presets: [
      device('fire-hd', 'Fire HD récent : 1080p', 1920, 1080, { profile: 'high', level: '4.1' }),
      device('switch', 'Nintendo Switch : 1080p', 1920, 1080, { profile: 'high', level: '4.1', maxrate: 10000 }),
      device('kindle-fire', 'Kindle Fire (legacy)', 1224, 600, { profile: 'main', level: '3.1' }),
      device('psp', 'Playstation Portable (legacy)', 320, 240, { profile: 'baseline', level: '3.0', fps: 30 }),
    ],
  },
];

const all = groups.flatMap((g) => g.presets);

/** Encodeurs FFmpeg nécessaires à l'ensemble des préréglages (hors replis). */
function requiredEncoders() {
  const names = new Set();
  for (const p of all) {
    p.args.forEach((a, i) => {
      if (a === '-c:v' || a === '-c:a') names.add(p.args[i + 1]);
    });
    if (p.extension === 'gif') names.add('gif');
  }
  return [...names].sort();
}

function getPreset(id) {
  const preset = all.find((p) => p.id === id);
  if (!preset) throw new MessageError('err.unknownFormat', { id });
  return preset;
}

module.exports = { groups, getPreset, requiredEncoders };
