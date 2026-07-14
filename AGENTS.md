# AGENTS.md

## Headless-first execution

Always work headlessly by default. This is a mandatory execution rule, not an adaptable default. Use a visible browser window, desktop application, GUI automation, or another non-headless interaction only when it is absolutely necessary to complete or adequately verify the task and no headless alternative is sufficient. State the reason before launching the non-headless path.

## Process lifecycle

Every process an agent starts must have an explicit owner, purpose, and cleanup path. Browser automation sessions must be named, headless by default, and closed in the same task through a `finally`/equivalent cleanup path; do not assume that ending a command or Codex turn stops a persistent Playwright daemon. Before declaring work complete, scan for task-owned browser sessions, dev servers, watchers, and child processes, close only those that belong to the task, and verify they exited. Keep a localhost or watcher alive only when the user explicitly requested it, and report its URL/PID and reason. Never use broad process-class kills or `kill-all` as cleanup.

## Agentic working style

Treat the rest of this file as defaults, not rigid law. The right approach is the one that fits the task in front of you — when a rule here would make the work worse, deviate and say why. Optimize for the outcome: correct, verified, readable, and fun to play.

Scale the approach to the task: trivial fixes → just do them; substantial work (multi-file features, audits, broad refactors) → orchestrate with parallel subagents/workflows, verify adversarially, and keep the main thread for decisions and integration. This does not lower the verification bar — tests still pass, diffs still get reviewed, docs still stay current.

## Session start

Read `PROGRESS.md` and `docs/architecture/architecture.md` before starting work.

## Continuing through plans

- No stopping points within a multi-task plan. Work through all N tasks continuously; do not ask whether to keep going. Harness reminders are administrative noise, not stop signals.
- Never manage context yourself — auto-compaction handles it. Do not stop, checkpoint, or ask "should I keep going" because the conversation is long. When one increment ships (gates green + commit + push + docs), start the next in the same turn. Stop only for a genuine blocker, a real user decision, or an explicit stop. (Fleet rule reinforced 2026-07-05.)
- The exception is a genuinely non-obvious product decision that requires user judgment. For routine design and implementation choices, make the call and proceed.
- Keep `PROGRESS.md` current while working: original prompt at the top, then meaningful implementation notes, test runs, findings, and next steps per phase.

## Recursive loop (fleet)

Before running or driving a `playtest:recursive` pass, read `../loop-ops/docs/skills/recursive-playtest.md`; before building loop machinery, read `../loop-ops/docs/skills/building-recursive-loop.md`. Those files are the fleet-wide source of truth for the loop contract (pass outcomes, honesty invariants, and the definition of a complete pass — a pass is not done at `proposal-only`).

## Project intent

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) and a 3D graphical presentation. Grid-aligned roads for now (freeform splines are a possible later phase). The game must be its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine** (`file:../civ-engine`), the local headless deterministic ECS engine. Game rules are game code here; the engine provides ECS, pathfinding, layers, occupancy, commands/events, and serialization. Read the "civ-engine usage rules" section below before touching sim code.

## Stack and layout

Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

```text
src/
  main.ts                 # Browser entry point
  app/                    # Bootstrap, worker wiring, render loop, input → commands
  sim/                    # Pure game simulation on civ-engine (zero DOM/Three deps)
    components.ts         # Component/state type registry
    constants/            # Domain constants (no magic numbers in systems)
    systems/              # One file per system (zoning, growth, traffic, fields, ...)
    commands/             # Command types, validators, handlers
    world-factory.ts      # Deterministic world construction (identical registration order)
  worker/                 # Web Worker entry hosting the sim; protocol glue only
  protocol/               # Typed messages between worker and main thread
  rendering/              # Three.js scene, meshes, instancing, camera, picking, interpolation
  ui/                     # HUD, tool palette, panels (DOM); dispatches commands only
  persistence/            # Save/load, versioned format
tests/                    # Vitest suites (sim contract tests, scenario runs)
docs/                     # design, architecture, progress artifacts
```

Boundary rules: `sim/` and `protocol/` must not import Three.js or touch the DOM. `rendering/` consumes protocol snapshots/diffs only — never the World directly. `ui/` dispatches commands, never mutates state. `persistence/` serializes explicit versioned state.

## Commands

