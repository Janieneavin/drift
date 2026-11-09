"use client";

import type { DriftConfig } from "@/lib/schema";
import { chordLabel, scaleOf } from "@/lib/music";

const COMMON: { label: string; degrees: number[] }[] = [
  { label: "Anthem  I – V – vi – IV", degrees: [0, 4, 5, 3] },
  { label: "Bittersweet  vi – IV – I – V", degrees: [5, 3, 0, 4] },
  { label: "Lift  I – IV – vi – V", degrees: [0, 3, 5, 4] },
  { label: "Open  I – IV", degrees: [0, 3] },
  { label: "Drone  I", degrees: [0] },
  { label: "Descending  I – vii – vi – V", degrees: [0, 6, 5, 4] },
];

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  currentIndex: number;
}

/** Choose a repeating chord progression, or let the harmony wander. */
export default function ProgressionEditor({ config, update, currentIndex }: Props) {
  const h = config.harmony;
  const scale = scaleOf(h);
  const prog = h.progression;
  const degreeCount = Math.min(7, scale.length);

  return (
    <div className="ctl">
      <div className="ctl-head">
        <span>Chords</span>
        <small>{prog ? "a repeating progression" : "wander freely"}</small>
      </div>
      <div className="seg">
        <button className={!prog ? "on" : ""} onClick={() => update((c) => (c.harmony.progression = null))}>
          Wander
        </button>
        <button className={prog ? "on" : ""} onClick={() => update((c) => (c.harmony.progression = c.harmony.progression ?? { degrees: [0, 4, 5, 3], bars: 2 }))}>
          Repeat a progression
        </button>
      </div>
      {prog && (
        <>
          <div className="chords">
            {prog.degrees.map((deg, i) => {
              const lbl = chordLabel(h.root, scale, deg);
              return (
                <div key={i} className={`chord ${i === currentIndex ? "now" : ""}`}>
                  <select
                    value={deg}
                    onChange={(e) =>
                      update((c) => {
                        if (c.harmony.progression) c.harmony.progression.degrees[i] = Number(e.target.value);
                      })
                    }
                    aria-label={`Chord ${i + 1}`}
                  >
                    {Array.from({ length: degreeCount }, (_, d) => {
                      const l = chordLabel(h.root, scale, d);
                      return (
                        <option key={d} value={d}>
                          {l.numeral} · {l.name}
                        </option>
                      );
                    })}
                  </select>
                  <b>{lbl.numeral}</b>
                  <small>{lbl.name}</small>
                  {prog.degrees.length > 1 && (
                    <button
                      className="x"
                      title="Remove this chord"
                      onClick={() =>
                        update((c) => {
                          if (c.harmony.progression) c.harmony.progression.degrees.splice(i, 1);
                        })
                      }
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {prog.degrees.length < 8 && (
              <button
                className="chord add"
                onClick={() =>
                  update((c) => {
                    if (c.harmony.progression) c.harmony.progression.degrees.push(0);
                  })
                }
              >
                +
              </button>
            )}
          </div>
          <div className="row wrap mt">
            <span className="hint" style={{ margin: 0 }}>Each chord lasts</span>
            <select className="inline" value={String(prog.bars)} onChange={(e) => update((c) => c.harmony.progression && (c.harmony.progression.bars = Number(e.target.value)))}>
              {[0.5, 1, 2, 4, 8].map((b) => (
                <option key={b} value={String(b)}>
                  {b === 0.5 ? "half a bar" : `${b} bar${b === 1 ? "" : "s"}`}
                </option>
              ))}
            </select>
          </div>
          <div className="chips">
            {COMMON.map((p) => (
              <button key={p.label} className="chip" onClick={() => update((c) => c.harmony.progression && (c.harmony.progression.degrees = [...p.degrees]))}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
