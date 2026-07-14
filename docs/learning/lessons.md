# Lessons

Non-obvious failure modes worth preserving. Each entry starts with its evidence anchors.

## A cleared drag ghost is not harness evidence of what the player attempted

| Field | Value |
|---|---|
| Surfaced by | Live lake-crossing water setup: the Pipe tool drew an invalid preview and the worker rejected the drag, but the canvas-only harness reported only that pointer events were dispatched. |
| Reviewer findings | Three grounded inspection agents independently confirmed the duplicated water rejection and the missing post-drag observation channels. |
| Fix commit | eeff688 |
| Test added | `tests/app/tools.test.ts` > "retains an observable valid pipe preview across water and submits the drag" plus cancellation/pointer-leave cleanup; `tests/harness/visual-host.test.ts` > "surfaces retained pipe previews, installed lake cells, and queue submissions"; `tests/sim/utilities.test.ts` > lake placement/conduction/save-load contracts. |
| Behavior delta | `Tools.pointerUp()` clears the visual ghost synchronously, while the worker queues the command asynchronously. Before, the next automation observation could see neither preview semantics, installed pipe count, nor submission outcome, so "drag dispatched" was indistinguishable from success. Retain a bounded semantic action record before clearing presentation state, expose post-tick installed counts as authoritative execution evidence, and return a correlated queued/rejected submission result for every command; monotonic ids prevent an older rejection from attaching to a newer same-name drag. Cancellation must clear an active semantic preview and leaving the map must clear an unsubmitted hover preview as well as the mesh. When a client preview mirrors a sim validator, test both layers against the same edge case; here both had independently encoded the obsolete "water blocks pipes" rule. |

## world.query() returns a single-use Generator

| Field | Value |
|---|---|
| Surfaced by | Phase 2 sim bring-up: `WorldTickFailureError: state 'demand'.c must be a finite JSON number` |
| Reviewer findings | n/a — caught by determinism-friendly state validation at tick time |
| Fix commit | 1f3ef66 |
| Test added | tests/sim/growth.test.ts > "grows R, then C/I as population and unemployment rise" (exercises the counting path) |
| Behavior delta | `w.query('citizen').length` is `undefined` (generator, not array) → `0.3 × undefined = NaN` written into world state → tick failure poisons the world. Always `[...world.query(...)]` before counting or double-iterating. |

## setPointerCapture throws for synthetic pointer events

| Field | Value |
|---|---|
| Surfaced by | Phase 2 browser verification: scripted drags placed nothing; probe showed `NotFoundError: no active pointer with the given id` |
| Reviewer findings | n/a — browser automation lesson |
| Fix commit | 4bf7f8e |
| Test added | n/a — exercised by every scripted-drag browser playtest |
| Behavior delta | Synthetic `PointerEvent`s (our automated playtest input) have no active pointer id; the uncaught throw aborted the pointerdown listener before the drag started, silently disabling every build tool under automation. Capture is now best-effort try/catch. |

## Background tabs throttle rAF to zero → stale camera matrixWorld breaks picking

| Field | Value |
|---|---|
| Surfaced by | Phase 2 browser verification: picks returned cells near world (0,0) while the render (screenshot-forced frames) showed a centered map; `fps: 0` in text state was the clue |
| Reviewer findings | n/a — browser automation lesson |
| Fix commit | 4bf7f8e |
| Test added | n/a — exercised by every scripted-drag browser playtest |
| Behavior delta | `matrixWorld` only updates during render; with rAF throttled in unfocused preview tabs, raycasts used a stale camera transform and mapped screen points to wrong/out-of-grid cells. `GroundPicker.intersect` now calls `camera.updateMatrixWorld()` itself. Corollary: screenshots force frames, so "it renders fine" does not imply render-derived state is fresh. |

## Preview-tab viewport can boot at 1px wide

