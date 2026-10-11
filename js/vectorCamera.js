/* ==========================================================================
   vectorCamera.js — VECTOR CAMERA (Build 029): turn the Polygon camera filter's mesh into a real vector picture.

   The filter's mesh is a list of triangles (x0 y0 x1 y1 x2 y2, in the small analysis image's pixel units, SUBPIXEL) with one flat colour each.
   That is already vector data, so the export is lossless: every triangle becomes one filled polygon — in SVG, or in a PDF (hand-written, no library).
   Nothing here touches the DOM (pure functions, unit tested); app.js / cameraFilters.js do the capturing.

   Frame handling
     · the visible part: the stage shows the camera picture with object-fit: cover, so the export is cropped to the same part (`visibleRect`)
     · mirroring: a front-camera picture is mirrored on screen; the export is mirrored the same way (what you saw is what you get)
     · colours: the graded colours (colour mode, music colour) exactly as drawn
     · seams: each polygon also gets a hairline stroke in its own colour (0.55 analysis px) so viewers never show light cracks between faces
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const hex2 = (n) => (n < 16 ? '0' : '') + Math.max(0, Math.min(255, Math.round(n))).toString(16);
export const rgbHex = (r, g, b) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const num = (x) => { const s = (Math.round(x * 100) / 100).toString(); return s; };

/** drawing styles: filled faces · faces drawn as coloured lines · black lines (line art) */
export const STYLES = [['fill', 'Filled'], ['lines', 'Colour lines'], ['black', 'Black lines']];
/** PDF page sizes in pt (portrait). 'fit' = the page is exactly the picture. */
export const PAGES = { fit: null, a4: [595.28, 841.89], a3: [841.89, 1190.55], square: [842, 842] };
export const PAGE_CHOICES = [['fit', 'Fit to picture'], ['a4', 'A4'], ['a3', 'A3'], ['square', 'Square']];
const LINE_W = 0.8; // analysis px, for the two line styles
export const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h ?? '').trim()); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
/** the colour a triangle is drawn with in a given style (stroke for the line styles) */
const faceColor = (style, r, g, b) => (style === 'black' ? '#000000' : rgbHex(r, g, b));
const bgOf = (o, dflt) => (o.background === 'transparent' ? null : (hexToRgb(o.background) ? o.background : dflt));

/**
 * The part of the analysis frame (w × h) that is visible in a stage of stageW × stageH (object-fit: cover), in mesh units.
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function visibleRect(mw, mh, stageW, stageH) {
  const fw = mw - 1, fh = mh - 1;
  if (!(stageW > 0 && stageH > 0)) return { x: 0, y: 0, w: fw, h: fh };
  const a = fw / fh, r = stageW / stageH;
  const w = a > r ? fh * r : fw, h = a > r ? fh : fw / r;
  return { x: (fw - w) / 2, y: (fh - h) / 2, w, h };
}

/** triangles that touch the rectangle (culls the ones fully cropped away) */
function inView(tris, t, rc) {
  const xs = [tris[t * 6], tris[t * 6 + 2], tris[t * 6 + 4]], ys = [tris[t * 6 + 1], tris[t * 6 + 3], tris[t * 6 + 5]];
  return Math.max(...xs) >= rc.x && Math.min(...xs) <= rc.x + rc.w && Math.max(...ys) >= rc.y && Math.min(...ys) <= rc.y + rc.h;
}

/**
 * @param {{tris:Float32Array, count:number}} mesh  @param {Uint8ClampedArray|Uint8Array} rgb count*3
 * @param {number} mw analysis width  @param {number} mh analysis height
 * @param {{rect?:{x:number,y:number,w:number,h:number}, mirror?:boolean, background?:string, longSide?:number, title?:string}} [o]
 * @returns {string} SVG document
 */
