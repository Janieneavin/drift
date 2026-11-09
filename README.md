# DRIFT

An instrument for people who don't play instruments. You design the conditions — what it should feel like and how it should behave — and a generative engine plays original music from them, forever, never quite the same.

## Run it

Node is installed in `~/.local/node` (no admin rights needed).

```bash
cd ~/drift
export PATH=~/.local/node/bin:$PATH
npm run dev
```

Open http://localhost:3210 and press play (or the space bar).

### Turn on the AI interpreter

Without a key, DRIFT uses a clearly labelled **offline interpreter** (keyword matching) so the instrument always works. For full natural-language interpretation with Claude:

```bash
cp .env.local.example .env.local   # then paste your key after ANTHROPIC_API_KEY=
```

Restart `npm run dev`. The pill in the top bar changes to **AI interpreter**.

## How it's built

| Part | Where | AI? |
|---|---|---|
| Configuration schema (Zod) | `lib/schema.ts` | no |
| Rules the engine can execute | `lib/rules.ts` | no |
| Generative music engine (Tone.js) | `lib/engine/` | no |
| "Your musical system" — plain-language, editable view of the config | `lib/describe.ts` | no |
| Patch format the AI returns (only what changes) | `lib/interpret/patch.ts` | — |
| Claude interpreter | `app/api/interpret/route.ts`, `lib/interpret/prompt.ts` | **yes** |
| Offline fallback interpreter | `lib/interpret/offline.ts` | no |
| Visuals driven by engine events | `components/Visualizer.tsx` | no |
| Saving systems, seeds, recordings → WAV | `lib/storage.ts`, `lib/wav.ts`, `components/Library.tsx` | no |

The AI only ever returns a validated **patch** (every field nullable; null = keep as is). The engine never waits on it, so the music keeps playing if the AI is slow or unavailable.

### The engine

- Each layer schedules its own notes; gaps come from density, pace, activity and unpredictability, with phrase-length rests.
- Pitches are chosen from the scale, weighted toward the current chord and the previous note (or replayed from a remembered phrase, varied).
- A slow chord progression moves by common root motions; pads re-voice smoothly.
- A clash guard removes semitone rubs and crowding in the low end.
- Evolution slowly random-walks each layer's activity, register and tone.
- All events run in time order on a logical clock, so a fixed seed reproduces a performance exactly.

### Notes & time (direct control)

At the top of the right panel: key, tonality (real scale names), your own scale (tap notes on the keyboard), tempo in BPM, and pulse (free-floating ↔ every layer locked to one beat grid). Each layer also has its own speed (¼× to 3×) and an optional **melody** you draw on a grid: columns are beats, rows are steps up/down the scale. The engine anchors it on the current harmony, brings it back as often as you choose, and varies it with unpredictability.

### Rules (creative constraints)

Never more than N sounds · each sound quieter than the last · layers drift apart · a new instrument every N minutes · gradually less recognizable · melodies take turns · no notes above / below a line · higher notes become rarer.

Anything else is reported as "not applied", never faked.
