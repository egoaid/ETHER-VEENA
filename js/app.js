/* ==========================================================================
   app.js — application initialization and coordination

   Per frame:  hands (MediaPipe) ─┐
               face  (optional) ──┤→ TriggerEngine → MappingEngine → destination setters → ThereminEngine
   plus the always-on core path:   HandControls → PitchModeProcessor → pitch/volume/envelope

   Instruments (v0.6, reworked in build 008): the selected instrument decides
   what the body does — each has its own physical metaphor:
     continuous   Theremin: spatial pitch (right) / volume (left)
     strings      Harp: 47 strings, fingertips sweep across them
     string-bend  Rudra Veena: left hand = neck (raga/meend), right = plectrum
   Per-fingertip state (fingerState.js) feeds the controllers; the overlay
   (instrumentVisuals.js) draws the instrument and body on the camera image
   in stage coordinates (geometry.js). Volume, effects and scope are shared.

   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { Camera, CameraError } from './camera.js';
import { HandTracker } from './handTracking.js';
import { FaceTracker } from './faceTracking.js';
import { HandControls } from './handControls.js';
import { ThereminEngine } from './theremin.js';
import { TriggerEngine, TRIGGER_DEFS, TRIGGER_GROUPS } from './triggers.js';
import { MappingEngine, DESTINATIONS, PRESETS } from './mapping.js';
import { UI } from './ui.js';
import { StageOverlay } from './instrumentVisuals.js';
import { AudioBands } from './audioReactive.js';
import { Mandala } from './mandala.js';
import { FingerTracker } from './fingerState.js';
import { HarpController, buildHarpLayout, sympatheticStrings } from './harpController.js';
import { RudraController, rudraVoicePitch } from './rudraVeenaController.js';
import { HandCheckView } from './handDiagnostics.js';
import { CameraFilter, nextFilterId, hexToRgb, midiOfHz } from './cameraFilters.js';
import { VideoGlitch } from './videoGlitch.js';
import { InteractionState } from './performanceInteractionState.js';
import { PoseTracker, PoseScheduler } from './poseTracking.js';
import { resolveRudraTuning, chikariVoice, MAIN_TUNINGS } from './rudraVeenaStrings.js';
import { RAGA_NAMES, ragaByName } from './ragas.js';
import { VirtualCursor, isPointingPose } from './virtualCursor.js';
import { PerformanceMode } from './performanceMode.js';
import { VoiceManager, STEAL_STRATEGIES } from './voices.js';
import { INSTRUMENTS, instrumentById, defaultParams, POLYPHONY_CHOICES, harpSympatheticScale } from './instruments.js';
import { INSTRUMENT_DESTINATION_KEYS } from './instrumentMappingProfiles.js';
import { anchorFor, destinationName, formatDestinationValue, formatTriggerValue } from './triggerHud.js';
import { destinationById } from './mapping.js';
import { UNIFIED_PRESETS, unifiedPresetById, PRESET_GROUPS } from './presets.js';
import { WakeLockKeeper } from './wakeLock.js';
import { LoadWatch, MODES, qualityOf, deviceHint, resolveLevel, loadDisplaySettings, saveDisplayMode, saveLearned } from './displayLoad.js';
import { APP_VERSION, APP_BUILD } from './appVersion.js';
import { checkForUpdate, applyUpdate } from './updateCheck.js';
import { meshToSvg, meshToPdf, visibleRect, drawMeshToCtx, sizeForPng } from './vectorCamera.js';
import { loadUserPresets, saveUserPresets, makeUserPreset, exportUserPresets, importUserPresets, uniqueName, loadLocks, saveLocks, lockDisplay, lockSynth, lockEffects, LOCKS } from './userPresets.js';
import {
  randomizeSynth,
  randomizeEffects,
  randomizeDelayMode,
  randomizeDisplay,
  randomizeRootScale,
  randomizeRudraTuning,
  randomizeMapping,
  randomizeInstrumentParams,
} from './randomize.js';
import {
  PitchModeProcessor,
  ROOT_NAMES,
  SCALE_NAMES,
  midiToNoteName,
  scalePitchClassSet,
  easyScaleBaseMidi,
  freqToMidi,
  midiToFreq,
  mod12,
} from './scales.js';

const MIN_FREQ_HZ = 130.81; // C3
const MAX_FREQ_HZ = 1046.5; // C6 — three octaves above C3
const CALIBRATION_COUNTDOWN_SECONDS = 3;
const FACE_DETECT_EVERY_N_FRAMES = 3; // keep face tracking from competing with hand responsiveness
const DEFAULT_PRESET_ID = 'classic';
const FIXED_VOLUME01 = 0.8; // volume when the left hand isn't the volume control
const RV_VIBRATO_RATE_HZ = 5.5;
const RV_VIBRATO_MAX_CENTS = 35;
const RV_ANDOLAN_MAX_CENTS = 45;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const SCALE_MODES = ['snap-scale', 'filter-scale', 'easy-scale'];

const fmt2 = (v) => v.toFixed(2);
const fmtPct = (v) => `${Math.round(v * 100)}%`;
const fmtSec = (v) => `${v.toFixed(2)}s`;

class App {
  constructor() {
    this.ui = new UI();
    this.camera = new Camera(this.ui.el.video);
    this.handTracker = new HandTracker();
    this.faceTracker = new FaceTracker();
    this.handControls = new HandControls();
    this.overlay = new StageOverlay(this.ui.el.stageCanvas, this.ui.el.video);
    this.bands = new AudioBands();
    this.mandala = new Mandala(this.ui.el.mandalaCanvas);
    this.background = { mode: 'camera', color: '#0b0a14', imageUrl: null, reactiveLayer: true };
    this.fingerTracker = new FingerTracker();
    this.harp = new HarpController();
    this.rudra = new RudraController();
    this.cursor = new VirtualCursor();
    this.poseTracker = null;
    this.poseLoading = false;
    this.poseScheduler = new PoseScheduler();
    this.showPose = true;
    // INSTRUMENT vs MENU mode: while a menu is open the body belongs to the UI.
    this.interaction = new InteractionState({
      settleMs: 450,
      onChange: (_mode, info) => { if (info.reset) this._resetInstrumentInput(); },
    });
    this.perf = new PerformanceMode({
      stage: this.ui.el.stage,
      layer: this.ui.el.perfLayer,
      panel: this.ui.el.perfPanel,
      onLayoutChange: () => this._onLayoutChange(),
      onAction: (a, arg) => this._perfAction(a, arg),
      onMenuOpen: () => this.interaction.enterMenu(),
      onMenuClose: () => this.interaction.exitMenu(performance.now()),
    });
    this.theremin = new ThereminEngine({ minFreq: MIN_FREQ_HZ, maxFreq: MAX_FREQ_HZ });
    this.pitchModeProcessor = new PitchModeProcessor({ minFreq: MIN_FREQ_HZ, maxFreq: MAX_FREQ_HZ });
    this.triggerEngine = new TriggerEngine();
    this.mapping = new MappingEngine(TRIGGER_DEFS.map((t) => t.id));

    // The player's own slider values. Mapped values overwrite the engine's
    // stored settings every frame, so these are the source of truth for
    // "what to go back to" when a mapping stops driving a destination.
    const t0 = this.theremin;
    this.base = {
      oscMix: t0.oscMix01, oscDetune: t0.oscDetuneCents,
      attack: t0.attackSeconds, decay: t0.decaySeconds, sustain: t0.sustainLevel, release: t0.releaseSeconds,
      delayMix: t0.delayMix01, delayTime: t0.delayTimeSeconds, delayFeedback: t0.delayFeedback01,
      reverbMix: t0.reverbMix01, reverbSize: t0.reverbSize01, pan: t0.pan,
    };

    this.isLive = false;
    this.wakeLock = new WakeLockKeeper();
    this._loopHandle = null;
    this._countdownInterval = null;
    this._countdownTimeout = null;

    // Pitch-mode / scale state. Continuous stays the default.
    this.pitchMode = 'continuous';
    this.rootPc = 0;
    this.scaleName = SCALE_NAMES[0];
    this.useFlats = false;
    this._minMidi = freqToMidi(MIN_FREQ_HZ);
    this._maxMidi = freqToMidi(MAX_FREQ_HZ);

    // Face tracking (optional, lazy)
    this.faceEnabled = false;
    this.faceLoading = false;
    this._lastFaceResult = null;
    this._frameCounter = 0;

    // Instruments (v0.6)
    this.instrumentId = 'theremin';
    this.instrumentParams = Object.fromEntries(INSTRUMENTS.map((i) => [i.id, defaultParams(i)]));
    this.instrumentSettings = Object.fromEntries(
      INSTRUMENTS.map((i) => [i.id, { polyphony: i.defaultPolyphony, steal: 'oldest' }])
    );
    this.voices = null;
    this.ragaName = 'Bhairav';
    this.instrumentOptions = Object.fromEntries(
      INSTRUMENTS.map((i) => [i.id, Object.fromEntries((i.options ?? []).map((o) => [o.key, o.default]))])
    );
    this._instOverride = {}; // expressive mapping overrides of instrument params (active instrument only)
    this.tuning = resolveRudraTuning();
    this._droneKey = null;
    this.harpLayout = null;
    this._displayFreq = null;
    this._drawState = null;
    this._rightWas = false;
    this._rightLostAt = 0;
    this._reacquireAt = 0;
    this._stageRect = null;
    this._stageRectAt = 0;
    this._chikariStep = 0;
    this._droneFifth = null;
    this.requirePointing = true;

    // Display. Defaults per the CYBER THEREMIN brief: body HUD, pitch/note and
    // oscilloscope all ON; the numeric debug cards are a separate, opt-in view.
    this.display = { body: true, triggers: true, pitchNote: true, scope: true, debug: new URLSearchParams(location.search).has('debug') };
    this.crt = { on: false, amount: 0.65 };
    this.privacy = false; try { this.privacy = localStorage.getItem('etherVeena.privacy') === '1'; } catch { /* storage unavailable */ }
    this._shoot = null; this._vector = { shots: [], sel: 0, urls: [], stamp: '', prepared: null, prepToken: 0 };
    this._store = null; try { this._store = window.localStorage; } catch { /* storage unavailable */ }
    this.perfSettings = this._store ? loadDisplaySettings(this._store) : { mode: 'auto', learned: 0 };
    this.loadWatch = new LoadWatch(); this._lastLoopAt = 0;
    this.displayLevel = resolveLevel(this.perfSettings.mode, { hint: deviceHint(), learned: this.perfSettings.learned });
    this.userPresets = this._store ? loadUserPresets(this._store) : [];
    this.locks = this._store ? loadLocks(this._store) : loadLocks({ getItem() { return null; } });
    this._scopeBuffer = null;
    this._prevTouched = new Set();
    this._activePresetId = null;

    this._registerDestinations();
    this._bindUi();
    this._initStaticUi();
    this.applyPreset(DEFAULT_PRESET_ID);
    this.setInstrument('theremin', { applyDefaults: false });
    this.overlay.attach();
    this._applyBackground();
  }

  get instrument() {
    return instrumentById(this.instrumentId);
  }

  // -- Setup -----------------------------------------------------------------

  /** Destination id -> setter. Each takes the destination's native value. */
  _registerDestinations() {
    const t = this.theremin;
    const m = this.mapping;
    for (const [key] of INSTRUMENT_DESTINATION_KEYS) m.registerDestination(`inst:${key}`, (v) => this._setInstrumentParamFraction(key, v));
    m.registerDestination('finePitch', (v) => t.setMappedFinePitchOffset(v));
    m.registerDestination('oscMix', (v) => t.setOscMix01(v));
    m.registerDestination('oscDetune', (v) => t.setOscDetuneCents(v));
    m.registerDestination('filterCutoff', (v) => t.setFilterCutoffHz(v));
    m.registerDestination('filterResonance', (v) => t.setFilterResonance(v));
    m.registerDestination('lfoRate', (v) => t.setMappedLfoRateHz(v));
    m.registerDestination('lfoDepth', (v) => t.setMappedLfoDepth01(v));
    m.registerDestination('attack', (v) => t.setAttackSeconds(v));
    m.registerDestination('decay', (v) => t.setDecaySeconds(v));
    m.registerDestination('sustain', (v) => t.setSustainLevel(v));
    m.registerDestination('release', (v) => t.setReleaseSeconds(v));
    m.registerDestination('delayMix', (v) => t.setDelayMix01(v));
    m.registerDestination('delayTime', (v) => t.setDelayTimeSeconds(v));
    m.registerDestination('delayFeedback', (v) => t.setDelayFeedback01(v));
    m.registerDestination('reverbMix', (v) => t.setReverbMix01(v));
    m.registerDestination('reverbSize', (v) => t.setReverbSize01(v));
    m.registerDestination('pan', (v) => t.setPan(v));
  }

  /** When a mapping stops driving a destination, put it back to the
   *  player's own base setting instead of leaving the last mapped value. */
  _restoreDestination(id) {
    if (id.startsWith('inst:')) { this._clearInstrumentOverride(id.slice(5)); return; }
    const t = this.theremin;
    const b = this.base;
    switch (id) {
      case 'finePitch': t.setMappedFinePitchOffset(0); break;
      case 'oscMix': t.setOscMix01(b.oscMix); break;
      case 'oscDetune': t.setOscDetuneCents(b.oscDetune); break;
      case 'filterCutoff': t.setBrightness01(t.brightness01); break;
      case 'filterResonance': t.setResonance01(t.resonance01); break;
      case 'attack': t.setAttackSeconds(b.attack); break;
      case 'decay': t.setDecaySeconds(b.decay); break;
      case 'sustain': t.setSustainLevel(b.sustain); break;
      case 'release': t.setReleaseSeconds(b.release); break;
      case 'delayMix': t.setDelayMix01(b.delayMix); break;
      case 'delayTime': t.setDelayTimeSeconds(b.delayTime); break;
      case 'delayFeedback': t.setDelayFeedback01(b.delayFeedback); break;
      case 'reverbMix': t.setReverbMix01(b.reverbMix); break;
      case 'reverbSize': t.setReverbSize01(b.reverbSize); break;
      case 'pan': t.setPan(b.pan); break;
      default: break; // LFO rate/depth are read at use time via mappedFlags; nothing to restore
    }
  }

  _bindUi() {
    const ui = this.ui;
    const t = this.theremin;

    ui.bindStartButton(() => this.toggleStart());
    ui.bindFullscreenButton(() => this.enterPerformance());
    // camera filter: rebuilds the picture from pseudo-3D polygons so the person cannot be recognised (cameraFilters.js)
    this.cameraFilter = new CameraFilter({ video: ui.el.video, canvas: ui.el.filterCanvas, stage: ui.el.stage });
    ui.el.cameraFilterSelect.addEventListener('change', () => this._setCameraFilter(ui.el.cameraFilterSelect.value));
    this.glitch = new VideoGlitch({ canvas: ui.el.glitchCanvas, stage: ui.el.stage, video: ui.el.video, filterCanvas: ui.el.filterCanvas, cameraFilter: this.cameraFilter });
    for (const [el, key] of [['glitchAmount', 'amount'], ['glitchFrequency', 'frequency'], ['glitchBlock', 'blockSize'], ['glitchRgb', 'rgbSplit'], ['glitchDisplace', 'displace'], ['glitchNoise', 'noise'], ['glitchHold', 'hold']]) {
      ui.el[el].addEventListener('input', () => { this.glitch.set({ [key]: Number(ui.el[el].value) / 100 }); ui.el.glitchControls.hidden = !(this.glitch.params.amount > 0.001); });
    }
    // Display performance (Build 032): Auto / Full / Lite / Minimal + a watchdog that steps down by itself when the picture starves the sound
    ui.el.displayPerfSelect.value = this.perfSettings.mode;
    ui.el.displayPerfSelect.addEventListener('change', () => {
      const m = MODES.includes(ui.el.displayPerfSelect.value) ? ui.el.displayPerfSelect.value : 'auto';
      this.perfSettings.mode = m; if (this._store) saveDisplayMode(this._store, m);
      this.displayLevel = resolveLevel(m, { hint: deviceHint(), learned: this.perfSettings.learned }); this.loadWatch.reset(); this._applyDisplayLevel();
    });
    this._applyDisplayLevel();
    ui.el.privacyToggle.checked = this.privacy;
    ui.el.privacyToggle.addEventListener('change', () => { this.privacy = ui.el.privacyToggle.checked; try { localStorage.setItem('etherVeena.privacy', this.privacy ? '1' : '0'); } catch { /* ignore */ } });
    ui.el.vectorShootButton.addEventListener('click', () => this.takeVectorPhoto());
    ui.el.shootCountdown.addEventListener('click', () => this._cancelShoot());
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._cancelShoot(); });
    ui.el.vectorSaveSvg.addEventListener('click', () => this._saveVector('svg'));
    ui.el.vectorSavePdf.addEventListener('click', () => this._saveVector('pdf'));
    ui.el.vectorSavePng.addEventListener('click', () => this._saveVector('png'));
    ui.el.vectorSaveAll.addEventListener('click', () => this._saveVector(ui.el.vectorShareAs.value, true));
    ui.el.vectorShare.addEventListener('click', () => this._shareVector());
    ui.el.vectorStrip.addEventListener('click', (e) => { const b = e.target.closest?.('[data-shot]'); if (b) { this._vector.sel = Number(b.dataset.shot); this._refreshShots(); } });
    let vecT = 0;
    const vecChanged = () => { ui.el.vectorBgColorField.hidden = ui.el.vectorBg.value !== 'custom'; clearTimeout(vecT); vecT = setTimeout(() => { this._refreshShots(); this._prepareShare(); }, 160); };
    for (const k of ['vectorStyle', 'vectorBg', 'vectorBgColor', 'vectorPage', 'vectorShareAs']) ui.el[k].addEventListener(k === 'vectorBgColor' ? 'input' : 'change', vecChanged);
    // Polygon motion smoothing (Build 030)
    ui.el.filterSmoothToggle.addEventListener('change', () => this.cameraFilter.setSmooth(ui.el.filterSmoothToggle.checked));
    // Randomize locks (Build 030): persisted, and honoured by the full-screen Random button too
    for (const box of ui.el.randomLocks.querySelectorAll('[data-lock]')) {
      box.checked = !!this.locks[box.dataset.lock];
      box.addEventListener('change', () => { this.locks[box.dataset.lock] = box.checked; if (this._store) saveLocks(this._store, this.locks); });
    }
    this._bindUserPresets();
    ui.el.crtToggle.addEventListener('change', () => this.setCrt({ on: ui.el.crtToggle.checked }));
    ui.el.crtAmount.addEventListener('input', () => this.setCrt({ amount: Number(ui.el.crtAmount.value) / 100 }));
    ui.el.filterDensity.addEventListener('input', () => this.cameraFilter.setDensity(Number(ui.el.filterDensity.value) / 100));
    ui.el.filterColorMode.addEventListener('change', () => {
      const m = ui.el.filterColorMode.value;
      this.cameraFilter.setColorStyle({ mode: m });
      ui.el.filterBaseField.hidden = m !== 'mono'; ui.el.filterDuoField.hidden = m !== 'duo';
    });
    ui.el.filterBase.addEventListener('input', () => this.cameraFilter.setColorStyle({ base: hexToRgb(ui.el.filterBase.value) }));
    ui.el.filterDark.addEventListener('input', () => this.cameraFilter.setColorStyle({ dark: hexToRgb(ui.el.filterDark.value) }));
    ui.el.filterBright.addEventListener('input', () => this.cameraFilter.setColorStyle({ bright: hexToRgb(ui.el.filterBright.value) }));
    ui.el.filterMusic.addEventListener('change', () => this.cameraFilter.setMusicColor(ui.el.filterMusic.value));
    this.cameraFilter.setColorStyle({ base: hexToRgb(ui.el.filterBase.value), dark: hexToRgb(ui.el.filterDark.value), bright: hexToRgb(ui.el.filterBright.value) });
    ui.bindCalibrateButton(() => this.startCalibrationCountdown());
    ui.bindSensitivitySlider((v) => this.setSensitivity(v));
    this.handCheck = new HandCheckView(document.querySelector('.stage-inner'));
    // Developer-only (no UI): window.etherDebug.handCheck(true) or ?debug=handcheck shows the raw handedness overlay.
    window.etherDebug = { handCheck: (on) => this.handCheck.setEnabled(!!on), swapHands: (on) => { this.handControls.swapHands = !!on; } };
    try { if (new URLSearchParams(location.search).get('debug') === 'handcheck') this.handCheck.setEnabled(true); } catch { /* ignore */ }
    ui.bindCheckbox('useFlatsToggle', (c) => { this.useFlats = c; this._refreshPitchGrid(); });
    ui.bindCheckbox('faceTrackingToggle', (c) => this.setFaceTracking(c));

    ui.bindModeButtons((mode) => this.setPitchMode(mode));
    ui.bindRootSelect((pc) => { this.rootPc = pc; this.pitchModeProcessor.reset(); this._refreshPitchGrid(); this._refreshRudraSa(); this._rebuildLayouts(); });
    ui.bindScaleSelect((name) => {
      if (this.instrument.kind === 'string-bend') this.ragaName = name;
      else this.scaleName = name;
      this.pitchModeProcessor.reset();
      this._refreshPitchGrid();
      this._rebuildLayouts();
    });

    ui.bindSelect('waveformSelect', (v) => this._quiet(() => t.setWaveform(v), 0.05));
    ui.bindSelect('filterTypeSelect', (v) => this._quiet(() => t.setFilterType(v), 0.05));
    ui.bindSelect('lfoTargetSelect', (v) => t.setLfoTarget(v));

    const display = () => ui.setOverlayVisibility(this.display);
    ui.bindCheckbox('showBodyControlsToggle', (c) => { this.display.body = c; display(); });
    ui.bindCheckbox('showPitchNoteToggle', (c) => { this.display.pitchNote = c; display(); });
    ui.bindCheckbox('showOscilloscopeToggle', (c) => { this.display.scope = c; display(); });
    ui.bindCheckbox('showDebugToggle', (c) => { this.display.debug = c; display(); });
    ui.bindCheckbox('showPoseToggle', (c) => { this.showPose = c; });
    ui.bindCheckbox('showTriggerHudToggle', (c) => { this.display.triggers = c; });
    ui.bindSelect('bodyVisualSelect', (v) => this.overlay.body.setMode(v));
    ui.bindSelect('backgroundSelect', (v) => { this.background.mode = v; this._applyBackground(); });
    ui.el.backgroundColor.addEventListener('input', (e) => { this.background.color = e.target.value; this._applyBackground(); });
    ui.el.backgroundImage.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (this.background.imageUrl) URL.revokeObjectURL(this.background.imageUrl);
      this.background.imageUrl = file ? URL.createObjectURL(file) : null;
      this._applyBackground();
    });
    ui.bindCheckbox('mandalaOverlayToggle', (c) => { this.background.reactiveLayer = c; });
    ui.bindSelect('delayModeSelect', (v) => this.theremin.setDelayMode(v));
    ui.bindSelect('faceHudSelect', (v) => this.overlay.body.setFaceMode(v));

    ui.bindSelect('polyphonySelect', (v) => {
      this.instrumentSettings[this.instrumentId].polyphony = parseInt(v, 10);
      this.voices?.setMaxPolyphony(parseInt(v, 10));
    });
    ui.bindSelect('stealSelect', (v) => {
      this.instrumentSettings[this.instrumentId].steal = v;
      this.voices?.setStealStrategy(v);
    });
    ui.el.performanceButton.addEventListener('click', () => this.enterPerformance());
    ui.bindRandomize((cats) => this.randomize(cats));

    ui.bindMappingEditor((triggerId, field, value) => {
      const changes = { [field]: value };
      if (field === 'destination') changes.curve = undefined; // re-pick that destination's default curve
      this.mapping.updateRow(triggerId, changes);
      this._activePresetId = null;
      ui.setActivePreset(null);
    });

    ui.bindPresetActions({
      onSave: () => {
        const ok = this.mapping.saveCustom();
        ui.setPresetStatus(ok ? 'Custom mapping saved on this device.' : 'Could not save (browser storage unavailable).');
      },
      onLoad: () => {
        const rows = this.mapping.loadCustom();
        if (!rows) { ui.setPresetStatus('No saved custom mapping yet.'); return; }
        this.mapping.setMappings(rows);
        this._activePresetId = null;
        ui.setActivePreset(null);
        ui.setPresetCoreNote('Custom mapping loaded. Right Hand X → Pitch and Left Hand Y → Volume always run underneath.');
        ui.renderMappingEditor();
        ui.setPresetStatus('Loaded your saved custom mapping.');
      },
      onReset: () => {
        this.mapping.clearCustom();
        this.applyPreset(DEFAULT_PRESET_ID);
        ui.setPresetStatus('Reset to Classic Theremin (saved custom mapping cleared).');
      },
    });
  }

  _initStaticUi() {
    const ui = this.ui;
    const t = this.theremin;

    ui.setPitchRangeHz(MIN_FREQ_HZ, MAX_FREQ_HZ);
    ui.populateScaleSelects(ROOT_NAMES, SCALE_NAMES);
    ui.setSensitivityDisplay(this.handControls.sensitivity);
    ui.setActiveMode(this.pitchMode);
    ui.setOverlayVisibility(this.display);
    for (const [key, v] of [['showBodyControlsToggle', this.display.body], ['showPitchNoteToggle', this.display.pitchNote], ['showOscilloscopeToggle', this.display.scope], ['showDebugToggle', this.display.debug], ['showPoseToggle', true], ['showTriggerHudToggle', true]]) ui.setCheckbox(key, v);
    ui.populateInstrumentSelects({ polyphonyChoices: POLYPHONY_CHOICES, stealStrategies: STEAL_STRATEGIES });
    ui.renderInstrumentButtons(INSTRUMENTS, (id) => this.setInstrument(id));
    ui.setCatalogs({
      triggerDefs: TRIGGER_DEFS,
      triggerGroups: TRIGGER_GROUPS,
      destinations: DESTINATIONS,
      getRow: (id) => this.mapping.getRow(id),
    });
    this._renderPresets();
    this._refreshPitchGrid();

    ui.renderSliders(
      'synthSliders',
      [
        { key: 'oscMix', label: 'Osc 2 mix', min: 0, max: 1, step: 0.01, value: t.oscMix01, format: fmtPct },
        { key: 'oscDetune', label: 'Osc 2 detune', min: -50, max: 50, step: 1, value: t.oscDetuneCents, format: (v) => `${v}¢` },
        { key: 'brightness', label: 'Brightness', min: 0, max: 1, step: 0.01, value: t.brightness01, format: fmt2 },
        { key: 'resonance', label: 'Resonance', min: 0, max: 1, step: 0.01, value: t.resonance01, format: fmt2 },
        { key: 'attack', label: 'Attack', min: 0.005, max: 2, step: 0.005, value: t.attackSeconds, format: fmtSec },
        { key: 'decay', label: 'Decay', min: 0.005, max: 2, step: 0.005, value: t.decaySeconds, format: fmtSec },
        { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01, value: t.sustainLevel, format: fmtPct },
        { key: 'release', label: 'Release', min: 0.005, max: 2, step: 0.005, value: t.releaseSeconds, format: fmtSec },
        { key: 'lfoRate', label: 'LFO rate', min: 0.1, max: 20, step: 0.1, value: t.lfoBaseRateHz, format: (v) => `${v.toFixed(1)}Hz` },
        { key: 'lfoDepth', label: 'LFO depth', min: 0, max: 1, step: 0.01, value: t.lfoBaseDepth01, format: fmt2 },
      ],
      (key, v) => this._applySynthSlider(key, v)
    );

    ui.renderSliders(
      'effectSliders',
      [
        { key: 'delayMix', label: 'Delay mix', min: 0, max: 1, step: 0.01, value: t.delayMix01, format: fmtPct },
        { key: 'delayTime', label: 'Delay time', min: 0.01, max: 1, step: 0.01, value: t.delayTimeSeconds, format: fmtSec },
        { key: 'delayFeedback', label: 'Delay feedback', min: 0, max: 0.9, step: 0.01, value: t.delayFeedback01, format: fmtPct },
        { key: 'pingWidth', label: 'Ping-pong width', min: 0, max: 1, step: 0.01, value: t.pingWidth01, format: fmtPct },
        { key: 'reverbMix', label: 'Reverb mix', min: 0, max: 1, step: 0.01, value: t.reverbMix01, format: fmtPct },
        { key: 'reverbSize', label: 'Reverb size', min: 0, max: 1, step: 0.01, value: t.reverbSize01, format: fmtPct },
        { key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.05, value: t.pan, format: fmt2 },
      ],
      (key, v) => this._applyEffectSlider(key, v)
    );
  }

  /** One place that applies a Synth slider value — used by the sliders, Randomize and Sound presets. */
  _applySynthSlider(key, v) {
    const t = this.theremin;
    if (key in this.base) this.base[key] = v;
    switch (key) {
      case 'oscMix': t.setOscMix01(v); break;
      case 'oscDetune': t.setOscDetuneCents(v); break;
      case 'brightness': t.setBrightness01(v); break;
      case 'resonance': t.setResonance01(v); break;
      case 'attack': t.setAttackSeconds(v); break;
      case 'decay': t.setDecaySeconds(v); break;
      case 'sustain': t.setSustainLevel(v); break;
      case 'release': t.setReleaseSeconds(v); break;
      case 'lfoRate': t.setLfoBaseRate(v); break;
      case 'lfoDepth': t.setLfoBaseDepth01(v); break;
      default: break;
    }
  }

  _applyEffectSlider(key, v) {
    const t = this.theremin;
    if (key in this.base) this.base[key] = v;
    switch (key) {
      case 'delayMix': t.setDelayMix01(v); break;
      case 'delayTime': t.setDelayTimeSeconds(v); break;
      case 'delayFeedback': t.setDelayFeedback01(v); break;
      case 'pingWidth': t.setPingPongWidth01(v); break;
      case 'reverbMix': t.setReverbMix01(v); break;
      case 'reverbSize': t.setReverbSize01(v); break;
      case 'pan': t.setPan(v); break;
      default: break;
    }
  }

  /** Apply generic-synth values (a Randomize result or Sound preset) and move the sliders/selects to match. */
  _applySynthValues(values) {
    const ui = this.ui;
    const t = this.theremin;
    for (const [key, v] of Object.entries(values)) {
      if (key === 'waveform') { t.setWaveform(v); ui.setSelectValue('waveformSelect', v); }
      else if (key === 'filterType') { t.setFilterType(v); ui.setSelectValue('filterTypeSelect', v); }
      else if (key === 'lfoTarget') { t.setLfoTarget(v); ui.setSelectValue('lfoTargetSelect', v); }
      else { this._applySynthSlider(key, v); ui.setSliderValue('synthSliders', key, v); }
    }
  }

  _applyEffectValues(values) {
    for (const [key, v] of Object.entries(values)) {
      this._applyEffectSlider(key, v);
      this.ui.setSliderValue('effectSliders', key, v);
    }
  }

  // -- Instruments (v0.6) ------------------------------------------------------------

  /**
   * Switch instrument. The Theremin's oscillators are never restarted:
   * switching only opens/closes its output gate and re-routes the body input.
   * @param {string} id
   * @param {{applyDefaults?:boolean}} [o] applyDefaults: adopt the instrument's default scale/raga
   */
  setInstrument(id, { applyDefaults = true } = {}) {
    const inst = instrumentById(id);
    this._releaseAllNotes();
    if (this.voices) {
      this.voices.stopDrone();
      this.voices.setVibrato(RV_VIBRATO_RATE_HZ, 0);
    }
    this._droneFifth = null;
    this.rudra.reset();
    this.harp.reset();
    this.fingerTracker.reset();
    this._displayFreq = null;

    this.instrumentId = inst.id;
    const cfg = this.instrumentSettings[inst.id];
    const isContinuous = inst.kind === 'continuous';
    const isBend = inst.kind === 'string-bend';

    this.handControls.fineEnabled = isContinuous;
    this.theremin.setThereminActive(isContinuous);

    if (applyDefaults && inst.defaultEffects) this._applyEffectValues(inst.defaultEffects);
    if (applyDefaults && inst.defaultRoot !== undefined) { this.rootPc = inst.defaultRoot; this.ui.el.rootSelect.value = String(this.rootPc); }
    if (applyDefaults && inst.defaultScale) {
      if (isBend) this.ragaName = inst.defaultScale;
      else if (SCALE_NAMES.includes(inst.defaultScale)) this.scaleName = inst.defaultScale;
      this.pitchModeProcessor.reset();
    }
    // Discrete instruments have no "pitch mode" concept: notes come from the layout.
    if (!isContinuous && this.pitchMode !== 'continuous') this.setPitchMode('continuous');

    const ui = this.ui;
    ui.setActiveInstrument(inst.id);
    ui.setInstrumentPanel({
      blurb: inst.blurb,
      isTheremin: isContinuous,
      showPolyphony: !isContinuous && !inst.monophonic,
    });
    ui.setSelectValue('polyphonySelect', cfg.polyphony);
    ui.setSelectValue('stealSelect', cfg.steal);
    this._instOverride = {};
    this._renderInstrumentSliders();
    this._renderInstrumentOptions();
    this._syncScaleMenu();

    ui.setModeRowVisible(isContinuous);
    document.body.dataset.instrument = inst.id;
    this._refreshModeChrome();
    this._refreshPitchGrid();
    this._rebuildLayouts();
    this._applyInstrumentToEngine();
  }

  /** Instrument params with any live expressive-mapping overrides applied. */
  _params(id) {
    return this.instrumentId === id && Object.keys(this._instOverride).length
      ? { ...this.instrumentParams[id], ...this._instOverride }
      : this.instrumentParams[id];
  }

  /** Mapping destination `inst:<key>`: move the active instrument's parameter inside its musical window. */
  _setInstrumentParamFraction(key, v01) {
    const def = this.instrument.params.find((d) => d.key === key);
    if (!def) return; // the active instrument doesn't have this parameter: no-op
    const [lo, hi] = def.random ?? [def.min, def.max];
    this._instOverride[key] = Math.min(def.max, Math.max(def.min, lo + clamp01(v01) * (hi - lo)));
    if (this.instrumentId === 'rudra' && (key === 'drone' || key === 'chikariLevel' || key === 'vibrato')) this._applyInstrumentToEngine();
  }

  _clearInstrumentOverride(key) {
    if (key in this._instOverride) { delete this._instOverride[key]; this._applyInstrumentToEngine(); }
  }

  _resetInstrumentInput() {
    this.fingerTracker.reset();
    this.harp.reset();
    this._releaseAllNotes();
    if (this.instrumentId === 'rudra') this.rudra.reset();
  }

  /** Rudra Veena tuning → concrete strings; retunes the drone/chikari system. */
  _refreshTuning() {
    const o = this.instrumentOptions.rudra;
    this.tuning = resolveRudraTuning({
      tuning: o.tuning,
      chikariTuning: o.chikariTuning,
      customMain: [0, 1, 2, 3].map((i) => o[`customMain${i}`]),
      customChikari: [0, 1, 2].map((i) => o[`customChikari${i}`]),
    });
    this.rudra.activeString = Math.min(this.rudra.activeString, this.tuning.melody.length - 1);
    this._applyInstrumentToEngine();
  }

  _renderInstrumentOptions() {
    const inst = this.instrument;
    const values = this.instrumentOptions[inst.id];
    this.ui.renderInstrumentOptions(inst.options ?? [], values, (key, v) => {
      values[key] = v;
      if (inst.id === 'rudra') this._refreshTuning();
      this.ui.renderInstrumentOptions(inst.options ?? [], values, null, true); // refresh showIf visibility
    });
  }

  /** Scale menu shows ragas for the Rudra Veena, scales otherwise. */
  _syncScaleMenu() {
    const isBend = this.instrument.kind === 'string-bend';
    this.ui.setScaleOptions(isBend ? RAGA_NAMES : SCALE_NAMES, isBend ? this.ragaName : this.scaleName, isBend ? 'Raga' : 'Scale');
    this.ui.el.rootSelect.value = String(this.rootPc);
  }

  /** Harp layout depend on instrument + root + scale. */
  _rebuildLayouts() {
    const inst = this.instrument;
    this.harpLayout = null;
    if (inst.kind === 'strings') this.harpLayout = buildHarpLayout({ rootPc: this.rootPc, scaleName: this.scaleName });
    this._releaseAllNotes();
  }

  _releaseAllNotes() {
    for (const f of this.fingerTracker.fingers) { f.note = null; f.lastNote = null; }
    if (this.voices) this.voices.killAll();
  }

  /** Scale row / grid / mode label depend on both the pitch mode and the instrument. */
  _refreshModeChrome() {
    const inst = this.instrument;
    const isContinuous = inst.kind === 'continuous';
    this.ui.setScaleRowVisible(!isContinuous || SCALE_MODES.includes(this.pitchMode));
    this.ui.setPitchGridVisible(isContinuous && this.pitchMode !== 'continuous');
    this.ui.setNoteModeLabel(isContinuous ? this._modeLabel(this.pitchMode) : inst.name);
  }

  _modeLabel(mode) {
    return { continuous: 'Continuous', chromatic: 'Chromatic', 'snap-scale': 'Snap to Scale', 'filter-scale': 'Filter Out of Scale', 'easy-scale': 'Easy Scale' }[mode] ?? mode;
  }

  _renderInstrumentSliders() {
    const inst = this.instrument;
    const params = this.instrumentParams[inst.id];
    this.ui.renderSliders(
      'instrumentSliders',
      inst.params.map((d) => ({ key: d.key, label: d.label, min: d.min, max: d.max, step: d.step, value: params[d.key], format: d.format })),
      (key, v) => {
        params[key] = v;
        this._onInstrumentParamChanged(key);
      }
    );
  }

  _onInstrumentParamChanged(_key) {
    this._applyInstrumentToEngine();
    this._refreshRudraSa();
  }

  /** Push instrument settings into the running voice engine (no-op before Start). */
  _applyInstrumentToEngine() {
    const v = this.voices;
    if (!v) return;
    const inst = this.instrument;
    const cfg = this.instrumentSettings[inst.id];
    v.setMaxPolyphony(cfg.polyphony);
    v.setStealStrategy(cfg.steal);
    if (inst.kind === 'string-bend') {
      const p = this._params(inst.id);
      if (this.instrumentOptions.rudra.droneMode !== 'on') { v.stopDrone(); this._droneKey = null; v.setVibrato(RV_VIBRATO_RATE_HZ, p.vibrato * RV_VIBRATO_MAX_CENTS); return; }
      const sa = this._rudraSaFreq();
      const strings = this.tuning.chikari.map((c) => ({ freq: sa * Math.pow(2, c.cents / 1200) }));
      const key = this.tuning.chikari.map((c) => c.cents).join(',');
      if (this._droneKey !== null && this._droneKey !== key && v.drone && v.drone.strings.length !== strings.length) v.stopDrone();
      this._droneKey = key;
      v.startDrone({
        strings,
        bedLevel: p.drone,
        cycleLevel: Math.min(1.4, p.chikariLevel * 0.85),
        recipeFor: () => inst.makeChikariRecipe({ ...this._params(inst.id), chikariLevel: 1 }, { velocity: 0.6, cycle: true }), // loudness comes from the cycle gain
      });
      v.setDroneLevels(p.drone, Math.min(1.4, p.chikariLevel * 0.85));
      v.setVibrato(RV_VIBRATO_RATE_HZ, p.vibrato * RV_VIBRATO_MAX_CENTS);
    } else {
      v.stopDrone();
      v.setVibrato(RV_VIBRATO_RATE_HZ, 0);
    }
  }

  _rudraSaFreq() {
    const p = this.instrumentParams.rudra;
    return midiToFreq(12 * (Math.round(p.saOctave) + 1) + this.rootPc);
  }

  _refreshRudraSa() {
    if (this.voices && this.instrumentId === 'rudra') {
      const sa = this._rudraSaFreq();
      this.voices.drone?.setFrequencies(this.tuning.chikari.map((c) => sa * Math.pow(2, c.cents / 1200)));
    }
  }


  // -- Sound presets / Randomize ------------------------------------------------------

  /**
   * ONE tap, EVERYTHING (Build 028): Instrument · Scale · Performance · Mapping · Synth · Effects · Display (see presets.js).
   * @param {string} id
   */
  applyUnifiedPreset(id) { this._quiet(() => this._applyUnifiedNow(id), 0.14); }

  /**
   * Run a change that cannot be made smoothly (a new patch, Randomize, a waveform swap) without clicks or a jump in level:
   * the output dips to silence (~25 ms), the change is made, and the level comes back gently. Without running audio it runs at once.
   */
  _quiet(fn, fadeInTau = 0.16) {
    const t = this.theremin;
    if (!t?.isRunning) { fn(); return; }
    (this._quietQ ??= []).push(fn);
    this._quietTau = Math.max(this._quietTau ?? 0, fadeInTau);
    if (this._quietT) return;
    t.duck();
    this._quietT = setTimeout(() => {
      const q = this._quietQ; const tau = this._quietTau; this._quietQ = []; this._quietT = null; this._quietTau = 0;
      for (const f of q) { try { f(); } catch (err) { console.error(err); } }
      this.theremin.unduck(tau);
    }, 45);
  }

  _applyUnifiedNow(id) {
    const p = typeof id === 'string' ? this._presetById(id) : id;
    if (!p) return;
    const ui = this.ui;
    // Instrument (+ its options and own parameters, always from the instrument's defaults so nothing is left over)
    this.setInstrument(p.instrument.id, { applyDefaults: false });
    const inst = this.instrument;
    Object.assign(this.instrumentOptions[inst.id], p.instrument.options ?? {});
    Object.assign(this.instrumentParams[inst.id], defaultParams(inst), p.instrument.params ?? {});
    if (inst.id === 'rudra') this._refreshTuning();
    this._renderInstrumentOptions();
    this._renderInstrumentSliders();
    // Scale
    this.rootPc = p.scale.root;
    ui.el.rootSelect.value = String(this.rootPc);
    if (inst.kind === 'string-bend') this.ragaName = p.scale.name; else if (SCALE_NAMES.includes(p.scale.name)) this.scaleName = p.scale.name;
    this.pitchModeProcessor.reset();
    // Performance
    if (p.performance.pitchMode) this.setPitchMode(p.performance.pitchMode);
    if (p.performance.sensitivity) { this.handControls.setSensitivity(p.performance.sensitivity); ui.setSensitivityDisplay(this.handControls.sensitivity); }
    if (p.performance.face !== undefined && p.performance.face !== this.faceEnabled) { ui.setCheckbox('faceTrackingToggle', p.performance.face); this.setFaceTracking(p.performance.face); }
    // Mapping
    this.mapping.setMappings(p.mapping);
    ui.renderMappingEditor();
    // Synth + Effects
    this._applySynthValues(p.synth);
    const { delayMode, ...fx } = p.effects;
    this._applyEffectValues(fx);
    if (delayMode) { this.theremin.setDelayMode(delayMode); ui.setSelectValue('delayModeSelect', delayMode); }
    // refresh everything that depends on instrument + root + scale
    this._syncScaleMenu();
    this._refreshPitchGrid();
    this._rebuildLayouts();
    this._refreshRudraSa();
    this._onInstrumentParamChanged(null);
    // Display
    this.applyDisplay(this.privacy && p.display.filter === 'off' ? { ...p.display, filter: 'facets', density: 0.5 } : p.display); // Privacy mode: a preset never leaves the picture unfiltered
    this._activePresetId = p.id;
    ui.setActivePreset(p.id);
    ui.setPresetCoreNote(p.blurb);
    ui.setStatusChip?.(p.name);
    this.perf.setNote?.(p.name);
  }

  /** Apply the current display level to everything that draws (polygon filter, glitch, CRT layers) and say so in the Display section. */
  _applyDisplayLevel() {
    const l = this.displayLevel; const q = qualityOf(l);
    this.cameraFilter.setQuality(l); this.glitch.setSuppressed(!q.glitch);
    document.body.classList.toggle('perf-lite', l === 1); document.body.classList.toggle('perf-minimal', l === 2);
    const auto = this.perfSettings.mode === 'auto';
    const what = ['all effects at their best.', 'coarser polygons, no motion smoothing, no Glitch, a simpler CRT: keeps the sound steady on phones.', 'the lightest picture: very coarse polygons, slow refresh, no CRT layers, no Glitch.'][l];
    this.ui.el.displayPerfStatus.textContent = `${auto ? 'Auto → ' : ''}${q.name[0].toUpperCase() + q.name.slice(1)}: ${what}${auto && l > 0 ? ' (Choose Full to override.)' : ''}`;
  }

  /** The watchdog found the picture too expensive: one level lighter, remembered for the next visit. */
  _stepDisplayDown() {
    if (this.displayLevel >= 2) return;
    this.displayLevel += 1; this.perfSettings.learned = Math.max(this.perfSettings.learned, this.displayLevel); if (this._store) saveLearned(this._store, this.perfSettings.learned);
    this._applyDisplayLevel();
    const name = qualityOf(this.displayLevel).name[0].toUpperCase() + qualityOf(this.displayLevel).name.slice(1);
    const msg = `Picture lightened to ${name} to keep the sound smooth`;
    this.ui.showToast(msg);
  }

  _presetById(id) { return unifiedPresetById(id) ?? this.userPresets.find((q) => q.id === id) ?? null; }
  _renderPresets() { this.ui.renderPresetButtons(UNIFIED_PRESETS, (id) => this.applyUnifiedPreset(id), PRESET_GROUPS, this.userPresets); this.ui.setActivePreset(this._activePresetId); }

  /** The whole current patch in the shape of a preset (so My presets and built-in presets are applied by the same code). */
  captureState() {
    const inst = this.instrument; const t = this.theremin; const e = this.ui.el;
    const sliders = (key) => { const out = {}; for (const inp of e[key].querySelectorAll('input[data-key]')) { const v = parseFloat(inp.value); if (Number.isFinite(v)) out[inp.dataset.key] = v; } return out; };
    const scaleName = inst.kind === 'string-bend' ? this.ragaName : this.scaleName;
    return {
      blurb: `${inst.name} · ${ROOT_NAMES[this.rootPc]} ${scaleName}`,
      instrument: { id: inst.id, options: { ...(this.instrumentOptions[inst.id] ?? {}) }, params: { ...(this.instrumentParams[inst.id] ?? {}) } },
      scale: { root: this.rootPc, name: scaleName },
      performance: { pitchMode: this.pitchMode, sensitivity: this.handControls.sensitivity, face: this.faceEnabled },
      mapping: this.mapping.exportAssignedRows(),
      synth: { ...sliders('synthSliders'), waveform: t.waveform, filterType: t.filterType, lfoTarget: t.lfoTarget },
      effects: { ...sliders('effectSliders'), delayMode: t.delayMode },
      display: this.getDisplayState(),
    };
  }

  /** The current Display settings, read from the real controls (the inverse of applyDisplay). */
  getDisplayState() {
    const e = this.ui.el; const n = (el) => Number(el.value) / 100;
    return {
      filter: e.cameraFilterSelect.value, density: n(e.filterDensity), colorMode: e.filterColorMode.value, base: e.filterBase.value, dark: e.filterDark.value, bright: e.filterBright.value, music: e.filterMusic.value,
      glitch: { amount: n(e.glitchAmount), frequency: n(e.glitchFrequency), blockSize: n(e.glitchBlock), rgbSplit: n(e.glitchRgb), displace: n(e.glitchDisplace), noise: n(e.glitchNoise), hold: n(e.glitchHold) },
      bodyVisual: e.bodyVisualSelect.value, background: e.backgroundSelect.value, faceHud: e.faceHudSelect.value, backgroundColor: e.backgroundColor.value,
      crt: { on: this.crt.on, amount: this.crt.amount },
    };
  }

  // -- My presets (Build 030) ------------------------------------------------------------------------------------------------------------
  _bindUserPresets() {
    const ui = this.ui; const e = ui.el; const say = (t) => { e.userPresetStatus.textContent = t; };
    e.userPresetSave.addEventListener('click', () => {
      if (this.userPresets.length >= 60) { say('You have 60 presets: delete one first.'); return; }
      const name = uniqueName(e.userPresetName.value || `Patch ${this.userPresets.length + 1}`, this.userPresets);
      const p = makeUserPreset(name, this.captureState());
      if (!p) { say('Could not build the preset.'); return; }
      this.userPresets.push(p);
      const ok = this._store ? saveUserPresets(this._store, this.userPresets) : false;
      this._activePresetId = p.id; this._renderPresets(); e.userPresetName.value = '';
      say(ok ? `Saved “${p.name}” in this browser.` : `Saved “${p.name}” for this visit only (browser storage is unavailable). Use Export JSON to keep it.`);
    });
    e.userPresetDelete.addEventListener('click', () => {
      const i = this.userPresets.findIndex((q) => q.id === this._activePresetId);
      if (i < 0) { say('Select one of My presets first, then press Delete.'); return; }
      const [gone] = this.userPresets.splice(i, 1); if (this._store) saveUserPresets(this._store, this.userPresets);
      this._activePresetId = null; this._renderPresets(); say(`Deleted “${gone.name}”.`);
    });
    e.userPresetExport.addEventListener('click', () => {
      if (!this.userPresets.length) { say('Nothing to export yet.'); return; }
      this._download(new Blob([exportUserPresets(this.userPresets)], { type: 'application/json' }), 'ether-veena-my-presets.json'); say(`Exported ${this.userPresets.length} preset(s).`);
    });
    e.userPresetImport.addEventListener('click', () => e.userPresetFile.click());
    e.userPresetFile.addEventListener('change', async () => {
      const f = e.userPresetFile.files?.[0]; e.userPresetFile.value = ''; if (!f) return;
      if (f.size > 2e6) { say('That file is too large to be a preset file.'); return; }
      const r = importUserPresets(await f.text(), this.userPresets);
      if (r.error) { say(r.error); return; }
      this.userPresets = r.list; if (this._store) saveUserPresets(this._store, this.userPresets); this._renderPresets();
      say(`Imported ${r.added} preset(s)${r.skipped ? `, skipped ${r.skipped} unusable` : ''}.`);
    });
  }

  _download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /** Apply a full display description (a preset's `display`, or randomizeDisplay()) by driving the real controls, so the UI always matches. */
  applyDisplay(d) {
    const e = this.ui.el;
    const set = (el, v, evt) => { if (!el) return; el.value = String(v); el.dispatchEvent(new Event(evt, { bubbles: true })); };
    set(e.cameraFilterSelect, d.filter, 'change');
    set(e.filterDensity, Math.round(d.density * 100), 'input');
    set(e.filterColorMode, d.colorMode, 'change');
    set(e.filterBase, d.base, 'input'); set(e.filterDark, d.dark, 'input'); set(e.filterBright, d.bright, 'input');
    set(e.filterMusic, d.music, 'change');
    const g = d.glitch;
    for (const [el, key] of [['glitchFrequency', 'frequency'], ['glitchBlock', 'blockSize'], ['glitchRgb', 'rgbSplit'], ['glitchDisplace', 'displace'], ['glitchNoise', 'noise'], ['glitchHold', 'hold'], ['glitchAmount', 'amount']]) set(e[el], Math.round(g[key] * 100), 'input');
    set(e.bodyVisualSelect, d.bodyVisual, 'change');
    if (d.backgroundColor) set(e.backgroundColor, d.backgroundColor, 'input');
    set(e.backgroundSelect, d.background, 'change');
    set(e.faceHudSelect, d.faceHud, 'change');
    this.setCrt(d.crt);
  }

  /** @param {{mapping?:boolean, synth?:boolean, effects?:boolean, rootscale?:boolean}} cats */
  randomize(cats) { this._quiet(() => this._randomizeNow(cats), 0.2); }

  _randomizeNow(cats) {
    const done = [];
    const inst = this.instrument;
    if (cats.synth) {
      this._applySynthValues(lockSynth(randomizeSynth(), this.locks));
      if (inst.params.length) {
        const rnd = randomizeInstrumentParams(inst);
        Object.assign(this.instrumentParams[inst.id], rnd);
        for (const [k, v] of Object.entries(rnd)) this.ui.setSliderValue('instrumentSliders', k, v);
        this._onInstrumentParamChanged(null);
      }
      this.ui.setActivePreset(null);
      done.push('Synth');
    }
    if (cats.effects) {
      const { delayMode, ...fx } = lockEffects({ ...randomizeEffects(), delayMode: randomizeDelayMode() }, this.locks);
      this._applyEffectValues(fx);
      if (delayMode) { this.theremin.setDelayMode(delayMode); this.ui.setSelectValue('delayModeSelect', delayMode); }
      done.push('Effects');
    }
    if (cats.rootscale) {
      const rs = randomizeRootScale(Math.random, { instrumentId: inst.id, ragaNames: RAGA_NAMES });
      const rootPc = this.locks.root ? this.rootPc : rs.rootPc;
      const scaleName = this.locks.scale ? (inst.kind === 'string-bend' ? this.ragaName : this.scaleName) : rs.scaleName;
      this.rootPc = rootPc;
      if (inst.kind === 'string-bend') this.ragaName = scaleName; else this.scaleName = scaleName;
      this._syncScaleMenu();
      this.pitchModeProcessor.reset();
      this._refreshPitchGrid();
      this._rebuildLayouts();
      this._refreshRudraSa();
      let tuningNote = '';
      if (inst.id === 'rudra' && !(this.locks.root && this.locks.scale)) {
        // the Rudra Veena is retuned by its player every day: a researched tuning (or a custom one) comes with the root and raga
        Object.assign(this.instrumentOptions.rudra, randomizeRudraTuning());
        this._refreshTuning();
        this._renderInstrumentOptions();
        const mt = MAIN_TUNINGS.find((t) => t.id === this.instrumentOptions.rudra.tuning);
        tuningNote = `, ${mt ? mt.name.split(' (')[0] : 'tuning'}`;
      }
      done.push(`${inst.kind === 'string-bend' ? 'Root & Raga' : 'Root & Scale'} (${ROOT_NAMES[rootPc]} ${scaleName}${tuningNote})`);
    }
    if (cats.display) { this.applyDisplay(lockDisplay(randomizeDisplay(Math.random, { privacy: this.privacy }), this.getDisplayState(), this.locks, { privacy: this.privacy })); this.ui.setActivePreset(null); done.push('Display'); }
    if (cats.mapping) {
      const rows = randomizeMapping(Math.random, { includeFace: this.faceEnabled, instrumentId: inst.id });
      this.mapping.setMappings(rows);
      this._activePresetId = null;
      this.ui.setActivePreset(null);
      this.ui.setPresetCoreNote('Randomized mapping. Finger inputs stay reserved for playing the instrument.');
      this.ui.renderMappingEditor();
      done.push('Mapping');
    }
    const nLocked = LOCKS.filter(([id]) => this.locks[id]).length;
    this.ui.setRandomizeStatus(done.length ? `Randomized: ${done.join(', ')}${nLocked ? ` (${nLocked} locked)` : ''}. Press again for another take.` : 'Tick at least one category first.');
  }

  async init() {
    this._loadVersion();
    registerServiceWorker();
  }

  // -- Presets ----------------------------------------------------------------

  applyPreset(id) {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    this.mapping.setMappings(preset.mappings);
    if (preset.settings?.sensitivity) {
      this.handControls.setSensitivity(preset.settings.sensitivity);
      this.ui.setSensitivityDisplay(this.handControls.sensitivity);
    }
    this._activePresetId = id;
    this.ui.setActivePreset(id);
    this.ui.setPresetCoreNote(preset.coreNote);
    this.ui.renderMappingEditor();
  }

  // -- Face tracking (optional) -------------------------------------------------

  async setFaceTracking(enabled) {
    if (!enabled) {
      this.faceEnabled = false;
      this._lastFaceResult = null;
      this.ui.setFaceTrackingStatus('Face tracking is off — turn it on to use mouth, smile, eyes, eyebrows and head rotation as triggers.');
      return;
    }
    if (!this.faceTracker.landmarker) {
      this.faceLoading = true;
      this.ui.setFaceTrackingStatus('Loading face model…');
      try {
        await this.faceTracker.load();
      } catch (err) {
        console.error('Face tracking failed to load:', err);
        this.faceLoading = false;
        this.faceEnabled = false;
        this.ui.el.faceTrackingToggle.checked = false;
        this.ui.setFaceTrackingStatus('Could not load the face model (check your connection). Hand tracking is unaffected.');
        return;
      }
      this.faceLoading = false;
    }
    this.faceEnabled = true;
    this.ui.setFaceTrackingStatus('Face tracking is on. It runs at a reduced rate so hand tracking stays responsive.');
  }

  // -- Session lifecycle -----------------------------------------------------------

  async toggleStart() {
    if (this.isLive) { this.stop(); return; }
    await this.start();
  }

  async start() {
    this.ui.clearError();
    this.ui.setStartButtonState('loading');
    this.ui.setTrackingState('off');

    try {
      await this.camera.start();
      this.ui.setMirrored(this.camera.facingMode === 'user');
      this.handControls.isMirrored = this.camera.facingMode === 'user';
      this.overlay.setMirrored(this.camera.facingMode === 'user');

      if (!this.handTracker.landmarker) await this.handTracker.load();
      await this.theremin.start();
      this.voices = new VoiceManager(this.theremin.audioContext, this.theremin.getVoiceDestination(), {
        maxPolyphony: this.instrumentSettings[this.instrumentId].polyphony,
        stealStrategy: this.instrumentSettings[this.instrumentId].steal,
      });
      this._applyInstrumentToEngine();
      this.theremin.triggerEnvelope(true); // sound is "on" by default; only Filter Scale ever closes it

      this._scopeBuffer = new Uint8Array(this.theremin.getAnalyserFftSize());
      this._prevTouched.clear();
      this._frameCounter = 0;

      this.isLive = true;
      this.wakeLock.acquire(); // Screen Wake Lock: the phone does not fall asleep while you play
      this.ui.setStageLive(true);
      this.ui.setStartButtonState('live');
      this.ui.setTrackingState('searching');
      this._refreshZoneLayout();
      this.overlay.resize();
      this._rebuildLayouts();
      this._applyInstrumentToEngine();
      this.ui.setCalibrationMode(this.handControls.isCalibrated ? 'calibrated' : 'default');
      this._runLoop();
    } catch (err) {
      this._handleStartError(err);
      this.camera.stop();
      this.ui.setStartButtonState('idle');
      this.ui.setStageLive(false);
      this.ui.setTrackingState('off');
    }
  }

  stop() {
    this.isLive = false;
    this.wakeLock.release();
    if (this._loopHandle) { cancelAnimationFrame(this._loopHandle); this._loopHandle = null; }
    this._cancelCalibrationCountdown();
    if (this.voices) { this.voices.dispose(); this.voices = null; }
    this.fingerTracker.reset();
    this.harp.reset();
    this.rudra.reset();
    this.cursor.reset();
    this.perf.exit();
    this._drawState = null;
    this.overlay.clear();
    this.theremin.stop();
    this.camera.stop();
    this.handControls.reset();
    this.pitchModeProcessor.reset();
    this._lastFaceResult = null;
    this.ui.setStartButtonState('idle');
    this.ui.setStageLive(false);
    this.ui.setTrackingState('off');
    this.ui.updateZoneCursors(null, null);
    this.ui.updateFinePitchGlow(null);
    this.ui.setVibratoActive(false);
    this.ui.updatePitchGridIndicator(null);
    this.ui.setNoteName('—');
    this.ui.setPitchNoteChip('—');
    this.ui.updateReadouts(null, null);
    this.ui.setOverlayVisibility(this.display); // also clears the scope canvas if it was on
    for (const card of ['rightHandCard', 'leftHandCard', 'faceCard']) this.ui.el[card].classList.remove('is-visible');
  }

  async switchCamera() {
    if (!this.isLive || !this.camera.hasMultipleCameras) return;
    try {
      const facingMode = await this.camera.switchFacing();
      this.ui.setMirrored(facingMode === 'user');
      this.handControls.isMirrored = facingMode === 'user';
      this.overlay.setMirrored(facingMode === 'user');
      this.fingerTracker.reset();
      this.handControls.reset();
      this.handControls.resetCalibration();
      this._refreshZoneLayout();
      this.ui.setCalibrationMode('default');
    } catch (err) {
      this._handleStartError(err);
      this.stop();
    }
  }

  // -- Calibration -----------------------------------------------------------------

  startCalibrationCountdown() {
    if (!this.isLive || this._countdownInterval || this._countdownTimeout) return;
    let remaining = CALIBRATION_COUNTDOWN_SECONDS;
    this.ui.el.calibrateButton.disabled = true;
    this.ui.showCalibrationCountdown(remaining);

    this._countdownInterval = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) { this.ui.showCalibrationCountdown(remaining); return; }
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
      this.ui.showCalibrationCountdown('Ready!');
      this._countdownTimeout = setTimeout(() => {
        this._countdownTimeout = null;
        this.ui.hideCalibrationCountdown();
        this.calibrate();
        this.ui.el.calibrateButton.disabled = !this.isLive;
      }, 400);
    }, 1000);
  }

  _cancelCalibrationCountdown() {
    if (this._countdownInterval) { clearInterval(this._countdownInterval); this._countdownInterval = null; }
    if (this._countdownTimeout) { clearTimeout(this._countdownTimeout); this._countdownTimeout = null; }
    this.ui.hideCalibrationCountdown();
  }

  calibrate() {
    if (!this.isLive) return;
    const result = this.handControls.calibrate();
    this._refreshZoneLayout();
    if (result.success) this._rebuildLayouts();
    this.ui.flashCalibrationResult(result.success, this.handControls.isCalibrated ? 'calibrated' : 'default');
  }

  setSensitivity(value) {
    this.handControls.setSensitivity(value);
    this.ui.setSensitivityDisplay(this.handControls.sensitivity);
    this._refreshZoneLayout();
  }

  // -- Pitch modes / grid --------------------------------------------------------------

  setPitchMode(mode) {
    if (mode === this.pitchMode) return;
    this.pitchMode = mode;
    this.pitchModeProcessor.reset();
    this.ui.setActiveMode(mode);
    this._refreshModeChrome();
    this._refreshPitchGrid();
  }

  _refreshZoneLayout() {
    const { rangeX, rangeY } = this.handControls.getZoneRanges();
    this.ui.setZoneLayout(this.handControls.rightCenter, this.handControls.leftCenter, rangeX, rangeY);
  }

  _refreshPitchGrid() {
    this.ui.renderPitchGrid(this.pitchMode === 'continuous' ? [] : this._buildGridTicks());
  }

  _buildGridTicks() {
    const minMidi = Math.round(this._minMidi);
    const maxMidi = Math.round(this._maxMidi);
    const span = this._maxMidi - this._minMidi;

    if (this.pitchMode === 'chromatic') {
      const ticks = [];
      for (let m = minMidi; m <= maxMidi; m++) {
        const isC = mod12(m) === 0;
        ticks.push({ fraction: (m - this._minMidi) / span, isRoot: isC, label: isC ? midiToNoteName(m, this.useFlats).fullName : null });
      }
      return ticks;
    }

    const pcSet = scalePitchClassSet(this.rootPc, this.scaleName);
    if (this.pitchMode === 'snap-scale' || this.pitchMode === 'filter-scale') {
      const ticks = [];
      for (let m = minMidi; m <= maxMidi; m++) {
        if (!pcSet.has(mod12(m))) continue;
        const isRoot = mod12(m) === this.rootPc;
        ticks.push({ fraction: (m - this._minMidi) / span, isRoot, label: isRoot ? midiToNoteName(m, this.useFlats).name : null });
      }
      return ticks;
    }

    if (this.pitchMode === 'easy-scale') {
      const base = easyScaleBaseMidi(MIN_FREQ_HZ, MAX_FREQ_HZ, this.rootPc);
      const ticks = [];
      for (let m = base; m <= base + 12; m++) {
        if (!pcSet.has(mod12(m))) continue;
        ticks.push({ fraction: (m - base) / 12, isRoot: mod12(m) === this.rootPc, label: midiToNoteName(m, this.useFlats).name });
      }
      return ticks;
    }
    return [];
  }

  _updateGridIndicator(modeResult) {
    if (this.pitchMode === 'continuous') return;
    let fraction;
    if (this.pitchMode === 'easy-scale') {
      fraction = (modeResult.continuousMidi - easyScaleBaseMidi(MIN_FREQ_HZ, MAX_FREQ_HZ, this.rootPc)) / 12;
    } else {
      fraction = (modeResult.continuousMidi - this._minMidi) / (this._maxMidi - this._minMidi);
    }
    this.ui.updatePitchGridIndicator(fraction, this.pitchMode === 'filter-scale' && modeResult.gate01 === 0);
  }

  // -- Main loop --------------------------------------------------------------------------

  _faceState() {
    if (!this.faceEnabled) return this.faceLoading ? 'loading' : 'off';
    return this._lastFaceResult ? 'on' : 'noface';
  }

  _runLoop() {
    const loop = () => {
      if (!this.isLive) return;
      const nowMs = performance.now();
      const workStart = performance.now();
      if (this.cameraFilter.id !== 'off') {
        // the existing audio analysis (AudioBands) and the pitch already shown in the readout drive the colour — no second analysis
        const f = this._displayFreq ?? this.theremin.getFrequencyHz();
        this.cameraFilter.update(nowMs, { bands: this.bands, midi: f > 20 ? midiOfHz(f) : null, level: this.bands.rms });
      }

      this.glitch.update(nowMs); // after the polygon filter, before anything is drawn above it
      if (this.perfSettings.mode === 'auto' && this.displayLevel < 2 && (this.cameraFilter.id !== 'off' || this.glitch.enabled)) {
        // the watchdog: what the picture cost this frame, and how long frames take overall
        if (this.loadWatch.sample(this._lastLoopAt ? nowMs - this._lastLoopAt : 0, performance.now() - workStart) === 'down') this._stepDisplayDown();
      }
      this._lastLoopAt = nowMs;

      const result = this.handTracker.detect(this.ui.el.video);
      if (result) {
        this._frameCounter += 1;
        const hand = this.handControls.process(result);

        // Face: optional and throttled so it never starves hand tracking.
        if (this.faceEnabled && this._frameCounter % FACE_DETECT_EVERY_N_FRAMES === 0) {
          const face = this.faceTracker.detect(this.ui.el.video);
          if (face) this._lastFaceResult = face.faceBlendshapes?.length ? face : null;
        }

        const triggerValues = this.triggerEngine.process(hand, this._faceEnabledResult());
        const inst = this.instrument;

        // Per-fingertip state (position in STAGE coordinates, curl, press/release events)
        const geom = this.overlay.geom;
        this._lastLandmarks = { left: hand.leftLandmarks, right: hand.rightLandmarks };
        const fingers = this.fingerTracker.update(hand, geom, nowMs);
        if (this.handCheck.enabled) {
          this.handCheck.render(this.handControls.lastDiagnostics, {
            geom,
            cssMirrored: this.ui.el.video.classList.contains('is-mirrored'),
            facingMode: this.camera.facingMode,
            fingerPresent: { left: !!this.fingerTracker.byId['left-index']?.present, right: !!this.fingerTracker.byId['right-index']?.present },
          });
        }

        // Body HUD pose (display only, lazy + throttled)
        this._runPose(nowMs);

        // Performance Mode: pointing finger = mouse cursor; that hand doesn't play notes meanwhile
        const suppress = this._runCursor(nowMs);

        this.ui.updateZoneCursors(hand.rightOffset, hand.volume01);
        this.ui.updateFinePitchGlow(hand.fineOffset);
        this._refreshZoneLayout();

        let noteLabel = null;
        let instrumentDraw = null;
        this._displayFreq = null;

        // MENU mode (a Performance-Mode menu is open, or we are settling after closing it):
        // the body belongs to the UI. Tracking and drawing continue; the instrument does not listen.
        const playing = this.interaction.instrumentActive(nowMs);

        if (!playing) {
          instrumentDraw = this._idleInstrumentDraw(inst);
          this.theremin.setVolume01(0);
        } else {
          switch (inst.kind) {
            case 'strings':
              instrumentDraw = this._runHarp(inst, nowMs, suppress);
              this.theremin.setVolume01(FIXED_VOLUME01);
              break;
            case 'string-bend': {
              const r = this._runRudra(inst, hand, nowMs, suppress);
              noteLabel = r.noteLabel;
              instrumentDraw = r.draw;
              this.theremin.setVolume01(FIXED_VOLUME01);
              break;
            }
            default:
              noteLabel = this._runTheremin(hand, nowMs);
          }
        }

        // Trigger → Mapping → Parameter (expressive layer; suspended in menu mode)
        if (!playing) this.mapping.lastRowOutputs = [];
        const touched = playing ? this.mapping.process(triggerValues) : new Set();
        for (const id of this._prevTouched) if (!touched.has(id)) this._restoreDestination(id);
        this._prevTouched = touched;

        this.theremin.setVibrato(hand.vibrato, {
          rateMapped: touched.has('lfoRate'),
          depthMapped: touched.has('lfoDepth'),
        });
        this.ui.setVibratoActive(hand.vibrato.active);

        const freq = this._displayFreq ?? this.theremin.getFrequencyHz();
        this.ui.updateReadouts(freq, this.theremin.currentVolume01);
        if (this.display.pitchNote) {
          const chip = noteLabel ? `${noteLabel} · ${freq.toFixed(0)} Hz` : this._instrumentStatus(inst);
          this.ui.setPitchNoteChip(chip);
        }
        this.ui.renderTriggerOverlay({
          triggerValues,
          lastOutputs: this.mapping.lastOutputs,
          right: hand.right,
          left: hand.left,
          faceState: this._faceState(),
        });
        this.ui.setTrackingState(hand.right || hand.left ? 'tracking' : 'searching');

        this._drawState = {
          instrumentId: inst.id,
          showBody: this.display.body,
          fingers,
          landmarks: { left: hand.leftLandmarks, right: hand.rightLandmarks },
          faceLandmarks: this.faceEnabled ? this._lastFaceResult?.faceLandmarks?.[0] ?? null : null,
          isMapped: (id) => this.mapping.getRow(id)?.destination !== 'none',
          triggerValues,
          instrument: instrumentDraw,
          triggerItems: this._triggerItems(triggerValues),
          anchorFor: (id) => anchorFor(id, { tracker: this.fingerTracker, faceLandmarks: this.faceEnabled ? this._lastFaceResult?.faceLandmarks?.[0] ?? null : null, geom: this.overlay.geom }),
        };
      }

      // Audio-reactive visuals follow the real output (analyser after every instrument + effect)
      const bgMode = this.background.mode;
      const needBands = bgMode !== 'camera' || this.overlay.body.mode === 'reactive' || (this.cameraFilter.id !== 'off' && this.cameraFilter.musicMode !== 'off');
      if (needBands) this.bands.update(this.theremin.analyser ?? null, this.theremin.audioContext?.sampleRate ?? 44100);
      if (bgMode === 'mandala') this.mandala.draw(this.bands, nowMs, { alpha: 1 });
      else if ((bgMode === 'color' || bgMode === 'image') && this.background.reactiveLayer) this.mandala.draw(this.bands, nowMs, { alpha: 0.4 });
      else this.mandala.clear();

      // The overlay animates (string vibration, meend trail) even between tracking frames.
      if (this._drawState) this.overlay.draw({ ...this._drawState, now: nowMs, bands: this.bands });

      if (this.display.scope && this.theremin.readWaveform(this._scopeBuffer)) {
        this.ui.drawOscilloscope(this._scopeBuffer);
      }

      this._loopHandle = requestAnimationFrame(loop);
    };
    this._loopHandle = requestAnimationFrame(loop);
  }

  // -- Theremin -----------------------------------------------------------------------

  /** Continuous pitch (right) / volume (left), plus safe tracking-loss behaviour. */
  _runTheremin(hand, nowMs) {
    let noteLabel = null;
    let modeResult = null;
    if (hand.right && hand.pitch01 !== null) {
      modeResult = this.pitchModeProcessor.process({
        pitch01: hand.pitch01,
        mode: this.pitchMode,
        rootPc: this.rootPc,
        scaleName: this.scaleName,
      });
      this.theremin.setTargetFrequencyHz(modeResult.targetFreqHz);
      this.theremin.triggerEnvelope(modeResult.gate01 > 0.5);
      noteLabel = midiToNoteName(modeResult.displayMidi, this.useFlats).fullName;
      this._displayFreq = modeResult.targetFreqHz;
      this.ui.setNoteName(noteLabel);
      this._updateGridIndicator(modeResult);
    }

    // Right hand lost: the pitch holds, and the sound fades out rather than droning on;
    // when it returns the sound eases back in over ~120 ms (no click, no jump).
    const rightOn = !!hand.right;
    if (rightOn && !this._rightWas) this._reacquireAt = nowMs;
    if (!rightOn && this._rightWas) this._rightLostAt = nowMs;
    this._rightWas = rightOn;
    const gate = rightOn ? clamp01((nowMs - this._reacquireAt) / 120) : 1 - clamp01((nowMs - this._rightLostAt - 150) / 350);

    // left hand = volume (always on)
    if (hand.left && hand.volume01 !== null) this.theremin.setVolume01(hand.volume01 * gate);
    else this.theremin.mute();
    return noteLabel;
  }

  // -- Harp ---------------------------------------------------------------------------

  _runHarp(inst, nowMs, suppress) {
    const layout = this.harpLayout;
    if (!layout || !this.voices) return { layout: layout ?? { strings: [] }, plucks: this.harp.plucks, material: 0.5 };
    const params = this._params(inst.id);
    const plucks = this.harp.update(this.fingerTracker, layout, nowMs, { suppressSides: suppress });
    const cap = this.instrumentSettings[inst.id].polyphony;
    for (const p of plucks) {
      const freq = midiToFreq(p.string.midi);
      const recipe = inst.makeRecipe(params, { freq, velocity: p.velocity });
      this.voices.noteOn({ recipe, freq, velocity: p.velocity, tag: 'string' });
      this.ui.flashPluckIndicator();
      // Sympathetic strings: octave/fifth above ring softly — only if there is headroom.
      if (params.sympathy > 0.02 && harpSympatheticScale(p.string.midi) > 0.05 && this.voices.activeCount < cap * 0.7) {
        for (const sym of sympatheticStrings(layout, p.string.i)) {
          const sf = midiToFreq(sym.midi);
          this.voices.noteOn({ recipe: inst.makeSympatheticRecipe(params, { freq: sf, velocity: p.velocity }), freq: sf, velocity: p.velocity, tag: 'sympathetic' });
        }
      }
    }
    return { layout, plucks: this.harp.plucks, material: params.material };
  }

  // -- Rudra Veena ---------------------------------------------------------------------

  _runRudra(inst, hand, nowMs, suppress) {
    const params = this._params(inst.id);
    const raga = ragaByName(this.ragaName);
    const tuning = this.tuning;
    const saFreq = this._rudraSaFreq();
    const out = this.rudra.update(this.fingerTracker, hand, params, raga, tuning, nowMs);
    const freqOf = (cents) => saFreq * Math.pow(2, cents / 1200);

    if (this.voices) {
      // Left hand lost: the MAIN strings let go; a struck chikari keeps ringing until it is struck again.
      if (out.releaseAll) for (let i = 0; i < tuning.melody.length; i++) this.voices.releaseTag(`main-${i}`, 0.5);
      // The fretted string follows the left hand; only the voice of the PLUCKED string is bent by the left index curl
      // (rudraVoicePitch); every other voice, and anything not yet plucked, is left alone.
      this.voices.applyPitchFn((v) => rudraVoicePitch(out, v), 0.025);
      // Andolan: a small deliberate left-hand wobble deepens and speeds the vibrato.
      const a = this.rudra.andolanState;
      const depth = params.vibrato * RV_VIBRATO_MAX_CENTS + (a.active ? a.depth01 * params.andolan * RV_ANDOLAN_MAX_CENTS : 0);
      this.voices.setVibrato(a.active ? Math.min(8, Math.max(3, a.rateHz)) : RV_VIBRATO_RATE_HZ, depth);

      if (!suppress.has('right')) {
        for (const st of out.strokes) {
          if (st.kind === 'main') {
            const str = tuning.melody[st.index] ?? tuning.melody[out.active];
            const cents = st.index === out.active ? out.cents : str.cents; // fretted string vs open string
            const freq = freqOf(cents);
            const t = `main-${str.index}`;
            this.voices.releaseTag(t, 0.25); // re-plucking a string damps its previous note
            this.voices.noteOn({ recipe: inst.makeRecipe(params, { freq, velocity: st.velocity, stringIndex: str.index }), freq, velocity: st.velocity, originCents: cents, tag: t });
          } else {
            // The chikari is ONE voice (any chikari string or the pinky strum): one sound with beating and a moving
            // overtone, pitched at the lowest chikari string, coloured faintly by the other strings of the tuning.
            const cv = chikariVoice(tuning.chikari);
            if (cv) {
              const freq = freqOf(cv.cents);
              const t = 'chikari';
              this.voices.releaseTag(t, 0.15); // a new stroke replaces the ringing one; otherwise it is never cut short
              this.voices.noteOn({ recipe: inst.makeChikariRecipe(params, { velocity: st.velocity, index: st.kind === 'chikari' ? st.index : 1, phase: Math.random(), extras: cv.extras }), freq, velocity: st.velocity, tag: t });
            }
          }
          this.ui.flashPluckIndicator();
        }
      }
    }

    const freqNow = freqOf(out.cents);
    this._displayFreq = freqNow;
    this.theremin.setTargetFrequencyHz(freqNow); // keeps the gated-off Theremin voice in tune for readouts
    const midi = freqToMidi(saFreq) + out.cents / 100;
    const noteLabel = midiToNoteName(Math.round(midi), this.useFlats).fullName;
    this.ui.setNoteName(noteLabel);
    return {
      noteLabel,
      draw: {
        raga,
        direction: this.rudra.direction.direction,
        ruler: out.ruler,
        span: params.span,
        active: out.active,
        tuning,
        trail: this.rudra.trail,
        strokes: this.rudra.strokes,
        bendCents: this.rudra.bendCents,
        contact: this.rudra.contact,
        pull: this.rudra.pull,
        andolan: this.rudra.andolanState.active,
        params,
      },
    };
  }

  /** Camera image / sound-reactive mandala / solid colour / custom image behind the instrument. */
  _applyBackground() {
    const { mode, color, imageUrl } = this.background;
    const stage = this.ui.el.stage;
    stage.dataset.bg = mode;
    document.body.dataset.bg = mode;
    const bd = this.ui.el.stageBackdrop;
    bd.style.backgroundColor = color;
    bd.style.backgroundImage = mode === 'image' && imageUrl ? `url("${imageUrl}")` : 'none';
    this.mandala.resize();
    if (mode === 'camera') this.mandala.clear();
  }

  /** One HUD entry per mapped trigger: its value and each parameter it drives, in real units. */
  _triggerItems(triggerValues) {
    if (!this.display.triggers) return [];
    const byTrigger = new Map();
    for (const o of this.mapping.lastRowOutputs) {
      const list = byTrigger.get(o.trigger) ?? [];
      list.push(o);
      byTrigger.set(o.trigger, list);
    }
    const items = [];
    for (const [trigger, outs] of byTrigger) {
      const def = TRIGGER_DEFS.find((d) => d.id === trigger);
      const tv = triggerValues[trigger];
      if (!def || !tv) continue;
      items.push({
        trigger, def, raw: tv.raw, valueText: formatTriggerValue(def, tv.raw),
        lines: outs.map((o) => ({ name: this._destName(o.destination), text: this._destText(o) })),
      });
    }
    return items;
  }

  _destName(id) {
    if (id.startsWith('inst:')) return destinationName(destinationById(id));
    return destinationName(destinationById(id));
  }

  /** The parameter's actual value, with its unit (instrument parameters use their own formatter). */
  _destText(o) {
    if (o.destination.startsWith('inst:')) {
      const key = o.destination.slice(5);
      const def = this.instrument.params.find((d) => d.key === key);
      const v = this._instOverride[key];
      return def && v !== undefined ? def.format(v) : `${Math.round(o.fraction * 100)}%`;
    }
    return formatDestinationValue(destinationById(o.destination), o.value);
  }

  /** What the overlay shows while the instrument is suspended: the instrument, with no live input. */
  _idleInstrumentDraw(inst) {
    if (inst.kind === 'strings') return { layout: this.harpLayout ?? { strings: [] }, plucks: [], material: this.instrumentParams.harp.material };
    if (inst.kind === 'string-bend') {
      const r = this.rudra;
      return { raga: ragaByName(this.ragaName), direction: r.direction.direction, ruler: r.ruler, span: this.instrumentParams.rudra.span, active: null, tuning: this.tuning, trail: [], strokes: [], bendCents: 0, contact: false, pull: { x: 0, dy: 0 }, andolan: false, params: this.instrumentParams.rudra };
    }
    return null;
  }

  /** Pose Landmarker for the Body HUD: loaded on first use, run every Nth frame. */
  _runPose(nowMs) {
    const want = this.display.body && this.showPose;
    this.overlay.showPose = want;
    if (!want) return;
    if (!this.poseTracker && !this.poseLoading) {
      this.poseLoading = true;
      const tracker = new PoseTracker();
      tracker.load().then(() => { this.poseTracker = tracker; }).catch((err) => {
        console.warn('Pose tracking unavailable (the Body HUD falls back to face + hands):', err);
        this.showPose = false;
        this.overlay.showPose = false;
      }).finally(() => { this.poseLoading = false; });
    }
    if (this.poseTracker && this.poseScheduler.due(this._frameCounter)) {
      const t0 = performance.now();
      const lm = this.poseTracker.detect(this.ui.el.video);
      this.poseScheduler.record(performance.now() - t0);
      if (lm) this.overlay.body.pose.set(lm, nowMs);
    }
  }

  _instrumentStatus(inst) {
    const poly = this.instrumentSettings[inst.id].polyphony;
    return `${inst.name} · ${this.voices ? this.voices.activeCount : 0}/${poly}`;
  }

  // -- Performance Mode ------------------------------------------------------------------

  async enterPerformance() {
    if (!this.isLive) {
      await this.start();
      if (!this.isLive) return; // camera refused: stay in the normal layout
    }
    await this.perf.enter();
    this.ui.el.perfNote.textContent = '';
    this.ui.el.perfFilterLabel.textContent = `Filter: ${this.cameraFilter.filter.name}`;
  }

  _onLayoutChange() {
    this.overlay.setTheme(this.perf.active ? 'spatial' : 'mythic');
    this.overlay.resize();
    this.mandala.resize();
    this._stageRectAt = 0;
    this._refreshZoneLayout();
  }

  _screenRect(nowMs) {
    if (!this._stageRect || nowMs - this._stageRectAt > 400) {
      this._stageRect = this.ui.el.stageCanvas.getBoundingClientRect();
      this._stageRectAt = nowMs;
    }
    return this._stageRect;
  }

  /**
   * Fingertip-as-mouse. Only in Performance Mode. Returns the hand sides that are
   * "pointing" this frame, so their fingers don't also play notes.
   * @returns {Set<string>}
   */
  _runCursor(nowMs) {
    const suppress = new Set();
    const cursorEl = this.ui.el.vcursor;
    if (!this.perf.active) {
      if (!cursorEl.hidden) cursorEl.hidden = true;
      return suppress;
    }
    let point = null;
    const rect = this._screenRect(nowMs);
    for (const side of ['right', 'left']) {
      const idx = this.fingerTracker.byId[`${side}-index`];
      if (!idx.present || idx.confidence < 1) continue;
      const curls = {
        index: idx.curl,
        middle: this.fingerTracker.byId[`${side}-middle`].curl,
        ring: this.fingerTracker.byId[`${side}-ring`].curl,
      };
      const pointing = isPointingPose(curls);
      if (pointing || !this.requirePointing) {
        point = { x: rect.left + idx.pos.x * rect.width, y: rect.top + idx.pos.y * rect.height };
        if (pointing) suppress.add(side);
        break;
      }
    }
    const cur = this.cursor.update(point, this.perf.targets(nowMs), nowMs);
    cursorEl.hidden = !cur.active;
    if (cur.active) {
      cursorEl.style.left = `${cur.x}px`;
      cursorEl.style.top = `${cur.y}px`;
      cursorEl.style.setProperty('--p', cur.progress.toFixed(3));
      cursorEl.classList.toggle('is-cooling', cur.cooling);
      cursorEl.classList.toggle('is-hover', !!cur.hoverId);
    }
    this.perf.showDwell(cur.hoverId, cur.progress);
    if (cur.fired) {
      const [action, arg] = PerformanceMode.splitId(cur.fired);
      // confirmation: the button flashes + rings, the cursor bursts
      this.perf.flashById(cur.fired);
      cursorEl.classList.remove('is-fired'); void cursorEl.getBoundingClientRect(); cursorEl.classList.add('is-fired');
      clearTimeout(this._cursorFiredT); this._cursorFiredT = setTimeout(() => cursorEl.classList.remove('is-fired'), 520);
      this.perf.activate(action, arg);
    }
    return suppress;
  }

  // -- Vector Camera (Build 029) -----------------------------------------------------------------------

  _cancelShoot() { if (this._shoot) { this._shoot.cancelled = true; this._shoot.wake?.(); } }

  _vecStatus(msg) { this.ui.el.vectorStatus.textContent = msg; if (this.perf.active) this.perf.setNote(msg); }

  /** The countdown / shot(s). Only the polygon picture is on screen (body.shoot-mode); files are built from the mesh data, not from a screenshot. */
  async takeVectorPhoto() {
    const ui = this.ui; const el = ui.el;
    if (this._shoot) return;
    if (!this.isLive) { this._vecStatus('Press Start first: the camera has to be running.'); return; }
    let note = '';
    if (this.cameraFilter.id === 'off') { this._setCameraFilter('facets'); note = 'The Camera filter was off, so Facets was switched on. '; }
    const secs = Number(el.vectorTimer.value) || 0; const detail = el.vectorDetail.value; const burst = Math.max(1, Math.min(5, Number(el.vectorBurst.value) || 1));
    const shoot = this._shoot = { cancelled: false, wake: null };
    const wasPerf = this.perf.active;
    document.body.classList.add('shoot-mode');
    el.vectorShootButton.disabled = true;
    const sleep = (ms) => new Promise((res) => { shoot.wake = res; setTimeout(res, ms); });
    const shots = []; let msg = '';
    try {
      el.shootCountdown.hidden = false;
      for (let s = secs; s > 0 && !shoot.cancelled; s--) { el.shootNumber.textContent = String(s); await sleep(1000); }
      if (shoot.cancelled) { msg = 'Cancelled.'; return; }
      el.shootCountdown.hidden = true;
      await sleep(secs ? 120 : 400); // one more frame so the live mesh is the current picture
      for (let i = 0; i < burst && !shoot.cancelled; i++) {
        const stage = el.filterCanvas.parentElement.getBoundingClientRect();
        const cap = this.cameraFilter.captureMesh(detail);
        el.shootFlash.classList.remove('is-on'); void el.shootFlash.offsetWidth; el.shootFlash.classList.add('is-on');
        if (!cap) { if (!shots.length) msg = 'No picture yet: wait for the camera image and try again.'; break; }
        shots.push({ mesh: { tris: cap.mesh.tris.slice(0, cap.mesh.count * 6), count: cap.mesh.count }, rgb: Uint8ClampedArray.from(cap.rgb), w: cap.w, h: cap.h, rect: visibleRect(cap.w, cap.h, stage.width, stage.height), mirror: el.filterCanvas.classList.contains('is-mirrored') });
        if (i < burst - 1) await sleep(900);
      }
      if (shots.length) msg = `${note}Done: ${shots.length} shot${shots.length > 1 ? 's' : ''}, ${shots[0].mesh.count} polygons each. Save or share below.`;
    } finally {
      el.shootCountdown.hidden = true; document.body.classList.remove('shoot-mode'); el.vectorShootButton.disabled = false; this._shoot = null;
      this.overlay.resize(); this._stageRectAt = 0; this._refreshZoneLayout();
      if (shots.length) {
        const v = this._vector; v.shots = shots; v.sel = 0; v.prepared = null; v.stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
        this._refreshShots(); this._prepareShare();
      }
      if (msg) this._vecStatus(msg);
      if (wasPerf) { if (shots.length) this._openPhotoResult(); } else document.getElementById('sectionVectorCamera')?.scrollIntoView?.({ block: 'center' });
    }
  }

  _vectorBackground() {
    const v = this.ui.el.vectorBg.value;
    return v === 'black' ? '#0a0908' : v === 'white' ? '#ffffff' : v === 'transparent' ? 'transparent' : this.ui.el.vectorBgColor.value;
  }
  _vectorOpts(shot, extra = {}) { const el = this.ui.el; return { rect: shot.rect, mirror: shot.mirror, style: el.vectorStyle.value, background: this._vectorBackground(), page: el.vectorPage.value, ...extra }; }

  async _renderShot(shot, kind) {
    const o = this._vectorOpts(shot);
    if (kind === 'svg') return new Blob([meshToSvg(shot.mesh, shot.rgb, shot.w, shot.h, o)], { type: 'image/svg+xml' });
    if (kind === 'pdf') return new Blob([await meshToPdf(shot.mesh, shot.rgb, shot.w, shot.h, o)], { type: 'application/pdf' });
    const { width, height } = sizeForPng(shot.rect);
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    drawMeshToCtx(c.getContext('2d'), shot.mesh, shot.rgb, shot.w, shot.h, o);
    return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
  }

  _fileName(i, ext) { const v = this._vector; return `ether-veena-vector-${v.stamp}${v.shots.length > 1 ? `-${i + 1}` : ''}.${ext}`; }

  /** thumbnails (burst) + the big preview, drawn with the current Style / Background */
  _refreshShots() {
    const v = this._vector; const el = this.ui.el;
    for (const u of v.urls) URL.revokeObjectURL(u); v.urls = [];
    if (!v.shots.length) { el.vectorResult.hidden = true; return; }
    const mk = (shot, long) => { const u = URL.createObjectURL(new Blob([meshToSvg(shot.mesh, shot.rgb, shot.w, shot.h, this._vectorOpts(shot, { longSide: long }))], { type: 'image/svg+xml' })); v.urls.push(u); return u; };
    el.vectorStrip.innerHTML = v.shots.length > 1 ? v.shots.map((sh, i) => `<button type="button" class="shot-thumb${i === v.sel ? ' is-active' : ''}" data-shot="${i}"><img src="${mk(sh, 240)}" alt="Shot ${i + 1}" /></button>`).join('') : '';
    el.vectorStrip.hidden = v.shots.length < 2; el.vectorSaveAll.hidden = v.shots.length < 2;
    el.vectorPreview.src = mk(v.shots[Math.min(v.sel, v.shots.length - 1)], 1000);
    el.vectorResult.hidden = false;
  }

  /** Save the selected shot (or all of them) as svg / pdf / png. */
  async _saveVector(kind, all = false) {
    const v = this._vector; if (!v.shots.length) return;
    const idx = all ? v.shots.map((_, i) => i) : [Math.min(v.sel, v.shots.length - 1)];
    for (const i of idx) {
      const blob = await this._renderShot(v.shots[i], kind); if (!blob) continue;
      this._download(blob, this._fileName(i, kind));
      if (idx.length > 1) await new Promise((r) => setTimeout(r, 400));
    }
    this._vecStatus(`Saved ${idx.length} ${kind.toUpperCase()} file${idx.length > 1 ? 's' : ''}.`);
  }

  _prepKey() { const el = this.ui.el; return [this._vector.stamp, el.vectorShareAs.value, el.vectorStyle.value, el.vectorBg.value, el.vectorBgColor.value, el.vectorPage.value].join('|'); }

  /** Render the files for the share sheet in advance: navigator.share must be called straight from a tap, with no waiting in between (iPhone Safari). */
  async _prepareShare() {
    const v = this._vector; if (!v.shots.length) return;
    const key = this._prepKey(); if (v.prepared?.key === key) return;
    const token = ++v.prepToken; v.prepared = null; const fmt = this.ui.el.vectorShareAs.value; const files = [];
    const mime = { png: 'image/png', pdf: 'application/pdf', svg: 'image/svg+xml' }[fmt];
    for (let i = 0; i < v.shots.length; i++) {
      const blob = await this._renderShot(v.shots[i], fmt);
      if (token !== v.prepToken) return;
      if (blob) files.push(new File([blob], this._fileName(i, fmt), { type: blob.type || mime }));
    }
    v.prepared = { key, files };
  }

  /** iPhone / Android share sheet (files). Falls back to saving where the browser cannot share files. */
  async _shareVector() {
    const v = this._vector; if (!v.shots.length) return;
    if (v.prepared?.key !== this._prepKey()) await this._prepareShare(); // (not instant: only when the settings changed a moment ago)
    const files = v.prepared?.files; const fmt = this.ui.el.vectorShareAs.value; if (!files?.length) return;
    const data = { files, title: 'ETHER VEENA vector photo' };
    if (!(navigator.canShare && navigator.canShare(data))) { await this._saveVector(fmt, true); this._vecStatus('This browser cannot share files here, so they were saved instead.'); return; }
    try { await navigator.share(data); this._vecStatus('Shared.'); } catch (err) {
      if (err?.name === 'AbortError') this._vecStatus('Share cancelled.');
      else if (err?.name === 'NotAllowedError') this._vecStatus('The browser only opens the share sheet after a real tap: tap Share with your finger (a pointing-hold cannot do it).');
      else { await this._saveVector(fmt, true); this._vecStatus('Sharing failed, so the files were saved instead.'); }
    }
  }

  // -- full-screen Photo menu (Build 030) ----------------------------------------------------------------------------------------------
  _cycleSelect(sel) { const o = [...sel.options]; sel.selectedIndex = (sel.selectedIndex + 1) % o.length; sel.dispatchEvent(new Event('change', { bubbles: true })); }
  _openPhotoMenu() {
    const e = this.ui.el; const txt = (sel) => sel.options[sel.selectedIndex].text;
    this.perf.openMenu('photo', 'Vector photo', [
      { id: 'shoot', label: '● Take photo' }, { id: 'timer', label: `Timer: ${txt(e.vectorTimer)}` }, { id: 'detail', label: `Detail: ${txt(e.vectorDetail)}` }, { id: 'burst', label: `Burst: ${txt(e.vectorBurst)}` },
    ]);
  }
  _openPhotoResult() {
    const n = this._vector.shots.length;
    this.perf.openMenu('photoResult', `Photo ready (${n})`, [
      { id: 'share', label: 'Share…' }, { id: 'png', label: 'Save PNG' }, { id: 'svg', label: 'Save SVG' }, { id: 'pdf', label: 'Save PDF' }, { id: 'retake', label: 'Retake' },
    ]);
  }
  _openPresetGroups() {
    const items = PRESET_GROUPS.map(([gid, title]) => ({ id: `g:${gid}`, label: `${title} ›`, active: this._presetById(this._activePresetId)?.instrument.id === gid && !this._presetById(this._activePresetId)?.mine }));
    if (this.userPresets.length) items.push({ id: 'g:mine', label: `My presets (${this.userPresets.length}) ›`, active: !!this._presetById(this._activePresetId)?.mine });
    this.perf.openMenu('presets', 'Presets', items);
  }
  _openPresetGroup(gid) {
    const list = gid === 'mine' ? this.userPresets : UNIFIED_PRESETS.filter((p) => p.instrument.id === gid);
    const title = gid === 'mine' ? 'My presets' : (PRESET_GROUPS.find(([g]) => g === gid)?.[1] ?? 'Presets');
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    this.perf.openMenu('presets', esc(title), [{ id: 'groups', label: '‹ Groups' }, ...list.map((p) => ({ id: p.id, label: esc(p.name), active: p.id === this._activePresetId }))]);
  }

  /** CRT monitor display mode (CSS layers only). */
  setCrt({ on, amount } = {}) {
    if (on !== undefined) this.crt.on = !!on;
    if (amount !== undefined) this.crt.amount = Math.min(1, Math.max(0, amount));
    const st = this.ui.el.stage;
    st.classList.toggle('has-crt', this.crt.on);
    st.style.setProperty('--crt-v', this.crt.amount.toFixed(2));
    this.ui.el.crtOverlay.style.setProperty('--crt', this.crt.amount.toFixed(2));
    this.ui.el.crtToggle.checked = this.crt.on;
    this.ui.el.crtAmount.value = String(Math.round(this.crt.amount * 100));
    this.ui.el.crtAmountField.hidden = !this.crt.on;
  }

  _setCameraFilter(id) {
    this.cameraFilter.setFilter(id);
    this.ui.el.cameraFilterSelect.value = this.cameraFilter.id;
    this.ui.el.perfFilterLabel.textContent = `Filter: ${this.cameraFilter.filter.name}`;
  }

  _perfAction(action, arg) {
    switch (action) {
      case 'cycle-filter':
        { let next = nextFilterId(this.cameraFilter.id); if (this.privacy && next === 'off') next = nextFilterId(next); this._setCameraFilter(next); }
        break;
      case 'open-presets':
        this._openPresetGroups();
        break;
      case 'pick-presets':
        if (arg === 'groups') this._openPresetGroups();
        else if (arg?.startsWith('g:')) this._openPresetGroup(arg.slice(2));
        else { this.applyUnifiedPreset(arg); this.perf.closeMenu(); }
        break;
      case 'photo-menu':
        this._openPhotoMenu();
        break;
      case 'pick-photo':
        if (arg === 'shoot') { this.perf.closeMenu(); this.takeVectorPhoto(); return; }
        this._cycleSelect({ timer: this.ui.el.vectorTimer, detail: this.ui.el.vectorDetail, burst: this.ui.el.vectorBurst }[arg]);
        this._openPhotoMenu();
        break;
      case 'pick-photoResult':
        if (arg === 'retake') { this.perf.closeMenu(); this._vector.shots = []; this.takeVectorPhoto(); }
        else if (arg === 'share') this._shareVector();
        else this._saveVector(arg, true);
        break;
      case 'randomize':
        this.randomize({ synth: true, effects: true, display: true });
        break;
      case 'calibrate':
        this.startCalibrationCountdown();
        break;
      default:
        break;
    }
  }

  _faceEnabledResult() {
    return this.faceEnabled ? this._lastFaceResult : null;
  }

  _handleStartError(err) {
    if (err instanceof CameraError) { this.ui.showError('Camera unavailable', err.message); return; }
    console.error(err);
    this.ui.showError('Could not start', 'Something went wrong starting the camera, hand tracking, or audio. Reload the page and try again.');
  }

  /** Shows the version of the running code; a newer one on the server is offered quietly next to it (checked at load, when the page becomes visible again, and every 30 min). */
  async _loadVersion() {
    const el = this.ui.el;
    this.ui.setVersion(`v${APP_VERSION} · build ${APP_BUILD}`);
    el.updateNote.addEventListener('click', () => applyUpdate());
    let last = 0;
    const check = async () => {
      if (Date.now() - last < 60_000) return; last = Date.now();
      const r = await checkForUpdate({ version: APP_VERSION, build: APP_BUILD });
      el.updateNote.hidden = !r.available;
      if (r.available) { el.updateNote.textContent = 'Update available · tap to reload'; el.updateNote.title = `Version ${r.version} (build ${r.build}) is on the server. Tap to load it.`; }
    };
    setTimeout(check, 3000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 30 * 60_000);
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

const app = new App();
app.init();

// Console / test hook (read-only use): `window.cyberTheremin.voices`, `.instrumentParams`, …
window.cyberTheremin = app;
