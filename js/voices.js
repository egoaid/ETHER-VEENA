/* ==========================================================================
   voices.js — the VOICE layer: Voice + VoiceManager (voice pool).

       Instrument (instruments.js)      decides WHAT a note sounds like
            │  recipe + freq + velocity
            ▼
       VoiceManager                     decides WHICH voice plays it:
            │                            polyphony limit, voice stealing,
            │                            note-off routing, shared vibrato
            ▼
       Voice 1 … Voice N                each one owns a tiny Web Audio graph:
                                        partial oscillators → lowpass → envelope → bus

   A Voice supports: note-on (constructor), note-off (release), frequency
   assignment, velocity, a per-note envelope, per-voice pitch bend (cents)
   and fast-fade stealing. Nothing here knows about hands, cameras or the
   DOM — it is driven by app.js through the VoiceManager only.

   Design notes:
   * Each note creates fresh nodes and destroys them when it has decayed.
     That is cheap in Web Audio and makes polyphony/stealing trivial.
   * Bend and vibrato both use OscillatorNode.detune (cents), so they are
     independent of the frequency each partial was created at and stack.
   * Every level change is a setTargetAtTime ramp — never a hard cut.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const STEAL_FADE_TAU = 0.006; // seconds — fast but click-free
const STEAL_CLEANUP_MS = 120;
const MIN_ATTACK = 0.005; // seconds
/**
 * JAWARI CONTACT CURVE (approximation) — an AMPLITUDE-DEPENDENT soft nonlinearity placed AFTER the note
 * envelope. The bridge contact of a jawari is strong when the string swings widely and fades as the
 * amplitude falls, so: a loud strike is shaped (more upper partials, a touch of even-harmonic buzz from the
 * one-sided contact `bias`), while the decaying tail passes through almost unchanged → the tone starts bright
 * and gets rounder by itself, with no EQ automation. It is NOT a hard clip or a bitcrusher:
 *   y(a) = [tanh(k·(a + b)) − tanh(k·b)] / (k · sech²(k·b))     → slope 1 at a = 0 (small signals untouched)
 * The WaveShaper only sees −1..1, so the signal is scaled by `scale` first and the curve compensates.
 * @param {number} k drive (≈0.3 gentle … 3 strong)  @param {number} b one-sided contact bias  @param {number} scale pre-gain
 */
export function makeContactCurve(k, b = 0.1, scale = 0.3, n = 2049) {
  const curve = new Float32Array(n);
  const norm = k * (1 - Math.pow(Math.tanh(k * b), 2));
  for (let i = 0; i < n; i++) {
    const u = (i / (n - 1)) * 2 - 1; // shaper input, −1..1
    const a = u / scale; // actual signal amplitude
    curve[i] = (scale * (Math.tanh(k * (a + b)) - Math.tanh(k * b))) / norm;
  }
  return curve;
}
/**
 * KHOOMEI-LIKE FORMANT SWEEP (chikari sustain). Research (Bergevin et al., eLife 2020, "Overtone focusing in biphonic Tuvan throat
 * singing"): khoomei is a steady low drone plus a narrowly FOCUSED resonance (≈1–3 kHz, made by merging two formants) that hovers
 * on one harmonic of the drone and slides to the next independently — a whistle-like tone riding on the fundamental, produced by
 * LINEAR filtering of a harmonic source. The chikari borrows exactly that: a harmonic series through narrow resonances whose centre
 * glides slowly between harmonics, so successive overtones swell and fade into each other while the fundamental stays put.
 * Returns the centre-frequency trajectory in Hz (log-domain, two incommensurate slow sinusoids) at `rate` points per second.
 * @param {{lo:number, hi:number, periods:[number,number], phase:number}} band
 */
export function formantCurve(band, dur, rate = 20) {
  const n = Math.max(2, Math.round(dur * rate));
  const out = new Float32Array(n);
  const p1 = band.phase * 2 * Math.PI; const p2 = band.phase * 2 * Math.PI * 1.7 + 1.3;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const s = 0.5 + 0.5 * (0.65 * Math.sin((2 * Math.PI * t) / band.periods[0] + p1) + 0.35 * Math.sin((2 * Math.PI * t) / band.periods[1] + p2));
    out[i] = band.lo * Math.pow(band.hi / band.lo, s);
  }
  return out;
}

