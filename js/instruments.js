/* ==========================================================================
   instruments.js — INSTRUMENT profiles.

   An instrument is DATA + two small pure functions:
     • `kind`   how the body plays it (see below)
     • `params` instrument-specific parameters (each has a range, default and
                a *musical* random range used by the Randomize feature)
     • `makeRecipe(params, {freq, velocity})`  →  a voices.js Recipe

   Instruments may also declare `options` (select menus such as the Rudra
   Veena's tuning). Options are choices, not sliders, and never mapping targets.

   kinds (each has its own physical playing metaphor, build 008):
     'continuous'  Theremin: continuous spatial pitch/volume (one always-on oscillator)
     'strings'     Harp: 47 vertical strings; a fingertip crossing a string plucks it
     'string-bend' Rudra Veena: left hand = neck (continuous swara/meend/bend),
                   right hand = plectrum (strokes + chikari drone strokes)

   Generic synth parameters (waveform, filter, ADSR, LFO, delay, reverb, pan)
   live in the Synth / Effects panels and belong to the Theremin voice; the
   parameters here belong to the instrument and are shown only for it.

   Not physical models — recognisable *behaviour* in a browser synth.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { MAIN_TUNINGS, CHIKARI_TUNINGS, SWARA_CHOICES, DEFAULT_TUNING_OPTIONS } from './rudraVeenaStrings.js';

const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtSec = (v) => `${v.toFixed(1)}s`;
const fmtInt = (v) => `${Math.round(v)}`;

export const POLYPHONY_CHOICES = [1, 2, 4, 6, 8, 12, 16, 20, 24, 32];
export const PLUCK_FINGERS = [
  { id: 'index', label: 'Index' },
  { id: 'middle', label: 'Middle' },
  { id: 'ring', label: 'Ring' },
  { id: 'pinky', label: 'Pinky' },
  { id: 'thumb', label: 'Thumb' },
];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Shared sympathetic-resonance partials (ring longer than the note itself). */
function resonancePartials(res, list) {
  if (res <= 0.01) return [];
  return list.map(([ratio, g, mul]) => ({ ratio, gain: g * res, decayMul: mul }));
}

/** Upper-partial brightness scale from the 0..1 "tone" parameter. */
const upperScale = (tone) => 0.3 + 1.4 * tone;

// ---------------------------------------------------------------------------

const THEREMIN = {
  id: 'theremin',
  name: 'Theremin',
  kind: 'continuous',
  blurb:
    'Continuous pitch and volume. Right hand → pitch, left hand → volume. Its controls live in Performance (sensitivity), Synth and Mapping.',
  defaultPolyphony: 1,
  params: [],
  makeRecipe: null,
};

/**
 * Harp string MATERIAL by register — two textures, no metal (build 017: the wound-steel bass, with its
 * noisy, clangy attack, was dropped; the bass now has the same warm, rounded gut character as the middle
 * strings, so the whole instrument sounds like one harp):
 *   LOW + MIDDLE  gut     warm, rounded, smooth attack, soft pluck, a clean harmonic series
 *   HIGH          nylon   short, hard, dry, crisp — strong click, almost no body
 * The zones blend over a few semitones so neighbouring strings never jump.
 * `material` (0..1, 0.5 = default) moves the gut→nylon boundary (higher = nylon starts lower = brighter, harder).
 */
const MATERIALS = {
  gut: { attack: 0.006, decayScale: 1.0, gains: [1, 0.42, 0.18, 0.07], partialSlope: 0.6, inharm: 0, noise: { level: 0.03, decay: 0.03, cutoff: 2200 }, body: 0.14, bright: 0.75, dampFactor: 1.0 },
  nylon: { attack: 0.0012, decayScale: 0.42, gains: [1, 0.4, 0.26, 0.15, 0.08], partialSlope: 0.9, inharm: 0.0002, noise: { level: 0.1, decay: 0.006, cutoff: 8000 }, body: 0, bright: 1.25, dampFactor: 1.3 },
};
const BLEND = 3; // semitones

export function harpZones(material = 0.5) {
  return { gutTop: 84 - (material - 0.5) * 12 };
}

/** 'gut' | 'nylon' for a MIDI note (used by the visual and the tests). */
export function harpMaterialZone(midi, material = 0.5) {
  return midi < harpZones(material).gutTop ? 'gut' : 'nylon';
}

const mix = (a, b, t) => a + (b - a) * t;

