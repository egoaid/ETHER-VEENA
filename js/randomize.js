/* ==========================================================================
   randomize.js — musically-constrained randomization.

   The point is *discovering interesting instruments*, not generating broken
   settings. Nothing here draws uniformly between a parameter's absolute
   min and max. Each parameter has a hand-picked useful window, several are
   drawn on a log scale, and related parameters are correlated (longer
   attack → longer release, big reverb → less delay, bright waveforms →
   darker filter, …). Categories are independent so the UI can offer
   Mapping / Synth / Effects / Root & Scale checkboxes.

   Pure logic (takes an `rng` so it can be tested with a seed); no DOM/audio.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/** A curated set of valid, musical scales (names must exist in scales.js). */
export const MUSICAL_SCALES = [
  'Major', 'Minor', 'Dorian', 'Mixolydian', 'Lydian', 'Phrygian',
  'Major Pentatonic', 'Minor Pentatonic', 'Blues', 'Harmonic Minor', 'Melodic Minor',
  'Hirajoshi', 'In-Sen', 'Kumoi', 'Bhairav', 'Phrygian Dominant', 'Whole Tone',
];

const between = (rng, [a, b]) => a + (b - a) * rng();
const logBetween = (rng, [a, b]) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * rng());
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const weighted = (rng, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1][0];
};
const round = (v, step) => Math.round(v / step) * step;

import { RANDOM_MAIN, RANDOM_CHIKARI, RUDRA_SA_PCS } from './rudraVeenaStrings.js';
import { SWARA_CENTS } from './ragas.js';

// -- Root & Scale ---------------------------------------------------------------

/** Scales with exactly seven notes per octave — the Harp needs these to lay out its real 47 strings. */
export const SEVEN_NOTE_SCALES = ['Major', 'Minor', 'Dorian', 'Mixolydian', 'Lydian', 'Phrygian', 'Harmonic Minor', 'Melodic Minor', 'Phrygian Dominant'];

/**
 * Instrument-aware: the Harp only gets 7-note scales (keeps ~47 strings and a
 * sensible range) and the Rudra Veena gets ragas, not scales.
 * @param {Function} rng
 * @param {{instrumentId?:string, ragaNames?:string[]}} [o]
 */
export function randomizeRootScale(rng = Math.random, o = {}) {
  if (o.instrumentId === 'rudra' && o.ragaNames?.length) return { rootPc: pick(rng, RUDRA_SA_PCS), scaleName: pick(rng, o.ragaNames) }; // Sa where Rudra players actually put it
  const rootPc = Math.floor(rng() * 12);
  if (o.instrumentId === 'harp') return { rootPc, scaleName: pick(rng, SEVEN_NOTE_SCALES) };
  return { rootPc, scaleName: pick(rng, MUSICAL_SCALES) };
}

/**
 * RUDRA VEENA TUNING for the day (the player decides: see rudraVeenaStrings.js). Mostly one of the researched presets (main strings ×
 * chikari), sometimes a freshly built custom set of four strictly ascending strings drawn from plausible swaras.
 * @returns {{tuning:string, chikariTuning:string, customMain0?:string, customMain1?:string, customMain2?:string, customMain3?:string}}
 */
export function randomizeRudraTuning(rng = Math.random) {
  const out = { tuning: weighted(rng, RANDOM_MAIN), chikariTuning: weighted(rng, RANDOM_CHIKARI) };
  if (rng() < 0.2) {
    // custom: lowest ∈ {Sa₋, Ma₋, Pa₋, Ni₋}, 2nd ∈ {Sa, Pa₋, Ma₋(if higher)}, 3rd ∈ {Pa, Sa, Ma}, top ∈ {Sa′, Pa′, Sa}
    const slots = [[[0, -1], [5, -1], [7, -1], [11, -1]], [[0, 0], [7, -1], [5, 0]], [[7, 0], [0, 0], [5, 0]], [[0, 1], [7, 1], [0, 0]]];
    const cents = ([slot, oct]) => SWARA_CENTS[slot] + 1200 * oct;
    for (let tries = 0; tries < 20; tries++) {
      const pickS = slots.map((list) => pick(rng, list));
      const c = pickS.map(cents);
      if (c.every((x, i) => i === 0 || x > c[i - 1])) {
        out.tuning = 'custom';
        pickS.forEach(([slot, oct], i) => { out[`customMain${i}`] = `${slot}:${oct}`; });
        break;
      }
    }
  }
  return out;
}

