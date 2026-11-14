// Pinned: both instances must run the exact same EmulatorJS + core build
const EJS_DATA = "https://cdn.emulatorjs.org/4.2.3/data/";
const PLAYERS = 2;

let cfg = null;
const stats = { iterations: 0, idleIterations: 0, multiStepIterations: 0, stateBytes: 0 };

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

function installFrameHooks(emu) {
    const gm = emu.gameManager;
    const inject = gm.functions.simulateInput;
    const prevMask = new Array(PLAYERS).fill(0);
    let frameBefore = 0;
    let lastHashed = -1;
    let done = false;

    const applyInputs = (frame) => {
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

    // Runs before the core emulates a frame: inputs set here are the inputs of frame `frameBefore`
    loopHooks.pre = () => {
        if (done) return false;
        frameBefore = gm.getFrameNum();
        applyInputs(frameBefore);
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
            report("hash", { frame, hash: hashBytes(state) });
        }
        if (frame >= cfg.frames) {
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
    if (e.origin !== location.origin || !e.data || e.data.type !== "boot" || cfg) return;
    boot(e.data);
});
parent.postMessage({ source: "instance", type: "ready" }, location.origin);