/**
 * Low registers get muddy when a deep fundamental, a sub-octave body partial, a long-ringing octave
 * resonance and a very long sustain stack up. Everything that adds low energy therefore fades IN with pitch
 * (the bass keeps the plain, clean gut harmonic series).
 */
const smooth01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const harpBodyScale = (midi) => smooth01(55, 70, midi);
export const harpResonanceScale = (midi) => smooth01(45, 70, midi);
/** Sympathetic strings only ring for notes from ~A2 upward, fading in until ~E4. */
export const harpSympatheticScale = (midi) => Math.min(1, Math.max(0, (midi - 45) / 20));
function blendMaterial(m1, m2, t) {
  const n = Math.max(m1.gains.length, m2.gains.length);
  const gains = Array.from({ length: n }, (_, i) => mix(m1.gains[i] ?? 0, m2.gains[i] ?? 0, t));
  return {
    attack: mix(m1.attack, m2.attack, t), decayScale: mix(m1.decayScale, m2.decayScale, t), gains,
    partialSlope: mix(m1.partialSlope, m2.partialSlope, t), inharm: mix(m1.inharm, m2.inharm, t),
    noise: { level: mix(m1.noise.level, m2.noise.level, t), decay: mix(m1.noise.decay, m2.noise.decay, t), cutoff: mix(m1.noise.cutoff, m2.noise.cutoff, t) },
    body: mix(m1.body, m2.body, t), bright: mix(m1.bright, m2.bright, t), dampFactor: mix(m1.dampFactor, m2.dampFactor, t),
  };
}

export function harpMaterialParams(midi, material = 0.5) {
  const z = harpZones(material);
  if (midi < z.gutTop - BLEND) return MATERIALS.gut;
  if (midi < z.gutTop + BLEND) return blendMaterial(MATERIALS.gut, MATERIALS.nylon, (midi - (z.gutTop - BLEND)) / (2 * BLEND));
  return MATERIALS.nylon;
}

const HARP = {
  id: 'harp',
  name: 'Harp',
  kind: 'strings',
  blurb:
    'Forty-seven strings stand across the picture: warm gut from the bass up through the middle, hard nylon on top. Sweep a fingertip across them — either hand, any fingers. Curl a finger to mute it.',
  defaultScale: 'Major',
  defaultPolyphony: 24,
  defaultEffects: { reverbMix: 0.42, reverbSize: 0.62 }, // a harp wants room; the reverb must be clearly audible
  holdUntilRelease: false,
  params: [
    { key: 'pluck', label: 'Pluck strength', min: 0, max: 1, step: 0.01, default: 0.6, format: fmtPct, random: [0.4, 0.85] },
    { key: 'decay', label: 'Decay', min: 0.6, max: 7, step: 0.1, default: 3.4, format: fmtSec, random: [2, 5] },
    { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.25, format: fmtPct, random: [0.05, 0.5] },
    { key: 'resonance', label: 'String resonance', min: 0, max: 1, step: 0.01, default: 0.4, format: fmtPct, random: [0.25, 0.7] },
    { key: 'sympathy', label: 'Sympathetic strings', min: 0, max: 1, step: 0.01, default: 0.35, format: fmtPct, random: [0.2, 0.6] },
    { key: 'material', label: 'Material: gut ↔ nylon', min: 0, max: 1, step: 0.01, default: 0.5, format: fmtPct, random: [0.3, 0.7] },
    { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, default: 0.55, format: fmtPct, random: [0.3, 0.85] },
  ],
  // Light on purpose: up to 24 voices + sympathetic strings must run on a phone.
  makeRecipe(p, { velocity, freq }) {
    const midi = 69 + 12 * Math.log2(freq / 440);
    const m = harpMaterialParams(midi, p.material);
    const up = upperScale(p.tone);
    // lower strings ring longer, capped so a bass tail never blurs under the reverb
    const registerScale = Math.min(1.25, Math.max(0.6, Math.pow(261 / freq, 0.2)));
    const tau = (p.decay * (1 - 0.85 * p.damping * m.dampFactor) * m.decayScale * registerScale) / 4;
    const metal = 0.5 + p.material; // how strongly inharmonicity shows
    const partials = m.gains.map((g, i) => ({
      ratio: (i + 1) * Math.sqrt(1 + m.inharm * metal * (i + 1) * (i + 1)),
      gain: i === 0 ? g : g * up,
      decayMul: 1 / (1 + i * m.partialSlope),
    }));
    const bodyGain = m.body * (0.4 + 0.6 * p.resonance) * harpBodyScale(midi);
    if (bodyGain > 0.01) partials.push({ ratio: 0.5, gain: bodyGain, decayMul: 1.3 });
    const resGain = 0.16 * p.resonance * harpResonanceScale(midi);
    if (resGain > 0.004) partials.push({ ratio: 2, gain: resGain, decayMul: 2.5 });
    return {
      wave: 'sine',
      partials,
      attack: m.attack,
      envTau: tau,
      sustain: 0,
      releaseTau: 0.25,
      peak: 0.22 + 0.7 * lerp(0.6, velocity, p.pluck),
      cutoffHz: (1200 + p.tone * 9000) * m.bright,
      cutoffVelocity: 0.5,
      noise: { level: m.noise.level * (0.4 + p.pluck), decay: m.noise.decay, cutoffHz: m.noise.cutoff },
    };
  },
  /** A very quiet, single-sine, long-ringing voice used for sympathetic resonance. */
  makeSympatheticRecipe(p, { freq, velocity }) {
    return {
      wave: 'sine',
      partials: [{ ratio: 1, gain: 1, decayMul: 1 }],
      attack: 0.02,
      envTau: (p.decay * 1.4) / 4,
      sustain: 0,
      releaseTau: 0.3,
      peak: 0.11 * p.sympathy * (0.4 + 0.6 * velocity) * harpSympatheticScale(69 + 12 * Math.log2(freq / 440)),
      cutoffHz: 5000,
      cutoffVelocity: 0,
      noise: null,
    };
  },
};