// -- Synth (generic Theremin voice) -----------------------------------------------

export function randomizeSynth(rng = Math.random) {
  const waveform = weighted(rng, [['sine', 3], ['triangle', 3], ['sawtooth', 2], ['square', 1.2]]);
  const harsh = waveform === 'sawtooth' || waveform === 'square';

  // Harsh waveforms already carry many harmonics: keep the filter lower and the
  // resonance gentler so the result stays pleasant rather than piercing.
  const brightness = harsh ? between(rng, [0.35, 0.72]) : between(rng, [0.5, 0.95]);
  const resonance = harsh ? between(rng, [0.05, 0.3]) : between(rng, [0.05, 0.45]);

  const attack = logBetween(rng, [0.01, 0.6]);
  // Slow attacks pair with somewhat longer releases.
  const release = Math.min(1.4, Math.max(0.1, attack * between(rng, [1, 2.5]) + between(rng, [0.08, 0.3])));
  const decay = logBetween(rng, [0.08, 0.8]);
  const sustain = between(rng, [0.6, 1]);

  const oscMix = rng() < 0.35 ? 0 : between(rng, [0.15, 0.7]);
  const oscDetune = oscMix === 0 ? 0 : (rng() < 0.5 ? 1 : -1) * between(rng, [3, 18]);

  const lfoTarget = weighted(rng, [['pitch', 6], ['filterCutoff', 2.5], ['amplitude', 1.5]]);
  const lfoRate = lfoTarget === 'pitch' ? between(rng, [4.2, 7]) : between(rng, [0.4, 6]);
  const lfoDepth = between(rng, [0.1, 0.55]);

  return {
    waveform,
    filterType: rng() < 0.9 ? 'lowpass' : 'bandpass',
    oscMix: round(oscMix, 0.01),
    oscDetune: Math.round(oscDetune),
    brightness: round(brightness, 0.01),
    resonance: round(resonance, 0.01),
    attack: round(attack, 0.005),
    decay: round(decay, 0.005),
    sustain: round(sustain, 0.01),
    release: round(release, 0.005),
    lfoTarget,
    lfoRate: round(lfoRate, 0.1),
    lfoDepth: round(lfoDepth, 0.01),
  };
}

/** Random values for an instrument's own parameters, inside each one's musical window. */
export function randomizeInstrumentParams(instrument, rng = Math.random) {
  const out = {};
  for (const d of instrument.params) {
    const [lo, hi] = d.random ?? [d.min + 0.25 * (d.max - d.min), d.min + 0.85 * (d.max - d.min)];
    const v = between(rng, [lo, hi]);
    out[d.key] = Math.min(d.max, Math.max(d.min, round(v, d.step)));
  }
  return out;
}

// -- Effects --------------------------------------------------------------------

