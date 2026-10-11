/* ==========================================================================
   audioReactive.js — turns the live audio into a few smooth control numbers.

   The visuals (mandala background, reactive body mesh) are driven by the
   REAL output: the engine's AnalyserNode taps the master bus after every
   instrument and effect, so what you see follows what you hear.

       rms      overall loudness           (time domain)
       bass     ≈ 20–250 Hz energy         (frequency domain)
       mid      ≈ 250–2000 Hz energy
       treble   ≈ 2–10 kHz energy
       centroid brightness 0..1            (spectral centroid, log-scaled)
       energy   a blend, for "how much is going on"

   Every value rises fast and falls slowly (attack/release smoothing) so the
   graphics breathe instead of flickering. Buffers are allocated once.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class AudioBands {
  constructor({ attack = 0.55, release = 0.07 } = {}) {
    this.attack = attack;
    this.release = release;
    this.freq = null;
    this.time = null;
    this.rms = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.centroid = 0.3;
    this.energy = 0;
  }

  _follow(prev, target) {
    return prev + (target - prev) * (target > prev ? this.attack : this.release);
  }

  /** Average of bins covering [lo, hi) Hz → 0..1 */
  static band(freq, sampleRate, fftSize, lo, hi) {
    const hz = sampleRate / fftSize;
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.min(freq.length, Math.ceil(hi / hz));
    let sum = 0;
    for (let i = a; i < b; i++) sum += freq[i];
    return b > a ? sum / (b - a) / 255 : 0;
  }

  /** @param {AnalyserNode|null} analyser @param {number} sampleRate */
  update(analyser, sampleRate = 44100) {
    if (!analyser) {
      this.rms = this._follow(this.rms, 0); this.bass = this._follow(this.bass, 0);
      this.mid = this._follow(this.mid, 0); this.treble = this._follow(this.treble, 0);
      this.energy = this._follow(this.energy, 0);
      return this;
    }
    if (!this.freq || this.freq.length !== analyser.frequencyBinCount) {
      this.freq = new Uint8Array(analyser.frequencyBinCount);
      this.time = new Uint8Array(analyser.fftSize);
    }
    analyser.getByteFrequencyData(this.freq);
    analyser.getByteTimeDomainData(this.time);

    let sq = 0;
    for (let i = 0; i < this.time.length; i++) { const v = (this.time[i] - 128) / 128; sq += v * v; }
    const rms = Math.sqrt(sq / this.time.length);

    const n = analyser.fftSize;
    const bass = AudioBands.band(this.freq, sampleRate, n, 20, 250);
    const mid = AudioBands.band(this.freq, sampleRate, n, 250, 2000);
    const treble = AudioBands.band(this.freq, sampleRate, n, 2000, 10000);

    // spectral centroid over the audible bins, mapped on a log scale to 0..1
    let num = 0; let den = 0;
    const hz = sampleRate / n;
    for (let i = 1; i < this.freq.length; i++) { num += i * hz * this.freq[i]; den += this.freq[i]; }
    const c = den > 0 ? num / den : 0;
    const centroid = clamp01(Math.log(Math.max(100, c) / 100) / Math.log(8000 / 100));

    this.rms = this._follow(this.rms, clamp01(rms * 3));
    this.bass = this._follow(this.bass, clamp01(bass * 1.4));
    this.mid = this._follow(this.mid, clamp01(mid * 1.6));
    this.treble = this._follow(this.treble, clamp01(treble * 2.2));
    if (den > 0) this.centroid += (centroid - this.centroid) * 0.1;
    this.energy = clamp01(this.rms * 0.5 + this.bass * 0.2 + this.mid * 0.2 + this.treble * 0.1);
    return this;
  }
}
