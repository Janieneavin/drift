import type { Layer } from "../schema";
import { type Rng, weightedPick } from "../music";

/**
 * Melody writing, done the way a composer would: short motifs with a
 * real rhythm and shape, built into phrases that repeat, vary, and end
 * either "open" (a question) or "home" (an answer).
 *
 *  steps: movement along the scale from the phrase's starting note
 *  beats: how long each note lasts before the next one, in beats
 */
export interface Motif {
  steps: number[];
  beats: number[];
}

export interface Phrase extends Motif {
  cadence: "open" | "home";
}

const RHYTHMS: Record<"melody" | "bells" | "texture", number[][]> = {
  melody: [
    [1, 1, 2],
    [0.5, 0.5, 1, 2],
    [1, 0.5, 0.5, 2],
    [1.5, 0.5, 1, 1],
    [2, 1, 1, 2],
    [1, 1, 1, 1, 2],
    [0.5, 0.5, 0.5, 0.5, 1, 1],
    [1, 2, 1, 2],
  ],
  bells: [
    [1, 1],
    [0.5, 0.5, 1],
    [1, 2],
    [0.25, 0.25, 0.5, 2],
    [0.5, 1, 1.5],
  ],
  texture: [
    [0.5, 0.5, 0.5, 0.5],
    [0.25, 0.25, 0.25, 0.25, 1],
    [0.5, 0.5, 1],
  ],
};

const pick = <T,>(rng: Rng, items: T[]) => items[Math.floor(rng() * items.length)];

function delta(rng: Rng, movement: Layer["movement"], goingUp: boolean): number {
  const dir = goingUp ? 1 : -1;
  switch (movement) {
    case "leaps":
      return (weightedPick(rng, [2, 3, 4, 1, 5], [3, 3, 2, 2, 1]) ?? 2) * (rng() < 0.75 ? dir : -dir);
    case "arpeggio":
      return 2 * (rng() < 0.85 ? dir : -dir);
    case "drone":
      return weightedPick(rng, [0, 1, -1], [5, 1, 1]) ?? 0;
    case "stepwise":
    default: {
      // mostly steps, some thirds, the occasional fourth — never a repeat
      const size = weightedPick(rng, [1, 2, 3], [5, 3, 1]) ?? 1;
      return size * (rng() < 0.8 ? dir : -dir);
    }
  }
}

/**
 * A short motif with a rhythm and a shape (usually an arch). A motif
 * must actually go somewhere: it spans several notes of the scale.
 * `rise` asks for an upward (true) or downward (false) overall shape.
 */
export function makeMotif(rng: Rng, role: Layer["role"], movement: Layer["movement"], density: number, rise?: boolean): Motif {
  const minSpan = movement === "drone" ? 1 : movement === "leaps" ? 5 : 4;
  let best: Motif | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const m = makeMotifOnce(rng, role, movement, density, rise);
    const span = Math.max(...m.steps) - Math.min(...m.steps);
    const net = m.steps[m.steps.length - 1] - m.steps[0];
    const shapeOk = rise === undefined || (rise ? net >= 0 : net <= 0);
    if (span >= minSpan && shapeOk) return m;
    if (!best || span > Math.max(...best.steps) - Math.min(...best.steps)) best = m;
  }
  return best!;
}

