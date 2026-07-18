# Simulation realism — agents that occupy space and follow rules

Direction set 2026-07-17 (user): cars must not drive through each other, must follow traffic laws, must keep to the right side of the road, must take up real space, must visibly differ, and must have a purpose; pedestrians likewise. This doc is the deeper think: what "realism" means for this game, what we have, the target model, and a phased plan with acceptance criteria.

Read with `game-design.md` (Traffic section holds the current tuned values) and `vision.md` (pillars 1–3: alive, trustworthy, readable). This doc governs the traffic/agent simulation; presentation-only work (building models, HUD stability) is tracked in PROGRESS.md, not here.

## Principles

Realism serves readability and cause-and-effect, not photorealism: the player should be able to watch one car and have its behavior make sense (it queues, it waits for a light, it keeps its lane, it goes somewhere for a reason).

The sim stays deterministic, headless, and worker-hosted: every rule below is a pure function of world state and tick; randomness only through `world.random()`; no per-frame renderer feedback into the sim.

Micro rules must not break macro throughput knobs: congestion buckets, path costs, caps, and intervals stay the demand/measurement layer; car-following and signals add local fidelity underneath, and both layers must stay cheap at 600 vehicles / 20 TPS.

Presentation carries what the sim need not: lane offset, car paint, wheel-level detail, and light fixtures are renderer concerns driven by protocol data (or pure shared functions of it), never new per-tick message traffic.

Prefer derived state over stored state: signal phase and queue order are computed from tick and existing components, so the save format, replay bundles, and determinism gate stay untouched unless a phase explicitly says otherwise.

## Where we are today (2026-07-17)

Purpose already exists: every vehicle and walker belongs to a citizen doing a real errand (commute to a specific workplace, shopping run to a specific staffed shop), trips rotate through phases with cooldowns, and unroutable trips are counted and retried. Nothing needs inventing here — later phases only surface it better.

Space does not exist: vehicles advance `t` along an edge with speed a function of the edge's aggregate congestion bucket only; two cars on the same edge and direction pass through each other freely, and opposing cars drive the same center line, so they visually drive through each other as well.

Laws do not exist: junction traffic-light fixtures shipped 2026-07-14 are explicitly static decoration; nothing stops, yields, or holds an intersection; there is no stop line and no red phase.

Identity is wrong-channel: all cars share one box mesh, and instance color encodes the edge's congestion bucket — so cars all look the same and their color says "traffic state", duplicating the traffic overlay's job instead of reading as paint.

Pedestrians are ahead of cars: direction-dependent curb lanes already separate opposing walkers, and clothing/skin/body variety shipped 2026-07-14; walkers still pass through each other on the same lane.

## Target model

### Phase T1 — occupancy, right-hand traffic, signals, identity (this increment)

Right-hand driving (presentation): a car's world pose offsets perpendicular-right of its travel direction by a lane half-gap, mirroring the pedestrian curb-lane precedent; opposing flows therefore occupy separate parallel lanes and can no longer intersect. The sim keeps `(edge, t, reverse)` untouched.

Headway / no-pass-through (sim): per `(edge, direction)`, vehicles form a queue ordered by progress; each tick a follower may advance at most to `leader.t − headway(edge)` where `headway(edge)` is a car length plus margin expressed in edge-progress units; order within a queue is stable (progress, then id) so overtaking cannot happen on a single carriageway. A car entering an edge whose entry slot is occupied waits at the end of its current edge instead of stacking onto the same spot.

Traffic signals (sim + presentation from one shared pure function): junction nodes with ≥3 approaches run a fixed two-phase cycle (north–south green, then east–west green, with an all-red clearance slice); `signalPhase(tick, nodeCell)` is a pure function in `src/protocol/` — the sim uses it to hold cars at a stop line near the end of red approaches, and the renderer uses the very same function to light the existing fixture faces, so no new worker messages exist and both sides can never disagree. Per-node offset (hash of the node cell) staggers cycles across town.

