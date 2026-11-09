import { z } from "zod";
import {
  ARC_SHAPES,
  FX,
  INSTRUMENTS,
  MODES,
  MOVEMENTS,
  PROMINENCE,
  RELATIONS,
  ROLES,
  ROOTS,
  RULE_TYPES,
  SURPRISE_KINDS,
  type DriftConfig,
  type Layer,
  sanitizeConfig,
} from "../schema";
import { clampRuleValue, makeRule } from "../rules";

/**
 * What the AI returns: a PATCH, not a whole new configuration.
 * Every field is nullable — null means "leave this exactly as it is".
 * That is how "keep everything the same, but…" is guaranteed.
 */
const N = z.number().nullable();

const AILayer = z.object({
  name: z.string(),
  role: z.enum(ROLES),
  instrument: z.enum(INSTRUMENTS),
  registerLow: z.number().int(),
  registerHigh: z.number().int(),
  activity: z.number(),
  minDuration: z.number(),
  maxDuration: z.number(),
  movement: z.enum(MOVEMENTS),
  volume: z.number(),
  pan: z.number(),
  prominence: z.enum(PROMINENCE),
  relationType: z.enum(RELATIONS),
  relationTarget: z.string().nullable(),
  speed: z.number(),
  fx: z.enum(FX),
  themeSteps: z.array(z.number().int().nullable()).nullable(),
  themeStrength: z.number(),
});

const AILayerEdit = z.object({
  id: z.string(),
  remove: z.boolean(),
  enabled: z.boolean().nullable(),
  name: z.string().nullable(),
  instrument: z.enum(INSTRUMENTS).nullable(),
  registerLow: z.number().int().nullable(),
  registerHigh: z.number().int().nullable(),
  activity: N,
  minDuration: N,
  maxDuration: N,
  movement: z.enum(MOVEMENTS).nullable(),
  volume: N,
  pan: N,
  prominence: z.enum(PROMINENCE).nullable(),
  relationType: z.enum(RELATIONS).nullable(),
  relationTarget: z.string().nullable(),
  speed: N,
  fx: z.enum(FX).nullable(),
  /** null = keep; [] = remove the melody; otherwise the new melody. */
  themeSteps: z.array(z.number().int().nullable()).nullable(),
  themeStrength: N,
});

const AIRule = z.object({
  type: z.enum(RULE_TYPES),
  value: z.number().nullable(),
  text: z.string(),
});

const AIRuleEdit = z.object({
  id: z.string(),
  remove: z.boolean(),
  enabled: z.boolean().nullable(),
  value: z.number().nullable(),
});

export const AIPatchSchema = z.object({
  reply: z.string(),
  name: z.string().nullable(),
  atmosphere: z.string().nullable(),
  macro: z.object({ density: N, evolution: N, unpredictability: N, intensity: N }),
  tempo: z.object({ bpm: N, lock: N, swing: N }),
  arc: z.object({ shape: z.enum(ARC_SHAPES).nullable(), minutes: N }),
  harmony: z.object({
    root: z.enum(ROOTS).nullable(),
    mode: z.enum(MODES).nullable(),
    /** semitones above the root; setting a mode without this clears any custom scale */
    customScale: z.array(z.number().int()).nullable(),
    chromatic: z.boolean().nullable(),
    /** a repeating progression; degrees [] = go back to wandering freely */
    progression: z.object({ degrees: z.array(z.number().int()), bars: z.number() }).nullable(),
    chordChange: N,
    tension: N,
  }),
  tone: z.object({ brightness: N, warmth: N }),
  space: z.object({ reverb: N, reverbMix: N, echo: N, echoTime: N, echoFeedback: N }),
  behavior: z.object({ overlap: N, memory: N, silence: N, surprises: N, surpriseKinds: z.array(z.enum(SURPRISE_KINDS)).nullable() }),
  replaceLayers: z.array(AILayer).nullable(),
  layerEdits: z.array(AILayerEdit),
  addLayers: z.array(AILayer),
  addRules: z.array(AIRule),
  ruleEdits: z.array(AIRuleEdit),
  triggerSurprise: z.boolean(),
  unsupported: z.array(z.object({ request: z.string(), reason: z.string() })),
});
export type AIPatch = z.infer<typeof AIPatchSchema>;