function makeMotifOnce(rng: Rng, role: Layer["role"], movement: Layer["movement"], density: number, rise?: boolean): Motif {
  const bank = role === "bells" ? RHYTHMS.bells : role === "texture" ? RHYTHMS.texture : RHYTHMS.melody;
  // busier systems favour longer figures
  const sorted = [...bank].sort((a, b) => a.length - b.length);
  const lo = Math.floor(density * 0.5 * (sorted.length - 1));
  const hi = Math.max(lo + 1, Math.ceil((0.4 + density * 0.6) * sorted.length));
  const beats = [...pick(rng, sorted.slice(lo, hi))];
  // melodies need a few notes to say something
  while (beats.length < 4 && role !== "bells") beats.splice(beats.length - 1, 0, pick(rng, [0.5, 1, 1]));
  const steps = [0];
  const peak = rise === false ? 0 : rise === true ? beats.length - 1 : Math.max(1, Math.floor(beats.length * (0.4 + rng() * 0.3)));
  const archUp = rise === undefined ? rng() < 0.7 : true; // most phrases rise then fall
  for (let i = 1; i < beats.length; i++) {
    const up = archUp ? i <= peak : i > peak;
    const next = steps[i - 1] + delta(rng, movement, up);
    steps.push(Math.max(-4, Math.min(7, next)));
  }
  return { steps, beats };
}

/** Light variation: a note nudged, a beat split in two. */
function vary(rng: Rng, m: Motif, amount: number): Motif {
  const steps = [...m.steps];
  const beats = [...m.beats];
  for (let i = 1; i < steps.length - 1; i++) if (rng() < amount * 0.22) steps[i] += rng() < 0.5 ? -1 : 1;
  if (rng() < amount * 0.25) {
    const i = Math.floor(rng() * beats.length);
    if (beats[i] >= 1) {
      // split one note into two
      beats.splice(i, 1, beats[i] / 2, beats[i] / 2);
      steps.splice(i + 1, 0, steps[i] + (rng() < 0.5 ? 1 : -1));
    }
  }
  return { steps, beats };
}

/**
 * Build the next phrase from a layer's motifs. `memory` decides how
 * often the main motif returns unchanged; `variation` how much it bends.
 */
export function composePhrase(rng: Rng, motifs: Motif[], memory: number, variation: number, index: number): Phrase {
  const [a, b] = motifs;
  const r = rng();
  let base: Motif;
  // the main idea returns often: repetition is what makes a melody recognizable
  if (r < 0.35 + memory * 0.45) base = a;
  else if (r < 0.6 + memory * 0.25) base = b ?? a; // the second idea
  else {
    // a sequence: the main idea, moved up or down the scale
    const shift = pick(rng, [-2, -1, 1, 2]);
    base = { steps: a.steps.map((s) => s + shift), beats: [...a.beats] };
  }
  let phrase: Motif = { steps: [...base.steps], beats: [...base.beats] };
  // sometimes two ideas join into a longer phrase
  if (b && rng() < 0.45) {
    const last = phrase.steps[phrase.steps.length - 1];
    phrase = { steps: [...phrase.steps, ...b.steps.map((s) => s + last)], beats: [...phrase.beats, ...b.beats] };
  }
  // occasionally turned upside down
  if (rng() < 0.15 * (1 - memory)) phrase = { steps: phrase.steps.map((s) => -s), beats: phrase.beats };
  phrase = vary(rng, phrase, variation);
  // questions and answers alternate
  return { ...phrase, cadence: index % 2 === 0 ? "open" : "home" };
}

/** A reply to another layer's phrase: same rhythm, mirrored shape, ending home. */
export function answerPhrase(rng: Rng, src: Motif): Phrase {
  const mirror = rng() < 0.6;
  const steps = mirror ? src.steps.map((s) => -s) : src.steps.map((s) => s - 2);
  const stretch = rng() < 0.3 ? 1.5 : 1;
  return { steps, beats: src.beats.map((x) => x * stretch), cadence: "home" };
}

/** Evolution: motifs slowly change while keeping their identity. */
export function mutateMotif(rng: Rng, m: Motif): Motif {
  const out = { steps: [...m.steps], beats: [...m.beats] };
  if (rng() < 0.6 && out.steps.length > 1) {
    const i = 1 + Math.floor(rng() * (out.steps.length - 1));
    out.steps[i] += rng() < 0.5 ? -1 : 1;
  } else {
    const i = Math.floor(rng() * out.beats.length);
    out.beats[i] = pick(rng, [0.5, 1, 1, 1.5, 2]);
  }
  return out;
}
