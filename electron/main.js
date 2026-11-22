/* Local Keymap - desktop shell (Electron).
 * Shows app/index.html in a native window and gives it WebHID access:
 *  - "select-hid-device" is answered by the app's own Material device picker (via IPC),
 *  - device permissions are remembered, so the keyboard reconnects on the next start,
 *  - definitions/ folders are read through IPC instead of a local web server.
 * `--smoke[=demo|grid|via|vial|device|picker|mouse|mousedemo|mousewrite]` runs a self-test, saves screenshots and
 * quits (used for development). `mousewrite` changes three settings on the connected mouse and puts them back. */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, shell, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { usbPollingRates } = require('./usb-polling');
const mouseHid = require('./hid-win');

const ROOT = path.join(__dirname, '..');
const SMOKE = process.argv.find((a) => a.startsWith('--smoke'));
const SMOKE_MODE = SMOKE ? (SMOKE.split('=')[1] || 'demo') : null;
const SMOKE_DEVICE = SMOKE && process.env.LK_SMOKE_DEVICE ? process.env.LK_SMOKE_DEVICE.split(':').map((h) => parseInt(h, 16)) : null;

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

// ------------------------------------------------------------------ VIA's keyboard list, shipped with the app
// generated/via-definitions.json.br is built by scripts/build-via-definitions.js from the-via/keyboards.
let viaBundle;
function viaDefinitions() {
  if (viaBundle !== undefined) return viaBundle;
  viaBundle = null;
  const file = app.isPackaged
    ? path.join(process.resourcesPath, 'via-definitions.json.br')
    : path.join(ROOT, 'generated', 'via-definitions.json.br');
  try {
    const data = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(file)).toString('utf8'));
    if (data && data.format === 'local-keymap-via-definitions' && data.definitions) viaBundle = data;
  } catch (e) {
    console.warn(`VIA keyboard list not available (${e.message}). Run "npm run defs" to build it.`);
  }
  return viaBundle;
}

