import * as Tone from "tone";
import type { DriftConfig, Layer, Rule, RuleType, SurpriseKind } from "../schema";
import { clamp, uid } from "../schema";
import {
  type Rng,
  chordPcs,
  gauss,
  midiToFreq,
  mulberry32,
  nextDegree,
  octaveHigh,
  octaveLow,
  scaleNotes,
  rootPc,
  scaleOf,
  weightedPick,
} from "../music";
import { type MelodyNote, styleFor, varyPhrase, writePhrase } from "./corpus";
import { type Matrix, learnedMatrix, nextState } from "./markov";
import { BASS, INTERLOCK, PROGRESSIONS, PULSE, type Phase, STEPS, additiveOrder, form, ladder, noteSteps } from "./composer";
import { type Motif, type Phrase, answerPhrase, composePhrase, makeMotif, mutateMotif } from "./melody";
import { BASE_CUTOFF, type DrumHit, type DrumKit, type FxUnit, RELEASE_TAIL, TRIM, makeFx, makeSource, type Poly } from "./instruments";

const makeSynth = (inst: Layer["instrument"]): Poly => makeSource(inst).synth;

/** A drum layer's evolving pattern: hit probabilities for 16 steps. */
interface DrumState {
  pattern: Record<DrumHit, number[]>;
  step: number; // absolute step counter
  gridTime: number; // unswung time of the current step
}

const DRUM_MIDI: Record<DrumHit, number> = { kick: 36, snare: 38, hat: 42, openhat: 46 };

/* ------------------------------------------------------------------ */
/* Events the engine announces (the visuals and UI listen to these)    */
/* ------------------------------------------------------------------ */

export type EngineEvent =
  | { kind: "note"; time: number; layerId: string; midi: number; velocity: number; duration: number; role: Layer["role"] | "surprise"; theme?: boolean; locked?: boolean }
  | { kind: "ghost"; time: number; layerId: string; midi: number; ruleId: string; ruleType: RuleType }
  | { kind: "chord"; time: number; pcs: number[] }
  | { kind: "surprise"; time: number; type: SurpriseKind }
  | { kind: "handoff"; time: number; from: string; to: string }
  | { kind: "relation"; time: number; from: string; to: string; type: string }
  | { kind: "layerEnter"; time: number; layerId: string; name: string }
  | { kind: "layerLeave"; time: number; layerId: string; name: string }
  | { kind: "ruleFired"; time: number; ruleId: string }
  | { kind: "silence"; time: number; until: number }
  | { kind: "markov"; time: number; layerId: string; from: number; to: number };

export interface LayerSnapshot {
  id: string;
  name: string;
  role: Layer["role"];
  colorIndex: number;
  lane: number; // 0..1 horizontal position for visuals
  active: boolean;
  speaking: boolean;
  runtime: boolean; // added by a rule, not part of the saved system
}

export interface RuleSnapshot {
  progress: number; // 0..1 for time-based rules
  fired: number; // times it has acted
}

export interface Snapshot {
  now: number;
  playing: boolean;
  seed: number;
  chord: number[];
  layers: LayerSnapshot[];
  rules: Record<string, RuleSnapshot>;
  soundingLayers: number;
  maxVoices: number | null;
  maxNotes: number | null;
  soundingNotes: number;
  arc: { intensity: number; progress: number } | null;
  chordIndex: number;
  phase: string | null;
  /** Ambient loops: where each loop is in its cycle and its chain's current note. */
  loops: { id: string; length: number; position: number; state: number }[];
  quietLevel: number | null;
  driftAmount: number;
  erosion: number;
  thinProgress: number;
  ceilingMidi: number | null;
  floorMidi: number | null;
  addProgress: number | null;
  speaker: string | null;
  level: number;
}

/* ------------------------------------------------------------------ */
/* Internal state                                                      */
/* ------------------------------------------------------------------ */

interface Voice {
  layer: Layer;
  runtime: boolean;
  colorIndex: number;
  synth: Poly;
  filter: Tone.Filter;
  panner: Tone.Panner;
  gain: Tone.Gain;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
  nextTime: number;
  lastMidi: number | null;
  lastNoteTime: number;
  direction: 1 | -1;
  /** The phrase currently being played, as interval/length pairs. */
  phrase: { step: number; dur: number }[];
  /** Phrases remembered for later return ("memory"). */
  memory: { step: number; dur: number }[][];
  replay: { step: number; dur: number }[];
  mods: { act: number; reg: number; bright: number };
  spread: number; // -1..1, used by "drift apart"
  bornAt: number;
  sinceRest: number;
  phraseTarget: number;
  /** Remaining steps of the user's melody being played, and its starting note. */
  themeQueue: { s: number | null; lock: boolean }[];
  themeAnchor: number | null;
  /** Every Tone node the voice owns besides the fixed chain, for disposal. */
  extraNodes: Tone.ToneAudioNode[];
  fx: FxUnit | null;
  kit: DrumKit | null;
  drum: DrumState | null;
  /** Phrase-based melody: the layer's motifs and the phrase being played. */
  motifs: Motif[];
  phraseQ: { s: number; beats: number }[];
  phrase_: Phrase | null;
  phraseAnchor: number | null;
  phraseIndex: number;
  lastBeats: number;
  answerFrom: string | null;
  /** Composed melody: the current period (A, A', B, A'') and what's playing. */
  period: MelodyNote[][];
  periodIndex: number;
  periodCycle: number;
  mplan: { notes: MelodyNote[]; startStep: number; end: number; last: boolean } | null;
  /** Ambient loop: its own length, the notes placed in it, and the chain's state. */
  amb: { length: number; start: number; slots: { offset: number; state: number }[]; index: number; pass: number; state: number; next: number } | null;
}

interface Sounding {
  layerId: string;
  midi: number;
  start: number;
  end: number;
  /** When the note has fully faded, release tail included. */
  fullEnd: number;
}

interface Pending {
  voiceId: string;
  time: number;
  midi: number;
  from: string;
  type: string;
}

const LOOKAHEAD = 0.3;
const TICK_MS = 50;
const MELODIC = new Set<Layer["role"]>(["melody", "bells"]);