export function emptyPatch(reply = ""): AIPatch {
  return {
    reply,
    name: null,
    atmosphere: null,
    macro: { density: null, evolution: null, unpredictability: null, intensity: null },
    tempo: { bpm: null, lock: null, swing: null },
    harmony: { root: null, mode: null, customScale: null, chromatic: null, progression: null, chordChange: null, tension: null },
    arc: { shape: null, minutes: null },
    tone: { brightness: null, warmth: null },
    space: { reverb: null, reverbMix: null, echo: null, echoTime: null, echoFeedback: null },
    behavior: { overlap: null, memory: null, silence: null, surprises: null, surpriseKinds: null },
    replaceLayers: null,
    layerEdits: [],
    addLayers: [],
    addRules: [],
    ruleEdits: [],
    triggerSurprise: false,
    unsupported: [],
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "layer";

function toLayer(a: z.infer<typeof AILayer>, id: string): Layer {
  return {
    id,
    name: a.name,
    role: a.role,
    instrument: a.instrument,
    enabled: true,
    register: { low: a.registerLow, high: a.registerHigh },
    activity: a.activity,
    durations: { min: a.minDuration, max: a.maxDuration },
    movement: a.movement,
    volume: a.volume,
    pan: a.pan,
    prominence: a.prominence,
    relation: { type: a.relationType, target: a.relationTarget },
    speed: a.speed,
    fx: a.fx,
    theme: a.themeSteps && a.themeSteps.some((x) => x !== null) ? { steps: a.themeSteps, locks: a.themeSteps.map(() => false), strength: a.themeStrength } : null,
  };
}

/** A human-readable list of what a patch changed (shown to the user). */
export interface ApplyResult {
  config: DriftConfig;
  changes: string[];
}

/** Merge a patch into the current configuration, then validate it. */
export function applyPatch(current: DriftConfig, p: AIPatch): ApplyResult {
  const c = structuredClone(current);
  const changes: string[] = [];
  const set = <T,>(label: string, value: T | null | undefined, apply: (v: T) => void) => {
    if (value === null || value === undefined) return;
    apply(value);
    changes.push(label);
  };

  set("name", p.name, (v) => (c.name = v));
  set("atmosphere", p.atmosphere, (v) => (c.atmosphere = v));
  set("density", p.macro.density, (v) => (c.macro.density = v));
  set("evolution", p.macro.evolution, (v) => (c.macro.evolution = v));
  set("unpredictability", p.macro.unpredictability, (v) => (c.macro.unpredictability = v));
  set("intensity", p.macro.intensity, (v) => (c.macro.intensity = v));
  set("tempo", p.tempo.bpm, (v) => (c.tempo.bpm = v));
  set("pulse", p.tempo.lock, (v) => (c.tempo.lock = v));
  set("swing", p.tempo.swing, (v) => (c.tempo.swing = v));
  set("key", p.harmony.root, (v) => (c.harmony.root = v));
  set("harmonic color", p.harmony.mode, (v) => {
    c.harmony.mode = v;
    c.harmony.customScale = null;
  });
  set("scale notes", p.harmony.customScale, (v) => (c.harmony.customScale = v.length >= 3 ? v : null));
  set("notes outside the scale", p.harmony.chromatic, (v) => (c.harmony.chromatic = v));
  set("chord progression", p.harmony.progression, (v) => (c.harmony.progression = v.degrees.length ? { degrees: v.degrees, bars: v.bars } : null));
  set("shape over time", p.arc.shape, (v) => (c.arc.shape = v));
  set("length of the arc", p.arc.minutes, (v) => (c.arc.minutes = v));
  set("how often harmony shifts", p.harmony.chordChange, (v) => (c.harmony.chordChange = v));
  set("richness of chords", p.harmony.tension, (v) => (c.harmony.tension = v));
  set("brightness", p.tone.brightness, (v) => (c.tone.brightness = v));
  set("warmth", p.tone.warmth, (v) => (c.tone.warmth = v));
  set("size of the space", p.space.reverb, (v) => (c.space.reverb = v));
  set("amount of reverb", p.space.reverbMix, (v) => (c.space.reverbMix = v));
  set("echoes", p.space.echo, (v) => (c.space.echo = v));
  set("echo timing", p.space.echoTime, (v) => (c.space.echoTime = v));
  set("echo repeats", p.space.echoFeedback, (v) => (c.space.echoFeedback = v));
  set("overlap", p.behavior.overlap, (v) => (c.behavior.overlap = v));
  set("returning phrases", p.behavior.memory, (v) => (c.behavior.memory = v));
  set("silences", p.behavior.silence, (v) => (c.behavior.silence = v));
  set("surprises", p.behavior.surprises, (v) => (c.behavior.surprises = v));
  set("kinds of surprises", p.behavior.surpriseKinds, (v) => (c.behavior.surpriseKinds = v));

  // layers
  const nameToId = new Map<string, string>();
  const used = new Set<string>();
  const uniqueId = (name: string) => {
    let id = slug(name);
    let i = 2;
    while (used.has(id)) id = `${slug(name)}-${i++}`;
    used.add(id);
    return id;
  };
  if (p.replaceLayers && p.replaceLayers.length) {
    c.layers = p.replaceLayers.slice(0, 6).map((a) => {
      const id = uniqueId(a.name);
      nameToId.set(a.name.toLowerCase(), id);
      return toLayer(a, id);
    });
    changes.push("layers");
  } else {
    for (const l of c.layers) used.add(l.id);
  }
  for (const e of p.layerEdits) {
    const l = c.layers.find((x) => x.id === e.id);
    if (!l) continue;
    if (e.remove) {
      c.layers = c.layers.filter((x) => x.id !== e.id);
      changes.push(`removed ${l.name}`);
      continue;
    }
    if (e.enabled !== null) l.enabled = e.enabled;
    if (e.name !== null) l.name = e.name;
    if (e.instrument !== null) l.instrument = e.instrument;
    if (e.registerLow !== null) l.register.low = e.registerLow;
    if (e.registerHigh !== null) l.register.high = e.registerHigh;
    if (e.activity !== null) l.activity = e.activity;
    if (e.minDuration !== null) l.durations.min = e.minDuration;
    if (e.maxDuration !== null) l.durations.max = e.maxDuration;
    if (e.movement !== null) l.movement = e.movement;
    if (e.volume !== null) l.volume = e.volume;
    if (e.pan !== null) l.pan = e.pan;
    if (e.prominence !== null) l.prominence = e.prominence;
    if (e.relationType !== null) l.relation = { type: e.relationType, target: e.relationTarget ?? l.relation.target };
    if (e.speed !== null) l.speed = e.speed;
    if (e.fx !== null) l.fx = e.fx;
    if (e.themeSteps !== null) {
      const old = l.theme;
      const steps = e.themeSteps.map((x, i) => (old?.locks[i] ? old.steps[i] ?? x : x));
      const locks = steps.map((_, i) => Boolean(old?.locks[i]));
      // user-locked notes are preserved even if the AI proposes otherwise
      l.theme = steps.some((x) => x !== null) ? { steps, locks, strength: e.themeStrength ?? old?.strength ?? 0.5 } : null;
    }
    else if (e.themeStrength !== null && l.theme) l.theme.strength = e.themeStrength;
    changes.push(l.name);
  }
  for (const a of p.addLayers) {
    if (c.layers.length >= 6) break;
    const id = uniqueId(a.name);
    nameToId.set(a.name.toLowerCase(), id);
    c.layers.push(toLayer(a, id));
    changes.push(`added ${a.name}`);
  }
  // relation targets may be given by name — resolve to ids
  for (const l of c.layers) {
    const t = l.relation.target;
    if (t && !c.layers.some((x) => x.id === t)) {
      const byName = nameToId.get(t.toLowerCase()) ?? c.layers.find((x) => x.name.toLowerCase() === t.toLowerCase())?.id;
      l.relation.target = byName ?? null;
    }
    if (l.relation.type === "independent") l.relation.target = null;
    if (l.relation.type !== "independent" && !l.relation.target) l.relation.type = "independent";
  }

  // rules
  for (const e of p.ruleEdits) {
    const r = c.rules.find((x) => x.id === e.id);
    if (!r) continue;
    if (e.remove) {
      c.rules = c.rules.filter((x) => x.id !== e.id);
      changes.push("removed a rule");
      continue;
    }
    if (e.enabled !== null) r.enabled = e.enabled;
    if (e.value !== null) Object.assign(r, clampRuleValue({ ...r, value: e.value }));
    changes.push("edited a rule");
  }
  for (const a of p.addRules) {
    // one rule of each kind at a time — a new one replaces the old
    c.rules = c.rules.filter((r) => r.type !== a.type);
    c.rules.push(clampRuleValue(makeRule(a.type, a.value ?? undefined, a.text)));
    changes.push("added a rule");
  }

  return { config: sanitizeConfig(c), changes };
}
