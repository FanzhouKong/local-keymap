/* Local Keymap - driver for Endgame Gear 4K wireless mice (XM2w 4k v2), on their 4K dongle or on the cable.
 *
 * Worked out from the official "Endgame Gear XM2w 4k v2 Configuration Tool" 1.02 (read, never run) and
 * checked read-only against an XM2w 4k v2 on its dongle.
 *
 * Interface: HID usage page 0xFF01 / usage 2, feature reports only.
 *   0xA1  63 data bytes. Command: [cmd, a, b, 0, 0, chunk, 0...], payload from data byte 15 (report byte 16).
 *         After a command the answer is read back with GetFeature 0xA1: byte 1 = status (1 ok, 3 busy),
 *         data from report byte 16.
 *   0xA0  1040 data bytes: after command 0x12, report bytes 16..1039 hold the 1024-byte settings block.
 * On the dongle (PID 0x1970) the official tool sends 0x0F 01 (or 0x0F 0F when that fails) before every
 * command; on the cable the mouse is PID 0x1982 and needs nothing first.
 *   0x0F 01 / 0x0F 0F    link check (dongle only)
 *   0x0D                 dongle info: firmware LE16 at 17
 *   0x0E                 mouse info: product ID LE16 at 18 (0x1982 when the mouse answers), firmware LE16 at 23
 *   0xB4                 battery percent at 16
 *   0x12                 read the settings block (then GetFeature 0xA0)
 *   0x14 0F 1C           write sensor and CPI settings (28 bytes)
 *   0x15 0F 0A           write polling, power and click filter settings (11 bytes)
 *   0x16 0F 1C chunk     write the button mapping, 2 chunks of 28 bytes
 * Commands that are NEVER sent by this app: 0x13 (factory reset), 0x70 / 0x71 / 0x72 (pairing) and firmware
 * updates. Only the commands in SAFE can go out.
 *
 * Settings block (byte offsets):
 *   0x01 sensor angle tuning (signed)   0x03 deep sleep minutes (+0x80 = off)   0x04 power saving minutes (+0x80 = off)
 *   0x05 polling rate code              0x06 flags (0x01 slamclick filter, 0x20 click filters unlocked, 0x40 max sensor fps)
 *   0x08 LED on lift-off (1 = on)       0x09 lift-off distance index            0x0A angle snapping   0x0B ripple control
 *   0x0C motion sync                    0x0D current CPI level (0-3)            0x0E number of CPI levels (1-4)
 *   0x23 4 CPI levels of 5 bytes: [X and Y differ, X LE16, Y LE16]
 *   0x37 8 buttons of 7 bytes: [type, code, value LE16, value2 LE16, click filter]
 *        in the order left, right, middle, back, forward, CPI button, wheel up, wheel down
 *   0x6F sensor glass mode
 * Everything else in the block is kept exactly as read.
 */
