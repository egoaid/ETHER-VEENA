/* ==========================================================================
   camera.js — webcam / phone camera access and the <video> element
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

export class Camera {
  /**
   * @param {HTMLVideoElement} videoElement
   */
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
    this.facingMode = 'user'; // 'user' (front) or 'environment' (rear)
    this.hasMultipleCameras = false;
  }

  /**
   * Ask the browser how many cameras are present. Best-effort: some
   * browsers only reveal camera labels/counts after permission is granted,
   * so this may under-report until start() has run once.
   */
  async detectMultipleCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      this.hasMultipleCameras = cams.length > 1;
    } catch (_err) {
      this.hasMultipleCameras = false;
    }
    return this.hasMultipleCameras;
  }

  /**
   * Request camera permission and start streaming into the <video> element.
   * @returns {Promise<void>}
   */
  async start() {
    // getUserMedia is only available in a "secure context": https://, or
    // http://localhost / http://127.0.0.1. Opening index.html directly as
    // a file:// URL, or serving it over plain http:// from another host,
    // makes navigator.mediaDevices disappear entirely in every modern
    // browser — the most common reason the camera silently "does nothing".
    if (!window.isSecureContext) {
      throw new CameraError(
        'insecure-context',
        'Camera access requires HTTPS (or http://localhost during development). ' +
          'Opening this file directly, or loading it over plain http://, blocks ' +
          'the camera in every modern browser. Serve it locally (e.g. `python3 -m ' +
          'http.server`) or deploy it to GitHub Pages, then reload.'
      );
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new CameraError(
        'unsupported',
        'This browser does not support camera access (getUserMedia).'
      );
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: this.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.error('getUserMedia failed:', err);
      throw this._mapGetUserMediaError(err);
    }

    this.video.srcObject = this.stream;

    // Some browsers (notably iOS Safari) don't reliably honor the
    // `autoplay` attribute when srcObject is assigned programmatically —
    // call play() explicitly so the stream is guaranteed to render.
    try {
      await this.video.play();
    } catch (err) {
      console.warn('video.play() was rejected, continuing anyway:', err);
    }

    await this._waitForVideoReady();
    await this.detectMultipleCameras();
  }

  /** Stop all tracks and detach the stream from the video element. */
  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
    }
    this.stream = null;
    this.video.srcObject = null;
  }

  /**
   * Switch between front and rear camera (mobile devices). Restarts the
   * stream. No-op if a switch is already in progress or unsupported.
   */
  async switchFacing() {
    this.facingMode = this.facingMode === 'user' ? 'environment' : 'user';
    this.stop();
    await this.start();
    return this.facingMode;
  }

  get width() {
    return this.video.videoWidth || 0;
  }

  get height() {
    return this.video.videoHeight || 0;
  }

  _waitForVideoReady() {
    return new Promise((resolve) => {
      if (this.video.readyState >= 2) {
        resolve();
        return;
      }
      const cleanup = () => {
        this.video.removeEventListener('loadeddata', onLoaded);
        clearTimeout(timer);
      };
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      this.video.addEventListener('loadeddata', onLoaded);
      // Safety net: if 'loadeddata' never fires for some reason, don't hang
      // the start-up flow forever — the stream is usually already good.
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, 3000);
    });
  }

  _mapGetUserMediaError(err) {
    const name = err && err.name ? err.name : 'Unknown';
    switch (name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return new CameraError(
          'permission-denied',
          'Camera permission was denied. Allow camera access in your browser/OS settings and try again.'
        );
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return new CameraError(
          'no-camera',
          'No camera was found on this device.'
        );
      case 'NotReadableError':
      case 'TrackStartError':
        return new CameraError(
          'camera-busy',
          'The camera could not be started. It may be in use by another app, browser tab, or the OS camera privacy setting is off.'
        );
      case 'OverconstrainedError':
      case 'ConstraintNotSatisfiedError':
        return new CameraError(
          'overconstrained',
          'No camera on this device matches the requested settings.'
        );
      case 'SecurityError':
        return new CameraError(
          'insecure-context',
          'Camera access was blocked for security reasons. Make sure the page is loaded over HTTPS or http://localhost.'
        );
      default:
        return new CameraError('unknown', `Camera error: ${name}`);
    }
  }
}

export class CameraError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CameraError';
    this.code = code;
  }
}