const tuningChoices = (list) => list.map((t) => ({ id: t.id, label: t.name }));
const swaraChoiceList = SWARA_CHOICES.filter((c) => c.oct >= -1 && c.oct <= 2).map((c) => ({ id: c.id, label: c.label }));
const isCustomMain = (o) => o.tuning === 'custom';
const isCustomChikari = (o) => o.chikariTuning === 'custom';

/** Per-string character of the four MAIN strings (index 0 = lowest). */
/**
 * CHIKARI SUSTAIN. How long a struck chikari rings, by stroke strength (velocity 0..1):
 *   audible length = 22 s (softest) … 36 s (hardest) — about 30 s for an ordinary stroke (velocity ≈ 0.6),
 *   and never shorter than 10 s (the 22 s floor is well above that).
 * "Audible length" = the time the FUNDAMENTAL stays above −40 dB of its start level.
 * NOTE: Voice multiplies the voice envelope (envTau) by each partial's own decay (envTau × decayMul), so the
 * fundamental (decayMul 1) decays with an effective time-constant of envTau / 2 — hence the factor 2 below.
 */
export const CHIKARI_MIN_SUSTAIN_S = 22;
export const CHIKARI_EXTRA_SUSTAIN_S = 14;
const LN_40DB = Math.log(100); // −40 dB amplitude ratio
export const chikariAudibleSeconds = (velocity) => CHIKARI_MIN_SUSTAIN_S + CHIKARI_EXTRA_SUSTAIN_S * clamp01(velocity);
export const chikariEnvTau = (velocity) => (2 * chikariAudibleSeconds(velocity)) / LN_40DB;
/** Starting phase of the khoomei-like harmonic sweep per string (the app passes a random one per strike so no two strokes sweep alike). */
export const CHIKARI_PHASE = [0.1, 0.45, 0.8];
/**
 * The chikari sustain is "overtone singing": a steady fundamental with a narrow, whistle-like resonance (≈1–3 kHz, two merged
 * bands) that glides slowly across the harmonics of the string, so overlapping overtones swell and fade into each other
 * (see formantCurve in voices.js for the research). Harmonics are exact (linear filtering of a harmonic source, no metal).
 */
export const chikariFormant = (phase) => ({
  harmonics: Array.from({ length: 16 }, (_, i) => i + 1),
  slope: 0.6, // 1/h^0.6 source spectrum
  gain: 0.2, // the focused harmonic sits ≈ −14 dB under the fundamental (was −10 dB)
  boost: 2.2, boostTau: 0.12, // brighter in the first ~0.3 s (the nail strike), then settles
  decayMul: 1.1,
  bands: [
    { q: 14, lo: 1000, hi: 3000, periods: [9.0, 4.3], phase },
    { q: 12, lo: 1300, hi: 3400, periods: [6.7, 3.1], phase: phase + 0.37 },
  ],
});
/** The three chikari strings are not clones: small, fixed differences in detune and decay (approximation of 3 close open strings). */
export const CHIKARI_STRING_VARIANT = [
  { pairCents: 2.6, decay: 1.0 },
  { pairCents: 3.8, decay: 0.94 },
  { pairCents: 5.0, decay: 1.07 },
];

