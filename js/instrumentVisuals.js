/* ==========================================================================
   instrumentVisuals.js — everything drawn on top of the camera image.

   ONE <canvas> covers the video and is redrawn once per frame (cheap: no
   DOM churn, so the 47 harp strings and the neck cost almost
   nothing). Two layers, both in STAGE coordinates (geometry.js) so they sit
   exactly where the tracked body parts are on screen:

     1. Body HUD (optional, subtle): fingertip markers, hand skeleton and a
        face outline that follow the real landmarks.
     2. Instrument visual (always for that instrument): the harp strings,
        music-box comb, xylophone bars, 47-string harp or veena neck — so
        the player sees at once how to play.

   Colours come from the build-006 palette.  ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { makeGeometry, videoToStage } from './geometry.js';
import { BodyHud } from './bodyHud.js';
import { TriggerHud } from './triggerHud.js';
import { HARP_Y0, HARP_Y1 } from './harpController.js';
import { harpMaterialZone } from './instruments.js';
import { swaraTargets, SWARA_NAMES } from './ragas.js';
import {
  NECK_X0, NECK_X1, PLUCK_X0, STRINGS_X1,
  MAIN_LANES_Y0, MAIN_LANE_H, MAIN_LANES_Y1, CHIKARI_Y0, CHIKARI_LANE_H,
  mainLaneCenter, chikariLaneCenter,
} from './rudraVeenaStrings.js';

/*
   Two visual themes share one set of drawing code:
     mythic   normal interface — walnut, brass, gut: handcrafted, acoustic, ancient
     spatial  Performance Mode — transparent HUD lines, cool glow: futuristic, spatial
   The instrument and the body are the same; only the material language changes.
   Musical markers (green/amber) stay recognisable in both.
*/
const PALETTES = {
  mythic: { paper: '239,231,216', dim: '183,172,151', faint: '124,114,97', signal: '87,240,172', tube: '231,165,61', danger: '230,97,74', black: '10,9,8', walnut: '74,53,39', body: '239,231,216', bodyA: 0.38, glow: 0, wood: true, fillA: 1 },
  spatial: { paper: '215,240,255', dim: '140,185,210', faint: '90,125,150', signal: '105,255,205', tube: '255,190,95', danger: '255,115,115', black: '3,12,22', walnut: '18,50,74', body: '140,228,255', bodyA: 0.62, glow: 10, wood: false, fillA: 0.45 },
};
let C = PALETTES.mythic;
const rgba = (c, a) => `rgba(${c},${a})`;

/** Material fill: carved wood in the mythic theme, a translucent glass panel in the spatial one. */
function panelFill(ctx, x, y, w, h, tint = 'walnut', alpha = 0.78) {
  if (C.wood) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, `rgba(${C[tint]},${Math.min(1, alpha + 0.12)})`);
    g.addColorStop(0.5, `rgba(${C[tint]},${alpha})`);
    g.addColorStop(1, `rgba(${C[tint]},${Math.max(0, alpha - 0.18)})`);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = `rgba(${C[tint]},${alpha * C.fillA})`;
  }
}
function glow(ctx, color, blur) {
  ctx.shadowColor = `rgba(${color},0.8)`;
  ctx.shadowBlur = C.glow ? blur : 0;
}

