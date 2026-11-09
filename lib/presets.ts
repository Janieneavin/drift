import type { DriftConfig, Layer } from "./schema";
import { INSTRUMENTS, MODES, ROOTS, SURPRISE_KINDS, sanitizeConfig, uid } from "./schema";
import { makeRule } from "./rules";
import { presetMatrix } from "./engine/markov";

type LayerInit = Partial<Layer> & Pick<Layer, "id" | "name" | "role" | "instrument">;

export function layer(init: LayerInit): Layer {
  const defaults: Record<Layer["role"], Partial<Layer>> = {
    pad: { register: { low: 3, high: 4 }, activity: 0.4, durations: { min: 8, max: 18 }, movement: "drone", volume: 0.45 },
    melody: { register: { low: 4, high: 6 }, activity: 0.55, durations: { min: 0.6, max: 3.5 }, movement: "stepwise", volume: 0.55 },
    bells: { register: { low: 5, high: 6 }, activity: 0.3, durations: { min: 1, max: 5 }, movement: "leaps", volume: 0.4 },
    bass: { register: { low: 1, high: 2 }, activity: 0.25, durations: { min: 4, max: 10 }, movement: "drone", volume: 0.5 },
    texture: { register: { low: 4, high: 5 }, activity: 0.3, durations: { min: 4, max: 12 }, movement: "drone", volume: 0.3 },
    drums: { register: { low: 2, high: 4 }, activity: 0.5, durations: { min: 0.1, max: 0.4 }, movement: "drone", volume: 0.55 },
  };
  return {
    enabled: true,
    pan: 0,
    prominence: "blends",
    relation: { type: "independent", target: null },
    speed: 1,
    theme: null,
    fx: "none",
    ...defaults[init.role],
    ...init,
  } as Layer;
}

/**
 * Every preset is a composed piece: a pulse pattern (role "bells"), a
 * melody written in a style learned from public-domain music ("melody"),
 * interlocking figures ("texture"), sustained chords ("pad"), and a low
 * line ("bass") over a repeating progression, cycling through
 * Beginning → Development → Expansion → Release. Layers join in the order
 * the form allows, so the list order is also the arrangement.
 */
const composed = (over: Partial<DriftConfig> & Pick<DriftConfig, "name" | "atmosphere" | "layers">): DriftConfig =>
  sanitizeConfig({
    version: 1,
    engine: { type: "composed", version: 5 },
    seed: null,
    macro: { density: 0.35, evolution: 0.4, unpredictability: 0.4, intensity: 0.55 },
    tempo: { bpm: 76, lock: 1, swing: 0 },
    harmony: { root: "D", mode: "dorian", customScale: null, chromatic: false, progression: null, chordChange: 0.35, tension: 0.5 },
    tone: { brightness: 0.45, warmth: 0.6 },
    space: { reverb: 0.8, reverbMix: 0.42, echo: 0.2, echoTime: 0.79, echoFeedback: 0.35 },
    behavior: { overlap: 0.5, memory: 0.6, silence: 0, surprises: 0, surpriseKinds: [] },
    arc: { shape: "off", minutes: 6 },
    rules: [],
    ...over,
  });

/**
 * Ambient pieces (the calm presets): voices repeat over loops of lengths
 * that never line up, a Markov chain chooses their notes, pads hold the
 * slowly drifting harmony. No beat, lots of space.
 */
const ambient = (over: Partial<DriftConfig> & Pick<DriftConfig, "name" | "atmosphere" | "layers">): DriftConfig =>
  composed({
    engine: { type: "ambient", version: 5 },
    tempo: { bpm: 60, lock: 0, swing: 0 },
    behavior: { overlap: 0.7, memory: 0.6, silence: 0, surprises: 0, surpriseKinds: [] },
    space: { reverb: 0.95, reverbMix: 0.55, echo: 0.3, echoTime: 0.9, echoFeedback: 0.4 },
    ...over,
  });

const loopVoice = (id: string, name: string, instrument: Layer["instrument"], low: number, high: number, extra: Partial<Layer> = {}) =>
  layer({ id, name, role: "melody", instrument, register: { low, high }, activity: 0.45, durations: { min: 3, max: 7 }, ...extra });

