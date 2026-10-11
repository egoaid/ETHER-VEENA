/* ==========================================================================
   cameraFilters.js — the Camera Filter: the live picture rebuilt as a faceted polygon image.

   An ARTISTIC camera visualisation (not a privacy tool): a clean low-poly / crystalline treatment that becomes part of
   the instrument's audiovisual identity — the music can colour it.

   PIPELINE
     camera → small analysis image (width adapts to the polygon density) → Sobel contours →
     a lattice of vertices whose interior points are pulled onto the contours with SUBPIXEL accuracy
     (then repaired so no triangle flips or collapses) → triangles (a square grid whose diagonal follows
     the contour, or a triangular lattice) → each face takes the AVERAGE colour of its own area
     (summed-area table), optional lit-relief shading + quantising, temporal smoothing
     = a MESH: geometry + per-face colour + per-face luminance.
     The mesh is rebuilt at ≈ 12 fps; GRADING (colour mode, music colour) and DRAWING happen separately,
     so the colours can follow the music smoothly between rebuilds.

   COLOUR is part of the mesh stage, not an overlay: each face's colour is graded (Original / Monochrome /
   Duotone, then hue / saturation / brightness / contrast from the music) before it is drawn.

   RENDERING: a WebGL triangle mesh when available (shared vertices rasterise watertight, subpixel vertices, MSAA edges,
   positions ready for future vertex animation), otherwise Canvas 2D without any stroke (faces are grown by ~0.6 px
   so their edges overlap instead of leaving seams). Both draw exactly the same mesh.

   Pure logic (buildFacets, gradeFaces, MusicColor, Governor) + the DOM class CameraFilter.   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/** id, name, grid, columns, how strongly vertices snap to contours (0..1), relief shading (0..1), colour levels (0 = off) */
export const CAMERA_FILTERS = [
  { id: 'off', name: 'Off' },
  { id: 'facets', name: 'Facets', grid: 'square', cols: 22, snap: 0.55, shade: 0, levels: 0 },
  { id: 'crystal', name: 'Crystal', grid: 'lattice', cols: 16, snap: 0.5, shade: 0.18, levels: 0 },
  { id: 'relief', name: 'Relief 3D', grid: 'square', cols: 18, snap: 0.45, shade: 0.42, levels: 9 },
  { id: 'shards', name: 'Shards', grid: 'lattice', cols: 9, snap: 0.8, shade: 0.25, levels: 6 },
];

/**
 * User-facing POLYGON DENSITY 0 (coarse) … 1 (fine); 0.5 = each filter's designed grid (the build-024 look).
 * Build 027: the slider no longer scales the column count by a power of two (whole columns → visible jumps).
 * Instead every legal (cols, rows) grid is listed in order of face count (the "ladder"), and the slider walks
 * along that ladder with a gentle ease, so one slider step changes the polygon count by a few percent everywhere
 * and the fine end is never more than ~4.8x the designed face count (draw cost on phones stays bounded).
 */
export const DENSITY_DEFAULT = 0.5;
export const DENSITY_EASE = 1.25;
export const MAX_FACES = 9000; // Build 028: was 2600 — the fine end now reaches ≈ 16× the designed face count (4.5 k–9 k faces)
export const MAX_FACTOR = 16;
const DEFAULT_ASPECT = 9 / 16;
const TIER_DROP = [0, 4, 9]; // rungs removed by the performance tiers 0/1/2

const _ladders = new Map();
/** all usable grids for a filter, ascending by face count: [{cols, rows, faces}] */
export function densityLadder(f, aspect = DEFAULT_ASPECT) {
  const key = `${f.grid}|${aspect.toFixed(3)}`;
  if (_ladders.has(key)) return _ladders.get(key);
  const rowFactor = f.grid === 'lattice' ? 0.866 : 1; const byFaces = new Map();
  for (let n = 3; n <= 150; n++) {
    const ideal = aspect / ((1 / n) * rowFactor);
    for (const m of new Set([Math.floor(ideal), Math.ceil(ideal)])) {
      if (m < 2) continue;
      const cellRatio = (aspect / m) / ((1 / n) * rowFactor); // cell height / nominal cell height
      if (Math.abs(cellRatio - 1) > 0.22) continue; // keep cells close to square / equilateral
      const faces = 2 * n * m; const prev = byFaces.get(faces);
      if (!prev || Math.abs(cellRatio - 1) < prev.err) byFaces.set(faces, { cols: n, rows: m, faces, err: Math.abs(cellRatio - 1) });
    }
  }
  const L = [...byFaces.values()].sort((x, y) => x.faces - y.faces);
  _ladders.set(key, L); return L;
}
/** the grid for a density (0..1), video aspect (h/w) and performance tier */
export function densityLevel(f, density = DENSITY_DEFAULT, aspect = DEFAULT_ASPECT, tier = 0) {
  const L = densityLadder(f, aspect);
  const designed = 2 * f.cols * Math.max(2, Math.round(aspect * f.cols / (f.grid === 'lattice' ? 0.866 : 1)));
  let i0 = 0; for (let i = 1; i < L.length; i++) if (Math.abs(L[i].faces - designed) < Math.abs(L[i0].faces - designed)) i0 = i;
  const base = L[i0].faces;
  let iMin = 0; while (iMin < i0 && (L[iMin].faces < 12 || L[iMin].faces < 0.09 * base)) iMin++;
  let iMax = i0; while (iMax + 1 < L.length && L[iMax + 1].faces <= Math.min(MAX_FACES, MAX_FACTOR * base)) iMax++;
  const u = (clamp(density, 0, 1) - 0.5) * 2; const v = Math.sign(u) * Math.pow(Math.abs(u), DENSITY_EASE);
  const rank = v < 0 ? i0 + v * (i0 - iMin) : i0 + v * (iMax - i0);
  const idx = clamp(Math.round(rank) - TIER_DROP[Math.min(2, Math.max(0, tier))], iMin, iMax);
  return L[idx];
}
export const colsFor = (f, density = DENSITY_DEFAULT) => densityLevel(f, density).cols;
/** The analysis image width is an implementation detail: ~6 px per polygon cell, 192-384 px, reduced by the performance tier (0 = best). */
export const ANALYSIS_TIERS = [1, 0.75, 0.58];
export const analysisWidthFor = (cols, tier = 0) => Math.max(144, Math.round((clamp(Math.round((cols * 6) / 32) * 32, 192, 960) * ANALYSIS_TIERS[Math.min(2, Math.max(0, tier))]) / 16) * 16);
/** a filter with its grid (cols AND rows) resolved for a density; the tier also thins the polygons (drawing cost grows with the face count) */
export function resolveFilter(f, density = DENSITY_DEFAULT, aspect = DEFAULT_ASPECT, tier = 0) {
  if (!f.cols) return f;
  const l = densityLevel(f, density, aspect, tier);
  return { ...f, cols: l.cols, rows: l.rows };
}

