'use strict';

// Tests de bout en bout : vraie application Electron, vraie interface, vrais fichiers, vrai FFmpeg.
// Lancement : npm run test:e2e

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  launch, setStub, getStub, clickMenu, addAndWaitReady,
} = require('./launch');
const { getFfmpeg, tmpDir, makeFixtures, probe } = require('../helpers/media');
const { createTranslator, LOCALES } = require('../../lib/i18n');
const { groups } = require('../../lib/presets');

const isMac = process.platform === 'darwin';
const LONG = 120000;

let ffmpeg;
let fixtures;
let fixturesDir;

before(async () => {
  ffmpeg = await getFfmpeg();
  if (!ffmpeg) return;
  fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-e2e-media-'));
  fixtures = makeFixtures(ffmpeg, fixturesDir, ['tone.wav', 'clip.mp4', 'text.mp4', 'long.mp4']);
  // Nom de fichier très long pour tester le débordement de la mise en page.
  fixtures.longName = path.join(fixturesDir, `${'très-long-nom-de-fichier-'.repeat(6)}.wav`);
  fs.copyFileSync(fixtures['tone.wav'], fixtures.longName);
});
after(() => { if (fixturesDir) fs.rmSync(fixturesDir, { recursive: true, force: true }); });

const needFfmpeg = (t) => {
  if (!ffmpeg) { t.skip('ffmpeg introuvable'); return false; }
  return true;
};

const items = (page) => page.locator('#queue > li');

// ---------- Affichage initial ----------

for (const lang of ['fr', 'en']) {
  test(`affichage initial (${lang}) : textes traduits, formats, états des boutons`, async (t) => {
    const { page } = await launch(t, { lang });
    const msg = LOCALES[lang];
    assert.equal(await page.title(), 'Kinoshift');
    assert.equal(await page.evaluate(() => document.documentElement.lang), lang);
    assert.equal(await page.locator('.beta-badge').textContent(), 'BETA');
    assert.ok(await page.locator('.beta-badge').isVisible());
    assert.equal(await page.locator('.big').textContent(), msg['dropzone.title']);
    assert.equal(await page.locator('#dropzone').getAttribute('aria-label'), msg['dropzone.aria']);
    assert.equal(await page.locator('#start').textContent(), msg['actions.convert']);
    assert.equal(await page.locator('#output-label').textContent(), msg['output.same']);
    assert.equal(await page.locator('#advanced summary').textContent(), msg['adv.summary']);

    // Aucun texte non traduit (clé brute) dans la page.
    const raw = await page.evaluate(() => document.body.innerText.match(/\b(?:menu|dialog|err|adv|item|status|output|format|dropzone|actions)\.[a-z0-9.]+/gi));
    assert.equal(raw, null, `clés brutes affichées : ${raw}`);

    // Tous les préréglages sont proposés, groupés.
    const ids = await page.$$eval('#format option', (o) => o.map((x) => x.value));
    assert.deepEqual(ids, groups.flatMap((g) => g.presets.map((p) => p.id)));
    assert.equal(await page.$$eval('#format optgroup', (g) => g.length), groups.length);
    assert.equal(await page.locator('#format').inputValue(), 'mp4');

    assert.equal(await page.locator('#queue > li').count(), 0);
    assert.ok(await page.locator('#start').isDisabled(), 'Convertir inactif sans fichier');
    assert.ok(await page.locator('#clear').isDisabled(), 'Vider inactif sans fichier');
    assert.ok(await page.locator('#samplerate-row').isHidden());
    assert.ok(await page.locator('#output-reset').isHidden());
    assert.ok(await page.locator('#ffmpeg-banner').isHidden() || !ffmpeg);
  });
}

// ---------- Formats et options ----------

test('format audio : fréquence visible, options vidéo masquées, « Sans audio » désactivé', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  await page.locator('#advanced summary').click();
  await page.locator('#adv-audio').selectOption('mute');
  assert.ok(await page.locator('.adv-video').first().isVisible());

  await page.locator('#format').selectOption('mp3');
  assert.ok(await page.locator('#samplerate-row').isVisible());
  assert.equal(await page.locator('#samplerate').inputValue(), '44100');
  for (const el of await page.locator('.adv-video').all()) assert.ok(await el.isHidden());
  assert.ok(await page.locator('#adv-audio option[value=mute]').isDisabled());
  assert.equal(await page.locator('#adv-audio').inputValue(), '0', 'sélection « sans audio » réinitialisée');

  await page.locator('#format').selectOption('flac');
  assert.ok(await page.locator('#samplerate-row').isVisible());

  await page.locator('#format').selectOption('gif');
  assert.ok(await page.locator('#samplerate-row').isHidden());
  assert.ok(await page.locator('.adv-video').first().isVisible());
  assert.ok(await page.locator('#adv-audio option[value=mute]').isEnabled());
});

