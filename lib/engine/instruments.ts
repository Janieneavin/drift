import * as Tone from "tone";
import type { Fx, Instrument } from "../schema";

// PolySynth is generic over its voice type; DRIFT mixes several.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Poly = Tone.PolySynth<any>;

/** Relative loudness trims so every instrument sits at a similar level. */
export const TRIM: Record<Instrument, number> = {
  glass: 0.75,
  felt: 0.85,
  bell: 0.42,
  choir: 0.2,
  strings: 0.3,
  air: 0.38,
  sub: 0.95,
  pluck: 0.7,
  violin: 0.32,
  cello: 0.4,
  flute: 0.6,
  horn: 0.35,
  harp: 0.7,
  supersaw: 0.16,
  acid: 0.3,
  chip: 0.22,
  drums: 0.8,
  organ: 0.22,
  rhodes: 0.7,
  piano: 0.9,
  marimba: 0.85,
};

/** How open each instrument's filter is at "neutral" brightness, in Hz. */
export const BASE_CUTOFF: Record<Instrument, number> = {
  glass: 4200,
  felt: 2400,
  bell: 6000,
  choir: 1400,
  strings: 1700,
  air: 1200,
  sub: 420,
  pluck: 3800,
  violin: 4200,
  cello: 2200,
  flute: 5000,
  horn: 1800,
  harp: 4500,
  supersaw: 3600,
  acid: 6000,
  chip: 5000,
  drums: 12000,
  organ: 4200,
  rhodes: 3600,
  piano: 4600,
  marimba: 3800,
};

/** How long a note keeps sounding after its release starts. */
export const RELEASE_TAIL: Record<Instrument, number> = {
  glass: 3,
  felt: 2,
  bell: 4,
  choir: 6,
  strings: 7,
  air: 8,
  sub: 5,
  pluck: 0.7,
  violin: 1.4,
  cello: 1.8,
  flute: 0.8,
  horn: 1.2,
  harp: 2.5,
  supersaw: 1.6,
  acid: 0.4,
  chip: 0.3,
  drums: 0.6,
  organ: 0.8,
  rhodes: 2.6,
  piano: 3.4,
  marimba: 0.9,
};

/**
 * A sound source: the polyphonic synth, the node its sound leaves from
 * (after any built-in colouring such as violin vibrato), and every node
 * created, so the voice can dispose of them all.
 */
export interface Source {
  synth: Poly;
  out: Tone.ToneAudioNode;
  nodes: Tone.ToneAudioNode[];
  kit: DrumKit | null;
}

const poly = (voice: unknown, opts: unknown): Poly => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = new Tone.PolySynth(voice as any, opts as never);
  // long, overlapping ambient notes need room: 32 voices per instrument
  s.maxPolyphony = 32;
  s.volume.value = -6;
  return s;
};

