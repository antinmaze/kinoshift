'use strict';

// Vérifie que chaque FFmpeg embarqué (vendor/ffmpeg/*) fournit tous les encodeurs requis par les préréglages.
//   node scripts/check-ffmpeg.js            -> tous les binaires de vendor/
//   node scripts/check-ffmpeg.js /chemin/ffmpeg
// Échoue (code 1) si un encodeur manque ou si aucun binaire n'est trouvé. Un binaire qui ne peut pas
// s'exécuter sur cette machine (ex. Windows depuis macOS) est signalé mais ne fait pas échouer.

const fs = require('node:fs');
const path = require('node:path');
const { listEncoders } = require('../lib/ffmpeg-locate');
const { requiredEncoders } = require('../lib/presets');

function vendorBinaries() {
  const root = path.join(__dirname, '..', 'vendor', 'ffmpeg');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .map((d) => path.join(root, d, d.startsWith('win') ? 'ffmpeg.exe' : 'ffmpeg'))
    .filter((f) => fs.existsSync(f));
}

async function main() {
  const files = process.argv.length > 2 ? process.argv.slice(2) : vendorBinaries();
  if (!files.length) {
    console.error('Aucun FFmpeg trouvé : lancez `npm run fetch-ffmpeg` d\'abord.');
    process.exit(1);
  }
  const required = requiredEncoders();
  let failed = false;
  for (const file of files) {
    const encoders = await listEncoders(file);
    if (!encoders.size) {
      console.log(`? ${file} : non exécutable ici, non vérifié`);
      continue;
    }
    const missing = required.filter((e) => !encoders.has(e));
    if (missing.length) {
      failed = true;
      console.log(`x ${file} : encodeurs manquants : ${missing.join(', ')}`);
    } else {
      console.log(`ok ${file} : ${required.length} encodeurs requis présents`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
