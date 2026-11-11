/* Local Keymap - the small, explicit bridge between the page and the desktop shell. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localKeymap', {
  desktop: true,
  platform: process.platform,
  listDefinitions: () => ipcRenderer.invoke('lk:list-definitions'),
  readDefinition: (source, file) => ipcRenderer.invoke('lk:read-definition', source, file),
  findViaDefinition: (vendorId, productId) => ipcRenderer.invoke('lk:find-via-definition', vendorId, productId),
  viaInfo: () => ipcRenderer.invoke('lk:via-info'),
  openDefinitionsFolder: () => ipcRenderer.invoke('lk:open-definitions-folder'),
  onChooseDevice: (fn) => { ipcRenderer.on('lk:choose-device', (_e, list) => fn(list)); },
  chooseDevice: (deviceId) => ipcRenderer.send('lk:device-chosen', deviceId || ''),
});