export function meshToSvg(mesh, rgb, mw, mh, o = {}) {
  const rc = o.rect ?? visibleRect(mw, mh, 0, 0); const mirror = !!o.mirror; const bg = bgOf(o, '#0a0908'); const style = o.style ?? 'fill';
  const k = (o.longSide ?? 2000) / Math.max(rc.w, rc.h); const W = Math.round(rc.w * k), H = Math.round(rc.h * k);
  const fx = (x) => (mirror ? mw - 1 - x : x);
  // in the mirrored frame the crop rectangle is mirrored too (the crop is centred, so only x0 changes)
  const vx = mirror ? mw - 1 - (rc.x + rc.w) : rc.x;
  const out = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(rc.y)} ${num(rc.w)} ${num(rc.h)}" width="${W}" height="${H}">`);
  out.push(`<title>${(o.title ?? 'ETHER VEENA vector photo').replace(/[<&>]/g, '')}</title>`);
  if (bg) out.push(`<rect x="${num(vx)}" y="${num(rc.y)}" width="${num(rc.w)}" height="${num(rc.h)}" fill="${bg}"/>`);
  out.push(`<g stroke-width="${style === 'fill' ? 0.55 : LINE_W}" stroke-linejoin="round">`);
  const t6 = mesh.tris;
  for (let t = 0; t < mesh.count; t++) {
    // visibility test in ORIGINAL (un-mirrored) coordinates
    if (!inView(t6, t, rc)) continue;
    const c = faceColor(style, rgb[t * 3], rgb[t * 3 + 1], rgb[t * 3 + 2]);
    out.push(`<polygon fill="${style === 'fill' ? c : 'none'}" stroke="${c}" points="${num(fx(t6[t * 6]))},${num(t6[t * 6 + 1])} ${num(fx(t6[t * 6 + 2]))},${num(t6[t * 6 + 3])} ${num(fx(t6[t * 6 + 4]))},${num(t6[t * 6 + 5])}"/>`);
  }
  out.push('</g>', '</svg>');
  return out.join('\n');
}

const enc = new TextEncoder();
const cl = (v) => (Math.round((v / 255) * 1000) / 1000).toString();

/**
 * A single-page PDF with the picture as vector paths (filled + hairline-stroked triangles, clipped to the page). Flate-compressed when the
 * browser has CompressionStream. @returns {Promise<Uint8Array>}
 */
export async function meshToPdf(mesh, rgb, mw, mh, o = {}) {
  const rc = o.rect ?? visibleRect(mw, mh, 0, 0); const mirror = !!o.mirror; const style = o.style ?? 'fill';
  const long = o.longSide ?? 842; // pt (A4 long side); vector, so the size is only the default print size
  let PW, PH, k, ox = 0, oy = 0;
  const fixed = PAGES[o.page ?? 'fit'];
  if (fixed) {
    // a standard page: orientation follows the picture, the picture is centred and as large as fits (a margin of 4%)
    const [a, b] = fixed; const land = rc.w > rc.h && a !== b;
    PW = land ? b : a; PH = land ? a : b;
    k = Math.min((PW * 0.96) / rc.w, (PH * 0.96) / rc.h); ox = (PW - rc.w * k) / 2; oy = (PH - rc.h * k) / 2;
  } else { k = long / Math.max(rc.w, rc.h); PW = rc.w * k; PH = rc.h * k; }
  const bgHex = bgOf(o, '#0a0908'); const bgc = bgHex ? hexToRgb(bgHex) : null;
  const px = (x) => ox + ((mirror ? mw - 1 - x : x) - (mirror ? mw - 1 - (rc.x + rc.w) : rc.x)) * k;
  const py = (y) => oy + (rc.y + rc.h - y) * k; // PDF's y axis points up
  const f = (x) => (Math.round(x * 100) / 100).toString();
  const ops = [`q`];
  if (bgc) ops.push(`${bgc.map(cl).join(' ')} rg 0 0 ${f(PW)} ${f(PH)} re f`); // the page background (not the picture's frame)
  ops.push(`${f(ox)} ${f(oy)} ${f(rc.w * k)} ${f(rc.h * k)} re W n`, `${f((style === 'fill' ? 0.55 : LINE_W) * k)} w 1 j`);
  const t6 = mesh.tris;
  for (let t = 0; t < mesh.count; t++) {
    if (!inView(t6, t, rc)) continue;
    const c = style === 'black' ? '0 0 0' : `${cl(rgb[t * 3])} ${cl(rgb[t * 3 + 1])} ${cl(rgb[t * 3 + 2])}`;
    ops.push(`${style === 'fill' ? `${c} rg ` : ''}${c} RG ${f(px(t6[t * 6]))} ${f(py(t6[t * 6 + 1]))} m ${f(px(t6[t * 6 + 2]))} ${f(py(t6[t * 6 + 3]))} l ${f(px(t6[t * 6 + 4]))} ${f(py(t6[t * 6 + 5]))} l h ${style === 'fill' ? 'B' : 'S'}`);
  }
  ops.push('Q');
  let body = enc.encode(ops.join('\n')); let filter = '';
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate'); const w = cs.writable.getWriter(); w.write(body); w.close();
      body = new Uint8Array(await new Response(cs.readable).arrayBuffer()); filter = ' /Filter /FlateDecode';
    } catch { /* leave it uncompressed */ }
  }
  const parts = []; const offsets = []; let pos = 0;
  const push = (u8) => { parts.push(u8); pos += u8.length; };
  const str = (s) => push(enc.encode(s));
  str('%PDF-1.4\n');
  const obj = (n, s) => { offsets[n] = pos; str(`${n} 0 obj\n${s}\nendobj\n`); };
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(PW)} ${f(PH)}] /Contents 4 0 R /Resources << >> >>`);
  offsets[4] = pos; str(`4 0 obj\n<< /Length ${body.length}${filter} >>\nstream\n`); push(body); str('\nendstream\nendobj\n');
  obj(5, `<< /Title (${(o.title ?? 'ETHER VEENA vector photo').replace(/[()\\]/g, '')}) /Producer (ETHER VEENA) >>`);
  const xref = pos; str(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) str(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  str(`trailer\n<< /Size 6 /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let p = 0; for (const u of parts) { out.set(u, p); p += u.length; }
  return out;
}

