# DRIFT

**An instrument for people who don't play instruments.** You describe a feeling or a place, shape how the music should behave, and DRIFT plays original music from those conditions — continuously, never quite the same twice.

For what DRIFT does and how it works, see **[docs/OVERVIEW.md](docs/OVERVIEW.md)**.

---

## Run it

You need **Node.js 20 or newer** (the LTS version from [nodejs.org](https://nodejs.org) is fine) and a modern desktop browser (Chrome, Edge, Firefox or Safari).

```bash
git clone https://github.com/Janieneavin/drift.git
cd drift
npm install
npm run dev
```

Open **http://localhost:3210** and press **Play** (or the space bar). Browsers only allow sound after you interact with the page, so the first click is needed.

The first time it plays, the piano recordings stream from the internet (about 2 MB, then cached). Offline, a soft synthesized piano is used instead.

### Optional: the AI interpreter

Without a key, DRIFT works fully, and typed requests use a simple offline interpreter that understands phrases like *slower, warmer, add drums, change the key to D*. To let Claude interpret anything you type:

1. Create an API key at [console.anthropic.com](https://console.anthropic.com) (usage is billed per request — typically a few cents).
2. Copy `.env.local.example` to `.env.local` and paste the key after `ANTHROPIC_API_KEY=`.
3. Restart `npm run dev`. The top bar changes from **Offline interpreter** to **AI interpreter**.

`.env.local` is excluded from git; never commit or share it.

### Production build

```bash
npm run build
npm start
```

---

## Using it

- **Simple mode** (default): pick a piece, press play, shape it with **Density**, **Evolution**, **Intensity** and **Unpredictability**, switch **Drums** on or off, and mix the layers.
- **Advanced mode** (top bar): the style (Ambient · Phrases · Pulse), the Markov chains, key, scale, tempo, chord progression, per-layer details, melodies, rules, undo history.
- **Library**: save a piece (the system itself), save a snapshot (system + seed, replays exactly), export/import JSON, record a performance to WAV.
- **Shortcuts**: <kbd>Space</kbd> play/stop · <kbd>F</kbd> immersive · <kbd>Esc</kbd> leave immersive · <kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>⇧</kbd>+<kbd>⌘/Ctrl</kbd>+<kbd>Z</kbd> redo · <kbd>?</kbd> show all shortcuts.

## Credits

- Piano: **Salamander Grand Piano** by Alexander Holm, CC BY 3.0, served from the Tone.js project.
- Techniques: Brian Eno's tape-loop method (*Music for Airports*); Alex Bainter's phrase-level Markov chain (*Generating More of My Favorite Aphex Twin Track*, 2018); minimalist additive and interlocking patterns (Steve Reich). All musical material in DRIFT is original or public domain.
- Built with Next.js, React, TypeScript, Tone.js, Zod, and the Anthropic API.
