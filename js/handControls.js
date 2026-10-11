/* ==========================================================================
   handControls.js — turn raw hand landmarks into musical control values
   v0.3: adds finger-based fine pitch, hand-size adaptive sensitivity, and
   feeds the vibrato detector, on top of v0.2's calibrated relative
   mapping. See DEVELOPER_NOTES.md, "Fine pitch, adaptive sensitivity, and
   vibrato (v0.3)" for the full design write-up.

   Right hand: palm X (coarse) + thumb/index shape (fine) -> pitch (0..1)
   Left hand:  palm Y, relative to a calibrated center     -> volume (0..1)
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { VibratoDetector } from './vibrato.js';
import { OneEuroFilter } from './smoothing.js';

// Landmarks averaged into a stable "palm center": wrist + the three
// knuckles that don't move much when fingers curl (index/middle/pinky MCP).
/** Whether MediaPipe's label for a RAW (un-mirrored) frame must be inverted to get the anatomical side. Independent of display mirroring. */
export const HANDEDNESS_LABEL_FLIP = false;

const PALM_LANDMARK_INDICES = [0, 5, 9, 17];

// Wrist and middle-finger MCP: a stable two-point "palm length" used as a
// hand-size estimate, for adaptive sensitivity and for normalizing the
// fine-pitch finger feature so it doesn't drift with camera distance.
const WRIST_INDEX = 0;
const MIDDLE_MCP_INDEX = 9;
const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;

// Natural raised-hand defaults (display-space, 0..1) used until the player
// calibrates. Roughly "right hand out to the right, left hand out to the
// left, both at a comfortable mid height" — close enough that the
// instrument is playable immediately, per "don't break existing behavior".
const DEFAULT_RIGHT_CENTER = { x: 0.62, y: 0.52 };
const DEFAULT_LEFT_CENTER = { x: 0.38, y: 0.52 };

// Half-width/half-height of the control zone around each calibrated
// center, in normalized display-space units, at sensitivity = 1 and
// adaptive scale = 1. This is the "small range around the natural
// position" from the spec, not the whole frame.
const BASE_RANGE_X = 0.16; // pitch (right hand, horizontal)
const BASE_RANGE_Y = 0.18; // volume (left hand, vertical)

// Movement smaller than this (in the same normalized units, before the
// sensitivity/range scaling) is treated as zero. Absorbs webcam-tracking
// jitter around a held position without needing to hold unnaturally still.
const DEAD_ZONE = 0.018;

// Response curve exponent for pitch: >1 means fine changes near the
// calibrated center and progressively larger changes toward the edge of
// the control zone (see DEVELOPER_NOTES.md for the reasoning).
const PITCH_CURVE_EXPONENT = 2.0;

// Volume at the calibrated center position, before any up/down movement.
// Moving up ramps toward 1.0; moving down ramps toward 0.0.
const VOLUME_BASELINE = 0.6;

// -- Finger-based fine pitch (Priority 6) ------------------------------------
// "Ratio" = thumb-tip-to-index-tip distance divided by hand size, so it
// tracks hand *shape* (pinched vs. spread) independent of hand position and
// roughly independent of distance from the camera.
const FINE_SMOOTHING = 0.4; // lighter than palm smoothing — a pinch is a fast, deliberate gesture
const FINE_DEAD_ZONE = 0.03; // ratio units
const FINE_RANGE = 0.5; // ratio units from rest to "full fine swing"
const FINE_PITCH_WEIGHT = 0.05; // max fine contribution, in pitch01 units (±)
// build 008 stability pipeline (see the pitch-pipeline note in DEVELOPER_NOTES.md):
//   coarse  = One Euro filtered palm X (steady at rest, quick when moving)
//   fine    = slew-limited, and faded out while the coarse hand is moving fast
const EURO_BETA = 5; // how fast the palm filter opens up with speed
const FINE_SLEW_PER_SEC = 2.5; // max change of the fine offset (−1..1 units) per second
const FINE_FADE_SPEED = 0.6; // coarse speed (normalized x / s) at which fine control is nearly off
const VIBRATO_FEED_ALPHA = 0.35; // light smoothing for the vibrato analyzer only

