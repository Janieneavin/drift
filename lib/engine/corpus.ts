/**
 * Melodic style learned from real music.
 *
 * A small corpus of PUBLIC-DOMAIN melodies (classical works whose
 * composers died long ago, and traditional folk songs), transcribed
 * approximately as scale degrees and durations. DRIFT never plays these
 * tunes; it learns how they move — which intervals tend to follow which,
 * and their rhythms — and writes new melodies in that style.
 *
 * degree: steps of the scale from the home note (0), 7 = an octave up
 * dur:    length in eighth notes
 */

export interface Tune {
  name: string;
  source: string;
  family: "major" | "minor";
  bar: number; // eighths per bar
  notes: [number, number][];
}

export const CORPUS: Tune[] = [
  {
    name: "Ode to Joy", source: "Beethoven, 9th Symphony (1824)", family: "major", bar: 8,
    notes: [[2, 2], [2, 2], [3, 2], [4, 2], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [0, 2], [1, 2], [2, 2], [2, 3], [1, 1], [1, 4],
      [2, 2], [2, 2], [3, 2], [4, 2], [4, 2], [3, 2], [2, 2], [1, 2], [0, 2], [0, 2], [1, 2], [2, 2], [1, 3], [0, 1], [0, 4],
      [1, 2], [1, 2], [2, 2], [0, 2], [1, 2], [2, 1], [3, 1], [2, 2], [0, 2], [1, 2], [2, 1], [3, 1], [2, 2], [1, 2], [0, 2], [1, 2], [-3, 4]],
  },
  {
    name: "Largo (“Goin’ Home” theme)", source: "Dvořák, New World Symphony (1893)", family: "major", bar: 8,
    notes: [[2, 3], [4, 1], [4, 4], [2, 3], [1, 1], [0, 4], [1, 2], [2, 2], [4, 2], [2, 2], [1, 8],
      [2, 3], [4, 1], [4, 4], [2, 3], [1, 1], [0, 4], [1, 2], [2, 2], [1, 2], [0, 2], [0, 8]],
  },
  {
    name: "Gymnopédie No. 1", source: "Satie (1888)", family: "major", bar: 6,
    notes: [[2, 2], [4, 2], [3, 2], [2, 2], [-1, 2], [-2, 2], [-1, 2], [0, 2], [-3, 6], [-5, 12],
      [2, 2], [4, 2], [3, 2], [2, 2], [-1, 2], [-2, 2], [-1, 2], [0, 2], [-3, 6], [1, 6]],
  },
  {
    name: "Wiegenlied (Lullaby)", source: "Brahms (1868)", family: "major", bar: 6,
    notes: [[2, 1], [2, 1], [4, 4], [2, 1], [2, 1], [4, 4], [2, 1], [4, 1], [7, 2], [6, 3], [5, 1], [5, 2], [4, 2],
      [1, 1], [2, 1], [3, 2], [1, 2], [1, 1], [2, 1], [3, 4], [1, 1], [3, 1], [6, 1], [5, 1], [4, 2], [6, 2], [7, 4]],
  },
  {
    name: "Minuet in G", source: "attr. Petzold, Notebook for A. M. Bach (1725)", family: "major", bar: 6,
    notes: [[4, 2], [0, 1], [1, 1], [2, 1], [3, 1], [4, 2], [0, 2], [0, 2], [5, 2], [3, 1], [4, 1], [5, 1], [6, 1], [7, 2], [0, 2], [0, 2],
      [3, 2], [4, 1], [3, 1], [2, 1], [1, 1], [2, 2], [3, 1], [2, 1], [1, 1], [0, 1], [-1, 2], [0, 1], [1, 1], [2, 1], [0, 1], [1, 6]],
  },
  {
    name: "Twinkle, Twinkle", source: "traditional", family: "major", bar: 8,
    notes: [[0, 2], [0, 2], [4, 2], [4, 2], [5, 2], [5, 2], [4, 4], [3, 2], [3, 2], [2, 2], [2, 2], [1, 2], [1, 2], [0, 4],
      [4, 2], [4, 2], [3, 2], [3, 2], [2, 2], [2, 2], [1, 4]],
  },
  {
    name: "Amazing Grace", source: "traditional", family: "major", bar: 6,
    notes: [[-3, 2], [0, 4], [2, 1], [0, 1], [2, 4], [1, 2], [0, 4], [-2, 2], [-3, 4], [-3, 2], [0, 4], [2, 1], [0, 1], [2, 4], [1, 2], [4, 10],
      [2, 2], [4, 3], [2, 1], [4, 1], [2, 1], [0, 4], [-3, 2], [-2, 3], [0, 1], [0, 1], [-2, 1], [-3, 4], [-3, 2], [0, 4], [2, 1], [0, 1], [2, 4], [1, 2], [0, 10]],
  },
  {
    name: "Shenandoah", source: "traditional", family: "major", bar: 8,
    notes: [[-3, 2], [0, 2], [0, 1], [0, 3], [1, 2], [2, 2], [5, 2], [4, 6], [7, 2], [6, 2], [5, 3], [4, 1], [5, 2], [4, 2], [2, 2], [4, 4],
      [4, 2], [5, 3], [5, 1], [5, 2], [2, 2], [4, 2], [2, 2], [1, 1], [0, 1], [2, 2], [1, 2], [0, 8]],
  },
  {
    name: "Greensleeves", source: "traditional", family: "minor", bar: 6,
    notes: [[0, 1], [2, 2], [3, 1], [4, 2], [5, 1], [4, 1], [3, 2], [1, 1], [-1, 2], [0, 1], [1, 1], [2, 2], [0, 1], [0, 2], [-1, 1], [0, 1], [1, 2], [-1, 1], [-3, 2],
      [0, 1], [2, 2], [3, 1], [4, 2], [5, 1], [4, 1], [3, 2], [1, 1], [-1, 2], [0, 1], [1, 1], [2, 2], [1, 1], [0, 1], [-1, 2], [-2, 1], [-1, 1], [0, 3]],
  },
  {
    name: "Scarborough Fair", source: "traditional", family: "minor", bar: 6,
    notes: [[0, 4], [0, 2], [4, 2], [4, 2], [1, 2], [2, 3], [1, 1], [0, 2], [4, 6], [6, 2], [7, 4], [6, 2], [4, 2], [5, 2], [3, 2], [4, 6],
      [7, 4], [7, 2], [7, 2], [6, 2], [4, 2], [4, 2], [3, 2], [2, 2], [1, 2], [0, 4], [4, 2], [3, 2], [2, 2], [1, 2], [0, 6]],
  },
  {
    name: "Wayfaring Stranger", source: "traditional", family: "minor", bar: 8,
    notes: [[0, 2], [2, 2], [3, 2], [4, 4], [4, 2], [3, 2], [4, 2], [2, 2], [0, 6], [0, 2], [2, 2], [3, 2], [4, 4], [4, 2], [6, 2], [7, 6],
      [7, 2], [6, 2], [4, 2], [4, 4], [3, 2], [2, 2], [3, 2], [2, 2], [0, 8]],
  },
  {
    name: "Sakura", source: "traditional (Japan)", family: "minor", bar: 8,
    notes: [[4, 2], [4, 2], [5, 4], [4, 2], [4, 2], [5, 4], [4, 2], [5, 2], [7, 2], [5, 2], [4, 2], [5, 1], [4, 1], [2, 4],
      [0, 2], [2, 2], [4, 2], [5, 2], [4, 2], [4, 1], [2, 1], [1, 4]],
  },
];

