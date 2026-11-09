import type { DriftConfig, Layer, RuleType } from "../schema";
import { clamp } from "../schema";
import { PRESETS, layer as makeLayer } from "../presets";
import { PROGRESSIONS } from "../engine/composer";

/** The progression a composed piece uses when none is set (mirrors the engine). */
/** Look presets up by name, so adding one never shifts the others. */
const byName = (name: string) => PRESETS.find((p) => p.name === name) ?? PRESETS[0];

function defaultProgression(mode: DriftConfig["harmony"]["mode"]): number[] {
  return ["minor", "phrygian", "minorPentatonic", "japanese"].includes(mode) ? PROGRESSIONS.minor : ["dorian", "wholeTone"].includes(mode) ? PROGRESSIONS.modal : PROGRESSIONS.major;
}
import { RULE_META } from "../rules";
import { type AIPatch, emptyPatch } from "./patch";

/**
 * Offline interpreter: simple keyword matching, used when the AI service
 * is unavailable. It is deliberately limited and always labelled as such.
 */

export type InterpretMode = "atmosphere" | "direct" | "rule";

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w));

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, half: 0.5 };
function num(s: string | undefined): number | null {
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  return NUMBER_WORDS[s] ?? null;
}
function minutesIn(t: string): number | null {
  const m = t.match(/(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|a|an|half)\s*(?:a\s*)?minutes?/);
  return m ? num(m[1]) : null;
}

export function configToPatch(c: DriftConfig, reply: string): AIPatch {
  const p = emptyPatch(reply);
  p.name = c.name;
  p.atmosphere = c.atmosphere;
  p.macro = { ...c.macro };
  p.tempo = { ...c.tempo };
  p.arc = { ...c.arc };
  p.harmony = {
    ...c.harmony,
    customScale: c.harmony.customScale ? [...c.harmony.customScale] : null,
    chromatic: c.harmony.chromatic,
    progression: c.harmony.progression ? { ...c.harmony.progression, degrees: [...c.harmony.progression.degrees] } : { degrees: [], bars: 2 },
  };
  p.tone = { ...c.tone };
  p.space = { ...c.space };
  p.behavior = { ...c.behavior, surpriseKinds: [...c.behavior.surpriseKinds] };
  // relation targets travel by name, since replaced layers get new ids
  const nameOf = new Map(c.layers.map((l) => [l.id, l.name]));
  p.replaceLayers = c.layers.map((l) => ({ ...layerToAI(l), relationTarget: l.relation.target ? nameOf.get(l.relation.target) ?? null : null }));
  return p;
}

export function layerToAI(l: Layer) {
  return {
    name: l.name,
    role: l.role,
    instrument: l.instrument,
    registerLow: l.register.low,
    registerHigh: l.register.high,
    activity: l.activity,
    minDuration: l.durations.min,
    maxDuration: l.durations.max,
    movement: l.movement,
    volume: l.volume,
    pan: l.pan,
    prominence: l.prominence,
    relationType: l.relation.type,
    // targets are resolved by name when layers are replaced
    relationTarget: l.relation.target,
    speed: l.speed,
    fx: l.fx,
    themeSteps: l.theme ? [...l.theme.steps] : null,
    themeStrength: l.theme?.strength ?? 0.5,
  };
}

