/* ==========================================================================
   triggerHud.js — live "what is this body part doing?" labels.

   The old overlay was a pair of numeric cards parked over the camera image.
   This replaces it as the performance display: for every Trigger that is
   mapped to something, a small label follows the body part that produces it

       Mouth Open  0.76
       → Cutoff  824 Hz
       → Reverb  38 %

   i.e. TRIGGER value → PARAMETER name → the parameter's REAL value with its
   unit. One trigger can drive several parameters (extra lines). Labels:
     • are anchored to the real landmark (fingertip, palm, mouth corner,
       forehead …) through the stage transform, with the anchor smoothed;
     • sit beside the body part, away from the middle of the screen, and are
       pushed apart so they never overlap; they fade in/out with the part;
     • are drawn on the same canvas as the rest of the HUD (no DOM churn).
   The numeric cards remain, as the opt-in "Debug numbers" view.

   Formatting helpers are pure and tested.   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { videoToStage } from './geometry.js';

const SHORT = {
  filterCutoff: 'Cutoff', filterResonance: 'Resonance', lfoRate: 'LFO Rate', lfoDepth: 'LFO Depth',
  oscMix: 'Osc Mix', oscDetune: 'Detune', finePitch: 'Fine Pitch', delayMix: 'Delay', delayTime: 'Delay Time',
  delayFeedback: 'Feedback', reverbMix: 'Reverb', reverbSize: 'Reverb Size', pan: 'Pan',
  attack: 'Attack', decay: 'Decay', sustain: 'Sustain', release: 'Release',
};

/** Short, human parameter name. */
export function destinationName(meta) {
  if (SHORT[meta.id]) return SHORT[meta.id];
  return meta.label.replace(/\s*\(.*?\)\s*/g, '').trim();
}

/** A parameter value in human units. `meta` is a mapping.js destination. */
export function formatDestinationValue(meta, v) {
  switch (meta.unit) {
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${Math.round(v)} Hz`;
    case 's': return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'cents': return `${v >= 0 ? '+' : ''}${Math.round(v)} ct`;
    default:
      if (meta.min < 0 && meta.max <= 1 && meta.id === 'pan') return Math.abs(v) < 0.03 ? 'C' : `${v < 0 ? 'L' : 'R'} ${Math.round(Math.abs(v) * 100)}%`;
      if (meta.min < 0) return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(0)}%`;
      if (meta.max <= 1.0001) return `${Math.round(v * 100)}%`;
      return v.toFixed(2);
  }
}

/** A trigger's own value: 0..1 → "0.76", signed → "+0.32". */
export function formatTriggerValue(def, raw) {
  return def?.signed ? `${raw >= 0 ? '+' : ''}${raw.toFixed(2)}` : raw.toFixed(2);
}

// Face landmark each face trigger is anchored to (blendshape semantics: "left" = the subject's left)
const FACE_ANCHOR = {
  mouthOpen: [13, 14], smile: [291, 61], leftEye: [386, 374], rightEye: [159, 145],
  leftEyebrow: [334, 296], rightEyebrow: [105, 66], headYaw: [10], headPitch: [10], headRoll: [10],
};

/**
 * Where on screen (stage-normalized) is the body part behind this trigger?
 * @returns {{x:number,y:number}|null} null when that part is not currently tracked
 */
export function anchorFor(triggerId, { tracker, faceLandmarks, geom }) {
  const m = /^(left|right)(Thumb|Index|Middle|Ring|Pinky)$/.exec(triggerId);
  if (m) {
    const f = tracker.byId[`${m[1]}-${m[2].toLowerCase()}`];
    return f?.present ? { x: f.pos.x, y: f.pos.y } : null;
  }
  const h = /^(left|right)Hand(X|Y|Depth)$/.exec(triggerId);
  if (h) {
    const palm = tracker.hands[h[1]].palm;
    return palm ? { x: palm.x, y: palm.y } : null;
  }
  const idx = FACE_ANCHOR[triggerId];
  if (idx && faceLandmarks) {
    let x = 0; let y = 0;
    for (const i of idx) { const p = videoToStage(geom, faceLandmarks[i].x, faceLandmarks[i].y); x += p.x; y += p.y; }
    return { x: x / idx.length, y: y / idx.length };
  }
  return null;
}