// -- Hand-size adaptive sensitivity (Priority 7) -----------------------------
const HAND_SIZE_SMOOTHING = 0.85; // heavy — zone size shouldn't visibly flicker
const ADAPTIVE_MIN_SCALE = 0.6;
const ADAPTIVE_MAX_SCALE = 1.8;

// -- Relative hand depth (v0.4, improved in v0.5) -----------------------------
// Combines two independent signals so depth is both stronger and more
// responsive than hand-size alone: (1) the same hand-size-vs-calibrated
// ratio adaptive sensitivity already computes (bigger apparent hand =
// closer), and (2) the raw change in MediaPipe's landmark z since
// calibration (smaller z = closer to the camera, per MediaPipe's own
// convention). Depth gets its own, lighter smoothing than the zone-sizing
// use of hand-size, since "keep smoothing low enough that depth remains
// responsive" was an explicit requirement — see DEVELOPER_NOTES.md,
// "Improved relative hand depth (v0.5)" for the full reasoning and how
// these constants were chosen.
const DEPTH_SMOOTHING = 0.6;
const DEPTH_GAIN = 1.4; // 0.5 * 1.4 = 0.7 per unit of size change: same slope as v0.4 for size alone; z adds on top
const DEPTH_Z_NORMALIZATION = 0.12; // typical z swing for a deliberate forward/back reach

export class HandControls {
  /**
   * @param {Object} [options]
   * @param {number} [options.smoothing] 0..1, higher = smoother but more
   *   laggy. Applied as an exponential moving average per hand per frame.
   * @param {number} [options.missingHandTimeoutMs] How long a hand can be
   *   briefly lost (tracking flicker) before we treat it as gone.
   */
  constructor(options = {}) {
    this.smoothing = options.smoothing ?? 0.55;
    this.missingHandTimeoutMs = options.missingHandTimeoutMs ?? 250;

    /** Whether the current camera stream is displayed mirrored (front camera). */
    this.isMirrored = true;
    /** Manual override for handedness, for devices/browsers that report it
     *  backwards. Toggled by the "swap hands" control in the UI. */
    this.swapHands = false;
    /** Per-frame hand-side diagnostics (DIAGNOSTIC ONLY — nothing reads this to make decisions). See handDiagnostics.js. */
    this.lastDiagnostics = [];

    /** 0.5x .. 2.5x — higher means a smaller physical movement reaches the
     *  edge of the control zone. Adjustable via the Sensitivity slider. */
    this.sensitivity = 1.0;

    this.rightCenter = { ...DEFAULT_RIGHT_CENTER };
    this.leftCenter = { ...DEFAULT_LEFT_CENTER };
    /** True once the player has calibrated at least once; false means the
     *  app is still using the built-in default centers. */
    this.isCalibrated = false;

    /** Ratio (thumb-index distance / hand size) at calibration time — the
     *  fine-pitch "zero point". Null until calibrated with a visible right
     *  hand, in which case fine pitch contributes nothing (rather than an
     *  arbitrary, unearned offset). */
    this.rightFineRestRatio = null;

    /** v0.6: the pinch-based fine pitch is meant for continuous playing. Discrete
     *  instruments switch it off, because curling a finger to pluck would
     *  otherwise nudge the note being selected. */
    this.fineEnabled = true;

    /** Hand-size (wrist-to-middle-MCP distance) at calibration time, per
     *  hand — the adaptive-sensitivity reference. Null means "no adaptive
     *  scaling yet" (scale stays 1x) until calibrated. */
    this.rightReferenceHandSize = null;
    this.leftReferenceHandSize = null;

    /** Palm landmark z at calibration time, per hand — the second signal
     *  feeding relative depth (v0.5). Null until calibrated. */
    this.rightReferenceZ = null;
    this.leftReferenceZ = null;

    this._smoothedX = { left: null, right: null };
    this._smoothedY = { left: null, right: null };
    this._smoothedHandSize = { left: null, right: null };
    this._smoothedDepthZ = { left: null, right: null };
    this._smoothedFineRatio = { right: null };
    this._lastSeenAt = { left: 0, right: 0 };
    /** Most recent smoothed display-space position/hand-size/fine-ratio per
     *  hand, kept around purely so calibrate() can capture "wherever the
     *  hands are right now". */
    this._lastPositions = { left: null, right: null };
    this._lastHandSize = { left: null, right: null };
    this._lastDepthZ = { left: null, right: null };
    this._lastFineRatio = { right: null };
    /** Raw MediaPipe landmark arrays for whichever hand currently occupies
     *  each resolved side, for consumers (the trigger system) that need
     *  finger geometry rather than the palm-center abstraction above. Not
     *  held through the missing-hand grace period — a stale landmark array
     *  isn't a useful stand-in the way a held position/size value is. */
    this._lastLandmarks = { left: null, right: null };

    this._vibrato = new VibratoDetector();
    this._euro = { x: { left: null, right: null }, y: { left: null, right: null } };
    this._vibX = null;
    this._fineSlewValue = 0;
    this._fineSlewAt = 0;
    /** Coarse right-hand speed (normalized display x per second), for fine-pitch fading and diagnostics. */
    this.rightSpeed = 0;
  }

