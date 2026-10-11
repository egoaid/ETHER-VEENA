/* ==========================================================================
   scales.js — MIDI/frequency conversion, note names, chromatic quantization,
   scale definitions, nearest-scale-note search, and the pitch-mode engine
   that turns continuous hand pitch into Continuous / Chromatic / Snap to
   Scale / Filter Out of Scale / Easy Scale behavior.

   This module knows nothing about hands, cameras, or the DOM — it's pure
   pitch math, so it can be tested and reused independently of the rest of
   the app. See DEVELOPER_NOTES.md, "Scales, quantization, and the pitch
   modes (v0.4)" for the full design write-up.

   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * The 30 scales offered by Novation's Launchkey/Launchpad scale mode,
 * reproduced here as pitch-class interval sets (semitones above the root,
 * within one octave) rather than hard-coded note lists, so any root can
 * reuse the same definition. The Pelog entries are the same 12-TET
 * approximation Launchkey uses — genuine Balinese pelog isn't 12-tone
 * equal temperament, but a fixed hand-tracked oscillator has no other
 * tuning system to draw on here, and this keeps the app consistent with
 * the well-known controller feature the brief asked to mirror.
 */
export const SCALES = {
  Major: [0, 2, 4, 5, 7, 9, 11],
  'Dorian #4': [0, 2, 3, 6, 7, 9, 10],
  Minor: [0, 2, 3, 5, 7, 8, 10],
  'Phrygian Dominant': [0, 1, 4, 5, 7, 8, 10],
  Dorian: [0, 2, 3, 5, 7, 9, 10],
  'Melodic Minor': [0, 2, 3, 5, 7, 9, 11],
  Mixolydian: [0, 2, 4, 5, 7, 9, 10],
  'Lydian Augmented': [0, 2, 4, 6, 8, 9, 11],
  Lydian: [0, 2, 4, 6, 7, 9, 11],
  'Lydian Dominant': [0, 2, 4, 6, 7, 9, 10],
  Phrygian: [0, 1, 3, 5, 7, 8, 10],
  'Super Locrian': [0, 1, 3, 4, 6, 8, 10],
  Locrian: [0, 1, 3, 5, 6, 8, 10],
  '8-tone Spanish': [0, 1, 3, 4, 5, 6, 8, 10],
  'Whole Tone': [0, 2, 4, 6, 8, 10],
  Bhairav: [0, 1, 4, 5, 7, 8, 11],
  'Half Whole Dim': [0, 1, 3, 4, 6, 7, 9, 10],
  'Hungarian Minor': [0, 2, 3, 6, 7, 8, 11],
  'Whole Half Diminished': [0, 2, 3, 5, 6, 8, 9, 11],
  Hirajoshi: [0, 2, 3, 7, 8],
  Blues: [0, 3, 5, 6, 7, 10],
  'In-Sen': [0, 1, 5, 7, 10],
  'Minor Pentatonic': [0, 3, 5, 7, 10],
  Iwato: [0, 1, 5, 6, 10],
  'Major Pentatonic': [0, 2, 4, 7, 9],
  Kumoi: [0, 2, 3, 7, 9],
  'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11],
  'Pelog-Selisir': [0, 1, 3, 7, 8],
  'Harmonic Major': [0, 2, 4, 5, 7, 8, 11],
  'Pelog-Tembung': [0, 1, 5, 7, 8],
};

export const SCALE_NAMES = Object.keys(SCALES);
export const ROOT_NAMES = NOTE_NAMES_SHARP; // C..B, index = pitch class 0..11

export const PITCH_MODES = ['continuous', 'chromatic', 'snap-scale', 'filter-scale', 'easy-scale'];

export function mod12(n) {
  return ((n % 12) + 12) % 12;
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * @param {number} midi Need not be an integer; rounded for naming.
 * @param {boolean} [useFlats]
 * @returns {{name: string, octave: number, fullName: string}}
 */
export function midiToNoteName(midi, useFlats = false) {
  const rounded = Math.round(midi);
  const pc = mod12(rounded);
  const names = useFlats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP;
  const name = names[pc];
  // MIDI 60 = C4 (middle C), the standard (if not universal) convention.
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, fullName: `${name}${octave}` };
}

/**
 * @param {number} rootPc 0..11 (C..B)
 * @param {string} scaleName Key into SCALES
 * @returns {Set<number>} Pitch classes (0..11) belonging to the scale.
 */
export function scalePitchClassSet(rootPc, scaleName) {
  const intervals = SCALES[scaleName] || SCALES.Major;
  return new Set(intervals.map((i) => mod12(rootPc + i)));
}