test('chaque format audio propose ses fréquences, chaque format vidéo aucune', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  for (const p of groups.flatMap((g) => g.presets)) {
    await page.locator('#format').selectOption(p.id);
    const visible = await page.locator('#samplerate-row').isVisible();
    assert.equal(visible, Boolean(p.sampleRates), p.id);
    if (p.sampleRates) {
      const values = await page.$$eval('#samplerate option', (o) => o.map((x) => x.value).filter(Boolean));
      assert.deepEqual(values, p.sampleRates.map(String), p.id);
    }
  }
});

test('options avancées : repliées au départ, valeurs par défaut', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  assert.equal(await page.locator('#advanced').evaluate((d) => d.open), false);
  await page.locator('#advanced summary').click();
  assert.equal(await page.locator('#adv-quality').inputValue(), 'normal');
  assert.equal(await page.locator('#adv-fps').inputValue(), '');
  assert.equal(await page.locator('#adv-size').inputValue(), '');
  assert.equal(await page.locator('#adv-audio').inputValue(), '0');
  assert.equal(await page.locator('#adv-start').inputValue(), '');
  assert.equal(await page.locator('#adv-end').inputValue(), '');
});

// ---------- Ajout de fichiers, file d'attente ----------

test('ajout par clic, doublons ignorés, retrait, clavier (Entrée et Espace)', async (t) => {
  if (!needFfmpeg(t)) return;
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [fixtures['tone.wav'], fixtures['clip.mp4']] });

  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  assert.equal(await items(page).count(), 2);
  assert.deepEqual(await page.$$eval('.item .name', (n) => n.map((x) => x.textContent)), ['tone.wav', 'clip.mp4']);
  assert.equal(await page.locator('.item .name').first().getAttribute('title'), fixtures['tone.wav']);
  await addAndWaitReady(page);

  // Doublon : ignoré.
  await page.locator('#dropzone').click();
  await page.waitForTimeout(300);
  assert.equal(await items(page).count(), 2);

  // Clavier : Entrée puis Espace sur la zone.
  await setStub(app, { files: [fixtures['text.mp4']] });
  await page.locator('#dropzone').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#queue > li').length === 3);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  assert.equal(await items(page).count(), 3, 'doublon ignoré aussi au clavier');

  // Retrait d'un élément en attente.
  await items(page).nth(2).locator('button').click();
  assert.equal(await items(page).count(), 2);
});

test('sélecteur de fichiers annulé : rien n\'est ajouté', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  await page.locator('#dropzone').click();
  await page.waitForTimeout(300);
  assert.equal(await items(page).count(), 0);
});

test('glisser-déposer : survol visuel, dépôt sans chemin ignoré sans erreur', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluate(() => document.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true })));
  assert.ok(await page.locator('#dropzone').evaluate((el) => el.classList.contains('over')));
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'faux.mp4'));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  assert.equal(await page.locator('#dropzone').evaluate((el) => el.classList.contains('over')), false);
  assert.equal(await items(page).count(), 0);
  assert.deepEqual(errors, []);
});

// ---------- Conversion ----------

