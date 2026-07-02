# city

A Cities: Skylines-inspired city builder that runs entirely in the browser. Draw roads, paint RCI zones, wire up power and water, place services, and watch a living city grow — buildings sprout along roads, citizens move in and commute, traffic congests and reroutes, pollution drifts, land value shifts, and the budget breathes.

![status](https://img.shields.io/badge/status-v1_playable-brightgreen)

## Play

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5199`). The first screen is the game.

Core loop: draw **Roads** → paint **Zone R/C/I** near them → place a **Coal/Wind** plant and drag **Line**s to your districts → place a **Pump** next to water and drag **Pipe**s (they run under anything) → watch demand bars, population, and traffic. **Fire/Police/Clinic/School** raise land value (school unlocks level 3). Overlays show pollution, noise, land value, and live traffic congestion. 💾 Save / 📂 Load / ✨ New in the toolbar; pause and 1×/2×/4× speeds.

## How it works

- **Simulation**: deterministic ECS on [civ-engine](../civ-engine) (local, `file:../civ-engine`), running at 20 TPS inside a Web Worker. Agent-based traffic routes over a derived road graph with congestion feedback; pollution/noise/land-value are downsampled field layers; power/water are flood-filled networks with deterministic brownout; the economy taxes buildings and charges upkeep per budget interval.
- **Rendering**: Three.js on the main thread, consuming typed protocol messages (never the sim state directly) — instanced buildings/vehicles/trees, procedural terrain, data-texture overlays, renderer-side motion interpolation, day/night cycle.
- **Determinism**: same seed + same commands = same city. CI-grade gate: a recorded play session must pass the engine's 3-stream replay `selfCheck` (`tests/sim/replay.test.ts`).

## Develop

```bash
npm test           # 57 sim contract tests incl. replay determinism gate
npm run typecheck  # tsc --noEmit (strict)
npm run lint       # eslint, zero warnings
npm run build      # typecheck + vite build
```

Docs: [game design](docs/design/game-design.md) · [architecture](docs/architecture/architecture.md) · [roadmap](docs/design/roadmap.md) · [progress log](PROGRESS.md). Conventions for agents and humans: [AGENTS.md](AGENTS.md).

Automated playtesting hooks: `window.render_game_to_text()` (JSON game state), `window.advanceTime(ms)` (fast-forward), `window.__game` (driver backdoor). Screenshots capture WebGL (`preserveDrawingBuffer`).

## Status

v1 core loop complete and browser-verified: roads, zoning, growth, citizens, employment, commuting traffic with congestion, pollution/noise/land value, services with coverage, power/water networks, taxes/budget with a broke-state escape, save/load, overlays, day/night. See [docs/design/roadmap.md](docs/design/roadmap.md) § Later for what's deliberately out of v1 (freeform roads, public transport, districts, disasters, high density).
