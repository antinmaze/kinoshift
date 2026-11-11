'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { LOCALES, resolveLocale, createTranslator, MessageError } = require('../lib/i18n');
const { groups } = require('../lib/presets');
const { parseTime, normalizeAdvanced } = require('../lib/advanced');

test('i18n : la langue de l\'OS est choisie dans l\'ordre de préférence', () => {
  assert.strictEqual(resolveLocale(['fr-FR', 'en-US']), 'fr');
  assert.strictEqual(resolveLocale(['es-ES', 'fr-CA']), 'fr');
  assert.strictEqual(resolveLocale(['en-GB']), 'en');
  assert.strictEqual(resolveLocale(['ja-JP']), 'en'); // repli
  assert.strictEqual(resolveLocale([]), 'en');
});

test('i18n : toutes les langues ont exactement les mêmes clés', () => {
  const keys = (l) => Object.keys(LOCALES[l]).sort();
  for (const l of Object.keys(LOCALES)) assert.deepStrictEqual(keys(l), keys('en'), `langue ${l}`);
});

test('i18n : chaque langue a sa page d\'aide', () => {
  for (const l of Object.keys(LOCALES)) {
    const file = path.join(__dirname, '..', 'renderer', `help.${l}.html`);
    assert.ok(fs.existsSync(file), `help.${l}.html manquant`);
  }
});

test('i18n : paramètres, repli sur la clé et paramètres imbriqués', () => {
  const { t } = createTranslator('fr');
  assert.strictEqual(t('menu.about', { name: 'Kinoshift' }), 'À propos de Kinoshift');
  assert.strictEqual(t('cle.inconnue'), 'cle.inconnue');
  assert.match(t('err.time.invalid', { label: { key: 'time.start' } }), /^Début invalide/);
  assert.strictEqual(createTranslator('xx').locale, 'en');
});

test('i18n : les erreurs de la bibliothèque sont traduisibles', () => {
  let err;
  try { parseTime('abc', { key: 'time.end' }); } catch (e) { err = e; }
  assert.ok(err instanceof MessageError);
  assert.match(createTranslator('en').t(err.key, err.params), /^Invalid end:/);
  assert.throws(() => normalizeAdvanced({ fps: 7 }), MessageError);
});

test('i18n : chaque groupe et chaque format traduit a une clé', () => {
  const ids = new Set(groups.flatMap((g) => g.presets.map((p) => p.id)));
  for (const g of groups) assert.ok(LOCALES.en[`group.${g.id}`], `groupe ${g.id}`);
  for (const key of Object.keys(LOCALES.en).filter((k) => k.startsWith('preset.'))) {
    assert.ok(ids.has(key.slice('preset.'.length)), `format inconnu : ${key}`);
  }
});

test('i18n : toutes les clés data-i18n du HTML existent', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const used = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 20);
  for (const key of used) assert.ok(LOCALES.en[key], `clé manquante : ${key}`);
});