/** Synthesized, original instrument recipes — no samples. */
export function makeSource(inst: Instrument): Source {
  const nodes: Tone.ToneAudioNode[] = [];
  const keep = <T extends Tone.ToneAudioNode>(n: T) => {
    nodes.push(n);
    return n;
  };
  let synth: Poly;
  let out: Tone.ToneAudioNode;
  let kit: DrumKit | null = null;

  switch (inst) {
    case "glass":
      synth = poly(Tone.FMSynth, {
        harmonicity: 3.01,
        modulationIndex: 1.4,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.03, decay: 2.2, sustain: 0.5, release: 2.6 },
        modulationEnvelope: { attack: 0.05, decay: 0.9, sustain: 0.15, release: 2 },
      });
      out = synth;
      break;
    case "felt":
      synth = poly(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.008, decay: 1.8, sustain: 0.05, release: 2 } });
      out = synth;
      break;
    case "bell":
      synth = poly(Tone.FMSynth, {
        harmonicity: 5.07,
        modulationIndex: 7,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.004, decay: 4, sustain: 0, release: 4 },
        modulationEnvelope: { attack: 0.002, decay: 1.8, sustain: 0, release: 2 },
      });
      out = synth;
      break;
    case "choir": {
      // soft "aah" voices: a slow swell, shaped by a vowel-like body
      synth = poly(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 3, spread: 16 }, envelope: { attack: 3.2, decay: 1, sustain: 0.8, release: 7 } });
      const vowel = keep(new Tone.Filter({ type: "peaking", frequency: 850, Q: 1.4, gain: 5 }));
      const breath = keep(new Tone.Filter({ type: "lowpass", frequency: 2200, rolloff: -24 }));
      synth.chain(vowel, breath);
      out = breath;
      break;
    }
    case "rhodes": {
      // a warm electric piano: a soft bell-like tine over a round body, gently shimmering
      synth = poly(Tone.FMSynth, {
        harmonicity: 1,
        modulationIndex: 2.4,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.006, decay: 3.2, sustain: 0.22, release: 2.6 },
        modulationEnvelope: { attack: 0.002, decay: 0.55, sustain: 0.08, release: 1 },
      });
      const shimmer = keep(new Tone.Tremolo({ frequency: 3.8, depth: 0.14 }).start());
      const warm = keep(new Tone.Filter({ type: "lowpass", frequency: 3200, rolloff: -12 }));
      synth.chain(shimmer, warm);
      out = warm;
      break;
    }
    case "strings":
      synth = poly(Tone.Synth, { oscillator: { type: "fattriangle", count: 3, spread: 22 }, envelope: { attack: 2.2, decay: 1, sustain: 0.85, release: 5 } });
      const soft = keep(new Tone.Filter({ type: "lowpass", frequency: 1800, rolloff: -24 }));
      synth.connect(soft);
      out = soft;
      break;
    case "air":
      synth = poly(Tone.Synth, { oscillator: { type: "fatsine", count: 4, spread: 40 }, envelope: { attack: 4, decay: 1, sustain: 0.9, release: 8 } });
      out = synth;
      break;
    case "sub":
      // a round, gentle bass: sine with a whisper of second harmonic
      synth = poly(Tone.Synth, { oscillator: { type: "custom", partials: [1, 0.22, 0.05] }, envelope: { attack: 0.08, decay: 0.8, sustain: 0.7, release: 1.8 } });
      out = synth;
      break;

    /* ---------- orchestral ---------- */
    case "violin": {
      // a bowed tone: slow attack, a body resonance, and vibrato
      synth = poly(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 2, spread: 7 }, envelope: { attack: 0.22, decay: 0.3, sustain: 0.85, release: 1.2 } });
      const vib = keep(new Tone.Vibrato({ frequency: 5.6, depth: 0.12 }));
      const body = keep(new Tone.Filter({ type: "peaking", frequency: 2600, Q: 1.2, gain: 6 }));
      const soft = keep(new Tone.Filter({ type: "lowpass", frequency: 5200, rolloff: -24 }));
      synth.chain(vib, body, soft);
      out = soft;
      break;
    }
    case "cello": {
      synth = poly(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 2, spread: 9 }, envelope: { attack: 0.32, decay: 0.4, sustain: 0.9, release: 1.6 } });
      const vib = keep(new Tone.Vibrato({ frequency: 5, depth: 0.1 }));
      const body = keep(new Tone.Filter({ type: "peaking", frequency: 900, Q: 1, gain: 5 }));
      const soft = keep(new Tone.Filter({ type: "lowpass", frequency: 2600, rolloff: -24 }));
      synth.chain(vib, body, soft);
      out = soft;
      break;
    }
    case "flute": {
      // a pure tone with a few soft harmonics and a gentle vibrato
      synth = poly(Tone.Synth, { oscillator: { type: "custom", partials: [1, 0.35, 0.12, 0.05, 0.02] }, envelope: { attack: 0.09, decay: 0.2, sustain: 0.8, release: 0.6 } });
      const vib = keep(new Tone.Vibrato({ frequency: 4.8, depth: 0.05 }));
      synth.connect(vib);
      out = vib;
      break;
    }
    case "horn": {
      // brass: the filter opens as the note swells
      synth = poly(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.18, decay: 0.4, sustain: 0.8, release: 1 },
        filter: { Q: 1.2, type: "lowpass", rolloff: -24 },
        filterEnvelope: { attack: 0.25, decay: 0.6, sustain: 0.55, release: 1, baseFrequency: 260, octaves: 2.6 },
      });
      out = synth;
      break;
    }
    case "harp":
      synth = poly(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 0.9,
        oscillator: { type: "triangle" },
        modulation: { type: "sine" },
        envelope: { attack: 0.003, decay: 2.4, sustain: 0, release: 2.4 },
        modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0, release: 0.3 },
      });
      out = synth;
      break;

    /* ---------- electronic ---------- */
    case "supersaw": {
      synth = poly(Tone.Synth, { oscillator: { type: "fatsawtooth", count: 5, spread: 42 }, envelope: { attack: 0.04, decay: 0.3, sustain: 0.75, release: 1.4 } });
      const chorus = keep(new Tone.Chorus({ frequency: 0.6, delayTime: 3.5, depth: 0.6, wet: 0.5 }).start());
      synth.connect(chorus);
      out = chorus;
      break;
    }
    case "acid": {
      // squelchy resonant bass: a fast filter envelope with high resonance
      synth = poly(Tone.MonoSynth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.004, decay: 0.25, sustain: 0.4, release: 0.2 },
        filter: { Q: 9, type: "lowpass", rolloff: -24 },
        filterEnvelope: { attack: 0.004, decay: 0.22, sustain: 0.1, release: 0.2, baseFrequency: 160, octaves: 4.2 },
      });
      const grit = keep(new Tone.Distortion({ distortion: 0.25, wet: 0.35 }));
      synth.connect(grit);
      out = grit;
      break;
    }
    case "chip":
      synth = poly(Tone.Synth, { oscillator: { type: "square" }, envelope: { attack: 0.004, decay: 0.12, sustain: 0.45, release: 0.15 } });
      out = synth;
      break;
    case "drums": {
      kit = new DrumKit();
      synth = poly(Tone.Synth, {}); // unused; keeps every voice the same shape
      nodes.push(...kit.nodes);
      out = kit.out;
      break;
    }
    case "organ": {
      // drawbar-style organ: a few strong harmonics, a slow rotating shimmer
      synth = poly(Tone.Synth, { oscillator: { type: "custom", partials: [1, 0.85, 0.45, 0.3, 0.15, 0, 0.1, 0.08] }, envelope: { attack: 0.06, decay: 0.2, sustain: 0.95, release: 0.7 } });
      const rotor = keep(new Tone.Chorus({ frequency: 0.8, delayTime: 4, depth: 0.45, wet: 0.45 }).start());
      const trem = keep(new Tone.Tremolo({ frequency: 5.5, depth: 0.12 }).start());
      synth.chain(rotor, trem);
      out = trem;
      break;
    }
    case "piano": {
      // Salamander Grand Piano (Alexander Holm, CC BY 3.0), streamed and cached
      // by the browser. Until it has loaded — or if offline — a soft synth plays.
      const fallback = poly(Tone.Synth, { oscillator: { type: "custom", partials: [1, 0.4, 0.18, 0.08, 0.04] }, envelope: { attack: 0.006, decay: 1.6, sustain: 0.12, release: 1.2 } });
      const mix = keep(new Tone.Gain(1));
      fallback.connect(mix);
      let loaded = false;
      const urls: Record<string, string> = {};
      for (const n of ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7"]) urls[n] = `${n.replace("#", "s")}.mp3`;
      // a long release, as if the sustain pedal were down
      const sampler = new Tone.Sampler({ urls, baseUrl: "https://tonejs.github.io/audio/salamander/", release: 3.4, onload: () => (loaded = true), onerror: () => (loaded = false) });
      sampler.volume.value = -9;
      sampler.connect(mix);
      nodes.push(sampler);
      // a stand-in with the few methods the engine uses
      synth = {
        triggerAttackRelease: (f: number, d: number, t: number, v: number) => (loaded ? sampler.triggerAttackRelease(f, d, t, v) : fallback.triggerAttackRelease(f, d, t, v)),
        triggerRelease: (f: number, t: number) => {
          fallback.triggerRelease(f, t);
          if (loaded) sampler.triggerRelease(f, t);
        },
        releaseAll: (t?: number) => {
          fallback.releaseAll(t);
          if (loaded) sampler.releaseAll(t);
        },
        set: (o: unknown) => fallback.set(o as never),
        get: () => fallback.get(),
        dispose: () => fallback.dispose(),
        volume: fallback.volume,
        connect: (n: Tone.InputNode) => mix.connect(n),
        maxPolyphony: 16,
      } as unknown as Poly;
      out = mix;
      break;
    }
    case "marimba": {
      // a soft mallet: a woody, quickly fading overtone over a warm body
      synth = poly(Tone.FMSynth, {
        harmonicity: 3.99,
        modulationIndex: 1.6,
        oscillator: { type: "sine" },
        modulation: { type: "sine" },
        envelope: { attack: 0.004, decay: 0.9, sustain: 0, release: 0.9 },
        modulationEnvelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.05 },
      });
      const body = keep(new Tone.Filter({ type: "lowpass", frequency: 3000, rolloff: -12 }));
      synth.connect(body);
      out = body;
      break;
    }
    case "pluck":
    default:
      synth = poly(Tone.Synth, { oscillator: { type: "sine" }, envelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.7 } });
      out = synth;
      break;
  }
  return { synth, out, nodes, kit };
}

