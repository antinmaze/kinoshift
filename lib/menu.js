'use strict';

const { app, Menu, shell } = require('electron');

const isMac = process.platform === 'darwin';

// Hub de feedback Supahub (formule gratuite : pas d'API ni de widget, on ouvre donc le site).
const FEEDBACK_URL = 'https://kinoshift.supahub.com';
const DONATE_URL = 'https://ko-fi.com/kinoshift';

/**
 * Menu minimal, aux conventions macOS : app (À propos, Paramètres > Thème, Masquer, Quitter),
 * Fichier, Édition, Fenêtre et Aide. Sous Windows/Linux, Paramètres est dans Fichier.
 * `send(action)` transmet une action de menu au renderer ; `t` traduit les libellés.
 * `ffmpegFound` : l'entrée d'aide « Installer FFmpeg » n'est utile que si aucun FFmpeg n'est disponible.
 */
function buildMenu(send, {
  theme = 'system', setTheme = () => {}, t = (key) => key, ffmpegFound = false, showAbout = () => {}, showHelp = () => {},
} = {}) {
  const name = app.name;

  const settings = {
    label: t('menu.settings'),
    submenu: ['system', 'light', 'dark'].map((id) => ({
      label: t(`menu.theme.${id}`),
      type: 'radio',
      checked: theme === id,
      click: () => setTheme(id),
    })),
  };

  const template = [
    ...(isMac
      ? [{
          label: name,
          submenu: [
            { label: t('menu.about', { name }), click: showAbout },
            { type: 'separator' },
            settings,
            { type: 'separator' },
            { role: 'hide', label: t('menu.hide', { name }) },
            { role: 'hideOthers', label: t('menu.hideOthers') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.quit', { name }) },
          ],
        }]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.addFiles'), accelerator: 'CmdOrCtrl+O', click: () => send('add-files') },
        { label: t('menu.convert'), accelerator: 'CmdOrCtrl+Return', click: () => send('start') },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close', label: t('menu.closeWindow') }]
          : [settings, { type: 'separator' }, { role: 'quit', label: t('menu.quitShort') }]),
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      role: 'windowMenu',
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        ...(isMac ? [] : [{ role: 'close', label: t('menu.close') }]),
        ...(app.isPackaged
          ? []
          : [
              { type: 'separator' },
              { role: 'reload', label: t('menu.reload') },
            ]),
      ],
    },
    {
      role: 'help',
      label: t('menu.help'),
      submenu: [
        { label: t('menu.helpApp', { name }), click: showHelp },
        { type: 'separator' },
        { label: t('menu.feedback.idea'), click: () => shell.openExternal(FEEDBACK_URL) },
        { label: t('menu.donate'), click: () => shell.openExternal(DONATE_URL) },
        ...(ffmpegFound
          ? []
          : [
              { type: 'separator' },
              {
                label: t('menu.installFfmpeg'),
                click: () => shell.openExternal('https://ffmpeg.org/download.html'),
              },
            ]),
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildMenu };
