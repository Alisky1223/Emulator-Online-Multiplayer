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
└── research/        reference clones for the Phase 0 audit (git-ignored)
```

## 🧰 Planned Stack

ASP.NET Core · SignalR · EF Core · PostgreSQL / SQL Server · Redis · coturn (TURN) · EmulatorJS + libretro Genesis core. `docker-compose` for infrastructure once the prototype works. Not before it's needed: React frontend, mobile, payments, chat, friends, leaderboards, microservices, k8s, custom emulator.

## 🚧 Current Status

**Sprint 1 — Phase 0 (technical investigation).** Repo scaffold in place; auditing the building-block repos before writing platform code.

## ⚠️ Biggest Risks

Emulator control (input + frames) · determinism across two browser instances · save-state access for rollback · WebRTC behind NAT · licensing (EmulatorJS + core + Netplay), especially for commercial use.

## 📜 License

See [LICENSE](LICENSE). Emulators and ROMs carry their own licenses and legal requirements; this project distributes no copyrighted game ROMs.

## 🤝 Contributing

Priority is a **minimal deterministic multiplayer prototype** before expanding into a full platform. Synchronization research, emulator integration experiments, and testing are welcome — start from the [roadmap](../../issues/17).
