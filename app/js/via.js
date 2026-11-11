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
  const VIAL_PAGE = 32;
  const MAX_COLS = 32, MAX_ROWS = 64; // QMK matrix rows are at most 32 bits wide
  const u32 = (d, i) => (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24)) >>> 0;

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

    /** Vial keeps its layout in the firmware: 0xFE 0x01 gives the size, 0xFE 0x02 <page> returns
     * 32-byte pages of xz-compressed JSON (the same format as a VIA definition). */
    async readVialDefinition(onProgress) {
      const d = await this.send([0xfe, 0x01], { raw: true });
      const size = u32(d, 0);
      if (!(size > 0 && size < 1 << 20)) throw new Error('The keyboard did not report a layout');
      const data = new Uint8Array(size);
      for (let page = 0, off = 0; off < size; page++, off += VIAL_PAGE) {
        const r = await this.send([0xfe, 0x02, page & 0xff, (page >> 8) & 0xff, (page >> 16) & 0xff, page >>> 24], { raw: true });
        data.set(r.subarray(0, Math.min(VIAL_PAGE, size - off)), off);
        if (onProgress) onProgress(Math.min(1, (off + VIAL_PAGE) / size));
      }
      return JSON.parse(new TextDecoder().decode(window.XZ.decompress(data)));
    }

    async layerCount() {
      if (this.protocol < 8) return 4;
      const d = await this.send([CMD.LAYER_COUNT]);
      return d[1];
    }

    /** Works out a VIA keyboard's matrix size without a definition.
     * "Get keycode (layer, row, col)" is answered with the firmware's real size, while the keymap
     * buffer holds the same keycodes flat (layer by layer, row by row) and reads as zeros past its
     * end. Matching a few single-key reads against the flat buffer gives the column count, then the
     * row count (the smallest one whose layers line up and whose buffer ends exactly there). A
     * candidate is only accepted after a spread of single-key reads all agree with it.
     * Only reads; nothing is written. -> { rows, cols, sure } (sure = false: it fits, but the
     * keymap had too little variety to double-check it) */
    async detectMatrix(layers) {
      if (this.protocol < 8) throw new Error('This firmware is too old to read its keymap in one go');
      const buf = [];
      const readTo = async (n) => {
        while (buf.length < n) {
          const off = buf.length * 2;
          if (off + 28 > 0xffff) throw new Error('The keymap is larger than expected');
          const bytes = await this.getKeymapBuffer(off, 28);
          for (let i = 0; i + 1 < bytes.length; i += 2) buf.push((bytes[i] << 8) | bytes[i + 1]);
        }
      };
      const seen = new Map();
      const kc = async (l, r, c) => {
        const k = `${l},${r},${c}`;
        if (!seen.has(k)) seen.set(k, await this.getKeycode(l, r, c));
        return seen.get(k);
      };
      const sample = async (pts) => {
        const out = [];
        for (const [l, r, c] of pts) out.push({ l, r, c, v: await kc(l, r, c) });
        return out;
      };
      // nonzero samples carry the information; zero can mean "unused" or "outside the matrix"
      const fits = (samples, rows, cols) => samples.every((s) => s.v === 0 || buf[(s.l * rows + s.r) * cols + s.c] === s.v);

      // Every corner of every checked layer, plus keys that are neither empty nor transparent, must
      // read the same one at a time as in the flat buffer. Returns how many distinctive keys agreed,
      // or -1 on any disagreement.
      const verify = async (rows, cols) => {
        const n = rows * cols;
        await readTo(layers * n);
        const lays = [...new Set([0, 1, 2, layers - 1])].filter((l) => l >= 0 && l < layers);
        const pts = [];
        lays.forEach((l) => pts.push([l, 0, 0], [l, 0, cols - 1], [l, rows - 1, 0], [l, rows - 1, cols - 1]));
        let distinct = 0;
        const step = Math.max(1, Math.floor(n / 8));
        for (let l = 0; l < Math.min(layers, 3); l++) {
          for (let i = 0; i < n && distinct < 14; i += step) {
            if (buf[l * n + i] > 1) { pts.push([l, Math.floor(i / cols), i % cols]); distinct++; }
          }
        }
        for (const [l, r, c] of pts) if (await kc(l, r, c) !== buf[(l * rows + r) * cols + c]) return -1;
        return distinct;
      };

      // 1) column candidates: rows 1-3 of layer 0 against the flat buffer
      const colSamples = await sample([1, 2, 3].flatMap((r) => [0, 1, 2, 5].map((c) => [0, r, c])));
      const evidence = colSamples.filter((s) => s.v !== 0);
      await readTo(3 * MAX_COLS + 6);
      let colCands = [];
      if (evidence.length >= 2 && new Set(evidence.map((s) => s.v)).size >= 2) {
        for (let c = 1; c <= MAX_COLS; c++) if (fits(colSamples, 1, c)) colCands.push(c);
      } else {
        // looks like a single row: the first column the firmware calls empty but the buffer doesn't
        for (let c = 1; c <= MAX_COLS; c++) {
          if (await kc(0, 0, c) !== buf[c]) { colCands = [c]; break; }
        }
      }

      // 2) rows for each column candidate: layers 1-2 line up, the buffer is all zeros right
      //    after the last layer, and the spot checks agree
      const pts = [];
      if (layers >= 2) pts.push([1, 0, 0], [1, 0, 1], [1, 0, 2], [1, 1, 0], [1, 1, 3], [1, 2, 1]);
      if (layers >= 3) pts.push([2, 0, 0], [2, 1, 1], [2, 2, 2]);
      for (const cols of colCands.slice(0, 4)) {
        const rowSamples = await sample(pts.filter(([, , c]) => c < cols));
        for (let rows = 1; rows <= MAX_ROWS; rows++) {
          const end = layers * rows * cols;
          if (end * 2 + 56 > 0xffff) break;
          await readTo(Math.max(end + 28, ...rowSamples.map((s) => (s.l * rows + s.r) * cols + s.c + 1)));
          if (!fits(rowSamples, rows, cols)) continue;
          if (buf.slice(end, end + 28).some((v) => v !== 0)) continue;
          const agreed = await verify(rows, cols);
          if (agreed < 0) continue;
          return { rows, cols, sure: layers >= 2 && agreed >= 3 };
        }
      }
      throw new Error('Could not work out the matrix size');
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

    get vialEncoders() { return this.vialProtocol >= 0 && this.protocol < 11; }

    async getEncoder(layer, id, clockwise) {
      if (this.vialEncoders) {
        // Vial: 0xFE 0x03 layer idx -> counter-clockwise, clockwise (big-endian); firmware without
        // encoder support leaves the request untouched
        const d = await this.send([0xfe, 0x03, layer, id], { raw: true });
        if (d[0] === 0xfe && d[1] === 0x03 && d[2] === layer && d[3] === id) throw new UnhandledError(0xfe);
        return clockwise ? (d[2] << 8) | d[3] : (d[0] << 8) | d[1];
      }
      const d = await this.send([CMD.GET_ENCODER, layer, id, clockwise ? 1 : 0]);
      return (d[4] << 8) | d[5];
    }

    async setEncoder(layer, id, clockwise, code) {
      if (this.vialEncoders) {
        await this.send([0xfe, 0x04, layer, id, clockwise ? 1 : 0, code >> 8, code & 0xff], { raw: true });
        return;
      }
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
