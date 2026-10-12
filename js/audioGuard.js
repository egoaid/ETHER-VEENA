/* ==========================================================================
   audioGuard.js — keeps the sound alive (Build 033).

   iOS Safari (and sometimes Android) puts a Web Audio context into "suspended" / "interrupted" when the page is hidden, the screen locks, a call or Siri
   takes the audio session, or the device is overloaded for a while — and it does NOT bring it back by itself. The instrument then looks alive (hands tracked,
   picture moving) but is silent for good. The guard:
     • resumes the context on `statechange`, on returning to the page, and on the next touch / click / key (a user gesture is what iOS requires),
     • notices a context that says "running" but whose clock has stopped (the audio thread is stuck) and nudges it with suspend() + resume(),
     • reports (once per episode) when it cannot recover, so the page can say "tap the screen to resume" instead of staying silently mute.
   It never touches the signal: sound quality is exactly what it was. Pure logic + DOM listeners, unit tested with fakes. ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export class AudioGuard {
  /**
   * @param {{ getContext:()=>(AudioContext|null), onStalled?:()=>void, onRecovered?:()=>void, doc?:Document, win?:Window, now?:()=>number }} o
   */
  constructor({ getContext, onStalled = () => {}, onRecovered = () => {}, doc = globalThis.document, win = globalThis.window, now = () => performance.now() }) {
    Object.assign(this, { getContext, onStalled, onRecovered, doc, win, now });
    this._active = false; this._stalled = false; this._busy = false;
    this._lastTime = -1; this._lastAdvance = 0; this._lastTry = 0; this._tries = 0;
    this._gesture = () => this.recover('gesture');
    this._visible = () => { if (!this.doc?.hidden) this.recover('visible'); };
    this._page = () => this.recover('pageshow');
    this._state = () => { if (this._ctx()?.state !== 'running') this.recover('statechange'); };
    this._boundCtx = null;
  }

  _ctx() { try { return this.getContext() || null; } catch (_e) { return null; } }

  start() {
    if (this._active) return; this._active = true; this._lastAdvance = this.now(); this._lastTime = -1; this._tries = 0;
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) this.doc?.addEventListener?.(ev, this._gesture, { passive: true, capture: true });
    this.doc?.addEventListener?.('visibilitychange', this._visible);
    this.win?.addEventListener?.('pageshow', this._page);
    this._bind();
  }
  stop() {
    if (!this._active) return; this._active = false;
    for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) this.doc?.removeEventListener?.(ev, this._gesture, { capture: true });
    this.doc?.removeEventListener?.('visibilitychange', this._visible);
    this.win?.removeEventListener?.('pageshow', this._page);
    try { this._boundCtx?.removeEventListener?.('statechange', this._state); } catch (_e) { /* gone */ }
    this._boundCtx = null;
  }
  _bind() {
    const c = this._ctx(); if (!c || c === this._boundCtx) return;
    try { this._boundCtx?.removeEventListener?.('statechange', this._state); } catch (_e) { /* gone */ }
    c.addEventListener?.('statechange', this._state); this._boundCtx = c;
  }

  /** Try to bring the context back. Safe to call any time; rate-limited so a stuck device is not hammered. */
  async recover(reason = 'manual') {
    if (!this._active || this._busy) return false;
    const c = this._ctx(); if (!c) return false;
    this._bind();
    if (c.state === 'running' && reason !== 'stuck') { this._ok(); return true; }
    const t = this.now(); if (reason !== 'gesture' && t - this._lastTry < 400) return false;
    this._lastTry = t; this._busy = true; this._tries += 1;
    try {
      if (reason === 'stuck' && c.state === 'running') { try { await c.suspend(); } catch (_e) { /* ignore */ } }
      await c.resume();
    } catch (_e) { /* iOS refuses outside a gesture: the next tap will do it */ }
    this._busy = false;
    if (c.state === 'running') { this._lastAdvance = this.now(); this._lastTime = c.currentTime; this._ok(); return true; }
    if (!this._stalled && (reason === 'gesture' || this._tries >= 2)) { this._stalled = true; this.onStalled(); }
    return false;
  }

  _ok() {
    this._tries = 0;
    if (this._stalled) { this._stalled = false; this.onRecovered(); }
  }

  /** Call about once a second from the main loop. */
  tick() {
    if (!this._active || this.doc?.hidden) return;
    const c = this._ctx(); if (!c) return;
    const t = this.now();
    if (c.state !== 'running') { this.recover('tick'); return; }
    if (c.currentTime !== this._lastTime) { this._lastTime = c.currentTime; this._lastAdvance = t; this._ok(); return; }
    if (t - this._lastAdvance > 2500) { this._lastAdvance = t; this.recover('stuck'); } // "running" but the clock is frozen
  }

  get stalled() { return this._stalled; }
}
