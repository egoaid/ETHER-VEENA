/* ==========================================================================
   handDiagnostics.js — "HAND CHECK": makes left/right handling visible.

   DIAGNOSTIC ONLY. Nothing here changes how hands are resolved; it shows, for
   every detected hand, each stage of the chain SEPARATELY so a person at a real
   camera can see exactly where (if anywhere) left and right are swapped:

     1 RAW      MediaPipe's own handedness label + score, and raw (un-mirrored)
                landmark X of the wrist and palm centre
     2 DISPLAY  X after the app's mirror transform, and which side of the screen
                that is (handControls.js and geometry.js are shown separately:
                they are two independent implementations of the same transform)
     3 RESOLVED the side the app finally uses (left / right) → left-index / right-index
     + the three mirror flags (handControls.isMirrored, geometry.mirrored, the
       video element's CSS mirror) so a disagreement between them is obvious

   "Screen side" and "anatomical side" are NOT assumed equal. The line
   "screen vs resolved" simply reports whether they agree; in front-camera mirror
   mode with a normal posture they are expected to agree, but this view never
   uses that expectation to decide anything.

   Tap the panel to FREEZE it (for a screenshot); tap again to resume.
   Pure formatting (buildHandCheck) + a small DOM view.   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { videoToStage } from './geometry.js';

const sideWord = (x) => (x < 0.5 ? 'LEFT' : 'RIGHT');
const up = (s) => (s ? s.toUpperCase() : '—');
const f3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');

/**
 * @param {Array} diags HandControls.lastDiagnostics
 * @param {{geom:object, cssMirrored:boolean, facingMode?:string, fingerPresent?:{left:boolean,right:boolean}}} ctx
 * @returns {{hands:Array, warnings:string[], mirror:object, summary:string[]}}
 */
export function buildHandCheck(diags, ctx) {
  const geom = ctx.geom;
  const mirror = {
    handControls: diags.length ? diags[0].isMirrored : null,
    geometry: !!geom?.mirrored,
    css: !!ctx.cssMirrored,
    swapHands: diags.length ? diags[0].swapHands : null,
    facingMode: ctx.facingMode ?? '?',
  };
  const hands = diags.map((d) => {
    const st = geom ? videoToStage(geom, d.rawPalmX, d.rawPalmY) : { x: d.displayX, y: d.rawPalmY };
    const displaySide = sideWord(d.displayX); // handControls.js
    const stageSide = sideWord(st.x); // geometry.js (what the canvas draws)
    const rawLabelUp = up(d.rawLabel);
    return {
      index: d.index,
      rawLabel: rawLabelUp,
      rawScore: d.rawScore,
      rawWristX: d.rawWristX,
      rawPalmX: d.rawPalmX,
      displayX: d.displayX,
      displaySide,
      stageX: st.x, stageY: st.y,
      stageSide,
      resolved: up(d.resolved),
      screenVsResolved: d.resolved ? (displaySide === up(d.resolved) ? 'agree' : 'DISAGREE') : 'n/a',
      rawVsScreen: d.rawLabel ? (rawLabelUp === displaySide ? 'raw label = screen side' : 'raw label OPPOSITE of screen side') : 'n/a',
      displayVsStage: displaySide === stageSide ? 'agree' : 'DISAGREE',
    };
  });

  const warnings = [];
  if (mirror.handControls !== null && (mirror.handControls !== mirror.geometry || mirror.geometry !== mirror.css)) {
    warnings.push(`MIRROR FLAGS DISAGREE: handControls=${mirror.handControls} geometry=${mirror.geometry} css=${mirror.css}`);
  }
  if (mirror.swapHands) warnings.push('Swap hands is ON (manual override)');
  const res = hands.map((h) => h.resolved).filter((r) => r !== '—');
  if (res.length === 2 && res[0] === res[1]) warnings.push(`TWO HANDS RESOLVED TO THE SAME SIDE (${res[0]}) — one of them is being overwritten`);
  if (hands.some((h) => h.displayVsStage === 'DISAGREE')) warnings.push('handControls display side ≠ geometry stage side');

  const summary = [];
  for (const side of ['LEFT', 'RIGHT']) {
    const h = hands.find((x) => x.resolved === side);
    const present = ctx.fingerPresent ? ctx.fingerPresent[side.toLowerCase()] : null;
    summary.push(h
      ? `${side}: screen ${h.displaySide} · raw ${h.rawLabel} · resolved ${h.resolved} · ${side.toLowerCase()}-index ${present === false ? 'ABSENT' : 'live'}`
      : `${side}: no hand resolved here`);
  }
  return { hands, warnings, mirror, summary };
}

