/* ==========================================================================
   rudraVeenaStrings.js — the Rudra Veena as DATA: strings, tunings, lanes.

   The instrument is seven strings, not one:
       4 MAIN (melody) strings   fretted by the left hand, plucked by the right
       3 CHIKARI strings         rhythmic drone strings (+ an optional Laraj
                                 string the architecture already has room for)

   Nothing here is "the" correct tuning: Rudra Veena traditions and
   individual instruments differ, so tunings are selectable presets plus a
   Custom option, each clearly labelled as a configuration. The pitch engine
   only ever reads `cents above Sa`, so adding a tuning = adding one object.

   Geometry (stage-normalized, shared by controller and visuals): four main
   lanes stacked over the neck, a separate chikari cluster beneath.
   Pure data + maths — no DOM, no audio.
   ETHER VEENA — © 2026 egoaid
   ========================================================================== */

import { SWARA_CENTS, SWARA_NAMES, ragaPitchCents } from './ragas.js';

// -- Swara choices (for custom tunings) -------------------------------------------

const octMark = (o) => (o < 0 ? '₋'.repeat(-o) : o > 0 ? '′'.repeat(o) : '');

/** Every swara slot over octaves −1..+2: {id:'5:-1', label:'Ma₋', cents}. */
export const SWARA_CHOICES = (() => {
  const out = [];
  for (let oct = -1; oct <= 2; oct++) {
    for (let slot = 0; slot < 12; slot++) {
      out.push({ id: `${slot}:${oct}`, label: `${SWARA_NAMES[slot]}${octMark(oct)}`, cents: SWARA_CENTS[slot] + 1200 * oct, slot, oct });
    }
  }
  return out;
})();
const choice = (id) => SWARA_CHOICES.find((c) => c.id === id) ?? SWARA_CHOICES.find((c) => c.id === '0:0');
const sw = (slot, oct) => `${slot}:${oct}`;

// -- Tuning presets -----------------------------------------------------------------

/**
 * RUDRA VEENA TUNINGS — researched summary (build 022). The Rudra Veena has no single tuning: the root (Sa) moves with the player and
 * the day (Dagarbani players ≈ G♯/A, Asad Ali Khan's Khandarbani school ≈ G or lower), and the string SET is a player's choice.
 * What the sources document (Grove via Wikipedia "Rudra veena"; a luthier's setup of an Asad Ali Khan instrument, sitarfactory.be;
 * ragajunglism.org; Wikipedia "Veena"):
 *   · standard melody strings:  Ma₋ (a fifth below Sa) · Sa · Pa · Sa′   (e.g. D2 A2 E3 A3, or B♭1 F2 C3 F3)
 *   · Asad Ali Khan setup:      kharaj Sa₋ · baj Ma₋ · Pa₋ · Sa;  chikari Sa′ and Sa″ (G♯3, G♯4 for Sa = G♯2); laraj Sa
 *   · Dagarbani instruments:    8 strings (a kharaj bass string and a laraj), tuned higher with thicker strings
 *   · drone (chikari) strings:  Sa″ · Pa′ · Sa′ (Sa–Pa–Sa) on the Veena family; Sa′/Sa″ pairs on Khandarbani instruments
 * The entries marked VARIANT are common-sense settings (as in sitar practice: Pa / Ma / Ni tuning chosen by raga) that musicians
 * may use but that I could not confirm for the Rudra Veena specifically — they are offered as configurations, not as facts.
 * Main-string tunings: four swara choices (lowest string first).
 */
