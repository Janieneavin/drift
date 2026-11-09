"use client";

import { useState } from "react";
import type { DriftConfig } from "@/lib/schema";
import type { Snapshot } from "@/lib/engine/Engine";
import { BUILT_IN, PHRASE_STEPS, type PhraseGrid } from "@/lib/engine/phrases";
import { pcName, rootPc, scaleOf } from "@/lib/music";
import { PALETTE } from "./Visualizer";

const TOP = 11;
const BOTTOM = -7;
const ROWS = Array.from({ length: TOP - BOTTOM + 1 }, (_, i) => TOP - i);

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  snapshot: Snapshot | null;
}

const big = (n: number) => (n >= 1e12 ? "over a trillion" : n >= 1e9 ? `${(n / 1e9).toFixed(1)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : n.toLocaleString());

/** The phrase chain, made visible: what it learned from, and what it's writing now. */
export default function PhrasePanel({ config, update, snapshot }: Props) {
  const [editing, setEditing] = useState<PhraseGrid | null>(null);
  const live = snapshot?.phrase ?? null;
  const scale = scaleOf(config.harmony);
  const home = rootPc(config.harmony.root);
  const noteName = (d: number) => pcName(home + scale[((d % scale.length) + scale.length) % scale.length]);
  const corpusNames = [...(config.phrasebank.builtIn || !config.phrasebank.user.length ? BUILT_IN.map((p) => p.name) : []), ...config.phrasebank.user.map((_, i) => `your phrase ${i + 1}`)];

  return (
    <div className="section">
      <p className="label">Phrase chain</p>
      <p className="hint">
        Every 16 beats the chain writes a new phrase. Each state is <i>a beat position + the notes on it + the bass underneath</i>, learned from the phrases below. Walking it follows
        one phrase, switching to another wherever they agree, so new phrases still sound like they belong. (Technique: Alex Bainter, 2018.)
      </p>
      {live && (
        <p className="hint" style={{ marginTop: 0 }}>
          Learned from <b>{live.corpus}</b> phrases · {live.states} states · can write <b>{big(live.possible)}</b> different phrases.
        </p>
      )}

      {live && (
        <>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="label" style={{ margin: 0, flex: 1 }}>
              Now playing
            </span>
            <span className={`badge ${live.original < 0 ? "fresh" : ""}`}>{live.original < 0 ? "a new phrase" : `original: ${corpusNames[live.original] ?? "?"}`}</span>
          </div>
          <PhraseRoll grid={live.grid} sources={live.sources} playhead={live.step} noteName={noteName} />
          <p className="hint" style={{ marginTop: 4 }}>
            Colour shows which learned phrase each step came from; white steps are shared by several.
          </p>
        </>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <span className="label" style={{ margin: 0, flex: 1 }}>
          Phrases it learns from
        </span>
        <button className={`toggle ${config.phrasebank.builtIn ? "on" : ""}`} title="Include DRIFT's own phrases" onClick={() => update((c) => (c.phrasebank.builtIn = !c.phrasebank.builtIn))} />
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        {config.phrasebank.builtIn ? `DRIFT's ${BUILT_IN.length} phrases` : "DRIFT's phrases are off"}
        {config.phrasebank.user.length ? ` + ${config.phrasebank.user.length} of yours` : ""}. Write your own and the chain mixes them in.
      </p>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="hint" style={{ margin: 0, minWidth: 70 }}>As written</span>
        <input type="range" min={0} max={1} step={0.05} value={config.phrasebank.mix} style={{ flex: 1 }} aria-label="How freely the chain mixes phrases" onChange={(e) => update((c) => (c.phrasebank.mix = Number(e.target.value)))} />
        <span className="hint" style={{ margin: 0, minWidth: 70, textAlign: "right" }}>Mixed freely</span>
      </div>
      {config.phrasebank.user.map((g, i) => (
        <div key={i} className="row" style={{ marginTop: 4 }}>
          <span className="mono" style={{ fontSize: 11, flex: 1 }}>
            your phrase {i + 1} · {g.filter((n) => n.length).length} notes
          </span>
          <button className="btn ghost small" onClick={() => setEditing(g.map((n) => [...n]))}>
            Copy to editor
          </button>
          <button className="x" title="Remove" onClick={() => update((c) => void c.phrasebank.user.splice(i, 1))}>
            ×
          </button>
        </div>
      ))}

      {!editing ? (
        <div className="row mt">
          <button className="btn small primary" disabled={config.phrasebank.user.length >= 24} onClick={() => setEditing(Array.from({ length: PHRASE_STEPS }, () => []))}>
            + Write a phrase
          </button>
          {live && (
            <button className="btn small" onClick={() => setEditing(live.grid.map((n) => [...n]))} title="Start from the phrase playing now">
              Edit the current phrase
            </button>
          )}
        </div>
      ) : (
        <PhraseEditor
          grid={editing}
          onChange={setEditing}
          noteName={noteName}
          onCancel={() => setEditing(null)}
          onSave={() => {
            const g = editing;
            update((c) => void c.phrasebank.user.push(g));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function PhraseRoll({ grid, sources, playhead, noteName }: { grid: PhraseGrid; sources: number[][]; playhead: number; noteName: (d: number) => string }) {
  return (
    <div className="proll" style={{ gridTemplateColumns: `22px repeat(${PHRASE_STEPS}, 1fr)` }}>
      {ROWS.map((d) => (
        <div key={d} style={{ display: "contents" }}>
          <span className="proll-label">{d % 7 === 0 ? noteName(d) : ""}</span>
          {grid.map((notes, s) => {
            const on = notes.includes(d);
            const src = sources[s] ?? [];
            const color = src.length === 1 ? PALETTE[src[0] % PALETTE.length] : "#ffffff";
            return <span key={s} className={`proll-cell ${s === playhead ? "head" : ""} ${s % 8 === 0 ? "beat" : ""}`} style={on ? { background: color, boxShadow: `0 0 6px ${color}` } : undefined} />;
          })}
        </div>
      ))}
    </div>
  );
}

function PhraseEditor({ grid, onChange, onSave, onCancel, noteName }: { grid: PhraseGrid; onChange: (g: PhraseGrid) => void; onSave: () => void; onCancel: () => void; noteName: (d: number) => string }) {
  const toggle = (s: number, d: number) => {
    const g = grid.map((n) => [...n]);
    if (g[s].includes(d)) g[s] = g[s].filter((x) => x !== d);
    else if (g[s].length < 4) g[s] = [...g[s], d].sort((a, b) => a - b);
    onChange(g);
  };
  const count = grid.filter((n) => n.length).length;
  return (
    <div className="theme" style={{ marginTop: 8 }}>
      <p className="hint" style={{ margin: "0 0 6px" }}>
        16 beats, left to right (each column is half a beat). Rows are notes of the scale; the lower rows are bass. Click to add or remove notes.
      </p>
      <div className="proll edit" style={{ gridTemplateColumns: `22px repeat(${PHRASE_STEPS}, 1fr)` }}>
        {ROWS.map((d) => (
          <div key={d} style={{ display: "contents" }}>
            <span className="proll-label">{noteName(d)}</span>
            {grid.map((notes, s) => (
              <button key={s} className={`proll-cell ${s % 8 === 0 ? "beat" : ""} ${d < 0 ? "low" : ""}`} style={notes.includes(d) ? { background: "#a9c7ff" } : undefined} onClick={() => toggle(s, d)} aria-label={`step ${s + 1}, ${noteName(d)}`} />
            ))}
          </div>
        ))}
      </div>
      <div className="row mt">
        <span className="hint" style={{ margin: 0, flex: 1 }}>
          {count} note{count === 1 ? "" : "s"}
        </span>
        <button className="btn ghost small" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary small" disabled={!count} onClick={onSave}>
          Teach it to the chain
        </button>
      </div>
    </div>
  );
}
