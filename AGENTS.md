# AGENTS.md — city

## What this is

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) with a 3D presentation. Grid-aligned roads for now (freeform splines are a possible later phase); its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine**, installed from a retained prebuilt archive pinned in `scripts/civ-engine-pin.json` and `package-lock.json` — it provides ECS, pathfinding, layers, occupancy, commands/events, and serialization; game rules are game code here. Read `docs/architecture/architecture.md` § "Sim internals worth pinning" and `docs/design/game-design.md` before touching sim code — they own the engine contracts this game builds on.

Stack: Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

<!-- FLEET-CANON:BEGIN sha=fa6416c07600 generated from ../fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

Shared rules for every repo under `github/`, kept in `../fleet/FLEET.md`; `../fleet/` is fleet's checkout beside this repo's primary checkout. Where a rule gives its reason, use the reason to judge cases the rule does not name; each `[Rn]`'s history is in `../fleet/docs/canon-rationale.md`. This repo's `docs/policies/local-rules.md` may add rules but cannot change these permissions or limits. [R13]

The main agent owns delivery and may implement directly. Use subagents when bounded, independent work or independent judgment materially improves speed or quality; keep small or tightly coupled work with one agent (owner directive, 2026-11-07). [R2, R3]

The designated coordinator reads `../fleet/docs/skills/coordinator.md` before planning and after each compaction, and any agent reads that file's "Delegate" section before delegating. Before these kinds of work, read the matching section of `../fleet/docs/work-rules.md`: standing loops and unattended runs; editing skills, agent instructions or rules; handing off or stopping mid-task.

### Permissions

- Commit, merge to main and push without asking. Force-pushing and rewriting history (they destroy history), and deploying and publishing (they reach other people), need the owner's OK. [R14]
- Ask before a major architecture or product change, a new major dependency, a change to a persistent format or a security boundary, or any other consequential action outside this machine, such as posting or sending something. [R8]
- Change fleet rules (FLEET.md, fleet skills and runbooks, agent memory) or add a rule to a repo's `docs/policies/local-rules.md` only when the owner asks, because the owner sets policy. You may add a proposal with its evidence to `../fleet/canon-candidates.md`, but not edit its entries. [R8]

### Sharing the machine

- Other Claude and Codex sessions may be working in this checkout, and you cannot see them. Do anything beyond a quick read in your own worktree, because two sessions in one tree spoil each other's gates and commits. Never revert, overwrite or delete changes you did not make. When resuming, check which worktrees, branches and files already exist. [R7]
- Done means merged to main and pushed: the owner archives sessions, and work left on a branch is lost. Merge on your branch, get the gates passing there, then move main, because other worktrees build on local main. Judge the merged result itself, not a worker's summary. Then remove your worktree and branch, and report where any unmerged work is. [R14]

### Doing the work

- The repo's gates must pass on the tree that is handed back or reaches main. Unless the repo's own rules ask more of a commit, commit on your own branch at every stopping point and say in the message what was not checked, because a session can end without warning. Docs-only changes need content checks and any gate the repo names for docs, not runtime tests or CI waits. [R14]
- Check the thing that should have changed (the file, the page, the number), not just the exit code or a tool's report: both can pass over a defect. Retest a blocker you inherit before repeating it. Never weaken a test or hide a failure to get green. [R9]
- Look at visual and interactive work rendered at full resolution, through the real controls, from fixed and random views, because passing tests say nothing about pixels. Run it headless unless a visible window is needed. [R16]
- Slowness on the critical path, such as a gate rendering on the CPU of a machine with a GPU, is a defect to fix. [R22]
- After pushing code, follow CI to the end; read a failed job's steps before blaming the code, since a billing limit fails jobs before any step runs. [R15]
- If a fix fails twice for one reason, rethink it. After five real repair attempts at one problem, whatever the approach and counting earlier sessions, stop and report, unless the owner set another limit; for a problem that keeps winning, run the search in `../fleet/docs/skills/hard-problem.md`. Stop when the task's criteria are met; do not invent follow-up work. [R11]
- For substantial or high-risk changes, use independent review when available. High-risk includes persistence and migrations, security and auth, concurrency, money, supply chain, and code changes in another repo. Review the exact revision against the task's criteria, and say so when review was unavailable. Fix the findings that matter and have those fixes checked; note minor ones instead of starting another round. `../fleet/docs/skills/multi-cli-review.md` provides the review mechanics. [R10]
- A defect the owner reports gets a test for its whole class and an entry in `docs/learning/defect-register.md`, because a fix without a check tends to come back. [R17]
- Sessions run long: take new requests in the same session, and never hand off to a new session to shed context. Split work expected to need more than about 200k tokens of context into milestones, each merged to main. [R6]

### Records, sized to the work

- Read `docs/learning/lessons.md` at session start; it lists this repo's known traps, and its header says how to add one. [R18]
- Every change that alters behaviour adds a dated line to `docs/devlog/summary.md` (`../fleet/docs/devlog-template.md`) when it lands, because later sessions orient from its newest entries. Work that spans sessions, has several agents writing, or gets an independent review also keeps its plan and review records in `docs/work/` (`../fleet/docs/work-docs.md`); other work needs none. [R24]
- Raw output (logs, captures, screenshots) stays in ignored folders. Never commit a binary over 512 KiB or any file over 1 MiB; LFS needs the owner's OK. [R23]

