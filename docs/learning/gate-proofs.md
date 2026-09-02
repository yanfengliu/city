# Gate proofs

Every lesson this repo used to keep as prose now lives in a machine, and this file is the record that each machine was actually made to go red by reintroducing the defect it claims to prevent.

Method for each entry: apply the smallest edit to product code (never to the test) that brings the defect back, run the gate, confirm it fails and that the failure names the defect, revert with `git checkout --`, confirm green. A gate that could not be made to go red is not recorded here as a gate.

Baseline at the time of these proofs: `npm test` 866 passed / 128 files, `npm run lint` exit 0, `npm run typecheck` exit 0, `npm run build` exit 0 (worker 162,626 / 166,000 bytes). No test file used as a proof surface was red at baseline.

Four gates named a real, existing, passing test and did **not** cover the lesson — the defect was reintroduced and the whole suite stayed green. Those are marked **was hollow**; finding them was the point.

---

## A cleared drag ghost is not harness evidence of what the player attempted

- **Gate:** `tests/app/tools.test.ts` :: "retains an observable valid pipe preview across water and submits the drag" — run by `npm test`
- **Mutation:** `src/app/tools.ts` `pointerUp` — set `retainedPipePreview = null` instead of recording the semantic preview, i.e. clear the record along with the ghost
- **Red:** `expected null to deeply equal { Object (active, submitted, ...) }`, plus "keeps power lines blocked over water and explains an all-existing pipe run" — `expected null to match object { submitted: true, …(3) }`
- **Green after revert:** yes

## world.query() returns a single-use Generator

