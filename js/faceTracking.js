/* ==========================================================================
   faceTracking.js — MediaPipe Face Landmarker: load model, detect face
   Mirrors handTracking.js's shape exactly (same package, same load/detect
   pattern) since both are "wrap one MediaPipe Tasks Vision detector."
   ETHER VEENA — © 2026 egoaid

   OPTIONAL and lazy: this only loads/runs when the player turns on Face
   Tracking, so nobody pays its cost (a second ~10MB+ model, plus a second
   per-frame detection pass) to play a hands-only session. See
   DEVELOPER_NOTES.md, "Face tracking (v0.5)" for the throttling strategy
   that keeps it from competing with hand-tracking responsiveness.
   ========================================================================== */

const TASKS_VISION_VERSION = '1.0.1'; // kept identical to handTracking.js's pin
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/**
 * MediaPipe's own face-mesh connection lists (tesselation, contours…), captured
 * when the landmarker loads so the Full Mask display can draw the real mesh.
 * Empty until face tracking has loaded; the overlay falls back to a simple mask.
 */
export const faceMesh = { tesselation: null, oval: null, lips: null, leftEye: null, rightEye: null, leftBrow: null, rightBrow: null };

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this._lastVideoTime = -1;
  }

  /** Download the WASM runtime and model, and create the landmarker. */
  async load() {
    const { FaceLandmarker, FilesetResolver } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`
    );

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    try {
      faceMesh.tesselation = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
      faceMesh.oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
      faceMesh.lips = FaceLandmarker.FACE_LANDMARKS_LIPS;
      faceMesh.leftEye = FaceLandmarker.FACE_LANDMARKS_LEFT_EYE;
      faceMesh.rightEye = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE;
      faceMesh.leftBrow = FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW;
      faceMesh.rightBrow = FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW;
    } catch (_e) { /* older builds: fallback mask is used */ }

    const baseConfig = {
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    };

    try {
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'GPU' },
      });
    } catch (err) {
      console.warn('FaceLandmarker GPU delegate failed, retrying on CPU:', err);
      this.landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'CPU' },
      });
    }
  }

  /**
   * Detect the face in the current video frame.
   * @param {HTMLVideoElement} video
   * @returns {{faceBlendshapes: Array, facialTransformationMatrixes: Array}|null}
   */
  detect(video) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this._lastVideoTime) return null;
    this._lastVideoTime = video.currentTime;

    const nowMs = performance.now();
    return this.landmarker.detectForVideo(video, nowMs);
  }

  close() {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
  }
}
