/* Local Keymap - key tester.
 * "Any keyboard" mode listens to browser key events on a full-size ANSI layout.
 * "Switch matrix" mode polls a VIA keyboard's raw switch matrix, so it also sees Fn and remapped keys.
 * "Polling rate" mode reads each USB keyboard's polling rate from its descriptors (desktop app on
 * Windows/Linux) and measures it from key presses (any keyboard, see polling.js).
 * "Mouse" mode shows which mouse buttons and wheel directions work, and counts presses that come too
 * soon after the last release of the same button (a worn switch that double-clicks). */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);

  // ---------------------------------------------------------------- full-size ANSI layout
  const K = (code, label = code, w = 1, h = 1) => ({ code, label, w, h });
  const G = (gap) => ({ gap });
  const ROWS = [
    [0, [K('Escape', 'Esc'), G(1), K('F1'), K('F2'), K('F3'), K('F4'), G(0.5), K('F5'), K('F6'), K('F7'), K('F8'), G(0.5),
      K('F9'), K('F10'), K('F11'), K('F12'), G(0.25), K('PrintScreen', 'PrtSc'), K('ScrollLock', 'ScrLk'), K('Pause')]],
    [1.25, [K('Backquote', '~\n`'), K('Digit1', '!\n1'), K('Digit2', '@\n2'), K('Digit3', '#\n3'), K('Digit4', '$\n4'), K('Digit5', '%\n5'),
      K('Digit6', '^\n6'), K('Digit7', '&\n7'), K('Digit8', '*\n8'), K('Digit9', '(\n9'), K('Digit0', ')\n0'), K('Minus', '_\n-'),
      K('Equal', '+\n='), K('Backspace', 'Backspace', 2), G(0.25), K('Insert', 'Ins'), K('Home'), K('PageUp', 'PgUp'), G(0.25),
      K('NumLock', 'Num\nLock'), K('NumpadDivide', '/'), K('NumpadMultiply', '*'), K('NumpadSubtract', '-')]],
    [2.25, [K('Tab', 'Tab', 1.5), ...'QWERTYUIOP'.split('').map((c) => K('Key' + c, c)), K('BracketLeft', '{\n['), K('BracketRight', '}\n]'),
      K('Backslash', '|\n\\', 1.5), G(0.25), K('Delete', 'Del'), K('End'), K('PageDown', 'PgDn'), G(0.25),
      K('Numpad7', '7'), K('Numpad8', '8'), K('Numpad9', '9'), K('NumpadAdd', '+', 1, 2)]],
    [3.25, [K('CapsLock', 'Caps Lock', 1.75), ...'ASDFGHJKL'.split('').map((c) => K('Key' + c, c)), K('Semicolon', ':\n;'), K('Quote', '"\n\''),
      K('Enter', 'Enter', 2.25), G(3.5), K('Numpad4', '4'), K('Numpad5', '5'), K('Numpad6', '6')]],
    [4.25, [K('ShiftLeft', 'Shift', 2.25), ...'ZXCVBNM'.split('').map((c) => K('Key' + c, c)), K('Comma', '<\n,'), K('Period', '>\n.'),
      K('Slash', '?\n/'), K('ShiftRight', 'Shift', 2.75), G(1.25), K('ArrowUp', '↑'), G(1.25),
      K('Numpad1', '1'), K('Numpad2', '2'), K('Numpad3', '3'), K('NumpadEnter', 'Enter', 1, 2)]],
    [5.25, [K('ControlLeft', 'Ctrl', 1.25), K('MetaLeft', 'Win', 1.25), K('AltLeft', 'Alt', 1.25), K('Space', '', 6.25),
      K('AltRight', 'Alt', 1.25), K('MetaRight', 'Win', 1.25), K('ContextMenu', 'Menu', 1.25), K('ControlRight', 'Ctrl', 1.25), G(0.25),
      K('ArrowLeft', '←'), K('ArrowDown', '↓'), K('ArrowRight', '→'), G(0.25), K('Numpad0', '0', 2), K('NumpadDecimal', '.')]],
  ];
  const MODS = new Set(['Escape', 'Tab', 'CapsLock', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight',
    'AltLeft', 'AltRight', 'ContextMenu', 'Backspace', 'Enter', 'NumpadEnter']);
  const LAYOUT = [];
  ROWS.forEach(([y, items]) => {
    let x = 0;
    items.forEach((it) => {
      if (it.gap) { x += it.gap; return; }
      LAYOUT.push({ x, y, w: it.w, h: it.h, id: it.code, label: it.label, color: MODS.has(it.code) ? 'mod' : 'alpha' });
      x += it.w;
    });
  });

  // ---------------------------------------------------------------- state
  const T = {
    mode: 'browser',
    pressed: new Set(), tested: new Set(), counts: new Map(), extras: new Map(), log: [],
    els: new Map(),
    matrix: { running: false, keys: [], els: [], tested: new Set(), errors: 0, scans: 0, since: 0, last: null },
    poll: { times: [], usb: null, scanning: false, raf: 0 },
    mouse: { pressed: new Set(), tested: new Set(), counts: {}, fast: {}, lastUp: {} },
  };

  const App = () => window.App;
  const active = () => App() && App().isTabActive('tester');
  const matrixReady = () => { const S = App().state; return !!(S.dev && S.def && S.keymap); };

  // ---------------------------------------------------------------- rendering
  function render() {
    stopMatrix();
    const host = $('#testerBoard');
    T.els.clear();
    $('#tab-tester').dataset.mode = T.mode;
    if (T.mode === 'polling') {
      renderPolling();
    } else if (T.mode === 'mouse') {
      renderMouse();
    } else if (T.mode === 'browser') {
      const els = Board.render(host, LAYOUT, { maxUnit: 50 });
      els.forEach((el, i) => {
        const k = LAYOUT[i];
        Board.setLabel(el, k.label);
        el.title = k.id;
        T.els.set(k.id, el);
      });
      T.pressed.forEach((c) => paint(c));
      T.tested.forEach((c) => paint(c));
      $('#testerHint').textContent = 'Press keys on any keyboard. Keys fill in while held and stay tinted once tested. Fn and some media keys never reach the browser; use the switch matrix test for those.';
    } else if (!matrixReady()) {
      host.innerHTML = '<div class="empty small"><p>Connect a VIA keyboard to test its switch matrix.</p></div>';
      $('#testerHint').textContent = 'The switch matrix test reads which physical switches are closed, straight from the firmware.';
    } else {
      startMatrix();
    }
    renderInfo();
  }

  function paint(code) {
    const el = T.els.get(code);
    if (!el) return;
    el.classList.toggle('pressed', T.pressed.has(code));
    el.classList.toggle('tested', T.tested.has(code));
    const n = T.counts.get(code) || 0;
    el.dataset.count = n > 1 ? String(n) : '';
  }

  function renderInfo() {
    if (T.mode === 'polling') { $('#testerCount').textContent = ''; return; }
    const browser = T.mode === 'browser', mouse = T.mode === 'mouse';
    const total = mouse ? MOUSE_PARTS.length : browser ? LAYOUT.length : T.matrix.keys.filter((k) => k.row >= 0).length;
    const tested = mouse ? T.mouse.tested.size : browser ? LAYOUT.filter((k) => T.tested.has(k.id)).length : T.matrix.tested.size;
    $('#testerCount').textContent = total ? `${tested} / ${total} ${mouse ? 'buttons' : 'keys'} tested` : '';
    $('#testerLast').classList.toggle('hidden', !browser);
    $('#testerExtrasWrap').classList.toggle('hidden', !browser || !T.extras.size);
    const ex = $('#testerExtras');
    ex.innerHTML = '';
    T.extras.forEach((n, code) => {
      const s = document.createElement('span');
      s.className = 'chip' + (T.pressed.has(code) ? ' on' : '');
      s.textContent = n > 1 ? `${code} ×${n}` : code;
      ex.appendChild(s);
    });
    const log = $('#testerLog');
    log.innerHTML = '';
    T.log.forEach((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      log.appendChild(li);
    });
  }

  function addLog(line) {
    T.log.unshift(line);
    if (T.log.length > 14) T.log.length = 14;
  }

  // ---------------------------------------------------------------- browser events
  function onDown(e) {
    if (active() && T.mode === 'polling') { onPollKey(e); return; }
    if (!active() || T.mode !== 'browser') return;
    e.preventDefault();
    const code = e.code || `key:${e.key}`;
    if (!e.repeat) {
      T.counts.set(code, (T.counts.get(code) || 0) + 1);
      if (!T.els.has(code)) T.extras.set(code, (T.extras.get(code) || 0) + 1);
      addLog(`↓ ${code}   key "${e.key}"   keyCode ${e.keyCode}${e.location ? `   location ${e.location}` : ''}`);
    }
    T.pressed.add(code);
    T.tested.add(code);
    paint(code);
    $('#lastKey').textContent = e.key === ' ' ? 'Space' : e.key;
    $('#lastCode').textContent = code;
    $('#lastKeyCode').textContent = String(e.keyCode);
    renderInfo();
  }

  function onUp(e) {
    if (active() && T.mode === 'polling') { onPollKey(e); return; }
    if (!active() || T.mode !== 'browser') return;
    e.preventDefault();
    const code = e.code || `key:${e.key}`;
    // Windows only sends keyup for PrintScreen, so count it here.
    if (!T.pressed.has(code)) {
      T.counts.set(code, (T.counts.get(code) || 0) + 1);
      if (!T.els.has(code)) T.extras.set(code, (T.extras.get(code) || 0) + 1);
      addLog(`↓ ${code}   (release only)`);
    }
    T.pressed.delete(code);
    T.tested.add(code);
    addLog(`↑ ${code}`);
    paint(code);
    renderInfo();
  }

  function releaseAll() {
    const codes = [...T.pressed];
    T.pressed.clear();
    codes.forEach(paint);
    renderInfo();
  }

  function reset() {
    T.pressed.clear(); T.tested.clear(); T.counts.clear(); T.extras.clear(); T.log = [];
    T.matrix.tested.clear();
    T.poll.times = [];
    T.mouse = { pressed: new Set(), tested: new Set(), counts: {}, fast: {}, lastUp: {} };
    ['lastKey', 'lastCode', 'lastKeyCode'].forEach((id) => { $('#' + id).textContent = '-'; });
    render();
  }

  // ---------------------------------------------------------------- switch matrix (VIA)
  function startMatrix() {
    const S = App().state;
    const M = T.matrix;
    M.keys = App().visibleKeys();
    M.els = Board.render($('#testerBoard'), M.keys, { maxUnit: 56 });
    M.keys.forEach((k, i) => {
      const el = M.els[i];
      if (k.row < 0) { Board.setLabel(el, 'Knob'); el.classList.add('none'); return; }
      Board.setLabel(el, S.kc.label(S.keymap[0][k.row * S.def.cols + k.col]));
      el.title = `matrix ${k.row},${k.col}`;
      el.classList.toggle('tested', M.tested.has(k.row * S.def.cols + k.col));
    });
    $('#testerHint').textContent = 'Press keys on the connected keyboard. This reads the physical switches, so Fn and layer keys show up too. If nothing lights up, the firmware may not expose its matrix to VIA (some builds disable it for security).';
    M.running = true; M.errors = 0; M.scans = 0; M.since = performance.now(); M.last = null;
    tick();
  }

  async function tick() {
    const M = T.matrix;
    if (!M.running) return;
    const S = App().state;
    try {
      const bytes = await S.dev.getMatrixState(S.def.rows, S.def.cols);
      if (!M.running) return;
      applyMatrix(bytes);
      M.errors = 0;
      M.scans++;
    } catch (e) {
      if (e.unhandled || ++M.errors > 5) {
        M.running = false;
        $('#testerBoard').insertAdjacentHTML('afterbegin', `<div class="banner">Switch matrix test stopped: ${e.unhandled ? 'this firmware does not support it.' : e.message}</div>`);
        return;
      }
    }
    const secs = (performance.now() - M.since) / 1000;
    if (secs > 1) $('#testerRate').textContent = `${Math.round(M.scans / secs)} scans/s`;
    setTimeout(tick, 15);
  }

  function applyMatrix(bytes) {
    const S = App().state, M = T.matrix;
    const { rows, cols } = S.def;
    const down = App().decodeMatrix(bytes, rows, cols);
    const sig = [...down].join(',');
    if (sig === M.last) return;
    const prev = new Set(M.last ? M.last.split(',').filter(Boolean).map(Number) : []);
    M.last = sig;
    down.forEach((idx) => { if (!prev.has(idx)) addLog(`↓ matrix ${Math.floor(idx / cols)},${idx % cols}`); M.tested.add(idx); });
    M.keys.forEach((k, i) => {
      if (k.row < 0) return;
      const idx = k.row * cols + k.col;
      M.els[i].classList.toggle('pressed', down.has(idx));
      M.els[i].classList.toggle('tested', M.tested.has(idx));
    });
    renderInfo();
  }

  // ---------------------------------------------------------------- polling rate
  const SPEED = { low: 'Low-speed', full: 'Full-speed', high: 'High-speed', super: 'SuperSpeed' };
  const ms = (v) => `${+v.toFixed(3)} ms`;
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  function renderPolling() {
    $('#testerBoard').innerHTML = `
      <div class="poll">
        <section class="poll-card">
          <div class="poll-head">
            <h3 class="t-title-medium">From the USB connection</h3><span class="spacer"></span>
            <button class="btn text" id="btnPollScan"><svg class="icon"><use href="#i-refresh"/></svg>Check again</button>
          </div>
          <p class="t-body-small muted">The rate each keyboard asks for in its USB descriptor. The computer polls it exactly this often, so this is the real number. After changing a keyboard's rate, replug it and check again.</p>
          <div id="pollUsb" class="poll-list"></div>
        </section>
        <section class="poll-card">
          <div class="poll-head">
            <h3 class="t-title-medium">Key press test</h3><span class="spacer"></span>
            <button class="btn text" id="btnPollReset"><svg class="icon"><use href="#i-refresh"/></svg>Start over</button>
          </div>
          <p class="t-body-small muted">Drum your fingers across several keys, or press a few keys at once, for about 5 seconds. Works with any keyboard: each key change reaches the computer on a polling tick, so the gaps between them show the rate.</p>
          <div class="poll-result"><span id="pollValue" class="poll-value">—</span><span id="pollNote" class="t-body-medium muted"></span></div>
          <div id="pollHist" class="poll-hist" aria-hidden="true"></div>
          <div class="poll-axis t-body-small muted"><span>0</span><span>1 ms</span><span>2 ms</span><span>3 ms</span><span>4 ms</span></div>
          <p id="pollStats" class="t-body-small muted"></p>
        </section>
      </div>`;
    $('#btnPollScan').addEventListener('click', scanUsb);
    $('#btnPollReset').addEventListener('click', () => { T.poll.times = []; paintPollResult(); });
    $('#testerHint').textContent = '';
    paintUsb();
    paintPollResult();
    if (!T.poll.usb && !T.poll.scanning) scanUsb();
  }

  async function scanUsb() {
    const desktop = window.localKeymap;
    if (!desktop || !desktop.usbPollingRates || T.poll.scanning) { paintUsb(); return; }
    T.poll.scanning = true;
    paintUsb();
    try {
      T.poll.usb = await desktop.usbPollingRates();
    } catch (e) {
      T.poll.usb = { supported: true, keyboards: [], error: e.message };
    }
    T.poll.scanning = false;
    paintUsb();
  }

  function paintUsb() {
    const host = $('#pollUsb');
    if (!host) return;
    host.innerHTML = '';
    const P = T.poll;
    const say = (text) => { host.appendChild(el('p', 't-body-medium muted', text)); };
    if (!window.localKeymap) { say('Only the desktop app can read USB descriptors. Use the key press test below.'); return; }
    if (P.scanning && !P.usb) { say('Reading USB devices…'); return; }
    if (!P.usb) return;
    if (!P.usb.supported) { say('macOS doesn’t share USB polling rates with apps. Use the key press test below.'); return; }
    if (P.usb.error) { say(`Couldn’t read the USB devices (${P.usb.error}). Use the key press test below.`); return; }
    const S = App().state;
    const isCur = (k) => !!S.dev && k.vendorId === S.dev.vendorId && k.productId === S.dev.productId;
    const rows = P.usb.keyboards.filter((k) => k.keyboard || isCur(k)).sort((a, b) => isCur(b) - isCur(a));
    if (!rows.length) { say('No USB keyboards found.'); return; }
    const hex = (n) => n.toString(16).padStart(4, '0').toUpperCase();
    rows.forEach((k) => {
      const row = el('div', 'poll-row' + (isCur(k) ? ' current' : ''));
      const name = el('div', 'poll-name');
      name.appendChild(el('span', 't-body-large', k.product || 'USB keyboard'));
      name.appendChild(el('span', 't-body-small muted', `${hex(k.vendorId)}:${hex(k.productId)}${isCur(k) ? ' · connected in this app' : ''}`));
      const rate = el('div', 'poll-rate');
      rate.appendChild(el('span', 'poll-hz', `${k.rate} Hz`));
      rate.appendChild(el('span', 't-body-small muted', `${SPEED[k.speed] || k.speed} USB · every ${ms(k.intervalMs)}`));
      row.append(name, rate);
      host.appendChild(row);
    });
    if (P.scanning) host.appendChild(el('p', 't-body-small muted', 'Checking again…'));
  }

  function onPollKey(e) {
    e.preventDefault();
    if (e.repeat) return;
    const P = T.poll;
    P.times.push(e.timeStamp);
    if (P.times.length > 2000) P.times.splice(0, P.times.length - 2000);
    if (!P.raf) P.raf = requestAnimationFrame(() => { P.raf = 0; paintPollResult(); });
  }

  function paintPollResult() {
    const value = $('#pollValue');
    if (!value) return;
    const r = window.PollingRate.estimate(T.poll.times);
    const note = $('#pollNote');
    if (r.kind === 'need-more') {
      value.textContent = T.poll.times.length ? 'Keep going…' : '—';
      note.textContent = T.poll.times.length ? `${Math.min(r.gaps, 25)} of 25 quick key changes` : 'Waiting for key presses';
    } else if (r.kind === 'over') {
      value.textContent = 'Over 2000 Hz';
      note.textContent = 'Too fast for the browser’s clock to tell 4000 from 8000 Hz. The USB reading above is exact.';
    } else {
      value.textContent = `${r.rate} Hz`;
      note.textContent = r.steady ? 'measured from your key presses' : 'measured, but the timing is noisy: keep going for a steadier result';
    }
    const hist = $('#pollHist');
    hist.innerHTML = '';
    const max = Math.max(1, ...r.histogram);
    r.histogram.forEach((n, i) => {
      const bar = el('span', 'poll-bar');
      bar.style.height = `${Math.round((n / max) * 100)}%`;
      bar.title = `${(i * 0.25).toFixed(2)}-${((i + 1) * 0.25).toFixed(2)} ms: ${n}`;
      hist.appendChild(bar);
    });
    $('#pollStats').textContent = r.events ? `${r.events} key events in ${r.reports} USB reports. Bars: how often each gap between reports came up.` : '';
  }

  /** From the keyboard panel's "Check" button: open this mode with a fresh USB reading. */
  function openPolling() {
    const tab = document.querySelector('.rail [data-tab=tester]');
    if (tab && !App().isTabActive('tester')) tab.click();
    T.poll.usb = null; // the keyboard may have been replugged with a new rate
    setMode('polling');
  }

  function stopMatrix() {
    T.matrix.running = false;
    $('#testerRate').textContent = '';
  }

  // ---------------------------------------------------------------- mouse buttons
  // [id, name]: b0-b4 are the browser's button numbers (left, middle, right, back, forward)
  const MOUSE_PARTS = [
    ['b0', 'Left button'], ['b2', 'Right button'], ['b1', 'Middle button (wheel click)'], ['b3', 'Back (side button)'], ['b4', 'Forward (side button)'],
    ['up', 'Wheel up'], ['down', 'Wheel down'], ['left', 'Wheel tilt left'], ['right', 'Wheel tilt right'],
  ];
  const partName = (id) => (MOUSE_PARTS.find(([p]) => p === id) || [id, id])[1];
  const FAST_MS = 80; // a press this soon after the last release of the same button: likely the switch double-clicking

  function renderMouse() {
    $('#testerBoard').innerHTML = `
      <div class="mt">
        <div id="mtPad" class="mt-pad" tabindex="0" aria-label="Mouse test area: click, scroll and press the side buttons here">
          <svg class="mt-mouse" viewBox="0 0 200 300" aria-hidden="true">
            <path class="mt-body" d="M100 8 C158 8 186 52 188 118 L190 214 C191 262 152 294 100 294 C48 294 9 262 10 214 L12 118 C14 52 42 8 100 8 Z"/>
            <path class="mt-part" data-part="b0" d="M97 11 C48 12 17 52 15 120 L97 120 Z"/>
            <path class="mt-part" data-part="b2" d="M103 11 C152 12 183 52 185 120 L103 120 Z"/>
            <rect class="mt-part" data-part="b1" x="88" y="38" width="24" height="50" rx="12"/>
            <path class="mt-part" data-part="up" d="M100 17 L111 31 L89 31 Z"/>
            <path class="mt-part" data-part="down" d="M100 109 L111 95 L89 95 Z"/>
            <path class="mt-part" data-part="left" d="M71 63 L83 54 L83 72 Z"/>
            <path class="mt-part" data-part="right" d="M129 63 L117 54 L117 72 Z"/>
            <rect class="mt-part" data-part="b4" x="3" y="132" width="15" height="38" rx="7"/>
            <rect class="mt-part" data-part="b3" x="3" y="176" width="15" height="38" rx="7"/>
            <text x="52" y="92">L</text><text x="140" y="92">R</text>
          </svg>
          <p class="t-body-medium muted">Click, scroll and press the side buttons here</p>
        </div>
        <div class="mt-stats card filled">
          <table>
            <thead><tr><th>Button</th><th class="num">Presses</th><th class="num" title="Presses that came less than ${FAST_MS} ms after the same button was let go">Too fast</th></tr></thead>
            <tbody id="mtRows"></tbody>
          </table>
          <p class="t-body-small muted">A press that comes less than ${FAST_MS} ms after the same button was let go is faster than a person double-clicks. If presses count up on single clicks, the switch is probably wearing out and double-clicking by itself.</p>
        </div>
      </div>`;
    const pad = $('#mtPad');
    pad.addEventListener('mousedown', onMouseDown);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
    pad.addEventListener('auxclick', (e) => e.preventDefault());
    pad.addEventListener('wheel', onWheel, { passive: false });
    $('#testerHint').textContent = 'Works with any mouse. Buttons light up while held and stay tinted once tested. Extra buttons that send keys instead (like a CPI button) show up in Any keyboard.';
    paintMouse();
  }

  function paintMouse() {
    const M = T.mouse;
    document.querySelectorAll('#mtPad [data-part]').forEach((el) => {
      el.classList.toggle('pressed', M.pressed.has(el.dataset.part));
      el.classList.toggle('tested', M.tested.has(el.dataset.part));
    });
    const rows = $('#mtRows');
    if (!rows) return;
    rows.innerHTML = '';
    MOUSE_PARTS.forEach(([id, name]) => {
      const tr = document.createElement('tr');
      const fast = M.fast[id] || 0;
      tr.className = (M.pressed.has(id) ? 'on ' : '') + (fast ? 'warn' : '');
      [name, M.counts[id] || 0, id.startsWith('b') ? fast : ''].forEach((v, i) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (i) td.className = 'num';
        tr.appendChild(td);
      });
      rows.appendChild(tr);
    });
  }

  function onMouseDown(e) {
    e.preventDefault(); // no text selection, no autoscroll from the middle button
    const M = T.mouse, id = 'b' + e.button, now = performance.now();
    if (!MOUSE_PARTS.some(([p]) => p === id)) { addLog(`↓ button ${e.button}`); renderInfo(); return; }
    M.pressed.add(id);
    M.tested.add(id);
    M.counts[id] = (M.counts[id] || 0) + 1;
    const gap = now - (M.lastUp[id] ?? -Infinity);
    if (gap < FAST_MS) {
      M.fast[id] = (M.fast[id] || 0) + 1;
      addLog(`↓ ${partName(id)} (${Math.round(gap)} ms, too fast)`);
    } else addLog(`↓ ${partName(id)}`);
    paintMouse();
    renderInfo();
  }

  function onMouseUp(e) {
    if (T.mode !== 'mouse' || !active()) return;
    if (e.button >= 3) e.preventDefault(); // no back/forward navigation
    const id = 'b' + e.button;
    if (!T.mouse.pressed.has(id)) return;
    T.mouse.pressed.delete(id);
    T.mouse.lastUp[id] = performance.now();
    addLog(`↑ ${partName(id)}`);
    paintMouse();
    renderInfo();
  }

  function onWheel(e) {
    e.preventDefault();
    const M = T.mouse, dirs = [];
    if (e.deltaY) dirs.push(e.deltaY < 0 ? 'up' : 'down');
    if (e.deltaX) dirs.push(e.deltaX < 0 ? 'left' : 'right');
    for (const d of dirs) {
      M.tested.add(d);
      M.counts[d] = (M.counts[d] || 0) + 1;
      M.pressed.add(d);
      clearTimeout(M['t_' + d]);
      M['t_' + d] = setTimeout(() => { M.pressed.delete(d); paintMouse(); }, 150);
      if (T.log[0] !== `⟳ ${partName(d)}`) addLog(`⟳ ${partName(d)}`);
    }
    paintMouse();
    renderInfo();
  }

  // ---------------------------------------------------------------- wiring
  function setMode(mode) {
    T.mode = mode;
    document.querySelectorAll('#testerMode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    render();
  }

  function init() {
    document.querySelectorAll('#testerMode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    $('#btnTesterReset').addEventListener('click', reset);
    $('#btnFullscreen').addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) { await document.exitFullscreen(); return; }
        await document.documentElement.requestFullscreen();
        if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock();
      } catch (e) { App().toast('Fullscreen is not available: ' + e.message, 'error'); }
    });
    document.addEventListener('fullscreenchange', () => {
      $('#btnFullscreen span').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
    });
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('mouseup', onMouseUp, true); // also when let go outside the test area
    window.addEventListener('blur', () => { if (T.mouse.pressed.size) { T.mouse.pressed.clear(); if (T.mode === 'mouse') paintMouse(); } });
    document.addEventListener('lk:tab', () => { if (active()) render(); else stopMatrix(); });
    document.addEventListener('lk:resize', () => { if (active()) render(); });
    const refreshMatrix = () => {
      if (T.mode !== 'matrix') return;
      T.matrix.tested.clear();
      if (active()) render();
    };
    document.addEventListener('lk:device', refreshMatrix);
    document.addEventListener('lk:device', () => { if (T.mode === 'polling' && active()) paintUsb(); });
    document.addEventListener('lk:definition', refreshMatrix);
    render();
  }

  window.Tester = { openPolling };
  document.addEventListener('DOMContentLoaded', init);
})();
