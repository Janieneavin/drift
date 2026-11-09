"use client";

import type { ArcShape, DriftConfig } from "@/lib/schema";
import type { Snapshot } from "@/lib/engine/Engine";
import { fill } from "@/lib/ui";

const SHAPES: { shape: ArcShape; label: string; hint: string }[] = [
  { shape: "off", label: "Steady", hint: "no overall shape" },
  { shape: "build", label: "Build", hint: "grows and stays full" },
  { shape: "buildRelease", label: "Climax", hint: "builds, peaks, lets go" },
  { shape: "waves", label: "Waves", hint: "slow swells" },
];

/** The piece's shape over time: layers accumulate, brightness and level swell. */
export default function ArcPanel({ config, update, snapshot }: { config: DriftConfig; update: (fn: (c: DriftConfig) => void) => void; snapshot: Snapshot | null }) {
  const arc = config.arc;
  const live = snapshot?.arc;
  // a small drawing of the curve, with a marker for "now"
  const curve = (x: number) => {
    switch (arc.shape) {
      case "build":
        return 0.12 + 0.88 * (x * x * (3 - 2 * x));
      case "buildRelease": {
        const s = (t: number) => t * t * (3 - 2 * t);
        return x < 0.72 ? 0.1 + 0.9 * Math.pow(s(x / 0.72), 1.3) : 0.1 + 0.9 * (1 - s((x - 0.72) / 0.28));
      }
      case "waves":
        return 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(2 * Math.PI * x));
      default:
        return 0.6;
    }
  };
  const pts = Array.from({ length: 41 }, (_, i) => `${(i / 40) * 100},${30 - curve(i / 40) * 26}`).join(" ");

  return (
    <div className="section">
      <p className="label">Shape over time</p>
      <div className="seg four">
        {SHAPES.map((s) => (
          <button key={s.shape} className={arc.shape === s.shape ? "on" : ""} onClick={() => update((c) => (c.arc.shape = s.shape))} title={s.hint}>
            {s.label}
          </button>
        ))}
      </div>
      {arc.shape !== "off" && (
        <>
          <svg className="arc-curve" viewBox="0 0 100 32" preserveAspectRatio="none">
            <polyline points={pts} fill="none" stroke="rgba(169,199,255,0.8)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
            {live && <line x1={live.progress * 100} x2={live.progress * 100} y1="0" y2="32" stroke="rgba(255,211,161,0.9)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="row">
            <span className="hint" style={{ margin: 0, flex: 1 }}>
              {arc.shape === "build" ? "Grows over" : arc.shape === "waves" ? "Each wave lasts" : "One full arc lasts"}
            </span>
            <input
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={arc.minutes}
              style={{ ...fill(arc.minutes, 1, 20), width: 120 }}
              onChange={(e) => update((c) => (c.arc.minutes = Number(e.target.value)))}
            />
            <small className="mono" style={{ width: 52, textAlign: "right" }}>
              {arc.minutes} min
            </small>
          </div>
          <p className="hint" style={{ marginTop: 6 }}>
            Layers join one by one in the order listed below; brightness, loudness and density rise with the curve.
            {live ? ` Right now: ${Math.round(live.intensity * 100)}% intensity.` : ""}
          </p>
        </>
      )}
    </div>
  );
}
