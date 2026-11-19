// Scripted inputs are a pure function of (seed, frame, player): no state to drift between instances.

// RetroPad button ids used by simulate_input
const PAD = { B: 0, Y: 1, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8 };
const PAD_IDS = Object.values(PAD);
// Highest digital RetroPad button id; above it are analog axes and EmulatorJS hotkeys
const MAX_BUTTON = 15;
// One keyboard, two players: player 2 gets its own keys, picked up whichever screen has focus
const P2_KEYS = {
    KeyI: PAD.UP, KeyK: PAD.DOWN, KeyJ: PAD.LEFT, KeyL: PAD.RIGHT,
    KeyU: PAD.Y, KeyO: PAD.B, KeyP: PAD.A, KeyM: PAD.START
};
const DIRECTIONS = [-1, PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT];
const HOLD_FRAMES = 8;
const START_PERIOD = 90;
const START_HOLD = 4;

function mix32(a) {
    a |= 0;
    a = Math.imul(a ^ (a >>> 16), 0x85ebca6b);
    a = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
    return (a ^ (a >>> 16)) >>> 0;
}

function scriptedMask(cfg, frame, player) {
    const h = mix32(cfg.seed ^ mix32(Math.floor(frame / HOLD_FRAMES) * 4 + player + 1));
    let mask = 0;
    const dir = DIRECTIONS[h % DIRECTIONS.length];
    if (dir >= 0) mask |= 1 << dir;
    if ((h >>> 8) % 3 === 0) mask |= 1 << PAD.B;
    if ((h >>> 12) % 3 === 0) mask |= 1 << PAD.Y;
    if ((h >>> 16) % 3 === 0) mask |= 1 << PAD.A;
    // Start only early on: gets past title/menus, then stops so it does not keep pausing the game
    if (frame < cfg.startUntil && frame % START_PERIOD < START_HOLD) mask |= 1 << PAD.START;
    if (cfg.perturbFrame === frame && player === 0) mask ^= 1 << PAD.A;
    return mask;
}

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
