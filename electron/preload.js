/* Local Keymap - the small, explicit bridge between the page and the desktop shell. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localKeymap', {
  desktop: true,
  platform: process.platform,
  appVersion: () => ipcRenderer.invoke('lk:app-version'),
  listDefinitions: () => ipcRenderer.invoke('lk:list-definitions'),
  readDefinition: (source, file) => ipcRenderer.invoke('lk:read-definition', source, file),
  findViaDefinition: (vendorId, productId) => ipcRenderer.invoke('lk:find-via-definition', vendorId, productId),
  viaInfo: () => ipcRenderer.invoke('lk:via-info'),
  usbPollingRates: () => ipcRenderer.invoke('lk:usb-polling-rates'),
  openDefinitionsFolder: () => ipcRenderer.invoke('lk:open-definitions-folder'),
  // the Endgame Gear mouse through Windows' own HID calls (WebHID can refuse its reports there)
  mouseHid: process.platform === 'win32' ? {
    open: (productId) => ipcRenderer.invoke('lk:mouse-hid', 'open', productId),
    setFeature: (handle, bytes) => ipcRenderer.invoke('lk:mouse-hid', 'set', handle, bytes),
    getFeature: (handle, reportId) => ipcRenderer.invoke('lk:mouse-hid', 'get', handle, reportId),
    close: (handle) => ipcRenderer.invoke('lk:mouse-hid', 'close', handle),
  } : null,
  onChooseDevice: (fn) => { ipcRenderer.on('lk:choose-device', (_e, list) => fn(list)); },
  chooseDevice: (deviceId) => ipcRenderer.send('lk:device-chosen', deviceId || ''),
});
