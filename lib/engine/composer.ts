/**
 * DRIFT's composed engine — the designed musical material.
 *
 * Original material written for DRIFT, using minimalist techniques
 * (not anyone's melodies or progressions):
 *  - a steady pulse of eighth notes in 12-beat cycles, accented in threes
 *  - interlocking patterns: the second voice sounds in the first one's rests
 *  - additive process: pattern notes appear (and disappear) one at a time
 *  - a repeating chord progression that changes on bar lines
 *  - a long-form arc: Beginning → Development → Expansion → Release, forever
 *
 * Pattern numbers are positions on a "ladder" of chord tones above the
 * layer's base note (0 = root, 1 = third, 2 = fifth, 3 = seventh or
 * octave …), so every note belongs to the chord of the moment.
 */

export const STEPS = 12; // one bar = 12 eighth notes

/** Rhythmic identity (Layer 1): pulse motifs. null = rest. */
export const PULSE: (number | null)[][] = [
  [0, null, 2, 1, null, 2, 0, null, 3, 2, null, 1],
  [0, 2, null, 4, 2, null, 1, 3, null, 2, 1, null],
  [2, null, 0, 2, null, 4, 3, null, 1, null, 2, 0],
];

/** Interlocking motifs (Layer 2): sung in the pulse's rests, higher up. */
export const INTERLOCK: number[][] = [
  [4, 5, 3, 4],
  [5, 4, 6, 5],
  [3, 4, 5, 6],
];

/** Low support (Layer 4): steps, ladder position, length in eighths, minimum intensity. */
export const BASS: { step: number; tone: number; len: number; minE: number }[] = [
  { step: 0, tone: 0, len: 5.5, minE: 0 },
  { step: 6, tone: 2, len: 2.5, minE: 0.55 },
  { step: 9, tone: 0, len: 2.5, minE: 0.8 },
];

/** Default progressions per mood family, as scale degrees (0 = home chord). */
export const PROGRESSIONS = {
  major: [0, 5, 3, 4],
  minor: [0, 5, 2, 6],
  modal: [0, 6, 3, 2],
};

export type Phase = "Beginning" | "Development" | "Expansion" | "Release";

/** Where in the long-form cycle we are, and how full the texture is (0..1). */
export function form(position: number): { phase: Phase; energy: number } {
  const p = ((position % 1) + 1) % 1;
  const s = (x: number) => x * x * (3 - 2 * x);
  if (p < 0.2) return { phase: "Beginning", energy: 0.12 + 0.18 * s(p / 0.2) };
  if (p < 0.5) return { phase: "Development", energy: 0.3 + 0.45 * s((p - 0.2) / 0.3) };
  if (p < 0.75) return { phase: "Expansion", energy: 0.75 + 0.25 * s((p - 0.5) / 0.25) };
  return { phase: "Release", energy: 1 - 0.88 * s((p - 0.75) / 0.25) };
}

/** Steps of a pulse pattern that carry notes. */
export const noteSteps = (pattern: (number | null)[]) => pattern.map((x, i) => (x === null ? -1 : i)).filter((i) => i >= 0);

/**
 * The order in which a pattern's notes appear as the texture fills in
 * (and disappear as it thins). The downbeat always comes first.
 */
export function additiveOrder(rng: () => number, steps: number[]): number[] {
  const rest = steps.filter((s) => s !== steps[0]);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [steps[0], ...rest];
}

/** A ladder of chord tones (MIDI) starting at or above `base`. */
export function ladder(chordPcs: number[], base: number, length = 12): number[] {
  const pcs = [...new Set(chordPcs)];
  const out: number[] = [];
  for (let m = base; out.length < length && m < base + 60; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}
