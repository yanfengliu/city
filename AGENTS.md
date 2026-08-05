# AGENTS.md — city

## What this is

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) with a 3D presentation. Grid-aligned roads for now (freeform splines are a possible later phase); its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine** (`file:../civ-engine`), the local headless deterministic ECS engine — it provides ECS, pathfinding, layers, occupancy, commands/events, and serialization; game rules are game code here. Read Known traps below before touching sim code.

Stack: Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

<!-- FLEET-CANON:BEGIN sha=f3fc55a93a9a generated from fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

- Work headlessly by default. If only a browser or GUI can finish or verify the task, say why, and close what you opened.
- Concurrent sessions share one worktree and one index: commit by explicit pathspec (`git commit -- <files>`), never `git commit -a`, `git add -A`, or `git add .` — a sweeping commit captures whatever another session has staged. (voxel c024b33.)
- Commit each verified unit to `main` promptly without being asked, and push at the end of the task; never commit failing or partial work as a checkpoint. Gates pass before any commit that touches code; a dependency change re-runs the audit gate.
- Toolchain baseline is Node 24, pinned per repo in `.nvmrc`. A repo that must keep an older major says so in its Gates section and keeps a CI job proving it.
- Runtime model calls are authorized and already paid for — this fleet has one user, with Claude Code and Codex subscriptions — so a program here may call a model at runtime, vision included, wherever that beats a hand-written heuristic. Model output proposes; a deterministic check disposes.
- A fix is done when the failing case has been rerun and a regression test or fixture fails if the fix reverts. A diff is not evidence.
- High-risk work — persistence/migrations, security/auth, concurrency, money, supply chain, edits that reach sibling repos — escalates to the multi-cli-review skill.
- Error messages are a product surface: audit them as a class, including paths the task did not touch. Every path that rejects or throws names what happened, which input caused it, and what would satisfy it — never a bare `Validation failed`.
- Docs are part of the change: update every affected surface in the same commit, and write prose one line per paragraph (no hard wrapping).
- Task-run evidence — raw traces, per-sample results, screenshots, recordings, generated reports, archives — lives only under ignored paths and is deleted once nothing active needs it; never commit, push, or move it to LFS. Tracked docs keep conclusions and provenance only. Such output enters Git only when review promotes it into a genuine repository input — a fixture, golden, snapshot, or contract.
- Git blob ceilings: a new or changed blob over 256 KiB needs an explicit repository-input reason; over 512 KiB binary, or 1 MiB anything, never enters ordinary Git. An external asset store or LFS requires explicit user approval, and an existing oversized blob is never precedent for another.
- Steering compounds: when the user gives a direction that outlives the immediate task, land it that same session — `../fleet/FLEET.md` if fleet-wide, else this repo's `docs/policies/local-rules.md` — and say where it went.
- Citations are part of the deliverable: anything with a public answer — a numerical method, a library's behaviour, an engine parameter, a format, a protocol — carries the source it was read from, and so does any mechanism offered to explain a measured result. A dependency's source is one call away (`gh api repos/<owner>/<repo>/contents/<path>`).
- Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`; a model a product itself calls is pinned in the repo that calls it. Never hardcode a model ID anywhere else.
<!-- FLEET-CANON:END -->

## Gates

`npm test` · `npm run typecheck` · `npm run lint` (zero warnings) · `npm run build` — all four before every code commit; smallest relevant check while iterating. Dependency audit gate: `npm audit --audit-level=high` (full tree and `--omit=dev`).

## Session start

Read `PROGRESS.md`, `docs/architecture/architecture.md`, and `docs/policies/local-rules.md` before starting work. Read `docs/learning/lessons.md` too — it records what has already been tried and what it cost, and a lessons file nothing tells anyone to open is write-only.

## Invariants & boundaries

- Layout: `src/app` (bootstrap, worker wiring, render loop, input → commands) · `src/sim` (pure simulation on civ-engine: `constants/` domain files, one file per system plus `road/` and `traffic/` domain subdirs, world assembly and component registration in `city.ts` — keep registration order identical for determinism) · `src/worker` (Web Worker hosting the sim; protocol glue only) · `src/protocol` (typed worker↔main messages) · `src/rendering` (Three.js scene, meshes, instancing, camera, picking, interpolation) · `src/ui` (DOM HUD, tool palette, panels) · `src/persistence` (versioned save/load) · `src/harness` (LLM playtest harness) · `src/shims`.
- `sim/` and `protocol/` must not import Three.js or touch the DOM. `rendering/` consumes protocol snapshots/diffs only — never the World directly. `ui/` dispatches commands, never mutates state. `persistence/` serializes explicit versioned state.
- TDD for sim behavior: write the failing contract test first, scenario-level where possible ("after N ticks of X, Y holds"); test the contract, not the implementation.
- No magic numbers — tunable gameplay values live in `src/sim/constants/` domain files.
- Files under 500 LOC. 2-space indentation.
- Do not ship a visual feature without verifying it in a browser screenshot. Expose `window.render_game_to_text()` and `window.advanceTime(ms)` for automated playtesting; init Three.js with `preserveDrawingBuffer: true` so screenshots capture WebGL.
- Game testing loop for meaningful gameplay changes: implement a small behavior with its headless test → dev server → drive the game in a real browser → check `render_game_to_text()` output, screenshots, and controls agree → fix and repeat. Verify before calling the game complete: road place/bulldoze, zone paint/erase, service and utility placement, camera orbit/pan/zoom, overlays, speed/pause, save/load/reset, demand meter and budget reacting to play, traffic visibly flowing and congesting.
- Do not edit the civ-engine repo unless the user asks; if an engine bug or missing feature blocks the game, note it in `PROGRESS.md` and work around it here. The engine is pinned as `file:../civ-engine`.
- Repo review lenses for adversarial passes: correctness, sim-determinism, engine-contract, rendering/perf.

## Known traps

civ-engine usage rules — hard-won; violating these causes silent breakage:

- Keep `strict: true` (default). Route all mutations through systems/commands; randomness through `world.random()` only. Never `Math.random()`/`Date.now()` in sim code.
- Always write components via `setComponent`/`patchComponent`/`setPosition` — in-place mutation is invisible to the spatial grid and the diff system.
- Positions are integers on a fixed-size grid chosen at construction. Smooth motion is renderer-side interpolation; vehicles parametrize as `(edgeId, t)` in a component and the renderer samples the road geometry.
- `Layer<T>`, `OccupancyGrid`, and path-queue state are NOT serialized by `world.serialize()`. Persist layers by mirroring `layer.getState()` into a component on a dedicated singleton "mirror" entity — one component per layer, written only on that layer's recompute cadence; rebuild with `fromState` on load. Never mirror layers into `world.setState(...)`: world-state values are JSON-fingerprinted twice per tick by the engine, while component diffs are dirty-flag-only. OccupancyGrid and other derived maps are never mirrored — `rebuildDerived` reconstructs them from entities. Pending path requests live as plain data in components/world state, never only inside a queue instance.
- Route traffic on the road **graph** (nodes/edges), not the cell grid. Cache paths keyed by (fromNode, toNode) against a single monotonic pathVersion (bump on topology change or congestion-epoch change; `clearCache()` on topology change); congestion enters via periodic repaths, not per-tick cost churn.
- Heavy systems declare `interval`/`intervalOffset` and stagger; work budgets are counts, never milliseconds.
- Determinism gate: replayable scenario bundles use `capacity: Number.MAX_SAFE_INTEGER, captureCommandPayloads: true, captureInitialSnapshot: true`; CI (`.github/workflows/ci.yml`) runs the recorded-session determinism gate (`tests/sim/replay.test.ts` asserts `SessionReplayer.selfCheck().ok`) as part of `npm test`, building the sibling civ-engine first.

## Conventions

- `docs/design/vision.md` — product direction and visual identity; `docs/design/game-design.md` — gameplay rules, mechanics, tuning values; `docs/design/roadmap.md` — milestone ordering and acceptance criteria; `docs/design/simulation-realism.md` — micro-level traffic/agent behavior (lanes, headway, signals, identity) and its phasing. Read before changing the relevant system.
- `docs/architecture/architecture.md` — code boundaries, worker protocol, data flow.
- `PROGRESS.md` — current status and next steps; keep it current while working (original prompt at top, then implementation notes, test runs, findings, and next steps per phase).
- `docs/harness.md` — the LLM playtest → annotate → replay → improve harness (`npm run playtest:llm`, `npm run playtest:recursive`).
- `docs/learning/lessons.md` — per the fleet evidence-anchor rule.