export const CITY_4AM: DriftConfig = ambient({
  name: "City at 4 A.M.",
  atmosphere: "An empty city at 4 a.m. Cold, nostalgic, and quietly beautiful.",
  macro: { density: 0.25, evolution: 0.4, unpredictability: 0.55, intensity: 0.5 },
  harmony: { root: "D", mode: "dorian", customScale: null, chromatic: false, progression: null, chordChange: 0.25, tension: 0.45 },
  tone: { brightness: 0.38, warmth: 0.65 },
  markov: null, // learned from real melodies
  layers: [
    loopVoice("near", "Piano, near", "piano", 4, 5, { volume: 0.55, pan: -0.2, activity: 0.55, durations: { min: 4, max: 8 } }),
    loopVoice("far", "Piano, far away", "piano", 5, 6, { volume: 0.36, pan: 0.4, prominence: "recedes", activity: 0.35, durations: { min: 4, max: 8 } }),
    loopVoice("voices", "Voices", "choir", 4, 5, { volume: 0.3, durations: { min: 8, max: 12 }, activity: 0.25 }),
    loopVoice("keys", "Electric piano", "rhodes", 3, 4, { volume: 0.34, pan: 0.1, prominence: "recedes", activity: 0.3, durations: { min: 4, max: 7 } }),
    layer({ id: "haze", name: "String drone", role: "pad", instrument: "strings", register: { low: 3, high: 4 }, volume: 0.24, prominence: "recedes" }),
    layer({ id: "hum", name: "Low hum", role: "bass", instrument: "sub", register: { low: 2, high: 2 }, volume: 0.34, durations: { min: 8, max: 14 } }),
  
  ],
});

/* ------------------------------------------------------------------ */
/* Letter Home — a written piano piece (original)                      */
/* ------------------------------------------------------------------ */

/**
 * One bar = 8 half-beat steps. A chord is [bass, three notes for the
 * left hand]; the left hand walks up the chord on beats 2, 3 and 4 (or the
 * bar splits between two chords). `mel` is [step in the bar, note] for the
 * right hand. Notes are scale degrees: 0 = D3, 7 = D4, 14 = D5, negative = bass.
 */
type Ch = [number, number, number, number];
const bar = (ch: Ch, mel: [number, number][], ch2?: Ch): number[][] => {
  const s: number[][] = Array.from({ length: 8 }, () => []);
  s[0].push(ch[0]);
  if (ch2) {
    s[2].push(ch[2]);
    s[4].push(ch2[0]);
    s[6].push(ch2[2]);
  } else {
    s[2].push(ch[1]);
    s[4].push(ch[2]);
    s[6].push(ch[3]);
  }
  for (const [at, d] of mel) s[at].push(d);
  return s;
};
const written = (...bars: number[][][]) => bars.flat().map((n) => [...new Set(n)].sort((x, y) => x - y));

const I: Ch = [-7, 0, 2, 4];
const I_LOW: Ch = [-14, 0, 2, 4];
const ii: Ch = [-6, 1, 3, 5];
const iii: Ch = [-5, 2, 4, 6];
const IV: Ch = [-4, 0, 3, 5];
const V: Ch = [-3, 1, 4, 6];
const V_LOW: Ch = [-10, 1, 4, 6];
const vi: Ch = [-2, 0, 2, 5];

