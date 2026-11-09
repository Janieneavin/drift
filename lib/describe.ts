import type { DriftConfig, Layer, Mode } from "./schema";

/**
 * "Your musical system" — every line is generated from the real
 * configuration (so it is always true) and every line is editable.
 * Each control is a set of plain-language choices mapped to numbers.
 */

export interface Choice {
  label: string;
  value: number | string;
}

export interface SystemLine {
  key: string;
  before: string;
  after: string;
  choices: Choice[];
  get: (c: DriftConfig) => number | string;
  set: (c: DriftConfig, v: number | string) => void;
  why: string;
}

const levels = (labels: string[], values: number[]): Choice[] => labels.map((label, i) => ({ label, value: values[i] }));

export const MOOD_CHOICES: Choice[] = [
  { label: "bright and open", value: "major" },
  { label: "luminous and dreamy", value: "lydian" },
  { label: "warm, like a folk song", value: "mixolydian" },
  { label: "melancholic but hopeful", value: "dorian" },
  { label: "sad", value: "minor" },
  { label: "dark and tense", value: "phrygian" },
  { label: "simple and clear", value: "pentatonic" },
  { label: "soft and earthy", value: "minorPentatonic" },
  { label: "weightless, never settling", value: "wholeTone" },
  { label: "sparse and haunting", value: "japanese" },
];

export const moodLabel = (m: Mode) => MOOD_CHOICES.find((c) => c.value === m)?.label ?? m;

export const SYSTEM_LINES: SystemLine[] = [
  {
    key: "mood",
    before: "The harmony feels",
    after: "",
    choices: MOOD_CHOICES,
    get: (c) => c.harmony.mode,
    set: (c, v) => (c.harmony.mode = v as Mode),
    why: "Every note is chosen from one family of pitches; this family sets the emotional color.",
  },
  {
    key: "chordChange",
    before: "Harmonies change",
    after: "",
    choices: levels(["very rarely", "slowly", "gradually", "often", "restlessly"], [0.05, 0.25, 0.45, 0.7, 0.92]),
    get: (c) => c.harmony.chordChange,
    set: (c, v) => (c.harmony.chordChange = v as number),
    why: "Underneath everything, a slow chord progression shifts; melodies lean toward its notes.",
  },
  {
    key: "tension",
    before: "Chords are",
    after: "",
    choices: levels(["plain", "gently rich", "rich", "tense and unresolved"], [0.1, 0.4, 0.65, 0.9]),
    get: (c) => c.harmony.tension,
    set: (c, v) => (c.harmony.tension = v as number),
    why: "Richer chords stack more notes, which adds color — and a little friction.",
  },
  {
    key: "tempo",
    before: "The music moves at a",
    after: "pace",
    choices: levels(["glacial (36 BPM)", "slow (50 BPM)", "walking (72 BPM)", "lively (96 BPM)"], [36, 50, 72, 96]),
    get: (c) => c.tempo.bpm,
    set: (c, v) => (c.tempo.bpm = v as number),
    why: "The tempo sets the beat, the gaps between events and how long harmonies last. Set it exactly in Notes & time.",
  },
  {
    key: "lock",
    before: "Timing is",
    after: "",
    choices: levels(["free-floating", "loosely on a beat", "mostly on the beat", "locked to the beat"], [0.05, 0.35, 0.65, 0.95]),
    get: (c) => c.tempo.lock,
    set: (c, v) => (c.tempo.lock = v as number),
    why: "Locked timing puts every layer on one shared beat grid; free timing lets each note arrive when it likes.",
  },
  {
    key: "overlap",
    before: "Notes",
    after: "overlap",
    choices: levels(["rarely", "occasionally", "often", "almost always"], [0.1, 0.4, 0.7, 0.95]),
    get: (c) => c.behavior.overlap,
    set: (c, v) => (c.behavior.overlap = v as number),
    why: "Longer notes ring into the next ones, blurring the line between melody and haze.",
  },
  {
    key: "memory",
    before: "Familiar phrases",
    after: "return, slightly changed",
    choices: levels(["never", "rarely", "sometimes", "often"], [0, 0.25, 0.5, 0.8]),
    get: (c) => c.behavior.memory,
    set: (c, v) => (c.behavior.memory = v as number),
    why: "Each layer remembers short phrases it played and may bring one back, varied by the unpredictability setting.",
  },
  {
    key: "silence",
    before: "Silences are",
    after: "",
    choices: levels(["rare", "occasional", "frequent", "a big part of it"], [0.05, 0.3, 0.55, 0.85]),
    get: (c) => c.behavior.silence,
    set: (c, v) => (c.behavior.silence = v as number),
    why: "Now and then everything stops for a few seconds, at irregular moments.",
  },
  {
    key: "surprises",
    before: "Unexpected sounds appear",
    after: "",
    choices: levels(["never", "rarely", "occasionally", "often"], [0, 0.15, 0.35, 0.65]),
    get: (c) => c.behavior.surprises,
    set: (c, v) => (c.behavior.surprises = v as number),
    why: "Rare events — a deep swell, a shimmer of bells, a gust, a stray note — at random moments.",
  },
  {
    key: "space",
    before: "The space feels",
    after: "",
    choices: levels(["close", "like a room", "like a hall", "vast"], [0.15, 0.4, 0.7, 0.98]),
    get: (c) => c.space.reverb,
    set: (c, v) => {
      c.space.reverb = v as number;
      c.space.reverbMix = 0.15 + (v as number) * 0.5;
    },
    why: "The size of the imaginary room the sounds are in.",
  },
  {
    key: "echo",
    before: "Echoes are",
    after: "",
    choices: levels(["absent", "subtle", "noticeable", "everywhere"], [0, 0.2, 0.45, 0.75]),
    get: (c) => c.space.echo,
    set: (c, v) => (c.space.echo = v as number),
    why: "Some notes repeat softly a moment later, like a reflection.",
  },
  {
    key: "tone",
    before: "The tone is",
    after: "",
    choices: levels(["muffled", "soft", "clear", "bright"], [0.12, 0.35, 0.6, 0.85]),
    get: (c) => c.tone.brightness,
    set: (c, v) => (c.tone.brightness = v as number),
    why: "How much of the high, airy part of each sound gets through.",
  },
  {
    key: "warmth",
    before: "It feels",
    after: "",
    choices: levels(["cold", "cool", "warm", "very warm"], [0.1, 0.35, 0.65, 0.9]),
    get: (c) => c.tone.warmth,
    set: (c, v) => (c.tone.warmth = v as number),
    why: "Warmth adds body to the low end and softens the top.",
  },
];

