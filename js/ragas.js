/* ==========================================================================
   ragas.js — a small, practical raga model for the Rudra Veena.

   Not a Hindustani music theory engine: enough to get the *feel* right.

   • Swaras sit at JUST-INTONATION cents (SWARA_CENTS), not at 12-TET
     (Pa = 702¢ not 700¢, Ga = 386¢ not 400¢, …).
   • A raga lists which swaras are allowed going UP (aroha) and DOWN
     (avaroha) — several ragas differ in the two directions.
   • The left hand moves along a continuous RULER measured in semitones (just
     a geometric ruler: 24 frets over the neck). `ragaPitchCents()` maps a
     ruler position to a pitch in cents above Sa: exact at each allowed
     swara, continuous (meend) between them, with a soft "pull" that makes
     the pitch linger near swaras. Disallowed semitone positions are simply
     glided through.

   Everything is pure math: no DOM, no audio.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/** Just-intonation cents for the 12 swara slots above Sa. */
export const SWARA_CENTS = [0, 90.2, 203.9, 294.1, 386.3, 498.0, 590.2, 702.0, 792.2, 884.4, 996.1, 1088.3];

/** Sargam names per semitone slot (lowercase = komal, Ma' = tivra Ma). */
export const SWARA_NAMES = ['Sa', 're', 'Re', 'ga', 'Ga', 'Ma', "Ma'", 'Pa', 'dha', 'Dha', 'ni', 'Ni'];

const S = (str) => str.split(' ').map((n) => SWARA_NAMES.indexOf(n));

/**
 * @typedef {Object} Raga
 * @property {string} name
 * @property {number[]} aroha   allowed semitone slots (0..11) going up
 * @property {number[]} avaroha allowed slots going down
 * @property {number} vadi      characteristic (most important) swara slot — highlighted in the visual
 * @property {number} samvadi   second characteristic swara slot
 */

/** @type {Raga[]} */
export const RAGAS = [
  { name: 'Bilawal', aroha: S('Sa Re Ga Ma Pa Dha Ni'), avaroha: S('Sa Re Ga Ma Pa Dha Ni'), vadi: 9, samvadi: 2 },
  { name: 'Yaman', aroha: S("Sa Re Ga Ma' Pa Dha Ni"), avaroha: S("Sa Re Ga Ma' Pa Dha Ni"), vadi: 4, samvadi: 11 },
  { name: 'Bhairav', aroha: S('Sa re Ga Ma Pa dha Ni'), avaroha: S('Sa re Ga Ma Pa dha Ni'), vadi: 8, samvadi: 1 },
  { name: 'Bhairavi', aroha: S('Sa re ga Ma Pa dha ni'), avaroha: S('Sa re ga Ma Pa dha ni'), vadi: 5, samvadi: 0 },
  { name: 'Kafi', aroha: S('Sa Re ga Ma Pa Dha ni'), avaroha: S('Sa Re ga Ma Pa Dha ni'), vadi: 7, samvadi: 0 },
  { name: 'Khamaj', aroha: S('Sa Ga Ma Pa Dha Ni'), avaroha: S('Sa ni Dha Pa Ma Ga Re'), vadi: 4, samvadi: 11 },
  { name: 'Todi', aroha: S("Sa re ga Ma' Pa dha Ni"), avaroha: S("Sa re ga Ma' Pa dha Ni"), vadi: 8, samvadi: 3 },
  { name: 'Marwa', aroha: S("Sa re Ga Ma' Dha Ni"), avaroha: S("Sa re Ga Ma' Dha Ni"), vadi: 1, samvadi: 9 },
  { name: 'Purvi', aroha: S("Sa re Ga Ma' Pa dha Ni"), avaroha: S("Sa re Ga Ma' Pa dha Ni"), vadi: 4, samvadi: 1 },
  { name: 'Darbari', aroha: S('Sa Re ga Ma Pa dha ni'), avaroha: S('Sa Re ga Ma Pa dha ni'), vadi: 3, samvadi: 8 },
  { name: 'Malkauns', aroha: S('Sa ga Ma dha ni'), avaroha: S('Sa ga Ma dha ni'), vadi: 5, samvadi: 0 },
  { name: 'Bhoopali', aroha: S('Sa Re Ga Pa Dha'), avaroha: S('Sa Re Ga Pa Dha'), vadi: 4, samvadi: 9 },
];

export const RAGA_NAMES = RAGAS.map((r) => r.name);
export const ragaByName = (name) => RAGAS.find((r) => r.name === name) ?? RAGAS[2];

/**
 * Ruler positions (semitones above Sa) that are valid swaras, in ascending
 * order, with the JI pitch (cents above Sa) each one sounds at.
 * @param {Raga} raga
 * @param {'up'|'down'} direction
 * @param {number} centre ruler position the list must cover ±13 around
 */
export function swaraTargets(raga, direction, centre) {
  const slots = direction === 'down' ? raga.avaroha : raga.aroha;
  const oct = Math.floor(centre / 12);
  const out = [];
  for (let k = oct - 2; k <= oct + 2; k++) {
    for (const s of slots) out.push({ ruler: 12 * k + s, cents: 1200 * k + SWARA_CENTS[s], slot: s });
  }
  return out.sort((a, b) => a.ruler - b.ruler);
}

/**
 * Map a continuous ruler position to a pitch (cents above Sa).
 * Monotonic and continuous; exact at each allowed swara.
 * @param {number} ruler semitones above Sa on the neck ruler (may be slightly negative)
 * @param {Raga} raga
 * @param {{pull?:number, direction?:'up'|'down'}} [o] pull 0..1: how strongly pitch lingers on swaras
 * @returns {{cents:number, target:{ruler:number,cents:number,slot:number}, nearest:{ruler:number,cents:number,slot:number}}}
 */
export function ragaPitchCents(ruler, raga, { pull = 0.5, direction = 'up' } = {}) {
  const t = swaraTargets(raga, direction, ruler);
  let lo = t[0];
  let hi = t[t.length - 1];
  for (let i = 0; i < t.length - 1; i++) {
    if (ruler >= t[i].ruler && ruler < t[i + 1].ruler) { lo = t[i]; hi = t[i + 1]; break; }
  }
  const u = Math.min(1, Math.max(0, (ruler - lo.ruler) / (hi.ruler - lo.ruler)));
  const p = 1 + Math.max(0, pull) * 4;
  const shaped = u < 0.5 ? 0.5 * Math.pow(2 * u, p) : 1 - 0.5 * Math.pow(2 * (1 - u), p);
  return { cents: lo.cents + shaped * (hi.cents - lo.cents), target: shaped < 0.5 ? lo : hi, nearest: u < 0.5 ? lo : hi };
}

/**
 * Track melodic direction with hysteresis so the aroha/avaroha set doesn't
 * flicker: switches only after the ruler has moved > `threshold` semitones the other way.
 */
export class DirectionTracker {
  constructor(threshold = 0.9) {
    this.threshold = threshold;
    this.direction = 'up';
    this._anchor = null;
  }
  reset() { this.direction = 'up'; this._anchor = null; }
  update(ruler) {
    if (this._anchor === null) { this._anchor = ruler; return this.direction; }
    const d = ruler - this._anchor;
    if (d > this.threshold) { this.direction = 'up'; this._anchor = ruler; }
    else if (d < -this.threshold) { this.direction = 'down'; this._anchor = ruler; }
    else if ((this.direction === 'up' && d < 0) || (this.direction === 'down' && d > 0)) this._anchor = ruler; // track extremes
    return this.direction;
  }
}