const _curveCache = new Map();
const contactCurve = (k, b) => {
  const key = `${k.toFixed(2)}|${b.toFixed(2)}`;
  if (!_curveCache.has(key)) _curveCache.set(key, makeContactCurve(k, b));
  return _curveCache.get(key);
};

const TAU_TO_SILENCE = 9; // 9 time-constants ≈ -78 dB: oscillators are stopped only when the tail is inaudible (no stop click)

export const STEAL_STRATEGIES = {
  oldest: 'Oldest note',
  quietest: 'Releasing first, then oldest',
  lowest: 'Lowest pitch',
};

/**
 * @typedef {Object} Recipe
 * @property {OscillatorType} [wave='sine']
 * @property {Array<{ratio:number, gain:number, decayMul?:number, pair?:boolean}>} partials
 *   decayMul scales how long that partial rings relative to `envTau` (higher = longer);
 *   pair adds a second, slightly detuned oscillator (chorus / natural instability).
 * @property {number} [pairCents=2]   detune of the paired oscillator
 * @property {number} attack          seconds
 * @property {number} envTau          decay time-constant of the note envelope (s)
 * @property {number} [sustain=0]     envelope level (0..1 of peak) the note settles to; 0 = plain ring-out
 * @property {number} releaseTau      time-constant used by note-off
 * @property {number} peak            0..1 loudness of the note
 * @property {number} cutoffHz        voice lowpass
 * @property {number} [cutoffVelocity=0.5] how much velocity opens the filter (0..1)
 * @property {number} [partialFloor=0]  partials decay toward this fraction of their start level
 * @property {{harmonics:number[], slope:number, gain:number, boost:number, boostTau:number, decayMul:number, bands:Array<{q:number, lo:number, hi:number, periods:[number,number], phase:number}>}} [formant] khoomei-like focused-harmonic sweep layer (see formantCurve)
 * noise.sweep = {from, tau}: the noise filter starts at cutoff×from and falls to cutoff (a nail "sha→n" sweep)
 * @property {{drive:number, bias?:number}} [contact] jawari contact curve after the envelope (amplitude-dependent buzz; see makeContactCurve)
 * @property {{depth:number}} [body] route through the instrument's shared body resonance (dandi/tumba approximation)
 * partial.buzz = {amount, tauMul, floor?, cents?}: a detuned partner layer (contact beating) that is strong at the strike and fades faster than the tone
 * @property {{from:number, tau:number}} [filterBloom] lowpass starts at cutoff*from and opens with time-constant tau (jawari-like bloom)
 * @property {{from:number, tau:number}} [pitchEnv] pitch starts at freq*from and settles to freq with time-constant tau (kick, toms, tabla bayan)
 * @property {{level:number, decay:number, cutoffHz:number, type?:'lowpass'|'highpass'|'bandpass', q?:number}|null} [noise] attack transient / the body of a snare, hat or cymbal
 */

