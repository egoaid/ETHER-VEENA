/* ==========================================================================
   performanceInteractionState.js — INSTRUMENT MODE vs MENU MODE.

   An explicit application state, not an accident of z-index. Whenever a
   menu is open the body is the UI's, not the instrument's:

       INSTRUMENT MODE   instrument controllers interpret hands/fingers
       MENU MODE         instrument interpretation is suspended: no notes,
                         no hit-testing, no continuous pitch/bend, no
                         performance mappings. Tracking keeps running.

   Leaving MENU MODE does not hand control back instantly: the finger
   states are reset (so a finger that is mid-gesture can't fire) and the
   instrument stays suspended for a short SETTLE window, so the very
   gesture that closed the menu can't play a note.
   Pure logic — time is passed in, so it is testable.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export const MODE = Object.freeze({ INSTRUMENT: 'instrument', MENU: 'menu' });

export class InteractionState {
  /**
   * @param {{settleMs?:number, onChange?:(mode:string, info:{reset:boolean})=>void}} [o]
   */
  constructor({ settleMs = 450, onChange = null } = {}) {
    this.settleMs = settleMs;
    this.onChange = onChange;
    this.mode = MODE.INSTRUMENT;
    this._settleUntil = 0;
  }

  get isMenu() {
    return this.mode === MODE.MENU;
  }

  enterMenu() {
    if (this.mode === MODE.MENU) return;
    this.mode = MODE.MENU;
    this.onChange?.(this.mode, { reset: true });
  }

  exitMenu(nowMs) {
    if (this.mode === MODE.INSTRUMENT) return;
    this.mode = MODE.INSTRUMENT;
    this._settleUntil = nowMs + this.settleMs;
    this.onChange?.(this.mode, { reset: true });
  }

  /** May instrument controllers interpret the body right now? */
  instrumentActive(nowMs) {
    return this.mode === MODE.INSTRUMENT && nowMs >= this._settleUntil;
  }

  /** 0..1 progress through the post-menu settle window (for subtle UI feedback); 1 when not settling. */
  settleProgress(nowMs) {
    if (this.mode === MODE.MENU) return 0;
    if (nowMs >= this._settleUntil) return 1;
    return 1 - (this._settleUntil - nowMs) / this.settleMs;
  }
}
