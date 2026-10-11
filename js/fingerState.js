/* ==========================================================================
   fingerState.js — independent state for every tracked fingertip.

   Harp / Rudra Veena (and the UI cursor) need to know, per
   finger: where it is on screen, how fast it is moving, whether it is
   "down", and what it last played. A single shared pluck detector cannot do
   chords, two-handed playing or harp sweeps — so each of the 10 fingertips
   gets its own FingerState with its own event detector and filters.

   Positions are STAGE-normalized (see geometry.js): the same space the
   overlay, keyboard, strings and neck are drawn in.

   Tracking loss: a finger whose hand disappears keeps its last state for
   `graceMs` (flicker protection); after that it is marked absent and a
   'lost' event is emitted so controllers can release its notes. When the
   hand comes back the detector is *primed* with the current curl, so a
   finger that reappears already curled does not fire a phantom note.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { ThresholdEventDetector } from './events.js';
import { OneEuroFilter } from './smoothing.js';
import { computeFingerCurls } from './triggers.js';
import { HandOpenState } from './gestures.js';
import { videoToStage } from './geometry.js';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const TIP_INDEX = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };

export const DEFAULTS = {
  graceMs: 160,
  aimCurl: 0.3, // while curl is below this the fingertip position is "aim" (not yet pressing)
  press: { on: 0.55, off: 0.3, debounceMs: 70 },
};

export class FingerState {
  constructor(side, name) {
    this.side = side;
    this.name = name;
    this.id = `${side}-${name}`;
    this.present = false;
    this.confidence = 0; // 1 when tracked this frame, decays through the grace period
    this.pos = { x: 0, y: 0 }; // filtered, stage-normalized
    this.prev = { x: 0, y: 0 };
    this.vel = { x: 0, y: 0 }; // stage units / second
    this.aimPos = { x: 0, y: 0 }; // last position while the finger was extended: what it was pointing at
    this.curl = 0;
    this.pressed = false;
    this.velocity = 0; // velocity (0..1) of the most recent press
    this.note = null; // controller-owned: key/string currently held by this finger
    this.lastNote = null;
    this.lastTriggerAt = -Infinity; // controller-owned cooldown clock
    this.cooldownUntil = 0;
    this.seenAt = 0;
    this._fx = new OneEuroFilter({ minCutoff: 3.0, beta: 0.6 });
    this._fy = new OneEuroFilter({ minCutoff: 3.0, beta: 0.6 });
    this._det = new ThresholdEventDetector({ ...DEFAULTS.press });
    this._wasPresent = false;
  }

  reset() {
    this.present = false;
    this.confidence = 0;
    this.pressed = false;
    this.note = null;
    this.lastNote = null;
    this._fx.reset();
    this._fy.reset();
    this._det.reset();
    this._wasPresent = false;
  }
}

export class FingerTracker {
  constructor(options = {}) {
    this.graceMs = options.graceMs ?? DEFAULTS.graceMs;
    /** @type {FingerState[]} */
    this.fingers = [];
    /** @type {Object<string,FingerState>} */
    this.byId = {};
    for (const side of ['left', 'right']) {
      for (const name of FINGER_NAMES) {
        const f = new FingerState(side, name);
        this.fingers.push(f);
        this.byId[f.id] = f;
      }
    }
    this.events = []; // filled by update(): {type:'press'|'release'|'lost', finger}
    /** Per-hand state: `open` = an open hand (≥3 extended fingers, with hysteresis). Fist = false. */
    // `palm` = steady palm position (middle knuckle, stage coordinates): unlike a fingertip it does
    // not move when the fingers curl, so it is the right thing to measure hand travel with.
    this.hands = {
      left: { open: false, palm: null, _s: new HandOpenState(), _fx: new OneEuroFilter({ minCutoff: 2, beta: 0.5 }), _fy: new OneEuroFilter({ minCutoff: 2, beta: 0.5 }) },
      right: { open: false, palm: null, _s: new HandOpenState(), _fx: new OneEuroFilter({ minCutoff: 2, beta: 0.5 }), _fy: new OneEuroFilter({ minCutoff: 2, beta: 0.5 }) },
    };
  }

  reset() {
    for (const f of this.fingers) f.reset();
    this.events = [];
    for (const h of Object.values(this.hands)) { h._s.reset(); h.open = false; h.palm = null; h.palmSpeed = 0; h._pt = null; h._raw = null; h._fx.reset(); h._fy.reset(); }
  }

  /**
   * @param {{rightLandmarks:Array|null,leftLandmarks:Array|null}} hand HandControls.process() output
   * @param {import('./geometry.js').Geometry} geom
   * @param {number} nowMs
   * @returns {FingerState[]}
   */
  update(hand, geom, nowMs) {
    this.events = [];
    for (const side of ['left', 'right']) {
      const lm = side === 'left' ? hand.leftLandmarks : hand.rightLandmarks;
      const curls = lm ? computeFingerCurls(lm) : null;
      const h = this.hands[side];
      if (curls) {
        h.open = h._s.update(curls, nowMs);
        const pp = videoToStage(geom, lm[9].x, lm[9].y);
        const np = { x: h._fx.filter(pp.x, nowMs), y: h._fy.filter(pp.y, nowMs) };
        // palm travel speed (stage units/s): how fast the WHOLE HAND is moving — curling a finger does not change it
        // measured on the RAW palm point (the filtered one lags behind a fast sweep), lightly averaged
        const rawSpeed = h._raw ? Math.hypot(pp.x - h._raw.x, pp.y - h._raw.y) / Math.max(1e-3, (nowMs - h._pt) / 1000) : 0;
        h.palmSpeed = (h.palmSpeed ?? 0) * 0.5 + rawSpeed * 0.5;
        h._raw = { x: pp.x, y: pp.y };
        h._pt = nowMs;
        h.palm = np;
      } else { h._s.reset(); h.open = false; h.palm = null; h.palmSpeed = 0; h._pt = null; h._raw = null; h._fx.reset(); h._fy.reset(); }
      for (const name of FINGER_NAMES) {
        const f = this.byId[`${side}-${name}`];
        if (lm) this._track(f, lm[TIP_INDEX[name]], curls[name], geom, nowMs);
        else this._miss(f, nowMs);
      }
    }
    return this.fingers;
  }

  _track(f, tip, curl, geom, now) {
    const p = videoToStage(geom, tip.x, tip.y);
    const reacquired = !f._wasPresent;
    if (reacquired) {
      f._fx.reset();
      f._fy.reset();
    }
    f.prev = { x: f.pos.x, y: f.pos.y };
    f.pos = { x: f._fx.filter(p.x, now), y: f._fy.filter(p.y, now) };
    if (reacquired) {
      f.prev = { x: f.pos.x, y: f.pos.y };
      f.vel = { x: 0, y: 0 };
      // Come back already-curled → must open the finger before it can press again.
      f._det.reset();
      f._det.prime(curl);
      f.pressed = curl >= f._det.on;
      f.aimPos = { x: f.pos.x, y: f.pos.y };
    } else {
      const dt = Math.max(1e-3, (now - f.seenAt) / 1000);
      f.vel = { x: (f.pos.x - f.prev.x) / dt, y: (f.pos.y - f.prev.y) / dt };
    }
    f.curl = curl;
    f.present = true;
    f.confidence = 1;
    f.seenAt = now;
    f._wasPresent = true;
    if (curl < DEFAULTS.aimCurl) f.aimPos = { x: f.pos.x, y: f.pos.y };

    if (!reacquired) {
      for (const ev of f._det.update(curl, now)) {
        if (ev.type === 'on') {
          f.pressed = true;
          f.velocity = ev.velocity;
          this.events.push({ type: 'press', finger: f, velocity: ev.velocity });
        } else {
          f.pressed = false;
          this.events.push({ type: 'release', finger: f });
        }
      }
    }
  }

  _miss(f, now) {
    if (!f._wasPresent) return;
    const gone = now - f.seenAt;
    if (gone <= this.graceMs) {
      f.confidence = Math.max(0, 1 - gone / this.graceMs);
      f.vel = { x: 0, y: 0 };
      return;
    }
    // Grace period over: the finger is gone. Tell controllers exactly once.
    f.present = false;
    f.confidence = 0;
    f._wasPresent = false;
    const wasPressed = f.pressed;
    f.pressed = false;
    f.vel = { x: 0, y: 0 };
    this.events.push({ type: 'lost', finger: f, wasPressed });
  }
}
