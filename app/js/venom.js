/* Local Keymap - driver for Geonworks Venom HE keyboards (vendor protocol, not VIA).
 *
 * Interface: HID usage page 0xFF53 / usage 0x61, 64-byte reports on report ID 0. The keyboard answers each
 * command with a report starting with the same command byte (0xFF = error). Worked out from the official
 * configurator (venom.how) and checked read-only against a Venom 60 HE RGB 7U (firmware 136).
 *
 *   [2]                  capabilities           [227]           firmware number (LE16 at 1)
 *   [222]                USB speed (0 full/1000Hz, 1 high/8000Hz, 2 low/125Hz)
 *   [64] / [80,p]        get / set active profile (0-3)
 *   [65|66|67, L, chunk] read 16 keys of layer L: key type / value 1 / value 2 (LE16 each, from byte 3)
 *   [87, L, type16, v1_16, v2_16, keyIndex, 0, v3,0, v4,0, v5,0, v6,0]   write one key (current profile)
 *   [217,0] / [217,1,b]  layout bits (bit 1 = split backspace)
 *   [230,0] / [230,1,x]  force 1000 Hz polling (x = 1) or default 8000 Hz (x = 0)
 *   [209]                live key-pressed bitmap, 128 keys from byte 3
 * Key type 1 = normal keycode (QMK-style 16 bit). 241 = Venom function key. Others are advanced (DKS, tap-hold...).
 *
 * Commands that are NEVER sent by this app: 0x80-0x83 (firmware/IAP), 99 (macro toggle + reboot),
 * 214 (calibration), 238 (factory reset), 239 (bootloader), 86 / chunk writes (profile copy).
 */
