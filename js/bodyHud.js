/* ==========================================================================
   bodyHud.js — the BODY layer of the overlay: pose skeleton, face, hands.

   Three visual languages are kept deliberately different:
     BODY tracking        thin connected figure: head · neck · shoulders ·
                          torso · arms · hips, hand skeletons, face outline/mask
     MUSICAL performance  glowing filled markers + active strings/keys/bars
                          (drawn by instrumentVisuals.js)
     UI interaction       the fingertip cursor (DOM, performanceMode/vcursor)

   Pose data (MediaPipe Pose Landmarker) is for DISPLAY only. It arrives at a
   low, throttled rate; `PoseSmoother` eases toward each new result every
   frame so the figure moves smoothly without running the detector faster.
   Landmarks are video-normalized; the caller supplies the stage transform.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { videoToStage } from './geometry.js';
import { faceMesh } from './faceTracking.js';

// MediaPipe pose indices
const P = { NOSE: 0, L_EAR: 7, R_EAR: 8, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16, L_HIP: 23, R_HIP: 24, L_KN: 25, R_KN: 26, L_AN: 27, R_AN: 28 };
const LIMBS = [
  [P.L_SH, P.L_EL], [P.L_EL, P.L_WR], [P.R_SH, P.R_EL], [P.R_EL, P.R_WR],
  [P.L_SH, P.R_SH], [P.L_HIP, P.R_HIP], [P.L_SH, P.L_HIP], [P.R_SH, P.R_HIP],
  [P.L_HIP, P.L_KN], [P.L_KN, P.L_AN], [P.R_HIP, P.R_KN], [P.R_KN, P.R_AN],
];
const JOINTS = [P.L_SH, P.R_SH, P.L_EL, P.R_EL, P.L_WR, P.R_WR, P.L_HIP, P.R_HIP, P.L_KN, P.R_KN, P.L_AN, P.R_AN];
const MIN_VIS = 0.5;

const HAND_CHAINS = [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]];

// Fallback face geometry (used until MediaPipe's own mesh lists are available)
const FACE = {
  oval: [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109],
  browL: [70, 63, 105, 66, 107], browR: [300, 293, 334, 296, 336],
  eyeL: [33, 160, 158, 133, 153, 144], eyeR: [362, 385, 387, 263, 373, 380],
  mouth: [61, 37, 0, 267, 291, 314, 17, 84],
  noseBridge: [168, 6, 197, 195, 5, 4], noseBase: [98, 97, 2, 326, 327],
  cheekL: [234, 93, 132, 58, 172], cheekR: [454, 323, 361, 288, 397],
  forehead: [54, 103, 67, 109, 10, 338, 297, 332, 284],
};

/** Eases pose landmarks toward each new detection, every frame (display smoothing only). */
export class PoseSmoother {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.pts = null;
    this.target = null;
    this.lastUpdate = 0;
  }
  reset() { this.pts = null; this.target = null; this.lastUpdate = 0; }
  set(landmarks, nowMs) {
    this.target = landmarks;
    this.lastUpdate = nowMs;
    if (!this.pts) this.pts = landmarks.map((l) => ({ x: l.x, y: l.y, v: l.visibility ?? 1 }));
  }
  /** Advance one display frame. Returns null if nothing recent (pose lost > 1.2 s). */
  step(nowMs) {
    if (!this.pts || !this.target || nowMs - this.lastUpdate > 1200) return null;
    const a = this.alpha;
    for (let i = 0; i < this.pts.length; i++) {
      const t = this.target[i];
      const p = this.pts[i];
      p.x += (t.x - p.x) * a;
      p.y += (t.y - p.y) * a;
      p.v += ((t.visibility ?? 1) - p.v) * a;
    }
    return this.pts;
  }
}

export class BodyHud {
  constructor() {
    this.faceMode = 'outline'; // 'outline' | 'mask'
    this.mode = 'skeleton'; // 'skeleton' | 'mesh' | 'face' | 'reactive'
    this.pose = new PoseSmoother();
  }