| Field | Value |
|---|---|
| Surfaced by | Phase 1 verification: 1-pixel-wide screenshot; drag placed a single road cell because every ray hit the same column |
| Reviewer findings | n/a — tooling lesson |
| Fix commit | n/a — operational (preview_resize to explicit dimensions before pointer tests) |
| Test added | n/a |
| Behavior delta | `window.innerWidth === 1` collapses picking to one column. Always set an explicit viewport (e.g. 1440×900) and dispatch a `resize` event before scripted pointer verification. |

## Optional parameters on load-bearing paths become silent dead code

| Field | Value |
|---|---|
| Surfaced by | Final adversarial review (critical finding): all three road handlers called `refreshRoads(sim)` without the world arg, so the in-flight-vehicle remap, edge-bucket carry-over, and congestion-mirror write never ran on live road edits |
| Reviewer findings | review workflow `final-adversarial-review`, CONFIRMED critical, reproduced live: stale edge ids teleported vehicles onto wrong streets, and shrinking the edge array poisoned the world permanently |
| Fix commit | (this commit) |
| Test added | tests/sim/traffic.test.ts > "survives massive topology destruction under in-flight vehicles (regression: stale edge ids)" |
| Behavior delta | Before: bulldozing roads with traffic in flight either silently corrupted routes/congestion attribution or threw WorldTickFailureError and halted the sim forever. After: vehicles remap by edge geometry key or despawn as disconnected trips. Design lesson: `fn(sim, w?)` with an optional world made forgetting `w` compile fine — the remap had NO other caller, so nothing failed until the exact scenario hit. Prefer required parameters (or a separate in-tick function) for behavior that must run; the replay self-check cannot catch it because the corruption replays identically. |

## Derived-state changes must be mirrored in BOTH the live mutation path and rebuildDerived

| Field | Value |
|---|---|
| Surfaced by | Final adversarial review (major): power line crossing a road — bulldozing the road left the freed cell unowned live, but `refreshUtilities` re-owned it to the line after save/load, so zoning that cell succeeded live and failed after reload |
| Reviewer findings | review workflow `final-adversarial-review`, CONFIRMED with an empirical repro (liveOccupied false vs reloadedOccupied true) |
| Fix commit | (this commit) |
| Test added | covered by the extended replay gate (tests/sim/replay.test.ts now exercises utilities/services/taxes/bulldozeRect with utilitiesEnabled) |
| Behavior delta | Save/load observably changed which cells were buildable. Rule: every special case added to a live handler (here: "line cells under roads stay road-owned") needs its inverse handled on the OTHER side of the ownership transition (road removed → line re-owns) AND identical logic in the rebuild path; the replay gate only catches it if its scenario exercises those commands — keep the gate's command coverage in sync with the shipping feature set. |

## "Coexists over an existing owner" needs re-ownership in EVERY demolition path, not just the one you were thinking about

| Field | Value |
|---|---|
| Surfaced by | Adversarial review of "power lines coexist over buildings" (the reported feature: lines route through buildings). A line owns a cell only when otherwise free; over a road or building the existing owner keeps `occupiedCells`. This was mirrored in the live handler, `refreshUtilities`, AND `removeRoadCells` (road bulldoze re-owns the line) — but NOT the building-demolition pass of `bulldozeRect` |
| Reviewer findings | review agent CONFIRMED with a live repro: bulldoze PART of a multi-cell building (rect covers one footprint cell) → the whole building is destroyed and all its footprint cells freed, but a coexisting line on a footprint cell OUTSIDE the rect was never seen by `bulldozeUtilities`, so it survived. `liveOccupied=false` (building deleted, line never owned it) vs `reloadOccupied=true` (`refreshUtilities` re-owns the freed cell to the surviving line). Same zone command accepted live, rejected after reload. |
| Fix commit | (this commit) |
| Test added | tests/sim/power-lines.test.ts > "bulldozing part of a multi-cell building re-owns a coexisting line (save/load parity)" |
| Behavior delta | When you add "X coexists over an existing owner Y," audit EVERY path that removes a Y — road removal AND building removal (and service/plant removal if reachable) — each must re-own or destroy the coexisting X identically to what the rebuild (`refreshUtilities`) does. It is easy to fix the one demolition path in front of you (roads) and miss the others (buildings). The replay `selfCheck` is structurally blind (`occupiedCells` is a derived cache, never serialized; the orphan entity replays identically), and a single-cell bulldoze test dodges it — only a ≥2-cell owner whose coexisting cell lies OUTSIDE the demolition rect triggers the orphan. |