### Style and environment

- Plain words; one line per paragraph, no hard wrapping. A report says what changed, how it was checked (including any check skipped or failed) and what is not done. [R25]
- Node 24 is the baseline. Products pin the model IDs they call in their own repo, and nowhere else. Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`. Runtime model calls are allowed and paid for; make per-item calls one-shot, not agent sessions. [R28, R29]
<!-- FLEET-CANON:END -->

## Gates

`npm test` · `npm run typecheck` · `npm run lint` (zero warnings) · `npm run build` — all four before every code commit; smallest relevant check while iterating. Dependency audit gate: `npm audit --audit-level=high` (full tree and `--omit=dev`).

## Session start

Read `PROGRESS.md`, the section map at the top of `docs/architecture/architecture.md`, and `docs/policies/local-rules.md` before starting work, then the sections of `architecture.md` the work needs.

## Invariants & boundaries

- Layout: `src/app` (bootstrap, worker wiring, render loop, input → commands) · `src/sim` (pure simulation on civ-engine: `constants/` domain files, one file per system plus `road/` and `traffic/` domain subdirs, world assembly and component registration in `city.ts` — keep registration order identical for determinism) · `src/worker` (Web Worker hosting the sim; protocol glue only) · `src/protocol` (typed worker↔main messages) · `src/rendering` (Three.js scene, meshes, instancing, camera, picking, interpolation) · `src/ui` (DOM HUD, tool palette, panels) · `src/persistence` (versioned save/load) · `src/harness` (LLM playtest harness) · `src/shims`.
- `sim/` and `protocol/` must not import Three.js or touch the DOM. `rendering/` consumes protocol snapshots/diffs only — never the World directly. `ui/` dispatches commands, never mutates state. `persistence/` serializes explicit versioned state.
- Every sim component write goes through `setComponent` / `patchComponent` / `setPosition`. `getComponent` hands back the store's own object and marks nothing dirty, so mutating it in place never reaches a `TickDiff` and skips the spatial-grid resync `setPosition` performs — the write lands in memory and is invisible to the renderer, the recorder, and the replay gate.
- Sim work budgets are counts — path resolutions per tick, entities scanned — never milliseconds. A wall-clock budget makes tick output depend on the machine and the moment, which is the one thing replay cannot survive.
- TDD for sim behavior: write the failing contract test first, scenario-level where possible ("after N ticks of X, Y holds"); test the contract, not the implementation.
- No magic numbers — tunable gameplay values live in `src/sim/constants/` domain files.
- Files under 500 LOC. 2-space indentation.
- `npm run visual:sweep` is how the canon's multi-angle visual check is run here: every model from four azimuths at two distances, one contact sheet per subject under `output/visual-sweep/<stamp>/`. Review the sheets. Expose `window.render_game_to_text()` and `window.advanceTime(ms)` for automated playtesting; init Three.js with `preserveDrawingBuffer: true` so screenshots capture WebGL.
- Game testing loop for meaningful gameplay changes: implement a small behavior with its headless test → dev server → drive the game in a real browser → check `render_game_to_text()` output, screenshots, and controls agree → fix and repeat. Verify before calling the game complete: road place/bulldoze, zone paint/erase, service and utility placement, camera orbit/pan/zoom, overlays, speed/pause, save/load/reset, demand meter and budget reacting to play, traffic visibly flowing and congesting.
- Do not edit the civ-engine repo unless the user asks; if an engine bug or missing feature blocks the game, note it in `PROGRESS.md` and work around it here. Installation and verified engine-upgrade steps are in `README.md`.
- Repo review lenses for adversarial passes: correctness, sim-determinism, engine-contract, rendering/perf.

## Conventions

- `docs/design/vision.md` — product direction and visual identity; `docs/design/game-design.md` — gameplay rules, mechanics, tuning values; `docs/design/roadmap.md` — milestone ordering and acceptance criteria; `docs/design/simulation-realism.md` — micro-level traffic/agent behavior (lanes, headway, signals, identity) and its phasing. Read before changing the relevant system.
- `docs/architecture/architecture.md` — code boundaries, worker protocol, data flow.
- `PROGRESS.md` — current status and next steps; keep it current while working (original prompt at top, then status and next steps per phase). Implementation notes, test runs, and findings go in the devlog, `docs/devlog/summary.md`; the dated log PROGRESS.md kept to 2026-08-23 is in `docs/devlog/progress-log.md`, newest first.
- `docs/harness.md` — the LLM playtest → annotate → replay → improve harness (`npm run playtest:llm`, `npm run playtest:recursive`).
- `docs/learning/lessons.md` — per the fleet evidence-anchor rule; `docs/learning/defect-register.md` — every defect the user has reported, and the check that now covers its class. Read the register before touching a surface it names.
