# Architecture

ETHER VEENA is a static site: HTML, CSS and ES modules, no build step, no server code. It runs on GitHub Pages as it is.

```
index.html            page, controls, About/FAQ, structured data
manifest.json         PWA manifest            service-worker.js   app-shell precache (offline)
version.json          newest published version (fetched with no-store)
css/                  base · camera · controls · theremin · hud
js/
  app.js              the App: wires everything, main loop, presets, Randomize, Vector Camera, Performance actions
  camera.js           getUserMedia                     handTracking / faceTracking / poseTracking  MediaPipe Tasks Vision (CDN)
  handControls.js     hand → pitch / volume / depth     fingerState.js · gestures.js              finger curl, pointing
  mapping.js          Trigger → Destination rows        triggers.js · instrumentMappingProfiles.js
  theremin.js         the audio graph (below)           voices.js   polyphonic plucked voices (harp, Rudra Veena, chikari drone)
  instruments.js      instrument definitions            rudraVeena*.js · harpController.js · ragas.js · scales.js
  cameraFilters.js    Polygon camera filters (WebGL / 2D)   videoGlitch.js   JPEG-style glitch      vectorCamera.js   SVG / PDF / PNG export
  presets.js          built-in unified presets          userPresets.js   My presets + Randomize locks (pure)
  randomize.js        musical random patches            performanceMode.js · virtualCursor.js   full-screen mode and finger pointing
  wakeLock.js         Screen Wake Lock                  updateCheck.js · appVersion.js   quiet "newer version" notice
  audioGuard.js       resumes a suspended/interrupted audio context · displayLoad.js  Display performance + Sound engine settings
tests/                node tests/run-all.mjs (unit + wiring); tests/browser/*.py need Playwright + Chromium
```

## Audio graph
oscillators → filter → envelope → hand gain ─┬─ dry ──────────────┐
voices bus ──────────────────────────────────┤                     │
                                             ├─ delay / ping-pong ─┼─ master gain → pan → limiter → soft clipper → analyser → output
                                             └─ reverb (A/B convolvers, cross-faded) ┘
- Every live parameter change uses `setTargetAtTime` (no direct `.value` writes while sound is running).
- Changes that cannot be smooth (a new patch, Randomize, waveform swap) go through `App._quiet()`: duck the master gain, change, unduck.

## Data and storage (all in the browser)
`etherVeena.userPresets.v1` · `etherVeena.randomLocks.v1` · `etherVeena.privacy` · `webTheremin.customMapping.v1`. Nothing is sent to a server; video never leaves the page.

## Updates
`version.json` is fetched with no-store at load, when the page becomes visible and every 30 minutes; if it is newer than `APP_VERSION/APP_BUILD`, a small note appears by the version label. Tapping it deletes this app's caches and the service worker, then reloads.
