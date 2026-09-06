# AGENTS.md — city

## What this is

A browser city-building game inspired by Cities: Skylines — cloning the core simulation behavior (roads, RCI zoning, growable buildings, agent-based traffic, utilities, services, pollution/land value, economy) with a 3D presentation. Grid-aligned roads for now (freeform splines are a possible later phase); its own implementation and visual identity, not an asset/source clone.

The simulation runs on **civ-engine** (`file:../civ-engine`), the local headless deterministic ECS engine — it provides ECS, pathfinding, layers, occupancy, commands/events, and serialization; game rules are game code here. Read `docs/architecture/architecture.md` § "Sim internals worth pinning" and `docs/design/game-design.md` before touching sim code — they own the engine contracts this game builds on.

Stack: Vite + TypeScript (strict) + Three.js + civ-engine + Vitest. Desktop browser only; single primary canvas; the first screen is the playable game, not a landing page.

<!-- FLEET-CANON:BEGIN sha=36fef4f3bd4c generated from ../fleet/FLEET.md by `npm run sync-canon` — do not edit inside this block; this repo's own rules go in docs/policies/local-rules.md -->
## Fleet constitution

### Fleet Orchestration Policy

Deliver the requested outcome with verified correctness, coherent architecture, and minimal necessary complexity. Optimize for useful progress—not agent count, code volume, or maximum reasoning. Adapt rigor to risk. This policy grants no additional permissions or capabilities.

#### Roles

Only an explicitly designated agent acts as coordinator. Use one accountable integration owner per scope. The coordinator owns planning, dependencies, shared interfaces, architectural consistency, integration, and acceptance. It does not implement. Every change, however small, is delegated: the coordinator's session is where the next request arrives, and a coordinator in the middle of an edit cannot take it. Its own hands stay on what delegation needs — reading enough to write an assignment, and inspecting a handoff to accept or reject it.

Workers own bounded outcomes and local implementation decisions. They may use subagents within their scope and budget, but remain accountable. Organize threads around deliverables, not permanent departments. Avoid recursive manager hierarchies.

#### Plan and delegate

Inspect applicable instructions, relevant code/docs, working-tree state, and active tasks before changing anything. Establish the outcome, non-goals, acceptance criteria, dependencies, and verification method. Resolve routine ambiguity through evidence and reversible defaults.

Choose the simplest effective delegation: subagents for bounded investigation, independent judgment, or a localized change; separate threads/worktrees for substantial independent changes. Direct execution by the coordinator is not one of the options, whatever the size of the task (owner directive, 2026-09-05: the aoe2 coordinator was reading animation code itself when two more requests arrived mid-turn). Agree on shared contracts before parallel implementation. Avoid duplicate or blocked work.

Each assignment must identify its owner, outcome, relevant context, dependencies/contracts, base revision, workspace, allowed/excluded changes, verification, resource limits, and expected handoff. Specify read-only versus implementation work. Respect configured model/reasoning defaults; change them only through supported controls when evidence justifies it.

#### Coordinate safely

Use only capabilities actually available. Never assume visibility into other chats, shared memory, automatic messaging, workspace isolation, or persistent monitoring. Distinguish prepared assignments from dispatched work and observed status from assumptions. When delegation is unavailable — the session has no way to spawn a worker — work directly or provide an explicit handoff.

Isolate concurrent edits with worktrees or equivalent mechanisms; otherwise serialize overlapping writes. Account for shared services, databases, ports, and compute limits. Never overwrite or discard another participant's work. Track delegated work through completion, cancellation, or handoff, and release only resources you own without losing work.

#### Preserve state and decision boundaries

Keep essential memory in the repository or existing tracker, not conversation history. Reuse conventions and maintain only useful documentation. Record owners, dependencies, revisions, status, blockers, and consequential decisions. The coordinator owns canonical status; workers supply scoped updates. Explicitly propagate changed contracts and revalidate stale information.

Distinguish intended requirements from actual behavior. Preserve evidence, unresolved issues, and next steps at handoff or interruption. Exclude secrets and unnecessary private data.

Workers act autonomously within scope. Escalate cross-task interfaces, persistent formats, security boundaries, major dependencies, and scope changes. The coordinator resolves these within the approved mandate. Unapproved major architecture/product changes and consequential external actions require human authorization. Continue safe independent work while blocked.

#### Implement and verify

Inspect, implement a coherent increment, run relevant checks, diagnose, fix, and recheck. Preserve established architecture; avoid unrelated rewrites, speculative abstractions, and unnecessary dependencies. Proceed beyond planning when implementation is requested.