const LETTER_HOME = [
  // A — the tune
  written(bar(I, [[0, 9], [4, 8], [6, 9]]), bar(vi, [[0, 11], [6, 9]]), bar(IV, [[0, 10], [4, 12], [6, 11]]), bar(V, [[0, 8]])),
  // A′ — the tune again, coming home
  written(bar(I, [[0, 9], [4, 8], [6, 9]]), bar(vi, [[0, 11], [6, 12]]), bar(IV, [[0, 12], [2, 11], [4, 10], [6, 8]], V), bar(I, [[0, 7]])),
  // B — a falling sequence
  written(bar(IV, [[0, 14], [6, 12]]), bar(V, [[0, 13], [6, 11]]), bar(iii, [[0, 11], [6, 9]]), bar(vi, [[0, 12], [4, 11], [6, 9]])),
  // B′ — reaching back toward the tune
  written(bar(IV, [[0, 14], [4, 15], [6, 14]]), bar(V, [[0, 13], [6, 11]]), bar(ii, [[0, 12], [4, 10], [6, 8]]), bar(V_LOW, [[0, 11], [6, 13]])),
  // A, an octave higher
  written(bar(I, [[0, 16], [4, 15], [6, 16]]), bar(vi, [[0, 18], [6, 16]]), bar(ii, [[0, 17], [4, 19], [6, 18]]), bar(IV, [[0, 17], [6, 14]])),
  // A′, higher, and home
  written(bar(I, [[0, 16], [4, 15], [6, 16]]), bar(vi, [[0, 18], [6, 19]]), bar(IV, [[0, 19], [2, 18], [4, 17], [6, 15]], V), bar(I_LOW, [[0, 14]])),
  // interlude, leading back to the start
  written(bar(vi, [[0, 14]]), bar(IV, [[0, 12]]), bar(I, [[0, 11], [6, 9]]), bar(V, [[0, 8], [4, 9], [6, 11]])),
];

