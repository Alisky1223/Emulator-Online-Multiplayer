# Emulator Multiplayer

A multiplayer framework for classic console games that lets each player run the game locally while synchronizing controller input over the network.

The core idea is simple:

> **Each player runs the emulator and ROM locally. The server synchronizes player inputs and timing rather than streaming video or game state.**

This approach aims to provide a lightweight online multiplayer experience for games that were originally designed for local multiplayer.

## 🎮 Concept

Instead of running the game on a central server and streaming the video to players, every participant runs an emulator on their own computer.

```text
                 ┌─────────────────────┐
                 │   Multiplayer Server │
                 │                     │
                 │  Input Synchronizer │
                 │  Session / Lobby    │
                 └──────────┬──────────┘
                            │
              Input + Frame │ Synchronization
                            │
             ┌──────────────┴──────────────┐
             │                             │
      ┌──────▼──────┐               ┌──────▼──────┐
      │   Player 1  │               │   Player 2  │
      │              │               │              │
      │   Emulator   │               │   Emulator   │
      │     +        │               │     +        │
      │  Local ROM   │               │  Local ROM   │
      └──────────────┘               └──────────────┘
```

The server does **not** need to transmit:

* Game video
* Audio
* ROM files
* Emulator state every frame
* Full game state

Instead, it primarily synchronizes:

* Controller inputs
* Frame numbers
* Player/session state
* Synchronization events

## 🎯 Goals

* Enable online multiplayer for supported retro games.
* Keep emulator execution local to each player.
* Minimize network bandwidth.
* Avoid centralized ROM hosting.
* Support legally owned ROMs supplied by players.
* Provide deterministic synchronization between emulator instances.
* Build a reusable networking layer rather than a game-specific implementation.

## 🧠 How It Works

For a deterministic emulator, the same:

```text
ROM
+
Emulator Version
+
Initial State
+
Input Sequence
+
Frame Timing
```

should produce the same game state.

Therefore, instead of sending the entire game state over the network, the system can synchronize the **inputs**.

For example:

```text
Frame 1000
Player 1 → LEFT

Frame 1001
Player 1 → LEFT + A

Frame 1002
Player 1 → RELEASE

Frame 1003
Player 2 → RIGHT
```

Each local emulator receives the same input sequence at the same frame.

The objective is for both emulators to remain synchronized.

## 🌐 Network Architecture

The initial architecture is planned around an authoritative synchronization server.

```text
Client A ─────┐
              │
              ▼
        ┌──────────────┐
        │ Game Session │
        │    Server    │
        └──────┬───────┘
               │
Client B ──────┘
```

The server can be responsible for:

1. Creating game sessions
2. Joining/leaving players
3. Assigning player slots
4. Establishing the initial synchronization point
5. Distributing controller inputs
6. Tracking frame numbers
7. Detecting synchronization problems

The actual game simulation remains local.

## 🕹️ Emulator

The project is intended to work with an open-source emulator that provides sufficient control over:

* Controller input
* Frame advancement/timing
* Emulator initialization
* ROM loading
* Deterministic execution
* Potentially save states or emulator state inspection

The first implementation will target **Sega Genesis / Mega Drive** because the original project concept focuses on games such as *Streets of Rage*.

The emulator layer should be abstracted so that another emulator or console can be integrated later.

```text
              Multiplayer Core
                     │
                     ▼
             IEmulatorAdapter
                /          \
               /            \
      Genesis Adapter    Future Adapter
           │
           ▼
      Genesis Emulator
```

## 📡 Input Synchronization

A network message could conceptually contain:

```json
{
  "sessionId": "abc123",
  "playerId": 2,
  "frame": 10542,
  "buttons": ["RIGHT", "A"]
}
```

The actual protocol is not finalized yet.

Important design considerations include:

* Input delay
* Packet loss
* Out-of-order packets
* Frame synchronization
* Late inputs
* Reconnection
* Determinism validation
* Rollback/resimulation

## 🔄 Possible Synchronization Models

### Lockstep

Every emulator waits until the required inputs for a frame are available.

```text
Frame N
 ├── Player 1 input
 └── Player 2 input
        ↓
   Advance Frame
```

**Advantages**

* Simple conceptual model
* Highly deterministic
* Low bandwidth

**Disadvantages**

* Network latency can directly affect gameplay
* One delayed player can stall everyone

