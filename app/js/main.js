/* Local Keymap - connection handling and the keymap editor. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const hex4 = (n) => Keycodes.hex(n);
  const oneLine = Keycodes.oneLine;

  const S = {
    dev: null, protocol: 0, layers: 0, macroCount: 0, def: null, kc: new Keycodes(12),
    keymap: null, enc: null, opts: [], layer: 0, sel: null, listen: false,
    visible: [], els: [], busy: false,
  };

  // ------------------------------------------------------------------ helpers
  function toast(msg, kind = 'info', ms = 4200) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `show ${kind}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = ''; }, ms);
  }
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* storage unavailable */ } },
  };
  const defKey = (vid, pid) => `lk.def.${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;
  const emit = (name) => document.dispatchEvent(new CustomEvent(name));
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  // ------------------------------------------------------------------ layout options (VIA bit packing)
  const optionCount = (label) => (Array.isArray(label) ? label.length - 1 : 2);
  const bitsFor = (n) => (n <= 2 ? 1 : n <= 4 ? 2 : n <= 8 ? 3 : n <= 16 ? 4 : 5);
  function unpackOptions(value, labels) {
    const out = new Array(labels.length).fill(0);
    let v = value >>> 0;
    for (let i = labels.length - 1; i >= 0; i--) {
      const bits = bitsFor(optionCount(labels[i]));
      out[i] = v & ((1 << bits) - 1);
      v >>>= bits;
    }
    return out.map((o, i) => (o < optionCount(labels[i]) ? o : 0));
  }
  function packOptions(opts, labels) {
    return labels.reduce((acc, label, i) => ((acc << bitsFor(optionCount(label))) | (opts[i] || 0)) >>> 0, 0);
  }

  // ------------------------------------------------------------------ definitions
  function prepareDefinition(json) {
    if (!json || typeof json !== 'object' || !json.matrix || !json.layouts || !Array.isArray(json.layouts.keymap)) {
      throw new Error('This is not a VIA definition file (it needs "matrix" and "layouts.keymap").');
    }
    const rows = +json.matrix.rows, cols = +json.matrix.cols;
    if (!(rows > 0 && cols > 0)) throw new Error('The definition has an invalid matrix size.');
    const layout = KLE.parse(json.layouts.keymap);
    const inMatrix = (k) => k.row < rows && k.col < cols;
    const optionKeys = {};
    for (const [g, opts] of Object.entries(layout.optionKeys)) {
      optionKeys[g] = {};
      for (const [o, ks] of Object.entries(opts)) optionKeys[g][o] = ks.filter(inMatrix);
    }
    return {
      raw: json,
      grid: json.grid === true,
      name: typeof json.name === 'string' ? json.name : 'Keyboard',
      vendorId: parseInt(json.vendorId, 16),
      productId: parseInt(json.productId, 16),
      rows, cols,
      labels: Array.isArray(json.layouts.labels) ? json.layouts.labels : [],
      keys: layout.keys.filter(inMatrix),
      optionKeys,
      customKeycodes: Array.isArray(json.customKeycodes) ? json.customKeycodes : [],
    };
  }

  const desktop = window.localKeymap || null; // set by the Electron shell

  function gridJson(rows, cols) {
    return {
      name: S.dev.name, vendorId: hex4(S.dev.vendorId), productId: hex4(S.dev.productId), grid: true,
      matrix: { rows, cols }, layouts: { keymap: KLE.gridKeymap(rows, cols) },
    };
  }

  /** Finds the keyboard's layout without asking for a file. In order:
   *  1. a file in the definitions folder   2. a file loaded earlier in the app
   *  3. the layout stored in the keyboard (Vial)   4. a built-in layout (Venom, demo)
   *  5. VIA's keyboard list, shipped with the app   6. a matrix grid, size read from the keyboard */
  async function findDefinition(dev, hid) {
    const vid = dev.vendorId, pid = dev.productId;
    const matches = (d) => parseInt(d.vendorId, 16) === vid && parseInt(d.productId, 16) === pid;
    if (desktop) {
      try {
        const list = await desktop.listDefinitions();
        const hit = list.find((d) => d.source === 'user' && matches(d)) || list.find(matches);
        if (hit) {
          const text = await desktop.readDefinition(hit.source, hit.file);
          return { def: prepareDefinition(JSON.parse(text)), source: `definitions/${hit.file}`, kind: 'file' };
        }
      } catch (e) { console.warn(e); }
    }
    const saved = store.get(defKey(vid, pid));
    if (saved) {
      try { return { def: prepareDefinition(JSON.parse(saved)), source: 'saved in app', kind: 'saved' }; } catch (e) { console.warn(e); }
    }
    if (dev.vialProtocol >= 0 && dev.readVialDefinition) {
      try {
        setStatus('Reading the layout from the keyboard…');
        const json = await dev.readVialDefinition((p) => setStatus(`Reading the layout from the keyboard… ${Math.round(p * 100)}%`));
        if (typeof json.name !== 'string') json.name = dev.name;
        return { def: prepareDefinition(json), source: 'layout stored in the keyboard (Vial)', kind: 'vial' };
      } catch (e) { console.warn('Vial layout:', e); }
    }
    const builtIn = hid.mockDefinition || dev.definition;
    if (builtIn) return { def: prepareDefinition(builtIn), source: hid.mockDefinition ? 'built-in demo' : 'built-in layout', kind: 'builtin' };
    if (desktop && desktop.findViaDefinition) {
      try {
        const hit = await desktop.findViaDefinition(vid, pid);
        if (hit) return { def: prepareDefinition(hit.definition), source: `VIA keyboard list (${String(hit.generatedAt).slice(0, 10)})`, kind: 'via' };
      } catch (e) { console.warn(e); }
    }
    if (dev.detectMatrix) {
      try {
        setStatus('Working out the key matrix…');
        const { rows, cols, sure } = await dev.detectMatrix(S.layers);
        const def = prepareDefinition(gridJson(rows, cols));
        def.gridSure = sure;
        return { def, source: `matrix grid, ${rows} × ${cols} found automatically`, kind: 'grid' };
      } catch (e) { console.warn('Matrix size:', e); }
    }
    return null;
  }

  async function loadAutoDefinition(hid) {
    const found = await findDefinition(S.dev, hid);
    if (found) await useDefinition(found.def, found.source, found.kind);
    else showNeedDefinition();
  }

  // ------------------------------------------------------------------ connection
  function setStatus(text) { $('#devStatus').textContent = text; }
  function updateStatus() {
    const btn = $('#btnConnect');
    btn.className = S.dev ? 'btn outlined' : 'btn filled';
    btn.querySelector('span').textContent = S.dev ? 'Disconnect' : 'Connect keyboard';
    if (!S.dev) {
      setStatus('No keyboard connected');
      return;
    }
    if (S.dev.kind === 'venom') {
      const i = S.dev.info;
      setStatus(`${S.dev.name} · Venom firmware ${i.firmware} · profile ${i.profile + 1} · ${VenomDevice.SPEEDS[i.usbSpeed] || 'unknown speed'}`);
      return;
    }
    const vial = S.dev.vialProtocol >= 0 ? ` · Vial ${S.dev.vialProtocol}` : '';
    setStatus(`${S.dev.name} · VIA protocol ${S.protocol}${vial} · ${S.layers} layers`);
  }

  // ------------------------------------------------------------------ Venom device panel (profile + polling rate)
  function renderDevicePanel() {
    const host = $('#devPanel');
    host.innerHTML = '';
    const venom = S.dev && S.dev.kind === 'venom';
    show('#devPanel', venom);
    if (!venom) return;
    const i = S.dev.info;
    const icon = (id) => `<svg class="icon s18"><use href="#i-${id}"/></svg>`;
    const group = (iconId, title, choices, current, onPick) => {
      const g = document.createElement('div');
      g.className = 'dev-group';
      const label = document.createElement('span');
      label.className = 't-label-large';
      label.innerHTML = `${icon(iconId)}${title}`;
      const seg = document.createElement('div');
      seg.className = 'segmented';
      choices.forEach(([value, text]) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.className = value === current ? 'active' : '';
        b.addEventListener('click', () => { if (value !== current) onPick(value); });
        seg.appendChild(b);
      });
      g.append(label, seg);
      return g;
    };

    host.appendChild(group('person', 'Profile', [0, 1, 2, 3].map((p) => [p, String(p + 1)]), i.profile, async (p) => {
      if (S.busy) return;
      try {
        await S.dev.setProfile(p);
        await useDefinition(S.def, S.source, S.sourceKind);
      } catch (e) { toast('Could not switch profile: ' + e.message, 'error'); }
    }));
    host.appendChild(group('speed', 'Polling rate', [[0, '8000 Hz'], [1, '1000 Hz']], i.force1k ? 1 : 0, (v) => setPolling(v === 1)));

    const now = document.createElement('span');
    now.className = 't-body-medium muted';
    now.id = 'usbSpeedNow';
    now.textContent = `Running at ${VenomDevice.SPEEDS[i.usbSpeed] || 'unknown speed'}`;
    host.appendChild(now);

    const note = document.createElement('div');
    note.className = 'dev-note t-body-small';
    note.innerHTML = icon('info');
    const text = document.createElement('span');
    text.textContent = 'A new polling rate takes effect after you unplug the keyboard and plug it back in.'
      + (i.firmware < VenomDevice.FIXED_1K_FIRMWARE
        ? ` Your firmware is ${i.firmware}; Geonworks fixed the 1000 Hz mode in firmware ${VenomDevice.FIXED_1K_FIRMWARE}, so update it with venom.how if the rate doesn't change.`
        : '');
    note.appendChild(text);
    host.appendChild(note);
  }

  async function setPolling(on) {
    try {
      const v = await S.dev.setForce1k(on);
      renderDevicePanel();
      toast(`Polling rate set to ${v ? '1000' : '8000'} Hz. Unplug the keyboard and plug it back in to apply it.`, 'ok', 9000);
      setTimeout(async () => {
        if (!S.dev || S.dev.kind !== 'venom') return;
        try { await S.dev.refreshUsbSpeed(); updateStatus(); renderDevicePanel(); } catch (_) { /* re-enumerating */ }
      }, 1500);
    } catch (e) {
      toast('Could not change the polling rate: ' + e.message, 'error');
    }
  }

  async function connectClicked() {
    if (S.dev) { await detach(); return; }
    if (!('hid' in navigator)) {
      toast('Keyboard access (WebHID) is not available here. Use the Local Keymap desktop app.', 'error', 8000);
      return;
    }
    try {
      const devs = await navigator.hid.requestDevice({ filters: [ViaDevice.FILTER, VenomDevice.FILTER] });
      const d = devs.find(isSupported) || devs[0];
      if (d) await attach(d);
    } catch (e) {
      if (e.name !== 'NotFoundError') toast(e.message, 'error');
    }
  }

  const isSupported = (hid) => ViaDevice.isVia(hid) || VenomDevice.isVenom(hid);

  async function attach(hid) {
    await detach();
    const venom = VenomDevice.isVenom(hid);
    const dev = venom ? new VenomDevice(hid) : new ViaDevice(hid);
    setStatus(`Connecting to ${dev.name}…`);
    try {
      await dev.open();
      await dev.protocolVersion();
      if (!venom && dev.protocol <= 10) await dev.detectVial();
      S.dev = dev;
      S.protocol = dev.protocol;
      S.layers = await dev.layerCount();
      try { S.macroCount = await dev.macroCount(); } catch (_) { S.macroCount = 0; }
      S.kc = new Keycodes(S.protocol, [], { vialProtocol: dev.vialProtocol });
      updateStatus();
      emit('lk:device');
      await loadAutoDefinition(hid);
    } catch (e) {
      console.error(e);
      toast(`${dev.name} did not answer like a ${venom ? 'Venom' : 'VIA'} keyboard (${e.message}).`, 'error', 7000);
      await dev.close();
      if (S.dev === dev) S.dev = null;
      resetEditor();
      updateStatus();
      emit('lk:device');
    }
  }

  async function detach() {
    if (!S.dev) return;
    const dev = S.dev;
    S.dev = null;
    resetEditor();
    updateStatus();
    emit('lk:device');
    await dev.close();
  }

  function resetEditor() {
    stopFinder();
    S.def = null; S.keymap = null; S.enc = null; S.sel = null; S.opts = []; S.layer = 0;
    S.source = ''; S.sourceKind = '';
    setListen(false);
    show('#kmEditor', false);
    show('#kmNeedDef', false);
    show('#kmEmpty', true);
    $('#kmBoard').innerHTML = '';
  }

  function showNeedDefinition() {
    stopFinder();
    S.def = null; S.keymap = null;
    show('#kmEmpty', false);
    show('#kmEditor', false);
    show('#kmNeedDef', true);
    $('#needDefIds').textContent = `vendorId ${hex4(S.dev.vendorId)} · productId ${hex4(S.dev.productId)}`;
    $('#needDefName').textContent = S.dev.name;
    if (S.dev.kind === 'venom') { $('#gridRows').value = 8; $('#gridCols').value = 16; }
  }

  async function useDefinition(def, source, kind) {
    stopFinder();
    S.busy = true;
    try {
      S.def = def;
      S.source = source;
      S.sourceKind = kind;
      S.kc = new Keycodes(S.protocol, def.customKeycodes, { vialProtocol: S.dev.vialProtocol });
      S.layer = 0; S.sel = null;
      S.opts = def.labels.map(() => 0);
      if (def.labels.length) {
        try { S.opts = unpackOptions(await S.dev.getLayoutOptions(), def.labels); } catch (_) { /* firmware without layout options */ }
      }
      setStatus('Reading keymap… 0%');
      S.keymap = await S.dev.readKeymap(S.layers, def.rows, def.cols, (p) => setStatus(`Reading keymap… ${Math.round(p * 100)}%`));
      S.enc = await readEncoders(def);
      show('#kmEmpty', false);
      show('#kmNeedDef', false);
      show('#kmEditor', true);
      $('#defSource').textContent = `${def.name} — ${source}`;
      show('#btnForgetDef', kind === 'saved');
      renderGridNote();
      renderDevicePanel();
      renderPicker();
      renderKeymap();
      updateStatus();
      emit('lk:definition');
      setTimeout(startFinder, 0);
    } catch (e) {
      console.error(e);
      toast('Could not read the keymap: ' + e.message, 'error', 7000);
      updateStatus();
      showNeedDefinition();
    } finally {
      S.busy = false;
    }
  }

  async function readEncoders(def) {
    const ids = [...new Set(allDefKeys(def).filter((k) => k.ei !== undefined).map((k) => k.ei))];
    if (!ids.length) return null;
    try {
      const enc = [];
      for (let l = 0; l < S.layers; l++) {
        enc[l] = {};
        for (const id of ids) enc[l][id] = [await S.dev.getEncoder(l, id, false), await S.dev.getEncoder(l, id, true)];
      }
      return enc;
    } catch (_) {
      return null; // firmware without encoder map support
    }
  }

  function allDefKeys(def) {
    const out = [...def.keys];
    Object.values(def.optionKeys).forEach((opts) => Object.values(opts).forEach((ks) => out.push(...ks)));
    return out;
  }

  /** Keys currently shown: base keys + the selected alternative of every layout option. */
  function visibleKeys(def = S.def, opts = S.opts) {
    if (!def) return [];
    const out = [...def.keys];
    for (const [g, alts] of Object.entries(def.optionKeys)) {
      const choice = +g < def.labels.length ? opts[+g] || 0 : 0;
      out.push(...(alts[choice] || alts[0] || []));
    }
    return out.sort((a, b) => a.y - b.y || a.x - b.x);
  }

  async function loadDefinitionText(text, source = 'saved in app') {
    let json;
    try { json = JSON.parse(text); } catch (e) { toast('That file is not valid JSON: ' + e.message, 'error', 7000); return; }
    let def;
    try { def = prepareDefinition(json); } catch (e) { toast(e.message, 'error', 7000); return; }
    if (!S.dev) { toast('Connect the keyboard first.', 'error'); return; }
    const idsKnown = Number.isFinite(def.vendorId) && Number.isFinite(def.productId);
    if (idsKnown && (def.vendorId !== S.dev.vendorId || def.productId !== S.dev.productId)) {
      const ok = await ask('Use this definition?', `This definition is for ${hex4(def.vendorId)}:${hex4(def.productId)}, but the connected keyboard is ${hex4(S.dev.vendorId)}:${hex4(S.dev.productId)}.`, 'Use anyway');
      if (!ok) return;
    }
    store.set(defKey(S.dev.vendorId, S.dev.productId), text);
    await useDefinition(def, source, 'saved');
  }

  /** A grid size chosen by hand is remembered for this keyboard (Forget returns to automatic). */
  async function useGrid(rowsInput, colsInput) {
    const rows = +rowsInput.value, cols = +colsInput.value;
    if (!(rows > 0 && rows <= 64 && cols > 0 && cols <= 32)) { toast('Use 1-64 rows and 1-32 columns.', 'error'); return; }
    if (!S.dev) return;
    await loadDefinitionText(JSON.stringify(gridJson(rows, cols)), `matrix grid, ${rows} × ${cols} set by hand`);
  }

  function renderGridNote() {
    const grid = !!(S.def && S.def.grid);
    show('#gridNote', grid);
    if (!grid) return;
    const auto = S.sourceKind === 'grid';
    $('#gridNoteText').textContent = `This keyboard isn't in VIA's list and doesn't carry its own layout, so its keys are shown in matrix order: ${S.def.rows} rows × ${S.def.cols} columns${auto ? ', read from the keyboard' : ''}. Each key shows what it does now; hold a key on the keyboard and it lights up here.`
      + (auto && S.def.gridSure === false ? ' The keymap has too little variety to double-check this size; if the labels look shifted, correct the rows and columns.' : '');
    $('#gridNote').classList.toggle('warn', auto && S.def.gridSure === false);
    $('#gridRows2').value = S.def.rows;
    $('#gridCols2').value = S.def.cols;
  }

  // ------------------------------------------------------------------ pressed keys light up in the editor
  /** Raw switch matrix bytes (rows * ceil(cols/8), MSB byte first) -> Set of row*cols+col. */
  function decodeMatrix(bytes, rows, cols) {
    const bpr = Math.ceil(cols / 8);
    const down = new Set();
    for (let r = 0; r < rows; r++) {
      for (let b = 0; b < bpr; b++) {
        const byte = bytes[r * bpr + b] || 0;
        if (!byte) continue;
        const colOffset = 8 * (bpr - 1 - b);
        for (let bit = 0; bit < 8; bit++) if ((byte >> bit) & 1 && colOffset + bit < cols) down.add(r * cols + colOffset + bit);
      }
    }
    return down;
  }

  const finder = { gen: 0, timer: 0, fails: 0, last: '' };
  function startFinder() {
    stopFinder();
    if (!S.dev || !S.def || !S.keymap || !S.dev.getMatrixState) return;
    const gen = finder.gen; // a newer start/stop makes this loop end, even mid-read
    const dev = S.dev;
    const live = () => finder.gen === gen && S.dev === dev && !!S.def;
    finder.fails = 0;
    const tick = async () => {
      if (!live()) return;
      if (!S.busy && isTabActive('keymap') && !document.hidden) {
        try {
          const bytes = await dev.getMatrixState(S.def.rows, S.def.cols);
          if (!live()) return;
          showPressed(decodeMatrix(bytes, S.def.rows, S.def.cols));
          finder.fails = 0;
        } catch (e) {
          if (!live()) return;
          if (e.unhandled || ++finder.fails > 5) { stopFinder(); return; }
        }
      }
      finder.timer = setTimeout(tick, 60);
    };
    tick();
  }
  function stopFinder() {
    finder.gen++;
    clearTimeout(finder.timer);
    if (finder.last) showPressed(new Set());
  }
  function showPressed(down) {
    const sig = [...down].join(',');
    if (sig === finder.last) return;
    finder.last = sig;
    if (!S.def) return;
    S.visible.forEach((k, i) => {
      if (k.row >= 0 && S.els[i]) S.els[i].classList.toggle('pressed', down.has(k.row * S.def.cols + k.col));
    });
  }

  // ------------------------------------------------------------------ keymap rendering
  const codeAt = (k, layer = S.layer) => S.keymap[layer][k.row * S.def.cols + k.col];

  function renderKeymap() {
    if (!S.def) return;
    S.visible = visibleKeys();
    S.els = Board.render($('#kmBoard'), S.visible, { maxUnit: 64 });
    finder.last = '';
    S.els.forEach((el, i) => el.addEventListener('mousedown', (e) => { e.preventDefault(); selectKey(i); }));
    renderLayerButtons();
    renderLayoutOptions();
    refreshLabels();
  }

  function refreshLabels() {
    S.visible.forEach((k, i) => {
      const el = S.els[i];
      let label, title, code = null;
      if (k.ei !== undefined && k.edir !== undefined) {
        // Vial: one key per direction
        const e = S.enc && S.enc[S.layer] && S.enc[S.layer][k.ei];
        const arrow = k.edir ? '↻' : '↺';
        label = e ? `${arrow} ${oneLine(S.kc.label(e[k.edir]))}` : `Knob ${k.ei} ${arrow}`;
        title = e ? `Encoder ${k.ei} ${k.edir ? 'clockwise' : 'counter-clockwise'}: ${S.kc.name(e[k.edir])}` : `Encoder ${k.ei} (this firmware does not expose knob mapping)`;
      } else if (k.ei !== undefined) {
        const e = S.enc && S.enc[S.layer] && S.enc[S.layer][k.ei];
        label = e ? `↺ ${oneLine(S.kc.label(e[0]))}\n↻ ${oneLine(S.kc.label(e[1]))}` : `Knob ${k.ei}`;
        title = e ? `Encoder ${k.ei}: ↺ ${S.kc.name(e[0])}  ↻ ${S.kc.name(e[1])}` : `Encoder ${k.ei} (this firmware does not expose knob mapping)`;
        if (k.row >= 0) title += `\nPress: ${S.kc.name(codeAt(k))}`;
      } else {
        code = codeAt(k);
        label = S.kc.label(code);
        title = `${S.kc.name(code)}  (${hex4(code)})\nmatrix ${k.row},${k.col}`;
        const special = S.dev.keyInfo && S.dev.keyInfo(S.layer, k.row, k.col, S.kc);
        if (special) { label = special.label; title = `${special.title}\nmatrix ${k.row},${k.col}`; code = null; }
        el.classList.toggle('adv', !!(special && special.advanced));
      }
      Board.setLabel(el, label);
      el.title = title;
      el.classList.toggle('trns', code === 1);
      el.classList.toggle('none', code === 0);
      el.classList.toggle('selected', !!S.sel && S.sel.i === i);
    });
    renderSelectionInfo();
  }

  function renderLayerButtons() {
    const host = $('#layerBtns');
    host.innerHTML = '';
    for (let l = 0; l < S.layers; l++) {
      const b = document.createElement('button');
      b.textContent = String(l);
      b.title = `Layer ${l}`;
      b.className = l === S.layer ? 'active' : '';
      b.addEventListener('click', () => { S.layer = l; renderLayerButtons(); refreshLabels(); });
      host.appendChild(b);
    }
  }

  function renderLayoutOptions() {
    const host = $('#layoutOpts');
    host.innerHTML = '';
    S.def.labels.forEach((label, g) => {
      const wrap = document.createElement('label');
      if (Array.isArray(label)) {
        // outlined select with a floating label
        const [title, ...choices] = label;
        wrap.className = 'field small';
        const lab = document.createElement('span');
        lab.className = 'field-label';
        lab.textContent = title;
        const sel = document.createElement('select');
        choices.forEach((c, i) => sel.add(new Option(c, String(i), false, i === S.opts[g])));
        sel.addEventListener('change', () => setLayoutOption(g, +sel.value));
        wrap.append(lab, sel);
      } else {
        // Material switch
        wrap.className = 'switch t-body-medium';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.setAttribute('role', 'switch');
        cb.checked = !!S.opts[g];
        cb.addEventListener('change', () => setLayoutOption(g, cb.checked ? 1 : 0));
        const track = document.createElement('span');
        track.className = 'track';
        wrap.append(cb, track, label);
      }
      host.appendChild(wrap);
    });
    show('#layoutOptsWrap', S.def.labels.length > 0);
  }

  async function setLayoutOption(g, v) {
    S.opts[g] = v;
    S.sel = null;
    renderKeymap();
    emit('lk:definition');
    try { await S.dev.setLayoutOptions(packOptions(S.opts, S.def.labels)); } catch (_) { /* display-only on this firmware */ }
  }

  // ------------------------------------------------------------------ selection + assignment
  function selectKey(i) {
    const k = S.visible[i];
    if (S.sel && S.sel.i === i) {
      S.sel = null; // clicking the selected key again deselects it
    } else if (k.ei === undefined) {
      S.sel = { i, slot: 'key' };
    } else if (S.enc && k.edir !== undefined) {
      S.sel = { i, slot: k.edir ? 'cw' : 'ccw' };
    } else if (S.enc) {
      S.sel = { i, slot: 'ccw' }; // switch to clockwise / press with the buttons under the keyboard
    } else if (k.row >= 0) {
      S.sel = { i, slot: 'key' };
    } else {
      toast('This firmware does not let you remap the knob.', 'error');
      return;
    }
    refreshLabels();
  }

  function renderSelectionInfo() {
    const info = $('#selInfo');
    const slots = $('#slotBtns');
    slots.innerHTML = '';
    if (!S.sel) {
      info.innerHTML = '<b>Click a key</b> on the keyboard above, then pick what it should do.';
      return;
    }
    const k = S.visible[S.sel.i];
    let code;
    if (S.sel.slot === 'key') code = codeAt(k);
    else code = S.enc[S.layer][k.ei][S.sel.slot === 'cw' ? 1 : 0];
    const where = S.sel.slot === 'key' ? `key ${k.row},${k.col}` : `knob ${k.ei} ${S.sel.slot === 'cw' ? 'clockwise' : 'counter-clockwise'}`;
    info.innerHTML = '';
    info.append(`Layer ${S.layer} · ${where} · now `);
    const b = document.createElement('code');
    const special = S.sel.slot === 'key' && S.dev.keyInfo && S.dev.keyInfo(S.layer, k.row, k.col, S.kc);
    b.textContent = special ? special.title.split('\n')[0] : `${S.kc.name(code)} (${hex4(code)})`;
    info.appendChild(b);
    if (k.ei !== undefined && k.edir === undefined) {
      const opts = [];
      if (S.enc) opts.push(['ccw', '↺ Counter-clockwise'], ['cw', '↻ Clockwise']);
      if (k.row >= 0) opts.push(['key', 'Press']);
      opts.forEach(([slot, text]) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        btn.className = slot === S.sel.slot ? 'active' : '';
        btn.addEventListener('click', () => { S.sel = { i: S.sel.i, slot }; refreshLabels(); });
        slots.appendChild(btn);
      });
    }
  }

  async function assign(code) {
    if (!S.sel) { toast('Select a key on the keyboard first.'); return; }
    if (S.busy) return;
    const { i, slot } = S.sel;
    const k = S.visible[i];
    S.busy = true;
    try {
      if (slot === 'key') {
        await S.dev.setKeycode(S.layer, k.row, k.col, code);
        S.keymap[S.layer][k.row * S.def.cols + k.col] = typeof code === 'object' ? code.value : code;
      } else if (typeof code === 'object') {
        throw new Error('That key can only go on a key, not a knob');
      } else {
        const cw = slot === 'cw';
        await S.dev.setEncoder(S.layer, k.ei, cw, code);
        S.enc[S.layer][k.ei][cw ? 1 : 0] = code;
      }
    } catch (e) {
      toast('Could not write to the keyboard: ' + e.message, 'error');
      return;
    } finally {
      S.busy = false;
    }
    advance();
    refreshLabels();
    emit('lk:keymap');
  }

  function advance() {
    const { i, slot } = S.sel;
    if (slot === 'ccw' && S.visible[i].edir === undefined) { S.sel = { i, slot: 'cw' }; return; }
    for (let j = i + 1; j < S.visible.length; j++) {
      const k = S.visible[j];
      if (k.ei === undefined) { S.sel = { i: j, slot: 'key' }; return; }
      if (S.enc) { S.sel = { i: j, slot: k.edir ? 'cw' : 'ccw' }; return; }
      if (k.row >= 0) { S.sel = { i: j, slot: 'key' }; return; }
    }
    S.sel = null;
    setListen(false);
  }

  // ------------------------------------------------------------------ picker
  let pickerTab = 'basic';
  function renderPicker() {
    const cats = S.kc.categories(S.layers, S.macroCount);
    if (S.dev && S.dev.extraCategories) cats.push(...S.dev.extraCategories());
    if (!cats.some((c) => c.id === pickerTab)) pickerTab = 'basic';
    const tabs = $('#pkTabs');
    tabs.innerHTML = '';
    cats.forEach((c) => {
      const b = document.createElement('button');
      b.textContent = c.title;
      b.className = c.id === pickerTab ? 'active' : '';
      b.addEventListener('click', () => { pickerTab = c.id; renderPicker(); });
      tabs.appendChild(b);
    });
    const body = $('#pkBody');
    body.innerHTML = '';
    const cat = cats.find((c) => c.id === pickerTab);
    if (cat.hint) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = cat.hint;
      body.appendChild(p);
    }
    cat.groups.forEach((g) => {
      const sec = document.createElement('div');
      sec.className = 'pk-group';
      const h = document.createElement('h4');
      h.textContent = g.title;
      const grid = document.createElement('div');
      grid.className = 'pk-grid';
      const items = g.items || g.codes.map((code) => {
        const d = S.kc.describe(code);
        return { value: code, label: d.label, title: `${d.name}  (${hex4(code)})${d.title ? '\n' + d.title : ''}` };
      });
      items.forEach((it) => {
        const btn = document.createElement('button');
        btn.className = 'pk-key';
        btn.textContent = it.label || ' ';
        const longest = Math.max(0, ...String(it.label).split('\n').map((l) => l.length));
        if (longest > 5) btn.classList.add('s');
        btn.title = it.title;
        btn.addEventListener('click', () => assign(it.value));
        grid.appendChild(btn);
      });
      sec.append(h, grid);
      body.appendChild(sec);
    });
  }

  function anyPreview() {
    const input = $('#anyInput'), out = $('#anyPreview');
    const set = (text, state) => {
      out.textContent = text;
      out.classList.toggle('ok', state === 'ok');
      out.classList.toggle('bad', state === 'bad');
    };
    if (!input.value.trim()) { set('Type a keycode name or expression, then press Enter.', ''); return null; }
    try {
      const code = S.kc.parse(input.value);
      set(`= ${hex4(code)} · ${S.kc.name(code)}`, 'ok');
      return code;
    } catch (e) {
      set(e.message, 'bad');
      return null;
    }
  }

  function setListen(on) {
    S.listen = on;
    const b = $('#btnListen');
    b.classList.toggle('active', on);
    b.querySelector('span').textContent = on ? 'Listening… press keys (click to stop)' : 'Assign by pressing a key';
  }

  /** Desktop shell: pick which keyboard to connect (answers WebHID's device request). */
  let pickerOpen = false;
  function showDevicePicker(list) {
    const dlg = $('#devDialog');
    const host = $('#devList');
    const prev = host.querySelector('input:checked');
    const prevId = prev && prev.value;
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<p class="t-body-medium muted dev-empty">No supported keyboard found. Plug it in; it appears here automatically.</p>';
    }
    list.forEach((d, i) => {
      const row = document.createElement('label');
      row.className = 'dev-option';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'lkDevice';
      radio.value = d.deviceId;
      radio.checked = prevId ? prevId === d.deviceId : i === 0;
      const text = document.createElement('span');
      text.className = 'dev-option-text';
      const name = document.createElement('span');
      name.className = 't-body-large';
      name.textContent = d.name;
      const ids = document.createElement('span');
      ids.className = 't-body-small muted';
      ids.textContent = `${hex4(d.vendorId)}:${hex4(d.productId)}`;
      text.append(name, ids);
      row.append(radio, text);
      row.addEventListener('dblclick', () => dlg.close('ok'));
      host.appendChild(row);
    });
    $('#devDialogOk').disabled = !list.length;
    if (pickerOpen) return;
    pickerOpen = true;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => {
      pickerOpen = false;
      const chosen = host.querySelector('input:checked');
      desktop.chooseDevice(dlg.returnValue === 'ok' && chosen ? chosen.value : '');
    }, { once: true });
  }

  /** Material dialog in place of confirm(). Resolves true when the confirm button is chosen. */
  function ask(title, text, okLabel = 'OK') {
    const dlg = $('#mdDialog');
    $('#mdDialogTitle').textContent = title;
    $('#mdDialogText').textContent = text;
    $('#mdDialogOk').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  function onKeyDown(e) {
    if (!S.listen || !isTabActive('keymap')) return;
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    e.preventDefault();
    if (e.repeat) return;
    const name = Keycodes.EVENT_TO_KC[e.code];
    if (!name) { toast(`"${e.code || e.key}" has no matching keycode.`); return; }
    assign(S.kc.parse(name));
  }

  // ------------------------------------------------------------------ backup / restore
  function backup() {
    const { rows, cols } = S.def;
    const data = {
      format: 'local-keymap-backup', version: 1, name: S.def.name,
      vendorId: hex4(S.dev.vendorId), productId: hex4(S.dev.productId), protocol: S.protocol,
      matrix: { rows, cols }, layoutOptions: S.opts, savedAt: new Date().toISOString(),
      layers: S.keymap.map((layer) => Array.from({ length: rows }, (_, r) => Array.from(layer.slice(r * cols, (r + 1) * cols), hex4))),
      encoders: S.enc ? S.enc.map((l) => Object.fromEntries(Object.entries(l).map(([id, v]) => [id, v.map(hex4)]))) : undefined,
    };
    if (S.dev.kind === 'venom') {
      // key types per layer (1 = normal, 241 = Venom function, other = advanced key from venom.how)
      data.venomProfile = S.dev.info.profile;
      data.keyTypes = S.dev.types.map((t) => Array.from({ length: rows }, (_, r) => Array.from(t.slice(r * cols, (r + 1) * cols))));
    }
    const slug = S.def.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'keyboard';
    download(`${slug}-keymap-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1));
  }

  async function restore(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { toast('Not a valid backup file.', 'error'); return; }
    if (!data || data.format !== 'local-keymap-backup' || !Array.isArray(data.layers)) { toast('Not a Local Keymap backup file.', 'error'); return; }
    const { rows, cols } = S.def;
    if (!data.matrix || data.matrix.rows !== rows || data.matrix.cols !== cols) {
      toast(`Backup is for a ${data.matrix?.rows}×${data.matrix?.cols} matrix; this keyboard is ${rows}×${cols}.`, 'error', 7000);
      return;
    }
    if ((data.protocol >= 11) !== (S.protocol >= 11)) {
      if (!await ask('Different keycode generation', 'This backup was made with old-style QMK keycodes and this keyboard uses new ones (or the other way round). Some keys may come out wrong.', 'Restore anyway')) return;
    }
    const changes = [];
    let skipped = 0;
    const venom = S.dev.kind === 'venom';
    const layers = Math.min(S.layers, data.layers.length);
    for (let l = 0; l < layers; l++) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const v = parseInt(data.layers[l]?.[r]?.[c], 16);
        if (!Number.isFinite(v)) continue;
        if (venom) {
          // Plain keys and Venom function keys can be restored; advanced keys (DKS, tap-hold...) can't.
          const bt = data.keyTypes?.[l]?.[r]?.[c] ?? 1;
          const ct = S.dev.types[l][r * cols + c];
          if (bt === ct && v === S.keymap[l][r * cols + c]) continue;
          if ((bt !== 1 && bt !== 241) || (ct !== 1 && ct !== 241 && ct !== 0)) { skipped++; continue; }
          changes.push({ l, r, c, v: bt === 241 ? { type: 241, value: v } : v });
        } else if (v !== S.keymap[l][r * cols + c]) {
          changes.push({ l, r, c, v });
        }
      }
    }
    if (skipped) toast(`${skipped} advanced key(s) (set up in venom.how) are left as they are.`, 'info', 7000);
    const encChanges = [];
    if (S.enc && Array.isArray(data.encoders)) {
      for (let l = 0; l < Math.min(S.layers, data.encoders.length); l++) {
        for (const [id, pair] of Object.entries(data.encoders[l] || {})) {
          if (!S.enc[l] || !S.enc[l][id]) continue;
          [0, 1].forEach((cw) => {
            const v = parseInt(pair[cw], 16);
            if (Number.isFinite(v) && v !== S.enc[l][id][cw]) encChanges.push({ l, id: +id, cw, v });
          });
        }
      }
    }
    if (!changes.length && !encChanges.length) { toast('The keyboard already matches this backup.'); return; }
    if (!await ask('Restore backup?', `${changes.length + encChanges.length} key(s) differ from "${data.name}". They will be written to the keyboard now.`, 'Restore')) return;
    S.busy = true;
    try {
      let n = 0;
      for (const ch of changes) {
        await S.dev.setKeycode(ch.l, ch.r, ch.c, ch.v);
        S.keymap[ch.l][ch.r * cols + ch.c] = typeof ch.v === 'object' ? ch.v.value : ch.v;
        if (++n % 10 === 0) setStatus(`Restoring… ${n}/${changes.length}`);
      }
      for (const ch of encChanges) {
        await S.dev.setEncoder(ch.l, ch.id, ch.cw === 1, ch.v);
        S.enc[ch.l][ch.id][ch.cw] = ch.v;
      }
      toast(`Restored ${changes.length + encChanges.length} key(s).`, 'ok');
    } catch (e) {
      toast('Restore stopped: ' + e.message, 'error');
    } finally {
      S.busy = false;
      updateStatus();
      refreshLabels();
      emit('lk:keymap');
    }
  }

  // ------------------------------------------------------------------ tabs + wiring
  function isTabActive(name) { return $(`#tab-${name}`).classList.contains('active'); }
  function setTab(name) {
    document.querySelectorAll('.rail [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
    $('#pageTitle').textContent = name === 'keymap' ? 'Keymap' : 'Key tester';
    if (name !== 'keymap') setListen(false);
    if (name === 'keymap' && S.def) renderKeymap();
    emit('lk:tab');
  }

  function readFile(input, fn) {
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.value = '';
      if (f) fn(await f.text());
    });
  }

  function init() {
    document.querySelectorAll('.rail [data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    anyPreview();
    $('#btnConnect').addEventListener('click', connectClicked);
    $('#btnConnect2').addEventListener('click', connectClicked);
    $('#btnDemo').addEventListener('click', () => attach(MockVia.create()));
    $('#btnLoadDef').addEventListener('click', () => $('#fileDef').click());
    $('#btnChangeDef').addEventListener('click', () => $('#fileDef').click());
    $('#btnForgetDef').addEventListener('click', async () => {
      if (!S.dev || S.busy) return;
      store.del(defKey(S.dev.vendorId, S.dev.productId));
      toast('Forgot the saved layout. Looking the keyboard up again.');
      await loadAutoDefinition(S.dev.hid);
    });
    $('#btnGrid').addEventListener('click', () => useGrid($('#gridRows'), $('#gridCols')));
    $('#btnGrid2').addEventListener('click', () => useGrid($('#gridRows2'), $('#gridCols2')));
    $('#btnLoadDef2').addEventListener('click', () => $('#fileDef').click());
    $('#btnBackup').addEventListener('click', backup);
    $('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
    readFile($('#fileDef'), loadDefinitionText);
    readFile($('#fileRestore'), restore);
    $('#btnListen').addEventListener('click', () => {
      if (!S.listen && !S.sel) { toast('Select a key first.'); return; }
      setListen(!S.listen);
    });
    $('#anyInput').addEventListener('input', anyPreview);
    $('#anyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const c = anyPreview(); if (c != null) assign(c); } });
    $('#btnAny').addEventListener('click', () => { const c = anyPreview(); if (c != null) assign(c); });
    window.addEventListener('keydown', onKeyDown);

    // drag & drop a definition anywhere while one is needed
    window.addEventListener('dragover', (e) => { if (S.dev) e.preventDefault(); });
    window.addEventListener('drop', async (e) => {
      if (!S.dev) return;
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (f) loadDefinitionText(await f.text());
    });

    let resizeT;
    window.addEventListener('resize', () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => { if (S.def && isTabActive('keymap')) renderKeymap(); emit('lk:resize'); }, 150);
    });

    if ('hid' in navigator) {
      navigator.hid.addEventListener('disconnect', (e) => {
        if (S.dev && e.device === S.dev.hid) { toast(`${S.dev.name} was unplugged.`); detach(); }
      });
      navigator.hid.addEventListener('connect', (e) => { if (!S.dev && isSupported(e.device)) attach(e.device); });
      navigator.hid.getDevices().then((ds) => { const d = ds.find(isSupported); if (d && !S.dev) attach(d); });
    } else {
      $('#noHid').classList.remove('hidden');
    }

    // desktop shell: device picker + definitions folder button
    if (desktop) {
      desktop.onChooseDevice(showDevicePicker);
      $('#btnOpenDefs').classList.remove('hidden');
      $('#btnOpenDefs').addEventListener('click', () => desktop.openDefinitionsFolder());
    }

    updateStatus();
  }

  window.App = { state: S, attach, detach, visibleKeys, toast, ask, setStatus, updateStatus, isTabActive, packOptions, unpackOptions, decodeMatrix };
  document.addEventListener('DOMContentLoaded', init);
})();