  _euroFilter(axis, side) {
    if (!this._euro[axis][side]) {
      const minCutoff = 0.6 + (1 - this.smoothing) * 2.4;
      this._euro[axis][side] = new OneEuroFilter({ minCutoff, beta: EURO_BETA, dCutoff: 1.0 });
    }
    return this._euro[axis][side];
  }

  /**
   * @param {ReturnType<import('./handTracking.js').HandTracker['detect']>} result
   * @returns {{
   *   pitch01: number|null, volume01: number|null,
   *   right: {x:number,y:number}|null, left: {x:number,y:number}|null,
   *   rightOffset: number|null, leftOffset: number|null,
   *   rightOffsetY: number|null, leftOffsetX: number|null,
   *   vibrato: {active: boolean, rateHz: number, depth01: number},
   *   fineOffset: number|null, rightDepth01: number, leftDepth01: number,
   *   rightLandmarks: Array|null, leftLandmarks: Array|null
   * }}
   *   rightOffset/leftOffset are the linear (pre-curve), zone-relative
   *   positions in -1..1, meant for drawing the UI cursor inside its zone
   *   box — not for audio, which uses the curved pitch01/volume01 instead.
   *   rightOffsetY/leftOffsetX are the same idea on the *other* axis of
   *   each hand — never used by the core pitch/volume path, only exposed
   *   for the generic trigger system (see triggers.js) so "Right Hand Y"
   *   and "Left Hand X" are available as assignable triggers.
   *   fineOffset is the finger-shape contribution alone, in -1..1, for a
   *   subtle UI cue; it's already folded into pitch01.
   *   rightLandmarks/leftLandmarks are the raw MediaPipe landmark arrays
   *   for whichever detected hand resolved to that side this frame (or
   *   null), for consumers that need finger geometry rather than the
   *   palm-center abstraction above.
   */
  process(result) {
    const now = performance.now();
    const positions = { left: null, right: null };
    const handSizes = { left: null, right: null };
    const depthZs = { left: null, right: null };
    const landmarksBySide = { left: null, right: null };
    let fineRatioRaw = null;
    const diagnostics = [];

    if (result && result.landmarks && result.handednesses) {
      for (let i = 0; i < result.landmarks.length; i++) {
        const landmarks = result.landmarks[i];
        const handedness = result.handednesses[i]?.[0]?.categoryName; // "Left" | "Right"
        const side = this._resolveSide(handedness);
        const rawForDiag = this._palmCenter(landmarks);
        diagnostics.push({
          index: i,
          rawLabel: handedness ?? null,
          rawScore: result.handednesses[i]?.[0]?.score ?? null,
          rawWristX: landmarks[0].x,
          rawPalmX: rawForDiag.x,
          rawPalmY: rawForDiag.y,
          displayX: this.isMirrored ? 1 - rawForDiag.x : rawForDiag.x,
          resolved: side,
          isMirrored: this.isMirrored,
          swapHands: this.swapHands,
        });
        if (!side) continue;

        const raw = this._palmCenter(landmarks);
        const displayX = this.isMirrored ? 1 - raw.x : raw.x;
        const displayY = raw.y;

        const smoothedX = this._euroFilter('x', side).filter(displayX, now);
        const smoothedY = this._euroFilter('y', side).filter(displayY, now);
        this._smoothedX[side] = smoothedX;
        this._smoothedY[side] = smoothedY;
        if (side === 'right') {
          this.rightSpeed = Math.abs(this._euro.x.right._dx);
          this._vibX = this._vibX === null ? displayX : this._vibX + (displayX - this._vibX) * VIBRATO_FEED_ALPHA;
        }
        positions[side] = { x: smoothedX, y: smoothedY };
        landmarksBySide[side] = landmarks;

        const handSize = this._handSize(landmarks);
        handSizes[side] = this._smooth('_smoothedHandSize', side, handSize, HAND_SIZE_SMOOTHING);
        depthZs[side] = this._smooth('_smoothedDepthZ', side, this._palmZ(landmarks), DEPTH_SMOOTHING);

        if (side === 'right') {
          fineRatioRaw = handSize > 0.0001 ? this._thumbIndexDistance(landmarks) / handSize : null;
        }

        this._lastSeenAt[side] = now;
      }
    }

    this.lastDiagnostics = diagnostics;

    // Treat a briefly-lost hand as still present for a short grace period,
    // so tracking flicker doesn't cause audio to stutter on/off.
    for (const side of ['left', 'right']) {
      if (!positions[side] && now - this._lastSeenAt[side] < this.missingHandTimeoutMs) {
        const x = this._smoothedX[side];
        const y = this._smoothedY[side];
        if (x !== null && y !== null) positions[side] = { x, y };
        if (this._smoothedHandSize[side] !== null) handSizes[side] = this._smoothedHandSize[side];
        if (this._smoothedDepthZ[side] !== null) depthZs[side] = this._smoothedDepthZ[side];
      }
      if (!positions[side]) {
        this._smoothedX[side] = null;
        this._smoothedY[side] = null;
        // Start fresh on return: no filter memory dragging the pitch from its old spot.
        this._euro.x[side]?.reset();
        this._euro.y[side]?.reset();
        if (side === 'right') { this._vibX = null; this.rightSpeed = 0; }
      }
    }

    this._lastPositions = positions;
    this._lastHandSize = handSizes;
    this._lastDepthZ = depthZs;
    this._lastLandmarks = landmarksBySide;

    const { rangeX, rangeY } = this._effectiveRanges(handSizes);

    let pitch01 = null;
    let rightOffset = null;
    let rightOffsetY = null;
    let fineOffset = null;

    if (positions.right) {
      rightOffset = this._linearOffset(positions.right.x - this.rightCenter.x, rangeX, DEAD_ZONE);
      // Secondary axis, for the generic trigger system only (see triggers.js)
      // — the core pitch path below only ever uses the X offset above.
      rightOffsetY = this._linearOffset(this.rightCenter.y - positions.right.y, rangeY, DEAD_ZONE);
      const curved = this._applyCurve(rightOffset, PITCH_CURVE_EXPONENT);
      let coarsePitch = 0.5 + curved * 0.5;

      if (fineRatioRaw !== null) {
        const smoothedRatio = this._smooth('_smoothedFineRatio', 'right', fineRatioRaw, FINE_SMOOTHING);
        this._lastFineRatio.right = smoothedRatio;
        if (this.rightFineRestRatio !== null && this.fineEnabled) {
          const rawFine = this._linearOffset(smoothedRatio - this.rightFineRestRatio, FINE_RANGE, FINE_DEAD_ZONE);
          // Slew-limit so a tracking glitch on the fingers can never make a pitch jump…
          const dtF = this._fineSlewAt ? Math.min(0.1, (now - this._fineSlewAt) / 1000) : 0;
          this._fineSlewAt = now;
          const maxStep = FINE_SLEW_PER_SEC * dtF;
          this._fineSlewValue += Math.max(-maxStep, Math.min(maxStep, rawFine - this._fineSlewValue));
          // …and back off while the whole hand is travelling, so coarse and fine don't fight.
          const still = 1 - Math.min(1, this.rightSpeed / FINE_FADE_SPEED) * 0.85;
          fineOffset = this._fineSlewValue * still;
          coarsePitch += fineOffset * FINE_PITCH_WEIGHT;
        }
      }

      pitch01 = clamp01(coarsePitch);
      this._vibrato.push(this._vibX ?? positions.right.x, now);
    } else {
      this._vibrato.reset();
    }

    let volume01 = null;
    let leftOffset = null;
    let leftOffsetX = null;
    if (positions.left) {
      // Up is positive: the calibrated center is the "neutral" height, and
      // display-space y grows downward, so we flip the sign here.
      leftOffset = this._linearOffset(this.leftCenter.y - positions.left.y, rangeY, DEAD_ZONE);
      // Secondary axis, for the generic trigger system only — the core
      // volume path below only ever uses the Y offset above.
      leftOffsetX = this._linearOffset(positions.left.x - this.leftCenter.x, rangeX, DEAD_ZONE);
      const curved = this._applyCurve(leftOffset, 1.0); // linear response for volume
      volume01 =
        curved >= 0
          ? VOLUME_BASELINE + curved * (1 - VOLUME_BASELINE)
          : VOLUME_BASELINE + curved * VOLUME_BASELINE;
      volume01 = clamp01(volume01);
    }

    const vibrato = this._vibrato.analyze();

    // Relative depth per hand: how much bigger/closer each hand looks now
    // versus at calibration time, combining the hand-size ratio with the
    // change in landmark z (see the constant comments above). Deliberately
    // NOT physical distance — see DEVELOPER_NOTES.md.
    const rightDepth01 = this._computeDepth01(
      handSizes.right,
      this.rightReferenceHandSize,
      depthZs.right,
      this.rightReferenceZ
    );
    const leftDepth01 = this._computeDepth01(
      handSizes.left,
      this.leftReferenceHandSize,
      depthZs.left,
      this.leftReferenceZ
    );

    return {
      pitch01,
      volume01,
      right: positions.right,
      left: positions.left,
      rightOffset,
      leftOffset,
      rightOffsetY,
      leftOffsetX,
      fineOffset,
      vibrato,
      rightDepth01,
      leftDepth01,
      rightLandmarks: landmarksBySide.right,
      leftLandmarks: landmarksBySide.left,
    };
  }

