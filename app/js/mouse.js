/* Local Keymap - the Mouse tab: status, CPI, polling rate, sensor, buttons, click filters and power settings of
 * Endgame Gear 4K mice (driver in endgame.js). Changes are collected here and written together with "Save to
 * mouse", as the official tool's Apply does; then the settings are read back from the mouse. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const E = window.EndgameMouse;
  const MODELS = { 0x1982: 'XM2w 4k v2' };
  const DEFAULT_BUTTONS = [[0x00, 0x01], [0x00, 0x02], [0x00, 0x04], [0x00, 0x08], [0x00, 0x10], [0x09, 0xf1], [0x01, 0x01], [0x01, 0xff]];
  const BATTERY_EVERY = 60000;

  const M = { dev: null, saved: null, edit: null, busy: false, asleep: false, capture: -1, xy: false, battTimer: null };
  const kc = new Keycodes(12);
  const toast = (...a) => window.App.toast(...a);
  const icon = (id, cls = 's18') => `<svg class="icon ${cls}"><use href="#i-${id}"/></svg>`;
  const keyName = (u) => { const d = kc.describe(u); return Keycodes.oneLine(d.label || '') || d.name.replace(/^KC_/, ''); };
  const tabActive = () => window.App.isTabActive('mouse');

  // ------------------------------------------------------------------ small DOM helpers
  function h(tag, props = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c); });
    return e;
  }
  function card(iconId, title) {
    const head = h('h3', { class: 't-title-medium', html: icon(iconId) });
    head.append(h('span', { text: title }));
    return h('section', { class: 'ms-card' }, head);
  }
  function row(label, sub, ...controls) {
    return h('div', { class: 'ms-row' }, h('div', { class: 'ms-label' }, h('span', { text: label }), sub ? h('span', { class: 'ms-sub', text: sub }) : null), ...controls);
  }
  function toggle(id, checked, onChange, disabled) {
    const input = h('input', { type: 'checkbox', id, role: 'switch' });
    input.checked = !!checked;
    input.disabled = !!disabled;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' + (disabled ? ' off' : '') }, input, h('span', { class: 'track' }));
  }
  function choose(id, options, value, onChange, disabled) {
    const s = h('select', { id });
    options.forEach(([v, t]) => s.appendChild(h('option', { value: String(v), text: t })));
    s.value = String(value);
    s.disabled = !!disabled;
    s.addEventListener('change', () => onChange(s.value));
    return h('label', { class: 'field small ms-select' }, s);
  }
  function numberBox(id, min, max, step, value, onChange, disabled, label) {
    const i = h('input', { type: 'number', id, min, max, step });
    i.value = value;
    i.disabled = !!disabled;
    i.addEventListener('change', () => onChange(Number(i.value)));
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
    return h('label', { class: 'field small ms-num' }, label ? h('span', { class: 'field-label', text: label }) : null, i);
  }
  /** a slider with its number: moving it updates the number, letting go commits */
  function slider(id, min, max, value, onChange, disabled, fmt = String) {
    const r = h('input', { type: 'range', id, min, max, step: 1, class: 'ms-range' });
    r.value = value;
    r.disabled = !!disabled;
    const out = h('span', { class: 'ms-value', text: fmt(Number(value)) });
    r.addEventListener('input', () => { out.textContent = fmt(Number(r.value)); });
    r.addEventListener('change', () => onChange(Number(r.value)));
    return h('span', { class: 'ms-slider' }, r, out);
  }

  // ------------------------------------------------------------------ CPI slider: 10-10000 in steps of 10, then up to 30000 in steps of 50
  const cpiToPos = (v) => (v <= 10000 ? Math.round(v / 10) : 1000 + Math.round((v - 10000) / 50));
  const posToCpi = (p) => (p <= 1000 ? p * 10 : 10000 + (p - 1000) * 50);

  // ------------------------------------------------------------------ editing
  function change(fn) {
    if (!M.edit || M.busy) return;
    fn(M.edit);
    render();
  }
  const pending = () => (M.saved && M.edit ? M.edit.changedSections(M.saved) : []);

  function loadDefaults() {
    M.xy = false;
    change((s) => {
      s.glass = false;
      s.polling = 0x02;
      s.motionSync = false;
      s.lod = 3;
      s.angleSnap = false; s.ripple = false; s.angleTune = 0; s.liftLed = true;
      s.setFlag('slamclick', true); s.setFlag('filtersUnlocked', false); s.setFlag('maxFps', false);
      s.setTimer('powerSave', true, 1); s.setTimer('deepSleep', true, 3);
      [400, 800, 1600, 3200].forEach((v, i) => s.setCpi(i, v));
      s.cpiCount = 4; s.cpiCurrent = 1;
      DEFAULT_BUTTONS.forEach(([type, code], i) => s.setButton(i, { type, code }));
      for (let i = 0; i < 5; i++) s.setFilter(i, 8);
    });
    toast('Default settings loaded. Click Save to mouse to write them.', 'info', 6000);
  }

  // ------------------------------------------------------------------ cards
  function statusCard() {
    const i = M.dev.info;
    const c = card('mouse', `Endgame Gear ${MODELS[i.mouseId] || 'mouse'}`);
    c.classList.add('ms-wide');
    const stat = (label, value, sub) => h('div', { class: 'ms-stat' }, h('span', { class: 'ms-sub', text: label }), h('span', { class: 'v', text: value }), sub ? h('span', { class: 'ms-sub', text: sub }) : null);
    const batt = i.battery == null ? '—' : `${i.battery}%`;
    const battSub = i.battery == null ? '' : i.wireless ? '' : i.battery < 100 ? 'charging' : 'full';
    const refresh = h('button', { class: 'btn text', title: 'Read the battery and settings from the mouse again', html: `${icon('refresh')}<span>Refresh</span>`, onclick: () => refresh() });
    const defaults = h('button', { class: 'btn text', title: 'Load the factory settings into the editor (written when you save)', html: `${icon('restore')}<span>Defaults</span>`, onclick: loadDefaults });
    refresh.disabled = defaults.disabled = M.busy;
    c.append(h('div', { class: 'ms-stats' },
      stat('Connection', i.wireless ? 'Wireless' : 'Cable', i.wireless ? '4K dongle' : 'USB'),
      stat('Battery', batt, battSub),
      stat('Mouse firmware', i.firmware || '—'),
      i.wireless ? stat('Dongle firmware', i.dongleFirmware || '—') : null,
      h('span', { class: 'spacer' }),
      defaults, refresh));
    return c;
  }

  function cpiCard() {
    const s = M.edit;
    const c = card('target', 'CPI');
    const count = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Number of CPI levels' });
    [1, 2, 3, 4].forEach((n) => count.appendChild(h('button', { class: n === s.cpiCount ? 'active' : '', text: String(n), onclick: () => change((x) => { x.cpiCount = n; }) })));
    c.append(row('CPI levels', 'The CPI button on the bottom steps through them', count));
    c.append(row('Different X and Y', 'Set the vertical CPI separately', toggle('ms-xy', M.xy, (on) => {
      M.xy = on;
      if (!on) change((x) => { for (let i = 0; i < 4; i++) { const { x: cx } = x.cpi(i); x.setCpi(i, cx, cx); } });
      else render();
    })));
    for (let i = 0; i < s.cpiCount; i++) {
      const { x, y } = s.cpi(i);
      const active = i === s.cpiCurrent;
      const radio = h('button', { class: 'ms-level' + (active ? ' active' : ''), title: active ? 'The mouse uses this level now' : 'Use this level now', text: String(i + 1), onclick: () => change((v) => { v.cpiCurrent = i; }) });
      const line = (axis, val, set) => h('div', { class: 'ms-cpi-line' },
        M.xy ? h('span', { class: 'ms-axis', text: axis }) : null,
        slider(`ms-cpi${i}${axis}`, 1, 1400, cpiToPos(val), (p) => change((v) => set(v, posToCpi(p))), false, (p) => String(posToCpi(p))),
        numberBox(`ms-cpin${i}${axis}`, E.CPI_MIN, E.CPI_MAX, 10, val, (n) => change((v) => set(v, n))));
      const lines = [line('X', x, (v, n) => { const c2 = v.cpi(i); v.setCpi(i, n, M.xy ? c2.y : n); })];
      if (M.xy) lines.push(line('Y', y, (v, n) => { const c2 = v.cpi(i); v.setCpi(i, c2.x, n); }));
      c.append(h('div', { class: 'ms-cpi' + (active ? ' active' : '') }, radio, h('div', { class: 'ms-cpi-lines' }, lines)));
    }
    c.append(h('p', { class: 'ms-sub ms-foot', text: `${E.CPI_MIN}–${E.CPI_MAX} CPI: steps of 10 up to 10000, then steps of 50. The highlighted level is the one in use.` }));
    return c;
  }

  function sensorCard() {
    const s = M.edit, i = M.dev.info;
    const c = card('speed', 'Polling rate and sensor');
    const pollFixed = !i.wireless || s.glass;
    const pollNote = !i.wireless ? 'On the cable the mouse reports at 1000 Hz. This is the wireless rate.'
      : s.glass ? 'Glass mode runs at 1000 Hz.' : 'Higher rates use more battery';
    const polls = E.POLLING.map(([v, t]) => [v, t]);
    if (!polls.some(([v]) => v === s.polling)) polls.push([s.polling, `Unknown (0x${s.polling.toString(16)})`]);
    c.append(row('Polling rate', pollNote, choose('ms-poll', polls, s.polling, (v) => change((x) => { x.polling = Number(v); }), pollFixed)));
    c.append(row('Motion sync', 'Lines sensor frames up with USB polls', toggle('ms-msync', s.motionSync, (on) => change((x) => { x.motionSync = on; }))));
    const lods = s.glass ? E.LOD_GLASS : E.LOD.map((t, k) => [k, t]);
    c.append(row('Lift-off distance', null, choose('ms-lod', lods, s.lod, (v) => change((x) => { x.lod = Number(v); }))));
    c.append(row('Sensor glass mode', 'For glass mousepads. Lift-off becomes 1.0 or 2.0 mm', toggle('ms-glass', s.glass, (on) => change((x) => { x.glass = on; }))));
    c.append(row('Angle snapping', 'Straightens slightly wobbly lines', toggle('ms-snap', s.angleSnap, (on) => change((x) => { x.angleSnap = on; }))));
    c.append(row('Ripple control', 'Smooths sensor noise at high CPI', toggle('ms-ripple', s.ripple, (on) => change((x) => { x.ripple = on; }))));
    c.append(row('Force max sensor fps', 'Keeps the sensor at its highest frame rate', toggle('ms-fps', s.flag('maxFps'), (on) => change((x) => { x.setFlag('maxFps', on); }))));
    c.append(row('Sensor angle tuning', 'Rotates the sensor’s axes', slider('ms-angle', -E.ANGLE_MAX, E.ANGLE_MAX, s.angleTune, (v) => change((x) => { x.angleTune = v; }), false, (v) => (v > 0 ? '+' + v : String(v)))));
    c.append(row('Disable LED on lift-off', null, toggle('ms-led', !s.liftLed, (on) => change((x) => { x.liftLed = !on; }))));
    return c;
  }

  // ---- buttons
  const ACTION_OPTIONS = E.ACTIONS.map(([id, label]) => [id, id === 'key' ? 'Keyboard key…' : id === 'fixedCpi' ? 'Fixed CPI…' : label]);
  function actionFor(id, prev) {
    const a = E.ACTIONS.find((x) => x[0] === id);
    if (id === 'key') return { type: 0x02, code: prev.type === 0x02 ? prev.code : 0, value: prev.type === 0x02 ? prev.value : 0, value2: 0 };
    if (id === 'fixedCpi') return { type: 0x0c, code: 0, value: prev.type === 0x0c ? prev.value : 400, value2: prev.type === 0x0c ? prev.value2 : 400 };
    return { type: a[2], code: a[3], value: 0, value2: 0 };
  }

  function buttonRow(idx, fixedNote) {
    const s = M.edit;
    const a = s.button(idx);
    const d = E.describeAction(a, keyName);
    if (fixedNote) return row(E.BUTTONS[idx], fixedNote, h('span', { class: 'ms-fixed', text: d.label }));
    const opts = ACTION_OPTIONS.slice();
    if (d.id === 'other') opts.push(['other', d.label]);
    const sel = choose(`ms-btn${idx}`, opts, d.id, (id) => change((x) => { if (id !== 'other') x.setButton(idx, actionFor(id, x.button(idx))); }));
    const r = row(E.BUTTONS[idx], null, sel);
    if (a.type === 0x02) {
      const extra = h('div', { class: 'ms-extra' });
      const capturing = M.capture === idx;
      extra.append(h('button', {
        class: 'btn tonal' + (capturing ? ' active' : ''),
        html: `${icon('keyboard')}<span>${capturing ? 'Press a key…' : a.value ? keyName(a.value) : 'Choose key'}</span>`,
        title: 'Click, then press the key (with Ctrl, Shift, Alt or Win if you like)',
        onclick: () => { M.capture = capturing ? -1 : idx; render(); },
      }));
      E.MODS.forEach(([bit, name]) => {
        const cb = h('input', { type: 'checkbox', id: `ms-mod${idx}-${bit}` });
        cb.checked = !!(a.code & bit);
        cb.addEventListener('change', () => change((x) => { const b = x.button(idx); x.setButton(idx, { ...b, code: cb.checked ? b.code | bit : b.code & ~bit }); }));
        extra.append(h('label', { class: 'ms-check' }, cb, h('span', { text: name })));
      });
      return h('div', { class: 'ms-group' }, r, extra);
    }
    if (a.type === 0x0c) {
      const extra = h('div', { class: 'ms-extra' },
        numberBox(`ms-fx${idx}`, E.CPI_MIN, E.CPI_MAX, 10, a.value, (n) => change((x) => { const b = x.button(idx); x.setButton(idx, { ...b, value: E.Settings.roundCpi(n) }); }), false, 'X'),
        numberBox(`ms-fy${idx}`, E.CPI_MIN, E.CPI_MAX, 10, a.value2, (n) => change((x) => { const b = x.button(idx); x.setButton(idx, { ...b, value2: E.Settings.roundCpi(n) }); }), false, 'Y'),
        h('span', { class: 'ms-sub', text: 'CPI while the button is held' }));
      return h('div', { class: 'ms-group' }, r, extra);
    }
    return r;
  }

  function buttonsCard() {
    const s = M.edit;
    const c = card('touch', 'Buttons');
    const lh = s.leftHanded;
    c.append(row('Left-handed mode', 'Swaps the left and right buttons', toggle('ms-lefthand', lh, (on) => change((x) => { x.leftHanded = on; }))));
    c.append(lh ? buttonRow(0) : buttonRow(0, 'Always left click'));
    c.append(lh ? buttonRow(1, 'Left click in left-handed mode') : buttonRow(1));
    [2, 4, 3].forEach((i) => c.append(buttonRow(i)));
    c.append(buttonRow(5, 'Steps through the CPI levels'));
    [6, 7].forEach((i) => c.append(buttonRow(i)));
    return c;
  }

  function filtersCard() {
    const s = M.edit;
    const c = card('tune', 'Click filters');
    c.append(row('Slamclick filter', 'Ignores clicks caused by slamming the mouse down', toggle('ms-slam', s.flag('slamclick'), (on) => change((x) => { x.setFlag('slamclick', on); }))));
    const unlocked = s.flag('filtersUnlocked');
    c.append(row('Change multiclick filters', 'They aren’t a debounce delay: lower values don’t make clicks faster, they only let more double clicks through', toggle('ms-unlock', unlocked, (on) => change((x) => { x.setFlag('filtersUnlocked', on); }))));
    const names = ['Left button', 'Right button', 'Middle button', 'Back button', 'Forward button'];
    c.append(h('p', { class: 'ms-sub ms-foot', text: 'Multiclick filter per button, 0–25 on the official tool’s scale. Left and right can use an SPDT switch mode instead.' }));
    [0, 1, 2, 4, 3].forEach((i) => {
      const f = s.filter(i);
      const spdt = i < 2 && (f === 0xf0 || f === 0xf1);
      const controls = [];
      if (i < 2) {
        controls.push(choose(`ms-spdt${i}`, E.SPDT.map(([v, t]) => [v == null ? 'off' : v, t]), spdt ? f : 'off', (v) => change((x) => { x.setFilter(i, v === 'off' ? 8 : Number(v)); }), !unlocked));
      }
      controls.push(slider(`ms-filter${i}`, 0, E.FILTER_MAX, spdt ? 8 : f, (v) => change((x) => { x.setFilter(i, v); }), !unlocked || spdt));
      c.append(row(names[i], null, ...controls));
    });
    return c;
  }

  function powerCard() {
    const s = M.edit;
    const c = card('bolt', 'Power');
    const ps = s.timer('powerSave'), ds = s.timer('deepSleep');
    const forced = s.powerSaveForced;
    c.append(row('Power saving', forced ? 'Always on at this polling rate' : 'Saves battery after this long without use',
      numberBox('ms-psmin', 1, 120, 1, ps.minutes, (n) => change((x) => { const t = x.timer('powerSave'); x.setTimer('powerSave', t.on, n); }), !ps.on && !forced, 'Minutes'),
      toggle('ms-ps', ps.on || forced, (on) => change((x) => { x.setTimer('powerSave', on, x.timer('powerSave').minutes); }), forced)));
    c.append(row('Deep sleep', 'A deeper sleep after a longer time without use',
      numberBox('ms-dsmin', 1, 120, 1, ds.minutes, (n) => change((x) => { const t = x.timer('deepSleep'); x.setTimer('deepSleep', t.on, n); }), !ds.on, 'Minutes'),
      toggle('ms-ds', ds.on, (on) => change((x) => { x.setTimer('deepSleep', on, x.timer('deepSleep').minutes); }))));
    c.append(h('p', { class: 'ms-sub ms-foot', text: 'Times are in minutes of no use, 1–120.' }));
    return c;
  }

  // ------------------------------------------------------------------ rendering
  function render() {
    const connected = !!M.dev;
    $('#msEmpty').classList.toggle('hidden', connected);
    $('#msAsleep').classList.toggle('hidden', !connected || !M.asleep);
    $('#msEditor').classList.toggle('hidden', !connected || M.asleep || !M.edit);
    updateStatus();
    if (!connected || M.asleep || !M.edit) return;

    const focused = document.activeElement && document.activeElement.id;
    const host = $('#msCards');
    host.innerHTML = '';
    host.append(statusCard(), cpiCard(), sensorCard(), buttonsCard(), filtersCard(), powerCard());
    host.classList.toggle('busy', M.busy);
    host.querySelectorAll('input, select, .segmented button, .ms-level').forEach((e) => { if (M.busy) e.disabled = true; });
    if (focused) { const f = document.getElementById(focused); if (f) f.focus(); }

    const p = pending();
    const names = { sensor: 'sensor and CPI', tuning: 'polling, power and click filters', buttons: 'buttons' };
    $('#msBar').classList.toggle('hidden', !p.length && !M.busy);
    if (!M.busy) $('#msBarText').textContent = p.length ? `Not saved yet: ${p.map((x) => names[x]).join(', ')}` : '';
    $('#btnMsSave').disabled = $('#btnMsDiscard').disabled = M.busy || !p.length;
  }

  function updateStatus() {
    const btn = $('#btnMsConnect');
    btn.className = `btn ms-only ${M.dev ? 'outlined' : 'filled'}`;
    btn.querySelector('span').textContent = M.dev ? 'Disconnect' : 'Connect mouse';
    const st = $('#msStatus');
    if (!M.dev) { st.textContent = 'No mouse connected'; return; }
    const i = M.dev.info;
    if (M.asleep) { st.textContent = `${M.dev.name} · mouse not answering`; return; }
    const parts = [`Endgame Gear ${MODELS[i.mouseId] || 'mouse'}`, i.wireless ? 'wireless' : 'cable'];
    if (i.battery != null) parts.push(`battery ${i.battery}%${!i.wireless && i.battery < 100 ? ' (charging)' : ''}`);
    if (i.firmware) parts.push(`firmware ${i.firmware}`);
    st.textContent = parts.join(' · ');
  }

  // ------------------------------------------------------------------ connection
  async function connectClicked() {
    if (M.dev) { await detach(); return; }
    if (!('hid' in navigator)) { toast('Device access (WebHID) is not available here. Use the Local Keymap desktop app.', 'error', 8000); return; }
    try {
      window.App.pickerFor = 'mouse';
      const devs = await navigator.hid.requestDevice({ filters: [E.FILTER_DONGLE, E.FILTER_WIRED] });
      const d = devs.find((x) => E.isEndgame(x));
      if (d) await attach(d);
    } catch (e) {
      if (e.name !== 'NotFoundError') toast(e.message, 'error');
    } finally {
      window.App.pickerFor = 'keyboard';
    }
  }

  async function attach(hid, opts) {
    await detach();
    // on Windows the real mouse is reached through Windows' own HID calls (WebHID can refuse it there)
    const bridge = window.localKeymap && window.localKeymap.mouseHid;
    const real = typeof HIDDevice !== 'undefined' && hid instanceof HIDDevice;
    const dev = new E(bridge && real ? E.windowsTransport(hid, bridge) : hid, opts);
    M.dev = dev;
    M.busy = true;
    $('#msStatus').textContent = `Connecting to ${dev.name}…`;
    try {
      await dev.open();
      M.asleep = !dev.info.linked;
      if (dev.settings) useSettings(dev.settings);
    } catch (e) {
      if (M.dev !== dev) return;
      if (e.asleep) M.asleep = true;
      else {
        console.error(e);
        toast(e.transport ? `${e.message}.` : `${dev.name} did not answer as expected (${e.message}).`, 'error', 8000);
        M.busy = false;
        await detach();
        return;
      }
    } finally {
      if (M.dev === dev) M.busy = false;
    }
    render();
    startBatteryTimer();
  }

  async function detach() {
    if (!M.dev) return;
    const dev = M.dev;
    Object.assign(M, { dev: null, saved: null, edit: null, busy: false, asleep: false, capture: -1 });
    clearInterval(M.battTimer);
    render();
    await dev.close();
  }

  function useSettings(s) {
    M.saved = s;
    M.edit = s.clone();
    M.xy = [0, 1, 2, 3].some((i) => { const c = s.cpi(i); return c.x !== c.y; });
  }

  /** Battery, versions and settings again (also wakes the page up after the mouse slept). */
  async function refresh() {
    if (!M.dev || M.busy) return;
    if (pending().length && !await window.App.ask('Discard unsaved changes?', 'Reading the settings from the mouse again replaces the changes you haven’t saved.', 'Discard')) return;
    M.busy = true; render();
    try {
      await M.dev.refreshInfo();
      M.asleep = !M.dev.info.linked;
      if (!M.asleep) useSettings(await M.dev.readSettings());
    } catch (e) {
      if (e.asleep) M.asleep = true;
      else toast('Could not read the mouse: ' + e.message, 'error', 7000);
    } finally {
      M.busy = false;
      render();
    }
  }

  async function save() {
    if (!M.dev || M.busy) return;
    const wanted = M.edit;
    const p = wanted.changedSections(M.saved);
    if (!p.length) return;
    M.busy = true; render();
    try {
      const { settings } = await M.dev.writeSettings(wanted, (n, total) => { $('#msBarText').textContent = `Saving ${n} of ${total}…`; });
      const notTaken = wanted.changedSections(settings);
      useSettings(settings);
      if (notTaken.length) toast(`Saved, but the mouse kept different values for: ${notTaken.join(', ')}.`, 'error', 9000);
      else toast('Saved to the mouse.', 'ok');
    } catch (e) {
      console.error(e);
      toast(e.asleep ? 'The mouse is asleep. Move it to wake it up, then save again.' : 'Could not save: ' + e.message, 'error', 8000);
    } finally {
      M.busy = false;
      render();
    }
  }

  function startBatteryTimer() {
    clearInterval(M.battTimer);
    M.battTimer = setInterval(async () => {
      if (!M.dev || M.busy || M.asleep || !tabActive() || document.hidden) return;
      try { await M.dev.refreshBattery(); updateStatus(); const b = document.querySelector('#msCards .ms-stat:nth-child(2) .v'); if (b) b.textContent = `${M.dev.info.battery}%`; }
      catch (_) { /* asleep or busy; shown on the next refresh */ }
    }, BATTERY_EVERY);
  }

  /** "Press a key" for a keyboard-key button: the key and any held modifiers. */
  function onKeyDown(e) {
    if (M.capture < 0 || !tabActive() || !M.edit) return;
    if (['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
    e.preventDefault();
    if (e.code === 'Escape' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) { M.capture = -1; render(); return; }
    const name = Keycodes.EVENT_TO_KC[e.code];
    let usage = null;
    try { usage = name ? kc.parse(name) : null; } catch (_) { usage = null; }
    if (usage == null || usage < 0x04 || usage > 0xa4) { toast(`"${e.code || e.key}" can't be sent by the mouse.`); return; }
    const mods = (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    const idx = M.capture;
    M.capture = -1;
    change((x) => x.setButton(idx, { type: 0x02, code: mods, value: usage, value2: 0 }));
  }

  function init() {
    $('#btnMsConnect').addEventListener('click', connectClicked);
    $('#btnMsConnect2').addEventListener('click', connectClicked);
    $('#btnMsDemo').addEventListener('click', () => attach(MockMouse.create(), { timeScale: 0.15 }));
    $('#btnMsRetry').addEventListener('click', refresh);
    $('#btnMsSave').addEventListener('click', save);
    $('#btnMsDiscard').addEventListener('click', () => { if (M.saved) { useSettings(M.saved); render(); } });
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('lk:tab', () => { if (!tabActive() && M.capture >= 0) { M.capture = -1; render(); } });
    if ('hid' in navigator) {
      navigator.hid.addEventListener('disconnect', (e) => { if (M.dev && e.device === (M.dev.hid.device || M.dev.hid)) { toast(`${M.dev.name} was unplugged.`); detach(); } });
      navigator.hid.addEventListener('connect', (e) => { if (!M.dev && E.isEndgame(e.device)) attach(e.device); });
      navigator.hid.getDevices().then((ds) => { const d = ds.find((x) => E.isEndgame(x)); if (d && !M.dev) attach(d); });
    }
    render();
  }

  window.MouseTab = { state: M, attach, detach, refresh, save, render };
  document.addEventListener('DOMContentLoaded', init);
})();