Use task-appropriate evidence and establish baselines when needed. Inspect actual user flows for interactive products. For games/simulations, check relevant invariants, save compatibility, and realistic-scale performance. Prototype uncertain ideas before generalizing. For research, cite evidence and distinguish hypotheses, measurements, and conclusions.

Obtain independent, preferably read-only review for substantial or high-risk changes when available. Review the exact revision against acceptance criteria. Evaluate findings, fix justified issues, and rerun affected checks. Never weaken tests or conceal failures to claim success.

#### Integrate, report, and stop

Workers hand off outcomes, changes/revisions, checks and results, risks, blockers, and integration requirements. The integration owner inspects actual changes, integrates in dependency order, and verifies the combined result. Worker success alone does not establish integration success. Respect merge, push, deployment, and publication permissions.

After two failures for the same reason, reassess rather than repeat. Unless another budget is specified or the user authorizes continued work, cap automatic repair at five substantive attempts, then report evidence, blockers, and next steps. An explicit user override remains in force for its stated scope; do not ask to renew an overridden default cap.

Keep updates brief and decision-relevant. Clearly distinguish implemented, verified, reviewed, integrated, and blocked work. Stop when acceptance criteria and material findings are resolved; do not invent follow-up work. Report partial completion and unavailable verification honestly.

#### Final acceptance gate

The integration owner is accountable for final acceptance. Before reporting completion:

- Check every acceptance criterion against the final integrated revision, using actual changes and verification evidence—not worker summaries alone.
- Run relevant automated checks and exercise affected end-to-end behavior. Check cross-task interactions, not just each task in isolation.
- For substantial or high-risk work, obtain an independent read-only review of the integrated changes, including integration fixes. If unavailable, explicitly report the missing review rather than implying it occurred.
- Resolve material findings, rerun affected checks, and obtain focused re-review where fixes invalidate earlier review.
- Report the verified revision, checks and results, review status, and any failed, skipped, or unavailable checks. Mark unmet criteria as incomplete.
- Confirm the verified revision is merged to main. Report anything left on a branch or in a worktree, and where it is.

Do not declare the result fully verified while material findings or required checks remain unresolved. Respect the repair budget and report blockers.

### Fleet conventions

