# Phase 0 findings

Running log of audit results (#1) and spike results (#22). Licensing is separate: `LICENSING.md` (#2).

## Spike #22 — frame control + determinism

Code: `spikes/determinism/`. EmulatorJS 4.2.3 from CDN, core `genesis_plus_gx`, non-threaded build.

### Result: go

| Run | ROM | Frames | Checkpoints | Result |
|---|---|---|---|---|
| Sync | SGDK `gentris` sample (random pieces) | 6000 | 100 | all equal |
| Sync | SGDK `platformer` sample | 6000 | 100 | all equal |
| Negative control, 1 button flipped for 1 frame at 900 on B | `gentris` | 1800 | 30 | equal through 900, different from 960 on |
| Live mirror: keys pressed on A only, 2-frame input delay, B in lockstep | `gentris` | 1140 | 19 | all equal |

Both instances cold-booted independently in two iframes of one headless Chrome tab, driven by the same inputs. The game's random piece sequence stayed identical on both sides.

Live mirror is the netcode minus the network: host tags each input with `frame + delay`, guest stalls a frame until the host has confirmed its inputs. With both instances in one tab the guest stalled 1 iteration in 1140 frames.

### Emulator control surface

| Need | Available | How |
|---|---|---|
| ROM from `<input type=file>` | yes | `EJS_gameUrl` accepts a `File` |
| Frame number | yes | `gameManager.getFrameNum()` (`get_current_frame_count`) |
| Input injection | yes | `gameManager.functions.simulateInput(player, button, value)` |
| Per-frame callback | yes, with a workaround | Emscripten `preMainLoop` / `postMainLoop` |
| Stall a frame (lockstep) | yes | `preMainLoop` returning `false` skips the iteration |
| Save state | yes | `gameManager.getState()`, 1,036,312 bytes for Genesis |
| Load state | exported, not exercised yet | `gameManager.loadState(bytes)` |

- One main-loop iteration advanced exactly one frame in every run (0 idle, 0 multi-step iterations).
- Inputs set in `preMainLoop` are read by the frame that runs right after.
- The full savestate hashes identically across instances, so it works as the sync checksum without digging into core memory.

### Workaround: loop hooks must exist at module creation

Emscripten reads `preMainLoop` / `postMainLoop` only when the module is created. Assigning them on `EJS_emulator.Module` after start does nothing. EmulatorJS builds the module config internally, so the spike wraps `window.EJS_Runtime` (the core factory) and adds the two hooks to the config. This depends on EmulatorJS internals; the real client needs the same trick, a small EmulatorJS patch, or an upstream option.

### Not covered yet

- [ ] Commercial co-op game with AI enemies (needs the tester's own ROM)
- [ ] Two different browsers, two different machines
- [ ] Start from a transferred savestate instead of cold boot (`loadState`)
- [ ] SRAM: both iframes share one origin's IndexedDB save folder, so they started from the same saves by construction
- [ ] Hashing cost: 1 MB state every 60 frames was fine; per-frame hashing for rollback is unmeasured
- [ ] Threaded cores
