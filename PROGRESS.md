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
- [x] Phase 2 — zoning + growth + demand + citizens (browser-verified: 48 buildings, 96 population, demand bars, inspect panel)
- [x] Phase 3 — employment + traffic (browser-verified: vehicles commuting, 49 employed, disconnectedTrips 0)
- [x] Phase 4 — fields + services (browser-verified: pollution overlay hazes industry, fire+school placed)
- [x] Phase 5 — utilities + economy (browser-verified: coal+lines+pump+pipes power/water the town; 66 sim tests; fixes: power lines may cross roads, budget first fires at tick 1024, roadsChanged payload emptied for replay determinism — caught by the new SessionReplayer.selfCheck gate)
- [ ] Phase 4 — fields + services
- [ ] Phase 5 — utilities + economy
- [x] Phase 6 — save/load (browser-verified: exact restore incl. treasury float), Save/Load/New buttons, pause/4x verified, day/night cycle
- [x] Phase 7 — verification + hardening: final adversarial review (23 agents) found 1 critical (dead vehicle-remap path — road edits under live traffic could poison the world; fixed + regression test + browser-verified) + 1 major (line/road occupancy divergence across save/load; fixed) + doc drift (fixed); replay gate extended to the shipping config incl. utilities/services/taxes/bulldozeRect; 58 tests, all gates green, audits clean, pushed.

v1 COMPLETE. The game-design "Definition of fully functioning" checklist passes: build → zone → power/water → 100+ population with commuting traffic, congestion + relief verified headless, overlays match sim fields, budget breathes (broke badge + utility-only escape), save → reload reproduces exactly, determinism self-check green.

## Log

### 2026-07-01 — Phases 0–1 done; Phase 2 sim done

Phase 0/1 committed and browser-verified (preview viewport gotcha: default preview window can be 1px wide — resize before pointer-based tests). Design review (41 agents) confirmed 23 findings; all folded into docs + implementation. Notable engine gotchas hit: `world.query()` returns a single-use Generator (`.length` is undefined → NaN); civ-engine index pulls `node:fs`/`node:path`/`node:crypto` into browser bundles (solved with vite alias shims in src/shims/). Phase 2 sim (zoning/growth/demand/citizens/bulldozeRect) implemented with zone-aware scoring and pluggable score inputs; 31 tests green including determinism and abandon/recover. Next: Phase 2 renderer (zone tint, instanced buildings, inspect panel), then Phase 3 traffic.

### 2026-07-01 — Phase 1 renderer (terrain, roads, tools, HUD)

Main-thread presentation for Phase 1: terrain mesh (one merged vertex-colored BufferGeometry from the `ready` TerrainPayload — land at y=0 with per-cell-hash lightness jitter, water recessed at y=-0.12, shore skirts at land/water and map edges), decorative trees (two InstancedMeshes, trunks+canopies, rebuilt per `roads` message so trees under roads hide/re-show), roads (merged flat quads at y=0.02, full rebuild per `roads` message — chunking deferred), ground-plane picking (mathematical y=0 plane → floored cell, null off-grid, clamped variant for drags), select/road/bulldoze tools with L-path drag ghost (InstancedMesh, capacity 256; red tint when road path crosses water or bulldoze path has no road; Escape/right-click cancels; MapControls left-pan disabled while a build tool is active), HUD treasury + tool buttons + rejection toasts, `render_game_to_text` extended with treasury/activeTool/roadCellCount/cameraTarget. Boundary kept: rendering/ has zero sim imports (scene now takes grid dims via constructor; grid helpers only used in app/). Browser verification pending (orchestrator).

### 2026-07-01 — Project inception

Assessed civ-engine fit via 6-reader doc sweep (findings in Claude memory + baked into architecture.md "civ-engine usage rules"). Key constraints honored in design: integer fixed grid, renderer-side interpolation, layers/occupancy/queues not world-serialized (mirror into world state + `rebuildDerived`), road-graph pathfinding with topology×congestion cache versioning, strict-mode determinism. civ-sim-web is NOT a civ-engine consumer (stale README) — used only for process precedent (engine-first phases, automation hooks). Next: adversarial design review, then scaffold.

### 2026-07-01 — LLM playtest → find → improve loop (5 rounds)

Played five full onboarding-to-healthy-city sessions via the automation hooks, fixing between rounds. Round 1 (naive advisor-follower): mass abandonment during onboarding (utility grace too short), ghost-town death spiral (vacancy suppressed R demand below the move-in gate forever), and a hard bug — roads could not cross power lines (ghost claimed valid, sim rejected, districts unconnectable). Round 2: bulldoze-then-build race (growth every 4 ticks rebuilt cleared cells before the road landed). Round 3: green service ghosts silently rejected (missing road/water adjacency in client validity) with useless 'Validation failed' toasts. Harness: monolithic worker advance starved command processing (now batched, 100 ticks). Fixes: grace 30→75 evals, recovery 5→3, bridge radius 2→3, vacancy penalty capped at 16 + move-in trickle above r > -0.3, road/line crossing symmetry, rubble (200-tick regrowth block), honest footprint ghosts + reason toasts. Round 5 result: one deliberate build pass → 228 population, both services placed, 74 employed, 9 commuting vehicles, zero disconnected trips, zero abandonment, treasury rising across budget cycles, "city is healthy" advisory, exact save/load restore. 61 tests green.

Known follow-ups (acceptable for now): lake-heavy terrain limits big-city sprawl (bridges are the natural next feature); level-ups are slow to witness in short sessions (no "leveled up" moment); employment is distance-based so unreachable jobs surface only via the disconnected-trips advisory.