/* ------------------------------------------------------------------ */
/* Learning: interval transitions and rhythms                          */
/* ------------------------------------------------------------------ */

type Counts = Map<string, Map<number, number>>;

export interface StyleModel {
  order2: Counts; // "prevprev,prev" → next interval
  order1: Counts; // "prev" → next interval
  unigram: Map<number, number>;
  rhythms: number[][]; // whole bars of durations, in eighths
  firstDegrees: Map<number, number>;
}

const bump = (m: Map<number, number>, k: number, by = 1) => m.set(k, (m.get(k) ?? 0) + by);
const clampIv = (iv: number) => Math.max(-7, Math.min(7, iv));

function learn(tunes: Tune[]): StyleModel {
  const order2: Counts = new Map();
  const order1: Counts = new Map();
  const unigram = new Map<number, number>();
  const rhythms: number[][] = [];
  const firstDegrees = new Map<number, number>();
  for (const t of tunes) {
    const degs = t.notes.map((n) => n[0]);
    bump(firstDegrees, degs[0]);
    const ivs = degs.slice(1).map((d, i) => clampIv(d - degs[i]));
    ivs.forEach((iv, i) => {
      bump(unigram, iv);
      if (i >= 1) {
        const k1 = String(ivs[i - 1]);
        if (!order1.has(k1)) order1.set(k1, new Map());
        bump(order1.get(k1)!, iv);
      }
      if (i >= 2) {
        const k2 = `${ivs[i - 2]},${ivs[i - 1]}`;
        if (!order2.has(k2)) order2.set(k2, new Map());
        bump(order2.get(k2)!, iv);
      }
    });
    // cut the tune into whole bars; keep bars whose notes fit exactly
    let cur: number[] = [];
    let sum = 0;
    for (const [, dur] of t.notes) {
      cur.push(dur);
      sum += dur;
      if (sum === t.bar) {
        rhythms.push(cur);
        cur = [];
        sum = 0;
      } else if (sum > t.bar) {
        cur = [];
        sum = 0;
      }
    }
  }
  return { order2, order1, unigram, rhythms, firstDegrees };
}