test('conversion complète : dossier de sortie, progression, révéler, vider', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const { app, page } = await launch(t, { lang: 'fr' });
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  await setStub(app, { files: [fixtures['tone.wav']], folder: outDir });

  await page.locator('#format').selectOption('flac');
  await page.locator('#output-choose').click();
  await page.waitForFunction((d) => document.getElementById('output-label').textContent === d, outDir);
  assert.ok(await page.locator('#output-reset').isVisible());

  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  await addAndWaitReady(page);
  await page.locator('#start').click();
  await page.locator('.item.done').waitFor({ timeout: 60000 });

  const outputs = fs.readdirSync(outDir);
  assert.equal(outputs.length, 1);
  assert.match(outputs[0], /\.flac$/);
  assert.equal(probe(ffmpeg, path.join(outDir, outputs[0])).audio[0].codec, 'flac');
  assert.equal(fs.readdirSync(fixturesDir).filter((f) => f.endsWith('.flac')).length, 0, 'rien écrit à côté de la source');
  assert.ok(await page.locator('#start').isDisabled(), 'plus rien à convertir');
  assert.ok(await page.locator('#clear').isEnabled());

  // Révéler dans le Finder / l'Explorateur.
  await page.locator('.item.done button').click();
  assert.deepEqual((await getStub(app)).reveal, [path.join(outDir, outputs[0])]);

  // Vider les terminés.
  await page.locator('#clear').click();
  assert.equal(await items(page).count(), 0);
  assert.ok(await page.locator('#clear').isDisabled());

  // Réinitialiser le dossier de sortie.
  await page.locator('#output-reset').click();
  assert.equal(await page.locator('#output-label').textContent(), LOCALES.fr['output.same']);
  assert.ok(await page.locator('#output-reset').isHidden());
});

test('sortie dans le dossier de la source par défaut, sans écraser l\'existant', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const dir = tmpDir(t, 'kinoshift-e2e-src-');
  const src = path.join(dir, 'tone.wav');
  fs.copyFileSync(fixtures['tone.wav'], src);
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [src] });
  await page.locator('#format').selectOption('mp3');

  for (let run = 1; run <= 2; run++) {
    await page.locator('#dropzone').click();
    await page.waitForFunction((n) => document.querySelectorAll('#queue > li').length === n, 1);
    await addAndWaitReady(page);
    await page.locator('#start').click();
    await page.locator('.item.done').first().waitFor({ timeout: 60000 });
    await page.locator('#clear').click();
    assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).length, run, `exécution ${run}`);
  }
  assert.equal(fs.readFileSync(src).length, fs.readFileSync(fixtures['tone.wav']).length, 'source intacte');
});

test('options avancées transmises : « Sans audio » produit une vidéo muette', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [fixtures['clip.mp4']], folder: outDir });
  await page.locator('#output-choose').click();
  await page.locator('#advanced summary').click();
  await page.locator('#format').selectOption('mp4');
  await page.locator('#adv-audio').selectOption('mute');
  await page.locator('#adv-size').selectOption('360');
  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  await addAndWaitReady(page);
  await page.locator('#start').click();
  await page.locator('.item.done').waitFor({ timeout: 60000 });
  const info = probe(ffmpeg, path.join(outDir, fs.readdirSync(outDir)[0]));
  assert.equal(info.audio.length, 0);
  assert.ok(info.video.height <= 360);
});

test('erreurs : fichier invalide et découpe hors durée affichés dans la file', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  const { app, page } = await launch(t, { lang: 'fr' });
  await setStub(app, { files: [fixtures['text.mp4'], fixtures['clip.mp4']], folder: outDir });
  await page.locator('#output-choose').click();
  await page.locator('#advanced summary').click();
  await page.locator('#adv-start').fill('3600');
  await page.locator('#dropzone').click();
  await page.waitForFunction(() => document.querySelectorAll('#queue > li').length === 2);
  await addAndWaitReady(page);
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelectorAll('.item.error').length === 2, null, { timeout: 60000 });
  for (const detail of await page.locator('.item.error .detail').all()) {
    const text = await detail.textContent();
    assert.ok(text.trim() && !/^err\./.test(text), text);
  }
  assert.deepEqual(fs.readdirSync(outDir), [], 'aucun fichier de sortie');
  // Les éléments en erreur peuvent être retirés ou vidés.
  assert.ok(await page.locator('#clear').isEnabled());
  await page.locator('#clear').click();
  assert.equal(await items(page).count(), 0);
});

test('annulation d\'une conversion en cours', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [fixtures['long.mp4']], folder: outDir });
  await page.locator('#output-choose').click();
  await page.locator('#format').selectOption('webm');
  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  await addAndWaitReady(page);
  await page.locator('#start').click();
  await page.locator('.item.running progress').waitFor();
  assert.ok(await page.locator('#start').isDisabled(), 'Convertir inactif pendant la conversion');
  await page.waitForFunction(() => document.querySelector('.item.running progress').value > 0, null, { timeout: 30000 });
  await page.locator('.item.running button').click();
  await page.locator('.item.canceled').waitFor({ timeout: 15000 });
  assert.deepEqual(fs.readdirSync(outDir), [], 'fichier partiel supprimé');
  assert.ok(await page.locator('#start').isDisabled());
});

