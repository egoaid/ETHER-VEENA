/* ==========================================================================
   smoothing.js — the One Euro filter (Casiez, Roussel, Vogel 2012).

   A fixed-alpha smoother forces a trade-off: enough smoothing to hide
   webcam-tracking jitter makes fast gestures laggy. The One Euro filter
   adapts: when the signal is nearly still it smooths heavily (kills jitter);
   when it moves fast the cutoff rises so it follows with little lag.
   That is exactly "stable but responsive" for a hand-played instrument.

     minCutoff  Hz — smoothing at rest (lower = steadier, laggier at rest)
     beta       how quickly the cutoff opens up with speed (higher = more responsive)
     dCutoff    Hz — smoothing of the speed estimate itself

   Time-aware (uses real dt), so it behaves the same at 30 and 60 fps.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const alphaFor = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroFilter {
  constructor({ minCutoff = 1.5, beta = 0.02, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this._x = null;
    this._dx = 0;
    this._t = null;
  }

  get value() {
    return this._x;
  }

  /** @param {number} x raw sample @param {number} tMs timestamp in ms @returns {number} filtered value */
  filter(x, tMs) {
    if (this._x === null) {
      this._x = x;
      this._t = tMs;
      return x;
    }
    const dt = Math.max(1e-3, (tMs - this._t) / 1000);
    this._t = tMs;
    const rawDx = (x - this._x) / dt;
    this._dx += alphaFor(this.dCutoff, dt) * (rawDx - this._dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this._dx);
    this._x += alphaFor(cutoff, dt) * (x - this._x);
    return this._x;
  }
}
