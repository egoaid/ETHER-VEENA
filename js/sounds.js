/* ==========================================================================
   sounds.js — SOUND presets (timbre) and PERFORMANCE presets (whole setups).

   Three preset concepts, kept apart on purpose:
     • Sound presets        this file   timbre: oscillator structure, filter,
                                        envelope, vibrato (LFO), effects and the
                                        active instrument's own tone parameters
     • Mapping presets      mapping.js  which body input drives which parameter
     • Performance presets  this file   one tap sets instrument + sound + mapping
                                        + scale/raga + effects together

   Sound presets deliberately differ in STRUCTURE (waveform, second-oscillator
   mix/detune, filter type, envelope shape, LFO target) — not just a few
   slider offsets — so each one is audibly its own thing.
   `instrument` values are applied only to parameters the active instrument has.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const S = (synth, effects, instrument = {}) => ({ synth, effects, instrument });

export const SOUND_PRESETS = [
  { id: 'soft', name: 'Soft', ...S(
    { waveform: 'sine', filterType: 'lowpass', oscMix: 0.15, oscDetune: 4, brightness: 0.5, resonance: 0.08, attack: 0.2, decay: 0.3, sustain: 0.9, release: 0.5, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.08 },
    { reverbMix: 0.3, reverbSize: 0.5, delayMix: 0, delayTime: 0.3, delayFeedback: 0.25, pan: 0 },
    { tone: 0.3, damping: 0.4 }) },
  { id: 'bright', name: 'Bright', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.3, oscDetune: 8, brightness: 0.88, resonance: 0.25, attack: 0.015, decay: 0.2, sustain: 0.9, release: 0.15, lfoTarget: 'pitch', lfoRate: 5.5, lfoDepth: 0.12 },
    { reverbMix: 0.15, reverbSize: 0.4, delayMix: 0.1, delayTime: 0.24, delayFeedback: 0.25, pan: 0 },
    { tone: 0.92 }) },
  { id: 'dark', name: 'Dark', ...S(
    { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.4, oscDetune: 6, brightness: 0.3, resonance: 0.3, attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.6, lfoTarget: 'filterCutoff', lfoRate: 0.3, lfoDepth: 0.4 },
    { reverbMix: 0.35, reverbSize: 0.7, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.12 }) },
  { id: 'warm', name: 'Warm', ...S(
    { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.35, oscDetune: 5, brightness: 0.5, resonance: 0.15, attack: 0.07, decay: 0.3, sustain: 0.9, release: 0.4, lfoTarget: 'pitch', lfoRate: 4.8, lfoDepth: 0.1 },
    { reverbMix: 0.25, reverbSize: 0.55, delayMix: 0.12, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.4, resonance: 0.55 }) },
  { id: 'metallic', name: 'Metallic', ...S(
    { waveform: 'square', filterType: 'lowpass', oscMix: 0.5, oscDetune: 23, brightness: 0.72, resonance: 0.55, attack: 0.01, decay: 0.25, sustain: 0.7, release: 0.3, lfoTarget: 'amplitude', lfoRate: 7, lfoDepth: 0.25 },
    { reverbMix: 0.2, reverbSize: 0.5, delayMix: 0.2, delayTime: 0.21, delayFeedback: 0.35, pan: 0 },
    { tone: 0.8, hardness: 0.85 }) },
  { id: 'glass', name: 'Glass', ...S(
    { waveform: 'sine', filterType: 'lowpass', oscMix: 0.55, oscDetune: 13, brightness: 0.9, resonance: 0.4, attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.7, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1 },
    { reverbMix: 0.5, reverbSize: 0.8, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.88, resonance: 0.65 }) },
  { id: 'vintage', name: 'Vintage', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.25, oscDetune: 7, brightness: 0.45, resonance: 0.35, attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.35, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.3 },
    { reverbMix: 0.18, reverbSize: 0.45, delayMix: 0.2, delayTime: 0.32, delayFeedback: 0.3, pan: 0 },
    { tone: 0.35, damping: 0.35 }) },
  { id: 'hollow', name: 'Hollow', ...S(
    { waveform: 'square', filterType: 'bandpass', oscMix: 0, oscDetune: 0, brightness: 0.35, resonance: 0.5, attack: 0.04, decay: 0.3, sustain: 0.9, release: 0.3, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.06 },
    { reverbMix: 0.3, reverbSize: 0.6, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.25, hardness: 0.2 }) },
  { id: 'bell', name: 'Bell', ...S(
    { waveform: 'sine', filterType: 'lowpass', oscMix: 0.6, oscDetune: 28, brightness: 0.85, resonance: 0.3, attack: 0.003, decay: 0.8, sustain: 0.1, release: 1.2, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0 },
    { reverbMix: 0.5, reverbSize: 0.75, delayMix: 0.1, delayTime: 0.4, delayFeedback: 0.3, pan: 0 },
    { tone: 0.8, hardness: 0.7, decay: 2.6 }) },
  { id: 'wooden', name: 'Wooden', ...S(
    { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.2, oscDetune: 3, brightness: 0.38, resonance: 0.2, attack: 0.01, decay: 0.15, sustain: 0.3, release: 0.18, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.03 },
    { reverbMix: 0.12, reverbSize: 0.35, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.35, hardness: 0.6, damping: 0.5 }) },
  { id: 'electronic', name: 'Electronic', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.5, oscDetune: 12, brightness: 0.8, resonance: 0.5, attack: 0.005, decay: 0.1, sustain: 0.95, release: 0.1, lfoTarget: 'filterCutoff', lfoRate: 5, lfoDepth: 0.5 },
    { reverbMix: 0.1, reverbSize: 0.4, delayMix: 0.25, delayTime: 0.19, delayFeedback: 0.4, pan: 0 },
    { tone: 0.85 }) },
  { id: 'radio', name: 'Radio', ...S(
    { waveform: 'square', filterType: 'bandpass', oscMix: 0.3, oscDetune: 15, brightness: 0.35, resonance: 0.6, attack: 0.02, decay: 0.2, sustain: 0.9, release: 0.12, lfoTarget: 'amplitude', lfoRate: 3, lfoDepth: 0.15 },
    { reverbMix: 0.05, reverbSize: 0.3, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.3 }) },
  { id: 'dreamy', name: 'Dreamy', ...S(
    { waveform: 'sine', filterType: 'lowpass', oscMix: 0.45, oscDetune: 10, brightness: 0.6, resonance: 0.2, attack: 0.45, decay: 0.5, sustain: 0.9, release: 1.2, lfoTarget: 'pitch', lfoRate: 4.2, lfoDepth: 0.15 },
    { reverbMix: 0.6, reverbSize: 0.85, delayMix: 0.3, delayTime: 0.45, delayFeedback: 0.45, pan: 0 },
    { tone: 0.5, resonance: 0.7 }) },
  { id: 'thin', name: 'Thin', ...S(
    { waveform: 'sawtooth', filterType: 'bandpass', oscMix: 0, oscDetune: 0, brightness: 0.8, resonance: 0.2, attack: 0.02, decay: 0.2, sustain: 0.8, release: 0.1, lfoTarget: 'pitch', lfoRate: 5.5, lfoDepth: 0.1 },
    { reverbMix: 0.1, reverbSize: 0.3, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.85, resonance: 0.1 }) },
  { id: 'thick', name: 'Thick', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.7, oscDetune: 18, brightness: 0.55, resonance: 0.2, attack: 0.05, decay: 0.3, sustain: 1, release: 0.45, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.15 },
    { reverbMix: 0.2, reverbSize: 0.5, delayMix: 0.08, delayTime: 0.28, delayFeedback: 0.3, pan: 0 },
    { tone: 0.5, resonance: 0.75 }) },
  { id: 'resonant', name: 'Resonant', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.2, oscDetune: 6, brightness: 0.5, resonance: 0.8, attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.4, lfoTarget: 'filterCutoff', lfoRate: 0.8, lfoDepth: 0.3 },
    { reverbMix: 0.3, reverbSize: 0.6, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.55, resonance: 0.9, bloom: 0.8 }) },
  { id: 'singing', name: 'Singing', ...S(
    { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.3, oscDetune: 5, brightness: 0.55, resonance: 0.45, attack: 0.12, decay: 0.3, sustain: 1, release: 0.55, lfoTarget: 'pitch', lfoRate: 5.8, lfoDepth: 0.35 },
    { reverbMix: 0.4, reverbSize: 0.65, delayMix: 0.05, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.5, vibrato: 0.4 }) },
  { id: 'experimental', name: 'Experimental', ...S(
    { waveform: 'square', filterType: 'lowpass', oscMix: 0.65, oscDetune: -35, brightness: 0.6, resonance: 0.7, attack: 0.3, decay: 0.6, sustain: 0.4, release: 1, lfoTarget: 'filterCutoff', lfoRate: 7.5, lfoDepth: 0.6 },
    { reverbMix: 0.3, reverbSize: 0.7, delayMix: 0.35, delayTime: 0.27, delayFeedback: 0.55, pan: 0 },
    { tone: 0.6 }) },
  { id: 'retro', name: 'Retro', ...S(
    { waveform: 'square', filterType: 'lowpass', oscMix: 0, oscDetune: 0, brightness: 0.75, resonance: 0.15, attack: 0.005, decay: 0.08, sustain: 0.8, release: 0.06, lfoTarget: 'pitch', lfoRate: 7, lfoDepth: 0.05 },
    { reverbMix: 0.05, reverbSize: 0.3, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3, pan: 0 },
    { tone: 0.75, hardness: 0.9, decay: 0.5, damping: 0.8 }) },
  { id: 'strange', name: 'Strange', ...S(
    { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.55, oscDetune: 42, brightness: 0.42, resonance: 0.65, attack: 0.15, decay: 0.5, sustain: 0.5, release: 0.8, lfoTarget: 'amplitude', lfoRate: 2.5, lfoDepth: 0.5 },
    { reverbMix: 0.45, reverbSize: 0.7, delayMix: 0.4, delayTime: 0.38, delayFeedback: 0.5, pan: 0.3 },
    { tone: 0.4 }) },
];

/**
 * Performance presets: instrument + sound + mapping + scale/raga + effects in one tap.
 * `scale` is a scale name (or raga name for Rudra Veena). `root` is a pitch class 0..11.
 * Only fields that make sense for the chosen instrument are used.
 */