export function randomizeEffects(rng = Math.random) {
  // Reverb is usually modest; occasionally lush.
  const reverbMix = rng() < 0.2 ? between(rng, [0.4, 0.6]) : between(rng, [0.05, 0.35]);
  const reverbSize = between(rng, [0.2, 0.8]);

  // Big reverb + big delay = mud, so a lush reverb thins out the delay.
  let delayMix = rng() < 0.3 ? 0 : between(rng, [0.08, 0.35]);
  if (reverbMix > 0.4) delayMix *= 0.5;
  const delayTime = between(rng, [0.12, 0.5]);
  const delayFeedback = between(rng, [0.15, 0.5]) * (delayMix > 0.25 ? 0.8 : 1);
  const pan = rng() < 0.7 ? 0 : between(rng, [-0.35, 0.35]);

  return {
    reverbMix: round(reverbMix, 0.01),
    reverbSize: round(reverbSize, 0.01),
    delayMix: round(delayMix, 0.01),
    delayTime: round(delayTime, 0.01),
    delayFeedback: round(delayFeedback, 0.01),
    pan: round(pan, 0.05),
  };
}

/** delay type: mostly the normal echo, sometimes the stereo ping-pong (Build 030: the Randomize lock "Delay type" keeps it) */
export function randomizeDelayMode(rng = Math.random) { return rng() < 0.3 ? 'pingpong' : 'normal'; }

// -- Mapping ---------------------------------------------------------------------
// Randomize Mapping rewrites the EXPRESSIVE layer only (Trigger → Destination rows);
// the performance inputs that make an instrument playable live in the controllers
// and are never touched. Sources come from the whole body — hand position/depth,
// every finger curl, and (when face tracking is on) the face and head — and the
// destination pool is instrument-specific (instrumentMappingProfiles.js).

import { expressivePool } from './instrumentMappingProfiles.js';

const HAND_POSITION = ['rightHandX', 'rightHandY', 'rightHandDepth', 'leftHandX', 'leftHandY', 'leftHandDepth'];
const FINGERS = ['rightThumb', 'rightIndex', 'rightMiddle', 'rightRing', 'rightPinky', 'leftThumb', 'leftIndex', 'leftMiddle', 'leftRing', 'leftPinky'];
const FACE = ['mouthOpen', 'smile', 'leftEye', 'rightEye', 'leftEyebrow', 'rightEyebrow', 'headYaw', 'headPitch', 'headRoll'];

/** Finger triggers (kept exported: other modules/tests use it to recognise playing inputs). */
export const FINGER_TRIGGERS = FINGERS;

/**
 * @param {Function} rng
 * @param {{includeFace?:boolean, instrumentId?:string, avoidTriggers?:string[]}} [o]
 * @returns {Array} rows in mapping.js `setMappings` format
 */
export function randomizeMapping(rng = Math.random, o = {}) {
  const avoid = new Set(o.avoidTriggers ?? []);
  const pool = expressivePool(o.instrumentId ?? 'theremin');
  const hands = HAND_POSITION.filter((t) => !avoid.has(t));
  const fingers = FINGERS.filter((t) => !avoid.has(t));
  const face = o.includeFace ? FACE.filter((t) => !avoid.has(t)) : [];

  // A varied, expressive set: always some fingers and some hand position; face when available.
  const count = Math.min(pool.length, 6 + Math.floor(rng() * 4)); // 6..9
  const sources = [];
  const take = (list, n) => { for (const t of shuffle(rng, [...list])) { if (n <= 0) break; if (!sources.includes(t)) { sources.push(t); n--; } } };
  take(fingers, 2 + Math.floor(rng() * 2));
  take(hands, 2);
  if (face.length) take(face, 2 + Math.floor(rng() * 2));
  take([...fingers, ...hands, ...face], count - sources.length);
  sources.length = Math.min(sources.length, count);

  const dests = shuffle(rng, [...pool]).slice(0, sources.length);
  const rows = dests.map((d, i) => {
    let min = between(rng, d.min);
    let max = between(rng, d.max);
    if (max - min < 0.16) max = Math.min(1, min + 0.2);
    return {
      trigger: sources[i],
      destination: d.id,
      min: round(min, 0.01),
      max: round(max, 0.01),
      invert: rng() < 0.15,
      smoothing: round(between(rng, [0.2, 0.5]), 0.05),
    };
  });

  // One trigger can drive several parameters: give two sources a second destination.
  const spare = shuffle(rng, pool.filter((d) => !rows.some((r) => r.destination === d.id)));
  for (let k = 0; k < 2 && spare.length; k++) {
    const d = spare.pop();
    const src = rows[Math.floor(rng() * rows.length)].trigger;
    if (rows.filter((r) => r.trigger === src).length >= 2) continue;
    let min = between(rng, d.min); let max = between(rng, d.max);
    if (max - min < 0.16) max = Math.min(1, min + 0.2);
    rows.push({ trigger: src, destination: d.id, min: round(min, 0.01), max: round(max, 0.01), invert: rng() < 0.15, smoothing: round(between(rng, [0.2, 0.5]), 0.05) });
  }

  // Correlation: a big reverb send makes a strong delay send muddy.
  const rev = rows.find((r) => r.destination === 'reverbMix');
  const del = rows.find((r) => r.destination === 'delayMix');
  if (rev && del && rev.max > 0.4) del.max = round(Math.max(del.max * 0.6, del.min + 0.16), 0.01);
  return rows;
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}


