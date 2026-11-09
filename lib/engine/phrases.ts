/**
 * Phrase-level Markov chain — the technique Alex Bainter described for
 * generating endless, new-but-familiar piano music ("Generating More of My
 * Favorite Aphex Twin Track", 2018), applied here to ORIGINAL phrases
 * written for DRIFT (and any phrases the user writes).
 *
 * A phrase is 16 beats = 32 half-beat steps. Each step of each phrase
 * becomes a state: "which step this is + which notes sound on it (+ the bass
 * underneath)". Walking the chain from start to end produces a phrase that
 * follows the originals step by step, switching from one to another where
 * they agree — so it sounds like it belongs, but is usually new.
 *
 * Notes are scale degrees from the home note (0), 7 = an octave up,
 * negative = below; so the music follows whatever key and mode you choose.
 */

export const PHRASE_STEPS = 32;

/** A phrase: for each of the 32 steps, the degrees played (empty = rest). */
export type PhraseGrid = number[][];

type Event = [step: number, ...degrees: number[]];

const grid = (events: Event[]): PhraseGrid => {
  const g: PhraseGrid = Array.from({ length: PHRASE_STEPS }, () => []);
  for (const [step, ...degs] of events) g[step] = [...degs].sort((a, b) => a - b);
  return g;
};

/**
 * DRIFT's own phrases: a quiet piano piece moving I → vi → IV → V and home,
 * with sparser variations between. In corpus order, which also decides how
 * one phrase may lead to the next.
 */
export const BUILT_IN: { name: string; grid: PhraseGrid }[] = [
  { name: "home", grid: grid([[0, -7, 4], [4, 7], [8, 9], [12, 7], [16, -7, 2], [20, 4], [24, 7], [28, 4]]) },
  { name: "home, sparse", grid: grid([[0, -7, 7], [8, 4], [13, 2], [16, -7, 4], [24, 7]]) },
  { name: "home, rising", grid: grid([[0, -7, 4], [4, 7], [8, 9], [12, 11], [16, -7, 9], [20, 7], [24, 4], [30, 2]]) },
  { name: "home to six", grid: grid([[0, -7, 2], [4, 4], [8, 7], [12, 4], [16, -2, 5], [20, 7], [24, 9], [28, 7]]) },
  { name: "six", grid: grid([[0, -2, 7], [4, 9], [8, 7], [12, 5], [16, -2, 4], [20, 5], [24, 7], [28, 9]]) },
  { name: "six, sparse", grid: grid([[0, -2, 5], [8, 9], [13, 7], [16, -2, 4], [24, 5]]) },
  { name: "six, falling", grid: grid([[0, -2, 9], [6, 7], [8, 5], [12, 4], [16, -2, 2], [20, 4], [24, 5], [28, 4]]) },
  { name: "six to four", grid: grid([[0, -2, 4], [4, 5], [8, 7], [12, 9], [16, -4, 7], [20, 5], [24, 3], [28, 5]]) },
  { name: "four", grid: grid([[0, -4, 7], [4, 5], [8, 7], [12, 10], [16, -4, 9], [20, 7], [24, 5], [28, 7]]) },
  { name: "four, sparse", grid: grid([[0, -4, 7], [8, 5], [13, 3], [16, -4, 5], [24, 9]]) },
  { name: "four, turning", grid: grid([[0, -4, 5], [4, 7], [8, 9], [12, 7], [16, -4, 5], [20, 3], [24, 5], [30, 7]]) },
  { name: "four to five", grid: grid([[0, -4, 3], [4, 5], [8, 7], [12, 5], [16, -3, 4], [20, 6], [24, 8], [28, 6]]) },
  { name: "five", grid: grid([[0, -3, 8], [4, 6], [8, 4], [12, 6], [16, -3, 8], [20, 11], [24, 8], [28, 6]]) },
  { name: "five, sparse", grid: grid([[0, -3, 6], [8, 4], [13, 8], [16, -3, 6], [24, 4]]) },
  { name: "five, reaching", grid: grid([[0, -3, 4], [4, 6], [8, 8], [12, 11], [16, -3, 8], [20, 6], [24, 4], [28, 2]]) },
  { name: "five to home", grid: grid([[0, -3, 6], [4, 8], [8, 6], [12, 4], [16, -7, 4], [20, 2], [24, 0], [28, 2]]) },
];

/* ------------------------------------------------------------------ */
/* The chain                                                           */
/* ------------------------------------------------------------------ */

export interface PhraseChain {
  /** state → (next state → count) */
  next: Map<string, Map<string, number>>;
  /** state → the phrases it appears in (for showing where a step came from) */
  sources: Map<string, number[]>;
  states: number;
  phrases: number;
  /** how many different phrases a walk can produce (capped for display) */
  possible: number;
}

const START = "start";
const END = "end";

/** Lowest degree played on a step, if it is a bass note. */
const bassOf = (notes: number[]) => (notes.length && notes[0] < 0 ? notes[0] : null);