const RUNTIME_TEMPLATES: Omit<Layer, "id">[] = [
  { name: "Visiting bells", role: "bells", instrument: "bell", enabled: true, register: { low: 5, high: 6 }, activity: 0.35, durations: { min: 1, max: 4 }, movement: "leaps", volume: 0.4, pan: 0.45, prominence: "blends", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
  { name: "Wandering pluck", role: "texture", instrument: "pluck", enabled: true, register: { low: 4, high: 6 }, activity: 0.45, durations: { min: 0.2, max: 0.8 }, movement: "arpeggio", volume: 0.45, pan: -0.45, prominence: "blends", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
  { name: "Distant choir", role: "pad", instrument: "choir", enabled: true, register: { low: 3, high: 5 }, activity: 0.3, durations: { min: 8, max: 16 }, movement: "drone", volume: 0.4, pan: 0.2, prominence: "recedes", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
  { name: "Second glass voice", role: "melody", instrument: "glass", enabled: true, register: { low: 5, high: 6 }, activity: 0.4, durations: { min: 0.8, max: 3 }, movement: "stepwise", volume: 0.45, pan: 0.5, prominence: "blends", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
  { name: "Air", role: "texture", instrument: "air", enabled: true, register: { low: 3, high: 4 }, activity: 0.3, durations: { min: 6, max: 12 }, movement: "drone", volume: 0.35, pan: -0.2, prominence: "recedes", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
  { name: "Low felt", role: "melody", instrument: "felt", enabled: true, register: { low: 3, high: 4 }, activity: 0.35, durations: { min: 1, max: 3 }, movement: "stepwise", volume: 0.5, pan: -0.5, prominence: "blends", relation: { type: "independent", target: null }, speed: 1, theme: null, fx: "none" },
];

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class Engine {
  private config: DriftConfig;
  private rng: Rng = Math.random;
  private seedUsed = 0;
  private built = false;
  private playing = false;
  private timer: number | null = null;
  private listeners = new Set<(e: EngineEvent) => void>();

  // audio graph
  private bus!: Tone.Gain;
  private masterFilter!: Tone.Filter;
  private eq!: Tone.EQ3;
  private compressor!: Tone.Compressor;
  private limiter!: Tone.Limiter;
  private out!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private reverbIn!: Tone.Gain;
  private delay!: Tone.FeedbackDelay;
  private meter!: Tone.Meter;
  private recorder!: Tone.Recorder;
  private surpriseSynth!: Poly;
  private surpriseBell!: Poly;
  private surpriseSub!: Poly;
  private surpriseOut!: Tone.Gain;
  private noise!: Tone.Noise;
  private noiseFilter!: Tone.Filter;
  private noiseEnv!: Tone.AmplitudeEnvelope;
  private reverbDecay = 0;

  // musical state
  private voices = new Map<string, Voice>();
  private colorCounter = 0;
  private sounding: Sounding[] = [];
  private pending: Pending[] = [];
  private chord = { degree: 0, pcs: [] as number[], next: 0 };
  private padVoicing = new Map<string, number[]>();
  private silenceUntil = 0;
  private startedAt = 0;
  private clock = 0; // logical time of the event being processed
  private progIndex = 0; // position in a fixed chord progression
  /** The composed engine's state: pulse counter, form cycle, patterns. */
  private comp = {
    step: 0,
    gridTime: 0,
    cycleStartBar: 0,
    cycleBars: 32,
    variant: 0,
    shift: 0,
    energy: 0.15,
    phase: "Beginning" as Phase,
    orders: new Map<string, number[]>(),
    on: new Set<string>(),
    chordBar: 0,
  };
  private arcStart = 0; // when the dramatic arc began
  private nextSilence = 0;
  private lastEvo = 0;
  private activeIds = new Set<string>();
  private nextSurprise = 0;
  private quiet = { level: 1, lastNote: 0 };
  private handoff = { speaker: null as string | null, phraseLeft: 0, waitUntil: 0, lastSpeaker: null as string | null };
  private ruleStart = new Map<string, number>();
  private ruleFired = new Map<string, number>();
  private ruleLastEmit = new Map<string, number>();
  private lastAddLayer = 0;
  private runtimeOrder: string[] = [];

  constructor(config: DriftConfig) {
    this.config = structuredClone(config);
  }

  /* ---------------- public API ---------------- */

  on(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  now(): number {
    return Tone.now();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getSeed(): number {
    return this.seedUsed;
  }

  async start(): Promise<void> {
    await Tone.start();
    if (!this.built) await this.build();
    if (this.playing) return;

    this.seedUsed = this.config.seed ?? Math.floor(Math.random() * 2 ** 31);
    this.rng = mulberry32(this.seedUsed);

    const now = Tone.now() + 0.05;
    this.startedAt = now;
    this.clock = now;
    this.progIndex = 0;
    this.arcStart = now;
    this.comp = { step: 0, gridTime: now + 0.12, cycleStartBar: 0, cycleBars: this.cycleLength(), variant: 0, shift: 0, energy: 0.12, phase: "Beginning", orders: new Map(), on: new Set(), chordBar: 0 };
    this.sounding = [];
    this.pending = [];
    this.silenceUntil = 0;
    this.quiet = { level: 1, lastNote: now };
    this.handoff = { speaker: null, phraseLeft: 0, waitUntil: 0, lastSpeaker: null };
    this.ruleStart.clear();
    this.ruleFired.clear();
    this.lastAddLayer = now;
    this.nextSurprise = now + 20 + this.rng() * 30;
    this.nextSilence = now + 10 + this.rng() * 20;
    this.lastEvo = now;
    for (const r of this.config.rules) this.ruleStart.set(r.id, now);

    // every performance starts from fresh voices, in the system's order,
    // so nothing from a previous run leaks into this one
    for (const id of [...this.voices.keys()]) this.removeVoice(id, 0.05);
    this.runtimeOrder = [];
    this.padVoicing.clear();
    this.pending = [];
    this.colorCounter = 0;
    this.syncVoices(now);

    this.chord = { degree: 0, pcs: [], next: now + 0.15 };
    this.applyAudioParams(0.05);
    this.updateActiveSet();

    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(0.9, now + 2.5);

    this.playing = true;
    this.loop();
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer !== null) Tone.getContext().clearInterval(this.timer);
    this.timer = null;
    const now = Tone.now();
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 1.8);
    setTimeout(() => {
      if (this.playing) return;
      for (const v of this.voices.values()) v.synth.releaseAll();
      this.surpriseSynth.releaseAll();
      this.surpriseBell.releaseAll();
      this.surpriseSub.releaseAll();
    }, 1900);
  }

  /** Apply a new configuration without interrupting playback. */
  setConfig(next: DriftConfig): void {
    const prev = this.config;
    this.config = structuredClone(next);
    if (!this.built) return;
    const now = Tone.now();

    // rules: start the clock on newly added rules
    const ids = new Set(next.rules.map((r) => r.id));
    for (const r of next.rules) if (!this.ruleStart.has(r.id)) this.ruleStart.set(r.id, now);
    for (const id of [...this.ruleStart.keys()]) if (!ids.has(id)) this.ruleStart.delete(id);
    if (!next.rules.some((r) => r.type === "handoff" && r.enabled)) this.handoff.speaker = null;
    if (next.rules.some((r) => r.type === "addLayerEvery" && r.enabled) && !prev.rules.some((r) => r.type === "addLayerEvery" && r.enabled)) {
      this.lastAddLayer = now;
    }
    if (!next.rules.some((r) => r.type === "addLayerEvery" && r.enabled)) {
      for (const id of this.runtimeOrder) this.removeVoice(id, 6);
      this.runtimeOrder = [];
    }

    // a new or lower note limit applies at once, to notes already ringing
    const prevMax = prev.rules.find((r) => r.type === "maxNotes" && r.enabled);
    const nextMax = next.rules.find((r) => r.type === "maxNotes" && r.enabled);
    if (this.playing && nextMax && (!prevMax || nextMax.value < prevMax.value)) this.trimToNoteLimit(Math.round(nextMax.value), now);

    const created = this.syncVoices(now);
    // Density changes the drum patterns too
    if (prev.macro.density !== next.macro.density) for (const v of this.voices.values()) if (v.kit && v.drum) v.drum.pattern = this.drumPattern(v);
    this.applyAudioParams(2.5);
    this.updateActiveSet();

    // while playing, new layers enter within a moment rather than waiting
    if (this.playing && created.length) {
      for (const v of created) v.nextTime = this.onGrid(now + 0.4 + this.rng() * 2.2);
      if (created.some((v) => v.layer.role === "pad")) this.chord.next = Math.min(this.chord.next, now + 0.6);
    }

    if (JSON.stringify(prev.harmony.progression) !== JSON.stringify(next.harmony.progression)) {
      this.progIndex = 0;
      if (this.playing) this.chord.next = Math.min(this.chord.next, this.onGridBar(now + 0.5));
    }
    if (prev.arc.shape !== next.arc.shape) this.arcStart = now;

    // a change of key or color is heard soon, but as a smooth chord change
    if (
      prev.harmony.root !== next.harmony.root ||
      prev.harmony.mode !== next.harmony.mode ||
      prev.harmony.tension !== next.harmony.tension ||
      JSON.stringify(prev.harmony.customScale) !== JSON.stringify(next.harmony.customScale)
    ) {
      if (this.playing) this.chord.next = Math.min(this.chord.next, now + 1.2);
    }
  }

  getConfig(): DriftConfig {
    return this.config;
  }

  /** "Introduce something unexpected" — fire a surprise right now. */
  surpriseNow(): void {
    if (!this.playing) return;
    const kinds = this.config.behavior.surpriseKinds.length ? this.config.behavior.surpriseKinds : (["highShimmer", "lowSwell", "cluster"] as SurpriseKind[]);
    this.fireSurprise(kinds[Math.floor(Math.random() * kinds.length)], Tone.now() + 0.1);
  }

  startRecording(): void {
    if (!this.built) return;
    if (this.recorder.state !== "started") this.recorder.start();
  }

  async stopRecording(): Promise<Blob | null> {
    if (!this.built || this.recorder.state !== "started") return null;
    return await this.recorder.stop();
  }

  snapshot(): Snapshot {
    const now = this.built ? Tone.now() : 0;
    const layers: LayerSnapshot[] = [];
    const list = [...this.voices.values()];
    const n = list.length;
    const drift = this.ruleProgress("driftApart");
    list.forEach((v, i) => {
      const base = n === 1 ? 0.5 : 0.14 + (0.72 * i) / (n - 1);
      const spreadOut = 0.5 + (base - 0.5) * (1 - drift * 0.15) + v.spread * drift * 0.22;
      layers.push({
        id: v.layer.id,
        name: v.layer.name,
        role: v.layer.role,
        colorIndex: v.colorIndex,
        lane: clamp(spreadOut, 0.04, 0.96),
        active: this.activeIds.has(v.layer.id),
        speaking: this.handoff.speaker === v.layer.id,
        runtime: v.runtime,
      });
    });
    const rules: Record<string, RuleSnapshot> = {};
    for (const r of this.config.rules) {
      rules[r.id] = { progress: this.progressOf(r, now), fired: this.ruleFired.get(r.id) ?? 0 };
    }
    const maxRule = this.rule("maxVoices");
    const ceil = this.rule("ceiling");
    const floor = this.rule("floor");
    const add = this.rule("addLayerEvery");
    let level = 0;
    if (this.built) {
      const db = this.meter.getValue() as number;
      level = Number.isFinite(db) ? clamp((db + 60) / 60) : 0;
    }
    return {
      now,
      playing: this.playing,
      seed: this.seedUsed,
      chord: this.chord.pcs,
      layers,
      rules,
      soundingLayers: this.soundingLayerCount(now, null),
      maxVoices: maxRule ? Math.round(maxRule.value) : null,
      maxNotes: this.rule("maxNotes") ? Math.round(this.rule("maxNotes")!.value) : null,
      soundingNotes: this.soundingNoteCount(now, false),
      arc: this.config.arc.shape === "off" && this.config.engine.type !== "composed" ? null : { intensity: this.arcIntensity(now), progress: this.arcProgress(now) },
      phase: this.config.engine.type === "composed" && this.playing ? this.comp.phase : null,
      loops: [...this.voices.values()].filter((v) => v.amb).map((v) => ({ id: v.layer.id, length: v.amb!.length, position: clamp((now - v.amb!.start) / v.amb!.length), state: v.amb!.state })),
      chordIndex: this.config.harmony.progression ? (this.progIndex - 1 + this.config.harmony.progression.degrees.length * 100) % this.config.harmony.progression.degrees.length : -1,
      quietLevel: this.rule("eachQuieter") ? this.quiet.level : null,
      driftAmount: drift,
      erosion: this.ruleProgress("erode"),
      thinProgress: this.ruleProgress("thinHighs"),
      ceilingMidi: ceil ? octaveHigh(ceil.value) : null,
      floorMidi: floor ? octaveLow(floor.value) : null,
      addProgress: add && this.playing ? clamp((now - this.lastAddLayer) / (add.value * 60)) : null,
      speaker: this.handoff.speaker,
      level,
    };
  }

  dispose(): void {
    this.stop();
    for (const id of [...this.voices.keys()]) this.removeVoice(id, 0);
  }

  /* ---------------- graph ---------------- */

  private async build(): Promise<void> {
    this.out = new Tone.Gain(0).toDestination();
    this.limiter = new Tone.Limiter(-1).connect(this.out);
    this.compressor = new Tone.Compressor({ threshold: -20, ratio: 3, attack: 0.05, release: 0.4 }).connect(this.limiter);
    this.eq = new Tone.EQ3({ low: 0, mid: 0, high: 0 }).connect(this.compressor);
    this.masterFilter = new Tone.Filter({ type: "lowpass", frequency: 9000, rolloff: -12, Q: 0.3 }).connect(this.eq);
    // headroom gain: individual layers are kept within 0..1, the bus lifts
    // the whole mix and the compressor/limiter keep peaks safe
    this.bus = new Tone.Gain(2.5).connect(this.masterFilter);

    this.reverbDecay = 2 + this.config.space.reverb * 14;
    this.reverb = new Tone.Reverb({ decay: this.reverbDecay, preDelay: 0.04, wet: 1 }).connect(this.bus);
    this.reverbIn = new Tone.Gain(1).connect(this.reverb);
    // echoTime goes up to 1.6s; the default maximum delay is only 1s
    this.delay = new Tone.FeedbackDelay({ delayTime: this.config.space.echoTime, maxDelay: 2, feedback: this.config.space.echoFeedback, wet: 1 });
    this.delay.connect(this.bus);
    this.delay.connect(this.reverbIn);

    this.meter = new Tone.Meter({ smoothing: 0.85 });
    this.out.connect(this.meter);
    this.recorder = new Tone.Recorder();
    this.out.connect(this.recorder);

    // surprise instruments
    this.surpriseOut = new Tone.Gain(0.7).connect(this.bus);
    this.surpriseOut.connect(this.reverbIn);
    this.surpriseSynth = makeSynth("felt");
    this.surpriseSynth.connect(this.surpriseOut);
    this.surpriseBell = makeSynth("bell");
    this.surpriseBell.volume.value = -14;
    this.surpriseBell.connect(this.surpriseOut);
    this.surpriseSub = makeSynth("sub");
    this.surpriseSub.connect(this.surpriseOut);
    this.noiseFilter = new Tone.Filter({ type: "bandpass", frequency: 600, Q: 1.2 });
    this.noiseEnv = new Tone.AmplitudeEnvelope({ attack: 2.5, decay: 0.5, sustain: 1, release: 3.5 });
    this.noise = new Tone.Noise("pink");
    this.noise.volume.value = -22;
    this.noise.chain(this.noiseFilter, this.noiseEnv, this.surpriseOut);
    this.noise.start();

    await this.reverb.ready;
    this.built = true;
  }

  private createVoice(layer: Layer, runtime: boolean, now: number): Voice {
    const src = makeSource(layer.instrument);
    const synth = src.synth;
    const filter = new Tone.Filter({ type: "lowpass", frequency: BASE_CUTOFF[layer.instrument], rolloff: -12, Q: 0.4 });
    const panner = new Tone.Panner(layer.pan);
    const gain = new Tone.Gain(0);
    const reverbSend = new Tone.Gain(0);
    const delaySend = new Tone.Gain(0);
    // source → (electronic effect) → tone filter → position → level
    const fx = makeFx(layer.fx, this.config.tempo.bpm);
    if (fx) {
      src.out.connect(fx.input);
      fx.output.chain(filter, panner, gain);
    } else {
      src.out.chain(filter, panner, gain);
    }
    gain.connect(this.bus);
    gain.connect(reverbSend);
    gain.connect(delaySend);
    reverbSend.connect(this.reverbIn);
    delaySend.connect(this.delay);
    const v: Voice = {
      layer,
      runtime,
      colorIndex: this.colorCounter++ % 6,
      synth,
      filter,
      panner,
      gain,
      reverbSend,
      delaySend,
      nextTime: now,
      lastMidi: null,
      lastNoteTime: now,
      direction: 1,
      phrase: [],
      memory: [],
      replay: [],
      mods: { act: 1, reg: 0, bright: 0 },
      spread: 0,
      bornAt: now,
      sinceRest: 0,
      phraseTarget: 4,
      themeQueue: [],
      themeAnchor: null,
      extraNodes: src.nodes,
      fx,
      kit: src.kit,
      drum: null,
      motifs: [],
      phraseQ: [],
      phrase_: null,
      phraseAnchor: null,
      phraseIndex: 0,
      lastBeats: 1,
      answerFrom: null,
      period: [],
      periodIndex: 0,
      periodCycle: -1,
      mplan: null,
      amb: null,
    };
    if (this.phrased(v)) v.motifs = this.newMotifs(v);
    this.voices.set(layer.id, v);
    this.resetVoiceTiming(v, now);
    return v;
  }

  private removeVoice(id: string, fade: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    this.voices.delete(id);
    const now = Tone.now();
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
    setTimeout(() => {
      v.synth.releaseAll();
      setTimeout(() => {
        v.synth.dispose();
        for (const n of v.extraNodes) n.dispose();
        for (const n of v.fx?.nodes ?? []) n.dispose();
        v.filter.dispose();
        v.panner.dispose();
        v.gain.dispose();
        v.reverbSend.dispose();
        v.delaySend.dispose();
      }, 500);
    }, fade * 1000 + 200);
  }

  /** Make the set of voices match the configuration. Returns new voices. */
  private syncVoices(now: number): Voice[] {
    const wanted = new Map(this.config.layers.map((l) => [l.id, l]));
    const created: Voice[] = [];
    for (const [id, v] of [...this.voices]) {
      if (v.runtime) continue;
      const l = wanted.get(id);
      if (!l) {
        this.removeVoice(id, 4);
      } else if (l.instrument !== v.layer.instrument || l.fx !== v.layer.fx) {
        // crossfade to the new instrument / effect
        this.removeVoice(id, 4);
        const nv = this.createVoice(l, false, now);
        nv.colorIndex = v.colorIndex;
        created.push(nv);
      } else {
        const busier = v.kit && v.drum && v.layer.activity !== l.activity;
        v.layer = l;
        // a drum layer's Activity reshapes its pattern straight away
        if (busier && v.drum) v.drum.pattern = this.drumPattern(v);
      }
    }
    for (const l of this.config.layers) if (!this.voices.has(l.id)) created.push(this.createVoice(l, false, now));
    this.assignSpread();
    return created;
  }

  private assignSpread(): void {
    const list = [...this.voices.values()];
    const n = list.length;
    list.forEach((v, i) => (v.spread = n === 1 ? 0 : -1 + (2 * i) / (n - 1)));
  }

  private resetVoiceTiming(v: Voice, now: number): void {
    const role = v.layer.role;
    if (v.kit) {
      // drums start on the next bar line of the shared grid
      const bar = (60 / this.config.tempo.bpm) * 4;
      const first = this.startedAt + Math.ceil((now + 0.2 - this.startedAt) / bar - 1e-6) * bar;
      v.drum = { pattern: this.drumPattern(v), step: 0, gridTime: first };
      v.nextTime = first;
      v.lastNoteTime = now;
      return;
    }
    const offset = role === "melody" ? 0.8 + this.rng() * 2.5 : role === "bass" ? 4 + this.rng() * 8 : role === "pad" ? 0 : 2 + this.rng() * 6;
    v.nextTime = role === "pad" ? now + offset : this.onGrid(now + offset);
    v.lastNoteTime = now;
  }

  /** Ramp every continuous audio parameter toward the current config. */
  private applyAudioParams(ramp: number): void {
    const c = this.config;
    const erosion = this.ruleProgress("erode");
    const arcI = this.arcIntensity(this.playing ? this.clock : Tone.now());
    const arcOn = c.arc.shape !== "off" || c.engine.type === "composed";
    // Intensity tilts the tone brighter (composed pieces fold it into the form instead)
    const tilt = c.engine.type === "composed" ? 0 : (c.macro.intensity - 0.5) * 0.3;
    const brightness = clamp(c.tone.brightness - erosion * 0.25 + (arcOn ? (arcI - 0.5) * 0.35 : 0) + tilt);
    // the arc also swells the overall level
    this.bus.gain.rampTo(arcOn ? 2.5 * (0.5 + 0.5 * arcI) : 2.5, ramp);
    this.masterFilter.frequency.rampTo(500 * Math.pow(2, brightness * 5.3), ramp);
    this.eq.low.rampTo(-2 + c.tone.warmth * 6, ramp);
    this.eq.high.rampTo(2 - c.tone.warmth * 7, ramp);

    const decay = 2 + c.space.reverb * 14;
    if (Math.abs(decay - this.reverbDecay) > 1.5) {
      this.reverbDecay = decay;
      this.reverb.decay = decay; // regenerates the space in the background
    }
    try {
      this.delay.delayTime.rampTo(clamp(c.space.echoTime, 0.05, 1.9), ramp);
      this.delay.feedback.rampTo(clamp(c.space.echoFeedback, 0, 0.9), ramp);
    } catch (err) {
      console.warn("[drift] could not update echoes", err);
    }

    const drift = this.ruleProgress("driftApart");
    for (const v of this.voices.values()) {
      // one bad value must never stop the music: each voice is isolated
      try {
        v.fx?.setTempo(c.tempo.bpm);
        const l = v.layer;
        const prom = l.prominence === "leads" ? { g: 1.3, r: 0.65, f: 1.25 } : l.prominence === "recedes" ? { g: 0.55, r: 1.45, f: 0.6 } : { g: 1, r: 1, f: 1 };
        const on = l.enabled ? 1 : 0;
        // Tone's gain params accept 0..1; the bus adds the extra headroom
        v.gain.gain.rampTo(clamp(on * TRIM[l.instrument] * Math.pow(l.volume, 1.3) * prom.g), ramp);
        const reverbMix = clamp(c.space.reverbMix + erosion * 0.25);
        v.reverbSend.gain.rampTo(clamp(reverbMix * prom.r), ramp);
        const echoRole = l.role === "pad" ? 0.25 : l.role === "bass" ? 0 : l.role === "texture" ? 0.8 : 1;
        v.delaySend.gain.rampTo(clamp(c.space.echo * echoRole * 0.8), ramp);
        const cutoff = BASE_CUTOFF[l.instrument] * Math.pow(2, (brightness - 0.5) * 2.4 + v.mods.bright) * prom.f;
        v.filter.frequency.rampTo(clamp(cutoff, 120, 16000), ramp);
        v.panner.pan.rampTo(clamp(l.pan + v.spread * drift * 0.7, -1, 1), ramp);
      } catch (err) {
        console.warn("[drift] could not update a layer's sound", err);
      }
    }
  }

  /* ---------------- rules ---------------- */

  private rule(type: RuleType): Rule | undefined {
    return this.config.rules.find((r) => r.type === type && r.enabled);
  }

  private progressOf(r: Rule, now: number): number {
    if (!r.enabled || !this.playing) return 0;
    if (!["driftApart", "erode", "thinHighs"].includes(r.type)) return 0;
    const start = this.ruleStart.get(r.id) ?? now;
    return clamp((now - start) / (Math.max(0.1, r.value) * 60));
  }

  private ruleProgress(type: RuleType): number {
    const r = this.rule(type);
    if (!r || !this.built) return 0;
    return this.progressOf(r, this.playing ? this.clock : Tone.now());
  }

  private fire(r: Rule, time: number, throttle = 0): void {
    this.ruleFired.set(r.id, (this.ruleFired.get(r.id) ?? 0) + 1);
    const last = this.ruleLastEmit.get(r.id) ?? 0;
    if (time - last >= throttle) {
      this.ruleLastEmit.set(r.id, time);
      this.emit({ kind: "ruleFired", time, ruleId: r.id });
    }
  }

  private ghost(v: Voice | null, midi: number, r: Rule, time: number): void {
    this.fire(r, time, 0.3);
    this.emit({ kind: "ghost", time, layerId: v?.layer.id ?? "surprise", midi, ruleId: r.id, ruleType: r.type });
  }

  /* ---------------- scheduler ---------------- */

  /**
   * Tone's context timer runs on a worker clock, so the music keeps
   * flowing even when the browser tab is in the background.
   */
  private loop = (): void => {
    if (this.timer !== null) return;
    this.timer = Tone.getContext().setInterval(() => {
      if (!this.playing) return;
      try {
        this.tick();
      } catch (err) {
        console.error("[drift] tick error", err);
      }
    }, TICK_MS / 1000);
  };

  /**
   * Every musical event — notes, chord changes, evolution steps, pauses,
   * surprises, responses — is processed strictly in time order on a
   * logical clock. That keeps a seeded performance exactly reproducible,
   * however the browser's timers happen to fire.
   */
  private tick(): void {
    const now = Tone.now();
    const horizon = now + LOOKAHEAD;
    this.sounding = this.sounding.filter((s) => s.fullEnd > Math.min(now, this.clock) - 0.05);
    for (let guard = 0; guard < 300; guard++) {
      const next = this.nextEvent();
      if (!next || next.time > horizon) break;
      this.clock = next.time;
      try {
        next.run();
      } catch (err) {
        // one failed event must not stop the others
        console.warn("[drift] event failed", err);
      }
    }
  }

  private nextEvent(): { time: number; run: () => void } | null {
    let best: { time: number; run: () => void } | null = null;
    const consider = (time: number, run: () => void) => {
      if (Number.isFinite(time) && (!best || time < best.time)) best = { time, run };
    };
    const c = this.config;
    const ambient = c.engine.type === "ambient";
    const composed = c.engine.type === "composed" || ambient;
    // the composed engine drives everything from one shared pulse
    if (composed && !ambient) consider(this.comp.gridTime, () => this.composedStep());
    if (ambient) {
      // the harmony still drifts slowly underneath (pads and the low line follow it)
      consider(this.chord.next, () => this.changeChord(this.chord.next));
      for (const v of this.voices.values()) {
        if (v.layer.role === "pad" || v.layer.role === "bass" || v.kit || !v.layer.enabled) continue;
        if (!v.amb) this.ambientInit(v, Math.max(this.clock, Tone.now()));
        consider(v.amb!.next, () => this.ambientStep(v));
      }
    }

    consider(this.lastEvo + 2, () => {
      this.lastEvo += 2;
      try {
        this.evolve(this.lastEvo, 2);
      } catch (err) {
        console.warn("[drift] evolution step failed", err);
      }
    });

    if (!composed) consider(this.chord.next, () => this.changeChord(this.chord.next));

    // pauses: irregular silences
    if (!composed) consider(this.nextSilence, () => {
      const t = this.nextSilence;
      const u = this.effectiveU();
      if (c.behavior.silence > 0.02 && t >= this.silenceUntil) {
        const len = 3 + this.rng() * (5 + c.behavior.silence * 10);
        this.silenceUntil = t + len;
        this.emit({ kind: "silence", time: t, until: this.silenceUntil });
      }
      const rate = Math.max(0.0005, c.behavior.silence * 0.02 * (0.5 + u));
      this.nextSilence = Math.max(t, this.silenceUntil) + -Math.log(Math.max(1e-6, this.rng())) / rate;
    });

    if (!composed) consider(this.nextSurprise, () => {
      const t = this.nextSurprise;
      const kinds = c.behavior.surpriseKinds;
      const rate0 = Math.max(0.0005, c.behavior.surprises * 0.03 * (0.4 + this.effectiveU()));
      this.nextSurprise = t + -Math.log(Math.max(1e-6, this.rng())) / rate0; // scheduled first, so a failure can't repeat
      if (kinds.length && c.behavior.surprises > 0.02 && t >= this.silenceUntil) {
        this.fireSurprise(kinds[Math.floor(this.rng() * kinds.length)], t);
      }
    });

    // rule: introduce a new instrument every N minutes
    const add = this.rule("addLayerEvery");
    if (add) {
      consider(this.lastAddLayer + add.value * 60, () => {
        this.lastAddLayer += add.value * 60;
        this.addRuntimeLayer(this.lastAddLayer, add);
      });
    }

    // responses from related layers
    if (this.pending.length && !composed) {
      let first = this.pending[0];
      for (const p of this.pending) if (p.time < first.time) first = p;
      const p = first;
      consider(p.time, () => {
        this.pending.splice(this.pending.indexOf(p), 1); // removed first, so a failure can't repeat
        const v = this.voices.get(p.voiceId);
        if (v && this.activeIds.has(v.layer.id) && v.layer.enabled) {
          if (this.play(v, p.time, p.midi)) this.emit({ kind: "relation", time: p.time, from: p.from, to: p.voiceId, type: p.type });
        }
      });
    }

    // each layer's own next event (pads follow the harmony instead)
    for (const v of this.voices.values()) {
      if (v.layer.role === "pad") continue;
      if (v.kit) {
        // drums play in every engine whenever their layer is switched on
        consider(v.nextTime, () => this.drumStep(v));
        continue;
      }
      if (composed) continue;
      consider(v.nextTime, () => {
        const t = v.nextTime;
        try {
          if (v.layer.enabled && this.activeIds.has(v.layer.id)) this.play(v, t, null);
        } finally {
          // always move on, even if this note failed
          v.nextTime = t + this.interval(v, t);
        }
      });
    }
    return best;
  }

  /** Audio can't be scheduled in the past; late events play right away. */
  private at(time: number): number {
    return Math.max(time, Tone.now() + 0.005);
  }

  private effectiveU(): number {
    return clamp(this.config.macro.unpredictability + this.ruleProgress("erode") * 0.45);
  }

  /**
   * The dramatic arc: how intense the piece is right now (0..1).
   * build: rises and stays · buildRelease: rises to a climax, then lets go
   * · waves: slow swells. Off: always 1 (no effect).
   */
  arcIntensity(t = this.clock): number {
    if (this.config.engine.type === "composed") return this.playing ? this.comp.energy : 0.3;
    const a = this.config.arc;
    if (a.shape === "off" || !this.playing) return 1;
    const p = Math.max(0, (t - this.arcStart) / (a.minutes * 60));
    const smooth = (x: number) => x * x * (3 - 2 * x);
    switch (a.shape) {
      case "build":
        return 0.12 + 0.88 * smooth(Math.min(1, p));
      case "buildRelease": {
        const q = p % 1; // the arc repeats
        if (q < 0.72) return 0.1 + 0.9 * Math.pow(smooth(q / 0.72), 1.3);
        return 0.1 + 0.9 * (1 - smooth((q - 0.72) / 0.28));
      }
      case "waves":
        return 0.2 + 0.8 * (0.5 - 0.5 * Math.cos(2 * Math.PI * p));
    }
    return 1;
  }

  private arcProgress(t: number): number {
    if (this.config.engine.type === "composed") return this.formPosition();
    const a = this.config.arc;
    if (a.shape === "off" || !this.playing) return 0;
    const p = (t - this.arcStart) / (a.minutes * 60);
    return a.shape === "build" ? Math.min(1, p) : p % 1;
  }

  /** Density, shaped by the arc: quiet beginnings, a full climax. */
  private density(): number {
    const d = this.config.macro.density;
    if (this.config.arc.shape === "off") return d;
    const i = this.arcIntensity();
    return clamp(d * (0.25 + 1.0 * i) + (i > 0.85 ? 0.12 : 0));
  }

  /** Next bar line on the shared grid. */
  private onGridBar(time: number): number {
    const bar = (60 / this.config.tempo.bpm) * 4;
    return this.startedAt + Math.ceil((time - this.startedAt) / bar - 1e-6) * bar;
  }

  /** Overall slowness 0..1, derived from the tempo. */
  private pace(): number {
    return clamp((this.config.tempo.bpm - 30) / 90);
  }

  /**
   * Time from `t` until a layer's next event: tempo, density, activity,
   * speed, randomness. When the pulse is locked, the result lands on a
   * beat grid shared by every layer.
   */
  private interval(v: Voice, t: number): number {
    const c = this.config;
    const d = this.density();
    const u = this.effectiveU();
    const beat = 60 / c.tempo.bpm;
    const grid = beat / 2;
    const speed = clamp(v.layer.speed, 0.25, 4);

    // a drawn melody moves one step per beat (scaled by the layer's speed)
    if (v.themeQueue.length) {
      const iv = (beat / speed) * Math.exp(gauss(this.rng) * 0.25 * u * (1 - c.tempo.lock));
      return this.snap(t, Math.max(0.12, iv), grid, c.tempo.lock > 0.3 ? 1 : 0);
    }

    if (this.phrased(v)) {
      // inside a phrase: the motif's own rhythm, in beats
      if (v.phraseQ.length) {
        const iv = (v.lastBeats * beat) / speed;
        const wobble = Math.exp(gauss(this.rng) * 0.12 * u * (1 - c.tempo.lock));
        return this.snap(t, Math.max(0.1, iv * wobble), grid / Math.min(2, Math.max(1, speed)), c.tempo.lock > 0.25 ? 1 : 0);
      }
      // between phrases: a breath. Density decides how long
      const actFactor = 0.4 + 1.2 * v.layer.activity * v.mods.act;
      let restBeats = (0.5 + 5 * Math.pow(1 - d, 1.5)) * (1.2 / actFactor) * (0.6 + this.rng() * 0.9);
      const rel = v.layer.relation.type;
      if (rel === "answers" || rel === "follows") restBeats *= 2.5; // mostly speaks when spoken to
      restBeats *= 1 + 0.75 * this.ruleProgress("driftApart") * v.spread;
      const iv = ((v.lastBeats + restBeats) * beat) / speed;
      return this.snap(t, Math.max(0.2, iv), beat, clamp(c.tempo.lock * (1 - u * 0.35)));
    }

    const base = { melody: 2.6, bells: 5, bass: 13, texture: 3.2, pad: 10, drums: 4 }[v.layer.role];
    const paceFactor = 1.9 - 1.45 * this.pace();
    const densFactor = 0.3 + 3.6 * Math.pow(d, 1.3);
    const actFactor = 0.35 + 1.25 * v.layer.activity * v.mods.act;
    let mean = (base * paceFactor) / (densFactor * actFactor * speed);
    const rel = v.layer.relation.type;
    if (rel === "answers" || rel === "follows") mean *= 1.8; // mostly speaks when spoken to
    const drift = this.ruleProgress("driftApart");
    mean *= 1 + 0.75 * drift * v.spread;

    // phrase-level breathing: after a few notes, a longer rest
    v.sinceRest++;
    if (v.sinceRest >= v.phraseTarget) {
      mean *= (1.6 + this.rng() * 2) * (1.2 - d * 0.5);
      v.sinceRest = 0;
      v.phraseTarget = 3 + Math.floor(this.rng() * 5);
    }

    // locked timing is less jittery; free timing follows unpredictability
    const jitter = (0.1 + 0.75 * u) * (1 - c.tempo.lock * 0.6);
    const iv = Math.max(0.12, mean * Math.exp(gauss(this.rng) * jitter));
    // "pulse": how strictly notes fall on the shared beat grid
    const lockChance = clamp(c.tempo.lock * (1 - u * 0.35));
    return this.snap(t, iv, grid / Math.min(2, Math.max(1, speed)), lockChance);
  }

  /** Put an absolute time on the half-beat grid, as often as the pulse asks. */
  private onGrid(time: number): number {
    const lock = this.config.tempo.lock;
    if (lock <= 0 || this.rng() >= lock) return time;
    const grid = 60 / this.config.tempo.bpm / 2;
    const k = Math.ceil((time - this.startedAt) / grid - 1e-6);
    return this.startedAt + k * grid + this.swingOffset(k, grid);
  }

  /** With probability `chance`, move t+iv onto the beat grid. */
  private snap(t: number, iv: number, grid: number, chance: number): number {
    if (chance <= 0 || this.rng() >= chance) return iv;
    const k = Math.ceil((t + iv - this.startedAt) / grid - 1e-6);
    const target = this.startedAt + k * grid + this.swingOffset(k, grid);
    return Math.max(grid * 0.5, target - t);
  }

  /** Swing pushes every other grid step a little late. */
  private swingOffset(k: number, grid: number): number {
    return k % 2 === 1 ? this.config.tempo.swing * grid * 0.33 : 0;
  }

  /** Which layers are allowed to play, driven by density and evolution. */
  private updateActiveSet(): void {
    const list = [...this.voices.values()].filter((v) => v.layer.enabled);
    if (this.config.engine.type === "composed" || this.config.engine.type === "ambient") {
      // the composer decides who plays; every enabled layer is available
      this.activeIds = new Set(list.map((v) => v.layer.id));
      return;
    }
    const n = list.length;
    const arcOn = this.config.arc.shape !== "off";
    const d = this.density();
    // with an arc, layers join one by one as intensity rises
    const count = arcOn ? clamp(Math.round(1 + this.arcIntensity() * (n - 0.6)), 1, n) : clamp(Math.round(2 + d * (n - 1) * 1.4), 1, n);
    const order = new Map(this.config.layers.map((l, i) => [l.id, i]));
    const priority = (v: Voice) => {
      if (arcOn) return 100 - (order.get(v.layer.id) ?? 50) - (v.runtime ? 20 : 0);
      let p = v.layer.activity * v.mods.act;
      if (v.layer.role === "pad") p += 10;
      if (v.layer.prominence === "leads") p += 5;
      if (v.runtime) p += 3; // a newly introduced instrument should be heard
      return p;
    };
    // layers that only answer or follow another don't use up a slot:
    // they speak when spoken to, so they come along with their partner
    const isResponder = (v: Voice) => (v.layer.relation.type === "answers" || v.layer.relation.type === "follows") && !!v.layer.relation.target && this.voices.has(v.layer.relation.target);
    const independent = list.filter((v) => !isResponder(v));
    const firstMelodic = arcOn ? undefined : independent.filter((v) => MELODIC.has(v.layer.role)).sort((a, b) => priority(b) - priority(a))[0];
    const sorted = [...independent].sort((a, b) => priority(b) - priority(a) + (b === firstMelodic ? 4 : 0) - (a === firstMelodic ? 4 : 0));
    const slots = clamp(count, Math.min(1, independent.length), independent.length);
    const active = new Set(sorted.slice(0, slots).map((v) => v.layer.id));
    for (const v of list) if (isResponder(v) && active.has(v.layer.relation.target!)) active.add(v.layer.id);
    this.activeIds = active;
  }

  /** Slow change over time: the "evolution" control. */
  private evolve(now: number, dt: number): void {
    const ev = this.config.macro.evolution;
    const k = Math.sqrt(dt / 2);
    for (const v of this.voices.values()) {
      v.mods.act = clamp(v.mods.act + gauss(this.rng) * 0.06 * ev * k + (1 - v.mods.act) * 0.03, 0.45, 1.6);
      v.mods.reg = clamp(v.mods.reg + gauss(this.rng) * 0.5 * ev * k - v.mods.reg * 0.02, -5, 5);
      v.mods.bright = clamp(v.mods.bright + gauss(this.rng) * 0.08 * ev * k - v.mods.bright * 0.03, -0.8, 0.8);
    }
    // melodies evolve: motifs change a note or a rhythm now and then
    for (const v of this.voices.values()) {
      if (!v.motifs.length) continue;
      if (this.rng() < ev * 0.12 * k) {
        const i = this.rng() < 0.3 ? 0 : 1;
        if (v.motifs[i]) v.motifs[i] = mutateMotif(this.rng, v.motifs[i]);
      }
      if (this.rng() < ev * 0.02 * k) v.motifs[1] = makeMotif(this.rng, v.layer.role, v.layer.movement, this.config.macro.density);
    }
    // rarely, at high evolution, the music moves to a closely related key
    if (this.config.engine.type === "layers" && this.rng() < ev * ev * 0.004 * k) {
      const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
      const i = ROOTS.indexOf(this.config.harmony.root);
      const shift = this.rng() < 0.5 ? 7 : 5;
      this.config.harmony.root = ROOTS[(i + shift) % 12];
      this.chord.next = Math.min(this.chord.next, now + 2);
    }
    this.updateActiveSet();
    this.applyAudioParams(2);

    // continuous rules announce themselves while they are changing things
    for (const type of ["driftApart", "erode", "thinHighs"] as const) {
      const r = this.rule(type);
      if (r && this.progressOf(r, now) < 1) this.fire(r, now, 6);
    }
  }

  /* ---------------- harmony ---------------- */

  private changeChord(time: number): void {
    const c = this.config;
    const first = this.chord.pcs.length === 0;
    const scale = scaleOf(c.harmony);
    // Surprise controls how far the harmony may wander from the expected move
    const prog = c.harmony.progression;
    const degree = prog ? prog.degrees[this.progIndex++ % prog.degrees.length] % scale.length : first ? 0 : nextDegree(this.rng, scale, this.chord.degree, this.effectiveU() * 0.2 + c.behavior.surprises * 0.7);
    const pcs = chordPcs(c.harmony.root, scale, degree, c.harmony.tension);
    const mix = 0.55 * c.harmony.chordChange + 0.45 * c.macro.evolution;
    let len = (44 - 37 * mix) * (0.75 + this.rng() * 0.5) * (1.4 - this.pace() * 0.6);
    if (prog) len = prog.bars * 4 * (60 / c.tempo.bpm); // a progression keeps strict time
    else if (c.tempo.lock > 0.5) {
      const bar = (60 / c.tempo.bpm) * 4;
      len = Math.max(bar, Math.round(len / bar) * bar);
    }
    this.chord = { degree, pcs, next: time + len };
    this.emit({ kind: "chord", time, pcs });

    for (const v of this.voices.values()) {
      if (!v.layer.enabled || !this.activeIds.has(v.layer.id)) continue;
      if (v.layer.role === "pad") this.playPad(v, time, len);
      else if (v.layer.role === "bass" && this.rng() < 0.85) {
        // the bass lands on the new chord's root
        const [lo, hi] = this.rangeFor(v);
        let root = lo + ((pcs[0] - (lo % 12) + 12) % 12);
        if (root > hi) root -= 12;
        this.play(v, time, root);
        v.nextTime = Math.max(v.nextTime, time + (60 / c.tempo.bpm) * 2);
      }
    }
  }

  private playPad(v: Voice, time: number, len: number): void {
    const c = this.config;
    const [lo, hi] = this.rangeFor(v);
    const prev = this.padVoicing.get(v.layer.id) ?? [];
    const dd = this.density();
    const size = dd < 0.2 ? 2 : dd < 0.6 ? 3 : 4;
    const pcs = this.chord.pcs.slice(0, Math.max(size, 2));
    const notes: number[] = [];
    pcs.forEach((pc, i) => {
      const options: number[] = [];
      for (let m = lo; m <= hi; m++) if (m % 12 === pc) options.push(m);
      if (!options.length) return;
      // smooth voice leading: stay close to the previous chord's notes
      const target = prev[i] ?? (lo + hi) / 2;
      options.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      const m = options[0];
      if (!notes.some((n) => Math.abs(n - m) < 3)) notes.push(m);
    });
    if (!notes.length) return;

    // "never more than N sounds": a pad chord counts as one sound
    const maxR = this.rule("maxVoices");
    if (maxR && this.soundingLayerCount(time, v.layer.id) >= Math.round(maxR.value)) {
      this.ghost(v, notes[0], maxR, time);
      return;
    }
    let allowed = notes.filter((m) => this.passesRange(v, m, time));
    if (!allowed.length) return;
    // "never more than N notes": thin the chord to fit, ghost the rest
    const maxN = this.rule("maxNotes");
    if (maxN) {
      const room = Math.round(maxN.value) - this.soundingNoteCount(time);
      if (room < allowed.length) {
        for (const m of allowed.slice(Math.max(0, room))) this.ghost(v, m, maxN, time);
        allowed = allowed.slice(0, Math.max(0, room));
      }
      if (!allowed.length) return;
    }
    this.padVoicing.set(v.layer.id, allowed);

    const dur = len * (0.85 + c.behavior.overlap * 0.6);
    // pads sit underneath so melodies come through
    let vel = 0.28 + this.rng() * 0.1;
    vel = this.applyQuieter(vel, time);
    if (vel <= 0) return;
    for (const m of allowed) {
      v.synth.triggerAttackRelease(midiToFreq(m + this.detune()), dur, this.at(time), vel);
      this.sounding.push({ layerId: v.layer.id, midi: m, start: time, end: time + dur + RELEASE_TAIL[v.layer.instrument] * 0.4, fullEnd: time + dur + RELEASE_TAIL[v.layer.instrument] });
      this.emit({ kind: "note", time, layerId: v.layer.id, midi: m, velocity: vel, duration: dur, role: "pad" });
    }
    v.lastNoteTime = time;
  }

  /* ---------------- melody & notes ---------------- */

  private rangeFor(v: Voice): [number, number] {
    const drift = this.ruleProgress("driftApart");
    const shift = Math.round(v.mods.reg * this.config.macro.evolution + v.spread * drift * 7);
    return [octaveLow(v.layer.register.low) + shift, octaveHigh(v.layer.register.high) + shift];
  }

  /** Ceiling / floor rules. Returns false (and shows a ghost) if blocked. */
  private passesRange(v: Voice | null, m: number, time: number): boolean {
    const ceil = this.rule("ceiling");
    if (ceil && m > octaveHigh(ceil.value)) {
      this.ghost(v, m, ceil, time);
      return false;
    }
    const floor = this.rule("floor");
    if (floor && m < octaveLow(floor.value)) {
      this.ghost(v, m, floor, time);
      return false;
    }
    return true;
  }

  /** Every individual note still audible at `time`, fading tails included. */
  private soundingNoteCount(time: number, includeUpcoming = true): number {
    // for the hard limit, notes already scheduled to start a little later
    // (swing, humanizing, answers) count too, so they can't stack up
    let n = 0;
    for (const s of this.sounding) if ((includeUpcoming || s.start <= time + 0.01) && s.fullEnd > time) n++;
    return n;
  }

  private soundingLayerCount(time: number, exclude: string | null): number {
    const ids = new Set<string>();
    for (const s of this.sounding) if (s.start <= time + 0.01 && s.end > time && s.layerId !== exclude) ids.add(s.layerId);
    return ids.size;
  }

  private detune(): number {
    const e = this.ruleProgress("erode");
    return e > 0 ? gauss(this.rng) * e * 0.35 : 0; // up to about a third of a semitone
  }

  private applyQuieter(vel: number, time: number): number {
    const r = this.rule("eachQuieter");
    if (!r) return vel;
    // quiet.level is the loudness the next sound may have (1 = unrestricted)
    if (time - this.quiet.lastNote > 5) this.quiet.level = 1; // a silence resets it
    const out = Math.min(vel, this.quiet.level * 0.75);
    this.quiet.level = (out / 0.75) * (1 - clamp(r.value, 0.01, 0.5));
    this.quiet.lastNote = time;
    this.fire(r, time, 0.8);
    if (this.quiet.level < 0.1) {
      // fully faded: fall silent, then begin again
      this.silenceUntil = Math.max(this.silenceUntil, time + 5.5 + this.rng() * 3);
      this.emit({ kind: "silence", time, until: this.silenceUntil });
    }
    return out < 0.015 ? 0 : out;
  }

  /** Choose a pitch for a layer: scale-aware, chord-aware, and continuous. */
  private choosePitch(v: Voice, cands: number[]): number | undefined {
    const c = this.config;
    const u = this.effectiveU();
    const chord = new Set(this.chord.pcs);
    const last = v.lastMidi ?? cands[Math.floor(cands.length / 2)];
    const center = (cands[0] + cands[cands.length - 1]) / 2;
    const span = Math.max(6, cands[cands.length - 1] - cands[0]);

    // memory: replay a remembered phrase, slightly varied
    if (v.replay.length) {
      const step = v.replay.shift()!;
      const varied = this.rng() < 0.15 + u * 0.5 ? step.step + (this.rng() < 0.5 ? -2 : 2) : step.step;
      const target = last + varied;
      const sorted = [...cands].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
      return sorted[0];
    }

    const mv = v.layer.movement;
    const weights = cands.map((m) => {
      const pc = m % 12;
      const isChord = chord.has(pc);
      let w = isChord ? 3 - u * 1.2 : 1;
      // avoid notes a semitone away from the harmony unless the system is tense
      if (!isChord && [...chord].some((cp) => Math.abs(((pc - cp + 18) % 12) - 6) === 5)) w *= 0.2 + c.harmony.tension * 0.6;
      const dist = Math.abs(m - last);
      if (mv === "stepwise") w *= Math.exp(-dist / (2 + u * 6)) * (dist === 0 ? 0.3 : 1);
      else if (mv === "leaps") w *= Math.exp(-dist / (7 + u * 8)) * (dist < 3 ? 0.25 : 1);
      else if (mv === "drone") {
        const rootPc = this.chord.pcs[0];
        const fifthPc = this.chord.pcs[2] ?? rootPc;
        w *= pc === rootPc ? 6 : pc === fifthPc ? 3 : 0.15;
        w *= Math.exp(-dist / 10);
      } else if (mv === "arpeggio") {
        if (!isChord) w *= 0.05;
        const dir = Math.sign(m - last);
        w *= dir === v.direction ? 2 : 0.4;
        w *= Math.exp(-dist / 6);
      }
      // gentle gravity toward the middle of the layer's range
      w *= Math.exp(-Math.pow((m - center) / span, 2) * 1.2);
      return w;
    });
    const m = weightedPick(this.rng, cands, weights);
    if (m !== undefined && mv === "arpeggio") {
      if (m >= cands[cands.length - 2]) v.direction = -1;
      else if (m <= cands[1]) v.direction = 1;
    }
    return m;
  }

  /**
   * Play one note on a layer at `time`, passing through every rule.
   * `forced` is used when another layer prompted this one.
   */
  private play(v: Voice, time: number, forced: number | null): boolean {
    const c = this.config;
    if (time < this.silenceUntil) return false;
    const u = this.effectiveU();

    // rule: melodies take turns
    const hand = this.rule("handoff");
    if (hand && MELODIC.has(v.layer.role) && forced === null) {
      if (time < this.handoff.waitUntil) return false;
      if (this.handoff.speaker && this.handoff.speaker !== v.layer.id && this.voices.has(this.handoff.speaker)) return false;
      if (!this.handoff.speaker || !this.voices.has(this.handoff.speaker)) {
        this.handoff.speaker = v.layer.id;
        this.handoff.phraseLeft = 3 + Math.floor(this.rng() * 6);
        if (this.handoff.lastSpeaker && this.handoff.lastSpeaker !== v.layer.id) {
          this.emit({ kind: "handoff", time, from: this.handoff.lastSpeaker, to: v.layer.id });
          this.fire(hand, time);
        }
      }
    }

    // relation: avoid another layer while it is sounding
    if (v.layer.relation.type === "avoids" && v.layer.relation.target) {
      const t = v.layer.relation.target;
      if (this.sounding.some((s) => s.layerId === t && s.start <= time && s.end > time)) return false;
    }

    // candidates in this layer's range, with collisions removed
    const [lo, hi] = this.rangeFor(v);
    const fullScale = scaleNotes(c.harmony.root, scaleOf(c.harmony), lo, hi);
    let cands = fullScale;
    if (!cands.length) return false;
    const others = this.sounding.filter((s) => s.layerId !== v.layer.id && s.end > time);
    cands = cands.filter((m) =>
      others.every((s) => {
        const d = Math.abs(m - s.midi);
        if (d === 0) return false; // no unisons fighting
        if (d <= 1) return false; // no semitone rubs
        if (Math.min(m, s.midi) < 50 && d <= 2) return false; // keep the low end clear
        return true;
      }),
    );
    if (!cands.length) return false;

    let midi: number | undefined;
    let isTheme = false;
    let isLocked = false;
    let inPhrase = false;
    let phraseEnd = false;
    let phrasePos = 0;
    if (forced !== null) {
      midi = [...cands].sort((a, b) => Math.abs(a - forced) - Math.abs(b - forced))[0];
    } else {
      const phraseStart = this.phrased(v) ? v.phraseQ.length === 0 : v.lastMidi === null || time - v.lastNoteTime > 2.5;
      if (phraseStart && !v.themeQueue.length) {
        // start of a phrase: maybe the user's melody, maybe a remembered phrase
        if (v.phrase.length >= 3) {
          v.memory.push(v.phrase.slice(0, 8));
          if (v.memory.length > 6) v.memory.shift();
          v.phrase = [];
        }
        const theme = v.layer.theme;
        const erosion = this.ruleProgress("erode");
        const memoryAmt = c.behavior.memory * (1 - erosion);
        if (theme && theme.steps.some((x) => x !== null) && this.rng() < theme.strength * (1 - erosion * 0.7)) {
          this.startTheme(v);
        } else if (!this.phrased(v) && v.memory.length && this.rng() < memoryAmt * 0.8) {
          v.replay = [...v.memory[Math.floor(this.rng() * v.memory.length)]];
        }
      }
      if (v.themeQueue.length) {
        const step = v.themeQueue.shift()!;
        if (step.s === null) return false; // a rest in the melody
        midi = this.themePitch(v, step.s, step.lock, fullScale, cands);
        isTheme = midi !== undefined;
        isLocked = step.lock;
      } else if (this.phrased(v)) {
        if (!v.phraseQ.length) this.startPhrase(v);
        const step = v.phraseQ.shift()!;
        v.lastBeats = step.beats;
        phraseEnd = v.phraseQ.length === 0;
        phrasePos = v.phrase_ ? (v.phrase_.steps.length - v.phraseQ.length - 1) / Math.max(1, v.phrase_.steps.length - 1) : 0;
        midi = this.phrasePitch(v, step.s, phraseEnd, fullScale, cands);
        inPhrase = true;
        if (v.answerFrom) {
          this.emit({ kind: "relation", time, from: v.answerFrom, to: v.layer.id, type: "answers" });
          v.answerFrom = null;
        }
      } else {
        midi = this.choosePitch(v, cands);
      }
    }
    if (midi === undefined) return false;

    // rule: ceiling / floor
    if (!this.passesRange(v, midi, time)) {
      const allowed = cands.filter((m) => {
        const ceil = this.rule("ceiling");
        const floor = this.rule("floor");
        return (!ceil || m <= octaveHigh(ceil.value)) && (!floor || m >= octaveLow(floor.value));
      });
      if (!allowed.length) return false;
      midi = [...allowed].sort((a, b) => Math.abs(a - midi!) - Math.abs(b - midi!))[0];
    }

    // rule: higher notes become rarer over time
    const thin = this.rule("thinHighs");
    if (thin && midi >= 67) {
      const p = this.progressOf(thin, time);
      const height = clamp((midi - 64) / 24);
      if (this.rng() < p * 0.95 * (0.4 + height)) {
        this.ghost(v, midi, thin, time);
        return false;
      }
    }

    // rule: never more than N sounds at once
    const maxR = this.rule("maxVoices");
    if (maxR && this.soundingLayerCount(time, v.layer.id) >= Math.round(maxR.value)) {
      this.ghost(v, midi, maxR, time);
      return false;
    }
    // rule: never more than N notes at once (hard limit, fading tails count)
    const maxN = this.rule("maxNotes");
    if (maxN && this.soundingNoteCount(time) >= Math.round(maxN.value)) {
      this.ghost(v, midi, maxN, time);
      return false;
    }

    // dynamics
    const roleVel = { melody: 0.55, bells: 0.42, bass: 0.55, texture: 0.36, pad: 0.4, drums: 0.7 }[v.layer.role];
    let vel = roleVel * (0.72 + this.rng() * 0.5 * (0.5 + u));
    // phrases swell towards the middle and settle at the end
    if (inPhrase) vel = Math.min(1, roleVel * 1.3) * (0.82 + 0.3 * Math.sin(Math.PI * phrasePos)) * (0.92 + this.rng() * 0.16 * (0.5 + u));
    vel = this.applyQuieter(clamp(vel, 0.05, 1), time);
    if (vel <= 0) return false;

    // note length: between the layer's limits, stretched by "overlap"
    const { min, max } = v.layer.durations;
    let dur = min + (max - min) * Math.pow(this.rng(), 1.4);
    dur *= 0.55 + c.behavior.overlap * 1.1;
    if (c.behavior.overlap < 0.35 && MELODIC.has(v.layer.role)) dur = Math.min(dur, 1.6);
    if (isTheme) dur = Math.min(dur, (60 / c.tempo.bpm / clamp(v.layer.speed, 0.25, 4)) * (0.8 + c.behavior.overlap * 1.6));
    if (inPhrase) {
      // connected notes: each lasts about until the next one begins
      const beatLen = (v.lastBeats * 60) / c.tempo.bpm / clamp(v.layer.speed, 0.25, 4);
      dur = beatLen * (0.8 + c.behavior.overlap * 0.6) * (phraseEnd ? 1.8 : 1);
      dur = Math.min(dur, Math.max(v.layer.durations.max * 1.5, 1));
    }
    dur = Math.max(0.08, dur);

    v.synth.triggerAttackRelease(midiToFreq(midi + this.detune()), dur, this.at(time), vel);
    const tail = RELEASE_TAIL[v.layer.instrument];
    this.sounding.push({ layerId: v.layer.id, midi, start: time, end: time + dur + Math.min(tail, 1.5) * 0.5, fullEnd: time + dur + tail });
    this.emit({ kind: "note", time, layerId: v.layer.id, midi, velocity: vel, duration: dur, role: v.layer.role, theme: isTheme, locked: isLocked });

    if (v.lastMidi !== null && forced === null) {
      v.phrase.push({ step: midi - v.lastMidi, dur });
      if (v.phrase.length > 10) v.phrase.shift();
    }
    v.lastMidi = midi;
    v.lastNoteTime = time;

    // handoff bookkeeping
    if (hand && MELODIC.has(v.layer.role) && this.handoff.speaker === v.layer.id && forced === null) {
      this.handoff.phraseLeft--;
      if (inPhrase ? phraseEnd : this.handoff.phraseLeft <= 0) {
        this.handoff.lastSpeaker = v.layer.id;
        this.handoff.speaker = null;
        this.handoff.waitUntil = time + dur * 0.6 + 0.8 + this.rng() * 2;
        // the next voice starts promptly
        const nextVoices = [...this.voices.values()].filter((o) => o !== v && MELODIC.has(o.layer.role) && o.layer.enabled && this.activeIds.has(o.layer.id));
        if (nextVoices.length) {
          const nv = nextVoices[Math.floor(this.rng() * nextVoices.length)];
          nv.nextTime = this.handoff.waitUntil + 0.05;
          for (const o of nextVoices) if (o !== nv) o.nextTime = Math.max(o.nextTime, this.handoff.waitUntil + 2);
        } else {
          this.handoff.waitUntil = time + dur + 2;
        }
      }
    }

    // relations: other layers answer, follow, or are led by this one
    if (forced === null) this.scheduleResponses(v, midi, time);
    if (inPhrase && phraseEnd) this.answerPhraseFrom(v, time);
    return true;
  }

  private scheduleResponses(src: Voice, midi: number, time: number): void {
    for (const o of this.voices.values()) {
      if (o === src || !o.layer.enabled) continue;
      const rel = o.layer.relation;
      let type: string | null = null;
      if (rel.target === src.layer.id && rel.type === "answers" && !(this.phrased(src) && this.phrased(o)) && this.rng() < 0.35 + 0.45 * this.config.macro.density) type = "answers";
      if (rel.target === src.layer.id && rel.type === "follows" && this.rng() < 0.7) type = "follows";
      if (src.layer.relation.type === "leads" && src.layer.relation.target === o.layer.id && this.rng() < 0.6) type = "follows";
      if (!type) continue;
      if (type === "answers") {
        const intervals = [-3, -4, -5, 3, 4, 7, -7];
        this.pending.push({ voiceId: o.layer.id, time: this.onGrid(time + 0.8 + this.rng() * 1.8), midi: midi + intervals[Math.floor(this.rng() * intervals.length)], from: src.layer.id, type });
      } else {
        const [lo, hi] = this.rangeFor(o);
        let m = midi;
        while (m > hi) m -= 12;
        while (m < lo) m += 12;
        this.pending.push({ voiceId: o.layer.id, time: this.onGrid(time + 0.3 + this.rng() * 0.6), midi: m, from: src.layer.id, type });
      }
    }
  }

  /** Quickly fade the oldest ringing notes until at most `n` remain. */
  private trimToNoteLimit(n: number, now: number): void {
    const ringing = this.sounding.filter((s) => s.start <= now + 0.01 && s.fullEnd > now).sort((a, b) => a.start - b.start);
    const excess = ringing.slice(0, Math.max(0, ringing.length - n));
    const byVoice = new Map<Voice, Sounding[]>();
    for (const s of excess) {
      const v = this.voices.get(s.layerId);
      if (v && !v.kit) byVoice.set(v, [...(byVoice.get(v) ?? []), s]);
      s.end = s.fullEnd = now + 0.3;
    }
    for (const [v, notes] of byVoice) {
      try {
        // shorten the release just for this cut, then restore it
        const original = (v.synth.get() as { envelope?: { release?: number } }).envelope?.release ?? 1;
        v.synth.set({ envelope: { release: 0.2 } } as never);
        for (const s of notes) v.synth.triggerRelease(midiToFreq(s.midi), now);
        setTimeout(() => v.synth.set({ envelope: { release: original } } as never), 600);
      } catch (err) {
        console.warn("[drift] could not trim notes", err);
      }
    }
  }

  /* ---------------- ambient engine ---------------- */

  private learned: Matrix | null = null;
  private markovMatrix(): Matrix {
    if (this.config.markov) return this.config.markov.matrix;
    if (!this.learned) this.learned = learnedMatrix();
    return this.learned;
  }

  /**
   * Loop lengths that never line up (in seconds, at 60 BPM). Because no
   * length divides another, the voices drift in and out of phase and the
   * combination of notes never repeats exactly.
   */
  private static LOOPS = [23.3, 17.9, 29.1, 31.7, 19.7, 37.3];

  private ambientInit(v: Voice, now: number): void {
    const c = this.config;
    const loopVoices = [...this.voices.values()].filter((x) => x.layer.role !== "pad" && x.layer.role !== "bass" && !x.kit);
    const i = Math.max(0, loopVoices.indexOf(v));
    const length = Engine.LOOPS[i % Engine.LOOPS.length] * (60 / c.tempo.bpm) * (i >= Engine.LOOPS.length ? 1.13 : 1);
    // a few notes placed at fixed points in the loop, well apart
    const count = clamp(Math.round(1 + v.layer.activity * 3 * (0.5 + c.macro.density)), 1, 5);
    const offsets: number[] = [];
    for (let tries = 0; offsets.length < count && tries < 60; tries++) {
      const o = 0.3 + this.rng() * (length - 2.5);
      if (offsets.every((x) => Math.abs(x - o) > Math.min(3, length / (count + 1)))) offsets.push(o);
    }
    offsets.sort((a, b) => a - b);
    // every loop opens with a note straight away, so nothing waits in silence
    if (offsets.length && offsets[0] > 2) offsets[0] = 0.3 + this.rng() * 1.5;
    // the first notes come from the chain too
    const m = this.markovMatrix();
    let state = this.rng() < 0.5 ? 0 : 4;
    const slots = offsets.map((offset) => {
      state = nextState(this.rng, m, state);
      return { offset, state };
    });
    const start = now + 0.5 + i * 1.7;
    v.amb = { length, start, slots, index: 0, pass: 0, state: slots[0]?.state ?? 0, next: start + (slots[0]?.offset ?? 0) };
  }

  private ambientStep(v: Voice): void {
    const a = v.amb!;
    const c = this.config;
    const slot = a.slots[a.index];
    // loose, human timing: the more unpredictable, the more each note breathes
    const t = a.start + slot.offset + gauss(this.rng) * 0.25 * this.effectiveU();
    try {
      // each time round the loop, some notes are chosen afresh by the chain;
      // the rest repeat, like a tape loop. Evolution decides how many change.
      if (a.index === 0 && a.pass > 0) {
        const m = this.markovMatrix();
        let prev = a.slots[a.slots.length - 1].state;
        for (const s of a.slots) {
          if (this.rng() < 0.15 + 0.6 * c.macro.evolution) {
            const from = prev;
            // Unpredictability: now and then the chain is ignored for a fresh note
            s.state = this.rng() < this.effectiveU() * 0.2 ? Math.floor(this.rng() * 8) : nextState(this.rng, m, prev);
            this.emit({ kind: "markov", time: a.start + s.offset, layerId: v.layer.id, from, to: s.state });
          }
          prev = s.state;
        }
      }
      a.state = slot.state;
      this.ambientNote(v, slot, t);
    } finally {
      a.index++;
      if (a.index >= a.slots.length) {
        a.index = 0;
        a.pass++;
        a.start += a.length;
      }
      a.next = a.start + a.slots[a.index].offset;
    }
  }

  private ambientNote(v: Voice, slot: { offset: number; state: number }, t: number): void {
    const c = this.config;
    const scale = scaleOf(c.harmony);
    const home = rootPc(c.harmony.root);
    const lo = octaveLow(v.layer.register.low);
    const centre = (lo + octaveHigh(v.layer.register.high)) / 2 - 4;
    let tonic = lo + ((home - (lo % 12) + 12) % 12);
    while (tonic + 12 <= centre) tonic += 12;
    const toMidi = (st: number) => (st >= 7 ? tonic + 12 : tonic + scale[st % scale.length] + 12 * Math.floor(st / scale.length));
    // never rub a semitone against something already sounding: ask the chain again
    const others = this.sounding.filter((s) => s.layerId !== v.layer.id && s.fullEnd > t);
    let state = slot.state;
    for (let tries = 0; tries < 4; tries++) {
      const m = toMidi(state);
      if (others.every((s) => Math.abs(((m - s.midi) % 12 + 12) % 12) !== 1 && Math.abs(((m - s.midi) % 12 + 12) % 12) !== 11)) break;
      state = nextState(this.rng, this.markovMatrix(), state);
      if (tries === 3) return; // leave a space instead
    }
    slot.state = state;
    const { min, max } = v.layer.durations;
    const dur = Math.max(1.5, min + (max - min) * this.rng()) * (0.7 + c.behavior.overlap * 0.6);
    const prom = v.layer.prominence === "leads" ? 1.15 : v.layer.prominence === "recedes" ? 0.75 : 1;
    const vel = clamp((0.24 + 0.16 * this.rng()) * prom * (0.7 + 0.6 * c.macro.intensity));
    this.composedNote(v, toMidi(state), t, dur, vel);
  }

  /* ---------------- composed engine ---------------- */

  /** Bars in one Beginning → Release cycle: shorter when Evolution is high. */
  private cycleLength(): number {
    const ev = this.config.macro.evolution;
    return Math.max(12, Math.round((40 - 24 * ev) * (0.85 + this.rng() * 0.3)));
  }

  private formPosition(): number {
    const bar = Math.floor(this.comp.step / STEPS);
    return clamp((bar - this.comp.cycleStartBar + (this.comp.step % STEPS) / STEPS) / this.comp.cycleBars);
  }

  /** The progression in use: the user's, or one suited to the mode. */
  private composedProgression(): { degrees: number[]; bars: number } {
    const h = this.config.harmony;
    if (h.progression) return h.progression;
    const family = ["minor", "phrygian", "minorPentatonic", "japanese"].includes(h.mode) ? "minor" : ["dorian", "wholeTone"].includes(h.mode) ? "modal" : "major";
    return { degrees: PROGRESSIONS[family], bars: 2 };
  }

  /** One eighth-note pulse: every pattern layer reads the same clock. */
  private composedStep(): void {
    const c = this.config;
    const st = this.comp;
    const idx = st.step % STEPS;
    const bar = Math.floor(st.step / STEPS);
    const eighth = 60 / c.tempo.bpm / 2;
    const u = this.effectiveU();
    const t = st.gridTime;

    try {
      if (idx === 0) this.composedBar(bar, t);
      const E = st.energy;
      const voices = [...this.voices.values()].filter((v) => v.layer.enabled && st.on.has(v.layer.id));
      const pulses = voices.filter((v) => v.layer.role === "bells");
      const locks = voices.filter((v) => v.layer.role === "texture");
      const melodies = voices.filter((v) => v.layer.role === "melody");
      const accent = idx === 0 ? 1 : idx % 3 === 0 ? 0.86 : 0.7; // a lilt in threes
      const human = () => gauss(this.rng) * 0.007 * u;

      // Layer 1: the pulse motif, notes added one by one
      pulses.forEach((v, k) => {
        const pattern = PULSE[(k + st.variant) % PULSE.length];
        const tone = pattern[idx];
        if (tone === null || !this.patternHas(v, pattern, idx, E, 0.05 + 0.25 * k)) return;
        const lad = ladder(this.chord.pcs, octaveLow(Math.max(3, v.layer.register.low)));
        const midi = lad[Math.min(lad.length - 1, tone + (k > 0 ? 2 : 0))];
        const vel = clamp((0.42 + 0.3 * E) * accent * (0.9 + this.rng() * 0.2));
        this.composedNote(v, midi, t + human(), eighth * (v.layer.instrument === "piano" ? 2.5 : 1.4), vel);
      });

      // Layer 2: interlocking motif in the pulse's rests (phase-shifted over time)
      locks.forEach((v, k) => {
        const base = PULSE[(st.variant + k) % PULSE.length];
        const rests = base.map((x, i) => (x === null ? i : -1)).filter((i) => i >= 0).map((i) => (i + st.shift + k * 2) % STEPS);
        const pos = rests.indexOf(idx);
        if (pos < 0) return;
        const pseudo = Array.from({ length: STEPS }, (_, i) => (rests.includes(i) ? 0 : null));
        if (!this.patternHas(v, pseudo, idx, E, 0.45 + 0.15 * k)) return;
        const motif = INTERLOCK[(st.variant + k) % INTERLOCK.length];
        let tone = motif[pos % motif.length];
        if (this.rng() < u * 0.12) tone += this.rng() < 0.5 ? -1 : 1; // a small, harmonic variation
        const lad = ladder(this.chord.pcs, octaveLow(Math.max(3, v.layer.register.low)));
        const midi = lad[Math.max(0, Math.min(lad.length - 1, tone))];
        const vel = clamp((0.32 + 0.25 * E) * (0.88 + this.rng() * 0.24));
        this.composedNote(v, midi, t + human(), eighth * 1.8, vel);
      });

      // the melody: phrases written in a style learned from real music
      melodies.forEach((v, k) => this.composedMelodyStep(v, k, st.step, idx, t + human(), E, eighth));

      // Layer 4: low support on the strong beats
      for (const v of voices.filter((x) => x.layer.role === "bass")) {
        const hit = BASS.find((b) => b.step === idx && E >= b.minE);
        if (!hit) continue;
        // the bass ladder starts on the chord's root, so the low line grounds each chord
        const lowest = octaveLow(Math.max(1, Math.min(2, v.layer.register.low)));
        const rootMidi = lowest + ((this.chord.pcs[0] - (lowest % 12) + 12) % 12);
        const lad = ladder(this.chord.pcs.slice(0, 3), rootMidi);
        this.composedNote(v, lad[hit.tone], t, eighth * hit.len, clamp((0.45 + 0.2 * E) * (idx === 0 ? 1 : 0.8)));
      }
    } finally {
      st.step++;
      st.gridTime = t + eighth;
    }
  }

  /** Bar lines: form, layer entries, chord changes, and slow variation. */
  private composedBar(bar: number, t: number): void {
    const c = this.config;
    const st = this.comp;
    // a new cycle of the form: same material, subtly varied
    if (bar - st.cycleStartBar >= st.cycleBars) {
      st.cycleStartBar = bar;
      st.cycleBars = this.cycleLength();
      if (this.rng() < 0.3 + c.macro.evolution * 0.5) st.variant++;
      if (this.rng() < c.macro.evolution) st.shift = (st.shift + (this.rng() < 0.5 ? 1 : STEPS - 1)) % STEPS;
      st.orders.clear();
    }
    const { phase, energy } = form(this.formPosition());
    st.phase = phase;
    // Intensity scales how full the texture can get
    st.energy = clamp(0.06 + energy * (0.45 + 0.75 * c.macro.intensity));
    const E = st.energy;

    // layers join (and leave) on bar lines, in a fixed order
    const all = [...this.voices.values()].filter((v) => v.layer.enabled);
    const nth = (role: Layer["role"][], v: Voice) => all.filter((x) => role.includes(x.layer.role)).indexOf(v);
    const on = new Set<string>();
    for (const v of all) {
      const r = v.layer.role;
      let need = 0;
      if (r === "bells") need = 0.05 + 0.25 * nth(["bells"], v); // the pulse starts the piece
      else if (r === "melody") need = 0.24 + 0.3 * nth(["melody"], v);
      else if (r === "bass") need = 0.3;
      else if (r === "texture") need = 0.45 + 0.15 * nth(["texture"], v);
      else if (r === "drums") need = 0; // drums are the user's call: on means on
      if (E >= need) on.add(v.layer.id);
    }
    for (const id of on) if (!st.on.has(id)) {
      const v = this.voices.get(id);
      if (v) {
        this.emit({ kind: "layerEnter", time: t, layerId: id, name: v.layer.name });
        void v;
      }
    }
    st.on = on;

    // harmony moves on bar lines only
    const prog = this.composedProgression();
    if (bar === 0 || (bar - st.chordBar) % Math.max(1, Math.round(prog.bars)) === 0) {
      st.chordBar = bar;
      const scale = scaleOf(c.harmony);
      const degree = prog.degrees[this.progIndex++ % prog.degrees.length] % scale.length;
      const richness = clamp(c.harmony.tension * (0.4 + 0.9 * E)); // richer chords at the peak
      const pcs = chordPcs(c.harmony.root, scale, degree, richness);
      this.chord = { degree, pcs, next: Infinity };
      this.emit({ kind: "chord", time: t, pcs });
      const barLen = (60 / c.tempo.bpm / 2) * STEPS;
      for (const v of all) if (v.layer.role === "pad") this.playPad(v, t, barLen * Math.max(1, prog.bars));
      // now and then the interlock drifts by one step against the pulse
      if (bar > 0 && this.rng() < c.macro.evolution * 0.2) st.shift = (st.shift + 1) % STEPS;
    }
  }

  /** Write (or reuse) a melody period: statement, varied repeat, contrast, return. */
  private composeMelodyPeriod(v: Voice): void {
    const h = this.config.harmony;
    const family = ["minor", "phrygian", "minorPentatonic", "japanese", "dorian"].includes(h.mode) ? "minor" : "major";
    const model = styleFor(family);
    const chordDegs = [0, 2, 4];
    const start = chordDegs[Math.floor(this.rng() * chordDegs.length)];
    const a = writePhrase(this.rng, model, 24, start);
    const a1 = varyPhrase(this.rng, model, a);
    const b = writePhrase(this.rng, model, 24, start + (this.rng() < 0.5 ? 2 : 4));
    const a2 = varyPhrase(this.rng, model, a);
    // the period comes home: the last note lands on the home note
    const last = a2[a2.length - 1];
    last.deg = Math.abs(last.deg - 7) < Math.abs(last.deg) ? 7 : 0;
    v.period = [a, a1, b, a2];
    v.periodIndex = 0;
  }

  private composedMelodyStep(v: Voice, k: number, step: number, idx: number, time: number, E: number, eighth: number): void {
    const c = this.config;
    // a new phrase may only begin on a bar line
    if ((!v.mplan || step >= v.mplan.end) && idx === 0) {
      const cycle = this.comp.cycleStartBar;
      // the melody keeps its identity across cycles, renewed now and then
      if (!v.period.length || (v.periodCycle !== cycle && this.rng() < 0.25 + c.macro.evolution * 0.5)) this.composeMelodyPeriod(v);
      v.periodCycle = cycle;
      const i = v.periodIndex % 4;
      const phrase = v.period[i];
      v.periodIndex++;
      // breathe between phrases; longer breaths when the texture is thin
      const rest = E < 0.45 || this.config.macro.density < 0.3 ? (i % 2 === 1 ? 1 : 0) : 0;
      v.mplan = { notes: phrase, startStep: step + k * 6, end: step + 24 + rest * STEPS, last: i === 3 };
    }
    const plan = v.mplan;
    if (!plan) return;
    const at = step - plan.startStep;
    const n = plan.notes.find((x) => x.at === at);
    if (!n) return;
    const scale = scaleOf(c.harmony);
    const chord = new Set(this.chord.pcs);
    const home = rootPc(c.harmony.root);
    const lo = octaveLow(v.layer.register.low);
    const centre = (lo + octaveHigh(v.layer.register.high)) / 2 - 5;
    let tonic = lo + ((home - (lo % 12) + 12) % 12);
    while (tonic + 12 <= centre) tonic += 12;
    const toMidi = (d: number) => {
      const len = scale.length;
      return tonic + scale[((d % len) + len) % len] + 12 * Math.floor(d / len);
    };
    let deg = n.deg;
    // strong beats and phrase endings sit on a note of the current chord
    const strong = n.at % 6 === 0 || n === plan.notes[plan.notes.length - 1];
    if (strong && !chord.has(toMidi(deg) % 12)) {
      for (const d of [1, -1, 2, -2]) if (chord.has(toMidi(deg + d) % 12)) {
        deg += d;
        break;
      }
    }
    const pos = plan.notes.indexOf(n) / Math.max(1, plan.notes.length - 1);
    const vel = clamp((0.5 + 0.25 * E) * (0.85 + 0.25 * Math.sin(Math.PI * pos)) * (n.at % 12 === 0 ? 1.05 : 1) * (0.94 + this.rng() * 0.12));
    const sustain = v.layer.instrument === "piano" ? 1.6 : 1.04;
    this.composedNote(v, toMidi(deg), time, n.dur * eighth * sustain, vel);
  }

  /** Is this pattern note present right now? (the additive process) */
  private patternHas(v: Voice, pattern: (number | null)[], idx: number, E: number, threshold: number): boolean {
    const steps = noteSteps(pattern);
    if (!steps.length) return false;
    const key = `${v.layer.id}:${pattern.join(",")}`;
    let order = this.comp.orders.get(key);
    if (!order) {
      order = additiveOrder(this.rng, steps);
      this.comp.orders.set(key, order);
    }
    const fill = clamp(0.25 + (E - threshold) * 1.6) * (0.45 + 0.55 * this.config.macro.density) + 0.12;
    const count = Math.max(2, Math.min(steps.length, Math.round(steps.length * fill)));
    return order.slice(0, count).includes(idx);
  }

  /** Play one composed note through the hard rules. */
  private composedNote(v: Voice, midi: number | undefined, time: number, dur: number, vel: number): void {
    if (midi === undefined) return;
    if (!this.passesRange(v, midi, time)) return;
    const maxR = this.rule("maxVoices");
    if (maxR && this.soundingLayerCount(time, v.layer.id) >= Math.round(maxR.value)) return this.ghost(v, midi, maxR, time);
    const maxN = this.rule("maxNotes");
    if (maxN && this.soundingNoteCount(time) >= Math.round(maxN.value)) return this.ghost(v, midi, maxN, time);
    const level = this.applyQuieter(vel, time);
    if (level <= 0) return;
    v.synth.triggerAttackRelease(midiToFreq(midi + this.detune()), Math.max(0.08, dur), this.at(time), level);
    const tail = RELEASE_TAIL[v.layer.instrument];
    this.sounding.push({ layerId: v.layer.id, midi, start: time, end: time + dur, fullEnd: time + dur + tail });
    this.emit({ kind: "note", time, layerId: v.layer.id, midi, velocity: level, duration: dur, role: v.layer.role });
    v.lastMidi = midi;
    v.lastNoteTime = time;
  }

  /* ---------------- phrase-based melody ---------------- */

  /** Layers that write melodies in phrases (rather than single tones). */
  private phrased(v: Voice): boolean {
    const r = v.layer.role;
    return r === "melody" || r === "bells" || (r === "texture" && v.layer.movement !== "drone");
  }

  private newMotifs(v: Voice): Motif[] {
    const d = this.config.macro.density;
    // two contrasting ideas: one rises, one falls
    const up = this.rng() < 0.5;
    return [makeMotif(this.rng, v.layer.role, v.layer.movement, d, up), makeMotif(this.rng, v.layer.role, v.layer.movement, d, !up)];
  }

  private startPhrase(v: Voice): void {
    if (!v.motifs.length) v.motifs = this.newMotifs(v);
    const c = this.config;
    const erosion = this.ruleProgress("erode");
    const ph = composePhrase(this.rng, v.motifs, c.behavior.memory * (1 - erosion), this.effectiveU(), v.phraseIndex++);
    this.loadPhrase(v, ph);
  }

  private loadPhrase(v: Voice, ph: Phrase): void {
    v.phrase_ = ph;
    v.phraseQ = ph.steps.map((s, i) => ({ s, beats: ph.beats[i] ?? 1 }));
    v.phraseAnchor = null;
  }

  /**
   * Where a phrase starts: a chord note close to where this layer last
   * was (so phrases connect), or near the middle of its range.
   */
  private phraseAnchorFor(v: Voice, scale: number[]): number {
    const chord = new Set(this.chord.pcs);
    const centre = (scale[0] + scale[scale.length - 1]) / 2;
    // start near where the layer was, but pulled back towards the middle,
    // so phrases connect without drifting to the edge of the range
    const target = v.lastMidi === null ? centre : v.lastMidi * 0.45 + centre * 0.55;
    let best = Math.floor(scale.length / 2);
    let bestD = Infinity;
    scale.forEach((m, i) => {
      const d = Math.abs(m - target) + (chord.has(m % 12) ? 0 : 5);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    // make the whole phrase fit inside the range
    if (v.phrase_) {
      const lo = Math.min(...v.phrase_.steps);
      const hi = Math.max(...v.phrase_.steps);
      if (hi - lo < scale.length) best = Math.max(-lo, Math.min(scale.length - 1 - hi, best));
    }
    return best;
  }

  private phrasePitch(v: Voice, step: number, last: boolean, scale: number[], cands: number[]): number | undefined {
    if (!scale.length) return undefined;
    if (v.phraseAnchor === null || v.phraseAnchor >= scale.length) v.phraseAnchor = this.phraseAnchorFor(v, scale);
    // if a step still leaves the range, fold it back in (never pile up on the edge)
    let idx = v.phraseAnchor + step;
    const top = scale.length - 1;
    if (top <= 0) idx = 0;
    else while (idx < 0 || idx > top) idx = idx < 0 ? -idx : 2 * top - idx;
    let target = scale[idx];
    if (last && v.phrase_) {
      // cadence: answers come home; questions rest on a chord note
      const home = rootPc(this.config.harmony.root);
      const chord = new Set(this.chord.pcs);
      const want = (m: number) => (v.phrase_!.cadence === "home" ? m % 12 === home : chord.has(m % 12));
      const near = scale.filter(want).sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      if (near !== undefined && Math.abs(near - target) <= 4) target = near;
    }
    if (cands.includes(target)) return target;
    // the exact note would clash: take the nearest that fits, but not a
    // repeat of the previous note (that is what made melodies sound stuck)
    const options = [...cands].sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    return options.find((m) => m !== v.lastMidi) ?? options[0];
  }

  /** When a phrase ends, layers that answer this one reply with a phrase. */
  private answerPhraseFrom(src: Voice, time: number): void {
    if (!src.phrase_) return;
    const beat = 60 / this.config.tempo.bpm;
    for (const o of this.voices.values()) {
      if (o === src || !o.layer.enabled || !this.activeIds.has(o.layer.id)) continue;
      if (o.layer.relation.type !== "answers" || o.layer.relation.target !== src.layer.id || !this.phrased(o)) continue;
      if (o.phraseQ.length || o.themeQueue.length) continue;
      if (this.rng() > 0.7 + 0.25 * this.config.macro.density) continue;
      this.loadPhrase(o, answerPhrase(this.rng, src.phrase_));
      o.answerFrom = src.layer.id;
      o.nextTime = this.onGrid(time + src.lastBeats * beat / clamp(src.layer.speed, 0.25, 4) + beat * (0.5 + this.rng()));
    }
  }

  /* ---------------- drum machine ---------------- */

  /** A pattern from density, activity and tempo: probabilities per step. */
  private drumPattern(v: Voice): Record<DrumHit, number[]> {
    const c = this.config;
    const d = clamp(c.macro.density * 0.7 + v.layer.activity * 0.6);
    const z = () => Array(16).fill(0) as number[];
    const kick = z();
    const snare = z();
    const hat = z();
    const openhat = z();
    const halftime = c.tempo.bpm < 85;
    if (d > 0.55 && !halftime) {
      for (const s of [0, 4, 8, 12]) kick[s] = 0.95; // four on the floor
    } else {
      kick[0] = 0.95;
      kick[10] = 0.35 + d * 0.4;
      kick[7] = 0.15 * d;
      kick[halftime ? 11 : 8] = 0.3 + d * 0.3;
    }
    if (halftime) snare[8] = 0.9;
    else {
      snare[4] = 0.88;
      snare[12] = 0.88;
    }
    for (let s = 0; s < 16; s++) {
      if (s % 4 === 2) hat[s] = 0.55 + d * 0.4; // off-beats
      else if (s % 2 === 0) hat[s] = 0.15 + d * 0.5;
      else hat[s] = Math.max(0, d - 0.5) * 0.9; // sixteenths when busy
    }
    openhat[14] = 0.15 + d * 0.35;
    if (d < 0.25) {
      // very sparse: a heartbeat and a few ticks
      for (let s = 0; s < 16; s++) hat[s] *= 0.4;
      snare[4] = snare[12] = 0.2;
    }
    return { kick, snare, hat, openhat };
  }

  private drumStep(v: Voice): void {
    const c = this.config;
    const st = v.drum;
    if (!st) return;
    const idx = st.step % 16;
    const sixteenth = 60 / c.tempo.bpm / 4 / clamp(v.layer.speed, 0.25, 4);
    // swing delays every other sixteenth
    const swing = idx % 2 === 1 ? c.tempo.swing * sixteenth * 0.55 : 0;
    const humanize = (1 - c.tempo.lock) * this.effectiveU() * 0.012 * gauss(this.rng);
    const t = st.gridTime + swing + humanize;
    const u = this.effectiveU();

    if (idx === 0) {
      // each bar: the pattern evolves a little, keeping its identity
      if (this.rng() < c.macro.evolution * 0.6) {
        const hits: DrumHit[] = ["kick", "snare", "hat", "openhat"];
        const h = hits[Math.floor(this.rng() * hits.length)];
        const s = Math.floor(this.rng() * 16);
        if (!(h === "kick" && s === 0)) st.pattern[h][s] = clamp(st.pattern[h][s] + (this.rng() < 0.5 ? -0.4 : 0.4));
      }
    }
    const bar = Math.floor(st.step / 16);
    const fill = bar % 4 === 3 && idx >= 12 && this.rng() < u * 0.5 ? 0.55 : 0;

    if (v.layer.enabled && this.activeIds.has(v.layer.id) && t >= this.silenceUntil) {
      for (const hit of ["kick", "snare", "hat", "openhat"] as DrumHit[]) {
        let p = st.pattern[hit][idx];
        // in a composed piece the drums swell and thin with the form
        if (c.engine.type === "composed") p *= hit === "kick" ? 0.65 + 0.35 * this.comp.energy : 0.35 + 0.65 * this.comp.energy;
        if (hit === "snare") p = Math.max(p, fill, this.rng() < u * 0.08 ? 0.5 : 0); // fills and ghost notes
        if (this.rng() >= p) continue;
        const accent = idx % 4 === 0 ? 1 : 0.8;
        const base = { kick: 0.9, snare: 0.72, hat: 0.38, openhat: 0.32 }[hit];
        const vel = clamp(base * accent * (0.82 + this.rng() * 0.3));
        // hard rules apply to drums too
        const maxR = this.rule("maxVoices");
        if (maxR && this.soundingLayerCount(t, v.layer.id) >= Math.round(maxR.value)) {
          this.ghost(v, DRUM_MIDI[hit], maxR, t);
          continue;
        }
        const maxN = this.rule("maxNotes");
        if (maxN && this.soundingNoteCount(t) >= Math.round(maxN.value)) {
          this.ghost(v, DRUM_MIDI[hit], maxN, t);
          continue;
        }
        try {
          v.kit!.trigger(hit, this.at(t), vel);
        } catch (err) {
          console.warn("[drift] drum hit failed", err);
          continue;
        }
        const len = { kick: 0.4, snare: 0.2, hat: 0.05, openhat: 0.25 }[hit];
        this.sounding.push({ layerId: v.layer.id, midi: DRUM_MIDI[hit], start: t, end: t + len, fullEnd: t + len });
        this.emit({ kind: "note", time: t, layerId: v.layer.id, midi: DRUM_MIDI[hit], velocity: vel, duration: len, role: "drums" });
        v.lastNoteTime = t;
      }
    }
    st.step++;
    st.gridTime += sixteenth;
    v.nextTime = st.gridTime;
  }

  /* ---------------- the user's melody ---------------- */

  private startTheme(v: Voice): void {
    if (!v.layer.theme) return;
    const t = v.layer.theme;
    v.themeQueue = t.steps.map((s, i) => ({ s, lock: Boolean(t.locks[i]) }));
    // trim trailing rests so the melody doesn't end on silence
    while (v.themeQueue.length && v.themeQueue[v.themeQueue.length - 1].s === null) v.themeQueue.pop();
    v.themeAnchor = null;
    v.replay = [];
  }

  /**
   * Turn a melody step into a pitch. The melody is anchored on a chord
   * note near the middle of the layer's range, so it always fits the
   * harmony, and varies slightly with unpredictability.
   */
  private themePitch(v: Voice, step: number, locked: boolean, scale: number[], cands: number[]): number | undefined {
    if (!scale.length) return undefined;
    if (v.themeAnchor === null || v.themeAnchor >= scale.length) {
      // the melody starts on the home note nearest the middle of the
      // layer's range, so changing the key moves the whole melody with it
      const home = rootPc(this.config.harmony.root);
      const centre = (scale[0] + scale[scale.length - 1]) / 2 - 3;
      let best = Math.floor(scale.length / 2);
      let bestD = Infinity;
      scale.forEach((m, i) => {
        if (m % 12 !== home) return;
        const d = Math.abs(m - centre);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      v.themeAnchor = best;
    }
    let s = step;
    const u = this.effectiveU();
    // unlocked notes vary gently; locked notes never do
    const roll = this.rng();
    if (!locked && roll < u * 0.3) s += this.rng() < 0.5 ? -1 : 1;
    const idx = Math.max(0, Math.min(scale.length - 1, v.themeAnchor + s));
    const target = scale[idx];
    // a locked note is played exactly, even if it rubs against another layer
    if (locked || cands.includes(target)) return target;
    // the exact note would clash with another layer: take the nearest that fits
    return [...cands].sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  }

  /** "Hear it now": play a layer's drawn melody right away. */
  playThemeNow(layerId: string): void {
    const v = this.voices.get(layerId);
    if (!v || !this.playing || !v.layer.theme) return;
    this.startTheme(v);
    v.nextTime = Tone.now() + 0.15;
    this.activeIds.add(layerId);
  }

  /* ---------------- surprises ---------------- */

  private fireSurprise(kind: SurpriseKind, time: number): void {
    const c = this.config;
    // notes outside the scale only when the user allows them
    if (kind === "foreignNote" && !c.harmony.chromatic) kind = "cluster";
    const chord = this.chord.pcs.length ? this.chord.pcs : [0, 4, 7];
    const near = (pc: number, center: number) => {
      let m = center - ((center - pc) % 12 + 12) % 12;
      if (center - m > 6) m += 12;
      return m;
    };
    const maxR = this.rule("maxVoices");
    if (maxR && this.soundingLayerCount(time, null) >= Math.round(maxR.value)) {
      this.ghost(null, 60, maxR, time);
      return;
    }
    const maxN = this.rule("maxNotes");
    const note = (synth: Poly, m: number, dur: number, vel: number, t: number) => {
      if (!this.passesRange(null, m, t)) return;
      if (maxN && this.soundingNoteCount(t) >= Math.round(maxN.value)) {
        this.ghost(null, m, maxN, t);
        return;
      }
      const v = this.applyQuieter(vel, t);
      if (v <= 0) return;
      synth.triggerAttackRelease(midiToFreq(m), dur, this.at(t), v);
      this.sounding.push({ layerId: "surprise", midi: m, start: t, end: t + dur, fullEnd: t + dur + 3 });
      this.emit({ kind: "note", time: t, layerId: "surprise", midi: m, velocity: v, duration: dur, role: "surprise" });
    };
    this.emit({ kind: "surprise", time, type: kind });
    switch (kind) {
      case "lowSwell":
        note(this.surpriseSub, near(chord[0], 33), 7, 0.55, time);
        break;
      case "highShimmer": {
        const count = 3 + Math.floor(this.rng() * 3);
        for (let i = 0; i < count; i++) note(this.surpriseBell, near(chord[i % chord.length], 84) + (i > 2 ? 12 : 0), 3, 0.25, time + i * (0.09 + this.rng() * 0.12));
        break;
      }
      case "cluster": {
        const cands = scaleNotes(c.harmony.root, scaleOf(c.harmony), 58, 72);
        const start = Math.floor(this.rng() * Math.max(1, cands.length - 3));
        for (let i = 0; i < 3; i++) if (cands[start + i]) note(this.surpriseSynth, cands[start + i], 2.5, 0.22, time + i * 0.03);
        break;
      }
      case "noiseGust": {
        const at = this.at(time);
        this.noiseFilter.frequency.cancelScheduledValues(at);
        this.noiseFilter.frequency.setValueAtTime(300, at);
        this.noiseFilter.frequency.exponentialRampToValueAtTime(1800 + this.rng() * 2000, at + 3);
        this.noiseFilter.frequency.exponentialRampToValueAtTime(400, at + 7);
        this.noiseEnv.triggerAttackRelease(3.5, at);
        this.emit({ kind: "note", time, layerId: "surprise", midi: 66, velocity: 0.3, duration: 6, role: "surprise" });
        break;
      }
      case "foreignNote": {
        // an out-of-key note that resolves back into the harmony
        const target = near(chord[Math.floor(this.rng() * chord.length)], 72);
        note(this.surpriseSynth, target + 1, 1.4, 0.3, time);
        note(this.surpriseSynth, target, 2.5, 0.28, time + 1.3);
        break;
      }
    }
  }

  /* ---------------- rule: introduce a new instrument ---------------- */

  private addRuntimeLayer(now: number, r: Rule): void {
    // first, wake any layers the user switched off
    const sleeping = this.config.layers.find((l) => !l.enabled);
    const total = this.voices.size;
    if (total >= 6 && this.runtimeOrder.length) {
      const oldest = this.runtimeOrder.shift()!;
      const ov = this.voices.get(oldest);
      if (ov) this.emit({ kind: "layerLeave", time: now, layerId: oldest, name: ov.layer.name });
      this.removeVoice(oldest, 6);
    } else if (total >= 6) {
      return;
    }
    void sleeping;
    const used = new Set([...this.voices.values()].map((v) => v.layer.instrument));
    const options = RUNTIME_TEMPLATES.filter((t) => !used.has(t.instrument));
    const tpl = (options.length ? options : RUNTIME_TEMPLATES)[Math.floor(this.rng() * (options.length || RUNTIME_TEMPLATES.length))];
    const layer: Layer = { ...structuredClone(tpl), id: uid("guest") };
    const v = this.createVoice(layer, true, now);
    v.nextTime = now + 0.5;
    this.runtimeOrder.push(layer.id);
    this.assignSpread();
    this.applyAudioParams(5);
    this.updateActiveSet();
    this.fire(r, now);
    this.emit({ kind: "layerEnter", time: now, layerId: layer.id, name: layer.name });
  }

  private emit(e: EngineEvent): void {
    for (const fn of this.listeners) fn(e);
  }
}
