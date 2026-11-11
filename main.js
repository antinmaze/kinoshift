'use strict';

const { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { locateFfmpeg, listEncoders } = require('./lib/ffmpeg-locate');
const { convert } = require('./lib/converter');
const { groups } = require('./lib/presets');
const { buildMenu } = require('./lib/menu');
const { THEMES, loadTheme, saveTheme } = require('./lib/theme');
const { resolveLocale, createTranslator, MessageError } = require('./lib/i18n');

let win = null;
let helpWin = null;
let ffmpegPath = null;
let theme = 'system';
let i18n = createTranslator('en'); // remplacé par la langue de l'OS au démarrage
const t = (key, params) => i18n.t(key, params);
const running = new Map(); // jobId -> { cancel }
const encoderCache = new Map(); // chemin ffmpeg -> Set des encodeurs

async function encodersFor(file) {
  if (!encoderCache.has(file)) encoderCache.set(file, await listEncoders(file));
  return encoderCache.get(file);
}

// Les erreurs de la bibliothèque portent une clé de message, traduite ici.
const errorText = (err) => (err instanceof MessageError ? t(err.key, err.params) : err.message);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

// Applique l'apparence (clair / sombre / système), la mémorise et met à jour la coche du menu.
function setTheme(next) {
  if (!THEMES.includes(next)) return;
  theme = next;
  nativeTheme.themeSource = next;
  saveTheme(settingsFile(), next);
  refreshMenu();
}

function refreshMenu() {
  buildMenu(sendMenuAction, {
    theme, setTheme, t, ffmpegFound: Boolean(ffmpegPath), showAbout, showHelp,
  });
}

// Aide Kinoshift : page explicative dans la langue de l'application (anglais par défaut).
function showHelp() {
  if (helpWin && !helpWin.isDestroyed()) {
    helpWin.show();
    helpWin.focus();
    return;
  }
  let file = path.join(__dirname, 'renderer', `help.${i18n.locale}.html`);
  if (!fs.existsSync(file)) file = path.join(__dirname, 'renderer', 'help.en.html');
  helpWin = new BrowserWindow({
    width: 620,
    height: 720,
    minWidth: 420,
    minHeight: 400,
    title: t('menu.helpApp', { name: app.name }),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  helpWin.loadFile(file);
  helpWin.webContents.on('will-navigate', (e) => e.preventDefault());
  helpWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  helpWin.on('closed', () => { helpWin = null; });
}

// À propos : boîte de dialogue avec le logo (le panneau natif affiche l'icône d'Electron en développement).
function showAbout() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 128 });
  dialog.showMessageBox({
    type: 'info',
    title: app.name,
    message: app.name,
    detail: t('about.detail', { version: app.getVersion(), name: app.name }),
    icon,
    buttons: ['OK'],
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 760,
    minWidth: 400,
    minHeight: 600,
    title: 'Kinoshift',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Aucune navigation ni fenêtre externe depuis l'UI.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}

ipcMain.handle('presets:list', () => groups.map((g) => ({
  label: t(`group.${g.id}`),
  presets: g.presets.map((p) => ({
    id: p.id,
    label: i18n.messages[`preset.${p.id}`] ?? p.label,
    audioOnly: p.audioOnly,
    sampleRates: p.sampleRates,
  })),
})));

ipcMain.handle('i18n:get', () => ({ locale: i18n.locale, messages: i18n.messages }));

ipcMain.handle('ffmpeg:status', async () => {
  ffmpegPath = await locateFfmpeg(ffmpegPath);
  refreshMenu();
  return { found: Boolean(ffmpegPath), path: ffmpegPath };
});

ipcMain.handle('ffmpeg:choose', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.ffmpegTitle'),
    properties: ['openFile'],
  });
  if (res.canceled) return { found: Boolean(ffmpegPath), path: ffmpegPath };
  ffmpegPath = await locateFfmpeg(res.filePaths[0]);
  refreshMenu();
  return { found: Boolean(ffmpegPath), path: ffmpegPath };
});

ipcMain.handle('files:choose', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.addFiles'),
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: t('dialog.mediaFilter'), extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('folder:choose', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: t('dialog.outputFolder'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('file:reveal', (_e, file) => {
  if (isString(file)) shell.showItemInFolder(file);
});

ipcMain.handle('convert:start', async (e, {
  jobId, input, outputDir, presetId, sampleRate, advanced,
}) => {
  if (!ffmpegPath) return { ok: false, error: t('ffmpeg.missing') };
  if (!isString(jobId) || !isString(input) || !path.isAbsolute(input)) {
    return { ok: false, error: t('err.invalidParams') };
  }
  if (outputDir != null && !(isString(outputDir) && path.isAbsolute(outputDir))) {
    return { ok: false, error: t('err.invalidOutputDir') };
  }

  let job;
  try {
    const encoders = await encodersFor(ffmpegPath);
    job = convert({
      ffmpegPath,
      input,
      outputDir,
      presetId,
      sampleRate: Number.isInteger(sampleRate) ? sampleRate : null,
      advanced,
      encoders: encoders.size ? encoders : null,
      onProgress: (p) => {
        if (!e.sender.isDestroyed()) e.sender.send('convert:progress', { jobId, progress: p });
      },
    });
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }

  running.set(jobId, job);
  try {
    const { output } = await job.promise;
    return { ok: true, output };
  } catch (err) {
    return { ok: false, canceled: Boolean(err.canceled), error: errorText(err) };
  } finally {
    running.delete(jobId);
  }
});

ipcMain.handle('convert:cancel', (_e, jobId) => {
  const job = running.get(jobId);
  if (job) job.cancel();
});

function sendMenuAction(action) {
  const target = BrowserWindow.getFocusedWindow() || win;
  if (target && !target.isDestroyed()) target.webContents.send('menu:action', action);
}

app.whenReady().then(async () => {
  // En développement, le Dock affiche l'icône d'Electron : on force celle de Kinoshift.
  if (process.platform === 'darwin' && !app.isPackaged) {
    app.dock?.setIcon(path.join(__dirname, 'build', 'icon.png'));
  }
  theme = loadTheme(settingsFile());
  nativeTheme.themeSource = theme;
  // Langue de l'OS (liste ordonnée des préférences), anglais par défaut.
  // KINOSHIFT_LOCALE (ex. « fr ») force la langue : utile pour les tests de bout en bout.
  const preferred = process.env.KINOSHIFT_LOCALE ? [process.env.KINOSHIFT_LOCALE] : (app.getPreferredSystemLanguages?.() ?? []);
  i18n = createTranslator(resolveLocale(preferred.length ? preferred : [app.getLocale()]));
  ffmpegPath = await locateFfmpeg(ffmpegPath);
  refreshMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const job of running.values()) job.cancel();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
