// Pinned: both instances must run the exact same EmulatorJS + core build
const EJS_DATA = "https://cdn.emulatorjs.org/4.2.3/data/";
const PLAYERS = 2;

let cfg = null;
const stats = { iterations: 0, idleIterations: 0, multiStepIterations: 0, stalledIterations: 0, stateBytes: 0 };
// Both instances hold at their first frame until the parent releases them together
let released = false;
let remoteInput = () => {};
let localInput = () => {};

function report(type, data) {
    parent.postMessage({ source: "instance", id: cfg ? cfg.id : null, type, ...data }, location.origin);
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

// Scripted mode: both instances compute the same inputs from (seed, frame, player)
function scriptedSource(inject) {
    const prevMask = new Array(PLAYERS).fill(0);
    return (frame) => {
        for (let p = 0; p < PLAYERS; p++) {
            const mask = scriptedMask(cfg, frame, p);
            const changed = mask ^ prevMask[p];
            if (!changed) continue;
            for (const id of PAD_IDS) {
                if (changed & (1 << id)) inject(p, id, (mask >>> id) & 1);
            }
            prevMask[p] = mask;
        }
    };
}

// Peer modes. Local input is not applied at once: it is tagged with a frame `delay` frames ahead,
// sent to the peer, and applied by both sides on that frame. With `wait`, a frame only runs once
// the peer has confirmed its inputs for it (lockstep).
function peerSource(gm, inject) {
    const pending = [];
    const scheduled = new Map();
    const received = new Map();
    let confirmedThrough = -1;
    let lastSent = -1;

    localInput = (button, value) => {
        if (cfg.capture) pending.push([cfg.port, button, value]);
    };
    // EmulatorJS keyboard/gamepad handlers end up here. Ids above MAX_BUTTON are dropped:
    // save/load-state and fast-forward hotkeys would change this side only.
    gm.simulateInput = (player, button, value) => {
        if (player === 0 && button <= MAX_BUTTON) localInput(button, value);
    };
    remoteInput = (frame, events) => {
        if (events.length) received.set(frame, events);
        if (frame > confirmedThrough) confirmedThrough = frame;
    };
    const take = (map, frame) => {
        const events = map.get(frame) || [];
        map.delete(frame);
        return events;
    };

    return (frame) => {
        // Sent once per frame, before any stall, so two waiting peers cannot deadlock
        if (cfg.capture && frame !== lastSent) {
            lastSent = frame;
            const target = frame + cfg.delay;
            const events = pending.splice(0);
            if (events.length) scheduled.set(target, events);
            report("input", { frame: target, events });
        }
        if (cfg.wait && frame > confirmedThrough) {
            stats.stalledIterations++;
            return false;
        }
        const mine = take(scheduled, frame);
        const theirs = take(received, frame);
        // Same apply order on both sides
        const ordered = cfg.id === "A" ? mine.concat(theirs) : theirs.concat(mine);
        for (const [player, button, value] of ordered) inject(player, button, value);
    };
}

function installFrameHooks(emu) {
    const gm = emu.gameManager;
    const inject = gm.functions.simulateInput;
    const applyInputs = cfg.mode === "script" ? scriptedSource(inject) : peerSource(gm, inject);
    let frameBefore = 0;
    let lastHashed = -1;
    let done = false;

    // Runs before the core emulates a frame: inputs set here are the inputs of frame `frameBefore`.
    // Returning false skips the iteration, so no frame is emulated.
    loopHooks.pre = () => {
        if (done || !released) return false;
        frameBefore = gm.getFrameNum();
        return applyInputs(frameBefore);
    };

    loopHooks.post = () => {
        if (done) return;
        const frame = gm.getFrameNum();
        const stepped = frame - frameBefore;
        stats.iterations++;
        if (stepped === 0) stats.idleIterations++;
        if (stepped > 1) stats.multiStepIterations++;

        if (frame !== lastHashed && frame > 0 && frame % cfg.hashEvery === 0) {
            lastHashed = frame;
            const state = gm.getState();
            stats.stateBytes = state.length;
            report("hash", { frame, hash: hashBytes(state), stalled: stats.stalledIterations });
        }
        if (cfg.frames > 0 && frame >= cfg.frames) {
            done = true;
            report("done", { frame, stats });
        }
    };
}

function boot(message) {
    cfg = message.cfg;
    window.EJS_player = "#game";
    window.EJS_core = cfg.core;
    window.EJS_gameUrl = message.rom;
    window.EJS_gameName = "determinism-spike";
    window.EJS_pathtodata = EJS_DATA;
    window.EJS_startOnLoaded = true;
    window.EJS_volume = cfg.muted ? 0 : 0.5;
    window.EJS_askBeforeExit = false;
    window.EJS_onGameStart = () => {
        try {
            installFrameHooks(window.EJS_emulator);
            report("started", { frame: window.EJS_emulator.gameManager.getFrameNum() });
        } catch (e) {
            report("error", { message: String(e && e.stack || e) });
        }
    };
    const loader = document.createElement("script");
    loader.src = EJS_DATA + "loader.js";
    loader.onerror = () => report("error", { message: "failed to load EmulatorJS loader" });
    document.body.appendChild(loader);
}

window.addEventListener("error", (e) => report("error", { message: e.message }));
window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === "boot" && !cfg) boot(e.data);
    if (e.data.type === "go") released = true;
    if (e.data.type === "input") remoteInput(e.data.frame, e.data.events);
    if (e.data.type === "localInput") localInput(e.data.button, e.data.value);
});

function onPlayer2Key(e) {
    const button = P2_KEYS[e.code];
    if (button === undefined || e.repeat || !cfg || cfg.mode !== "duo") return;
    const value = e.type === "keydown" ? 1 : 0;
    if (cfg.port === 1) localInput(button, value);
    else report("p2key", { button, value });
}
window.addEventListener("keydown", onPlayer2Key, true);
window.addEventListener("keyup", onPlayer2Key, true);
parent.postMessage({ source: "instance", type: "ready" }, location.origin);
