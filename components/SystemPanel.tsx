"use client";

import { useState } from "react";
import NotesPanel from "./NotesPanel";
import ThemeEditor from "./ThemeEditor";
import AddLayer from "./AddLayer";
import ArcPanel from "./ArcPanel";
import MarkovPanel from "./MarkovPanel";
import { fill } from "@/lib/ui";
import type { DriftConfig, Layer } from "@/lib/schema";
import { INSTRUMENTS } from "@/lib/schema";
import {
  ACTIVITY_CHOICES,
  MOVEMENT_LABEL,
  PROMINENCE_LABEL,
  REGISTER_CHOICES,
  RELATION_LABEL,
  SYSTEM_LINES,
  activityLabel,
  nearestChoice,
  registerLabel,
  summarize,
} from "@/lib/describe";
import { INSTRUMENT_GROUPS, INSTRUMENT_LABEL, PRESETS, roleFor } from "@/lib/presets";
import { layer as makeLayer } from "@/lib/presets";
import type { Fx } from "@/lib/schema";

const FX_LABEL: Record<Fx, string> = {
  none: "no effect",
  sweep: "a filter sweep",
  pump: "sidechain pumping",
  crush: "bit-crush",
  drive: "drive",
};
import { uid } from "@/lib/schema";
import type { Snapshot } from "@/lib/engine/Engine";
import { PALETTE } from "./Visualizer";

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  snapshot: Snapshot | null;
  playing: boolean;
  advanced: boolean;
  onHearTheme: (layerId: string) => void;
  lastMarkov: { from: number; to: number; at: number } | null;
  onOpenPreset: (c: DriftConfig) => void;
}

