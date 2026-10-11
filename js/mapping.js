/* ==========================================================================
   mapping.js — the MAPPING layer: Trigger -> (min/max, invert, smoothing,
   curve) -> Destination parameter.

   This is the piece the brief called "extremely important": nothing here
   hard-codes which trigger controls which parameter. Every one of the 25
   triggers always has exactly one row (destination defaults to 'none');
   the MappingEngine turns a frame's trigger values into destination
   values generically, then hands each one to whatever setter function
   app.js registered for that destination id. Adding a new trigger or a
   new destination never requires touching this file's transform logic,
   only the TRIGGER_DEFS/DESTINATIONS data (in triggers.js / this file).

   See DEVELOPER_NOTES.md, "The mapping layer and presets (v0.5)".
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

// -- Destination catalog --------------------------------------------------------
// min/max are in the parameter's own musical units — never raw Web Audio
// values the player would have to guess at. `curveCapable` destinations
// additionally accept an 'exponential' curve (useful for anything
// frequency-like, per the brief); everything else is linear only.
import { instrumentDestinationEntries } from './instrumentMappingProfiles.js';

export const DESTINATIONS = [
  { id: 'none', label: 'None', group: 'Off', min: 0, max: 1, unit: '' },
  { id: 'finePitch', label: 'Fine Pitch', group: 'Pitch', min: -0.2, max: 0.2, unit: '' },
  { id: 'oscMix', label: 'Oscillator Mix', group: 'Oscillator', min: 0, max: 1, unit: '' },
  { id: 'oscDetune', label: 'Oscillator Detune', group: 'Oscillator', min: -50, max: 50, unit: 'cents' },
  {
    id: 'filterCutoff',
    label: 'Filter Cutoff (Brightness)',
    group: 'Filter',
    min: 200,
    max: 9000,
    unit: 'Hz',
    curveCapable: true,
    defaultCurve: 'exponential',
  },
  { id: 'filterResonance', label: 'Filter Resonance', group: 'Filter', min: 0.1, max: 20, unit: '' },
  { id: 'lfoRate', label: 'LFO Rate', group: 'Modulation', min: 0.1, max: 20, unit: 'Hz', curveCapable: true },
  { id: 'lfoDepth', label: 'LFO Depth', group: 'Modulation', min: 0, max: 1, unit: '' },
  { id: 'attack', label: 'Attack', group: 'Envelope', min: 0.005, max: 2, unit: 's' },
  { id: 'decay', label: 'Decay', group: 'Envelope', min: 0.005, max: 2, unit: 's' },
  { id: 'sustain', label: 'Sustain', group: 'Envelope', min: 0, max: 1, unit: '' },
  { id: 'release', label: 'Release', group: 'Envelope', min: 0.005, max: 2, unit: 's' },
  { id: 'delayMix', label: 'Delay Mix', group: 'Delay', min: 0, max: 1, unit: '' },
  { id: 'delayTime', label: 'Delay Time', group: 'Delay', min: 0.01, max: 1, unit: 's', curveCapable: true },
  { id: 'delayFeedback', label: 'Delay Feedback', group: 'Delay', min: 0, max: 0.9, unit: '' },
  { id: 'reverbMix', label: 'Reverb Mix', group: 'Reverb', min: 0, max: 1, unit: '' },
  { id: 'reverbSize', label: 'Reverb Size', group: 'Reverb', min: 0, max: 1, unit: '' },
  { id: 'pan', label: 'Pan', group: 'Output', min: -1, max: 1, unit: '' },
  // Instrument parameters (ETHER VEENA): move the ACTIVE instrument's own expressive parameters.
  ...instrumentDestinationEntries(),
];

export function destinationById(id) {
  return DESTINATIONS.find((d) => d.id === id) ?? DESTINATIONS[0];
}

// -- Built-in presets -------------------------------------------------------------
// Right Hand X -> Pitch and Left Hand Y -> Volume are NOT mapping rows:
// they're the always-on core Theremin path (see DEVELOPER_NOTES.md, "Why
// Pitch/Volume aren't mapping destinations"). `coreNote` is shown in the UI
// as a reminder of that; `mappings` is what the preset actually configures
// on top. Any trigger not listed here reverts to 'none' when the preset loads.
export const PRESETS = [
  {
    id: 'classic',
    name: 'Classic Theremin',
    coreNote:
      'Right Hand X → Pitch and Left Hand Y → Volume always run — this preset only adds one gentle touch on top.',
    mappings: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.2, max: 0.9 }],
  },
  {
    id: 'expressive',
    name: 'Expressive',
    coreNote: 'Right Hand X → Pitch and Left Hand Y → Volume always run underneath this preset.',
    mappings: [
      { trigger: 'rightHandDepth', destination: 'filterResonance' },
      { trigger: 'leftHandDepth', destination: 'filterCutoff' },
      { trigger: 'rightIndex', destination: 'lfoDepth' },
      { trigger: 'rightMiddle', destination: 'lfoRate' },
      { trigger: 'rightRing', destination: 'delayMix' },
      { trigger: 'rightPinky', destination: 'reverbMix' },
      { trigger: 'mouthOpen', destination: 'oscDetune', min: 0.3, max: 1 },
      { trigger: 'headRoll', destination: 'pan' },
    ],
  },
  {
    id: 'five-finger',
    name: 'Five Finger',
    coreNote: 'Right Hand X → Pitch and Left Hand Y → Volume always run underneath this preset.',
    mappings: [
      { trigger: 'rightThumb', destination: 'oscMix' },
      { trigger: 'rightIndex', destination: 'finePitch' },
      { trigger: 'rightMiddle', destination: 'filterCutoff' },
      { trigger: 'rightRing', destination: 'filterResonance' },
      { trigger: 'rightPinky', destination: 'reverbMix' },
    ],
  },
  {
    id: 'face-expression',
    name: 'Face Expression',
    coreNote: 'Right Hand X → Pitch and Left Hand Y → Volume always run underneath this preset.',
    mappings: [
      { trigger: 'mouthOpen', destination: 'filterCutoff' },
      { trigger: 'smile', destination: 'filterResonance' },
      { trigger: 'leftEyebrow', destination: 'lfoDepth' },
      { trigger: 'rightEyebrow', destination: 'lfoRate' },
      { trigger: 'headYaw', destination: 'delayMix' },
      { trigger: 'headRoll', destination: 'reverbMix' },
      { trigger: 'headPitch', destination: 'oscDetune' },
    ],
  },
  {
    id: 'experimental',
    name: 'Experimental',
    coreNote: 'Right Hand X → Pitch and Left Hand Y → Volume always run underneath this preset.',
    mappings: [
      { trigger: 'rightHandDepth', destination: 'filterCutoff' },
      { trigger: 'leftHandDepth', destination: 'filterResonance' },
      { trigger: 'rightIndex', destination: 'finePitch' },
      { trigger: 'rightMiddle', destination: 'lfoDepth' },
      { trigger: 'rightRing', destination: 'delayFeedback' },
      { trigger: 'rightPinky', destination: 'reverbMix' },
      // Substituted for the brief's "Mouth Open -> Distortion/Waveshaping":
      // distortion isn't implemented in this pass (see DEVELOPER_NOTES.md),
      // so this routes to a destination that exists instead of a silent gap.
      { trigger: 'mouthOpen', destination: 'delayMix', min: 0.2, max: 1 },
      { trigger: 'headRoll', destination: 'pan' },
    ],
  },
  // ---- build 008: more presets. `settings` also tunes the core hand path (sensitivity) --------
  {
    id: 'stable',
    name: 'Stable',
    coreNote: 'Lower sensitivity: bigger hand movements for the same pitch change — steadier, less twitchy.',
    settings: { sensitivity: 0.8 },
    mappings: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.3, max: 0.85 }],
  },
  {
    id: 'sensitive',
    name: 'Sensitive',
    coreNote: 'Higher sensitivity: small movements reach the edges of the control zone.',
    settings: { sensitivity: 1.6 },
    mappings: [{ trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.2, max: 0.9 }],
  },
  {
    id: 'wide-range',
    name: 'Wide Range',
    coreNote: 'Highest sensitivity: the whole pitch range in a compact gesture.',
    settings: { sensitivity: 2.0 },
    mappings: [
      { trigger: 'rightHandDepth', destination: 'filterCutoff', min: 0.25, max: 0.9 },
      { trigger: 'leftHandDepth', destination: 'reverbMix', min: 0, max: 0.5 },
    ],
  },
  {
    id: 'fine-pitch',
    name: 'Fine Pitch',
    coreNote: 'Finger shape trims the pitch on top of hand position (thumb-index pinch always does; this adds the thumb curl).',
    settings: { sensitivity: 1.2 },
    mappings: [
      { trigger: 'rightThumb', destination: 'finePitch', min: 0.35, max: 0.65 },
      { trigger: 'rightHandDepth', destination: 'filterCutoff' },
    ],
  },
  {
    id: 'harp-performance',
    name: 'Harp Performance',
    coreNote: 'For Harp: all fingers sweep strings, so mappings use depth, face and head only.',
    mappings: [
      { trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.1, max: 0.65 },
      { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.35 },
      { trigger: 'headYaw', destination: 'pan', min: 0.25, max: 0.75 },
      { trigger: 'mouthOpen', destination: 'reverbSize' },
    ],
  },
  {
    id: 'rudra-expressive',
    name: 'Rudra Expressive',
    coreNote: 'For Rudra Veena: the right fingers pluck and the left hand plays the neck — space and colour come from depth, face and head.',
    mappings: [
      { trigger: 'rightHandDepth', destination: 'reverbMix', min: 0.15, max: 0.7 },
      { trigger: 'leftHandDepth', destination: 'delayMix', min: 0, max: 0.3 },
      { trigger: 'mouthOpen', destination: 'reverbSize' },
      { trigger: 'headRoll', destination: 'pan', min: 0.35, max: 0.65 },
    ],
  },
];

const DEFAULT_SMOOTHING = 0.3;
const LOCAL_STORAGE_KEY = 'webTheremin.customMapping.v1';

function normalizeRow(partial) {
  const destination = destinationById(partial.destination ?? 'none');
  return {
    trigger: partial.trigger,
    destination: destination.id,
    min: partial.min ?? 0,
    max: partial.max ?? 1,
    invert: partial.invert ?? false,
    smoothing: partial.smoothing ?? DEFAULT_SMOOTHING,
    curve: partial.curve ?? destination.defaultCurve ?? 'linear',
  };
}

export class MappingEngine {
  /** @param {string[]} triggerIds All 25 trigger ids, from TRIGGER_DEFS. */
  constructor(triggerIds) {
    this._triggerIds = triggerIds;
    /** @type {Map<string, ReturnType<typeof normalizeRow>>} One entry per
     *  trigger, always — 'none' destination means unassigned. */
    this.rows = new Map(triggerIds.map((id) => [id, normalizeRow({ trigger: id, destination: 'none' })]));
    /** trigger id -> additional rows: ONE trigger can drive SEVERAL parameters (e.g. mouth → cutoff + reverb). */
    this.extra = new Map();
    /** Per-row results of the last frame, for the HUD: {trigger, destination, fraction, value} */
    this.lastRowOutputs = [];
    /** destination id -> (nativeValue: number) => void */
    this._setters = new Map();
    /** trigger id -> smoothed 0..1 value. */
    this._smoothedByTrigger = new Map();
    /** destination id -> last computed native value, for the overlay. */
    this.lastOutputs = new Map();
  }

  registerDestination(destinationId, setter) {
    this._setters.set(destinationId, setter);
  }

  /** Load a preset (or a saved custom set): resets every row to 'none',
   *  then applies the given partial rows on top. */
  setMappings(partialRows) {
    for (const id of this._triggerIds) this.rows.set(id, normalizeRow({ trigger: id, destination: 'none' }));
    this.extra.clear();
    for (const partial of partialRows) {
      if (!this.rows.has(partial.trigger)) continue;
      // the first row for a trigger is its editable primary row; further rows are additional parameters
      if (this.rows.get(partial.trigger).destination === 'none') this.rows.set(partial.trigger, normalizeRow(partial));
      else {
        const list = this.extra.get(partial.trigger) ?? [];
        list.push(normalizeRow(partial));
        this.extra.set(partial.trigger, list);
      }
    }
    this._smoothedByTrigger.clear();
  }

  /** Update one trigger's row (from the mapping editor UI). */
  updateRow(triggerId, changes) {
    const current = this.rows.get(triggerId);
    if (!current) return;
    this.rows.set(triggerId, normalizeRow({ ...current, ...changes }));
    if (changes.destination !== undefined) this._smoothedByTrigger.delete(triggerId);
  }

  getRow(triggerId) {
    return this.rows.get(triggerId);
  }

  /** Serializable snapshot of every non-'none' row, for saving. */
  exportAssignedRows() {
    return [...this.rows.values(), ...[...this.extra.values()].flat()].filter((r) => r.destination !== 'none');
  }

  /** Every active row of one trigger: the primary row plus any additional ones. */
  rowsFor(triggerId) {
    return [this.rows.get(triggerId), ...(this.extra.get(triggerId) ?? [])].filter((r) => r && r.destination !== 'none');
  }

  /**
   * Apply one frame's trigger values through every assigned row and call
   * each destination's registered setter.
   * @param {Object<string, {raw:number, value01:number}>} triggerValues
   * @returns {Set<string>} destination ids that were driven by a mapping
   *   this frame (several rows sharing a destination are averaged) — theremin.js's auto-vibrato fallback uses this to know
   *   when a manual mapping should take priority over gesture detection.
   */
  process(triggerValues) {
    this.lastOutputs.clear();

    // Several triggers may feed one destination (e.g. mouth AND hand depth
    // both steering the filter). Rather than last-row-wins — where a
    // resting trigger would silently cancel an active one — every row's
    // native value is collected and the destination receives their mean.
    const perDestination = new Map(); // destination id -> {sum, count}

    this.lastRowOutputs = [];
    const all = [];
    for (const [triggerId, row] of this.rows) {
      if (row.destination !== 'none') all.push([triggerId, row, triggerId]);
      (this.extra.get(triggerId) ?? []).forEach((r, i) => { if (r.destination !== 'none') all.push([triggerId, r, `${triggerId}#${i + 1}`]); });
    }
    for (const [triggerId, row, key] of all) {
      const trigger = triggerValues[triggerId];
      if (!trigger) continue;
      const destination = destinationById(row.destination);

      const smoothed = this._smoothRow(key, trigger.value01, row.smoothing);
      const inverted = row.invert ? 1 - smoothed : smoothed;
      const fraction = Math.min(1, Math.max(0, row.min + inverted * (row.max - row.min)));
      const nativeValue = this._toNative(destination, fraction, row.curve);
      this.lastRowOutputs.push({ trigger: triggerId, destination: destination.id, fraction, value: nativeValue, raw: trigger.raw });

      const acc = perDestination.get(destination.id) ?? { sum: 0, count: 0 };
      acc.sum += nativeValue;
      acc.count += 1;
      perDestination.set(destination.id, acc);
    }

    const touchedDestinations = new Set();
    for (const [destinationId, { sum, count }] of perDestination) {
      const value = sum / count;
      const setter = this._setters.get(destinationId);
      if (setter) setter(value);
      this.lastOutputs.set(destinationId, value);
      touchedDestinations.add(destinationId);
    }
    return touchedDestinations;
  }

  _smoothRow(triggerId, value01, smoothing) {
    const prev = this._smoothedByTrigger.get(triggerId);
    const next = prev === undefined ? value01 : prev + (value01 - prev) * (1 - smoothing);
    this._smoothedByTrigger.set(triggerId, next);
    return next;
  }

  _toNative(destination, fraction01, curve) {
    if (curve === 'exponential' && destination.min > 0) {
      const logMin = Math.log(destination.min);
      const logMax = Math.log(destination.max);
      return Math.exp(logMin + (logMax - logMin) * fraction01);
    }
    return destination.min + fraction01 * (destination.max - destination.min);
  }

  /** Save the currently-assigned rows to localStorage. Returns false (and
   *  leaves storage untouched) if it isn't available rather than throwing. */
  saveCustom() {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(this.exportAssignedRows()));
      return true;
    } catch (_err) {
      return false;
    }
  }

  /** @returns {Array|null} The saved custom rows, or null if none exist. */
  loadCustom() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (_err) {
      return null;
    }
  }

  clearCustom() {
    try {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (_err) {
      /* ignore */
    }
  }
}