export const PRESETS: DriftConfig[] = [
  composed({
    name: "Letter Home",
    atmosphere: "A written piano piece: a simple, tender melody over a flowing left hand, with soft strings underneath. It plays as composed, section by section, and returns to the beginning.",
    engine: { type: "phrase", version: 5 },
    macro: { density: 1, evolution: 0.8, unpredictability: 0.25, intensity: 0.5 },
    tempo: { bpm: 66, lock: 1, swing: 0 },
    harmony: { root: "D", mode: "major", customScale: null, chromatic: false, progression: null, chordChange: 0.3, tension: 0.25 },
    tone: { brightness: 0.45, warmth: 0.72 },
    space: { reverb: 0.85, reverbMix: 0.4, echo: 0.05, echoTime: 0.9, echoFeedback: 0.2 },
    behavior: { overlap: 0.6, memory: 0.6, silence: 0, surprises: 0, surpriseKinds: [] },
    phrasebank: { builtIn: false, user: LETTER_HOME, mix: 0 },
    layers: [
      layer({ id: "piano", name: "Piano", role: "melody", instrument: "piano", register: { low: 3, high: 5 }, volume: 0.66, prominence: "leads" }),
      layer({ id: "strings", name: "Soft strings", role: "pad", instrument: "strings", register: { low: 3, high: 4 }, volume: 0.16, prominence: "recedes" }),
    ],
  }),
  CITY_4AM,
  composed({
    name: "Endless Piano",
    atmosphere: "A quiet piano piece that never ends: new phrases written one after another by a Markov chain, each sounding like it belongs.",
    engine: { type: "phrase", version: 5 },
    macro: { density: 0.7, evolution: 0.5, unpredictability: 0.35, intensity: 0.5 },
    tempo: { bpm: 92, lock: 1, swing: 0 },
    harmony: { root: "D", mode: "major", customScale: null, chromatic: false, progression: null, chordChange: 0.3, tension: 0.4 },
    tone: { brightness: 0.45, warmth: 0.68 },
    space: { reverb: 0.85, reverbMix: 0.45, echo: 0.12, echoTime: 0.65, echoFeedback: 0.3 },
    behavior: { overlap: 0.6, memory: 0.6, silence: 0, surprises: 0, surpriseKinds: [] },
    layers: [
      layer({ id: "piano", name: "Piano", role: "melody", instrument: "piano", register: { low: 3, high: 5 }, volume: 0.62, prominence: "leads" }),
      layer({ id: "echo", name: "High piano", role: "melody", instrument: "piano", register: { low: 3, high: 5 }, volume: 0.3, pan: 0.35, prominence: "recedes" }),
      layer({ id: "voices", name: "Soft voices", role: "pad", instrument: "choir", register: { low: 3, high: 4 }, volume: 0.2, prominence: "recedes", enabled: false }),
    ],
  }),
  ambient({
    name: "Departures",
    atmosphere: "An empty airport lounge at dawn: calm, spacious, unhurried — music for waiting and thinking.",
    macro: { density: 0.3, evolution: 0.25, unpredictability: 0.3, intensity: 0.45 },
    harmony: { root: "F", mode: "major", customScale: null, chromatic: false, progression: null, chordChange: 0.15, tension: 0.35 },
    tone: { brightness: 0.4, warmth: 0.7 },
    space: { reverb: 1, reverbMix: 0.58, echo: 0.25, echoTime: 1.05, echoFeedback: 0.38 },
    markov: { preset: "consonant", matrix: presetMatrix("consonant") },
    layers: [
      loopVoice("piano", "Piano", "piano", 4, 5, { volume: 0.55, pan: -0.15, activity: 0.5, durations: { min: 5, max: 9 } }),
      loopVoice("piano2", "Second piano", "piano", 5, 5, { volume: 0.38, pan: 0.35, activity: 0.3, durations: { min: 5, max: 9 }, prominence: "recedes" }),
      loopVoice("voices", "Voices", "choir", 4, 5, { volume: 0.3, activity: 0.2, durations: { min: 9, max: 13 } }),
      loopVoice("low", "Low voices", "choir", 3, 3, { volume: 0.26, activity: 0.15, durations: { min: 10, max: 14 }, prominence: "recedes" }),
      layer({ id: "air", name: "Air", role: "pad", instrument: "strings", register: { low: 3, high: 3 }, volume: 0.2, prominence: "recedes" }),
    ],
  }),
  ambient({
    name: "Abandoned Cathedral",
    atmosphere: "Sunlight filtering through an abandoned cathedral.",
    macro: { density: 0.3, evolution: 0.3, unpredictability: 0.3, intensity: 0.5 },
    harmony: { root: "F", mode: "lydian", customScale: null, chromatic: false, progression: null, chordChange: 0.2, tension: 0.4 },
    tone: { brightness: 0.55, warmth: 0.65 },
    space: { reverb: 1, reverbMix: 0.62, echo: 0.15, echoTime: 1.1, echoFeedback: 0.3 },
    markov: { preset: "consonant", matrix: presetMatrix("consonant") },
    layers: [
      loopVoice("harp", "Harp", "harp", 4, 5, { volume: 0.5, pan: -0.3 }),
      loopVoice("keys", "Electric piano", "rhodes", 4, 5, { volume: 0.36, pan: 0.25, durations: { min: 4, max: 7 }, activity: 0.35 }),
      loopVoice("choir", "Choir", "choir", 4, 5, { volume: 0.3, durations: { min: 7, max: 12 }, activity: 0.3 }),
      layer({ id: "organ", name: "Stone organ", role: "pad", instrument: "organ", register: { low: 3, high: 4 }, volume: 0.28, prominence: "recedes" }),
      layer({ id: "cello", name: "Cello", role: "bass", instrument: "cello", register: { low: 2, high: 3 }, volume: 0.38, durations: { min: 5, max: 10 } }),
    ],
  }),
  ambient({
    name: "Uneasy Summer Evening",
    atmosphere: "A warm summer evening that feels slightly unsettling.",
    macro: { density: 0.35, evolution: 0.5, unpredictability: 0.55, intensity: 0.5 },
    harmony: { root: "A", mode: "mixolydian", customScale: null, chromatic: false, progression: null, chordChange: 0.35, tension: 0.7 },
    tone: { brightness: 0.48, warmth: 0.78 },
    space: { reverb: 0.7, reverbMix: 0.42, echo: 0.35, echoTime: 0.62, echoFeedback: 0.45 },
    markov: null,
    layers: [
      loopVoice("keys", "Piano", "piano", 4, 5, { volume: 0.52, pan: -0.25 }),
      loopVoice("keys", "Electric piano", "rhodes", 3, 4, { volume: 0.38, durations: { min: 4, max: 8 }, activity: 0.35 }),
      loopVoice("insects", "Harp", "harp", 5, 6, { volume: 0.3, pan: 0.45, durations: { min: 2, max: 4 }, activity: 0.45 }),
      layer({ id: "haze", name: "Warm strings", role: "pad", instrument: "strings", register: { low: 3, high: 4 }, volume: 0.3 }),
      layer({ id: "deep", name: "Heavy air", role: "bass", instrument: "sub", register: { low: 2, high: 2 }, volume: 0.36, durations: { min: 6, max: 12 } }),
    ],
  }),
  ambient({
    name: "Underwater",
    atmosphere: "Floating underwater with distant sounds above.",
    macro: { density: 0.3, evolution: 0.35, unpredictability: 0.4, intensity: 0.45 },
    harmony: { root: "E", mode: "minor", customScale: null, chromatic: false, progression: null, chordChange: 0.15, tension: 0.4 },
    tone: { brightness: 0.22, warmth: 0.72 },
    space: { reverb: 0.98, reverbMix: 0.6, echo: 0.45, echoTime: 1.2, echoFeedback: 0.5 },
    markov: { preset: "stepwise", matrix: presetMatrix("stepwise") },
    layers: [
      loopVoice("drops", "Electric piano", "rhodes", 4, 5, { volume: 0.42, pan: 0.3, durations: { min: 4, max: 8 } }),
      loopVoice("above", "Distant voices", "choir", 4, 5, { volume: 0.28, prominence: "recedes", activity: 0.3, durations: { min: 8, max: 12 } }),
      loopVoice("light", "Light above", "harp", 5, 6, { volume: 0.3, pan: -0.35, activity: 0.35 }),
      layer({ id: "current", name: "Current", role: "pad", instrument: "air", register: { low: 3, high: 4 }, volume: 0.38 }),
      layer({ id: "deep", name: "Deep call", role: "bass", instrument: "sub", register: { low: 1, high: 2 }, volume: 0.42, durations: { min: 6, max: 12 } }),
    ],
  }),
  composed({
    name: "Night Drive",
    atmosphere: "Driving through a neon city after midnight, electronic and hypnotic.",
    macro: { density: 0.55, evolution: 0.45, unpredictability: 0.3, intensity: 0.7 },
    tempo: { bpm: 112, lock: 1, swing: 0.1 },
    harmony: { root: "F", mode: "minor", customScale: null, chromatic: false, progression: { degrees: [0, 5, 2, 6], bars: 2 }, chordChange: 0.35, tension: 0.45 },
    tone: { brightness: 0.6, warmth: 0.45 },
    space: { reverb: 0.55, reverbMix: 0.3, echo: 0.4, echoTime: 0.4, echoFeedback: 0.45 },
    layers: [
      layer({ id: "chip", name: "Chip pulse", role: "bells", instrument: "chip", register: { low: 4, high: 5 }, volume: 0.32, pan: -0.2 }),
      layer({ id: "lead", name: "Synth lead", role: "melody", instrument: "supersaw", register: { low: 4, high: 5 }, volume: 0.32, prominence: "leads", fx: "drive" }),
      layer({ id: "saw", name: "Neon pad", role: "pad", instrument: "supersaw", register: { low: 3, high: 4 }, volume: 0.3, fx: "pump" }),
      layer({ id: "acid", name: "Acid bass", role: "bass", instrument: "acid", register: { low: 2, high: 2 }, volume: 0.42, fx: "sweep" }),
      layer({ id: "beat", name: "Machine pulse", role: "drums", instrument: "drums", activity: 0.55, volume: 0.5 }),
      layer({ id: "keys", name: "Piano stabs", role: "texture", instrument: "piano", register: { low: 4, high: 5 }, volume: 0.35, pan: 0.3 }),
    ],
  }),
  ambient({
    name: "Orchestral Dawn",
    atmosphere: "First light over a quiet valley, as a small orchestra wakes up.",
    macro: { density: 0.35, evolution: 0.35, unpredictability: 0.35, intensity: 0.5 },
    harmony: { root: "G", mode: "major", customScale: null, chromatic: false, progression: null, chordChange: 0.3, tension: 0.4 },
    tone: { brightness: 0.52, warmth: 0.72 },
    space: { reverb: 0.88, reverbMix: 0.48, echo: 0.12, echoTime: 0.7, echoFeedback: 0.3 },
    markov: { preset: "learned", matrix: presetMatrix("learned") },
    layers: [
      loopVoice("violin", "Solo violin", "violin", 4, 6, { volume: 0.45, durations: { min: 3, max: 6 }, prominence: "leads" }),
      loopVoice("flute", "Flute", "flute", 5, 6, { volume: 0.34, pan: 0.35, activity: 0.35 }),
      loopVoice("harp", "Harp", "harp", 4, 5, { volume: 0.45, pan: -0.35 }),
      layer({ id: "strings", name: "String section", role: "pad", instrument: "strings", register: { low: 3, high: 4 }, volume: 0.32 }),
      layer({ id: "cello", name: "Cello", role: "bass", instrument: "cello", register: { low: 2, high: 3 }, volume: 0.4, durations: { min: 5, max: 10 } }),
    ],
  }),
  composed({
    name: "Great Vessel",
    atmosphere: "Something expansive and bittersweet: a simple repeating chord progression, warm sustained synthesizers, and layers that gradually build toward an emotional climax.",
    macro: { density: 0.5, evolution: 0.3, unpredictability: 0.25, intensity: 0.75 },
    tempo: { bpm: 76, lock: 1, swing: 0 },
    harmony: { root: "D#", mode: "major", customScale: null, chromatic: false, progression: { degrees: [0, 3, 5, 4], bars: 2 }, chordChange: 0.4, tension: 0.45 },
    tone: { brightness: 0.5, warmth: 0.75 },
    space: { reverb: 0.8, reverbMix: 0.45, echo: 0.25, echoTime: 0.395, echoFeedback: 0.4 },
    layers: [
      layer({ id: "pulse", name: "Glass pulse", role: "bells", instrument: "glass", register: { low: 5, high: 6 }, volume: 0.4, pan: 0.35 }),
      layer({ id: "line", name: "Rising line", role: "melody", instrument: "supersaw", register: { low: 4, high: 5 }, volume: 0.32, prominence: "leads", fx: "sweep" }),
      layer({ id: "organ", name: "Warm organ", role: "pad", instrument: "organ", register: { low: 3, high: 4 }, volume: 0.38 }),
      layer({ id: "root", name: "Ground", role: "bass", instrument: "sub", register: { low: 1, high: 2 }, volume: 0.5 }),
      layer({ id: "drums", name: "Machine heart", role: "drums", instrument: "drums", activity: 0.3, volume: 0.42 }),
      layer({ id: "choir", name: "Choir at the peak", role: "pad", instrument: "choir", register: { low: 4, high: 5 }, volume: 0.32, prominence: "recedes" }),
    ],
  }),
];

