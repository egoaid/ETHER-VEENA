/* ==========================================================================
   performanceMode.js — full-screen camera performance interface.

   Enter: the stage becomes the whole screen (CSS fixed layout — works on
   iPhone Safari, which has no element fullscreen; the real Fullscreen API
   is also requested where it exists and failures are ignored). The control
   deck disappears; only four corner controls and a small instrument label
   remain, placed at the corners/edges where a performing hand rarely goes:

        [ Instrument ]                  [ Random ] [ Menu ]
        (camera image, instrument overlay, HUD)
        [ Calibrate ]                               [ Exit ]

   Controls work by mouse/touch AND by pointing with a fingertip (dwell;
   see virtualCursor.js). Menus (instrument list, performance presets) are
   simple lists of the same kind of buttons.

   Recovery: leaving fullscreen with Esc/system gesture, a `pagehide`, or a
   camera stop all fall back to the normal layout; entering re-measures the
   overlay so tracking and drawing stay aligned.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const MIN_TARGET_W = 88;
const MIN_TARGET_H = 64;

export class PerformanceMode {
  /**
   * @param {Object} o
   * @param {HTMLElement} o.stage    .stage element (goes fixed/fullscreen)
   * @param {HTMLElement} o.layer    #perfLayer (controls)
   * @param {HTMLElement} o.panel    #perfPanel (menu list container)
   * @param {()=>void} o.onLayoutChange  called after enter/exit/resize so overlay + geometry re-measure
   * @param {(action:string, arg?:string)=>void} o.onAction
   */
  constructor({ stage, layer, panel, onLayoutChange, onAction, onMenuOpen = null, onMenuClose = null }) {
    this.onMenuOpen = onMenuOpen;
    this.onMenuClose = onMenuClose;
    this.stage = stage;
    this.layer = layer;
    this.panel = panel;
    this.onLayoutChange = onLayoutChange;
    this.onAction = onAction;
    this.active = false;
    this._menu = null; // 'instruments' | 'presets' | null
    this._rects = [];
    this._rectsAt = 0;
    this._dwellShown = new Map();

    layer.addEventListener('click', (e) => this._click(e));
    panel.addEventListener('click', (e) => this._click(e));
    document.addEventListener('fullscreenchange', () => {
      if (this.active && !document.fullscreenElement && this._usedFullscreen) this.exit();
    });
    window.addEventListener('resize', () => { this._rectsAt = 0; if (this.active) this.onLayoutChange(); });
    window.addEventListener('orientationchange', () => setTimeout(() => this.onLayoutChange(), 250));
    window.addEventListener('pagehide', () => { if (this.active) this.exit(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.active) this.exit(); });
  }

  async enter() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('perf-mode');
    this._usedFullscreen = false;
    try {
      if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
        this._usedFullscreen = true;
      }
    } catch (_e) { /* iPhone Safari etc.: the CSS full-viewport layout is enough */ }
    this._closeMenu();
    this._rectsAt = 0;
    this.onLayoutChange();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('perf-mode');
    this._closeMenu();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    this._usedFullscreen = false;
    for (const el of this.layer.querySelectorAll('.perf-btn')) el.style.removeProperty('--dwell');
    this._dwellShown.clear();
    this.onLayoutChange(); // theme + geometry switch immediately…
    // …and again two frames later, once the layout has settled.
    requestAnimationFrame(() => requestAnimationFrame(() => this.onLayoutChange()));
  }

  /** A short toast at the top (e.g. the name of the preset just applied). */
  setNote(text) {
    const el = this.layer.querySelector('#perfNote');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-toast'); void el.offsetWidth; el.classList.add('is-toast');
  }

  /** The click confirmation: the button flashes, pops and sends a ring out. */
  flash(el) {
    if (!el) return;
    el.classList.remove('is-fired');
    el.querySelector('.perf-fire-ring')?.remove();
    void el.offsetWidth; // restart the animation
    const ring = document.createElement('span'); ring.className = 'perf-fire-ring'; el.appendChild(ring);
    el.classList.add('is-fired');
    clearTimeout(el._firedT);
    el._firedT = setTimeout(() => { el.classList.remove('is-fired'); ring.remove(); }, 700);
  }

  /** Flash the button that has the given cursor-target id (see targets()). */
  flashById(id) {
    const t = this._rects.find((r) => r.id === id);
    if (t) this.flash(t.el);
  }

  /** Fill the menu panel. items: [{id,label,active}] */
  openMenu(kind, title, items) {
    const wasOpen = this._menu !== null;
    this._menu = kind;
    if (!wasOpen) this.onMenuOpen?.();
    this.panel.hidden = false;
    this.panel.innerHTML =
      `<div class="perf-panel-title">${title}</div><div class="perf-panel-items">` +
      items.map((i) => `<button type="button" class="perf-btn perf-item${i.active ? ' is-active' : ''}" data-perf-action="pick-${kind}" data-arg="${i.id}"><span class="perf-label">${i.label}</span></button>`).join('') +
      `<button type="button" class="perf-btn perf-item perf-back" data-perf-action="close-menu"><span class="perf-label">Back</span></button></div>`;
    this._rectsAt = 0;
  }

  _closeMenu() {
    const wasOpen = this._menu !== null;
    this._menu = null;
    if (wasOpen) this.onMenuClose?.();
    this.panel.hidden = true;
    this.panel.innerHTML = '';
    this._rectsAt = 0;
  }

  closeMenu() { this._closeMenu(); }

  get menuOpen() { return this._menu !== null; }

  _click(e) {
    const el = e.target.closest?.('[data-perf-action]');
    if (!el) return;
    this.flash(el);
    this.activate(el.dataset.perfAction, el.dataset.arg);
  }

  activate(action, arg) {
    if (action === 'close-menu') { this._closeMenu(); return; }
    if (action === 'exit') { this.exit(); return; }
    this.onAction(action, arg);
  }

  /** Button rectangles for the virtual cursor (cached ~300 ms; layout is static in perf mode). */
  targets(now) {
    if (now - this._rectsAt > 300) {
      this._rects = [];
      const nodes = [...this.layer.querySelectorAll('.perf-btn[data-perf-action]'), ...this.panel.querySelectorAll('.perf-btn[data-perf-action]')];
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        const inMenu = this.panel.contains(el);
        // Corner buttons: a generous hit area (a fingertip is much blunter than a mouse). MENU ITEMS: exactly the drawn button,
        // no padding — the gaps between them are real gaps, so a sweep across the sheet cannot land on a neighbour.
        const w = inMenu ? r.width : Math.max(r.width, MIN_TARGET_W);
        const h = inMenu ? r.height : Math.max(r.height, MIN_TARGET_H);
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const rect = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 };
        this._rects.push({ id: el.dataset.perfAction + (el.dataset.arg ? `:${el.dataset.arg}` : ''), rect, el, pad: inMenu ? 0 : undefined });
      }
      this._rectsAt = now;
    }
    return this._rects;
  }

  /** Show hover/dwell feedback on the button the cursor is over. */
  showDwell(hoverId, progress) {
    for (const t of this._rects) {
      const p = t.id === hoverId ? progress : 0;
      const prev = this._dwellShown.get(t.id) ?? 0;
      if (Math.abs(p - prev) > 0.02 || (p === 0) !== (prev === 0)) {
        t.el.style.setProperty('--dwell', p.toFixed(2));
        t.el.classList.toggle('is-hover', p > 0 || t.id === hoverId);
        this._dwellShown.set(t.id, p);
      }
    }
  }

  /** Split an id produced by targets(): 'pick-instruments:harp' → ['pick-instruments','harp'] */
  static splitId(id) {
    const i = id.indexOf(':');
    return i < 0 ? [id, undefined] : [id.slice(0, i), id.slice(i + 1)];
  }
}