(function () {
  'use strict';

  const SAFE = new Set([0x0f, 0x0d, 0x0e, 0xb4, 0x12, 0x14, 0x15, 0x16]); // also checked in electron/hid-win.js
  const MOUSE_READS = new Set([0x0e, 0xb4, 0x12]); // answered by the mouse itself, not the dongle
  const VID = 0x3367, PID_DONGLE = 0x1970, PID_WIRED = 0x1982;
  const CMD_ID = 0xa1, BLOCK_ID = 0xa0, CMD_LEN = 63, BLOCK_LEN = 1040, DATA = 16, BLOCK_SIZE = 1024;

  const OFF = {
    angleTune: 0x01, deepSleep: 0x03, powerSave: 0x04, polling: 0x05, flags: 0x06, liftLed: 0x08, lod: 0x09,
    angleSnap: 0x0a, ripple: 0x0b, motionSync: 0x0c, cpiCurrent: 0x0d, cpiCount: 0x0e, cpi: 0x23, buttons: 0x37, glass: 0x6f,
  };
  const FLAG = { slamclick: 0x01, filtersUnlocked: 0x20, maxFps: 0x40 };

  // [code, label] in the official tool's order
  const POLLING = [[0x02, '4000 Hz'], [0x04, '2000 Hz'], [0x08, '1000 Hz'], [0x80, '1000 Hz, power saving'], [0x40, '125 Hz, office mode']];
  const LOD = ['0.7 mm', '0.8 mm', '0.9 mm', '1.0 mm', '1.1 mm', '1.2 mm', '1.3 mm', '1.4 mm', '1.5 mm', '1.6 mm', '1.7 mm'];
  const LOD_GLASS = [[1, '1.0 mm'], [2, '2.0 mm']]; // in glass mode the index means one of these two
  const SPDT = [[null, 'Off'], [0xf1, 'GX Speed Mode'], [0xf0, 'GX Safe Mode']]; // left and right button only
  const CPI_MIN = 10, CPI_MAX = 30000, FILTER_MAX = 25, ANGLE_MAX = 127;

  const BUTTONS = ['Left button', 'Right button', 'Middle button', 'Back button', 'Forward button', 'CPI button', 'Wheel up', 'Wheel down'];

  /** Button actions: [id, label, type, code]. Keyboard keys (type 2) and fixed CPI (type 12) carry values. */
  const ACTIONS = [
    ['left', 'Left click', 0x00, 0x01], ['right', 'Right click', 0x00, 0x02], ['middle', 'Middle click', 0x00, 0x04],
    ['back', 'Back', 0x00, 0x08], ['forward', 'Forward', 0x00, 0x10],
    ['wheelUp', 'Scroll up', 0x01, 0x01], ['wheelDown', 'Scroll down', 0x01, 0xff],
    ['cpiLoop', 'CPI loop', 0x09, 0xf1], ['fixedCpi', 'Fixed CPI', 0x0c, 0x00], ['key', 'Keyboard key', 0x02, null],
    ['playPause', 'Play / pause', 0x20, 0xcd], ['next', 'Next track', 0x20, 0xb5], ['previous', 'Previous track', 0x20, 0xb6],
    ['mute', 'Mute', 0x20, 0xe2], ['volUp', 'Volume up', 0x20, 0xe9], ['volDown', 'Volume down', 0x20, 0xea],
    ['browser', 'Web browser', 0x18, 0x96], ['explorer', 'File explorer', 0x18, 0x94],
    ['disable', 'Disabled', 0xff, 0x00],
  ];
  const MODS = [[0x01, 'Ctrl'], [0x02, 'Shift'], [0x04, 'Alt'], [0x08, 'Win']];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const u16 = (d, i) => d[i] | (d[i + 1] << 8);
  const put16 = (d, i, v) => { d[i] = v & 255; d[i + 1] = (v >> 8) & 255; };
  /** The official tool shows versions by reading the hex digits as a decimal number of hundredths: 0x0102 -> 1.02 */
  const version = (w) => (w ? (parseInt(w.toString(16), 10) / 100).toFixed(2) : '');

  /** A settings block, edited in place. Only known fields change; every other byte stays as read. */
  class MouseSettings {
    constructor(bytes) { this.b = Uint8Array.from(bytes); }
    clone() { return new MouseSettings(this.b); }

    get polling() { return this.b[OFF.polling]; }
    set polling(v) { this.b[OFF.polling] = v; }
    get motionSync() { return !!this.b[OFF.motionSync]; }
    set motionSync(on) { this.b[OFF.motionSync] = on ? 1 : 0; }
    get glass() { return this.b[OFF.glass] === 1; }
    set glass(on) {
      if (on === this.glass) return;
      this.b[OFF.glass] = on ? 1 : 0;
      // as the official tool does: lift-off distance moves to the nearest choice of the other list
      const i = this.b[OFF.lod];
      this.b[OFF.lod] = on ? (i <= 7 ? 1 : 2) : (i === 2 ? 10 : 3);
    }
    get lod() { return this.b[OFF.lod]; }
    set lod(i) { this.b[OFF.lod] = i; }
    get angleSnap() { return !!this.b[OFF.angleSnap]; }
    set angleSnap(on) { this.b[OFF.angleSnap] = on ? 1 : 0; }
    get ripple() { return !!this.b[OFF.ripple]; }
    set ripple(on) { this.b[OFF.ripple] = on ? 1 : 0; }
    get angleTune() { const v = this.b[OFF.angleTune]; return v > 127 ? v - 256 : v; }
    set angleTune(v) { this.b[OFF.angleTune] = Math.max(-ANGLE_MAX, Math.min(ANGLE_MAX, Math.round(v))) & 255; }
    get liftLed() { return this.b[OFF.liftLed] === 1; }
    set liftLed(on) { this.b[OFF.liftLed] = on ? 1 : 0; }
    flag(name) { return !!(this.b[OFF.flags] & FLAG[name]); }
    setFlag(name, on) { this.b[OFF.flags] = on ? this.b[OFF.flags] | FLAG[name] : this.b[OFF.flags] & ~FLAG[name]; }

    /** Power saving / deep sleep: { on, minutes } (minutes 1-120; bit 7 set = off) */
    timer(which) { const v = this.b[OFF[which]]; return { on: !(v & 0x80), minutes: v & 0x7f }; }
    setTimer(which, on, minutes) {
      const m = Math.max(1, Math.min(120, Math.round(minutes) || 1));
      this.b[OFF[which]] = on ? m : m | 0x80;
    }
    /** Power saving can't be turned off at "1000 Hz, power saving" and "125 Hz, office mode". */
    get powerSaveForced() { return this.polling === 0x80 || this.polling === 0x40; }

    get cpiCount() { return this.b[OFF.cpiCount]; }
    set cpiCount(n) {
      this.b[OFF.cpiCount] = Math.max(1, Math.min(4, n));
      if (this.cpiCurrent >= this.cpiCount) this.cpiCurrent = this.cpiCount - 1;
    }
    get cpiCurrent() { return this.b[OFF.cpiCurrent]; }
    set cpiCurrent(i) { this.b[OFF.cpiCurrent] = i; }
    cpi(i) { const o = OFF.cpi + i * 5; return { x: u16(this.b, o + 1), y: u16(this.b, o + 3) }; }
    setCpi(i, x, y = x) {
      const o = OFF.cpi + i * 5;
      x = MouseSettings.roundCpi(x); y = MouseSettings.roundCpi(y);
      this.b[o] = x !== y ? 1 : 0;
      put16(this.b, o + 1, x); put16(this.b, o + 3, y);
    }
    /** 10-30000 in steps of 10, and of 50 above 10000, as the official tool rounds them. */
    static roundCpi(v) {
      v = Math.max(CPI_MIN, Math.min(CPI_MAX, Math.round(Number(v) || 0)));
      return v > 10000 ? Math.round(v / 50) * 50 : Math.round(v / 10) * 10;
    }

    button(i) {
      const o = OFF.buttons + i * 7, b = this.b;
      return { type: b[o], code: b[o + 1], value: u16(b, o + 2), value2: u16(b, o + 4), filter: b[o + 6] };
    }
    /** action: { type, code, value, value2 } (the click filter byte is left alone) */
    setButton(i, a) {
      const o = OFF.buttons + i * 7;
      this.b[o] = a.type; this.b[o + 1] = a.code;
      put16(this.b, o + 2, a.value || 0); put16(this.b, o + 4, a.value2 || 0);
    }
    /** Click filter of buttons 0-4: 0-25, or an SPDT mode (0xF1 / 0xF0, left and right only). */
    filter(i) { return this.b[OFF.buttons + i * 7 + 6]; }
    setFilter(i, v) { this.b[OFF.buttons + i * 7 + 6] = v; }

    /** Left-handed (as the official tool does it): the right button clicks left and the left button takes over the
     * right button's action; turned off, the right button gets that action back and the left button clicks left.
     * The click filters move with the actions. */
    get leftHanded() { const r = this.button(1); return r.type === 0 && r.code === 1; }
    set leftHanded(on) {
      if (on === this.leftHanded) return;
      const [from, to] = on ? [1, 0] : [0, 1];
      const moving = this.button(from), staying = this.button(to);
      this.setButton(to, moving); this.setFilter(to, moving.filter);
      this.setButton(from, { type: 0x00, code: 0x01 }); this.setFilter(from, staying.filter);
    }

    // ---- what goes to the mouse
    sensorPayload() { const b = this.b; return [b[7], b[8], b[9], b[10], b[11], b[1], b[14], b[13], ...b.slice(OFF.cpi, OFF.cpi + 20)]; }
    tuningPayload() {
      const b = this.b, f = (i) => b[OFF.buttons + i * 7 + 6];
      return [b[OFF.motionSync], b[OFF.polling], b[OFF.flags], b[OFF.powerSave], f(0), f(1), f(2), f(3), f(4), b[OFF.deepSleep], b[OFF.glass]];
    }
    buttonPayload() { return Array.from(this.b.slice(OFF.buttons, OFF.buttons + 56)); }

    /** The sections that differ from another settings block: 'sensor', 'tuning', 'buttons'. */
    changedSections(from) {
      const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      const out = [];
      if (!same(this.sensorPayload(), from.sensorPayload())) out.push('sensor');
      if (!same(this.tuningPayload(), from.tuningPayload())) out.push('tuning');
      if (!same(this.buttonPayload(), from.buttonPayload())) out.push('buttons');
      return out;
    }

    /** Problems that would stop a write (values the official tool never sends). */
    problems() {
      const p = [];
      if (!POLLING.some(([c]) => c === this.polling)) p.push(`polling rate code 0x${this.polling.toString(16)}`);
      if (this.glass ? ![1, 2].includes(this.lod) : this.lod > 10) p.push(`lift-off distance ${this.lod}`);
      if (this.cpiCount < 1 || this.cpiCount > 4) p.push(`${this.cpiCount} CPI levels`);
      if (this.cpiCurrent >= this.cpiCount) p.push(`CPI level ${this.cpiCurrent + 1} of ${this.cpiCount}`);
      for (let i = 0; i < 4; i++) {
        const { x, y } = this.cpi(i);
        if (x < CPI_MIN || x > CPI_MAX || y < CPI_MIN || y > CPI_MAX) p.push(`CPI ${x}×${y}`);
      }
      for (let i = 0; i < 5; i++) {
        const f = this.filter(i);
        if (f > FILTER_MAX && !(i < 2 && (f === 0xf0 || f === 0xf1))) p.push(`click filter ${f} on ${BUTTONS[i].toLowerCase()}`);
      }
      return p;
    }
  }

  let kc = null;
  const defaultKeyName = (u) => {
    if (!window.Keycodes) return `key 0x${u.toString(16)}`;
    kc = kc || new window.Keycodes(12);
    const d = kc.describe(u);
    return window.Keycodes.oneLine(d.label || '') || d.name.replace(/^KC_/, '');
  };

  /** What a button does, as { id, label, title }. keyName(usage) names a keyboard key (HID usage). */
  function describeAction(a, keyName = defaultKeyName) {
    if (a.type === 0x02) {
      const mods = MODS.filter(([m]) => a.code & m).map(([, n]) => n);
      return { id: 'key', label: [...mods, a.value ? keyName(a.value) : 'no key'].join(' + '), title: 'Keyboard key' };
    }
    if (a.type === 0x0c) return { id: 'fixedCpi', label: a.value === a.value2 ? `Fixed CPI ${a.value}` : `Fixed CPI ${a.value} × ${a.value2}`, title: 'Fixed CPI while held' };
    const f = ACTIONS.find(([, , t, c]) => t === a.type && c === a.code);
    if (f) return { id: f[0], label: f[1], title: f[1] };
    return { id: 'other', label: `Other (${a.type.toString(16)}:${a.code.toString(16)})`, title: 'Set up with another tool; kept as it is' };
  }

  class EndgameMouse {
    /** timeScale shortens the waits between a command and its answer (the pretend mouse and the tests). */
    constructor(hid, { timeScale = 1 } = {}) {
      this.hid = hid;
      this.kind = 'endgame';
      this.timeScale = timeScale;
      this.info = { wireless: hid.productId === PID_DONGLE, dongleFirmware: '', firmware: '', battery: null, linked: false };
      this.settings = null; // MouseSettings as read
      this._chain = Promise.resolve();
    }

    static isEndgame(hid) {
      return !!hid && hid.vendorId === VID && (hid.productId === PID_DONGLE || hid.productId === PID_WIRED)
        && (hid.collections || []).some((c) => c.usagePage === 0xff01 && c.usage === 0x0002);
    }

    get name() { return this.hid.productName || (this.info.wireless ? 'Endgame Gear 4K dongle' : 'Endgame Gear mouse'); }
    get vendorId() { return this.hid.vendorId; }
    get productId() { return this.hid.productId; }

    // ---- transport
    _queue(fn) {
      const p = this._chain.then(fn, fn);
      this._chain = p.catch(() => {});
      return p;
    }

    /** The answer as the official tool sees it: [report ID, status, ..., data from byte 16]. The dongle
     * answers every GetFeature with its own report ID first (0xA1, even when 0xA0 was asked for). */
    static _full(view, id, len) {
      const d = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      const out = new Uint8Array(len + 1);
      if (d[0] === CMD_ID || d[0] === BLOCK_ID) out.set(d.subarray(0, len + 1));
      else { out[0] = id; out.set(d.subarray(0, len), 1); }
      return out;
    }

    /** Sends one 0xA1 command, waits, and reads the answer (0xA1, or the 0xA0 block). -> full report bytes */
    async _command(bytes, { wait, payload = null, chunk = 0, read = CMD_ID } = {}) {
      if (!SAFE.has(bytes[0])) throw new Error(`Refusing to send mouse command 0x${bytes[0].toString(16)}`);
      const out = new Uint8Array(CMD_LEN);
      out.set(bytes.slice(0, 3));
      out[5] = chunk;
      if (payload) out.set(payload.slice(0, CMD_LEN - (DATA - 1)), DATA - 1);
      const len = read === BLOCK_ID ? BLOCK_LEN : CMD_LEN;
      let r;
      try {
        await this.hid.sendFeatureReport(CMD_ID, out);
        await sleep(wait * this.timeScale);
        for (let attempt = 0; attempt < 3; attempt++) {
          r = EndgameMouse._full(await this.hid.receiveFeatureReport(read), read, len);
          if (r[1] !== 3) break; // 3 = busy: wait and read again, as the official tool does
          await sleep((wait + 200) * this.timeScale);
        }
      } catch (e) {
        // the system refused the transfer, so nothing reached the dongle or the mouse
        throw Object.assign(new Error(`Couldn’t talk to the ${this.info.wireless ? 'dongle' : 'mouse'}: ${e.message}`), { transport: true });
      }
      if (r[1] !== 1) {
        const err = Object.assign(new Error(`The mouse answered command 0x${bytes[0].toString(16)} with status ${r[1]}`), { status: r[1] });
        // behind the dongle, questions for a sleeping mouse come back busy or with another status (8, 17...)
        if (this.info.wireless && MOUSE_READS.has(bytes[0])) err.asleep = true;
        throw err;
      }
      return r;
    }

    /** On the dongle: the link check the official tool sends before each command. */
    async _link() {
      if (!this.info.wireless) return;
      try { await this._command([0x0f, 0x01], { wait: 300 }); return; } catch (e) { if (e.transport) throw e; /* try the other form */ }
      try { await this._command([0x0f, 0x0f], { wait: 300 }); } catch (e) {
        if (e.transport) throw e;
        throw Object.assign(new Error('The mouse isn’t answering through the dongle. Switch it on or move it to wake it up.'), { asleep: true });
      }
    }

    async open() {
      if (!this.hid.opened) await this.hid.open();
      await this.refreshInfo();
      if (this.info.linked) await this.readSettings();
    }

    async close() {
      try { if (this.hid.opened) await this.hid.close(); } catch (_) { /* gone */ }
    }

    /** Firmware versions, link state and battery. */
    refreshInfo() {
      return this._queue(async () => {
        const w = this.info.wireless;
        if (w) {
          await this._link();
          const d = await this._command([0x0d], { wait: 150 });
          const v = u16(d, 17);
          this.info.dongleFirmware = parseInt(v.toString(16), 10) < 200 ? version(v) : '';
        }
        await this._link();
        const m = await this._command([0x0e], { wait: w ? 350 : 150 });
        this.info.mouseId = u16(m, 18);
        this.info.linked = this.info.mouseId === PID_WIRED;
        if (!this.info.linked) {
          this.info.firmware = ''; this.info.battery = null;
          return this.info;
        }
        this.info.firmware = version(u16(m, 23));
        await this._link();
        const b = await this._command([0xb4], { wait: w ? 350 : 300 });
        this.info.battery = Math.min(100, b[16]);
        return this.info;
      });
    }

    /** Battery only (lighter than refreshInfo). */
    refreshBattery() {
      return this._queue(async () => {
        await this._link();
        const b = await this._command([0xb4], { wait: this.info.wireless ? 350 : 300 });
        this.info.battery = Math.min(100, b[16]);
        return this.info.battery;
      });
    }

    readSettings() {
      return this._queue(async () => {
        await this._link();
        const r = await this._command([0x12], { wait: this.info.wireless ? 400 : 110, read: BLOCK_ID });
        this.settings = new MouseSettings(r.slice(DATA, DATA + BLOCK_SIZE));
        return this.settings;
      });
    }

    /** Writes the sections of `next` that differ from what was read, then reads the settings back. */
    writeSettings(next, onStep) {
      return this._queue(async () => {
        if (!this.settings) throw new Error('Read the settings first');
        const bad = next.problems();
        if (bad.length) throw new Error('Not written, these values look wrong: ' + bad.join(', '));
        const sections = next.changedSections(this.settings);
        const wait = this.info.wireless ? 880 : 500;
        let n = 0;
        for (const s of sections) {
          if (onStep) onStep(++n, sections.length, s);
          if (s === 'sensor') {
            await this._link();
            await this._command([0x14, 0x0f, 0x1c], { wait, payload: next.sensorPayload() });
          } else if (s === 'tuning') {
            await this._link();
            await this._command([0x15, 0x0f, 0x0a], { wait, payload: next.tuningPayload() });
          } else if (s === 'buttons') {
            const p = next.buttonPayload();
            for (let c = 0; c < 2; c++) {
              await this._link();
              await this._command([0x16, 0x0f, 0x1c], { wait, payload: p.slice(c * 28, c * 28 + 28), chunk: c + 1 });
              await sleep(100 * this.timeScale);
            }
          }
        }
        await this._link();
        const r = await this._command([0x12], { wait: this.info.wireless ? 400 : 110, read: BLOCK_ID });
        this.settings = new MouseSettings(r.slice(DATA, DATA + BLOCK_SIZE));
        return { sections, settings: this.settings };
      });
    }
  }

  /**
   * On Windows the desktop app sends the mouse's reports through Windows' own HID calls
   * (localKeymap.mouseHid, see electron/hid-win.js): WebHID can refuse every one of them there,
   * depending on the order Windows lists the dongle's collections. This wraps the WebHID device so
   * EndgameMouse uses it as before; when the helper can't open the mouse, WebHID is used after all.
   */
  function windowsTransport(device, bridge) {
    let handle = null, web = false;
    const plain = (e) => new Error(String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    return {
      device, vendorId: device.vendorId, productId: device.productId, productName: device.productName, collections: device.collections,
      get opened() { return web ? device.opened : handle !== null; },
      get route() { return web ? 'WebHID' : 'Windows'; },
      async open() {
        try {
          handle = (await bridge.open(device.productId)).handle;
        } catch (e) {
          console.warn('Talking to the mouse through WebHID:', plain(e).message);
          web = true;
          if (!device.opened) await device.open();
        }
      },
      async close() {
        if (web) { if (device.opened) await device.close(); return; }
        const h = handle;
        handle = null;
        if (h !== null) await bridge.close(h).catch(() => {});
      },
      async sendFeatureReport(id, data) {
        if (web) return device.sendFeatureReport(id, data);
        const d = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const b = new Uint8Array(d.length + 1);
        b[0] = id;
        b.set(d, 1);
        try { await bridge.setFeature(handle, b); } catch (e) { throw plain(e); }
      },
      async receiveFeatureReport(id) {
        if (web) return device.receiveFeatureReport(id);
        let b;
        try { b = await bridge.getFeature(handle, id); } catch (e) { throw plain(e); }
        return new DataView(b.buffer, b.byteOffset, b.byteLength);
      },
    };
  }

  EndgameMouse.FILTER_DONGLE = { vendorId: VID, productId: PID_DONGLE, usagePage: 0xff01, usage: 0x0002 };
  EndgameMouse.FILTER_WIRED = { vendorId: VID, productId: PID_WIRED, usagePage: 0xff01, usage: 0x0002 };
  Object.assign(EndgameMouse, {
    POLLING, LOD, LOD_GLASS, SPDT, BUTTONS, ACTIONS, MODS, CPI_MIN, CPI_MAX, FILTER_MAX, ANGLE_MAX,
    Settings: MouseSettings, describeAction, windowsTransport,
  });
  window.EndgameMouse = EndgameMouse;
})();
