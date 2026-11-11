/* Local Keymap - VIA keyboard definition layout parser.
 * Mirrors the rules of VIA's reader: KLE rows -> keys with row/col (legend 0), layout option
 * "group,option" (legend 8) and rotary encoders "e<n>" (legend 4), after KLE alignment remapping. */
(function () {
  'use strict';

  // KLE label alignment table (raw legend index -> normalized position), from kle-serial.
  const ALIGN = [
    [0, 6, 2, 8, 9, 11, 3, 5, 1, 4, 7, 10],
    [1, 7, -1, -1, 9, 11, 4, -1, -1, -1, -1, 10],
    [3, -1, 5, -1, 9, 11, -1, -1, 4, -1, -1, 10],
    [4, -1, -1, -1, 9, 11, -1, -1, -1, -1, -1, 10],
    [0, 6, 2, 8, 10, -1, 3, 5, 1, 4, 7, -1],
    [1, 7, -1, -1, 10, -1, 4, -1, -1, -1, -1, -1],
    [3, -1, 5, -1, 10, -1, -1, -1, 4, -1, -1, -1],
    [4, -1, -1, -1, 10, -1, -1, -1, -1, -1, -1, -1],
  ];
  const ENCODER_RE = /^[eE](\d+)\s*$/;

  function legends(text, a) {
    const map = ALIGN[a] || ALIGN[0];
    const out = [];
    text.split('\n').forEach((l, i) => {
      const idx = map[i];
      if (idx !== undefined && idx >= 0) out[idx] = l.trim();
    });
    return out;
  }

  function pair(s) {
    if (!s) return null;
    const parts = s.split(/[,，]/);
    if (parts.length !== 2) return null;
    const n = parts.map((v) => parseInt(v, 10));
    return n.some(Number.isNaN) ? null : n;
  }

  /** keymap: definition.layouts.keymap -> { keys, optionKeys: {group: {option: keys[]}} } */
  function parse(keymap) {
    const rows = (keymap || []).filter(Array.isArray);
    const all = [];
    const colorCount = {};
    let carry = { c: '#cccccc', t: '#000000', r: 0, rx: 0, ry: 0, a: 0 };
    let y = 0;

    for (const row of rows) {
      const st = { ...carry, w: 1, h: 1, d: false, x2: 0, y2: 0, w2: 0, h2: 0 };
      let x = 0;
      for (const n of row) {
        if (n && typeof n === 'object') {
          for (const p of ['y2', 'x2', 'w2', 'h2', 'r', 'rx', 'ry', 'h', 'w']) if (typeof n[p] === 'number') st[p] = n[p];
          if (typeof n.d === 'boolean') st.d = n.d;
          if (typeof n.rx === 'number' || typeof n.ry === 'number') y = st.ry;
          if (typeof n.y === 'number') y += n.y;
          if (typeof n.x === 'number') x += n.x;
          if (typeof n.a === 'number') st.a = n.a;
          if (typeof n.c === 'string') st.c = n.c;
          if (typeof n.t === 'string') st.t = n.t;
        } else if (typeof n === 'string') {
          const L = legends(n, st.a);
          const key = {
            x: x + st.rx, y, w: st.w, h: st.h, r: st.r, rx: st.rx, ry: st.ry,
            x2: st.x2, y2: st.y2, w2: st.w2, h2: st.h2,
            row: -1, col: -1, group: -1, option: 0, colorKey: `${st.c}:${st.t}`,
          };
          const enc = L[4] && ENCODER_RE.exec(L[4]);
          if (enc) key.ei = +enc[1];
          const rc = pair(L[0]);
          if (rc) { key.row = rc[0]; key.col = rc[1]; }
          const go = pair(L[8]);
          if (go) { key.group = go[0]; key.option = go[1]; }
          if (!st.d && (rc || key.ei !== undefined)) {
            all.push(key);
            colorCount[key.colorKey] = (colorCount[key.colorKey] || 0) + 1;
          }
          x += st.w;
          st.w = 1; st.h = 1; st.d = false; st.x2 = 0; st.y2 = 0; st.w2 = 0; st.h2 = 0;
        }
      }
      carry = { c: st.c, t: st.t, r: st.r, rx: st.rx, ry: st.ry, a: st.a };
      y += 1;
    }

    // Most common colour = alphas, then mods, then accents (like VIA).
    const order = Object.keys(colorCount).sort((p, q) => colorCount[q] - colorCount[p]);
    const kind = ['alpha', 'mod', 'accent'];
    all.forEach((k) => { k.color = kind[order.indexOf(k.colorKey)] || 'mod'; delete k.colorKey; });

    const keys = all.filter((k) => k.group < 0);
    const optionKeys = {};
    all.filter((k) => k.group >= 0).forEach((k) => {
      optionKeys[k.group] = optionKeys[k.group] || {};
      (optionKeys[k.group][k.option] = optionKeys[k.group][k.option] || []).push(k);
    });

    // Move every alternative of a group onto the spot of its option 0.
    const pivot = (ks) => ({ x: Math.min(...ks.map((k) => k.x)), y: Math.min(...ks.map((k) => k.y)) });
    for (const g of Object.keys(optionKeys)) {
      const opts = optionKeys[g];
      if (!opts[0]) continue;
      const zero = pivot(opts[0]);
      for (const o of Object.keys(opts)) {
        if (+o === 0) continue;
        const p = pivot(opts[o]);
        const dx = p.x - zero.x, dy = p.y - zero.y;
        opts[o].forEach((k) => { k.x -= dx; k.y -= dy; k.rx -= dx; k.ry -= dy; });
      }
    }
    return { keys, optionKeys };
  }

  /** A plain rows x cols grid, for keyboards without a definition file. */
  function gridKeymap(rows, cols) {
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => `${r},${c}`));
  }

  window.KLE = { parse, gridKeymap };
})();
