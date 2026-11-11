/* Local Keymap - desktop shell (Electron).
 * Shows app/index.html in a native window and gives it WebHID access:
 *  - "select-hid-device" is answered by the app's own Material device picker (via IPC),
 *  - device permissions are remembered, so the keyboard reconnects on the next start,
 *  - definitions/ folders are read through IPC instead of a local web server.
 * `--smoke[=demo|device]` runs a self-test, saves screenshots and quits (used for development). */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SMOKE = process.argv.find((a) => a.startsWith('--smoke'));
const SMOKE_MODE = SMOKE ? (SMOKE.split('=')[1] || 'demo') : null;

let win = null;
let pendingChoice = null; // callback from "select-hid-device"
let lastDeviceList = [];
const debug = { selectEvents: 0, rawCount: 0, added: 0 }; // reported by the self-test

// ------------------------------------------------------------------ definitions folders
function definitionDirs() {
  return [
    { key: 'user', dir: path.join(app.getPath('userData'), 'definitions') },
    { key: 'bundled', dir: app.isPackaged ? path.join(process.resourcesPath, 'definitions') : path.join(ROOT, 'definitions') },
  ];
}

function listDefinitions() {
  const out = [];
  for (const { key, dir } of definitionDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')); } catch (_) { continue; }
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        const pick = (k) => (text.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`)) || [])[1] || '';
        out.push({ source: key, file, name: pick('name'), vendorId: pick('vendorId'), productId: pick('productId') });
      } catch (_) { /* unreadable file */ }
    }
  }
  return out;
}

function readDefinition(source, file) {
  const entry = definitionDirs().find((d) => d.key === source);
  if (!entry || typeof file !== 'string' || path.basename(file) !== file || !/\.json$/i.test(file)) {
    throw new Error('Invalid definition file');
  }
  return fs.readFileSync(path.join(entry.dir, file), 'utf8');
}

// ------------------------------------------------------------------ remembered keyboards
// Keyboards the user picked once are allowed again on later starts (so they reconnect by themselves).
const grantsFile = () => path.join(app.getPath('userData'), 'hid-devices.json');
function loadGrants() {
  try { const g = JSON.parse(fs.readFileSync(grantsFile(), 'utf8')); return Array.isArray(g) ? g : []; } catch (_) { return []; }
}
function saveGrant(d) {
  const grants = loadGrants();
  if (grants.some((g) => g.vendorId === d.vendorId && g.productId === d.productId)) return;
  grants.push({ vendorId: d.vendorId, productId: d.productId, name: d.name });
  try { fs.writeFileSync(grantsFile(), JSON.stringify(grants, null, 1)); } catch (_) { /* read-only profile */ }
}
const isGranted = (device) => !!device && loadGrants().some((g) => g.vendorId === device.vendorId && g.productId === device.productId);

function answerChoice(deviceId) {
  if (!pendingChoice) return;
  const cb = pendingChoice;
  pendingChoice = null;
  const picked = lastDeviceList.find((d) => d.deviceId === deviceId);
  if (picked) saveGrant(picked);
  cb(picked ? picked.deviceId : '');
}

// Only accept IPC from our own page.
const fromApp = (event) => {
  const url = event.senderFrame && event.senderFrame.url;
  return typeof url === 'string' && url.startsWith('file://');
};

ipcMain.handle('lk:list-definitions', (e) => (fromApp(e) ? listDefinitions() : []));
ipcMain.handle('lk:read-definition', (e, source, file) => {
  if (!fromApp(e)) throw new Error('Not allowed');
  return readDefinition(source, file);
});
ipcMain.handle('lk:open-definitions-folder', async (e) => {
  if (!fromApp(e)) return '';
  const dir = definitionDirs()[0].dir;
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return dir;
});
ipcMain.on('lk:device-chosen', (e, deviceId) => {
  if (fromApp(e)) answerChoice(typeof deviceId === 'string' ? deviceId : '');
});

// ------------------------------------------------------------------ window
function toInfo(d) {
  return { deviceId: d.deviceId, name: d.name || 'HID device', vendorId: d.vendorId, productId: d.productId };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 760,
    minHeight: 560,
    title: 'Local Keymap',
    icon: path.join(ROOT, 'app', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141218' : '#fef7ff',
    autoHideMenuBar: true,
    show: !SMOKE,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((_wc, permission) => ['hid', 'fullscreen', 'keyboardLock'].includes(permission));
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(['fullscreen', 'keyboardLock', 'pointerLock'].includes(permission)));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isGranted(details.device));

  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    debug.selectEvents++;
    debug.rawCount = (details.deviceList || []).length;
    if (pendingChoice) answerChoice('');
    lastDeviceList = details.deviceList.map(toInfo);
    pendingChoice = callback;
    win.webContents.send('lk:choose-device', lastDeviceList);
    if (SMOKE_MODE === 'device') {
      // self-test: behave like a person - wait for the list to fill, then pick the first keyboard
      setTimeout(() => answerChoice(lastDeviceList[0] ? lastDeviceList[0].deviceId : ''), 2500);
    }
  });
  ses.on('hid-device-added', (_e, details) => {
    debug.added++;
    if (!pendingChoice || !details.device) return;
    lastDeviceList = lastDeviceList.filter((d) => d.deviceId !== details.device.deviceId).concat(toInfo(details.device));
    win.webContents.send('lk:choose-device', lastDeviceList);
  });
  ses.on('hid-device-removed', (_e, details) => {
    if (!pendingChoice || !details.device) return;
    lastDeviceList = lastDeviceList.filter((d) => d.deviceId !== details.device.deviceId);
    win.webContents.send('lk:choose-device', lastDeviceList);
  });

  // No navigation away from the app; web links open in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.loadFile(path.join(ROOT, 'app', 'index.html'));
  if (SMOKE) runSmoke();
}

function setMenu() {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

// ------------------------------------------------------------------ self-test (development only)
async function runSmoke() {
  const outDir = process.env.LK_SMOKE_OUT || app.getPath('temp');
  const report = { mode: SMOKE_MODE, errors: [] };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code, gesture = false) => win.webContents.executeJavaScript(code, gesture);
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
  };
  win.webContents.on('console-message', (...args) => {
    const e = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (e.level === 'error' || e.level === 3) report.errors.push(String(e.message));
  });
  try {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
    win.showInactive(); // screenshots need a visible window
    await wait(1200);
    report.page = await js(`({ title: document.title, hid: 'hid' in navigator, bridge: !!window.localKeymap, platform: window.localKeymap && window.localKeymap.platform })`);
    await shot('smoke-tester.png');
    await js(`document.querySelector('.rail [data-tab=keymap]').click(); 1`);
    if (SMOKE_MODE === 'picker') {
      // open the real device picker, screenshot it, then cancel
      await js(`App.detach().then(() => { document.querySelector('#btnConnect').click(); return 1; })`, true);
      await wait(3000);
      report.pickerOpen = await js(`document.querySelector('#devDialog').open`);
      report.pickerItems = await js(`[...document.querySelectorAll('#devList .dev-option')].map((e) => e.innerText.replace(/\\n/g, ' | '))`);
      await js(`document.querySelector('#devDialog').close('cancel'); 1`);
      await wait(500);
    } else if (SMOKE_MODE === 'device') {
      await wait(1500); // a previously chosen keyboard reconnects by itself
      report.autoConnected = await js(`!!App.state.dev`);
      if (!report.autoConnected) await js(`document.querySelector('#btnConnect').click(); 1`, true);
      await wait(6000);
    } else {
      await js(`App.attach(MockVia.create()).then(() => 1)`);
      await wait(800);
    }
    report.devicesOffered = lastDeviceList;
    report.debug = debug;
    report.granted = await js(`navigator.hid.getDevices().then((ds) => ds.map((d) => d.productName + ' ' + d.vendorId.toString(16) + ':' + d.productId.toString(16) + ' ' + d.collections.map((c) => c.usagePage.toString(16) + '/' + c.usage.toString(16)).join(',')))`);
    report.message = await js(`document.querySelector('#toast').textContent`);
    report.status = await js(`document.querySelector('#devStatus').textContent`);
    report.keys = await js(`document.querySelectorAll('#kmBoard .key').length`);
    report.definitions = await js(`window.localKeymap.listDefinitions().then((l) => l.length)`);
    await shot(`smoke-${SMOKE_MODE}.png`);
  } catch (err) {
    report.errors.push(String(err && err.stack || err));
  }
  fs.writeFileSync(path.join(outDir, 'smoke-report.json'), JSON.stringify(report, null, 2));
  console.log('SMOKE ' + JSON.stringify(report));
  app.quit();
}

// ------------------------------------------------------------------ lifecycle
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    setMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || SMOKE) app.quit();
  });
}
