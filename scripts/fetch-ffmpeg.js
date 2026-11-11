'use strict';

// Télécharge les binaires FFmpeg statiques 9.0.2 (release, GPL, avec x264, x265,
// vpx, opus, lame, vorbis) qui sont embarqués dans l'installeur. Chaque archive est
// vérifiée par empreinte SHA-256 avant extraction.
//
//   node scripts/fetch-ffmpeg.js                 -> plateforme courante
//   node scripts/fetch-ffmpeg.js mac-arm64 win-x64
//   node scripts/fetch-ffmpeg.js all
//
// Destination : vendor/ffmpeg/<mac|win>-<arch>/{ffmpeg[.exe], LICENSE, README}

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const FFMPEG_VERSION = '9.0.2';
const RIEDL = 'https://ffmpeg.martin-riedl.de/download/macos';
const GYAN = `https://github.com/GyanD/codexffmpeg/releases/download/${FFMPEG_VERSION}`;

// Cible -> archive .zip épinglée (URL + SHA-256) et fichiers à en extraire.
// `files` : { destination: chemin (suffixe) dans l'archive }.
const TARGETS = {
  'mac-arm64': {
    url: `${RIEDL}/arm64/1789931890_${FFMPEG_VERSION}/ffmpeg.zip`,
    sha: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
    bin: 'ffmpeg',
    files: { ffmpeg: 'ffmpeg' },
    source: 'Martin Riedl (https://ffmpeg.martin-riedl.de), macOS arm64',
  },
  'mac-x64': {
    url: `${RIEDL}/amd64/1789931006_${FFMPEG_VERSION}/ffmpeg.zip`,
    sha: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
    bin: 'ffmpeg',
    files: { ffmpeg: 'ffmpeg' },
    source: 'Martin Riedl (https://ffmpeg.martin-riedl.de), macOS x86_64',
  },
  'win-x64': {
    url: `${GYAN}/ffmpeg-${FFMPEG_VERSION}-essentials_build.zip`,
    sha: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    bin: 'ffmpeg.exe',
    files: { 'ffmpeg.exe': 'bin/ffmpeg.exe', LICENSE: 'LICENSE', README: 'README.txt' },
    source: 'gyan.dev (https://www.gyan.dev/ffmpeg/builds/), Windows x64',
  },
};

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function hostTarget() {
  const os = { darwin: 'mac', win32: 'win' }[process.platform];
  const key = `${os}-${process.arch}`;
  if (!TARGETS[key]) throw new Error(`Plateforme non prise en charge : ${process.platform}-${process.arch}`);
  return key;
}

// Lecture minimale d'un .zip (méthodes « stored » et « deflate »), sans dépendance.
function unzipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('archive zip invalide');
  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) throw new Error('archive zip invalide');
    const method = buf.readUInt16LE(pos + 10);
    const size = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const local = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    entries.set(name, () => {
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`méthode zip non gérée : ${method}`);
    });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Cherche une entrée par suffixe de chemin ; un nom sans « / » ne cible que la racine
// (ou le dossier racine de l'archive), pas les sous-dossiers.
function findEntry(entries, suffix) {
  for (const [name, read] of entries) {
    if (name === suffix) return read;
    if (name.endsWith(`/${suffix}`) && (suffix.includes('/') || name.split('/').length === 2)) return read;
  }
  throw new Error(`« ${suffix} » introuvable dans l'archive`);
}

function provenance(t) {
  return [
    `FFmpeg ${FFMPEG_VERSION} — build statique GPL v3`,
    `Source du binaire : ${t.source}`,
    `Archive : ${t.url}`,
    `SHA-256 de l'archive : ${t.sha}`,
    '',
    `Code source FFmpeg : https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz`,
    'Les bibliothèques intégrées (x264, x265, libvpx, opus, lame, vorbis…) sont sous leurs licences respectives ;',
    'le binaire est distribué sous GNU GPL v3 (voir LICENSE).',
    '',
  ].join('\n');
}

async function fetchTarget(key, root) {
  const t = TARGETS[key];
  const dir = path.join(root, 'vendor', 'ffmpeg', key);
  const binPath = path.join(dir, t.bin);
  const stamp = path.join(dir, '.archive-sha256');

  if (fs.existsSync(binPath) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === t.sha) {
    console.log(`${key} : déjà présent (${FFMPEG_VERSION})`);
    return;
  }

  console.log(`${key} : téléchargement…`);
  const res = await fetch(t.url);
  if (!res.ok) throw new Error(`${t.url} : HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const got = sha256(archive);
  if (got !== t.sha) throw new Error(`${t.url} : empreinte inattendue (${got})`);

  const entries = unzipEntries(archive);
  const extracted = Object.entries(t.files).map(([dest, suffix]) => [dest, findEntry(entries, suffix)()]);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let upstreamReadme = '';
  for (const [dest, data] of extracted) {
    if (dest === 'README') { upstreamReadme = data.toString('utf8'); continue; }
    fs.writeFileSync(path.join(dir, dest), data, { mode: dest === t.bin ? 0o755 : 0o644 });
  }
  if (!t.files.LICENSE) fs.copyFileSync(path.join(root, 'LICENSE'), path.join(dir, 'LICENSE'));
  fs.writeFileSync(path.join(dir, 'README'), provenance(t) + upstreamReadme);
  fs.writeFileSync(stamp, `${t.sha}\n`);
  console.log(`${key} : OK`);
}

async function main() {
  const root = path.join(__dirname, '..');
  const args = process.argv.slice(2);
  const keys = args.includes('all') ? Object.keys(TARGETS) : (args.length ? args : [hostTarget()]);
  for (const key of keys) {
    if (!TARGETS[key]) throw new Error(`Cible inconnue : ${key} (${Object.keys(TARGETS).join(', ')})`);
    await fetchTarget(key, root);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { TARGETS, FFMPEG_VERSION };
