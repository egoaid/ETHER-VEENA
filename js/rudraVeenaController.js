/* ==========================================================================
   rudraVeenaController.js — the Rudra Veena performance model (build 009).

   Seven strings (see rudraVeenaStrings.js): four MAIN melody strings in
   horizontal lanes over the neck, three CHIKARI strings in their own cluster.

   LEFT hand = the neck
     index fingertip X  → fret position on a continuous ruler, FRET 0..24
                          (left = lower pitch, right = higher pitch)
     index fingertip Y  → which MAIN string it hovers over (lane, hysteresis)
     index CURL         → BEND. Once a main string has been plucked, curling the left index finger raises that
                          string's pitch the way a pulled string does: slowly at first (tension grows with the SQUARE of the
                          pull), then faster, flattening toward the maximum (nothing below curl 0.30, a few cents around 0.35,
                          small at 0.40, medium at 0.50, strong at 0.60, maximum from 0.70). The pitch follows through a
                          lightly damped spring (it settles like a string, snaps back a little faster than it rises) and a
                          bent string is never perfectly still: a faint waver, strongest mid-bend, nil at rest and at the
                          full stretch. The maximum is the Meend range parameter. Palm up/down travel does not bend.
                          SLIDE AND BEND ARE INDEPENDENT: while the finger is curled the fret follows the HAND (palm),
                          not the fingertip (curling moves the tip, not the hand), so you can slide along the neck while
                          bending, and curling alone never moves the fret. The string stays latched while curled.
     small deliberate wobble → andolan (shared VibratoDetector)
     aroha/avaroha follow the direction of travel
   RIGHT hand = the plectrum   (RUDRA-ONLY pluck logic below; other instruments keep DeliberatePressDetector)
     index / middle / ring: extend the finger over a string (aim), CURL it a little → the string sounds;
                          extend again to pluck again. No speed condition: bending the finger IS the pluck.
                          armed/pressed hysteresis stops noise from sounding twice.
     pinky              → chikari strum: all chikari strings in quick succession

   Only the fretted (active) string follows the left hand; the other main
   strings ring at their open tuning, as on the real instrument.
   Tracking loss: the string holds its pitch, then releases after 0.6 s.
   Pure logic — no DOM, no audio.   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { DirectionTracker } from './ragas.js';
import { OneEuroFilter } from './smoothing.js';
import { VibratoDetector } from './vibrato.js';
import {
  frettedCents,
  mainLaneAt,
  chikariLaneAt,
  mainLaneCenter,
  MAIN_LANE_H,
  MAIN_LANES_Y0,
  MAIN_LANES_Y1,
  NECK_X0,
  NECK_X1,
  onNeck,
} from './rudraVeenaStrings.js';

const LANE_SWITCH_MARGIN = 0.32; // fraction of a lane beyond its edge before switching (hysteresis)
const CONTACT_ON = 0.3; // index curl that latches the string + fret (and starts the bend)…
const CONTACT_OFF = 0.2; // …and lets go

/**
 * Left-index curl → bend amount 0..1 on a TENSION curve (build 021; build 020's straight-line knots felt linear).
 * A string pulled sideways by d is stretched by ≈ d²/2L, so its tension — and its pitch — rises with the SQUARE of the pull at first,
 * and the logarithmic cents scale then flattens the top:   u = ln(1 + (A·d)²) / ln(1 + A²),  d = (curl − 0.30) / 0.40.
 *   curl 0.30 → 0   0.35 → 0.05   0.40 → 0.15 (small)   0.50 → 0.45 (medium)   0.60 → 0.74 (strong)   0.70+ → 1 (maximum)
 * Fine control: the first 0.1 of curl gives only ~0.03 of the range (a few cents), so small inflections are easy.
 */
export const BEND_CURL0 = 0.3;
export const BEND_CURL1 = 0.7;
export const BEND_TENSION_A = 2.2;
export function bendFromCurl(curl) {
  const d = Math.min(1, Math.max(0, (curl - BEND_CURL0) / (BEND_CURL1 - BEND_CURL0)));
  return Math.log(1 + (BEND_TENSION_A * d) ** 2) / Math.log(1 + BEND_TENSION_A ** 2);
}

