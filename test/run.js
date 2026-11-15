#!/usr/bin/env node
/* Local Keymap - tests (npm test). Loads the app's own scripts into a sandbox and checks:
 *  1. the .xz decoder against vectors made with Python's lzma module (test/fixtures/xz),
 *  2. matrix-size detection against simulated QMK firmware (old and new), many shapes and keymaps,
 *  3. reading Vial layouts and knobs from simulated Vial firmware (real vial.json files),
 *  4. that every definition in the VIA bundle parses and its split backspace option is recognized
 *     (when generated/ has been built),
 *  5. the polling rate estimate from key press times, and the USB descriptor arithmetic. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

const ctx = { console, setTimeout, clearTimeout, TextDecoder, EventTarget, Event };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['keycodes.js', 'kle.js', 'xz.js', 'via.js', 'polling.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'js', f), 'utf8'), ctx, { filename: f });
}
const { ViaDevice, KLE, XZ, PollingRate } = ctx;
const usb = require(path.join(ROOT, 'electron', 'usb-polling.js'));

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL ${msg}`); };

// ------------------------------------------------------------------ 1) xz
function xzTests() {
  const dir = path.join(FIX, 'xz');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  for (const [name, want] of Object.entries(manifest)) {
    try {
      const out = Buffer.from(XZ.decompress(new Uint8Array(fs.readFileSync(path.join(dir, `${name}.xz`)))));
      const sha = crypto.createHash('sha256').update(out).digest('hex');
      if (out.length !== want.size || sha !== want.sha256) fail(`xz ${name}: wrong output`);
    } catch (e) { fail(`xz ${name}: ${e.message}`); }
  }
  // every single-bit flip must be rejected or decode to the same bytes, never to something else
  const good = fs.readFileSync(path.join(dir, 'text.xz'));
  const goodOut = Buffer.from(XZ.decompress(new Uint8Array(good)));
  let flips = 0;
  for (let i = 0; i < good.length; i += Math.max(1, Math.floor(good.length / 400))) {
    const b = new Uint8Array(good);
    b[i] ^= 1 << (i % 8);
    flips++;
    try { if (Buffer.compare(Buffer.from(XZ.decompress(b)), goodOut) !== 0) fail(`xz: corruption at byte ${i} went unnoticed`); } catch (_) { /* rejected */ }
  }
  let garbage = false;
  try { XZ.decompress(new Uint8Array(64)); } catch (_) { garbage = true; }
  if (!garbage) fail('xz: accepted garbage');
  console.log(`xz: ${Object.keys(manifest).length} vectors, ${flips} corrupted copies checked`);
}

// ------------------------------------------------------------------ simulated firmware
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

function makeKeymap(L, R, C, style) {
  const km = new Uint16Array(L * R * C);
  const alphas = Array.from({ length: 0xe8 - 4 }, (_, i) => i + 4);
  for (let l = 0; l < L; l++) {
    for (let i = 0; i < R * C; i++) {
      let v;
      if (l === 0) v = rnd() < (style.holes ?? 0.12) ? 0 : pick(alphas);
      else if (l === 1 && style.fnLayer) v = rnd() < 0.6 ? 1 : pick([0x3a, 0x3b, 0x3c, 0x4c, 0x52, 0x51, 0x7c00, 0x5221, 0]);
      else v = style.upper === 'none' ? 0 : style.upper === 'mixed' ? (rnd() < 0.5 ? 1 : 0) : 1;
      km[l * R * C + i] = v;
    }
  }
  if (style.trailingNo) for (let l = 0; l < L; l++) for (let i = R * C - style.trailingNo; i < R * C; i++) km[l * R * C + i] = 0;
  return km;
}

/** QMK's dynamic keymap as seen over VIA raw HID. boundsCheck = newer firmware (0 outside the
 * matrix); older firmware reads EEPROM linearly, past the keymap into the macro buffer. */
