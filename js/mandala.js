/* ==========================================================================
   mandala.js — the sound-reactive background.

   A neon polygon mandala: concentric rings of 6–12-sided polygons joined by
   radial spokes, with a ring of orbiting points. It is driven by AudioBands:

       bass     the rings swell (radius) and the line weight grows
       mid      the vertices ripple (a travelling wave around each ring)
       treble   rotation speeds up, spokes brighten, the orbiting points flare
       centroid hue (dark/warm sounds → violet/magenta, bright → cyan/white)
       energy   overall brightness; silence leaves a faint resting mandala

   Cheap by design: five stroked polygon rings + a handful of points, additive
   blending, one small shadow blur. It draws on its own canvas BEHIND the
   video, so it shows whenever the camera image is hidden (or, faintly, over a
   chosen background image/colour).      ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const RINGS = [
  { sides: 6, r: 0.2, speed: 0.12 },
  { sides: 8, r: 0.34, speed: -0.09 },
  { sides: 12, r: 0.48, speed: 0.07 },
  { sides: 6, r: 0.62, speed: -0.05 },
  { sides: 12, r: 0.78, speed: 0.035 },
];
const POINTS = 40;

export class Mandala {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.angle = 0;
    this._last = 0;
    this._cleared = false;
  }

  resize() {
    const box = this.canvas.parentElement;
    const W = box.clientWidth || 640;
    const H = box.clientHeight || 480;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
  }

  clear() {
    if (this._cleared) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this._cleared = true;
  }

  /**
   * @param {import('./audioReactive.js').AudioBands} a
   * @param {number} now ms
   * @param {{alpha?:number}} [o] overall strength (1 = background, ~0.35 = layer over an image)
   */
  draw(a, now, { alpha = 1 } = {}) {
    const { ctx } = this;
    this._cleared = false;
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0.016;
    this._last = now;
    this.angle += dt * (0.25 + a.treble * 2.2 + a.energy * 0.8);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';

    const cx = this.W / 2;
    const cy = this.H / 2;
    const maxR = Math.min(this.W, this.H) * 0.5;
    const hue = 285 - a.centroid * 110; // violet → magenta → cyan as the sound brightens
    const rest = 0.16; // a faint resting mandala so silence is not a black hole
    const lvl = (rest + a.energy * 0.9) * alpha;

    RINGS.forEach((ring, k) => {
      const swell = 1 + a.bass * 0.22 + a.rms * 0.06;
      const R = maxR * ring.r * swell;
      const rot = this.angle * ring.speed * 6 + k;
      const verts = [];
      for (let i = 0; i < ring.sides; i++) {
        const th = rot + (i / ring.sides) * Math.PI * 2;
        const ripple = 1 + a.mid * 0.16 * Math.sin(th * 3 + now * 0.004 * (k + 1));
        verts.push([cx + Math.cos(th) * R * ripple, cy + Math.sin(th) * R * ripple]);
      }
      ctx.beginPath();
      verts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.strokeStyle = `hsla(${(hue + k * 22) % 360}, 95%, ${55 + a.treble * 20}%, ${Math.min(1, lvl * (0.55 + 0.12 * k))})`;
      ctx.lineWidth = 1 + a.bass * 3 + (RINGS.length - k) * 0.25;
      if (k % 2 === 0) { ctx.shadowColor = `hsla(${hue},100%,60%,${0.6 * alpha})`; ctx.shadowBlur = 6 + a.energy * 10; } else ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // spokes to the next ring out (same vertex index modulo)
      if (k < RINGS.length - 1) {
        const next = RINGS[k + 1];
        const R2 = maxR * next.r * swell;
        const rot2 = this.angle * next.speed * 6 + k + 1;
        ctx.beginPath();
        for (let i = 0; i < ring.sides; i++) {
          const th = rot + (i / ring.sides) * Math.PI * 2;
          const th2 = rot2 + (Math.round((i / ring.sides) * next.sides) / next.sides) * Math.PI * 2;
          ctx.moveTo(cx + Math.cos(th) * R, cy + Math.sin(th) * R);
          ctx.lineTo(cx + Math.cos(th2) * R2, cy + Math.sin(th2) * R2);
        }
        ctx.strokeStyle = `hsla(${(hue + 60) % 360}, 90%, 62%, ${Math.min(1, lvl * (0.25 + a.treble * 0.9))})`;
        ctx.lineWidth = 0.8 + a.treble * 1.5;
        ctx.stroke();
      }
    });

    // orbiting points: flare with treble
    ctx.fillStyle = `hsla(${(hue + 150) % 360}, 100%, 75%, ${Math.min(1, lvl * 0.9)})`;
    for (let i = 0; i < POINTS; i++) {
      const th = this.angle * 0.8 + (i / POINTS) * Math.PI * 2;
      const rr = maxR * (0.88 + 0.07 * Math.sin(i * 1.7 + now * 0.002) + a.treble * 0.08);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, 1.2 + a.treble * 3 + (i % 5 === 0 ? 1.5 : 0), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