/* ------------------------------------------------------------------ */
/* Randomize — explore new systems                                     */
/* ------------------------------------------------------------------ */

const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

const ADJ = ["Quiet", "Drifting", "Hollow", "Amber", "Paper", "Salt", "Northern", "Slow", "Glass", "Lantern", "Winter", "Velvet"];
const NOUN = ["Harbor", "Orbit", "Garden", "Corridor", "Tide", "Archive", "Meadow", "Signal", "Window", "Station", "Field", "Room"];

export function randomConfig(): DriftConfig {
  // a composed piece always has a pulse, a melody, chords and a low line
  const roles: Layer["role"][] = ["bells", "melody", "pad", "bass"];
  if (Math.random() < 0.6) roles.push("texture");
  const instFor: Record<Layer["role"], readonly Layer["instrument"][]> = {
    pad: ["strings", "choir", "organ", "supersaw"],
    melody: ["violin", "flute", "cello", "supersaw", "horn"],
    bells: ["piano", "harp", "glass", "chip"],
    bass: ["sub", "cello", "acid"],
    texture: ["pluck", "harp", "piano", "flute"],
    drums: ["drums"],
  };
  const names: Record<Layer["role"], string[]> = {
    pad: ["Haze", "Wash", "Breath", "Horizon"],
    melody: ["Thread", "Wanderer", "Voice", "Line"],
    bells: ["Sparks", "Chimes", "Glints", "Stars"],
    bass: ["Undertow", "Ground", "Deep hum"],
    texture: ["Grain", "Flutter", "Dust"],
    drums: ["Pulse"],
  };
  const layers = roles.map((role, i) => {
    const instrument = pick(instFor[role]);
    return layer({
      id: uid("layer"),
      name: `${pick(names[role])} (${instrument})`,
      role,
      instrument,
      pan: rnd(-0.6, 0.6),
      activity: rnd(0.2, 0.7),
      prominence: i === 1 ? "leads" : pick(["blends", "blends", "recedes"] as const),
    });
  });
  // occasionally let one melodic layer answer another
  const melodic = layers.filter((l) => l.role === "melody" || l.role === "bells");
  if (melodic.length >= 2 && Math.random() < 0.6) {
    melodic[1].relation = { type: pick(["answers", "follows", "avoids"] as const), target: melodic[0].id };
  }
  return sanitizeConfig({
    version: 1,
    engine: { type: "composed", version: 5 },
    name: `${pick(ADJ)} ${pick(NOUN)}`,
    atmosphere: "A randomized system — describe what it makes you feel, or keep exploring.",
    seed: null,
    macro: { density: rnd(0.15, 0.6), evolution: rnd(0.2, 0.7), unpredictability: rnd(0.2, 0.7), intensity: 0.5 },
    tempo: { bpm: Math.round(rnd(38, 80)), lock: rnd(0.1, 0.7), swing: 0 },
    harmony: { root: pick(ROOTS), mode: pick(MODES.filter((m) => m !== "wholeTone")), customScale: null, chromatic: Math.random() < 0.3, progression: null, chordChange: rnd(0.15, 0.6), tension: rnd(0.1, 0.7) },
    tone: { brightness: rnd(0.2, 0.7), warmth: rnd(0.2, 0.8) },
    space: { reverb: rnd(0.4, 1), reverbMix: rnd(0.25, 0.6), echo: rnd(0, 0.5), echoTime: rnd(0.2, 1.2), echoFeedback: rnd(0.2, 0.6) },
    behavior: {
      overlap: rnd(0.2, 0.8),
      memory: rnd(0.1, 0.7),
      silence: rnd(0.1, 0.5),
      surprises: rnd(0.1, 0.5),
      surpriseKinds: SURPRISE_KINDS.filter(() => Math.random() < 0.5),
    },
    layers,
    rules: Math.random() < 0.5 ? [makeRule(pick(["driftApart", "eachQuieter", "handoff", "thinHighs"] as const))] : [],
  });
}

