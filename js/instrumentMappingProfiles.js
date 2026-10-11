/* ==========================================================================
   instrumentMappingProfiles.js — each instrument's EXPRESSIVE destinations.

   Two layers are kept apart on purpose:

       PERFORMANCE INPUTS   what you must do to play (finger position/curl,
                            sweeps, the neck hand…).
                            Handled by the instrument controllers. Never
                            touched by mappings or Randomize.
       EXPRESSIVE MAPPINGS  optional Trigger → Destination rows that shape
                            the sound (tone, decay, resonance, reverb …).
                            This is what Randomize Mapping rewrites.

   A profile lists which *instrument parameters* make sense as destinations
   for that instrument. An instrument parameter becomes a mapping destination
   with id `inst:<key>`; it moves the parameter inside its musical window
   (the `random:[lo,hi]` range in instruments.js), so even an extreme
   trigger position stays musical. Adding an instrument = adding one entry.
   CYBER THEREMIN / ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/** Generic instrument-parameter destinations (catalog entries for mapping.js). Native range 0..1. */
export const INSTRUMENT_DESTINATION_KEYS = [
  ['tone', 'Tone / Brightness'],
  ['tune', 'Tuning'],
  ['decay', 'Decay'],
  ['sustain', 'Sustain'],
  ['release', 'Release'],
  ['damping', 'Damping'],
  ['resonance', 'Resonance'],
  ['pluck', 'Pluck Strength'],
  ['velocity', 'Velocity Response'],
  ['shimmer', 'Detune / Shimmer'],
  ['sympathy', 'Sympathetic Resonance'],
  ['material', 'Material Character'],
  ['bloom', 'Harmonic Bloom'],
  ['jawari', 'Jawari / Buzz'],
  ['vibrato', 'Vibrato'],
  ['andolan', 'Andolan'],
  ['drone', 'Drone Level'],
  ['chikariLevel', 'Chikari Level'],
];

export const instrumentDestinationEntries = () =>
  INSTRUMENT_DESTINATION_KEYS.map(([key, label]) => ({
    id: `inst:${key}`,
    label,
    group: 'Instrument (active instrument only)',
    min: 0,
    max: 1,
    unit: '',
  }));

const EFFECTS = ['reverbMix', 'reverbSize', 'delayMix', 'delayFeedback', 'pan'];

/** Destinations (besides effects) each instrument exposes for expressive mapping. */
export const MAPPING_PROFILES = {
  theremin: {
    instrument: [],
    voice: ['filterCutoff', 'filterResonance', 'lfoRate', 'lfoDepth', 'oscMix', 'oscDetune', 'finePitch'],
  },
  harp: { instrument: ['tone', 'decay', 'damping', 'resonance', 'sympathy', 'material', 'pluck'], voice: [] },
  rudra: { instrument: ['sustain', 'pluck', 'resonance', 'jawari', 'vibrato', 'andolan', 'drone', 'chikariLevel', 'tone', 'bloom'], voice: [] },
};

/** Musical windows, in destination fractions, used when Randomize picks min/max. */
const INSTRUMENT_WINDOW = { min: [0, 0.35], max: [0.6, 1] };
const VOICE_WINDOWS = {
  filterCutoff: { min: [0.12, 0.4], max: [0.7, 1] },
  filterResonance: { min: [0, 0.12], max: [0.25, 0.5] },
  lfoDepth: { min: [0, 0.1], max: [0.35, 0.7] },
  lfoRate: { min: [0.15, 0.3], max: [0.4, 0.65] },
  oscMix: { min: [0, 0.2], max: [0.4, 0.8] },
  oscDetune: { min: [0.38, 0.5], max: [0.5, 0.62] },
  finePitch: { min: [0.4, 0.48], max: [0.52, 0.6] },
};
const EFFECT_WINDOWS = {
  reverbMix: { min: [0, 0.1], max: [0.35, 0.65] },
  reverbSize: { min: [0.2, 0.4], max: [0.6, 0.85] },
  delayMix: { min: [0, 0.05], max: [0.25, 0.5] },
  delayFeedback: { min: [0.1, 0.25], max: [0.35, 0.55] },
  pan: { min: [0.3, 0.45], max: [0.55, 0.7] },
};

/**
 * The expressive destination pool for an instrument, each with its musical window.
 * @returns {Array<{id:string, min:[number,number], max:[number,number]}>}
 */
export function expressivePool(instrumentId) {
  const profile = MAPPING_PROFILES[instrumentId] ?? MAPPING_PROFILES.theremin;
  return [
    ...profile.instrument.map((k) => ({ id: `inst:${k}`, ...INSTRUMENT_WINDOW })),
    ...profile.voice.map((id) => ({ id, ...VOICE_WINDOWS[id] })),
    ...EFFECTS.map((id) => ({ id, ...EFFECT_WINDOWS[id] })),
  ];
}
