"use client";

import { useRef } from "react";
import type { Composition, DriftConfig } from "@/lib/schema";
import { ENGINE_VERSION } from "@/lib/schema";
import { PRESETS } from "@/lib/presets";

export interface Recording {
  id: string;
  name: string;
  url: string;
  seconds: number;
  seed: number;
  ext: "wav" | "webm";
}

interface Props {
  config: DriftConfig;
  compositions: Composition[];
  currentId: string | null;
  recordings: Recording[];
  playing: boolean;
  currentSeed: number | null;
  onSave: (asNew: boolean) => void;
  onSnapshot: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onOpen: (c: DriftConfig, id: string | null) => void;
  onDelete: (id: string) => void;
  onRandomize: () => void;
  onBlank: () => void;
  onSeed: (seed: number | null) => void;
  onRestart: () => void;
  onClose: () => void;
}

export default function Library(p: Props) {
  const fixed = p.config.seed !== null;
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="drawer">
      <div className="row">
        <p className="label" style={{ flex: 1, margin: 0 }}>
          Library
        </p>
        <button className="btn ghost small" onClick={p.onClose}>
          close
        </button>
      </div>

      <div className="section" style={{ marginTop: 6 }}>
        <h2 className="q">Save the system</h2>
        <p className="hint">Saving keeps the description, every setting, layer relationship and rule — not a recording. Reopening it plays a new performance of the same composition.</p>
        <div className="row wrap">
          <button className="btn primary small" onClick={() => p.onSave(false)}>
            {p.currentId ? "Save changes" : "Save composition"}
          </button>
          {p.currentId && (
            <button className="btn small" onClick={() => p.onSave(true)}>
              Save as new
            </button>
          )}
          <button className="btn small" onClick={p.onSnapshot} title="Save this exact performance: the system plus its current seed">
            Save snapshot
          </button>
          <button className="btn small" onClick={p.onRandomize} title="Build a random system to explore">
            ⚄ Randomize
          </button>
          <button className="btn small" onClick={p.onBlank} title="Start with a single soft pad and add layers one by one">
            Start from scratch
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>A snapshot also keeps the seed, so it replays this exact performance.</p>
        <div className="row wrap mt">
          <button className="btn small" onClick={p.onExport}>
            Export system (.json)
          </button>
          <button className="btn small" onClick={() => fileRef.current?.click()}>
            Import system…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) p.onImport(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="section">
        <h2 className="q">Realization</h2>
        <div className="seed-box">
          <label className="row" style={{ cursor: "pointer" }}>
            <button className={`toggle ${fixed ? "on" : ""}`} onClick={() => p.onSeed(fixed ? null : p.currentSeed ?? 1)} />
            <span>{fixed ? "Fixed seed — the same performance every time" : "Fresh performance every time you press play"}</span>
          </label>
          {fixed && (
            <div className="row mt">
              <span className="hint" style={{ margin: 0 }}>
                Seed
              </span>
              <input
                className="input mono"
                style={{ width: 130, padding: "4px 8px" }}
                type="number"
                value={p.config.seed ?? 0}
                onChange={(e) => p.onSeed(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              />
              <button className="btn small" onClick={p.onRestart} disabled={!p.playing}>
                Replay from start
              </button>
            </div>
          )}
          {!fixed && p.playing && p.currentSeed !== null && (
            <div className="row mt">
              <span className="hint mono" style={{ margin: 0, flex: 1 }}>
                this performance: seed {p.currentSeed}
              </span>
              <button className="btn small" onClick={() => p.onSeed(p.currentSeed)}>
                Keep this one
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="section">
        <h2 className="q">Your compositions</h2>
        {p.compositions.length === 0 && <p className="hint">Nothing saved yet.</p>}
        {p.compositions.map((c) => (
          <div className="comp-item" key={c.id}>
            <div className="row">
              <b style={{ flex: 1, fontWeight: 500 }}>{c.config.name}</b>
              <span className="badge" style={{ color: c.kind === "snapshot" ? "#a9c7ff" : undefined }}>{c.kind}</span>
              {c.id === p.currentId && <span className="badge">open</span>}
            </div>
            <div className="atm">“{c.config.atmosphere}”</div>
            <div className="meta">
              {c.config.layers.length} layers · {c.config.rules.length} rule{c.config.rules.length === 1 ? "" : "s"} · {new Date(c.savedAt).toLocaleString()}
              {c.config.seed !== null ? ` · seed ${c.config.seed}` : ""}
            </div>
            {c.config.seed !== null && c.config.engine.version !== ENGINE_VERSION && (
              <div className="unsupported">Saved with engine v{c.config.engine.version}; this seed may now play a slightly different performance (current engine v{ENGINE_VERSION}).</div>
            )}
            <div className="row mt">
              <button className="btn small" onClick={() => p.onOpen(c.config, c.id)}>
                Open
              </button>
              <button className="btn ghost small" onClick={() => confirm(`Delete “${c.config.name}”?`) && p.onDelete(c.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section">
        <h2 className="q">Starting points</h2>
        <div className="row wrap">
          {PRESETS.map((pr) => (
            <button key={pr.name} className="chip" onClick={() => p.onOpen(pr, null)}>
              {pr.name}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <h2 className="q">Recorded performances</h2>
        <p className="hint">Audio captures of one performance. These are separate from the saved system above.</p>
        {p.recordings.length === 0 && <p className="hint">Use ● Record in the top bar to capture an excerpt.</p>}
        {p.recordings.map((r) => (
          <div className="comp-item" key={r.id}>
            <div className="row">
              <span style={{ flex: 1 }}>{r.name}</span>
              <a className="btn small" href={r.url} download={`${r.name.replace(/[^\w-]+/g, "_")}.${r.ext}`}>
                Download {r.ext.toUpperCase()}
              </a>
            </div>
            <div className="meta">
              {r.seconds.toFixed(0)}s · seed {r.seed}
            </div>
            <audio src={r.url} controls />
          </div>
        ))}
      </div>
    </div>
  );
}
