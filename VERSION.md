# Version

**ETHER VEENA 0.7.0 — build 032** (2026-10-12)

The version lives in three places that must always agree (`tests/build031.test.mjs` checks this):

| File | Field | Used for |
|---|---|---|
| `version.json` | `version`, `build` | what the server says is newest (the app fetches it with no-store) |
| `js/appVersion.js` | `APP_VERSION`, `APP_BUILD` | what the running code is; shown top-right and compared with `version.json` |
| `service-worker.js` | `CACHE_NAME` (`ether-veena-shell-v<version>-<build>`) | the offline cache; a new name replaces the old cache |
| `index.html` | JSON-LD `softwareVersion` | search engines |

Release checklist: bump the four values above → add a section to `CHANGELOG.md` → `node tests/run-all.mjs` → upload.
A visitor who still runs an older build sees a small "Update available · tap to reload" note under the version label.