class FakeHid extends EventTarget {
  constructor({ L, R, C, km, boundsCheck = true, protocol = 12, vialXz = null, encoders = 0 }) {
    super();
    Object.assign(this, { L, R, C, km, boundsCheck, protocolV: protocol, vialXz });
    this.opened = false;
    this.vendorId = 0x1234; this.productId = 0x5678; this.productName = 'Fake';
    this.collections = [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ items: [{ reportSize: 8, reportCount: 32 }] }] }];
    this.after = Uint8Array.from({ length: 4096 }, () => Math.floor(rnd() * 256));
    this.enc = Array.from({ length: L }, (_, l) => Array.from({ length: encoders }, (_, e) => [0x81 + l + e, 0x80 + l + e]));
    this.writes = 0;
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  byte(a) {
    const n = this.L * this.R * this.C * 2;
    if (a < n) { const v = this.km[a >> 1]; return a & 1 ? v & 255 : v >> 8; }
    return this.after[(a - n) % 4096];
  }
  async sendReport(_id, data) {
    const d = new Uint8Array(32);
    d.set(new Uint8Array(data.buffer || data).slice(0, 32));
    this.handle(d);
    setImmediate(() => { const ev = new Event('inputreport'); ev.data = new DataView(d.buffer); this.dispatchEvent(ev); });
  }
  handle(d) {
    const { L, R, C } = this;
    switch (d[0]) {
      case 0x01: d[1] = 0; d[2] = this.protocolV; break;
      case 0x04: {
        let v = 0;
        if (!this.boundsCheck || (d[1] < L && d[2] < R && d[3] < C)) { const a = ((d[1] * R + d[2]) * C + d[3]) * 2; v = (this.byte(a) << 8) | this.byte(a + 1); }
        d[4] = v >> 8; d[5] = v & 255; break;
      }
      case 0x05: case 0x13: this.writes++; break;
      case 0x0c: d[1] = 0; break;
      case 0x11: d[1] = L; break;
      case 0x12: { const off = (d[1] << 8) | d[2]; for (let i = 0; i < d[3]; i++) d[4 + i] = off + i < L * R * C * 2 ? this.byte(off + i) : 0; break; }
      case 0xfe: {
        if (!this.vialXz) { d[0] = 0xff; break; }
        const x = this.vialXz, cmd = d[1];
        const put32 = (v) => { d[0] = v & 255; d[1] = (v >> 8) & 255; d[2] = (v >> 16) & 255; d[3] = v >>> 24; };
        if (cmd === 0) { d.fill(0); put32(6); }
        else if (cmd === 1) { d.fill(0); put32(x.length); }
        else if (cmd === 2) { const page = d[2] | (d[3] << 8); d.fill(0); d.set(x.subarray(page * 32, page * 32 + 32)); }
        else if (cmd === 3) { const e = this.enc[d[2]] && this.enc[d[2]][d[3]]; if (e) { d.fill(0); d[0] = e[0] >> 8; d[1] = e[0] & 255; d[2] = e[1] >> 8; d[3] = e[1] & 255; } }
        else if (cmd === 4) { const e = this.enc[d[2]] && this.enc[d[2]][d[3]]; if (e) e[d[4] ? 1 : 0] = (d[5] << 8) | d[6]; }
        break;
      }
      default: d[0] = 0xff;
    }
  }
}

async function connect(hid) {
  const dev = new ViaDevice(hid);
  await dev.open();
  await dev.protocolVersion();
  if (dev.protocol <= 10) await dev.detectVial();
  return dev;
}

// ------------------------------------------------------------------ 2) matrix detection
async function detectionTests() {
  const shapes = [[5, 14], [5, 15], [6, 16], [6, 17], [6, 21], [8, 6], [10, 7], [12, 16], [4, 12], [5, 12], [1, 4], [2, 3], [3, 3],
    [4, 4], [5, 4], [6, 4], [9, 9], [11, 8], [14, 6], [7, 18], [8, 22], [16, 16], [1, 12], [2, 8], [6, 24], [5, 32], [32, 8]];
  const styles = [
    { name: 'typical', fnLayer: true, upper: 'trns' },
    { name: 'all-trns-upper', upper: 'trns' },
    { name: 'kc_no-upper', fnLayer: true, upper: 'none' },
    { name: 'mixed-upper', upper: 'mixed' },
    { name: 'sparse', fnLayer: true, upper: 'trns', holes: 0.45 },
    { name: 'trailing-no', fnLayer: true, upper: 'trns', trailingNo: 5 },
  ];
  const n = { right: 0, flagged: 0, gaveUp: 0, normalUnsure: 0 };
  for (const [R, C] of shapes) for (const st of styles) for (const L of [1, 2, 4, 6, 16]) for (const boundsCheck of [true, false]) {
    if (L * R * C * 2 > 0xff00) continue;
    const hid = new FakeHid({ L, R, C, km: makeKeymap(L, R, C, st), boundsCheck });
    const dev = await connect(hid);
    const tag = `${R}x${C}, ${L} layers, ${st.name}, ${boundsCheck ? 'new' : 'old'} firmware`;
    try {
      const got = await dev.detectMatrix(L);
      if (got.rows === R && got.cols === C) n.right++;
      else if (!got.sure) n.flagged++;
      else fail(`matrix ${tag}: said ${got.rows}x${got.cols} and claimed to be sure`);
      if (!got.sure && L > 1 && R * C >= 16 && st.name === 'typical') n.normalUnsure++;
    } catch (_) { n.gaveUp++; }
    if (hid.writes) fail(`matrix ${tag}: wrote to the keyboard`);
    if (R * C >= 40 && L >= 2) {
      // ordinary keyboards must always be found
      const d2 = await connect(new FakeHid({ L, R, C, km: makeKeymap(L, R, C, styles[0]), boundsCheck }));
      const g = await d2.detectMatrix(L).catch((e) => ({ err: e.message }));
      if (g.rows !== R || g.cols !== C || !g.sure) fail(`matrix ${R}x${C}, ${L} layers, typical keymap: ${JSON.stringify(g)}`);
    }
  }
  if (n.normalUnsure) fail(`matrix: ${n.normalUnsure} ordinary keymaps flagged as unsure`);
  console.log(`matrix: ${n.right} right, ${n.flagged} wrong but flagged unsure, ${n.gaveUp} gave up (the app then asks for the size)`);
}