/* ---------------- drum machine ---------------- */

export type DrumHit = "kick" | "snare" | "hat" | "openhat";

/** An original synthesized kit: no samples. */
export class DrumKit {
  readonly out = new Tone.Gain(1);
  private kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 6, envelope: { attack: 0.001, decay: 0.42, sustain: 0, release: 0.1 } });
  private snareNoise = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.16, sustain: 0 } });
  private snareTone = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.12, sustain: 0 } });
  private snareHp = new Tone.Filter({ type: "highpass", frequency: 1400 });
  private hat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.04, sustain: 0 } });
  private openHat = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.001, decay: 0.22, sustain: 0 } });
  private hatHp = new Tone.Filter({ type: "highpass", frequency: 7500 });
  /** Each drum can only start once per instant; keep start times strictly increasing. */
  private last: Record<DrumHit, number> = { kick: 0, snare: 0, hat: 0, openhat: 0 };
  readonly nodes: Tone.ToneAudioNode[];

  constructor() {
    this.kick.volume.value = -2;
    this.snareNoise.volume.value = -14;
    this.snareTone.volume.value = -16;
    this.hat.volume.value = -22;
    this.openHat.volume.value = -24;
    this.kick.connect(this.out);
    this.snareNoise.chain(this.snareHp, this.out);
    this.snareTone.connect(this.out);
    this.hat.connect(this.hatHp);
    this.openHat.connect(this.hatHp);
    this.hatHp.connect(this.out);
    this.nodes = [this.out, this.kick, this.snareNoise, this.snareTone, this.snareHp, this.hat, this.openHat, this.hatHp];
  }

  trigger(hit: DrumHit, time: number, velocity: number): void {
    time = Math.max(time, this.last[hit] + 0.002);
    this.last[hit] = time;
    switch (hit) {
      case "kick":
        this.kick.triggerAttackRelease("C1", 0.3, time, velocity);
        break;
      case "snare":
        this.snareNoise.triggerAttackRelease(0.14, time, velocity);
        this.snareTone.triggerAttackRelease("G2", 0.1, time, velocity * 0.7);
        break;
      case "hat":
        this.hat.triggerAttackRelease(0.03, time, velocity);
        break;
      case "openhat":
        this.openHat.triggerAttackRelease(0.2, time, velocity);
        break;
    }
  }
}

