import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

export const MODES = [
  "major",
  "lydian",
  "mixolydian",
  "dorian",
  "minor",
  "phrygian",
  "pentatonic",
  "minorPentatonic",
  "wholeTone",
  "japanese",
] as const;

export const ROLES = ["pad", "melody", "bells", "bass", "texture", "drums"] as const;

export const INSTRUMENTS = [
  "glass", // clear, glassy FM tone
  "felt", // soft muted piano-like
  "bell", // inharmonic, ringing
  "choir", // breathy wide pad
  "strings", // warm slow pad
  "air", // hollow, wind-like pad
  "sub", // deep sine bass
  "pluck", // short, delicate
  // orchestral (synthesized)
  "violin", // bowed, with vibrato
  "cello", // low bowed strings
  "flute", // breathy, pure
  "horn", // warm brass swell
  "harp", // plucked strings
  // electronic
  "supersaw", // wide detuned lead/pad
  "acid", // squelchy resonant bass
  "chip", // square-wave lead
  "drums", // drum machine (kick, snare, hats)
  "organ", // warm drawbar organ
  "piano", // sampled grand piano (synth fallback offline)
  "marimba", // soft wooden mallets
] as const;

export const ARC_SHAPES = ["off", "build", "buildRelease", "waves"] as const;
export type ArcShape = (typeof ARC_SHAPES)[number];

/** Electronic effects a layer can run through. */
export const FX = ["none", "sweep", "pump", "crush", "drive"] as const;
export type Fx = (typeof FX)[number];

export const MOVEMENTS = ["stepwise", "leaps", "drone", "arpeggio"] as const;
export const PROMINENCE = ["leads", "blends", "recedes"] as const;
export const RELATIONS = ["independent", "answers", "follows", "avoids", "leads"] as const;
export const SURPRISE_KINDS = ["lowSwell", "highShimmer", "cluster", "noiseGust", "foreignNote"] as const;

export const RULE_TYPES = [
  "maxVoices",
  "maxNotes",
  "eachQuieter",
  "driftApart",
  "addLayerEvery",
  "erode",
  "handoff",
  "ceiling",
  "floor",
  "thinHighs",
] as const;

export type Root = (typeof ROOTS)[number];
export type Mode = (typeof MODES)[number];
export type Role = (typeof ROLES)[number];
export type Instrument = (typeof INSTRUMENTS)[number];
export type Movement = (typeof MOVEMENTS)[number];
export type Prominence = (typeof PROMINENCE)[number];
export type Relation = (typeof RELATIONS)[number];
export type SurpriseKind = (typeof SURPRISE_KINDS)[number];
export type RuleType = (typeof RULE_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Engine configuration — the composition's "system"                   */
/* ------------------------------------------------------------------ */

const unit = z.number().min(0).max(1);

export const LayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(ROLES),
  instrument: z.enum(INSTRUMENTS),
  enabled: z.boolean(),
  /** Octave range the layer plays in (1 = very low, 7 = very high). */
  register: z.object({ low: z.number().int().min(1).max(7), high: z.number().int().min(1).max(7) }),
  /** How talkative this layer is relative to the others. */
  activity: unit,
  /** Note lengths, in seconds. */
  durations: z.object({ min: z.number().min(0.05).max(30), max: z.number().min(0.1).max(40) }),
  movement: z.enum(MOVEMENTS),
  volume: unit,
  pan: z.number().min(-1).max(1),
  /** Which sounds dominate or recede. */
  prominence: z.enum(PROMINENCE),
  /** How this layer relates to another layer. */
  relation: z.object({ type: z.enum(RELATIONS), target: z.string().nullable() }),
  /** An electronic effect on this layer. */
  fx: z.enum(FX),
  /** Speed relative to the overall tempo (0.5 = half speed, 2 = double). */
  speed: z.number().min(0.25).max(4),
  /**
   * A melody the user drew: a sequence of steps up/down the scale from
   * a starting note (null = a rest). The engine weaves it in and varies it.
   */
  theme: z
    .object({
      steps: z.array(z.number().int().min(-7).max(10).nullable()).max(16),
      /** Locked notes are never varied (same length as steps). */
      locks: z.array(z.boolean()).max(16),
      /** How often the melody appears, 0..1. */
      strength: unit,
    })
    .nullable(),
});
export type Layer = z.infer<typeof LayerSchema>;

export const RuleSchema = z.object({
  id: z.string().min(1),
  type: z.enum(RULE_TYPES),
  enabled: z.boolean(),
  /** Meaning depends on type (count, minutes, octave, step size…). */
  value: z.number(),
  /** The user's own words, if the rule came from language. */
  text: z.string(),
});
export type Rule = z.infer<typeof RuleSchema>;