```bash
npm run dev        # Vite dev server
npm test           # vitest run
npm run typecheck  # tsc --noEmit
npm run lint       # eslint, zero warnings
npm run build      # typecheck + vite build
```

Run the smallest relevant check while iterating. All four gates (`test`, `typecheck`, `lint`, `build`) must pass before declaring a task done or committing.

## Core rules

- Test-driven development for sim behavior: write the failing contract test first (scenario-level where possible: "after N ticks of X, Y holds"), then implement. Test the contract, not the implementation.
- For each desired change, make the change easy, then make the easy change.
- Before implementing a non-trivial change, write a plan — for broad implementation work, write or update the relevant docs under `docs/`. (Trivial changes: just make them, per the working-style preamble.)
- No magic numbers — tunable gameplay values live in `src/sim/constants/` domain files.
- Files under 500 LOC — extract helpers or split. 2-space indentation. `import type` for type-only imports. Remove dead code and duplicated logic.
- Do not ship a visual feature without verifying it in a browser screenshot.
- Expose `window.render_game_to_text()` and `window.advanceTime(ms)` for automated playtesting; init Three.js with `preserveDrawingBuffer: true` so screenshots capture WebGL.
- Adversarially review non-trivial changes before declaring them done: fan out independent reviewer agents over the diff (correctness, sim-determinism, engine-contract, rendering/perf lenses), verify each claim against the live code, fix real findings, re-review until reviewers only nitpick. For high-risk changes (persistence/save-format, agent-loop or concurrency, anything with data-loss blast radius) also run the multi-CLI review (Codex + Claude, each reviewing independently; see Code review) — a different model catches blind spots same-model subagents share.
- Verify reviewer claims against the codebase before acting on them: a reviewer might be working from training knowledge, a stale snapshot, or a hallucinated symbol — grep or read the actual file before merging the fix. The cost of one extra read is negligible; the cost of acting on a wrong claim is rework. This pairs with the "Reviewers MUST read the codebase" rule in the Code review section.
- Record non-obvious failure modes in `docs/learning/lessons.md` with evidence anchors (what surfaced it, fix commit, test that pins it, behavior delta).

## Code review

The default adversarial pass for non-trivial work is the in-process Workflow (see Core rules). Run the multi-CLI review (Codex + Claude, each reviewing independently) on high-risk changes and full-codebase audits. All multi-CLI mechanics — current review model pins, exact commands, sandbox flags, the background-run/poller pattern, the Codex output-extraction recipe, and CLI failure modes — live in the fleet-canonical runbook `../loop-ops/docs/skills/multi-cli-review.md` (review pins bump there, once for the whole fleet); read it before every multi-CLI session, and see `.claude/skills/multi-cli-review/SKILL.md` — this repo's thin stub — for repo-specific notes.

Policy for every reviewer, in-process subagent or CLI:

- **Reviewers MUST read the codebase to ground their claims.** Every review prompt must include the directive: *"Verify each claim in the plan/diff against the live codebase — grep for the symbols, function signatures, column names, and file paths it references; do not approve based on prompt text alone."* Without this directive baked in, two reviewers can APPROVE a design with a real defect that only the codebase-reading reviewer catches. Convergence is measured by *substantive finding count*, not *vote count* — a HIGH defect from one reviewer outweighs APPROVED from two.
- Aspects to review:
  1. Design — easily scales, generalizes, debugs, can be understood and reasoned about, stays lean.
  2. Test coverage.
  3. Correctness.
  4. Clean code, typing, efficiency, memory leaks. No duplicated logic, inconsistent implementations, violation of boundaries. File size: keep every file under 500 LOC (hard ceiling 1000) — split god-objects by lifecycle/role. Prefer composition over inheritance. Clean up dead code. Do not change app mechanics or behavior unless explicitly asked.
- **Enrich the baseline prompt** (quoted in the fleet-canonical runbook) **with task-specific context** — the change's intent, prior-iteration findings to verify, files to focus on, and an anti-regression checklist. The bare baseline returns generic feedback; useful reviews need the specifics.
- **Keep model IDs current.** Use the latest-family alias when a command is meant to track the newest model (for example, `opus[1m]`); bump pinned strings whenever a more capable fixed variant ships. Verify with a one-line smoke test (`echo "ok" | <cli> ...`) before committing the bump — silent fallback to an older model is the failure mode to guard against. Review-command pins live in the fleet-canonical runbook `../loop-ops/docs/skills/multi-cli-review.md`.