/** Pitch dynamics of the bent string: a lightly damped spring (rises ≈ 7 Hz, snaps back ≈ 10 Hz) + a faint waver while bent. */
export const BEND_DYN = { riseHz: 7, fallHz: 10, zeta: 0.9, waverCents: 14, waverHz: [4.7, 7.9] };
export class BendString {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.v = 0; }
  /** @param {number} u target bend 0..1  @param {number} maxCents  @param {number} dtMs  @param {number} tMs */
  step(u, maxCents, dtMs, tMs) {
    const target = u * maxCents;
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    const w = 2 * Math.PI * (target >= this.x ? BEND_DYN.riseHz : BEND_DYN.fallHz);
    // semi-implicit spring toward the target, in ≤ 4 ms sub-steps (a camera frame of 33 ms would be unstable at ω ≈ 70 rad/s)
    const n = Math.max(1, Math.ceil(dt / 0.004)); const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * BEND_DYN.zeta * w * this.v) * h;
      this.x += this.v * h;
    }
    if (Math.abs(target - this.x) < 0.3 && Math.abs(this.v) < 3) { this.x = target; this.v = 0; } // settled: land exactly (0 at rest, the cap at full stretch)
    this.x = Math.min(maxCents, Math.max(0, this.x));
    const t = tMs / 1000;
    const waver = BEND_DYN.waverCents * u * (1 - u) * (0.6 * Math.sin(2 * Math.PI * BEND_DYN.waverHz[0] * t) + 0.4 * Math.sin(2 * Math.PI * BEND_DYN.waverHz[1] * t + 1.1));
    return Math.min(maxCents, Math.max(0, this.x + (this.x > 0 ? waver : 0)));
  }
}

/** Rudra pluck: a finger that is EXTENDED aims; bending it a little sounds the string; extending it again re-arms it. */
export const PLUCK = { arm: 0.26, press: 0.42, velMin: 0.45, velMax: 0.95, fullCurlSpeed: 4 /* curl units / s that count as a hard stroke */ };
export class RudraPluckDetector {
  constructor() { this.reset(); }
  reset() { this.armed = false; this.aim = null; this._hist = []; }
  /** @returns {{aim:number|null, velocity:number}|null} an event when the finger is bent through `press` while armed */
  update({ curl, y, now }) {
    this._hist.push({ t: now, c: curl });
    while (this._hist.length > 1 && now - this._hist[0].t > 120) this._hist.shift();
    if (curl < PLUCK.arm) { this.armed = true; this.aim = y; } // extended: aiming (the aim stops following once the finger starts to curl)
    if (this.armed && curl >= PLUCK.press) {
      this.armed = false;
      const f = this._hist[0];
      const speed = now > f.t ? (curl - f.c) / ((now - f.t) / 1000) : 0;
      // loudness only — it never gates the pluck (a slow bend sounds too)
      const velocity = PLUCK.velMin + (PLUCK.velMax - PLUCK.velMin) * Math.min(1, Math.max(0, speed / PLUCK.fullCurlSpeed));
      return { aim: this.aim, velocity };
    }
    return null;
  }
}

/**
 * The pitch (cents above Sa) a sounding voice should have, or null to leave it alone.
 * Only the voices of the PLUCKED string bend: the fretted string follows the ruler (+ the bend when it is the
 * plucked one); a plucked-but-not-fretted string bends from its own pluck pitch; nothing else is touched.
 * @param {{active:number, baseCents:number, bendCents:number, bendString:number|null}} out
 * @param {{tag:any, originCents:number}} v
 */
export function rudraVoicePitch(out, v) {
  if (typeof v.tag !== 'string' || !v.tag.startsWith('main-')) return null; // chikari / sympathetic strings never bend
  const idx = Number(v.tag.slice(5));
  if (out.active === null) return null; // left hand away from the strings: every ringing string keeps its pitch
  if (idx === out.active) return out.baseCents + (out.bendString === idx ? out.bendCents : 0);
  if (idx === out.bendString) return v.originCents + out.bendCents;
  return null;
}

export class RudraController {
  constructor() {
    this.direction = new DirectionTracker();
    this.andolan = new VibratoDetector({ minRateHz: 3, maxRateHz: 8, minAmplitude: 0.004, maxAmplitude: 0.04 });
    this._curlFilter = new OneEuroFilter({ minCutoff: 2.5, beta: 1.0 }); // light smoothing: the bend must feel immediate
    this._bend = new BendString();
    this._dets = new Map(); // right-hand finger name → RudraPluckDetector
    this.reset();
  }