export const PERFORMANCE_PRESETS = [
  { id: 'vintage-theremin', name: 'Vintage Theremin', instrument: 'theremin', sound: 'vintage', mapping: 'classic', scale: 'Major', root: 0, pitchMode: 'continuous' },
  { id: 'space-theremin', name: 'Space Theremin', instrument: 'theremin', sound: 'dreamy', mapping: 'expressive', scale: 'Whole Tone', root: 2, pitchMode: 'continuous' },
  { id: 'ghost-voice', name: 'Ghost Voice', instrument: 'theremin', sound: 'singing', mapping: 'stable', scale: 'Minor', root: 9, pitchMode: 'continuous' },
  { id: 'old-radio', name: 'Old Radio', instrument: 'theremin', sound: 'radio', mapping: 'classic', scale: 'Major', root: 0, pitchMode: 'continuous' },
  { id: 'temple-drone', name: 'Temple Drone', instrument: 'rudra', sound: 'dark', mapping: 'rudra-expressive', scale: 'Bhairav', root: 2 },
  { id: 'raga-drone', name: 'Raga Drone', instrument: 'rudra', sound: 'warm', mapping: 'rudra-expressive', scale: 'Yaman', root: 4 },
  { id: 'dream-harp', name: 'Dream Harp', instrument: 'harp', sound: 'dreamy', mapping: 'harp-performance', scale: 'Major', root: 0 },
];