/** Nearest integer MIDI note — i.e. the nearest semitone, with no scale involved. */
export function nearestChromaticMidi(continuousMidi) {
  return Math.round(continuousMidi);
}

/**
 * Nearest MIDI note whose pitch class belongs to the given scale set.
 * Searches outward semitone-by-semitone from the rounded value — cheap and
 * exact for any interval pattern, including scales with gaps of a minor
 * third or more (pentatonic scales, Whole Tone, etc).
 * @param {number} continuousMidi
 * @param {Set<number>} pitchClassSet
 */
export function nearestScaleMidi(continuousMidi, pitchClassSet) {
  const rounded = Math.round(continuousMidi);
  if (pitchClassSet.has(mod12(rounded))) return rounded;
  for (let radius = 1; radius <= 12; radius++) {
    const lower = rounded - radius;
    const upper = rounded + radius;
    const lowerOk = pitchClassSet.has(mod12(lower));
    const upperOk = pitchClassSet.has(mod12(upper));
    if (lowerOk && upperOk) {
      return Math.abs(continuousMidi - lower) <= Math.abs(continuousMidi - upper) ? lower : upper;
    }
    if (lowerOk) return lower;
    if (upperOk) return upper;
  }
  return rounded; // unreachable in practice — every scale here has >=1 pitch class
}

/**
 * Stateful hysteresis snapper: once locked onto a target, only moves to a
 * new candidate when it's *meaningfully* closer than staying put, so a hand
 * hovering near the midpoint between two notes doesn't rapidly flicker
 * between them. Works for any candidate spacing (semitone or scale degree)
 * since the comparison is purely distance-based, not a fixed boundary.
 */
export class NoteSnapper {
  /** @param {number} [hysteresisSemitones] How much closer a new candidate
   *    must be before switching away from the current lock. */
  constructor(hysteresisSemitones = 0.15) {
    this.hysteresis = hysteresisSemitones;
    this.lockedMidi = null;
  }

  reset() {
    this.lockedMidi = null;
  }

  /**
   * @param {number} continuousMidi Current unquantized pitch, in MIDI units.
   * @param {(continuousMidi: number) => number} nearestFn e.g.
   *   nearestChromaticMidi, or (m) => nearestScaleMidi(m, pcSet).
   * @returns {number} The locked target MIDI note.
   */
  snap(continuousMidi, nearestFn) {
    const candidate = nearestFn(continuousMidi);
    if (this.lockedMidi === null) {
      this.lockedMidi = candidate;
      return this.lockedMidi;
    }
    if (candidate !== this.lockedMidi) {
      const distToCandidate = Math.abs(continuousMidi - candidate);
      const distToLocked = Math.abs(continuousMidi - this.lockedMidi);
      if (distToLocked - distToCandidate > this.hysteresis) {
        this.lockedMidi = candidate;
      }
    }
    return this.lockedMidi;
  }
}

// One octave, stretched across the player's full pitch01 (0..1) range —
// see the "Easy Scale" write-up in DEVELOPER_NOTES.md for why compressing
// the range (rather than a bespoke spatial mapping) is what makes each
// scale degree a comfortably wide, stable region.
export const EASY_SCALE_SPAN_SEMITONES = 12;

/**
 * The MIDI note, at or below the geometric-mean of [minFreq, maxFreq],
 * whose pitch class matches the chosen root — the anchor Easy Scale's
 * compressed one-octave window is built on. Exported standalone (not just
 * a method on PitchModeProcessor) so the UI grid can lay itself out
 * identically without duplicating the anchor calculation.
 */
export function easyScaleBaseMidi(minFreq, maxFreq, rootPc) {
  const centerMidi = (freqToMidi(minFreq) + freqToMidi(maxFreq)) / 2;
  const rounded = Math.round(centerMidi);
  const offset = mod12(rootPc - rounded);
  return rounded + (offset > 6 ? offset - 12 : offset);
}

/**
 * Converts continuous hand pitch into whatever the current pitch mode
 * needs: a target frequency (always smoothly approached, never a retrigger)
 * plus the note-name/scale-position info the UI displays. One instance
 * should live for the lifetime of the app so its NoteSnappers keep their
 * hysteresis state between frames; call reset() when the mode changes.
 */
