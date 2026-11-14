# Determinism spike (#22)

Two EmulatorJS instances on one machine, same ROM, same inputs (live or scripted), state hashes compared every N frames. No server involved. Throwaway code.

## Run

```
node spikes/determinism/serve.mjs
```

Open `http://localhost:8080`, pick your own ROM, press **Run**. Needs internet: EmulatorJS 4.2.3 and the core load from `cdn.emulatorjs.org`. Keep the tab visible; a background tab stops rendering frames.

## Two players (default)

A is player 1, B is player 2. Each instance sends only its own pad and waits for the other's inputs before running a frame — the real netcode with same-tab messaging in place of the network.

1. Wait until both screens show the game, then click screen A.
2. Player 1: EmulatorJS keys (arrows, Enter = Start, Z / X / S ...) or a gamepad.
3. Player 2: `I J K L` move, `U O P` buttons, `M` Start. These work while A has focus, so two people can share one keyboard.
4. Watch the status line: **IN SYNC so far** = every checkpoint hash equal, **DESYNC** = states differ.

How it works: input is not applied at once. Each press is tagged with a frame `Input delay` frames ahead, sent to the peer, and applied by both on that frame. A frame runs only after the peer has confirmed its inputs for it (lockstep), so if one side stops, both stop.

## Mirror

You play on A; B sends nothing and copies A. B ignores its own keyboard and gamepad.

In both live modes, save/load-state, fast-forward and rewind hotkeys are blocked. Do not use the EmulatorJS menu for save/load state or restart either: those change one side only and will desync, which is expected.

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
