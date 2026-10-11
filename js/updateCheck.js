/* ==========================================================================
   updateCheck.js — tell the player, quietly, that a newer version is on the server.
   The running code knows its own version (appVersion.js); the server's version.json is fetched with no-store and compared.
   Pure functions + one injected fetch → unit-tested. ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/** "0.7.0" + "031"  →  comparable tuple */
function parts(version, build) {
  const v = String(version ?? '').split('.').map((n) => parseInt(n, 10)); while (v.length < 3) v.push(0);
  return [...v.slice(0, 3).map((n) => (Number.isFinite(n) ? n : 0)), Number.parseInt(build, 10) || 0];
}
/** > 0 when `b` is newer than `a` */
export function compareVersions(a, b) {
  const x = parts(a.version, a.build), y = parts(b.version, b.build);
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] > x[i] ? 1 : -1;
  return 0;
}

/**
 * @param {{version:string, build:string}} running
 * @param {(url:string, init?:object)=>Promise<{ok:boolean, json:()=>Promise<any>}>} fetchFn
 * @returns {Promise<{available:boolean, version?:string, build?:string}>}  never throws (offline = nothing to say)
 */
export async function checkForUpdate(running, fetchFn = globalThis.fetch?.bind(globalThis), base = './version.json') {
  try {
    const res = await fetchFn(`${base}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { available: false };
    const data = await res.json();
    if (!data || typeof data.version !== 'string') return { available: false };
    return compareVersions(running, data) > 0 ? { available: true, version: data.version, build: String(data.build ?? '') } : { available: false };
  } catch { return { available: false }; }
}

/** Drop this app's caches and service worker, then reload: the next load comes from the network (and is cached again). */
export async function applyUpdate(env = globalThis) {
  try {
    if (env.caches) for (const k of await env.caches.keys()) if (k.startsWith('ether-veena-')) await env.caches.delete(k);
    const regs = env.navigator?.serviceWorker?.getRegistrations ? await env.navigator.serviceWorker.getRegistrations() : [];
    for (const r of regs) await r.unregister();
  } catch { /* reload anyway */ }
  env.location.reload();
}
