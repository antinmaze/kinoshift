'use strict';

// Outils des tests de bout en bout : lancement réel d'Electron piloté par Playwright.
// Les boîtes de dialogue natives sont remplacées côté processus principal (impossible à piloter autrement).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');

/** Lance l'application avec un dossier utilisateur temporaire et la langue demandée. */
async function launch(t, { lang = 'en', userData } = {}) {
  const dir = userData ?? fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-e2e-'));
  const app = await _electron.launch({
    args: [ROOT, `--user-data-dir=${dir}`],
    env: { ...process.env, KINOSHIFT_LOCALE: lang },
  });
  t.after(async () => {
    await app.close().catch(() => {});
    if (!userData) fs.rmSync(dir, { recursive: true, force: true });
  });

  await app.evaluate(({ dialog, shell }) => {
    globalThis.__stub = { files: [], folder: null, reveal: [], boxes: [] };
    dialog.showOpenDialog = async (_win, opts) => {
      if (opts.properties.includes('openDirectory')) {
        const folder = globalThis.__stub.folder;
        return folder ? { canceled: false, filePaths: [folder] } : { canceled: true, filePaths: [] };
      }
      const files = globalThis.__stub.files;
      return files.length ? { canceled: false, filePaths: files } : { canceled: true, filePaths: [] };
    };
    dialog.showMessageBox = async (opts) => { globalThis.__stub.boxes.push(opts.message + '\n' + opts.detail); return { response: 0 }; };
    shell.showItemInFolder = (file) => { globalThis.__stub.reveal.push(file); };
  });

  const page = await app.firstWindow();
  await page.waitForSelector('html.ready');
  await page.waitForFunction(() => document.querySelectorAll('#format option').length > 0);
  const name = await app.evaluate(({ app: a }) => a.name);
  return { app, page, userData: dir, appName: name };
}

const setStub = (app, patch) => app.evaluate((_electron, p) => { Object.assign(globalThis.__stub, p); }, patch);
const getStub = (app) => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__stub)));

/** Clique une entrée du menu de l'application, par chemin de libellés. */
const clickMenu = (app, labels) => app.evaluate(({ Menu }, path_) => {
  let items = Menu.getApplicationMenu().items;
  let item;
  for (const label of path_) {
    item = items.find((i) => i.label === label);
    if (!item) throw new Error(`entrée de menu introuvable : ${label}`);
    items = item.submenu?.items ?? [];
  }
  item.click();
}, labels);

/** Les boutons Convertir sont inactifs tant que FFmpeg n'est pas détecté : on attend. */
const addAndWaitReady = async (page) => {
  await page.waitForFunction(() => !document.querySelector('#start').disabled);
};

module.exports = {
  launch, setStub, getStub, clickMenu, addAndWaitReady, ROOT,
};