- Repository rules add concrete local constraints consistent with the Fleet Orchestration Policy; they do not override its permissions, adaptive workflow, or stopping limits.
- Verify visual work visually: capture the rendered result — screenshot, frame, recording — and look at it, because a passing test says nothing about what the pixels do. Work with no visual surface runs headlessly. For 3D work, one framing is not a check: sweep several camera angles and zoom levels, since a defect the chosen view happens to hide is the normal case. For 2D interfaces and artwork, inspect relevant viewport sizes, scales, and states. For games and other interactive visual deliverables, exercise real controls and representative user flows, and inspect how the rendered result responds over time. For static scenes and assets, inspect applicable viewpoints, using orbit, pan, or zoom in a viewer when available and useful. Use headless interaction and rendering when they provide adequate evidence; use a visible session only when necessary to verify behavior. An aggregate view — a contact sheet, grid, montage, or proof sheet — answers "is there one of each" and never "is each one right", and answers the first just as confidently when the second answer is no: inspect each item at the artifact's own native resolution, and bind the review to the digest of the bytes inspected, so regenerating the artifact strands its review instead of inheriting it. Badge's 63-source contact sheet read as cohesive while ten sources were wrong, and the lesson recurred four days after it was written down, against 48px proof sheets. For visual tasks, inspect the affected user flows and the surrounding rendered result for material regressions; choose the coverage from the change's risk and acceptance criteria.
- A defect the user reports is recorded and gated, never only fixed: an entry in `docs/learning/defect-register.md` — symptom as they saw it, investigation, root cause, and how it is checked from now on — plus a check that covers the defect's whole class rather than the one instance. Unlike a lesson, the entry stays after it becomes a gate: the register is the standing list of what the gates could not see, which is where the next defect comes from.
- Gates pass before any commit that touches code; a dependency change re-runs the audit gate. The user has authorized committing, merging to main, and pushing in every repository they own, with no separate approval each time — that standing grant is what the policy's merge and push permissions resolve to. Force-pushing, rewriting history, deploying, and publishing still need the user's authorization.
- For an authorized push, inspect the remote gate through completion when available. Read job steps and runner assignment before treating a failed run as a code failure: exhausted Actions allowance can fail before any job starts. Report unavailable remote verification and use the local gate as evidence within its bounds. Resolve failures that block the requested outcome within the repair budget; report unrelated failures without silently expanding scope.
- The user archives threads, and anything sitting outside main is thrown away with them. So work counts as done only once it is merged to main. A branch, a worktree, or an uncommitted tree does not count, whatever its gates say. Merging is the last step of the work. If something cannot be merged, say so and say where the work is.
- A repo chooses its own language and toolchain — Node, Python, and Rust all run here. Each pins its version where its own tooling reads it (`.nvmrc`, `requires-python`, `rust-toolchain.toml`) and names it in Gates, so a version mismatch is not read as a code failure. Node repos baseline at 24; an older major keeps a CI job proving it.
- Runtime model calls are authorized and already paid for — this fleet has one user, with Claude Code and Codex subscriptions — so a program here may call a model at runtime, vision included.
- When a hard problem blocks progress, use `../fleet/docs/skills/hard-problem.md` to explore distinct approaches. Give each idea a newly spawned independent owner and only the context needed to learn the domain and test assumptions from first principles. Queue waves within available resources; compare evidence before combining routes. Before abandoning a whole strategy, prove it cannot meet the user's requirements under stated assumptions, and obtain independent scrutiny of that proof.
- For substantial or high-risk changes, use independent review when available. High-risk areas include persistence/migrations, security/auth, concurrency, money, supply chain, and edits that reach sibling repos; `../fleet/docs/skills/multi-cli-review.md` provides the review mechanics.
- Error messages are a product surface: check the affected class and relevant adjacent paths. Each names what happened, which input caused it, and what would satisfy it — never a bare `Validation failed`.
- When blocked, hand over the relevant artifact — screenshot, rendered page, log line, data row — with secrets and unnecessary private data removed, as soon as the blocker is named rather than after the analysis: your description of it is filtered through the misunderstanding that caused the block, so it cannot contain what you failed to notice.
- Task-run evidence lives only under ignored paths and is deleted once no active task, unresolved issue, or handoff needs it; it enters Git only when review promotes it into a repository input — a fixture, golden, snapshot, or contract. Tracked docs keep plans, authored review reports, conclusions, and provenance; raw task output stays ignored. Blob ceilings for anything promoted: over 256 KiB needs a stated reason, over 512 KiB binary or 1 MiB of anything never enters ordinary Git, and an asset store or LFS needs the user's approval.
- Keep planning documents and every authored review round in a permanent `docs/work/<id>_<theme>/` folder, with consecutive IDs from 0 independently in each repo. `plan.md` holds status; shared documentation stays in its canonical home. Allocate through the repo's common authority and follow `../fleet/docs/work-docs.md` for formats, review targets, and migration.
- Use the common word where it says the same thing as the rare one. This covers chat, docs, commit subjects and PR titles, comments, and error messages. One idea per sentence, unless another rule asks one line to carry more. Cut length, not facts: keep exact terms, numbers, and the evidence a claim rests on. It applies to sentences you write, not to text you quote or paste. Do not copy this canon's style.
- Write prose one line per paragraph (no hard wrapping).
- Keep a devlog: one short dated line per behaviour-changing session in `docs/devlog/summary.md`, newest first, and a section in `docs/devlog/detailed/` for anything a later session could trip over — what was believed and proved false, what a reviewer caught that the author missed, what number moved and from what. It is history, not status. Both shapes are in `../fleet/docs/devlog-template.md`.
- A lesson is prose only until it is a gate. It lands the session it is learned in `docs/learning/lessons.md` — read at session start — anchored to a measurement, commit, or test id, and naming the gate that will retire it: a test, a lint rule, a schema check, a fixed command. That file is a queue: an entry is deleted in the commit landing its gate, and a gate counts only once it has been made to go red by reintroducing the defect. Deleting the prose is safe only because the deletion is recoverable, so the gate carries the claim in its own header and `docs/learning/gate-proofs.md` carries the mutation, the failure it produced, and the pre-retirement commit that `git show <sha>:docs/learning/lessons-evidence.md` reads the whole evidence file back out of. A gate and the claim in its header can be wrong together and look exactly like a gate that is right, and auditing one means reaching what was believed, measured and abandoned at the time — never the sentence the gate carries about itself. An entry that can name no gate is not a lesson — fleet-wide knowledge is staged in `canon-candidates.md` for this constitution, repo-only knowledge goes to `docs/policies/local-rules.md`, and the rest is folklore and is dropped. An index that only grows is a list of things that failed to graduate: aoe2's reached 84 entries, none naming a gate. An index already holding ungated entries is emptied entry by entry as each one's area is next touched, not kept as a standing exception. Shape: `../fleet/docs/lessons-template.md`.
- A green gate proves less than it looks like. Every gate is bounded by something — a seed set, a tick window, a resolution, a fixture that ends early, an include list, a shared flag any one case can satisfy — and proves nothing past that bound, so name the bound in the gate's own header and pin every input that reproduces the defect, not just the one you thought of. Past its bound a gate does not merely miss the defect — it can measure a different phenomenon entirely and report it just as confidently: aoe2's stone-mining window opened at tick 11,000 on a fixture that resolves by conquest at 11,442, so it was reading a decided match, and a finished match and a deadlocked one are pixel-identical. A gate that cannot tell "passed" from "did not run" reports the second as the first, and a check built from the same symbol as the thing it checks proves only that the code agrees with itself. Retiring 356 lessons across 14 repos found **more than 40 whose evidence named a live, passing test that did not catch the defect** — every repo's `docs/learning/gate-proofs.md` records its own: an 800-decision rollout window hid a divergence that starts at 3,000, a Rust-side struct pin stayed green while the WGSL side it mirrors gained a field, and `replaceFootprintOwner(…, undefined)` passed all 873 tests.
- A command's exit status is a claim about the command, not about the work: a pipeline exits with its last stage's status, so `npm run x | tail` reports tail's success over any failure; `git add` fails all-or-nothing while the `commit` after it still succeeds and ships a message that lies about its contents; and a tool reporting that it applied a fix reports a no-op identically to a refusal — read the artifact it should have changed. Red deserves the same suspicion as green: a non-zero exit is equally a claim about the command, and a missing dev dependency, an unresolvable binary or a wrong working directory fails identically to a broken product — aoe2's `playtest:corpus` went red on a merge because `tsx` was gone from `node_modules`, not because the code was wrong. A blocker you inherited is the same kind of claim: retest it before repeating it, because its whole effect is to stop work. A RETURN VALUE is a claim of the same kind: a search that cannot match hands back a sentinel the next call uses without complaint, and an `indexOf` miss fed to `slice` deleted 319 lines of a tracked spec in one edit.
- Verify the instrument before trusting the measurement, because a critic is a backstop and not the first line. Confirm the flag took effect, the denominator is the population you meant, the control reproduces, and the claim you are relying on is still true rather than remembered. A whole session's conclusions were built on labels chosen with knowledge of the future, agreement quoted over a population that was 99.8% forced no-ops, a `--eval-episodes` flag silently ignored so every checkpoint was picked by a five-sample lottery, and a review lane declared unavailable from a three-week-old memory that was wrong. Each was one command away from being caught. An A/B comparison asks one more thing: that the tree HOLD STILL. Edits landing between the two arms make them differ by more than the variable under test, and the result reads as a finding — aoe2 read a boot-map regression off two arms it had edited between. A repo that ships a debugging instrument — a session replayer, a recorder and bundle differ, a capture script, a profiler, a debug probe — is asked FIRST, and the task's first probe names which of them answers the question or why none does. aoe2 skipped its engine's replay harness twice with the rule in prose (2026-06-13, 2026-09-05), the second time with a memory stating the rule loaded in the same session; what held was a hook that refuses to write or run a scratch probe without a `harness:` line naming the tool. A rule that must be remembered at the moment of writing a probe is enforced at that moment, not read at session start.

