'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listPresets: () => ipcRenderer.invoke('presets:list'),
  getI18n: () => ipcRenderer.invoke('i18n:get'),
  ffmpegStatus: () => ipcRenderer.invoke('ffmpeg:status'),
  chooseFfmpeg: () => ipcRenderer.invoke('ffmpeg:choose'),
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  reveal: (file) => ipcRenderer.invoke('file:reveal', file),
  pathForFile: (file) => webUtils.getPathForFile(file),
  convert: (job) => ipcRenderer.invoke('convert:start', job),
  cancel: (jobId) => ipcRenderer.invoke('convert:cancel', jobId),
  onMenuAction: (cb) => {
    ipcRenderer.on('menu:action', (_e, action) => cb(action));
  },
  onProgress: (cb) => {
    ipcRenderer.on('convert:progress', (_e, data) => cb(data));
  },
});
