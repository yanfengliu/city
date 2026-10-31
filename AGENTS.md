# AGENTS.md — city

## What this is

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) with a 3D presentation. Grid-aligned roads for now (freeform splines are a possible later phase); its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine** (`file:../civ-engine`), the local headless deterministic ECS engine — it provides ECS, pathfinding, layers, occupancy, commands/events, and serialization; game rules are game code here. Read `docs/architecture/architecture.md` § "Sim internals worth pinning" and `docs/design/game-design.md` before touching sim code — they own the engine contracts this game builds on.

Stack: Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

<!-- FLEET-CANON:BEGIN sha=e54f2a9ae007 generated from ../fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

Reasons and evidence per `[Rn]`: `../fleet/docs/canon-rationale.md`. `../fleet/` is fleet's checkout beside the repo's primary checkout, also from a worktree. The designated coordinator reads `../fleet/docs/skills/coordinator.md` before planning and after each compaction, and any agent reads that file's "Delegate" section before delegating. Before these kinds of work, read the matching section of `../fleet/docs/work-rules.md`: visual and interactive work; games, simulations and research; measuring, debugging and slow steps; writing error messages; toolchains, dependencies and model calls; standing loops and unattended runs; pushing executable changes; a user-reported defect; editing skills, agent instructions or rules; run output and files over 256 KiB; handing off or stopping mid-task.

### Fleet Orchestration Policy

Deliver the requested outcome with verified correctness, coherent architecture and minimal necessary complexity. Optimize useful progress, not agent count, code volume or maximum reasoning. Adapt rigor to risk. This policy grants no new permissions or capabilities. [R1]

**Roles.** Only an explicitly designated agent coordinates; each scope has one accountable integration owner. [R2]

Workers own bounded outcomes and local implementation decisions. [R3]

Inspect instructions, code, docs, tree state and active tasks; set outcome, non-goals, acceptance criteria, dependencies and verification; settle ambiguity with evidence and reversible defaults. [R4]

**Session size** (owner directives, 2026-09-23 and 2026-10-22). Sessions run long: take new requests as separate assignments in the same session, and never hand off to a successor session to shed context; auto-compaction carries the session. Split tasks expected to exceed about 200k context tokens into milestones within that budget, each committed and merged to main once green. Milestones are task boundaries; a compaction never justifies wrapping up or handing off. [R6]

**Coordinate safely.** Beyond a trivial read, each session or agent defaults to its own worktree; serialize overlapping writes only when none is available, and say why. Finish each bounded increment in its session: merge to main, push, then `git worktree remove`, remove completed task-owned branches and unneeded temporary files, and explicitly transfer the ownership and location of still-needed resources. Report any merged worktree left and its location as a defect. Never overwrite or discard another participant's work. On resumption, first inspect surviving worktrees, artifacts and task status, assuming nothing survived until checked; recover what exists and preserve unfinished work. [R7]

