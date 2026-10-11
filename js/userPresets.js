/* ==========================================================================
   userPresets.js — MY PRESETS and RANDOMIZE LOCKS (Build 030). Pure (no DOM): validation, storage, JSON export / import.

   A "my preset" has exactly the shape of a built-in unified preset (presets.js), so one function applies both:
     { id, name, blurb, mine: true, instrument:{id,options,params}, scale:{root,name}, performance:{pitchMode,sensitivity,face},
       mapping:[rows], synth:{…}, effects:{…incl. delayMode,pingWidth}, display:{…incl. glitch, crt, bodyVisual, background, faceHud, backgroundColor} }
   Anything read from storage or from an imported file is untrusted: it is rebuilt field by field, never used as it is.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */
import { DISPLAY_BASE } from './presets.js';

export const USER_PRESETS_KEY = 'etherVeena.userPresets.v1';
export const LOCKS_KEY = 'etherVeena.randomLocks.v1';
export const MAX_USER_PRESETS = 60;
export const MAX_NAME = 40;
const INSTRUMENTS = ['theremin', 'harp', 'rudra'];
const HEX = /^#[0-9a-f]{6}$/i;
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x, d, lo = -1e6, hi = 1e6) => (Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
const str = (x, d, max = 60) => (typeof x === 'string' ? x.slice(0, max) : d);
const flatNumbers = (o, max = 64) => { const r = {}; if (!isObj(o)) return r; for (const [k, v] of Object.entries(o).slice(0, max)) { if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue; if (Number.isFinite(v)) r[k] = v; else if (typeof v === 'string' && v.length <= 40) r[k] = v; else if (typeof v === 'boolean') r[k] = v; } return r; };

/** Rebuild a display description from untrusted data (missing keys come from DISPLAY_BASE). */
export function sanitizeDisplay(d) {
  const b = DISPLAY_BASE; const x = isObj(d) ? d : {}; const g = isObj(x.glitch) ? x.glitch : {};
  const hex = (v, dflt) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : dflt);
  const out = {
    filter: str(x.filter, b.filter, 12), density: num(x.density, b.density, 0, 1), colorMode: str(x.colorMode, b.colorMode, 12),
    base: hex(x.base, b.base), dark: hex(x.dark, b.dark), bright: hex(x.bright, b.bright), music: str(x.music, b.music, 12),
    glitch: {}, bodyVisual: str(x.bodyVisual, b.bodyVisual, 16), background: str(x.background, b.background, 12), faceHud: str(x.faceHud, b.faceHud, 12),
    crt: { on: !!(isObj(x.crt) ? x.crt.on : b.crt.on), amount: num(isObj(x.crt) ? x.crt.amount : undefined, b.crt.amount, 0, 1) },
  };
  for (const k of Object.keys(b.glitch)) out.glitch[k] = num(g[k], b.glitch[k], 0, 1);
  if (typeof x.backgroundColor === 'string' && HEX.test(x.backgroundColor)) out.backgroundColor = x.backgroundColor.toLowerCase();
  return out;
}

/** @returns a clean preset, or null when `p` is not a usable preset */
export function sanitizePreset(p) {
  if (!isObj(p) || typeof p.name !== 'string' || !p.name.trim()) return null;
  if (!isObj(p.instrument) || !INSTRUMENTS.includes(p.instrument.id)) return null;
  if (!isObj(p.scale) || typeof p.scale.name !== 'string') return null;
  const rows = Array.isArray(p.mapping) ? p.mapping.filter(isObj).slice(0, 24).map((r) => ({ ...flatNumbers(r, 12) })) : [];
  const perf = isObj(p.performance) ? p.performance : {};
  return {
    id: /^[A-Za-z0-9_-]{1,60}$/.test(p.id ?? '') ? p.id : newId(),
    name: p.name.trim().slice(0, MAX_NAME), blurb: str(p.blurb, 'My preset.', 200), mine: true,
    instrument: { id: p.instrument.id, options: flatNumbers(p.instrument.options, 16), params: flatNumbers(p.instrument.params, 40) },
    scale: { root: Math.round(num(p.scale.root, 0, 0, 11)), name: p.scale.name.slice(0, 40) },
    performance: { pitchMode: str(perf.pitchMode, 'continuous', 20), sensitivity: num(perf.sensitivity, 1, 0.3, 3), face: !!perf.face },
    mapping: rows, synth: flatNumbers(p.synth), effects: flatNumbers(p.effects), display: sanitizeDisplay(p.display),
  };
}
let seq = 0;
export function newId() { return `user-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`; }

