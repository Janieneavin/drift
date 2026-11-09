# DRIFT — project overview

## The idea

Most AI music tools generate a finished track from a prompt. DRIFT does something different: **the user designs a musical system, and the system plays.** Inspired by Brian Eno's generative music, DRIFT is an instrument for people who don't play instruments. You describe a place or feeling, decide how the music should behave, and DRIFT performs it endlessly — recognizably the same piece, never exactly the same performance.

The AI is a translator, not the composer. It turns your words into settings and rules you can see, edit, save and share.

## How someone uses it

1. **Pick or describe a piece.** Choose a starting point (e.g. *City at 4 A.M.*, *Departures*, *Endless Piano*) or type an atmosphere like *"a lighthouse at dusk, lonely but calm."*
2. **Press play** and shape it live with four controls — **Density** (how many notes), **Evolution** (how fast it changes), **Intensity** (how bright and full), **Unpredictability** (how loosely it varies) — plus a **Drums** switch and per-layer volume.
3. **Direct it in words** (*"make it warmer," "slow down the harmonic changes"*) or set **rules** (*"never more than two sounds at once"*). Only what you mention changes; everything else is preserved.
4. **Save the system**, not just a recording. Reopening it plays a new performance of the same piece; a saved **seed** replays one performance exactly. Recordings export as WAV; systems export as JSON.

Simple mode shows only the essentials; Advanced mode exposes everything.

## Three ways the music is made

| Style | Inspired by | How it works |
|---|---|---|
| **Ambient** | Eno, *Music for Airports* | Each voice repeats a short phrase on its own loop length (17.9 s, 23.3 s, 29.1 s…). Because the lengths never line up, the combination of voices never repeats. All notes come from a clash-free pitch set (no two notes a semitone apart) over a slowly shifting drone. |
| **Phrases** | Alex Bainter's endless *aisatsana* | A Markov chain over whole phrases writes a new 16-beat piano phrase at a time, in the style of the phrases it learned. |
| **Pulse** | Steve Reich; Eno's *The Big Ship* | Interlocking patterns on a shared beat over a repeating chord progression; notes are added and removed one at a time, and the piece cycles Beginning → Development → Expansion → Release. |

## The Markov chains

DRIFT uses Markov chains at three levels, each visible in the interface:

- **Note to note (Ambient).** An 8×8 table: for the note just played, how likely each next note is. Its default is *learned* from a small corpus of public-domain melodies (Beethoven, Dvořák, Satie, Brahms, traditional folk songs). It writes each loop's phrase, then occasionally rewrites one note. Users can click cells to change the probabilities and watch transitions light up live.
- **Phrase level (Phrases).** Each state is *a beat position + the notes on it + the bass underneath*, learned from 16 original phrases (and any the user writes in a grid). Walking the chain follows one phrase and switches to another wherever they agree, so new phrases sound like they belong; the default set can produce over 100,000 distinct phrases. A live piano roll colours every note by the phrase it came from.
- **Chord to chord.** When harmony is left free, the next chord is chosen by weighted transitions from the current one.

## What uses AI and what doesn't

| AI (Claude) | Conventional code |
|---|---|
| Turning a description into a complete system | All sound generation (Tone.js / Web Audio) |
| Applying instructions as *changes* to the current system | Scheduling, Markov chains, patterns, loops |
| Translating plain-language rules into DRIFT's fixed rule types, and saying honestly when a request can't be done | Executing rules, controls, undo history, saving, seeds, WAV export, visuals |

The AI returns a **patch** (only what changes), validated against a schema before it touches anything. The music engine never waits on the AI: if the AI is unavailable, an offline keyword interpreter takes over, clearly labelled, and the music keeps playing.

## Architecture

- **Next.js + React + TypeScript** interface; **Tone.js / Web Audio** synthesis in the browser.
- **One configuration schema (Zod)** describes a whole piece: key, scale, tempo, layers, rules, Markov tables, phrases, seed. Everything — presets, saves, AI output, imports — passes through it.
- **A deterministic engine**: all events run in time order on a logical clock from a seeded random generator, so a fixed seed reproduces a performance exactly.
- **Transparency**: a plain-language "Your musical system" panel; rules shown as cards that pulse when they act; notes a rule blocks appear as "ghosts" in the visuals; a GPU-rendered horizon scene whose colour follows the chords, whose sun rises with the music's intensity, and whose sea glitters with each note.

## How it was tested

Checks run in the browser against the live engine, for example: notes stay within the chosen key and pitch set (0 semitone clashes in ambient tests); every layer sounds; a fixed seed replays identical events; the "never more than N notes" rule holds; density, evolution and intensity each change the music independently; the phrase chain produces new phrases; AI requests return valid patches; no console errors; the production build succeeds.

## Limitations

- Sound quality was tuned by measurement and established technique; it benefits from more human listening.
- Without an API key, typed requests understand only simple phrases.
- Long sessions (hours) and phones have not been tested thoroughly.
- The sampled piano needs an internet connection the first time.

## Credits and sources

- Brian Eno — generative music; *Music for Airports* tape-loop method.
- Alex Bainter — *How to Host a Generative Music Platform on the Web* (2019) and *Generating More of My Favorite Aphex Twin Track* (2018).
- Steve Reich — additive and interlocking pattern techniques.
- Salamander Grand Piano — Alexander Holm, CC BY 3.0.
- All melodies, phrases and patterns in DRIFT are original or public domain. No copyrighted recordings or melodies are used.