/**
 * Draw the picture onto a 2D context (for the PNG export). Same crop / mirror / style / background as the SVG; `ctx` is any CanvasRenderingContext2D-like object.
 * @returns {{width:number, height:number}} the size the canvas needs (set it BEFORE drawing: see sizeForPng)
 */
export function drawMeshToCtx(ctx, mesh, rgb, mw, mh, o = {}) {
  const rc = o.rect ?? visibleRect(mw, mh, 0, 0); const mirror = !!o.mirror; const style = o.style ?? 'fill'; const bg = bgOf(o, '#0a0908');
  const { width, height } = sizeForPng(rc, o.longSide);
  const k = width / rc.w; const x0 = mirror ? mw - 1 - (rc.x + rc.w) : rc.x;
  const px = (x) => ((mirror ? mw - 1 - x : x) - x0) * k, py = (y) => (y - rc.y) * k;
  ctx.clearRect?.(0, 0, width, height);
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height); }
  ctx.lineJoin = 'round'; ctx.lineWidth = (style === 'fill' ? 0.55 : LINE_W) * k;
  const t6 = mesh.tris;
  for (let t = 0; t < mesh.count; t++) {
    if (!inView(t6, t, rc)) continue;
    const c = faceColor(style, rgb[t * 3], rgb[t * 3 + 1], rgb[t * 3 + 2]);
    ctx.beginPath(); ctx.moveTo(px(t6[t * 6]), py(t6[t * 6 + 1])); ctx.lineTo(px(t6[t * 6 + 2]), py(t6[t * 6 + 3])); ctx.lineTo(px(t6[t * 6 + 4]), py(t6[t * 6 + 5])); ctx.closePath();
    if (style === 'fill') { ctx.fillStyle = c; ctx.fill(); }
    ctx.strokeStyle = c; ctx.stroke();
  }
  return { width, height };
}
/** pixel size of the PNG: the long side is `longSide` (default 2400) */
export function sizeForPng(rc, longSide = 2400) { const k = longSide / Math.max(rc.w, rc.h); return { width: Math.max(1, Math.round(rc.w * k)), height: Math.max(1, Math.round(rc.h * k)) }; }

/** timer choices (seconds) for the self-timer */
export const TIMER_CHOICES = [0, 3, 5, 10];
