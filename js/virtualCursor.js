/* ==========================================================================
   virtualCursor.js — use a fingertip as a mouse, safely.

   Performance Mode hides the control deck, so a few buttons can be operated
   by pointing. Immediate click-on-contact would fire constantly while
   playing, so activation is deliberate:

     1. the cursor only exists while you make a POINTING pose — index finger
        extended, middle and ring curled (an unusual shape while playing);
     2. hover a button → it highlights and a progress ring fills;
     3. hold steady for `dwellMs` (default 400 ms) → it fires;
     4. leaving the button resets the ring (with a short jitter tolerance); moving more than `sweepPx` while over
        a button also restarts it, so a sweep across buttons never presses one — only coming to rest does;
     5. after a fire there is a global cooldown, and that same button must
        be left before it can fire again.

   Cursor position is smoothed (One Euro), and ignores movements smaller
   than a dead zone so tracking jitter can't slide it off a button.
   Pure logic — no DOM (targets are handed in as rectangles).
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { OneEuroFilter } from './smoothing.js';

export const POINTING = { indexMaxCurl: 0.35, middleMinCurl: 0.55, ringMinCurl: 0.5 };

/** Is this hand making the pointing pose? @param {Object<string,number>} curls thumb/index/middle/ring/pinky curl 0..1 */
export function isPointingPose(curls) {
  return curls.index < POINTING.indexMaxCurl && curls.middle > POINTING.middleMinCurl && curls.ring > POINTING.ringMinCurl;
}

function distanceToRect(x, y, r) {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

export class VirtualCursor {
  constructor({ dwellMs = 400, cooldownMs = 900, deadZonePx = 6, leaveGraceMs = 220, padPx = 14, jitterPx = 30, sweepPx = 24 } = {}) {
    this.jitterPx = jitterPx;
    this.sweepPx = sweepPx;
    this.dwellMs = dwellMs;
    this.cooldownMs = cooldownMs;
    this.deadZonePx = deadZonePx;
    this.leaveGraceMs = leaveGraceMs;
    this.padPx = padPx;
    this._fx = new OneEuroFilter({ minCutoff: 2.0, beta: 0.4 });
    this._fy = new OneEuroFilter({ minCutoff: 2.0, beta: 0.4 });
    this.reset();
  }

  reset() {
    this._fx.reset();
    this._fy.reset();
    this.pos = null;
    this.hoverId = null;
    this._hoverSince = 0;
    this._lastInsideAt = 0;
    this._cooldownUntil = 0;
    this._needsLeave = null;
    this._anchor = null;
  }

  /**
   * @param {{x:number,y:number}|null} point screen px of the pointing fingertip, or null when not pointing
   * @param {Array<{id:string, rect:{left:number,top:number,right:number,bottom:number}}>} targets
   * @param {number} now ms
   * @returns {{active:boolean, x:number, y:number, hoverId:string|null, progress:number, fired:string|null}}
   */
  update(point, targets, now) {
    if (!point) {
      // Pose released: cursor disappears, dwell resets. (A fire already happened or it didn't.)
      this.pos = null;
      this._fx.reset();
      this._fy.reset();
      this.hoverId = null;
      return { active: false, x: 0, y: 0, hoverId: null, progress: 0, fired: null, cooling: false };
    }

    const fx = this._fx.filter(point.x, now);
    const fy = this._fy.filter(point.y, now);
    if (!this.pos || Math.hypot(fx - this.pos.x, fy - this.pos.y) >= this.deadZonePx) this.pos = { x: fx, y: fy };
    const { x, y } = this.pos;

    // The target whose centre is NEAREST among those under the cursor (overlapping hit areas never steal the click
    // from the button you are actually on); per-target `pad` (menu items use 0 so neighbours never overlap).
    let hit = null; let bestD = Infinity;
    for (const t of targets) {
      const p = t.pad ?? this.padPx;
      if (x >= t.rect.left - p && x <= t.rect.right + p && y >= t.rect.top - p && y <= t.rect.bottom + p) {
        const d = Math.hypot(x - (t.rect.left + t.rect.right) / 2, y - (t.rect.top + t.rect.bottom) / 2);
        if (d < bestD) { bestD = d; hit = t; }
      }
    }
    let progress = 0;
    let fired = null;

    if (this._needsLeave && (!hit || hit.id !== this._needsLeave)) this._needsLeave = null;

    if (hit && hit.id !== this._needsLeave) {
      this._lastInsideAt = now;
      if (this.hoverId !== hit.id) {
        this.hoverId = hit.id;
        this._hoverSince = now;
        this._anchor = { x, y };
      } else if (this._anchor && Math.hypot(x - this._anchor.x, y - this._anchor.y) > this.sweepPx) {
        // still MOVING over the button (a sweep on the way to another one): the dwell starts over from here.
        // Only a cursor that comes to rest on a button can press it.
        this._hoverSince = now;
        this._anchor = { x, y };
      }
      if (now >= this._cooldownUntil) {
        progress = Math.min(1, (now - this._hoverSince) / this.dwellMs);
        if (progress >= 1) {
          fired = hit.id;
          this._cooldownUntil = now + this.cooldownMs;
          this._needsLeave = hit.id;
          this.hoverId = null;
          progress = 0;
        }
      } else {
        this._hoverSince = now; // don't accumulate dwell during cooldown
      }
    } else if (!hit) {
      // Tolerate tracking jitter just outside the button (small distance AND short time);
      // a real move away — or a sweep through — resets the dwell immediately.
      const held = this.hoverId ? targets.find((t) => t.id === this.hoverId) : null;
      const near = held && distanceToRect(x, y, held.rect) <= this.jitterPx;
      if (this.hoverId && near && now - this._lastInsideAt <= this.leaveGraceMs) progress = Math.min(1, (now - this._hoverSince) / this.dwellMs);
      else this.hoverId = null;
    }
    return { active: true, x, y, hoverId: this.hoverId, progress, fired, cooling: now < this._cooldownUntil };
  }
}
