# DRIFT — Audit against the Secondary Development Specification

Status key: ✅ done · 🟡 partial · ❌ missing · 🧪 prototype

## Audit

| § | Requirement | Before this pass | This pass (vertical slice) |
|---|---|---|---|
| 1 | No-code composition studio; bounded surprise | ✅ systems, rules, seeds | — |
| 2 | "Your musical system" panel, every item editable & audible | ✅ | — |
| 2 | Causal link between state and sound | ✅ lanes, ghosts, rule overlays, pulsing rule cards, ticker | — |
| 2 | Undo/redo + change history | ❌ | ✅ |
| 2 | Simple and advanced modes | 🟡 both shown at once | ✅ toggle |
| 3 | Add/edit/disable/combine/remove constraints | ✅ 9 typed rule types | + "max simultaneous notes" |
| 3 | Show interpreted rule before applying | ❌ applied immediately | ✅ preview → Apply / Cancel |
| 3 | Explain unsupported requests, offer alternative | ✅ | — |
| 3 | Hard vs soft constraints, precedence | 🟡 all rules hard; locks < hard rules undocumented | precedence documented below; soft rules → Phase 2 |
| 4 | Tonic, scale/mode, custom pitch set | ✅ | — |
| 4 | Optional non-diatonic notes | 🟡 stray-note surprise always allowed | ✅ explicit "allow notes outside the scale" switch |
| 4 | Key changes, tonal-centre strength | 🟡 slow automatic key drift at high evolution | Phase 2 |
| 4 | Melody: draw notes, motif length, rests, repetition vs variation, steps vs leaps | ✅ grid editor + movement + strength | — |
| 4 | Lock/freeze selected notes | ❌ | ✅ per-note and whole-melody locks |
| 4 | Contour, articulation, ornamentation | ❌ | Phase 2 |
| 4 | Harmony: palette, harmonic rhythm, drone/pedal, tension, voice leading | 🟡 harmonic rhythm, tension, drone movement, voice-led pads | chord palette / pedal tonic → Phase 2 |
| 4 | Per-layer instrument, tempo, density, pan, timbre, interactions | ✅ | — |
| 4 | Per-layer scale subset, phase, loop lengths | ❌ | Phase 2 |
| 4 | Natural-language and precise editing interchangeably | ✅ | — |
| 5 | Identity / Variation / Surprise as separate controls | 🟡 Unpredictability conflates variation + surprise | ✅ Surprise is its own main control |
| 5 | Identity locks, bounded ranges | 🟡 melody locks only | Phase 2 |
| 5 | Reproducible seed + new realization | ✅ | + engine version recorded |
| 6 | Deterministic layered engine | ✅ time-ordered logical clock | — |
| 6 | Cellular automaton engine | ❌ | Phase 3 |
| 7 | AI proposes 2–3 systems, A/B compare | ❌ | Phase 2 |
| 7 | Live changes without restarts | ✅ ramps, crossfades, beat-quantized entries | — |
| 7 | "Why did that happen?" view | 🟡 ticker + ghosts + rule pulses | full event inspector → Phase 2 |
| 8 | Versioned system spec | 🟡 schema version, no engine version | ✅ engine version |
| 8 | Composition vs Snapshot vs Recording | 🟡 composition + recording | ✅ snapshots |
| 8 | JSON import/export | ❌ | ✅ |
| 8 | WAV export | ✅ | — |
| 8 | MIDI export | ❌ | Phase 2 |
| 9 | Next.js/TS/Tone/Zod, offline engine, finite rule grammar | ✅ | — |
| 9 | Scheduler independent of React, gesture-safe start, fallbacks | ✅ | — |
| 9 | CPU / voice limits | 🟡 16 voices per instrument, 6 layers | — |

## Precedence (how conflicts resolve)

1. **Hard rules** (ceiling/floor, max sounds, max notes, higher notes rarer) always win. A blocked note becomes a visible ghost.
2. **Locked melody notes** are never varied and are allowed to clash with other layers — but they still obey hard rules.
3. **Unlocked melody notes, remembered phrases, improvisation** vary freely within the scale, the harmony and the clash guard.
4. **Surprises** may leave the scale only if "allow notes outside the scale" is on.

Locked melodies are stored as steps relative to the home note, so changing the key moves them with it (the shape is preserved). This is the selected policy for acceptance test 1.

## Plan

**Now (vertical slice — completes Phase 1 and the acceptance tests):** melody note locks · allowed-notes switch · max-simultaneous-notes rule · separate Surprise control · undo/redo + history · rule preview · simple/advanced mode · snapshots · JSON import/export · engine version.

**Phase 2 (high value):** soft constraints with probabilities · identity locks with bounded ranges · AI proposes 2–3 systems + A/B compare · "why did that happen?" event inspector · MIDI export · chord palette, pedal tonic, tonal-centre strength, scheduled key changes · melody contour / articulation · per-layer scale subsets, phase and loop lengths.

**Phase 3 (experimental):** cellular automaton engine with live grid · loop-length and growth/decay engines · user-uploaded sounds (cached like Generative.fm's samples) · installable offline app.
