# Product Backlog

Source of truth for issues is GitHub. This file is the readable overview: what each item delivers and which sprint it sits in. Tracking issue: [#17](../../../issues/17).

Sprint = GitHub Milestone = one roadmap phase. Item IDs below are GitHub issue numbers.

## Ordering principle

Prove the hardest technical assumptions first (frame control, determinism). Product and infrastructure work only after the netcode core is proven. Nothing in "Not now" gets built before M2.

## Sprint 1 — Phase 0: Technical Investigation

Goal: know whether the approach is feasible before building it.

| # | Item | Notes |
|---|------|-------|
| 1 | Audit EmulatorJS / EmulatorJS-Netplay / playtime | ROM load, input injection, frame control, save-state, netplay protocol, WebRTC/NAT. Output: `docs/PHASE0.md` |
| 2 | Licensing audit | EmulatorJS + Genesis core + Netplay + libs; commercial obligations. Output: `docs/LICENSING.md` |
| 18 | Repo scaffolding | ✅ done — `docs/`, `research/`, test projects |
| 20 | Update README + this backlog | ✅ done |

Exit criteria: documented answers to the emulator / netplay / browser questions in #1; go/no-go on frame control and determinism.

## Sprint 2 — Phase 1: Emulator Prototype

| # | Item |
|---|------|
| 3 | Minimal client — select local ROM, load EmulatorJS + Genesis core, play |

Exit: open the page, pick a ROM, play it. No server.

## Sprint 3 — Phase 2: Input Abstraction

| # | Item |
|---|------|
| 4 | `InputManager` + `ControllerState` decoupled from EmulatorJS internals; local path end-to-end |

## Sprint 4 — Phase 3: Frame Control

| # | Item |
|---|------|
| 5 | Prove frame counter access + stepped advance (frame N → input → frame N+1) |

Risk item. If unachievable, stop and re-investigate the core.

## Sprint 5 — Phase 4: Determinism Test → **M0**

| # | Item |
|---|------|
| 6 | Two instances, same ROM + state + scripted inputs → identical periodic state hashes |

**M0** = state hashes match across two browsers through several thousand frames.

## Sprint 6 — Phase 5: Input Protocol

| # | Item |
|---|------|
| 7 | Frame-based message `{ type, frame, player, buttons }`, buttons bitmask; encode/decode + tests; `docs/PROTOCOL.md` |

## Sprint 7 — Phase 6: WebSocket Relay MVP → **M1**

| # | Item |
|---|------|
| 8 | ASP.NET Core WebSocket relay A↔B for frame inputs |

**M1** = two browsers exchange frame-based inputs over WebSocket.

## Sprint 8 — Phase 7: Game Session Backend → **M2**

| # | Item |
|---|------|
| 9 | `GameSession` entity + state machine (Waiting → … → Running → Finished); backend scaffold (API/Application/Domain/Infrastructure, SignalR, EF Core, Postgres) |
| 10 | ROM identification via SHA-256; reject hash mismatch |
| 11 | Generic `Game` entity (Id, Name, Platform, RomHash, EmulatorCore, InputProfile) |

**M2** = two browsers play a real two-player Genesis game together.

## Sprint 9 — Phase 8: WebRTC Gameplay → **M3**

| # | Item |
|---|------|
| 12 | ASP.NET Core signaling (offer/answer/ICE) + WebRTC DataChannel; gameplay off the server |
| 13 | `docker-compose`: api, database, redis, turn (coturn) |

**M3** = WebRTC peer-to-peer gameplay.

## Sprint 10 — Phase 9: Latency Handling

| # | Item |
|---|------|
| 14 | V1 input delay → V2 frame acks → V3 prediction → V4 rollback (rollback only if core supports state manipulation) |

## Sprint 11 — Phase 10: Desync Detection

| # | Item |
|---|------|
| 15 | Periodic `{ frame, stateHash }` exchange; flag + abort on divergence |

## Sprint 12 — Phase 11: User Experience → **M4**

| # | Item |
|---|------|
| 16 | Home → select game → ROM → find match → opponent found → ROM verified → ready → sync → play; disconnect/desync UX |

**M4** = matchmaking. **M5** (production platform) is post-roadmap hardening.

## Not now (do not build before M2)

React frontend · mobile app · payments · chat · friends · achievements · leaderboards · many games · cloud saves · microservices · Kubernetes · custom emulator · custom rollback implementation.
