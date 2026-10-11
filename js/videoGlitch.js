/* ==========================================================================
   videoGlitch.js — configurable video glitch layer (Build 027)
   ETHER VEENA — © 2026 egoaid

   Pipeline (bottom → top):
     Camera video  →  Polygon filter canvas  →  GLITCH canvas  →  stage canvas (instrument, body, hands,
     trigger labels) → DOM overlay (information).
   The glitch only ever reads the picture underneath it (the polygon filter output, or the camera video when the
   filter is Off) and paints its own canvas, so it can never corrupt the layers above it, the hand/face tracking
   (which reads the <video>), or the audio.

   Look (Build 028): short BURSTS of JPEG DAMAGE. Between bursts the layer is hidden (zero cost). During a burst the
   picture really goes through a JPEG-style codec (YCbCr, 4:2:0 chroma, 8×8 DCT, coarse quantisation) so it breaks into
   flat 8×8 blocks with ringing and colour bleed; some block rows get a wrong DC value (the colour cast that runs to the
   right in a corrupted JPEG) and slices are displaced in whole blocks; sometimes the frame is held.
   Sliders:  Noise = compression damage · Block size = size of the blocks · Displacement = block-row corruption ·
             RGB split = chroma shift (colour bleed).

   Controls (all 0…1):  amount (0 = off)  ·  frequency (bursts per second)  ·  blockSize  ·  rgbSplit  ·
                        displace (horizontal displacement)  ·  noise  ·  hold (frame hold probability)

   `glitchPlan` is a pure, seeded function (unit tested); `VideoGlitch` is the thin canvas renderer.
   ========================================================================== */

export const GLITCH_DEFAULTS = Object.freeze({ amount: 0, frequency: 0.4, blockSize: 0.4, rgbSplit: 0.5, displace: 0.5, noise: 0.3, hold: 0.2 });
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const createGlitchState = (seed = 1) => ({ rng: makeRng(seed), nextBurstAt: 0, burstEnd: -1, level: 0, layoutAt: -1, layout: null, seq: 0 });

/** mean bursts per second for a frequency 0…1 */
export const burstRate = (frequency) => 0.25 + 5.5 * Math.pow(clamp01(frequency), 1.5);

/**
 * What to draw at time `now` (ms).  Returns {active:false} between bursts / when off, otherwise
 * {active, level, split, noise, hold, blocks:[{y,h,x,w,dx}]} — every geometry value is a FRACTION of the frame.
 */
export function glitchPlan(now, params, st) {
  const p = { ...GLITCH_DEFAULTS, ...params }; const amount = clamp01(p.amount);
  if (amount <= 0.001) { st.burstEnd = -1; st.nextBurstAt = 0; return { active: false }; }
  const r = st.rng;
  if (now >= st.burstEnd && now >= st.nextBurstAt) {
    if (st.nextBurstAt === 0) { st.nextBurstAt = now + (1000 / burstRate(p.frequency)) * r(); return { active: false }; } // first burst after a random wait
    const dur = 70 + 190 * r() * (0.5 + amount);
    st.burstEnd = now + dur; st.level = (0.45 + 0.55 * r()) * (0.35 + 0.65 * amount); st.layoutAt = -1;
    const gap = (-Math.log(1 - r() * 0.999) * 1000) / burstRate(p.frequency); // exponential gaps: irregular, like real glitches
    st.nextBurstAt = st.burstEnd + gap;
  }
  if (now >= st.burstEnd) return { active: false };
  if (st.layoutAt < 0 || now - st.layoutAt >= 45) { // a new random layout ~22 times a second inside a burst
    st.layoutAt = now; st.seq++;
    const level = st.level; const bh = lerp(0.02, 0.22, clamp01(p.blockSize)); const n = Math.max(1, Math.round(1 + 9 * level));
    const blocks = [];
    for (let i = 0; i < n; i++) {
      const h = Math.min(0.5, bh * (0.5 + r())); const y = r() * (1 - h);
      const full = r() < 0.6; const w = full ? 1 : lerp(0.25, 0.9, r()); const x = full ? 0 : r() * (1 - w);
      blocks.push({ y, h, x, w, dx: (r() * 2 - 1) * clamp01(p.displace) * 0.12 * level });
    }
    st.layout = { blocks, hold: r() < clamp01(p.hold) * level };
  }
  return { active: true, seq: st.seq, jpeg: clamp01(p.noise) * (0.5 + 0.5 * st.level), dc: clamp01(p.displace) * st.level, blockPx: lerp(8, 30, clamp01(p.blockSize)), level: st.level, split: clamp01(p.rgbSplit) * 0.035 * st.level, noise: clamp01(p.noise) * st.level * 0.6, hold: st.layout.hold, blocks: st.layout.blocks };
}


