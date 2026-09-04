# research/

Reference clones for the Phase 0 technical audit (see issue #1). Clone contents are git-ignored; audit findings go in `docs/PHASE0.md`.

| Folder | Repo | Notes |
|--------|------|-------|
| `EmulatorJS/` | [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | Web frontend for RetroArch — ROM loading, cores, input, in-repo netplay client |
| `EmulatorJS-netplay-server-v2/` | [ethanaobrien/EmulatorJS-netplay-server-v2](https://github.com/ethanaobrien/EmulatorJS-netplay-server-v2) | Official EmulatorJS netplay server (C#/.NET) + `netplay.js` client |
| `playtime/` | [n-at/playtime](https://github.com/n-at/playtime) | Retro games library, EmulatorJS + netplay integration (Go) |

Re-clone:

```
cd research
git clone --depth 1 https://github.com/EmulatorJS/EmulatorJS.git
git clone --depth 1 https://github.com/ethanaobrien/EmulatorJS-netplay-server-v2.git
git clone --depth 1 https://github.com/n-at/playtime.git
```
