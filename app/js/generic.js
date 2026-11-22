/* Local Keymap - a generic 65% layout for VIA keyboards that don't share theirs.
 * Such a keyboard only reports a matrix of keycodes, not where its keys sit. Most 65% boards wire
 * each matrix row to one row of keys and number the columns left to right, and their keymap still
 * says what most keys are (Q is Q). So letters, digits and other unmistakable keys pin each matrix
 * row to a row of the board and fix a few positions; every other key falls in between, in matrix
 * order, guided by what it does (a Home key belongs in the right-hand column). Keys that fit
 * nowhere get a row of their own under the board, so no key is ever hidden.
 * Boards without arrows or a right-hand column come out as a 60%. */
(function () {
  'use strict';

  // arrangements kept by an older version are worked out again, from the keymap they were first worked
  // out from when they kept it (2: remapped keys no longer pull a key out of its matrix row, 1.1.1;
  // 3: a repeated letter or a key nothing explains no longer hides a split backspace, and the source
  // keymap is kept, 1.1.2)
  const VERSION = 3;
  const TRNS = 1;
  const LAYER = 0x10000; // stands for any layer key (MO, TT, TG, OSL...)

  const KC = {
    ENT: 0x28, ESC: 0x29, BSPC: 0x2a, TAB: 0x2b, SPC: 0x2c, MINS: 0x2d, EQL: 0x2e, LBRC: 0x2f, RBRC: 0x30,
    BSLS: 0x31, NUHS: 0x32, SCLN: 0x33, QUOT: 0x34, GRV: 0x35, COMM: 0x36, DOT: 0x37, SLSH: 0x38, CAPS: 0x39,
    INS: 0x49, HOME: 0x4a, PGUP: 0x4b, DEL: 0x4c, END: 0x4d, PGDN: 0x4e, RGHT: 0x4f, LEFT: 0x50, DOWN: 0x51,
    UP: 0x52, NUBS: 0x64, APP: 0x65, MUTE: 0x7f, AMUTE: 0xa8, VOLU: 0xa9, VOLD: 0xaa,
    LCTL: 0xe0, LSFT: 0xe1, LALT: 0xe2, LGUI: 0xe3, RCTL: 0xe4, RSFT: 0xe5, RALT: 0xe6, RGUI: 0xe7,
  };
  const letter = (ch) => 0x04 + ch.charCodeAt(0) - 65;
  const digit = (d) => (d === 0 ? 0x27 : 0x1d + d);
  const NAV = [KC.DEL, KC.HOME, KC.PGUP, KC.PGDN, KC.END, KC.INS, KC.GRV, KC.MUTE, KC.AMUTE, KC.VOLU, KC.VOLD, LAYER];
  const RMOD = [KC.RALT, KC.RGUI, KC.RCTL, KC.APP, KC.LALT, KC.LGUI, KC.LCTL, LAYER];
  const BS2 = [KC.BSPC, KC.DEL, KC.GRV, KC.BSLS, TRNS];

  /** One key position of the template: c = centre x, code = the keycode that pins a key here
   * (letters, digits...), like = keycodes usually found here, skip = cost of leaving it empty. */
  const slot = (id, c, code, like = [], skip = 4) => ({ id, c, code, like, skip });
  const run = (ids, codes, x0) => ids.map((id, i) => slot(id, x0 + i, codes[i]));
  const ROWS = [
    [slot('esc', 0.5, null, [KC.ESC, KC.GRV], 2),
      ...run(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(digit), 1.5),
      slot('mins', 11.5, KC.MINS), slot('eql', 12.5, KC.EQL),
      slot('bs', 14, null, [KC.BSPC, KC.BSLS, KC.DEL, KC.GRV], 2), slot('bs2', 14.5, null, BS2, 0.3), slot('r0', 15.5, null, NAV, 0.8)],
    [slot('tab', 0.75, KC.TAB),
      ...run('QWERTYUIOP'.split(''), 'QWERTYUIOP'.split('').map(letter), 2),
      slot('lbrc', 12, KC.LBRC), slot('rbrc', 13, KC.RBRC),
      slot('bsls', 14.25, null, [KC.BSLS, KC.BSPC], 2), slot('r1', 15.5, null, NAV, 0.8)],
    [slot('caps', 0.875, null, [KC.CAPS, KC.LCTL, KC.ESC, LAYER], 2),
      ...run('ASDFGHJKL'.split(''), 'ASDFGHJKL'.split('').map(letter), 2.25),
      slot('scln', 11.25, KC.SCLN), slot('quot', 12.25, KC.QUOT),
      slot('ent', 13.875, KC.ENT), slot('r2', 15.5, null, NAV, 0.8)],
    [slot('lsft', 1.125, KC.LSFT), slot('iso', 1.75, null, [KC.NUBS, TRNS, KC.LSFT], 0.3),
      ...run('ZXCVBNM'.split(''), 'ZXCVBNM'.split('').map(letter), 2.75),
      slot('comm', 9.75, KC.COMM), slot('dot', 10.75, KC.DOT), slot('slsh', 11.75, KC.SLSH),
      slot('rsft', 13.125, KC.RSFT, [LAYER], 2), slot('up', 14.5, KC.UP, [], 1.5), slot('r3', 15.5, null, NAV, 0.8)],
    [slot('lctl', 0.625, null, [KC.LCTL, KC.CAPS, LAYER], 1), slot('lgui', 1.875, null, [KC.LGUI, KC.LALT, LAYER, KC.APP], 1),
      slot('lalt', 3.125, null, [KC.LALT, KC.LGUI], 1), slot('spc', 6.875, KC.SPC, [], 3),
      slot('ra', 10.5, null, RMOD, 0.5), slot('rb', 11.5, null, RMOD, 0.5), slot('rc', 12.5, null, RMOD, 0.5),
      slot('rd', 13.5, null, RMOD, 0.5), slot('left', 13.5, KC.LEFT, [], 1.5), slot('down', 14.5, KC.DOWN, [], 1.5), slot('rght', 15.5, KC.RGHT, [], 1.5)],
  ];
  ROWS.forEach((r) => r.forEach((s, i) => { s.i = i; }));
  const LIKED = new Set(ROWS.flat().flatMap((s) => s.like));
  const ANCHOR = new Map(); // keycode -> [row, slot]
  ROWS.forEach((r, ri) => r.forEach((s) => { if (s.code != null) ANCHOR.set(s.code, [ri, s]); }));
  // which row a keycode suggests, and how strongly (letters and digits outvote everything else)
  const HINT = new Map();
  ANCHOR.forEach(([ri], code) => HINT.set(code, [ri, 2]));
  HINT.set(KC.SPC, [4, 4]);
  [[KC.ESC, 0], [KC.BSPC, 0], [KC.GRV, 0], [KC.BSLS, 1], [KC.CAPS, 2], [KC.NUHS, 2], [KC.NUBS, 3],
    [KC.LCTL, 4], [KC.LGUI, 4], [KC.LALT, 4], [KC.RALT, 4], [KC.RCTL, 4], [KC.RGUI, 4], [KC.APP, 4]]
    .forEach(([code, ri]) => HINT.set(code, [ri, 0.5]));

  /** A QMK keycode -> the plain key it types (mod-tap, layer-tap and modded keys count as their
   * key; grave escape counts as Esc; layer keys as LAYER). */
  function basic(code, modern) {
    if (code < 0x100) return code;
    if (code < 0x2000) return code & 0xff;
    if (code === (modern ? 0x7c16 : 0x5c16)) return KC.ESC;
    if (code >= 0x4000 && code <= 0x4fff) return code & 0xff || LAYER; // LT(layer, key)
    if (modern) {
      if (code >= 0x2000 && code <= 0x3fff) return code & 0xff; // MT
      if (code >= 0x5200 && code <= 0x52df) return LAYER;
    } else {
      if (code >= 0x6000 && code <= 0x7fff) return code & 0xff;
      if ((code >= 0x5000 && code <= 0x54ff) || (code >= 0x5800 && code <= 0x581f)) return LAYER;
    }
    return code;
  }

  /** The anchors (sorted by column) that agree with each other: their places keep going one way
   * as the column goes up, and there is room between two of them for the keys wired between them
   * (a remapped layout like Colemak keeps letters in order, but shifted). */
  function consistent(anchors, group) {
    const between = (a, b) => group.filter((k) => k.col > a.k.col && k.col < b.k.col).length;
    const best = (sign) => {
      const n = anchors.length, score = new Array(n).fill(1), prev = new Array(n).fill(-1);
      for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) {
        const room = sign * (anchors[i].slot.i - anchors[j].slot.i) - 1;
        if (room < 0) continue;
        const s = score[j] + 1 - 1.2 * Math.max(0, between(anchors[j], anchors[i]) - room);
        if (s > score[i]) { score[i] = s; prev[i] = j; }
      }
      let i = n ? score.indexOf(Math.max(...score)) : -1;
      const out = [];
      while (i >= 0) { out.unshift(anchors[i]); i = prev[i]; }
      return { keep: out, score: n ? Math.max(...score) : 0 };
    };
    const up = best(1), down = best(-1);
    return down.score > up.score ? { keep: down.keep, dir: -1 } : { keep: up.keep, dir: 1 };
  }

  /** Lines up a row's keys (sorted left to right) with the template row; returns slot per key. */
  function align(keys, slots) {
    const n = keys.length, m = slots.length;
    const SKIP_KEY = 3;
    const cost = (k, s) => {
      if (k.anchor) return k.anchor === s ? 0 : 12;
      let v = s.code != null && s.code !== k.code ? 1.5 : 0; // a letter's place taken by another key
      if (s.code === k.code || s.like.includes(k.code)) v -= 1.5;
      else if (LIKED.has(k.code)) v += 0.5; // a Home key belongs somewhere else
      if (k.x !== undefined) v += (k.strong ? 0.6 : 0.15) * Math.abs(k.x - s.c);
      return v;
    };
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(Infinity));
    const how = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    dp[0][0] = 0;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= m; j++) {
        if (i === 0 && j === 0) continue;
        let best = Infinity, h = 0;
        if (i > 0 && j > 0 && dp[i - 1][j - 1] + cost(keys[i - 1], slots[j - 1]) < best) { best = dp[i - 1][j - 1] + cost(keys[i - 1], slots[j - 1]); h = 1; }
        if (i > 0 && dp[i - 1][j] + (keys[i - 1].anchor ? 20 : SKIP_KEY) < best) { best = dp[i - 1][j] + (keys[i - 1].anchor ? 20 : SKIP_KEY); h = 2; }
        if (j > 0 && dp[i][j - 1] + slots[j - 1].skip < best) { best = dp[i][j - 1] + slots[j - 1].skip; h = 3; }
        dp[i][j] = best; how[i][j] = h;
      }
    }
    const out = new Map();
    for (let i = n, j = m; i > 0 || j > 0;) {
      const h = how[i][j];
      if (h === 1) { out.set(keys[i - 1], slots[j - 1]); i--; j--; } else if (h === 2) i--; else j--;
    }
    return out;
  }

  /**
   * layers: keymap layers (flat Uint16Array per layer, rows * cols) as read from the keyboard, or
   * source: { l0, present } kept from an earlier arrangement (layer 0 and which positions hold a key),
   * so a newer version arranges the keymap the keyboard had when it was first seen, not later remaps.
   * -> { ok, json (a VIA-style definition), placed: Map "r,c" -> slot id, extras, keys, anchors }
   */
  function fit({ rows, cols, layers, source, protocol = 12, name = 'Keyboard', vendorId = '0x0000', productId = '0x0000' }) {
    const modern = protocol >= 11;
    const n = rows * cols;
    let l0, present;
    if (source) {
      l0 = Array.from(source.l0).slice(0, n);
      present = Array.from(source.present).slice(0, n).map((v) => (v ? 1 : 0));
    } else {
      // QMK fills matrix positions outside the layout with KC_NO on every layer the firmware's keymap
      // defines; layers it doesn't define are KC_TRNS everywhere and say nothing
      const defined = layers.filter((l, i) => i === 0 || Array.prototype.some.call(l.subarray(0, n), (v) => v === 0));
      l0 = Array.from(layers[0].subarray(0, n));
      present = l0.map((_, i) => (defined.some((l) => l[i]) ? 1 : 0));
    }
    const keys = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!present[i]) continue;
      keys.push({ row: r, col: c, code: basic(l0[i], modern) });
    }

    // 1. each matrix row joins the row of the board its keys vote for
    const prowOf = new Array(rows).fill(-1);
    for (let r = 0; r < rows; r++) {
      const votes = [0, 0, 0, 0, 0];
      keys.filter((k) => k.row === r).forEach((k) => { const h = HINT.get(k.code); if (h) votes[h[0]] += h[1]; });
      const top = Math.max(...votes);
      if (top >= 2) prowOf[r] = votes.indexOf(top);
    }
    keys.forEach((k) => { k.prow = prowOf[k.row]; });

    // 2. per board row: unmistakable keys pin positions; the rest get an x between them
    const slotOf = new Map();
    let anchors = 0;
    for (let p = 0; p < 5; p++) {
      const rowKeys = keys.filter((k) => k.prow === p);
      if (!rowKeys.length) continue;
      // a repeated keycode pins nothing (split shifts often send Shift twice), except a letter or digit
      // repeated within one matrix row: that's a key remapped to it, and `consistent` keeps the one in order
      const count = new Map(), rowsOf = new Map();
      rowKeys.forEach((k) => {
        count.set(k.code, (count.get(k.code) || 0) + 1);
        if (!rowsOf.has(k.code)) rowsOf.set(k.code, new Set());
        rowsOf.get(k.code).add(k.row);
      });
      const canPin = (code) => count.get(code) === 1 || (code >= 0x04 && code <= 0x27 && rowsOf.get(code).size === 1);
      const groups = [...new Set(rowKeys.map((k) => k.row))].map((r) => {
        const group = rowKeys.filter((k) => k.row === r).sort((a, b) => a.col - b.col);
        const cand = group.filter((k) => { const a = ANCHOR.get(k.code); return a && a[0] === p && canPin(k.code); })
          .map((k) => ({ k, slot: ANCHOR.get(k.code)[1] }));
        const { keep, dir } = consistent(cand, group);
        keep.forEach(({ k, slot: s }) => { k.anchor = s; k.x = s.c; k.strong = true; });
        anchors += keep.length;
        const pins = keep.map(({ k }) => k);
        // board units per matrix column (about 2 where a row of keys is split over two matrix rows)
        const a = pins[0], b = pins[pins.length - 1];
        const slope = pins.length > 1 ? Math.max(0.5, Math.min(2.5, Math.abs((b.x - a.x) / (b.col - a.col)))) * dir : null;
        return { group, pins, slope };
      });
      const known = groups.filter((g) => g.slope !== null);
      const rowSlope = known.length ? known.reduce((s, g) => s + g.slope, 0) / known.length : 1;
      for (const { group, pins, slope } of groups) {
        const step = slope ?? rowSlope;
        for (const k of group) {
          if (k.anchor) continue;
          const left = pins.filter((a) => a.col < k.col).pop(), right = pins.find((a) => a.col > k.col);
          if (left && right) { k.x = left.x + (k.col - left.col) / (right.col - left.col) * (right.x - left.x); k.strong = true; }
          else if (left) k.x = left.x + (k.col - left.col) * step;
          else if (right) k.x = right.x - (right.col - k.col) * step;
          else k.sortX = k.col; // no pins in this matrix row: matrix order only
        }
      }
      rowKeys.sort((a, b) => (a.x ?? a.sortX) - (b.x ?? b.sortX) || a.row - b.row || a.col - b.col);
      align(rowKeys, ROWS[p]).forEach((s, k) => slotOf.set(k, s.id));
    }

    // 3. keys left over (often wired into a neighbouring matrix row) and keys sitting where their
    //    keycode doesn't belong move to a place that suits what they do: the other half of a split
    //    backspace, a split left shift, a backslash... A placed key may make way if it has
    //    somewhere at least as good to go (a \ wired in the Enter row takes the \ place from a
    //    Backspace that is really half of a split backspace). Keycodes can be remapped, so they
    //    only overrule the wiring when they leave little doubt (see `leaves`).
    const byId = new Map();
    slotOf.forEach((id, k) => byId.set(id, k));
    const NEEDS = { bs2: 'bs', iso: 'lsft' };
    const SLOT = new Map(ROWS.flatMap((r, ri) => r.map((s) => [s.id, { s, ri }])));
    const fits = (k, id) => {
      const { s, ri } = SLOT.get(id);
      const i = s.like.indexOf(k.code);
      if (k.code === TRNS && ri !== k.prow) return 0;
      return s.code === k.code ? 3 : i >= 0 ? Math.max(1, 2 - 0.3 * i) : 0;
    };
    const value = (k, id) => {
      if (!id) return 0;
      const f = fits(k, id);
      const { s, ri } = SLOT.get(id);
      return f ? 2 * f + s.skip / 2 + (ri === k.prow ? 0.5 : 0) : 0;
    };
    const move = (k, id) => {
      const was = slotOf.get(k);
      if (was && byId.get(was) === k) byId.delete(was);
      slotOf.set(k, id);
      byId.set(id, k);
    };
    const usable = (id, without) => !NEEDS[id] || (byId.has(NEEDS[id]) && byId.get(NEEDS[id]) !== without);
    // letters and other keys with a place of their own were placed by position (a Colemak F sits
    // where QWERTY has E); they only move into their own empty place
    const coded = (id) => SLOT.get(id).s.code != null;
    // A key placed in its own matrix row's row of the board leaves it only when its keycode doesn't
    // suit that place, or when it repeats the key it would pair up with: the second Backspace of a
    // split backspace wired where \ usually is. Otherwise the wiring wins. A Backspace on the \ key
    // with ` and \ on the split halves (HHKB-like) looks just like a board wired the other way
    // round, and VIA's list has about three boards with the extra half in the Enter row for each
    // one with it in the \ key's place.
    const leaves = (c, from, to) => {
      const f = fits(c, from), t = fits(c, to);
      if (t <= f) return false;
      const pair = NEEDS[to] && byId.get(NEEDS[to]);
      return !f || !!(pair && pair.code === c.code);
    };
    // the extra half of a pair is only shown next to its main key: a lone key goes to the main
    // place (the top matrix row's key is the left half on most boards, whatever it types)
    const fillMains = () => {
      for (const [extra, main] of Object.entries(NEEDS)) if (byId.has(extra) && !byId.has(main)) move(byId.get(extra), main);
    };
    fillMains();
    for (let round = 0; round < 12; round++) {
      let best = null, gain = 0.01;
      for (const k of keys) {
        if (k.anchor) continue;
        const cur = slotOf.get(k);
        if (cur && (value(k, cur) || coded(cur))) continue; // already somewhere that suits it
        const cost = cur ? 0.5 : 0;
        for (const id of SLOT.keys()) {
          const v = value(k, id);
          if (!v || id === cur || !usable(id, k)) continue;
          const c = byId.get(id);
          if (!c) { if (v - cost > gain) { gain = v - cost; best = [[k, id]]; } continue; }
          if (c.anchor || coded(id)) continue;
          // the key there moves to k's old place or to an empty one: within its row, or to another
          // row only where it clearly belongs (a second Backspace from the \ place to a split backspace)
          for (const dest of [cur, ...[...SLOT.keys()].filter((d) => !byId.has(d))]) {
            if (!dest || dest === id || !usable(dest, c)) continue;
            const v2 = value(c, dest);
            const sameRow = SLOT.get(dest).ri === SLOT.get(id).ri;
            if (sameRow ? !v2 && dest !== cur : !leaves(c, id, dest)) continue;
            const g = v + v2 - value(c, id) - cost - 0.5;
            if (g > gain) { gain = g; best = [[c, dest], [k, id]]; }
          }
        }
      }
      if (!best) break;
      if (best.length === 2 && best[0][1] === slotOf.get(best[1][0])) { // a straight swap
        const [[c, a], [k, b]] = best;
        byId.set(a, c); byId.set(b, k); slotOf.set(c, a); slotOf.set(k, b);
      } else best.forEach(([key, id]) => move(key, id));
    }
    fillMains();
    // a right-hand column wired one matrix row down (common where a split backspace fills the top
    // row): the top key comes from the bottom matrix row and the others each from the row below
    const rc = ['r0', 'r1', 'r2', 'r3'].map((id) => byId.get(id));
    if (rc.every(Boolean) && rc.every((k) => k.col === rc[0].col) && rc[0].prow === 4 && rc[1].prow === 1 && rc[2].prow === 2 && rc[3].prow === 3) {
      ['r0', 'r1', 'r2', 'r3'].forEach((id, i) => { byId.set(id, rc[(i + 1) % 4]); slotOf.set(rc[(i + 1) % 4], id); });
    }
    // no arrows: a 60%. The key right of Backspace is its other half, the one right of Right Shift
    // a split right shift, and nothing else has a right-hand column.
    const sixty = !['up', 'left', 'down', 'rght'].some((id) => byId.has(id));
    if (sixty) {
      if (byId.has('r0') && !byId.has('bs2')) move(byId.get('r0'), 'bs2');
      ['r0', 'r1', 'r2'].forEach((id) => { if (byId.has(id)) { slotOf.delete(byId.get(id)); byId.delete(id); } });
      if (byId.has('r3') && !byId.has('rsft')) move(byId.get('r3'), 'rsft');
    } else if (byId.has('bs') && !byId.has('bs2')) {
      // a key nothing explains (remapped to a letter or a macro...) wired after every pinned key of the
      // \ or Enter row: on most 65% boards that is the other half of a split backspace
      const lastPin = (k) => keys.every((q) => q.row !== k.row || !q.anchor || q.col < k.col);
      const loose = keys.filter((k) => !slotOf.has(k) && (k.prow === 1 || k.prow === 2) && lastPin(k));
      if (loose.length === 1) move(loose[0], 'bs2');
    }
    const left = keys.filter((k) => !slotOf.has(k));

    // 4. geometry
    const out = [];
    const put = (id, x, y, w = 1, opt) => { const k = byId.get(id); if (k) out.push({ k, x, y, w, opt }); };
    const labels = [], defaults = [];
    put('esc', 0, 0);
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'mins', 'eql'].forEach((id, i) => put(id, 1 + i, 0));
    if (byId.has('bs2')) {
      const g = labels.push('Split Backspace') - 1;
      put('bs', 13, 0, 2, [g, 0]); put('bs', 13, 0, 1, [g, 1]); put('bs2', 14, 0, 1, [g, 1]);
      const a = byId.get('bs').code, b = byId.get('bs2').code;
      defaults.push(a !== b && a !== TRNS && b !== TRNS ? 1 : 0);
    } else put('bs', 13, 0, 2);
    put('r0', 15, 0);
    put('tab', 0, 1, 1.5);
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'lbrc', 'rbrc'].forEach((id, i) => put(id, 1.5 + i, 1));
    put('bsls', 13.5, 1, 1.5); put('r1', 15, 1);
    put('caps', 0, 2, 1.75);
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'scln', 'quot'].forEach((id, i) => put(id, 1.75 + i, 2));
    put('ent', 12.75, 2, 2.25); put('r2', 15, 2);
    if (byId.has('iso')) {
      const g = labels.push('Split Left Shift') - 1;
      put('lsft', 0, 3, 2.25, [g, 0]); put('lsft', 0, 3, 1.25, [g, 1]); put('iso', 1.25, 3, 1, [g, 1]);
      const c = byId.get('iso').code;
      defaults.push(c !== TRNS && c !== KC.LSFT ? 1 : 0);
    } else put('lsft', 0, 3, 2.25);
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'comm', 'dot', 'slsh'].forEach((id, i) => put(id, 2.25 + i, 3));
    if (sixty && byId.has('r3')) {
      const g = labels.push('Split Right Shift') - 1;
      put('rsft', 12.25, 3, 2.75, [g, 0]); put('rsft', 12.25, 3, 1.75, [g, 1]); put('r3', 14, 3, 1, [g, 1]);
      defaults.push(byId.get('r3').code !== TRNS ? 1 : 0);
    } else {
      put('rsft', 12.25, 3, sixty ? 2.75 : 1.75); put('up', 14, 3); put('r3', 15, 3);
    }
    // bottom row: mods either side of the space bar, sized by how many there are
    const lm = ['lctl', 'lgui', 'lalt'].filter((id) => byId.has(id));
    const rm = ['ra', 'rb', 'rc', 'rd'].filter((id) => byId.has(id));
    let lw = lm.length === 3 ? [1.25, 1.25, 1.25] : lm.map(() => 1.5), rw, rEnd;
    if (sixty) { rEnd = 15; rw = rm.map(() => (rm.length >= 4 ? 1.25 : 1.5)); }
    else if (rm.length >= 3) { rEnd = 13; rw = rm.map(() => 1); }
    else {
      rEnd = 12.5; // a gap before the arrows
      rw = rm.map(() => (rm.length === 2 ? 1.25 : 1.5));
      if (lm.length === 3 && rm.length === 1) lw = [1.5, 1, 1.5];
    }
    let x = 0;
    lm.forEach((id, i) => { put(id, x, 4, lw[i]); x += lw[i]; });
    const rStart = rEnd - rw.reduce((a, b) => a + b, 0);
    put('spc', x, 4, Math.max(1, rStart - x));
    let rx = rStart;
    rm.forEach((id, i) => { put(id, rx, 4, rw[i]); rx += rw[i]; });
    put('left', 13, 4); put('down', 14, 4); put('rght', 15, 4);
    left.sort((a, b) => a.row - b.row || a.col - b.col).forEach((k, i) => out.push({ k, x: i, y: 5.5, w: 1 }));

    // 5. as a VIA definition (KLE rows, "row,col" legends, "group,option" for the alternatives)
    const legend = (e) => `${e.k.row},${e.k.col}` + (e.opt ? `\n\n\n${e.opt[0]},${e.opt[1]}` : '');
    // VIA's colours: the most common one is for letters, then modifiers, then accents
    const colour = (e) => {
      const id = slotOf.get(e.k);
      if (id === 'esc' || id === 'ent') return '#777777';
      return id && (/^[A-Z0-9]$/.test(id) || ['mins', 'eql', 'lbrc', 'rbrc', 'scln', 'quot', 'comm', 'dot', 'slsh', 'spc'].includes(id)) ? '#cccccc' : '#aaaaaa';
    };
    const keymap = [];
    let yAt = 0, c = null;
    for (const y of [...new Set(out.map((e) => e.y))].sort((a, b) => a - b)) {
      const row = [];
      let cursor = 0;
      out.filter((e) => e.y === y).sort((a, b) => a.x - b.x).forEach((e, i) => {
        const p = {};
        if (colour(e) !== c) { c = colour(e); p.c = c; }
        if (i === 0 && y !== yAt) p.y = y - yAt;
        if (e.x !== cursor) p.x = +(e.x - cursor).toFixed(4);
        if (e.w !== 1) p.w = e.w;
        if (Object.keys(p).length) row.push(p);
        row.push(legend(e));
        cursor = e.x + e.w;
      });
      keymap.push(row);
      yAt = y + 1;
    }
    const placed = new Map();
    slotOf.forEach((id, k) => placed.set(`${k.row},${k.col}`, id));
    const extras = left.length;
    const ok = anchors >= 25 && extras <= 3 && keys.length >= 50 && (keys.length - extras) / keys.length >= 0.94;
    const size = sixty ? '60%' : '65%';
    return {
      ok, size, placed, extras, keys: keys.length, anchors,
      json: {
        name, vendorId, productId, matrix: { rows, cols },
        generic: { size, version: VERSION, defaults, extras, source: { l0, present } },
        layouts: { labels, keymap },
      },
    };
  }

  window.GenericLayout = { fit, basic, VERSION };
})();