export const filterById = (id) => CAMERA_FILTERS.find((f) => f.id === id) ?? CAMERA_FILTERS[0];

/** Next filter id in the cycle (used by the full-screen button). */
export const nextFilterId = (id) => CAMERA_FILTERS[(CAMERA_FILTERS.findIndex((f) => f.id === id) + 1) % CAMERA_FILTERS.length].id;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Sobel gradient of the luminance. Returns { mag, gx, gy } (Float32Array w*h each).
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h
 */
export function gradients(rgba, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) L[i] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
  const gx = new Float32Array(w * h); const gy = new Float32Array(w * h); const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = L[i - w - 1], b = L[i - w], c = L[i - w + 1], d = L[i - 1], f = L[i + 1], g = L[i + w - 1], hh = L[i + w], k = L[i + w + 1];
      const sx = (c + 2 * f + k) - (a + 2 * d + g);
      const sy = (g + 2 * hh + k) - (a + 2 * b + c);
      gx[i] = sx; gy[i] = sy; mag[i] = Math.abs(sx) + Math.abs(sy);
    }
  }
  return { L, gx, gy, mag };
}

/** Summed-area table of R, G, B → box means in O(1). */
export function summedArea(rgba, w, h) {
  const W = w + 1; const S = new Float64Array(W * (h + 1) * 3);
  for (let y = 0; y < h; y++) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      r += rgba[p]; g += rgba[p + 1]; b += rgba[p + 2];
      const i = ((y + 1) * W + (x + 1)) * 3; const up = (y * W + (x + 1)) * 3;
      S[i] = S[up] + r; S[i + 1] = S[up + 1] + g; S[i + 2] = S[up + 2] + b;
    }
  }
  return { S, w, h };
}

/** Mean RGB of the box centred on (cx, cy) with half-size r (pixels), written into out[0..2]. */
export function boxMean(sat, cx, cy, r, out) {
  const { S, w, h } = sat; const W = w + 1;
  const x0 = clamp(Math.round(cx - r), 0, w - 1); const x1 = clamp(Math.round(cx + r) + 1, x0 + 1, w);
  const y0 = clamp(Math.round(cy - r), 0, h - 1); const y1 = clamp(Math.round(cy + r) + 1, y0 + 1, h);
  const n = (x1 - x0) * (y1 - y0);
  for (let c = 0; c < 3; c++) {
    out[c] = (S[(y1 * W + x1) * 3 + c] - S[(y0 * W + x1) * 3 + c] - S[(y1 * W + x0) * 3 + c] + S[(y0 * W + x0) * 3 + c]) / n;
  }
}

/** The lattice of vertices (before snapping): square grid or triangular lattice. */
export function buildLattice(w, h, f) {
  const cell = w / f.cols;
  const verts = []; const rowsIdx = [];
  if (f.grid === 'lattice') {
    // rows are spread EVENLY over the frame (the last row sits exactly on the bottom border, never a sliver above it)
    const rows = f.rows ?? Math.max(2, Math.round((h - 1) / (cell * 0.866))); const dy = (h - 1) / rows;
    for (let j = 0; j <= rows; j++) {
      const y = j === rows ? h - 1 : j * dy; const off = j % 2 ? cell / 2 : 0; const row = [];
      row.push(verts.length); verts.push({ x: 0, y, border: true });
      for (let x = off || cell; x < w - cell * 0.35; x += cell) { row.push(verts.length); verts.push({ x: Math.min(w - 1, x), y, border: j === 0 || j === rows }); }
      row.push(verts.length); verts.push({ x: w - 1, y, border: true });
      rowsIdx.push(row);
    }
  } else {
    const rows = f.rows ?? Math.max(2, Math.round(h / cell));
    for (let j = 0; j <= rows; j++) {
      const row = [];
      for (let i = 0; i <= f.cols; i++) { row.push(verts.length); verts.push({ x: i === f.cols ? w - 1 : Math.min(w - 1, i * cell), y: j === rows ? h - 1 : (j * (h - 1)) / rows, border: i === 0 || i === f.cols || j === 0 || j === rows }); }
      rowsIdx.push(row);
    }
  }
  return { verts, rowsIdx, cell };
}

/**
 * Pull each interior vertex onto the nearest strong contour, with SUBPIXEL accuracy: the best contour pixel within snap × half a cell is
 * refined to the contour-weighted centroid of its 5×5 neighbourhood, so vertices are not stuck on the integer pixel grid of the small
 * analysis image (a main cause of jagged polygon boundaries). Border vertices only slide ALONG their border; corners stay.
 * Vertices keep their lattice position in (ox, oy) for the repair pass.
 */
export function snapVertices(verts, mag, w, h, cell, snap) {
  const R = Math.max(1, Math.round(cell * 0.62 * snap));
  for (const v of verts) {
    v.ox = v.x; v.oy = v.y;
    const edgeX = v.x <= 0 || v.x >= w - 1; const edgeY = v.y <= 0 || v.y >= h - 1;
    v.fixed = edgeX && edgeY;
    if (v.fixed) continue;
    const x0 = Math.round(v.x), y0 = Math.round(v.y);
    let bx = x0, by = y0, best = -Infinity;
    for (let dy = edgeY ? 0 : -R; dy <= (edgeY ? 0 : R); dy++) {
      for (let dx = edgeX ? 0 : -R; dx <= (edgeX ? 0 : R); dx++) {
        const x = clamp(x0 + dx, 0, w - 1); const y = clamp(y0 + dy, 0, h - 1);
        const m = mag[y * w + x] - 0.002 * (dx * dx + dy * dy); // ties pull toward the lattice point
        if (m > best) { best = m; bx = x; by = y; }
      }
    }
    // subpixel refinement: centroid of the contour strength around the best pixel
    let sw = 0, sx = 0, sy = 0; const thr = Math.max(1, best * 0.5);
    for (let dy = edgeY ? 0 : -2; dy <= (edgeY ? 0 : 2); dy++) {
      for (let dx = edgeX ? 0 : -2; dx <= (edgeX ? 0 : 2); dx++) {
        const x = clamp(bx + dx, 0, w - 1); const y = clamp(by + dy, 0, h - 1);
        const wgt = mag[y * w + x] - thr;
        if (wgt > 0) { sw += wgt; sx += wgt * x; sy += wgt * y; }
      }
    }
    v.x = sw > 0 && !edgeX ? sx / sw : bx; v.y = sw > 0 && !edgeY ? sy / sw : by;
    if (edgeX) v.x = x0; if (edgeY) v.y = y0;
  }
}

