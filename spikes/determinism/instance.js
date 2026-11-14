// Pinned: both instances must run the exact same EmulatorJS + core build
const EJS_DATA = "https://cdn.emulatorjs.org/4.2.3/data/";
const PLAYERS = 2;

let cfg = null;
const stats = { iterations: 0, idleIterations: 0, multiStepIterations: 0, stalledIterations: 0, stateBytes: 0 };
// Both instances hold at their first frame until the parent releases them together
let released = false;
let remoteInput = () => {};

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

// Live host: local keyboard/gamepad input is not applied at once. It is tagged with a frame
// `delay` frames ahead, sent to the guest, and applied locally when that frame comes up.
function hostSource(gm, inject) {
    const pending = [];
    const scheduled = new Map();
    let lastFrame = -1;
    gm.functions.simulateInput = (player, button, value) => pending.push([player, button, value]);
    return (frame) => {
        // Loop iteration that did not advance the frame: this frame's inputs are already final
        if (frame === lastFrame) return;
        lastFrame = frame;
        const target = frame + cfg.delay;
        const events = pending.splice(0);
        if (events.length) scheduled.set(target, events);
        report("input", { frame: target, events });
        const due = scheduled.get(frame);
        if (!due) return;
        scheduled.delete(frame);
        for (const [player, button, value] of due) inject(player, button, value);
    };
}

// Live guest: lockstep. A frame only runs once the host has confirmed its inputs.
function guestSource(gm, inject) {
    const received = new Map();
    let confirmedThrough = -1;
    gm.functions.simulateInput = () => {};
    remoteInput = (frame, events) => {
        if (events.length) received.set(frame, events);
        if (frame > confirmedThrough) confirmedThrough = frame;
    };
    return (frame) => {
        if (frame > confirmedThrough) {
            stats.stalledIterations++;
            return false;
        }
        const due = received.get(frame);
        if (!due) return;
        received.delete(frame);
        for (const [player, button, value] of due) inject(player, button, value);
    };
}

function installFrameHooks(emu) {
    const gm = emu.gameManager;
    const inject = gm.functions.simulateInput;
    const applyInputs = cfg.mode === "script" ? scriptedSource(inject)
        : cfg.role === "host" ? hostSource(gm, inject) : guestSource(gm, inject);
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
});
parent.postMessage({ source: "instance", type: "ready" }, location.origin);