export function nearestChoice(line: SystemLine, c: DriftConfig): Choice {
  const v = line.get(c);
  if (typeof v === "string") return line.choices.find((ch) => ch.value === v) ?? line.choices[0];
  let best = line.choices[0];
  for (const ch of line.choices) if (Math.abs((ch.value as number) - v) < Math.abs((best.value as number) - v)) best = ch;
  return best;
}

/* ---------------- per-layer descriptions ---------------- */

export const MOVEMENT_LABEL: Record<Layer["movement"], string> = {
  stepwise: "in small steps",
  leaps: "in wide leaps",
  drone: "holding long tones",
  arpeggio: "up and down through the harmony",
};
export const PROMINENCE_LABEL: Record<Layer["prominence"], string> = {
  leads: "leads",
  blends: "blends in",
  recedes: "stays in the background",
};
export const RELATION_LABEL: Record<Layer["relation"]["type"], string> = {
  independent: "plays independently",
  answers: "answers",
  follows: "follows",
  avoids: "avoids",
  leads: "leads",
};
export const REGISTER_CHOICES: Choice[] = [
  { label: "very low", value: "1-2" },
  { label: "low", value: "2-3" },
  { label: "middle", value: "3-5" },
  { label: "high", value: "5-6" },
  { label: "very high", value: "6-7" },
];
export function registerLabel(l: Layer): string {
  const mid = (l.register.low + l.register.high) / 2;
  return mid < 2 ? "very low" : mid < 3 ? "low" : mid < 5 ? "middle" : mid < 6.25 ? "high" : "very high";
}
export const ACTIVITY_CHOICES: Choice[] = levels(["rarely", "now and then", "often", "constantly"], [0.15, 0.4, 0.65, 0.9]);
export function activityLabel(l: Layer): string {
  const v = l.activity;
  return v < 0.28 ? "rarely" : v < 0.53 ? "now and then" : v < 0.78 ? "often" : "constantly";
}

/** A short summary sentence of the whole system, generated from the config. */
export function summarize(c: DriftConfig): string[] {
  const on = c.layers.filter((l) => l.enabled);
  const lines: string[] = [];
  const word = ["no", "one", "two", "three", "four", "five", "six"][on.length] ?? `${on.length}`;
  lines.push(`${word[0].toUpperCase() + word.slice(1)} independent layer${on.length === 1 ? "" : "s"}, each moving at its own pace.`);
  const rel = on.filter((l) => l.relation.type !== "independent" && l.relation.target);
  for (const l of rel) {
    const t = c.layers.find((x) => x.id === l.relation.target);
    if (t) lines.push(`${l.name} ${RELATION_LABEL[l.relation.type]} ${t.name}.`);
  }
  const leads = on.filter((l) => l.prominence === "leads");
  if (leads.length) lines.push(`${leads.map((l) => l.name).join(" and ")} ${leads.length > 1 ? "lead" : "leads"}; the rest stay behind.`);
  lines.push(c.behavior.overlap > 0.5 ? "Notes often overlap." : "Notes occasionally overlap.");
  lines.push(c.harmony.chordChange < 0.4 ? "Harmonies change gradually." : "Harmonies shift fairly often.");
  if (c.behavior.memory > 0.3) lines.push("Phrases come back, never quite the same.");
  if (c.behavior.surprises > 0.1) lines.push("Unexpected sounds appear occasionally.");
  return lines;
}
