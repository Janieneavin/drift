"use client";

import type { Layer } from "@/lib/schema";

const TOP = 7; // highest step shown (7 scale steps above the start)
const BOTTOM = -3; // lowest step shown
const ROWS = Array.from({ length: TOP - BOTTOM + 1 }, (_, i) => TOP - i);

const STRENGTHS = [
  { label: "rarely", value: 0.2 },
  { label: "sometimes", value: 0.45 },
  { label: "often", value: 0.75 },
  { label: "almost always", value: 1 },
];

type Theme = NonNullable<Layer["theme"]>;

interface Props {
  layer: Layer;
  color: string;
  onChange: (theme: Layer["theme"]) => void;
  onHear: () => void;
  canHear: boolean;
}

/**
 * Draw a melody as a shape: each column is one beat, each row a step up
 * or down the scale. An empty column is a rest. Locked notes are played
 * exactly every time; unlocked notes may vary.
 */
export default function ThemeEditor({ layer, color, onChange, onHear, canHear }: Props) {
  const theme = layer.theme;
  const steps: (number | null)[] = theme?.steps.length ? [...theme.steps] : Array(8).fill(null);
  while (steps.length < 4) steps.push(null);
  const locks: boolean[] = steps.map((_, i) => Boolean(theme?.locks[i]));
  const strength = theme?.strength ?? 0.45;

  const emit = (nextSteps: (number | null)[], nextLocks: boolean[], s = strength) => {
    const t: Theme = { steps: nextSteps, locks: nextLocks.map((l, i) => l && nextSteps[i] !== null), strength: s };
    onChange(nextSteps.some((x) => x !== null) ? t : null);
  };
  const set = (col: number, row: number) => {
    if (locks[col]) return; // a locked note can't be redrawn until unlocked
    const next = [...steps];
    next[col] = next[col] === row ? null : row;
    emit(next, locks);
  };
  const toggleLock = (col: number) => {
    if (steps[col] === null) return;
    const next = [...locks];
    next[col] = !next[col];
    emit(steps, next);
  };
  const resize = (n: number) => {
    const ns = steps.slice(0, n);
    const nl = locks.slice(0, n);
    while (ns.length < n) {
      ns.push(null);
      nl.push(false);
    }
    emit(ns, nl);
  };
  const allLocked = steps.some((x) => x !== null) && steps.every((x, i) => x === null || locks[i]);
  const strengthLabel = STRENGTHS.reduce((a, b) => (Math.abs(b.value - strength) < Math.abs(a.value - strength) ? b : a)).label;

  return (
    <div className="theme">
      <div className="theme-grid" style={{ gridTemplateColumns: `14px repeat(${steps.length}, 1fr)` }}>
        {ROWS.map((row) => (
          <div key={row} style={{ display: "contents" }}>
            <span className="theme-row-label">{row === 0 ? "●" : row > 0 ? `+${row}` : row}</span>
            {steps.map((v, col) => (
              <button
                key={col}
                className={`cell ${row === 0 ? "zero" : ""} ${v === row ? "on" : ""} ${locks[col] ? "locked" : ""}`}
                style={v === row ? { background: color, boxShadow: `0 0 8px ${color}` } : undefined}
                onClick={() => set(col, row)}
                aria-label={`beat ${col + 1}, ${row === 0 ? "starting note" : `${Math.abs(row)} step${Math.abs(row) === 1 ? "" : "s"} ${row > 0 ? "up" : "down"}`}`}
              />
            ))}
          </div>
        ))}
        <span className="theme-row-label" title="Lock notes">🔒</span>
        {steps.map((v, col) => (
          <button
            key={`lock-${col}`}
            className={`lock ${locks[col] ? "on" : ""}`}
            disabled={v === null}
            onClick={() => toggleLock(col)}
            title={v === null ? "A rest can't be locked" : locks[col] ? "Locked: always played exactly. Click to unlock" : "Lock this note so it never varies"}
          >
            {v === null ? "" : locks[col] ? "●" : "○"}
          </button>
        ))}
      </div>
      <p className="hint" style={{ margin: "6px 0 0" }}>
        Each column is a beat; ● is the home note (it moves with the key), rows above and below are steps up and down the scale. Empty columns are rests. Locked notes (bottom row) are played exactly every time; the rest may vary.
      </p>
      <div className="row wrap mt">
        <span>Plays</span>
        <select
          className="inline"
          value={strengthLabel}
          onChange={(e) => emit(steps, locks, STRENGTHS.find((x) => x.label === e.target.value)!.value)}
          disabled={!theme}
        >
          {STRENGTHS.map((s) => (
            <option key={s.label} value={s.label}>
              {s.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn ghost small" onClick={() => resize(Math.max(4, steps.length - 1))} title="Fewer beats">
          −
        </button>
        <span className="mono" style={{ fontSize: 12 }}>
          {steps.length} beats
        </span>
        <button className="btn ghost small" onClick={() => resize(Math.min(16, steps.length + 1))} title="More beats">
          +
        </button>
      </div>
      <div className="row mt">
        <button className="btn small primary" onClick={onHear} disabled={!theme || !canHear} title={canHear ? "Play this melody now" : "Press play first"}>
          ▶ Hear it now
        </button>
        <button className="btn small" disabled={!theme} onClick={() => emit(steps, steps.map((x) => !allLocked && x !== null))}>
          {allLocked ? "Unlock all" : "Lock all"}
        </button>
        <button className="btn ghost small" onClick={() => onChange(null)} disabled={!theme}>
          Clear
        </button>
      </div>
    </div>
  );
}
