/* ==========================================================================
   theremin.js — the synthesizer / effects engine (SYNTH / EFFECT PARAMETER
   layer of the BODY INPUT -> TRIGGER -> MAPPING -> PARAMETER architecture)

   Graph:

       osc1 -> osc1Gain ─┐
       osc2 -> osc2Gain ─┴─> filter -> envelopeGain (ADSR) -> handGain ─┬─> dry ────────────┐
                                  ^                                     ├─> delay -> delayWet┤
                          LFO (pitch/cutoff/amplitude target) ──────────┴─> reverb -> revWet ┤
                                                                                              ▼
                                                                                        masterGain
                                                                                              ↓
                                                                                        pannerNode
                                                                                              ↓
                                                                                         analyser (oscilloscope tap)
                                                                                              ↓
                                                                                          destination

   This module knows nothing about hands, triggers, or mappings — every
   method here is "set this musical parameter", called either by the core
   Theremin path (pitch01/volume01 from handControls.js + scales.js) or by
   mapping.js's generic destination setters. See DEVELOPER_NOTES.md,
   "Synthesizer expansion (v0.5)" for the full design write-up.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const DEFAULT_LFO_RATE_HZ = 5.5;
const MAX_VIBRATO_SEMITONES = 1.2; // raised from v0.4's 0.6 — must be clearly audible per the brief
const LFO_FILTER_OCTAVE_RANGE = 2.0; // max cutoff swing when LFO targets Filter Cutoff
const LFO_AMPLITUDE_MAX = 0.35; // max gain swing when LFO targets Amplitude

const MIN_CUTOFF_HZ = 200;
const MAX_CUTOFF_HZ = 9000;
const MIN_Q = 0.1;
const MAX_Q = 20;
const DEPTH_BRIGHTNESS_OCTAVES = 2.5;
const DEPTH_RESONANCE_RANGE = 8;

const FINE_PITCH_MAP_SEMITONE_RANGE = 4; // ±4 semitones at the mapping's fine-pitch extremes

const MAX_DELAY_SECONDS = 1.0;
const REVERB_MIN_SECONDS = 0.4;
const REVERB_MAX_SECONDS = 3.5;
const REVERB_MAX_SECONDS_LIGHT = 2.0; // Light sound engine: a shorter convolution tail (cheaper)
const REVERB_WET_BOOST = 1.7; // the convolved signal is much quieter than the dry one: compensate so Mix means what it says
const REVERB_REGEN_THRESHOLD = 0.04; // don't rebuild the impulse response for tiny changes
const REVERB_REGEN_MIN_MS = 260; // …nor more often than this (a trailing rebuild catches the latest value)
const REVERB_XFADE_TAU = 0.035; // s: old → new impulse response cross-fade (swapping a ConvolverNode buffer in place clicks)
const MIN_ENV_SECONDS = 0.005; // attack / release floor: a faster edge is a click

/** Transparent soft clipper: identical below the knee, then a smooth tanh shoulder up to ±CEIL (never a hard digital clip). */
export function makeSoftClipCurve(n = 2049, knee = 0.8, ceil = 0.98) {
  const c = new Float32Array(n); const span = ceil - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1; const a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= knee ? a : knee + span * Math.tanh((a - knee) / span));
  }
  return c;
}

import { PingPongDelay } from './pingPongDelay.js';

export class ThereminEngine {
  /**
   * @param {Object} [options]
   * @param {number} [options.minFreq]
   * @param {number} [options.maxFreq]
   * @param {number} [options.smoothingSeconds]
   */
  constructor(options = {}) {
    this.minFreq = options.minFreq ?? 130.81; // C3
    this.maxFreq = options.maxFreq ?? 1046.5; // C6
    this.smoothingSeconds = options.smoothingSeconds ?? 0.045;

    this.audioContext = null;
    this.isRunning = false;
    this.currentVolume01 = 0;

    // -- User/manual base settings (Sound panel), all overridable per-frame
    // by an active mapping targeting the same destination. -------------------
    this.waveform = 'sine';
    this.oscMix01 = 0; // 0 = only osc1
    this.oscDetuneCents = 0;
    this.filterType = 'lowpass';
    this.brightness01 = 0.85;
    this.resonance01 = 0.15;
    this.attackSeconds = 0.08;
    this.decaySeconds = 0.12;
    this.sustainLevel = 0.85;
    this.releaseSeconds = 0.15;
    this.lfoTarget = 'pitch'; // 'pitch' | 'filterCutoff' | 'amplitude'
    this.lfoBaseRateHz = DEFAULT_LFO_RATE_HZ;
    this.lfoBaseDepth01 = 0.5;
    this.delayMix01 = 0;
    this.delayTimeSeconds = 0.25;
    this.delayFeedback01 = 0.3;
    this.delayMode = 'normal'; // 'normal' | 'pingpong'
    this.pingWidth01 = 1;
    this.reverbMix01 = 0;
    this.reverbSize01 = 0.4;
    this.pan = 0;

    this._baseTargetFreq = this._pitchToFrequency(0.5);
    this._mappedFinePitchOffset01 = 0;
    this._envelopeGateOn = false;
    this._lastReverbSize = null;
    this._thereminActive = true;
  }

