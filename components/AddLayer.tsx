"use client";

import { useState } from "react";
import type { Instrument, Layer } from "@/lib/schema";
import { uid } from "@/lib/schema";
import { INSTRUMENT_GROUPS, INSTRUMENT_LABEL, layer as makeLayer, roleFor } from "@/lib/presets";

const ROLES: { role: Layer["role"]; label: string; hint: string }[] = [
  { role: "melody", label: "Melody", hint: "phrases in a learned style" },
  { role: "bells", label: "Pulse", hint: "the repeating pattern" },
  { role: "texture", label: "Interlock", hint: "fills the pulse's gaps" },
  { role: "pad", label: "Pad", hint: "long, held chords" },
  { role: "bass", label: "Bass", hint: "low notes underneath" },
  { role: "drums", label: "Drums", hint: "a rhythm on the beat" },
];

const SOUND_HINT: Record<Instrument, string> = {
  glass: "clear, glassy",
  felt: "soft piano",
  bell: "ringing bells",
  choir: "breathy voices",
  strings: "warm string wash",
  air: "hollow wind",
  sub: "deep hum",
  pluck: "short and delicate",
  violin: "bowed, singing",
  cello: "deep bowed",
  flute: "pure and breathy",
  horn: "warm brass",
  harp: "plucked strings",
  supersaw: "wide synth",
  acid: "squelchy bass",
  chip: "retro square",
  drums: "drum machine",
  organ: "warm organ",
  piano: "real grand piano",
  rhodes: "warm electric piano",
  marimba: "soft mallets",
};

/** Instruments that suit each role best are shown first. */
const SUGGEST: Record<Layer["role"], Instrument[]> = {
  melody: ["violin", "flute", "cello", "piano", "supersaw", "horn", "glass"],
  pad: ["strings", "choir", "organ", "air", "supersaw", "horn"],
  bass: ["sub", "cello", "acid"],
  bells: ["piano", "harp", "glass", "chip", "marimba"],
  texture: ["pluck", "harp", "piano", "flute", "supersaw"],
  drums: ["drums"],
};

const DEFAULT_REGISTER: Partial<Record<Instrument, { low: number; high: number }>> = {
  cello: { low: 2, high: 3 },
  acid: { low: 2, high: 3 },
  violin: { low: 4, high: 6 },
  flute: { low: 5, high: 6 },
  horn: { low: 3, high: 4 },
  harp: { low: 3, high: 5 },
};

interface Props {
  count: number;
  onAdd: (layer: Layer) => void;
  onClose: () => void;
}

/** Build a layer step by step: what it does, what it sounds like, its name. */
export default function AddLayer({ count, onAdd, onClose }: Props) {
  const [role, setRole] = useState<Layer["role"]>("melody");
  const [inst, setInst] = useState<Instrument>("glass");
  const [name, setName] = useState("");
  const full = count >= 6;

  const pickRole = (r: Layer["role"]) => {
    setRole(r);
    setInst(SUGGEST[r][0]);
  };

  const add = () => {
    const finalRole = inst === "drums" ? "drums" : role === "drums" ? roleFor(inst) : role;
    const l = makeLayer({
      id: uid("layer"),
      name: name.trim() || (inst === "drums" ? "Drum machine" : `${INSTRUMENT_LABEL[inst][0].toUpperCase()}${INSTRUMENT_LABEL[inst].slice(1)} ${ROLES.find((r) => r.role === finalRole)?.label.toLowerCase() ?? ""}`.trim()),
      role: finalRole,
      instrument: inst,
      ...(DEFAULT_REGISTER[inst] ? { register: DEFAULT_REGISTER[inst] } : {}),
      pan: Math.round((Math.random() - 0.5) * 60) / 100,
    });
    onAdd(l);
  };

  const ordered = (items: Instrument[]) => [...items].sort((a, b) => Number(SUGGEST[role].includes(b)) - Number(SUGGEST[role].includes(a)));

  return (
    <div className="add-layer">
      <div className="row">
        <b style={{ flex: 1, fontWeight: 500 }}>New layer</b>
        <button className="btn ghost small" onClick={onClose}>
          Cancel
        </button>
      </div>

      <p className="step">1 · What does it do?</p>
      <div className="role-grid">
        {ROLES.map((r) => (
          <button key={r.role} className={`role-opt ${role === r.role ? "on" : ""}`} onClick={() => pickRole(r.role)}>
            <span>{r.label}</span>
            <small>{r.hint}</small>
          </button>
        ))}
      </div>

      <p className="step">2 · What does it sound like?</p>
      {role === "drums" ? (
        <div className="inst-grid">
          <button className="inst-opt on">
            <span>{INSTRUMENT_LABEL.drums}</span>
            <small>{SOUND_HINT.drums}</small>
          </button>
        </div>
      ) : (
        INSTRUMENT_GROUPS.map((g) => {
          const items = ordered(g.items.filter((i) => i !== "drums"));
          return (
            <div key={g.label}>
              <p className="group-label">{g.label}</p>
              <div className="inst-grid">
                {items.map((i) => (
                  <button key={i} className={`inst-opt ${inst === i ? "on" : ""} ${SUGGEST[role].includes(i) ? "suggested" : ""}`} onClick={() => setInst(i)}>
                    <span>{INSTRUMENT_LABEL[i]}</span>
                    <small>{SOUND_HINT[i]}</small>
                  </button>
                ))}
              </div>
            </div>
          );
        })
      )}

      <p className="step">3 · Name it (optional)</p>
      <input className="input" value={name} placeholder={`e.g. “${role === "drums" ? "Heartbeat" : role === "pad" ? "Fog" : role === "bass" ? "Undertow" : "Night bird"}”`} onChange={(e) => setName(e.target.value)} />

      <div className="row mt end">
        {full && <span className="hint" style={{ margin: 0, flex: 1 }}>Six layers is the maximum — remove one first.</span>}
        <button className="btn primary small" onClick={add} disabled={full}>
          Add layer
        </button>
      </div>
    </div>
  );
}
