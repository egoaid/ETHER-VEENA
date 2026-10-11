/* ==========================================================================
   gestures.js — the GESTURE INTERPRETER layer.

       BODY INPUT ─► GESTURE INTERPRETER ─► instrument performance model ─► sound
                     (this file)

   Raw finger curl is a noisy number. Treating "curl crossed a threshold" as
   "play a note" makes every instrument fragile: a trembling finger, a hand
   being repositioned or a tracking glitch all look the same as intent. This
   file turns raw input into DELIBERATE gestures, once, for everyone:

     DeliberatePressDetector   a finger pressing a key / striking a string
         IDLE ─(extended long enough)─► ARMED ─(fast, sustained closing)─►
         PRE-PRESS ─(closed far enough, soon enough)─► PRESSED ─(opened)─► IDLE
       A press needs: the finger to have been EXTENDED for a moment first, a
       sustained closing movement (not a single noisy frame), a large rise in
       curl, and the fingertip not to be sweeping across the screen. What the
       finger was pointing at is latched while it was extended (`aim`).

     HandOpenState             an OPEN hand (≥3 extended fingers), with hysteresis
     IndexOnlyState            the index-only pose (index out, others curled)

   Pure logic, time passed in — unit-tested with synthetic noise.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export const PRESS_DEFAULTS = {
  armCurl: 0.32, // finger counts as extended below this
  armMs: 60, // …for this long before it can press
  preCurl: 0.38, // closing is recognised from here
  pressCurl: 0.58, // the press fires when curl reaches this…
  riseMin: 0.3, // …having risen at least this much…
  windowMs: 400, // …within this time
  minClosure: 1.6, // curl units / s over the last ~110 ms (a deliberate press closes in well under half a second)
  releaseCurl: 0.3,
  releaseMs: 40,
  maxTipSpeed: 1.4, // stage units / s of the HAND (palm): faster = sweeping across, not pressing
  minVelocity: 0.25,
  fullClosure: 5, // closing speed that maps to velocity 1
};

export class DeliberatePressDetector {
  constructor(o = {}) {
    this.o = { ...PRESS_DEFAULTS, ...o };
    this.reset();
  }

  reset() {
    this.state = 'idle'; // idle | armed | pre | pressed
    this._lowSince = null;
    this._relSince = null;
    this._hist = [];
    this._aim = null;
    this._latched = null;
    this._preStart = 0;
    this._riseBase = 0;
    this._peak = 0;
  }

  get pressed() { return this.state === 'pressed'; }
  get latchedAim() { return this._latched; }

  /**
   * @param {{curl:number, now:number, tipSpeed?:number, aim?:any}} s
   * @returns {Array<{type:'press', velocity:number, aim:any}|{type:'release'}>}
   */
  update({ curl, now, tipSpeed = 0, aim = null }) {
    const o = this.o;
    const events = [];
    this._hist.push({ t: now, c: curl });
    while (this._hist.length > 2 && now - this._hist[0].t > 600) this._hist.shift();

    // closing speed over ~120 ms
    let closure = 0;
    for (let i = this._hist.length - 1; i >= 0; i--) {
      if (now - this._hist[i].t >= 110 || i === 0) {
        const dt = (now - this._hist[i].t) / 1000;
        closure = dt > 0.04 ? (curl - this._hist[i].c) / dt : 0;
        break;
      }
    }

    switch (this.state) {
      case 'idle':
        if (curl < o.armCurl) {
          if (this._lowSince === null) this._lowSince = now;
          if (now - this._lowSince >= o.armMs) { this.state = 'armed'; this._aim = aim; }
        } else this._lowSince = null;
        break;

      case 'armed':
        if (curl < o.armCurl) { this._aim = aim; break; } // still aiming: follow what it points at
        if (curl > o.preCurl) {
          if (closure >= o.minClosure && tipSpeed <= o.maxTipSpeed) {
            this.state = 'pre';
            this._preStart = now;
            this._riseBase = Math.min(...this._hist.filter((h) => now - h.t <= o.windowMs).map((h) => h.c));
            this._peak = closure;
          } else if (curl > 0.5) {
            // drifted closed slowly (or while sweeping): that is not a press
            this.state = 'idle';
            this._lowSince = null;
          }
        }
        break;

      case 'pre':
        this._peak = Math.max(this._peak, closure);
        if (curl >= o.pressCurl && curl - this._riseBase >= o.riseMin) {
          this.state = 'pressed';
          this._latched = this._aim;
          this._relSince = null;
          events.push({ type: 'press', velocity: Math.min(1, o.minVelocity + (1 - o.minVelocity) * (this._peak / o.fullClosure)), aim: this._latched });
        } else if (now - this._preStart > o.windowMs || curl < o.armCurl + 0.04) {
          this.state = 'idle';
          this._lowSince = null;
        }
        break;

      case 'pressed':
        if (curl < o.releaseCurl) {
          if (this._relSince === null) this._relSince = now;
          if (now - this._relSince >= o.releaseMs) {
            this.state = 'idle';
            this._lowSince = now; // already extended: it re-arms after armMs
            events.push({ type: 'release' });
          }
        } else this._relSince = null;
        break;
      default:
        break;
    }
    return events;
  }
}

/** Open hand: ≥3 of index..pinky extended (mean curl low), with hysteresis. */
export class HandOpenState {
  constructor({ enterMean = 0.3, exitMean = 0.46, enterMs = 40 } = {}) {
    this.enterMean = enterMean;
    this.exitMean = exitMean;
    this.enterMs = enterMs;
    this.reset();
  }
  reset() { this.open = false; this._since = null; }
  /** @param {{index:number,middle:number,ring:number,pinky:number}} c */
  update(c, now) {
    const four = [c.index, c.middle, c.ring, c.pinky];
    const mean = (four[0] + four[1] + four[2] + four[3]) / 4;
    const extended = four.filter((v) => v < 0.4).length;
    if (this.open) {
      if (mean > this.exitMean || extended < 3) { this.open = false; this._since = null; }
    } else if (mean < this.enterMean && extended >= 3) {
      if (this._since === null) this._since = now;
      if (now - this._since >= this.enterMs) this.open = true;
    } else this._since = null;
    return this.open;
  }
}

/** Index finger out, middle/ring/pinky curled (the pointing shape), with hysteresis. */
export class IndexOnlyState {
  constructor({ enterMs = 70 } = {}) {
    this.enterMs = enterMs;
    this.reset();
  }
  reset() { this.active = false; this._since = null; }
  update(c, now) {
    if (this.active) {
      if (c.index > 0.5 || Math.min(c.middle, c.ring, c.pinky) < 0.4) { this.active = false; this._since = null; }
    } else if (c.index < 0.32 && c.middle > 0.6 && c.ring > 0.55 && c.pinky > 0.45) {
      if (this._since === null) this._since = now;
      if (now - this._since >= this.enterMs) this.active = true;
    } else this._since = null;
    return this.active;
  }
}