export const MAIN_TUNINGS = [
  { id: 'style-a', name: 'Standard — Ma₋ · Sa · Pa · Sa′ (documented)', strings: [sw(5, -1), sw(0, 0), sw(7, 0), sw(0, 1)] },
  { id: 'khandarbani', name: 'Khandarbani (Asad Ali Khan setup) — Sa₋ · Ma₋ · Pa₋ · Sa (documented)', strings: [sw(0, -1), sw(5, -1), sw(7, -1), sw(0, 0)] },
  { id: 'style-b', name: 'Pancham — Pa₋ · Sa · Pa · Sa′ (variant)', strings: [sw(7, -1), sw(0, 0), sw(7, 0), sw(0, 1)] },
  { id: 'kharaj', name: 'Kharaj bass — Sa₋ · Sa · Pa · Sa′ (Dagar-style kharaj, variant)', strings: [sw(0, -1), sw(0, 0), sw(7, 0), sw(0, 1)] },
  { id: 'nishad', name: 'Nishad — Ni₋ · Sa · Pa · Sa′ (for Pa-less ragas, variant)', strings: [sw(11, -1), sw(0, 0), sw(7, 0), sw(0, 1)] },
  { id: 'custom', name: 'Custom', strings: null },
];

/**
 * Chikari tunings: three swara choices. Register is an octave or two above the main Sa. The chikari is played as ONE voice
 * (see chikariVoice): the lowest string is its pitch, the other strings add faint colour — so these are timbre/pitch choices.
 */
export const CHIKARI_TUNINGS = [
  { id: 'sa-sa-sa2', name: 'Sa′ / Sa′ / Sa″ (Khandarbani, documented)', strings: [sw(0, 1), sw(0, 1), sw(0, 2)] },
  { id: 'sa-pa-sa2', name: 'Sa′ / Pa′ / Sa″ (Sa–Pa–Sa drones, documented for the veena family)', strings: [sw(0, 1), sw(7, 1), sw(0, 2)] },
  { id: 'sa-ma-sa2', name: 'Sa′ / Ma′ / Sa″ (variant)', strings: [sw(0, 1), sw(5, 1), sw(0, 2)] },
  { id: 'pa-sa-sa2', name: 'Pa / Sa′ / Sa″ (variant)', strings: [sw(7, 0), sw(0, 1), sw(0, 2)] },
  { id: 'custom', name: 'Custom', strings: null },
];

/**
 * The chikari as ONE sound: the lowest chikari string is the voice's pitch, and every OTHER string that is not a unison or an
 * octave of it adds a faint extra partial at its own pitch (so a Pa′ chikari still colours the sound). Octaves/unisons are
 * already the voice's own harmonics. Returns {cents, extras:[ratio…]} (at most 2 extras).
 */
export function chikariVoice(chikari) {
  const strings = chikari.filter((c) => c.role === 'chikari');
  if (!strings.length) return null;
  const root = Math.min(...strings.map((c) => c.cents));
  const extras = [];
  for (const c of strings) {
    const d = c.cents - root;
    if (d < 1 || Math.abs(d % 1200) < 1 || Math.abs((d % 1200) - 1200) < 1) continue;
    const ratio = Math.pow(2, (d % 1200) / 1200);
    if (!extras.some((r) => Math.abs(Math.log2(r / ratio)) < 0.01)) extras.push(ratio);
  }
  return { cents: root, extras: extras.slice(0, 2) };
}

/** A researched pool for the Randomize button (preset ids, with weights favouring the documented settings). */
export const RANDOM_MAIN = [['style-a', 3], ['khandarbani', 2], ['style-b', 1.3], ['kharaj', 1], ['nishad', 0.7]];
export const RANDOM_CHIKARI = [['sa-sa-sa2', 3], ['sa-pa-sa2', 3], ['sa-ma-sa2', 1], ['pa-sa-sa2', 1]];
/** Sa (the root) as played: Dagarbani ≈ G♯/A, Khandarbani ≈ G or lower (E–F heard), B♭ in the Grove example → pitch classes D…B♭. */
export const RUDRA_SA_PCS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Optional extra drone string. Present in the data model; the UI can switch it on later. */
export const LARAJ = { id: 'laraj', name: 'Laraj', swara: sw(0, -1), role: 'laraj' };

export const DEFAULT_TUNING_OPTIONS = {
  tuning: 'style-a',
  chikariTuning: 'sa-sa-sa2',
  customMain: [sw(5, -1), sw(0, 0), sw(7, 0), sw(0, 1)],
  customChikari: [sw(0, 1), sw(0, 1), sw(0, 2)],
  laraj: false,
};

