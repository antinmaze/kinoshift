'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const isWin = process.platform === 'win32';
const exeName = isWin ? 'ffmpeg.exe' : 'ffmpeg';

/** FFmpeg embarqué : dossier `resources/ffmpeg` de l'app installée, ou `vendor/ffmpeg/<os>-<arch>` en développement. */
function bundledCandidates() {
  const osName = { darwin: 'mac', win32: 'win' }[process.platform];
  const list = [];
  if (process.resourcesPath) list.push(path.join(process.resourcesPath, 'ffmpeg', exeName));
  if (osName) list.push(path.join(__dirname, '..', 'vendor', 'ffmpeg', `${osName}-${process.arch}`, exeName));
  return list;
}

function candidates(extraPath) {
  const list = [];
  if (extraPath) list.push(extraPath);
  if (process.env.FFMPEG_PATH) list.push(process.env.FFMPEG_PATH);
  list.push(...bundledCandidates());

  // Les apps lancées depuis le Finder / menu Démarrer n'héritent pas toujours du PATH.
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  if (process.platform === 'darwin') {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin');
  } else if (isWin) {
    dirs.push(
      'C:\\ffmpeg\\bin',
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ffmpeg', 'bin'),
      path.join(process.env.ChocolateyInstall || 'C:\\ProgramData\\chocolatey', 'bin'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'),
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims'),
    );
  } else {
    dirs.push('/usr/bin', '/usr/local/bin');
  }
  for (const dir of dirs) list.push(path.join(dir, exeName));
  return list;
}

function checkVersion(file) {
  return new Promise((resolve) => {
    try {
      execFile(file, ['-version'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        resolve(!err && /^ffmpeg version/i.test(stdout || ''));
      });
    } catch {
      resolve(false);
    }
  });
}

/** Retourne le chemin d'un ffmpeg fonctionnel, ou null. */
async function locateFfmpeg(extraPath) {
  for (const file of candidates(extraPath)) {
    if (!path.isAbsolute(file)) continue;
    try {
      if (!fs.statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    if (await checkVersion(file)) return file;
  }
  return null;
}

/** Ensemble des encodeurs disponibles dans ce ffmpeg (vide si la commande échoue). */
function listEncoders(file) {
  return new Promise((resolve) => {
    try {
      execFile(file, ['-hide_banner', '-encoders'], { timeout: 10000, windowsHide: true }, (err, stdout) => {
        const names = new Set();
        if (!err) {
          for (const m of String(stdout).matchAll(/^\s[VAS][.A-Z]{5}\s+(\S+)/gm)) names.add(m[1]);
        }
        resolve(names);
      });
    } catch {
      resolve(new Set()); // binaire non exécutable sur cette machine
    }
  });
}

module.exports = { locateFfmpeg, listEncoders };