## civ-engine usage rules (hard-won; violating these causes silent breakage)

- Keep `strict: true` (default). Route all mutations through systems/commands; randomness through `world.random()` only. Never `Math.random()`/`Date.now()` in sim code.
- Always write components via `setComponent`/`patchComponent`/`setPosition` — in-place mutation is invisible to the spatial grid and the diff system.
- Positions are integers on a fixed-size grid chosen at construction. Smooth motion is renderer-side interpolation; vehicles parametrize as `(edgeId, t)` in a component and the renderer samples the road geometry.
- `Layer<T>`, `OccupancyGrid`, and path-queue state are NOT serialized by `world.serialize()`. Persist layers by mirroring `layer.getState()` into a component on a dedicated singleton "mirror" entity — one component per layer, written only on that layer's recompute cadence; rebuild with `fromState` on load. Never mirror layers into `world.setState(...)`: world-state values are JSON-fingerprinted twice per tick by the engine, while component diffs are dirty-flag-only. OccupancyGrid and other derived maps are never mirrored — `rebuildDerived` reconstructs them from entities. Pending path requests live as plain data in components/world state, never only inside a queue instance.
- Route traffic on the road **graph** (nodes/edges), not the cell grid. Cache paths keyed by (fromNode, toNode) against a single monotonic pathVersion (bump on topology change or congestion-epoch change; `clearCache()` on topology change); congestion enters via periodic repaths, not per-tick cost churn.
- Heavy systems declare `interval`/`intervalOffset` and stagger; work budgets are counts, never milliseconds.
- Determinism gate: replayable scenario bundles use `capacity: Number.MAX_SAFE_INTEGER, captureCommandPayloads: true, captureInitialSnapshot: true`; CI (`.github/workflows/ci.yml`) runs the recorded-session determinism gate (`tests/sim/replay.test.ts` asserts `SessionReplayer.selfCheck().ok`) as part of `npm test`, building the sibling civ-engine first.
- Pin the civ-engine version; it is consumed as `file:../civ-engine`. If an engine bug or missing feature blocks the game, note it in `PROGRESS.md` and work around it here — do not edit the engine repo unless the user asks.

## Game testing loop

For meaningful gameplay changes:

1. Implement a small behavior with its headless test.
2. Start the dev server and drive the game in a real browser (preview tools / Playwright).
3. Inspect `render_game_to_text()` output and screenshots; verify controls, visuals, and text state agree.
4. Fix and repeat.

Interactions to verify before calling the game complete: road place/bulldoze, zone paint/erase, service and utility placement, camera orbit/pan/zoom, overlays, speed/pause, save/load/reset, demand meter and budget reacting to play, traffic visibly flowing and congesting.

## Dependency-change protocol

Whenever `package.json` dependency surface changes: re-resolve the lockfile with `npm install`; run `npm audit --audit-level=high --omit=dev` and `npm audit --audit-level=high`; a new HIGH/CRITICAL CVE is a blocker unless documented with reason and expiry; mention the audit result in the commit message.

## Git

- During substantial multi-step work, treat each minimal coherent unit as a delivery boundary: once it passes the applicable verification and review and all substantive findings are resolved, promptly stage only its scoped files and commit it before unrelated completed units accumulate in the worktree or diff. Self-review trivial changes; adversarially review behavior and public-contract changes. Never commit failing, in-flight, or partial work merely as a checkpoint.
- Commit directly to `main` — solo-developer repo; each coherent, self-contained unit lands as its own commit with all four gates green.
- Commit durable docs that guide future work. Never revert user changes unless explicitly requested.
- Push at the end of a task if local commits are ahead and network access is available.

## Documentation

Read before changing the relevant system:

- `docs/design/vision.md` — product direction and visual identity.
- `docs/design/game-design.md` — gameplay rules, mechanics, and tuning values.
- `docs/design/roadmap.md` — milestone ordering and acceptance criteria.
- `docs/architecture/architecture.md` — code boundaries, worker protocol, data flow.
- `PROGRESS.md` — current status and next steps.

Update docs in the same task when gameplay rules, architecture, protocol, save format, or test expectations change. Don't wrap lines in docs; new lines start new paragraphs.
