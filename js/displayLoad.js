/* ==========================================================================
   displayLoad.js — DISPLAY PERFORMANCE (Build 032). Keeps the picture from starving the sound on small / slow phones.

   The sound runs on its own audio thread, but hand tracking, the Polygon filter, Glitch and the CRT layers all share the page's main thread:
   when the picture takes too long, hand input stops being read and the instrument goes quiet. Three display levels trade picture for headroom:

     full     everything as designed (smooth polygon motion, up to the finest polygons, Glitch, full CRT)
     lite     coarser polygons (≤ density 0.5), no motion smoothing, a lower-resolution canvas, mesh at ≤ 9 per second, Glitch off, CRT without blur / animation
     minimal  the lightest picture: very coarse polygons, mesh at ≤ 4 per second, 640 px canvas, no CRT layers

   Mode: Auto (default) | Full | Lite | Minimal. In Auto the app starts in `lite` on a small iPhone (SE / mini class) and on devices that report few cores or little memory,
   and a LoadWatch steps the level down by itself when the measured cost stays too high (the level it learned is remembered).
   Pure functions + one small class: unit tested. ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export const MODES = ['auto', 'full', 'lite', 'minimal'];
export const LEVELS = ['full', 'lite', 'minimal'];
export const MODE_LABELS = { auto: 'Auto (recommended)', full: 'Full', lite: 'Lite', minimal: 'Minimal' };

/** What each level allows. Read by CameraFilter.setQuality, VideoGlitch and the CSS body classes. */
export const QUALITY = [
  { name: 'full',    floorTier: 0, densityCap: 1,    smooth: true,  minRebuildMs: 0,   moveGapMs: 16,  colorGapMs: 33,  dprCap: 3,    maxBacking: 2048, glitch: true },
  { name: 'lite',    floorTier: 1, densityCap: 0.5,  smooth: false, minRebuildMs: 110, moveGapMs: 66,  colorGapMs: 66,  dprCap: 1.25, maxBacking: 960,  glitch: false },
  { name: 'minimal', floorTier: 2, densityCap: 0.3,  smooth: false, minRebuildMs: 240, moveGapMs: 110, colorGapMs: 110, dprCap: 1,    maxBacking: 640,  glitch: false },
];
export const qualityOf = (level) => QUALITY[Math.min(2, Math.max(0, level | 0))];

/** 0 = nothing to worry about, 1 = start in Lite: a small iPhone (SE / mini / 8 class), or a device that says it has little CPU or memory */
export function deviceHint(env = globalThis) {
  const nav = env.navigator ?? {}; const scr = env.screen ?? {};
  const ua = String(nav.userAgent ?? ''); const small = Math.min(scr.width || 9999, scr.height || 9999);
  const iphone = /iPhone|iPod/.test(ua);
  if (iphone && small <= 375) return 1;
  if (Number.isFinite(nav.hardwareConcurrency) && nav.hardwareConcurrency > 0 && nav.hardwareConcurrency <= 2) return 1;
  if (Number.isFinite(nav.deviceMemory) && nav.deviceMemory > 0 && nav.deviceMemory <= 2) return 1;
  return 0;
}

/** the level to run at: a fixed mode wins; Auto = the larger of the device hint and what the watchdog learned earlier */
export function resolveLevel(mode, { hint = 0, learned = 0 } = {}) {
  if (mode === 'full') return 0;
  if (mode === 'lite') return 1;
  if (mode === 'minimal') return 2;
  return Math.min(2, Math.max(hint | 0, learned | 0));
}

/**
 * Watches the measured cost of the picture and says when to step down. Feed it once per animation frame:
 *   dtMs   = time since the previous frame          workMs = what the picture (filter + glitch) cost in this frame
 * It works in TIME, not in frames (a frame can take 300 ms on a struggling phone, and the answer must still come within seconds).
 * Overloaded = the smoothed work > workLimit OR the smoothed frame time > dtLimit. After `needMs` of continuous overload it returns 'down';
 * `graceMs` after (re)start and `cooldownMs` after a step it does not judge, so a camera that is still warming up, or the effect of a change, is not misread.
 * It never steps up by itself.
 */
export class LoadWatch {
  constructor({ workLimitMs = 14, dtLimitMs = 62, needMs = 1800, graceMs = 2500, cooldownMs = 3500 } = {}) {
    Object.assign(this, { workLimitMs, dtLimitMs, needMs, graceMs, cooldownMs }); this.reset();
  }
  reset() { this.dtEma = 0; this.workEma = 0; this._init = false; this._bad = 0; this._wait = this.graceMs; }
  sample(dtMs, workMs) {
    if (!(dtMs > 0) || dtMs > 1500 || !(workMs >= 0)) return null; // a tab that was in the background (or garbage) is not "slow"
    const k = 1 - Math.exp(-dtMs / 400); // time-based smoothing (≈ 0.4 s)
    if (!this._init) { this.dtEma = dtMs; this.workEma = workMs; this._init = true; } else { this.dtEma += (dtMs - this.dtEma) * k; this.workEma += (workMs - this.workEma) * k; }
    if (this._wait > 0) { this._wait -= dtMs; return null; }
    if (this.workEma > this.workLimitMs || this.dtEma > this.dtLimitMs) this._bad += dtMs; else this._bad = Math.max(0, this._bad - dtMs * 2);
    if (this._bad >= this.needMs) { this._bad = 0; this._wait = this.cooldownMs; this._init = false; return 'down'; }
    return null;
  }
}

export const MODE_KEY = 'etherVeena.displayMode';
export const LEARNED_KEY = 'etherVeena.displayLearned';
export function loadDisplaySettings(storage) {
  let mode = 'auto', learned = 0;
  try { const m = storage.getItem(MODE_KEY); if (MODES.includes(m)) mode = m; const l = parseInt(storage.getItem(LEARNED_KEY), 10); if (l >= 0 && l <= 2) learned = l; } catch { /* storage unavailable */ }
  return { mode, learned };
}
export function saveDisplayMode(storage, mode) { try { storage.setItem(MODE_KEY, MODES.includes(mode) ? mode : 'auto'); } catch { /* ignore */ } }
export function saveLearned(storage, level) { try { storage.setItem(LEARNED_KEY, String(Math.min(2, Math.max(0, level | 0)))); } catch { /* ignore */ } }

// -- Sound engine (Build 033): 'standard' = full quality (default everywhere); 'light' = less CPU, simpler tone — only when the user chooses it ----------------------------
export const SOUND_KEY = 'etherVeena.soundMode';
export const SOUND_MODES = ['standard', 'light'];
export function loadSoundMode(storage) { try { const m = storage.getItem(SOUND_KEY); return SOUND_MODES.includes(m) ? m : 'standard'; } catch { return 'standard'; } }
export function saveSoundMode(storage, mode) { try { storage.setItem(SOUND_KEY, SOUND_MODES.includes(mode) ? mode : 'standard'); } catch { /* ignore */ } }

/** camera size to ask for: 16:9 either way; a small / slow phone does not need 720p to track hands (the picture is shown small and the polygons are redrawn anyway) */
export function cameraSizeFor(hint = 0) { return hint >= 1 ? { width: 960, height: 540 } : { width: 1280, height: 720 }; }