## preview_screenshot can hang while the page is healthy — capture the canvas yourself

| Field | Value |
|---|---|
| Surfaced by | Bridges browser verification (2026-07-02): preview_screenshot timed out (30 s) on every attempt — fresh server, fresh tab, small viewport — while preview_eval kept working and the sim kept ticking |
| Reviewer findings | n/a — tooling lesson |
| Fix commit | n/a — operational workaround |
| Test added | n/a |
| Behavior delta | The screenshot transport can wedge independently of the page. Workaround that works because `preserveDrawingBuffer: true` is set: in preview_eval, force a frame (`s.controls.update(); s.camera.updateMatrixWorld(); s.renderer.render(s.scene, s.camera)`), stash `renderer.domElement.toDataURL('image/jpeg', 0.7)` on `window.__shot`, then return it in ~50k-char slices — oversized eval results are auto-saved to tool-result files; pad short tails (e.g. `+ '#'.repeat(20000)`) so every slice lands in a file instead of context. Concatenate the files, `tr -d '"\n#'`, strip the data-URL prefix, `base64 -d` → JPEG. Also remember rAF is throttled to zero in background tabs, so render_game_to_text camera-derived state and tweens freeze — set camera/controls directly instead of flyTo before capturing. |

## The utility abandonment grace was silently bypassed by the score path

| Field | Value |
|---|---|
| Surfaced by | Playtest round 8: following the onboarding tips (connect highway → zone → wait for buildings) mass-abandoned all 63 buildings to population 0 within ~9s of game time, far inside the "60s utility grace" that round 1 added to prevent exactly this |
| Reviewer findings | n/a — surfaced by play, root-caused by reading the level system |
| Fix commit | (this commit) |
| Test added | tests/sim/utilities.test.ts > "keeps the full utility grace where pollution depresses land value (onboarding)" |
| Behavior delta | The desirability `score` includes a `+10 if (powered && watered)` term. A building with missing utilities loses that +10, and if land value is even mildly depressed (pollution from early industry or a coal plant — coal emits 30, dropping land value 30→18 within ~6 cells), the raw score falls below `ABANDON_SCORE` (12). Abandonment then fired on the FAST score path (`ABANDON_EVALS`=10 ≈ 8s) instead of the intended `UTILITY_ABANDON_EVALS`=75 (≈60s) utility grace — so the grace was dead whenever land value was below 24, which is exactly the onboarding case (fresh district, no power yet, some industry nearby). Fix: gate the score path on `!utilitiesBad`, so a building with missing power/water can only abandon on the long utility grace; the score path resumes once utilities connect (and the restored +10 bonus lifts a merely-depressed score back over the line). Design lesson: when a single scalar (`score`) folds in an orthogonal concern (utility connection) that ALSO has its own dedicated timer/path, the two interact — the missing-utility penalty laundered into a "bad location" verdict. Keep the fast path measuring only what it names (location desirability); let the concern with its own grace own its own timeline. The pre-existing grace test never caught it because it used a pollution-free all-land R district (land value 30 → score 15 ≥ 12), so the score path never engaged.

## A "consecutive" streak counter must reset on the healthy branch, not only on abandon/recover