Workers act autonomously in scope; escalate cross-task interfaces, persistent formats, security boundaries, major dependencies and scope changes to the coordinator for resolution within the approved mandate. Unapproved major architecture or product changes and consequential external actions need human authorization. Fleet rules (FLEET.md, the fleet's skills and runbooks, canon candidates, and agent memory) change only when the owner asks (owner directive, 2026-10-28). Agents propose changes instead of making them. The one exception: they may add a proposal to `../fleet/canon-candidates.md`, with the lesson, its evidence and the rule it would change (owner directive, 2026-10-29). They never change, promote or delete an entry: the owner decides each one, and the session the owner asks makes the change. Never reset consumed allowances. [R8]

**Implement and verify.** Inspect, implement a coherent increment, check, diagnose, fix, recheck. Preserve architecture; no unrelated rewrites, speculative abstractions or unnecessary dependencies. Implement when requested. Use task-appropriate evidence and baselines; prototype uncertain ideas before generalizing. Never weaken tests or conceal failures to claim success. Docs-only work uses content and version checks; skip runtime tests and CI waits. [R9]

During authorized work and within scope and budget, proactively improve products and the task's orchestration, learn from recorded outcomes and propose improvements to fleet rules. Read `../fleet/docs/skills/self-improvement/SKILL.md` when proposing a fleet-rule change or turning a mistake into a gate (owner directive, 2026-10-29). [R33]

Obtain independent, preferably read-only review for substantial or high-risk changes when available. Review the exact revision against acceptance criteria. Report unavailable review; fix justified findings, rerun affected checks, and obtain focused re-review when fixes invalidate earlier review. [R10]

**Integrate, report, and stop.** Reassess after two failures for one reason. Unless another budget is set or the user authorizes more, cap automatic repair at five substantive attempts, then report; explicit overrides hold for their stated scope without asking again. Keep updates brief and decision-relevant. Stop when acceptance criteria and material findings are resolved; invent no follow-up work. [R11]

**Final acceptance gate.** The integration owner integrates in dependency order and on the final integrated revision's actual changes and evidence, not worker summaries, checks every acceptance criterion, runs relevant automated checks and exercises affected end-to-end behavior and cross-task interactions. Substantial or high-risk work gets independent read-only review of the integrated changes, integration fixes included. Confirm the merge to main; report that revision, review status and every failed, skipped or unavailable check and unmet criterion. Nothing is fully verified with an open material finding or required check. [R12]

### Fleet conventions

- Repository rules add local constraints consistent with this policy; they cannot override its permissions, adaptive workflow or stopping limits. [R13]
- Gates pass before any commit touching code, a merge included: merge on a detached HEAD or its own branch and move main to it once its gate passes. The user's standing grant covers committing, merging to main and pushing in their repos; force-pushing, rewriting history, deploying and publishing still need authorization. Work is done only once merged to main, regardless of green branch or worktree gates; report unmerged work's location. [R14]
- For substantial or high-risk changes, use independent review when available. High-risk includes persistence and migrations, security and auth, concurrency, money, supply chain, and executable changes in sibling repos; `../fleet/docs/skills/multi-cli-review.md` provides the review mechanics. [R10]
- Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`; every model a product calls is pinned in its calling repo. No model IDs are hardcoded elsewhere. [R29]
- Read `docs/learning/lessons.md` at session start. Record the session's lessons there; each names its retiring gate and is deleted in the commit landing it. A gate counts only after going red with the defect reintroduced, following `../fleet/docs/lessons-template.md`. [R18]
- Gates prove nothing beyond their bounds: name the bound in the header and pin every reproducing input. Distinguish passed from did-not-run; a check built from its checked symbol proves only self-agreement. [R19]
- Verify outcomes beyond exit status, red or green, and return values: read the artifact that should have changed. Retest inherited blockers before repeating them. [R20]
- Keep plans and every authored review round in permanent `docs/work/<id>_<theme>/` folders (`../fleet/docs/work-docs.md`). Record history, not status: a dated devlog line per behaviour-changing session in `docs/devlog/summary.md` (`../fleet/docs/devlog-template.md`). [R24]
- Use common words with the same meaning in chat, docs, commits, PRs, comments and errors. One idea per sentence unless a rule needs more. Cut length, not facts: keep exact terms, numbers and evidence. Quotes and pastes are exempt; do not copy this canon's style. One line per paragraph, no hard wrapping. [R25]
- When blocked, immediately hand over the redacted artifact with the named blocker, before analysis; continue safe independent work. [R27]
- The owner's directions that outlive a task land that session in `../fleet/FLEET.md` if fleet-wide, otherwise the repo's `docs/policies/local-rules.md`; report where. [R31]
- When a hard problem blocks progress, run the search in `../fleet/docs/skills/hard-problem.md`. [R32]
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
- Do not edit the civ-engine repo unless the user asks; if an engine bug or missing feature blocks the game, note it in `PROGRESS.md` and work around it here. The engine is pinned as `file:../civ-engine`.
- Repo review lenses for adversarial passes: correctness, sim-determinism, engine-contract, rendering/perf.

## Conventions

- `docs/design/vision.md` — product direction and visual identity; `docs/design/game-design.md` — gameplay rules, mechanics, tuning values; `docs/design/roadmap.md` — milestone ordering and acceptance criteria; `docs/design/simulation-realism.md` — micro-level traffic/agent behavior (lanes, headway, signals, identity) and its phasing. Read before changing the relevant system.
- `docs/architecture/architecture.md` — code boundaries, worker protocol, data flow.
- `PROGRESS.md` — current status and next steps; keep it current while working (original prompt at top, then status and next steps per phase). Implementation notes, test runs, and findings go in the devlog, `docs/devlog/summary.md`; the dated log PROGRESS.md kept to 2026-08-23 is in `docs/devlog/progress-log.md`, newest first.
- `docs/harness.md` — the LLM playtest → annotate → replay → improve harness (`npm run playtest:llm`, `npm run playtest:recursive`).
- `docs/learning/lessons.md` — per the fleet evidence-anchor rule; `docs/learning/defect-register.md` — every defect the user has reported, and the check that now covers its class. Read the register before touching a surface it names.
