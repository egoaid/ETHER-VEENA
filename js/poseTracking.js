/* ==========================================================================
   poseTracking.js — MediaPipe Pose Landmarker (Body HUD only).

   Pose landmarks draw the body (shoulders, neck, torso, arms, hips…); they
   are NOT musical triggers — hands stay the performance input. It follows
   faceTracking.js's philosophy: OPTIONAL, LAZY (nothing is downloaded until
   the Body HUD asks), and THROTTLED so it never competes with hand tracking.

   `PoseScheduler` decides how often detection runs: every 4th frame by
   default, backing off toward every 10th if detection proves expensive on
   this device, so the instrument stays responsive on phones.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const TASKS_VISION_VERSION = '1.0.1'; // identical to handTracking.js / faceTracking.js
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const MODEL_ASSET_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export class PoseTracker {
  constructor() {
    this.landmarker = null;
    this._lastVideoTime = -1;
  }

  async load() {
    const { PoseLandmarker, FilesetResolver } = await import(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}`);
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
    const base = { runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minTrackingConfidence: 0.5 };
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, { ...base, baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'GPU' } });
    } catch (err) {
      console.warn('PoseLandmarker GPU delegate failed, retrying on CPU:', err);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, { ...base, baseOptions: { modelAssetPath: MODEL_ASSET_URL, delegate: 'CPU' } });
    }
  }

  /** @returns {Array<{x:number,y:number,z:number,visibility?:number}>|null} the 33 pose landmarks */
  detect(video) {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this._lastVideoTime) return null;
    this._lastVideoTime = video.currentTime;
    const res = this.landmarker.detectForVideo(video, performance.now());
    return res?.landmarks?.[0] ?? null;
  }

  close() {
    if (this.landmarker) { this.landmarker.close(); this.landmarker = null; }
  }
}

/** Adaptive throttle: run every `every` frames; slow down if detection is costly. */
export class PoseScheduler {
  constructor({ baseEvery = 4, maxEvery = 10, budgetMs = 12 } = {}) {
    this.baseEvery = baseEvery;
    this.maxEvery = maxEvery;
    this.budgetMs = budgetMs;
    this.every = baseEvery;
    this._avg = 0;
  }

  /** Should detection run on this frame? */
  due(frame) {
    return frame % this.every === 0;
  }

  /** Report how long a detection took (ms); adapts the interval. */
  record(ms) {
    this._avg = this._avg ? this._avg * 0.8 + ms * 0.2 : ms;
    if (this._avg > this.budgetMs * 2) this.every = Math.min(this.maxEvery, this.every + 1);
    else if (this._avg < this.budgetMs * 0.6) this.every = Math.max(this.baseEvery, this.every - 1);
    return this.every;
  }
}
