# PROGRESS

## Original prompt (2026-07-01)

> I want to build a city skyline clone both in terms of behavior and graphics. […] grid-aligned roads for now are ok. 3d graphics yes. Learn from other repos' AGENTS.md and CLAUDE.md and form your own. Write down necessary design, specs, and roadmaps to docs then start working. /goal do not stop until you have a fully functioning game.

Decisions locked: grid-aligned roads, 3D (Three.js), sim on civ-engine (file:../civ-engine) in a Web Worker, conventions distilled from civ-engine/town/townscaper/civ-sim-web AGENTS docs.

## Status

- [x] Conventions: AGENTS.md + CLAUDE.md written.
- [x] Design docs: vision, game-design, architecture, roadmap written.
- [x] Design docs adversarially reviewed against civ-engine API (23 confirmed findings folded in).
- [x] Phase 0 — scaffold
- [x] Phase 1 — terrain + roads (browser-verified: road drag + bulldoze with exact refund)
- [~] Phase 2 — zoning + growth + demand + citizens (sim done + tested; renderer in progress)
- [~] Phase 3 — employment + traffic (sim done + tested incl. congestion scenario, save/load replay, topology remap; vehicle rendering pending)
- [ ] Phase 4 — fields + services
- [ ] Phase 5 — utilities + economy
- [ ] Phase 6 — game shell + polish
- [ ] Phase 7 — verification + hardening

## Log

### 2026-07-01 — Phases 0–1 done; Phase 2 sim done

Phase 0/1 committed and browser-verified (preview viewport gotcha: default preview window can be 1px wide — resize before pointer-based tests). Design review (41 agents) confirmed 23 findings; all folded into docs + implementation. Notable engine gotchas hit: `world.query()` returns a single-use Generator (`.length` is undefined → NaN); civ-engine index pulls `node:fs`/`node:path`/`node:crypto` into browser bundles (solved with vite alias shims in src/shims/). Phase 2 sim (zoning/growth/demand/citizens/bulldozeRect) implemented with zone-aware scoring and pluggable score inputs; 31 tests green including determinism and abandon/recover. Next: Phase 2 renderer (zone tint, instanced buildings, inspect panel), then Phase 3 traffic.

### 2026-07-01 — Phase 1 renderer (terrain, roads, tools, HUD)

Main-thread presentation for Phase 1: terrain mesh (one merged vertex-colored BufferGeometry from the `ready` TerrainPayload — land at y=0 with per-cell-hash lightness jitter, water recessed at y=-0.12, shore skirts at land/water and map edges), decorative trees (two InstancedMeshes, trunks+canopies, rebuilt per `roads` message so trees under roads hide/re-show), roads (merged flat quads at y=0.02, full rebuild per `roads` message — chunking deferred), ground-plane picking (mathematical y=0 plane → floored cell, null off-grid, clamped variant for drags), select/road/bulldoze tools with L-path drag ghost (InstancedMesh, capacity 256; red tint when road path crosses water or bulldoze path has no road; Escape/right-click cancels; MapControls left-pan disabled while a build tool is active), HUD treasury + tool buttons + rejection toasts, `render_game_to_text` extended with treasury/activeTool/roadCellCount/cameraTarget. Boundary kept: rendering/ has zero sim imports (scene now takes grid dims via constructor; grid helpers only used in app/). Browser verification pending (orchestrator).

### 2026-07-01 — Project inception

Assessed civ-engine fit via 6-reader doc sweep (findings in Claude memory + baked into architecture.md "civ-engine usage rules"). Key constraints honored in design: integer fixed grid, renderer-side interpolation, layers/occupancy/queues not world-serialized (mirror into world state + `rebuildDerived`), road-graph pathfinding with topology×congestion cache versioning, strict-mode determinism. civ-sim-web is NOT a civ-engine consumer (stale README) — used only for process precedent (engine-first phases, automation hooks). Next: adversarial design review, then scaffold.