// -- Display (Build 028) ------------------------------------------------------------------------------------------
const hsvHex = (h, sat, v) => {
  const c = v * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return '#' + [r, g, b].map((k) => Math.round((k + m) * 255).toString(16).padStart(2, '0')).join('');
};

/**
 * A random but good-looking Display: camera filter (+ density, colours, music colour), glitch (usually off, and then gentle), body visual,
 * face HUD, background (camera or the mandala — never a colour/image, which need a file) and the CRT monitor. Same shape as a preset's `display`.
 */
export function randomizeDisplay(rng = Math.random, o = {}) {
  const privacy = !!o.privacy; // Privacy mode: never 'off', and no very fine (recognisable) polygons
  const filter = weighted(rng, [['off', privacy ? 0 : 1.2], ['facets', 2], ['crystal', 2], ['relief', 2], ['shards', 1.6]]);
  const colorMode = filter === 'off' ? 'original' : weighted(rng, [['original', 2], ['mono', 1.5], ['duo', 2]]);
  const h = rng() * 360; const h2 = (h + between(rng, [110, 220])) % 360;
  const glitchOn = rng() < 0.3;
  const background = weighted(rng, [['camera', 7], ['mandala', 3]]);
  return {
    filter,
    density: round(between(rng, privacy ? [0.2, 0.6] : [0.25, 0.85]), 0.01),
    colorMode,
    base: hsvHex(h, between(rng, [0.45, 0.9]), between(rng, [0.8, 1])),
    dark: hsvHex(h, between(rng, [0.6, 1]), between(rng, [0.08, 0.28])),
    bright: hsvHex(h2, between(rng, [0.35, 0.85]), between(rng, [0.85, 1])),
    music: weighted(rng, [['off', 2], ['audio', 2], ['pitch', 2], ['both', 2]]),
    glitch: glitchOn
      ? { amount: round(between(rng, [0.2, 0.65]), 0.01), frequency: round(between(rng, [0.15, 0.6]), 0.01), blockSize: round(between(rng, [0.25, 0.6]), 0.01), rgbSplit: round(between(rng, [0.2, 0.7]), 0.01), displace: round(between(rng, [0.2, 0.7]), 0.01), noise: round(between(rng, [0.35, 0.8]), 0.01), hold: round(between(rng, [0, 0.3]), 0.01) }
      : { amount: 0, frequency: 0.4, blockSize: 0.4, rgbSplit: 0.5, displace: 0.5, noise: 0.55, hold: 0.2 },
    bodyVisual: pick(rng, ['skeleton', 'mesh', 'face', 'reactive']),
    background,
    faceHud: pick(rng, ['outline', 'mask']),
    crt: { on: rng() < 0.25, amount: round(between(rng, [0.35, 0.85]), 0.01) },
  };
}