/**
 * Turn the selected presets into concrete strings.
 * @returns {{melody:Array<{id,name,cents,openRuler,role:'melody',index}>, chikari:Array<{id,name,cents,role,index}>}}
 */
export function resolveRudraTuning(opts = {}) {
  const o = { ...DEFAULT_TUNING_OPTIONS, ...opts };
  const main = MAIN_TUNINGS.find((t) => t.id === o.tuning) ?? MAIN_TUNINGS[0];
  const chik = CHIKARI_TUNINGS.find((t) => t.id === o.chikariTuning) ?? CHIKARI_TUNINGS[0];
  const mainIds = main.strings ?? o.customMain;
  const chikIds = chik.strings ?? o.customChikari;

  const melody = mainIds.map((id, index) => {
    const c = choice(id);
    return { id: `main-${index + 1}`, name: c.label, cents: c.cents, openRuler: c.slot + 12 * c.oct, role: 'melody', index };
  });
  const chikari = chikIds.map((id, index) => {
    const c = choice(id);
    return { id: `chikari-${index + 1}`, name: c.label, cents: c.cents, role: 'chikari', index };
  });
  if (o.laraj) {
    const c = choice(LARAJ.swara);
    chikari.push({ id: 'laraj', name: LARAJ.name, cents: c.cents, role: 'laraj', index: chikari.length });
  }
  return { melody, chikari };
}

// -- Fretting ------------------------------------------------------------------------

/**
 * Pitch (cents above Sa) of melody string `str` fretted `r` semitones along the neck ruler.
 * At the nut (r = 0) the string sounds exactly its open tuning; further along,
 * the raga's swaras (just intonation, meend between them) take over, blended in
 * over the first ~0.8 semitone so there is never a jump.
 */
export function frettedCents(str, r, raga, { pull = 0.5, direction = 'up' } = {}) {
  const rr = Math.max(0, r);
  const raga01 = ragaPitchCents(str.openRuler + rr, raga, { pull, direction }).cents;
  const w = Math.min(1, rr / 0.8);
  const ease = w * w * (3 - 2 * w);
  return str.cents + ease * (raga01 - str.cents);
}

// -- Lane geometry (stage-normalized) --------------------------------------------------

export const NECK_X0 = 0.07;
export const NECK_X1 = 0.62;
export const PLUCK_X0 = 0.66;
export const STRINGS_X1 = 0.94;

export const MAIN_LANES_Y0 = 0.36;
export const MAIN_LANE_H = 0.075;
export const CHIKARI_Y0 = 0.74;
export const CHIKARI_LANE_H = 0.05;

export const mainLaneCenter = (i) => MAIN_LANES_Y0 + (i + 0.5) * MAIN_LANE_H;
export const chikariLaneCenter = (i) => CHIKARI_Y0 + (i + 0.5) * CHIKARI_LANE_H;
export const MAIN_LANES_Y1 = MAIN_LANES_Y0 + 4 * MAIN_LANE_H;

/** Is a fingertip over the main strings (the neck)? Used to tell "fretting" from "hand somewhere else". */
export const onNeck = (x, y, mx = 0.03, my = 0.05) => x >= NECK_X0 - mx && x <= NECK_X1 + mx && y >= MAIN_LANES_Y0 - my && y <= MAIN_LANES_Y1 + my;

/** Which main lane does y fall in (nearest; `null` if clearly outside the main cluster)? */
export function mainLaneAt(y, margin = 0.05) {
  if (y < MAIN_LANES_Y0 - margin || y > MAIN_LANES_Y1 + margin) return null;
  return Math.min(3, Math.max(0, Math.floor((y - MAIN_LANES_Y0) / MAIN_LANE_H)));
}

/** Which chikari lane (0..n-1) does y fall in, `null` if outside that cluster? */
export function chikariLaneAt(y, n = 3, margin = 0.03) {
  const y1 = CHIKARI_Y0 + n * CHIKARI_LANE_H;
  if (y < CHIKARI_Y0 - margin || y > y1 + margin) return null;
  return Math.min(n - 1, Math.max(0, Math.floor((y - CHIKARI_Y0) / CHIKARI_LANE_H)));
}
