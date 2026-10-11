/* ==========================================================================
   triggers.js — the 25-trigger BODY INPUT layer

   Turns raw hand/face detection into a flat set of named, continuous
   0..1 (or, for head rotation, -1..1) values. Knows nothing about audio or
   what any trigger is mapped to — see mapping.js for TRIGGER → PARAMETER.
   Per-trigger smoothing intentionally does NOT live here: the brief's own
   architecture puts "Smoothing" as a per-mapping setting (mapping.js), so
   triggers stay as instantaneous/responsive as the underlying detection
   allows, and the same trigger can be smoothed differently for two
   different destinations.

   See DEVELOPER_NOTES.md, "The trigger layer (v0.5)" for the full design
   write-up, including the finger-curl geometry and head-rotation caveats.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

// -- Trigger catalog ----------------------------------------------------------

function handTriggerDefs(side, label) {
  return [
    { id: `${side}HandX`, label: `${label} Hand X`, group: `${label} Hand` },
    { id: `${side}HandY`, label: `${label} Hand Y`, group: `${label} Hand` },
    { id: `${side}HandDepth`, label: `${label} Hand Depth`, group: `${label} Hand` },
    { id: `${side}Thumb`, label: `${label} Thumb`, group: `${label} Hand` },
    { id: `${side}Index`, label: `${label} Index`, group: `${label} Hand` },
    { id: `${side}Middle`, label: `${label} Middle`, group: `${label} Hand` },
    { id: `${side}Ring`, label: `${label} Ring`, group: `${label} Hand` },
    { id: `${side}Pinky`, label: `${label} Pinky`, group: `${label} Hand` },
  ];
}

export const TRIGGER_DEFS = [
  ...handTriggerDefs('right', 'Right'),
  ...handTriggerDefs('left', 'Left'),
  { id: 'mouthOpen', label: 'Mouth Open', group: 'Face' },
  { id: 'smile', label: 'Smile', group: 'Face' },
  { id: 'leftEye', label: 'Left Eye', group: 'Face' },
  { id: 'rightEye', label: 'Right Eye', group: 'Face' },
  { id: 'leftEyebrow', label: 'Left Eyebrow', group: 'Face' },
  { id: 'rightEyebrow', label: 'Right Eyebrow', group: 'Face' },
  // Signed (-1..1): rotation is inherently bidirectional, unlike every
  // other trigger here, which is a one-directional "how much" quantity.
  { id: 'headYaw', label: 'Head Yaw', group: 'Face', signed: true },
  { id: 'headPitch', label: 'Head Pitch', group: 'Face', signed: true },
  { id: 'headRoll', label: 'Head Roll', group: 'Face', signed: true },
];

export const TRIGGER_GROUPS = ['Right Hand', 'Left Hand', 'Face'];

export function triggerLabel(id) {
  return TRIGGER_DEFS.find((t) => t.id === id)?.label ?? id;
}

// -- Finger curl geometry ------------------------------------------------------
// 0.0 = fully extended, 1.0 = strongly bent (a closed fist reads as ~1 on
// every finger). Four-finger estimate: how far the fingertip sits from the
// wrist, relative to how far its own knuckle (MCP) sits from the wrist —
// extended fingers push the tip much farther out than the knuckle; curled
// fingers fold the tip back toward (or past) the knuckle. The thumb doesn't
// fold toward the wrist the same way, so it uses a separate estimate: its
// tip's distance from the index knuckle, normalized by hand size (extended
// = thumb held away from the palm; curled = tucked in close).
//
// EXT_RATIO/CURL_RATIO below are empirical starting points, not derived
// from a dataset — the first constants to retune after on-device testing
// if curl feels off for a given hand size or camera angle.
const FOUR_FINGER_DEFS = {
  index: { mcp: 5, tip: 8 },
  middle: { mcp: 9, tip: 12 },
  ring: { mcp: 13, tip: 16 },
  pinky: { mcp: 17, tip: 20 },
};
const FOUR_FINGER_EXT_RATIO = 1.7;
const FOUR_FINGER_CURL_RATIO = 0.9;
const THUMB_EXT_RATIO = 0.6;
const THUMB_CURL_RATIO = 0.15;

/**
 * @param {Array<{x:number,y:number,z:number}>} landmarks Raw 21-point
 *   MediaPipe hand landmarks (from HandControls's process() output —
 *   `rightLandmarks`/`leftLandmarks`).
 * @returns {{thumb:number, index:number, middle:number, ring:number, pinky:number}}
 */
export function computeFingerCurls(landmarks) {
  const wrist = landmarks[0];
  const result = {};

  for (const [name, { mcp, tip }] of Object.entries(FOUR_FINGER_DEFS)) {
    const mcpDist = distance2D(landmarks[mcp], wrist);
    const tipDist = distance2D(landmarks[tip], wrist);
    const ratio = mcpDist > 0.0001 ? tipDist / mcpDist : FOUR_FINGER_EXT_RATIO;
    result[name] = ratioToCurl(ratio, FOUR_FINGER_EXT_RATIO, FOUR_FINGER_CURL_RATIO);
  }

  const handSize = distance2D(landmarks[0], landmarks[9]);
  const thumbRatio = handSize > 0.0001 ? distance2D(landmarks[4], landmarks[5]) / handSize : THUMB_EXT_RATIO;
  result.thumb = ratioToCurl(thumbRatio, THUMB_EXT_RATIO, THUMB_CURL_RATIO);

  return result;
}

