/* Local Keymap - estimates a keyboard's polling rate from key event times.
 * A key change only reaches the computer in a USB report, and reports can only arrive on the
 * keyboard's polling ticks, so the gaps between reports are whole multiples of the polling interval.
 * The estimate is the slowest standard rate that (nearly) every gap fits. The browser's clock is
 * coarsened to 0.1 ms, so rates up to 2000 Hz are told apart exactly and faster ones roughly. */
(function (root) {
  'use strict';

  const RATES = [125, 250, 500, 1000, 2000, 4000, 8000];
  const SAME_REPORT = 0.05; // events closer than this came in the same report (ms)
  const BURST = 20; // gaps longer than this tell nothing (ms)
  const MIN_GAPS = 25;

  /** times: event timestamps in ms (key downs and ups, no auto-repeat), any order.
   * -> { events, reports, gaps, rate, kind: 'need-more' | 'exact' | 'over', histogram }
   *    kind 'over' = faster than 2000 Hz (the clock can't tell 4000 from 8000 Hz) */
  function estimate(times, opts = {}) {
    const jitter = opts.jitter || 0.12;
    const t = [...times].filter(Number.isFinite).sort((a, b) => a - b);
    const reports = [];
    for (const x of t) if (!reports.length || x - reports[reports.length - 1] > SAME_REPORT) reports.push(x);
    const gaps = [];
    for (let i = 1; i < reports.length; i++) {
      const g = reports[i] - reports[i - 1];
      if (g < BURST) gaps.push(g);
    }
    const histogram = new Array(16).fill(0); // 0.25 ms bins from 0 to 4 ms
    gaps.forEach((g) => { if (g < 4) histogram[Math.floor(g / 0.25)]++; });
    // gaps within the clock's noise may just be one report timestamped twice: they fit any rate
    const useful = gaps.filter((g) => g > jitter).length;
    const base = { events: t.length, reports: reports.length, gaps: useful, rate: null, kind: 'need-more', histogram };
    if (useful < MIN_GAPS) return base;

    // Fold every gap into one interval T. At the real rate the remainders bunch up at 0; a rate
    // that's too slow also gets a bunch half-way (at T/2), because the real ticks fall there too.
    const folded = (T) => {
      let atZero = 0, atHalf = 0;
      for (const g of gaps) {
        const r = g % T;
        if (Math.min(r, T - r) <= jitter) atZero++;
        else if (Math.abs(r - T / 2) <= jitter) atHalf++;
      }
      return { atZero: atZero / gaps.length, atHalf: atHalf / gaps.length };
    };
    for (const rate of RATES) {
      const T = 1000 / rate;
      if (T < 4 * jitter) break; // too fine for the clock to check
      const f = folded(T);
      if (f.atZero >= 0.4 && f.atZero >= 3 * f.atHalf) return { ...base, rate, kind: 'exact', steady: f.atZero >= 0.6 };
    }
    return { ...base, rate: 2000, kind: 'over', steady: true };
  }

  const api = { estimate, RATES };
  root.PollingRate = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
