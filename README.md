# Emulator Online Multiplayer

A web platform where two players play a supported retro game online while **each browser locally emulates the player's own legally obtained ROM**. The server coordinates matchmaking and sessions; gameplay stays in sync by exchanging **frame-based controller inputs**, not video or game state.

> **Run locally. Synchronize inputs. Play together.**

## 🎮 Concept

Instead of running the game on a central server and streaming video, every player runs an emulator in their **own browser** via [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS). The backend never sees the ROM, the video, or the full game state — only inputs, frame numbers, and session state.

```text
                         OUR PLATFORM
                              │
                ┌─────────────┴─────────────┐
                │                           │
          Control Plane                Game Plane
          (ASP.NET Core)               (Browser / EmulatorJS)
                │                           │
       ┌────────┼────────┐          ┌───────┴───────┐
    Account  Lobby   Matchmaking   Player A       Player B
                                   Emulator        Emulator
                                     │               │
                                   ROM A            ROM B
                                     │               │
                                     └── inputs ─────┘
```

## 🧠 How It Works

A deterministic emulator produces the same result given the same:

```text
ROM  +  Core version  +  Initial state  +  Input sequence  +  Frame timing
```

So the network only carries inputs, tagged with the frame they apply to:

```text
Frame 1000  P1 → LEFT
Frame 1001  P1 → LEFT + A
Frame 1003  P2 → RIGHT
```

Each local emulator applies the same input at the same frame and both stay synchronized.

## 🌐 Two Planes

### Control plane — ASP.NET Core

Accounts · game catalog · rooms · matchmaking · session lifecycle · ready state · ROM-hash verification · WebRTC signaling. **Never simulates the game.**

### Game plane — browser

EmulatorJS + a libretro Genesis core + local ROM. Player inputs travel A↔B:

- **Prototype:** WebSocket relay through the server (easy to debug).
- **Target:** WebRTC DataChannel peer-to-peer; server only does signaling.

```text
Prototype:  A ─► ASP.NET Core ─► B
Target:     A ◄──── WebRTC DataChannel ────► B   (server signals only)
```

## 🕹️ Emulator

First target: **Sega Genesis / Mega Drive** (concept centers on games like *Streets of Rage*). The emulator layer is abstracted so other cores/consoles can be added without touching matchmaking.

Phase 0 audits whether EmulatorJS / the core give us enough control over: ROM loading from `<input type=file>`, programmatic input injection, frame counter + stepped advance, save/load state, deterministic execution. See [docs/README.md](docs/README.md).

## 🔐 ROM Ownership

Players supply their **own legally obtained ROMs**. The server receives only a **SHA-256 hash** and rejects a session when the two players' hashes differ (region / revision / modified ROM) — the usual source of mysterious desync. No copyrighted ROMs are hosted or distributed.

## 🔄 Synchronization Models

Introduced in order, only as needed:

1. **Input delay** — inputs applied a few frames late to hide jitter.
2. **Frame acknowledgements** — "I have inputs through frame N".
3. **Prediction** — repeat last remote input when one is missing.
4. **Rollback** — save state → predict → re-simulate on arrival. Only if the core supports the required state manipulation.

Lockstep + input delay first; rollback is a later phase.

## 🗺️ Roadmap

