/* Local Keymap - VIA raw-HID protocol over WebHID.
 * Packets are 32 bytes on report ID 0; the keyboard answers each command with one input report
 * that echoes the command bytes (0xFF in byte 0 = command not handled by the firmware). */
(function () {
  'use strict';

  const CMD = {
    PROTOCOL_VERSION: 0x01, GET_KEYBOARD_VALUE: 0x02, SET_KEYBOARD_VALUE: 0x03,
    GET_KEYCODE: 0x04, SET_KEYCODE: 0x05, MACRO_GET_COUNT: 0x0c, LAYER_COUNT: 0x11,
    GET_BUFFER: 0x12, SET_BUFFER: 0x13, GET_ENCODER: 0x14, SET_ENCODER: 0x15, UNHANDLED: 0xff,
  };
  const VALUE = { UPTIME: 0x01, LAYOUT_OPTIONS: 0x02, SWITCH_MATRIX_STATE: 0x03 };

  class UnhandledError extends Error {
    constructor(cmd) { super(`The firmware does not support command 0x${cmd.toString(16)}`); this.unhandled = true; }
  }

  function reportLength(hid) {
    for (const c of hid.collections || []) {
      if (c.usagePage !== 0xff60) continue;
      for (const r of c.outputReports || []) {
        const bits = (r.items || []).reduce((s, it) => s + it.reportSize * it.reportCount, 0);
        if (bits) return bits / 8;
      }
    }
    return 32;
  }

  class ViaDevice {
    constructor(hid) {
      this.hid = hid;
      this.len = reportLength(hid);
      this.protocol = 0;
      this.vialProtocol = -1;
      this._waiter = null;
      this._chain = Promise.resolve();
      this._onInput = (e) => {
        const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
        if (this._waiter) this._waiter(data);
      };
      hid.addEventListener('inputreport', this._onInput);
    }

    static isVia(hid) {
      return (hid.collections || []).some((c) => c.usagePage === 0xff60 && c.usage === 0x61);
    }

    get name() { return this.hid.productName || 'Keyboard'; }
    get vendorId() { return this.hid.vendorId; }
    get productId() { return this.hid.productId; }

    async open() { if (!this.hid.opened) await this.hid.open(); }

    async close() {
      this.hid.removeEventListener('inputreport', this._onInput);
      try { if (this.hid.opened) await this.hid.close(); } catch (_) { /* already gone */ }
    }

    /** Send one command and resolve with the 32-byte reply. Commands are strictly serialized. */
    send(bytes, { timeout = 1000, raw = false } = {}) {
      const run = () => new Promise((resolve, reject) => {
        const out = new Uint8Array(this.len);
        out.set(bytes.slice(0, this.len));
        const done = (fn, v) => { clearTimeout(timer); this._waiter = null; fn(v); };
        const timer = setTimeout(() => done(reject, new Error('The keyboard did not respond')), timeout);
        this._waiter = (data) => {
          if (raw) return done(resolve, data);
          let echo = true;
          for (let i = 1; i < bytes.length; i++) if (data[i] !== bytes[i]) { echo = false; break; }
          if (!echo) return; // a stale reply to an earlier command - keep waiting
          if (data[0] === bytes[0]) return done(resolve, data);
          if (data[0] === CMD.UNHANDLED) return done(reject, new UnhandledError(bytes[0]));
        };
        this.hid.sendReport(0, out).catch((err) => done(reject, err));
      });
      const p = this._chain.then(run, run);
      this._chain = p.catch(() => {});
      return p;
    }

    async protocolVersion() {
      const d = await this.send([CMD.PROTOCOL_VERSION]);
      this.protocol = (d[1] << 8) | d[2];
      return this.protocol;
    }

    /** Vial firmware answers 0xFE 0x00 with its own protocol number; plain VIA firmware says "unhandled". */
    async detectVial() {
      try {
        const d = await this.send([0xfe, 0x00], { raw: true, timeout: 400 });
        if (d[0] !== 0xff) {
          const v = (d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0;
          if (v < 1000) this.vialProtocol = v;
        }
      } catch (_) { /* not Vial */ }
      return this.vialProtocol;
    }

    async layerCount() {
      if (this.protocol < 8) return 4;
      const d = await this.send([CMD.LAYER_COUNT]);
      return d[1];
    }

    async macroCount() {
      const d = await this.send([CMD.MACRO_GET_COUNT]);
      return d[1];
    }

    async getKeymapBuffer(offset, size) {
      const d = await this.send([CMD.GET_BUFFER, offset >> 8, offset & 0xff, size]);
      return d.slice(4, 4 + size);
    }

    /** -> array[layer] of Uint16Array(rows*cols), index = row*cols + col */
    async readKeymap(layers, rows, cols, onProgress) {
      const total = layers * rows * cols * 2;
      const raw = new Uint8Array(total);
      if (this.protocol >= 8) {
        for (let off = 0; off < total; off += 28) {
          const size = Math.min(28, total - off);
          raw.set(await this.getKeymapBuffer(off, size), off);
          if (onProgress) onProgress(Math.min(1, (off + size) / total));
        }
      } else {
        let i = 0;
        for (let l = 0; l < layers; l++) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++, i++) {
          const v = await this.getKeycode(l, r, c);
          raw[i * 2] = v >> 8; raw[i * 2 + 1] = v & 0xff;
        }
      }
      const out = [];
      for (let l = 0; l < layers; l++) {
        const arr = new Uint16Array(rows * cols);
        for (let i = 0; i < rows * cols; i++) {
          const p = (l * rows * cols + i) * 2;
          arr[i] = (raw[p] << 8) | raw[p + 1];
        }
        out.push(arr);
      }
      return out;
    }

    async getKeycode(layer, row, col) {
      const d = await this.send([CMD.GET_KEYCODE, layer, row, col]);
      return (d[4] << 8) | d[5];
    }

    async setKeycode(layer, row, col, code) {
      await this.send([CMD.SET_KEYCODE, layer, row, col, code >> 8, code & 0xff]);
    }

    async getEncoder(layer, id, clockwise) {
      const d = await this.send([CMD.GET_ENCODER, layer, id, clockwise ? 1 : 0]);
      return (d[4] << 8) | d[5];
    }

    async setEncoder(layer, id, clockwise, code) {
      await this.send([CMD.SET_ENCODER, layer, id, clockwise ? 1 : 0, code >> 8, code & 0xff]);
    }

    async getLayoutOptions() {
      const d = await this.send([CMD.GET_KEYBOARD_VALUE, VALUE.LAYOUT_OPTIONS]);
      return ((d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5]) >>> 0;
    }

    async setLayoutOptions(v) {
      await this.send([CMD.SET_KEYBOARD_VALUE, VALUE.LAYOUT_OPTIONS, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
    }

    /** Raw switch matrix: rows * ceil(cols/8) bytes, each row MSB byte first. */
    async getMatrixState(rows, cols) {
      const bpr = Math.ceil(cols / 8);
      const out = [];
      if (this.protocol >= 12) {
        const perQuery = Math.max(1, Math.floor(28 / bpr));
        for (let r = 0; r < rows; r += perQuery) {
          const n = Math.min(perQuery, rows - r) * bpr;
          const d = await this.send([CMD.GET_KEYBOARD_VALUE, VALUE.SWITCH_MATRIX_STATE, r], { timeout: 500 });
          for (let i = 0; i < n; i++) out.push(d[3 + i]);
        }
      } else {
        const d = await this.send([CMD.GET_KEYBOARD_VALUE, VALUE.SWITCH_MATRIX_STATE], { timeout: 500 });
        for (let i = 0; i < rows * bpr; i++) out.push(d[2 + i]);
      }
      return out;
    }
  }

  ViaDevice.FILTER = { usagePage: 0xff60, usage: 0x61 };
  window.ViaDevice = ViaDevice;
})();
