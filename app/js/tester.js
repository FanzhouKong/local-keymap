/* Local Keymap - key tester.
 * "Any keyboard" mode listens to browser key events on a full-size ANSI layout.
 * "Switch matrix" mode polls a VIA keyboard's raw switch matrix, so it also sees Fn and remapped keys. */
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
  };

  const App = () => window.App;
  const active = () => App() && App().isTabActive('tester');
  const matrixReady = () => { const S = App().state; return !!(S.dev && S.def && S.keymap); };

  // ---------------------------------------------------------------- rendering
  function render() {
    stopMatrix();
    const host = $('#testerBoard');
    T.els.clear();
    if (T.mode === 'browser') {
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
    const browser = T.mode === 'browser';
    const total = browser ? LAYOUT.length : T.matrix.keys.filter((k) => k.row >= 0).length;
    const tested = browser ? LAYOUT.filter((k) => T.tested.has(k.id)).length : T.matrix.tested.size;
    $('#testerCount').textContent = total ? `${tested} / ${total} keys tested` : '';
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

  function stopMatrix() {
    T.matrix.running = false;
    $('#testerRate').textContent = '';
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
    document.addEventListener('lk:tab', () => { if (active()) render(); else stopMatrix(); });
    document.addEventListener('lk:resize', () => { if (active()) render(); });
    const refreshMatrix = () => {
      if (T.mode !== 'matrix') return;
      T.matrix.tested.clear();
      if (active()) render();
    };
    document.addEventListener('lk:device', refreshMatrix);
    document.addEventListener('lk:definition', refreshMatrix);
    render();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
