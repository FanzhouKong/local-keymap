/* Local Keymap - a pretend VIA keyboard (60% with a knob) for trying the app without hardware.
 * It implements the firmware side of the VIA protocol in memory, behind a WebHID-like object.
 * Its switch matrix follows the keys you press on your real keyboard, so the matrix tester works too. */
(function () {
  'use strict';

  const ROWS = 5, COLS = 15, LAYERS = 4;
  const DEFINITION = {
    name: 'Demo 60% (pretend keyboard)', vendorId: '0x4C4B', productId: '0x0060',
    matrix: { rows: ROWS, cols: COLS },
    layouts: {
      labels: ['Split Backspace', ['Right Shift', 'Full', 'Split']],
      keymap: [
        [{ c: '#777777' }, '0,0', { c: '#cccccc' }, '0,1', '0,2', '0,3', '0,4', '0,5', '0,6', '0,7', '0,8', '0,9', '0,10', '0,11', '0,12',
          { c: '#aaaaaa', w: 2 }, '0,13\n\n\n0,0', { x: 0.5, c: '#cccccc' }, '0,13\n\n\n0,1', '0,14\n\n\n0,1'],
        [{ c: '#aaaaaa', w: 1.5 }, '1,0', { c: '#cccccc' }, '1,1', '1,2', '1,3', '1,4', '1,5', '1,6', '1,7', '1,8', '1,9', '1,10', '1,11', '1,12',
          { c: '#aaaaaa', w: 1.5 }, '1,13', { x: 0.5, c: '#777777' }, '\n\n\n\n\n\n\n\n\ne0'],
        [{ c: '#aaaaaa', w: 1.75 }, '2,0', { c: '#cccccc' }, '2,1', '2,2', '2,3', '2,4', '2,5', '2,6', '2,7', '2,8', '2,9', '2,10', '2,11',
          { c: '#777777', w: 2.25 }, '2,13'],
        [{ c: '#aaaaaa', w: 2.25 }, '3,0', { c: '#cccccc' }, '3,2', '3,3', '3,4', '3,5', '3,6', '3,7', '3,8', '3,9', '3,10', '3,11',
          { c: '#aaaaaa', w: 2.75 }, '3,13\n\n\n1,0', { x: 0.5, w: 1.75 }, '3,13\n\n\n1,1', '3,14\n\n\n1,1'],
        [{ w: 1.25 }, '4,0', { w: 1.25 }, '4,1', { w: 1.25 }, '4,2', { c: '#cccccc', w: 6.25 }, '4,6', { c: '#aaaaaa', w: 1.25 }, '4,10',
          { w: 1.25 }, '4,11', { w: 1.25 }, '4,12', { w: 1.25 }, '4,13'],
      ],
    },
  };

  const LAYER0 = [
    ['KC_ESC', 'KC_1', 'KC_2', 'KC_3', 'KC_4', 'KC_5', 'KC_6', 'KC_7', 'KC_8', 'KC_9', 'KC_0', 'KC_MINS', 'KC_EQL', 'KC_BSPC', 'KC_GRV'],
    ['KC_TAB', 'KC_Q', 'KC_W', 'KC_E', 'KC_R', 'KC_T', 'KC_Y', 'KC_U', 'KC_I', 'KC_O', 'KC_P', 'KC_LBRC', 'KC_RBRC', 'KC_BSLS', 'KC_NO'],
    ['KC_CAPS', 'KC_A', 'KC_S', 'KC_D', 'KC_F', 'KC_G', 'KC_H', 'KC_J', 'KC_K', 'KC_L', 'KC_SCLN', 'KC_QUOT', 'KC_NO', 'KC_ENT', 'KC_NO'],
    ['KC_LSFT', 'KC_NO', 'KC_Z', 'KC_X', 'KC_C', 'KC_V', 'KC_B', 'KC_N', 'KC_M', 'KC_COMM', 'KC_DOT', 'KC_SLSH', 'KC_NO', 'KC_RSFT', 'MO(1)'],
    ['KC_LCTL', 'KC_LGUI', 'KC_LALT', 'KC_NO', 'KC_NO', 'KC_NO', 'KC_SPC', 'KC_NO', 'KC_NO', 'KC_NO', 'KC_RALT', 'MO(1)', 'KC_APP', 'KC_RCTL', 'KC_NO'],
  ];
  const LAYER1 = {
    '0,0': 'KC_GRV', '0,1': 'KC_F1', '0,2': 'KC_F2', '0,3': 'KC_F3', '0,4': 'KC_F4', '0,5': 'KC_F5', '0,6': 'KC_F6', '0,7': 'KC_F7',
    '0,8': 'KC_F8', '0,9': 'KC_F9', '0,10': 'KC_F10', '0,11': 'KC_F11', '0,12': 'KC_F12', '0,13': 'KC_DEL',
    '1,8': 'KC_UP', '2,7': 'KC_LEFT', '2,8': 'KC_DOWN', '2,9': 'KC_RGHT', '1,1': 'KC_MPLY', '1,2': 'KC_VOLU', '2,2': 'KC_VOLD',
    '2,1': 'KC_MPRV', '2,3': 'KC_MNXT', '1,13': 'QK_BOOT', '3,13': 'LT(2, KC_RSFT)',
  };

  function create() {
    const kc = new Keycodes(12);
    const km = new Uint16Array(LAYERS * ROWS * COLS).fill(1); // KC_TRNS
    const at = (l, r, c) => (l * ROWS + r) * COLS + c;
    LAYER0.forEach((row, r) => row.forEach((n, c) => { km[at(0, r, c)] = kc.parse(n); }));
    Object.entries(LAYER1).forEach(([rc, n]) => { const [r, c] = rc.split(',').map(Number); km[at(1, r, c)] = kc.parse(n); });
    const enc = Array.from({ length: LAYERS }, (_, l) => [[l ? 1 : kc.parse('KC_VOLD'), l ? 1 : kc.parse('KC_VOLU')]]);
    let layoutOptions = 0;
    const down = new Set();

    // mirror real key presses into the pretend matrix (by matching layer-0 keycodes)
    const where = (code) => {
      const name = Keycodes.EVENT_TO_KC[code];
      if (!name) return null;
      const v = kc.parse(name);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (km[at(0, r, c)] === v) return r * COLS + c;
      return null;
    };
    window.addEventListener('keydown', (e) => { const p = where(e.code); if (p != null) down.add(p); }, true);
    window.addEventListener('keyup', (e) => { const p = where(e.code); if (p != null) down.delete(p); }, true);
    window.addEventListener('blur', () => down.clear());

    const dev = new EventTarget();
    Object.assign(dev, {
      opened: false, vendorId: 0x4c4b, productId: 0x0060, productName: 'Demo 60% (pretend)',
      collections: [{ usagePage: 0xff60, usage: 0x61, outputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 32 }] }] }],
      mockDefinition: DEFINITION,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      async sendReport(_id, data) {
        if (!this.opened) throw new Error('Device is not open');
        const d = new Uint8Array(32);
        d.set(new Uint8Array(data.buffer || data).slice(0, 32));
        handle(d);
        setTimeout(() => {
          const ev = new Event('inputreport');
          ev.data = new DataView(d.buffer);
          ev.reportId = 0;
          dev.dispatchEvent(ev);
        }, 1);
      },
    });

    function handle(d) {
      const u16 = (i) => (d[i] << 8) | d[i + 1];
      switch (d[0]) {
        case 0x01: d[1] = 0; d[2] = 12; break; // protocol 12
        case 0x02:
          if (d[1] === 0x02) { d[2] = layoutOptions >>> 24; d[3] = (layoutOptions >>> 16) & 255; d[4] = (layoutOptions >>> 8) & 255; d[5] = layoutOptions & 255; }
          else if (d[1] === 0x03) {
            const off = d[2], bpr = Math.ceil(COLS / 8), per = Math.floor(28 / bpr);
            let i = 3;
            for (let r = off; r < Math.min(ROWS, off + per); r++) {
              let v = 0;
              for (let c = 0; c < COLS; c++) if (down.has(r * COLS + c)) v |= 1 << c;
              for (let b = bpr - 1; b >= 0; b--) d[i++] = (v >> (8 * b)) & 255;
            }
          } else d[0] = 0xff;
          break;
        case 0x03:
          if (d[1] === 0x02) layoutOptions = ((d[2] << 24) | (d[3] << 16) | (d[4] << 8) | d[5]) >>> 0;
          else d[0] = 0xff;
          break;
        case 0x04: { const v = km[at(d[1], d[2], d[3])]; d[4] = v >> 8; d[5] = v & 255; break; }
        case 0x05: km[at(d[1], d[2], d[3])] = u16(4); break;
        case 0x0c: d[1] = 16; break;
        case 0x11: d[1] = LAYERS; break;
        case 0x12: { const off = u16(1), n = d[3]; for (let i = 0; i < n; i++) { const v = km[(off + i) >> 1] ?? 0; d[4 + i] = (off + i) % 2 ? v & 255 : v >> 8; } break; }
        case 0x13: { const off = u16(1), n = d[3]; for (let i = 0; i < n; i++) { const p = (off + i) >> 1; km[p] = (off + i) % 2 ? (km[p] & 0xff00) | d[4 + i] : (km[p] & 0xff) | (d[4 + i] << 8); } break; }
        case 0x14: { const v = enc[d[1]][d[2]][d[3] ? 1 : 0]; d[4] = v >> 8; d[5] = v & 255; break; }
        case 0x15: enc[d[1]][d[2]][d[3] ? 1 : 0] = u16(4); break;
        default: d[0] = 0xff;
      }
    }
    return dev;
  }

  window.MockVia = { create, DEFINITION };
})();