const cross = (A, B, C) => (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
const crossO = (A, B, C) => (B.ox - A.ox) * (C.oy - A.oy) - (B.oy - A.oy) * (C.ox - A.ox);

/**
 * Keep the mesh VALID: snapping can drag vertices across each other, flipping or collapsing triangles. Any triangle whose signed area has
 * reversed or fallen below 18 % of its lattice area pulls its vertices half-way back toward the lattice (up to 4 rounds), then resets them.
 * Returns the number of triangles that needed repair.
 */
export function repairMesh(verts, tris) {
  let repaired = 0;
  for (let round = 0; round < 5; round++) {
    const pull = new Set();
    for (const [a, b, c] of tris) {
      const A = verts[a], B = verts[b], C = verts[c];
      const o = crossO(A, B, C);
      if (cross(A, B, C) * Math.sign(o || 1) < 0.18 * Math.abs(o)) { pull.add(a); pull.add(b); pull.add(c); }
    }
    if (!pull.size) break;
    if (round === 0) repaired = pull.size;
    for (const i of pull) {
      const v = verts[i]; if (v.fixed) continue;
      if (round === 4) { v.x = v.ox; v.y = v.oy; } else { v.x = (v.x + v.ox) / 2; v.y = (v.y + v.oy) / 2; }
    }
  }
  return repaired;
}

/**
 * TONE: a soft, even picture. The faceted look is most beautiful in the middle tones, so every face colour is passed through a gentle tone curve:
 *   · overall contrast around the middle × 0.72 (the brightest and darkest faces move toward the middle)
 *   · a highlight SHOULDER (above luminance 185 the rise is slowed to ×0.6): white walls, windows and lamps stay a soft light colour, never a blown-out white
 *   · a shadow FOOT (below luminance 62 the fall is slowed to ×0.55): shadows are lifted, never near-black
 * Result: luminance 0…255 lands in ≈ 47…208. Hue and saturation are kept (the colour is scaled by the new/old luminance ratio).
 */
export const TONE = { contrast: 0.72, shoulderAt: 185, shoulderK: 0.6, footAt: 62, footK: 0.55 };
export function toneLum(y) {
  let v = 127.5 + (y - 127.5) * TONE.contrast;
  if (v > TONE.shoulderAt) v = TONE.shoulderAt + (v - TONE.shoulderAt) * TONE.shoulderK;
  if (v < TONE.footAt) v = TONE.footAt - (TONE.footAt - v) * TONE.footK;
  return v;
}
/** Apply the tone curve to an RGB colour (0..255), keeping its hue and saturation. Writes into out. */
export function toneMap(r, g, b, out = [0, 0, 0]) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b; const y2 = toneLum(y);
  if (y < 6) { out[0] = out[1] = out[2] = y2; return out; }
  const k = y2 / y;
  let R = r * k, G = g * k, B = b * k;
  const mx = Math.max(R, G, B);
  if (mx > 255) { // a saturated colour lifted past the gamut: ease it toward grey of the SAME luminance instead of clipping (clipping would darken it again)
    const s = Math.max(0, (255 - y2) / (mx - y2));
    R = y2 + (R - y2) * s; G = y2 + (G - y2) * s; B = y2 + (B - y2) * s;
  }
  out[0] = clamp(R, 0, 255); out[1] = clamp(G, 0, 255); out[2] = clamp(B, 0, 255);
  return out;
}

/**
 * Build the triangle mesh and the flat colour of every triangle.
 * @param {Uint8ClampedArray} rgba small RGBA image  @param {number} w @param {number} h  @param {object} f one of CAMERA_FILTERS (columns resolved: see resolveFilter)
 * @param {{prevColors?:Float32Array|null}} [state] previous frame's colours (temporal smoothing); updated in place
 * @returns {{tris:Float32Array, colors:Float32Array, lum:Float32Array, count:number, verts:Array, repaired:number, vidx:Int32Array, vpos:Float32Array}}
 *   tris = x0 y0 x1 y1 x2 y2 per triangle (small-image pixels, SUBPIXEL; faces sharing a vertex hold exactly the same numbers);
 *   colors = source RGB per face (0..255, after relief shading / quantising / smoothing, BEFORE colour grading); lum = its luminance 0..255
 */
