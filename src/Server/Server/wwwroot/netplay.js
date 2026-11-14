// Pinned: both peers must run the exact same EmulatorJS + core build
const EJS_VERSION = "4.2.3";
const EJS_DATA = `https://cdn.emulatorjs.org/${EJS_VERSION}/data/`;
// Highest digital RetroPad button id; above it are analog axes and EmulatorJS hotkeys
const MAX_BUTTON = 15;
const HASH_EVERY = 60;
const STALL_NOTICE_MS = 1000;

const $ = (id) => document.getElementById(id);

// Exposed for automated runs
const net = window.__netplay = {
    state: "idle", player: 0, delay: 0, frame: 0, startFrame: null, compared: 0, mismatches: 0,
    firstMismatch: null, lastCheckpoint: 0, stalledIterations: 0, peerHidden: false, error: null
};

let socket = null;
let local = null;
let booted = false;
let localReady = null;
let peerReady = null;
// Both peers hold at their first frame until both have loaded
let released = false;
let stallSince = 0;
let onRemoteInput = () => {};
const localHashes = new Map();
const remoteHashes = new Map();

// Not crypto.subtle: on a LAN the page is plain http, which is not a secure context
function hashBytes(bytes) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        h1 = Math.imul(h1 ^ b, 2654435761);
        h2 = Math.imul(h2 ^ b, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

// Emscripten reads preMainLoop/postMainLoop only when the module is created, so they have to be
// in the config EmulatorJS hands to the core factory; setting them on Module later does nothing.
const loopHooks = { pre: null, post: null };
let coreFactory;
Object.defineProperty(window, "EJS_Runtime", {
    configurable: true,
    get: () => coreFactory,
    set: (factory) => {
        coreFactory = (config) => factory(Object.assign(config, {
            preMainLoop: () => (loopHooks.pre ? loopHooks.pre() : undefined),
            postMainLoop: () => { if (loopHooks.post) loopHooks.post(); }
        }));
    }
});

function setStatus(text, cls) {
    $("status").textContent = text;
    $("status").className = cls || "";
}

function send(message) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

// Terminal: the game cannot continue on this page
function fail(text) {
    if (net.state === "error") return;
    net.state = "error";
    net.error = text;
    setStatus(text, "fail");
    if (socket) socket.close();
}

function sendHello() {
    net.state = "verifying";
    setStatus(`Player ${net.player} — peer connected, comparing ROMs…`);
    send({ type: "hello", rom: local.rom, size: local.size, core: local.core, ejs: EJS_VERSION, delay: local.delay });
}

function onHello(m) {
    if (booted) return;
    if (m.ejs !== EJS_VERSION) return fail(`Emulator version mismatch: you ${EJS_VERSION}, peer ${m.ejs}. Reload both pages.`);
    if (m.core !== local.core) return fail(`Core mismatch: you picked ${local.core}, peer picked ${m.core}. Reload and pick the same core.`);
    if (m.rom !== local.rom || m.size !== local.size) {
        return fail(`ROM mismatch — not starting. Yours: ${local.rom} (${local.size} bytes), peer's: ${m.rom} (${m.size} bytes). `
            + "Both players need the exact same ROM file (same region and revision). Reload and try again.");
    }
    net.delay = net.player === 1 ? local.delay : m.delay;
    boot();
}

function tryStart() {
    if (!localReady || !peerReady || released) return;
    if (localReady.frame === peerReady.frame && localReady.hash !== peerReady.hash) {
        return fail(`Start states differ (yours ${localReady.hash}, peer's ${peerReady.hash}) — not starting. `
            + "Same ROM but different saved game data or emulator settings on the two machines.");
    }
    released = true;
    net.state = "running";
    const parent = window.EJS_emulator.elements && window.EJS_emulator.elements.parent;
    if (parent && parent.focus) parent.focus();
}

function compareHashes(frame) {
    if (!localHashes.has(frame) || !remoteHashes.has(frame)) return;
    const same = localHashes.get(frame) === remoteHashes.get(frame);
    localHashes.delete(frame);
    remoteHashes.delete(frame);
    net.compared++;
    net.lastCheckpoint = Math.max(net.lastCheckpoint, frame);
    if (!same) {
        net.mismatches++;
        if (net.firstMismatch === null || frame < net.firstMismatch) net.firstMismatch = frame;
    }
}

// Local input is not applied at once: it is tagged with a frame `delay` frames ahead, sent to the
// peer, and applied by both sides on that frame. A frame only runs once the peer has confirmed
// its inputs for it (lockstep).
function installFrameHooks(emu) {
    const gm = emu.gameManager;
    const inject = gm.functions.simulateInput;
    const localPort = net.player - 1;
    const remotePort = 1 - localPort;
    const pending = [];
    const scheduled = new Map();
    const received = new Map();
    let confirmedThrough = -1;
    let lastSent = -1;
    let lastHashed = -1;

    // EmulatorJS keyboard/gamepad handlers end up here. Ids above MAX_BUTTON are dropped:
    // save/load-state and fast-forward hotkeys would change this side only.
    gm.simulateInput = (player, button, value) => {
        if (player === 0 && button <= MAX_BUTTON) pending.push([button, value]);
    };
    onRemoteInput = (frame, events) => {
        if (events.length) received.set(frame, events);
        if (frame > confirmedThrough) confirmedThrough = frame;
    };
    const apply = (map, frame, port) => {
        const events = map.get(frame);
        if (!events) return;
        map.delete(frame);
        for (const [button, value] of events) inject(port, button, value);
    };

    // Runs before the core emulates a frame: inputs set here are the inputs of that frame.
    // Returning false skips the iteration, so no frame is emulated.
    loopHooks.pre = () => {
        if (!released || net.state !== "running") return false;
        const frame = gm.getFrameNum();
        // Sent once per frame, before any stall, so two waiting peers cannot deadlock
        if (frame !== lastSent) {
            lastSent = frame;
            const target = frame + net.delay;
            const events = pending.splice(0);
            if (events.length) scheduled.set(target, events);
            send({ type: "input", frame: target, events });
        }
        if (frame > confirmedThrough) {
            net.stalledIterations++;
            if (!stallSince) stallSince = performance.now();
            return false;
        }
        stallSince = 0;
        // Same apply order on both sides
        apply(localPort === 0 ? scheduled : received, frame, 0);
        apply(localPort === 0 ? received : scheduled, frame, 1);
    };

    loopHooks.post = () => {
        const frame = gm.getFrameNum();
        net.frame = frame;
        if (frame !== lastHashed && frame > 0 && frame % HASH_EVERY === 0) {
            lastHashed = frame;
            const hash = hashBytes(gm.getState());
            localHashes.set(frame, hash);
            send({ type: "hash", frame, hash });
            compareHashes(frame);
        }
    };

    const frame = gm.getFrameNum();
    net.startFrame = frame;
    localReady = { frame, hash: hashBytes(gm.getState()) };
    net.state = "ready";
    send({ type: "ready", frame: localReady.frame, hash: localReady.hash });
    tryStart();
}

function boot() {
    booted = true;
    net.state = "loading";
    setStatus(`Player ${net.player} — ROMs match, loading emulator…`);
    window.EJS_player = "#game";
    window.EJS_core = local.core;
    window.EJS_gameUrl = local.file;
    window.EJS_gameName = "netplay";
    window.EJS_pathtodata = EJS_DATA;
    window.EJS_startOnLoaded = true;
    window.EJS_volume = 0.5;
    window.EJS_askBeforeExit = false;
    // Anything that changes one side only would desync
    window.EJS_Buttons = {
        restart: false, saveState: false, loadState: false, quickSave: false, quickLoad: false,
        cheat: false, loadSavFiles: false, netplay: false, cacheManager: false, exitEmulation: false
    };
    window.EJS_onGameStart = () => {
        try {
            installFrameHooks(window.EJS_emulator);
        } catch (e) {
            fail("Emulator error: " + String(e && e.stack || e));
        }
    };
    const loader = document.createElement("script");
    loader.src = EJS_DATA + "loader.js";
    loader.onerror = () => fail("Failed to load EmulatorJS from cdn.emulatorjs.org (internet needed).");
    document.body.appendChild(loader);
}

function onPeerLeft() {
    if (booted) return fail(`Peer disconnected at frame ${net.frame}. Reload the page to start a new game.`);
    net.state = "waiting";
    setStatus(`Player ${net.player} — peer left, waiting for a player to join room ${local.room}…`);
}

function onMessage(m) {
    switch (m.type) {
        case "joined":
            net.player = m.player;
            if (m.peer) return sendHello();
            net.state = "waiting";
            return setStatus(`Player ${net.player} — waiting for the other player to join room ${local.room}…`);
        case "peer-joined": return sendHello();
        case "peer-left": return onPeerLeft();
        case "rejected": return fail(m.message);
        case "hello": return onHello(m);
        case "ready":
            peerReady = { frame: m.frame, hash: m.hash };
            return tryStart();
        case "input": return onRemoteInput(m.frame, m.events);
        case "hash":
            remoteHashes.set(m.frame, m.hash);
            return compareHashes(m.frame);
        case "hidden":
            net.peerHidden = m.hidden;
            return;
    }
}

function connect() {
    net.state = "connecting";
    setStatus("Connecting…");
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${scheme}//${location.host}/ws?room=${encodeURIComponent(local.room)}`);
    socket.onmessage = (e) => {
        try {
            onMessage(JSON.parse(e.data));
        } catch (err) {
            fail("Bad message: " + String(err && err.stack || err));
        }
    };
    socket.onclose = () => fail(booted
        ? `Connection to the server lost at frame ${net.frame}. Reload the page to start a new game.`
        : "Could not connect to the server, or the connection was lost. Reload and try again.");
}

function render() {
    if (net.state === "ready") {
        setStatus(`Player ${net.player} — emulator loaded, waiting for the peer's emulator…`);
    }
    if (net.state !== "running") return;
    const role = `Player ${net.player} (pad ${net.player})`;
    const summary = `${net.compared} checkpoints compared, through frame ${net.lastCheckpoint}`;
    const waited = stallSince ? performance.now() - stallSince : 0;
    if (net.mismatches) {
        setStatus(`DESYNC — first differing checkpoint at frame ${net.firstMismatch} (${summary})`, "fail");
    } else if (net.peerHidden) {
        setStatus(`${role} — paused: the peer's tab is hidden or minimised`, "warn");
    } else if (waited > STALL_NOTICE_MS) {
        setStatus(`${role} — waiting for the peer's input for ${(waited / 1000).toFixed(1)} s (slow connection, or their tab is hidden)`, "warn");
    } else {
        setStatus(`IN SYNC — ${role}, ${summary}`, "pass");
    }
    $("detail").textContent = `room ${local.room} · frame ${net.frame} · input delay ${net.delay} · waited ${net.stalledIterations} iterations`;
}

window.addEventListener("error", (e) => { if (booted) fail("Error: " + e.message); });
document.addEventListener("visibilitychange", () => send({ type: "hidden", hidden: document.hidden }));
setInterval(render, 250);

$("room").value = new URLSearchParams(location.search).get("room") || "";
$("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (local) return;
    const file = $("rom").files[0];
    local = {
        room: $("room").value.trim().toUpperCase(),
        core: $("core").value,
        delay: parseInt($("delay").value, 10),
        file,
        size: file.size,
        rom: null
    };
    for (const el of $("form").elements) el.disabled = true;
    setStatus("Hashing ROM…");
    local.rom = hashBytes(new Uint8Array(await file.arrayBuffer()));
    connect();
});