| Field | Value |
|---|---|
| Surfaced by | Playtest round 9, from the round-8 adversarial review: `badUtilityEvals` (the utility-abandon streak) was reset on abandon, recover, and growth — but NOT when a still-alive building returned to healthy |
| Reviewer findings | round-8 review flagged it as pre-existing (verified byte-identical on pre/post round-8 code); confirmed and fixed in round 9 |
| Fix commit | (this commit) |
| Test added | tests/sim/utilities.test.ts > "regaining utilities resets the utility-abandon streak (no premature abandon on flicker)" — RED (25 abandoned) → GREEN |
| Behavior delta | A building that accumulated ~67 of the 75-eval utility grace while unpowered, then regained power for even one eval (healthy), then lost it again, abandoned within a few evals instead of getting a fresh 60s grace — because the healthy branch reset `upEvals`/`badEvals` but never `badUtilityEvals`. Reachable via brownout flicker on an undersized plant (the ascending-id-prefix brownout flips buildings powered/unpowered as capacity fluctuates). The doc already said the streak was "consecutive", but the code only enforced that for the score path. Rule: a counter documented as "N CONSECUTIVE evaluations of X" must be cleared on EVERY not-X branch — including the healthy fall-through — not just the terminal abandon/recover transitions; a reset that lives only on the transitions silently accumulates across brief recoveries. Found by a scale playtest that otherwise confirmed robustness (solvent economy, 0 disconnected trips, self-relieving rush-hour congestion, pollution appropriately mild) — the bug came from the review, not new play. |

## The client mirror tick lags the worker tick — anchor harness annotations to the worker