const models = new Map<string, StyleModel>();
/** The style learned from the corpus (major or minor tunes weighted up). */
export function styleFor(family: "major" | "minor"): StyleModel {
  if (!models.has(family)) {
    // the family's own tunes count three times as much as the others
    const weighted = CORPUS.flatMap((t) => (t.family === family ? [t, t, t] : [t]));
    models.set(family, learn(weighted));
  }
  return models.get(family)!;
}

function sample(rng: () => number, m: Map<number, number> | undefined): number | undefined {
  if (!m || !m.size) return undefined;
  let total = 0;
  for (const v of m.values()) total += v;
  let r = rng() * total;
  for (const [k, v] of m) {
    r -= v;
    if (r <= 0) return k;
  }
  return [...m.keys()][0];
}

export interface MelodyNote {
  deg: number; // scale degree from the home note
  at: number; // start, in eighths from the phrase start
  dur: number; // length in eighths
}

/**
 * Write a new phrase in the learned style: rhythms taken from real bars,
 * intervals chosen the way the corpus tends to move.
 */
export function writePhrase(rng: () => number, model: StyleModel, eighths: number, start: number, lo = -3, hi = 9): MelodyNote[] {
  // rhythm: whole bars from the corpus, until the phrase is full
  const durs: number[] = [];
  let sum = 0;
  while (sum < eighths) {
    const bar = model.rhythms[Math.floor(rng() * model.rhythms.length)] ?? [2, 2, 2];
    for (const d of bar) {
      if (sum >= eighths) break;
      const dd = Math.min(d, eighths - sum);
      durs.push(dd);
      sum += dd;
    }
  }
  // phrases breathe out on a longer final note
  if (durs.length > 2 && durs[durs.length - 1] < 2) {
    const last = durs.pop()!;
    durs[durs.length - 1] += last;
  }
  // pitches: walk the learned interval patterns
  const notes: MelodyNote[] = [];
  let deg = start;
  let p1: number | null = null;
  let p2: number | null = null;
  let at = 0;
  durs.forEach((dur, i) => {
    if (i > 0) {
      let iv = (p1 !== null && p2 !== null ? sample(rng, model.order2.get(`${p2},${p1}`)) : undefined) ?? (p1 !== null ? sample(rng, model.order1.get(String(p1))) : undefined) ?? sample(rng, model.unigram) ?? 1;
      let next = deg + iv;
      if (next > hi) next = deg - Math.abs(iv); // turn back into range
      if (next < lo) next = deg + Math.abs(iv);
      iv = next - deg;
      p2 = p1;
      p1 = iv;
      deg = next;
    }
    notes.push({ deg, at, dur });
    at += dur;
  });
  return notes;
}

/** A varied repeat: same rhythm and opening, a new ending. */
export function varyPhrase(rng: () => number, model: StyleModel, phrase: MelodyNote[]): MelodyNote[] {
  const keep = Math.max(2, Math.ceil(phrase.length * 0.55));
  const out = phrase.slice(0, keep).map((n) => ({ ...n }));
  let deg = out[out.length - 1].deg;
  let prev = out.length > 1 ? out[out.length - 1].deg - out[out.length - 2].deg : 0;
  for (const n of phrase.slice(keep)) {
    const iv = sample(rng, model.order1.get(String(clampIv(prev)))) ?? 1;
    deg = Math.max(-3, Math.min(9, deg + iv));
    prev = iv;
    out.push({ ...n, deg });
  }
  return out;
}
