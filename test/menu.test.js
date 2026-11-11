'use strict';

// Menu de l'application (lib/menu.js) avec un faux Electron, sous macOS puis Windows/Linux, en français et en anglais.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createElectronMock, loadWithMock, findItem } = require('./helpers/mock-electron');
const { createTranslator } = require('../lib/i18n');

function build({ platform = 'darwin', lang = 'en', isPackaged = false, ffmpegFound = true, theme = 'system' } = {}) {
  const mock = createElectronMock({ isPackaged });
  const { module: menuModule, restore } = loadWithMock('lib/menu.js', mock, { platform });
  const { t } = createTranslator(lang);
  const sent = [];
  const themes = [];
  const about = [];
  const help = [];
  menuModule.buildMenu((a) => sent.push(a), {
    theme, setTheme: (id) => themes.push(id), t, ffmpegFound, showAbout: () => about.push(1), showHelp: () => help.push(1),
  });
  restore();
  return { template: mock.menu, mock, t, sent, themes, about, help };
}

const flatten = (items) => items.flatMap((i) => [i, ...(i.submenu ? flatten(i.submenu) : [])]);

test('macOS : menu d\'application, Fichier, Édition, Fenêtre, Aide', () => {
  const { template, t } = build({ platform: 'darwin' });
  assert.deepEqual(template.map((m) => m.label), ['Kinoshift', t('menu.file'), t('menu.edit'), t('menu.window'), t('menu.help')]);
  const app = findItem(template, 'Kinoshift').submenu;
  assert.equal(app[0].label, t('menu.about', { name: 'Kinoshift' }));
  assert.ok(app.some((i) => i.role === 'quit'));
  assert.ok(app.some((i) => i.label === t('menu.settings')), 'Paramètres dans le menu de l\'app');
  assert.ok(!findItem(template, t('menu.file')).submenu.some((i) => i.label === t('menu.settings')));
});

test('Windows/Linux : pas de menu d\'application, Paramètres et Quitter dans Fichier', () => {
  for (const platform of ['win32', 'linux']) {
    const { template, t } = build({ platform });
    assert.deepEqual(template.map((m) => m.label), [t('menu.file'), t('menu.edit'), t('menu.window'), t('menu.help')]);
    const file = findItem(template, t('menu.file')).submenu;
    assert.ok(file.some((i) => i.label === t('menu.settings')), platform);
    assert.ok(file.some((i) => i.role === 'quit' && i.label === t('menu.quitShort')), platform);
    assert.ok(!file.some((i) => i.role === 'close'), platform);
  }
});

test('Fichier : Ajouter des fichiers et Convertir, avec raccourcis et action envoyée au renderer', () => {
  const { template, t, sent } = build();
  const file = findItem(template, t('menu.file')).submenu;
  const add = file.find((i) => i.label === t('menu.addFiles'));
  const start = file.find((i) => i.label === t('menu.convert'));
  assert.equal(add.accelerator, 'CmdOrCtrl+O');
  assert.equal(start.accelerator, 'CmdOrCtrl+Return');
  add.click();
  start.click();
  assert.deepEqual(sent, ['add-files', 'start']);
});

test('Thème : trois choix radio, celui en cours est coché, un clic appelle setTheme', () => {
  for (const current of ['system', 'light', 'dark']) {
    const { template, t, themes } = build({ theme: current });
    const radios = findItem(template, 'Kinoshift', t('menu.settings')).submenu;
    assert.deepEqual(radios.map((r) => r.label), ['system', 'light', 'dark'].map((id) => t(`menu.theme.${id}`)));
    assert.ok(radios.every((r) => r.type === 'radio'));
    assert.deepEqual(radios.filter((r) => r.checked).map((r) => r.label), [t(`menu.theme.${current}`)]);
    radios.forEach((r) => r.click());
    assert.deepEqual(themes, ['system', 'light', 'dark']);
  }
});

test('Aide : aide, idée, café ; liens ouverts dans le navigateur par défaut', () => {
  const { template, t, mock, help } = build();
  const items = findItem(template, t('menu.help')).submenu;
  const helpItem = items.find((i) => i.label === t('menu.helpApp', { name: 'Kinoshift' }));
  helpItem.click();
  assert.equal(help.length, 1);
  items.find((i) => i.label === t('menu.feedback.idea')).click();
  items.find((i) => i.label === t('menu.donate')).click();
  assert.deepEqual(mock.calls.openExternal, ['https://kinoshift.supahub.com', 'https://ko-fi.com/kinoshift']);
  for (const url of mock.calls.openExternal) assert.match(url, /^https:\/\//);
});

test('Aide : « Installer FFmpeg » seulement si FFmpeg est introuvable', () => {
  const found = build({ ffmpegFound: true });
  const missing = build({ ffmpegFound: false });
  const label = missing.t('menu.installFfmpeg');
  assert.ok(!findItem(found.template, found.t('menu.help')).submenu.some((i) => i.label === label));
  const install = findItem(missing.template, missing.t('menu.help')).submenu.find((i) => i.label === label);
  assert.ok(install);
  install.click();
  assert.deepEqual(missing.mock.calls.openExternal, ['https://ffmpeg.org/download.html']);
});

test('À propos : l\'entrée appelle showAbout', () => {
  const { template, t, about } = build();
  findItem(template, 'Kinoshift').submenu.find((i) => i.label === t('menu.about', { name: 'Kinoshift' })).click();
  assert.equal(about.length, 1);
});

test('Recharger : visible en développement, absent de l\'app empaquetée', () => {
  const dev = build({ isPackaged: false });
  const prod = build({ isPackaged: true });
  assert.ok(flatten(dev.template).some((i) => i.role === 'reload'));
  assert.ok(!flatten(prod.template).some((i) => i.role === 'reload'));
});

test('libellés : tous traduits (aucune clé brute), aucun libellé vide, aucun raccourci en double', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const lang of ['en', 'fr']) {
      for (const ffmpegFound of [true, false]) {
        const { template } = build({ platform, lang, ffmpegFound, isPackaged: false });
        const items = flatten(template).filter((i) => i.type !== 'separator');
        for (const item of items) {
          assert.ok(typeof item.label === 'string' && item.label.trim(), `libellé vide (${platform}/${lang}) : ${JSON.stringify(item.role)}`);
          assert.doesNotMatch(item.label, /^(menu|dialog|about|err)\./, `clé non traduite : ${item.label}`);
        }
        const accelerators = items.map((i) => i.accelerator).filter(Boolean);
        assert.equal(new Set(accelerators).size, accelerators.length, 'raccourcis en double');
      }
    }
  }
});

test('français : libellés francisés', () => {
  const { template } = build({ lang: 'fr', platform: 'darwin' });
  const labels = template.map((m) => m.label);
  assert.ok(labels.includes('Fichier'));
  assert.ok(labels.includes('Aide'));
  assert.ok(findItem(template, 'Aide').submenu.some((i) => /Aide Kinoshift/.test(i.label)));
});
