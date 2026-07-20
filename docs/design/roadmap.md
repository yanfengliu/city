# Roadmap

Each phase lands as one or more commits on `main` with all gates green (`test`, `typecheck`, `lint`, `build`), headless contract tests for its sim behavior, and — from phase 1 on — a browser screenshot verification. A phase is done when its acceptance criteria pass, docs are updated, and `PROGRESS.md` records the outcome.

## Phase 0 — Scaffold

Vite + TS strict + Three.js + civ-engine (`file:../civ-engine`) + Vitest + ESLint. Directory skeleton per architecture.md. Worker boots a trivial world; canvas renders a ground plane; `npm run dev/test/typecheck/lint/build` all work. Automation hooks registered (`render_game_to_text`, `advanceTime`).

Accept: empty scene at 60 fps, worker round-trip visible (tick counter in HUD), all gates green.

## Phase 1 — Terrain and roads

Seeded terrain (normalized elevation/water/trees) sent once to renderer; renderer-only rolling relief shared by ground meshes and picking; road place/bulldoze commands with validators, cost, L-drag expansion; road graph derivation + topologyVersion; chunked road mesh; camera controls; terrain picking with ghost preview; treasury debits.

Accept: draw/bulldoze road networks in browser; graph unit tests pass (corners, intersections, islands); terrain deterministic per seed.

## Phase 2 — Zoning, growth, demand, citizens

Zone paint/dezone commands; growth system with footprint occupancy; demand model; citizen move-in/out (citizen entities live in phase 2 because demand math needs population and unemployment to bootstrap C/I — verified by walking the formulas: with P=0 and U=0, C and I can never go positive and R stalls at 8 free housing capacity); building level/abandon state machine gated by explicit `createCitySim` flags `{fieldsEnabled, utilitiesEnabled}` (both false until their phase: disabled fields read landValue = 30 / coverage 0 / educated false, disabled utilities read powered = watered = true; the flags stay supported forever so early-phase scenario tests remain valid); rect bulldoze covering buildings and roads; instanced building rendering; zone tint overlay; inspect panel basics.

Accept: zoning near roads grows buildings over time per demand; scenario test: zoned R+C+I districts with road access → buildings of all three zones and rising population within N ticks; buildings render with zone-distinct archetypes; level variation becomes reachable in phase 4 when land value and services feed the score (with neutral inputs score is pinned at 25, below LEVEL2_SCORE 45 — level-ups are intentionally impossible until phase 4).

## Phase 3 — Employment and traffic

Employment matching; trip generation; road-graph pathfinding via queue+cache with topology/congestion versioning; vehicle motion with per-edge counts, congestion buckets and epoch; vehicle instancing with interpolation; traffic overlay; disconnectedTrips warning.

Accept: scenario tests — commuters flow between R and C/I clusters; blocking the only route cancels trips; a parallel road reduces max congestion bucket. Browser: visible smooth vehicles, congestion coloring.

## Phase 4 — Fields and services

Pollution/noise/landValue layers with cadences + mirroring into the singleton mirror entity's components; service buildings (fire/police/clinic/school/park/community garden) with separate coverage layers and five grouped civic benefits; desirability wiring (`fieldsEnabled` flips on — land value + coverage now feed levels); field overlays via DataTexture; service placement UI; parks and gardens as profile-sensitive leisure destinations.

Accept: scenario tests — industry raises pollution which drags neighboring land value down; a school enables level-3; overlays visibly match sim values in browser.

## Phase 5 — Utilities and economy

Power (plants/lines/flood-fill/brownout) and water (pumps/pipes) networks; powered/watered gating of growth/leveling/abandonment (`utilitiesEnabled` flips on; the `createCitySim` flag stays supported so earlier-phase scenario tests remain valid); budget interval (taxes by zone/level, upkeep), tax sliders, broke state blocking all purchases except power and water items (plants, lines, pumps, pipes); ⚡/💧 problem icons; power/water overlays.

Accept: scenario tests — unpowered city stalls and abandons, powering it recovers; brownout is deterministic; taxes at 20% suppress demand; budget can go negative and recover; a city that starts broke and unpowered can still buy a wind turbine and recover. Browser: place utilities, watch icons clear.

## Phase 6 — Game shell and polish

Full HUD polish, info panels, event toasts, overlays menu; save/load (localStorage + export/import) with `rebuildDerived`; speed controls incl. pause; day/night lighting; sound off by default (stretch); title-free instant-play boot; `render_game_to_text` completeness.

Accept: save → reload reproduces the city (hash of serialize output stable); all v1 tools usable end-to-end in browser.

## Phase 7 — Verification and hardening

Full-suite pass; determinism gate (recorded-session replay + SessionReplayer.selfCheck) in CI (shipped: .github/workflows/ci.yml); simulation acceptance check at ≥1,000 population plus the SHA-pinned render fixture (936 people, 453 buildings, 88 vehicles at its paused start; active cases grow through 1,000) at nominal 20 TPS and 60 Hz presentation using the game-design pacing tolerances; adversarial review sweep over the whole codebase; fix findings; final automated playthrough (agent builds a city from scratch via browser) recorded in PROGRESS.md; README updated.

Accept: the game-design doc's "Definition of fully functioning" checklist passes end to end.

## Later (explicitly out of v1)

Freeform spline roads (design must stay compatible: graph + rasterization already abstract over cell geometry), public transport, districts/policies, fires/crime/health incidents, high density, freight chains, player terrain sculpting and slope gameplay, milestones/unlock progression, ambient audio.