/** Floating HAND CHECK panel + one tag on each detected hand. */
export class HandCheckView {
  /** @param {HTMLElement} host the .stage-inner element */
  constructor(host) {
    this.enabled = false; this.frozen = false;
    this.root = document.createElement('div');
    this.root.className = 'handcheck'; this.root.hidden = true;
    this.panel = document.createElement('div'); this.panel.className = 'handcheck-panel';
    this.panel.title = 'Tap to freeze / resume';
    this.panel.addEventListener('click', () => { this.frozen = !this.frozen; this.panel.classList.toggle('is-frozen', this.frozen); });
    this.tags = document.createElement('div'); this.tags.className = 'handcheck-tags';
    this.root.append(this.tags, this.panel);
    host.appendChild(this.root);
  }
  setEnabled(on) { this.enabled = !!on; this.root.hidden = !on; if (!on) { this.frozen = false; this.panel.classList.remove('is-frozen'); } }

  render(diags, ctx) {
    if (!this.enabled || this.frozen) return;
    const r = buildHandCheck(diags, ctx);
    const lines = [];
    lines.push(`<b>HAND CHECK</b> <span class="hc-dim">(tap to freeze)</span>`);
    lines.push(`<span class="hc-dim">mirror: handControls=${r.mirror.handControls} · geometry=${r.mirror.geometry} · css=${r.mirror.css} · swap=${r.mirror.swapHands} · cam=${r.mirror.facingMode}</span>`);
    for (const w of r.warnings) lines.push(`<span class="hc-warn">⚠ ${w}</span>`);
    if (!r.hands.length) lines.push('<span class="hc-dim">no hand detected</span>');
    for (const h of r.hands) {
      lines.push(`<span class="hc-hand">hand ${h.index}</span> RAW: <b>${h.rawLabel}</b> (${f3(h.rawScore)}) · rawX wrist ${f3(h.rawWristX)} palm ${f3(h.rawPalmX)}`);
      lines.push(`&nbsp;&nbsp;DISPLAY: <b>${h.displaySide}</b> (x ${f3(h.displayX)}; geometry ${h.stageSide} ${f3(h.stageX)})`);
      lines.push(`&nbsp;&nbsp;RESOLVED: <b>${h.resolved}</b> · screen vs resolved: ${h.screenVsResolved} · ${h.rawVsScreen}`);
    }
    lines.push('<hr>');
    for (const s of r.summary) lines.push(s);
    this.panel.innerHTML = lines.join('<br>');

    // one tag on each hand, placed where the canvas draws it (geometry.js)
    this.tags.textContent = '';
    for (const h of r.hands) {
      const t = document.createElement('div');
      t.className = `handcheck-tag ${h.resolved === 'LEFT' ? 'is-left' : h.resolved === 'RIGHT' ? 'is-right' : ''}`;
      t.style.left = `${h.stageX * 100}%`; t.style.top = `${h.stageY * 100}%`;
      t.innerHTML = `RAW: ${h.rawLabel}<br>DISPLAY: ${h.displaySide}<br>RESOLVED: ${h.resolved}`;
      this.tags.appendChild(t);
    }
  }
}
