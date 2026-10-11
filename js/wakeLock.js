/* ==========================================================================
   wakeLock.js — keep the phone's screen awake while the instrument is running (Screen Wake Lock API).
   · acquire() when the camera starts, release() when it stops
   · the browser drops the lock whenever the page is hidden (tab switch, screen off): it is requested again as soon as the page is visible
   · not supported (older iOS / Firefox) or refused (battery saver): silently does nothing — the instrument still works, the screen may then sleep
   No DOM except the two injected objects, so it is unit-tested with fakes.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export class WakeLockKeeper {
  /** @param {{nav?:Navigator, doc?:Document}} [o] */
  constructor({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
    this.nav = nav; this.doc = doc;
    this.wanted = false; this.sentinel = null; this._pending = false;
    this.state = this.supported ? 'idle' : 'unsupported'; // idle | active | unsupported | denied
    this._onVisible = () => { if (this.wanted && !this.doc.hidden && !this.sentinel) this._request(); };
    this.doc?.addEventListener?.('visibilitychange', this._onVisible);
  }

  get supported() { return !!this.nav && !!this.nav.wakeLock && typeof this.nav.wakeLock.request === 'function'; }

  async acquire() { this.wanted = true; return this._request(); }

  async release() {
    this.wanted = false;
    const s = this.sentinel; this.sentinel = null;
    if (this.supported) this.state = 'idle';
    try { await s?.release?.(); } catch { /* already released */ }
  }

  async _request() {
    if (!this.supported || this.sentinel || this._pending || this.doc?.hidden) return this.state === 'active';
    this._pending = true;
    try {
      const s = await this.nav.wakeLock.request('screen');
      if (!this.wanted) { try { await s.release(); } catch { /* ignore */ } return false; } // released while the request was in flight
      this.sentinel = s; this.state = 'active';
      s.addEventListener?.('release', () => { if (this.sentinel === s) { this.sentinel = null; if (this.state === 'active') this.state = 'idle'; } });
      return true;
    } catch {
      this.state = 'denied'; return false; // NotAllowedError: battery saver / not permitted — never an error for the user
    } finally { this._pending = false; }
  }

  dispose() { this.doc?.removeEventListener?.('visibilitychange', this._onVisible); return this.release(); }
}
