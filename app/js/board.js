/* Local Keymap - renders a list of keys ({x, y, w, h, r, rx, ry, x2, y2, w2, h2, color, ei}) as keycaps. */
(function () {
  'use strict';

  function corners(k) {
    const rects = [[k.x, k.y, k.w, k.h]];
    if (k.w2 && k.h2) rects.push([k.x + (k.x2 || 0), k.y + (k.y2 || 0), k.w2, k.h2]);
    const pts = [];
    rects.forEach(([x, y, w, h]) => pts.push([x, y], [x + w, y], [x, y + h], [x + w, y + h]));
    if (!k.r) return pts;
    const a = (k.r * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    return pts.map(([px, py]) => {
      const dx = px - k.rx, dy = py - k.ry;
      return [k.rx + dx * c - dy * s, k.ry + dx * s + dy * c];
    });
  }

  /** Renders keys into host (replacing its content). Returns the key elements, same order as keys. */
  function render(host, keys, opts = {}) {
    host.innerHTML = '';
    if (!keys.length) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    keys.forEach((k) => corners(k).forEach(([x, y]) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }));
    const wU = maxX - minX, hU = maxY - minY;
    const cs = getComputedStyle(host);
    const inner = (host.clientWidth || 960) - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0);
    const avail = Math.max(320, inner - 2);
    const U = Math.max(22, Math.min(opts.maxUnit || 60, Math.floor(avail / wU)));
    const gap = Math.max(2, Math.round(U * 0.07));

    const board = document.createElement('div');
    board.className = 'board';
    board.style.width = `${Math.ceil(wU * U)}px`;
    board.style.height = `${Math.ceil(hU * U)}px`;
    board.style.setProperty('--u', `${U}px`);

    const els = keys.map((k) => {
      const el = document.createElement('div');
      el.className = `key ${k.color || 'alpha'}${k.ei !== undefined ? ' encoder' : ''}`;
      el.style.left = `${(k.x - minX) * U + gap / 2}px`;
      el.style.top = `${(k.y - minY) * U + gap / 2}px`;
      el.style.width = `${k.w * U - gap}px`;
      el.style.height = `${k.h * U - gap}px`;
      if (k.r) {
        el.style.transformOrigin = `${(k.rx - k.x) * U - gap / 2}px ${(k.ry - k.y) * U - gap / 2}px`;
        el.style.transform = `rotate(${k.r}deg)`;
      }
      if (k.w2 && k.h2 && (k.w2 !== k.w || k.h2 !== k.h || k.x2 || k.y2)) {
        const ext = document.createElement('div');
        ext.className = 'key-ext';
        ext.style.left = `${(k.x2 || 0) * U}px`;
        ext.style.top = `${(k.y2 || 0) * U}px`;
        ext.style.width = `${k.w2 * U - gap}px`;
        ext.style.height = `${k.h2 * U - gap}px`;
        el.appendChild(ext);
      }
      const cap = document.createElement('div');
      cap.className = 'cap';
      el.appendChild(cap);
      board.appendChild(el);
      return el;
    });
    host.appendChild(board);
    return els;
  }

  function setLabel(el, label) {
    const cap = el.lastChild;
    const text = label == null ? '' : String(label);
    if (cap.textContent === text) return;
    cap.textContent = text;
    const longest = Math.max(0, ...text.split('\n').map((l) => l.length));
    cap.classList.toggle('s', longest > 4 && longest <= 7);
    cap.classList.toggle('xs', longest > 7);
  }

  window.Board = { render, setLabel };
})();