  /**
   * Capture the current (smoothed) hand positions/hand-sizes/finger-ratio
   * as the new calibration baseline. Call this from the "Calibrate" button
   * while both hands are held in their natural playing position.
   * @returns {{success: boolean, right: boolean, left: boolean}}
   */
  calibrate() {
    const gotRight = !!this._lastPositions.right;
    const gotLeft = !!this._lastPositions.left;

    if (gotRight) {
      this.rightCenter = { ...this._lastPositions.right };
      if (this._lastHandSize.right) this.rightReferenceHandSize = this._lastHandSize.right;
      if (this._lastDepthZ.right !== null) this.rightReferenceZ = this._lastDepthZ.right;
      if (this._lastFineRatio.right !== null) this.rightFineRestRatio = this._lastFineRatio.right;
    }
    if (gotLeft) {
      this.leftCenter = { ...this._lastPositions.left };
      if (this._lastHandSize.left) this.leftReferenceHandSize = this._lastHandSize.left;
      if (this._lastDepthZ.left !== null) this.leftReferenceZ = this._lastDepthZ.left;
    }
    if (gotRight && gotLeft) this.isCalibrated = true;

    return { success: gotRight && gotLeft, right: gotRight, left: gotLeft };
  }

  /**
   * Hand size (wrist → middle knuckle, in video-normalized units) captured at
   * calibration — the mean of whichever hands were calibrated — or null when
   * the player hasn't calibrated. Used to size the keyboard to a real hand.
   */
  referenceHandSize() {
    const v = [this.rightReferenceHandSize, this.leftReferenceHandSize].filter((x) => x && x > 0.01);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  /** Back to the built-in default centers (e.g. after switching cameras,
   *  since front/rear coordinate spaces aren't comparable). */
  resetCalibration() {
    this.rightCenter = { ...DEFAULT_RIGHT_CENTER };
    this.leftCenter = { ...DEFAULT_LEFT_CENTER };
    this.rightFineRestRatio = null;
    this.rightReferenceHandSize = null;
    this.leftReferenceHandSize = null;
    this.rightReferenceZ = null;
    this.leftReferenceZ = null;
    this.isCalibrated = false;
  }

  setSensitivity(value) {
    this.sensitivity = Math.min(2.5, Math.max(0.5, value));
  }

  /** Current zone half-extents in normalized display-space units, for the
   *  UI to size the on-screen control-zone boxes — kept in sync with what
   *  process() actually used, including adaptive scaling. */
  getZoneRanges() {
    return this._effectiveRanges(this._lastHandSize);
  }

  /** Clears tracking/smoothing state (e.g. on stop or camera switch), but
   *  deliberately keeps calibration — stopping and restarting shouldn't
   *  force the player to recalibrate. */
  reset() {
    this._smoothedX = { left: null, right: null };
    this._smoothedY = { left: null, right: null };
    this._smoothedHandSize = { left: null, right: null };
    this._smoothedDepthZ = { left: null, right: null };
    this._smoothedFineRatio = { right: null };
    this._lastSeenAt = { left: 0, right: 0 };
    this._lastPositions = { left: null, right: null };
    this._lastHandSize = { left: null, right: null };
    this._lastDepthZ = { left: null, right: null };
    this._lastFineRatio = { right: null };
    this._lastLandmarks = { left: null, right: null };
    this.lastDiagnostics = [];
    this._vibrato.reset();
    this._euro = { x: { left: null, right: null }, y: { left: null, right: null } };
    this._vibX = null;
    this._fineSlewValue = 0;
    this._fineSlewAt = 0;
    this.rightSpeed = 0;
  }

  /**
   * MediaPipe handedness label → ANATOMICAL side ('left' = the performer's own left hand).
   *
   * Two things must never be mixed up:
   *   - DISPLAY mirroring (CSS scaleX(-1) + `displayX = 1 − x`): purely how the picture is SHOWN.
   *   - HANDEDNESS: which anatomical hand the model says it is. It depends on the image fed to the
   *     model, which is always the RAW camera frame (front and rear alike) — NOT on how it is displayed.
   *
   * Build 010–012 flipped the label whenever the display was mirrored (front camera), which made the
   * performer's left hand arrive as `right` (Rudra Veena fretting/plucking swapped, and the same for every
   * two-handed instrument). The label is now used as reported, for both cameras.
   * If a future MediaPipe build reports the opposite convention for raw frames, change
   * HANDEDNESS_LABEL_FLIP below — one constant, independent of mirroring and of `swapHands`.
   *
   * `swapHands` stays a purely manual user override on top.
   */
  _resolveSide(categoryName) {
    if (categoryName !== 'Left' && categoryName !== 'Right') return null;
    let isRight = categoryName === 'Right';
    if (HANDEDNESS_LABEL_FLIP) isRight = !isRight;
    if (this.swapHands) isRight = !isRight;
    return isRight ? 'right' : 'left';
  }

  _palmCenter(landmarks) {
    let x = 0;
    let y = 0;
    for (const idx of PALM_LANDMARK_INDICES) {
      x += landmarks[idx].x;
      y += landmarks[idx].y;
    }
    const n = PALM_LANDMARK_INDICES.length;
    return { x: x / n, y: y / n };
  }

  _handSize(landmarks) {
    return this._distance(landmarks[WRIST_INDEX], landmarks[MIDDLE_MCP_INDEX]);
  }

  /** Average landmark z across the same stable palm points used elsewhere.
   *  MediaPipe's convention: smaller z = closer to the camera. */
  _palmZ(landmarks) {
    let z = 0;
    for (const idx of PALM_LANDMARK_INDICES) z += landmarks[idx].z;
    return z / PALM_LANDMARK_INDICES.length;
  }

  /**
   * Combine the hand-size ratio and the landmark-z change into one 0..1
   * depth value. Returns neutral (0.5) whenever there's no calibrated
   * reference yet, exactly like the size-only version did in v0.4.
   */
  _computeDepth01(currentSize, referenceSize, currentZ, referenceZ) {
    if (!referenceSize || !currentSize || referenceZ === null || currentZ === null) return 0.5;
    const sizeComponent = this._adaptiveScale(currentSize, referenceSize) - 1; // roughly -0.4..+0.8
    const zDelta = referenceZ - currentZ; // positive = closer than at calibration
    const zComponent = Math.min(1.5, Math.max(-1.5, zDelta / DEPTH_Z_NORMALIZATION));
    return clamp01(0.5 + (sizeComponent + zComponent) * DEPTH_GAIN * 0.5);
  }

  _thumbIndexDistance(landmarks) {
    return this._distance(landmarks[THUMB_TIP_INDEX], landmarks[INDEX_TIP_INDEX]);
  }

  _distance(a, b) {
    // 2D only: z from MediaPipe's world-less image landmarks is a rougher,
    // less consistently-scaled estimate across devices than x/y, so it's
    // left out rather than adding noise to a value used for calibration.
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * @param {{left: number|null, right: number|null}} handSizes Latest
   *   smoothed hand-size estimates, used to scale the range adaptively.
   */
  _effectiveRanges(handSizes) {
    const rightScale = this._adaptiveScale(handSizes.right, this.rightReferenceHandSize);
    const leftScale = this._adaptiveScale(handSizes.left, this.leftReferenceHandSize);
    return {
      rangeX: (BASE_RANGE_X * rightScale) / this.sensitivity,
      rangeY: (BASE_RANGE_Y * leftScale) / this.sensitivity,
    };
  }

  /**
   * A hand that looks bigger than it did at calibration time is closer to
   * the camera, which makes the same physical hand movement cover a larger
   * fraction of the frame. Scaling the control range up to match keeps the
   * *physical* movement needed to sweep the full range roughly constant
   * regardless of how close/far the player is standing.
   */
  _adaptiveScale(currentSize, referenceSize) {
    if (!currentSize || !referenceSize || referenceSize < 0.0001) return 1;
    const scale = currentSize / referenceSize;
    return Math.min(ADAPTIVE_MAX_SCALE, Math.max(ADAPTIVE_MIN_SCALE, scale));
  }

  _smooth(store, side, value, alpha) {
    const prev = this[store][side];
    const next = prev === null || prev === undefined ? value : prev + (value - prev) * (1 - alpha);
    this[store][side] = next;
    return next;
  }

  /**
   * Dead-zoned, range-normalized offset from a reference point, in -1..1.
   * Values inside `deadZone` collapse to exactly 0; the remaining travel
   * out to `range` is rescaled to fill 0..1 smoothly (no jump at the
   * boundary).
   */
  _linearOffset(rawOffset, range, deadZone) {
    const sign = Math.sign(rawOffset);
    const magnitude = Math.abs(rawOffset);
    if (magnitude < deadZone) return 0;
    const usableRange = Math.max(0.0001, range - deadZone);
    const t = Math.min(1, (magnitude - deadZone) / usableRange);
    return sign * t;
  }

  /** Apply the "fine near center, coarse near the edge" response curve. */
  _applyCurve(linearOffset01, exponent) {
    const sign = Math.sign(linearOffset01);
    const magnitude = Math.abs(linearOffset01);
    return sign * Math.pow(magnitude, exponent);
  }
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
