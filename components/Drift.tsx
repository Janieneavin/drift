"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Engine, EngineEvent, Snapshot } from "@/lib/engine/Engine";
import { type Composition, type DriftConfig, sanitizeConfig } from "@/lib/schema";
import { CITY_4AM, blankConfig, layer as makeLayer, randomConfig } from "@/lib/presets";
import { uid } from "@/lib/schema";
import { applyPatch } from "@/lib/interpret/patch";
import { type InterpretResult, aiAvailable, interpret } from "@/lib/interpret/client";
import type { InterpretMode } from "@/lib/interpret/offline";
import { deleteComposition, exportSystem, importSystem, listCompositions, saveComposition } from "@/lib/storage";
import { blobToWav } from "@/lib/wav";
import { describeChange } from "@/lib/history";
import { fill } from "@/lib/ui";

interface HistoryEntry {
  config: DriftConfig;
  label: string;
  at: number;
  pendingLabelKey: string;
}
/** Two labels from the same slider drag look alike once the numbers go. */
const labelKey = (label: string) => label.replace(/[\d%→.]+/g, "");
import Visualizer from "./Visualizer";
import { ComposeIcon, HistoryIcon, ImmersiveIcon, LibraryIcon, RedoIcon, SystemIcon, UndoIcon } from "./Icons";
import ShaderBackdrop from "./ShaderBackdrop";
import SystemPanel from "./SystemPanel";
import RulesPanel from "./RulesPanel";
import Library, { type Recording } from "./Library";

interface LogItem {
  id: number;
  mode: InterpretMode;
  you: string;
  reply: string;
  source: "ai" | "offline";
  notice?: string;
  unsupported: { request: string; reason: string }[];
}

const ATMOSPHERE_EXAMPLES = [
  "An empty city at 4 a.m., cold and nostalgic.",
  "Sunlight filtering through an abandoned cathedral.",
  "A warm summer evening that feels slightly unsettling.",
  "Floating underwater with distant sounds above.",
];
const DIRECT_EXAMPLES = ["Make it more melancholic", "Introduce something unexpected", "Remove the higher notes", "Make the atmosphere feel warmer", "Keep everything the same, but make it slower"];

const SURPRISE_TEXT: Record<string, string> = {
  lowSwell: "a deep swell rises",
  highShimmer: "a shimmer of high bells",
  cluster: "a soft knot of close notes",
  noiseGust: "a gust of air passes",
  foreignNote: "a stray note finds its way home",
};

const MAX_RECORD_SECONDS = 180;