// ------------------------------------------------------------------ 3) Vial
async function vialTests() {
  const dir = path.join(FIX, 'vial');
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.xz'));
  for (const f of names) {
    const xz = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const src = JSON.parse(fs.readFileSync(path.join(dir, f.replace(/\.xz$/, '.json')), 'utf8'));
    const { rows: R, cols: C } = src.matrix;
    const parsedSrc = KLE.parse(src.layouts.keymap);
    const knobs = [...new Set(parsedSrc.keys.filter((k) => k.ei !== undefined).map((k) => k.ei))].length;
    const dev = await connect(new FakeHid({ L: 4, R, C, km: makeKeymap(4, R, C, { fnLayer: true }), protocol: 9, vialXz: xz, encoders: knobs }));
    if (dev.vialProtocol !== 6) fail(`vial ${f}: not detected as Vial`);
    const json = await dev.readVialDefinition();
    if (JSON.stringify(json) !== JSON.stringify(src)) fail(`vial ${f}: layout differs from vial.json`);
    const keys = KLE.parse(json.layouts.keymap).keys;
    const knobKeys = keys.filter((k) => k.ei !== undefined);
    if (keys.some((k) => k.ei === undefined && (k.row < 0 || k.row >= R || k.col >= C))) fail(`vial ${f}: keys outside the matrix`);
    if (knobKeys.some((k) => k.row !== -1 || (k.edir !== 0 && k.edir !== 1))) fail(`vial ${f}: knob keys parsed as matrix keys`);
    if (knobs) {
      const ccw = await dev.getEncoder(1, 0, false), cw = await dev.getEncoder(1, 0, true);
      await dev.setEncoder(2, 0, true, 0xe9);
      if (ccw !== 0x82 || cw !== 0x81 || await dev.getEncoder(2, 0, true) !== 0xe9) fail(`vial ${f}: knob read/write`);
    }
    console.log(`vial: ${json.name}, ${keys.length} keys, ${knobKeys.length} knob keys`);
  }
  const noKnobs = await connect(new FakeHid({ L: 2, R: 2, C: 2, km: new Uint16Array(8), protocol: 9, vialXz: new Uint8Array(fs.readFileSync(path.join(dir, names[0]))) }));
  const r = await noKnobs.getEncoder(0, 0, false).then(() => 'accepted', (e) => (e.unhandled ? 'unsupported' : e.message));
  if (r !== 'unsupported') fail(`vial: firmware without knobs -> ${r}`);
  const via = await connect(new FakeHid({ L: 2, R: 2, C: 2, km: new Uint16Array(8) }));
  if (via.vialProtocol !== -1 || via.vialEncoders) fail('plain VIA firmware detected as Vial');
}

// ------------------------------------------------------------------ 4) VIA bundle
function bundleTests() {
  const file = path.join(ROOT, 'generated', 'via-definitions.json.br');
  if (!fs.existsSync(file)) { console.log('via bundle: not built (npm run defs), skipped'); return; }
  const b = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(file)));
  let keys = 0;
  for (const [id, d] of Object.entries(b.definitions)) {
    try {
      const p = KLE.parse(d.layouts.keymap);
      const all = [...p.keys, ...Object.values(p.optionKeys).flatMap((o) => Object.values(o).flat())];
      if (!all.length) fail(`via ${id} ${d.name}: no keys`);
      keys += all.length;
    } catch (e) { fail(`via ${id} ${d.name}: ${e.message}`); }
  }
  if (b.count < 1000) fail(`via bundle: only ${b.count} keyboards`);

  // split backspace: every definition that mentions a backspace option on its own gets the control
  let bs = 0, missed = 0;
  for (const [id, d] of Object.entries(b.definitions)) {
    const labels = d.layouts.labels || [];
    const own = labels.filter((l) => (Array.isArray(l) ? /back ?space/i.test(String(l[0])) : /back ?space/i.test(String(l))));
    const opt = KLE.backspaceOption(labels);
    if (opt) {
      bs++;
      if (opt.choices.length < 2 || opt.g < 0 || opt.g >= labels.length) fail(`backspace ${id}: bad option ${JSON.stringify(opt)}`);
      const l = labels[opt.g];
      if (typeof l === 'string' && /^split/i.test(l) && opt.choices.find((c) => c.name === 'Split').value !== 1) fail(`backspace ${id}: "${l}" upside down`);
      if (typeof l === 'string' && /^(2u|full|unified)/i.test(l) && opt.choices.find((c) => c.name === 'Split').value !== 0) fail(`backspace ${id}: "${l}" upside down`);
    } else if (own.length) {
      missed++;
    }
  }
  if (bs < 800) fail(`backspace: only ${bs} keyboards recognized`);
  console.log(`via bundle: ${b.count} keyboards, ${keys} keys parsed, split backspace switch on ${bs} (${missed} plain "Backspace" switches left as they are)`);
}

