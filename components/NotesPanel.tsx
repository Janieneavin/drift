"use client";

import type { DriftConfig, Mode } from "@/lib/schema";
import { MODES, ROOTS } from "@/lib/schema";
import { SCALES, pcName, rootPc, scaleOf } from "@/lib/music";
import { moodLabel } from "@/lib/describe";
import { fill } from "@/lib/ui";
import ProgressionEditor from "./ProgressionEditor";

const MODE_NAME: Record<Mode, string> = {
  major: "Major (Ionian)",
  lydian: "Lydian",
  mixolydian: "Mixolydian",
  dorian: "Dorian",
  minor: "Natural minor (Aeolian)",
  phrygian: "Phrygian",
  pentatonic: "Major pentatonic",
  minorPentatonic: "Minor pentatonic",
  wholeTone: "Whole tone",
  japanese: "In (Japanese)",
};

interface Props {
  config: DriftConfig;
  update: (fn: (c: DriftConfig) => void) => void;
  chordIndex: number;
}

/** Direct control over key, scale, tempo and pulse. */
export default function NotesPanel({ config, update, chordIndex }: Props) {
  const h = config.harmony;
  const root = rootPc(h.root);
  const scale = new Set(scaleOf(h));
  const custom = h.customScale !== null;

  const toggleNote = (interval: number) => {
    if (interval === 0) return; // the home note always stays
    update((c) => {
      const cur = new Set(scaleOf(c.harmony));
      if (cur.has(interval)) cur.delete(interval);
      else cur.add(interval);
      if (cur.size < 3) return; // a scale needs at least three notes
      c.harmony.customScale = [...cur].sort((a, b) => a - b);
    });
  };

  return (
    <div className="section">
      <p className="label">Notes &amp; time</p>

      <div className="ctl">
        <div className="ctl-head">
          <span>Key</span>
          <small>the home note everything returns to</small>
        </div>
        <div className="keys">
          {ROOTS.map((r, i) => (
            <button key={r} className={`key ${h.root === r ? "on" : ""}`} onClick={() => update((c) => (c.harmony.root = r))}>
              {pcName(i)}
            </button>
          ))}
        </div>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <span>Tonality</span>
          <small>{custom ? "your own scale" : moodLabel(h.mode)}</small>
        </div>
        <select
          className="input"
          value={custom ? "custom" : h.mode}
          onChange={(e) =>
            update((c) => {
              if (e.target.value === "custom") return;
              c.harmony.mode = e.target.value as Mode;
              c.harmony.customScale = null;
            })
          }
        >
          {custom && <option value="custom">Custom scale</option>}
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_NAME[m]} — {moodLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <span>Notes in use</span>
          <small>{scale.size} of 12 · tap to add or remove</small>
        </div>
        <div className="piano">
          {Array.from({ length: 12 }, (_, i) => {
            const pc = (root + i) % 12;
            const black = [1, 3, 6, 8, 10].includes(pc);
            return (
              <button
                key={i}
                className={`pk ${black ? "black" : ""} ${scale.has(i) ? "on" : ""} ${i === 0 ? "home" : ""}`}
                onClick={() => toggleNote(i)}
                title={i === 0 ? "The home note is always in the scale" : scale.has(i) ? "Remove this note" : "Add this note"}
              >
                {pcName(pc)}
              </button>
            );
          })}
        </div>
        {custom && (
          <div className="row mt">
            <span className="hint" style={{ margin: 0, flex: 1 }}>
              Custom scale — melodies, chords and harmony all use only these notes.
            </span>
            <button className="btn small" onClick={() => update((c) => (c.harmony.customScale = null))}>
              Back to {MODE_NAME[h.mode]}
            </button>
          </div>
        )}
        {!custom && (
          <p className="hint" style={{ margin: "6px 0 0" }}>
            {MODE_NAME[h.mode]} on {pcName(root)}: {SCALES[h.mode].map((s) => pcName(root + s)).join(" · ")}
          </p>
        )}
      </div>

      <ProgressionEditor config={config} update={update} currentIndex={chordIndex} />

      <div className="ctl">
        <label className="row" style={{ cursor: "pointer" }}>
          <button
            className={`toggle ${h.chromatic ? "on" : ""}`}
            onClick={() => update((c) => (c.harmony.chromatic = !c.harmony.chromatic))}
            aria-label="Allow notes outside the scale"
          />
          <span style={{ flex: 1 }}>Allow notes outside the scale</span>
        </label>
        <p className="hint" style={{ margin: "4px 0 0" }}>
          {h.chromatic
            ? "Occasionally a stray note from outside the scale appears, then resolves home."
            : "Strict: every note comes from the notes above."}
        </p>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <span>Tempo</span>
          <small>
            <b className="mono">{config.tempo.bpm}</b> BPM
          </small>
        </div>
        <div className="row">
          <input
            type="range"
            className="wide"
            min={30}
            max={160}
            step={1}
            value={config.tempo.bpm}
            style={fill(config.tempo.bpm, 30, 160)}
            onChange={(e) => update((c) => (c.tempo.bpm = Number(e.target.value)))}
          />
          <input
            className="input mono"
            style={{ width: 64, padding: "3px 6px" }}
            type="number"
            min={30}
            max={160}
            value={config.tempo.bpm}
            onChange={(e) => update((c) => (c.tempo.bpm = Math.max(30, Math.min(160, Number(e.target.value) || 30))))}
          />
        </div>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <span>Pulse</span>
          <small>{config.tempo.lock < 0.2 ? "free-floating" : config.tempo.lock < 0.5 ? "loosely on a beat" : config.tempo.lock < 0.8 ? "mostly on the beat" : "locked to the beat"}</small>
        </div>
        <input type="range" className="wide" min={0} max={1} step={0.01} value={config.tempo.lock} style={fill(config.tempo.lock)} onChange={(e) => update((c) => (c.tempo.lock = Number(e.target.value)))} />
        <div className="scale-ends">
          <span>free</span>
          <span>on the beat</span>
        </div>
      </div>

      <div className="ctl">
        <div className="ctl-head">
          <span>Swing</span>
          <small>{config.tempo.swing < 0.05 ? "straight" : config.tempo.swing < 0.4 ? "a little shuffle" : config.tempo.swing < 0.75 ? "swung" : "heavy shuffle"}</small>
        </div>
        <input type="range" className="wide" min={0} max={1} step={0.01} value={config.tempo.swing} style={fill(config.tempo.swing)} onChange={(e) => update((c) => (c.tempo.swing = Number(e.target.value)))} />
      </div>
    </div>
  );
}