/** Bumped whenever the engine's scheduling changes, so seeds stay honest. */
export const ENGINE_VERSION = 5;

export const ConfigSchema = z.object({
  version: z.literal(1),
  /**
   * layers: independent generative layers.
   * composed: one designed piece — interlocking patterns over a repeating
   * progression, with a built-in Beginning → Development → Expansion → Release form.
   */
  engine: z.object({ type: z.enum(["layers", "composed", "ambient"]), version: z.number().int() }),
  /**
   * The Markov chain that picks notes in ambient pieces: 8×8 weights,
   * row = note just played (1 … 8), column = next note. null = learned
   * from the public-domain melody corpus.
   */
  markov: z
    .object({
      preset: z.string(),
      matrix: z.array(z.array(z.number().min(0).max(100)).length(8)).length(8),
    })
    .nullable(),
  name: z.string(),
  atmosphere: z.string(),
  /** null = a fresh realization each time; a number reproduces one exactly. */
  seed: z.number().int().nullable(),
  macro: z.object({ density: unit, evolution: unit, unpredictability: unit, intensity: unit }),
  tempo: z.object({
    /** Beats per minute. */
    bpm: z.number().min(30).max(160),
    /** 0 = free-floating timing, 1 = every note locked to the beat. */
    lock: unit,
    /** Shuffle: delays every other sixteenth note (drums and locked notes). */
    swing: unit,
  }),
  harmony: z.object({
    root: z.enum(ROOTS),
    mode: z.enum(MODES),
    /**
     * The user's own scale, as semitones above the root (always includes 0).
     * When set, it replaces the mode's notes.
     */
    customScale: z.array(z.number().int().min(0).max(11)).min(3).max(12).nullable(),
    /** Allow occasional notes outside the scale (stray-note surprises). */
    chromatic: z.boolean(),
    /**
     * A repeating chord progression (scale degrees, 0 = home chord) and
     * how many bars each chord lasts. null = harmony wanders freely.
     */
    progression: z.object({ degrees: z.array(z.number().int().min(0).max(6)).min(1).max(8), bars: z.number().min(0.5).max(8) }).nullable(),
    /** How often the harmony shifts. */
    chordChange: unit,
    /** How rich / tense the chords are. */
    tension: unit,
  }),
  tone: z.object({ brightness: unit, warmth: unit }),
  space: z.object({
    reverb: unit,
    reverbMix: unit,
    echo: unit,
    echoTime: z.number().min(0.08).max(1.6),
    echoFeedback: z.number().min(0).max(0.85),
  }),
  behavior: z.object({
    /** How much notes overlap one another. */
    overlap: unit,
    /** How often short phrases return (and vary). */
    memory: unit,
    /** How often the music falls into silence. */
    silence: unit,
    /** How often unexpected events happen. */
    surprises: unit,
    surpriseKinds: z.array(z.enum(SURPRISE_KINDS)),
  }),
  /** The piece's shape over time: build, climax, release. */
  arc: z.object({ shape: z.enum(ARC_SHAPES), minutes: z.number().min(1).max(30) }),
  layers: z.array(LayerSchema).min(1).max(6),
  rules: z.array(RuleSchema).max(12),
});
export type DriftConfig = z.infer<typeof ConfigSchema>;

export const CompositionSchema = z.object({
  id: z.string(),
  savedAt: z.number(),
  /** composition = the system (new performance each time); snapshot = system + fixed seed */
  kind: z.enum(["composition", "snapshot"]),
  config: ConfigSchema,
});
export type Composition = z.infer<typeof CompositionSchema>;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

export function uid(prefix = "x"): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Bring configurations saved by older versions up to date. */
export function migrateConfig(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const c = structuredClone(raw) as Record<string, unknown> & { pace?: number; tempo?: unknown; harmony?: Record<string, unknown>; layers?: Record<string, unknown>[] };
  if (!c.tempo) {
    const pace = typeof c.pace === "number" ? c.pace : 0.3;
    c.tempo = { bpm: Math.round(30 + pace * 90), lock: 0.3, swing: 0 };
  }
  delete c.pace;
  if (c.harmony && !("customScale" in c.harmony)) c.harmony.customScale = null;
  if (c.harmony && !("chromatic" in c.harmony)) c.harmony.chromatic = Array.isArray((c as { behavior?: { surpriseKinds?: string[] } }).behavior?.surpriseKinds) && ((c as { behavior: { surpriseKinds: string[] } }).behavior.surpriseKinds.includes("foreignNote"));
  if (!c.engine) c.engine = { type: "layers", version: ENGINE_VERSION };
  if (!("markov" in c)) (c as Record<string, unknown>).markov = null;
  const mac = (c as { macro?: Record<string, number> }).macro;
  if (mac && typeof mac.intensity !== "number") mac.intensity = 0.5;
  if (c.harmony && !("progression" in c.harmony)) c.harmony.progression = null;
  if (!("arc" in c)) (c as Record<string, unknown>).arc = { shape: "off", minutes: 6 };
  if (Array.isArray(c.layers)) for (const l of c.layers) {
    if (!("speed" in l)) l.speed = 1;
    if (!("fx" in l)) l.fx = "none";
    if (!("theme" in l)) l.theme = null;
    const th = l.theme as { steps?: unknown[]; locks?: boolean[] } | null;
    if (th && !Array.isArray(th.locks)) th.locks = [];
  }
  return c;
}