  async start() {
    if (this.isRunning) return;
    this._starting = true;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API is not supported in this browser.');

    if (!this.audioContext) this.audioContext = new AudioCtx();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // -- Oscillators + mixer ------------------------------------------------
    this.osc1 = ctx.createOscillator();
    this.osc1.type = this.waveform;
    this.osc1.frequency.setValueAtTime(this._baseTargetFreq, now);

    this.osc2 = ctx.createOscillator();
    this.osc2.type = this.waveform;
    this.osc2.frequency.setValueAtTime(this._baseTargetFreq, now);
    this.osc2.detune.setValueAtTime(this.oscDetuneCents, now);

    this.osc1Gain = ctx.createGain();
    this.osc2Gain = ctx.createGain();
    this.osc1Gain.gain.setValueAtTime(1 - this.oscMix01, now);
    this.osc2Gain.gain.setValueAtTime(this.oscMix01, now);

    // -- Filter ---------------------------------------------------------------
    this.filter = ctx.createBiquadFilter();
    this.filter.type = this.filterType;
    this.filter.frequency.setValueAtTime(this._brightnessToCutoff(this.brightness01), now);
    this.filter.Q.setValueAtTime(this._resonanceToQ(this.resonance01), now);

    // -- ADSR envelope gate (the instrument's one discrete on/off event —
    // see "Envelope" in DEVELOPER_NOTES.md) ------------------------------------
    this.envelopeGain = ctx.createGain();
    this.envelopeGain.gain.setValueAtTime(0, now);
    this._envelopeGateOn = false;

    // -- Hand-driven volume (always immediate, never run through the ADSR) ----
    this.handGain = ctx.createGain();
    this.handGain.gain.setValueAtTime(0, now);

    // -- Instrument routing (v0.6): the continuous Theremin voice passes through
    // `thereminOut` (a gate: closed when a discrete instrument is selected) and
    // the polyphonic voice pool feeds `voiceBus`. Both meet at handGain, so
    // volume, delay, reverb, pan and the oscilloscope apply to every instrument.
    this.thereminOut = ctx.createGain();
    this.thereminOut.gain.setValueAtTime(this._thereminActive ? 1 : 0, now);
    this.voiceBus = ctx.createGain();
    this.voiceBus.gain.setValueAtTime(1, now);

    // -- Delay ------------------------------------------------------------------
    this.delayNode = ctx.createDelay(MAX_DELAY_SECONDS);
    this.delayNode.delayTime.setValueAtTime(this.delayTimeSeconds, now);
    this.delayFeedbackGain = ctx.createGain();
    this.delayFeedbackGain.gain.setValueAtTime(this.delayFeedback01, now);
    this.delayWetGain = ctx.createGain();
    this.delayWetGain.gain.setValueAtTime(this.delayMix01, now);
    // Ping-pong delay (Build 027): a separate path, silent while the mode is Normal
    this.pingSend = ctx.createGain();
    this.pingSend.gain.setValueAtTime(0, now);
    this.pingPong = new PingPongDelay(ctx, { maxDelay: MAX_DELAY_SECONDS, time: this.delayTimeSeconds, feedback: this.delayFeedback01, width: this.pingWidth01 });
    this.pingWetGain = ctx.createGain();
    this.pingWetGain.gain.setValueAtTime(0, now);

    // -- Reverb (ConvolverNode with a synthesized impulse response) -----------
    this.convolver = ctx.createConvolver(); // two convolvers (A/B): a new impulse goes into the idle one and is cross-faded in
    this.convolver.normalize = true;
    this.convolverB = ctx.createConvolver();
    this.convolverB.normalize = true;
    this._xfA = ctx.createGain(); this._xfA.gain.setValueAtTime(1, now);
    this._xfB = ctx.createGain(); this._xfB.gain.setValueAtTime(0, now);
    this._reverbActive = 'A'; this._lastReverbSize = null; this._lastReverbAt = 0;
    this._rebuildReverbImpulse(this.reverbSize01, true);
    this.reverbWetGain = ctx.createGain();
    this.reverbWetGain.gain.setValueAtTime(this.reverbMix01 * REVERB_WET_BOOST, now);

    // -- Master / pan / analyser (oscilloscope tap) ----------------------------
    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(1, now);
    this.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.panner) this.panner.pan.setValueAtTime(this.pan, now);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    // Output protection: a limiter + a soft clipper after the pan, so no patch (loud preset, high resonance, delay + reverb piling up, many voices) can clip.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-10, now); this.limiter.knee.setValueAtTime(6, now); this.limiter.ratio.setValueAtTime(16, now);
    this.limiter.attack.setValueAtTime(0.002, now); this.limiter.release.setValueAtTime(0.18, now);
    this.softClip = ctx.createWaveShaper(); this.softClip.curve = makeSoftClipCurve(); this.softClip.oversample = '2x';