// ---------------------------------------------------------------------------------------------------------------------
// JPEG DAMAGE — a small real JPEG-style codec (pure, unit tested)
// ---------------------------------------------------------------------------------------------------------------------
const QL = [16,11,10,16,24,40,51,61, 12,12,14,19,26,58,60,55, 14,13,16,24,40,57,69,56, 14,17,22,29,51,87,80,62, 18,22,37,56,68,109,103,77, 24,35,55,64,81,104,113,92, 49,64,78,87,103,121,120,101, 72,92,95,98,112,100,103,99];
const QC = new Array(64).fill(99); [[17,18,24,47],[18,21,26,66],[24,26,56,99],[47,66,99,99]].forEach((r, y) => r.forEach((v, x) => { QC[y * 8 + x] = v; }));
const COS8 = (() => { const m = new Float32Array(64); for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) m[u * 8 + x] = (u === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * u * Math.PI) / 16); return m; })();
/** JPEG "quality" (1…100) for a damage amount 0…1: 0 → mild (~35), 1 → the DC term only (blocks are flat) */
export const jpegQuality = (damage) => 1.5 + 34 * Math.pow(1 - clamp01(damage), 1.6);
export const jpegScale = (q) => (q < 50 ? 5000 / q : 200 - 2 * q) / 100;

const _t = new Float32Array(64), _f = new Float32Array(64);
function dct8(src, so, stride, out) { // forward 8×8 DCT of src (block at offset so) into out[64]
  for (let y = 0; y < 8; y++) for (let u = 0; u < 8; u++) { let a = 0; for (let x = 0; x < 8; x++) a += COS8[u * 8 + x] * src[so + y * stride + x]; _t[y * 8 + u] = a; }
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) { let a = 0; for (let y = 0; y < 8; y++) a += COS8[v * 8 + y] * _t[y * 8 + u]; out[v * 8 + u] = a; }
}
function idct8(F, dst, so, stride) {
  for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let a = 0; for (let u = 0; u < 8; u++) a += COS8[u * 8 + x] * F[v * 8 + u]; _t[v * 8 + x] = a; }
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let a = 0; for (let v = 0; v < 8; v++) a += COS8[v * 8 + y] * _t[v * 8 + x]; dst[so + y * stride + x] = a; }
}
/** quantise + (optionally) corrupt every 8×8 block of one plane in place. dcShift(bx, by) → added to the dequantised DC (in 8×mean units). */
function codecPlane(plane, pw, ph, table, scale, dcShift) {
  for (let by = 0; by < ph / 8; by++) for (let bx = 0; bx < pw / 8; bx++) {
    dct8(plane, by * 8 * pw + bx * 8, pw, _f);
    for (let i = 0; i < 64; i++) { const q = Math.max(1, Math.round(table[i] * scale)); _f[i] = Math.round(_f[i] / q) * q; }
    if (dcShift) _f[0] += dcShift(bx, by);
    idct8(_f, plane, by * 8 * pw + bx * 8, pw);
  }
}
/**
 * Run an RGBA image through the JPEG-style codec.
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h
 * @param {{quality?:number, chromaShift?:number, corrupt?:Array<{by0:number,by1:number,bx0:number,bx1:number,y:number,cb:number,cr:number}>}} o
 *   corrupt: runs of blocks (luma 8×8 units, end exclusive) that get a wrong DC (offsets in grey levels, ≈ ±128) — the classic JPEG colour-cast bands
 * @returns {Uint8ClampedArray} new RGBA image, same size
 */
