# Lessons

Non-obvious failure modes worth preserving. Each entry starts with its evidence anchors.

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
