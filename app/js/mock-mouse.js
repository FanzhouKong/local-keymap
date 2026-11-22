/* Local Keymap - a pretend Endgame Gear XM2w 4k v2 on its 4K dongle, for trying the Mouse tab without hardware
 * and for the self-tests. It answers like the real dongle (every GetFeature returns the whole 1040-byte answer,
 * starting with 0xA1), keeps the settings block in memory, and refuses any command the app shouldn't send. */
(function () {
  'use strict';

  // the first 112 bytes of a real XM2w 4k v2's settings block (the rest is zero)
  const INITIAL = [
    0x00, 0x00, 0x00, 0x03, 0x01, 0x04, 0x01, 0x00, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01, 0xff,
    0xff, 0x00, 0x01, 0x01, 0x00, 0x00, 0xff, 0x01, 0x02, 0xff, 0x00, 0x00, 0x01, 0x03, 0x00, 0xff,
    0x00, 0x01, 0x04, 0x00, 0x20, 0x03, 0x20, 0x03, 0x00, 0x20, 0x03, 0x20, 0x03, 0x00, 0x40, 0x06,
    0x40, 0x06, 0x00, 0x80, 0x0c, 0x80, 0x0c, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x02,
    0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x08, 0x00, 0x00,
    0x00, 0x00, 0x08, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x08, 0x09, 0xf1, 0x00, 0x00, 0x00, 0x00,
    0x08, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x08, 0x01, 0xff, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00,
  ];

  /** asleep: the mouse is asleep behind the dongle. The dongle then fails the link check, or with
   * linkWhileAsleep (as the real one often does) passes it and answers questions for the mouse with status 8. */
  function create({ wireless = true, asleep = false, linkWhileAsleep = false, battery = 87 } = {}) {
    const block = new Uint8Array(1024);
    block.set(INITIAL);
    const answer = new Uint8Array(1040);
    const state = { block, sent: [], refused: [], asleep, battery };

    function command(d) {
      const cmd = d[0], p = d.slice(15);
      answer.fill(0);
      answer[0] = 0xa1;
      answer[1] = 1;
      const awake = !state.asleep || !wireless;
      switch (cmd) {
        case 0x0f: if ((!awake && !linkWhileAsleep) || (d[1] !== 0x01 && d[1] !== 0x0f)) answer[1] = 2; break;
        case 0x0d: answer[17] = 0x01; answer[18] = 0x01; break; // dongle firmware 1.01
        case 0x0e: if (awake) { answer[18] = 0x82; answer[19] = 0x19; answer[23] = 0x07; answer[24] = 0x01; } else if (linkWhileAsleep) answer[1] = 8; break;
        case 0xb4: if (awake) answer[16] = state.battery; else answer[1] = linkWhileAsleep ? 8 : 2; break;
        case 0x12: if (awake) answer.set(block, 16); else answer[1] = 2; break;
        case 0x14:
          if (d[1] !== 0x0f || d[2] !== 0x1c) { answer[1] = 2; break; }
          [7, 8, 9, 10, 11, 1, 14, 13].forEach((o, i) => { block[o] = p[i]; });
          block.set(p.slice(8, 28), 0x23);
          break;
        case 0x15:
          if (d[1] !== 0x0f || d[2] !== 0x0a) { answer[1] = 2; break; }
          [0x0c, 5, 6, 4, 0x3d, 0x44, 0x4b, 0x52, 0x59, 3, 0x6f].forEach((o, i) => { block[o] = p[i]; });
          break;
        case 0x16:
          if (d[1] !== 0x0f || d[2] !== 0x1c || (d[5] !== 1 && d[5] !== 2)) { answer[1] = 2; break; }
          block.set(p.slice(0, 28), 0x37 + (d[5] - 1) * 28);
          break;
        default:
          state.refused.push(cmd);
          answer[1] = 2;
      }
    }

    return {
      vendorId: 0x3367,
      productId: wireless ? 0x1970 : 0x1982,
      productName: wireless ? 'Endgame Gear HS Dongle (demo)' : 'Endgame Gear XM2w 4k v2 (demo)',
      collections: [{ usagePage: 0xff01, usage: 0x0002 }],
      opened: false,
      mock: state,
      async open() { this.opened = true; },
      async close() { this.opened = false; },
      addEventListener() {},
      removeEventListener() {},
      async sendFeatureReport(id, data) {
        const d = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
        if (id !== 0xa1 || d.length !== 63) throw new Error(`Unexpected report ${id} of ${d.length} bytes`);
        state.sent.push(Array.from(d.slice(0, 6)));
        command(d);
      },
      async receiveFeatureReport() { return new DataView(answer.slice().buffer); },
    };
  }

  window.MockMouse = { create, INITIAL };
})();
