import type { Mode, Root } from "./schema";
import { ROOTS } from "./schema";

/* Seeded random numbers so a realization can be reproduced exactly. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function weightedPick<T>(rng: Rng, items: T[], weights: number[]): T | undefined {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return undefined;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* Scales as semitone offsets from the root. */
export const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  japanese: [0, 1, 5, 7, 8],
};

export const rootPc = (root: Root) => ROOTS.indexOf(root);

/** The notes in use: the user's own scale if set, otherwise the mode's. */
export function scaleOf(h: { mode: Mode; customScale: number[] | null }): number[] {
  return h.customScale && h.customScale.length >= 3 ? h.customScale : SCALES[h.mode];
}

/** All MIDI notes of the scale between lo and hi (inclusive). */
export function scaleNotes(root: Root, scale: number[], lo: number, hi: number): number[] {
  const pcs = new Set(scale.map((s) => (s + rootPc(root)) % 12));
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (pcs.has(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

/**
 * A chord is built by stacking every-other scale step from a degree.
 * Works for 5-, 6- and 7-note scales alike.
 */
export function chordPcs(root: Root, sc: number[], degree: number, tension: number): number[] {
  const n = sc.length;
  const size = tension > 0.66 ? 5 : tension > 0.33 ? 4 : 3;
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const idx = degree + i * 2;
    out.push((sc[idx % n] + rootPc(root) + 12 * Math.floor(idx / n)) % 12);
  }
  return out;
}

/**
 * Pick the next chord degree. Favors gentle, common root motions
 * (by 4th/5th or 3rd), avoids staying put, and rarely jumps by step.
 */
export function nextDegree(rng: Rng, sc: number[], current: number, adventurous: number): number {
  const n = sc.length;
  const degrees = Array.from({ length: n }, (_, i) => i);
  if (current >= n) current = 0;
  const weights = degrees.map((d) => {
    if (d === current) return 0.15;
    const interval = (sc[d] - sc[current] + 12) % 12;
    let w = 1;
    if (interval === 5 || interval === 7) w = 3; // 4th/5th motion
    else if (interval === 3 || interval === 4 || interval === 8 || interval === 9) w = 2.4; // 3rd motion
    else if (interval === 1 || interval === 11) w = 0.3 + adventurous; // semitone — rare
    else w = 0.8 + adventurous * 0.8; // steps
    if (d === 0) w *= 1.4; // home is attractive
    return w;
  });
  return weightedPick(rng, degrees, weights) ?? 0;
}

export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const pcName = (pc: number) => NAMES[((pc % 12) + 12) % 12];

/** Octave number 1..7 → MIDI range (C1 = 24). */
export const octaveLow = (o: number) => 12 * (o + 1);
export const octaveHigh = (o: number) => 12 * (o + 1) + 11;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** A friendly name for the chord built on a scale degree, e.g. "vi · B minor". */
export function chordLabel(root: Root, scale: number[], degree: number): { numeral: string; name: string } {
  const d = degree % scale.length;
  const pcs = chordPcs(root, scale, d, 0);
  const third = (pcs[1] - pcs[0] + 12) % 12;
  const fifth = (pcs[2] - pcs[0] + 12) % 12;
  const quality = third === 4 && fifth === 7 ? "major" : third === 3 && fifth === 7 ? "minor" : third === 3 && fifth === 6 ? "dim" : third === 4 && fifth === 8 ? "aug" : "";
  const base = ROMAN[d] ?? String(d + 1);
  const numeral = quality === "minor" || quality === "dim" ? base.toLowerCase() + (quality === "dim" ? "°" : "") : base + (quality === "aug" ? "+" : "");
  return { numeral, name: `${pcName(pcs[0])}${quality === "minor" ? " minor" : quality === "dim" ? " dim" : quality === "aug" ? " aug" : quality === "major" ? "" : ""}` };
}
