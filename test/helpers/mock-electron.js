'use strict';

// Faux module `electron` pour tester main.js et lib/menu.js sans lancer Electron.

const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function createElectronMock({
  userData, name = 'Kinoshift', version = '1.2.3', languages = ['en-US'], locale = 'en-US', isPackaged = false, openDialog,
} = {}) {
  const calls = {
    openExternal: [], showItemInFolder: [], messageBoxes: [], openDialogs: [], menus: [], dockIcons: [], quit: 0,
  };
  const ipc = new Map();
  const appEvents = new Map();
  const windows = [];
  let focused = null;

  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.loaded = null;
      this.destroyed = false;
      this.shown = 0;
      this.focusedCount = 0;
      this.events = new Map();
      this.sent = [];
      const wc = {
        events: new Map(),
        openHandler: null,
        on: (ev, cb) => wc.events.set(ev, cb),
        setWindowOpenHandler: (fn) => { wc.openHandler = fn; },
        send: (channel, data) => this.sent.push({ channel, data }),
        isDestroyed: () => this.destroyed,
      };
      this.webContents = wc;
      windows.push(this);
    }

    loadFile(file) { this.loaded = file; }
    on(ev, cb) { this.events.set(ev, cb); }
    show() { this.shown++; }
    focus() { this.focusedCount++; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; this.events.get('closed')?.(); }
    static getAllWindows() { return windows.filter((w) => !w.destroyed); }
    static getFocusedWindow() { return focused; }
  }

  const electron = {
    app: {
      name,
      isPackaged,
      getVersion: () => version,
      getPath: (key) => (key === 'userData' ? userData : os.tmpdir()),
      getPreferredSystemLanguages: () => languages,
      getLocale: () => locale,
      dock: { setIcon: (icon) => calls.dockIcons.push(icon) },
      whenReady: () => ({
        then(cb) {
          electron.app.ready = Promise.resolve().then(cb);
          return electron.app.ready;
        },
      }),
      on: (ev, cb) => appEvents.set(ev, cb),
      quit: () => { calls.quit++; },
    },
    BrowserWindow,
    dialog: {
      showMessageBox: async (opts) => { calls.messageBoxes.push(opts); return { response: 0 }; },
      showOpenDialog: async (_win, opts) => {
        calls.openDialogs.push(opts);
        return openDialog ? openDialog(opts) : { canceled: true, filePaths: [] };
      },
    },
    ipcMain: { handle: (channel, fn) => ipc.set(channel, fn) },
    nativeImage: { createFromPath: (p) => ({ path: p, resize: (size) => ({ path: p, size }) }) },
    nativeTheme: { themeSource: 'system' },
    shell: {
      openExternal: (url) => { calls.openExternal.push(url); return Promise.resolve(); },
      showItemInFolder: (file) => calls.showItemInFolder.push(file),
    },
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: (menu) => calls.menus.push(menu),
    },
  };

  return {
    electron,
    calls,
    windows,
    /** Appelle un gestionnaire IPC comme le ferait le renderer. */
    async invoke(channel, payload) {
      const sent = [];
      const event = { sender: { send: (ch, data) => sent.push({ channel: ch, data }), isDestroyed: () => false }, sent };
      const handler = ipc.get(channel);
      if (!handler) throw new Error(`canal IPC sans gestionnaire : ${channel}`);
      const result = await handler(event, payload);
      return { result, sent };
    },
    handlers: ipc,
    emitApp: (ev, ...args) => appEvents.get(ev)?.(...args),
    hasAppEvent: (ev) => appEvents.has(ev),
    setFocused: (w) => { focused = w; },
    get menu() { return calls.menus.at(-1); },
  };
}

function findItem(template, ...labels) {
  let items = template;
  let item;
  for (const label of labels) {
    item = items.find((i) => i.label === label);
    if (!item) throw new Error(`entrée de menu introuvable : ${label} (parmi ${items.map((i) => i.label).join(', ')})`);
    items = item.submenu ?? [];
  }
  return item;
}

/**
 * Charge un module de l'application avec le faux Electron.
 * `ffmpegStub` : { path } remplace lib/ffmpeg-locate.locateFfmpeg (path = null simule FFmpeg absent).
 */
function loadWithMock(file, mock, { platform, ffmpegStub } = {}) {
  const abs = path.join(ROOT, file);
  const toClear = ['main.js', 'lib/menu.js'].map((f) => path.join(ROOT, f));
  for (const f of toClear) delete require.cache[f];

  const realLocate = require('../../lib/ffmpeg-locate');
  const originalLoad = Module._load;
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  if (platform) Object.defineProperty(process, 'platform', { value: platform });

  Module._load = function patched(request, parent, ...rest) {
    if (request === 'electron') return mock.electron;
    if (ffmpegStub && /ffmpeg-locate$/.test(request)) {
      return { ...realLocate, locateFfmpeg: async () => ffmpegStub.path };
    }
    return originalLoad.call(this, request, parent, ...rest);
  };

  let loaded;
  try {
    loaded = require(abs);
  } finally {
    Module._load = originalLoad;
  }
  return {
    module: loaded,
    restore() {
      if (platform) Object.defineProperty(process, 'platform', originalPlatform);
      for (const f of toClear) delete require.cache[f];
    },
  };
}

function tmpUserData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kinoshift-userdata-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

module.exports = { createElectronMock, loadWithMock, findItem, tmpUserData, ROOT };
