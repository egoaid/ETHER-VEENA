/* ==========================================================================
   geometry.js — one coordinate system for camera, tracking, overlay and UI.

   MediaPipe landmarks are normalized to the *video frame* (0..1, un-mirrored).
   What the player sees is that frame shown with `object-fit: cover` inside
   the stage box (so the frame is scaled to fill it and the overflow is
   cropped) and, for the front camera, mirrored. Everything that must line
   up with the picture — the HUD, keyboard, harp strings, neck, the finger
   cursor — therefore works in STAGE coordinates: 0..1 across the visible
   stage box, exactly what is on screen.

       video-normalized (x,y)
            │  mirror (front camera):  x → 1 − x
            │  cover-crop:             scale = max(W/vw, H/vh), centred
            ▼
       stage-normalized (sx,sy)  →  ×(W,H) = CSS pixels inside the stage

   Pure functions, no DOM: the `Geometry` object is refreshed by the caller
   whenever the video size, stage size, camera or mirroring changes.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

/**
 * @typedef {Object} Geometry
 * @property {number} vw video frame width (px)
 * @property {number} vh video frame height (px)
 * @property {number} W stage width (CSS px)
 * @property {number} H stage height (CSS px)
 * @property {boolean} mirrored
 */

export function makeGeometry(vw, vh, W, H, mirrored) {
  return { vw: vw || 640, vh: vh || 480, W: W || 640, H: H || 480, mirrored: !!mirrored };
}

function cover(g) {
  const scale = Math.max(g.W / g.vw, g.H / g.vh);
  const dispW = g.vw * scale;
  const dispH = g.vh * scale;
  return { dispW, dispH, offX: (g.W - dispW) / 2, offY: (g.H - dispH) / 2 };
}

/** Video-normalized landmark → stage-normalized point (0..1 of the visible stage; may fall outside 0..1 if cropped away). */
export function videoToStage(g, x, y) {
  const c = cover(g);
  const dx = g.mirrored ? 1 - x : x;
  return { x: (c.offX + dx * c.dispW) / g.W, y: (c.offY + y * c.dispH) / g.H };
}

/** Inverse of videoToStage. */
export function stageToVideo(g, sx, sy) {
  const c = cover(g);
  const dx = (sx * g.W - c.offX) / c.dispW;
  return { x: g.mirrored ? 1 - dx : dx, y: (sy * g.H - c.offY) / c.dispH };
}

/** Is a stage-normalized point inside the visible stage? */
export function insideStage(p, margin = 0) {
  return p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;
}

/**
 * Convert a hand length measured in video-normalized units (HandControls'
 * calibration reference) to STAGE WIDTHS, for this camera + crop. The video
 * is scaled uniformly, so the geometric mean of the two axes is the honest
 * conversion for a measurement that mixes x and y.
 */
export function handLengthStageWidths(g, refSize) {
  const c = cover(g);
  return (refSize * Math.sqrt(c.dispW * c.dispH)) / g.W;
}
