"use client";

import type { DriftConfig } from "@/lib/schema";
import type { Snapshot } from "@/lib/engine/Engine";
import { MATRIX_PRESETS, STATES, STATE_LABELS, STATE_NAMES, learnedMatrix, normalized } from "@/lib/engine/markov";
import { pcName, rootPc, scaleOf } from "@/lib/music";
import { PALETTE } from "./Visualizer";

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  snapshot: Snapshot | null;
  lastStep: { from: number; to: number; at: number } | null;
}

/**
 * The Markov chain, made visible and editable. Rows are the note just
 * played, columns the next note; brighter cells are more likely moves.
 */
export default function MarkovPanel({ config, update, snapshot, lastStep }: Props) {
  const raw = config.markov?.matrix ?? learnedMatrix();
  const probs = normalized(raw);
  const presetId = config.markov?.preset ?? "learned";
  const scale = scaleOf(config.harmony);
  const home = rootPc(config.harmony.root);
  const noteName = (st: number) => pcName(home + (st >= 7 ? 0 : scale[st % scale.length]));
  const fresh = lastStep && performance.now() - lastStep.at < 1500;

  const edit = (from: number, to: number, delta: number) =>
    update((c) => {
      const m = (c.markov?.matrix ?? learnedMatrix()).map((r) => [...r]);
      // work in "probability units" so a click always makes a visible change
      const row = normalized([m[from]])[0].map((p) => p * 10);
      row[to] = Math.max(0, row[to] + delta);
      m[from] = row;
      c.markov = { preset: "custom", matrix: m };
    });

  return (
    <div className="section">
      <p className="label">Markov chain · how notes follow each other</p>
      <p className="hint">
        Each new note is chosen from the one before it, using these chances. Rows: the note just played. Columns: what comes next. Click a cell to make that move more likely, ⌥-click
        (Alt-click) to make it less likely.
      </p>

      <div className="mk-grid" style={{ gridTemplateColumns: `28px repeat(${STATES}, 1fr)` }}>
        <span />
        {STATE_LABELS.map((l, j) => (
          <span key={j} className="mk-head" title={STATE_NAMES[j]}>
            {noteName(j)}
          </span>
        ))}
        {probs.map((row, i) => (
          <div key={i} style={{ display: "contents" }}>
            <span className="mk-head row" title={`after the ${STATE_NAMES[i]}`}>
              {noteName(i)}
            </span>
            {row.map((p, j) => {
              const live = fresh && lastStep!.from === i && lastStep!.to === j;
              return (
                <button
                  key={j}
                  className={`mk-cell ${live ? "live" : ""}`}
                  style={{ background: `rgba(169, 199, 255, ${(0.06 + Math.pow(p, 0.7) * 0.9).toFixed(3)})` }}
                  title={`${noteName(i)} → ${noteName(j)}: ${Math.round(p * 100)}%`}
                  onClick={(e) => edit(i, j, e.altKey ? -1.5 : 1.5)}
                >
                  {p >= 0.15 ? Math.round(p * 100) : ""}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="chips">
        {MATRIX_PRESETS.map((pr) => (
          <button key={pr.id} className={`chip ${presetId === pr.id ? "on" : ""}`} title={pr.hint} onClick={() => update((c) => (c.markov = { preset: pr.id, matrix: pr.make() }))}>
            {pr.label}
          </button>
        ))}
        {presetId === "custom" && <span className="chip on">Your own</span>}
      </div>

      {snapshot && snapshot.loops.length > 0 && (
        <>
          <p className="label" style={{ marginTop: 16 }}>
            Loops · lengths that never line up
          </p>
          {snapshot.loops.map((l) => {
            const s = snapshot.layers.find((x) => x.id === l.id);
            const color = PALETTE[(s?.colorIndex ?? 0) % PALETTE.length];
            return (
              <div className="mk-loop" key={l.id}>
                <span className="swatch" style={{ background: color }} />
                <span className="mk-loop-name">{s?.name ?? l.id}</span>
                <span className="mono mk-loop-len">{l.length.toFixed(1)}s</span>
                <span className="mk-loop-bar">
                  <span style={{ width: `${Math.round(l.position * 100)}%`, background: color }} />
                </span>
                <span className="mono mk-loop-note">{noteName(l.state)}</span>
              </div>
            );
          })}
          <p className="hint" style={{ marginTop: 6 }}>
            Each voice repeats over its own loop. Every time round, Evolution decides how many of its notes the chain chooses afresh; the rest repeat like a tape loop.
          </p>
        </>
      )}
    </div>
  );
}