const SAMPLE_X = new Float64Array(7), SAMPLE_Y = new Float64Array(7), SAMPLE_RGB = new Float64Array(21), SAMPLE_L = new Float64Array(7);
export function buildFacets(rgba, w, h, f, state = {}) {
  const { L, gx, gy, mag } = gradients(rgba, w, h);
  const sat = summedArea(rgba, w, h);
  const { verts, rowsIdx, cell } = buildLattice(w, h, f);
  snapVertices(verts, mag, w, h, cell, f.snap);

  // ---- faces ----
  const idx = [];
  const lum = (v) => L[clamp(Math.round(v.y), 0, h - 1) * w + clamp(Math.round(v.x), 0, w - 1)];
  if (f.grid === 'lattice') {
    for (let j = 0; j < rowsIdx.length - 1; j++) {
      const a = rowsIdx[j]; const b = rowsIdx[j + 1];
      let ia = 0, ib = 0;
      // zip two neighbouring rows into triangles, always advancing the side whose next vertex is further left (in LATTICE terms)
      while (ia < a.length - 1 || ib < b.length - 1) {
        const nextA = ia < a.length - 1 ? verts[a[ia + 1]].ox : Infinity;
        const nextB = ib < b.length - 1 ? verts[b[ib + 1]].ox : Infinity;
        if (nextA <= nextB) { idx.push([a[ia], a[ia + 1], b[ib]]); ia++; } else { idx.push([a[ia], b[ib + 1], b[ib]]); ib++; }
      }
    }
  } else {
    for (let j = 0; j < rowsIdx.length - 1; j++) {
      for (let i = 0; i < rowsIdx[j].length - 1; i++) {
        const v00 = rowsIdx[j][i], v10 = rowsIdx[j][i + 1], v01 = rowsIdx[j + 1][i], v11 = rowsIdx[j + 1][i + 1];
        // the diagonal that follows the contour = the one joining the two most similar corners
        if (Math.abs(lum(verts[v00]) - lum(verts[v11])) <= Math.abs(lum(verts[v10]) - lum(verts[v01]))) { idx.push([v00, v10, v11]); idx.push([v00, v11, v01]); } else { idx.push([v00, v10, v01]); idx.push([v10, v11, v01]); }
      }
    }
  }
  const repaired = repairMesh(verts, idx);

  // ---- colours ----
  const count = idx.length;
  const tris = new Float32Array(count * 6); const colors = new Float32Array(count * 3); const lumOut = new Float32Array(count);
  const prev = state.prevColors && state.prevColors.length === colors.length ? state.prevColors : null;
  const m = [0, 0, 0]; const acc = [0, 0, 0];
  const r = Math.max(1, cell * 0.16);
  const levels = f.levels;
  for (let t = 0; t < count; t++) {
    const A = verts[idx[t][0]], B = verts[idx[t][1]], C = verts[idx[t][2]];
    tris[t * 6] = A.x; tris[t * 6 + 1] = A.y; tris[t * 6 + 2] = B.x; tris[t * 6 + 3] = B.y; tris[t * 6 + 4] = C.x; tris[t * 6 + 5] = C.y;
    const cx = (A.x + B.x + C.x) / 3, cy = (A.y + B.y + C.y) / 3;
    // SHARP faces (Build 028): seven samples (centroid, three edge-midpoint pulls, three vertex pulls). A face that straddles a picture edge
    // takes the colour of the MEDIAN sample (the dominant side) instead of the average, so it does not turn into a muddy blend of both sides:
    // boundaries between faces then fall exactly where the picture's edges are, like a vector illustration. 25 % of the mean keeps flat areas calm.
    const sx = SAMPLE_X, sy = SAMPLE_Y;
    sx[0] = cx; sy[0] = cy;
    sx[1] = (A.x + B.x) * 0.25 + cx * 0.5; sy[1] = (A.y + B.y) * 0.25 + cy * 0.5;
    sx[2] = (B.x + C.x) * 0.25 + cx * 0.5; sy[2] = (B.y + C.y) * 0.25 + cy * 0.5;
    sx[3] = (C.x + A.x) * 0.25 + cx * 0.5; sy[3] = (C.y + A.y) * 0.25 + cy * 0.5;
    sx[4] = A.x * 0.4 + cx * 0.6; sy[4] = A.y * 0.4 + cy * 0.6;
    sx[5] = B.x * 0.4 + cx * 0.6; sy[5] = B.y * 0.4 + cy * 0.6;
    sx[6] = C.x * 0.4 + cx * 0.6; sy[6] = C.y * 0.4 + cy * 0.6;
    acc[0] = acc[1] = acc[2] = 0;
    for (let k = 0; k < 7; k++) {
      boxMean(sat, sx[k], sy[k], r, m); SAMPLE_RGB[k * 3] = m[0]; SAMPLE_RGB[k * 3 + 1] = m[1]; SAMPLE_RGB[k * 3 + 2] = m[2];
      acc[0] += m[0]; acc[1] += m[1]; acc[2] += m[2]; SAMPLE_L[k] = 0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2];
    }
    let med = 0; { // the sample whose luminance is the median of the seven (no allocation: count how many are below each)
      for (let k = 0; k < 7; k++) { let below = 0; for (let j = 0; j < 7; j++) if (SAMPLE_L[j] < SAMPLE_L[k] || (SAMPLE_L[j] === SAMPLE_L[k] && j < k)) below++; if (below === 3) { med = k; break; } }
    }
    let R = 0.75 * SAMPLE_RGB[med * 3] + 0.25 * (acc[0] / 7), G = 0.75 * SAMPLE_RGB[med * 3 + 1] + 0.25 * (acc[1] / 7), Bc = 0.75 * SAMPLE_RGB[med * 3 + 2] + 0.25 * (acc[2] / 7);
    if (f.shade > 0) {
      // pseudo-3D: light from the upper left; the local gradient is the surface slope, the parity gives each facet its own tilt
      const ix = clamp(Math.round(cx), 0, w - 1), iy = clamp(Math.round(cy), 0, h - 1), gi = iy * w + ix;
      const slope = -(gx[gi] * -0.6 + gy[gi] * -0.8) / 600;
      const tilt = (t % 2 ? 0.05 : -0.05) + ((Math.round(A.x * 7 + B.y * 13 + C.x * 3)) % 5 - 2) * 0.012;
      const k = 1 + f.shade * clamp(slope + tilt, -0.3, 0.3);
      R *= k; G *= k; Bc *= k;
    }
    if (levels > 0) { const q = 255 / (levels - 1); R = Math.round(R / q) * q; G = Math.round(G / q) * q; Bc = Math.round(Bc / q) * q; }
    toneMap(clamp(R, 0, 255), clamp(G, 0, 255), clamp(Bc, 0, 255), m); R = m[0]; G = m[1]; Bc = m[2]; // soft tone: no blown highlights, no crushed shadows
    if (prev) { R = prev[t * 3] + (R - prev[t * 3]) * 0.55; G = prev[t * 3 + 1] + (G - prev[t * 3 + 1]) * 0.55; Bc = prev[t * 3 + 2] + (Bc - prev[t * 3 + 2]) * 0.55; }
    colors[t * 3] = clamp(R, 0, 255); colors[t * 3 + 1] = clamp(G, 0, 255); colors[t * 3 + 2] = clamp(Bc, 0, 255);
    lumOut[t] = 0.299 * colors[t * 3] + 0.587 * colors[t * 3 + 1] + 0.114 * colors[t * 3 + 2];
  }
  state.prevColors = colors;
  // Vertex-level data for MOTION SMOOTHING (Build 030): the triangle list as vertex indices and the final vertex positions.
  const vidx = new Int32Array(count * 3); for (let t = 0; t < count; t++) { vidx[t * 3] = idx[t][0]; vidx[t * 3 + 1] = idx[t][1]; vidx[t * 3 + 2] = idx[t][2]; }
  const vpos = new Float32Array(verts.length * 2); for (let i = 0; i < verts.length; i++) { vpos[i * 2] = verts[i].x; vpos[i * 2 + 1] = verts[i].y; }
  return { tris, colors, lum: lumOut, count, verts, repaired, vidx, vpos };
}

// ---------------------------------------------------------------------------------------------------------------------
// COLOUR — graded per FACE (part of the mesh stage), never as an overlay on the finished picture
// ---------------------------------------------------------------------------------------------------------------------

export const COLOR_MODES = ['original', 'mono', 'duo'];
export const DEFAULT_STYLE = { mode: 'original', base: [90, 190, 255], dark: [8, 14, 46], bright: [255, 196, 120], hueShift: 0, sat: 1, val: 1, contrast: 1 };

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-9) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx > 0 ? d / mx : 0, mx];
}
export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360; const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
const lerp = (a, b, t) => a + (b - a) * t;
const rgbSat = (c) => { const mx = Math.max(c[0], c[1], c[2]); return mx > 0 ? (mx - Math.min(c[0], c[1], c[2])) / mx : 0; };
/** hex "#rrggbb" → [r,g,b] */
export const hexToRgb = (hex) => { const n = parseInt(String(hex).replace('#', ''), 16); return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [255, 255, 255]; };