/** Mood words nudge the current values (used by both modes). */
function applyMoods(t: string, c: DriftConfig, p: AIPatch, strength: number, notes: string[]) {
  const nudge = (get: () => number, setP: (v: number) => void, d: number) => setP(clamp(get() + d * strength));
  const mac = { ...c.macro };
  const v = {
    density: p.macro.density ?? mac.density,
    evolution: p.macro.evolution ?? mac.evolution,
    unpredictability: p.macro.unpredictability ?? mac.unpredictability,
    bpm: p.tempo.bpm ?? c.tempo.bpm,
    lock: p.tempo.lock ?? c.tempo.lock,
    brightness: p.tone.brightness ?? c.tone.brightness,
    warmth: p.tone.warmth ?? c.tone.warmth,
    reverb: p.space.reverb ?? c.space.reverb,
    reverbMix: p.space.reverbMix ?? c.space.reverbMix,
    echo: p.space.echo ?? c.space.echo,
    tension: p.harmony.tension ?? c.harmony.tension,
    overlap: p.behavior.overlap ?? c.behavior.overlap,
    memory: p.behavior.memory ?? c.behavior.memory,
    silence: p.behavior.silence ?? c.behavior.silence,
    surprises: p.behavior.surprises ?? c.behavior.surprises,
  };
  const n = (k: keyof typeof v, d: number, note: string) => {
    v[k] = clamp(v[k] + d * strength);
    notes.push(note);
  };
  void nudge;

  if (has(t, "melanchol", "sad", "nostalg", "lonel", "grief", "wistful", "longing")) {
    n("brightness", -0.12, "darker, more wistful color");
    if (!p.harmony.mode) p.harmony.mode = c.harmony.mode === "minor" ? "phrygian" : "minor";
  }
  if (has(t, "warm", "cozy", "golden", "sunny", "tender")) {
    n("warmth", 0.25, "warmer tone");
    n("brightness", 0.05, "a little more glow");
  }
  if (has(t, "cold", "icy", "winter", "frozen", "frost", "glass")) n("warmth", -0.2, "colder tone");
  if (has(t, "dark", "ominous", "haunt", "shadow", "night")) n("brightness", -0.18, "darker");
  if (has(t, "bright", "hopeful", "joy", "happy", "morning", "sunrise")) {
    n("brightness", 0.2, "brighter");
    if (!p.harmony.mode && has(t, "hopeful", "joy", "happy")) p.harmony.mode = "major";
  }
  if (has(t, "dream", "float", "space", "cosmic", "weightless", "drift")) {
    n("reverbMix", 0.15, "more spacious");
    n("overlap", 0.15, "notes blur together");
  }
  if (has(t, "unsettl", "uneasy", "eerie", "strange", "anxious", "tense", "uncanny")) {
    n("tension", 0.3, "more tension in the harmony");
    n("unpredictability", 0.15, "less predictable");
    p.behavior.surpriseKinds = Array.from(new Set([...(p.behavior.surpriseKinds ?? c.behavior.surpriseKinds), "foreignNote" as const]));
  }
  if (has(t, "calm", "peace", "still", "serene", "gentle", "quiet")) {
    n("density", -0.08, "sparser");
    n("unpredictability", -0.12, "steadier");
  }
  if (has(t, "busy", "energetic", "lively", "rain", "crowd", "restless")) {
    n("density", 0.18, "denser");
    v.bpm = Math.min(160, v.bpm * 1.15);
    notes.push("a little quicker");
  }
  if (has(t, "underwater", "ocean", "sea", "submerged")) {
    n("brightness", -0.25, "muffled, as if underwater");
    n("echo", 0.2, "more echoes");
  }
  if (has(t, "cathedral", "church", "hall", "cave", "vast", "huge", "canyon")) {
    n("reverb", 0.3, "a vast space");
    n("reverbMix", 0.15, "more reverb");
  }
  const aboutHarmony = /harmon|chord/.test(t);
  if (has(t, "slower", "slow down", "more slowly", "slow it") && !aboutHarmony) {
    v.bpm = Math.max(30, Math.round(v.bpm * 0.8));
    notes.push(`slower (${Math.round(v.bpm)} BPM)`);
  }
  if (has(t, "faster", "speed up", "quicker") && !aboutHarmony) {
    v.bpm = Math.min(160, Math.round(v.bpm * 1.2));
    notes.push(`faster (${Math.round(v.bpm)} BPM)`);
  }
  const bpm = t.match(/(\d{2,3})\s*bpm/);
  if (bpm) {
    v.bpm = Math.max(30, Math.min(160, Number(bpm[1])));
    notes.push(`tempo set to ${v.bpm} BPM`);
  }
  if (has(t, "on the beat", "steady beat", "more rhythmic", "in time", "pulse", "groove")) {
    v.lock = clamp(v.lock + 0.35);
    notes.push("notes lock more tightly to the beat");
  }
  if (has(t, "free time", "free-floating", "floating rhythm", "no beat", "loose", "rubato")) {
    v.lock = clamp(v.lock - 0.35);
    notes.push("timing floats more freely");
  }
  if (has(t, "sparser", "fewer notes", "less busy", "emptier", "thinner")) n("density", -0.15, "sparser");
  if (has(t, "denser", "more notes", "fuller", "busier", "richer")) n("density", 0.15, "denser");
  if (has(t, "more echo", "more delay")) n("echo", 0.2, "more echoes");
  if (has(t, "less echo", "no echo", "drier")) n("echo", -0.25, "fewer echoes");
  if (has(t, "closer", "intimate", "less reverb", "smaller room")) n("reverbMix", -0.2, "closer, drier space");
  if (has(t, "repetitive", "simpler", "familiar", "repeat")) {
    n("memory", 0.25, "phrases return more often");
    n("unpredictability", -0.12, "more predictable");
  }
  if (has(t, "more varied", "less repetitive", "more random", "chaotic", "wilder")) {
    n("memory", -0.2, "phrases return less often");
    n("unpredictability", 0.18, "more unpredictable");
  }
  if (has(t, "more silence", "more pauses", "more space between")) n("silence", 0.2, "more silences");
  if (has(t, "fewer pauses", "less silence", "continuous")) n("silence", -0.2, "fewer silences");
  if (has(t, "change more", "evolve faster", "more change", "keep changing")) n("evolution", 0.2, "changes more quickly");
  const steadyBeat = /steady (beat|pulse|rhythm|tempo)/.test(t);
  if (has(t, "stable", "change less", "don't change", "less change") || (/\bsteady\b/.test(t) && !steadyBeat)) n("evolution", -0.2, "changes more slowly");

  p.macro = { density: v.density, evolution: v.evolution, unpredictability: v.unpredictability, intensity: p.macro.intensity };
  p.tempo = { bpm: v.bpm, lock: v.lock, swing: p.tempo.swing };
  p.tone = { brightness: v.brightness, warmth: v.warmth };
  p.space = { ...p.space, reverb: v.reverb, reverbMix: v.reverbMix, echo: v.echo };
  p.harmony = { ...p.harmony, tension: v.tension };
  p.behavior = { ...p.behavior, overlap: v.overlap, memory: v.memory, silence: v.silence, surprises: v.surprises };
}

