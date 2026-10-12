/* ==========================================================================
   service-worker.js — service worker: app-shell precache for PWA installability
   ETHER VEENA — © 2026 egoaid

   Scope is the directory this file lives in, so this works unmodified when
   the site is deployed under a GitHub Pages project path
   (e.g. https://user.github.io/web-theremin/) as well as at a domain root.

   NOTE: only the app shell (HTML/CSS/JS/icons) is precached here. The
   MediaPipe WASM runtime and hand-landmarker model are loaded from a CDN
   at runtime and are NOT cached, so the instrument itself currently needs
   a network connection the first time it starts in a session. See
   DEVELOPER_NOTES.md ("Known limitations") for the plan to change that.

   Bump CACHE_NAME whenever shell files change so clients pick up the new
   version instead of serving stale cached files.
   ========================================================================== */

const CACHE_NAME = 'ether-veena-shell-v0.7.0-033';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './version.json',
  './css/base.css',
  './css/camera.css',
  './css/controls.css',
  './css/theremin.css',
  './css/hud.css',
  './js/app.js',
  './js/camera.js',
  './js/handTracking.js',
  './js/handControls.js',
  './js/theremin.js',
  './js/ui.js',
  './js/vibrato.js',
  './js/scales.js',
  './js/triggers.js',
  './js/mapping.js',
  './js/faceTracking.js',
  './js/bodyHud.js',
  './js/poseTracking.js',
  './js/rudraVeenaStrings.js',
  './js/instrumentMappingProfiles.js',
  './js/performanceInteractionState.js',
  './js/gestures.js',
  './js/handDiagnostics.js',
  './js/cameraFilters.js',
  './js/pingPongDelay.js',
  './js/videoGlitch.js',
  './js/triggerHud.js',
  './js/audioReactive.js',
  './js/mandala.js',
  './js/geometry.js',
  './js/smoothing.js',
  './js/fingerState.js',
  './js/harpController.js',
  './js/rudraVeenaController.js',
  './js/ragas.js',
  './js/instrumentVisuals.js',
  './js/virtualCursor.js',
  './js/performanceMode.js',
  './js/events.js',
  './js/voices.js',
  './js/instruments.js',
  './js/sounds.js',
  './js/presets.js',
  './js/vectorCamera.js',
  './js/userPresets.js',
  './js/wakeLock.js',
  './js/appVersion.js',
  './js/updateCheck.js',
  './js/displayLoad.js',
  './js/audioGuard.js',
  './js/randomize.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-16.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle same-origin GET requests; let cross-origin requests (Google
  // Fonts, the MediaPipe CDN, the hand-landmarker model) go straight to the
  // network so we never accidentally cache or block third-party assets.
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // version.json is how a running app learns that a newer version exists: always ask the network first (cached copy only when offline).
  if (new URL(request.url).pathname.endsWith('/version.json')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => cached);
    })
  );
});
