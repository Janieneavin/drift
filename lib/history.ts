import type { DriftConfig } from "./schema";
import { RULE_META } from "./rules";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const FRIENDLY: Record<string, string> = {
  chordChange: "harmony changes",
  tension: "chord richness",
  brightness: "tone",
  warmth: "warmth",
  reverb: "space",
  reverbMix: "reverb",
  echo: "echoes",
  echoTime: "echo timing",
  echoFeedback: "echo repeats",
  overlap: "overlap",
  memory: "returning phrases",
  silence: "silences",
  surprises: "surprise",
  surpriseKinds: "kinds of surprises",
  register: "range",
  activity: "activity",
  durations: "note lengths",
  movement: "movement",
  volume: "volume",
  pan: "position",
  prominence: "prominence",
  relation: "relationship",
  speed: "speed",
  theme: "melody",
  instrument: "instrument",
  enabled: "on/off",
  name: "name",
};

/** A short, human-readable description of what changed. */
export function describeChange(prev: DriftConfig, next: DriftConfig): string {
  const out: string[] = [];
  if (prev.name !== next.name) out.push("name");
  if (prev.atmosphere !== next.atmosphere) out.push("atmosphere");
  for (const k of ["density", "evolution", "unpredictability"] as const)
    if (prev.macro[k] !== next.macro[k]) out.push(`${k[0].toUpperCase() + k.slice(1)} ${pct(prev.macro[k])}→${pct(next.macro[k])}`);
  if (prev.tempo.bpm !== next.tempo.bpm) out.push(`Tempo ${prev.tempo.bpm}→${next.tempo.bpm} BPM`);
  if (prev.tempo.lock !== next.tempo.lock) out.push(`Pulse ${pct(prev.tempo.lock)}→${pct(next.tempo.lock)}`);
  if (prev.harmony.root !== next.harmony.root) out.push(`Key ${prev.harmony.root}→${next.harmony.root}`);
  if (prev.harmony.mode !== next.harmony.mode) out.push(`Tonality → ${next.harmony.mode}`);
  if (!eq(prev.harmony.customScale, next.harmony.customScale)) out.push(next.harmony.customScale ? "Scale notes" : "Scale reset");
  if (prev.harmony.chromatic !== next.harmony.chromatic) out.push(next.harmony.chromatic ? "Allow outside notes" : "Strict scale");
  if (!eq(prev.harmony.progression, next.harmony.progression)) out.push(next.harmony.progression ? "Chord progression" : "Harmony wanders");
  if (!eq(prev.arc, next.arc)) out.push(next.arc.shape === "off" ? "Steady shape" : `Shape: ${next.arc.shape === "buildRelease" ? "climax" : next.arc.shape} (${next.arc.minutes} min)`);
  for (const k of ["chordChange", "tension"] as const) if (prev.harmony[k] !== next.harmony[k]) out.push(FRIENDLY[k]);
  for (const k of ["brightness", "warmth"] as const) if (prev.tone[k] !== next.tone[k]) out.push(FRIENDLY[k]);
  for (const k of Object.keys(next.space) as (keyof DriftConfig["space"])[]) if (prev.space[k] !== next.space[k]) out.push(FRIENDLY[k]);
  for (const k of Object.keys(next.behavior) as (keyof DriftConfig["behavior"])[])
    if (!eq(prev.behavior[k], next.behavior[k])) out.push(k === "surprises" ? `Surprise ${pct(prev.behavior.surprises)}→${pct(next.behavior.surprises)}` : FRIENDLY[k]);
  if (prev.seed !== next.seed) out.push(next.seed === null ? "Fresh performances" : `Seed ${next.seed}`);

  const pl = new Map(prev.layers.map((l) => [l.id, l]));
  const nl = new Map(next.layers.map((l) => [l.id, l]));
  for (const l of next.layers) if (!pl.has(l.id)) out.push(`+ ${l.name}`);
  for (const l of prev.layers) if (!nl.has(l.id)) out.push(`− ${l.name}`);
  for (const l of next.layers) {
    const o = pl.get(l.id);
    if (!o || eq(o, l)) continue;
    const keys = (Object.keys(l) as (keyof typeof l)[]).filter((k) => !eq(o[k], l[k])).map((k) => FRIENDLY[k] ?? k);
    out.push(`${l.name}: ${keys.join(", ")}`);
  }

  const pr = new Map(prev.rules.map((r) => [r.id, r]));
  const nr = new Map(next.rules.map((r) => [r.id, r]));
  for (const r of next.rules) if (!pr.has(r.id)) out.push(`+ rule: ${RULE_META[r.type].title}`);
  for (const r of prev.rules) if (!nr.has(r.id)) out.push(`− rule: ${RULE_META[r.type].title}`);
  for (const r of next.rules) {
    const o = pr.get(r.id);
    if (o && !eq(o, r)) out.push(`${RULE_META[r.type].title}${o.enabled !== r.enabled ? (r.enabled ? " on" : " off") : ""}`);
  }

  if (!out.length) return "Edit";
  return out.slice(0, 3).join(" · ") + (out.length > 3 ? ` · +${out.length - 3} more` : "");
}