function titleFrom(text: string): string {
  const words = text
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "of", "at", "with", "and", "that", "feels", "is", "in", "through"].includes(w.toLowerCase()))
    .slice(0, 3);
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ") || "Untitled";
}

/** Strip nulls so only fields that changed remain set (for "direct" mode). */
function onlyChanged(p: AIPatch, c: DriftConfig): AIPatch {
  const eq = (a: number | null, b: number) => a === null || Math.abs(a - b) < 1e-6;
  if (eq(p.macro.density, c.macro.density)) p.macro.density = null;
  if (eq(p.macro.evolution, c.macro.evolution)) p.macro.evolution = null;
  if (eq(p.macro.unpredictability, c.macro.unpredictability)) p.macro.unpredictability = null;
  if (eq(p.tempo.bpm, c.tempo.bpm)) p.tempo.bpm = null;
  if (eq(p.tempo.lock, c.tempo.lock)) p.tempo.lock = null;
  if (eq(p.tone.brightness, c.tone.brightness)) p.tone.brightness = null;
  if (eq(p.tone.warmth, c.tone.warmth)) p.tone.warmth = null;
  if (eq(p.space.reverb, c.space.reverb)) p.space.reverb = null;
  if (eq(p.space.reverbMix, c.space.reverbMix)) p.space.reverbMix = null;
  if (eq(p.space.echo, c.space.echo)) p.space.echo = null;
  if (eq(p.harmony.tension, c.harmony.tension)) p.harmony.tension = null;
  for (const k of ["overlap", "memory", "silence", "surprises"] as const) if (eq(p.behavior[k], c.behavior[k])) p.behavior[k] = null;
  return p;
}

/** Recognize one of the supported rule types in a sentence. */
export function matchRule(t: string): { type: RuleType; value: number | null } | null {
  const m = t.match(/(?:never|no|not|at most|maximum(?: of)?|max)\s+(?:let\s+)?(?:more than\s+)?(\d+|one|two|three|four|five|six)\s+(?:simultaneous\s+)?(sounds?|notes?|voices?|instruments?|layers?|things?)/);
  if (m) return { type: /note/.test(m[2]) ? "maxNotes" : "maxVoices", value: num(m[1]) };
  if (/(quieter|softer) than the (previous|last|one before)/.test(t) || /each .* (quieter|softer)/.test(t)) return { type: "eachQuieter", value: null };
  if (/(new|another|different) (instrument|sound|voice|layer)/.test(t) && /every/.test(t)) return { type: "addLayerEvery", value: minutesIn(t) };
  if (has(t, "drift apart", "diverge", "move apart", "grow apart", "separate")) return { type: "driftApart", value: minutesIn(t) };
  if (has(t, "less recognizable", "unrecognizable", "dissolve", "erode", "fall apart", "disintegrat", "decay")) return { type: "erode", value: minutesIn(t) };
  if (/(when(ever)?|once|if) one .*(stops|ends|finishes).*(another|next|other)/.test(t) || has(t, "take turns", "one at a time", "pass the melody", "hand off")) return { type: "handoff", value: null };
  if (/(high|higher|top) notes?.*(less|fewer|rarer|disappear|fade)/.test(t) || has(t, "fewer high", "less high")) return { type: "thinHighs", value: minutesIn(t) };
  if (/(no|remove|without|avoid|cut|drop|lose).*(high|higher|top|treble)/.test(t)) return { type: "ceiling", value: 5 };
  if (/(no|remove|without|avoid|cut|drop|lose).*(low|lower|bass|deep)/.test(t)) return { type: "floor", value: 3 };
  return null;
}