  reset() {
    this.direction.reset();
    this.andolan.reset();
    this.ruler = 0;
    this.activeString = 1; // default: the Sa string
    this.cents = 0; // pitch of the active (fretted) string incl. bend
    this.baseCents = 0;
    this.bendCents = 0;
    this.target = null;
    this.andolanState = { active: false, rateHz: 0, depth01: 0 };
    this.trail = [];
    this.strokes = []; // for the visual: {at, kind:'main'|'chikari'|'strum', index}
    this._leftLostAt = null;
    this._releasedForLoss = false;
    this._fretted = false;
    this._fretting = false; // the left index is over the strings
    this.contact = false; // left index curled (string + fret latched, bend active)
    this.pull = { x: 0, dy: 0 }; // for the visual: string deflection toward the fingertip
    this.bendString = null; // index of the most recently plucked main string = the one the left curl bends
    this.bendU = 0; // 0..1 bend amount from the left index curl
    this._restRuler = 0; // ruler while the left index was last relaxed
    this._restPalmX = 0; // palm X at that moment (the hand's own travel is measured from here while curled)
    this._rOff = 0; // smoothly decaying offset that keeps the ruler continuous when its source changes
    this._rPrev = 0;
    this._tPrev = null;
    this._bend.reset();
    this._curlFilter.reset();
    this._dets.clear();
  }