test('plusieurs fichiers : traités les uns après les autres', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [fixtures['tone.wav'], fixtures['clip.mp4'], fixtures['text.mp4']], folder: outDir });
  await page.locator('#output-choose').click();
  await page.locator('#format').selectOption('wav');
  await page.locator('#dropzone').click();
  await page.waitForFunction(() => document.querySelectorAll('#queue > li').length === 3);
  await addAndWaitReady(page);
  await page.locator('#start').click();
  await page.waitForFunction(() => document.querySelectorAll('.item.done, .item.error').length === 3, null, { timeout: 90000 });
  assert.equal(await page.locator('.item.done').count(), 2);
  assert.equal(await page.locator('.item.error').count(), 1);
  assert.equal(fs.readdirSync(outDir).length, 2);
});

// ---------- Menu natif ----------

test('menu : Ajouter des fichiers et Convertir pilotent l\'interface', { timeout: LONG }, async (t) => {
  if (!needFfmpeg(t)) return;
  const outDir = tmpDir(t, 'kinoshift-e2e-out-');
  const { app, page } = await launch(t, { lang: 'fr' });
  const tr = createTranslator('fr').t;
  await setStub(app, { files: [fixtures['tone.wav']], folder: outDir });
  await page.locator('#format').selectOption('mp3');

  await clickMenu(app, [tr('menu.file'), tr('menu.addFiles')]);
  await items(page).first().waitFor();
  await addAndWaitReady(page);
  await clickMenu(app, [tr('menu.file'), tr('menu.convert')]);
  await page.locator('.item.done, .item.running').first().waitFor({ timeout: 60000 });
});

test('menu : thème appliqué, mémorisé et restauré au prochain lancement', async (t) => {
  const first = await launch(t, { lang: 'fr' });
  const tr = createTranslator('fr').t;
  const theme = () => first.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource);
  assert.equal(await theme(), 'system');
  const base = isMac ? [first.appName, tr('menu.settings')] : [tr('menu.file'), tr('menu.settings')];
  await clickMenu(first.app, [...base, tr('menu.theme.dark')]);
  assert.equal(await theme(), 'dark');
  await page_waitDark(first.app, true);
  await clickMenu(first.app, [...base, tr('menu.theme.light')]);
  assert.equal(await theme(), 'light');
  await page_waitDark(first.app, false);
  await clickMenu(first.app, [...base, tr('menu.theme.dark')]);
  await first.app.close();

  const second = await launch(t, { lang: 'fr', userData: first.userData });
  assert.equal(await second.app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark');
});

const page_waitDark = async (app, dark) => {
  for (let i = 0; i < 20; i++) {
    if (await app.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors) === dark) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.fail(`shouldUseDarkColors != ${dark}`);
};

test('menu Aide : fenêtre d\'aide dans la langue, unique, sans navigation externe', async (t) => {
  for (const lang of ['fr', 'en']) {
    const { app, page, appName } = await launch(t, { lang });
    const tr = createTranslator(lang).t;
    const label = [tr('menu.help'), tr('menu.helpApp', { name: appName })];
    const opened = app.waitForEvent('window');
    await clickMenu(app, label);
    const help = await opened;
    await help.waitForLoadState();
    assert.equal(await help.evaluate(() => document.documentElement.lang), lang);
    assert.equal(await help.title(), await help.evaluate(() => document.title));
    assert.ok((await help.locator('h1').first().textContent()).trim());
    assert.ok(help.url().endsWith(`help.${lang}.html`));

    // Deuxième clic : pas de nouvelle fenêtre.
    await clickMenu(app, label);
    await page.waitForTimeout(300);
    assert.equal(app.windows().length, 2);
    await help.close();
  }
});

test('menu À propos : texte et version', { skip: !isMac && 'entrée présente seulement sous macOS' }, async (t) => {
  const { app, appName } = await launch(t, { lang: 'en' });
  const tr = createTranslator('en').t;
  await clickMenu(app, [appName, tr('menu.about', { name: appName })]);
  const [box] = (await getStub(app)).boxes;
  assert.match(box, /^Kinoshift\nVersion \d+\.\d+\.\d+/);
  assert.match(box, /\bBETA\b/);
  assert.match(box, /GPL/);
  assert.match(box, /without warranty/i);
});

