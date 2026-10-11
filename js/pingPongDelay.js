/* ==========================================================================
   pingPongDelay.js — stereo ping-pong delay (Build 027)
   ETHER VEENA — © 2026 egoaid

   input (forced to mono) -> delayL -> out LEFT
                              delayL -> fbLR -> delayR -> out RIGHT
                                                 delayR -> fbRL -> delayL
   Echo n arrives at n * time, on the LEFT for odd n and the RIGHT for even n,
   with level feedback^(n-1). `width` 1 = hard ping-pong, 0 = both echoes
   centred (a mono delay). Feedback is capped below 1, so it can never run away.
   The Normal delay in theremin.js is a separate, untouched path.
   ========================================================================== */

export const PING_MAX_FEEDBACK = 0.92;

/** Pure schedule helper (used by the tests and by the browser render check). */
export function pingPongEchoes(time, feedback, width, count = 6) {
  const fb = Math.min(PING_MAX_FEEDBACK, Math.max(0, feedback));
  const w = Math.min(1, Math.max(0, width));
  const same = (1 + w) / 2; const cross = (1 - w) / 2;
  const out = [];
  for (let n = 1; n <= count; n++) {
    const level = Math.pow(fb, n - 1); const onLeft = n % 2 === 1;
    out.push({ n, time: n * time, level, left: level * (onLeft ? same : cross), right: level * (onLeft ? cross : same) });
  }
  return out;
}

export class PingPongDelay {
  constructor(ctx, { maxDelay = 2, time = 0.25, feedback = 0.3, width = 1 } = {}) {
    this.ctx = ctx; const now = ctx.currentTime;
    this.input = ctx.createGain(); this.input.channelCount = 1; this.input.channelCountMode = 'explicit';
    this.delayL = ctx.createDelay(maxDelay); this.delayR = ctx.createDelay(maxDelay);
    this.delayL.delayTime.setValueAtTime(time, now); this.delayR.delayTime.setValueAtTime(time, now);
    this.fbLR = ctx.createGain(); this.fbRL = ctx.createGain();
    this.fbLR.gain.setValueAtTime(Math.min(PING_MAX_FEEDBACK, feedback), now); this.fbRL.gain.setValueAtTime(Math.min(PING_MAX_FEEDBACK, feedback), now);
    this.merger = ctx.createChannelMerger(2);
    this.gLL = ctx.createGain(); this.gRL = ctx.createGain(); this.gLR = ctx.createGain(); this.gRR = ctx.createGain();
    this.out = ctx.createGain();
    this.input.connect(this.delayL);
    this.delayL.connect(this.fbLR); this.fbLR.connect(this.delayR);
    this.delayR.connect(this.fbRL); this.fbRL.connect(this.delayL);
    this.delayL.connect(this.gLL); this.delayR.connect(this.gRL);   // -> left channel
    this.delayL.connect(this.gLR); this.delayR.connect(this.gRR);   // -> right channel
    this.gLL.connect(this.merger, 0, 0); this.gRL.connect(this.merger, 0, 0);
    this.gLR.connect(this.merger, 0, 1); this.gRR.connect(this.merger, 0, 1);
    this.merger.connect(this.out);
    const x = Math.min(1, Math.max(0, width)); // initial width applied immediately (no ramp from the default gain of 1)
    for (const g of [this.gLL, this.gRR]) g.gain.setValueAtTime((1 + x) / 2, now);
    for (const g of [this.gRL, this.gLR]) g.gain.setValueAtTime((1 - x) / 2, now);
  }
  setTime(seconds) { const t = this.ctx.currentTime; for (const d of [this.delayL, this.delayR]) d.delayTime.setTargetAtTime(seconds, t, 0.05); }
  setFeedback(v) { const f = Math.min(PING_MAX_FEEDBACK, Math.max(0, v)); const t = this.ctx.currentTime; for (const g of [this.fbLR, this.fbRL]) g.gain.setTargetAtTime(f, t, 0.05); }
  setWidth(w) {
    const x = Math.min(1, Math.max(0, w)); const same = (1 + x) / 2; const cross = (1 - x) / 2; const t = this.ctx.currentTime;
    this.gLL.gain.setTargetAtTime(same, t, 0.03); this.gRR.gain.setTargetAtTime(same, t, 0.03);
    this.gRL.gain.setTargetAtTime(cross, t, 0.03); this.gLR.gain.setTargetAtTime(cross, t, 0.03);
  }
  /** every node, for cleanup */
  get nodes() { return [this.input, this.delayL, this.delayR, this.fbLR, this.fbRL, this.merger, this.gLL, this.gRL, this.gLR, this.gRR, this.out]; }
}
