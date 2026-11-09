import { CORPUS } from "./corpus";

/**
 * The Markov chain that chooses notes in ambient pieces.
 *
 * States are the eight notes of the scale from the home note up to its
 * octave (1 … 8). Each row of the matrix says, for the note just played,
 * how likely each next note is. Rows don't need to add up to anything —
 * they are weights, normalized when a note is chosen.
 */

export const STATES = 8;
export const STATE_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8"];
export const STATE_NAMES = ["home", "2nd", "3rd", "4th", "5th", "6th", "7th", "octave"];

export type Matrix = number[][];

const empty = (): Matrix => Array.from({ length: STATES }, () => Array(STATES).fill(0));

/** A scale degree from the corpus → one of the eight states. */
const toState = (deg: number) => {
  if (deg === 7) return 7;
  return ((deg % 7) + 7) % 7;
};

/** Transition weights learned from the public-domain melodies. */
export function learnedMatrix(): Matrix {
  const m = empty();
  for (const t of CORPUS) {
    for (let i = 1; i < t.notes.length; i++) {
      const a = toState(t.notes[i - 1][0]);
      const b = toState(t.notes[i][0]);
      m[a][b] += 1;
    }
  }
  // a little smoothing so no note is ever completely unreachable
  return m.map((row) => row.map((v) => v + 0.15));
}

/** Gentle steps up and down, sometimes staying put. */
function stepwise(): Matrix {
  return Array.from({ length: STATES }, (_, a) =>
    Array.from({ length: STATES }, (_, b) => {
      const d = Math.abs(a - b);
      return d === 0 ? 1.2 : d === 1 ? 3 : d === 2 ? 1 : 0.1;
    }),
  );
}

/** Open, consonant movement around the home chord (1, 3, 5, 8), like bells. */
function consonant(): Matrix {
  const chordish = [0, 2, 4, 7];
  return Array.from({ length: STATES }, (_, a) =>
    Array.from({ length: STATES }, (_, b) => {
      let w = chordish.includes(b) ? 3 : 0.6;
      if (a === b) w *= 0.4;
      if (Math.abs(a - b) === 1) w += 0.8;
      return w;
    }),
  );
}

/** Pentatonic: only 1 2 3 5 6 8 — nothing can clash. */
function pentatonic(): Matrix {
  const allowed = [0, 1, 2, 4, 5, 7];
  return Array.from({ length: STATES }, (_, a) =>
    Array.from({ length: STATES }, (_, b) => (allowed.includes(b) ? (Math.abs(a - b) <= 2 ? 2.5 : 1) : 0)),
  );
}

/** Every note equally likely: pure chance, for comparison. */
function uniform(): Matrix {
  return Array.from({ length: STATES }, () => Array(STATES).fill(1));
}

export const MATRIX_PRESETS: { id: string; label: string; hint: string; make: () => Matrix }[] = [
  { id: "learned", label: "Learned from real melodies", hint: "how Bach, Satie, Dvořák and folk songs move", make: learnedMatrix },
  { id: "consonant", label: "Open & consonant", hint: "circles the home chord, like bells", make: consonant },
  { id: "stepwise", label: "Stepwise drift", hint: "small steps, sometimes standing still", make: stepwise },
  { id: "pentatonic", label: "Pentatonic", hint: "only notes that never clash", make: pentatonic },
  { id: "uniform", label: "Pure chance", hint: "every note equally likely", make: uniform },
];

export function presetMatrix(id: string): Matrix {
  return (MATRIX_PRESETS.find((p) => p.id === id) ?? MATRIX_PRESETS[0]).make();
}

/** Each row as probabilities (adding up to 1). */
export function normalized(m: Matrix): Matrix {
  return m.map((row) => {
    const sum = row.reduce((a, b) => a + Math.max(0, b), 0);
    return sum > 0 ? row.map((v) => Math.max(0, v) / sum) : row.map(() => 1 / STATES);
  });
}

/** Choose the next note from the current one. */
export function nextState(rng: () => number, m: Matrix, from: number): number {
  const row = m[from] ?? m[0];
  let total = 0;
  for (const v of row) total += Math.max(0, v);
  if (total <= 0) return from;
  let r = rng() * total;
  for (let i = 0; i < row.length; i++) {
    r -= Math.max(0, row[i]);
    if (r <= 0) return i;
  }
  return row.length - 1;
}