/** Build a preset from a captured app state (see App.captureState) */
export function makeUserPreset(name, state) {
  return sanitizePreset({ ...state, id: newId(), name, blurb: state.blurb ?? 'My preset.' });
}

export function loadUserPresets(storage) {
  try {
    const raw = JSON.parse(storage.getItem(USER_PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.map(sanitizePreset).filter(Boolean).slice(0, MAX_USER_PRESETS) : [];
  } catch { return []; }
}
export function saveUserPresets(storage, list) { try { storage.setItem(USER_PRESETS_KEY, JSON.stringify(list.slice(0, MAX_USER_PRESETS))); return true; } catch { return false; } }

/** a file the user can keep: { app, version, presets } */
export function exportUserPresets(list) { return JSON.stringify({ app: 'ether-veena', kind: 'user-presets', version: 1, presets: list }, null, 2); }
/** @returns {{list:Array, added:number, skipped:number}} merged list (an imported preset with a known id replaces it; unusable ones are skipped) */
export function importUserPresets(text, existing = []) {
  let data; try { data = JSON.parse(text); } catch { return { list: existing, added: 0, skipped: 0, error: 'This file is not valid JSON.' }; }
  const arr = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.presets) ? data.presets : null;
  if (!arr) return { list: existing, added: 0, skipped: 0, error: 'No presets found in this file.' };
  const list = existing.slice(); let added = 0, skipped = 0;
  for (const raw of arr.slice(0, 200)) {
    const p = sanitizePreset(raw);
    if (!p || list.length >= MAX_USER_PRESETS && !list.some((q) => q.id === p.id)) { skipped++; continue; }
    const i = list.findIndex((q) => q.id === p.id);
    if (i >= 0) list[i] = p; else list.push(p);
    added++;
  }
  return { list, added, skipped };
}
/** a name that is not used yet: "Name", "Name 2", … */
export function uniqueName(name, list) {
  const base = (name || 'My preset').trim().slice(0, MAX_NAME - 3) || 'My preset'; const used = new Set(list.map((p) => p.name));
  if (!used.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

// ---- Randomize locks ----------------------------------------------------------------------------------------------------------------
export const LOCKS = [
  ['root', 'Root note'], ['scale', 'Scale / Raga'], ['voice', 'Waveform & filter type'], ['filter', 'Camera filter'],
  ['colors', 'Colours'], ['fx', 'Glitch & CRT'], ['body', 'Body visual & background'], ['delay', 'Delay type'],
];
export const LOCK_IDS = LOCKS.map(([id]) => id);
export const noLocks = () => Object.fromEntries(LOCK_IDS.map((id) => [id, false]));
export function sanitizeLocks(x) { const r = noLocks(); if (isObj(x)) for (const id of LOCK_IDS) r[id] = x[id] === true; return r; }
export function loadLocks(storage) { try { return sanitizeLocks(JSON.parse(storage.getItem(LOCKS_KEY) ?? '{}')); } catch { return noLocks(); } }
export function saveLocks(storage, locks) { try { storage.setItem(LOCKS_KEY, JSON.stringify(sanitizeLocks(locks))); } catch { /* ignore */ } }

const DISPLAY_LOCKS = { filter: ['filter'], colors: ['colorMode', 'base', 'dark', 'bright', 'music'], fx: ['glitch', 'crt'], body: ['bodyVisual', 'background', 'faceHud', 'backgroundColor'] };
/** Keep the locked parts of the CURRENT display in a randomized one. Privacy mode still wins over a locked "off" filter. */
export function lockDisplay(next, current, locks, { privacy = false } = {}) {
  const out = { ...next };
  for (const [id, keys] of Object.entries(DISPLAY_LOCKS)) {
    if (!locks?.[id]) continue;
    for (const k of keys) out[k] = isObj(current[k]) ? { ...current[k] } : current[k];
  }
  if (locks?.filter && privacy && out.filter === 'off') { out.filter = 'facets'; out.density = Math.min(out.density, 0.6); }
  if (locks?.filter && out.filter === 'off') out.colorMode = out.colorMode ?? 'original';
  return out;
}
/** Keep the locked synth / effects values. @returns the synth values without the locked keys (so they are simply not touched) */
export function lockSynth(synth, locks) { if (!locks?.voice) return synth; const { waveform, filterType, ...rest } = synth; return rest; }
export function lockEffects(fx, locks) { if (!locks?.delay) return fx; const { delayMode, pingWidth, ...rest } = fx; return rest; }