const SUPPORTED_LIST = Object.values(RULE_META)
  .map((m) => `“${m.sentence.replace("{v}", "…")}”`)
  .join(", ");

export function interpretOffline(mode: InterpretMode, text: string, current: DriftConfig): AIPatch {
  const t = text.toLowerCase();

  if (mode === "rule") {
    const parts = text.split(/;|\. |\band also\b/i).map((s) => s.trim()).filter(Boolean);
    const p = emptyPatch("");
    for (const part of parts.length ? parts : [text]) {
      const r = matchRule(part.toLowerCase());
      if (r) p.addRules.push({ type: r.type, value: r.value, text: part });
      else p.unsupported.push({ request: part, reason: `The offline interpreter couldn't match this to a rule it can run. Supported rules: ${SUPPORTED_LIST}.` });
    }
    p.reply = p.addRules.length
      ? `Added ${p.addRules.length === 1 ? "a rule" : `${p.addRules.length} rules`}: ${p.addRules.map((r) => RULE_META[r.type].title.toLowerCase()).join(", ")}.`
      : "I couldn't turn that into a rule I can actually run.";
    return p;
  }

  if (mode === "atmosphere") {
    const score = (words: string[]) => words.filter((w) => t.includes(w)).length;
    const candidates: [DriftConfig, number][] = [
      [byName("Endless Piano"), score(["piano", "endless", "solo", "phrase", "aphex", "quiet piano", "study", "focus"])],
      [byName("Departures"), score(["airport", "lounge", "waiting", "calm", "spacious", "unhurried", "eno", "ambient", "peaceful"])],
      [byName("City at 4 A.M."), score(["city", "street", "night", "4 a.m", "empty", "cold", "urban", "nostalg", "rain"])],
      [byName("Abandoned Cathedral"), score(["cathedral", "church", "light", "sun", "holy", "stone", "abandon", "dust", "temple"])],
      [byName("Uneasy Summer Evening"), score(["summer", "warm", "evening", "unsettl", "uneasy", "heat", "garden", "dusk"])],
      [byName("Underwater"), score(["water", "ocean", "sea", "float", "submerg", "deep", "swim", "tide"])],
      [byName("Night Drive"), score(["electronic", "neon", "techno", "club", "drive", "synth", "beat", "dance", "cyber", "rave"])],
      [byName("Orchestral Dawn"), score(["orchestra", "violin", "cello", "strings", "symphon", "cinematic", "film", "classical", "dawn"])],
      [byName("Great Vessel"), score(["expansive", "bittersweet", "climax", "build", "anthem", "ship", "vast", "progression", "swell", "epic", "uplifting"])],
    ];
    candidates.sort((a, b) => b[1] - a[1]);
    const base = candidates[0][0];
    const p = configToPatch(base, "");
    p.name = titleFrom(text);
    p.atmosphere = text;
    const notes: string[] = [];
    applyMoods(t, base, p, 1, notes);
    // several mood words shouldn't pile up into an extreme
    const keep = (v: number | null, b: number, lo = 0.05) => (v === null ? v : clamp(v, Math.max(lo, b - 0.25), Math.min(0.97, b + 0.25)));
    p.tone.brightness = keep(p.tone.brightness, base.tone.brightness, 0.1);
    p.tone.warmth = keep(p.tone.warmth, base.tone.warmth);
    p.space.reverbMix = keep(p.space.reverbMix, base.space.reverbMix);
    p.macro.density = keep(p.macro.density, base.macro.density);
    p.macro.unpredictability = keep(p.macro.unpredictability, base.macro.unpredictability);
    p.reply = `Offline sketch: started from the “${base.name}” system${notes.length ? ` and made it ${Array.from(new Set(notes)).slice(0, 4).join(", ")}` : ""}.`;
    return p;
  }

  // direct: modify the current system
  const p = emptyPatch("");
  const notes: string[] = [];
  applyMoods(t, current, p, 1, notes);
  onlyChanged(p, current);
  if (has(t, "unexpected", "surprise", "something new", "something strange")) {
    p.triggerSurprise = true;
    p.behavior.surprises = clamp(current.behavior.surprises + 0.15);
    notes.push("an unexpected event, and surprises a little more often");
  }
  if (/\b(lower|deeper)\b/.test(t) && !/lower notes|lower sounds/.test(t)) {
    for (const l of current.layers) if (l.role !== "bass") p.layerEdits.push({ ...blankEdit(l.id), registerLow: Math.max(1, l.register.low - 1), registerHigh: Math.max(1, l.register.high - 1) });
    notes.push("everything sits lower");
  }
  const key = text.match(/\b(?:in|key of|to)\s+([A-G])\s*(#|♯|b|♭|sharp|flat)?(?:\s+(major|minor))?\b/);
  if (key) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
    let i = names.indexOf(key[1] as (typeof names)[number]);
    if (key[2] && /#|♯|sharp/.test(key[2])) i = (i + 1) % 12;
    if (key[2] && /b|♭|flat/.test(key[2])) i = (i + 11) % 12;
    p.harmony.root = names[i];
    if (key[3]) p.harmony.mode = key[3] === "major" ? "major" : "minor";
    notes.push(`now in ${names[i]}${key[3] ? ` ${key[3]}` : ""}`);
  }
  // instruments by name: "add a violin", "give it drums", "more electronic"
  const add = (name: string, role: Layer["role"], instrument: Layer["instrument"], extra: Partial<ReturnType<typeof layerToAI>> = {}) => {
    if (current.layers.some((l) => l.instrument === instrument) || current.layers.length + p.addLayers.length >= 6) return;
    p.addLayers.push({ ...layerToAI(makeLayer({ id: "x", name, role, instrument })), ...extra });
    notes.push(`added ${name.toLowerCase()}`);
  };
  if (/\bviolin/.test(t)) add("Violin", "melody", "violin", { registerLow: 4, registerHigh: 6, prominence: "leads" });
  if (/\bcello/.test(t)) add("Cello", "bass", "cello", { registerLow: 2, registerHigh: 3, movement: "stepwise" });
  if (/\bflute/.test(t)) add("Flute", "melody", "flute", { registerLow: 5, registerHigh: 6 });
  if (/\b(horn|brass)/.test(t)) add("Horns", "pad", "horn", { registerLow: 3, registerHigh: 4 });
  if (/\bharp/.test(t)) add("Harp", "bells", "harp", { registerLow: 3, registerHigh: 5, movement: "arpeggio" });
  if (/orchestra/.test(t)) {
    add("Violin", "melody", "violin", { registerLow: 4, registerHigh: 6, prominence: "leads" });
    add("Cello", "bass", "cello", { registerLow: 2, registerHigh: 3, movement: "stepwise" });
    add("Horns", "pad", "horn", { registerLow: 3, registerHigh: 4 });
  }
  if (/\b(drums?|beat|techno|house|dance)\b/.test(t)) {
    add("Drum machine", "drums", "drums");
    if (current.tempo.lock < 0.8) p.tempo.lock = 0.9;
    if (current.tempo.bpm < 90 && /techno|house|dance/.test(t)) p.tempo.bpm = 118;
  }
  if (/electronic|synth|techno|house|dance/.test(t)) {
    add("Acid line", "bass", "acid", { registerLow: 2, registerHigh: 3, movement: "arpeggio", speed: 2, fx: "sweep", activity: 0.7, minDuration: 0.15, maxDuration: 0.5 });
    add("Neon pad", "pad", "supersaw", { registerLow: 3, registerHigh: 4, fx: "pump" });
  }
  if (/\bacid\b/.test(t)) add("Acid line", "bass", "acid", { registerLow: 2, registerHigh: 3, movement: "arpeggio", speed: 2, fx: "sweep" });
  if (/chip|8-bit|8 bit|retro game/.test(t)) add("Chip lead", "melody", "chip", { registerLow: 4, registerHigh: 5 });
  if (/progression|repeating chords?|chord sequence|recognizable harmony/.test(t)) {
    p.harmony.progression = { degrees: /bittersweet|sad|melanchol/.test(t) ? [5, 3, 0, 4] : [0, 4, 5, 3], bars: 2 };
    notes.push("a repeating chord progression");
  }
  if (/wander|free harmony|no progression/.test(t)) {
    p.harmony.progression = { degrees: [], bars: 2 };
    notes.push("harmony wanders freely");
  }
  if (current.engine.type !== "composed" && /climax|crescendo|build(s|ing)? (up|toward)|gradually build|epic|swell/.test(t)) {
    p.arc = { shape: "buildRelease", minutes: 6 };
    notes.push("a build toward a climax and release");
  }
  if (/\bwaves?\b|ebb and flow/.test(t)) {
    p.arc = { shape: "waves", minutes: 3 };
    notes.push("slow waves of intensity");
  }
  if (/steady|no build/.test(t) && !/steady (beat|pulse|rhythm|tempo)/.test(t)) {
    p.arc = { shape: "off", minutes: current.arc.minutes };
  }
  if (/\borgan\b/.test(t)) add("Organ", "pad", "organ", { registerLow: 3, registerHigh: 4 });
  // composed-piece requests
  if (/interlock|another (melody|line|voice)|second (melody|line)/.test(t)) {
    const n = current.layers.filter((l) => l.role === "bells" || l.role === "texture").length;
    if (current.layers.length + p.addLayers.length < 6) {
      const inst = (["marimba", "glass", "harp", "bell"] as const).find((i) => !current.layers.some((l) => l.instrument === i)) ?? "glass";
      p.addLayers.push({ ...layerToAI(makeLayer({ id: "x", name: `Interlock ${n + 2}`, role: "bells", instrument: inst })), registerLow: 5, registerHigh: 6 });
      notes.push("another interlocking melody");
    }
  }
  if (/(slow|slower|less often).*(harmon|chord)|(harmon|chord).*(slow|slower|less often)/.test(t)) {
    const prog = current.harmony.progression ?? { degrees: defaultProgression(current.harmony.mode), bars: 2 };
    p.harmony.progression = { degrees: [...prog.degrees], bars: Math.min(8, prog.bars * 2) };
    notes.push(`chords change every ${Math.min(8, prog.bars * 2)} bars`);
  }
  if (/(faster|more often|quicker).*(harmon|chord)|(harmon|chord).*(faster|more often|quicker)/.test(t)) {
    const prog = current.harmony.progression ?? { degrees: defaultProgression(current.harmony.mode), bars: 2 };
    p.harmony.progression = { degrees: [...prog.degrees], bars: Math.max(0.5, prog.bars / 2) };
    notes.push("chords change more often");
  }
  if (/gradually build|build up|more intense|bigger|grow/.test(t)) {
    p.macro.intensity = Math.min(1, current.macro.intensity + 0.25);
    notes.push("builds to fuller peaks");
  }
  if (/calmer|less intense|gentler|smaller/.test(t)) {
    p.macro.intensity = Math.max(0, current.macro.intensity - 0.25);
    notes.push("gentler peaks");
  }
  if (/swing|shuffle/.test(t)) {
    p.tempo.swing = Math.min(1, current.tempo.swing + 0.45);
    notes.push("more swing");
  }
  if (/pump|sidechain/.test(t)) {
    for (const l of current.layers) if (l.role === "pad") p.layerEdits.push({ ...blankEdit(l.id), fx: "pump" });
    notes.push("pads pump with the beat");
  }
  const rule = matchRule(t);
  if (rule && (rule.type === "ceiling" || rule.type === "floor")) {
    p.addRules.push({ type: rule.type, value: rule.value, text });
    notes.push(rule.type === "ceiling" ? "higher notes removed (as a visible rule you can edit)" : "low notes removed (as a visible rule you can edit)");
  }
  if (!notes.length) {
    p.unsupported.push({ request: text, reason: "The offline interpreter only understands simple words like slower, warmer, darker, sparser, more echo, more melancholic, something unexpected. Connect the AI for full language." });
    p.reply = "I couldn't find anything I understand in that (offline mode).";
  } else {
    p.reply = `Changed: ${Array.from(new Set(notes)).join(", ")}. Everything else stays as it was.`;
  }
  return p;
}

function blankEdit(id: string): AIPatch["layerEdits"][number] {
  return {
    id,
    remove: false,
    enabled: null,
    name: null,
    instrument: null,
    registerLow: null,
    registerHigh: null,
    activity: null,
    minDuration: null,
    maxDuration: null,
    movement: null,
    volume: null,
    pan: null,
    prominence: null,
    relationType: null,
    relationTarget: null,
    speed: null,
    fx: null,
    themeSteps: null,
    themeStrength: null,
  };
}
