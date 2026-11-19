# Wire protocol — WebSocket relay MVP (#8)

What the code sends today. JSON text frames, one message per frame. The compact bitmask input format planned in #7 is not implemented yet; when it lands it replaces `input` below.

Code: server `src/Server/Server/Relay/`, client `src/Server/Server/wwwroot/netplay.js`.

## Connection

```
ws://<host>:5279/ws?room=<CODE>
```

- Room code: 1-32 chars of `A-Z 0-9 - _`, case-insensitive (server upper-cases it).
- A room holds two peers. First to join is player 1, second is player 2. A freed seat is given to the next joiner.
- The server keeps rooms in memory only. It never parses, stores or simulates anything a peer sends, and never sees the ROM.
- Max message size 16 KB; text frames only. Bigger or binary closes the socket.
- Server pings every 5 s and drops a peer that does not answer within 15 s.

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
| `{"type":"hello","rom":"c10055e32888ab8b","size":131072,"core":"segaMD","ejs":"4.2.3","delay":3}` | Sent by both once both are in the room. `rom` = 64-bit non-cryptographic hash of the ROM bytes (`hashBytes`, works without a secure context). If `rom`, `size`, `core` or `ejs` differ, both sides refuse to start. `delay` = requested input delay in frames; **player 1's value is used by both** |
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
|   (both: compare ROM hash, load emulator, hold at first frame)
|-- ready -------------->|-- ready ---------------->|
|<------------- ready ---|<----------------- ready -|
|   (both: release)
|-- input f+delay ------>|------------------------->|   every frame, both directions
|-- hash --------------->|------------------------->|   every 60 frames, both directions
```

## Size

An idle `input` is about 42 bytes, sent 60 times a second per player; `hash` about 55 bytes once a second.