const STRING_CHARACTER = [
  { sustain: 1.35, tone: -0.15, bloom: 0.6, resonance: 0.25, buzz: 0.6 }, // low: long, dark, heavy body
  { sustain: 1.15, tone: -0.05, bloom: 0.9, resonance: 0.1, buzz: 0.9 },
  { sustain: 1.0, tone: 0.05, bloom: 1.0, resonance: 0, buzz: 1.0 },
  { sustain: 0.8, tone: 0.2, bloom: 1.15, resonance: -0.15, buzz: 1.2 }, // high: shorter, brighter, more buzz
];

const RUDRA_VEENA = {
  id: 'rudra',
  name: 'Rudra Veena',
  kind: 'string-bend',
  blurb:
    'Four main strings (24 frets) and the chikari. Left hand = the neck: put your index fingertip over the strings and slide it along (left = lower, right = higher); its height picks the string. With the left hand away from the strings, every string is open — aim with your right hand and pluck. After you pluck a string, CURL your left index finger to bend it — the more you curl, the higher it goes — and straighten it to let it come back; you can keep sliding while you bend. Right hand = plectrum: hold index or middle over a string and bend the finger a little to pluck; straighten it to pluck again. The chikari is played by the RING finger or the PINKY only — bend either: one long voice, with a slowly moving overtone, rings for about 30 seconds (a harder stroke rings longer). The tuning menu offers the documented Rudra Veena tunings; Randomize (Root & Scale) picks a new one. Nothing sounds on its own unless you switch the drone on.',
  defaultPolyphony: 12,
  defaultEffects: { reverbMix: 0.38, reverbSize: 0.7 },
  holdUntilRelease: false,
  needsScaleRow: true,
  defaultScale: 'Bhairav', // a raga name (ragas.js), shown in the scale menu for this instrument
  options: [
    { key: 'droneMode', label: 'Drone / auto chikari cycle', choices: [{ id: 'off', label: 'Off — silent until you play' }, { id: 'on', label: 'On — tanpura-style background' }], default: 'off' },
    { key: 'tuning', label: 'Rudra Veena tuning', choices: tuningChoices(MAIN_TUNINGS), default: 'style-a' },
    ...[0, 1, 2, 3].map((i) => ({ key: `customMain${i}`, label: `Main string ${i + 1}`, choices: swaraChoiceList, default: DEFAULT_TUNING_OPTIONS.customMain[i], showIf: isCustomMain })),
    { key: 'chikariTuning', label: 'Chikari tuning', choices: tuningChoices(CHIKARI_TUNINGS), default: 'sa-sa-sa2' },
    ...[0, 1, 2].map((i) => ({ key: `customChikari${i}`, label: `Chikari ${i + 1}`, choices: swaraChoiceList, default: DEFAULT_TUNING_OPTIONS.customChikari[i], showIf: isCustomChikari })),
  ],
  params: [
    { key: 'pluck', label: 'Pluck strength', min: 0, max: 1, step: 0.01, default: 0.6, format: fmtPct, random: [0.45, 0.85] },
    { key: 'sustain', label: 'Sustain', min: 2, max: 14, step: 0.1, default: 8, format: fmtSec, random: [5, 11] },
    { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, default: 0.15, format: fmtPct, random: [0.05, 0.35] },
    { key: 'bloom', label: 'Harmonic bloom', min: 0, max: 1, step: 0.01, default: 0.6, format: fmtPct, random: [0.4, 0.85] },
    { key: 'jawari', label: 'Jawari / buzz', min: 0, max: 1, step: 0.01, default: 0.35, format: fmtPct, random: [0.2, 0.6] },
    { key: 'resonance', label: 'Body resonance', min: 0, max: 1, step: 0.01, default: 0.6, format: fmtPct, random: [0.4, 0.85] },
    { key: 'meendRange', label: 'Meend range (max bend)', min: 1, max: 8, step: 0.5, default: 4, format: (v) => `up to ${v} st`, random: [3, 6] },
    { key: 'span', label: 'Neck span (frets)', min: 7, max: 24, step: 1, default: 24, format: (v) => `${Math.round(v)} frets`, random: [20, 24] },
    { key: 'snap', label: 'Swara pull', min: 0, max: 1, step: 0.01, default: 0.45, format: fmtPct, random: [0.3, 0.65] },
    { key: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: 0.01, default: 0.12, format: fmtPct, random: [0.05, 0.3] },
    { key: 'andolan', label: 'Andolan depth', min: 0, max: 1, step: 0.01, default: 0.6, format: fmtPct, random: [0.4, 0.8] },
    { key: 'drone', label: 'Drone bed level (when Drone is On)', min: 0, max: 1, step: 0.01, default: 0.35, format: fmtPct, random: [0.2, 0.55] },
    { key: 'chikariLevel', label: 'Chikari level', min: 0, max: 1.5, step: 0.01, default: 1.0, format: fmtPct, random: [0.75, 1.25] },
    { key: 'tone', label: 'Tone', min: 0, max: 1, step: 0.01, default: 0.45, format: fmtPct, random: [0.3, 0.65] },
    { key: 'saOctave', label: 'Sa octave', min: 1, max: 4, step: 1, default: 2, format: (v) => `${Math.round(v)}`, random: [2, 2] },
  ],
  /**
   * A MAIN string. pluck → resonant harmonic body → sustained "biyo~n":
   *  • upper partials decay faster and BLOOM in after the attack (jawari bridge);
   *  • `jawari` adds detuned partner oscillators on the upper partials — a
   *    controlled buzz that never turns into noise;
   *  • each of the four strings has its own character (sustain, tone, bloom,
   *    body, buzz): the lowest is long and heavy, the highest short and bright.
   */
  makeRecipe(p, { velocity, stringIndex = 1 }) {
    const ch = STRING_CHARACTER[Math.min(3, Math.max(0, stringIndex))];
    const tone = clamp01(p.tone + ch.tone);
    const bloom = clamp01(p.bloom * ch.bloom);
    const res = clamp01(p.resonance + ch.resonance);
    const jawari = clamp01((p.jawari ?? 0.35) * ch.buzz);
    const base = [1, 0.95, 0.75, 0.55, 0.42, 0.32, 0.24, 0.18, 0.13, 0.09, 0.06, 0.04];
    const up = upperScale(tone);
    // Jawari (approximation): the partials 4–9 get a detuned "contact" partner layer that is strong at the
    // strike and fades faster than the tone (buzz → round), instead of a static detune that buzzes forever.
    const partials = base.map((g, i) => ({
      ratio: i + 1,
      gain: i < 2 ? g : g * up,
      decayMul: 1 / (1 + i * 0.28),
      pair: i < 3,
      buzz: jawari > 0.05 && i >= 3 && i < 9 ? { amount: 0.55 + 0.6 * jawari, tauMul: 0.3, floor: 0.2 } : undefined,
      bloom: i >= 2 && bloom > 0.02 ? { from: 1 - 0.75 * bloom, tau: 0.04 + 0.05 * i * bloom } : undefined,
    }));
    if (res > 0.01) {
      // a softer sub-octave than before (it blurred the pitch); the BODY filters below now supply the depth
      partials.push({ ratio: 0.5, gain: 0.3 * res, decayMul: 1.4 });
      partials.push({ ratio: 1, gain: 0.32 * res, decayMul: 2.4 });
    }
    return {
      wave: 'sine',
      partials,
      pairCents: 2.8 + jawari * 7,
      attack: 0.005,
      envTau: (p.sustain * ch.sustain * (1 - 0.8 * p.damping)) / 4,
      sustain: 0,
      releaseTau: 0.6,
      peak: 0.24 + 0.7 * lerp(0.55, velocity, p.pluck),
      cutoffHz: 900 + tone * 7500,
      cutoffVelocity: 0.55,
      filterBloom: bloom > 0.02 ? { from: 1 - 0.6 * bloom, tau: 0.18 } : undefined,
      // amplitude-dependent jawari contact: a loud strike is shaped, the quiet tail passes almost unchanged
      contact: jawari > 0.02 ? { drive: 0.3 + 2.4 * jawari, bias: 0.12 } : undefined,
      // shared body resonance (dandi/tumba approximation) — broad fixed resonances that colour every string
      body: { depth: clamp01(res) },
      noise: { level: 0.07 * p.pluck, decay: 0.02, cutoffHz: 2200 },
    };
  },
  /**
   * A CHIKARI string (also used for the drone cycle): bright, plucked, blooming,
   * with its OWN level (`chikariLevel`) so it stays clearly audible without
   * touching the master volume.
   */
  makeChikariRecipe(p, { velocity = 0.65, cycle = false, index = 0, phase = CHIKARI_PHASE[Math.min(2, Math.max(0, index))], extras = [] } = {}) {
    const level = p.chikariLevel ?? 1;
    const variant = CHIKARI_STRING_VARIANT[Math.min(2, Math.max(0, index))];
    const v = clamp01(velocity);
    // Three close open strings that never quite stand still (approximation, build 020):
    //   0.0–0.1 s   a slightly hard attack
    //   0.1–1 s     "bibibi": short-lived upper harmonics 4–6 whose detuned partners beat at ≈8–16 Hz (jawari contact)
    //   1–5 s       a subtle 2nd/3rd-harmonic beat (partners a few cents apart) on top of the fundamental
    //   5–30 s      the long FUNDAMENTAL, with a very weak beat and faint 2nd/3rd harmonics, never a pure sine
    // Every partial is an exact harmonic (no inharmonic "bell"/metal), the highest is the 6th, the detune is a few cents
    // (13 cents only on the short-lived contact partials), the filter stays dark and closes after the strike.
    const k = variant.pairCents / 3.8; // each string beats a little differently
    const contact = 0.55 + 0.9 * v; // a harder stroke touches the bridge harder → more buzz at the strike
    const upper = { amount: 0.6, tauMul: 0.12, floor: 0.1, cents: 13 * k };
    const partials = [
      { ratio: 1, gain: 1, decayMul: 1, buzz: { amount: 0.1, tauMul: 1, floor: 1, cents: 3.2 * k } }, // very-low-level detuned partner, lasts as long as the string
      { ratio: 2, gain: 0.2, decayMul: 0.55, buzz: { amount: 0.35, tauMul: 0.8, floor: 0.6, cents: 4.5 * k } },
      { ratio: 3, gain: 0.13, decayMul: 0.38, buzz: { amount: 0.3, tauMul: 0.6, floor: 0.5, cents: 5.5 * k } },
      { ratio: 4, gain: 0.14 * contact, decayMul: 0.14, buzz: upper },
      { ratio: 5, gain: 0.09 * contact, decayMul: 0.1, buzz: upper },
      { ratio: 6, gain: 0.05 * contact, decayMul: 0.08, buzz: upper },
      // quiet body resonance (dandi/tumba, approximation): a soft octave-below partial that outlasts the upper harmonics
      { ratio: 0.5, gain: 0.1, decayMul: 1.15 },
    ];
    // the OTHER chikari strings of the tuning (a Pa′ next to the Sa′, …) as faint extra partials of this one voice
    for (const ratio of extras.slice(0, 2)) partials.push({ ratio, gain: 0.09, decayMul: 0.75 });
    const tau = cycle ? 1.5 : chikariEnvTau(velocity) * variant.decay;
    return {
      wave: 'sine',
      partials,
      pairCents: variant.pairCents,
      attack: 0.003, // slightly hard
      // a struck chikari rings ~30 s (longer for a harder stroke); the auto drone cycle re-strikes every ~1 s,
      // so it keeps the short tau (otherwise dozens of long voices would stack up)
      envTau: tau,
      sustain: 0,
      releaseTau: 0.5,
      peak: 0.45 * (0.2 + 0.4 * velocity) * (0.35 + 0.9 * level), // quieter again than build 021 (×0.72 → ×0.45, about −4 dB)
      cutoffHz: 2400, // dark: no bell / metal sparkle
      cutoffVelocity: 0.3,
      filterBloom: { from: 2.0, tau: 1.0 }, // opens at the strike, closes → rounder with time
      contact: { drive: 0.5 + 1.2 * clamp01(p.jawari ?? 0.35), bias: 0.12 },
      body: { depth: clamp01(p.resonance ?? 0.6) * 0.8 },
      noise: null, // no nail "shan": the chikari starts with its tone (build 023)
      formant: cycle ? undefined : chikariFormant(phase), // khoomei-like focused-harmonic sweep (struck notes only; the drone cycle stays light)
    };
  },
};

export const INSTRUMENTS = [THEREMIN, HARP, RUDRA_VEENA];

export function instrumentById(id) {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[0];
}

export function defaultParams(instrument) {
  return Object.fromEntries(instrument.params.map((d) => [d.key, d.default]));
}