export class StageOverlay {
  /** @param {HTMLCanvasElement} canvas @param {HTMLVideoElement} video */
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
    this.W = 0;
    this.H = 0;
    this.dpr = 1;
    this.mirrored = true;
    this.geom = makeGeometry(640, 480, 640, 480, true);
    this._ro = null;
    this.body = new BodyHud();
    this.trig = new TriggerHud();
    this.showTriggers = true;
    this.theme = 'mythic';
    this.showPose = true;
  }

  attach() {
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(this.canvas.parentElement);
    }
    window.addEventListener('resize', () => this.resize());
    this.video.addEventListener('loadedmetadata', () => this.resize());
  }

  /** Re-measure stage and video; call on resize, camera switch, fullscreen. */
  resize() {
    const box = this.canvas.parentElement;
    const W = box.clientWidth || 640;
    const H = box.clientHeight || 480;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    this._updateGeom();
  }

  /** 'mythic' (normal interface) or 'spatial' (Performance Mode). */
  setTheme(t) {
    this.theme = t === 'spatial' ? 'spatial' : 'mythic';
    C = PALETTES[this.theme];
  }

  setMirrored(m) {
    this.mirrored = !!m;
    this._updateGeom();
  }

  _updateGeom() {
    this.geom = makeGeometry(this.video.videoWidth, this.video.videoHeight, this.W, this.H, this.mirrored);
  }

  clear() {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * @param {Object} s
   * @param {'theremin'|'harp'|'rudra'} s.instrumentId
   * @param {boolean} s.showBody
   * @param {import('./fingerState.js').FingerState[]} s.fingers
   * @param {{left:Array|null,right:Array|null}} s.landmarks
   * @param {Array|null} s.faceLandmarks
   * @param {(id:string)=>boolean} s.isMapped
   * @param {Object<string,{raw:number}>} s.triggerValues
   * @param {Object} s.instrument  per-instrument draw data
   * @param {number} s.now
   */
  draw(s) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);

    // body first (behind the instrument), then the instrument, then performance markers
    if (s.showBody) {
      this.body.draw(ctx, {
        W: this.W, H: this.H, geom: this.geom, pal: C,
        landmarks: s.landmarks, faceLandmarks: s.faceLandmarks, showPose: this.showPose,
        triggerValues: s.triggerValues, isMapped: s.isMapped, now: s.now, bands: s.bands,
      });
    }
    switch (s.instrumentId) {
      case 'harp': this._harp(s); break;
      case 'rudra': this._rudra(s); break;
      default: break;
    }
    this._fingertips(s);
    if (this.showTriggers && s.triggerItems) this.trig.draw(ctx, { W: this.W, H: this.H, pal: C, items: s.triggerItems, anchor: s.anchorFor });
  }

  // -- helpers -------------------------------------------------------------------
  px(x, y) { return [x * this.W, y * this.H]; }

  lm(l) {
    const p = videoToStage(this.geom, l.x, l.y);
    return [p.x * this.W, p.y * this.H];
  }

  // -- performance markers ---------------------------------------------------------
  _fingertips(s) {
    // PERFORMANCE markers: glowing filled dots — deliberately unlike the thin body
    // skeleton and unlike the UI cursor (a DOM ring with a dwell arc).
    const { ctx } = this;
    for (const f of s.fingers) {
      if (!f.present) continue;
      if (s.instrumentId === 'theremin' && !s.showBody) continue;
      if (s.instrumentId === 'rudra' && !(f.name === 'index' && f.side === 'left') && f.side !== 'right') continue;
      const trig = `${f.side}${f.name[0].toUpperCase()}${f.name.slice(1)}`;
      const mapped = s.isMapped(trig);
      const [x, y] = this.px(f.pos.x, f.pos.y);
      const col = f.pressed ? C.signal : mapped ? C.tube : C.paper;
      const a = 0.35 + 0.65 * f.confidence;
      const rad = 4 + 5 * f.curl;
      ctx.save();
      glow(ctx, col, f.pressed ? 16 : 6);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fillStyle = rgba(col, (f.pressed ? 0.95 : 0.45) * a);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = f.pressed ? 2.5 : 1.4;
      ctx.strokeStyle = rgba(col, 0.95 * a);
      ctx.stroke();
      ctx.restore();
    }
  }

  // -- Harp ------------------------------------------------------------------------
  _harp(s) {
    const { ctx } = this;
    const { layout, plucks, material } = s.instrument;
    const y0 = HARP_Y0 * this.H;
    const y1 = HARP_Y1 * this.H;
    const now = s.now;
    const vib = new Map();
    for (const p of plucks) {
      const age = now - p.at;
      if (age > 700) continue;
      vib.set(p.i, { amp: (1 - age / 700) * (3 + 7 * p.velocity), phase: age * 0.06 });
    }
    // Strings are drawn in the colour/weight of their material: gut and hard nylon.
    const STYLE = C.wood
      ? { gut: ['226,206,160', 1.6], nylon: ['246,240,226', 0.95] }
      : { gut: ['150,235,255', 1.5], nylon: ['225,248,255', 0.9] };
    let lastZone = null;
    for (const str of layout.strings) {
      const x = str.x * this.W;
      const zone = harpMaterialZone(str.midi, material);
      const [col, width] = STYLE[zone];
      if (zone !== lastZone) {
        lastZone = zone;
        ctx.fillStyle = rgba(C.dim, 0.85);
        ctx.font = '9px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(zone.toUpperCase(), x, y0 - 6);
      }
      const v = vib.get(str.i);
      ctx.save();
      ctx.lineWidth = str.isRoot || str.isFourth ? width + 0.6 : width;
      ctx.strokeStyle = str.isRoot ? rgba(C.danger, 0.9) : str.isFourth ? rgba(C.wood ? C.black : C.tube, 0.95) : rgba(col, 0.62);
      if (str.isFourth && C.wood) { ctx.shadowColor = rgba(C.paper, 0.7); ctx.shadowBlur = 1.5; }
      ctx.beginPath();
      if (v) {
        for (let k = 0; k <= 16; k++) {
          const t = k / 16;
          const yy = y0 + (y1 - y0) * t;
          const dx = Math.sin(t * Math.PI) * v.amp * Math.sin(v.phase + t * 3);
          if (k === 0) ctx.moveTo(x + dx, yy); else ctx.lineTo(x + dx, yy);
        }
        glow(ctx, C.signal, 8);
        ctx.strokeStyle = rgba(C.signal, 0.95);
        ctx.lineWidth = width + 0.8;
      } else { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      ctx.stroke();
      ctx.restore();
    }
  }

  // -- Rudra Veena -----------------------------------------------------------------
  _rudra(s) {
    const { ctx } = this;
    const d = s.instrument; // {raga, direction, ruler, span, active, tuning, strokes, trail, bendCents, andolan, params}
    const now = s.now;
    const W = this.W;
    const H = this.H;
    const X0 = NECK_X0 * W;
    const X1 = NECK_X1 * W;
    const XE = STRINGS_X1 * W;
    const rulerX = (r) => X0 + (r / d.span) * (X1 - X0);
    const laneTop = MAIN_LANES_Y0 * H;
    const laneH = MAIN_LANE_H * H;

    // latest stroke age per string (for vibration)
    const mainAge = [1e9, 1e9, 1e9, 1e9];
    const chikAge = [1e9, 1e9, 1e9, 1e9];
    for (const st of d.strokes) {
      const age = now - st.at;
      if (st.kind === 'main' && st.index >= 0) mainAge[st.index] = Math.min(mainAge[st.index], age);
      else if (st.kind === 'chikari' && st.index >= 0) chikAge[st.index] = Math.min(chikAge[st.index], age);
      else if (st.kind === 'strum') for (let i = 0; i < 4; i++) chikAge[i] = Math.min(chikAge[i], age + i * 45);
    }
    const wavy = (xa, xb, y, amp, phase) => {
      ctx.beginPath();
      if (amp > 0.1) {
        for (let k = 0; k <= 48; k++) {
          const t = k / 48;
          const yy = y + Math.sin(t * Math.PI) * amp * Math.sin(now * 0.05 + phase);
          const xx = xa + (xb - xa) * t;
          if (k === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
      } else { ctx.moveTo(xa, y); ctx.lineTo(xb, y); }
      ctx.stroke();
    };

    // ---- MAIN STRINGS: the four melody strings, one lane each ----
    panelFill(ctx, X0 - 8, laneTop - 6, XE - X0 + 14, laneH * 4 + 12, 'walnut', 0.66);
    ctx.strokeStyle = rgba(C.paper, 0.32); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(X0 - 8, laneTop - 6, XE - X0 + 14, laneH * 4 + 12, 8) : ctx.rect(X0 - 8, laneTop - 6, XE - X0 + 14, laneH * 4 + 12);
    if (C.wood) ctx.fill();
    ctx.stroke();
    ctx.fillStyle = rgba(C.dim, 0.9); ctx.font = '9px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('MAIN STRINGS', X0, laneTop - 12);

    // frets across the neck (left = lower, right = higher)
    ctx.strokeStyle = rgba(C.paper, 0.15);
    // (one fret per semitone: fret r sits exactly at the ruler position of r semitones, so what you see is what sounds)
    for (let r = 0; r <= d.span; r++) {
      const x = rulerX(r);
      ctx.strokeStyle = rgba(C.paper, r % 12 === 0 ? 0.34 : 0.15); ctx.lineWidth = r % 12 === 0 ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x, laneTop); ctx.lineTo(x, laneTop + laneH * 4); ctx.stroke();
    }
    ctx.lineWidth = 1;
    // inlay dots + fret numbers like the real neck
    ctx.fillStyle = rgba(C.paper, 0.4); ctx.font = '8px \"IBM Plex Mono\", monospace'; ctx.textAlign = 'center';
    for (const r of [0, 5, 7, 12, 17, 19, 24]) {
      if (r > d.span) continue;
      ctx.fillText(String(r), rulerX(r), laneTop + laneH * 4 + 9);
      if (r > 0 && r < d.span) { const xm = (rulerX(r - 1) + rulerX(r)) / 2; ctx.beginPath(); ctx.arc(xm, laneTop + laneH * 4 + 4, r % 12 === 0 ? 2.2 : 1.6, 0, Math.PI * 2); ctx.fill(); }
    }
    // fret direction hint
    ctx.fillStyle = rgba(C.dim, 0.75); ctx.textAlign = 'left'; ctx.fillText('◂ lower', X0, laneTop + laneH * 4 + 18);
    ctx.textAlign = 'right'; ctx.fillText('higher ▸', X1, laneTop + laneH * 4 + 18);

    // swara markers on the ACTIVE string (the one the left hand is fretting)
    // (d.active is null while the left hand is away from the strings: all four are open, none is selected)
    const hasActive = d.active !== null && d.active !== undefined;
    const active = d.tuning.melody[hasActive ? d.active : 0] ?? d.tuning.melody[0];
    const ay = mainLaneCenter(hasActive ? d.active : 0) * H;
    ctx.textAlign = 'center'; ctx.font = '10px "IBM Plex Sans", sans-serif';
    if (hasActive) for (const t of swaraTargets(d.raga, d.direction, active.openRuler + d.span / 2)) {
      const r = t.ruler - active.openRuler;
      if (r < 0 || r > d.span) continue;
      const x = rulerX(r);
      const key = t.slot === d.raga.vadi ? C.tube : t.slot === 0 ? C.signal : C.paper;
      const near = Math.abs(d.ruler - r) < 0.4;
      ctx.fillStyle = rgba(key, near ? 1 : 0.7);
      ctx.beginPath(); ctx.arc(x, ay, near ? 5.5 : t.slot === 0 || t.slot === d.raga.vadi ? 4.5 : 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba(C.paper, near ? 1 : 0.7);
      ctx.fillText(SWARA_NAMES[t.slot], x, laneTop - 1);
    }

    // the four strings themselves
    for (let i = 0; i < 4; i++) {
      const y = mainLaneCenter(i) * H;
      const isActive = hasActive && i === d.active;
      ctx.save();
      const thick = 2.6 - i * 0.4;
      ctx.strokeStyle = rgba(isActive ? C.signal : C.paper, isActive ? 0.95 : 0.55);
      if (isActive) glow(ctx, C.signal, 8);
      ctx.lineWidth = thick;
      const age = mainAge[i];
      wavy(X0 - 4, XE, y, age < 900 ? (1 - age / 900) * 6 : 0, i);
      ctx.restore();
      const name = d.tuning.melody[i]?.name ?? '';
      ctx.fillStyle = rgba(isActive ? C.signal : C.dim, isActive ? 1 : 0.85);
      ctx.font = `${isActive ? '600 ' : ''}12px "Fraunces", serif`;
      ctx.textAlign = 'right';
      ctx.fillText(name, X0 - 14, y + 4);
    }

    // playhead on the active string + pull gauge
    const px = rulerX(Math.min(d.span, Math.max(0, d.ruler)));
    if (hasActive) {
      ctx.save();
      glow(ctx, C.signal, 10);
      ctx.strokeStyle = rgba(C.signal, 0.95); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(px, ay - laneH / 2); ctx.lineTo(px, ay + laneH / 2); ctx.stroke();
      ctx.restore();
    }
    // hooked string: the string visibly bends toward the fingertip (the pull IS the meend)
    if (d.contact && hasActive) {
      const fy = ay + d.pull.dy * H;
      ctx.save();
      glow(ctx, C.tube, 12);
      ctx.strokeStyle = rgba(C.tube, 0.95); ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(X0 - 4, ay); ctx.lineTo(px, fy); ctx.lineTo(XE, ay); ctx.stroke();
      ctx.fillStyle = rgba(C.tube, 1); ctx.beginPath(); ctx.arc(px, fy, 6, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const pct = Math.min(1, d.bendCents / Math.max(1, d.params.meendRange * 100));
      ctx.fillStyle = rgba(C.tube, 0.95); ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
      ctx.fillText(`MEEND +${(d.bendCents / 100).toFixed(1)} st`, px + 10, fy - 8);
      void pct;
    } else {
      ctx.fillStyle = rgba(C.signal, 0.95); ctx.beginPath(); ctx.arc(px, ay, 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // meend trail
    if (d.trail.length > 1) {
      ctx.lineWidth = 2.5;
      for (let i = 1; i < d.trail.length; i++) {
        const age = (now - d.trail[i].t) / 1400;
        ctx.strokeStyle = rgba(C.signal, Math.max(0, 0.6 * (1 - age)));
        ctx.beginPath(); ctx.moveTo(rulerX(d.trail[i - 1].ruler), laneTop + laneH * 4 + 26); ctx.lineTo(rulerX(d.trail[i].ruler), laneTop + laneH * 4 + 26); ctx.stroke();
      }
    }

    // ---- CHIKARI: a separate cluster, visually unlike the main strings ----
    const nChik = d.tuning.chikari.length;
    const cTop = CHIKARI_Y0 * H;
    const cH = CHIKARI_LANE_H * H * nChik;
    panelFill(ctx, X0 - 8, cTop - 6, XE - X0 + 14, cH + 12, 'walnut', 0.5);
    ctx.save();
    ctx.setLineDash([5, 3]);
    ctx.strokeStyle = rgba(C.tube, 0.6);
    ctx.strokeRect(X0 - 8, cTop - 6, XE - X0 + 14, cH + 12);
    ctx.restore();
    ctx.fillStyle = rgba(C.tube, 0.95); ctx.font = '9px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('CHIKARI', X0, cTop - 12);
    for (let i = 0; i < nChik; i++) {
      const y = chikariLaneCenter(i) * H;
      const age = chikAge[i] ?? 1e9;
      ctx.save();
      ctx.strokeStyle = rgba(C.tube, 0.85); ctx.lineWidth = 1.1;
      glow(ctx, C.tube, age < 700 ? 10 : 0);
      for (const off of [-1.8, 1.8]) wavy(X0 - 4, XE, y + off, age < 900 ? (1 - age / 900) * 5 : 0, i + 3);
      ctx.restore();
      ctx.fillStyle = rgba(C.tube, 0.9); ctx.font = '11px "Fraunces", serif'; ctx.textAlign = 'right';
      ctx.fillText(d.tuning.chikari[i].name, X0 - 14, y + 4);
    }

    // pluck area (right hand)
    const pxa = PLUCK_X0 * W;
    ctx.save();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = rgba(C.tube, 0.5);
    ctx.strokeRect(pxa, laneTop - 8, XE - pxa + 4, cTop + cH - laneTop + 14);
    ctx.restore();
    ctx.fillStyle = rgba(C.tube, 0.85); ctx.font = '9px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    ctx.fillText('PLUCK · bend index/middle over a string   ring or pinky = chikari   |   left: curl fingertip to bend', pxa - 130, laneTop - 14);

    // readout
    ctx.fillStyle = rgba(C.paper, 0.95); ctx.font = '600 15px "Fraunces", serif'; ctx.textAlign = 'left';
    ctx.fillText(`${d.raga.name}  ·  ${hasActive ? active.name : 'open strings'}${d.andolan ? '  ~ andolan' : ''}`, X0, laneTop - 28);
  }
}
