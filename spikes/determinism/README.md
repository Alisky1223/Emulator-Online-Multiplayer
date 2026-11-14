# Determinism spike (#22)

Two EmulatorJS instances on one machine, same ROM, same inputs (live or scripted), state hashes compared every N frames. No server involved. Throwaway code.

## Run

```
node spikes/determinism/serve.mjs
```

Open `http://localhost:8080`, pick your own ROM, press **Run**. Needs internet: EmulatorJS 4.2.3 and the core load from `cdn.emulatorjs.org`. Keep the tab visible; a background tab stops rendering frames.

## Live mode (default)

You play on A; B mirrors.

1. Wait until both screens show the game, then click screen A.
2. Play with the EmulatorJS keys (arrows, Enter = Start, Z / X / A / S ...) or a gamepad.
3. Watch B and the status line: **IN SYNC so far** = every checkpoint hash equal, **DESYNC** = states differ.

How it works: A does not apply your input at once. Each input is tagged with a frame `Input delay` frames ahead, sent to B, and applied by both on that frame. B runs a frame only after A has confirmed that frame's inputs (lockstep). B ignores its own keyboard and gamepad.

Do not use the EmulatorJS menu on A for save/load state, restart, fast-forward or rewind: those change A only and will desync, which is expected.

## Scripted mode

Both instances compute the same inputs from `(seed, frame, player)`; the run ends after `Frames`.

- **Perturb B at frame** — flips one button for one frame on B only. Hashes must diverge after it; this proves the hash would catch a real desync.
- **Press Start until frame** — scripted Start presses to get past title/menus into gameplay.

## Files

| File | Role |
|---|---|
| `index.html`, `harness.js` | Parent page: boots two iframes, compares hashes |
| `instance.html`, `instance.js` | One emulator instance: per-frame hooks, input injection, state hashing |
| `script.js` | Scripted inputs as a pure function of `(seed, frame, player)`; hash function |
| `serve.mjs` | Zero-dependency static server |