/** Repair anything slightly out of range, then validate strictly. */
export function sanitizeConfig(input: unknown): DriftConfig {
  const c = migrateConfig(input) as DriftConfig;
  const u = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v) : d);
  c.macro.density = u(c.macro.density, 0.3);
  c.macro.evolution = u(c.macro.evolution, 0.4);
  c.macro.unpredictability = u(c.macro.unpredictability, 0.4);
  c.macro.intensity = u(c.macro.intensity, 0.5);
  c.tempo = {
    bpm: clamp(Math.round(c.tempo?.bpm ?? 56), 30, 160),
    lock: u(c.tempo?.lock, 0.3),
    swing: u(c.tempo?.swing, 0),
  };
  if (c.harmony.progression) {
    const degrees = c.harmony.progression.degrees.filter((x) => Number.isFinite(x)).map((x) => Math.max(0, Math.min(6, Math.round(x)))).slice(0, 8);
    c.harmony.progression = degrees.length ? { degrees, bars: clamp(c.harmony.progression.bars ?? 2, 0.5, 8) } : null;
  }
  c.arc = { shape: c.arc?.shape ?? "off", minutes: clamp(c.arc?.minutes ?? 6, 1, 30) };
  if (c.harmony.customScale) {
    const pcs = Array.from(new Set([0, ...c.harmony.customScale.map((x) => ((Math.round(x) % 12) + 12) % 12)])).sort((a, b) => a - b);
    c.harmony.customScale = pcs.length >= 3 ? pcs : null;
  } else {
    c.harmony.customScale = null;
  }
  c.harmony.chordChange = u(c.harmony.chordChange, 0.4);
  c.harmony.tension = u(c.harmony.tension, 0.3);
  c.tone.brightness = u(c.tone.brightness, 0.5);
  c.tone.warmth = u(c.tone.warmth, 0.5);
  c.space.reverb = u(c.space.reverb, 0.6);
  c.space.reverbMix = u(c.space.reverbMix, 0.4);
  c.space.echo = u(c.space.echo, 0.2);
  c.space.echoTime = clamp(c.space.echoTime ?? 0.5, 0.08, 1.6);
  c.space.echoFeedback = clamp(c.space.echoFeedback ?? 0.4, 0, 0.85);
  for (const k of ["overlap", "memory", "silence", "surprises"] as const) c.behavior[k] = u(c.behavior[k], 0.3);
  c.layers = c.layers.slice(0, 6).map((l) => {
    let low = Math.round(clamp(l.register.low, 1, 7));
    let high = Math.round(clamp(l.register.high, 1, 7));
    if (low > high) [low, high] = [high, low];
    let min = clamp(l.durations.min, 0.05, 30);
    let max = clamp(l.durations.max, 0.1, 40);
    if (min > max) [min, max] = [max, min];
    const theme = l.theme && l.theme.steps.some((x) => x !== null)
      ? {
          steps: l.theme.steps.slice(0, 16).map((x) => (x === null ? null : Math.round(clamp(x, -7, 10)))),
          locks: l.theme.steps.slice(0, 16).map((_, i) => Boolean(l.theme!.locks?.[i])),
          strength: u(l.theme.strength, 0.5),
        }
      : null;
    return {
      ...l,
      speed: clamp(l.speed ?? 1, 0.25, 4),
      fx: l.fx ?? "none",
      // the drum machine is always the drums role, and vice versa
      role: l.instrument === "drums" ? "drums" : l.role === "drums" ? "melody" : l.role,
      theme,
      register: { low, high },
      durations: { min, max },
      activity: u(l.activity, 0.5),
      volume: u(l.volume, 0.6),
      pan: clamp(l.pan, -1, 1),
    };
  });
  const ids = new Set(c.layers.map((l) => l.id));
  for (const l of c.layers) {
    if (l.relation.target && !ids.has(l.relation.target)) l.relation = { type: "independent", target: null };
    if (l.relation.target === l.id) l.relation = { type: "independent", target: null };
  }
  c.rules = c.rules.slice(0, 12);
  return ConfigSchema.parse(c);
}