/** A section that can be opened and closed (Advanced mode). */
function Fold({ title, open, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details className="fold" open={open}>
      <summary>{title}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

export default function SystemPanel({ config, update, snapshot, playing, advanced, onHearTheme, lastMarkov, onOpenPreset }: Props) {
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const colorOf = (id: string, i: number) => {
    const s = snapshot?.layers.find((l) => l.id === id);
    return PALETTE[(s?.colorIndex ?? i) % PALETTE.length];
  };
  const runtime = snapshot?.layers.filter((l) => l.runtime) ?? [];

  /* ---------------- Simple mode: presets and layers, nothing else ---------------- */
  if (!advanced) {
    return (
      <>
        <div className="section">
          <p className="label">Pieces</p>
          <div className="preset-list">
            {PRESETS.map((p) => (
              <button key={p.name} className={`preset ${p.name === config.name ? "on" : ""}`} onClick={() => onOpenPreset(p)}>
                <b>{p.name}</b>
                <small>{p.engine.type === "composed" ? "Pulse" : "Ambient"} · {p.atmosphere}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="section">
          <div className="row">
            <p className="label" style={{ flex: 1, margin: 0 }}>
              Layers
            </p>
            <button className="btn small" disabled={config.layers.length >= 6 && !adding} onClick={() => setAdding((a) => !a)}>
              {adding ? "Close" : "+ Add"}
            </button>
          </div>
          {adding && (
            <AddLayer
              count={config.layers.length}
              onClose={() => setAdding(false)}
              onAdd={(nl) => {
                update((c) => void c.layers.push(nl));
                setAdding(false);
              }}
            />
          )}
          {config.layers.map((l, i) => (
            <div key={l.id} className={`simple-layer ${l.enabled ? "" : "off"}`}>
              <span className="swatch" style={{ background: colorOf(l.id, i) }} />
              <span className="simple-name" title={INSTRUMENT_LABEL[l.instrument]}>
                {l.name}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={l.volume}
                style={fill(l.volume)}
                aria-label={`${l.name} volume`}
                onChange={(e) =>
                  update((c) => {
                    const t = c.layers.find((x) => x.id === l.id);
                    if (t) t.volume = Number(e.target.value);
                  })
                }
              />
              <button
                className={`toggle ${l.enabled ? "on" : ""}`}
                title={l.enabled ? "Mute this layer" : "Bring this layer back"}
                onClick={() =>
                  update((c) => {
                    const t = c.layers.find((x) => x.id === l.id);
                    if (t) t.enabled = !t.enabled;
                  })
                }
              />
            </div>
          ))}
          <p className="hint" style={{ marginTop: 10 }}>
            Switch to <b>Advanced</b> (top bar) for the key, tempo, chord progression, Markov chain, melodies, rules and each layer&apos;s details.
          </p>
        </div>
      </>
    );
  }

  /* ---------------- Advanced mode: everything, in sections ---------------- */
  const style = config.engine.type === "composed" ? "pulse" : config.engine.type === "ambient" ? "ambient" : "generative";
  return (
    <>
      <Fold title="Style" open>
        <div className="seg">
          <button className={style === "ambient" ? "on" : ""} onClick={() => update((c) => (c.engine.type = "ambient"))}>
            Ambient
          </button>
          <button className={style === "pulse" ? "on" : ""} onClick={() => update((c) => (c.engine.type = "composed"))}>
            Pulse
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          {style === "ambient"
            ? "Ambient: each voice repeats over a slow loop of its own length; a Markov chain picks its notes. No beat unless you add drums."
            : style === "pulse"
              ? "Pulse: interlocking patterns on a shared beat over a repeating progression, cycling Beginning → Development → Expansion → Release."
              : "Generative (older engine): independent layers improvising in phrases. Choose Ambient or Pulse to switch."}
        </p>
        <p className="hint" style={{ marginTop: 6, fontSize: 11 }}>
          Piano: Salamander Grand Piano by Alexander Holm, CC BY 3.0 (a soft synth plays until it loads, or when offline).
        </p>
      </Fold>
      {config.engine.type === "ambient" && (
        <Fold title="Markov chain & loops" open>
          <MarkovPanel config={config} update={update} snapshot={snapshot} lastStep={lastMarkov} />
        </Fold>
      )}
      {config.engine.type === "layers" && (
        <Fold title="Shape over time">
          <ArcPanel config={config} update={update} snapshot={snapshot} />
        </Fold>
      )}
      <Fold title="Notes & time">
        <NotesPanel config={config} update={update} chordIndex={snapshot?.chordIndex ?? -1} />
      </Fold>
      <Fold title="Your musical system">
      <div className="section">
        <p className="label">Your musical system</p>
        <ul className="summary">
          {summarize(config).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 8 }}>
          Every line below is a rule the engine is following right now. Change any of them — the music adjusts without stopping. Hover a line to see why it matters.
        </p>
        {SYSTEM_LINES.map((line) => {
          const cur = nearestChoice(line, config);
          return (
            <div className="sysline" key={line.key}>
              <span>{line.before}</span>
              <select
                className="inline"
                value={String(cur.value)}
                onChange={(e) => {
                  const ch = line.choices.find((c) => String(c.value) === e.target.value);
                  if (ch) update((c) => line.set(c, ch.value));
                }}
              >
                {line.choices.map((ch) => (
                  <option key={String(ch.value)} value={String(ch.value)}>
                    {ch.label}
                  </option>
                ))}
              </select>
              {line.after && <span>{line.after}</span>}
              <span className="why">{line.why}</span>
            </div>
          );
        })}
      </div>
      </Fold>

      <Fold title="Layers" open>
      <div className="section">
        <div className="row">
          <p className="label" style={{ flex: 1, margin: 0 }}>
            Layers · how they behave together
          </p>
          <button className="btn small primary" disabled={config.layers.length >= 6 && !adding} onClick={() => setAdding((a) => !a)}>
            {adding ? "Close" : "+ Add layer"}
          </button>
        </div>
        {adding && (
          <AddLayer
            count={config.layers.length}
            onClose={() => setAdding(false)}
            onAdd={(nl) => {
              update((c) => void c.layers.push(nl));
              setAdding(false);
              setOpenId(nl.id);
            }}
          />
        )}
        {config.layers.map((l, i) => (
          <LayerCard
            key={l.id}
            open={openId === l.id}
            onToggleOpen={() => setOpenId((o) => (o === l.id ? null : l.id))}
            l={l}
            color={colorOf(l.id, i)}
            config={config}
            speaking={snapshot?.speaker === l.id}
            active={snapshot ? snapshot.layers.find((x) => x.id === l.id)?.active ?? true : true}
            update={update}
            playing={playing}
            advanced={advanced}
            onHear={() => onHearTheme(l.id)}
          />
        ))}
        {runtime.map((r) => (
          <div className="layer-card" key={r.id}>
            <div className="layer-head">
              <span className="swatch" style={{ background: PALETTE[r.colorIndex % PALETTE.length] }} />
              <span style={{ flex: 1 }}>{r.name}</span>
              <span className="badge">added by a rule</span>
            </div>
          </div>
        ))}
      </div>
      </Fold>
    </>
  );
}

function LayerCard({
  l,
  color,
  config,
  speaking,
  active,
  update,
  playing,
  advanced,
  onHear,
  open,
  onToggleOpen,
}: {
  l: Layer;
  color: string;
  config: DriftConfig;
  speaking: boolean;
  active: boolean;
  update: (fn: (c: DriftConfig) => void) => void;
  playing: boolean;
  advanced: boolean;
  onHear: () => void;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const [showTheme, setShowTheme] = useState(false);
  const edit = (fn: (x: Layer) => void) =>
    update((c) => {
      const t = c.layers.find((x) => x.id === l.id);
      if (t) fn(t);
    });
  const others = config.layers.filter((x) => x.id !== l.id);
  const relValue = l.relation.type === "independent" || !l.relation.target ? "independent" : `${l.relation.type}:${l.relation.target}`;

  return (
    <div className={`layer-card ${l.enabled ? "" : "off"} ${speaking ? "speaking" : ""}`} style={{ ["--accent-color" as string]: color } as React.CSSProperties}>
      <div className="layer-head">
        <span className="swatch" style={{ background: color, boxShadow: active && l.enabled ? `0 0 8px ${color}` : "none" }} />
        <input className="layer-name" value={l.name} onChange={(e) => edit((x) => (x.name = e.target.value || x.name))} />
        <button className={`icon-btn ${open ? "active" : ""}`} style={{ height: 24, padding: "0 8px" }} onClick={onToggleOpen} title="Open this layer's details">
          {open ? "Done" : "Edit"}
        </button>
        <button className={`toggle ${l.enabled ? "on" : ""}`} title={l.enabled ? "Mute this layer" : "Bring this layer back"} onClick={() => edit((x) => (x.enabled = !x.enabled))} />
        <button
          className="x"
          title="Remove layer"
          disabled={config.layers.length <= 1}
          onClick={() =>
            update((c) => {
              c.layers = c.layers.filter((x) => x.id !== l.id);
              for (const o of c.layers) if (o.relation.target === l.id) o.relation = { type: "independent", target: null };
            })
          }
        >
          ×
        </button>
      </div>
      <div className="layer-body">
        <select
          className="inline"
          value={l.instrument}
          onChange={(e) =>
            edit((x) => {
              const inst = e.target.value as Layer["instrument"];
              // switching to or from the drum machine changes what the layer does
              if (inst === "drums" || x.instrument === "drums") x.role = roleFor(inst);
              x.instrument = inst;
            })
          }
        >
          {INSTRUMENT_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => (
                <option key={i} value={i}>
                  {INSTRUMENT_LABEL[i]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>{" "}
        <select className="inline" value={l.prominence} onChange={(e) => edit((x) => (x.prominence = e.target.value as Layer["prominence"]))}>
          {Object.entries(PROMINENCE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        , plays{" "}
        <select
          className="inline"
          value={String(ACTIVITY_CHOICES.find((c) => c.label === activityLabel(l))?.value)}
          onChange={(e) => edit((x) => (x.activity = Number(e.target.value)))}
        >
          {ACTIVITY_CHOICES.map((c) => (
            <option key={c.label} value={String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
        , moves{" "}
        <select className="inline" value={l.movement} onChange={(e) => edit((x) => (x.movement = e.target.value as Layer["movement"]))}>
          {Object.entries(MOVEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        , sits{" "}
        <select
          className="inline"
          value={String(REGISTER_CHOICES.find((c) => c.label === registerLabel(l))?.value)}
          onChange={(e) =>
            edit((x) => {
              const [lo, hi] = String(e.target.value).split("-").map(Number);
              x.register = { low: lo, high: hi };
            })
          }
        >
          {REGISTER_CHOICES.map((c) => (
            <option key={c.label} value={String(c.value)}>
              {c.label}
            </option>
          ))}
        </select>{" "}
        and{" "}
        <select
          className="inline"
          value={relValue}
          onChange={(e) =>
            edit((x) => {
              if (e.target.value === "independent") x.relation = { type: "independent", target: null };
              else {
                const [type, target] = e.target.value.split(":");
                x.relation = { type: type as Layer["relation"]["type"], target };
              }
            })
          }
        >
          <option value="independent">plays independently</option>
          {others.map((o) =>
            (["answers", "follows", "avoids", "leads"] as const).map((t) => (
              <option key={`${t}:${o.id}`} value={`${t}:${o.id}`}>
                {RELATION_LABEL[t]} {o.name}
              </option>
            )),
          )}
        </select>
        {advanced && (
          <>
            , through{" "}
            <select className="inline" value={l.fx} onChange={(e) => edit((x) => (x.fx = e.target.value as Fx))}>
              {(Object.keys(FX_LABEL) as Fx[]).map((f) => (
                <option key={f} value={f}>
                  {FX_LABEL[f]}
                </option>
              ))}
            </select>
          </>
        )}
        {advanced && <>, at </>}
        {advanced && <select className="inline" value={String(l.speed)} onChange={(e) => edit((x) => (x.speed = Number(e.target.value)))}>
          {SPEEDS.map((s) => (
            <option key={s.value} value={String(s.value)}>
              {s.label}
            </option>
          ))}
          {!SPEEDS.some((s) => s.value === l.speed) && <option value={String(l.speed)}>{l.speed}× speed</option>}
        </select>}
        .
      </div>
      {open && (
        <div className="layer-details">
          <Slider label="Volume" value={l.volume} min={0} max={1} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((x) => (x.volume = v))} />
          <Slider label="Position" value={l.pan} min={-1} max={1} step={0.05} show={(v) => (Math.abs(v) < 0.05 ? "centre" : v < 0 ? `${Math.round(-v * 100)}% left` : `${Math.round(v * 100)}% right`)} onChange={(v) => edit((x) => (x.pan = v))} />
          <Slider label="Activity" value={l.activity} min={0} max={1} step={0.01} show={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((x) => (x.activity = v))} />
          {l.role !== "drums" && (
            <>
              <div className="detail-row">
                <span>Range</span>
                <span className="row" style={{ gap: 4 }}>
                  <select className="inline" value={l.register.low} onChange={(e) => edit((x) => (x.register = { low: Math.min(Number(e.target.value), x.register.high), high: x.register.high }))}>
                    {OCTAVES.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  to
                  <select className="inline" value={l.register.high} onChange={(e) => edit((x) => (x.register = { low: x.register.low, high: Math.max(Number(e.target.value), x.register.low) }))}>
                    {OCTAVES.map((o) => (
                      <option key={o.v} value={o.v}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
              <Slider
                label="Shortest note"
                value={l.durations.min}
                min={0.05}
                max={20}
                step={0.05}
                log
                show={(v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} s`}
                onChange={(v) => edit((x) => (x.durations = { min: v, max: Math.max(v, x.durations.max) }))}
              />
              <Slider
                label="Longest note"
                value={l.durations.max}
                min={0.1}
                max={30}
                step={0.05}
                log
                show={(v) => `${v < 1 ? v.toFixed(2) : v.toFixed(1)} s`}
                onChange={(v) => edit((x) => (x.durations = { min: Math.min(v, x.durations.min), max: v }))}
              />
            </>
          )}
          <div className="row mt">
            <button
              className="btn small"
              disabled={config.layers.length >= 6}
              onClick={() =>
                update((c) => {
                  const src = c.layers.find((x) => x.id === l.id);
                  if (src) c.layers.push({ ...structuredClone(src), id: `${src.id}-copy-${Math.random().toString(36).slice(2, 5)}`, name: `${src.name} (copy)`, pan: Math.max(-1, Math.min(1, -src.pan || 0.3)) });
                })
              }
            >
              Duplicate
            </button>
          </div>
        </div>
      )}
      {advanced && <button className="btn ghost small" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setShowTheme((s) => !s)}>
        {showTheme ? "▾" : "▸"} Melody{l.theme ? ` · ${l.theme.steps.filter((x) => x !== null).length} notes` : " · none (improvises)"}
      </button>}
      {advanced && showTheme && <ThemeEditor layer={l} color={color} onChange={(t) => edit((x) => (x.theme = t))} onHear={onHear} canHear={playing && l.enabled} />}
    </div>
  );
}

const SPEEDS = [
  { label: "quarter speed", value: 0.25 },
  { label: "half speed", value: 0.5 },
  { label: "¾ speed", value: 0.75 },
  { label: "normal speed", value: 1 },
  { label: "1½× speed", value: 1.5 },
  { label: "double speed", value: 2 },
  { label: "triple speed", value: 3 },
];

const OCTAVES = [
  { v: 1, label: "very low" },
  { v: 2, label: "low" },
  { v: 3, label: "lower-middle" },
  { v: 4, label: "middle" },
  { v: 5, label: "upper-middle" },
  { v: 6, label: "high" },
  { v: 7, label: "very high" },
];

/** A labelled slider; `log` spreads short values out for note lengths. */
function Slider({
  label,
  value,
  min,
  max,
  step,
  show,
  onChange,
  log,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
  onChange: (v: number) => void;
  log?: boolean;
}) {
  const toPos = (v: number) => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min));
  const fromPos = (p: number) => (log ? min * Math.pow(max / min, p) : min + p * (max - min));
  const pos = toPos(value);
  return (
    <div className="detail-row">
      <span>{label}</span>
      <span className="detail-ctl">
        <input
          type="range"
          min={0}
          max={1}
          step={log ? 0.005 : step / (max - min)}
          value={pos}
          style={fill(pos)}
          onChange={(e) => onChange(Math.round(fromPos(Number(e.target.value)) / step) * step)}
          aria-label={label}
        />
        <small className="mono">{show(value)}</small>
      </span>
    </div>
  );
}
