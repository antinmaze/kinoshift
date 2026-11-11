'use strict';

// Processus principal (main.js) avec un faux Electron : IPC, validations, fenêtres, thème, langue, conversion réelle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createElectronMock, loadWithMock, findItem, tmpUserData, ROOT,
} = require('./helpers/mock-electron');
const { getFfmpeg, tmpDir, makeFixtures, probe } = require('./helpers/media');
const { createTranslator, LOCALES } = require('../lib/i18n');
const { groups } = require('../lib/presets');

async function boot(t, {
  platform, languages, locale, isPackaged, openDialog, ffmpeg, userData,
} = {}) {
  const dir = userData ?? tmpUserData(t);
  const mock = createElectronMock({
    userData: dir, languages, locale, isPackaged, openDialog,
  });
  const stub = ffmpeg === 'missing' ? { path: null } : undefined;
  const { restore } = loadWithMock('main.js', mock, { platform, ffmpegStub: stub });
  t.after(restore);
  await mock.electron.app.ready;
  const lang = createTranslator(mock.languagesFor ?? (languages?.[0]?.startsWith('fr') ? 'fr' : 'en'));
  return { mock, stub, userData: dir, tr: lang.t };
}

const helpMenu = (mock, tr) => findItem(mock.menu, tr('menu.help')).submenu;

