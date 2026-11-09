"use client";

import { useState } from "react";
import type { DriftConfig, RuleType } from "@/lib/schema";
import { RULE_TYPES } from "@/lib/schema";
import { RULE_META, makeRule, ruleSentence } from "@/lib/rules";
import { fill } from "@/lib/ui";
import type { Snapshot } from "@/lib/engine/Engine";
import type { InterpretResult } from "@/lib/interpret/client";

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  snapshot: Snapshot | null;
  pulses: Record<string, number>;
  onHover: (id: string | null) => void;
  onAsk: (text: string) => Promise<void>;
  busy: boolean;
  pending: { text: string; result: InterpretResult } | null;
  onApplyPending: () => void;
  onCancelPending: () => void;
}

const EXAMPLES = [
  "Never let more than two sounds play at once",
  "Every new sound should be quieter than the previous one",
  "The melodies should gradually drift apart",
  "Introduce a new instrument every two minutes",
  "Whenever one melody stops, another should begin",
  "The music should gradually become less recognizable",
];

export default function RulesPanel({ config, update, snapshot, pulses, onHover, onAsk, busy, pending, onApplyPending, onCancelPending }: Props) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState<RuleType | "">("");
  const now = typeof performance !== "undefined" ? performance.now() : 0;

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    await onAsk(t);
    setText("");
  };

  return (
    <div className="section">
      <h2 className="q">How should it behave?</h2>
      <p className="hint">Set rules the music must keep following — about how layers interact, what is allowed, how it changes over time.</p>
      <textarea
        className="input"
        rows={2}
        placeholder="e.g. Whenever one melody stops, another should begin"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="row mt">
        <select className="inline" value={adding} onChange={(e) => setAdding(e.target.value as RuleType | "")} style={{ flex: 1 }}>
          <option value="">…or pick a rule</option>
          {RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {RULE_META[t].title}
            </option>
          ))}
        </select>
        {adding && (
          <button
            className="btn small"
            onClick={() => {
              const t = adding;
              update((c) => {
                c.rules = c.rules.filter((r) => r.type !== t);
                c.rules.push(makeRule(t));
              });
              setAdding("");
            }}
          >
            Add
          </button>
        )}
        <button className="btn primary small" onClick={submit} disabled={busy || !text.trim()}>
          {busy ? "…" : "Interpret"}
        </button>
      </div>
      {pending && (
        <div className="preview-card">
          <div className="row">
            <b style={{ flex: 1, fontWeight: 500 }}>Interpreted as</b>
            <span className={`src ${pending.result.source}`}>{pending.result.source === "ai" ? "AI" : "offline"}</span>
          </div>
          <div className="rule-said">you said: “{pending.text}”</div>
          {pending.result.patch.addRules.length > 0 ? (
            <ul>
              {pending.result.patch.addRules.map((r, i) => {
                const replaces = config.rules.find((x) => x.type === r.type);
                return (
                  <li key={i}>
                    {ruleSentence(makeRule(r.type, r.value ?? undefined))}
                    {replaces && <span className="hint"> (replaces “{ruleSentence(replaces)}”)</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint" style={{ margin: "6px 0" }}>No rule I can run.</p>
          )}
          {pending.result.patch.unsupported.map((u, i) => (
            <div className="unsupported" key={i}>
              Can’t do “{u.request}”: {u.reason}
            </div>
          ))}
          <div className="row mt end">
            <button className="btn ghost small" onClick={onCancelPending}>
              Cancel
            </button>
            <button className="btn primary small" onClick={onApplyPending} disabled={!pending.result.patch.addRules.length && !pending.result.patch.ruleEdits.length}>
              Apply
            </button>
          </div>
        </div>
      )}
      <div className="chips">
        {EXAMPLES.map((ex) => (
          <button key={ex} className="chip" onClick={() => setText(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {config.rules.length > 0 && <p className="label" style={{ marginTop: 16 }}>Active rules · hover to see them on screen</p>}
      {config.rules.map((r) => {
        const m = RULE_META[r.type];
        const s = snapshot?.rules[r.id];
        const pulsing = pulses[r.id] && now - pulses[r.id] < 450;
        const timed = ["driftApart", "erode", "thinHighs"].includes(r.type);
        return (
          <div key={r.id} className={`rule-card ${r.enabled ? "" : "off"} ${pulsing ? "pulse" : ""}`} onMouseEnter={() => onHover(r.id)} onMouseLeave={() => onHover(null)}>
            <div className="rule-title">
              <span>{m.title}</span>
              <button
                className={`toggle ${r.enabled ? "on" : ""}`}
                title={r.enabled ? "Switch off to hear the difference" : "Switch on"}
                onClick={() =>
                  update((c) => {
                    const t = c.rules.find((x) => x.id === r.id);
                    if (t) t.enabled = !t.enabled;
                  })
                }
              />
              <button className="x" title="Remove rule" onClick={() => update((c) => void (c.rules = c.rules.filter((x) => x.id !== r.id)))}>
                ×
              </button>
            </div>
            <div className="rule-sentence">{ruleSentence(r)}</div>
            {r.text && r.text.toLowerCase() !== ruleSentence(r).toLowerCase() && <div className="rule-said">you said: “{r.text}”</div>}
            {m.max > m.min && (
              <input
                type="range"
                className="mini"
                min={m.min}
                max={m.max}
                step={m.step}
                value={r.value}
                style={fill(r.value, m.min, m.max)}
                onChange={(e) =>
                  update((c) => {
                    const t = c.rules.find((x) => x.id === r.id);
                    if (t) t.value = Number(e.target.value);
                  })
                }
              />
            )}
            {timed && snapshot?.playing && (
              <div className="progress" title="How far this rule has progressed">
                <div style={{ width: `${Math.round((s?.progress ?? 0) * 100)}%` }} />
              </div>
            )}
            <div className="rule-meta">
              Hear: {m.hear}
              <br />
              See: {m.see}
              {s && s.fired > 0 && (
                <>
                  <br />
                  Acted {s.fired} time{s.fired === 1 ? "" : "s"} this performance.
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