/**
 * A state remembers its step, its notes, and the bass sounding underneath,
 * so phrases only mix where their harmony agrees.
 */
const stateKey = (step: number, notes: number[], bass: number | null) => `${step}|${notes.join(",")}|${bass ?? ""}`;

export function parseState(key: string): { step: number; notes: number[] } {
  const [s, n] = key.split("|");
  return { step: Number(s), notes: n ? n.split(",").map(Number) : [] };
}

export function buildChain(phrases: PhraseGrid[]): PhraseChain {
  const next = new Map<string, Map<string, number>>();
  const sources = new Map<string, number[]>();
  const add = (a: string, b: string) => {
    if (!next.has(a)) next.set(a, new Map());
    const m = next.get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  // which bass each phrase ends on, so the next phrase can follow it
  const endBass = phrases.map((g) => {
    let bass: number | null = null;
    for (const n of g) bass = bassOf(n) ?? bass;
    return bass;
  });
  phrases.forEach((g, pi) => {
    // a phrase may start after any phrase ending on the bass that precedes it in the corpus
    const prevBass = endBass[(pi - 1 + phrases.length) % phrases.length];
    let prev = `${START}|${prevBass ?? ""}`;
    let bass: number | null = null;
    for (let step = 0; step < PHRASE_STEPS; step++) {
      const notes = g[step] ?? [];
      bass = bassOf(notes) ?? bass;
      const key = stateKey(step, notes, bass);
      add(prev, key);
      const src = sources.get(key) ?? [];
      if (!src.includes(pi)) src.push(pi);
      sources.set(key, src);
      prev = key;
    }
    add(prev, END);
  });
  // count distinct walks (dynamic programming over the steps)
  const memo = new Map<string, number>();
  const count = (s: string): number => {
    if (s === END) return 1;
    if (memo.has(s)) return memo.get(s)!;
    let total = 0;
    for (const n of next.get(s)?.keys() ?? []) total += count(n);
    memo.set(s, Math.min(total, 1e12));
    return memo.get(s)!;
  };
  let possible = 0;
  for (const k of next.keys()) if (k.startsWith(START)) possible += count(k);
  return { next, sources, states: sources.size, phrases: phrases.length, possible };
}

export interface WalkedPhrase {
  grid: PhraseGrid;
  /** for each step: which original phrase(s) it came from */
  sources: number[][];
  endBass: number | null;
  /** index of the original phrase it reproduces exactly, or -1 if new */
  original: number;
}

/**
 * Walk the chain from the start state that follows `prevBass`.
 *
 * `follow` names the phrase to begin from, and `mix` (0 … 1) is how freely
 * the walk may switch to another phrase where they agree: 0 plays it exactly
 * as written, 1 is the classic chain.
 */
export function walk(rng: () => number, chain: PhraseChain, prevBass: number | null, corpus: PhraseGrid[], follow: number | null = null, mix = 1): WalkedPhrase {
  const starts = [...chain.next.keys()].filter((k) => k.startsWith(START));
  const startsInto = (pi: number) => starts.find((k) => [...(chain.next.get(k)?.keys() ?? [])].some((n) => chain.sources.get(n)?.includes(pi)));
  let state = (follow !== null ? startsInto(follow) : undefined) ?? starts.find((k) => k === `${START}|${prevBass ?? ""}`) ?? starts[Math.floor(rng() * starts.length)];
  // the phrases the walk is still faithful to
  let current: number[] | null = follow !== null ? [follow] : null;
  const g: PhraseGrid = [];
  const sources: number[][] = [];
  let bass: number | null = null;
  for (let step = 0; step < PHRASE_STEPS; step++) {
    const options = chain.next.get(state);
    if (!options || !options.size) break;
    const faithful = (k: string) => k === END || !current || (chain.sources.get(k) ?? []).some((i) => current!.includes(i));
    const weighted = [...options].map(([k, v]) => [k, v * (faithful(k) ? 1 : mix)] as const);
    let total = weighted.reduce((a, [, w]) => a + w, 0);
    const pool = total > 0 ? weighted : [...options];
    if (total <= 0) total = pool.reduce((a, [, w]) => a + w, 0);
    let r = rng() * total;
    let chosen = pool[0][0];
    for (const [k, v] of pool) {
      r -= v;
      if (r <= 0) {
        chosen = k;
        break;
      }
    }
    if (chosen === END) break;
    const src = chain.sources.get(chosen) ?? [];
    const kept = current ? src.filter((i) => current!.includes(i)) : src;
    current = kept.length ? kept : src;
    const { notes } = parseState(chosen);
    g.push(notes);
    sources.push(chain.sources.get(chosen) ?? []);
    bass = bassOf(notes) ?? bass;
    state = chosen;
  }
  while (g.length < PHRASE_STEPS) {
    g.push([]);
    sources.push([]);
  }
  const same = (a: PhraseGrid, b: PhraseGrid) => a.every((n, i) => n.join(",") === (b[i] ?? []).join(","));
  const original = corpus.findIndex((c) => same(g, c));
  return { grid: g, sources, endBass: bass, original };
}