/**
 * Grade ONE face colour. mode: original (the camera's own colours) · mono (one selected hue, brightness from the source luminance:
 * dark → the colour → a little toward white) · duo (source luminance interpolated between a dark and a bright colour);
 * then contrast around the middle, and hue rotation / saturation / brightness (highlights weigh more) — the music's part.
 * @returns {[number, number, number]} 0..255
 */
export function gradeColor(r, g, b, lum, style, out = [0, 0, 0]) {
  const st = style ?? DEFAULT_STYLE;
  const t0 = lum / 255;
  const t = clamp(0.5 + (t0 - 0.5) * (st.contrast ?? 1), 0, 1);
  let R, G, B;
  if (st.mode === 'mono') {
    const base = st.base;
    if (t < 0.8) { const k = 0.06 + 0.94 * (t / 0.8); R = base[0] * k; G = base[1] * k; B = base[2] * k; } else { const u = ((t - 0.8) / 0.2) * 0.35; R = lerp(base[0], 255, u); G = lerp(base[1], 255, u); B = lerp(base[2], 255, u); }
  } else if (st.mode === 'duo') {
    R = lerp(st.dark[0], st.bright[0], t); G = lerp(st.dark[1], st.bright[1], t); B = lerp(st.dark[2], st.bright[2], t);
    // two complementary colours average to a muddy grey in the middle: keep the saturation along the ramp at ≥ 85 % of the
    // interpolated endpoint saturation (the endpoints themselves are untouched)
    if (t > 0.001 && t < 0.999) {
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const sd = rgbSat(st.dark), sb = rgbSat(st.bright), want = 0.85 * lerp(sd, sb, t), have = mx > 0 ? (mx - mn) / mx : 0;
      if (have < want && mx > 0) { const k = want / Math.max(have, 1e-6); const mean = (R + G + B) / 3; const f = Math.min(k, 3); R = clamp(mean + (R - mean) * f, 0, 255); G = clamp(mean + (G - mean) * f, 0, 255); B = clamp(mean + (B - mean) * f, 0, 255); }
    }
  } else if ((st.contrast ?? 1) !== 1) {
    R = 127.5 + (r - 127.5) * st.contrast; G = 127.5 + (g - 127.5) * st.contrast; B = 127.5 + (b - 127.5) * st.contrast;
  } else { R = r; G = g; B = b; }
  const hs = st.hueShift ?? 0, sm = st.sat ?? 1, vm = st.val ?? 1;
  if (hs !== 0 || sm !== 1 || vm !== 1) {
    // (inline HSV round trip: no allocation — this runs for every face on every colour frame)
    const r1 = clamp(R, 0, 255) / 255, g1 = clamp(G, 0, 255) / 255, b1 = clamp(B, 0, 255) / 255;
    const mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1), d = mx - mn;
    let h = 0;
    if (d > 1e-9) { if (mx === r1) h = ((g1 - b1) / d) % 6; else if (mx === g1) h = (b1 - r1) / d + 2; else h = (r1 - g1) / d + 4; h *= 60; if (h < 0) h += 360; }
    const s2 = clamp((mx > 0 ? d / mx : 0) * sm, 0, 1), v2 = clamp(mx * (1 + (vm - 1) * (0.35 + 0.65 * t)), 0, 1);
    h = (((h + hs) % 360) + 360) % 360;
    const c = v2 * s2, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m0 = v2 - c;
    let rr, gg, bb;
    if (h < 60) { rr = c; gg = x; bb = 0; } else if (h < 120) { rr = x; gg = c; bb = 0; } else if (h < 180) { rr = 0; gg = c; bb = x; } else if (h < 240) { rr = 0; gg = x; bb = c; } else if (h < 300) { rr = x; gg = 0; bb = c; } else { rr = c; gg = 0; bb = x; }
    R = (rr + m0) * 255; G = (gg + m0) * 255; B = (bb + m0) * 255;
  }
  out[0] = clamp(R, 0, 255); out[1] = clamp(G, 0, 255); out[2] = clamp(B, 0, 255);
  return out;
}

/**
 * Grade every face of a mesh into a Uint8ClampedArray(count*3).
 * Fast paths: Original with a neutral grade is a plain copy; Monochrome / Duotone depend on the luminance alone, so the whole grade is a
 * 256-entry lookup table (built per call, 256 gradeColor calls) and each face costs one lookup. Only Original + a music grade needs the per-face HSV work.
 */
