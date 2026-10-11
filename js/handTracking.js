/* ==========================================================================
   handTracking.js — MediaPipe Hand Landmarker: load model, detect hands
   ETHER VEENA — © 2026 egoaid

   Loaded from a pinned CDN version so the app stays static (no build step,
   no bundler) and works unmodified on GitHub Pages. See DEVELOPER_NOTES.md
   for the version pin and how to bump it later.
   ========================================================================== */

const TASKS_VISION_VERSION = '1.0.1';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this._lastVideoTime = -1;
  }

  /** Download the WASM runtime and model, and create the landmarker. */
  async load() {
    const { HandLandmarker, FilesetResolver } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`
    );

    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);

    const baseConfig = {
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    };

    // Not every browser/device supports the GPU delegate (older Android
    // WebViews and some desktop configurations reject it outright). Try GPU
    // first for lower latency, and fall back to CPU rather than letting the
    // whole app fail to start.
    try {
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'GPU' },
      });
    } catch (err) {
      console.warn('HandLandmarker GPU delegate failed, retrying on CPU:', err);
      this.landmarker = await HandLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'CPU' },
      });
    }
  }

  /**
   * Detect hands in the current video frame.
   * @param {HTMLVideoElement} video
   * @returns {{landmarks: Array<Array<{x:number,y:number,z:number}>>, handednesses: Array<Array<{categoryName:string,score:number}>>}|null}
   *   Raw MediaPipe result, or null if the frame was a duplicate (not yet
   *   advanced) or the landmarker isn't ready.
   */
  detect(video) {
    if (!this.landmarker || video.readyState < 2) return null;

    // MediaPipe's VIDEO mode requires a strictly increasing timestamp and
    // will throw if we feed it the same frame twice.
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
