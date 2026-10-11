/* ==========================================================================
   events.js — turn a continuous 0..1 body signal into discrete EVENTS.

   The plucked instruments (Harp, Rudra
   Veena) all share one problem: a finger being *held* in a "triggering"
   position must produce exactly ONE note, not a machine-gun of notes, and
   webcam tracking jitter around the threshold must not re-trigger either.
   That is solved here once, generically, so no instrument re-implements it.

       value
         ▲
   on  ──┼──────────╱‾‾‾‾‾‾‾╲───────      arm ─ crossing `on` fires NOTE ON
         │         ╱  (held)  ╲                 (only while armed)
   off ──┼────────╱────────────╲──────      the signal must fall below `off`
         │                                   (hysteresis) before it re-arms;
         └──────────────────────────► t      that falling edge fires NOTE OFF

   Extra guards: a debounce window after each NOTE ON, and a velocity
   estimate taken from how fast the signal was rising when it crossed.

   Pure logic — no DOM, no audio, no MediaPipe. Web-testable in Node.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export class ThresholdEventDetector {
  /**
   * @param {Object} [o]
   * @param {number} [o.on=0.6]  value that must be reached to fire NOTE ON
   * @param {number} [o.off=0.3] value it must fall below to re-arm / fire NOTE OFF
   * @param {number} [o.debounceMs=90] minimum time between two NOTE ONs
   * @param {number} [o.speedForFullVelocity=6] rise speed (value units / second) that maps to velocity 1
   * @param {number} [o.minVelocity=0.3] velocity of the gentlest possible trigger
   */
  constructor(o = {}) {
    this.on = o.on ?? 0.6;
    this.off = o.off ?? 0.3;
    this.debounceMs = o.debounceMs ?? 90;
    this.speedForFullVelocity = o.speedForFullVelocity ?? 6;
    this.minVelocity = o.minVelocity ?? 0.3;
    this.reset();
  }

  reset() {
    this._armed = true;
    this._active = false;
    this._prevValue = null;
    this._prevTime = null;
    this._peakSpeed = 0;
    this._lastOnAt = -Infinity;
  }

  /**
   * Adopt the current value as the starting state without firing anything.
   * Used when a finger (re)appears: if it is already past the threshold it
   * must first fall below `off` before it can trigger, so reacquisition
   * never plays a phantom note.
   */
  prime(value) {
    this._prevValue = value;
    this._peakSpeed = 0;
    if (value >= this.on) {
      this._armed = false;
      this._active = false;
    }
  }

  /**
   * Feed one sample per frame.
   * @param {number} value 0..1 (e.g. finger curl)
   * @param {number} nowMs monotonic time in ms
   * @returns {Array<{type:'on'|'off', velocity?:number}>} zero, one or two events
   */
  update(value, nowMs) {
    const events = [];

    // Rise speed (units/s), with a short memory so the velocity reflects the
    // flick that *led to* the crossing, not only the single crossing frame.
    if (this._prevValue !== null && nowMs > this._prevTime) {
      const dt = (nowMs - this._prevTime) / 1000;
      const speed = Math.max(0, (value - this._prevValue) / dt);
      this._peakSpeed = Math.max(this._peakSpeed * 0.8, speed);
    }
    this._prevValue = value;
    this._prevTime = nowMs;

    if (this._armed && value >= this.on) {
      if (nowMs - this._lastOnAt >= this.debounceMs) {
        const v = this.minVelocity + (1 - this.minVelocity) * Math.min(1, this._peakSpeed / this.speedForFullVelocity);
        events.push({ type: 'on', velocity: Math.min(1, Math.max(this.minVelocity, v)) });
        this._lastOnAt = nowMs;
        this._active = true;
      }
      // Whether or not the debounce let it fire, we are past the threshold:
      // disarm so holding the finger there can never retrigger.
      this._armed = false;
    } else if (!this._armed && value <= this.off) {
      this._armed = true;
      if (this._active) {
        events.push({ type: 'off' });
        this._active = false;
      }
      this._peakSpeed = 0;
    }
    return events;
  }
}
