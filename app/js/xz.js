/* Local Keymap - a small .xz (LZMA2) decompressor.
 * Vial keyboards keep their layout in the firmware as JSON packed with Python's lzma.compress(),
 * which is the .xz format with one LZMA2 filter and a CRC64 check. This decodes exactly that
 * (plus CRC32 / no check) and verifies the checksums, following the xz file format spec and the
 * reference LZMA decoder (LzmaSpec.cpp). Other filters (BCJ, delta) are rejected. */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ checksums
  let T32 = null;
  function crc32(b, s, e) {
    if (!T32) {
      T32 = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
        T32[i] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = s; i < e; i++) c = T32[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  let T64 = null;
  function crc64(b, s, e) {
    const P = 0xc96c5795d7870f42n, M = 0xffffffffffffffffn;
    if (!T64) {
      T64 = [];
      for (let i = 0; i < 256; i++) {
        let c = BigInt(i);
        for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ P : c >> 1n;
        T64.push(c);
      }
    }
    let c = M;
    for (let i = s; i < e; i++) c = T64[Number((c ^ BigInt(b[i])) & 0xffn)] ^ (c >> 8n);
    return c ^ M;
  }

  const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  const u64le = (b, i) => (BigInt(u32le(b, i + 4)) << 32n) | BigInt(u32le(b, i));
  const fail = (what) => { throw new Error(`Corrupt layout data (xz: ${what})`); };

  // ------------------------------------------------------------------ range decoder
  class RangeDecoder {
    constructor(buf, pos, end) {
      if (end - pos < 5 || buf[pos] !== 0) fail('bad range coder start');
      this.buf = buf;
      this.pos = pos + 5;
      this.end = end;
      this.range = 0xffffffff;
      this.code = buf[pos + 1] * 0x1000000 + (buf[pos + 2] << 16) + (buf[pos + 3] << 8) + buf[pos + 4];
      if (this.code === this.range) fail('bad range coder start');
    }

    normalize() {
      if (this.range < 0x1000000) {
        if (this.pos >= this.end) fail('chunk ended early');
        this.range *= 256;
        this.code = this.code * 256 + this.buf[this.pos++];
      }
    }

    bit(probs, i) {
      const p = probs[i];
      const bound = (this.range >>> 11) * p;
      let b;
      if (this.code < bound) {
        this.range = bound;
        probs[i] = p + ((2048 - p) >>> 5);
        b = 0;
      } else {
        this.range -= bound;
        this.code -= bound;
        probs[i] = p - (p >>> 5);
        b = 1;
      }
      this.normalize();
      return b;
    }

    tree(probs, base, bits) {
      let m = 1;
      for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, base + m);
      return m - (1 << bits);
    }

    reverse(probs, base, bits) {
      let m = 1, s = 0;
      for (let i = 0; i < bits; i++) {
        const b = this.bit(probs, base + m);
        m = (m << 1) | b;
        s |= b << i;
      }
      return s;
    }

    direct(bits) {
      let res = 0;
      for (let i = 0; i < bits; i++) {
        this.range = this.range >>> 1;
        let b = 0;
        if (this.code >= this.range) { this.code -= this.range; b = 1; }
        this.normalize();
        res = res * 2 + b;
      }
      return res;
    }
  }

  // ------------------------------------------------------------------ LZMA2
  const lenCoder = () => ({ choice: new Uint16Array(2), low: new Uint16Array(16 * 8), mid: new Uint16Array(16 * 8), high: new Uint16Array(256) });

  class Lzma2Decoder {
    constructor() {
      this.out = new Uint8Array(1 << 16);
      this.size = 0;
      this.dictStart = 0;
      this.lc = 0; this.lp = 0; this.pb = 0;
      this.isMatch = new Uint16Array(12 * 16);
      this.isRep = new Uint16Array(12);
      this.isRepG0 = new Uint16Array(12);
      this.isRepG1 = new Uint16Array(12);
      this.isRepG2 = new Uint16Array(12);
      this.isRep0Long = new Uint16Array(12 * 16);
      this.posSlot = new Uint16Array(4 * 64);
      this.posDec = new Uint16Array(115);
      this.align = new Uint16Array(16);
      this.matchLen = lenCoder();
      this.repLen = lenCoder();
      this.lit = new Uint16Array(0x300);
    }

    ensure(n) {
      if (this.size + n <= this.out.length) return;
      let cap = this.out.length;
      while (cap < this.size + n) cap *= 2;
      const o = new Uint8Array(cap);
      o.set(this.out.subarray(0, this.size));
      this.out = o;
    }

    setProps(b) {
      if (b >= 9 * 5 * 5) fail('bad properties');
      this.lc = b % 9;
      b = (b / 9) | 0;
      this.lp = b % 5;
      this.pb = (b / 5) | 0;
      if (this.lc + this.lp > 4 || this.pb > 4) fail('bad properties');
    }

    resetState() {
      this.state = 0;
      this.reps = [0, 0, 0, 0];
      const n = 0x300 << (this.lc + this.lp);
      if (this.lit.length !== n) this.lit = new Uint16Array(n);
      for (const a of [this.isMatch, this.isRep, this.isRepG0, this.isRepG1, this.isRepG2, this.isRep0Long,
        this.posSlot, this.posDec, this.align, this.lit,
        this.matchLen.choice, this.matchLen.low, this.matchLen.mid, this.matchLen.high,
        this.repLen.choice, this.repLen.low, this.repLen.mid, this.repLen.high]) a.fill(1024);
    }

    /** Decodes one LZMA2 stream starting at buf[pos]; returns the position after its end marker. */
    decode(buf, pos, end) {
      let needDictReset = true, needProps = true;
      for (;;) {
        if (pos >= end) fail('stream ended early');
        const control = buf[pos++];
        if (control === 0x00) return pos;
        if (control === 0x01 || control >= 0xe0) { this.dictStart = this.size; needDictReset = false; }
        else if (needDictReset) fail('missing dictionary reset');
        if (control >= 0x80) {
          if (pos + 4 > end) fail('stream ended early');
          const unpacked = ((control & 0x1f) << 16) + (buf[pos] << 8) + buf[pos + 1] + 1;
          const packed = (buf[pos + 2] << 8) + buf[pos + 3] + 1;
          pos += 4;
          if (control >= 0xc0) {
            if (pos >= end) fail('stream ended early');
            this.setProps(buf[pos++]);
            needProps = false;
            this.resetState();
          } else if (needProps) {
            fail('missing properties');
          } else if (control >= 0xa0) {
            this.resetState();
          }
          if (pos + packed > end) fail('stream ended early');
          this.chunk(buf, pos, pos + packed, unpacked);
          pos += packed;
        } else if (control <= 0x02) {
          if (pos + 2 > end) fail('stream ended early');
          const n = (buf[pos] << 8) + buf[pos + 1] + 1;
          pos += 2;
          if (pos + n > end) fail('stream ended early');
          this.ensure(n);
          this.out.set(buf.subarray(pos, pos + n), this.size);
          this.size += n;
          pos += n;
        } else {
          fail('bad chunk type');
        }
      }
    }

    lenOf(rc, L, posState) {
      if (rc.bit(L.choice, 0) === 0) return rc.tree(L.low, posState << 3, 3);
      if (rc.bit(L.choice, 1) === 0) return 8 + rc.tree(L.mid, posState << 3, 3);
      return 16 + rc.tree(L.high, 0, 8);
    }

    distance(rc, len) {
      const slot = rc.tree(this.posSlot, (len < 3 ? len : 3) << 6, 6);
      if (slot < 4) return slot;
      const bits = (slot >> 1) - 1;
      const dist = (2 | (slot & 1)) * 2 ** bits;
      if (slot < 14) return dist + rc.reverse(this.posDec, dist - slot, bits);
      return dist + rc.direct(bits - 4) * 16 + rc.reverse(this.align, 0, 4);
    }

    chunk(buf, start, end, unpacked) {
      const rc = new RangeDecoder(buf, start, end);
      this.ensure(unpacked);
      const out = this.out, lit = this.lit, lc = this.lc;
      const pbMask = (1 << this.pb) - 1, lpMask = (1 << this.lp) - 1;
      const limit = this.size + unpacked;
      let n = this.size, state = this.state;
      let [rep0, rep1, rep2, rep3] = this.reps;

      while (n < limit) {
        const pos = n - this.dictStart;
        const posState = pos & pbMask;
        if (rc.bit(this.isMatch, (state << 4) + posState) === 0) {
          // literal
          const prev = pos > 0 ? out[n - 1] : 0;
          const base = 0x300 * (((pos & lpMask) << lc) + (prev >> (8 - lc)));
          let sym = 1;
          if (state >= 7) {
            if (rep0 >= pos) fail('bad distance');
            let match = out[n - rep0 - 1];
            do {
              const mb = (match >> 7) & 1;
              match <<= 1;
              const b = rc.bit(lit, base + ((1 + mb) << 8) + sym);
              sym = (sym << 1) | b;
              if (mb !== b) break;
            } while (sym < 0x100);
          }
          while (sym < 0x100) sym = (sym << 1) | rc.bit(lit, base + sym);
          out[n++] = sym & 0xff;
          state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
          continue;
        }

        let len;
        if (rc.bit(this.isRep, state) === 1) {
          if (pos === 0) fail('repeat before any data');
          if (rc.bit(this.isRepG0, state) === 0) {
            if (rc.bit(this.isRep0Long, (state << 4) + posState) === 0) {
              // "short rep": one byte at the last distance
              state = state < 7 ? 9 : 11;
              out[n] = out[n - rep0 - 1];
              n++;
              continue;
            }
          } else {
            let dist;
            if (rc.bit(this.isRepG1, state) === 0) {
              dist = rep1;
            } else {
              if (rc.bit(this.isRepG2, state) === 0) dist = rep2;
              else { dist = rep3; rep3 = rep2; }
              rep2 = rep1;
            }
            rep1 = rep0;
            rep0 = dist;
          }
          len = this.lenOf(rc, this.repLen, posState);
          state = state < 7 ? 8 : 11;
        } else {
          rep3 = rep2; rep2 = rep1; rep1 = rep0;
          len = this.lenOf(rc, this.matchLen, posState);
          state = state < 7 ? 7 : 10;
          rep0 = this.distance(rc, len);
          if (rep0 === 0xffffffff) fail('unexpected end marker');
        }
        len += 2;
        if (rep0 >= pos) fail('bad distance');
        if (n + len > limit) fail('match runs past the chunk');
        let src = n - rep0 - 1;
        for (let k = 0; k < len; k++) out[n++] = out[src++];
      }

      this.size = n;
      this.state = state;
      this.reps = [rep0, rep1, rep2, rep3];
    }
  }

  // ------------------------------------------------------------------ .xz container
  const CHECK_SIZE = [0, 4, 4, 4, 8, 8, 8, 16, 16, 16, 32, 32, 32, 64, 64, 64];
  const MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00];

  function decompress(input) {
    const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (buf.length < 32 || MAGIC.some((b, i) => buf[i] !== b)) throw new Error('Not .xz data');
    if (buf[6] !== 0 || (buf[7] & 0xf0)) fail('unsupported stream flags');
    if (crc32(buf, 6, 8) !== u32le(buf, 8)) fail('header checksum');
    const check = buf[7] & 0x0f;
    const dec = new Lzma2Decoder();
    let pos = 12;

    for (;;) {
      if (pos >= buf.length) fail('missing index');
      if (buf[pos] === 0x00) break; // the index follows the last block
      const hstart = pos, hsize = (buf[pos] + 1) * 4;
      if (hstart + hsize > buf.length) fail('truncated block header');
      if (crc32(buf, hstart, hstart + hsize - 4) !== u32le(buf, hstart + hsize - 4)) fail('block header checksum');
      const flags = buf[hstart + 1];
      if (flags & 0x3c) fail('unsupported block flags');
      let p = hstart + 2;
      const varint = () => {
        let v = 0, mul = 1;
        for (let i = 0; i < 9; i++) {
          const b = buf[p++];
          v += (b & 0x7f) * mul;
          mul *= 128;
          if (!(b & 0x80)) return v;
        }
        return fail('bad number');
      };
      if (flags & 0x40) varint(); // compressed size
      if (flags & 0x80) varint(); // uncompressed size
      const filters = (flags & 3) + 1;
      for (let f = 0; f < filters; f++) {
        const id = varint(), propSize = varint();
        if (filters !== 1 || id !== 0x21 || propSize !== 1) throw new Error('This .xz data uses a filter other than plain LZMA2');
        if (buf[p] > 40) fail('bad dictionary size');
        p += propSize;
      }

      const outStart = dec.size;
      pos = dec.decode(buf, hstart + hsize, buf.length);
      while ((pos - hstart) % 4) if (buf[pos++] !== 0) fail('block padding');
      if (pos + CHECK_SIZE[check] > buf.length) fail('truncated check');
      if (check === 1 && crc32(dec.out, outStart, dec.size) !== u32le(buf, pos)) fail('CRC32 mismatch');
      if (check === 4 && crc64(dec.out, outStart, dec.size) !== u64le(buf, pos)) fail('CRC64 mismatch');
      pos += CHECK_SIZE[check];
    }
    return dec.out.slice(0, dec.size);
  }

  const api = { decompress };
  root.XZ = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