export class Voice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {Recipe} recipe
   * @param {{freq:number, velocity:number, originCents?:number, noiseBuffer?:AudioBuffer,
   *          vibratoNode?:AudioNode, onDestroyed?:(v:Voice)=>void, tag?:any}} o
   */
  constructor(ctx, destination, recipe, o) {
    this.ctx = ctx;
    this.recipe = recipe;
    this.baseFreq = o.freq;
    this.velocity = o.velocity;
    this.originCents = o.originCents ?? 0;
    this.tag = o.tag ?? null;
    this.startTime = ctx.currentTime;
    this.state = 'active'; // 'active' | 'releasing' | 'dead'
    this._delay = o.delay ?? 0; // seconds: lets one gesture schedule a strum of several strings
    this._onDestroyed = o.onDestroyed || null;
    this._vibratoNode = o.vibratoNode || null;
    this._cleanupTimer = null;
    this._oscs = [];
    this._nodes = [];

    const now = ctx.currentTime + this._delay;
    const attack = Math.max(MIN_ATTACK, recipe.attack); // a faster edge than a few ms is heard as a click ("puchi")

    this.out = this._track(ctx.createGain());
    this.out.gain.value = 1;
    this.out.connect(destination);

    this.env = this._track(ctx.createGain());
    this.env.gain.setValueAtTime(0, now);
    this.env.gain.linearRampToValueAtTime(recipe.peak, now + attack);
    this.env.gain.setTargetAtTime(recipe.peak * (recipe.sustain ?? 0), now + attack, Math.max(0.01, recipe.envTau));

    this.filter = this._track(ctx.createBiquadFilter());
    this.filter.type = 'lowpass';
    const velOpen = recipe.cutoffVelocity ?? 0.5;
    const cutoff = recipe.cutoffHz * (1 - velOpen + velOpen * (0.35 + 0.65 * o.velocity));
    const cutoffClamped = Math.min(20000, Math.max(80, cutoff));
    if (recipe.filterBloom) {
      this.filter.frequency.setValueAtTime(Math.max(80, cutoffClamped * recipe.filterBloom.from), now);
      this.filter.frequency.setTargetAtTime(cutoffClamped, now + attack, recipe.filterBloom.tau);
    } else {
      this.filter.frequency.setValueAtTime(cutoffClamped, now);
    }
    this.filter.Q.value = 0.5;

    this.filter.connect(this.env);
    if (recipe.contact && ctx.createWaveShaper) {
      const SCALE = 0.3;
      const pre = this._track(ctx.createGain()); pre.gain.value = SCALE;
      const shaper = this._track(ctx.createWaveShaper());
      shaper.curve = contactCurve(recipe.contact.drive, recipe.contact.bias ?? 0.1);
      const post = this._track(ctx.createGain()); post.gain.value = 1 / SCALE;
      this.env.connect(pre); pre.connect(shaper); shaper.connect(post); post.connect(this.out);
      this.contactStage = shaper;
    } else this.env.connect(this.out);

    const floor = recipe.partialFloor ?? 0;
    for (const p of recipe.partials) {
      const pg = this._track(ctx.createGain());
      const g0 = p.gain;
      pg.gain.setValueAtTime(g0, now);
      const tau = Math.max(0.02, recipe.envTau * (p.decayMul ?? 1));
      pg.gain.setTargetAtTime(g0 * floor, now + attack, tau);
      // `bloom`: the partial swells in after the pluck (the veena's jawari
      // bridge makes upper harmonics bloom) — an extra gain stage that rises
      // from a fraction of its level to full.
      if (p.bloom) {
        const bg = this._track(ctx.createGain());
        bg.gain.setValueAtTime(p.bloom.from, now);
        bg.gain.setTargetAtTime(1, now + attack, p.bloom.tau);
        pg.connect(bg);
        bg.connect(this.filter);
      } else {
        pg.connect(this.filter);
      }

      // `buzz`: the centre oscillator carries the tone; two detuned partners (contact beating) are routed through
      // their own gain that starts strong and settles low — the buzz is loud at the strike and fades faster than the tone.
      let buzzIn = null;
      if (p.buzz) {
        buzzIn = this._track(ctx.createGain());
        const lo = p.buzz.amount * (p.buzz.floor ?? 0.15);
        buzzIn.gain.setValueAtTime(p.buzz.amount, now);
        buzzIn.gain.setTargetAtTime(lo, now + attack, Math.max(0.02, recipe.envTau * p.buzz.tauMul));
        buzzIn.connect(pg);
      }
      const bzc = p.buzz ? (p.buzz.cents ?? recipe.pairCents ?? 2) : 0;
      const detunes = p.buzz ? [0, -bzc, bzc] : p.pair ? [-(recipe.pairCents ?? 2), recipe.pairCents ?? 2] : [0];
      for (const d of detunes) {
        const osc = ctx.createOscillator();
        osc.type = recipe.wave || 'sine';
        if (recipe.pitchEnv) {
          osc.frequency.setValueAtTime(o.freq * p.ratio * recipe.pitchEnv.from, now);
          osc.frequency.setTargetAtTime(o.freq * p.ratio, now, recipe.pitchEnv.tau);
        } else osc.frequency.setValueAtTime(o.freq * p.ratio, now);
        osc.detune.setValueAtTime(d, now);
        osc._pairDetune = d;
        osc.connect(p.buzz ? (d === 0 ? pg : buzzIn) : p.pair ? this._pairGain(pg) : pg);
        if (this._vibratoNode) this._vibratoNode.connect(osc.detune);
        osc.start(now);
        this._oscs.push(osc);
      }
    }

    // KHOOMEI-LIKE LAYER: harmonics of the note through narrow resonances that glide between harmonics (see formantCurve)
    if (recipe.formant) {
      const F = recipe.formant;
      const nyq = (ctx.sampleRate || 44100) * 0.45;
      // only harmonics the focus can ever reach are built (the narrow bands would silence the rest): fewer oscillators, same sound
      const reachLo = 0.55 * Math.min(...F.bands.map((b) => b.lo)); const reachHi = Math.min(nyq, 1.3 * Math.max(...F.bands.map((b) => b.hi)));
      const bus = this._track(ctx.createGain());
      for (const h of F.harmonics) {
        const hf = o.freq * h;
        if (hf > reachHi || hf < reachLo) continue;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(o.freq * h, now);
        osc.detune.setValueAtTime(0, now);
        osc._pairDetune = 0;
        const hg = this._track(ctx.createGain());
        hg.gain.value = Math.pow(h, -F.slope);
        osc.connect(hg); hg.connect(bus);
        if (this._vibratoNode) this._vibratoNode.connect(osc.detune);
        osc.start(now);
        this._oscs.push(osc);
      }
      const boost = this._track(ctx.createGain()); // a brighter attack that settles
      boost.gain.setValueAtTime(F.boost, now);
      boost.gain.setTargetAtTime(1, now + attack, F.boostTau);
      const decay = this._track(ctx.createGain()); // its own slow decay (outlasts the upper partials, ends with the fundamental)
      decay.gain.setValueAtTime(F.gain, now);
      decay.gain.setTargetAtTime(0, now + attack, Math.max(0.05, recipe.envTau * F.decayMul));
      const dur = Math.min(45, recipe.envTau * TAU_TO_SILENCE);
      for (const band of F.bands) {
        const bp = this._track(ctx.createBiquadFilter());
        bp.type = 'bandpass';
        bp.Q.value = band.q;
        const curve = formantCurve(band, dur);
        bp.frequency.setValueAtTime(curve[0], now);
        if (bp.frequency.setValueCurveAtTime) bp.frequency.setValueCurveAtTime(curve, now + attack, dur);
        bus.connect(bp); bp.connect(boost);
      }
      boost.connect(decay); decay.connect(this.env);
    }

    if (recipe.noise && o.noiseBuffer && recipe.noise.level > 0.0005) {
      const src = ctx.createBufferSource();
      src.buffer = o.noiseBuffer;
      const bp = this._track(ctx.createBiquadFilter());
      bp.type = recipe.noise.type ?? 'lowpass';
      if (recipe.noise.sweep) {
        bp.frequency.setValueAtTime(Math.min(20000, recipe.noise.cutoffHz * recipe.noise.sweep.from), now);
        bp.frequency.setTargetAtTime(recipe.noise.cutoffHz, now, recipe.noise.sweep.tau);
      } else bp.frequency.value = recipe.noise.cutoffHz;
      if (recipe.noise.q) bp.Q.value = recipe.noise.q;
      if (recipe.noise.decay > 0.15) src.loop = true; // long cymbal/hat washes outlast the 0.25 s noise buffer
      const ng = this._track(ctx.createGain());
      const lvl = recipe.noise.level * (0.4 + 0.6 * o.velocity);
      ng.gain.setValueAtTime(lvl, now);
      ng.gain.setTargetAtTime(0, now + 0.001, Math.max(0.003, recipe.noise.decay));
      src.connect(bp).connect(ng).connect(this.out);
      src.start(now);
      this._noiseSrc = src;
      this._nodes.push(src);
    }

    // Free everything once the note has certainly decayed (ring-out notes).
    this._scheduleCleanup((attack + recipe.envTau * TAU_TO_SILENCE + 0.2) * 1000);
  }

  _track(node) {
    this._nodes.push(node);
    return node;
  }

  // A paired oscillator shares its partial's gain node at half level each
  // so the pair sums to the partial's intended amplitude.
  _pairGain(partialGain) {
    const half = this._track(this.ctx.createGain());
    half.gain.value = 0.5;
    half.connect(partialGain);
    return half;
  }

  /** Pitch offset in cents relative to the pitch this note was started at. */
  setBendCents(cents, glideSeconds = 0.02) {
    if (this.state === 'dead') return;
    const now = this.ctx.currentTime;
    for (const osc of this._oscs) osc.detune.setTargetAtTime(cents + osc._pairDetune, now, glideSeconds);
  }

  /** NOTE OFF: fade with the instrument's release time-constant. */
  release(releaseTau) {
    if (this.state !== 'active') return;
    this.state = 'releasing';
    const now = this.ctx.currentTime;
    const tau = Math.max(0.01, releaseTau ?? this.recipe.releaseTau);
    holdParam(this.env.gain, now);
    this.env.gain.setTargetAtTime(0, now, tau);
    this._scheduleCleanup((tau * TAU_TO_SILENCE + 0.1) * 1000);
  }

  /** Voice stealing / panic: very fast fade, then free. */
  kill() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    const now = this.ctx.currentTime;
    holdParam(this.env.gain, now);
    this.env.gain.setTargetAtTime(0, now, STEAL_FADE_TAU);
    this.out.gain.setTargetAtTime(0, now, STEAL_FADE_TAU);
    this._scheduleCleanup(STEAL_CLEANUP_MS);
    if (this._onDestroyed) this._onDestroyed(this); // leaves the pool immediately
    this._onDestroyed = null;
  }

  _scheduleCleanup(ms) {
    if (this._cleanupTimer) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(() => this._destroy(), ms);
  }

  _destroy() {
    if (this._cleanupTimer) { clearTimeout(this._cleanupTimer); this._cleanupTimer = null; }
    const wasAlive = this.state !== 'dead';
    this.state = 'dead';
    for (const osc of this._oscs) {
      try { if (this._vibratoNode) this._vibratoNode.disconnect(osc.detune); } catch (_e) { /* already gone */ }
      try { osc.stop(); } catch (_e) { /* already stopped */ }
      try { osc.disconnect(); } catch (_e) { /* ignore */ }
    }
    for (const n of this._nodes) { try { if (n.stop) n.stop(); } catch (_e) { /* ignore */ } try { n.disconnect(); } catch (_e) { /* ignore */ } }
    this._oscs = [];
    this._nodes = [];
    if (wasAlive && this._onDestroyed) this._onDestroyed(this);
    this._onDestroyed = null;
  }
}

