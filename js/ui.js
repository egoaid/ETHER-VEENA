/* ==========================================================================
   ui.js — interface state and display updates
   v0.6 adds: instrument selector + instrument-specific panel, Randomize and
   Sound-preset controls, the graphical Body HUD host, and a separate Debug
   (numeric) overlay switch. v0.5 added: collapsible sections, a data-driven mapping editor, generated
   synth/effect slider panels, preset controls, face-tracking toggle, the
   live body-control overlay cards, the pitch/note chip, and the
   oscilloscope. Owns DOM references and rendering only; no camera/audio/
   tracking/scale/mapping logic — those modules pass data in and get
   callbacks out.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

const OVERLAY_REFRESH_MS = 66; // ~15 Hz: overlay text doesn't need to redraw every animation frame

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      stage: $('stage'),
      video: $('video'),
      trackingStatus: $('trackingStatus'),
      trackingStatusLabel: $('trackingStatusLabel'),
      fullscreenButton: $('fullscreenButton'),
      filterCanvas: $('filterCanvas'),
      glitchCanvas: $('glitchCanvas'),
      glitchAmount: $('glitchAmount'), glitchControls: $('glitchControls'), glitchFrequency: $('glitchFrequency'), glitchBlock: $('glitchBlock'), glitchRgb: $('glitchRgb'), glitchDisplace: $('glitchDisplace'), glitchNoise: $('glitchNoise'), glitchHold: $('glitchHold'),
      cameraFilterSelect: $('cameraFilterSelect'),
      filterDensity: $('filterDensity'),
      filterColorMode: $('filterColorMode'),
      filterBaseField: $('filterBaseField'),
      filterDuoField: $('filterDuoField'),
      filterBase: $('filterBase'),
      filterDark: $('filterDark'),
      filterBright: $('filterBright'),
      filterMusic: $('filterMusic'),
      perfFilterLabel: document.querySelector('#perfFilter .perf-label'),
      errorTitle: $('errorTitle'),
      errorMessage: $('errorMessage'),

      zonePitch: $('zonePitch'),
      zonePitchCursor: $('zonePitchCursor'),
      zoneVolume: $('zoneVolume'),
      zoneVolumeCursor: $('zoneVolumeCursor'),
      privacyToggle: $('privacyToggle'),
      updateNote: $('updateNote'),
      vectorShootButton: $('vectorShootButton'), vectorTimer: $('vectorTimer'), vectorDetail: $('vectorDetail'), vectorStatus: $('vectorStatus'), vectorResult: $('vectorResult'), vectorPreview: $('vectorPreview'), vectorSaveSvg: $('vectorSaveSvg'), vectorSavePdf: $('vectorSavePdf'), vectorSavePng: $('vectorSavePng'), vectorShare: $('vectorShare'), vectorSaveAll: $('vectorSaveAll'), vectorBurst: $('vectorBurst'), vectorStyle: $('vectorStyle'), vectorBg: $('vectorBg'), vectorBgColor: $('vectorBgColor'), vectorBgColorField: $('vectorBgColorField'), vectorPage: $('vectorPage'), vectorShareAs: $('vectorShareAs'), vectorStrip: $('vectorStrip'), filterSmoothToggle: $('filterSmoothToggle'), userPresetButtons: $('userPresetButtons'), userPresetName: $('userPresetName'), userPresetSave: $('userPresetSave'), userPresetDelete: $('userPresetDelete'), userPresetExport: $('userPresetExport'), userPresetImport: $('userPresetImport'), userPresetFile: $('userPresetFile'), userPresetStatus: $('userPresetStatus'), randomLocks: $('randomLocks'), shootCountdown: $('shootCountdown'), shootNumber: $('shootNumber'), shootFlash: $('shootFlash'),
      crtToggle: $('crtToggle'), crtAmount: $('crtAmount'), crtAmountField: $('crtAmountField'), crtOverlay: $('crtOverlay'),

      rightHandCard: $('rightHandCard'),
      leftHandCard: $('leftHandCard'),
      faceCard: $('faceCard'),
      pitchNoteChip: $('pitchNoteChip'),
      oscilloscopeCanvas: $('oscilloscopeCanvas'),

      pitchValue: $('pitchValue'),
      volumeValue: $('volumeValue'),
      pitchBar: $('pitchBar'),
      volumeBar: $('volumeBar'),

      startButton: $('startButton'),
      startButtonLabel: $('startButtonLabel'),

      calibrateButton: $('calibrateButton'),
      calibrationStatus: $('calibrationStatus'),
      stageCountdown: $('stageCountdown'),
      countdownNumber: $('countdownNumber'),

      sensitivitySlider: $('sensitivitySlider'),
      sensitivityValue: $('sensitivityValue'),

      vibratoIndicator: $('vibratoIndicator'),

      modeRow: $('modeRow'),
      scaleRow: $('scaleRow'),
      rootSelect: $('rootSelect'),
      scaleSelect: $('scaleSelect'),

      noteNameDisplay: $('noteNameDisplay'),
      noteModeLabel: $('noteModeLabel'),
      pitchGrid: $('pitchGrid'),
      pitchGridTicks: $('pitchGridTicks'),
      pitchGridIndicator: $('pitchGridIndicator'),

      waveformSelect: $('waveformSelect'),
      filterTypeSelect: $('filterTypeSelect'),
      lfoTargetSelect: $('lfoTargetSelect'),
      synthSliders: $('synthSliders'),
      effectSliders: $('effectSliders'),
      delayModeSelect: $('delayModeSelect'),

      mappingEditor: $('mappingEditor'),
      presetButtons: $('presetButtons'),
      presetCoreNote: $('presetCoreNote'),
      presetStatus: $('presetStatus'),
      saveCustomButton: $('saveCustomButton'),
      loadCustomButton: $('loadCustomButton'),
      resetMappingButton: $('resetMappingButton'),

      faceTrackingToggle: $('faceTrackingToggle'),
      faceTrackingStatus: $('faceTrackingStatus'),
      useFlatsToggle: $('useFlatsToggle'),
      showBodyControlsToggle: $('showBodyControlsToggle'),
      showPitchNoteToggle: $('showPitchNoteToggle'),
      showOscilloscopeToggle: $('showOscilloscopeToggle'),
      versionTag: $('versionTag'),

      // v0.6
      stageCanvas: $('stageCanvas'),
      instrumentOptions: $('instrumentOptions'),
      showPoseToggle: $('showPoseToggle'),
      mandalaCanvas: $('mandalaCanvas'),
      stageBackdrop: $('stageBackdrop'),
      backgroundSelect: $('backgroundSelect'),
      backgroundColor: $('backgroundColor'),
      backgroundImage: $('backgroundImage'),
      bodyVisualSelect: $('bodyVisualSelect'),
      mandalaOverlayToggle: $('mandalaOverlayToggle'),
      showTriggerHudToggle: $('showTriggerHudToggle'),
      faceHudSelect: $('faceHudSelect'),
      performanceButton: $('performanceButton'),
      perfLayer: $('perfLayer'),
      perfPanel: $('perfPanel'),
      perfNote: $('perfNote'),
      vcursor: $('vcursor'),
      instrumentRow: $('instrumentRow'),
      instrumentBlurb: $('instrumentBlurb'),
      instrumentControls: $('instrumentControls'),
      polyphonySelect: $('polyphonySelect'),
      stealSelect: $('stealSelect'),
      instrumentSliders: $('instrumentSliders'),
      showDebugToggle: $('showDebugToggle'),
      synthThereminOnlyNote: $('synthThereminOnlyNote'),
      synthBody: $('synthBody'),
      randomizeButton: $('randomizeButton'),
      randomizeStatus: $('randomizeStatus'),
      pluckIndicator: $('pluckIndicator'),
    };

    this._calibrationStatusTimer = null;
    this._modeButtons = Array.from(this.el.modeRow.querySelectorAll('.mode-button'));
    this._lastOverlayRefresh = 0;
    this._scopeCtx = this.el.oscilloscopeCanvas.getContext('2d');
    this._triggerDefs = [];
    this._triggerGroups = [];
    this._destinations = [];
    this._getRow = () => null;
  }

  // -- Generic bindings ------------------------------------------------------

  bindStartButton(fn) { this.el.startButton.addEventListener('click', fn); }
  bindFullscreenButton(fn) { this.el.fullscreenButton.addEventListener('click', fn); }
  bindCalibrateButton(fn) { this.el.calibrateButton.addEventListener('click', fn); }
  bindSensitivitySlider(fn) {
    this.el.sensitivitySlider.addEventListener('input', (e) => fn(parseFloat(e.target.value)));
  }
  bindCheckbox(key, fn) {
    this.el[key].addEventListener('change', (e) => fn(e.target.checked));
  }
  bindSelect(key, fn) {
    this.el[key].addEventListener('change', (e) => fn(e.target.value));
  }
  bindModeButtons(fn) {
    for (const btn of this._modeButtons) btn.addEventListener('click', () => fn(btn.dataset.mode));
  }
  bindRootSelect(fn) {
    this.el.rootSelect.addEventListener('change', (e) => fn(parseInt(e.target.value, 10)));
  }
  bindScaleSelect(fn) {
    this.el.scaleSelect.addEventListener('change', (e) => fn(e.target.value));
  }
  bindPresetActions({ onSave, onLoad, onReset }) {
    this.el.saveCustomButton.addEventListener('click', onSave);
    this.el.loadCustomButton.addEventListener('click', onLoad);
    this.el.resetMappingButton.addEventListener('click', onReset);
  }

  populateScaleSelects(rootNames, scaleNames) {
    this.el.rootSelect.innerHTML = rootNames.map((n, pc) => `<option value="${pc}">${n}</option>`).join('');
    this.el.scaleSelect.innerHTML = scaleNames
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join('');
  }

  /** Rebuild the scale menu (scales, or ragas for the Rudra Veena) and relabel it. */
  setScaleOptions(names, selected, label) {
    const sel = this.el.scaleSelect;
    sel.innerHTML = names.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    sel.value = selected;
    const lab = sel.closest('label');
    if (lab && lab.firstChild) lab.firstChild.textContent = `${label}\n        `;
  }

  // -- Generated slider panels (Synth / Effects) ------------------------------

  /**
   * @param {'synthSliders'|'effectSliders'|'instrumentSliders'} containerKey
   * @param {Array<{key:string,label:string,min:number,max:number,step:number,value:number,format:(v:number)=>string}>} defs
   * @param {(key:string, value:number) => void} onInput
   * Safe to call repeatedly on the same container (the instrument panel is
   * re-rendered on every instrument change): the previous listener is removed.
   */
  renderSliders(containerKey, defs, onInput) {
    const container = this.el[containerKey];
    container.innerHTML = defs
      .map(
        (d) => `
      <label class="sound-field slider-field">
        <span>${escapeHtml(d.label)}</span>
        <input type="range" data-key="${d.key}" min="${d.min}" max="${d.max}" step="${d.step}" value="${d.value}" />
        <output data-out="${d.key}">${escapeHtml(d.format(d.value))}</output>
      </label>`
      )
      .join('');
    const byKey = new Map(defs.map((d) => [d.key, d]));
    container._sliderDefs = byKey;
    if (container._sliderHandler) container.removeEventListener('input', container._sliderHandler);
    container._sliderHandler = (e) => {
      const key = e.target.dataset.key;
      if (!key) return;
      const value = parseFloat(e.target.value);
      container.querySelector(`[data-out="${key}"]`).textContent = byKey.get(key).format(value);
      onInput(key, value);
    };
    container.addEventListener('input', container._sliderHandler);
  }

  /** Move a generated slider (and its readout) programmatically — used by Randomize and presets. */
  setSliderValue(containerKey, key, value) {
    const container = this.el[containerKey];
    const input = container.querySelector(`input[data-key="${key}"]`);
    const def = container._sliderDefs?.get(key);
    if (!input || !def) return;
    input.value = value;
    container.querySelector(`[data-out="${key}"]`).textContent = def.format(parseFloat(input.value));
  }

  /**
   * Select menus for an instrument's discrete choices (e.g. Rudra Veena tuning).
   * `showIf(values)` hides an option until it is relevant (custom tunings).
   * @param {boolean} [refreshOnly] only update visibility, keep existing controls/listeners
   */
  renderInstrumentOptions(options, values, onChange, refreshOnly = false) {
    const box = this.el.instrumentOptions;
    if (!refreshOnly) {
      box.innerHTML = options
        .map((o) => `<label class="sound-field" data-option="${o.key}"><span>${escapeHtml(o.label)}</span><select data-key="${o.key}">${o.choices.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.label)}</option>`).join('')}</select></label>`)
        .join('');
      for (const o of options) box.querySelector(`select[data-key="${o.key}"]`).value = values[o.key];
      if (box._optHandler) box.removeEventListener('change', box._optHandler);
      box._optHandler = (e) => { const k = e.target.dataset.key; if (k && onChange) onChange(k, e.target.value); };
      box.addEventListener('change', box._optHandler);
    }
    for (const o of options) {
      const row = box.querySelector(`[data-option="${o.key}"]`);
      if (row) row.hidden = o.showIf ? !o.showIf(values) : false;
    }
  }

  setSelectValue(key, value) {
    this.el[key].value = value;
  }

  setCheckbox(key, checked) {
    this.el[key].checked = !!checked;
  }

  // -- Instrument selector + panel (v0.6) ----------------------------------------

  renderInstrumentButtons(instruments, onSelect) {
    this.el.instrumentRow.innerHTML = instruments
      .map((i) => `<button type="button" class="mode-button instrument-button" data-instrument="${i.id}" aria-pressed="false">${escapeHtml(i.name)}</button>`)
      .join('');
    this.el.instrumentRow.onclick = (e) => {
      const id = e.target.closest?.('[data-instrument]')?.dataset.instrument;
      if (id) onSelect(id);
    };
  }

  setActiveInstrument(id) {
    for (const btn of this.el.instrumentRow.querySelectorAll('[data-instrument]')) {
      const active = btn.dataset.instrument === id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    document.body.dataset.instrument = id;
  }

  /**
   * @param {{blurb:string, showPluckControls:boolean, showPolyphony:boolean}} info
   */
  setInstrumentPanel(info) {
    this.el.instrumentBlurb.textContent = info.blurb;
    this.el.instrumentControls.hidden = !info.showPolyphony;
    this.el.synthThereminOnlyNote.hidden = info.isTheremin;
    this.el.synthBody.classList.toggle('is-dimmed', !info.isTheremin);
  }

  populateInstrumentSelects({ polyphonyChoices, stealStrategies }) {
    this.el.polyphonySelect.innerHTML = polyphonyChoices.map((n) => `<option value="${n}">${n}</option>`).join('');
    this.el.stealSelect.innerHTML = Object.entries(stealStrategies)
      .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`)
      .join('');
  }

  setModeRowVisible(visible) {
    this.el.modeRow.hidden = !visible;
  }

  setScaleRowVisible(visible) {
    this.el.scaleRow.classList.toggle('is-visible', !!visible);
  }

  setPitchGridVisible(visible) {
    this.el.pitchGrid.style.display = visible ? '' : 'none';
  }

  setNoteModeLabel(text) {
    this.el.noteModeLabel.textContent = text;
  }

  /** Brief flash on the pluck indicator (note-on event happened). */
  flashPluckIndicator() {
    const el = this.el.pluckIndicator;
    el.classList.remove('is-hit');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('is-hit');
  }

  // -- Sound presets / randomize --------------------------------------------------

  bindRandomize(fn) {
    this.el.randomizeButton.addEventListener('click', () => {
      const cats = {};
      for (const box of document.querySelectorAll('[data-randomize]')) cats[box.dataset.randomize] = box.checked;
      fn(cats);
    });
  }

  setRandomizeStatus(text) {
    this.el.randomizeStatus.textContent = text;
  }

  // -- Mapping editor (data-driven, event-delegated) ----------------------------

  setCatalogs({ triggerDefs, triggerGroups, destinations, getRow }) {
    this._triggerDefs = triggerDefs;
    this._triggerGroups = triggerGroups;
    this._destinations = destinations;
    this._getRow = getRow;
  }

  /** @param {(triggerId:string, field:string, value:any) => void} onChange */
  bindMappingEditor(onChange) {
    const editor = this.el.mappingEditor;
    editor.addEventListener('input', (e) => {
      const t = e.target;
      if (t.type !== 'range' && t.type !== 'number') return;
      onChange(t.dataset.trigger, t.dataset.field, parseFloat(t.value));
      const out = editor.querySelector(`[data-out="${t.dataset.trigger}-${t.dataset.field}"]`);
      if (out) out.textContent = `${Math.round(parseFloat(t.value) * 100)}%`;
    });
    editor.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset.field) return;
      if (t.type === 'checkbox') {
        onChange(t.dataset.trigger, t.dataset.field, t.checked);
      } else if (t.tagName === 'SELECT') {
        onChange(t.dataset.trigger, t.dataset.field, t.value);
        this.renderMappingEditor(); // destination/curve change alters which fields show
      }
    });
  }

  renderMappingEditor() {
    const groupsHtml = this._triggerGroups
      .map((group) => {
        const rows = this._triggerDefs.filter((t) => t.group === group).map((t) => this._mappingRowHtml(t));
        return `<div class="map-group"><div class="map-group-title">${escapeHtml(group)}</div>${rows.join('')}</div>`;
      })
      .join('');
    this.el.mappingEditor.innerHTML = groupsHtml;
  }

  _mappingRowHtml(trigger) {
    const row = this._getRow(trigger.id);
    const dest = this._destinations.find((d) => d.id === row.destination) ?? this._destinations[0];
    const optionsByGroup = {};
    for (const d of this._destinations) (optionsByGroup[d.group] ||= []).push(d);
    const options = Object.entries(optionsByGroup)
      .map(([group, list]) => {
        const opts = list
          .map((d) => `<option value="${d.id}"${d.id === row.destination ? ' selected' : ''}>${escapeHtml(d.label)}</option>`)
          .join('');
        return group === 'Off' ? opts : `<optgroup label="${escapeHtml(group)}">${opts}</optgroup>`;
      })
      .join('');

    let detail = '';
    if (dest.id !== 'none') {
      const id = trigger.id;
      const pct = (v) => `${Math.round(v * 100)}%`;
      detail = `
        <div class="map-detail">
          <label>Min <input type="range" data-trigger="${id}" data-field="min" min="0" max="1" step="0.01" value="${row.min}" /><output data-out="${id}-min">${pct(row.min)}</output></label>
          <label>Max <input type="range" data-trigger="${id}" data-field="max" min="0" max="1" step="0.01" value="${row.max}" /><output data-out="${id}-max">${pct(row.max)}</output></label>
          <label>Smooth <input type="range" data-trigger="${id}" data-field="smoothing" min="0" max="0.95" step="0.05" value="${row.smoothing}" /><output data-out="${id}-smoothing">${pct(row.smoothing)}</output></label>
          <label class="toggle"><input type="checkbox" data-trigger="${id}" data-field="invert"${row.invert ? ' checked' : ''} /> Invert</label>
          ${
            dest.curveCapable
              ? `<label>Curve <select data-trigger="${id}" data-field="curve"><option value="linear"${row.curve === 'linear' ? ' selected' : ''}>Linear</option><option value="exponential"${row.curve === 'exponential' ? ' selected' : ''}>Exponential</option></select></label>`
              : ''
          }
        </div>`;
    }

    return `
      <div class="map-row">
        <div class="map-main">
          <span class="map-trigger">${escapeHtml(trigger.label)}</span>
          <select data-trigger="${trigger.id}" data-field="destination">${options}</select>
        </div>${detail}
      </div>`;
  }

  // -- Presets ------------------------------------------------------------------------

  /** Built-in presets under a heading per instrument (groups: [[instrumentId, title]]), plus "My presets" in their own row. */
  renderPresetButtons(presets, onSelect, groups = null, mine = []) {
    const btn = (p) => `<button type="button" class="mode-button" data-preset="${p.id}">${escapeHtml(p.name)}</button>`;
    this.el.presetButtons.innerHTML = groups
      ? groups.map(([gid, title]) => { const list = presets.filter((p) => p.instrument.id === gid); return list.length ? `<div class="preset-group-label">${escapeHtml(title)}</div>${list.map(btn).join('')}` : ''; }).join('')
      : presets.map(btn).join('');
    this.el.userPresetButtons.innerHTML = mine.length ? mine.map(btn).join('') : '<span class="panel-hint">None yet: set up a patch, name it and press “Save current as preset”.</span>';
    const handler = (e) => { const id = e.target.dataset?.preset; if (id) onSelect(id); };
    this.el.presetButtons.onclick = handler;
    this.el.userPresetButtons.onclick = handler;
  }

  setActivePreset(id) {
    for (const btn of document.querySelectorAll('#presetButtons [data-preset], #userPresetButtons [data-preset]')) {
      btn.classList.toggle('is-active', btn.dataset.preset === id);
    }
  }

  setPresetCoreNote(text) { this.el.presetCoreNote.textContent = text; }
  setPresetStatus(text) { this.el.presetStatus.textContent = text; }
  setFaceTrackingStatus(text) { this.el.faceTrackingStatus.textContent = text; }

  // -- Display toggles / overlay -------------------------------------------------------

  /**
   * `body`   the graphical Body HUD (performance UI)
   * `debug`  the numeric trigger cards over the camera image (developer UI)
   */
  setOverlayVisibility({ body: _body, pitchNote, scope, debug }) {
    this.el.stage.classList.toggle('hide-body', !debug); // CSS class name kept from v0.5: it hides the numeric cards
    this.el.stage.classList.toggle('show-pitchnote', !!pitchNote);
    this.el.stage.classList.toggle('show-scope', !!scope);
    if (!scope) this._clearScope();
  }

  setPitchNoteChip(text) { this.el.pitchNoteChip.textContent = text; }

  /**
   * Redraws the three trigger cards (throttled). Hand cards follow the live
   * palm position so the numbers sit next to the hand producing them; the
   * face card is fixed at top-center (face-mesh anchoring is a documented
   * future improvement).
   * @param {Object} data
   * @param {Object} data.triggerValues id -> {raw,value01}
   * @param {Map<string,number>} data.lastOutputs destination id -> native value
   * @param {{x:number,y:number}|null} data.right
   * @param {{x:number,y:number}|null} data.left
   * @param {'off'|'loading'|'on'|'noface'} data.faceState
   */
  renderTriggerOverlay(data) {
    const now = performance.now();
    if (now - this._lastOverlayRefresh < OVERLAY_REFRESH_MS) return;
    this._lastOverlayRefresh = now;
    if (this.el.stage.classList.contains('hide-body')) return;

    this._renderHandCard(this.el.rightHandCard, 'Right Hand', 'Right Hand', data.right, data, 'right');
    this._renderHandCard(this.el.leftHandCard, 'Left Hand', 'Left Hand', data.left, data, 'left');
    this._renderFaceCard(data);
  }

  _renderHandCard(card, title, group, position, data, side) {
    if (!position) {
      card.classList.remove('is-visible');
      return;
    }
    card.classList.add('is-visible');
    const x = Math.min(88, Math.max(12, position.x * 100));
    const y = Math.min(90, Math.max(10, position.y * 100));
    card.style.left = `${x}%`;
    card.style.top = `${y}%`;
    card.dataset.side = side;
    card.innerHTML = `<div class="trigger-card-title">${title}</div>${this._triggerLines(group, data)}`;
  }

  _renderFaceCard(data) {
    const card = this.el.faceCard;
    if (data.faceState === 'off') {
      card.classList.remove('is-visible');
      return;
    }
    card.classList.add('is-visible');
    if (data.faceState === 'loading') {
      card.innerHTML = '<div class="trigger-card-title">Face</div><div class="trigger-line dim">loading model…</div>';
    } else if (data.faceState === 'noface') {
      card.innerHTML = '<div class="trigger-card-title">Face</div><div class="trigger-line dim">no face detected</div>';
    } else {
      card.innerHTML = `<div class="trigger-card-title">Face</div>${this._triggerLines('Face', data)}`;
    }
  }

  _triggerLines(group, data) {
    return this._triggerDefs
      .filter((t) => t.group === group)
      .map((t) => {
        const v = data.triggerValues[t.id];
        const short = group === 'Face' ? t.label : t.label.replace(/^(Right|Left) (Hand )?/, '');
        const value = v ? v.raw.toFixed(2) : '—';
        const row = this._getRow(t.id);
        let dest = '';
        if (row && row.destination !== 'none') {
          const d = this._destinations.find((x) => x.id === row.destination);
          const out = data.lastOutputs.get(row.destination);
          dest = `<span class="trigger-dest">→ ${escapeHtml(d.label)}${out !== undefined ? ' ' + formatNative(d, out) : ''}</span>`;
        }
        return `<div class="trigger-line"><span class="trigger-name">${escapeHtml(short)}</span><span class="trigger-value">${value}</span>${dest}</div>`;
      })
      .join('');
  }

  /** @param {Uint8Array|null} samples Time-domain data, or null to skip. */
  drawOscilloscope(samples) {
    if (!this.el.stage.classList.contains('show-scope') || !samples) return;
    const canvas = this.el.oscilloscopeCanvas;
    const ctx = this._scopeCtx;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(46, 242, 255, 0.95)';
    ctx.shadowColor = 'rgba(255, 63, 164, 0.7)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const step = samples.length / w;
    for (let x = 0; x < w; x++) {
      const v = samples[Math.floor(x * step)] / 255; // 0..1, 0.5 = silence
      const y = h - v * h;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _clearScope() {
    this._scopeCtx.clearRect(0, 0, this.el.oscilloscopeCanvas.width, this.el.oscilloscopeCanvas.height);
  }

  // -- Everything below is unchanged from v0.4 ---------------------------------------------

  setActiveMode(mode) {
    for (const btn of this._modeButtons) {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    }
    const needsScaleRow = mode === 'snap-scale' || mode === 'filter-scale' || mode === 'easy-scale';
    this.el.scaleRow.classList.toggle('is-visible', needsScaleRow);
    const labels = {
      continuous: 'Continuous',
      chromatic: 'Chromatic',
      'snap-scale': 'Snap to Scale',
      'filter-scale': 'Filter Out of Scale',
      'easy-scale': 'Easy Scale',
    };
    this.el.noteModeLabel.textContent = labels[mode] ?? mode;
    this.el.pitchGrid.style.display = mode === 'continuous' ? 'none' : '';
  }

  setNoteName(name) { this.el.noteNameDisplay.textContent = name; }

  renderPitchGrid(ticks) {
    this.el.pitchGridTicks.innerHTML = ticks
      .map((tick) => {
        const pct = tick.fraction * 100;
        const cls = tick.isRoot ? 'pitch-grid-tick is-root' : 'pitch-grid-tick';
        const label = tick.label
          ? `<span class="pitch-grid-label" style="left:${pct}%">${escapeHtml(tick.label)}</span>`
          : '';
        return `<div class="${cls}" style="left:${pct}%"></div>${label}`;
      })
      .join('');
  }

  updatePitchGridIndicator(fraction, muted) {
    const el = this.el.pitchGridIndicator;
    if (fraction === null || fraction === undefined) {
      el.classList.remove('is-visible');
      return;
    }
    el.classList.add('is-visible');
    el.classList.toggle('is-muted', !!muted);
    el.style.left = `${Math.min(1, Math.max(0, fraction)) * 100}%`;
  }

  setVersion(text) { this.el.versionTag.textContent = text; }

  setStartButtonState(state) {
    const btn = this.el.startButton;
    btn.classList.toggle('is-loading', state === 'loading');
    btn.classList.toggle('is-live', state === 'live');
    btn.disabled = state === 'loading';
    const labels = { idle: 'Start Theremin', loading: 'Starting…', live: 'Stop Theremin' };
    this.el.startButtonLabel.textContent = labels[state] ?? labels.idle;
    this.el.calibrateButton.disabled = state !== 'live';
  }

  setTrackingState(state) {
    this.el.trackingStatus.dataset.state = state;
    const labels = { off: 'camera off', searching: 'searching for hands', tracking: 'tracking' };
    this.el.trackingStatusLabel.textContent = labels[state] ?? '';
  }

  setStageLive(isLive) { this.el.stage.classList.toggle('is-live', !!isLive); }

  showError(title, message) {
    this.el.errorTitle.textContent = title;
    this.el.errorMessage.textContent = message;
    this.el.stage.classList.add('has-error');
  }
  clearError() { this.el.stage.classList.remove('has-error'); }
  setMirrored(isMirrored) { this.el.video.classList.toggle('is-mirrored', isMirrored); this.el.filterCanvas.classList.toggle('is-mirrored', isMirrored); this.el.glitchCanvas.classList.toggle('is-mirrored', isMirrored); }

  setZoneLayout(pitchCenter, volumeCenter, rangeX, rangeY) {
    Object.assign(this.el.zonePitch.style, {
      left: `${pitchCenter.x * 100}%`,
      top: `${pitchCenter.y * 100}%`,
      width: `${Math.min(90, rangeX * 2 * 100)}%`,
    });
    Object.assign(this.el.zoneVolume.style, {
      left: `${volumeCenter.x * 100}%`,
      top: `${volumeCenter.y * 100}%`,
      height: `${Math.min(90, rangeY * 2 * 100)}%`,
    });
  }

  /** Pitch = a vertical line inside its zone; volume = a horizontal line (volume01 0..1, up = loud; null = hand not visible). */
  updateZoneCursors(rightOffset, volume01) {
    this._placeZoneCursor(this.el.zonePitchCursor, rightOffset, 'x');
    const c = this.el.zoneVolumeCursor;
    if (volume01 === null || volume01 === undefined) { c.classList.remove('is-visible'); return; }
    c.classList.add('is-visible');
    c.style.top = `${(1 - Math.min(1, Math.max(0, volume01))) * 100}%`;
  }

  updateFinePitchGlow(fineOffset) {
    const m = fineOffset === null || fineOffset === undefined ? 0 : Math.abs(fineOffset);
    this.el.zonePitchCursor.style.setProperty('--fine-mag', m.toFixed(2));
  }

  setVibratoActive(active) { this.el.vibratoIndicator.classList.toggle('is-active', !!active); }

  showCalibrationCountdown(displayValue) {
    this.el.stageCountdown.classList.add('is-active');
    this.el.countdownNumber.textContent = displayValue;
  }
  hideCalibrationCountdown() { this.el.stageCountdown.classList.remove('is-active'); }

  setCalibrationMode(mode) {
    if (this._calibrationStatusTimer) return;
    this.el.calibrationStatus.textContent =
      mode === 'calibrated' ? 'Calibration: your positions' : 'Calibration: default positions — tap Calibrate';
    this.el.calibrationStatus.dataset.tone = 'neutral';
  }

  flashCalibrationResult(success, mode) {
    this.el.calibrationStatus.textContent = success ? 'Calibrated!' : 'Show both hands, then tap Calibrate again';
    this.el.calibrationStatus.dataset.tone = success ? 'good' : 'warn';
    if (this._calibrationStatusTimer) clearTimeout(this._calibrationStatusTimer);
    this._calibrationStatusTimer = setTimeout(() => {
      this._calibrationStatusTimer = null;
      this.setCalibrationMode(mode);
    }, 1800);
  }

  setSensitivityDisplay(value) {
    this.el.sensitivitySlider.value = value;
    this.el.sensitivityValue.textContent = `${value.toFixed(1)}x`;
  }

  updateReadouts(freqHz, volume01) {
    if (freqHz && freqHz > 0) {
      this.el.pitchValue.textContent = freqHz.toFixed(1);
      this.el.pitchBar.style.width = `${this._pitchFractionFromFreq(freqHz) * 100}%`;
    } else {
      this.el.pitchValue.textContent = '—';
      this.el.pitchBar.style.width = '0%';
    }
    if (volume01 !== null && volume01 !== undefined) {
      this.el.volumeValue.textContent = Math.round(volume01 * 100);
      this.el.volumeBar.style.width = `${volume01 * 100}%`;
    } else {
      this.el.volumeValue.textContent = '—';
      this.el.volumeBar.style.width = '0%';
    }
  }

  setPitchRangeHz(minFreq, maxFreq) { this._minFreq = minFreq; this._maxFreq = maxFreq; }

  _pitchFractionFromFreq(freq) {
    if (!this._minFreq || !this._maxFreq) return 0;
    const t = (Math.log(freq) - Math.log(this._minFreq)) / (Math.log(this._maxFreq) - Math.log(this._minFreq));
    return Math.min(1, Math.max(0, t));
  }

  _placeZoneCursor(el, offset, axis) {
    if (offset === null || offset === undefined) {
      el.classList.remove('is-visible');
      return;
    }
    el.classList.add('is-visible');
    const pct = 50 + Math.min(1, Math.max(-1, offset)) * 50;
    if (axis === 'x') el.style.left = `${pct}%`;
    else el.style.top = `${pct}%`;
  }
}

function formatNative(destination, value) {
  if (destination.unit === 'Hz') return `${Math.round(value)} Hz`;
  if (destination.unit === 'cents') return `${Math.round(value)}¢`;
  if (destination.unit === 's') return `${value.toFixed(2)} s`;
  return value.toFixed(2);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
