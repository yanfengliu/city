# AGENTS.md — city

## What this is

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) with a 3D presentation. Grid-aligned roads for now (freeform splines are a possible later phase); its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine** (`file:../civ-engine`), the local headless deterministic ECS engine — it provides ECS, pathfinding, layers, occupancy, commands/events, and serialization; game rules are game code here. Read Known traps below before touching sim code.

Stack: Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

## Fleet constitution

- Work headlessly by default; go non-headless only when nothing else can complete or verify the task, and say why.
- These rules are strong defaults, not law: when one would make the work worse, deviate and say why.
- Scale the approach to the task: trivial changes directly; substantial work as explore → plan → implement → verify, with subagents when work is genuinely parallel.
- Delivery boundary: each minimal coherent verified unit is reviewed, staged (scoped files only), and committed promptly — never commit failing or partial work as a checkpoint. Commit to `main`; push at the end of every task.
- Concurrent sessions share one worktree and one index: commit by explicit pathspec (`git commit -- <files>`), never `git commit -a`, `git add -A`, or `git add .` — a sweeping commit captures whatever another session has staged. (Evidence: voxel c024b33, 2026-07-17.)
- The repo's gates must pass before every commit that touches code; doc-only changes need a self-reviewed diff.
- Review: self-review trivial changes; adversarially review non-trivial ones — independent agents that try to refute the change against the live code. High-risk work (persistence/migrations, security/auth, concurrency, money, supply chain, edits that reach sibling repos) escalates to the multi-cli-review skill. Reviewers must read the live code; verify reviewer claims against the codebase before acting on them; substantive findings outweigh approval votes.
- Dependency changes: re-resolve the lockfile, run the repo's audit gate (a new HIGH/CRITICAL is a blocker), and note the audit result in the commit message.
- Docs are part of the change: update every affected surface in the same commit; write prose one line per paragraph (no hard wrapping); never reference or mandate files that don't exist.
- Bias to continue: work through the whole accepted plan without mid-plan check-ins; context management is the harness's job, never a reason to stop. Stop only for a genuine blocker, a direction-changing decision, or an explicit stop. (Established 2026-05-01; reinforced 2026-07-05.)
- Error messages are a product surface: whenever code rejects, fails, or throws, say what happened, which specific input caused it, and what would satisfy it — never a bare `Validation failed`, `invalid input`, or a silent boolean false. A diagnostic that forces a human or an agent to read the source to learn why is itself a defect; fix the message in the same change as the bug. Applies equally to validators, CLI output, and assertion text. (Established 2026-07-18, after city's `placeService` answered five rejected placements with only "Validation failed".)
- Steering compounds: when the user gives a direction that generalizes past the immediate task, land it in the canon in that same session — here if it is fleet-wide, else the repo's AGENTS.md or lessons file — so the next run inherits it instead of relearning it, and say what was captured and where. (Established 2026-07-18.)
- Reviewer model pins live only in `../loop-ops/docs/skills/multi-cli-review.md`, and loop-work model directives in `../loop-ops/DIRECTIVES.md` — never hardcode model IDs anywhere else.
- Lessons files (`docs/learning/lessons.md` where present) require evidence anchors — source, fix commit, test id, behavior delta; unanchored lessons are folklore.
- Recursive loop: before running or driving a pass, read `../loop-ops/docs/skills/recursive-playtest.md`; before building loop machinery, read `../loop-ops/docs/skills/building-recursive-loop.md`.

## Gates

`npm test` · `npm run typecheck` · `npm run lint` (zero warnings) · `npm run build` — all four before every code commit; smallest relevant check while iterating. Dependency audit gate: `npm audit --audit-level=high` (full tree and `--omit=dev`).

## Session start

Read `PROGRESS.md` and `docs/architecture/architecture.md` before starting work.

## Invariants & boundaries

- Layout: `src/app` (bootstrap, worker wiring, render loop, input → commands) · `src/sim` (pure simulation on civ-engine: `constants/` domain files, one file per system plus `road/` and `traffic/` domain subdirs, world assembly and component registration in `city.ts` — keep registration order identical for determinism) · `src/worker` (Web Worker hosting the sim; protocol glue only) · `src/protocol` (typed worker↔main messages) · `src/rendering` (Three.js scene, meshes, instancing, camera, picking, interpolation) · `src/ui` (DOM HUD, tool palette, panels) · `src/persistence` (versioned save/load) · `src/harness` (LLM playtest harness) · `src/shims`.
- `sim/` and `protocol/` must not import Three.js or touch the DOM. `rendering/` consumes protocol snapshots/diffs only — never the World directly. `ui/` dispatches commands, never mutates state. `persistence/` serializes explicit versioned state.
- TDD for sim behavior: write the failing contract test first, scenario-level where possible ("after N ticks of X, Y holds"); test the contract, not the implementation.
- No magic numbers — tunable gameplay values live in `src/sim/constants/` domain files.
- Files under 500 LOC; 2-space indentation; `import type` for type-only imports; remove dead code and duplicated logic.
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
- `.claude/skills/multi-cli-review/SKILL.md` — this repo's thin stub of repo-specific notes for the fleet multi-cli-review runbook.