function ratioToCurl(ratio, extRatio, curlRatio) {
  return clamp01((extRatio - ratio) / (extRatio - curlRatio));
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// -- Head rotation from the face transformation matrix -------------------------
// BEST-EFFORT: extracted assuming MediaPipe's FacialTransformationMatrix
// `.data` is a column-major 4x4 (the common WebGL/OpenGL convention used
// throughout MediaPipe's C++/Web stack). This has not been verified against
// a live camera in this environment — if yaw/pitch/roll come out swapped or
// inverted on-device, that's a matrix-index or sign issue to fix here, not
// a deeper architectural problem. See DEVELOPER_NOTES.md.
const HEAD_ANGLE_NORMALIZATION_RAD = 0.9; // ~52°, treated as "full deflection"

/**
 * @param {Float32Array|number[]} m 16-element column-major 4x4 matrix.
 * @returns {{yaw:number, pitch:number, roll:number}} Each -1..1.
 */
export function decomposeHeadRotation(m) {
  const yaw = Math.atan2(m[8], m[10]);
  const pitch = Math.atan2(-m[9], Math.hypot(m[8], m[10]));
  const roll = Math.atan2(m[1], m[0]);
  return {
    yaw: clampSigned(yaw / HEAD_ANGLE_NORMALIZATION_RAD),
    pitch: clampSigned(pitch / HEAD_ANGLE_NORMALIZATION_RAD),
    roll: clampSigned(roll / HEAD_ANGLE_NORMALIZATION_RAD),
  };
}

// -- Face blendshape lookup -----------------------------------------------------
// "Left"/"Right" in MediaPipe's blendshape names are anatomical (the
// subject's own left/right), unlike the hand-mirroring correction applied
// elsewhere in this app — face mirroring is not corrected for in this pass
// (see DEVELOPER_NOTES.md, "Known limitations").
function blendshapeScore(categories, name) {
  if (!categories) return 0;
  const found = categories.find((c) => c.categoryName === name);
  return found ? found.score : 0;
}

/**
 * Converts a raw MediaPipe FaceLandmarker result for one frame into the
 * nine face/head trigger values.
 * @param {{faceBlendshapes?: Array, facialTransformationMatrixes?: Array}|null} faceResult
 */
function faceTriggerValues(faceResult) {
  const categories = faceResult?.faceBlendshapes?.[0]?.categories ?? null;
  const matrix = faceResult?.facialTransformationMatrixes?.[0]?.data ?? null;

  const mouthOpen = blendshapeScore(categories, 'jawOpen');
  const smile =
    (blendshapeScore(categories, 'mouthSmileLeft') + blendshapeScore(categories, 'mouthSmileRight')) / 2;
  const leftEye = blendshapeScore(categories, 'eyeBlinkLeft');
  const rightEye = blendshapeScore(categories, 'eyeBlinkRight');
  const leftEyebrow = blendshapeScore(categories, 'browOuterUpLeft');
  const rightEyebrow = blendshapeScore(categories, 'browOuterUpRight');
  const head = matrix ? decomposeHeadRotation(matrix) : { yaw: 0, pitch: 0, roll: 0 };

  return { mouthOpen, smile, leftEye, rightEye, leftEyebrow, rightEyebrow, ...head };
}

// -- The engine ------------------------------------------------------------------

export class TriggerEngine {
  /**
   * @param {import('./handControls.js').HandControls['process']} extends this;
   *   call once per frame with that frame's outputs.
   * @param {ReturnType<import('./handControls.js').HandControls['process']>} handOut
   * @param {{faceBlendshapes?: Array, facialTransformationMatrixes?: Array}|null} faceResult
   * @returns {Object<string, {raw: number, value01: number}>}
   */
  process(handOut, faceResult) {
    const values = {};

    setUnsigned(values, 'rightHandX', unsignedFromOffset(handOut.rightOffset));
    setUnsigned(values, 'rightHandY', unsignedFromOffset(handOut.rightOffsetY));
    setUnsigned(values, 'rightHandDepth', handOut.rightDepth01);
    setUnsigned(values, 'leftHandX', unsignedFromOffset(handOut.leftOffsetX));
    setUnsigned(values, 'leftHandY', unsignedFromOffset(handOut.leftOffset));
    setUnsigned(values, 'leftHandDepth', handOut.leftDepth01);

    const rightCurls = handOut.rightLandmarks ? computeFingerCurls(handOut.rightLandmarks) : null;
    const leftCurls = handOut.leftLandmarks ? computeFingerCurls(handOut.leftLandmarks) : null;
    for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
      setUnsigned(values, `right${capitalize(finger)}`, rightCurls ? rightCurls[finger] : 0);
      setUnsigned(values, `left${capitalize(finger)}`, leftCurls ? leftCurls[finger] : 0);
    }

    const face = faceTriggerValues(faceResult);
    setUnsigned(values, 'mouthOpen', face.mouthOpen);
    setUnsigned(values, 'smile', face.smile);
    setUnsigned(values, 'leftEye', face.leftEye);
    setUnsigned(values, 'rightEye', face.rightEye);
    setUnsigned(values, 'leftEyebrow', face.leftEyebrow);
    setUnsigned(values, 'rightEyebrow', face.rightEyebrow);
    setSigned(values, 'headYaw', face.yaw);
    setSigned(values, 'headPitch', face.pitch);
    setSigned(values, 'headRoll', face.roll);

    return values;
  }
}

function unsignedFromOffset(offset) {
  // offset is -1..1 (or null when the hand isn't tracked) from HandControls;
  // triggers are displayed/used as 0..1 like the brief's own overlay example.
  return offset === null || offset === undefined ? 0.5 : clamp01((offset + 1) / 2);
}

function setUnsigned(values, id, value01) {
  const v = clamp01(value01);
  values[id] = { raw: v, value01: v };
}

function setSigned(values, id, signedValue) {
  const v = clampSigned(signedValue);
  values[id] = { raw: v, value01: (v + 1) / 2 };
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function clampSigned(v) {
  return Math.min(1, Math.max(-1, v));
}
