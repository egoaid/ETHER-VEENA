/* ==========================================================================
   presets.js — UNIFIED PRESETS (Build 028). One tap sets EVERYTHING that makes a patch:

     Instrument    instrument, its options (Rudra tuning, drone) and its own parameters
     Scale         root + scale (or raga for the Rudra Veena)
     Performance   pitch mode, hand sensitivity, face tracking
     Mapping       Trigger → Destination rows
     Synth         the generic (Theremin) voice
     Effects       delay type + times, reverb, pan
     Display       camera filter + density + colours + music colour, glitch, body visual, background, face HUD, CRT monitor

   A preset lists all seven groups, so applying one always lands in the same, complete state (no leftovers from the previous patch).
   `display` is merged over DISPLAY_BASE; every other group is applied as written.
   Pure data. ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export const GLITCH_OFF = Object.freeze({ amount: 0, frequency: 0.4, blockSize: 0.4, rgbSplit: 0.5, displace: 0.5, noise: 0.55, hold: 0.2 });
export const DISPLAY_BASE = Object.freeze({
  filter: 'off', density: 0.5, colorMode: 'original', base: '#5abeff', dark: '#080e2e', bright: '#ffc478', music: 'off',
  glitch: GLITCH_OFF, bodyVisual: 'skeleton', background: 'camera', faceHud: 'outline', crt: { on: false, amount: 0.65 },
});
const D = (o) => ({ ...DISPLAY_BASE, ...o, glitch: { ...GLITCH_OFF, ...(o.glitch ?? {}) }, crt: { ...DISPLAY_BASE.crt, ...(o.crt ?? {}) } });

const FX = (o) => ({ delayMode: 'normal', pingWidth: 0.8, pan: 0, ...o });

const BASE_PRESETS = [
  // ---------------------------------------------------------------- Theremin ------------------------------------------------------------
  { id: 'vintage-theremin', name: 'Vintage Theremin', blurb: 'A 1950s sci-fi set: warm saw voice, gentle vibrato, and a glowing brown-tube monitor.',
    instrument: { id: 'theremin' }, scale: { root: 0, name: 'Major' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.2, max: 0.9 }],
    synth: { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.25, oscDetune: 7, brightness: 0.45, resonance: 0.35, attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.35, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.3 },
    effects: FX({ reverbMix: 0.18, reverbSize: 0.45, delayMix: 0.2, delayTime: 0.32, delayFeedback: 0.3 }),
    display: D({ crt: { on: true, amount: 0.75 }, bodyVisual: 'skeleton' }) },
  { id: 'space-theremin', name: 'Space Theremin', blurb: 'Whole-tone drift into a long ping-pong echo; the crystal picture changes hue with your pitch.',
    instrument: { id: 'theremin' }, scale: { root: 2, name: 'Whole Tone' }, performance: { pitchMode: 'continuous', sensitivity: 1.2, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterResonance' }, { trigger: 'leftHandDepth', destination: 'filterCutoff' }, { trigger: 'rightIndex', destination: 'lfoDepth' }, { trigger: 'rightMiddle', destination: 'lfoRate' }, { trigger: 'rightRing', destination: 'delayMix' }, { trigger: 'rightPinky', destination: 'reverbMix' }],
    synth: { waveform: 'sine', filterType: 'lowpass', oscMix: 0.45, oscDetune: 10, brightness: 0.6, resonance: 0.2, attack: 0.45, decay: 0.5, sustain: 0.9, release: 1.2, lfoTarget: 'pitch', lfoRate: 4.2, lfoDepth: 0.15 },
    effects: FX({ delayMode: 'pingpong', pingWidth: 1, reverbMix: 0.6, reverbSize: 0.85, delayMix: 0.3, delayTime: 0.45, delayFeedback: 0.45 }),
    display: D({ filter: 'crystal', density: 0.6, colorMode: 'duo', dark: '#050a2a', bright: '#7be8ff', music: 'pitch', bodyVisual: 'reactive' }) },
  { id: 'ghost-voice', name: 'Ghost Voice', blurb: 'A singing, vowel-like voice with steady hands (low sensitivity) in a cold monochrome relief.',
    instrument: { id: 'theremin' }, scale: { root: 9, name: 'Minor' }, performance: { pitchMode: 'continuous', sensitivity: 0.8, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.3, max: 0.85 }],
    synth: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.3, oscDetune: 5, brightness: 0.55, resonance: 0.45, attack: 0.12, decay: 0.3, sustain: 1, release: 0.55, lfoTarget: 'pitch', lfoRate: 5.8, lfoDepth: 0.35 },
    effects: FX({ reverbMix: 0.4, reverbSize: 0.65, delayMix: 0.05, delayTime: 0.3, delayFeedback: 0.3 }),
    display: D({ filter: 'relief', density: 0.5, colorMode: 'mono', base: '#a8d8ff', music: 'audio', glitch: { amount: 0.2, frequency: 0.2, noise: 0.45 } }) },
  { id: 'old-radio', name: 'Old Radio', blurb: 'Band-passed square wave, a coarse green picture and a flickering tube — a station half tuned in.',
    instrument: { id: 'theremin' }, scale: { root: 0, name: 'Major' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.2, max: 0.9 }],
    synth: { waveform: 'square', filterType: 'bandpass', oscMix: 0.3, oscDetune: 15, brightness: 0.35, resonance: 0.6, attack: 0.02, decay: 0.2, sustain: 0.9, release: 0.12, lfoTarget: 'amplitude', lfoRate: 3, lfoDepth: 0.15 },
    effects: FX({ reverbMix: 0.05, reverbSize: 0.3, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3 }),
    display: D({ filter: 'facets', density: 0.3, colorMode: 'mono', base: '#6dff9a', crt: { on: true, amount: 0.9 }, glitch: { amount: 0.35, frequency: 0.3, blockSize: 0.35, noise: 0.5 } }) },
  { id: 'broken-signal', name: 'Broken Signal', blurb: 'Detuned, fast LFO and heavy JPEG damage: a transmission falling apart in blocks.',
    instrument: { id: 'theremin' }, scale: { root: 4, name: 'Phrygian Dominant' }, performance: { pitchMode: 'snap-scale', sensitivity: 1.4, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterCutoff' }, { trigger: 'leftHandDepth', destination: 'filterResonance' }, { trigger: 'rightIndex', destination: 'finePitch' }, { trigger: 'rightMiddle', destination: 'lfoDepth' }, { trigger: 'rightRing', destination: 'delayFeedback' }, { trigger: 'rightPinky', destination: 'reverbMix' }],
    synth: { waveform: 'square', filterType: 'lowpass', oscMix: 0.65, oscDetune: -35, brightness: 0.6, resonance: 0.7, attack: 0.3, decay: 0.6, sustain: 0.4, release: 1, lfoTarget: 'filterCutoff', lfoRate: 7.5, lfoDepth: 0.6 },
    effects: FX({ delayMode: 'pingpong', pingWidth: 0.9, reverbMix: 0.3, reverbSize: 0.7, delayMix: 0.35, delayTime: 0.27, delayFeedback: 0.55 }),
    display: D({ filter: 'shards', density: 0.5, colorMode: 'duo', dark: '#1a0030', bright: '#ff4fa3', music: 'both', crt: { on: true, amount: 0.5 }, glitch: { amount: 0.85, frequency: 0.6, blockSize: 0.45, rgbSplit: 0.7, displace: 0.7, noise: 0.8, hold: 0.3 } }) },
  { id: 'neon-lab', name: 'Neon Lab', blurb: 'Bright pentatonic lead with every finger on a knob; a magenta-to-cyan relief that breathes with the sound.',
    instrument: { id: 'theremin' }, scale: { root: 7, name: 'Major Pentatonic' }, performance: { pitchMode: 'snap-scale', sensitivity: 1.6, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'filterResonance' }, { trigger: 'leftHandDepth', destination: 'filterCutoff' }, { trigger: 'rightIndex', destination: 'lfoDepth' }, { trigger: 'rightMiddle', destination: 'lfoRate' }, { trigger: 'rightRing', destination: 'delayMix' }, { trigger: 'rightPinky', destination: 'reverbMix' }],
    synth: { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.5, oscDetune: 12, brightness: 0.8, resonance: 0.5, attack: 0.005, decay: 0.1, sustain: 0.95, release: 0.1, lfoTarget: 'filterCutoff', lfoRate: 5, lfoDepth: 0.5 },
    effects: FX({ delayMode: 'pingpong', pingWidth: 0.7, reverbMix: 0.1, reverbSize: 0.4, delayMix: 0.25, delayTime: 0.19, delayFeedback: 0.4 }),
    display: D({ filter: 'relief', density: 0.65, colorMode: 'duo', dark: '#3a0050', bright: '#32f0ff', music: 'both', crt: { on: true, amount: 0.35 }, glitch: { amount: 0.25, frequency: 0.35, noise: 0.5 }, bodyVisual: 'mesh' }) },
  { id: 'face-voice', name: 'Face Voice', blurb: 'Your mouth, smile, brows and head shape the sound (turns face tracking on).',
    instrument: { id: 'theremin' }, scale: { root: 9, name: 'Minor' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: true },
    mapping: [{ trigger: 'mouthOpen', destination: 'filterCutoff' }, { trigger: 'smile', destination: 'filterResonance' }, { trigger: 'leftEyebrow', destination: 'lfoDepth' }, { trigger: 'rightEyebrow', destination: 'lfoRate' }, { trigger: 'headYaw', destination: 'delayMix' }, { trigger: 'headRoll', destination: 'reverbMix' }, { trigger: 'headPitch', destination: 'oscDetune' }],
    synth: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.35, oscDetune: 5, brightness: 0.5, resonance: 0.15, attack: 0.07, decay: 0.3, sustain: 0.9, release: 0.4, lfoTarget: 'pitch', lfoRate: 4.8, lfoDepth: 0.1 },
    effects: FX({ reverbMix: 0.25, reverbSize: 0.55, delayMix: 0.12, delayTime: 0.3, delayFeedback: 0.3 }),
    display: D({ filter: 'facets', density: 0.7, colorMode: 'original', bodyVisual: 'face', faceHud: 'mask' }) },
  // ---------------------------------------------------------------- Rudra Veena ---------------------------------------------------------
  { id: 'temple-drone', name: 'Temple Drone', blurb: 'Bhairav on D over a Khandarbani tuning with the tanpura-style drone running, in front of the sound-reactive mandala.',
    instrument: { id: 'rudra', options: { tuning: 'khandarbani', chikariTuning: 'sa-sa-sa2', droneMode: 'on' }, params: { drone: 0.4, chikariLevel: 1.0, jawari: 0.4, tone: 0.4 } },
    scale: { root: 2, name: 'Bhairav' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.15, max: 0.7 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.3 }, { trigger: 'mouthOpen', destination: 'reverbSize' }, { trigger: 'headRoll', destination: 'pan', min: 0.35, max: 0.65 }],
    synth: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.4, oscDetune: 6, brightness: 0.3, resonance: 0.3, attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.6, lfoTarget: 'filterCutoff', lfoRate: 0.3, lfoDepth: 0.4 },
    effects: FX({ reverbMix: 0.4, reverbSize: 0.75, delayMix: 0.08, delayTime: 0.4, delayFeedback: 0.3 }),
    display: D({ background: 'mandala', bodyVisual: 'face', music: 'off' }) },
  { id: 'raga-drone', name: 'Raga Drone', blurb: 'Yaman on E, standard tuning, drone off — a clean, dry veena under amber duotone facets.',
    instrument: { id: 'rudra', options: { tuning: 'style-a', chikariTuning: 'sa-pa-sa2', droneMode: 'off' }, params: { jawari: 0.35, tone: 0.45, vibrato: 0.12 } },
    scale: { root: 4, name: 'Yaman' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.15, max: 0.7 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.3 }, { trigger: 'mouthOpen', destination: 'reverbSize' }, { trigger: 'headRoll', destination: 'pan', min: 0.35, max: 0.65 }],
    synth: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.35, oscDetune: 5, brightness: 0.5, resonance: 0.15, attack: 0.07, decay: 0.3, sustain: 0.9, release: 0.4, lfoTarget: 'pitch', lfoRate: 4.8, lfoDepth: 0.1 },
    effects: FX({ reverbMix: 0.25, reverbSize: 0.55, delayMix: 0.1, delayTime: 0.35, delayFeedback: 0.3 }),
    display: D({ filter: 'facets', density: 0.45, colorMode: 'duo', dark: '#1a0c00', bright: '#ffc060', bodyVisual: 'skeleton' }) },
  { id: 'midnight-todi', name: 'Midnight Todi', blurb: 'Todi on G with a deep kharaj string, long sustain and a blue monochrome crystal; ping-pong echoes in the dark.',
    instrument: { id: 'rudra', options: { tuning: 'kharaj', chikariTuning: 'sa-sa-sa2', droneMode: 'on' }, params: { sustain: 11, bloom: 0.75, jawari: 0.5, resonance: 0.8, drone: 0.3 } },
    scale: { root: 7, name: 'Todi' }, performance: { pitchMode: 'continuous', sensitivity: 0.9, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.2, max: 0.7 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.35 }, { trigger: 'headYaw', destination: 'pan', min: 0.3, max: 0.7 }],
    synth: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.4, oscDetune: 6, brightness: 0.3, resonance: 0.3, attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.6, lfoTarget: 'filterCutoff', lfoRate: 0.3, lfoDepth: 0.4 },
    effects: FX({ delayMode: 'pingpong', pingWidth: 0.8, reverbMix: 0.45, reverbSize: 0.8, delayMix: 0.2, delayTime: 0.5, delayFeedback: 0.4 }),
    display: D({ filter: 'crystal', density: 0.55, colorMode: 'mono', base: '#4a8cff', music: 'audio', crt: { on: true, amount: 0.3 } }) },
  // ---------------------------------------------------------------- Harp ----------------------------------------------------------------
  { id: 'dream-harp', name: 'Dream Harp', blurb: 'A 47-string harp in C major, drenched in reverb; the crystal picture follows the notes you pluck.',
    instrument: { id: 'harp', params: { decay: 4.5, sympathy: 0.5, tone: 0.55 } }, scale: { root: 0, name: 'Major' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.1, max: 0.65 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.35 }, { trigger: 'headYaw', destination: 'pan', min: 0.25, max: 0.75 }, { trigger: 'mouthOpen', destination: 'reverbSize' }],
    synth: { waveform: 'sine', filterType: 'lowpass', oscMix: 0.45, oscDetune: 10, brightness: 0.6, resonance: 0.2, attack: 0.45, decay: 0.5, sustain: 0.9, release: 1.2, lfoTarget: 'pitch', lfoRate: 4.2, lfoDepth: 0.15 },
    effects: FX({ reverbMix: 0.6, reverbSize: 0.85, delayMix: 0.3, delayTime: 0.45, delayFeedback: 0.45 }),
    display: D({ filter: 'crystal', density: 0.7, colorMode: 'original', music: 'both', bodyVisual: 'reactive' }) },
  { id: 'glass-harp', name: 'Glass Harp', blurb: 'Bright Lydian strings with a glassy, nylon-leaning tone; shards in ice-blue and a stereo ping-pong tail.',
    instrument: { id: 'harp', params: { material: 0.85, tone: 0.85, decay: 5, damping: 0.1, resonance: 0.65 } }, scale: { root: 5, name: 'Lydian' }, performance: { pitchMode: 'continuous', sensitivity: 1.0, face: false },
    mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.2, max: 0.7 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.4 }, { trigger: 'headYaw', destination: 'pan', min: 0.25, max: 0.75 }],
    synth: { waveform: 'sine', filterType: 'lowpass', oscMix: 0.55, oscDetune: 13, brightness: 0.9, resonance: 0.4, attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.7, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1 },
    effects: FX({ delayMode: 'pingpong', pingWidth: 1, reverbMix: 0.5, reverbSize: 0.8, delayMix: 0.25, delayTime: 0.36, delayFeedback: 0.45 }),
    display: D({ filter: 'shards', density: 0.55, colorMode: 'duo', dark: '#02122b', bright: '#c8f4ff', music: 'pitch', glitch: { amount: 0.15, frequency: 0.15, noise: 0.4 } }) },
];



// ---- shared pieces for the additional presets ---------------------------------------------------------------------------------------
const SYN = {
  warm: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.35, oscDetune: 5, brightness: 0.5, resonance: 0.15, attack: 0.07, decay: 0.3, sustain: 0.9, release: 0.4, lfoTarget: 'pitch', lfoRate: 4.8, lfoDepth: 0.1 },
  dark: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.4, oscDetune: 6, brightness: 0.3, resonance: 0.3, attack: 0.12, decay: 0.4, sustain: 0.85, release: 0.6, lfoTarget: 'filterCutoff', lfoRate: 0.3, lfoDepth: 0.4 },
  soft: { waveform: 'sine', filterType: 'lowpass', oscMix: 0.15, oscDetune: 4, brightness: 0.5, resonance: 0.08, attack: 0.2, decay: 0.3, sustain: 0.9, release: 0.5, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.08 },
  singing: { waveform: 'triangle', filterType: 'lowpass', oscMix: 0.3, oscDetune: 5, brightness: 0.55, resonance: 0.45, attack: 0.12, decay: 0.3, sustain: 1, release: 0.55, lfoTarget: 'pitch', lfoRate: 5.8, lfoDepth: 0.35 },
  retro: { waveform: 'square', filterType: 'lowpass', oscMix: 0, oscDetune: 0, brightness: 0.75, resonance: 0.15, attack: 0.005, decay: 0.08, sustain: 0.8, release: 0.06, lfoTarget: 'pitch', lfoRate: 7, lfoDepth: 0.05 },
  vintage: { waveform: 'sawtooth', filterType: 'lowpass', oscMix: 0.25, oscDetune: 7, brightness: 0.45, resonance: 0.35, attack: 0.05, decay: 0.3, sustain: 0.8, release: 0.35, lfoTarget: 'pitch', lfoRate: 5, lfoDepth: 0.3 },
  glass: { waveform: 'sine', filterType: 'lowpass', oscMix: 0.55, oscDetune: 13, brightness: 0.9, resonance: 0.4, attack: 0.03, decay: 0.3, sustain: 0.9, release: 0.7, lfoTarget: 'pitch', lfoRate: 6, lfoDepth: 0.1 },
};
const MAP_THEREMIN = [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.2, max: 0.9 }];
const MAP_RUDRA = [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.15, max: 0.7 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.3 }, { trigger: 'mouthOpen', destination: 'reverbSize' }, { trigger: 'headRoll', destination: 'pan', min: 0.35, max: 0.65 }];
const MAP_HARP = [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.1, max: 0.65 }, { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.35 }, { trigger: 'headYaw', destination: 'pan', min: 0.25, max: 0.75 }, { trigger: 'mouthOpen', destination: 'reverbSize' }];
const PERF = (o = {}) => ({ pitchMode: 'continuous', sensitivity: 1.0, face: false, ...o });
const RUDRA = (root, name, options, params = {}) => ({ instrument: { id: 'rudra', options: { chikariTuning: 'sa-sa-sa2', droneMode: 'on', ...options }, params }, scale: { root, name } });

const MORE_PRESETS = [
  // ---------------------------------------------------------------- Theremin ------------------------------------------------------------
  { id: 'blue-hour', name: 'Blue Hour', blurb: 'Dorian on D: a soft, unhurried voice under blue-to-amber crystal facets — dusk on the stage.',
    instrument: { id: 'theremin' }, scale: { root: 2, name: 'Dorian' }, performance: PERF({ sensitivity: 0.9 }), mapping: MAP_THEREMIN, synth: SYN.soft,
    effects: FX({ reverbMix: 0.4, reverbSize: 0.7, delayMix: 0.12, delayTime: 0.38, delayFeedback: 0.3 }),
    display: D({ filter: 'crystal', density: 0.55, colorMode: 'duo', dark: '#06143a', bright: '#ffb36b', music: 'audio' }) },
  { id: 'cathedral-voice', name: 'Cathedral Voice', blurb: 'A choir-like voice in Lydian with a huge, slow reverb and a slow ping-pong shimmer.',
    instrument: { id: 'theremin' }, scale: { root: 7, name: 'Lydian' }, performance: PERF({ sensitivity: 0.9 }), mapping: [{ trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.3, max: 0.85 }, { trigger: 'leftHandDepth', destination: 'filterCutoff', min: 0.3, max: 0.9 }],
    synth: SYN.singing, effects: FX({ delayMode: 'pingpong', pingWidth: 0.6, reverbMix: 0.7, reverbSize: 0.95, delayMix: 0.18, delayTime: 0.6, delayFeedback: 0.4 }),
    display: D({ filter: 'relief', density: 0.4, colorMode: 'mono', base: '#e8d9b0', music: 'audio', bodyVisual: 'face' }) },
  { id: 'pixel-bell', name: 'Pixel Bell', blurb: 'Hirajoshi on D with an 8-bit square voice; chunky coarse polygons and a CRT glow.',
    instrument: { id: 'theremin' }, scale: { root: 2, name: 'Hirajoshi' }, performance: PERF({ pitchMode: 'snap-scale', sensitivity: 1.3 }), mapping: MAP_THEREMIN, synth: SYN.retro,
    effects: FX({ reverbMix: 0.12, reverbSize: 0.35, delayMix: 0.2, delayTime: 0.19, delayFeedback: 0.35 }),
    display: D({ filter: 'shards', density: 0.3, colorMode: 'duo', dark: '#0b1d00', bright: '#c8ff6a', crt: { on: true, amount: 0.7 } }) },
  { id: 'tape-echo', name: 'Tape Echo', blurb: 'The vintage saw voice into a long, dark ping-pong echo; scratchy JPEG glitches and a worn CRT.',
    instrument: { id: 'theremin' }, scale: { root: 0, name: 'Minor' }, performance: PERF(), mapping: MAP_THEREMIN, synth: SYN.vintage,
    effects: FX({ delayMode: 'pingpong', pingWidth: 0.9, reverbMix: 0.2, reverbSize: 0.5, delayMix: 0.4, delayTime: 0.42, delayFeedback: 0.6 }),
    display: D({ filter: 'facets', density: 0.4, colorMode: 'mono', base: '#ffcf8a', crt: { on: true, amount: 0.8 }, glitch: { amount: 0.2, frequency: 0.2, noise: 0.5 } }) },
  // ---------------------------------------------------------------- Harp ----------------------------------------------------------------
  { id: 'moon-harp', name: 'Moon Harp', blurb: 'Dorian strings with long decay and sympathetic ringing, under a pale monochrome relief.',
    instrument: { id: 'harp', params: { decay: 5.5, sympathy: 0.55, tone: 0.5, material: 0.4 } }, scale: { root: 2, name: 'Dorian' }, performance: PERF(), mapping: MAP_HARP, synth: SYN.soft,
    effects: FX({ reverbMix: 0.55, reverbSize: 0.85, delayMix: 0.2, delayTime: 0.5, delayFeedback: 0.4 }),
    display: D({ filter: 'relief', density: 0.5, colorMode: 'mono', base: '#cfe6ff', music: 'audio' }) },
  { id: 'gut-harp', name: 'Gut Harp', blurb: 'A dry, woody gut-string sound in Mixolydian: close, intimate, almost no reverb.',
    instrument: { id: 'harp', params: { material: 0.1, tone: 0.35, decay: 2.2, damping: 0.4, resonance: 0.3, sympathy: 0.2 } }, scale: { root: 7, name: 'Mixolydian' }, performance: PERF(), mapping: MAP_HARP, synth: SYN.warm,
    effects: FX({ reverbMix: 0.12, reverbSize: 0.35, delayMix: 0, delayTime: 0.3, delayFeedback: 0.3 }),
    display: D({ filter: 'facets', density: 0.6, colorMode: 'original' }) },
  { id: 'silk-road', name: 'Silk Road', blurb: 'Harmonic minor on E with a wide ping-pong echo and amber shards — a caravan at night.',
    instrument: { id: 'harp', params: { tone: 0.65, decay: 4, sympathy: 0.5 } }, scale: { root: 4, name: 'Harmonic Minor' }, performance: PERF(), mapping: MAP_HARP, synth: SYN.glass,
    effects: FX({ delayMode: 'pingpong', pingWidth: 1, reverbMix: 0.4, reverbSize: 0.7, delayMix: 0.3, delayTime: 0.33, delayFeedback: 0.45 }),
    display: D({ filter: 'shards', density: 0.55, colorMode: 'duo', dark: '#1d0b00', bright: '#ffc15e', music: 'pitch' }) },
  // ---------------------------------------------------------------- Rudra Veena: ragas by time of day -----------------------------------
  { id: 'dawn-bhairavi', name: 'Dawn Bhairavi', blurb: 'Bhairavi (a morning raga), standard tuning, a gentle drone and a soft warm picture.', ...RUDRA(2, 'Bhairavi', { tuning: 'style-a', chikariTuning: 'sa-pa-sa2' }, { drone: 0.3, tone: 0.45 }),
    performance: PERF(), mapping: MAP_RUDRA, synth: SYN.warm, effects: FX({ reverbMix: 0.35, reverbSize: 0.65, delayMix: 0.08, delayTime: 0.4, delayFeedback: 0.3 }),
    display: D({ filter: 'crystal', density: 0.45, colorMode: 'duo', dark: '#2a0e1c', bright: '#ffd9a0', music: 'audio' }) },
  { id: 'evening-bhoopali', name: 'Evening Bhoopali', blurb: 'Bhoopali (a five-note evening raga), Pancham tuning — bright, open and consonant.', ...RUDRA(4, 'Bhoopali', { tuning: 'style-b' }, { drone: 0.35, bloom: 0.7 }),
    performance: PERF(), mapping: MAP_RUDRA, synth: SYN.warm, effects: FX({ reverbMix: 0.4, reverbSize: 0.7, delayMix: 0.1, delayTime: 0.4, delayFeedback: 0.3 }),
    display: D({ filter: 'facets', density: 0.5, colorMode: 'duo', dark: '#0a1a14', bright: '#ffe08a', music: 'pitch' }) },
  { id: 'dusk-marwa', name: 'Dusk Marwa', blurb: 'Marwa at sunset (it leaves out Pa, so the Nishad tuning): restless and unresolved, with a slow echo.', ...RUDRA(2, 'Marwa', { tuning: 'nishad' }, { drone: 0.3, jawari: 0.45 }),
    performance: PERF(), mapping: MAP_RUDRA, synth: SYN.dark, effects: FX({ delayMode: 'pingpong', pingWidth: 0.7, reverbMix: 0.4, reverbSize: 0.75, delayMix: 0.18, delayTime: 0.5, delayFeedback: 0.4 }),
    display: D({ filter: 'relief', density: 0.5, colorMode: 'duo', dark: '#200016', bright: '#ff8a4a', music: 'both' }) },
  { id: 'midnight-malkauns', name: 'Midnight Malkauns', blurb: 'Malkauns, the deep-night raga (Pa-less, Nishad tuning): low, slow and heavy, with a faint CRT glow.', ...RUDRA(0, 'Malkauns', { tuning: 'nishad' }, { drone: 0.4, sustain: 11, resonance: 0.8 }),
    performance: PERF({ sensitivity: 0.9 }), mapping: MAP_RUDRA, synth: SYN.dark, effects: FX({ reverbMix: 0.5, reverbSize: 0.85, delayMix: 0.1, delayTime: 0.5, delayFeedback: 0.35 }),
    display: D({ filter: 'crystal', density: 0.45, colorMode: 'mono', base: '#3d6bff', crt: { on: true, amount: 0.35 }, background: 'mandala' }) },
  { id: 'late-darbari', name: 'Late Darbari', blurb: 'Darbari (a grave late-night raga) with the deep kharaj string and long sustain.', ...RUDRA(2, 'Darbari', { tuning: 'kharaj' }, { drone: 0.4, sustain: 12, andolan: 0.8, bloom: 0.7 }),
    performance: PERF({ sensitivity: 0.9 }), mapping: MAP_RUDRA, synth: SYN.dark, effects: FX({ reverbMix: 0.5, reverbSize: 0.85, delayMix: 0.08, delayTime: 0.5, delayFeedback: 0.3 }),
    display: D({ filter: 'relief', density: 0.4, colorMode: 'mono', base: '#9ec4ff', music: 'audio', bodyVisual: 'face' }) },
  { id: 'monsoon-kafi', name: 'Monsoon Kafi', blurb: 'Kafi, a rainy-season raga: soft meend, a steady drone and cool teal polygons.', ...RUDRA(4, 'Kafi', { tuning: 'style-a' }, { drone: 0.35, meendRange: 5, tone: 0.5 }),
    performance: PERF(), mapping: MAP_RUDRA, synth: SYN.soft, effects: FX({ reverbMix: 0.45, reverbSize: 0.8, delayMix: 0.12, delayTime: 0.45, delayFeedback: 0.35 }),
    display: D({ filter: 'crystal', density: 0.5, colorMode: 'duo', dark: '#021a1f', bright: '#9af0e0', music: 'audio' }) },
];

export const UNIFIED_PRESETS = [...BASE_PRESETS, ...MORE_PRESETS];
export const unifiedPresetById = (id) => UNIFIED_PRESETS.find((p) => p.id === id) ?? null;
/** instrument ids in menu order, with their display names */
export const PRESET_GROUPS = [['theremin', 'Theremin'], ['harp', 'Harp'], ['rudra', 'Rudra Veena']];
export const presetsOfGroup = (gid, list = UNIFIED_PRESETS) => list.filter((p) => p.instrument.id === gid);
