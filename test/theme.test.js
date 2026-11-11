'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadTheme, saveTheme } = require('../lib/theme');

test('theme : valeur par défaut « system » si le fichier est absent ou invalide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-'));
  const file = path.join(dir, 'settings.json');
  assert.strictEqual(loadTheme(file), 'system');
  fs.writeFileSync(file, '{"theme":"neon"}');
  assert.strictEqual(loadTheme(file), 'system');
  fs.rmSync(dir, { recursive: true });
});

test('theme : sauvegarde puis relecture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-'));
  const file = path.join(dir, 'sub', 'settings.json');
  saveTheme(file, 'dark');
  assert.strictEqual(loadTheme(file), 'dark');
  fs.rmSync(dir, { recursive: true });
});
