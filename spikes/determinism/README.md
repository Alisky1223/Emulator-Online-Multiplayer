# Determinism spike (#22)

Two EmulatorJS instances on one machine, same ROM, same scripted inputs, state hashes compared every N frames. No server involved. Throwaway code.

## Run

```
node spikes/determinism/serve.mjs
```

Open `http://localhost:8080`, pick your own ROM, press **Run**. Needs internet: EmulatorJS 4.2.3 and the core load from `cdn.emulatorjs.org`.

- **IN SYNC** — every checkpoint hash equal on A and B.
- **DESYNC** — first differing checkpoint frame is shown.
- **Perturb B at frame** — flips one button for one frame on B only. Hashes must diverge after it; this proves the hash would catch a real desync.
- **Press Start until frame** — scripted Start presses to get past title/menus into gameplay.

Keep the tab visible; a background tab stops rendering frames.

## Files

| File | Role |
|---|---|
| `index.html`, `harness.js` | Parent page: boots two iframes, compares hashes |
| `instance.html`, `instance.js` | One emulator instance: per-frame hooks, input injection, state hashing |
| `script.js` | Scripted inputs as a pure function of `(seed, frame, player)`; hash function |
| `serve.mjs` | Zero-dependency static server |
