import type { Rule, RuleType } from "./schema";
import { uid } from "./schema";

/**
 * The fixed set of creative constraints DRIFT can actually execute.
 * Each one has a plain-language sentence, an editable value, and a
 * description of how it shows up on screen.
 */
export interface RuleMeta {
  type: RuleType;
  title: string;
  /** Sentence with {v} where the value goes. */
  sentence: string;
  valueLabel: (v: number) => string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  /** What the user will hear. */
  hear: string;
  /** What the user will see. */
  see: string;
}

const octaveName = (o: number) =>
  ["", "very low", "low", "lower-middle", "middle", "upper-middle", "high", "very high"][Math.round(o)] ?? `${o}`;

export const RULE_META: Record<RuleType, RuleMeta> = {
  maxVoices: {
    type: "maxVoices",
    title: "Limit simultaneous sounds",
    sentence: "Never more than {v} sounds at once",
    valueLabel: (v) => `${Math.round(v)}`,
    min: 1,
    max: 5,
    step: 1,
    defaultValue: 2,
    hear: "Sounds wait their turn instead of piling up.",
    see: "Glowing slots on the right edge; a sound that finds them full appears as a ghost.",
  },
  maxNotes: {
    type: "maxNotes",
    title: "Limit simultaneous notes",
    sentence: "Never more than {v} notes sounding at once",
    valueLabel: (v) => `${Math.round(v)}`,
    min: 1,
    max: 6,
    step: 1,
    defaultValue: 2,
    hear: "Counts every single note, including chord notes and fading tails. Chords are thinned to fit.",
    see: "Small dots on the right edge fill as notes sound; extra notes become ghosts.",
  },
  eachQuieter: {
    type: "eachQuieter",
    title: "Each sound quieter than the last",
    sentence: "Every new sound is quieter than the previous one (resets after a silence)",
    valueLabel: (v) => `${Math.round(v * 100)}% softer each time`,
    min: 0.03,
    max: 0.3,
    step: 0.01,
    defaultValue: 0.1,
    hear: "Phrases fade away like footsteps receding, then start fresh after a pause.",
    see: "Particles shrink one after another and spring back after a silence.",
  },
  driftApart: {
    type: "driftApart",
    title: "Melodies drift apart",
    sentence: "The layers gradually drift apart over {v} minutes",
    valueLabel: (v) => `${v.toFixed(1)}`,
    min: 0.5,
    max: 15,
    step: 0.5,
    defaultValue: 4,
    hear: "Each layer slowly takes its own speed, register and position in the stereo field.",
    see: "Each layer's stream of light separates across the screen.",
  },
  addLayerEvery: {
    type: "addLayerEvery",
    title: "Introduce new instruments",
    sentence: "Introduce a new instrument every {v} minutes",
    valueLabel: (v) => `${v.toFixed(1)}`,
    min: 0.5,
    max: 10,
    step: 0.5,
    defaultValue: 2,
    hear: "A new voice enters on a timer; when the ensemble is full, the oldest newcomer leaves.",
    see: "A ring fills like a clock in the corner; a new color enters when it closes.",
  },
  erode: {
    type: "erode",
    title: "Gradually less recognizable",
    sentence: "The music becomes less recognizable over {v} minutes",
    valueLabel: (v) => `${v.toFixed(1)}`,
    min: 1,
    max: 20,
    step: 0.5,
    defaultValue: 6,
    hear: "Phrases stop returning, timing loosens, tones blur and drift out of tune.",
    see: "Particles blur and scatter more and more.",
  },
  handoff: {
    type: "handoff",
    title: "Melodies take turns",
    sentence: "Whenever one melody stops, another begins",
    valueLabel: () => "",
    min: 0,
    max: 0,
    step: 1,
    defaultValue: 0,
    hear: "Only one melodic voice speaks at a time, passing the line between them.",
    see: "A thread of light passes from the voice that stops to the one that starts.",
  },
  ceiling: {
    type: "ceiling",
    title: "Remove higher notes",
    sentence: "No notes above the {v} range",
    valueLabel: (v) => octaveName(v),
    min: 2,
    max: 7,
    step: 1,
    defaultValue: 4,
    hear: "The top of the sound is cut away; everything stays below the line.",
    see: "A faint horizontal line; anything above it becomes a ghost.",
  },
  floor: {
    type: "floor",
    title: "Remove lower notes",
    sentence: "No notes below the {v} range",
    valueLabel: (v) => octaveName(v),
    min: 1,
    max: 6,
    step: 1,
    defaultValue: 3,
    hear: "The deep end is removed; the music floats.",
    see: "A faint horizontal line near the bottom; anything below it becomes a ghost.",
  },
  thinHighs: {
    type: "thinHighs",
    title: "Higher notes become rarer",
    sentence: "Higher notes become less frequent over {v} minutes",
    valueLabel: (v) => `${v.toFixed(1)}`,
    min: 0.5,
    max: 20,
    step: 0.5,
    defaultValue: 5,
    hear: "High notes thin out over time until only a few remain.",
    see: "The top of the canvas slowly darkens.",
  },
};

export function makeRule(type: RuleType, value?: number, text = ""): Rule {
  const m = RULE_META[type];
  return {
    id: uid("rule"),
    type,
    enabled: true,
    value: value ?? m.defaultValue,
    text,
  };
}

export function ruleSentence(r: Rule): string {
  const m = RULE_META[r.type];
  return m.sentence.replace("{v}", m.valueLabel(r.value));
}

export function clampRuleValue(r: Rule): Rule {
  const m = RULE_META[r.type];
  if (m.max === m.min) return { ...r, value: m.defaultValue };
  return { ...r, value: Math.min(m.max, Math.max(m.min, r.value)) };
}