/** cancelAndHoldAtTime where available, else the classic value-read fallback. */
function holdParam(param, now) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    const v = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(v, now);
  }
}

/**
 * The chikari / drone system: one object that can represent the actual
 * chikari strings (and an optional Laraj), not just a generic hum.
 *
 *   strings: [{freq}]  — frequencies of the individual drone strings
 *   bed                — a soft continuous layer built from those same strings
 *   cycle              — the strings plucked in turn (a real plucked Voice each,
 *                        with jawari-style bloom), so the drone breathes
 *
 * `bedLevel` and `cycleLevel` are separate: the cycle is the audible
 * rhythmic chikari role and must not depend on how loud the quiet bed is.
 * Timers are cleared on stop().
 */
export class Drone {
  /** @param {{ctx:AudioContext, destination:AudioNode, strings:Array<{freq:number}>, bedLevel:number, cycleLevel:number, recipeFor:(freq:number, index:number)=>Recipe, noiseBuffer:AudioBuffer}} o */
  constructor(o) {
    this.ctx = o.ctx;
    this.destination = o.destination;
    this.strings = o.strings;
    this.recipeFor = o.recipeFor;
    this.noiseBuffer = o.noiseBuffer;
    this.bedLevel = o.bedLevel;
    this.cycleLevel = o.cycleLevel;
    this._timer = null;
    this._step = 0;
    this._voices = new Set();
    this._stopped = false;

    const ctx = this.ctx;
    this.bedOut = ctx.createGain();
    this.bedOut.gain.value = 0;
    this.bedOut.connect(this.destination);
    this.cycleOut = ctx.createGain();
    this.cycleOut.gain.value = this.cycleLevel;
    this.cycleOut.connect(this.destination);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 1600;
    this.filter.connect(this.bedOut);
    this._oscs = [];
    this._lfos = [];
    this.strings.forEach((st, i) => {
      for (const d of [-3, 3]) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = st.freq;
        osc.detune.value = d;
        osc._idx = i;
        const g = ctx.createGain();
        g.gain.value = 0.35;
        // slow, mutually-detuned amplitude drift so the bed shimmers rather than sits
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.09 + 0.037 * (i * 2 + (d > 0 ? 1 : 0));
        const lg = ctx.createGain();
        lg.gain.value = 0.12;
        lfo.connect(lg).connect(g.gain);
        lfo.start();
        osc.connect(g).connect(this.filter);
        osc.start();
        this._oscs.push(osc);
        this._lfos.push(lfo);
      }
    });
    this.setLevels(this.bedLevel, this.cycleLevel);
    this._scheduleNext(400);
  }

  setLevels(bed, cycle) {
    this.bedLevel = Math.max(0, bed);
    this.cycleLevel = Math.max(0, cycle);
    const now = this.ctx.currentTime;
    this.bedOut.gain.setTargetAtTime(this.bedLevel * 0.45, now, 0.4);
    this.cycleOut.gain.setTargetAtTime(this.cycleLevel, now, 0.2);
  }

  /** Retune in place (same number of strings). */
  setFrequencies(freqs) {
    const now = this.ctx.currentTime;
    freqs.forEach((f, i) => { if (this.strings[i]) this.strings[i].freq = f; });
    for (const o of this._oscs) if (freqs[o._idx]) o.frequency.setTargetAtTime(freqs[o._idx], now, 0.05);
  }

  _scheduleNext(ms) {
    if (this._stopped) return;
    this._timer = setTimeout(() => this._pluck(), ms);
  }

  _pluck() {
    if (this._stopped) return;
    const n = this.strings.length;
    const i = this._step % n;
    this._step += 1;
    if (this.cycleLevel > 0.01 && n) {
      const freq = this.strings[i].freq;
      const v = new Voice(this.ctx, this.cycleOut, this.recipeFor(freq, i), {
        freq,
        velocity: 0.6,
        noiseBuffer: this.noiseBuffer,
        onDestroyed: (vv) => this._voices.delete(vv),
      });
      this._voices.add(v);
    }
    // ~1.2 s per string; a longer breath after each full round
    this._scheduleNext(this._step % n === 0 ? 1800 : 1150);
  }

  stop() {
    this._stopped = true;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const now = this.ctx.currentTime;
    this.bedOut.gain.setTargetAtTime(0, now, 0.15);
    this.cycleOut.gain.setTargetAtTime(0, now, 0.15);
    for (const v of [...this._voices]) v.release(0.2);
    setTimeout(() => {
      for (const o of this._oscs) { try { o.stop(); } catch (_e) { /* ignore */ } try { o.disconnect(); } catch (_e) { /* ignore */ } }
      for (const l of this._lfos) { try { l.stop(); } catch (_e) { /* ignore */ } try { l.disconnect(); } catch (_e) { /* ignore */ } }
      try { this.bedOut.disconnect(); this.cycleOut.disconnect(); this.filter.disconnect(); } catch (_e) { /* ignore */ }
    }, 900);
  }
}