function findViaDefinition(vid, pid) {
  const b = viaDefinitions();
  if (!b || !Number.isInteger(vid) || !Number.isInteger(pid)) return null;
  const key = `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;
  const definition = b.definitions[key];
  return definition ? { definition, commit: b.commit, generatedAt: b.generatedAt } : null;
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

ipcMain.handle('lk:app-version', (e) => (fromApp(e) ? app.getVersion() : ''));
ipcMain.handle('lk:list-definitions', (e) => (fromApp(e) ? listDefinitions() : []));
ipcMain.handle('lk:read-definition', (e, source, file) => {
  if (!fromApp(e)) throw new Error('Not allowed');
  return readDefinition(source, file);
});
ipcMain.handle('lk:find-via-definition', (e, vid, pid) => (fromApp(e) ? findViaDefinition(vid, pid) : null));
ipcMain.handle('lk:via-info', (e) => {
  const b = fromApp(e) && viaDefinitions();
  return b ? { count: b.count, commit: b.commit, generatedAt: b.generatedAt } : null;
});
ipcMain.handle('lk:usb-polling-rates', (e) => (fromApp(e) ? usbPollingRates() : { supported: false, keyboards: [] }));
// the Endgame Gear mouse on Windows, through Windows' own HID calls (see hid-win.js for why)
ipcMain.handle('lk:mouse-hid', (e, op, a, b) => {
  if (!fromApp(e)) throw new Error('Not allowed');
  if (op === 'open') return mouseHid.open(a);
  if (op === 'set') return mouseHid.setFeature(a, b);
  if (op === 'get') return mouseHid.getFeature(a, b);
  if (op === 'close') return mouseHid.close(a);
  throw new Error('Unknown request');
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
    if (SMOKE_MODE === 'device' || SMOKE_MODE === 'mouse') {
      // self-test: behave like a person - wait for the list to fill, then pick the first keyboard or mouse
      // (or the one LK_SMOKE_DEVICE=vid:pid names)
      setTimeout(() => {
        const want = SMOKE_DEVICE && lastDeviceList.find((d) => d.vendorId === SMOKE_DEVICE[0] && d.productId === SMOKE_DEVICE[1]);
        const pick = want || (SMOKE_DEVICE ? null : lastDeviceList[0]);
        answerChoice(pick ? pick.deviceId : '');
        win.webContents.executeJavaScript(`(() => { const d = document.querySelector('#devDialog'); if (d.open) d.close('auto'); return 1; })()`);
      }, 2500);
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
    if (SMOKE_MODE === 'demo') {
      // the tester's Mouse mode: a click, a second click 20 ms later (too fast), a side button, a scroll
      await js(`document.querySelector('#testerMode [data-mode=mouse]').click(); 1`);
      await wait(300);
      report.mouseTester = await js(`(async () => {
        const pad = document.querySelector('#mtPad'), pause = (ms) => new Promise((r) => setTimeout(r, ms));
        const ev = (type, button) => (type === 'mousedown' ? pad : window).dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
        ev('mousedown', 0); await pause(30); ev('mouseup', 0); await pause(20); ev('mousedown', 0); await pause(30); ev('mouseup', 0);
        await pause(200); ev('mousedown', 3); await pause(30); ev('mouseup', 3);
        pad.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
        await pause(50);
        return { count: document.querySelector('#testerCount').textContent,
          rows: [...document.querySelectorAll('#mtRows tr')].map((tr) => [...tr.cells].map((c) => c.textContent).join(' | ')),
          log: [...document.querySelectorAll('#testerLog li')].map((li) => li.textContent).slice(0, 6) };
      })()`);
      await shot('smoke-mouse-tester.png');
      await js(`document.querySelector('#testerMode [data-mode=browser]').click(); 1`);
    }
    if (SMOKE_MODE === 'mouse' || SMOKE_MODE === 'mousewrite' || SMOKE_MODE === 'mousedemo') {
      // mouse: the real Endgame Gear mouse, read only (status and settings, nothing is written);
      // mousewrite: the real mouse, three settings changed through the page and saved, then the mouse's
      //   original settings written back (only run it when that's wanted);
      // mousedemo: the pretend mouse, edited through the page's controls and saved
      const view = () => js(`({
        title: document.querySelector('#pageTitle').textContent, status: document.querySelector('#msStatus').textContent,
        keyboardButtonShown: getComputedStyle(document.querySelector('#btnConnect')).display !== 'none',
        mouseButton: getComputedStyle(document.querySelector('#btnMsConnect')).display === 'none' ? null : document.querySelector('#btnMsConnect').innerText,
        shown: ['#msEmpty', '#msAsleep', '#msEditor'].filter((s) => !document.querySelector(s).classList.contains('hidden')),
        cards: [...document.querySelectorAll('#msCards .ms-card h3')].map((e) => e.textContent),
        bar: document.querySelector('#msBar').classList.contains('hidden') ? null : document.querySelector('#msBarText').textContent,
        toast: document.querySelector('#toast').className.includes('show') ? document.querySelector('#toast').textContent : null })`);
      const summary = (expr) => js(`(() => { const s = ${expr}; if (!s) return null; const E = EndgameMouse;
        return { polling: (E.POLLING.find(([c]) => c === s.polling) || [0, 'code ' + s.polling])[1], motionSync: s.motionSync, lod: s.glass ? s.lod : E.LOD[s.lod], glass: s.glass,
          angleSnap: s.angleSnap, ripple: s.ripple, angleTune: s.angleTune, liftLed: s.liftLed, slamclick: s.flag('slamclick'), filtersUnlocked: s.flag('filtersUnlocked'), maxFps: s.flag('maxFps'),
          powerSave: s.timer('powerSave'), deepSleep: s.timer('deepSleep'), cpi: [0, 1, 2, 3].slice(0, s.cpiCount).map((i) => s.cpi(i)), cpiCurrent: s.cpiCurrent + 1,
          buttons: E.BUTTONS.map((n, i) => n + ': ' + E.describeAction(s.button(i)).label + (i < 5 ? ' (filter ' + s.filter(i) + ')' : '')), problems: s.problems() }; })()`);
      await js(`document.querySelector('.rail [data-tab=mouse]').click(); 1`);
      await wait(400);
      if (SMOKE_MODE !== 'mousedemo') {
        await wait(5000); // a mouse chosen before reconnects by itself
        if (!(await js(`!!MouseTab.state.dev`))) {
          await js(`document.querySelector('#btnMsConnect').click(); 1`, true);
          await wait(9000);
        }
        report.mouse = await view();
        report.mouseSettings = await summary('MouseTab.state.saved');
        report.mouseInfo = await js(`MouseTab.state.dev && MouseTab.state.dev.info`);
        report.mouseRoute = await js(`MouseTab.state.dev ? (MouseTab.state.dev.hid.route || 'WebHID') : null`); // Windows: the HID helper
        await shot('smoke-mouse.png');
        await js(`window.scrollTo(0, document.body.scrollHeight); 1`);
        await wait(300);
        await shot('smoke-mouse-bottom.png');
        await js(`window.scrollTo(0, 0); 1`);
        if (SMOKE_MODE === 'mousewrite' && (await js(`!!MouseTab.state.saved`))) {
          await js(`window.__orig = Array.from(MouseTab.state.saved.b); 1`);
          const idle = async () => { for (let i = 0; i < 60 && (await js(`MouseTab.state.busy`)); i++) await wait(500); };
          await js(`(() => {
            const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change')); };
            set('ms-dsmin', '4'); set('ms-cpin0X', '810'); set('ms-btn7', 'volDown');
            return 1; })()`);
          await wait(300);
          report.writeEdited = await view();
          const t0 = Date.now();
          await js(`document.querySelector('#btnMsSave').click(); 1`);
          await wait(500);
          await idle();
          report.writeMs = Date.now() - t0;
          report.writeSaved = await view();
          report.writeReadBack = await summary('MouseTab.state.saved');
          report.writeTook = await js(`(() => { const s = MouseTab.state.saved; return { deepSleep: s.timer('deepSleep').minutes, cpi: s.cpi(0).x, wheelDown: EndgameMouse.describeAction(s.button(7)).label,
            otherBytesKept: Array.from(s.b).every((v, i) => [0x03, 0x24, 0x25, 0x26, 0x27, 0x68, 0x69].includes(i) || v === window.__orig[i]) }; })()`);
          await shot('smoke-mouse-written.png');
          // put the mouse's own settings back: read what it holds now, then write the original block
          report.restore = await js(`(async () => {
            const dev = MouseTab.state.dev;
            await dev.readSettings();
            const r = await dev.writeSettings(new EndgameMouse.Settings(window.__orig));
            const same = Array.from(r.settings.b).every((v, i) => v === window.__orig[i]);
            return { sections: r.sections, sameAsBefore: same };
          })()`);
          await js(`MouseTab.refresh().then(() => 1)`);
          await wait(500);
          await idle();
          report.afterRestore = await summary('MouseTab.state.saved');
        }
      } else {
        report.mouseEmpty = await view();
        await shot('smoke-mouse-empty.png');
        await js(`window.__mm = MockMouse.create(); MouseTab.attach(window.__mm, { timeScale: 0 }).then(() => 1)`);
        await wait(800);
        report.mouseDemo = await view();
        report.mouseDemoSettings = await summary('MouseTab.state.saved');
        await shot('smoke-mouse.png');
        // change things through the page's own controls
        await js(`(() => {
          const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change')); };
          const flip = (id) => { const e = document.getElementById(id); e.checked = !e.checked; e.dispatchEvent(new Event('change')); };
          set('ms-poll', '2');
          flip('ms-msync');
          [...document.querySelectorAll('#msCards .segmented button')].find((b) => b.textContent === '3').click();
          set('ms-cpin1X', '1234');
          set('ms-lod', '5');
          set('ms-btn3', 'key');
          document.getElementById('ms-btn3').closest('.ms-group').querySelector('.ms-extra .btn').click();
          window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true }));
          set('ms-btn7', 'volDown');
          flip('ms-unlock');
          set('ms-spdt0', '241');
          set('ms-dsmin', '10');
          return 1; })()`);
        await wait(400);
        report.mouseEdited = await view();
        await shot('smoke-mouse-edited.png');
        await js(`document.querySelector('#btnMsSave').click(); 1`);
        await wait(1500);
        report.mouseSaved = await view();
        report.mouseWritten = await summary('new EndgameMouse.Settings(window.__mm.mock.block)');
        report.mouseCommands = await js(`({ kinds: [...new Set(window.__mm.mock.sent.map((x) => x[0].toString(16)))], refused: window.__mm.mock.refused })`);
        await shot('smoke-mouse-saved.png');
        await js(`window.scrollTo(0, document.body.scrollHeight); 1`);
        await wait(300);
        await shot('smoke-mouse-bottom.png');
        await js(`window.scrollTo(0, 0); 1`);
        // the defaults, then discard
        await js(`[...document.querySelectorAll('#msCards .btn')].find((b) => b.textContent.includes('Defaults')).click(); 1`);
        await wait(300);
        report.mouseDefaults = await view();
        await js(`document.querySelector('#btnMsDiscard').click(); 1`);
        await wait(300);
        report.mouseDiscarded = await view();
      }
      await wait(300);
      throw Object.assign(new Error('done'), { done: true });
    }
    await js(`App.setTab('keymap'); 1`);
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
      if (report.autoConnected && SMOKE_DEVICE) {
        const ids = await js(`[App.state.dev.vendorId, App.state.dev.productId]`);
        if (ids[0] !== SMOKE_DEVICE[0] || ids[1] !== SMOKE_DEVICE[1]) { await js(`App.detach().then(() => 1)`); report.autoConnected = false; }
      }
      if (!report.autoConnected) await js(`document.querySelector('#btnConnect').click(); 1`, true);
      await wait(8000);
      report.rttProbe = await js(`(async () => {
        const d = App.state.dev;
        if (!d) return null;
        const q = d.kind === 'venom' ? [222] : [1];
        const t = [];
        for (let i = 0; i < 400; i++) { const t0 = performance.now(); await d.send(q); t.push(performance.now() - t0); }
        const s = [...t].sort((a, b) => a - b), p = (x) => s[Math.floor(x * (s.length - 1))].toFixed(3);
        const hist = {};
        t.forEach((v) => { const b = (Math.round(v * 8) / 8).toFixed(3); hist[b] = (hist[b] || 0) + 1; });
        const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => k + 'ms:' + v).join(' ');
        return { min: p(0), p10: p(0.1), median: p(0.5), p90: p(0.9), max: p(1), top, info: d.info ? { usbSpeed: d.info.usbSpeed, force1k: d.info.force1k, fw: d.info.firmware } : null };
      })()`);
      report.page2 = await js(`({ need: !document.querySelector('#kmNeedDef').classList.contains('hidden'), editor: !document.querySelector('#kmEditor').classList.contains('hidden'), vial: App.state.dev && App.state.dev.vialProtocol, protocol: App.state.protocol, layers: App.state.layers })`);
      // read-only: would the matrix size have been found without any layout? (VIA keyboards)
      report.detectMatrix = await js(`(async () => {
        const d = App.state.dev;
        if (!d || !d.detectMatrix) return null;
        const t = performance.now();
        try { const r = await d.detectMatrix(App.state.layers); return JSON.stringify(r) + ' in ' + Math.round(performance.now() - t) + ' ms'; }
        catch (e) { return 'error: ' + e.message; }
      })()`);
      // the rail lists each keyboard: open the demo next to the real one, then the real one from the rail
      report.railSwitch = await js(`(async () => {
        const realName = App.state.dev && App.state.dev.name;
        if (!realName) return null;
        const rail = () => [...document.querySelectorAll('#railKeyboards .rail-item')].map((b) => b.innerText.replace(/\\n+/g, ' ') + (b.classList.contains('active') ? ' *' : ''));
        await App.attach(MockVia.create());
        const withDemo = rail();
        const item = [...document.querySelectorAll('#railKeyboards .rail-item')].find((b) => b.innerText.replace(/\\n+/g, ' ') === realName);
        item.click();
        for (let i = 0; i < 40 && (!App.state.dev || App.state.dev.name !== realName || !App.state.keymap); i++) await new Promise((r) => setTimeout(r, 250));
        return { withDemo, back: rail(), open: App.state.dev && App.state.dev.name, tab: document.body.dataset.tab };
      })()`);
      // the keymap as read (already in memory, nothing more is sent): rows of hex keycodes per layer
      report.keymapRead = await js(`(() => {
        const s = App.state;
        if (!s.keymap || !s.def) return null;
        const h = (n) => n.toString(16).padStart(4, '0');
        return s.keymap.slice(0, 2).map((l) => Array.from({ length: s.def.rows }, (_, r) => Array.from(l.slice(r * s.def.cols, (r + 1) * s.def.cols), h).join(' ')));
      })()`);
    } else {
      // demo: built-in layout; grid: no layout anywhere (size worked out); via: pretend to be a
      // keyboard from VIA's list (LK_SMOKE_VIA=vid:pid); vial: serve LK_SMOKE_VIAL (an .xz layout)
      let opts = '{}';
      if (SMOKE_MODE === 'grid') opts = '{ definition: false }';
      if (SMOKE_MODE === 'via') {
        const [vid, pid] = String(process.env.LK_SMOKE_VIA || '3434:0111').split(':').map((h) => parseInt(h, 16));
        opts = `{ definition: false, vendorId: ${vid}, productId: ${pid}, productName: 'Pretend VIA keyboard' }`;
      }
      if (SMOKE_MODE === 'vial') opts = `{ vialXz: new Uint8Array(${JSON.stringify([...fs.readFileSync(process.env.LK_SMOKE_VIAL)])}), productName: 'Pretend Vial keyboard' }`;
      // arrange the generic layout afresh rather than reuse one kept from an earlier run
      if (SMOKE_MODE === 'grid') await js(`['generic', 'view', 'opts', 'def'].forEach((w) => localStorage.removeItem('lk.' + w + '.4c4b:0060')); 1`);
      await js(`App.attach(MockVia.create(${opts})).then(() => 1)`);
      await wait(1500);
      report.encoders = await js(`App.state.enc ? JSON.stringify(App.state.enc[0]) : null`);
      // the demo keyboard's matrix follows real key presses: holding Q should light up its key
      await js(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ' })); 1`);
      await wait(400);
      report.heldKeyLit = await js(`[...document.querySelectorAll('#kmBoard .key.pressed')].map((e) => e.innerText)`);
      await js(`window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyQ' })); 1`);
      await wait(300);
      report.releasedKeyLit = await js(`document.querySelectorAll('#kmBoard .key.pressed').length`);
      // the keyboard panel's Backspace control: Split, then back to Full
      const bsClick = (name) => js(`(() => { const b = [...document.querySelectorAll('#devPanel .segmented button')].find((x) => x.textContent === '${name}'); if (!b) return null; b.click(); return 1; })()`);
      const bsState = () => js(`({ keys: App.state.visible.length, opts: JSON.stringify(App.state.opts), active: [...document.querySelectorAll('#devPanel .segmented button.active')].map((b) => b.textContent).join(',') })`);
      if (await bsClick('Split')) {
        await wait(400);
        report.backspaceSplit = await bsState();
        await bsClick('Full');
        await wait(400);
        report.backspaceFull = await bsState();
      }
      if (SMOKE_MODE === 'grid') {
        // no layout anywhere: a generic layout arranged from the keymap, and the switch to the grid and back
        const view = () => js(`({ source: App.state.source, kind: App.state.sourceKind, keys: document.querySelectorAll('#kmBoard .key').length, button: document.querySelector('#btnGeneric').innerText, opts: JSON.stringify(App.state.opts) })`);
        report.generic = await view();
        await shot('smoke-generic.png');
        await js(`document.querySelector('#btnGeneric').click(); 1`);
        await wait(1500);
        report.genericToGrid = await view();
        await shot('smoke-grid-matrix.png');
        await js(`document.querySelector('#btnGeneric').click(); 1`);
        await wait(1500);
        report.gridToGeneric = await view();
        // a grid size set by hand (older versions saved one from "Use grid") doesn't hide the
        // generic layout; it's what the grid view shows
        await js(`localStorage.setItem('lk.def.4c4b:0060', JSON.stringify({ name: 'Demo', vendorId: '0x4C4B', productId: '0x0060', grid: true, matrix: { rows: 5, cols: 15 }, layouts: { keymap: KLE.gridKeymap(5, 15) } })); App.attach(MockVia.create({ definition: false })).then(() => 1)`);
        await wait(1500);
        report.handGrid = await view();
        await js(`document.querySelector('#btnGeneric').click(); 1`);
        await wait(1500);
        report.handGridToGrid = await view();
        await js(`document.querySelector('#btnGeneric').click(); 1`);
        await wait(1500);
        report.handGridBack = await view();
        await js(`localStorage.removeItem('lk.def.4c4b:0060'); 1`);
        // an arrangement kept by an older version of the generic layout is worked out again
        await js(`localStorage.setItem('lk.generic.4c4b:0060', JSON.stringify({ name: 'Old', vendorId: '0x4C4B', productId: '0x0060', matrix: { rows: 5, cols: 15 }, generic: { size: '60%', version: GenericLayout.VERSION - 1, defaults: [], extras: 0 }, layouts: { labels: [], keymap: [['0,0']] } })); App.attach(MockVia.create({ definition: false })).then(() => 1)`);
        await wait(1500);
        report.oldArrangement = { ...(await view()), keptVersion: await js(`JSON.parse(localStorage.getItem('lk.generic.4c4b:0060')).generic.version`), current: await js(`GenericLayout.VERSION`) };
      }
    }
    report.panel = await js(`document.querySelector('#devPanel').classList.contains('hidden') ? null : document.querySelector('#devPanel').innerText.replace(/\\n+/g, ' | ')`);
    report.toolbarOptions = await js(`document.querySelector('#layoutOpts').innerText.replace(/\\n+/g, ' | ')`);
    if (SMOKE_MODE === 'polling' || process.env.LK_SMOKE_POLLING) {
      // the keyboard panel's Check button opens the tester's polling rate view
      await js(`(() => { const b = [...document.querySelectorAll('#devPanel .btn.text')].pop(); if (b) b.click(); else window.Tester.openPolling(); return 1; })()`);
      await wait(4000);
      report.polling = await js(`({ tab: App.isTabActive('tester'), usb: document.querySelector('#pollUsb').innerText.replace(/\\n+/g, ' | '), value: document.querySelector('#pollValue').textContent })`);
    }
    report.source = await js(`App.state.source || null`);
    report.matrix = await js(`App.state.def ? App.state.def.rows + 'x' + App.state.def.cols : null`);
    report.gridNote = await js(`document.querySelector('#gridNote').classList.contains('hidden') ? null : document.querySelector('#gridNoteText').textContent`);
    report.viaList = await js(`window.localKeymap.viaInfo()`);
    report.devicesOffered = lastDeviceList;
    report.debug = debug;
    report.granted = await js(`navigator.hid.getDevices().then((ds) => ds.map((d) => d.productName + ' ' + d.vendorId.toString(16) + ':' + d.productId.toString(16) + ' ' + d.collections.map((c) => c.usagePage.toString(16) + '/' + c.usage.toString(16)).join(',')))`);
    report.message = await js(`document.querySelector('#toast').textContent`);
    report.status = await js(`document.querySelector('#devStatus').textContent`);
    report.keys = await js(`document.querySelectorAll('#kmBoard .key').length`);
    // which matrix positions are shown as Backspace and the keys next to it (a generic layout's guess)
    report.backspaceArea = await js(`(App.state.visible || []).filter((k) => k.row >= 0 && k.y < 1.5 && k.x >= 12.5 && k.x < 15).map((k) => k.row + ',' + k.col + '@' + k.x + ',' + k.y + 'w' + k.w).join(' ')`);
    // keys a generic layout couldn't place (the row under the board)
    report.extraKeys = await js(`(App.state.visible || []).filter((k) => k.row >= 0 && k.y >= 5).map((k) => k.row + ',' + k.col).join(' ')`);
    report.definitions = await js(`window.localKeymap.listDefinitions().then((l) => l.length)`);
    // the rail: version, then Tester, one item per keyboard (* = lit), Add keyboard, Mouse
    report.rail = await js(`[document.querySelector('#appVersion').textContent, ...[...document.querySelectorAll('.rail .rail-item')].map((b) => b.innerText.replace(/\\n+/g, ' ') + (b.classList.contains('active') ? ' *' : ''))]`);
    await shot(`smoke-${SMOKE_MODE}.png`);
  } catch (err) {
    if (!err || !err.done) report.errors.push(String(err && err.stack || err));
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
  app.on('will-quit', () => mouseHid.stop());
}
