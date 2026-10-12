# Changelog

## 0.7.0 build 032 — 2026-10-12
- Display performance (Display section): Auto / Full / Lite / Minimal. Lite and Minimal use coarser polygons, a lower-resolution canvas, a slower mesh refresh, no motion smoothing, no Glitch and a lighter (or no) CRT, so a small phone keeps playing sound while the Polygon filter is on.
- Auto starts in Lite on small iPhones (SE / mini class) and low-spec devices, and steps down by itself when the picture takes too long; the level it learns is remembered.
- Polygon motion: face colours are no longer recomputed on every gliding frame (less work per frame on all devices).
- New app icon and social image (Rudra / Shiva: trident, crescent moon, damaru). Public address set to https://egoaid.github.io/ETHER-VEENA/.

## 0.7.0 build 031 — 2026-10-12
- Sound safety: Random / presets / waveform changes no longer jump in level or click (the output dips for ~25 ms, the change is made, the level returns gently).
- Output limiter + soft clipper after the pan: no patch can clip the output.
- Fewer clicks: reverb size changes cross-fade between two convolvers and are rate-limited; envelope edges have a 5 ms floor; voices are freed only when their tail is inaudible.
- Screen Wake Lock: the phone screen stays on while the camera is running (requested again after the page returns to the foreground).
- Quiet update notice next to the version label when a newer build is on the server.
- Public site files: new icon set (favicons, Apple touch icon, maskable, social image), `manifest.json`, `service-worker.js`, `robots.txt`, `sitemap.xml`, `llms.txt`, social/OGP and structured data, About / FAQ section.
- Icon redesign: Rudra / Shiva motif (trishula, crescent moon, damaru, third eye) on indigo. New Display performance setting (Auto / Full / Lite / Minimal) for slower phones.

## 0.7.0 build 030 — 2026-10-11
- Full-screen Photo menu (shoot, timer, detail, burst) with share / save result menu.
- Share sheet for the Vector Camera files (PNG / PDF / SVG); PNG export; line-art styles, backgrounds, PDF page sizes; burst 1/3/5.
- 25 presets in groups (Rudra Veena ragas by time of day); two-level full-screen preset menu.
- My presets (save the whole patch, export / import JSON).
- Randomize locks (root, scale, waveform & filter type, camera filter, colours, glitch & CRT, body visual & background, delay type).
- Smoother Polygon motion (optional).

## 0.7.0 build 029 — 2026-10-10
- Privacy mode (Randomize / presets never turn the Camera filter off).
- Volume shown as a horizontal line; Vector Camera (SVG / PDF, self-timer).

## 0.7.0 build 028 — 2026-10-09
- JPEG-style block glitch; far finer and sharper polygons; unified presets; Randomize Display; CRT monitor mode; pitch line.

## 0.7.0 build 027
- Finer polygon density, ping-pong delay, video glitch, simpler UI.