export default function Drift() {
  const [config, setConfig] = useState<DriftConfig>(CITY_4AM);
  const configRef = useRef(config);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ai, setAi] = useState<"checking" | "ai" | "offline">("checking");
  const [busy, setBusy] = useState<InterpretMode | null>(null);
  const [atmo, setAtmo] = useState(CITY_4AM.atmosphere);
  const [direct, setDirect] = useState("");
  const [log, setLog] = useState<LogItem[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [ticker, setTicker] = useState<{ id: number; text: string }[]>([]);
  const [hoveredRule, setHoveredRule] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(true);
  const [showSystem, setShowSystem] = useState(true);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [uiAwake, setUiAwake] = useState(true);
  const [backdropOk, setBackdropOk] = useState(true);
  const onNoBackdrop = useCallback(() => setBackdropOk(false), []);
  const enterImmersive = useCallback(() => {
    setImmersive(true);
    setShowLibrary(false);
    setShowHistory(false);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  const exitImmersive = useCallback(() => {
    setImmersive(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => undefined);
  }, []);

  const [lastMarkov, setLastMarkov] = useState<{ from: number; to: number; at: number } | null>(null);
  const [pendingRule, setPendingRule] = useState<{ text: string; result: InterpretResult } | null>(null);
  const [advanced, setAdvanced] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("drift.mode");
      if (v) setAdvanced(v === "advanced");
    } catch {
      /* ignore */
    }
  }, []);
  const toggleMode = () =>
    setAdvanced((a) => {
      try {
        localStorage.setItem("drift.mode", a ? "simple" : "advanced");
      } catch {
        /* ignore */
      }
      return !a;
    });
  const [compositions, setCompositions] = useState<Composition[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recording, setRecording] = useState<number | null>(null);
  const [recTick, setRecTick] = useState(0);
  const logId = useRef(0);

  /* ---------------- engine lifecycle ---------------- */

  useEffect(() => {
    let alive = true;
    import("@/lib/engine/Engine").then(({ Engine }) => {
      if (!alive) return;
      const e = new Engine(configRef.current);
      // handy for inspecting the engine from the browser console
      (window as unknown as { drift?: unknown }).drift = e;
      setEngine(e);
    });
    aiAvailable().then((ok) => alive && setAi(ok ? "ai" : "offline"));
    setCompositions(listCompositions());
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setPlaying(engine?.isPlaying() ?? false);
    return () => engine?.dispose();
  }, [engine]);

  /* ---------------- undo / redo / history ---------------- */

  // past holds earlier systems (newest last), each with what changed after it
  const historyRef = useRef<{ past: HistoryEntry[]; future: HistoryEntry[] }>({ past: [], future: [] });
  const [, setHistoryTick] = useState(0);
  const bumpHistory = () => setHistoryTick((t) => t + 1);

  const applyConfig = useCallback(
    (next: DriftConfig, record = true) => {
      const prev = configRef.current;
      const clean = sanitizeConfig(next);
      if (JSON.stringify(prev) === JSON.stringify(clean)) return;
      if (record) {
        const h = historyRef.current;
        const label = describeChange(prev, clean);
        const last = h.past[h.past.length - 1];
        // dragging a slider makes one history step, not hundreds
        const sameGesture = last && last.pendingLabelKey === labelKey(label) && Date.now() - last.at < 1200;
        if (sameGesture) {
          last.label = describeChange(last.config, clean);
          last.at = Date.now();
        } else {
          h.past.push({ config: prev, label, at: Date.now(), pendingLabelKey: labelKey(label) });
          if (h.past.length > 80) h.past.shift();
        }
        h.future = [];
        bumpHistory();
      }
      configRef.current = clean;
      setConfig(clean);
      engine?.setConfig(clean);
    },
    [engine],
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    const entry = h.past.pop();
    if (!entry) return;
    h.future.push({ config: configRef.current, label: entry.label, at: Date.now(), pendingLabelKey: "" });
    applyConfig(entry.config, false);
    bumpHistory();
  }, [applyConfig]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const entry = h.future.pop();
    if (!entry) return;
    h.past.push({ config: configRef.current, label: entry.label, at: 0, pendingLabelKey: "" });
    applyConfig(entry.config, false);
    bumpHistory();
  }, [applyConfig]);

  /** Jump back to just before history step `index` (0 = oldest). */
  const restoreTo = useCallback(
    (index: number) => {
      const h = historyRef.current;
      while (h.past.length > index) {
        const entry = h.past.pop()!;
        h.future.push({ config: configRef.current, label: entry.label, at: Date.now(), pendingLabelKey: "" });
        configRef.current = entry.config;
      }
      applyConfig(configRef.current, false);
      setConfig(configRef.current);
      engine?.setConfig(configRef.current);
      bumpHistory();
    },
    [applyConfig, engine],
  );

  const update = useCallback(
    (fn: (c: DriftConfig) => void) => {
      const n = structuredClone(configRef.current);
      fn(n);
      applyConfig(n);
    },
    [applyConfig],
  );

  /* ---------------- events → pulses & ticker ---------------- */

  const say = useCallback((text: string) => {
    const id = Math.random();
    setTicker((t) => [...t.slice(-2), { id, text }]);
    setTimeout(() => setTicker((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (!engine) return;
    const lastSaid = new Map<string, number>();
    const throttle = (key: string, sec: number) => {
      const now = performance.now() / 1000;
      if (now - (lastSaid.get(key) ?? -999) < sec) return false;
      lastSaid.set(key, now);
      return true;
    };
    const nameOf = (id: string) => configRef.current.layers.find((l) => l.id === id)?.name ?? engine.snapshot().layers.find((l) => l.id === id)?.name ?? "a voice";
    const handle = (e: EngineEvent) => {
      const delay = Math.max(0, (e.time - engine.now()) * 1000);
      setTimeout(() => {
        switch (e.kind) {
          case "ruleFired":
            setPulses((p) => ({ ...p, [e.ruleId]: performance.now() }));
            break;
          case "markov":
            setLastMarkov({ from: e.from, to: e.to, at: performance.now() });
            break;
          case "surprise":
            say(SURPRISE_TEXT[e.type]);
            break;
          case "handoff":
            if (throttle("handoff", 4)) say(`${nameOf(e.from)} hands the melody to ${nameOf(e.to)}`);
            break;
          case "relation":
            if (throttle(`rel-${e.to}`, 14)) say(`${nameOf(e.to)} ${e.type} ${nameOf(e.from)}`);
            break;
          case "layerEnter":
            say(`${e.name} enters`);
            break;
          case "layerLeave":
            say(`${e.name} leaves to make room`);
            break;
          case "silence":
            if (throttle("silence", 20)) say("a pause");
            break;
        }
      }, delay);
    };
    return engine.on(handle);
  }, [engine, say]);

  // panels read a snapshot a few times a second
  useEffect(() => {
    if (!engine) return;
    const id = setInterval(() => setSnapshot(engine.snapshot()), 300);
    return () => clearInterval(id);
  }, [engine]);

  /* ---------------- transport ---------------- */

  const togglePlay = useCallback(async () => {
    if (!engine) return;
    if (engine.isPlaying()) {
      engine.stop();
      setPlaying(false);
    } else {
      engine.setConfig(configRef.current);
      await engine.start();
      setPlaying(true);
      setStarted(true);
    }
  }, [engine]);

  const restart = useCallback(async () => {
    if (!engine) return;
    engine.stop();
    setTimeout(async () => {
      await engine.start();
      setPlaying(true);
    }, 1900);
  }, [engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "Escape" && immersive) exitImmersive();
      if (e.key.toLowerCase() === "f" && !typing && !e.metaKey && !e.ctrlKey) {
        if (immersive) exitImmersive();
        else enterImmersive();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, undo, redo, immersive, enterImmersive, exitImmersive]);

  /* ---------------- language ---------------- */

  const ask = useCallback(
    async (mode: InterpretMode, text: string) => {
      setBusy(mode);
      try {
        const res = await interpret(mode, text, configRef.current);
        if (res.source === "offline") setAi("offline");
        // rules are shown as interpreted first; nothing changes until Apply
        if (mode === "rule") {
          setPendingRule({ text, result: res });
          return;
        }
        const { config: next } = applyPatch(configRef.current, res.patch);
        applyConfig(next);
        if (res.patch.triggerSurprise) engine?.surpriseNow();
        if (mode === "atmosphere") setAtmo(next.atmosphere);
        if (res.source === "offline") setAi("offline");
        setLog((l) => [
          { id: ++logId.current, mode, you: text, reply: res.patch.reply, source: res.source, notice: res.notice, unsupported: res.patch.unsupported },
          ...l.slice(0, 7),
        ]);
      } catch (err) {
        // the music keeps playing; just report what went wrong
        setLog((l) => [
          { id: ++logId.current, mode, you: text, reply: `Something went wrong applying that: ${err instanceof Error ? err.message : String(err)}`, source: "offline", unsupported: [] },
          ...l.slice(0, 7),
        ]);
      } finally {
        setBusy(null);
      }
    },
    [applyConfig, engine],
  );

  const applyPendingRule = useCallback(() => {
    const p = pendingRule;
    if (!p) return;
    const { config: next } = applyPatch(configRef.current, p.result.patch);
    applyConfig(next);
    setLog((l) => [
      { id: ++logId.current, mode: "rule", you: p.text, reply: p.result.patch.reply, source: p.result.source, notice: p.result.notice, unsupported: p.result.patch.unsupported },
      ...l.slice(0, 7),
    ]);
    setPendingRule(null);
  }, [pendingRule, applyConfig]);

  /* ---------------- library ---------------- */

  const save = (asNew: boolean) => {
    const comp = saveComposition(configRef.current, asNew ? undefined : currentId ?? undefined);
    setCurrentId(comp.id);
    setCompositions(listCompositions());
    say(`saved “${comp.config.name}”`);
  };

  const snapshot_ = () => {
    // the system plus the seed of the performance you're hearing
    const seed = engine?.isPlaying() ? engine.getSeed() : configRef.current.seed ?? Math.floor(Math.random() * 2 ** 31);
    const comp = saveComposition({ ...configRef.current, seed, name: `${configRef.current.name} · seed ${seed}` }, undefined, "snapshot");
    setCompositions(listCompositions());
    say(`snapshot saved (seed ${comp.config.seed})`);
  };

  const exportFile = () => {
    const url = URL.createObjectURL(exportSystem(configRef.current));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${configRef.current.name.replace(/[^\w-]+/g, "_") || "drift"}.drift.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const importFile = async (file: File) => {
    try {
      const c = await importSystem(file);
      open(c, null);
      say(`imported “${c.name}”`);
    } catch (err) {
      say(err instanceof Error ? err.message : "Couldn't import that file");
    }
  };

  const open = (c: DriftConfig, id: string | null) => {
    applyConfig(structuredClone(c));
    setAtmo(c.atmosphere);
    setCurrentId(id);
    setShowLibrary(false);
    say(`opened “${c.name}” — same system, a new performance`);
  };

  const randomize = () => {
    const c = randomConfig();
    applyConfig(c);
    setAtmo("");
    setCurrentId(null);
    say(`randomized: “${c.name}”`);
  };

  /* ---------------- recording ---------------- */

  const stopRecording = useCallback(async () => {
    if (!engine || recording === null) return;
    const started = recording;
    setRecording(null);
    const blob = await engine.stopRecording();
    if (!blob) return;
    const seconds = (performance.now() - started) / 1000;
    let url: string;
    let ext: Recording["ext"] = "wav";
    try {
      url = URL.createObjectURL(await blobToWav(blob));
    } catch {
      url = URL.createObjectURL(blob);
      ext = "webm";
    }
    setRecordings((r) => [{ id: String(Date.now()), name: `${configRef.current.name} — performance ${r.length + 1}`, url, seconds, seed: engine.getSeed(), ext }, ...r]);
    say("recording saved to the library");
  }, [engine, recording, say]);

  const toggleRecord = async () => {
    if (!engine) return;
    if (recording !== null) return stopRecording();
    if (!engine.isPlaying()) await togglePlay();
    engine.startRecording();
    setRecording(performance.now());
  };

  useEffect(() => {
    if (recording === null) return;
    const id = setInterval(() => {
      setRecTick((t) => t + 1);
      if ((performance.now() - recording) / 1000 > MAX_RECORD_SECONDS) stopRecording();
    }, 500);
    return () => clearInterval(id);
  }, [recording, stopRecording]);
  void recTick;

  /* ---------------- drums, any time ---------------- */

  const drumsOn = config.layers.some((l) => l.role === "drums" && l.enabled);
  const toggleDrums = () => {
    const existing = configRef.current.layers.find((l) => l.role === "drums");
    if (!existing && configRef.current.layers.length >= 6) {
      say("six layers is the maximum — remove one to add drums");
      return;
    }
    update((c) => {
      const d = c.layers.find((l) => l.role === "drums");
      if (d) d.enabled = !d.enabled;
      else c.layers.push(makeLayer({ id: uid("drums"), name: "Drum machine", role: "drums", instrument: "drums", activity: 0.4, volume: 0.45 }));
    });
    say(existing ? (existing.enabled ? "drums off" : "drums back on") : "drum machine added — tune it on its card (Edit: volume, activity)");
  };

  /* ---------------- immersive mode ---------------- */

  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) setImmersive(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  // in immersive mode the controls fade away until the mouse moves
  useEffect(() => {
    if (!immersive) {
      setUiAwake(true);
      return;
    }
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setUiAwake(true);
      clearTimeout(t);
      t = setTimeout(() => setUiAwake(false), 2500);
    };
    wake();
    window.addEventListener("mousemove", wake);
    window.addEventListener("touchstart", wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [immersive]);

  /* ---------------- render ---------------- */

  const slider = (label: string, hint: string, value: number, set: (c: DriftConfig, v: number) => void) => (
    <div className="macro">
      <div className="top">
        <b>{label}</b>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input type="range" min={0} max={1} step={0.01} value={value} style={fill(value)} onChange={(e) => update((c) => set(c, Number(e.target.value)))} aria-label={label} />
      <small>{hint}</small>
    </div>
  );
  const macro = (key: "density" | "evolution" | "unpredictability", label: string, hint: string) =>
    slider(label, hint, config.macro[key], (c, v) => (c.macro[key] = v));

  const insets = immersive ? { left: 0, right: 0 } : { left: showCompose ? 392 : 0, right: showSystem || showLibrary ? 396 : 0 };
  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const openX = vw - insets.left - insets.right > 320 ? (insets.left + (vw - insets.left - insets.right) / 2) / vw : 0.5;

  const recSeconds = recording !== null ? Math.floor((performance.now() - recording) / 1000) : 0;

  return (
    <div className={`app ${immersive ? "immersive" : ""} ${immersive && !uiAwake ? "asleep" : ""}`}>
      {backdropOk && <ShaderBackdrop engine={engine} openX={openX} onUnsupported={onNoBackdrop} />}
      <Visualizer engine={engine} config={config} hoveredRule={hoveredRule} insets={insets} backdrop={backdropOk} immersive={immersive} />

      {!started && (
        <div className="splash">
          <h1>DRIFT</h1>
          <p>An instrument for people who don&apos;t play instruments.</p>
          <p>You design the conditions. The music emerges, and never repeats.</p>
          <p className="atmo">“{config.atmosphere}”</p>
          <span className="cta">Press play — or the space bar — to begin</span>
        </div>
      )}

      <div className="topbar">
        <span className="wordmark">DRIFT</span>
        <input className="comp-name" value={config.name} onChange={(e) => update((c) => (c.name = e.target.value))} aria-label="Composition name" />
        <span className={`pill ${ai === "ai" ? "ai" : ai === "offline" ? "offline" : ""}`} title={ai === "offline" ? "No AI available: descriptions are interpreted by simple keyword matching" : "Claude interprets your words"}>
          {ai === "checking" ? "…" : ai === "ai" ? "AI interpreter" : "Offline interpreter (keyword fallback)"}
        </span>
        <div className="toolbar" title="Simple: plain-language controls. Advanced: key, scale, tempo, melodies, speeds and effects.">
          <button className={`icon-btn ${advanced ? "" : "active"}`} onClick={() => advanced && toggleMode()}>
            Simple
          </button>
          <button className={`icon-btn ${advanced ? "active" : ""}`} onClick={() => !advanced && toggleMode()}>
            Advanced
          </button>
        </div>
        <span className="spacer" />
        <div className="toolbar">
          <button className="icon-btn" onClick={undo} disabled={!historyRef.current.past.length} title={historyRef.current.past.length ? `Undo: ${historyRef.current.past[historyRef.current.past.length - 1].label} (⌘Z)` : "Nothing to undo"}>
            <UndoIcon />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!historyRef.current.future.length} title={historyRef.current.future.length ? `Redo: ${historyRef.current.future[historyRef.current.future.length - 1].label} (⇧⌘Z)` : "Nothing to redo"}>
            <RedoIcon />
          </button>
          <button className={`icon-btn ${showHistory ? "active" : ""}`} onClick={() => setShowHistory((s) => !s)} title="Change history">
            <HistoryIcon />
            History{historyRef.current.past.length ? ` · ${historyRef.current.past.length}` : ""}
          </button>
        </div>
        <div className="toolbar">
          <button className={`icon-btn ${showCompose ? "active" : ""}`} onClick={() => setShowCompose((s) => !s)} title="Show or hide the compose panel">
            <ComposeIcon />
            Compose
          </button>
          <button className={`icon-btn ${showSystem ? "active" : ""}`} onClick={() => setShowSystem((s) => !s)} title="Show or hide your musical system">
            <SystemIcon />
            System
          </button>
          <button className={`icon-btn ${showLibrary ? "active" : ""}`} onClick={() => setShowLibrary((s) => !s)} title="Saved systems, snapshots and recordings">
            <LibraryIcon />
            Library
          </button>
        </div>
        <div className="toolbar">
          <button className={`icon-btn ${immersive ? "active" : ""}`} onClick={immersive ? exitImmersive : enterImmersive} title="Fill the screen with the visuals (F · Esc to leave)">
            <ImmersiveIcon />
            {immersive ? "Exit" : "Immersive"}
          </button>
        </div>
        <div className="toolbar">
          <button className={`icon-btn rec ${recording !== null ? "on" : ""}`} onClick={toggleRecord} title="Record an excerpt of this performance">
            <span className="dot-rec" />
            {recording !== null ? `Stop ${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, "0")}` : "Record"}
          </button>
        </div>
      </div>

      <aside className={`panel left ${showCompose ? "" : "hidden"}`}>
        <div className="section">
          <h2 className="q">What should it feel like?</h2>
          <p className="hint">Describe a place, a feeling, a memory. The AI designs a musical system for it.</p>
          <textarea
            className="input"
            rows={3}
            value={atmo}
            onChange={(e) => setAtmo(e.target.value)}
            placeholder="An empty city at 4 a.m. Cold, nostalgic, and quietly beautiful."
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (atmo.trim() && !busy) ask("atmosphere", atmo.trim());
              }
            }}
          />
          <div className="row mt end">
            <button className="btn primary small" disabled={!atmo.trim() || busy !== null} onClick={() => ask("atmosphere", atmo.trim())}>
              {busy === "atmosphere" ? "Designing…" : "Design this system"}
            </button>
          </div>
          <div className="chips">
            {ATMOSPHERE_EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => setAtmo(ex)}>
                {ex}
              </button>
            ))}
          </div>
        </div>

        <RulesPanel
          config={config}
          update={update}
          snapshot={snapshot}
          pulses={pulses}
          onHover={setHoveredRule}
          onAsk={(t) => ask("rule", t)}
          busy={busy === "rule"}
          pending={pendingRule}
          onApplyPending={applyPendingRule}
          onCancelPending={() => setPendingRule(null)}
        />

        <div className="section">
          <h2 className="q">Direct it</h2>
          <p className="hint">Change the music while it plays. Only what you mention changes.</p>
          <div className="row">
            <input
              className="input"
              value={direct}
              placeholder="Make it more melancholic"
              onChange={(e) => setDirect(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === "Enter" && direct.trim() && !busy) {
                  const t = direct.trim();
                  setDirect("");
                  await ask("direct", t);
                }
              }}
            />
            <button
              className="btn primary small"
              disabled={!direct.trim() || busy !== null}
              onClick={async () => {
                const t = direct.trim();
                setDirect("");
                await ask("direct", t);
              }}
            >
              {busy === "direct" ? "…" : "Go"}
            </button>
          </div>
          <div className="chips">
            {DIRECT_EXAMPLES.map((ex) => (
              <button key={ex} className="chip" disabled={busy !== null} onClick={() => ask("direct", ex)}>
                {ex}
              </button>
            ))}
          </div>
          <div className="log">
            {log.map((item) => (
              <div className="log-item" key={item.id}>
                <div>
                  <span className="you">“{item.you}”</span>
                  <span className={`src ${item.source}`}>{item.source === "ai" ? "AI" : "offline"}</span>
                </div>
                <div>{item.reply}</div>
                {item.source === "offline" && item.notice && <div className="hint" style={{ margin: 0 }}>Fallback used: {item.notice}</div>}
                {item.unsupported.map((u, i) => (
                  <div className="unsupported" key={i}>
                    Not applied — “{u.request}”: {u.reason}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <aside className={`panel right ${showSystem ? "" : "hidden"}`}>
        <SystemPanel config={config} update={update} snapshot={snapshot} playing={playing} advanced={advanced} onHearTheme={(id) => engine?.playThemeNow(id)} lastMarkov={lastMarkov} />
      </aside>

      {showLibrary && (
        <Library
          config={config}
          compositions={compositions}
          currentId={currentId}
          recordings={recordings}
          playing={playing}
          currentSeed={playing ? snapshot?.seed ?? null : null}
          onSave={save}
          onSnapshot={snapshot_}
          onExport={exportFile}
          onImport={importFile}
          onOpen={open}
          onDelete={(id) => {
            deleteComposition(id);
            if (id === currentId) setCurrentId(null);
            setCompositions(listCompositions());
          }}
          onRandomize={randomize}
          onBlank={() => {
            const c = blankConfig();
            open(c, null);
            setShowSystem(true);
            say("a blank system — add layers with “+ Add layer”");
          }}
          onSeed={(seed) => update((c) => (c.seed = seed))}
          onRestart={restart}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {showHistory && (
        <div className="drawer history">
          <div className="row">
            <p className="label" style={{ flex: 1, margin: 0 }}>
              Change history · click a step to go back to before it
            </p>
            <button className="btn ghost small" onClick={() => setShowHistory(false)}>
              close
            </button>
          </div>
          {historyRef.current.future.length > 0 && (
            <p className="hint">{historyRef.current.future.length} undone change{historyRef.current.future.length === 1 ? "" : "s"} can be redone (↷).</p>
          )}
          {historyRef.current.past.length === 0 && <p className="hint">No changes yet. Every edit — by you or the AI — appears here and can be undone.</p>}
          {[...historyRef.current.past]
            .map((e, i) => ({ e, i }))
            .reverse()
            .map(({ e, i }) => (
              <button key={i} className="hist-item" onClick={() => restoreTo(i)} title="Go back to before this change">
                <span className="mono">{i + 1}</span>
                <span style={{ flex: 1 }}>{e.label}</span>
              </button>
            ))}
        </div>
      )}

      <div className="ticker">
        {ticker.map((t) => (
          <div key={t.id}>{t.text}</div>
        ))}
      </div>

      <div className="bottom">
        <button className={`play ${playing ? "on" : ""}`} onClick={togglePlay} aria-label={playing ? "Stop" : "Play"} disabled={!engine}>
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 18 18">
              <rect x="3" y="3" width="12" height="12" rx="2" fill="#eef1f7" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 20 20">
              <path d="M6 3.5 L16.5 10 L6 16.5 Z" fill="#eef1f7" />
            </svg>
          )}
        </button>
        <button
          className={`drum-toggle ${drumsOn ? "on" : ""}`}
          onClick={toggleDrums}
          title={drumsOn ? "Switch the drums off" : config.layers.some((l) => l.role === "drums") ? "Switch the drums back on" : "Add a drum machine to this piece"}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <ellipse cx="8" cy="5" rx="6" ry="2.2" />
            <path d="M2 5v6c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2V5" />
          </svg>
          Drums
        </button>
        {macro("density", "Density", "how many notes and layers")}
        {macro("evolution", "Evolution", "how quickly things change")}
        {config.engine.type === "composed" && slider("Intensity", "how full the peaks get", config.macro.intensity, (c, v) => (c.macro.intensity = v))}
        {macro("unpredictability", "Unpredictability", "how loosely notes vary")}
        {config.engine.type === "layers" && slider("Surprise", "how far it departs", config.behavior.surprises, (c, v) => (c.behavior.surprises = v))}
        {config.engine.type === "composed" && playing && snapshot?.phase && (
          <div className="form-status" title="The piece cycles through these four sections forever">
            {(["Beginning", "Development", "Expansion", "Release"] as const).map((p) => (
              <span key={p} className={snapshot.phase === p ? "on" : ""}>
                {p}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