export function gradeFaces(mesh, style, out = new Uint8ClampedArray(mesh.count * 3)) {
  const st = style ?? DEFAULT_STYLE; const n = mesh.count;
  const neutral = (st.hueShift ?? 0) === 0 && (st.sat ?? 1) === 1 && (st.val ?? 1) === 1 && (st.contrast ?? 1) === 1;
  if (st.mode === 'original' && neutral) { for (let i = 0; i < n * 3; i++) out[i] = mesh.colors[i]; return out; }
  const tmp = [0, 0, 0];
  if (st.mode === 'mono' || st.mode === 'duo') {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let L = 0; L < 256; L++) { gradeColor(L, L, L, L, st, tmp); lut[L * 3] = tmp[0]; lut[L * 3 + 1] = tmp[1]; lut[L * 3 + 2] = tmp[2]; }
    for (let t = 0; t < n; t++) { const L = Math.min(255, Math.max(0, Math.round(mesh.lum[t]))) * 3; out[t * 3] = lut[L]; out[t * 3 + 1] = lut[L + 1]; out[t * 3 + 2] = lut[L + 2]; }
    return out;
  }
  for (let t = 0; t < n; t++) {
    gradeColor(mesh.colors[t * 3], mesh.colors[t * 3 + 1], mesh.colors[t * 3 + 2], mesh.lum[t], st, tmp);
    out[t * 3] = tmp[0]; out[t * 3 + 1] = tmp[1]; out[t * 3 + 2] = tmp[2];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// MUSIC COLOUR — the existing audio analysis (AudioBands) and the sounding pitch drive the grade; both are smoothed again here
// ---------------------------------------------------------------------------------------------------------------------

export const MUSIC_COLOR_MODES = ['off', 'audio', 'pitch', 'both'];
/** Pitch (MIDI) → hue rotation in degrees: continuous, A2 (45) … A6 (93) = −150° … +150°, A4 (69) = 0 (the colours as chosen). Clamped, never wrapping, so there is no jump. */
export const pitchHueShift = (midi) => (clamp((midi - 45) / 48, 0, 1) - 0.5) * 300;
export const midiOfHz = (hz) => 69 + 12 * Math.log2(hz / 440);

export class MusicColor {
  /** hueSpeed: maximum hue travel in degrees per second (keeps the colour from ever jumping) */
  constructor({ hueSpeed = 140, idleReleaseSec = 1.4 } = {}) { this.hueSpeed = hueSpeed; this.idleRelease = idleReleaseSec; this.reset(); }
  reset() { this.pitchHue = 0; this.bass = 0; this.mid = 0; this.treble = 0; this.energy = 0; this.style = { hueShift: 0, sat: 1, val: 1, contrast: 1 }; }
  /**
   * @param {{bass:number,mid:number,treble:number,energy:number}|null} bands existing AudioBands values 0..1 (already attack/release-smoothed)
   * @param {{midi:number|null, level:number}} pitch sounding pitch (null when none) and loudness 0..1
   * @param {string} mode off|audio|pitch|both  @param {number} dtMs
   */
  update(bands, pitch, mode, dtMs) {
    const dt = clamp(dtMs / 1000, 0, 0.25);
    const fol = (cur, target, up, down) => cur + (target - cur) * (1 - Math.exp(-dt / (target > cur ? up : down))); // second, slower smoothing (s)
    const useA = (mode === 'audio' || mode === 'both') && bands;
    const useP = mode === 'pitch' || mode === 'both';
    this.bass = fol(this.bass, useA ? bands.bass : 0, 0.18, 0.7);
    this.mid = fol(this.mid, useA ? bands.mid : 0, 0.18, 0.7);
    this.treble = fol(this.treble, useA ? bands.treble : 0, 0.12, 0.5);
    this.energy = fol(this.energy, useA ? bands.energy : 0, 0.2, 0.9);
    // pitch hue: follow the sounding pitch (rate-limited, so the colour never jumps); with no sounding pitch it relaxes smoothly to neutral
    const sounding = useP && pitch && pitch.midi != null && pitch.level > 0.05;
    if (sounding) { const maxStep = this.hueSpeed * dt; this.pitchHue += clamp(pitchHueShift(pitch.midi) - this.pitchHue, -maxStep, maxStep); }
    else this.pitchHue *= Math.exp(-dt / this.idleRelease);
    // mapping: bass → hue tendency, mid → saturation, treble → highlight brightness, energy → contrast / intensity
    this.style = {
      hueShift: this.pitchHue + 38 * this.bass,
      sat: clamp(0.82 + 0.75 * this.mid, 0.4, 1.6),
      val: clamp(1 + 0.45 * this.treble + 0.15 * this.energy, 0.8, 1.5),
      contrast: clamp(1 + 0.5 * this.energy, 1, 1.5),
    };
    return this.style;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// PERFORMANCE GOVERNOR — keeps the filter inside a frame budget on slower devices
// ---------------------------------------------------------------------------------------------------------------------

export class Governor {
  /** budgetMs: average cost (rebuild + draw) that is acceptable; tiers 0 (best) … 2 (lightest) */
  constructor({ budgetMs = 10, upEvery = 20, downEvery = 90 } = {}) { this.budget = budgetMs; this.upEvery = upEvery; this.downEvery = downEvery; this.tier = 0; this.ema = 0; this._n = 0; this._calm = 0; }
  step(ms) {
    this.ema = this._n === 0 ? ms : this.ema + (ms - this.ema) * 0.2; this._n++;
    if (this._n % this.upEvery === 0 && this.ema > this.budget && this.tier < 2) { this.tier++; this._calm = 0; }
    else if (this.ema < this.budget * 0.45 && this.tier > 0) { if (++this._calm >= this.downEvery) { this.tier--; this._calm = 0; } } else this._calm = 0;
    return this.tier;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// MOTION SMOOTHING (Build 030) — the mesh is rebuilt ~10-20 times a second; between rebuilds the VERTICES glide from where they were last shown
// to their new positions and the face colours cross-fade, so moving subjects flow instead of stepping. Only valid while the vertex lattice
// is the same (same vertex count); a new lattice (density / size change) simply switches.
// ---------------------------------------------------------------------------------------------------------------------

/** smooth ease for 0..1 */
export const easeInOut = (e) => { const x = clamp(e, 0, 1); return x * x * (3 - 2 * x); };

/** Triangle coordinates from two vertex-position sets at progress e (0 = from, 1 = to), using the NEW triangle list (so the mesh is always watertight at both ends). out: Float32Array(count*6) */
export function blendTris(fromV, toV, vidx, e, out) {
  const n = vidx.length / 3;
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = vidx[t * 3 + k] * 2; const a = fromV[vi], b = fromV[vi + 1];
      out[t * 6 + k * 2] = a + (toV[vi] - a) * e; out[t * 6 + k * 2 + 1] = b + (toV[vi + 1] - b) * e;
    }
  }
  return out;
}
/** cross-fade two colour arrays (0..255) into out */
export function blendColors(from, to, e, out) { for (let i = 0; i < to.length; i++) out[i] = from[i] + (to[i] - from[i]) * e; return out; }

// ---------------------------------------------------------------------------------------------------------------------
// RENDERERS — the same mesh, two ways to draw it
// ---------------------------------------------------------------------------------------------------------------------

/** Canvas 2D fallback: no stroke. Every face is grown by `grow` px about its centroid so neighbours OVERLAP slightly instead of leaving anti-aliasing seams. */
export function paintFacets(ctx, mesh, rgb, w, h, W, H, grow = 0.6) {
  const sx = W / (w - 1), sy = H / (h - 1);
  const { tris, count } = mesh;
  for (let t = 0; t < count; t++) {
    let x0 = tris[t * 6] * sx, y0 = tris[t * 6 + 1] * sy, x1 = tris[t * 6 + 2] * sx, y1 = tris[t * 6 + 3] * sy, x2 = tris[t * 6 + 4] * sx, y2 = tris[t * 6 + 5] * sy;
    if (grow > 0) {
      const cx = (x0 + x1 + x2) / 3, cy = (y0 + y1 + y2) / 3;
      const g = (x, y) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * grow, y + (dy / d) * grow]; };
      [x0, y0] = g(x0, y0); [x1, y1] = g(x1, y1); [x2, y2] = g(x2, y2);
    }
    ctx.fillStyle = `rgb(${rgb[t * 3] | 0},${rgb[t * 3 + 1] | 0},${rgb[t * 3 + 2] | 0})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
  }
}

/** Interleaved GPU buffers from a mesh: positions in NDC (faces sharing a vertex share the exact same floats) and per-vertex colours. */
export function meshToGlBuffers(mesh, rgb, w, h, pos = null, col = null) {
  const n = mesh.count * 3;
  if (!pos || pos.length !== n * 2) pos = new Float32Array(n * 2);
  if (!col || col.length !== n * 3) col = new Uint8Array(n * 3);
  const ix = 2 / (w - 1), iy = 2 / (h - 1);
  for (let t = 0; t < mesh.count; t++) {
    for (let k = 0; k < 3; k++) {
      const v = t * 3 + k;
      pos[v * 2] = mesh.tris[t * 6 + k * 2] * ix - 1; pos[v * 2 + 1] = 1 - mesh.tris[t * 6 + k * 2 + 1] * iy;
      col[v * 3] = rgb[t * 3]; col[v * 3 + 1] = rgb[t * 3 + 1]; col[v * 3 + 2] = rgb[t * 3 + 2];
    }
  }
  return { pos, col, vertexCount: n };
}

const VS = 'attribute vec2 a_pos; attribute vec3 a_col; varying vec3 v_col; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); v_col = a_col; }';
const FS = 'precision mediump float; varying vec3 v_col; void main(){ gl_FragColor = vec4(v_col, 1.0); }';

/** WebGL renderer: one draw call for the whole mesh. Positions are re-uploaded each rebuild (so vertex animation can be added later), colours each frame. */
export class GlFacetRenderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
    if (!gl) throw new Error('no webgl');
    this.gl = gl; this.canvas = canvas; this.pos = null; this.col = null; this.vertexCount = 0; this.lost = false;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this._init(); this.lost = false; });
    this._init();
  }

  _init() {
    const gl = this.gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.aPos = gl.getAttribLocation(prog, 'a_pos'); this.aCol = gl.getAttribLocation(prog, 'a_col');
    this.posBuf = gl.createBuffer(); this.colBuf = gl.createBuffer();
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
  }

  resize(W, H) { if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; } this.gl.viewport(0, 0, W, H); }

  /** upload positions (after a rebuild) */
  setMesh(mesh, rgb, w, h) {
    const b = meshToGlBuffers(mesh, rgb, w, h, this.pos, this.col);
    this.pos = b.pos; this.col = b.col; this.vertexCount = b.vertexCount;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf); gl.bufferData(gl.ARRAY_BUFFER, this.col, gl.DYNAMIC_DRAW);
  }

  /** upload new graded colours only (music colour between rebuilds) */
  setColors(mesh, rgb) {
    for (let t = 0; t < mesh.count; t++) for (let k = 0; k < 3; k++) { const v = (t * 3 + k) * 3; this.col[v] = rgb[t * 3]; this.col[v + 1] = rgb[t * 3 + 1]; this.col[v + 2] = rgb[t * 3 + 2]; }
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf); gl.bufferData(gl.ARRAY_BUFFER, this.col, gl.DYNAMIC_DRAW);
  }

  draw() {
    if (this.lost || !this.vertexCount) return;
    const gl = this.gl;
    gl.clearColor(0.04, 0.035, 0.03, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colBuf); gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }
}

/**
 * The DOM side: reads the <video>, rebuilds the mesh at ~12 fps (width adapts to the density and the performance tier), grades the faces with the
 * colour style + the music, and draws on a canvas that sits over the video (backing size follows the displayed size × devicePixelRatio).
 */
export class CameraFilter {
  /** @param {{video:HTMLVideoElement, canvas:HTMLCanvasElement, stage:HTMLElement, renderer?:'auto'|'webgl'|'canvas2d'}} o */
  constructor({ video, canvas, stage, renderer = 'auto' }) {
    this.video = video; this.canvas = canvas; this.stage = stage;
    this.id = 'off'; this.filter = filterById('off'); this.density = DENSITY_DEFAULT;
    this.style = { ...DEFAULT_STYLE }; this.musicMode = 'off'; this.music = new MusicColor(); this.governor = new Governor();
    this._small = document.createElement('canvas');
    this._sctx = this._small.getContext('2d', { willReadFrequently: true });
    this.gl = null; this._ctx = null;
    if (renderer !== 'canvas2d') { try { this.gl = new GlFacetRenderer(canvas); } catch { this.gl = null; } }
    if (!this.gl) this._ctx = canvas.getContext('2d');
    this.renderer = this.gl ? 'webgl' : 'canvas2d';
    this.smooth = true; this._ip = null; this._ipRgb = null; this._shownV = null; this._shownRgb = null; this._fromV = null; this._fromRgb = null; this._toV = null; this._tRebuild = 0; this._interpMs = 60; this._lastE = 1;
    this._state = {}; this._mesh = null; this._rgb = null; this._last = 0; this._lastDraw = 0; this._lastStyleKey = ''; this.minIntervalMs = 80; this.drawSeq = 0; this.stats = { rebuildMs: 0, drawMs: 0, faces: 0, analysisW: 0 };
  }

  setFilter(id) {
    this.id = filterById(id).id; this.filter = filterById(id); this._state = {}; this._mesh = null; this._last = 0;
    this.stage.classList.toggle('has-filter', this.id !== 'off');
    if (this.id === 'off') this._clear();
  }
  /** Motion smoothing on/off (Display → Polygon motion smoothing) */
  setSmooth(on) { this.smooth = !!on; this._fromV = null; this._lastE = 1; }
  setDensity(d) { this.density = clamp(d, 0, 1); this._state = {}; this._mesh = null; this._last = 0; }
  setColorStyle(partial) { Object.assign(this.style, partial); this._lastStyleKey = ''; }
  setMusicColor(mode) { this.musicMode = MUSIC_COLOR_MODES.includes(mode) ? mode : 'off'; if (this.musicMode === 'off') this.music.reset(); this._lastStyleKey = ''; }

  /**
   * The mesh for a VECTOR PHOTO (vectorCamera.js): detail 'live' = the mesh on screen right now (same faces, same graded colours);
   * 'fine' / 'finest' = a fresh mesh of the current frame at density 0.8 / 1.0 on the best analysis size (no performance tier, no temporal smoothing).
   * @returns {{mesh:object, rgb:Uint8ClampedArray, w:number, h:number}|null}
   */
  captureMesh(detail = 'live') {
    const v = this.video; if (this.id === 'off' || !v.videoWidth || v.readyState < 2) return null;
    const style = this._style ?? { ...this.style };
    if (detail === 'live' && this._mesh && this._rgb) return { mesh: this._mesh, rgb: Uint8ClampedArray.from(this._rgb), w: this._mw, h: this._mh };
    const f = resolveFilter(this.filter, detail === 'finest' ? 1 : 0.8, v.videoHeight / v.videoWidth, 0);
    const w = analysisWidthFor(f.cols, 0); const h = Math.max(8, Math.round((w * v.videoHeight) / v.videoWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(v, 0, 0, w, h);
    const mesh = buildFacets(x.getImageData(0, 0, w, h).data, w, h, f, {});
    return { mesh, rgb: gradeFaces(mesh, style), w, h };
  }

  _clear() { if (this.gl) { const gl = this.gl.gl; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } else if (this._ctx) this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height); }

  _backingSize() {
    const v = this.video; const a = v.videoWidth / v.videoHeight;
    const r = this.stage.getBoundingClientRect();
    const shownW = Math.max(r.width || 640, (r.height || 360) * a); // object-fit: cover
    const dpr = Math.min(3, window.devicePixelRatio || 1); // Build 028: edges are drawn at the device's real resolution
    const W = clamp(Math.round(shownW * dpr), 320, this.gl ? 2048 : 1280);
    return [W, Math.round(W / a)];
  }

  /**
   * Call every animation frame. Rebuilds the mesh when due; grades + draws when the mesh or the colours changed.
   * @param {number} nowMs @param {{bands?:object|null, midi?:number|null, level?:number}} [music] existing audio bands + the sounding pitch
   */
  update(nowMs, music = {}) {
    if (this.id === 'off') return;
    const v = this.video;
    if (!v.videoWidth || v.readyState < 2) return;
    const dt = this._lastDraw ? nowMs - this._lastDraw : 16;
    const style = { ...this.style, ...(this.musicMode === 'off' ? {} : this.music.update(music.bands ?? null, { midi: music.midi ?? null, level: music.level ?? 0 }, this.musicMode, dt)) };
    let rebuilt = false;
    // rebuild interval adapts to what a rebuild costs (cheap = more often, ≥ 50 ms; expensive = ≤ 100 ms)
    const interval = clamp(this.stats.rebuildMs * 8, 50, 100) * (this.governor.tier >= 2 ? 1.25 : 1);
    if (!this._mesh || nowMs - this._last >= interval) {
      const t0 = performance.now();
      this._last = nowMs;
      const f = resolveFilter(this.filter, this.density, v.videoHeight / v.videoWidth, this.governor.tier);
      const w = analysisWidthFor(f.cols, this.governor.tier); const h = Math.max(8, Math.round((w * v.videoHeight) / v.videoWidth));
      if (this._small.width !== w || this._small.height !== h) { this._small.width = w; this._small.height = h; this._state = {}; }
      this._sctx.drawImage(v, 0, 0, w, h);
      const img = this._sctx.getImageData(0, 0, w, h);
      const prevMesh = this._mesh;
      this._mesh = buildFacets(img.data, w, h, f, this._state); this._mw = w; this._mh = h;
      this.stats.rebuildMs = performance.now() - t0; this.stats.faces = this._mesh.count; this.stats.analysisW = w;
      // smoothing: glide from what is shown now to the new mesh (only on the same vertex lattice)
      const same = this.smooth && prevMesh && this._shownV && this._shownV.length === this._mesh.vpos.length && prevMesh.count === this._mesh.count;
      this._fromV = same ? Float32Array.from(this._shownV) : null; this._fromRgb = same && this._shownRgb && this._shownRgb.length === this._mesh.count * 3 ? Float32Array.from(this._shownRgb) : null;
      this._toV = this._mesh.vpos; this._tRebuild = nowMs; this._interpMs = Math.max(40, Math.min(110, interval));
      rebuilt = true;
    }
    const e = this._fromV ? easeInOut((nowMs - this._tRebuild) / this._interpMs) : 1;
    const moving = e < 1 || this._lastE < 1;
    const key = `${style.mode}|${style.hueShift.toFixed(0)}|${style.sat.toFixed(2)}|${style.val.toFixed(2)}|${style.contrast.toFixed(2)}|${style.base}|${style.dark}|${style.bright}`;
    this._style = style;
    if (!rebuilt && !moving && key === this._lastStyleKey && nowMs - this._lastDraw < 250) return;
    if (!rebuilt && nowMs - this._lastDraw < (moving ? 16 : 33)) return; // gliding: every frame (≤ 60 fps); colour-only redraws ≤ 30 fps
    const t1 = performance.now();
    const [W, H] = this._backingSize();
    this._rgb = gradeFaces(this._mesh, style, this._rgb && this._rgb.length === this._mesh.count * 3 ? this._rgb : undefined);
    // what is drawn: the new mesh, or a blend between the previous shown state and the new one
    let drawMesh = this._mesh; let drawRgb = this._rgb;
    if (e < 1 && this._fromV) {
      if (!this._ip || this._ip.count !== this._mesh.count) this._ip = { tris: new Float32Array(this._mesh.count * 6), count: this._mesh.count };
      blendTris(this._fromV, this._toV, this._mesh.vidx, e, this._ip.tris); drawMesh = this._ip;
      if (this._fromRgb) { if (!this._ipRgb || this._ipRgb.length !== this._rgb.length) this._ipRgb = new Uint8ClampedArray(this._rgb.length); blendColors(this._fromRgb, this._rgb, e, this._ipRgb); drawRgb = this._ipRgb; }
    }
    // remember what is on screen (vertex positions + colours) so the next rebuild can glide from exactly here
    if (this.smooth) {
      if (!this._shownV || this._shownV.length !== this._toV?.length) this._shownV = new Float32Array(this._mesh.vpos.length);
      if (e < 1 && this._fromV) blendColors(this._fromV, this._toV, e, this._shownV); else this._shownV.set(this._mesh.vpos);
      if (!this._shownRgb || this._shownRgb.length !== drawRgb.length) this._shownRgb = new Float32Array(drawRgb.length);
      this._shownRgb.set(drawRgb);
    }
    if (this.gl) {
      this.gl.resize(W, H);
      if (rebuilt || e < 1 || this._lastE < 1) this.gl.setMesh(drawMesh, drawRgb, this._mw, this._mh); else this.gl.setColors(drawMesh, drawRgb);
      this.gl.draw();
    } else {
      if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
      paintFacets(this._ctx, drawMesh, drawRgb, this._mw, this._mh, W, H);
    }
    this._lastE = e;
    this._lastDraw = nowMs; this._lastStyleKey = key; this.drawSeq++;
    this.stats.drawMs = performance.now() - t1;
    if (rebuilt) this.governor.step(this.stats.rebuildMs + this.stats.drawMs);
  }
}
