/* ==========================================================================
   harpController.js — the 47-string spatial harp.

   Physical metaphor: strings stand vertically across the camera image; a
   fingertip that sweeps across one plucks it. Either hand, any finger, all
   at once; a hand swept across the field is a glissando.

   Strings are the selected scale's notes in ascending order starting near
   C1 (the concert harp's lowest string) up to at most C8 or 47 strings. A
   7-note scale gives exactly the real 47 strings (C1..G7); scales with
   fewer notes per octave give fewer strings because the range is bounded.
   Root-note strings are drawn red and the "fourth" dark, as on a real harp.

   Per-finger state (fingerState.js) carries the previous position; a string
   fires when the fingertip crosses its x. Protections (TWO gates, both needed):
     • the HAND must be open (≥3 extended fingers, with hysteresis) — a fist,
       a pointing hand or a hand being repositioned plays nothing
     • the individual FINGER must be extended (curled finger = muted)
     • same string can't retrigger from the same finger for 350 ms
       (unless it has travelled to a different string in between)
     • per-string cooldown across fingers (no double strikes)
     • a crossing is only CONFIRMED once the fingertip has travelled 40% of a
       string spacing past the string in the same direction — a real pluck
       carries through, tracking jitter that wobbles back and forth does not
     • teleport guard: an implausibly large jump (tracking glitch) is not a sweep
     • reacquisition after tracking loss never fires (fingerState resets prev)
   Velocity follows sweep speed. Pure logic — no DOM, no audio.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { SCALES } from './scales.js';

export const HARP_STRING_COUNT = 47;
const LOW_MIDI = 24; // C1
const HIGH_MIDI = 108; // C8
const X0 = 0.04;
const X1 = 0.96;
export const HARP_Y0 = 0.15; // strings span 15%–80% of the stage height: clear of the top
export const HARP_Y1 = 0.8; // controls and of the bottom corner buttons

const MAX_CURL_TO_PLAY = 0.45;
const SAME_STRING_COOLDOWN_MS = 350;
const STRING_COOLDOWN_MS = 140;
const TELEPORT_DX = 0.12; // stage widths per frame (≈3.6 stage-widths/s at 30 fps — faster than any real sweep)
const FULL_VELOCITY_SPEED = 1.4; // stage widths / second
const MIN_VELOCITY = 0.22;
const MAX_STRINGS_PER_FINGER_FRAME = 10;
const CONFIRM_TRAVEL = 0.4; // × string spacing

/**
 * @typedef {{i:number, midi:number, x:number, isRoot:boolean, isFourth:boolean}} HarpString
 * @returns {{strings: HarpString[], spacing:number}}
 */
export function buildHarpLayout({ rootPc, scaleName }) {
  const intervals = SCALES[scaleName] ?? SCALES.Major;
  const notes = [];
  for (let oct = 0; oct <= 9 && notes.length < HARP_STRING_COUNT; oct++) {
    for (const iv of intervals) {
      const midi = 12 * oct + rootPc + iv;
      if (midi < LOW_MIDI) continue;
      if (midi > HIGH_MIDI) break;
      notes.push({ midi, interval: iv });
      if (notes.length >= HARP_STRING_COUNT) break;
    }
  }
  const n = notes.length;
  const strings = notes.map((note, i) => ({
    i,
    midi: note.midi,
    x: n > 1 ? X0 + ((X1 - X0) * i) / (n - 1) : 0.5,
    isRoot: note.interval === 0,
    isFourth: note.interval === 5,
  }));
  return { strings, spacing: n > 1 ? (X1 - X0) / (n - 1) : 1 };
}

/** Nearby strings that should ring sympathetically with `stringIndex` (octave above, fifth above). */
export function sympatheticStrings(layout, stringIndex) {
  const base = layout.strings[stringIndex];
  if (!base) return [];
  const out = [];
  for (const iv of [12, 19]) {
    const s = layout.strings.find((c) => c.midi === base.midi + iv);
    if (s) out.push(s);
  }
  return out;
}

export class HarpController {
  constructor() {
    this.stringCooldownUntil = new Map(); // string index -> ms
    this.plucks = []; // recent plucks for the visual: {i, at, velocity}
    this._pending = new Map(); // finger id -> {dir, list:[{i, travel}]}
  }

  reset() {
    this.stringCooldownUntil.clear();
    this.plucks = [];
    this._pending.clear();
  }

  /**
   * @param {import('./fingerState.js').FingerTracker} tracker
   * @param {{strings:HarpString[], spacing:number}} layout
   * @param {number} nowMs
   * @param {{suppressSides?:Set<string>}} [o]
   * @returns {Array<{finger:any, string:HarpString, velocity:number}>} plucks to sound, in order
   */
  update(tracker, layout, nowMs, { suppressSides = new Set() } = {}) {
    const out = [];
    const strings = layout.strings;
    if (strings.length < 2) return out;
    const x0 = strings[0].x;
    const dx = layout.spacing;

    for (const f of tracker.fingers) {
      if (!f.present || f.confidence < 1 || suppressSides.has(f.side) || f.curl > MAX_CURL_TO_PLAY || !tracker.hands[f.side].open) { this._pending.delete(f.id); continue; }
      const a = f.prev.x;
      const b = f.pos.x;
      if (a === b) continue;
      if (Math.abs(b - a) > TELEPORT_DX || f.pos.y < HARP_Y0 || f.pos.y > HARP_Y1) { this._pending.delete(f.id); continue; }

      const dir = b > a ? 1 : -1;
      let st = this._pending.get(f.id);
      if (!st || st.dir !== dir) { st = { dir, list: [] }; this._pending.set(f.id, st); } // reversal cancels unconfirmed crossings
      const step = Math.abs(b - a);
      for (const c of st.list) c.travel += step;

      // strings crossed this frame
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const iLo = Math.max(0, Math.ceil((lo - x0) / dx - 1e-9));
      const iHi = Math.min(strings.length - 1, Math.floor((hi - x0) / dx + 1e-9));
      const crossed = [];
      for (let i = iLo; i <= iHi; i++) crossed.push(i);
      if (dir < 0) crossed.reverse();
      for (const i of crossed) st.list.push({ i, travel: Math.abs(b - strings[i].x) });

      // confirm the ones the finger has carried through
      const speed = Math.abs(f.vel.x);
      const velocity = Math.min(1, MIN_VELOCITY + (1 - MIN_VELOCITY) * (speed / FULL_VELOCITY_SPEED));
      const keep = [];
      let n = 0;
      for (const c of st.list) {
        if (c.travel < CONFIRM_TRAVEL * dx) { keep.push(c); continue; }
        if (n >= MAX_STRINGS_PER_FINGER_FRAME) continue;
        const i = c.i;
        if (f.lastNote === i && nowMs - f.lastTriggerAt < SAME_STRING_COOLDOWN_MS) continue;
        if ((this.stringCooldownUntil.get(i) ?? 0) > nowMs) continue;
        this.stringCooldownUntil.set(i, nowMs + STRING_COOLDOWN_MS);
        f.lastNote = i;
        f.lastTriggerAt = nowMs;
        out.push({ finger: f, string: strings[i], velocity });
        this.plucks.push({ i, at: nowMs, velocity });
        n++;
      }
      st.list = keep;
    }
    // keep the visual list short
    if (this.plucks.length > 64) this.plucks.splice(0, this.plucks.length - 64);
    return out;
  }
}