/** A near-empty system to build up layer by layer. */
export function blankConfig(): DriftConfig {
  return sanitizeConfig({
    ...structuredClone(CITY_4AM),
    name: "Untitled system",
    atmosphere: "",
    seed: null,
    rules: [],
    behavior: { ...CITY_4AM.behavior, surprises: 0.1 },
    layers: [layer({ id: uid("layer"), name: "Ground", role: "pad", instrument: "strings", volume: 0.4 })],
  });
}

export const INSTRUMENT_LABEL: Record<(typeof INSTRUMENTS)[number], string> = {
  glass: "glass",
  felt: "felt piano",
  bell: "bells",
  choir: "choir",
  strings: "strings",
  air: "air",
  sub: "deep hum",
  pluck: "pluck",
  violin: "violin",
  cello: "cello",
  flute: "flute",
  horn: "horn",
  harp: "harp",
  supersaw: "supersaw",
  acid: "acid bass",
  chip: "chip lead",
  drums: "drum machine",
  organ: "organ",
  piano: "grand piano",
  rhodes: "electric piano",
  marimba: "marimba",
};

export const INSTRUMENT_GROUPS: { label: string; items: (typeof INSTRUMENTS)[number][] }[] = [
  { label: "Ambient", items: ["piano", "rhodes", "marimba", "glass", "felt", "bell", "choir", "strings", "air", "sub", "pluck"] },
  { label: "Orchestral", items: ["violin", "cello", "flute", "horn", "harp"] },
  { label: "Electronic", items: ["supersaw", "organ", "acid", "chip", "drums"] },
];

/** A sensible role for an instrument chosen from a menu. */
export function roleFor(inst: (typeof INSTRUMENTS)[number]): Layer["role"] {
  if (inst === "drums") return "drums";
  if (["choir", "strings", "air", "supersaw", "organ"].includes(inst)) return "pad";
  if (["sub", "cello", "acid"].includes(inst)) return "bass";
  if (["bell", "harp"].includes(inst)) return "bells";
  return "melody";
}