  setFaceMode(m) { this.faceMode = m === 'mask' ? 'mask' : 'outline'; }
  setMode(m) { this.mode = ['skeleton', 'mesh', 'face', 'reactive'].includes(m) ? m : 'skeleton'; }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} s
   * @param {number} s.W @param {number} s.H @param {import('./geometry.js').Geometry} s.geom
   * @param {Object} s.pal palette {body, bodyA, glow, ...}
   * @param {{left:Array|null,right:Array|null}} s.landmarks hands
   * @param {Array|null} s.faceLandmarks
   * @param {boolean} s.showPose
   * @param {Object} s.triggerValues @param {(id:string)=>boolean} s.isMapped
   * @param {number} s.now
   */
  draw(ctx, s) {
    const toPx = (l) => { const p = videoToStage(s.geom, l.x, l.y); return [p.x * s.W, p.y * s.H]; };
    // Body Visual: skeleton (lines) | mesh (polygon figure) | face (face + hands only) | reactive (mesh that moves with the sound)
    if (s.showPose && this.mode !== 'face') {
      if (this.mode === 'mesh' || this.mode === 'reactive') this._mesh(ctx, s, toPx, this.mode === 'reactive');
      else this._pose(ctx, s, toPx);
    }
    if (s.faceLandmarks) this._face(ctx, s, toPx);
    this._hands(ctx, s, toPx);
  }

  _stroke(ctx, pal, a, w) {
    ctx.strokeStyle = `rgba(${pal.body},${a})`;
    ctx.lineWidth = w;
    ctx.shadowColor = `rgba(${pal.body},${pal.glow ? 0.8 : 0})`;
    ctx.shadowBlur = pal.glow;
  }

  // -- body -------------------------------------------------------------------------------
  _pose(ctx, s, toPx) {
    const pts = this.pose.step(s.now);
    if (!pts) return;
    const ok = (i) => pts[i] && pts[i].v >= MIN_VIS;
    const px = (i) => toPx(pts[i]);
    const pal = s.pal;

    // head centre and neck (MediaPipe has no neck landmark: derive it from shoulders + head)
    let head = null;
    if (ok(P.L_EAR) && ok(P.R_EAR)) { const a = px(P.L_EAR), b = px(P.R_EAR); head = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.85]; }
    else if (ok(P.NOSE)) { const n = px(P.NOSE); head = [n[0], n[1], s.W * 0.05]; }
    let neck = null;
    if (ok(P.L_SH) && ok(P.R_SH)) {
      const a = px(P.L_SH), b = px(P.R_SH);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      neck = head ? [mid[0] + (head[0] - mid[0]) * 0.32, mid[1] + (head[1] - mid[1]) * 0.32] : mid;
      this._torso(ctx, s, px, mid);
    }

    ctx.save();
    ctx.lineCap = 'round';
    this._stroke(ctx, pal, pal.bodyA, 2.2);
    for (const [a, b] of LIMBS) {
      if (!ok(a) || !ok(b)) continue;
      const [x1, y1] = px(a); const [x2, y2] = px(b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    // head ring + neck line joining head → shoulders
    if (head) {
      ctx.beginPath(); ctx.arc(head[0], head[1], Math.max(10, head[2] * 0.75), 0, Math.PI * 2); ctx.stroke();
      if (neck) { ctx.beginPath(); ctx.moveTo(head[0], head[1] + Math.max(10, head[2] * 0.75)); ctx.lineTo(neck[0], neck[1]); ctx.stroke(); }
    }
    if (neck && ok(P.L_SH) && ok(P.R_SH)) {
      const a = px(P.L_SH), b = px(P.R_SH);
      ctx.beginPath(); ctx.moveTo(neck[0], neck[1]); ctx.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(neck[0], neck[1], 4.5, 0, Math.PI * 2); ctx.stroke();
    }
    // joints
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(${pal.body},${Math.min(1, pal.bodyA + 0.2)})`;
    for (const i of JOINTS) {
      if (!ok(i)) continue;
      const [x, y] = px(i);
      ctx.beginPath(); ctx.arc(x, y, i === P.L_WR || i === P.R_WR ? 5 : 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  /**
   * POLYGON MESH body: the pose landmarks become connected, filled polygons —
   * a faceted figure rather than a stick figure. Triangulated head (fan around
   * the head centre), neck, torso (quad + centre fan), and tapered limb
   * quads (thicker at the joint nearer the body). In `reactive` mode the same
   * mesh is driven by the audio: bass thickens/brightens the edges, mid ripples
   * the vertices, treble flickers the vertex glints.
   */
  _mesh(ctx, s, toPx, reactive) {
    const pts = this.pose.step(s.now);
    if (!pts) return;
    const ok = (i) => pts[i] && pts[i].v >= MIN_VIS;
    const bands = reactive && s.bands ? s.bands : { bass: 0, mid: 0, treble: 0, energy: 0, centroid: 0.3 };
    const t = s.now * 0.006;
    const P0 = (i) => toPx(pts[i]);
    // ripple vertices with the mids (a few px, never enough to lose the shape)
    const px = (i) => { const p = P0(i); const j = reactive ? Math.sin(t + i * 1.3) * bands.mid * 5 : 0; return [p[0] + j, p[1] + j * 0.6]; };
    const hue = 200 + (reactive ? (1 - bands.centroid) * 120 : 0);
    const edgeCol = reactive ? `hsla(${hue},95%,70%,` : `rgba(${s.pal.body},`;
    const fillCol = reactive ? `hsla(${hue + 30},90%,55%,` : `rgba(${s.pal.body},`;
    const fa = reactive ? 0.1 + bands.energy * 0.28 : 0.1;
    const ea = reactive ? 0.55 + bands.bass * 0.4 : s.pal.bodyA + 0.1;

    const tri = (a, b, c, k = 1) => {
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.closePath();
      ctx.fillStyle = `${fillCol}${(fa * k).toFixed(3)})`; ctx.fill();
      ctx.stroke();
    };
    const limb = (ia, ib, wa, wb) => {
      if (!ok(ia) || !ok(ib)) return;
      const a = px(ia); const b = px(ib);
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len; const ny = dx / len;
      const A1 = [a[0] + nx * len * wa, a[1] + ny * len * wa]; const A2 = [a[0] - nx * len * wa, a[1] - ny * len * wa];
      const B1 = [b[0] + nx * len * wb, b[1] + ny * len * wb]; const B2 = [b[0] - nx * len * wb, b[1] - ny * len * wb];
      tri(A1, A2, B1, 1); tri(A2, B2, B1, 0.8);
    };

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `${edgeCol}${ea.toFixed(3)})`;
    ctx.lineWidth = 1 + (reactive ? bands.bass * 2.4 : 0.4);
    if (s.pal.glow || reactive) { ctx.shadowColor = `${edgeCol}0.8)`; ctx.shadowBlur = (s.pal.glow || 4) + (reactive ? bands.energy * 12 : 0); }

    // torso: quad split into a fan around its centre
    if (ok(P.L_SH) && ok(P.R_SH) && ok(P.L_HIP) && ok(P.R_HIP)) {
      const a = px(P.L_SH), b = px(P.R_SH), c = px(P.R_HIP), d = px(P.L_HIP);
      const m = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
      tri(a, b, m, 1.3); tri(b, c, m, 1); tri(c, d, m, 1.3); tri(d, a, m, 1);
    }
    // arms (upper arm wider than forearm), legs
    limb(P.L_SH, P.L_EL, 0.2, 0.15); limb(P.L_EL, P.L_WR, 0.15, 0.09);
    limb(P.R_SH, P.R_EL, 0.2, 0.15); limb(P.R_EL, P.R_WR, 0.15, 0.09);
    limb(P.L_HIP, P.L_KN, 0.2, 0.14); limb(P.L_KN, P.L_AN, 0.14, 0.09);
    limb(P.R_HIP, P.R_KN, 0.2, 0.14); limb(P.R_KN, P.R_AN, 0.14, 0.09);

    // head: hexagonal fan + neck
    let head = null;
    if (ok(P.L_EAR) && ok(P.R_EAR)) { const a = px(P.L_EAR), b = px(P.R_EAR); head = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(a[0] - b[0], a[1] - b[1]) * 0.85]; }
    else if (ok(P.NOSE)) { const n = px(P.NOSE); head = [n[0], n[1], s.W * 0.05]; }
    if (head) {
      const r = Math.max(12, head[2] * 0.8);
      const ring = Array.from({ length: 6 }, (_, i) => { const th = (i / 6) * Math.PI * 2 - Math.PI / 2; return [head[0] + Math.cos(th) * r, head[1] + Math.sin(th) * r * 1.15]; });
      for (let i = 0; i < 6; i++) tri(head, ring[i], ring[(i + 1) % 6], i % 2 ? 1.2 : 0.8);
      if (ok(P.L_SH) && ok(P.R_SH)) {
        const a = px(P.L_SH), b = px(P.R_SH);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const w = r * 0.32;
        tri([head[0] - w, head[1] + r], [head[0] + w, head[1] + r], mid, 1);
      }
    }
    // vertex glints (treble flickers them)
    ctx.shadowBlur = 0;
    ctx.fillStyle = `${edgeCol}${(0.55 + (reactive ? bands.treble * 0.45 : 0.2)).toFixed(3)})`;
    for (const i of JOINTS) {
      if (!ok(i)) continue;
      const [x, y] = px(i);
      ctx.beginPath(); ctx.arc(x, y, 2.5 + (reactive ? bands.treble * 3 * Math.abs(Math.sin(t + i)) : 0), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  _torso(ctx, s, px, shoulderMid) {
    const ok = (i) => this.pose.pts[i].v >= MIN_VIS;
    if (!(ok(P.L_SH) && ok(P.R_SH) && ok(P.L_HIP) && ok(P.R_HIP))) return;
    const a = px(P.L_SH), b = px(P.R_SH), c = px(P.R_HIP), d = px(P.L_HIP);
    const g = ctx.createLinearGradient(shoulderMid[0], shoulderMid[1], (c[0] + d[0]) / 2, (c[1] + d[1]) / 2);
    g.addColorStop(0, `rgba(${s.pal.body},0.16)`);
    g.addColorStop(1, `rgba(${s.pal.body},0.03)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.fill();
  }

  // -- hands -------------------------------------------------------------------------------
  _hands(ctx, s, toPx) {
    ctx.save();
    ctx.lineCap = 'round';
    for (const side of ['left', 'right']) {
      const lms = s.landmarks[side];
      if (!lms) continue;
      this._stroke(ctx, s.pal, Math.min(1, s.pal.bodyA + 0.15), 1.8);
      for (const chain of HAND_CHAINS) {
        ctx.beginPath();
        chain.forEach((i, k) => { const [x, y] = toPx(lms[i]); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
        ctx.stroke();
      }
      const [wx, wy] = toPx(lms[0]); const [mx, my] = toPx(lms[9]);
      const r = Math.hypot(mx - wx, my - wy) * 0.55;
      const depth = s.triggerValues[`${side}HandDepth`]?.raw ?? 0.5;
      const mapped = s.isMapped(`${side}HandDepth`);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = mapped ? `rgba(${s.pal.tube},${0.5 + 0.4 * depth})` : `rgba(${s.pal.body},${0.35 + 0.4 * depth})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc((wx + mx) / 2, (wy + my) / 2, r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  // -- face ----------------------------------------------------------------------------------
  _face(ctx, s, toPx) {
    const pts = s.faceLandmarks;
    const P2 = (i) => toPx(pts[i]);
    const pal = s.pal;
    const path = (idxs, close) => {
      ctx.beginPath();
      idxs.forEach((i, k) => { const [x, y] = P2(i); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      if (close) ctx.closePath();
      ctx.stroke();
    };
    const pairPath = (pairs, widthA) => {
      ctx.beginPath();
      for (const c of pairs) { const a = P2(c.start); const b = P2(c.end); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
      void widthA;
    };
    const tv = s.triggerValues;
    const featureColor = (ids) => (ids.some((id) => s.isMapped(id)) ? pal.tube : pal.body);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (this.faceMode === 'mask') {
      // translucent face plate: a soft fill over the oval, the real MediaPipe mesh if we have it
      const fill = ctx.createRadialGradient(...P2(1), 4, ...P2(1), Math.abs(P2(10)[1] - P2(152)[1]) * 0.7);
      fill.addColorStop(0, `rgba(${pal.body},0.14)`);
      fill.addColorStop(1, `rgba(${pal.body},0.05)`);
      ctx.fillStyle = fill;
      ctx.beginPath();
      FACE.oval.forEach((i, k) => { const [x, y] = P2(i); if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `rgba(${pal.body},0.24)`;
      ctx.lineWidth = 0.8;
      if (faceMesh.tesselation && pts.length >= 468) pairPath(faceMesh.tesselation);
      else {
        for (const chain of [FACE.noseBridge, FACE.noseBase, FACE.cheekL, FACE.cheekR, FACE.forehead]) path(chain, false);
      }
    }

    // the important geometry — bright and clear in both modes
    this._stroke(ctx, pal, 0.85, 2.4);
    path(FACE.oval, true);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = `rgba(${featureColor(['leftEyebrow'])},${0.65 + 0.35 * (tv.leftEyebrow?.raw ?? 0)})`; path(FACE.browL, false);
    ctx.strokeStyle = `rgba(${featureColor(['rightEyebrow'])},${0.65 + 0.35 * (tv.rightEyebrow?.raw ?? 0)})`; path(FACE.browR, false);
    ctx.strokeStyle = `rgba(${featureColor(['leftEye'])},0.95)`; path(FACE.eyeL, true);
    ctx.strokeStyle = `rgba(${featureColor(['rightEye'])},0.95)`; path(FACE.eyeR, true);
    const mouthAct = Math.max(tv.mouthOpen?.raw ?? 0, tv.smile?.raw ?? 0);
    ctx.strokeStyle = `rgba(${featureColor(['mouthOpen', 'smile'])},${0.7 + 0.3 * mouthAct})`;
    path(FACE.mouth, true);
    ctx.restore();
  }
}