// ------------------------------------------------------------------ 5) polling rate
function pollingTests() {
  let s = 4242;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  // a person drumming or slapping keys; each change arrives on the next poll, timestamped with a
  // little jitter, the odd late event, and the browser's 0.1 ms clock
  const session = (rate, style) => {
    const T = 1000 / rate, phase = rnd() * T, times = [];
    let t = 1000;
    while (t < 6000) {
      if (style === 'slap') {
        const n = 3 + Math.floor(rnd() * 3);
        for (let i = 0; i < n; i++) { const d = t + rnd() * 15; times.push(d, d + 60 + rnd() * 80); }
        t += 150 + rnd() * 250;
      } else {
        const n = 4 + Math.floor(rnd() * 5);
        for (let i = 0; i < n; i++) { times.push(t, t + 40 + rnd() * 60); t += 8 + rnd() * 32; }
        t += 80 + rnd() * 200;
      }
    }
    return times.map((x) => {
      let r = Math.ceil((x - phase) / T) * T + phase + Math.abs(gauss()) * 0.06;
      if (rnd() < 0.1) r += rnd() * 1.5;
      return Math.floor(r / 0.1) * 0.1;
    });
  };
  let n = 0;
  for (const rate of [125, 250, 500, 1000, 2000, 4000, 8000]) {
    for (const style of ['roll', 'slap']) {
      for (let k = 0; k < 20; k++) {
        const r = PollingRate.estimate(session(rate, style));
        n++;
        const ok = rate <= 2000 ? r.kind === 'exact' && r.rate === rate : r.kind === 'over';
        if (!ok) fail(`polling ${rate} Hz (${style}): said ${r.kind} ${r.rate}`);
      }
    }
  }
  if (PollingRate.estimate([1, 2, 3]).kind !== 'need-more') fail('polling: decided from 3 events');

  // descriptor arithmetic: full speed bInterval is ms (rounded down to a power of 2), high speed 2^(n-1) x 125 us
  const cases = [[1, 'full', 1], [4, 'full', 4], [10, 'full', 8], [1, 'high', 0.125], [4, 'high', 1], [8, 'low', 8]];
  cases.forEach(([b, sp, want]) => { if (usb.periodMs(b, sp) !== want) fail(`periodMs(${b}, ${sp}) = ${usb.periodMs(b, sp)}, want ${want}`); });
  const kb = usb.summarize([
    { vendorId: 1, productId: 2, product: 'Board', speed: 'high', interfaces: [
      { number: 0, cls: 3, subclass: 1, protocol: 1, endpoints: [{ address: 0x81, attributes: 3, bInterval: 1 }] },
      { number: 1, cls: 3, subclass: 0, protocol: 0, endpoints: [{ address: 0x82, attributes: 3, bInterval: 4 }, { address: 0x02, attributes: 3, bInterval: 1 }] }] },
    { vendorId: 3, productId: 4, product: 'Headset', speed: 'full', interfaces: [{ number: 3, cls: 3, subclass: 0, protocol: 0, endpoints: [{ address: 0x83, attributes: 3, bInterval: 4 }] }] },
    { vendorId: 5, productId: 6, product: 'Disk', speed: 'high', interfaces: [{ number: 0, cls: 8, subclass: 6, protocol: 80, endpoints: [{ address: 0x81, attributes: 2, bInterval: 0 }] }] },
  ]);
  if (kb.length !== 2 || kb[0].rate !== 8000 || !kb[0].keyboard || kb[1].rate !== 250 || kb[1].keyboard) fail(`usb summarize: ${JSON.stringify(kb)}`);
  console.log(`polling: ${n} simulated key press sessions, USB descriptor arithmetic`);
}

(async () => {
  xzTests();
  await detectionTests();
  await vialTests();
  bundleTests();
  pollingTests();
  console.log(failures ? `\n${failures} failure(s)` : '\nall tests passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