/* ---------------- electronic effects ---------------- */

export interface FxUnit {
  input: Tone.ToneAudioNode;
  output: Tone.ToneAudioNode;
  nodes: Tone.ToneAudioNode[];
  /** Keep tempo-synced effects in time. */
  setTempo: (bpm: number) => void;
}

export function makeFx(fx: Fx, bpm: number): FxUnit | null {
  switch (fx) {
    case "sweep": {
      // a slow filter sweep: one rise and fall every two bars
      const af = new Tone.AutoFilter({ frequency: bpm / 60 / 8, baseFrequency: 220, octaves: 4.5, depth: 0.9, wet: 1 }).start();
      return { input: af, output: af, nodes: [af], setTempo: (b) => af.frequency.rampTo(b / 60 / 8, 1) };
    }
    case "pump": {
      // sidechain-style pumping: the volume ducks on every beat and swells back
      const g = new Tone.Gain(1);
      const lfo = new Tone.LFO({ frequency: bpm / 60, min: 0.15, max: 1, type: "sawtooth" }).start();
      lfo.connect(g.gain);
      return { input: g, output: g, nodes: [g, lfo], setTempo: (b) => lfo.frequency.rampTo(b / 60, 1) };
    }
    case "crush": {
      const d = new Tone.Distortion({ distortion: 0.6, oversample: "none", wet: 0.5 });
      const lp = new Tone.Filter({ type: "lowpass", frequency: 3200 });
      d.connect(lp);
      return { input: d, output: lp, nodes: [d, lp], setTempo: () => undefined };
    }
    case "drive": {
      const d = new Tone.Distortion({ distortion: 0.35, oversample: "2x", wet: 0.6 });
      return { input: d, output: d, nodes: [d], setTempo: () => undefined };
    }
    default:
      return null;
  }
}
