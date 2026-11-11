'use strict';

// En développement, macOS affiche le nom du bundle Electron.app dans la barre de menus.
// Ce script le remplace par « Kinoshift » (sans effet sur l'app packagée, qui utilise productName).
if (process.platform !== 'darwin') process.exit(0);

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const plist = path.join(
  __dirname, '..', 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'Info.plist',
);
if (!fs.existsSync(plist)) process.exit(0);

const NAME = 'Kinoshift';
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${NAME}`, plist], { stdio: 'ignore' });
  } catch {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${NAME}`, plist], { stdio: 'ignore' });
  }
}