export function jpegDamage(rgba, w, h, o = {}) {
  const q = o.quality ?? 20; const scale = jpegScale(q);
  const pw = Math.ceil(w / 16) * 16, ph = Math.ceil(h / 16) * 16; const cw = pw / 2, ch = ph / 2;
  const Y = new Float32Array(pw * ph), Cb = new Float32Array(pw * ph), Cr = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const p = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4; const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2]; const i = y * pw + x;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b - 128; Cb[i] = -0.168736 * r - 0.331264 * g + 0.5 * b; Cr[i] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const cs = Math.round(o.chromaShift ?? 0);
  const sub = (P, shift) => { const out = new Float32Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const sx = Math.min(pw - 2, Math.max(0, x * 2 + shift)); const i = y * 2 * pw + sx; out[y * cw + x] = (P[i] + P[i + 1] + P[i + pw] + P[i + pw + 1]) / 4 - 0; } return out; };
  const cb = sub(Cb, -cs), cr = sub(Cr, cs); // the colour planes slide in opposite directions: coloured fringes
  const runs = o.corrupt ?? [];
  const dcFor = (key) => (bx, by) => { let s = 0; for (const r of runs) if (by >= r.by0 && by < r.by1 && bx >= r.bx0 && bx < r.bx1) s += r[key] * 8; return s; };
  const dcC = (key) => (bx, by) => { let s = 0; for (const r of runs) if (by * 2 >= r.by0 && by * 2 < r.by1 && bx * 2 >= r.bx0 && bx * 2 < r.bx1) s += r[key] * 8; return s; };
  codecPlane(Y, pw, ph, QL, scale, runs.length ? dcFor('y') : null);
  codecPlane(cb, cw, ch, QC, scale, runs.length ? dcC('cb') : null);
  codecPlane(cr, cw, ch, QC, scale, runs.length ? dcC('cr') : null);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const yy = Y[y * pw + x] + 128, c1 = cb[(y >> 1) * cw + (x >> 1)], c2 = cr[(y >> 1) * cw + (x >> 1)]; const p = (y * w + x) * 4;
    out[p] = yy + 1.402 * c2; out[p + 1] = yy - 0.344136 * c1 - 0.714136 * c2; out[p + 2] = yy + 1.772 * c1; out[p + 3] = 255;
  }
  return out;
}

export class VideoGlitch {
  /** @param {{canvas:HTMLCanvasElement, stage:HTMLElement, video:HTMLVideoElement, filterCanvas:HTMLCanvasElement, cameraFilter:{id:string, drawSeq:number}, seed?:number}} o */
  constructor({ canvas, stage, video, filterCanvas, cameraFilter, seed = (Date.now() & 0xffff) | 1 }) {
    Object.assign(this, { canvas, stage, video, filterCanvas, cameraFilter });
    this.params = { ...GLITCH_DEFAULTS }; this.st = createGlitchState(seed);
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas'); this.bctx = this.base.getContext('2d', { willReadFrequently: true });   // last good copy of the picture underneath (output size)
    this.work = document.createElement('canvas'); this.wctx = this.work.getContext('2d', { willReadFrequently: true });   // the picture at "codec" size (8 px blocks = blockPx output px)
    this._seq = -1; this._paintSeq = -1; this._haveBase = false; this._visible = false; this.stats = { drawMs: 0, bursts: 0 };
  }
  set(partial) { Object.assign(this.params, partial); if (!(this.params.amount > 0.001)) this._hide(); }
  get enabled() { return this.params.amount > 0.001; }
  _hide() { if (this._visible) { this._visible = false; this.stage.classList.remove('has-glitch'); } this._paintSeq = -1; }

  _captureBase(src, sw, sh) {
    const w = Math.min(640, sw); const h = Math.max(8, Math.round((w * sh) / sw));
    if (this.base.width !== w || this.base.height !== h) { this.base.width = w; this.base.height = h; this.canvas.width = w; this.canvas.height = h; }
    this.bctx.drawImage(src, 0, 0, w, h); this._haveBase = true;
  }

