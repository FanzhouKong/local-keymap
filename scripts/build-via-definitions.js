#!/usr/bin/env node
/* Local Keymap - packs the VIA keyboard definitions (github.com/the-via/keyboards, GPL-3.0) into
 * generated/via-definitions.json.br, so the app finds a keyboard's layout by its USB IDs without
 * asking for a file. Only what the keymap editor needs is kept (name, IDs, matrix, layouts,
 * custom keycodes); v3 definitions win over v2 ones for the same keyboard.
 *
 *   node scripts/build-via-definitions.js                 download the current master branch
 *   node scripts/build-via-definitions.js <dir|.tar.gz>   use a local checkout or archive
 *   node scripts/build-via-definitions.js --if-missing    do nothing when the bundle already exists */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'generated', 'via-definitions.json.br');
const ARCHIVE_URL = 'https://codeload.github.com/the-via/keyboards/tar.gz/refs/heads/master';

// ------------------------------------------------------------------ tar reading (ustar + pax, enough for GitHub archives)
function* tarEntries(buf) {
  let off = 0;
  let pax = {};
  let longName = null;
  const str = (a, b) => buf.toString('utf8', a, b).replace(/\0.*$/s, '');
  const parsePax = (data) => {
    const out = {};
    let i = 0;
    while (i < data.length) {
      const sp = data.indexOf(0x20, i);
      if (sp < 0) break;
      const len = parseInt(data.toString('utf8', i, sp), 10);
      if (!(len > 0)) break;
      const rec = data.toString('utf8', sp + 1, i + len - 1);
      const eq = rec.indexOf('=');
      if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
      i += len;
    }
    return out;
  };
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const size = parseInt(str(off + 124, off + 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = str(off + 345, off + 500);
    let name = str(off, off + 100);
    if (prefix) name = `${prefix}/${name}`;
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') { pax = parsePax(data); continue; }
    if (type === 'g') { yield { global: parsePax(data) }; continue; }
    if (type === 'L') { longName = data.toString('utf8').replace(/\0.*$/s, ''); continue; }
    if (type === '0' || type === '\0') yield { name: pax.path || longName || name, data };
    pax = {};
    longName = null;
  }
}

function* dirEntries(dir) {
  const walk = function* (d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) yield* walk(p);
      else if (ent.isFile()) yield { name: `keyboards/${path.relative(dir, p).split(path.sep).join('/')}`, data: fs.readFileSync(p) };
    }
  };
  for (const sub of ['src', 'v3']) {
    if (fs.existsSync(path.join(dir, sub))) yield* walk(path.join(dir, sub));
  }
}

// ------------------------------------------------------------------ definitions
const hexId = (v) => {
  const n = typeof v === 'number' ? v : parseInt(String(v), 16);
  return Number.isInteger(n) && n >= 0 && n <= 0xffff ? n : null;
};
const idKey = (vid, pid) => `${vid.toString(16).padStart(4, '0')}:${pid.toString(16).padStart(4, '0')}`;

function slim(json) {
  if (!json || typeof json !== 'object') return null;
  const vid = hexId(json.vendorId), pid = hexId(json.productId);
  const rows = +(json.matrix && json.matrix.rows), cols = +(json.matrix && json.matrix.cols);
  const keymap = json.layouts && json.layouts.keymap;
  if (vid === null || pid === null || !(rows > 0 && cols > 0) || !Array.isArray(keymap)) return null;
  const def = {
    name: typeof json.name === 'string' ? json.name : idKey(vid, pid),
    vendorId: `0x${vid.toString(16).toUpperCase().padStart(4, '0')}`,
    productId: `0x${pid.toString(16).toUpperCase().padStart(4, '0')}`,
    matrix: { rows, cols },
    layouts: { keymap },
  };
  if (Array.isArray(json.layouts.labels) && json.layouts.labels.length) def.layouts.labels = json.layouts.labels;
  if (Array.isArray(json.customKeycodes) && json.customKeycodes.length) {
    def.customKeycodes = json.customKeycodes.map((k) => ({ name: k.name, title: k.title, shortName: k.shortName }));
  }
  return { key: idKey(vid, pid), def };
}

async function getEntries(arg) {
  if (arg && fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return { entries: dirEntries(arg), source: arg };
  let gz;
  if (arg) {
    gz = fs.readFileSync(arg);
  } else {
    console.log(`Downloading ${ARCHIVE_URL}`);
    const res = await fetch(ARCHIVE_URL);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    gz = Buffer.from(await res.arrayBuffer());
  }
  return { entries: tarEntries(zlib.gunzipSync(gz)), source: arg || ARCHIVE_URL };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--if-missing') && fs.existsSync(OUT)) {
    console.log(`${path.relative(ROOT, OUT)} already exists`);
    return;
  }
  const input = args.find((a) => !a.startsWith('--'));
  const { entries } = await getEntries(input);

  const found = { v3: new Map(), src: new Map() };
  let commit = null, bad = 0;
  for (const e of entries) {
    if (e.global) { commit = e.global.comment || commit; continue; }
    const m = /^[^/]+\/(v3|src)\/.+\.json$/i.exec(e.name);
    if (!m) continue;
    let json;
    try { json = JSON.parse(e.data.toString('utf8').replace(/^﻿/, '')); } catch (_) { bad++; continue; }
    const s = slim(json);
    if (!s) { bad++; continue; }
    const bucket = found[m[1].toLowerCase()];
    if (!bucket.has(s.key)) bucket.set(s.key, s.def);
  }

  const definitions = {};
  for (const [k, d] of found.src) definitions[k] = d;
  for (const [k, d] of found.v3) definitions[k] = d; // v3 wins
  const keys = Object.keys(definitions).sort();
  const sorted = Object.fromEntries(keys.map((k) => [k, definitions[k]]));
  const bundle = {
    format: 'local-keymap-via-definitions',
    version: 1,
    source: 'https://github.com/the-via/keyboards',
    license: 'GPL-3.0',
    commit,
    generatedAt: new Date().toISOString(),
    count: keys.length,
    definitions: sorted,
  };
  const text = JSON.stringify(bundle);
  const packed = zlib.brotliCompressSync(Buffer.from(text), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: text.length },
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, packed);
  console.log(`${keys.length} keyboards (${found.v3.size} v3, ${found.src.size} v2, ${bad} skipped) from commit ${commit || 'unknown'}`);
  console.log(`${path.relative(ROOT, OUT)}: ${(packed.length / 1024).toFixed(0)} KB (${(text.length / 1048576).toFixed(1)} MB unpacked)`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