(function () {
  'use strict';

  const SAFE = new Set([2, 64, 65, 66, 67, 80, 87, 209, 217, 222, 227, 230]);
  const KEYS = 128, ROWS = 8, COLS = 16, LAYERS = 4;

  // Venom function keys (key type 241)
  const FUNCTION_KEYS = [
    [0x0101, 'Lock\nL-Win', 'Disable left Win key (toggle)'],
    [0x0102, 'Lock\nR-Win', 'Disable right Win key (toggle)'],
    [0x0103, 'Lock\nWin', 'Disable both Win keys (toggle)'],
    [0x0104, 'Lock\nAlt-F4', 'Block Alt+F4 (toggle)'],
    [0x0105, 'Lock\nAlt-Tab', 'Block Alt+Tab (toggle)'],
    [0x0201, 'OKS\nToggle', 'Toggle one-key-snap / OKS'],
    [0x0601, 'RGB\n-', 'Lighting brightness down'],
    [0x0602, 'RGB\n+', 'Lighting brightness up'],
    [0x0603, 'RGB\nSleep', 'Lighting sleep'],
    [0x0604, 'RGB\nOn/Off', 'Lighting on/off'],
    [0x0401, 'Re-\ncalibrate', 'Start key recalibration when pressed'],
  ];

  // Venom 60 HE (PID 0x4102 = 16642), converted from the official layout file. Labels are "row,col" with
  // firmware key index = row * 16 + col. Option 0,x = split backspace (keyboard layout bit 1).
  const LAYOUT_60HE = {
    name: 'Geon Venom 60 HE', vendorId: '0x534B', productId: '0x4102', matrix: { rows: ROWS, cols: COLS },
    layouts: {
      labels: ['Split Backspace'],
      keymap: [
        ['0,9', '0,10', '0,12', '1,1', '1,2', '1,4', '1,6', '2,1', '2,2', '2,4', '2,6', '2,9', '2,10', { c: '#aaaaaa', w: 2 }, '2,14\n\n\n0,0', '2,12\n\n\n0,1', '2,15\n\n\n0,1'],
        [{ w: 1.5 }, '0,8', { c: '#cccccc' }, '0,11', '0,14', '1,0', '1,3', '1,5', '1,7', '2,0', '2,3', '2,5', '2,7', '2,8', '2,11', { w: 1.5 }, '2,13'],
        [{ w: 1.75 }, '0,2', { c: '#cccccc' }, '0,13', '0,15', '1,8', '1,9', '1,10', '1,12', '3,9', '3,10', '3,12', '3,14', '3,15', { c: '#aaaaaa', w: 2.25 }, '3,13'],
        [{ c: '#aaaaaa', w: 2.25 }, '0,1', { c: '#cccccc' }, '0,5', '0,6', '0,4', '1,11', '1,13', '1,14', '3,8', '3,11', '3,1', '3,2', { c: '#aaaaaa', w: 1.75 }, '3,6', '3,7'],
        [{ c: '#aaaaaa', w: 1.5 }, '0,0', '0,3', { w: 1.5 }, '0,7', { c: '#cccccc', w: 7 }, '1,15', { c: '#aaaaaa', w: 1.5 }, '3,0', '3,3', { w: 1.5 }, '3,5'],
      ],
    },
  };
  const LAYOUTS = { 0x4102: LAYOUT_60HE };
  const SPLIT_BS_BIT = 2;

  const u16 = (d, i) => d[i] | (d[i + 1] << 8);

  class VenomDevice {
    constructor(hid) {
      this.hid = hid;
      this.kind = 'venom';
      this.protocol = 12; // QMK-style keycodes like VIA protocol 12
      this.vialProtocol = -1;
      this.info = { firmware: 0, usbSpeed: -1, force1k: 0, layoutBits: 0, profile: 0, caps: null };
      this.types = []; this.v2 = [];
      this._waiter = null;
      this._chain = Promise.resolve();
      this._onInput = (e) => {
        const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
        if (this._waiter) this._waiter(data);
      };
      hid.addEventListener('inputreport', this._onInput);
    }

    static isVenom(hid) {
      return hid.vendorId === 0x534b && (hid.collections || []).some((c) => c.usagePage === 0xff53 && c.usage === 0x61);
    }

    get name() { return this.hid.productName || 'Venom HE'; }
    get vendorId() { return this.hid.vendorId; }
    get productId() { return this.hid.productId; }
    get definition() { return LAYOUTS[this.hid.productId] || null; }

    async open() {
      if (!this.hid.opened) await this.hid.open();
      const caps = await this.send([2]);
      this.info.caps = Array.from(caps.slice(0, 16));
      this.info.firmware = u16(await this.send([227]), 1);
      this.info.usbSpeed = (await this.send([222]))[1];
      this.info.force1k = (await this.send([230, 0]))[2];
      this.info.layoutBits = (await this.send([217, 0]))[2];
      this.info.profile = (await this.send([64]))[1];
    }

    async close() {
      this.hid.removeEventListener('inputreport', this._onInput);
      try { if (this.hid.opened) await this.hid.close(); } catch (_) { /* gone */ }
    }

    send(bytes, { timeout = 1000 } = {}) {
      if (!SAFE.has(bytes[0])) return Promise.reject(new Error(`Refusing to send Venom command ${bytes[0]}`));
      const run = () => new Promise((resolve, reject) => {
        const out = new Uint8Array(64);
        out.set(bytes.slice(0, 64));
        const done = (fn, v) => { clearTimeout(timer); this._waiter = null; fn(v); };
        const timer = setTimeout(() => done(reject, new Error('The keyboard did not respond')), timeout);
        this._waiter = (data) => {
          if (data[0] === bytes[0]) done(resolve, data);
          else if (data[0] === 0xff) done(reject, Object.assign(new Error(`Command ${bytes[0]} was rejected`), { unhandled: true }));
        };
        this.hid.sendReport(0, out).catch((err) => done(reject, err));
      });
      const p = this._chain.then(run, run);
      this._chain = p.catch(() => {});
      return p;
    }

    // ---- the ViaDevice-compatible surface used by the editor
    async protocolVersion() { return this.protocol; }
    async layerCount() { return LAYERS; }
    async macroCount() { return 16; }

    async readKeymap(layers, rows, cols, onProgress) {
      const out = [];
      this.types = []; this.v2 = [];
      const total = layers * (KEYS / 16);
      let n = 0;
      for (let l = 0; l < layers; l++) {
        const codes = new Uint16Array(rows * cols), types = new Uint16Array(KEYS), v2 = new Uint16Array(KEYS);
        for (let chunk = 0; chunk < KEYS / 16; chunk++) {
          const t = await this.send([65, l, chunk]);
          const a = await this.send([66, l, chunk]);
          const b = await this.send([67, l, chunk]);
          for (let i = 0; i < 16; i++) {
            const idx = chunk * 16 + i;
            types[idx] = u16(t, 3 + i * 2);
            v2[idx] = u16(b, 3 + i * 2);
            if (idx < rows * cols) codes[idx] = u16(a, 3 + i * 2);
          }
          if (onProgress) onProgress(++n / total);
        }
        out.push(codes); this.types.push(types); this.v2.push(v2);
      }
      return out;
    }

    /** code: 16-bit keycode (normal key) or { type, value } for Venom function keys */
    async setKeycode(layer, row, col, code) {
      const idx = row * COLS + col;
      const type = typeof code === 'object' ? code.type : 1;
      const v1 = typeof code === 'object' ? code.value : code;
      await this.send([87, layer, type & 255, type >> 8, v1 & 255, v1 >> 8, 0, 0, idx, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      if (this.types[layer]) { this.types[layer][idx] = type; this.v2[layer][idx] = 0; }
    }

    async getEncoder() { throw Object.assign(new Error('No knobs on this keyboard'), { unhandled: true }); }
    async setEncoder() { throw Object.assign(new Error('No knobs on this keyboard'), { unhandled: true }); }

    async getLayoutOptions() { return (this.info.layoutBits & SPLIT_BS_BIT) ? 1 : 0; }
    async setLayoutOptions(v) {
      const bits = v & 1 ? this.info.layoutBits | SPLIT_BS_BIT : this.info.layoutBits & ~SPLIT_BS_BIT;
      await this.send([217, 1, bits]);
      this.info.layoutBits = bits;
    }

    /** Same shape as VIA's switch matrix: rows of ceil(16/8)=2 bytes, highest columns first. */
    async getMatrixState(rows) {
      const d = await this.send([209], { timeout: 500 });
      const out = [];
      for (let r = 0; r < rows; r++) out.push(d[3 + r * 2 + 1], d[3 + r * 2]);
      return out;
    }

    // ---- Venom-specific extras used by the editor
    /** Label override for keys that aren't plain keycodes. */
    keyInfo(layer, row, col, kc) {
      const idx = row * COLS + col;
      const type = this.types[layer] ? this.types[layer][idx] : 1;
      if (type === 1 || type === 0) return null;
      const v1 = window.App.state.keymap[layer][idx];
      if (type === 241) {
        const f = FUNCTION_KEYS.find((k) => k[0] === v1);
        return { label: f ? f[1] : `Fn\n0x${v1.toString(16)}`, title: f ? `Venom function: ${f[2]}` : `Venom function 0x${v1.toString(16)}` };
      }
      const a = Keycodes.oneLine(kc.label(v1)), b = Keycodes.oneLine(kc.label(this.v2[layer][idx]));
      return {
        label: `${a}\n${b} ★`,
        title: `Advanced key (type ${type}: tap-hold, DKS, toggle…) set up in venom.how\nvalues: ${kc.name(v1)} / ${kc.name(this.v2[layer][idx])}\nAssigning a normal key here replaces it.`,
        advanced: true,
      };
    }

    extraCategories() {
      return [{
        id: 'venom', title: 'Venom',
        hint: 'Keyboard functions built into the Venom firmware. Advanced keys (DKS, tap-hold, toggle) are set up in venom.how and shown with ★.',
        groups: [{ title: 'Venom functions', items: FUNCTION_KEYS.map(([value, label, title]) => ({ value: { type: 241, value }, label, title })) }],
      }];
    }

    async setProfile(p) {
      await this.send([80, p]);
      this.info.profile = (await this.send([64]))[1];
      return this.info.profile;
    }

    async setForce1k(on) {
      await this.send([230, 1, on ? 1 : 0]);
      this.info.force1k = (await this.send([230, 0]))[2];
      return this.info.force1k;
    }

    async refreshUsbSpeed() {
      this.info.usbSpeed = (await this.send([222]))[1];
      return this.info.usbSpeed;
    }
  }

  VenomDevice.FILTER = { vendorId: 0x534b, usagePage: 0xff53, usage: 0x61 };
  VenomDevice.SPEEDS = { 0: '1000 Hz (USB full speed)', 1: '8000 Hz (USB high speed)', 2: '125 Hz (USB low speed)' };
  VenomDevice.FIXED_1K_FIRMWARE = 148;
  window.VenomDevice = VenomDevice;
})();
