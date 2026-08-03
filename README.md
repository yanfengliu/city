# city

A Cities: Skylines-inspired city builder that runs entirely in the browser. Draw roads, paint RCI zones, wire power and water, place services, and watch a deterministic living city grow: buildings develop, named residents move in, purposeful walkers and cars travel, traffic queues and reroutes, pollution and land value shift, and the budget responds.

![status](https://img.shields.io/badge/status-v1_complete-brightgreen)

## Play

Development uses Node 24 from `.nvmrc`. The local `file:` dependencies expect sibling checkouts at `../civ-engine` and `../voxel`; run `npm ci` and `npm run build` in both siblings before installing City. The fleet bootstrap described below prepares the checkout layout.

```bash
npm ci
npm run dev
```

Open the printed URL (default `http://localhost:5199`). The first screen is the playable game.

Core loop: draw **Roads** → paint **Zone R/C/I** nearby → place a **Coal/Wind** plant and drag **Line**s to districts → place a **Pump** beside water and drag underground **Pipe**s → balance demand, services, utilities, taxes, and traffic. **Fire/Police/Clinic/School/Park/Garden** provide distinct coverage and leisure effects. Overlays expose pollution, noise, land value, congestion, utilities, and service coverage. Save, Load, New, pause, and 1×/2×/4× controls are in the game HUD.

Cars keep right, preserve headway, obey deterministic junction signals, and retain visible identity. Pedestrians keep personal space, choose work/shopping/leisure trips, and can be selected to inspect a named resident's household, biography, home, work, destination, happiness, and recent life events.

## How it works

- **Simulation**: deterministic ECS on [civ-engine](../civ-engine), running at 20 TPS in a Web Worker. Agent traffic routes over a derived road graph with congestion feedback; pollution, noise, land value, and service coverage use downsampled field layers; power and water use deterministic network propagation; the economy taxes buildings and charges upkeep.
- **Presentation**: Three.js on the main thread consumes typed protocol messages, never simulation state directly. Instanced terrain, buildings, vehicles, people, vegetation, and low-poly assets from [voxel](../voxel) keep the city responsive while renderer-side interpolation provides smooth motion.
- **Determinism**: the same seed and commands produce the same city. CI requires recorded-session replay plus the engine's three-stream `SessionReplayer.selfCheck` in `tests/sim/replay.test.ts`.

## Develop

```bash
npm test           # Vitest contracts, scenarios, replay, and benchmark contracts
npm run typecheck  # TypeScript strict mode
npm run lint       # ESLint with zero warnings
npm run build      # typecheck + production Vite build + worker budget
```

Run `npm run hooks:install` once per clone to activate the tracked pre-commit artifact gate. It inspects staged Git objects before a normal commit; CI independently scans every commit after the fixed clean policy epoch on every pushed branch and pull request, including an oversized or evidence blob that a later commit deletes. City's exact thresholds, reviewed fixture allowance, and the client-hook/server-admission boundary are recorded in [the local policy](docs/policies/local-rules.md).

Project references: [game design](docs/design/game-design.md) · [simulation realism](docs/design/simulation-realism.md) · [architecture](docs/architecture/architecture.md) · [roadmap](docs/design/roadmap.md) · [progress log](PROGRESS.md) · [benchmark procedure and evidence](benchmarks/README.md). Conventions for agents and humans live in [AGENTS.md](AGENTS.md).

Automated playtesting exposes `window.render_game_to_text()` for bounded JSON state, `window.advanceTime(ms)` for deterministic fast-forward, and `window.__game` for the test driver. WebGL uses `preserveDrawingBuffer` so browser screenshots capture the rendered city.

## Status

v1 is complete and browser-verified: roads and terrain, zoning and growth, citizens and employment, purposeful traffic and pedestrians, micro-level traffic rules, services and green leisure, utilities and economy, overlays, inspection, save/load, and the full game shell. The final-source frame-pacing gate passes every DPR/speed profile; its concise result and provenance are recorded in [PROGRESS.md](PROGRESS.md). See the roadmap's **Later** section for deliberately out-of-v1 work such as freeform roads, public transport, districts, incidents, high density, freight, terrain sculpting, unlock progression, and audio.

## Part of a fleet

This repo is one of roughly two dozen sibling repos kept side by side under one `github/` directory. Fleet-wide setup, governance, and the recursive self-improvement loop live in [fleet](https://github.com/yanfengliu/fleet); on a fresh machine, clone that repo and run `npm run clone-fleet` to restore every sibling and the shared canon.
