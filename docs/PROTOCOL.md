# Wire protocol — WebSocket relay MVP (#8)

What the code sends today. JSON text frames, one message per frame. The compact bitmask input format planned in #7 is not implemented yet; when it lands it replaces `input` below.

Code: Cloudflare relay `src/Server/Worker/`, ASP.NET Core relay `src/Server/Server/Relay/`, client `src/Server/Server/wwwroot/netplay.js`.

## Transports

The page offers four options in `transport.js`. They use the same gameplay messages.

- **Cloudflare Worker relay (default).** A secure WebSocket carries gameplay messages through the Worker. Each normalized room code maps to one Durable Object, which tracks the seats using WebSocket attachments.
- **Direct (WebRTC, #12).** Pairing through the free PeerJS cloud server (`0.peerjs.com`). First to open room `X` registers PeerJS id `emu-online-mp-X-1` and becomes player 1; the second finds the id taken and dials it. Then one reliable, ordered data channel carries JSON objects straight between the browsers. ICE: Google + Cloudflare STUN, PeerJS's free TURN (UDP + TCP) as fallback. The host answers the connection with `{"type":"welcome"}` (or `rejected`/`room-full` for a third player) and synthesises the `joined` / `peer-joined` / `peer-left` messages the relay would send. The status line shows `direct udp` or `relayed via TURN`.
- **Direct, paired by the relay (WebRTC, #34).** Both players connect to a compatible WebSocket relay for the handshake. Player 1 sends `{"type":"rtc-offer","sdp"}` when a peer is present (`peer-joined`, or `joined` with `peer: true`). Player 2 replies with `{"type":"rtc-answer","sdp"}`. Both send `{"type":"rtc-ice","candidate"}` as candidates are found. A reliable, ordered data channel `game` then carries gameplay, with the same `welcome` handshake as PeerJS mode.
- **Server relay (WebSocket).** The ASP.NET Core server below.

All: a side that hears nothing for 15 s while playing stops the game (live pings keep messages flowing even while the peer's tab is hidden).

## Connection (WebSocket relays)

```
ws://<host>:5279/ws?room=<CODE>
wss://<worker-host>/ws?room=<CODE>
```

- Room code: 1-32 chars of `A-Z 0-9 - _`, case-insensitive (server upper-cases it).
- A room holds two peers. First to join is player 1, second is player 2. A freed seat is given to the next joiner.
- The relays keep room membership for the life of the sockets and forward peer messages as text. Each browser loads its own ROM.
- Max message size 16 KB; text frames only. Bigger or binary closes the socket.
- The ASP.NET Core server also pings every 5 s and drops a peer that does not answer within 15 s.

## Server → client

| Message | When |
|---|---|
| `{"type":"joined","player":1,"peer":false}` | First message after connecting. `player` is 1 or 2, `peer` says whether the other player is already in the room |
| `{"type":"peer-joined"}` | The other player entered the room |
| `{"type":"peer-left"}` | The other player's socket closed or timed out |
| `{"type":"rejected","reason":"room-full","message":"…"}` | Room already has two players, or `reason` = `bad-room` for an invalid code. The socket is closed right after (close code 1008) |

## Client ↔ client (relayed unchanged to the other peer only)

Anything a client sends is forwarded as-is to the other peer in the room, and dropped when there is none. Clients must not send the four server types above.

| Message | Meaning |
|---|---|
| `{"type":"hello","rom":"c10055e32888ab8b","size":131072,"core":"segaMD","ejs":"4.2.3"}` | Sent by both once both are in the room. `rom` = 64-bit non-cryptographic hash of the ROM bytes (`hashBytes`, works without a secure context). If `rom`, `size`, `core` or `ejs` differ, both sides refuse to start |
| `{"type":"ping","id":7}` | Round-trip probe. The receiver answers `{"type":"pong","id":7}` at once. Player 1 sends 8 in a row after the hellos match; both send one every 2 s while playing (shown as live ping) |
| `{"type":"start","delay":4,"auto":true,"rtt":96}` | Player 1 → player 2 after measuring: input delay in frames for both sides, whether it was auto-picked, and the measured round trip (upper quartile of the 8 samples, ms). Both load the emulator after this. Auto delay = `ceil(rtt / 2 / 16.7) + 1`, clamped 1-30: an input sent at frame f must reach the peer before its frame f + delay, i.e. delay must cover the one-way trip. A number typed into player 1's delay field overrides it |
| `{"type":"ready","frame":0,"hash":"…"}` | Emulator loaded and held at its first frame. `hash` = hash of the savestate at that frame. When both are ready and the hashes match, both release. Different hashes on the same frame = refuse to start |
| `{"type":"input","frame":1234,"events":[[8,1],[4,0]]}` | Sent once per emulated frame. `events` = the sender's pad changes `[button, value]` to apply on `frame` (= sender's current frame + delay); usually `[]`. Also means "my inputs through `frame` are final": a peer only runs frame N after receiving an `input` with `frame` ≥ N. Buttons are RetroPad ids 0-15, value 1 = pressed, 0 = released. The pad is implied by the sender: player 1 → port 0, player 2 → port 1 |
| `{"type":"hash","frame":1260,"hash":"…"}` | Every 60 frames: hash of the full savestate after `frame`. Each side compares with its own hash for that frame and shows IN SYNC / DESYNC |
| `{"type":"hidden","hidden":true}` | Sender's tab became hidden / visible again. A hidden tab renders no frames, so the peer shows why it is paused |

## Sequence

```
A                      server                      B
|-- connect ?room=X ---->|                          |
|<-- joined p1 ----------|                          |
|                        |<----- connect ?room=X ---|
|                        |------ joined p2, peer -->|
|<-- peer-joined --------|                          |
|-- hello -------------->|-- hello ---------------->|
|<------------- hello ---|<----------------- hello -|
|   (both: compare ROM hash)
|-- ping x8 ------------>|------------------------->|
|<-------------------------------------- pong x8 ---|
|-- start delay -------->|------------------------->|
|   (both: load emulator, hold at first frame)
|-- ready -------------->|-- ready ---------------->|
|<------------- ready ---|<----------------- ready -|
|   (both: release)
|-- input f+delay ------>|------------------------->|   every frame, both directions
|-- hash --------------->|------------------------->|   every 60 frames, both directions
```

## Size

An idle `input` is about 42 bytes, sent 60 times a second per player; `hash` about 55 bytes once a second, `ping`/`pong` about 25 bytes every 2 s.