export class TriggerHud {
  constructor() {
    this.state = new Map(); // trigger id → {x, y, alpha}
  }

  reset() { this.state.clear(); }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object} s
   * @param {number} s.W @param {number} s.H
   * @param {Object} s.pal palette (instrumentVisuals)
   * @param {Array<{trigger:string, def:any, raw:number, lines:Array<{name:string,text:string}>}>} s.items active, tracked mappings
   * @param {(triggerId:string)=>({x:number,y:number}|null)} s.anchor
   */
  draw(ctx, { W, H, pal, items, anchor }) {
    const labels = [];
    const seen = new Set();
    for (const it of items) {
      const a = anchor(it.trigger);
      if (!a) continue;
      seen.add(it.trigger);
      const st = this.state.get(it.trigger) ?? { x: a.x, y: a.y, alpha: 0 };
      st.x += (a.x - st.x) * 0.4;
      st.y += (a.y - st.y) * 0.4;
      st.alpha = Math.min(1, st.alpha + 0.18);
      this.state.set(it.trigger, st);
      labels.push({ it, st });
    }
    for (const [id, st] of this.state) {
      if (!seen.has(id)) { st.alpha -= 0.12; if (st.alpha <= 0) this.state.delete(id); }
    }
    if (!labels.length) return;

    ctx.save();
    ctx.font = '11px "IBM Plex Sans", sans-serif';
    ctx.textBaseline = 'top';
    const lineH = 14;
    const pad = 6;

    // measure + initial placement beside the body part, away from the screen centre
    for (const l of labels) {
      const head = `${l.it.def.label}  ${l.it.valueText}`;
      l.w = Math.max(ctx.measureText(head).width, ...l.it.lines.map((ln) => ctx.measureText(`→ ${ln.name}  ${ln.text}`).width)) + pad * 2;
      l.h = (1 + l.it.lines.length) * lineH + pad * 2 - 2;
      const ax = l.st.x * W;
      const ay = l.st.y * H;
      const right = ax < W / 2 ? -1 : 1; // left half of the screen → label goes further left
      l.x = right > 0 ? ax + 16 : ax - 16 - l.w;
      l.y = ay - l.h / 2;
      l.ax = ax; l.ay = ay;
    }
    // keep inside the stage, then push apart vertically so nothing overlaps
    const m = 8;
    labels.sort((a, b) => a.y - b.y);
    for (const l of labels) { l.x = Math.min(W - m - l.w, Math.max(m, l.x)); l.y = Math.min(H - m - l.h, Math.max(m, l.y)); }
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 1; i < labels.length; i++) {
        const a = labels[i - 1]; const b = labels[i];
        const overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
        if (overlapX && b.y < a.y + a.h + 4) b.y = a.y + a.h + 4;
      }
    }
    for (const l of labels) l.y = Math.min(H - m - l.h, l.y);

    for (const l of labels) {
      const alpha = l.st.alpha;
      // leader line
      ctx.strokeStyle = `rgba(${pal.tube},${0.55 * alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(l.ax, l.ay);
      ctx.lineTo(l.x + (l.x > l.ax ? 0 : l.w), l.y + l.h / 2);
      ctx.stroke();
      // Build 027: text only — no plate, no border. A soft dark halo (text shadow) keeps it readable on any picture.
      ctx.save();
      ctx.shadowColor = `rgba(${pal.black},${0.9 * alpha})`; ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
      // text
      ctx.fillStyle = `rgba(${pal.paper},${0.95 * alpha})`;
      ctx.fillText(`${l.it.def.label}  ${l.it.valueText}`, l.x + pad, l.y + pad - 1);
      l.it.lines.forEach((ln, i) => {
        ctx.fillStyle = `rgba(${pal.dim},${alpha})`;
        ctx.fillText(`→ ${ln.name}`, l.x + pad, l.y + pad - 1 + (i + 1) * lineH);
        ctx.fillStyle = `rgba(${pal.signal},${alpha})`;
        const nameW = ctx.measureText(`→ ${ln.name}  `).width;
        ctx.fillText(ln.text, l.x + pad + nameW, l.y + pad - 1 + (i + 1) * lineH);
      });
      ctx.restore();
    }
    ctx.restore();
  }
}