  /** Call once per animation frame, AFTER cameraFilter.update(). */
  update(nowMs) {
    if (!this.enabled) { this._hide(); return; }
    const filterOn = this.cameraFilter.id !== 'off'; const bgCamera = (this.stage.dataset.bg ?? 'camera') === 'camera';
    const plan = glitchPlan(nowMs, this.params, this.st);
    // The polygon canvas is a WebGL surface that may be cleared after it is shown: keep a copy of every fresh polygon frame
    // (only when the polygon filter drew in THIS frame, and only while a burst is on / about to start: saves the GPU read-back otherwise)
    const soon = plan.active || this.st.nextBurstAt - nowMs < 250;
    if (filterOn && soon && !(plan.active && plan.hold) && this.cameraFilter.drawSeq !== this._seq && this.cameraFilter._lastDraw === nowMs && this.filterCanvas.width > 0) { this._seq = this.cameraFilter.drawSeq; this._captureBase(this.filterCanvas, this.filterCanvas.width, this.filterCanvas.height); }
    if (!plan.active || !bgCamera) { this._hide(); return; }
    if (plan.seq === this._paintSeq && this._visible) return; // same layout as the last paint: the damaged frame stays (a stuttering frame, and no cost)
    const t0 = performance.now(); const v = this.video;
    if (!filterOn) { if (!v.videoWidth || v.readyState < 2) { this._hide(); return; } if (!plan.hold || !this._haveBase) this._captureBase(v, v.videoWidth, v.videoHeight); }
    if (!this._haveBase) { this._hide(); return; }
    this._paint(plan); this._paintSeq = plan.seq;
    if (!this._visible) { this._visible = true; this.stage.classList.add('has-glitch'); this.stats.bursts++; }
    this.stats.drawMs = performance.now() - t0;
  }

  _paint(plan) {
    const { ctx, base, work, wctx } = this; const W = base.width; const H = base.height;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    const rng = makeRng((plan.seq * 2654435761) >>> 0 || 1);
    if (plan.jpeg > 0.01) {
      // the picture shrinks so that one 8×8 codec block covers `blockPx` output pixels
      const k = 8 / plan.blockPx; const ww = Math.max(16, Math.round(W * k)); const wh = Math.max(16, Math.round(H * k));
      if (work.width !== ww || work.height !== wh) { work.width = ww; work.height = wh; }
      wctx.imageSmoothingEnabled = true; wctx.drawImage(base, 0, 0, ww, wh);
      const img = wctx.getImageData(0, 0, ww, wh);
      const runs = plan.blocks.slice(0, Math.max(1, Math.round(plan.blocks.length * 0.6))).filter(() => plan.dc > 0.02).map((b) => {
        const by0 = Math.floor((b.y * wh) / 8); const by1 = by0 + Math.max(1, Math.round((b.h * wh) / 8 * 0.5));
        const bx0 = Math.floor((b.x * ww) / 8); const bx1 = b.w >= 1 ? Math.ceil(ww / 8) : bx0 + Math.max(1, Math.round((b.w * ww) / 8));
        const a = plan.dc * 60; return { by0, by1, bx0, bx1, y: (rng() * 2 - 1) * a * 0.8, cb: (rng() * 2 - 1) * a, cr: (rng() * 2 - 1) * a };
      });
      const dmg = jpegDamage(img.data, ww, wh, { quality: jpegQuality(plan.jpeg), chromaShift: Math.round(plan.split * ww * 0.5), corrupt: runs });
      img.data.set(dmg); wctx.putImageData(img, 0, 0);
      ctx.drawImage(work, 0, 0, W, H); // nearest-neighbour upscale: the blocks stay hard-edged
    } else {
      ctx.drawImage(base, 0, 0);
    }
    const bp = Math.max(1, Math.round(plan.blockPx)); // slices move in whole blocks, on the block grid
    for (const b of plan.blocks) {
      const sy = Math.round((b.y * H) / bp) * bp; const sh = Math.max(bp, Math.round((b.h * H) / bp) * bp); const sx = Math.round((b.x * W) / bp) * bp; const sw = Math.max(bp, Math.round((b.w * W) / bp) * bp);
      const dx = Math.round((b.dx * W) / bp) * bp; if (dx) ctx.drawImage(ctx.canvas, sx, sy, sw, sh, sx + dx, sy, sw, sh);
    }
  }
}