test('menu Aide : idées et dons ouvrent le navigateur par défaut (URL https seulement)', async (t) => {
  const { app } = await launch(t, { lang: 'en' });
  const tr = createTranslator('en').t;
  await app.evaluate(({ shell }) => { globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; });
  await clickMenu(app, [tr('menu.help'), tr('menu.feedback.idea')]);
  await clickMenu(app, [tr('menu.help'), tr('menu.donate')]);
  const opened = await app.evaluate(() => globalThis.__opened);
  assert.deepEqual(opened, ['https://kinoshift.supahub.com', 'https://ko-fi.com/kinoshift']);
});

// ---------- Sécurité ----------

test('sécurité : renderer isolé (pas de Node), API minimale, CSP, navigation et fenêtres bloquées', async (t) => {
  const { app, page } = await launch(t, { lang: 'en' });
  assert.deepEqual(
    await page.evaluate(() => [typeof require, typeof process, typeof module, typeof Buffer]),
    ['undefined', 'undefined', 'undefined', 'undefined'],
  );
  assert.deepEqual(await page.evaluate(() => Object.keys(window.api).sort()), [
    'cancel', 'chooseFfmpeg', 'chooseFiles', 'chooseFolder', 'convert', 'ffmpegStatus', 'getI18n',
    'listPresets', 'onMenuAction', 'onProgress', 'pathForFile', 'reveal',
  ]);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);

  const url = page.url();
  await page.evaluate(() => { location.href = 'https://example.com/'; }).catch(() => {});
  await page.waitForTimeout(500);
  assert.equal(page.url(), url, 'navigation refusée');
  const opened = await page.evaluate(() => window.open('https://example.com/'));
  assert.equal(opened, null);
  await page.waitForTimeout(300);
  assert.equal(app.windows().length, 1);

  // Des entrées hostiles envoyées au processus principal sont refusées proprement.
  const res = await page.evaluate(() => window.api.convert({ jobId: 'x', input: '../etc/passwd', presetId: 'mp3' }));
  assert.equal(res.ok, false);
  await page.evaluate(() => window.api.reveal(12345));
  assert.deepEqual((await getStub(app)).reveal, []);
});

test('sécurité : nom de fichier avec HTML affiché comme texte, jamais interprété', async (t) => {
  if (!needFfmpeg(t)) return;
  const dir = tmpDir(t, 'kinoshift-e2e-xss-');
  const evil = path.join(dir, '<img src=x onerror=alert(1)>.wav');
  fs.copyFileSync(fixtures['tone.wav'], evil);
  const { app, page } = await launch(t, { lang: 'en' });
  await setStub(app, { files: [evil] });
  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  assert.equal(await page.locator('#queue img').count(), 0);
  assert.equal(await page.locator('.item .name').textContent(), '<img src=x onerror=alert(1)>.wav');
});

// ---------- Accessibilité et mise en page ----------

test('accessibilité : zone clavier, contrôles étiquetés, ordre de tabulation', async (t) => {
  const { page } = await launch(t, { lang: 'en' });
  const dz = page.locator('#dropzone');
  assert.equal(await dz.getAttribute('role'), 'button');
  assert.equal(await dz.getAttribute('tabindex'), '0');
  assert.ok((await dz.getAttribute('aria-label')).length > 0);
  assert.equal(await page.locator('#queue').getAttribute('aria-live'), 'polite');

  for (const id of ['format', 'samplerate', 'adv-quality', 'adv-fps', 'adv-size', 'adv-audio', 'adv-start']) {
    assert.equal(await page.locator(`label[for="${id}"]`).count(), 1, `étiquette manquante : ${id}`);
  }
  assert.ok(await page.locator('#adv-end').getAttribute('placeholder'));

  await dz.focus();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dropzone');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'format');
});

test('mise en page : pas de défilement horizontal à la taille minimale, même avec un nom très long', async (t) => {
  if (!needFfmpeg(t)) return;
  const { app, page } = await launch(t, { lang: 'fr' });
  const [minW, minH] = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getMinimumSize());
  assert.ok(minW >= 400 && minH >= 600);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(400, 600));
  await setStub(app, { files: [fixtures.longName] });
  await page.locator('#dropzone').click();
  await items(page).first().waitFor();
  await page.locator('#advanced summary').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `débordement horizontal de ${overflow}px`);
});
