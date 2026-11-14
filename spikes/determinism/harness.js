const IDS = ["A", "B"];
const $ = (id) => document.getElementById(id);

// Exposed for automated runs
const result = window.__result = {
    state: "idle", compared: 0, mismatches: 0, firstMismatch: null, lastFrame: 0, stats: {}, errors: []
};

let hashes = {};
let finished = {};

function setStatus(text, cls) {
    $("status").textContent = text;
    $("status").className = cls || "";
}

function addRow(frame, a, b) {
    const same = a === b;
    const tr = document.createElement("tr");
    if (!same) tr.className = "diff";
    for (const text of [frame, a, b, same ? "=" : "DESYNC"]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
    }
    $("rows").prepend(tr);
}

function onHash(id, frame, hash) {
    hashes[id].set(frame, hash);
    const other = hashes[id === "A" ? "B" : "A"].get(frame);
    if (other === undefined) return;
    const a = hashes.A.get(frame), b = hashes.B.get(frame);
    result.compared++;
    result.lastFrame = Math.max(result.lastFrame, frame);
    if (a !== b) {
        result.mismatches++;
        if (result.firstMismatch === null || frame < result.firstMismatch) result.firstMismatch = frame;
    }
    addRow(frame, a, b);
    updateStatus();
}

function updateStatus() {
    const ended = finished.A && finished.B;
    if (result.errors.length) {
        result.state = "error";
        return setStatus("ERROR: " + result.errors[0], "fail");
    }
    const summary = `${result.compared} checkpoints compared, through frame ${result.lastFrame}`;
    if (result.mismatches) {
        result.state = ended ? "fail" : "running";
        return setStatus(`DESYNC — first differing checkpoint at frame ${result.firstMismatch} (${summary})`, "fail");
    }
    result.state = ended ? "pass" : "running";
    setStatus(ended ? `IN SYNC — ${summary}` : `Running… ${summary}, all equal`, ended ? "pass" : "");
}

window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.origin !== location.origin || !m || m.source !== "instance" || !m.id) return;
    if (m.type === "hash") onHash(m.id, m.frame, m.hash);
    if (m.type === "started") $("cap" + m.id).textContent = `${m.id} — started at frame ${m.frame}`;
    if (m.type === "error") { result.errors.push(`${m.id}: ${m.message}`); updateStatus(); }
    if (m.type === "done") {
        finished[m.id] = true;
        result.stats[m.id] = m.stats;
        $("cap" + m.id).textContent = `${m.id} — done at frame ${m.frame}, state ${m.stats.stateBytes} bytes, `
            + `${m.stats.idleIterations} idle / ${m.stats.multiStepIterations} multi-step iterations`;
        updateStatus();
    }
});

function bootInstance(id, rom, cfg) {
    const frame = $("frame" + id);
    const onReady = (e) => {
        if (e.source !== frame.contentWindow || !e.data || e.data.type !== "ready") return;
        window.removeEventListener("message", onReady);
        frame.contentWindow.postMessage({ type: "boot", rom, cfg: { ...cfg, id } }, location.origin);
    };
    window.addEventListener("message", onReady);
    frame.src = "instance.html?" + id + "=" + Date.now();
}

$("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const rom = $("rom").files[0];
    const num = (id) => parseInt($(id).value, 10);
    const cfg = {
        core: $("core").value,
        seed: num("seed") | 0,
        frames: num("frames"),
        hashEvery: num("hashEvery"),
        startUntil: num("startUntil"),
        perturbFrame: -1,
        muted: false
    };
    const perturb = $("perturbFrame").value === "" ? -1 : num("perturbFrame");

    hashes = { A: new Map(), B: new Map() };
    finished = {};
    Object.assign(result, { state: "running", compared: 0, mismatches: 0, firstMismatch: null, lastFrame: 0, stats: {}, errors: [] });
    $("rows").textContent = "";
    setStatus("Booting two instances…");

    bootInstance("A", rom, cfg);
    bootInstance("B", rom, { ...cfg, perturbFrame: perturb, muted: true });
});