- **Gate:** `tests/sim/growth.test.ts` (the engine's tick-time state validation) and `tests/sim/source-contracts.test.ts` :: "never treats a query() generator as an array" — run by `npm test`
- **Mutation:** `src/sim/demand.ts:40` — `[...w.query('citizen')].length` → `w.query('citizen').length`
- **Red:** growth — `WorldTickFailureError: state 'demand'.c must be a finite JSON number` (5 of 6 tests); source contract — `"src/sim/demand.ts:40: const citizens = w.query('citizen').length;"`
- **Green after revert:** yes
- **Note:** the growth gate covers only call sites whose count feeds validated world state. The source contract was added so the whole class is covered wherever `.query()` is used as an array.

## setPointerCapture throws for synthetic pointer events

- **Gate:** `tests/app/input.test.ts` :: "starts the drag even when capture throws for a synthetic pointer" — run by `npm test`. **New gate — nothing covered this.** Removing the try/catch passed all 21 tests in `tests/app/input.test.ts` + `tests/app/tools.test.ts`.
- **Mutation:** `src/app/input.ts` — replace the `try { element.setPointerCapture(...) } catch {}` with a bare call
- **Red:** `expected [Function] to not throw an error but 'Error: NotFoundError: no active pointer…' was thrown`
- **Green after revert:** yes

## Background tabs throttle rAF to zero → stale camera matrixWorld breaks picking

- **Gate:** `tests/rendering/picking.test.ts` :: "refreshes the camera itself, because a throttled rAF leaves matrixWorld stale" — run by `npm test`. **New gate — nothing covered this.** Deleting the refresh passed all 19 tests across picking, instance-picking and input.
- **Mutation:** `src/rendering/picking.ts` `pointerRay` — delete `this.camera.updateMatrixWorld();`
- **Red:** `the pick used a stale camera transform — screen-to-world must call updateMatrixWorld() itself rather than assume the render loop ran: expected { x: 1, y: 1 } to deeply equal { x: 6, y: 6 }`
- **Green after revert:** yes
- **Note:** the fixture had to pan the camera WITHOUT calling `lookAt`, because `Object3D.lookAt` refreshes `matrixWorld` as a side effect. A first version of this test that re-aimed the camera passed with the defect live.

## Preview-tab viewport can boot at 1px wide

- **Gate:** `tests/config/browser-driver-contracts.test.ts` :: "gives every browser page an explicit viewport, never the tab default" — run by `npm test`. **New gate.**
- **Mutation:** `scripts/visual-sweep.mjs` — `browser.newContext({ viewport: VIEWPORT })` → `browser.newContext()`
- **Red:** `expected [ 'scripts/visual-sweep.mjs: newPage(()', 'scripts/visual-sweep.mjs: newPage(()', 'scripts/visual-sweep.mjs: newContext(()' ] to deeply equal []`
- **Green after revert:** yes

## Optional parameters on load-bearing paths become silent dead code

- **Gate:** `tests/sim/traffic.test.ts` :: "keeps in-flight cars on the same road when a rebuild renumbers edges" and `tests/sim/source-contracts.test.ts` :: "passes the world to refreshRoads from every command handler" — run by `npm test`
- **Was hollow:** the anchored test, "survives massive topology destruction under in-flight vehicles (regression: stale edge ids)", passed with `refreshRoads(sim, w)` → `refreshRoads(sim)` in the `bulldozeRect` handler. Its per-vehicle loop is **vacuous**: that rect destroys the buildings too, so every car is culled and the loop iterates over nothing. Its remaining assertions ("no tick failure", "the edge id is in range") both hold with a stale id, because a stale id still names *some* edge.
- **Mutation:** `src/sim/road/commands.ts:172` (`placeRoad` handler) — `refreshRoads(sim, w)` → `refreshRoads(sim)`
- **Red:** `vehicle 202 must still be on the road it was on: expected [ '5>7>6>2', '5217>5224>5218>7', …(1) ] to deeply equal [ '5209>5217>5210>8', …(2) ]` — the car teleported onto the newly placed stub. Source contract: `expected [ 'placeRoad: refreshRoads(sim)' ] to deeply equal []`; the same for `bulldozeRect` and `bulldozeRoad`.
- **Green after revert:** yes

## Derived-state changes must be mirrored in BOTH the live mutation path and rebuildDerived

- **Gate:** `tests/sim/derived-state-parity.test.ts` :: "lands on identical caches whether played forwards or rebuilt from the snapshot" — run by `npm test`. **New gate.** The anchored gate (`tests/sim/replay.test.ts`) is structurally blind here: these caches are derived and never serialized, so a corrupted one replays identically to a clean one — the evidence entry said so itself.
- **Mutation 1:** `src/sim/utilities.ts` `bulldozeUtilities` — drop `sim.occupiedCells.delete(i)` from the `waterPump` branch (live path frees nothing; the rebuild does)
- **Red:** `occupiedCells differs between the live path and rebuildDerived …: expected [ … ] to deeply equal [ [ 336, 191 ], … ]`
- **Mutation 2:** `src/sim/road/commands.ts` `removeRoadCells` — re-own a freed road cell to a crossing power line, live path only (the pre-2026 coexistence model)
- **Red:** same assertion, one extra `occupiedCells` entry live
- **Green after revert:** yes

## The utility abandonment grace was silently bypassed by the score path

- **Gate:** `tests/sim/utilities.test.ts` :: "keeps the full utility grace where pollution depresses land value (onboarding)" — run by `npm test`
- **Was hollow:** the test ran `LEVEL_INTERVAL * 25` — 25 evaluations — against an `ABANDON_EVALS` that had since grown from 10 to 60. The fast score path could not fire in that window even with the guard deleted, so removing `!utilitiesBad` left all 11 tests in the file green. Measured at the end of the original window: 25 buildings, all unpowered, 5 already under `ABANDON_SCORE` (min 6.33), max `badEvals` 21.
- **Fix to the gate:** run 200 evaluations (asserted `> ABANDON_EVALS` and `< UTILITY_ABANDON_EVALS`), then require at least one home to be unpowered, under `ABANDON_SCORE`, and holding `badEvals >= ABANDON_EVALS` — so the fast path is demonstrably wound up and held back by the guard alone.
- **Mutation:** `src/sim/buildings.ts` — `(scoreBad && !utilitiesBad && …)` → `(scoreBad && …)`
- **Red:** `homes abandoned inside the utility grace — the missing-utility score penalty tripped the fast score path…: expected 5 to be +0`
- **Green after revert:** yes

## A "consecutive" streak counter must reset on the healthy branch, not only on abandon/recover

- **Gate:** `tests/sim/utilities.test.ts` :: "regaining utilities resets the utility-abandon streak (no premature abandon on flicker)" — run by `npm test`
- **Mutation:** `src/sim/buildings.ts` `levelSystem` — delete the healthy fall-through block that clears `badUtilityEvals`
- **Red:** `expected 25 to be +0` (25 buildings abandoned) — the signature recorded when the defect was first found
- **Green after revert:** yes

## The client mirror tick lags the worker tick — anchor harness annotations to the worker

- **Gate:** `tests/harness/replay-harness.test.ts` :: "stamps the marker with the worker tick and echoes it back" / "quotes the tick the worker reported, never the lagging client mirror" — run by `npm test`. **New gate — nothing covered this.** Anchoring the finding to the client mirror tick passed all 877 tests.
- **Mutation 1:** `src/app/game.ts` `case 'annotated'` — `message.tick` → `this.tick`
- **Red:** `expected '…this.harnessFindin…' to contain 'message.tick'`
- **Mutation 2:** `src/worker/sim.worker.ts` `case 'annotate'` — `const tick = world.tick` → a client-supplied tick
- **Red:** `expected '…' to contain 'const tick = world.tick;'`
- **Green after revert:** yes
- **Note:** this is a source contract by necessity — the headless pipeline has no client/worker skew to reproduce in-process, which is why the anchored end-to-end test could never have caught it.

## Never gate on a piped test run — the pipe eats the exit code

- **Gate:** `tests/config/gate-invocation.test.ts` :: "never pipes a gate command, because the pipe reports the wrong exit code" — run by `npm test`. **New gate.** Scans the npm scripts, `.github/workflows/`, and `.githooks/`.
- **Mutation 1:** `.github/workflows/ci.yml` — `run: npm test` → `run: npm test | tee test-output.txt`
- **Red:** `expected [ "workflows/ci.yml: run: npm test | tee test-output.txt" ] to deeply equal []`
- **Mutation 2:** `package.json` — `"test": "vitest run"` → `"test": "vitest run | tee out.txt"`
- **Red:** `expected [ "package.json script \"test\": vitest run | tee out.txt" ] to deeply equal []`
- **Green after revert:** yes
- **Note:** the companion test caught a bug in the detector itself — the first `|`-not-`||` regex matched the second bar of `||`. It is now a lookbehind, and the negative case is pinned.

## A headless playtest tab stops rAF — a "screenshot" must pump its own presentation frame

- **Gate:** `tests/rendering/scene-after-frame.test.ts` :: "pumps a presentation frame before reading the buffer, because rAF is stopped" — run by `npm test`. **New gate — nothing covered this.** Removing the pump passed all 297 tests in `tests/rendering/`.
- **Mutation:** `src/rendering/scene.ts` `screenshot()` — delete `this.presentFrame(performance.now());`
- **Red:** `screenshot() must run the frame callbacks, not just render: expected "vi.fn()" to be called once, but got 0 times`
- **Green after revert:** yes

## A "current problems" count restricted to live entities goes blind exactly when everything dies

- **Gate:** `tests/app/tips.test.ts` :: "is called over every building, not just the live ones" — run by `npm test`
- **Was hollow:** the anchored test exercises `utilityTipFacts` in isolation, and the helper counts whatever it is handed — it is correct with the defect live. The defect was at the call site. `utilityTipFacts(all)` → `utilityTipFacts(live)` in `src/app/game.ts` passed all 102 tests under `tests/app/`.
- **Mutation:** `src/app/game.ts` `computeAdvisories` — `utilityTipFacts(all)` → `utilityTipFacts(live)`
- **Red:** `utilityTipFacts is called with "live", which is not bound to the unfiltered building list — a utility-fault count taken over live buildings only reads zero in a fully abandoned city, which is when it matters most`
- **Green after revert:** yes

## A "coexists over an existing owner" overlay is a bug magnet — make it own nothing instead

- **Gate:** `tests/sim/power-lines.test.ts` :: describe "utilities never occupy building space" — run by `npm test`
- **Mutation:** `src/sim/utilities.ts` `placePowerLine` handler — add back `if (!sim.occupiedCells.has(i)) sim.occupiedCells.set(i, entity);`
- **Red:** 4 tests, including "a power line claims no occupiedCells even on bare land" (`expected true to be false`) and "a building grows on a zoned cell that carries a power line" (`expected null not to be null`)
- **Green after revert:** yes

## A "green migration" claim is only as good as which gates actually ran

- **Gate:** `tests/harness/replay-harness.test.ts` :: "dogfoods the recursive loop with verified findings and before/after comparison" — run by `npm test`
- **Mutation:** `src/harness/dogfood.ts` — remove `verificationMethod: 'replay'` from the verified finding
- **Red:** the dogfood test fails — the strict recorder refuses the finding at record time inside the `annotate` callback, so no findings come back
- **Green after revert:** yes
- **Gap, reported not hidden:** dropping the `{ kind: 'tick' }` evidence ref instead leaves the gate green. The method half is gated; the replayable-ref half is not.
- **Second claim, not gateable:** "a migration claim needs the full gate list named next to it, not 'green'" has no mechanical trigger and is staged in `canon-candidates.md`.

## Immediate entity-id recycling must be handled at both sides of a render diff

- **Gate:** `tests/worker/diff-projection.test.ts` :: "does not remove an upsert-only component when its entity id was recycled"; `tests/app/occupancy.test.ts` :: "clears the old footprint when an entity id is recycled at a new location" and "is handed the previous view at every call site that reconciles a footprint" — run by `npm test`
- **Was hollow (client half):** the reconciler is a pure helper and is correct in isolation. Passing `undefined` as `previous` at the `applyBuildingUpsert` call site — which is the defect the lesson describes, one side of the pair fixed and the other not — passed all **873** tests.
- **Mutation 1 (worker):** `src/worker/diff-projection.ts` — add `...diff.entities.destroyed` back into both removal streams
- **Red:** `expected { buildings: [ 7 ], structures: [ 7 ] } to deeply equal { buildings: [], structures: [] }`
- **Mutation 2 (client helper):** `src/app/occupancy.ts` — delete the previous-footprint cleanup block
- **Red:** `expected [ 21, 22, 41, 42, 66, 67, 86, 87 ] to deeply equal [ 66, 67, 86, 87 ]`
- **Mutation 3 (client call site):** `src/app/game.ts` — `replaceFootprintOwner(this.buildingCellOwner, previous, …)` → `undefined`
- **Red:** `replaceFootprintOwner(this.buildingCellOwner, undefined, …) discards the previous footprint — a recycled id would claim its new cells while still owning its old ones`
- **Green after revert:** yes

## A utility reach halo must mirror the conduction closure, not supplied status

- **Gate:** `tests/app/network-overlay-state.test.ts` — run by `npm test`
- **Mutation 1:** `src/app/network-overlay-state.ts` — `expand(infrastructure)` → `expand(supplied)` (allocation flags standing in for topology)
- **Red:** "draws the halo from the placed hardware alone, never through buildings" and "shows planning reach around a source-less conductor without marking supply"
- **Mutation 2:** `networkOverlayInputsChanged` — drop `'structures'`
- **Red:** "refreshes for every worker payload that changes the overlay closure"
- **Green after revert:** yes

## A shared heightfield also needs shared triangle and lifecycle contracts

- **Gate:** `tests/rendering/surface-geometry.test.ts`, `tests/rendering/picking.test.ts`, `tests/harness/player.test.ts` — run by `npm test`
- **Mutation 1 (triangulation):** `src/rendering/surface-geometry.ts` — `const diagonal = cellX + cellZ + 1` → `+ 2`
- **Red:** "splits an inset rectangle along the terrain triangle seam" — `expected […] to have a length of 18 but got 12`
- **Mutation 2 (off-map contract):** `src/rendering/picking.ts` `pickClamped` — drop the `?? this.intersectClampedDatum(...)` fallback
- **Red:** `expected null to match object { x: +0 }`
- **Mutation 3 (late-init lifecycle):** `src/harness/player.ts` — remove the post-ready `picker.setTerrainSurface(scene.getTerrainSurface())`
- **Red:** "refreshes its picker when terrain arrives after harness construction" — `expected "vi.fn()" to be called at least once`
- **Green after revert:** yes

## A DEV guard only tree-shakes recorder code when all recorder state stays inside it

- **Gate:** `scripts/check-production-bundle.mjs` — run by `npm run build`
- **Mutation:** `src/worker/sim.worker.ts` `startRecorder` — construct the recorder unconditionally and discard it outside the guard
- **Red:** `Error: production sim worker retained recorder code: SessionRecorder, MemorySink` (build exit 1)
- **Green after revert:** yes
- **Note:** the byte budget has been raised for legitimate sim growth and now sits at 162,626 / 166,000 — only 3.4 kB of headroom, so the forbidden-symbol scan is the load-bearing half.

## A green determinism result is vacuous when it checked no segments

- **Gate:** `tests/harness/llm-loop-script.test.ts` :: "never reports a zero-segment self-check as verified" — run by `npm test`
- **Mutation:** `scripts/llm-visual-loop.mjs` — `ok: selfCheck.ok === true && checkedSegments > 0` → `ok: selfCheck.ok === true`
- **Red:** `expected '…' to contain 'selfCheck.ok === true && checkedSegme…'`
- **Green after revert:** yes

## A browser performance fixture must share the boot world's seed

- **Gate:** `tests/performance/performance-fixture-contract.test.ts` :: "replays one tick to the exact workload projected by the shipping worker" — run by `npm test`
- **Mutation:** `scripts/performance-fixture-contract.mjs` — `PERFORMANCE_FIXTURE_SEED = 12_345` → `3` (the original mismatch)
- **Red:** `expected 12345 to be 3`
- **Green after revert:** yes
- **Note:** both browser drivers import the seed from this shared module, so they cannot drift from it. Neutering a driver's own `if (fixtureSave?.meta?.seed !== EXPECTED_FIXTURE_SEED)` guard is not separately caught.

## Visual bathymetry must read raw elevation before the land-surface projection

- **Gate:** `tests/rendering/water-depth.test.ts` and `tests/rendering/terrain-mesh.test.ts` — run by `npm test`
- **Mutation:** `src/rendering/water-depth.ts` `waterDepth01` — read the land-surface projection (`Math.max(elevation, seaLevel)`) instead of the raw seeded elevation
- **Red:** 3 tests, including "normalizes seeded elevation below sea level into a clamped depth" — `expected +0 to be close to 0.5`
- **Green after revert:** yes

## Water motion should animate lighting before it animates the mechanical plane

- **Gate:** `tests/rendering/water-wave-material.test.ts` :: "injects time-driven wave normals without displacing the flat geometry" — run by `npm test`
- **Mutation 1:** `src/rendering/water-wave-material.ts` — remove the flat-normal restoration before the shadow lookup
- **Red:** `expected '…' to contain 'transformedNormal = normalMatrix * ve…'`
- **Mutation 2:** inject `transformed.y += 0.05 * waterSlope.x;` (geometry displacement)
- **Red:** `expected '…' not to contain 'transformed.y +='`
- **Green after revert:** yes

## A test driven through the system it tests can pass while the defect is live

- **Gate:** `tests/sim/school-runs.test.ts` :: "does not let a nearer unreachable school shadow a reachable one" — run by `npm test`
- **Mutation:** `src/sim/traffic/schools.ts` `schoolFor` — delete the road-component filter
- **Red:** `chose the reachable school, not the nearer decoy: expected 46 to be 32` — the exact numbers recorded when the lesson was learned
- **Green after revert:** yes

## A silhouette-joint check must measure the tightest side, not the widest

- **Gate:** `tests/rendering/trees.test.ts` :: "seats every canopy on the trunk it grows from, with no daylight at the joint" — run by `npm test`
- **Mutation 1:** `src/rendering/constants.ts` — every `canopySink` → 0
- **Red:** `expected 0.3400000035762787 to be less than 0.3400000035762787` (canopy no longer reaches below the trunk top)
- **Mutation 2:** broadleaf `canopySink` 0.15 → 0.10 — the shallow value a max-radius probe passes
- **Red:** `expected 0.0401898302980177 to be greater than 0.075` — the exact measurement recorded when the trap was found, proving the narrowest-cross-section probe is load-bearing and a widest-point probe would not be
- **Green after revert:** yes

## A camera you set is not the camera that took the frame

- **Gate:** `tests/config/browser-driver-contracts.test.ts` :: "records the camera the frame was actually taken from, after the settle" — run by `npm test`. **New gate** — the sweep did the right thing but nothing held it there.
- **Mutation 1:** `scripts/visual-sweep.mjs` — move the settle wait after the camera readback
- **Red:** `no settle between aiming the camera and reading it back, so the recorded position is the one that was requested rather than the one the frame was taken from`
- **Mutation 2:** remove the `scene.controls.minDistance` clamp lift
- **Red:** `expected '…' to contain 'scene.controls.minDistance ='`
- **Green after revert:** yes

---

## The pairing gate itself (`npm run lessons:check`)

Not a lesson, but the gate that keeps this discipline honest once the staging area is empty. Its non-vacuity check ("the files hold at least one entry") could not survive emptying the files, so it was reworked: the parsers and every pairing rule are proved against inline fixtures on each run, and only then applied to the live files.

- **Gate:** `scripts/check-lessons.mjs` — run by `npm run lessons:check`
- **Mutation 1 (half-emptied staging area):** append one rule to `lessons.md` with no matching entry
- **Red:** `docs/learning/lessons.md lists 1 rule(s) but docs/learning/lessons-evidence.md holds 0 entr(y|ies)`
- **Mutation 2 (broken parser):** `fenced = !fenced` → `fenced = true`, so every entry after a template fence is swallowed
- **Red:** `lessons check is broken — self-test "a fenced template is skipped and entries after it are not" expected no problem and got 2`
- **Mutation 3 (check deleted):** `if (rules.length !== entries.length)` → `if (false)`
- **Red:** `lessons check is broken — self-test "an entry with no rule fails" expected a problem and got 0: none`
- **Green after revert:** yes — `10 self-tests, and the staging area is empty`
