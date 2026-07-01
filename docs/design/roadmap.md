# Roadmap

Each phase lands as one or more commits on `main` with all gates green (`test`, `typecheck`, `lint`, `build`), headless contract tests for its sim behavior, and — from phase 1 on — a browser screenshot verification. A phase is done when its acceptance criteria pass, docs are updated, and `PROGRESS.md` records the outcome.

## Phase 0 — Scaffold

Vite + TS strict + Three.js + civ-engine (`file:../civ-engine`) + Vitest + ESLint. Directory skeleton per architecture.md. Worker boots a trivial world; canvas renders a ground plane; `npm run dev/test/typecheck/lint/build` all work. Automation hooks registered (`render_game_to_text`, `advanceTime`).

Accept: empty scene at 60 fps, worker round-trip visible (tick counter in HUD), all gates green.

## Phase 1 — Terrain and roads

Seeded terrain (water/land/trees) sent once to renderer; road place/bulldoze commands with validators, cost, L-drag expansion; road graph derivation + topologyVersion; chunked road mesh; camera controls; ground picking with ghost preview; treasury debits.

Accept: draw/bulldoze road networks in browser; graph unit tests pass (corners, intersections, islands); terrain deterministic per seed.

## Phase 2 — Zoning, growth, demand

Zone paint/dezone commands; growth system with footprints on OccupancyGrid; demand model; building level/abandon state machine (power/water gates arrive in phase 5 — until then those inputs read as satisfied); instanced building rendering; zone tint overlay; inspect panel basics.

Accept: zoning near roads grows buildings over time per demand; scenario test: 200 zoned cells + positive demand → ≥ 30 buildings within N ticks; buildings render with level variation.

## Phase 3 — Citizens and traffic

Citizen move-in/out, employment matching; trip generation; road-graph pathfinding via queue+cache with topology/congestion versioning; vehicle motion with per-edge counts, congestion buckets and epoch; vehicle instancing with interpolation; traffic overlay; disconnectedTrips warning.

Accept: scenario tests — commuters flow between R and C/I clusters; blocking the only route cancels trips; a parallel road reduces max congestion bucket. Browser: visible smooth vehicles, congestion coloring.

## Phase 4 — Fields and services

Pollution/noise/landValue layers with cadences + world-state mirroring; service buildings (fire/police/clinic/school) with coverage layers; desirability wiring (land value + coverage now feed levels); field overlays via DataTexture; service placement UI.

Accept: scenario tests — industry raises pollution which drags neighboring land value down; a school enables level-3; overlays visibly match sim values in browser.

## Phase 5 — Utilities and economy

Power (plants/lines/flood-fill/brownout) and water (pumps/pipes) networks; powered/watered gating of growth/leveling/abandonment; budget interval (taxes by zone/level, upkeep), tax sliders, broke state blocking purchases; ⚡/💧 problem icons; power/water overlays.

Accept: scenario tests — unpowered city stalls and abandons, powering it recovers; brownout is deterministic; taxes at 20% suppress demand; budget can go negative and recover. Browser: place utilities, watch icons clear.

## Phase 6 — Game shell and polish

Full HUD polish, info panels, event toasts, overlays menu; save/load (localStorage + export/import) with `rebuildDerived`; speed controls incl. pause; day/night lighting; sound off by default (stretch); title-free instant-play boot; `render_game_to_text` completeness.

Accept: save → reload reproduces the city (hash of serialize output stable); all v1 tools usable end-to-end in browser.

## Phase 7 — Verification and hardening

Full-suite pass; determinism gate (synthetic playtest + SessionReplayer.selfCheck) in CI path; perf check at acceptance scale (≥1,000 population city; 20 TPS, ≥30 fps); adversarial review sweep over the whole codebase; fix findings; final automated playthrough (agent builds a city from scratch via browser) recorded in PROGRESS.md; README updated.

Accept: the game-design doc's "Definition of fully functioning" checklist passes end to end.

## Later (explicitly out of v1)

Freeform spline roads (design must stay compatible: graph + rasterization already abstract over cell geometry), public transport, districts/policies, fires/crime/health incidents, high density, freight chains, terrain height, milestones/unlock progression, ambient audio.