| Field | Value |
|---|---|
| Surfaced by | Building the playtest harness (docs/harness.md): `__harness.annotate` recorded a finding "at the current tick", but `render_game_to_text().tick` (read on the client) was ~40 ticks behind the worker's `world.tick`, so a naive `inspectAt(clientTick)` landed BEFORE the annotated command executed (showed roads=10 instead of the placed road) |
| Reviewer findings | n/a — surfaced during browser verification of the harness |
| Fix commit | (harness commit) |
| Test added | tests/harness/replay-harness.test.ts pins the record→annotate→replay→inspect pipeline headlessly (no client/worker skew there) |
| Behavior delta | The sim runs in a Web Worker; the client's `tick` is whatever the last `frame` message carried, which lags the worker by the async round-trip plus the live game-loop advance. So a tick the client reads is NOT the tick the worker is on. Annotations must anchor to the WORKER's `world.tick` (the marker's tick, echoed back via the `annotated` message and readable from `findings()`), and replay/inspect must use `finding.tick`, never a client-side tick. General rule for worker-hosted sims: any "at the current tick" operation belongs in the worker, and the tick it used must be reported back — the client's view of "now" is always stale. |

## Never gate on a piped test run — the pipe eats the exit code

| Field | Value |
|---|---|
| Surfaced by | Playtest round 3: `npx vitest run 2>&1 | grep ... && git commit && git push` pushed while one (flaky, load-induced) test was red — grep's exit 0 masked vitest's failure |
| Reviewer findings | n/a — process lesson |
| Fix commit | n/a — process (redirect to a file, check `$?`, then grep the file) |
| Test added | n/a — process lesson |
| Behavior delta | A red suite reached the remote. Pattern now: `npx vitest run > out 2>&1; echo exit=$?` and only proceed on 0. |

## A headless playtest tab stops rAF — a "screenshot" must pump its own presentation frame

| Field | Value |
|---|---|
| Surfaced by | Vision playtest: after batch-`advance()`ing a district that leveled 46 buildings, every "▲ Level N" celebration sprite was frozen on screen; `levelUpFx.group.children.length` stayed 46 across tens of seconds of real time, and `scene.fps` read 0 |
| Reviewer findings | n/a — surfaced during a vision-harness playtest |
| Fix commit | (this commit) |
| Test added | n/a — WebGL isn't unit-testable in vitest; verified live (spawn a sprite timestamped 5s in the past → `player.screenshot()` → `group.children` 1→0, proving the capture ran the frame callbacks) |
| Behavior delta | The render loop is `renderer.setAnimationLoop(renderFrame)` (rAF). A headless/automation browser tab isn't painting, so rAF is throttled to a full stop — `renderFrame` never runs, so the `onFrame` callbacks (view sync, `vehiclesView.updateFrame`, `levelUpFx.updateFrame`) never fire. `scene.screenshot()` forced a bare `renderer.render()` that BYPASSED those callbacks, so every capture was a stale frame: vehicles pinned at their last interpolated position, level-up labels accumulating forever (they fade on a wall-clock timer the callback advances), camera `flyTo` tweens stuck. The 46 "stuck labels" read as a game bug but were a capture artifact. Fix: `screenshot()` now pumps a full presentation frame (`presentFrame`: callbacks + flight + controls + render) before reading the buffer, so a capture reflects live animated state. General rule for driving a rendered app headless: never assume the rAF loop is running — anything time-based (interpolation, particle/FX lifetimes, tweens) is frozen unless the capture path pumps the frame itself. Capturing then IS the frame tick: animation advances by real wall-clock between successive screenshots, so two shots taken microseconds apart look identical even after a big `advance()`. |

## A "current problems" count restricted to live entities goes blind exactly when everything dies

| Field | Value |
|---|---|
| Surfaced by | Vision playtest: a city with a plant + pump placed but a broken/undersized utility network mass-abandoned; the advisor dropped the ⚡/💧 tips and instead showed "🏛 Grow up — add services for land value" — the worst possible guidance for a dark, dying city |
| Reviewer findings | n/a — surfaced during a vision-harness playtest |
| Fix commit | (this commit) |
| Test added | tests/app/tips.test.ts > "utilityTipFacts count buildings that need a utility even once abandoned" (3 cases incl. the mass-abandoned regression) — RED (helper absent) → GREEN |
| Behavior delta | `computeAdvisories` derived `unpowered`/`unwatered` from `live = buildings.filter(!abandoned)`. When a city goes dark and EVERY building abandons, `live` is empty, so both counts read 0 — which (a) hides the ⚡/💧 tips (gated on `unpowered/unwatered > 0`) precisely when the player needs them, and (b) makes `utilitiesSettled` falsely true, surfacing the services/level-up tip in a fully-abandoned city. The flood-fill keeps `powered`/`watered` accurate on abandoned buildings (they're in `allBuildings` for supply, and `applyFlags` patches every entity), so the fix is to count over ALL buildings, not just live ones (extracted to a pure `utilityTipFacts` helper). Rule: a metric that means "how many things need fixing right now" must include the things that already broke — filtering to the healthy/live subset makes the alarm go silent at the moment of total failure. Pollution-abandoned buildings are unaffected (they stay powered+watered, so they don't count as needing a utility). |

## A "coexists over an existing owner" overlay is a bug magnet — make it own nothing instead

| Field | Value |
|---|---|
| Surfaced by | User request "the power line should not occupy building space … so thin it should take any space." Power lines had been designed to own `occupiedCells` "only when the cell is otherwise free," which blocked a building from growing on the cell (and `placePowerLine` also `dezoneCells`'d its run). Fixing it also let me delete the coexistence machinery three separate prior lessons/fixes were about. |
| Reviewer findings | The earlier "coexist over an existing owner" model generated a recurring bug class: [line/road occupancy divergence across save/load], [re-ownership needed in EVERY demolition path], and the road-crossing re-own — each a fix for the *same* root shape (a derived cache, `occupiedCells`, holding an entity that another owner also claims). |
| Fix commit | (this commit) |
| Test added | tests/sim/power-lines.test.ts "utilities never occupy building space" (building grows on a line cell; line claims no occupiedCells; no dezone; plant sits on a line cell) + tests/rendering/line-geometry.test.ts |
| Behavior delta | Making the line a **pure overlay** (conducts via its own `powerLineCells` map, never writes `occupiedCells`, never dezones — exactly how pipes already worked) deleted: the `placeableRoadCells` line-exception, the re-own blocks in `removeRoadCells` / `bulldozeRect` / `placeRoad`, and the conditional release in `bulldozeUtilities`. One catch when an overlay stops owning cells: any *validator* that gated on "is anything here" via the shared map must add the overlay's own map explicitly — the `bulldozeRect` validator checked `occupiedCells` (which used to include free-cell lines) and would have silently refused to bulldoze a lone line until `powerLineCells` was added back to it (pinned by "bulldozes a lone power line on bare ground"). Rule: if two things can occupy the same cell, don't have one "own it when free" in a shared derived cache — give it a private map and let it own nothing. Ownership transfer across every add/remove/rebuild path is the expensive, bug-prone alternative; no ownership means no transfer to get wrong, and the replay `selfCheck` is structurally blind to `occupiedCells` divergence anyway (it's derived, never serialized). |

## A "green migration" claim is only as good as which gates actually ran

| Field | Value |
|---|---|
| Surfaced by | loop-ops shift-machinery adversarial review (2026-07-09) → full-suite re-run during candidateClass work |
| Reviewer findings | in-process reviewer session; failure reproduced at HEAD~1 (pre-existing on main, not the triggering diff) |
| Fix commit | (this commit) |
| Test added | tests/harness/replay-harness.test.ts > "dogfoods the recursive loop with verified findings and before/after comparison" (pre-existing test, now the pin) |
| Behavior delta | Before: engine 2.0.0's strict-by-default recording silently refused the dogfood's `verified` finding (evidence was step/metric/text only — no replayable ref, no method), so `findingsFromMarkers` returned nothing and the dogfood test failed on main while the repo was believed migrated-green. After: `CityImprovementFindingInput` carries `verificationMethod`, the dogfood finding anchors a `tick` ref + `verificationMethod: 'replay'`, and the strict engine accepts it because it is now actually honest. |

The engine 2.0.0 fleet validation ran this repo's suite once and recorded "green" — but the strict-default flip bites at RECORD time inside a host `annotate` callback, and the belief persisted unchecked while other repos' evidence accumulated. Two rules: (1) a migration claim needs the full gate list named next to it, not "green"; (2) when an engine major flips validation defaults, grep the consumers for every construction site of the newly-validated payload (here: `verificationStatus: 'verified'`) instead of trusting suite output alone — a swallowed throw inside a callback turns a hard error into a silent no-op.

## Immediate entity-id recycling must be handled at both sides of a render diff

| Field | Value |
|---|---|
| Surfaced by | Adversarial review of special-building replacement: demolition can release a growable/service id and civ-engine may reuse it before the tick diff is emitted. |
| Reviewer findings | Generic `entities.destroyed` removals can erase a same-tick replacement upsert. After switching to component-specific removals, a recycled structure id can instead arrive as upsert-only, so the client must clear that id's previous footprint before claiming its new one. |
| Fix commit | (this commit) |
| Test added | `tests/worker/diff-projection.test.ts` pins destroyed + component-upsert-only projection; `tests/app/occupancy.test.ts` pins clearing the recycled id's old footprint before claiming the new footprint. |
| Behavior delta | Worker removal streams now follow the `building`/`structure` component diffs, and the client reconciles old and new footprints for every upsert. Rule: component-specific projection and cache reconciliation are a pair—fixing only one side converts a disappearing replacement into stale invisible occupancy. |

## A utility reach halo must mirror the conduction closure, not supplied status

| Field | Value |
|---|---|
| Surfaced by | Gameplay/UI adversarial review after increasing `UTILITY_BRIDGE_RADIUS` from 3 to 5. |
| Reviewer findings | The overlay expanded from infrastructure plus currently supplied growables only, but the sim lets every attached non-abandoned growable and service conduct even during a brownout. Service messages also did not trigger overlay recomputation. |
| Fix commit | (this commit) |
| Test added | `tests/app/network-overlay-state.test.ts` pins brownout conduction, service bridging, abandoned/disconnected behavior, source-less conductor planning reach, utility-specific coloring, and refresh dependencies for building/structure/network messages. |
| Behavior delta | The client now repeats the same monotone attachment closure as the sim and refreshes whenever any closure input changes. Source-less lines/pipes still show planning reach, while nearby buildings remain red because allocation has no source capacity. Rule: a topology visualization must derive from topology; allocation flags are a separate layer and cannot stand in for graph membership. |

## A shared heightfield also needs shared triangle and lifecycle contracts

| Field | Value |
|---|---|
| Surfaced by | Adversarial rendering/determinism review of the rolling-terrain elevation diff. |
| Reviewer findings | One whole-ray bisection could converge on a hidden far crossing after a foreground ridge; the first sampling fix could still skip a grazing triangle or explode in work near the horizon; finite-map clipping then broke the active-drag off-map clamp fallback. Inset quads sampled the right corner heights but bridged the terrain cell's opposite diagonal, and the automation player captured the flat boot surface before the worker `ready` message. |
| Fix commit | (this commit) |
| Test added | `tests/rendering/picking.test.ts` pins first-visible shallow ridges, a narrow grazing apex before distant ground, bounded height sampling, and off-map `pick` versus `pickClamped`; `tests/rendering/surface-geometry.test.ts` pins seam-split patches; `tests/harness/player.test.ts` pins post-ready surface refresh. |
| Behavior delta | Picking now clips to the finite map/height slab, traverses cells front-to-back with bounded grid DDA, and intersects the exact two visible triangles per cell; this avoids both skipped grazing ridges and near-horizontal sampling explosions. `pickClamped` alone adds a constant-work terrain-edge fallback so pointer drags remain usable outside the finite map. Every inset road/zone/shore rectangle is likewise clipped into triangles that stay on one underlying terrain plane, and harness picks refresh from `CityScene` at call time. Rule: once ground is piecewise-linear rather than one plane, merely sharing `heightAt()` is insufficient — consumers must also share its triangulation, nearest-hit semantics, finite bounds, off-map interaction contract, and late-initialization lifecycle. |

## Backdrop-filter can corrupt an otherwise-correct headless screenshot

| Field | Value |
|---|---|
| Surfaced by | Visual evidence review: the WebGL scene was correct, but Chromium's full-page capture replaced frosted HUD regions with opaque black rectangles. |
| Reviewer findings | The canvas-only render and a separate overview were healthy; corruption aligned with DOM elements using `backdrop-filter`, not terrain geometry. |
| Fix commit | n/a — evidence-driver workaround, not shipped game behavior. |
| Test added | Headless `output/playwright/terrain-elevation/playtest-elevation.mjs` disables backdrop filters only in the evidence page, records page/console errors, then captures `final-road-on-relief.png`; the clean image was inspected at original resolution. |
| Behavior delta | Browser evidence now injects `* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }` before full-page capture. Rule: when screenshot artifacts align exactly with composited CSS chrome, isolate the capture compositor before changing the rendered product; keep the workaround in the evidence driver so production visuals remain untouched. |

## A DEV guard only tree-shakes recorder code when all recorder state stays inside it

| Field | Value |
|---|---|
| Surfaced by | Comparing production worker artifacts while making localhost recording opt-in: an otherwise harmless unconditional `recorder = undefined` in the world-swap path grew the minified worker from 111.16 kB to 162.95 kB. |
| Reviewer findings | n/a — surfaced by before/after production bundle inspection. |
| Fix commit | (this commit) |
| Test added | `tests/harness/recording-mode.test.ts` pins explicit `record=1`; `tests/harness/llm-loop-script.test.ts` pins the unattended runner's opt-in. `npm run build` now rejects recorder symbols or a worker above the 120,000-byte budget and reports the current 111,167-byte artifact. |
| Behavior delta | Recorder construction, connection, and assignment now remain inside the `import.meta.env.DEV` branch; production dead-code elimination removes the recorder implementation, while normal dev workers select the lean path by name. Rule: a compile-time environment guard is not enough if mutable state associated with the guarded feature is also touched from unconditional code—inspect the emitted artifact, not just the source branch. |

## A green determinism result is vacuous when it checked no segments

| Field | Value |
|---|---|
| Surfaced by | Adversarial review of the unattended visual-loop gate: an idle recorder returned `selfCheck.ok: true` with `checkedSegments: 0`. |
| Reviewer findings | The runner treated `ok` alone as proof, so a run that recorded no command boundary could publish a false-green determinism result. Normal-mode recorder requests also remained pending forever because no worker recorder existed to answer them. |
| Fix commit | (this commit) |
| Test added | `tests/harness/llm-loop-script.test.ts` requires both `selfCheck.ok === true` and `checkedSegments > 0`; `tests/harness/recording-mode.test.ts` pins immediate rejection with the `?record=1` instruction outside recording mode. Live checks covered an idle zero-segment rejection and a three-segment recorded pass. |
| Behavior delta | Unattended verification now fails closed unless it replayed at least one real segment, and disabled recorder APIs reject instead of leaking unresolved promises. Rule: always pair a verification status with the amount of evidence actually checked. |

## A browser performance fixture must share the boot world's seed

| Field | Value |
|---|---|
| Surfaced by | Determinism review of the first render profile: its save was generated with seed 3 while the browser's renderer booted terrain and tree state with seed 12345. |
| Reviewer findings | Building counts could still reach the expected values, masking that the loaded sim and already-created visual world described different terrain. That made the first before/after scene identity claim too weak. |
| Fix commit | (this commit) |
| Test added | `tests/performance/render-benchmark.test.ts` pins the generated fixture's SHA-256, seed 12345, and exact post-load tick/building/vehicle state; the benchmark driver rejects any other fixture seed before launching Chromium. |
| Behavior delta | The committed render profile now compares identical seed-aligned terrain, water, trees, simulation state, viewport, and binaries. Rule: for save-driven visual benchmarks, state counts are not enough—pin every world-construction input that survives outside the loaded snapshot. |

## Visual bathymetry must read raw elevation before the land-surface projection

| Field | Value |
|---|---|
| Surfaced by | Code-path review for depth-colored water: the shared `TerrainSurface` deliberately maps every below-sea sample to the coast datum because roads, bridges, picking, and overlays need a flat water contract. |
| Reviewer findings | Reading `TerrainSurface.cellHeight()` would make every water cell depth zero; keeping a blue material base while enabling vertex colors would also multiply the ramp and darken it twice. The raw ready payload already contains the correct seeded elevation and sea level. |
| Fix commit | (this commit) |
| Test added | `tests/rendering/water-depth.test.ts` pins raw depth normalization, coast-aware corner smoothing, and the exact friendly ramp; `tests/rendering/terrain-mesh.test.ts` pins flat y, deterministic color buffers, mask authority, vertex-color material configuration, and one water mesh. |
| Behavior delta | `buildTerrainMesh` derives bathymetry directly from `seaLevel - elevation`, writes it as vertex color into the existing white/default-base water material, and leaves every geometry/gameplay surface flat. Rule: when a shared presentation projection intentionally discards source information for one contract, semantic rendering that needs that information must consume the raw immutable payload—not reverse-engineer the projection. |

## Water motion should animate lighting before it animates the mechanical plane

| Field | Value |
|---|---|
| Surfaced by | Boundary and visual review of wind-driven surface waves after depth-colored water landed. |
| Reviewer findings | GPU vertex displacement would make visible water diverge from flat CPU picking and could expose fixed shoreline skirts at troughs; a separate wall clock inside the material would also split rAF and screenshot timing. |
| Fix commit | (this commit) |
| Test added | `tests/rendering/water-wave-material.test.ts` pins the two-band wind field, bounded and seamless phase, analytic slopes, normal-only standard-material injection, flat-normal restoration before shadow lookup, live uniform reuse across context recompilation, and clear failure when Three.js removes a shader hook; `tests/rendering/scene-water-waves.test.ts` pins CityScene material discovery plus shared-clock advancement; terrain tests keep flat y, bathymetry colors, one mesh, received shadows, and no water shadow casting. |
| Behavior delta | `WaterWaveMaterial` moves only analytic lighting normals, restores the flat normal before Three.js applies receiver shadow bias, and lets `CityScene` own its wrapped presentation time. The water visibly ripples even while gameplay is paused without changing geometry buffers, shadow edges, picking, saves, sim state, draw count, or the cached caster shadow map. Rule: for decorative environmental motion over a mechanically fixed surface, start with a renderer-time normal field; add geometry only when collision/picking and boundary seams are explicitly updated too. |