export class VoiceManager {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination the synth's voice bus (feeds hand-volume + effects)
   * @param {{maxPolyphony?:number, stealStrategy?:keyof typeof STEAL_STRATEGIES}} [o]
   */
  constructor(ctx, destination, o = {}) {
    this.ctx = ctx;
    this.maxPolyphony = Math.max(1, o.maxPolyphony ?? 8);
    this.stealStrategy = o.stealStrategy ?? 'oldest';
    /** @type {Voice[]} voices that are alive (active or releasing) */
    this.voices = [];
    this.stolenCount = 0;

    this.bus = ctx.createGain();
    this.bus.connect(destination);
    this._applyBusGain();

    // Shared vibrato LFO: one oscillator → gain (depth in cents) → every voice's detune.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 5.5;
    this.vibrato = ctx.createGain();
    this.vibrato.gain.value = 0;
    this.lfo.connect(this.vibrato);
    this.lfo.start();

    this.noiseBuffer = this._makeNoise();
    this.drone = null;
    this._destination = destination;
    this._body = null;
  }

  /**
   * Shared BODY RESONANCE (dandi + tumba), an approximation: broad, fixed-frequency resonances of the instrument's
   * body — they colour every string the same way, whatever it plays — as three peaking filters in series
   * (≈110 Hz tumba air, ≈220 Hz dandi/body, ≈440 Hz upper body) placed between the voices and the voice bus.
   * `depth` 0..1 sets the boost (up to +6 / +4 / +2 dB). Peaking filters only add warmth and depth; they cannot
   * ring, blow up or change pitch.
   */
  _bodyBus(spec) {
    if (!this._body) {
      const ctx = this.ctx;
      const input = ctx.createGain();
      const mk = (f, q) => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = q; b.gain.value = 0; return b; };
      const filters = [mk(110, 1.1), mk(220, 1.2), mk(440, 1.4)];
      input.connect(filters[0]); filters[0].connect(filters[1]); filters[1].connect(filters[2]); filters[2].connect(this.bus);
      this._body = { input, filters };
    }
    const d = Math.min(1, Math.max(0, spec.depth));
    const now = this.ctx.currentTime;
    [6, 4, 2].forEach((db, i) => this._body.filters[i].gain.setTargetAtTime(db * d, now, 0.05));
    return this._body.input;
  }

  _makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // More simultaneous voices → each one a bit quieter, so 16-voice chords don't clip.
  _applyBusGain() {
    this.bus.gain.setTargetAtTime(0.9 / Math.pow(this.maxPolyphony, 0.35), this.ctx.currentTime, 0.05);
  }

  setMaxPolyphony(n) {
    this.maxPolyphony = Math.max(1, Math.floor(n));
    this._applyBusGain();
    while (this.voices.length > this.maxPolyphony) this._steal();
  }

  setStealStrategy(name) {
    if (STEAL_STRATEGIES[name]) this.stealStrategy = name;
  }

  get activeCount() {
    return this.voices.length;
  }

  /**
   * NOTE ON. Steals a voice first if the pool is full.
   * @param {Object} o
   * @param {Recipe} o.recipe
   * @param {number} o.freq Hz
   * @param {number} o.velocity 0..1
   * @param {number} [o.originCents] the pitch (in cents from the instrument's reference) this note starts at
   * @returns {Voice}
   */
  noteOn({ recipe, freq, velocity, originCents = 0, tag = null, delay = 0 }) {
    while (this.voices.length >= this.maxPolyphony) this._steal();
    const voice = new Voice(this.ctx, recipe.body ? this._bodyBus(recipe.body) : this.bus, recipe, {
      freq,
      velocity,
      originCents,
      tag,
      delay,
      noiseBuffer: this.noiseBuffer,
      vibratoNode: this.vibrato,
      onDestroyed: (v) => this._remove(v),
    });
    this.voices.push(voice);
    return voice;
  }

  /** NOTE OFF for one voice (or the newest active voice when omitted). */
  noteOff(voice, releaseTau) {
    if (!voice) return;
    voice.release(releaseTau);
  }

  releaseAll(releaseTau) {
    for (const v of [...this.voices]) v.release(releaseTau);
  }

  killAll() {
    for (const v of [...this.voices]) v.kill();
  }

  /** Instrument-wide pitch: every sounding voice bends relative to where it was plucked. */
  applyPitchCents(currentCents, glideSeconds = 0.02) {
    for (const v of this.voices) {
      if (v.tag === 'chikari' || v.tag === 'sympathetic') continue; // drone strokes don't follow the neck
      v.setBendCents(currentCents - v.originCents, glideSeconds);
    }
  }

  /**
   * Per-voice pitch: `fn(voice)` returns the voice's current pitch in cents (same
   * reference as noteOn's originCents), or null to leave that voice alone.
   * Used by the Rudra Veena so only the fretted string follows the left hand.
   */
  applyPitchFn(fn, glideSeconds = 0.02) {
    for (const v of this.voices) {
      const c = fn(v);
      if (c !== null && c !== undefined) v.setBendCents(c - v.originCents, glideSeconds);
    }
  }

  /** Release the sounding voices that carry `tag` (e.g. re-plucking a string). */
  releaseTag(tag, releaseTau = 0.2) {
    for (const v of this.voices) if (v.tag === tag && v.state === 'active') v.release(releaseTau);
  }

  setVibrato(rateHz, depthCents) {
    const now = this.ctx.currentTime;
    this.lfo.frequency.setTargetAtTime(Math.max(0.1, rateHz), now, 0.1);
    this.vibrato.gain.setTargetAtTime(Math.max(0, depthCents), now, 0.1);
  }

  /**
   * Start the chikari/drone system on the given individual strings.
   * @param {{strings:Array<{freq:number}>, bedLevel:number, cycleLevel:number, recipeFor:(freq:number,index:number)=>Recipe}} o
   */
  startDrone(o) {
    if (this.drone) {
      this.drone.setFrequencies(o.strings.map((x) => x.freq));
      this.drone.setLevels(o.bedLevel, o.cycleLevel);
      return;
    }
    this.drone = new Drone({ ctx: this.ctx, destination: this._destination, noiseBuffer: this.noiseBuffer, ...o });
  }

  _makeLoopNoise() {
    const len = Math.floor(this.ctx.sampleRate * 1.0);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setDroneLevels(bed, cycle) { if (this.drone) this.drone.setLevels(bed, cycle); }

  stopDrone() {
    if (this.drone) { this.drone.stop(); this.drone = null; }
  }

  dispose() {
    this.killAll();
    this.stopDrone();
    setTimeout(() => {
      try { this.lfo.stop(); this.lfo.disconnect(); this.vibrato.disconnect(); this.bus.disconnect(); } catch (_e) { /* ignore */ }
    }, 150);
  }

  // -- internals ------------------------------------------------------------

  _remove(voice) {
    const i = this.voices.indexOf(voice);
    if (i >= 0) this.voices.splice(i, 1);
  }

  _pickVictim() {
    // Sympathetic-resonance voices are decoration: they always go first.
    const symp = this.voices.filter((v) => v.tag === 'sympathetic');
    const list = symp.length ? symp : this.voices;
    if (!list.length) return null;
    switch (this.stealStrategy) {
      case 'lowest':
        return list.reduce((a, b) => (b.baseFreq < a.baseFreq ? b : a));
      case 'quietest': {
        const releasing = list.filter((v) => v.state === 'releasing');
        const pool = releasing.length ? releasing : list;
        return pool.reduce((a, b) => (b.startTime < a.startTime ? b : a));
      }
      case 'oldest':
      default:
        return list.reduce((a, b) => (b.startTime < a.startTime ? b : a));
    }
  }

  _steal() {
    const victim = this._pickVictim();
    if (!victim) return;
    this.stolenCount += 1;
    victim.kill(); // removes itself from the pool via onDestroyed
    this._remove(victim); // belt and braces
  }
}