    // -- LFO (vibrato when targeting pitch; general modulation otherwise) -----
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.setValueAtTime(this.lfoBaseRateHz, now);
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.setValueAtTime(0, now);
    this.lfo.connect(this.lfoGain);
    this._connectLfoTarget(this.lfoTarget);
    this.lfo.start();

    // -- Wire the signal path --------------------------------------------------
    this.osc1.connect(this.osc1Gain).connect(this.filter);
    this.osc2.connect(this.osc2Gain).connect(this.filter);
    this.filter.connect(this.envelopeGain);
    this.envelopeGain.connect(this.thereminOut);
    this.thereminOut.connect(this.handGain);
    this.voiceBus.connect(this.handGain);

    // Dry path
    this.handGain.connect(this.masterGain);
    // Delay send (feedback loop) + wet
    this.handGain.connect(this.delayNode);
    this.delayNode.connect(this.delayFeedbackGain);
    this.delayFeedbackGain.connect(this.delayNode);
    this.delayNode.connect(this.delayWetGain);
    this.delayWetGain.connect(this.masterGain);
    // Ping-pong send + wet (stereo)
    this.handGain.connect(this.pingSend);
    this.pingSend.connect(this.pingPong.input);
    this.pingPong.out.connect(this.pingWetGain);
    this.pingWetGain.connect(this.masterGain);
    // Reverb send + wet
    this._revConn = { A: false, B: false }; this._syncReverbInput(); // the convolvers get input only while they are needed (see _syncReverbInput)
    this.convolver.connect(this._xfA); this.convolverB.connect(this._xfB);
    this._xfA.connect(this.reverbWetGain); this._xfB.connect(this.reverbWetGain);
    this.reverbWetGain.connect(this.masterGain);

    const preLimiter = this.panner ? (this.masterGain.connect(this.panner), this.panner) : this.masterGain;
    preLimiter.connect(this.limiter);
    this.limiter.connect(this.softClip);
    this.softClip.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.osc1.start();
    this.osc2.start();

