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
| Two players: P1 keys to A, P2 keys to B, both in lockstep, 2-frame delay | SGDK `joy-test`, `gentris` | 1440 | 24 | all equal; each pad showed only its own player's buttons, identical on both screens |

Both instances cold-booted independently in two iframes of one headless Chrome tab, driven by the same inputs. The game's random piece sequence stayed identical on both sides.

The live modes are the netcode minus the network: each side tags its input with `frame + delay`, sends it, and stalls a frame until the peer has confirmed that frame's inputs. With both instances in one tab each side stalled 1 iteration in ~1400 frames.

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
- [ ] Real network between the two instances: WebSocket relay done on one PC (see below); still open: real latency, jitter, two machines, WebRTC
- [ ] Two different browsers, two different machines
- [ ] Start from a transferred savestate instead of cold boot (`loadState`)
- [ ] SRAM: both iframes share one origin's IndexedDB save folder, so they started from the same saves by construction
- [ ] Hashing cost: 1 MB state every 60 frames was fine; per-frame hashing for rollback is unmeasured
- [ ] Threaded cores

## Relay MVP #8 — two browsers through the WebSocket relay

Code: server `src/Server/Server/Relay/`, client `src/Server/Server/wwwroot/`. Messages: `PROTOCOL.md`. Same lockstep as the spike's two-player mode, with the same-tab messaging replaced by an ASP.NET Core WebSocket relay; one emulator per page.

### Result: works on one PC, two physical machines not tested

Automated with puppeteer: two separate headless Chrome instances (separate profiles), one on `http://localhost:5279` and one on `http://192.168.1.6:5279` (the PC's LAN address, so that page is **not a secure context**, like a real second machine). Each browser pressed its own keys with the normal EmulatorJS key map.

| Run | ROM | Frames | Checkpoints | Result |
|---|---|---|---|---|
| Two players, delay 3 | SGDK `joy-test` | 1800 | 30 | all equal; pad 1 showed only player 1's buttons, pad 2 only player 2's, identical on both screens |
| Two players, delay 3 | SGDK `gentris` | 3540 | 59 | all equal |
| Negative control: one input injected on player 2's side only at ~frame 3560 | `gentris` | — | — | both sides showed DESYNC, first differing checkpoint 3600 |
| Different ROMs (`gentris` vs `platformer`) | — | — | — | both sides refused to start with "ROM mismatch" and both hashes |
| Third page joins the room | — | — | — | rejected: "Room TEST1 already has two players."; the game was not disturbed |
| Player 2's tab put in the background for 3 s | `joy-test` | — | — | player 1 stalled and showed "paused: the peer's tab is hidden or minimised"; resumed in sync when it came back |
| Player 2's page closed | `joy-test`, `gentris` | — | — | player 1 froze and showed "Peer disconnected at frame N" |
| Server killed mid-game | `platformer` | — | — | both showed "Connection to the server lost at frame N" |

- Delay is agreed through the room: player 1 asked for 3, player 2 for 7, both ran with 3.
- Both emulators reported first frame 0 and identical start-state hashes.
- Stalls: 1-4 waited iterations per side in 1800-3500 frames on loopback.
- EmulatorJS 4.2.3 itself loads and runs on a non-secure `http://<LAN-IP>` page. The client uses the spike's plain JS hash, not `crypto.subtle`.
- `dotnet test`: 13 unit tests on the room logic, 3 integration tests through a real WebSocket on the test server.

### Not tested / known weak points

- [ ] Two physical machines, real Wi-Fi/LAN latency and jitter, Windows Firewall prompt. Everything above ran on one PC over loopback, where latency is ~0. With delay 3 (50 ms) a slower link will stall more often; raise the delay on player 1's side
- [ ] Browsers other than Chrome; a real (non-headless) window; gamepads
- [ ] A commercial game (needs the tester's own ROM), long sessions
- [ ] Save RAM: each browser has its own saves. A game with battery saves can start from different states; the start-state hash check should refuse it, but that path was never triggered in a test
- [ ] EmulatorJS menu: restart, save/load state, cheats and netplay buttons are hidden, but the settings menu (core options, fast forward, rewind) is still reachable and will desync
- [ ] No resync after a desync and no reconnect: on peer loss or socket drop the page must be reloaded
- [ ] A peer that vanishes without closing its socket should be reported after the server's 15 s keep-alive timeout, with "waiting for the peer's input" shown until then; this path was not tested
- [ ] No auth, no rate limit, anyone on the LAN can join a room by its code
