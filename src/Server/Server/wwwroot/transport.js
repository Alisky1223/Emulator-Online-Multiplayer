// Both transports hand netplay.js the same messages the WebSocket relay sends (joined, peer-joined,
// peer-left, rejected) plus everything the peer sends, so the game code does not care which one runs.

// Namespaces our room codes on the shared public PeerJS server
const PEER_PREFIX = "emu-online-mp-";
const PEER_JOIN_TIMEOUT_MS = 30000;
// Gives the "room full" notice time to arrive before the connection closes
const PEER_FULL_CLOSE_MS = 1000;
const PEER_RECONNECT_MS = 3000;
// Few servers on purpose: every extra one slows candidate gathering
const ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
    // PeerJS's free relay, used only when no direct path exists. TCP variants get through networks that block UDP
    {
        urls: [
            "turn:eu-0.turn.peerjs.com:3478?transport=udp",
            "turn:eu-0.turn.peerjs.com:3478?transport=tcp",
            "turn:us-0.turn.peerjs.com:3478?transport=udp",
            "turn:us-0.turn.peerjs.com:3478?transport=tcp"
        ],
        username: "peerjs",
        credential: "peerjsp"
    }
];

function openWebSocketTransport(room, { onMessage, onClosed }) {
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${location.host}/ws?room=${encodeURIComponent(room)}`);
    socket.onmessage = (e) => onMessage(JSON.parse(e.data));
    socket.onclose = () => onClosed(null);
    return {
        send(m) { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); },
        close() { socket.onclose = null; socket.close(); },
        route: async () => "server relay"
    };
}

// First to open the room registers it on the PeerJS server as host (player 1); the second finds the
// id taken and dials the host instead. After that the two browsers talk directly over a data channel.
function openWebRtcTransport(room, { onMessage, onClosed }) {
    let peer = null;
    let conn = null;
    let closed = false;
    // PeerJS ids must end in a letter or digit; room codes may end in - or _
    const hostId = `${PEER_PREFIX}${room}-1`;
    const options = { debug: 0, config: { iceServers: ICE_SERVERS } };

    const deliver = (m) => { if (!closed) onMessage(m); };
    const end = (reason) => {
        if (closed) return;
        closed = true;
        if (peer) peer.destroy();
        onClosed(reason);
    };
    const transport = {
        send(m) { if (conn && conn.open) conn.send(m); },
        close() { closed = true; if (peer) peer.destroy(); },
        route: () => describeRoute(conn)
    };

    const Peer = window.peerjs && window.peerjs.Peer;
    if (!Peer) {
        setTimeout(() => end("PeerJS did not load from cdn.jsdelivr.net (internet needed)."), 0);
        return transport;
    }

    const newPeer = (id) => {
        const p = id ? new Peer(id, options) : new Peer(options);
        peer = p;
        // Losing the PeerJS server keeps an open data connection; reconnecting lets the host take a new guest
        p.on("disconnected", () => setTimeout(() => {
            if (peer === p && !p.destroyed && p.disconnected) p.reconnect();
        }, PEER_RECONNECT_MS));
        return p;
    };
    // Once the two browsers are connected, PeerJS server trouble does not matter
    const connected = () => Boolean(conn && conn.open);

    function host() {
        const p = newPeer(hostId);
        p.on("open", () => { if (!connected()) deliver({ type: "joined", player: 1, peer: false }); });
        p.on("connection", (c) => {
            if (conn) {
                c.on("open", () => {
                    c.send({ type: "rejected", reason: "room-full", message: `Room ${room} already has two players.` });
                    setTimeout(() => c.close(), PEER_FULL_CLOSE_MS);
                });
                return;
            }
            conn = c;
            const timer = setTimeout(() => {
                if (conn !== c || c.open) return;
                conn = null;
                c.close();
            }, PEER_JOIN_TIMEOUT_MS);
            c.on("open", () => {
                clearTimeout(timer);
                if (conn !== c) return;
                // Goes out before the hello that peer-joined triggers
                c.send({ type: "welcome" });
                deliver({ type: "peer-joined" });
            });
            c.on("data", (m) => { if (conn === c) deliver(m); });
            c.on("close", () => {
                if (conn !== c) return;
                conn = null;
                deliver({ type: "peer-left" });
            });
        });
        p.on("error", (err) => {
            if (peer !== p) return;
            if (err.type === "unavailable-id") {
                p.destroy();
                return guest();
            }
            if (!connected()) end(describeError(err));
        });
    }

    function guest() {
        const p = newPeer(null);
        let timer = 0;
        p.on("open", () => {
            if (conn) return;
            const c = conn = p.connect(hostId, { reliable: true, serialization: "json" });
            timer = setTimeout(() => end("Could not connect to the other player directly. One of the networks may block it; "
                + "try the \"Server relay\" connection instead."), PEER_JOIN_TIMEOUT_MS);
            c.on("data", (m) => {
                if (conn !== c) return;
                if (m.type === "welcome" || m.type === "rejected") clearTimeout(timer);
                deliver(m.type === "welcome" ? { type: "joined", player: 2, peer: true } : m);
            });
            c.on("close", () => { if (conn === c) end("The other player left."); });
        });
        p.on("error", (err) => {
            if (peer !== p || connected()) return;
            end(err.type === "peer-unavailable"
                ? `Nobody is hosting room ${room} any more. Reload and try again.`
                : describeError(err));
        });
    }

    host();
    return transport;
}

function describeError(err) {
    switch (err && err.type) {
        case "network":
        case "socket-error":
        case "server-error":
            return "Cannot reach the PeerJS pairing server (0.peerjs.com). Check the internet connection, or try the \"Server relay\" connection.";
        case "browser-incompatible": return "This browser does not support WebRTC.";
        default: return `Connection error: ${(err && err.message) || err}`;
    }
}

async function describeRoute(conn) {
    const pc = conn && conn.peerConnection;
    if (!pc) return null;
    const stats = await pc.getStats();
    let pair = null;
    stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    // Firefox reports the pair but no transport entry
    if (!pair) stats.forEach((s) => { if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") pair = s; });
    if (!pair) return null;
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    const relayed = [local, remote].some((c) => c && c.candidateType === "relay");
    return `${relayed ? "relayed via TURN" : "direct"}${local && local.protocol ? " " + local.protocol : ""}`;
}