    this.isRunning = true; this._starting = false;
    this.currentVolume01 = 0;
  }

  stop() {
    if (!this.isRunning) return;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    try {
      this.handGain.gain.cancelScheduledValues(now);
      this.handGain.gain.setTargetAtTime(0, now, 0.03);
      this.envelopeGain.gain.cancelScheduledValues(now);
      this.envelopeGain.gain.setTargetAtTime(0, now, 0.03);
      this.lfoGain.gain.cancelScheduledValues(now);
      this.lfoGain.gain.setTargetAtTime(0, now, 0.03);
    } catch (_err) {
      /* context may already be closing */
    }

    const nodesToStop = [this.osc1, this.osc2, this.lfo];
    const nodesToDisconnect = [
      this.osc1Gain,
      this.osc2Gain,
      this.filter,
      this.envelopeGain,
      this.thereminOut,
      this.voiceBus,
      this.handGain,
      this.delayNode,
      this.delayFeedbackGain,
      this.delayWetGain,
      this.pingSend,
      ...(this.pingPong ? this.pingPong.nodes : []),
      this.pingWetGain,
      this.convolver,
      this.convolverB,
      this._xfA,
      this._xfB,
      this.limiter,
      this.softClip,
      this.reverbWetGain,
      this.masterGain,
      this.panner,
      this.analyser,
      this.lfoGain,
    ].filter(Boolean);

    setTimeout(() => {
      try {
        for (const n of nodesToStop) n.stop();
        for (const n of [...nodesToStop, ...nodesToDisconnect]) n.disconnect();
      } catch (_err) {
        /* already stopped */
      }
    }, 80);

    this.osc1 = null;
    this.osc2 = null;
    this.osc1Gain = null;
    this.osc2Gain = null;
    this.filter = null;
    this.envelopeGain = null;
    this.thereminOut = null;
    this.voiceBus = null;
    this.handGain = null;
    this.delayNode = null;
    this.delayFeedbackGain = null;
    this.delayWetGain = null;
    this.pingSend = null;
    this.pingPong = null;
    this.pingWetGain = null;
    this.convolver = null;
    this.convolverB = null;
    this._xfA = null;
    this._xfB = null;
    this.limiter = null;
    this.softClip = null;
    clearTimeout(this._reverbTimer); clearTimeout(this._revIdleTimer); clearTimeout(this._revOldTimer); this._irToken = (this._irToken || 0) + 1; this._revConn = null;
    this.reverbWetGain = null;
    this.masterGain = null;
    this.panner = null;
    this.analyser = null;
    this.lfo = null;
    this.lfoGain = null;

    this.isRunning = false;
    this.currentVolume01 = 0;
    this._envelopeGateOn = false;
    this._lastReverbSize = null;
  }

  // -- Instrument routing (v0.6) -----------------------------------------------

  /** Open/close the continuous Theremin voice. Closed while a discrete
   *  instrument (Harp, Rudra Veena) is selected. Oscillators keep running — this
   *  is a smooth gain ramp, never a stop/restart. */
  setThereminActive(active) {
    this._thereminActive = !!active;
    if (this.isRunning) this.thereminOut.gain.setTargetAtTime(active ? 1 : 0, this.audioContext.currentTime, 0.03);
  }

  /** Where a VoiceManager should connect its output. */
  getVoiceDestination() {
    return this.isRunning ? this.voiceBus : null;
  }

  // -- Core Theremin path (pitch/volume) --------------------------------------

  /** Thin wrapper for Continuous mode; every pitch mode ultimately calls
   *  setTargetFrequencyHz, same as v0.4. */
  setPitch01(pitch01) {
    this.setTargetFrequencyHz(this._pitchToFrequency(clamp01(pitch01)));
  }

  setTargetFrequencyHz(freqHz) {
    if (!(freqHz > 0)) return;
    this._baseTargetFreq = freqHz;
    this._applyEffectiveFrequency();
  }

  /** Additive fine-pitch contribution from the generic mapping system
   *  (e.g. Right Index -> Fine Pitch), layered on top of — not replacing —
   *  the built-in pinch-based fine pitch already folded into pitch01 by
   *  handControls.js. @param {number} offset01 -0.2..0.2-ish, destination units */
  setMappedFinePitchOffset(offset01) {
    this._mappedFinePitchOffset01 = offset01;
    this._applyEffectiveFrequency();
  }

  _applyEffectiveFrequency() {
    if (!this.isRunning) return;
    const semitones = this._mappedFinePitchOffset01 * FINE_PITCH_MAP_SEMITONE_RANGE;
    const freq = this._baseTargetFreq * Math.pow(2, semitones / 12);
    const now = this.audioContext.currentTime;
    this.osc1.frequency.setTargetAtTime(freq, now, this.smoothingSeconds);
    this.osc2.frequency.setTargetAtTime(freq, now, this.smoothingSeconds);
  }

  setVolume01(volume01) {
    if (!this.isRunning) return;
    const clamped = clamp01(volume01);
    this.currentVolume01 = clamped;
    const gain = clamped * clamped;
    this.handGain.gain.setTargetAtTime(gain, this.audioContext.currentTime, this.smoothingSeconds);
  }

  mute() {
    if (!this.isRunning) return;
    this.currentVolume01 = 0;
    this.handGain.gain.setTargetAtTime(0, this.audioContext.currentTime, this.smoothingSeconds);
  }

  /** Current base (pre-detune, pre-LFO, pre-fine-pitch) oscillator 1
   *  frequency in Hz, for UI readouts. */
  getFrequencyHz() {
    if (!this.isRunning) return 0;
    return this.osc1.frequency.value;
  }

  // -- ADSR envelope ------------------------------------------------------------

  /**
   * The instrument's one discrete event: turn the envelope on (Attack then
   * Decay to Sustain) or off (Release). Everywhere else in this engine,
   * "sound" is continuous — this exists specifically for Filter Out of
   * Scale's mute/unmute, called only on a state change (not every frame).
   * @param {boolean} gateOn
   */
  triggerEnvelope(gateOn) {
    if (!this.isRunning || gateOn === this._envelopeGateOn) return;
    this._envelopeGateOn = gateOn;
    const g = this.envelopeGain.gain;
    const now = this.audioContext.currentTime;
    const current = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(current, now);
    if (gateOn) {
      g.linearRampToValueAtTime(1, now + Math.max(MIN_ENV_SECONDS, this.attackSeconds));
      g.linearRampToValueAtTime(
        this.sustainLevel,
        now + Math.max(MIN_ENV_SECONDS, this.attackSeconds) + Math.max(MIN_ENV_SECONDS, this.decaySeconds)
      );
    } else {
      g.linearRampToValueAtTime(0, now + Math.max(0.005, this.releaseSeconds));
    }
  }

  setAttackSeconds(seconds) {
    this.attackSeconds = Math.max(MIN_ENV_SECONDS, seconds);
  }

  setDecaySeconds(seconds) {
    this.decaySeconds = Math.max(0.005, seconds);
  }

  setSustainLevel(level01) {
    this.sustainLevel = clamp01(level01);
  }

  setReleaseSeconds(seconds) {
    this.releaseSeconds = Math.max(0.005, seconds);
  }

  // -- Oscillator / filter --------------------------------------------------------

  setWaveform(waveform) {
    this.waveform = waveform;
    if (this.isRunning) {
      this.osc1.type = waveform;
      this.osc2.type = waveform;
    }
  }

  setOscMix01(value01) {
    this.oscMix01 = clamp01(value01);
    if (this.isRunning) {
      const now = this.audioContext.currentTime;
      this.osc1Gain.gain.setTargetAtTime(1 - this.oscMix01, now, 0.05);
      this.osc2Gain.gain.setTargetAtTime(this.oscMix01, now, 0.05);
    }
  }

  setOscDetuneCents(cents) {
    this.oscDetuneCents = cents;
    if (this.isRunning) {
      this.osc2.detune.setTargetAtTime(cents, this.audioContext.currentTime, 0.05);
    }
  }

  setFilterType(type) {
    this.filterType = type;
    if (this.isRunning) this.filter.type = type;
  }

  setBrightness01(value) {
    this.brightness01 = clamp01(value);
    if (this.isRunning) {
      this.filter.frequency.setTargetAtTime(this._brightnessToCutoff(this.brightness01), this.audioContext.currentTime, 0.05);
    }
  }

  setResonance01(value) {
    this.resonance01 = clamp01(value);
    if (this.isRunning) {
      this.filter.Q.setTargetAtTime(this._resonanceToQ(this.resonance01), this.audioContext.currentTime, 0.05);
    }
  }

  /** Direct native-Hz setter, for the 'filterCutoff' mapping destination. */
  setFilterCutoffHz(hz) {
    if (!this.isRunning) return;
    this.filter.frequency.setTargetAtTime(clampRange(hz, MIN_CUTOFF_HZ, MAX_CUTOFF_HZ), this.audioContext.currentTime, 0.05);
  }

  /** Direct native-Q setter, for the 'filterResonance' mapping destination. */
  setFilterResonance(q) {
    if (!this.isRunning) return;
    this.filter.Q.setTargetAtTime(clampRange(q, MIN_Q, MAX_Q), this.audioContext.currentTime, 0.05);
  }

  // -- LFO (vibrato + general modulation) ------------------------------------------

  /** @param {'pitch'|'filterCutoff'|'amplitude'} target */
  setLfoTarget(target) {
    this.lfoTarget = target;
    if (this.isRunning) this._connectLfoTarget(target);
  }

  setLfoBaseRate(hz) {
    this.lfoBaseRateHz = Math.max(0.05, hz);
  }

  setLfoBaseDepth01(depth01) {
    this.lfoBaseDepth01 = clamp01(depth01);
  }

  /**
   * Called once per frame with the vibrato gesture detector's output. Only
   * has an effect when the LFO targets Pitch AND the mapping system isn't
   * already driving rate/depth this frame (mapped control always wins) —
   * see DEVELOPER_NOTES.md, "Reconciling automatic vibrato with the mapping
   * system" for why gesture-gating is specifically a pitch-target concept.
   * @param {{active: boolean, rateHz: number, depth01: number}} vibrato
   * @param {{rateMapped: boolean, depthMapped: boolean}} mappedFlags
   */
  setVibrato(vibrato, mappedFlags = {}) {
    if (!this.isRunning) return;
    const now = this.audioContext.currentTime;

    let rateHz = this.lfoBaseRateHz;
    let depth01 = this.lfoTarget === 'pitch' ? 0 : this.lfoBaseDepth01;

    if (this.lfoTarget === 'pitch' && !mappedFlags.depthMapped && vibrato.active) {
      depth01 = vibrato.depth01;
    }
    if (!mappedFlags.rateMapped && vibrato.rateHz > 0.01) {
      rateHz = vibrato.rateHz;
    }
    if (mappedFlags.rateMapped) rateHz = this._mappedLfoRateHz ?? rateHz;
    if (mappedFlags.depthMapped) depth01 = this._mappedLfoDepth01 ?? depth01;

    this.lfo.frequency.setTargetAtTime(rateHz, now, 0.15);
    this._applyLfoDepth(depth01);
  }

  /** 'lfoRate' mapping destination setter. */
  setMappedLfoRateHz(hz) {
    this._mappedLfoRateHz = hz;
  }

  /** 'lfoDepth' mapping destination setter. */
  setMappedLfoDepth01(depth01) {
    this._mappedLfoDepth01 = depth01;
  }

  _connectLfoTarget(target) {
    try {
      this.lfoGain.disconnect();
    } catch (_err) {
      /* not connected yet */
    }
    if (target === 'pitch') {
      this.lfoGain.connect(this.osc1.frequency);
      this.lfoGain.connect(this.osc2.frequency);
    } else if (target === 'filterCutoff') {
      this.lfoGain.connect(this.filter.frequency);
    } else if (target === 'amplitude') {
      this.lfoGain.connect(this.handGain.gain);
    }
  }

  _applyLfoDepth(depth01) {
    const now = this.audioContext.currentTime;
    let depthValue = 0;
    if (this.lfoTarget === 'pitch') {
      const baseFreq = this.osc1.frequency.value;
      const semitones = MAX_VIBRATO_SEMITONES * depth01;
      depthValue = baseFreq * (Math.pow(2, semitones / 12) - 1);
    } else if (this.lfoTarget === 'filterCutoff') {
      const baseCutoff = this._brightnessToCutoff(this.brightness01);
      depthValue = baseCutoff * (Math.pow(2, depth01 * LFO_FILTER_OCTAVE_RANGE) - 1);
    } else if (this.lfoTarget === 'amplitude') {
      depthValue = depth01 * LFO_AMPLITUDE_MAX;
    }
    this.lfoGain.gain.setTargetAtTime(depthValue, now, 0.1);
  }

  // -- Delay ------------------------------------------------------------------------

  setDelayMix01(value01) {
    this.delayMix01 = clamp01(value01);
    this._applyDelayWet();
  }

  /** Normal and Ping-Pong share Time / Feedback / Mix; only one of the two paths is audible. */
  _applyDelayWet() {
    if (!this.isRunning) return;
    const t = this.audioContext.currentTime; const ping = this.delayMode === 'pingpong';
    this.delayWetGain.gain.setTargetAtTime(ping ? 0 : this.delayMix01, t, 0.05);
    this.pingWetGain.gain.setTargetAtTime(ping ? this.delayMix01 : 0, t, 0.05);
    this.pingSend.gain.setTargetAtTime(ping ? 1 : 0, t, 0.05);
  }

  setDelayMode(mode) {
    this.delayMode = mode === 'pingpong' ? 'pingpong' : 'normal';
    this._applyDelayWet();
  }

  setPingPongWidth01(value01) {
    this.pingWidth01 = clamp01(value01);
    if (this.isRunning) this.pingPong.setWidth(this.pingWidth01);
  }

  setDelayTimeSeconds(seconds) {
    this.delayTimeSeconds = clampRange(seconds, 0.001, MAX_DELAY_SECONDS);
    if (this.isRunning) { this.delayNode.delayTime.setTargetAtTime(this.delayTimeSeconds, this.audioContext.currentTime, 0.05); this.pingPong.setTime(this.delayTimeSeconds); }
  }

  setDelayFeedback01(value01) {
    this.delayFeedback01 = clampRange(value01, 0, 0.92); // stay under 1 — no runaway feedback
    if (this.isRunning) {
      this.delayFeedbackGain.gain.setTargetAtTime(this.delayFeedback01, this.audioContext.currentTime, 0.05);
      this.pingPong.setFeedback(this.delayFeedback01);
    }
  }

  // -- Reverb -----------------------------------------------------------------------

  setReverbMix01(value01) {
    this.reverbMix01 = clamp01(value01);
    if (this.isRunning) {
      this.reverbWetGain.gain.setTargetAtTime(this.reverbMix01 * REVERB_WET_BOOST, this.audioContext.currentTime, 0.05);
      this._syncReverbInput();
    }
  }

  /**
   * Convolution is the most expensive thing in the effects chain, and two ConvolverNodes (A/B, for the click-free impulse swap) used to run all the time —
   * even with Reverb Mix at 0. Now only the convolver that is heard gets input, and none while the mix is 0 (a short delay lets the wet gain finish fading first).
   * Same sound, a fraction of the audio-thread work.
   */
  _setRevIn(key, on) {
    if (!this._revConn || this._revConn[key] === on || !this.handGain) return;
    const node = key === 'A' ? this.convolver : this.convolverB;
    try { if (on) this.handGain.connect(node); else this.handGain.disconnect(node); this._revConn[key] = on; } catch (_e) { /* node already gone */ }
  }
  _syncReverbInput() {
    if ((!this.isRunning && !this._starting) || !this._revConn) return;
    clearTimeout(this._revIdleTimer);
    if (this.reverbMix01 > 0.001) { this._setRevIn(this._reverbActive, true); return; }
    this._revIdleTimer = setTimeout(() => { if (this.isRunning && this.reverbMix01 <= 0.001) { this._setRevIn('A', false); this._setRevIn('B', false); } }, 450);
  }

  /** 'standard' (full quality, the default) or 'light' (less CPU: shorter reverb tail; the voice pool is switched by the app). */
  setSoundLight(on) {
    on = !!on; if (on === !!this.soundLight) return;
    this.soundLight = on;
    if (this.isRunning) { this._lastReverbSize = null; this._rebuildReverbImpulse(this.reverbSize01); }
  }

  setReverbSize01(value01) {
    this.reverbSize01 = clamp01(value01);
    if (this.isRunning) this._rebuildReverbImpulse(this.reverbSize01);
  }

  // -- Quiet changes (Build 031) ----------------------------------------------------------------------------------------
  /** Take the whole output to silence in ~25 ms (call, wait ~45 ms, change things that cannot be changed smoothly, then unduck). */
  duck() {
    if (!this.isRunning) return;
    const g = this.masterGain.gain; const now = this.audioContext.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(0, now, 0.008);
  }
  /** Bring the output back gently (time-constant `tau`, ≈ 3 × tau to full): a new patch never arrives at full level in one step. */
  unduck(tau = 0.16) {
    if (!this.isRunning) return;
    const g = this.masterGain.gain; const now = this.audioContext.currentTime;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.setTargetAtTime(1, now + 0.01, Math.max(0.02, tau));
  }

  /**
   * Synthesizes a decaying-noise impulse response for the ConvolverNode —
   * no external audio asset needed, keeping the project a static, purely
   * code-defined site. Regeneration is throttled (REVERB_REGEN_THRESHOLD)
   * since swapping ConvolverNode.buffer is comparatively expensive and
   * causes a tiny discontinuity; not worth doing every animation frame for
   * a slowly-moving mapped parameter.
   */
  _rebuildReverbImpulse(size01, force = false) {
    if (!force && this._lastReverbSize !== null && Math.abs(size01 - this._lastReverbSize) < REVERB_REGEN_THRESHOLD) {
      return;
    }
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (!force && nowMs - this._lastReverbAt < REVERB_REGEN_MIN_MS) {
      // too soon (a mapped Reverb Size moving every frame): rebuild once, with the latest value, shortly
      clearTimeout(this._reverbTimer);
      this._reverbTimer = setTimeout(() => { if (this.isRunning) this._rebuildReverbImpulse(this.reverbSize01); }, REVERB_REGEN_MIN_MS);
      return;
    }
    this._lastReverbSize = size01;
    this._lastReverbAt = nowMs;

    const ctx = this.audioContext;
    const durationSeconds = REVERB_MIN_SECONDS + ((this.soundLight ? REVERB_MAX_SECONDS_LIGHT : REVERB_MAX_SECONDS) - REVERB_MIN_SECONDS) * size01;
    const length = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const token = (this._irToken = (this._irToken || 0) + 1);
    const finish = () => { if ((this.isRunning || this._starting) && token === this._irToken) this._swapImpulse(buffer, force); };
    // At start-up the impulse is built at once; later rebuilds are sliced into small chunks so a slow phone's main thread (hand tracking, picture) is never blocked for tens of ms.
    this._fillImpulse(buffer, size01, force ? Infinity : 16384, () => token === this._irToken && (this.isRunning || this._starting), finish);
  }

  /** A room, not just decaying noise: a short pre-delay, a handful of early reflections, then a dense tail that darkens as it decays. Filled `chunk` samples at a time. */
  _fillImpulse(buffer, size01, chunk, alive, done) {
    const sr = this.audioContext.sampleRate; const length = buffer.length;
    const decayExponent = 1.5 + size01 * 2.5; // bigger "size" also decays a touch more gently
    const preDelay = Math.floor(sr * 0.012);
    const taps = [0.011, 0.019, 0.027, 0.041, 0.053, 0.071];
    const chans = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let ch = 0; let i = preDelay; let lp = 0;
    const step = () => {
      if (!alive()) return;
      const data = chans[ch]; const end = Math.min(length, i + chunk);
      for (; i < end; i++) {
        const t = (i - preDelay) / (length - preDelay);
        const damp = 0.9 - 0.75 * t; // brighter early, darker late
        lp += ((Math.random() * 2 - 1) - lp) * damp;
        data[i] = lp * Math.pow(1 - t, decayExponent) * 1.6;
      }
      if (i < length) { setTimeout(step, 0); return; }
      taps.forEach((sec, k) => {
        const idx = preDelay + Math.floor(sr * sec * (ch ? 1.07 : 1));
        if (idx < length) data[idx] += (k % 2 ? -1 : 1) * (0.9 - k * 0.1);
      });
      if (ch === 0) { ch = 1; i = preDelay; lp = 0; if (chunk === Infinity) step(); else setTimeout(step, 0); return; }
      done();
    };
    step();
  }

  _swapImpulse(buffer, force) {
    const ctx = this.audioContext;
    // load the idle convolver, then cross-fade (a hard buffer swap cuts the tail and clicks)
    const toB = this._reverbActive === 'A';
    const idle = toB ? this.convolverB : this.convolver;
    const old = toB ? 'A' : 'B';
    const idleKey = toB ? 'B' : 'A';
    if (this.reverbMix01 > 0.001) this._setRevIn(idleKey, true);
    idle.buffer = buffer;
    const now = ctx.currentTime;
    const fadeIn = toB ? this._xfB.gain : this._xfA.gain; const fadeOut = toB ? this._xfA.gain : this._xfB.gain;
    fadeIn.cancelScheduledValues(now); fadeOut.cancelScheduledValues(now);
    if (force) { fadeIn.setValueAtTime(1, now); fadeOut.setValueAtTime(0, now); } else {
      fadeIn.setTargetAtTime(1, now, REVERB_XFADE_TAU); fadeOut.setTargetAtTime(0, now, REVERB_XFADE_TAU);
    }
    this._reverbActive = toB ? 'B' : 'A';
    // once the cross-fade is over (≈ 9 time constants) the old convolver gets no more input and its processing winds down
    clearTimeout(this._revOldTimer);
    this._revOldTimer = setTimeout(() => { if (this.isRunning && this._reverbActive !== old) this._setRevIn(old, false); }, Math.ceil(REVERB_XFADE_TAU * 9 * 1000) + 60);
    if (force) this._setRevIn(old, false);
  }

  // -- Output -------------------------------------------------------------------------

  setPan(value) {
    this.pan = clampRange(value, -1, 1);
    if (this.isRunning && this.panner) {
      this.panner.pan.setTargetAtTime(this.pan, this.audioContext.currentTime, 0.05);
    }
  }

  /** For the oscilloscope overlay: fills `target` (a Uint8Array sized to
   *  analyser.fftSize) with the current time-domain waveform. No-ops
   *  silently when not running so the caller doesn't need to guard. */
  readWaveform(target) {
    if (!this.isRunning || !this.analyser) return false;
    this.analyser.getByteTimeDomainData(target);
    return true;
  }

  getAnalyserFftSize() {
    return this.analyser ? this.analyser.fftSize : 1024;
  }

  _pitchToFrequency(pitch01) {
    const logMin = Math.log(this.minFreq);
    const logMax = Math.log(this.maxFreq);
    return Math.exp(logMin + (logMax - logMin) * pitch01);
  }

  _brightnessToCutoff(brightness01) {
    const logMin = Math.log(MIN_CUTOFF_HZ);
    const logMax = Math.log(MAX_CUTOFF_HZ);
    return Math.exp(logMin + (logMax - logMin) * clamp01(brightness01));
  }

  _resonanceToQ(resonance01) {
    return MIN_Q + (MAX_Q - MIN_Q) * clamp01(resonance01);
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function clampRange(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
