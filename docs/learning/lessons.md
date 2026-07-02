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