test('démarrage : fenêtre principale sécurisée, page, menu, icône du Dock', async (t) => {
  const { mock } = await boot(t, { platform: 'darwin' });
  assert.equal(mock.windows.length, 1);
  const win = mock.windows[0];
  assert.match(win.loaded, /renderer[\\/]index\.html$/);
  assert.deepEqual(
    { ...win.options.webPreferences, preload: undefined },
    { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: undefined },
  );
  assert.ok(fs.existsSync(win.options.webPreferences.preload), 'preload présent');
  assert.ok(win.options.minWidth >= 400 && win.options.minHeight >= 600);
  assert.ok(mock.menu.length >= 4, 'menu défini');
  assert.equal(mock.calls.dockIcons.length, 1);

  // La navigation et les nouvelles fenêtres sont bloquées.
  let prevented = false;
  win.webContents.events.get('will-navigate')({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.deepEqual(win.webContents.openHandler(), { action: 'deny' });
});

test('app empaquetée : pas de réglage de l\'icône du Dock', async (t) => {
  const { mock } = await boot(t, { platform: 'darwin', isPackaged: true });
  assert.equal(mock.calls.dockIcons.length, 0);
});

test('canaux IPC exposés', async (t) => {
  const { mock } = await boot(t);
  for (const ch of ['presets:list', 'i18n:get', 'ffmpeg:status', 'ffmpeg:choose', 'files:choose', 'folder:choose', 'file:reveal', 'convert:start', 'convert:cancel']) {
    assert.ok(mock.handlers.has(ch), ch);
  }
});

test('langue : choix selon les préférences du système', async (t) => {
  const cases = [
    [{ languages: ['fr-FR', 'en-US'] }, 'fr'],
    [{ languages: ['fr-CA'] }, 'fr'],
    [{ languages: ['en-GB'] }, 'en'],
    [{ languages: ['ja-JP'] }, 'en'],
    [{ languages: ['ja-JP', 'fr-FR'] }, 'fr'],
    [{ languages: [], locale: 'fr' }, 'fr'],
    [{ languages: [], locale: 'de' }, 'en'],
  ];
  for (const [opts, expected] of cases) {
    const { mock } = await boot(t, opts);
    const { result } = await mock.invoke('i18n:get');
    assert.equal(result.locale, expected, JSON.stringify(opts));
    assert.deepEqual(result.messages, LOCALES[expected]);
  }
});

test('presets:list : groupes et préréglages complets, libellés traduits', async (t) => {
  for (const [languages, lang] of [[['fr-FR'], 'fr'], [['en-US'], 'en']]) {
    const { mock } = await boot(t, { languages });
    const { result } = await mock.invoke('presets:list');
    const tr = createTranslator(lang).t;
    assert.deepEqual(result.map((g) => g.label), groups.map((g) => tr(`group.${g.id}`)));
    const ids = result.flatMap((g) => g.presets.map((p) => p.id));
    assert.deepEqual(ids, groups.flatMap((g) => g.presets.map((p) => p.id)));
    const iphone = result.flatMap((g) => g.presets).find((p) => p.id === 'iphone-4k');
    assert.equal(iphone.label, LOCALES[lang]['preset.iphone-4k']);
    for (const p of result.flatMap((g) => g.presets)) assert.ok(p.label && !p.label.startsWith('preset.'));
    const mp3 = result[0].presets.find((p) => p.id === 'mp3');
    assert.equal(mp3.audioOnly, true);
  }
});

test('convert:start : paramètres invalides refusés avec un message traduit', async (t) => {
  const { mock, tr } = await boot(t, { languages: ['fr-FR'] });
  const base = { jobId: 'j1', input: '/tmp/x.mp4', presetId: 'mp3' };
  const cases = [
    [{ ...base, jobId: undefined }, 'err.invalidParams'],
    [{ ...base, jobId: '' }, 'err.invalidParams'],
    [{ ...base, jobId: 42 }, 'err.invalidParams'],
    [{ ...base, input: 'relatif/x.mp4' }, 'err.invalidParams'],
    [{ ...base, input: '' }, 'err.invalidParams'],
    [{ ...base, input: 42 }, 'err.invalidParams'],
    [{ ...base, input: null }, 'err.invalidParams'],
    [{ ...base, outputDir: 'relatif' }, 'err.invalidOutputDir'],
    [{ ...base, outputDir: 42 }, 'err.invalidOutputDir'],
    [{ ...base, outputDir: '' }, 'err.invalidOutputDir'],
  ];
  for (const [payload, key] of cases) {
    const { result } = await mock.invoke('convert:start', payload);
    assert.deepEqual(result, { ok: false, error: tr(key) }, JSON.stringify(payload));
  }
});

test('convert:start : fichier absent ou préréglage inconnu -> erreur traduite, sans exception', async (t) => {
  if (!await getFfmpeg()) return t.skip('ffmpeg introuvable');
  const { mock, tr } = await boot(t, { languages: ['fr-FR'] });
  const dir = tmpDir(t);
  const absent = await mock.invoke('convert:start', { jobId: 'a', input: path.join(dir, 'absent.mp4'), presetId: 'mp3' });
  assert.equal(absent.result.ok, false);
  assert.ok(absent.result.error);
  const unknown = await mock.invoke('convert:start', { jobId: 'b', input: path.join(dir, 'x.mp4'), presetId: 'inconnu' });
  assert.deepEqual(unknown.result, { ok: false, error: tr('err.unknownFormat', { id: 'inconnu' }) });
});

test('convert:start : conversion réelle, progression envoyée, sortie vérifiée', async (t) => {
  const ffmpeg = await getFfmpeg();
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  const dir = tmpDir(t);
  const { 'clip.mp4': clip } = makeFixtures(ffmpeg, dir, ['clip.mp4']);
  const out = path.join(dir, 'sortie');
  fs.mkdirSync(out);
  const { mock } = await boot(t);
  const { result, sent } = await mock.invoke('convert:start', {
    jobId: 'job-1', input: clip, outputDir: out, presetId: 'mp4', sampleRate: 1.5, advanced: {},
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(path.dirname(result.output), out);
  const info = probe(ffmpeg, result.output);
  assert.equal(info.video.codec, 'h264');
  const progress = sent.filter((s) => s.channel === 'convert:progress');
  assert.ok(progress.length > 0, 'progression reçue');
  assert.ok(progress.every((s) => s.data.jobId === 'job-1' && s.data.progress >= 0 && s.data.progress <= 1));
});

test('convert:start : option avancée invalide -> message traduit', async (t) => {
  const ffmpeg = await getFfmpeg();
  if (!ffmpeg) return t.skip('ffmpeg introuvable');
  const dir = tmpDir(t);
  const { 'clip.mp4': clip } = makeFixtures(ffmpeg, dir, ['clip.mp4']);
  const { mock, tr } = await boot(t, { languages: ['fr-FR'] });
  const { result } = await mock.invoke('convert:start', {
    jobId: 'j', input: clip, outputDir: dir, presetId: 'mp3', advanced: { start: '3600' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, tr('err.startAfterEnd'));
  assert.ok(!/^err\./.test(result.error), result.error);
});

async function startLong(t, mock, name = 'job-long') {
  const ffmpeg = await getFfmpeg();
  const dir = tmpDir(t);
  const { 'long.mp4': input } = makeFixtures(ffmpeg, dir, ['long.mp4']);
  const promise = mock.invoke('convert:start', { jobId: name, input, outputDir: dir, presetId: 'webm' });
  return { promise, dir };
}

async function untilSettled(promise, action, interval = 250, max = 40) {
  let settled = false;
  const result = promise.finally(() => { settled = true; });
  for (let i = 0; i < max && !settled; i++) {
    await new Promise((r) => setTimeout(r, interval));
    if (!settled) await action();
  }
  return result;
}

test('convert:cancel : annule la conversion en cours et supprime le fichier partiel', async (t) => {
  if (!await getFfmpeg()) return t.skip('ffmpeg introuvable');
  const { mock } = await boot(t, { languages: ['fr-FR'] });
  const { promise, dir } = await startLong(t, mock);
  const { result } = await untilSettled(promise, () => mock.invoke('convert:cancel', 'job-long'));
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.webm')), []);
});

test('convert:cancel : identifiant inconnu ou invalide sans effet', async (t) => {
  const { mock } = await boot(t);
  for (const id of ['inconnu', '', undefined, null, 42, {}]) {
    const { result } = await mock.invoke('convert:cancel', id);
    assert.equal(result, undefined);
  }
});

test('fermeture de l\'app (before-quit) : annule les conversions en cours', async (t) => {
  if (!await getFfmpeg()) return t.skip('ffmpeg introuvable');
  const { mock } = await boot(t);
  const { promise } = await startLong(t, mock, 'job-quit');
  const { result } = await untilSettled(promise, async () => mock.emitApp('before-quit'));
  assert.equal(result.canceled, true);
});

test('files:choose / folder:choose : résultats et annulation', async (t) => {
  const answers = [];
  const { mock } = await boot(t, { openDialog: () => answers.shift() });
  answers.push({ canceled: true, filePaths: [] });
  assert.deepEqual((await mock.invoke('files:choose')).result, []);
  answers.push({ canceled: false, filePaths: ['/a/un.mp4', '/b/deux.mov'] });
  assert.deepEqual((await mock.invoke('files:choose')).result, ['/a/un.mp4', '/b/deux.mov']);
  assert.ok(mock.calls.openDialogs.at(-1).properties.includes('multiSelections'));
  assert.ok(mock.calls.openDialogs.at(-1).properties.includes('openFile'));

  answers.push({ canceled: true, filePaths: [] });
  assert.equal((await mock.invoke('folder:choose')).result, null);
  answers.push({ canceled: false, filePaths: ['/sortie'] });
  assert.equal((await mock.invoke('folder:choose')).result, '/sortie');
  const last = mock.calls.openDialogs.at(-1).properties;
  assert.ok(last.includes('openDirectory') && last.includes('createDirectory'));
});

test('file:reveal : n\'affiche que les chemins texte non vides', async (t) => {
  const { mock } = await boot(t);
  for (const bad of [undefined, null, 42, '', {}, ['/a']]) await mock.invoke('file:reveal', bad);
  assert.deepEqual(mock.calls.showItemInFolder, []);
  await mock.invoke('file:reveal', '/tmp/sortie.mp3');
  assert.deepEqual(mock.calls.showItemInFolder, ['/tmp/sortie.mp3']);
});

test('ffmpeg:status / ffmpeg:choose : FFmpeg fourni, absent, choisi à la main', async (t) => {
  const real = await getFfmpeg();
  const { mock, tr } = await boot(t, {
    openDialog: () => ({ canceled: false, filePaths: [mock2.script] }),
  });
  const mock2 = { script: null };
  const status = (await mock.invoke('ffmpeg:status')).result;
  assert.equal(status.found, Boolean(real));
  assert.equal(status.path, real);
  assert.ok(!helpMenu(mock, tr).some((i) => i.label === tr('menu.installFfmpeg')));

  if (process.platform === 'win32') return;
  const dir = tmpDir(t);
  const script = path.join(dir, 'mon-ffmpeg');
  fs.writeFileSync(script, '#!/bin/sh\necho "ffmpeg version 99.0-test"\n', { mode: 0o755 });
  mock2.script = script;
  const chosen = (await mock.invoke('ffmpeg:choose')).result;
  // Un chemin valide choisi par l'utilisateur est retenu, un chemin invalide ne casse rien.
  assert.ok(chosen.found);
  assert.ok(path.isAbsolute(chosen.path));
});

test('ffmpeg:choose : annulation conserve le FFmpeg actuel', async (t) => {
  const { mock } = await boot(t, { openDialog: () => ({ canceled: true, filePaths: [] }) });
  const before = (await mock.invoke('ffmpeg:status')).result;
  assert.deepEqual((await mock.invoke('ffmpeg:choose')).result, before);
});

test('FFmpeg introuvable : statut, entrée de menu « Installer FFmpeg », conversion refusée, puis retrouvé', async (t) => {
  const real = await getFfmpeg();
  const { mock, stub, tr } = await boot(t, { languages: ['fr-FR'], ffmpeg: 'missing' });
  assert.ok(helpMenu(mock, tr).some((i) => i.label === tr('menu.installFfmpeg')));
  assert.deepEqual((await mock.invoke('ffmpeg:status')).result, { found: false, path: null });
  const refused = await mock.invoke('convert:start', { jobId: 'x', input: '/tmp/x.mp4', presetId: 'mp3' });
  assert.deepEqual(refused.result, { ok: false, error: tr('ffmpeg.missing') });

  if (!real) return;
  stub.path = real;
  assert.deepEqual((await mock.invoke('ffmpeg:status')).result, { found: true, path: real });
  assert.ok(!helpMenu(mock, tr).some((i) => i.label === tr('menu.installFfmpeg')), 'menu mis à jour');
});

test('thème : changement via le menu, application, enregistrement et restauration au redémarrage', async (t) => {
  const userData = tmpUserData(t);
  const first = await boot(t, { userData });
  const tr = first.tr;
  assert.equal(first.mock.electron.nativeTheme.themeSource, 'system');
  const radios = () => findItem(first.mock.menu, 'Kinoshift', tr('menu.settings')).submenu;
  // Sous Linux/Windows, Paramètres est dans Fichier.
  const radiosFile = () => findItem(first.mock.menu, tr('menu.file'), tr('menu.settings')).submenu;
  const list = process.platform === 'darwin' ? radios : radiosFile;

  list().find((r) => r.label === tr('menu.theme.dark')).click();
  assert.equal(first.mock.electron.nativeTheme.themeSource, 'dark');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')), { theme: 'dark' });
  assert.deepEqual(list().filter((r) => r.checked).map((r) => r.label), [tr('menu.theme.dark')]);

  const second = await boot(t, { userData });
  assert.equal(second.mock.electron.nativeTheme.themeSource, 'dark');
});

test('thème : fichier de réglages corrompu -> thème système', async (t) => {
  const userData = tmpUserData(t);
  fs.writeFileSync(path.join(userData, 'settings.json'), '{pas du json');
  const { mock } = await boot(t, { userData });
  assert.equal(mock.electron.nativeTheme.themeSource, 'system');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ theme: 'rose' }));
  const again = await boot(t, { userData });
  assert.equal(again.mock.electron.nativeTheme.themeSource, 'system');
});

test('menu : actions envoyées à la fenêtre', async (t) => {
  const { mock, tr } = await boot(t);
  const win = mock.windows[0];
  const file = findItem(mock.menu, tr('menu.file')).submenu;
  file.find((i) => i.label === tr('menu.addFiles')).click();
  file.find((i) => i.label === tr('menu.convert')).click();
  assert.deepEqual(win.sent, [
    { channel: 'menu:action', data: 'add-files' },
    { channel: 'menu:action', data: 'start' },
  ]);
  // Fenêtre détruite : aucune erreur.
  win.destroyed = true;
  file.find((i) => i.label === tr('menu.addFiles')).click();
  assert.equal(win.sent.length, 2);
});

test('À propos : boîte de dialogue avec version, logo et texte traduit', async (t) => {
  for (const [languages, lang] of [[['en-US'], 'en'], [['fr-FR'], 'fr']]) {
    const { mock } = await boot(t, { languages, platform: 'darwin' });
    const tr = createTranslator(lang).t;
    findItem(mock.menu, 'Kinoshift').submenu.find((i) => i.label === tr('menu.about', { name: 'Kinoshift' })).click();
    const box = mock.calls.messageBoxes.at(-1);
    assert.equal(box.message, 'Kinoshift');
    assert.equal(box.detail, tr('about.detail', { version: '1.2.3', name: 'Kinoshift' }));
    assert.match(box.detail, /1\.2\.3/);
    assert.match(box.icon.path, /build[\\/]icon\.png$/);
  }
});

test('Aide : page dans la langue de l\'app, fenêtre unique, recréée après fermeture', async (t) => {
  for (const [languages, file] of [[['fr-FR'], 'help.fr.html'], [['en-US'], 'help.en.html'], [['ja-JP'], 'help.en.html']]) {
    const { mock } = await boot(t, { languages });
    const lang = file.includes('.fr.') ? 'fr' : 'en';
    const tr = createTranslator(lang).t;
    const open = () => helpMenu(mock, tr).find((i) => i.label === tr('menu.helpApp', { name: 'Kinoshift' })).click();

    open();
    assert.equal(mock.windows.length, 2, languages.join());
    const help = mock.windows[1];
    assert.equal(path.basename(help.loaded), file);
    assert.ok(fs.existsSync(path.join(ROOT, 'renderer', file)));
    assert.equal(help.options.title, tr('menu.helpApp', { name: 'Kinoshift' }));
    assert.deepEqual(
      help.options.webPreferences,
      { contextIsolation: true, nodeIntegration: false, sandbox: true },
    );
    assert.deepEqual(help.webContents.openHandler(), { action: 'deny' });

    open();
    assert.equal(mock.windows.length, 2, 'pas de seconde fenêtre');
    assert.ok(help.shown >= 1 && help.focusedCount >= 1, 'fenêtre existante remise au premier plan');

    help.close();
    open();
    assert.equal(mock.windows.length, 3, 'recréée après fermeture');
  }
});

test('cycle de vie : fermeture de toutes les fenêtres et réactivation', async (t) => {
  const linux = await boot(t, { platform: 'linux' });
  linux.mock.emitApp('window-all-closed');
  assert.equal(linux.mock.calls.quit, 1, 'quitte hors macOS');

  const mac = await boot(t, { platform: 'darwin' });
  mac.mock.windows[0].close();
  mac.mock.emitApp('window-all-closed');
  assert.equal(mac.mock.calls.quit, 0, 'macOS reste actif sans fenêtre');
  mac.mock.emitApp('activate');
  assert.equal(mac.mock.windows.length, 2, 'fenêtre recréée à la réactivation');
  mac.mock.emitApp('activate');
  assert.equal(mac.mock.windows.length, 2, 'pas de doublon si une fenêtre existe');
});