Full tracking issue: [#17 Roadmap & Scrum tracking](../../issues/17). Backlog: [docs/BACKLOG.md](docs/BACKLOG.md).

| Phase | Focus |
|------|-------|
| 0 | Technical audit of EmulatorJS / EmulatorJS-Netplay / playtime + licensing |
| 1 | Minimal client: select ROM, load core, play |
| 2 | Input abstraction (`InputManager` + `ControllerState`) |
| 3 | Prove frame control (frame counter + stepped advance) |
| 4 | Determinism test — identical state hashes across two instances |
| 5 | Frame-based input protocol |
| 6 | WebSocket input relay MVP (ASP.NET Core) |
| 7 | `GameSession` backend + state machine + ROM-hash verification |
| 8 | WebRTC gameplay + signaling + Docker infra |
| 9 | Latency handling (delay → acks → prediction → rollback) |
| 10 | Desync detection (periodic state-hash exchange) |
| 11 | User experience flow |

**Delivery milestones:** M0 identical state hashes across two browsers · M1 WebSocket frame inputs · M2 real two-player Genesis game · M3 WebRTC gameplay · M4 matchmaking · M5 production platform.

Scrum: each phase is a GitHub Milestone = one sprint.

## 🏗️ Project Structure

```text
Emulator-Online-Multiplayer/
├── src/
│   ├── Client/       browser client host
│   ├── Server/       ASP.NET Core — API, sessions, signaling, relay
│   ├── Emulator/     emulator abstraction (adapters per core)
│   └── Protocol/     wire messages + serialization
├── tests/
│   ├── Architecture.Tests/   layering / plane-boundary rules
│   ├── Unit.Tests/           domain, protocol, input merge
│   ├── Integration.Tests/    ASP.NET Core, EF Core, relay
│   └── E2E.Tests/            browser-driven two-client flows
├── docs/            architecture, protocol, audit findings, backlog
├── spikes/          throwaway experiments (determinism harness, #22)
└── research/        reference clones for the Phase 0 audit (git-ignored)
```

## ▶️ Run it (two players over WebSocket, M1)

One PC runs the server; it also serves the browser client. Needs the .NET 10 SDK, and internet on both machines (EmulatorJS loads from `cdn.emulatorjs.org`).

```
dotnet run --project src/Server/Server
```

The server listens on port **5279** on all interfaces and prints the URLs to open.

1. On the server PC open `http://localhost:5279`.
2. On the second machine (same LAN) open `http://<server-PC-LAN-IP>:5279`, e.g. `http://192.168.1.6:5279`. The server prints its addresses at start; otherwise run `ipconfig` on the server PC and take the **IPv4 Address** of the Wi-Fi / Ethernet adapter.
3. The first time, Windows Firewall may ask whether to allow the server: allow it on **private networks**. If the second machine cannot connect, that prompt was dismissed; allow inbound TCP 5279 by hand.
4. On both: type the same room code, pick the same ROM file (your own copy on each machine), press **Join**. First to join is player 1, second is player 2.
5. When both emulators have loaded the game starts on both. Click the game screen and play with the normal EmulatorJS keys or a gamepad. The status line shows **IN SYNC** or **DESYNC**.

Two browser windows on one PC work too (both on `http://localhost:5279`), but keep both windows visible side by side: a hidden or minimised tab stops rendering frames and pauses the game for both players.

Do not use save/load state, restart, fast forward, rewind or cheats; they change one side only. Wire messages: [docs/PROTOCOL.md](docs/PROTOCOL.md). What was tested: [docs/PHASE0.md](docs/PHASE0.md).

## 🧰 Planned Stack

ASP.NET Core · SignalR · EF Core · PostgreSQL / SQL Server · Redis · coturn (TURN) · EmulatorJS + libretro Genesis core. `docker-compose` for infrastructure once the prototype works. Not before it's needed: React frontend, mobile, payments, chat, friends, leaderboards, microservices, k8s, custom emulator.

## 🚧 Current Status

Determinism spike done (#22). WebSocket relay MVP (#8, M1) works: two browsers play in lockstep through the ASP.NET Core relay; verified with two browser instances on one PC, not yet on two physical machines. See [docs/PHASE0.md](docs/PHASE0.md).

## ⚠️ Biggest Risks

Emulator control (input + frames) · determinism across two browser instances · save-state access for rollback · WebRTC behind NAT · licensing (EmulatorJS + core + Netplay), especially for commercial use.

## 📜 License

See [LICENSE](LICENSE). Emulators and ROMs carry their own licenses and legal requirements; this project distributes no copyrighted game ROMs.

## 🤝 Contributing

Priority is a **minimal deterministic multiplayer prototype** before expanding into a full platform. Synchronization research, emulator integration experiments, and testing are welcome — start from the [roadmap](../../issues/17).