- A standing loop sources its next task by running the artifact the way its user does — the default entry point, the real configuration — never by reading code for something to improve. A repo with no runnable entry point has no standing loop.
- This harness compacts context mid-task: a compaction is a harness event, not a task boundary, and never a reason to wrap up or hand off to a fresh session.

- Before resuming interrupted work, inspect surviving worktrees, artifacts, and task status. Recover what exists and preserve unfinished work; do not assume that a worktree, transcript, or shared memory survived.

- Steering compounds: a direction that outlives the immediate task lands that same session — `../fleet/FLEET.md` if fleet-wide, else this repo's `docs/policies/local-rules.md` — and you say where it went.
- Reviewer model pins live only in `../fleet/docs/skills/multi-cli-review.md`; a model a product itself calls is pinned in the repo that calls it. Never hardcode a model ID anywhere else.
<!-- FLEET-CANON:END -->

## Gates

`npm test` · `npm run typecheck` · `npm run lint` (zero warnings) · `npm run build` — all four before every code commit; smallest relevant check while iterating. Dependency audit gate: `npm audit --audit-level=high` (full tree and `--omit=dev`).

## Session start

Read `PROGRESS.md`, `docs/architecture/architecture.md`, and `docs/policies/local-rules.md` before starting work.

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
- `PROGRESS.md` — current status and next steps; keep it current while working (original prompt at top, then implementation notes, test runs, findings, and next steps per phase).
- `docs/harness.md` — the LLM playtest → annotate → replay → improve harness (`npm run playtest:llm`, `npm run playtest:recursive`).
- `docs/learning/lessons.md` — per the fleet evidence-anchor rule; `docs/learning/defect-register.md` — every defect the user has reported, and the check that now covers its class. Read the register before touching a surface it names.