### Input Delay

Inputs are intentionally delayed by a small number of frames.

```text
Current Frame: 1000

Inputs received:
P1 → Frame 1005
P2 → Frame 1005

Both emulators execute frame 1005
```

This can make synchronization more predictable while hiding some network jitter.

### Rollback

Each client predicts inputs and later corrects the simulation when authoritative input arrives.

```text
Predict
   ↓
Simulate
   ↓
Remote input arrives
   ↓
Rollback
   ↓
Apply correct input
   ↓
Resimulate
```

Rollback may provide a better experience for latency-sensitive games, but it requires deeper emulator integration and reliable deterministic execution.

The project will initially favor **lockstep/input synchronization** before introducing rollback complexity.

## 🔐 ROM Ownership

This project is designed around a model where players provide and run their **own legally obtained ROMs**.

The multiplayer infrastructure should not require the server to distribute copyrighted ROM files.

The server should instead coordinate a session between clients that already have compatible game data locally.

## 🏗️ Project Structure

The project is expected to evolve toward something similar to:

```text
Emulator-Multiplayer/
│
├── src/
│   ├── Server/
│   │   ├── Session
│   │   ├── Networking
│   │   └── Synchronization
│   │
│   ├── Client/
│   │   ├── Networking
│   │   ├── Input
│   │   └── Session
│   │
│   ├── Emulator/
│   │   ├── Abstractions
│   │   └── Genesis
│   │
│   └── Protocol/
│       ├── Messages
│       └── Serialization
│
├── tests/
│
├── docs/
│
└── README.md
```

The exact structure may change as implementation progresses.

## 🚧 Current Status

**Early research / prototype phase**

Current focus:

* [x] Define the multiplayer concept
* [x] Identify input synchronization as the primary networking mechanism
* [x] Define local-emulator architecture
* [ ] Select an appropriate open-source emulator
* [ ] Build emulator adapter
* [ ] Create basic client/server connection
* [ ] Implement lobby/session system
* [ ] Implement controller input synchronization
* [ ] Implement frame synchronization
* [ ] Test deterministic execution
* [ ] Test with a real Genesis multiplayer game
* [ ] Handle latency and packet loss
* [ ] Investigate rollback synchronization

## 🧪 Prototype Goal

The first successful prototype should be extremely small:

```text
Player 1                         Player 2
   │                                │
   │ Local Emulator                 │ Local Emulator
   │ Local ROM                      │ Local ROM
   │                                │
   └──────────┐          ┌──────────┘
              ▼          ▼
             Multiplayer
                Server
                  │
                  ▼
          Synchronize Inputs
```

The first milestone is **not** a complete multiplayer platform.

It is simply:

> Run the same Genesis game on two computers and successfully synchronize both players' controller inputs so that both emulators remain synchronized.

Once this works reliably, additional features can be built on top of it.

## 🔮 Future Ideas

Potential future features include:

* Game/session browser
* Private rooms
* Matchmaking
* Player invitations
* NAT traversal
* Dedicated servers
* Spectator mode
* Replay recording
* Input recording
* Desync detection
* Automatic emulator configuration
* Multiple console/emulator adapters
* Rollback netcode
* Host migration
* Latency measurement
* Cross-platform clients

## ⚠️ Challenges

The biggest technical challenge is **determinism**.

Two emulator instances must produce equivalent results from the same initial state and input sequence.

Potential sources of desynchronization include:

* Different emulator versions
* Different emulator configurations
* Different ROM revisions
* Timing differences
* Random number generation
* CPU emulation differences
* Audio/video timing
* Uninitialized emulator state
* Incorrect input-frame alignment

Therefore, emulator compatibility and deterministic execution will be treated as first-class concerns.

## 📜 License

The project license will be defined once the initial architecture and dependencies are established.

Individual emulators and game ROMs may have their own licenses and legal requirements. This project does not provide copyrighted game ROMs.

---

## 🤝 Contributing

Contributions, experiments, emulator integrations, synchronization research, and testing are welcome.

The initial priority is establishing a **minimal deterministic multiplayer prototype** before expanding the system into a complete platform.

---

### Project Vision

**Run locally. Synchronize inputs. Play together.**

The long-term goal is to make online multiplayer possible for compatible retro games without requiring players to stream the entire game through a central server.
