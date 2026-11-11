'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Apparence : « system » suit le réglage de macOS / Windows.
const THEMES = ['system', 'light', 'dark'];

function loadTheme(file) {
  try {
    const { theme } = JSON.parse(fs.readFileSync(file, 'utf8'));
    return THEMES.includes(theme) ? theme : 'system';
  } catch {
    return 'system';
  }
}

function saveTheme(file, theme) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ theme }));
  } catch {
    // Préférence non critique : on ignore les erreurs d'écriture.
  }
}

module.exports = { THEMES, loadTheme, saveTheme };