  /**
   * @param {import('./fingerState.js').FingerTracker} tracker
   * @param {{left:{x:number,y:number}|null}} hand
   * @param {{span:number, snap:number, meendRange:number}} params
   * @param {import('./ragas.js').Raga} raga
   * @param {{melody:Array, chikari:Array}} tuning
   * @param {number} nowMs
   * @returns {{cents:number, baseCents:number, bendCents:number, bendString:number|null, ruler:number, active:number, strokes:Array, releaseAll:boolean}}
   */
  update(tracker, hand, params, raga, tuning, nowMs) {
    const li = tracker.byId['left-index'];
    const releaseAll = false; // open strings keep ringing whether or not the left hand is visible
    const str = () => tuning.melody[this.activeString] ?? tuning.melody[0];

    // ---- RIGHT hand first (a pluck decides which string the left curl bends) ----
    const strokes = [];
    const nChik = tuning.chikari.length;
    for (const name of ['index', 'middle', 'ring', 'pinky']) {
      const f = tracker.byId[`right-${name}`];
      const det = this._dets.get(name) ?? this._dets.set(name, new RudraPluckDetector()).get(name);
      if (!f.present) { det.reset(); continue; }
      const ev = det.update({ curl: f.curl, y: f.pos.y, now: nowMs });
      if (!ev) continue;
      if (name === 'pinky') { strokes.push({ kind: 'strum', velocity: ev.velocity }); continue; } // the chikari: pinky anywhere
      const y = ev.aim ?? f.pos.y;
      const chik = chikariLaneAt(y, nChik);
      if (chik !== null) {
        // over the chikari cluster ONLY the ring finger (and the pinky above) plays it; index/middle do nothing there
        if (name === 'ring') strokes.push({ kind: 'chikari', index: chik, velocity: ev.velocity });
        continue;
      }
      // a main string: the lane under the finger. With the left hand on the strings and nothing under the finger, the fretted
      // string; with the left hand away, an aim outside the strings plays nothing. Unfretted strings sound OPEN.
      const index = mainLaneAt(y) ?? (this._fretting ? this.activeString : null);
      if (index === null) continue;
      strokes.push({ kind: 'main', index, velocity: ev.velocity });
      this.bendString = index; // the left curl now bends THIS string's voice
    }

    // ---- LEFT hand ----
    // The fretting hand counts only while the index fingertip is OVER the strings (or hooked on one by a curl). Away from them no
    // string is "selected": every main string is open, and nothing is fretted, bent or latched.
    const onStrings = li.present && (this.contact || onNeck(li.pos.x, li.pos.y));
    this._fretting = onStrings;
    if (onStrings) {
      this._fretted = true;

      const y = li.pos.y;
      const curl = this._curlFilter.filter(li.curl, nowMs);
      const wasContact = this.contact;
      this.contact = this.contact ? curl > CONTACT_OFF : curl > CONTACT_ON;

      // ruler position (left = low, right = high).
      // Relaxed finger: the fingertip. Curled finger: the HAND (palm) — curling moves the tip, not the hand — measured from where the
      // finger was last relaxed. So sliding works while bending and curling alone never moves the fret. An offset keeps the ruler
      // continuous whenever the source changes and fades out over ≈ 0.14 s.
      const W = NECK_X1 - NECK_X0;
      const palmL = tracker.hands.left.palm;
      const tipRuler = Math.min(1.04, Math.max(-0.04, (li.pos.x - NECK_X0) / W)) * params.span;
      let raw = tipRuler;
      if (this.contact && palmL) raw = Math.min(1.04 * params.span, Math.max(-0.04 * params.span, this._restRuler + ((palmL.x - this._restPalmX) / W) * params.span));
      if (!this.contact && curl < CONTACT_OFF) { this._restRuler = tipRuler; this._restPalmX = palmL ? palmL.x : li.pos.x; }
      const dtS = this._tPrev === null ? 0 : Math.max(0, (nowMs - this._tPrev) / 1000);
      const switched = this.contact !== wasContact;
      if (this._tPrev === null) this._rOff = 0;
      else if (switched) this._rOff += this._rPrev - (raw + this._rOff);
      else this._rOff *= Math.exp(-dtS / 0.14);
      this.ruler = raw + this._rOff;
      this._rPrev = this.ruler;
      this._tPrev = nowMs;

      if (!this.contact) {
        // hovering: the lane under the fingertip picks the string (hysteresis around the current lane)
        const centre = mainLaneCenter(this.activeString);
        const beyond = Math.abs(y - centre) - MAIN_LANE_H * (0.5 + LANE_SWITCH_MARGIN);
        if (beyond > 0 || y < MAIN_LANES_Y0 || y > MAIN_LANES_Y1) {
          const lane = mainLaneAt(y, 1) ?? this.activeString;
          this.activeString = Math.min(tuning.melody.length - 1, lane);
        }
      }

      const dir = this.direction.update(this.ruler);
      this.baseCents = frettedCents(str(), this.ruler, raga, { pull: params.snap, direction: dir });

      // BEND: the left index curl (non-linear), only once a main string has been plucked; never from palm motion
      this.bendU = this.bendString === null ? 0 : bendFromCurl(curl);
      this.bendCents = this._bend.step(this.bendU, params.meendRange * 100, dtS * 1000, nowMs); // spring + faint waver, ≤ the Meend range
      this.pull = { x: li.pos.x, dy: -this.bendU * 1.4 * MAIN_LANE_H }; // visual: the string lifts as it is bent
      this.cents = this.baseCents + (this.bendString === this.activeString ? this.bendCents : 0);
      this.target = null;
      if (hand.left) this.andolan.push(hand.left.x, nowMs);
      this.andolanState = this.andolan.analyze();
      this.trail.push({ t: nowMs, ruler: this.ruler });
    } else {
      this.andolan.reset();
      this.andolanState = { active: false, rateHz: 0, depth01: 0 };
      this.contact = false;
      this.bendU = 0;
      this.bendCents = 0;
      this._bend.reset();
      this._curlFilter.reset();
      this._tPrev = null;
      this._fretted = false;
    }
    while (this.trail.length && nowMs - this.trail[0].t > 1400) this.trail.shift();
    if (!this._fretted) this.cents = this.bendString !== null ? (tuning.melody[this.bendString] ?? tuning.melody[0]).cents : (tuning.melody[0]?.cents ?? 0); // nothing fretted: the open string last struck

    for (const s of strokes) this.strokes.push({ at: nowMs, kind: s.kind, index: s.index ?? -1 });
    if (this.strokes.length > 32) this.strokes.splice(0, this.strokes.length - 32);
    return {
      cents: this.cents, baseCents: this._fretted ? this.baseCents : this.cents, bendCents: this.bendCents, bendString: this.bendString,
      ruler: this.ruler, active: this._fretting ? this.activeString : null, fretting: this._fretting, strokes, releaseAll,
    };
  }
}