Stopping distance interacts with headway, so red lights produce visible queues that spill back exactly as far as demand pushes them — this is the emergent behavior the whole phase exists for, and the acceptance test for "cars take up real space".

Two-approach nodes (bends, dead ends) and highway-gateway internals carry no signal: minor tee/cross junctions are where the law lives.

Car identity (presentation): stable id/generation hash picks per-car paint from a curated palette plus a small set of body proportions (sedan/hatch/van-ish scale tweaks within the same low-poly silhouette family), mirroring the pedestrian variety system; congestion coloring leaves car paint entirely — the traffic overlay is the one place that visualizes load.

Pedestrian spacing (sim): same-lane walkers get the same no-pass clamp with a much smaller personal-space gap, so sidewalk flows read as queues of people rather than coincident sprites.

Macro speed law stays: bucket-based slowdown still applies as the upper bound on free-flow speed, headway and signals only ever reduce below it; congestion measurement (edge counts, buckets, path costs, repath epochs) is unchanged.

Explicit non-goals for T1: no lane-change model, no left-turn conflict resolution inside the junction box (cars cross opposing flow during their green as if protected), no per-vehicle save-state additions, no protocol message changes.

### Phase T2 — junction discipline and destinations that hold you

Turning behavior: brief speed dip through junctions, a stop-sign rule for minor-onto-arterial tees (arterial = higher congestion class), and don't-block-the-box (a car may not enter a junction whose exit edge has no free entry slot).

Pedestrian legality: walkers cross carriageways only at junction crosswalks, gated by the same `signalPhase` function; mid-block crossing disappears once crosswalk routing lands.

Arrival that occupies space: a short curbside dwell at the destination (car pulls to the lane edge and pauses before despawn), reading as parking without a parking-lot economy.

Vehicle classes: purpose-typed bodies (commuter cars, delivery vans for C, box trucks for I) drawing from the same identity-hash machinery, laying the visual groundwork for freight.

### Phase T3 — the city that trades and responds

Freight and service trips as first-class purposes (I→C goods runs, deliveries), emergency vehicles with signal preemption from the existing service buildings, and activity schedules that shift trip mix across the day/night cycle already present in the renderer.

Transit remains out of scope per `roadmap.md` (post-v1).

## Contracts (tests that define done for T1)

Headway: after N ticks on a straight two-node road with a slow leader, a faster follower's progress never exceeds `leader.t − headway`, and their order by `t` is invariant for the whole run.

Entry blocking: with an edge's entry slot occupied, an arriving car holds at `t ≈ 1` of its previous edge and enters only when the slot frees; no tick ever shows two cars of one direction within headway of each other, on any edge, in a whole-scenario sweep.

Signals: during a red window for an approach, no car crosses the stop line on that approach; during green they clear; a standing queue drains front-first with headway preserved; `signalPhase` is pure (same inputs → same phase) and its cycle covers every approach with green within one period.

Right-hand presentation: for both traversal directions of the same edge, sampled render poses sit on opposite sides of the polyline, offset toward each car's travel-right; opposing poses never coincide.

Identity: paint/body choice is a pure function of (id, generation) — same car same look across frames, saves, and replays; distribution across the palette is non-degenerate over 100 ids; bucket colors no longer touch car instances.

Pedestrian spacing: same-lane followers never pass leaders and never render within the personal-space gap.

Determinism: the recorded-session replay self-check and byte-identical rebuild contracts stay green with all of the above active; no `Math.random`/`Date.now` anywhere in the new paths.

Performance: vehicle system at 600 cars stays within its per-tick budget (queue grouping is O(V) with sorts bounded per-edge); no new per-frame allocations in the renderer's per-car loop.

## Related but separate

Congestion realism tuning (bucket thresholds, capacity per cell) stays a `game-design.md` concern; this doc changes what a single car does, not how load is scored.

Service-building model fidelity and HUD layout stability are presentation workstreams recorded in PROGRESS.md (2026-07-17); they share no mechanics with this doc.