export class PitchModeProcessor {
  /**
   * @param {Object} options
   * @param {number} options.minFreq
   * @param {number} options.maxFreq
   */
  constructor({ minFreq, maxFreq }) {
    this.minFreq = minFreq;
    this.maxFreq = maxFreq;
    this._minMidi = freqToMidi(minFreq);
    this._maxMidi = freqToMidi(maxFreq);

    this._chromaticSnapper = new NoteSnapper();
    this._scaleSnapper = new NoteSnapper();
    this._easyScaleSnapper = new NoteSnapper();
  }

  /** Call when the pitch mode changes, so a stale hysteresis lock from the
   *  previous mode doesn't linger and cause an unexpected first jump. */
  reset() {
    this._chromaticSnapper.reset();
    this._scaleSnapper.reset();
    this._easyScaleSnapper.reset();
  }

  /**
   * @param {Object} args
   * @param {number} args.pitch01 0..1, from HandControls — unchanged,
   *   continuous, hand-position-derived input.
   * @param {'continuous'|'chromatic'|'snap-scale'|'filter-scale'|'easy-scale'} args.mode
   * @param {number} args.rootPc 0..11
   * @param {string} args.scaleName Key into SCALES
   * @returns {{
   *   targetFreqHz: number, gate01: number,
   *   displayMidi: number, inScale: boolean, scaleDegreeIndex: number,
   *   continuousMidi: number
   * }}
   *   targetFreqHz is always what the oscillator should smoothly move
   *   toward — the oscillator itself never stops/restarts regardless of
   *   mode. gate01 is 1 except in Filter Out of Scale, where it's 0 for an
   *   out-of-scale pitch (muted, not silenced by stopping anything).
   *   displayMidi is for the note-name readout; scaleDegreeIndex is -1
   *   outside scale-degree-based modes/notes, else the index into the
   *   scale's pitch classes (for Easy Scale's grid highlight).
   *   continuousMidi is the pre-snap value (in whichever MIDI space the
   *   mode uses — full-range or Easy Scale's compressed window) for
   *   positioning a smooth, unsnapped indicator on the UI grid.
   */
  process({ pitch01, mode, rootPc, scaleName }) {
    const pcSet = scalePitchClassSet(rootPc, scaleName);
    const continuousMidi = this._minMidi + (this._maxMidi - this._minMidi) * clamp01(pitch01);

    if (mode === 'chromatic') {
      const target = this._chromaticSnapper.snap(continuousMidi, nearestChromaticMidi);
      return this._result(target, 1, pcSet, continuousMidi);
    }

    if (mode === 'snap-scale') {
      const target = this._scaleSnapper.snap(continuousMidi, (m) => nearestScaleMidi(m, pcSet));
      return this._result(target, 1, pcSet, continuousMidi);
    }

    if (mode === 'filter-scale') {
      // Continuous pitch, unquantized — only the gate depends on the scale.
      const nearestPc = mod12(nearestChromaticMidi(continuousMidi));
      const inScale = pcSet.has(nearestPc);
      return this._result(continuousMidi, inScale ? 1 : 0, pcSet, continuousMidi);
    }

    if (mode === 'easy-scale') {
      const easyMidiBase = easyScaleBaseMidi(this.minFreq, this.maxFreq, rootPc);
      const easyContinuousMidi = easyMidiBase + EASY_SCALE_SPAN_SEMITONES * clamp01(pitch01);
      const target = this._easyScaleSnapper.snap(easyContinuousMidi, (m) => nearestScaleMidi(m, pcSet));
      return this._result(target, 1, pcSet, easyContinuousMidi);
    }

    // 'continuous' (default): plain unquantized mapping, exactly as v0.1–v0.3.
    return this._result(continuousMidi, 1, pcSet, continuousMidi);
  }

  _result(targetMidi, gate01, pcSet, continuousMidiRaw) {
    // displayMidi reflects what's actually sounding: the snapped target in
    // quantized modes, or the (unsnapped) continuous position in Continuous
    // and Filter Out of Scale modes, where targetMidi IS the continuous
    // value (no snapping happens in either). continuousMidiRaw is kept
    // separate purely for the UI's smooth, unsnapped grid indicator.
    const displayMidi = Math.round(targetMidi);
    const pc = mod12(displayMidi);
    const pitchClasses = [...pcSet].sort((a, b) => a - b);
    const scaleDegreeIndex = pitchClasses.indexOf(mod12(Math.round(targetMidi)));
    return {
      targetFreqHz: midiToFreq(targetMidi),
      gate01,
      displayMidi,
      inScale: pcSet.has(pc),
      scaleDegreeIndex,
      continuousMidi: continuousMidiRaw,
    };
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
