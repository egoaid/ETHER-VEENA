/* ==========================================================================
   vibrato.js — detect intentional, sustained periodic hand motion and
   distinguish it from incoherent webcam-tracking jitter.

   Deliberately a tiny, dependency-free, position-only analyzer: it knows
   nothing about hands, audio, or MediaPipe. Feed it a single numeric
   signal over time (handControls.js feeds it the right hand's smoothed X
   position) and it reports whether that signal currently looks like a
   human vibrato gesture (a small, steady 3–9 Hz wobble) rather than either
   stillness or random noise.

   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export class VibratoDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowMs] How much recent history to analyze.
   *   Long enough to contain several cycles of a slow (3 Hz) vibrato,
   *   short enough that the detector reacts within a fraction of a second.
   * @param {number} [options.minRateHz] Below this, treat motion as a
   *   deliberate pitch move/glissando, not vibrato.
   * @param {number} [options.maxRateHz] Above this, treat motion as
   *   tracking noise — faster than any human hand actually oscillates.
   * @param {number} [options.minAmplitude] Below this (normalized
   *   display-space units), treat it as noise floor / held-still jitter.
   * @param {number} [options.maxAmplitude] Above this, treat it as a large
   *   intentional gesture rather than a fine vibrato wobble.
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs ?? 600;
    this.minRateHz = options.minRateHz ?? 3;
    this.maxRateHz = options.maxRateHz ?? 9;
    this.minAmplitude = options.minAmplitude ?? 0.006;
    this.maxAmplitude = options.maxAmplitude ?? 0.05;
    this._samples = []; // { t: ms, v: number }
  }

  reset() {
    this._samples = [];
  }

  /**
   * @param {number} value
   * @param {number} timestampMs
   */
  push(value, timestampMs) {
    this._samples.push({ t: timestampMs, v: value });
    const cutoff = timestampMs - this.windowMs;
    while (this._samples.length && this._samples[0].t < cutoff) {
      this._samples.shift();
    }
  }

  /**
   * @returns {{active: boolean, rateHz: number, depth01: number}}
   *   depth01 is 0 when inactive, otherwise how deep the wobble is within
   *   [minAmplitude, maxAmplitude], for scaling an audible effect.
   */
  analyze() {
    const n = this._samples.length;
    if (n < 6) return { active: false, rateHz: 0, depth01: 0 };

    let mean = 0;
    for (const s of this._samples) mean += s.v;
    mean /= n;

    let min = Infinity;
    let max = -Infinity;
    let crossings = 0;
    let prevSign = null;

    for (const s of this._samples) {
      const d = s.v - mean;
      if (d < min) min = d;
      if (d > max) max = d;
      const sign = d >= 0 ? 1 : -1;
      if (prevSign !== null && sign !== prevSign) crossings++;
      prevSign = sign;
    }

    const durationSec = (this._samples[n - 1].t - this._samples[0].t) / 1000;
    if (durationSec <= 0) return { active: false, rateHz: 0, depth01: 0 };

    // Each full oscillation crosses the mean twice, so crossings/2 cycles
    // occurred over durationSec — a simple, cheap stand-in for a proper
    // frequency estimate (FFT would be overkill for a single-tone wobble
    // over such a short window).
    const rateHz = crossings / 2 / durationSec;
    const amplitude = (max - min) / 2;

    const inRate = rateHz >= this.minRateHz && rateHz <= this.maxRateHz;
    const inAmplitude = amplitude >= this.minAmplitude && amplitude <= this.maxAmplitude;

    const depth01 = inAmplitude
      ? Math.min(1, (amplitude - this.minAmplitude) / (this.maxAmplitude - this.minAmplitude))
      : 0;

    return { active: inRate && inAmplitude, rateHz, depth01 };
  }
}
