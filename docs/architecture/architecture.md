# Architecture

## Overview

Two threads. A Web Worker owns the simulation: a civ-engine `World` plus game systems, driven by the engine's own loop (20 TPS, speed-scaled). The main thread owns presentation: a Three.js scene, DOM HUD, and input. They speak a typed, JSON/structured-clone-safe protocol; the renderer never touches the World.

The worker does NOT use the engine's `ClientAdapter` or `RenderAdapter` classes. It drives the engine loop via `world.start()`/`setSpeed()`/`pause()`/`resume()`, submits commands directly via `world.submitWithResult` (custom `{type:'command', name, data}` envelope), and builds custom bulk/incremental messages from `world.onDiff`. Speed 0 maps to `world.pause()` — never `setSpeed(0)`, which throws.

```text
main thread                      │ worker
                                 │
input → tool logic → Command ────┼──▶ command envelope → submitWithResult → validators
                                 │        World.step() @ 20 TPS × speed
Three.js scene ◀── RenderStore ◀─┼─── onDiff → render messages (bulk + incremental)
DOM HUD       ◀── UiStore     ◀──┼─── frame payload (stats, demand, treasury, events)
overlay plane ◀── FieldStore  ◀──┼─── field chunks (on each field's cadence)
```

## Module boundaries

- `src/sim/` — pure game logic on civ-engine. No DOM, no Three, no timers, no Math.random/Date.now. Everything deterministic and headless-testable. Exports `createCitySim(config)` (the world-factory) and shared types.
- `src/protocol/` — message types both sides import. No logic beyond type guards. Every payload must be structured-clone-safe plain data.
- `src/worker/` — thin host: instantiate world via factory, drive the engine loop (`world.start()`; 1x/2x/4x via `setSpeed`, pause via `pause()`/`resume()` — never `setSpeed(0)`), submit commands via `world.submitWithResult`, and project `world.onDiff` into protocol messages over postMessage. No engine `ClientAdapter`/`RenderAdapter`; no game rules here.
- `src/rendering/` — Three.js only. Consumes protocol messages into a RenderStore (entity views keyed by id+generation), builds/updates GPU resources. Never imports `sim/`.
- `src/ui/` — DOM HUD (vanilla TS, no framework; keep it lean). Reads UiStore, dispatches commands via a single `submitCommand` funnel.
- `src/app/` — composition root: boot worker, wire stores, input → active tool → command, render loop.
- `src/harness/` — dev-only playtest/replay adapters. It wraps the composition-root game surface, recorder messages, and real `PlayerInput` events. The civ-engine visual playtest host lives here and may read UI labels / screenshot / text state, but it must not bypass the real player surface for visual-loop actions.
- `src/persistence/` — save/load: requests snapshot from worker, versions it, localStorage + file export/import; load path re-creates the worker world from snapshot.

## Worker protocol (v1)

Source of truth for implemented shapes: `src/protocol/messages.ts`. Notable divergences from the sketch below as built: the `vehicles` message is a full per-tick list `{topologyVersion, list:[{id, edge, t, reverse}]}` rather than upserts/removed; `field` messages carry `width`, `height`, and `defaultValue` alongside sparse cells; the inspect panel reads client-side building views (no `inspect` round-trip exists yet); `requestSnapshot`/`loadSnapshot` land in phase 6.

Client → worker: `{type:'command', name, data}` (one per player action; a custom envelope the worker hands to `world.submitWithResult` — not the engine `ClientAdapter` — with in-sim validation), `{type:'setSpeed', speed: 0|1|2|4}` (worker maps 1/2/4 to `world.setSpeed` and 0 to `world.pause()`/`resume()`; never `setSpeed(0)`, which throws), `{type:'requestSnapshot'}` (save), `{type:'loadSnapshot', snapshot, meta}`, `{type:'setFieldSubscriptions', fields[]}` (active overlay only), `{type:'inspect', entityId}` (info-panel round-trip).

Worker → client: `{type:'ready', gridW, gridH, terrain, seed}` (once; terrain is static after gen EXCEPT the tree mask — the renderer derives current trees locally as the initial mask minus road cells minus building/structure footprints, so no tree message exists; the sim's landValue nearTrees input reads the same derived view sim-side), `{type:'zones', cells:[{i, zone}]}` (bulk; on zone/dezone and after load), `{type:'buildings', upserts: BuildingView[], removed: entityId[]}` (incremental, built from `world.onDiff` — not an engine `RenderAdapter`), `{type:'vehicles', topologyVersion, list: VehicleView[]}` (full per-tick list while any vehicle exists), `{type:'frame', tick, stats}` (every tick; small — no events array; toasts come from commandRejected and save responses), `{type:'field', name, blockSize, cells}` (sparse block updates on that field's cadence, only when subscribed), `{type:'traffic', edges:[{id, bucket}]}` (on congestion-epoch change; phase 3), `{type:'networks', power:{lineCells, plantIds}, water:{pipeCells, pumpIds}}` (on network recompute; phase 5), `{type:'inspectResult', ...}` (building details, residents, jobs, score inputs), `{type:'snapshot', snapshot, meta}` (save response), `{type:'commandRejected', name, code, message}` (surfaced as UI toast).

After `{type:'loadSnapshot'}` the worker responds with a fresh full sync — `ready` (terrain regenerated from the restored seed), `roads`, `zones`, a full `buildings` upsert, `frame` — the same sequence as initial boot.

Projected render views are minimal per archetype: buildings `{kind:'rci'|'service'|'utility', zone, level, cells:[x,y,w,h], abandoned, powered, watered, structureType?}` where `structureType` identifies non-RCI structures (fireStation, police, clinic, school, coalPlant, windTurbine, waterPump); vehicles `{kind:'vehicle', travel:{edge, t}, topologyVersion}` (renderer resolves geometry via its road-graph mirror, keeping the previous graph until no vehicle view references it); roads are NOT entities in the render stream — road cell set + derived graph geometry arrive as a `{type:'roads', topologyVersion, cells, edges}` message on topology change (cheaper than per-cell entities and the renderer needs edges for vehicle interpolation anyway).

## Rendering plan

- Terrain: one static mesh from the `ready` terrain (vertex-colored plane; water as a second translucent plane slightly below y=0). Trees: `InstancedMesh` over the renderer's locally derived tree view — initial mask minus road cells minus building/structure footprints, recomputed from messages it already receives (no extra tree message).
- Roads: merged BufferGeometry regenerated per 16x16-cell chunk on road changes (chunk dirty-set from the `roads` message diff). Simple quad strips with lane-line texture; intersections as flat quads.
- Buildings: one `InstancedMesh` per (zone, level) RCI archetype (9) + abandoned variant tint via instance color, plus service/utility archetypes (fireStation, police, clinic, school, coalPlant, windTurbine, waterPump) and meshes for power lines and pipes (phase 5). Procedural low-poly box+roof geometry, footprint-scaled. Rebuild instance buffers incrementally from `buildings` messages.
- Vehicles: single `InstancedMesh` (capacity 600). Per frame: for each vehicle view, sample its edge polyline at `t` (+ per-tick lerp between last two sim states, renderer-owned), set instance matrix. Instance color by speed (white→red) for readable congestion.
- Field overlays: one 64x64 (or 32x32 for blockSize 4) `DataTexture` per active field on a transparent plane above terrain; updated from sparse `field` messages. Only the active overlay is subscribed.
- Camera: `MapControls` (orbit/pan/zoom, angle-clamped). Picking: raycast against the ground plane → cell coords; tools draw ghost previews client-side and validate optimistically (authoritative validation in-sim; rejection → toast + ghost flash).
- Day/night (phase 6): renderer-local sun/ambient animation keyed to sim day fraction from `frame`.

## Sim internals worth pinning

- System registry: single ordered registration list in `world-factory.ts` (deterministic registration order is a replay contract). Phases: input = command handlers only; update = growth/citizens/traffic/utilities; postUpdate = fields, demand, economy; output = stats projection.
- `createCitySim` takes explicit flags `{fieldsEnabled, utilitiesEnabled}` (both false until their phase — fields in phase 4, utilities in phase 5). Disabled fields read landValue = 30, coverage 0, educated false; disabled utilities read powered = watered = true. The flags stay supported forever so early-phase scenario tests remain valid.
- Road graph, OccupancyGrid, Layers, and the PathRequestQueue are game-owned singletons living OUTSIDE World state — with their authoritative source persisted where `world.serialize()` sees it: road cells live in a `roadCells` world-state record (small, written only on player action), pending trips as component data, and layer states as components on a dedicated singleton "mirror" entity (one component per layer, written only on that layer's recompute cadence). Layers go on the mirror entity rather than into `world.setState(...)` because world-state values are JSON-fingerprinted twice per tick by the engine, while component diffs are dirty-flag-only. OccupancyGrid and other derived maps are NOT mirrored anywhere. After `applySnapshot` (load/replay), `rebuildDerived(world)` reconstructs graph/occupancy/queue from entities and world state and layers from the mirror components. This function is the single choke point keeping derived caches honest.
- Traffic vs topology changes: edge identity is a geometry key (string of the two endpoint cells + the first path cell). On graph rebuild the sim remaps in-flight vehicles' edge ids via the geometry-key map; vehicles referencing vanished edges despawn (counted in `disconnectedTrips`; the citizen's trip is cancelled). PathCache key is (fromNode, toNode) only; one monotonic `pathVersion` counter bumps on EITHER topology change or congestion-epoch change (no packed-version arithmetic); `clearCache()` on topology change.
- Determinism: strict mode on; the only RNG is `world.random()`; queues drain deterministically; congestion epochs and buckets are integer state in world state. CI runs a 2,000-tick synthetic playtest (scripted policy building a small city) and asserts `SessionReplayer.selfCheck().ok`.

## Performance budgets (from civ-engine benchmarks on this machine)

- Entities ≤ ~6,000 (2k citizens + ≤600 vehicles + ~1–2k buildings + services): engine ticks this in ≤ ~5 ms; budget 50 ms/tick at 20 TPS.
- Pathfinding: road graph ≤ ~1k nodes; 8 path resolutions/tick budgeted through the queue; cached hits ~0.01 ms.
- Diff payloads at this scale ~25–50 KB/tick worst case; fields throttled to their cadence and subscription.
- Render: instancing keeps draw calls ≈ #archetypes + chunks + overlays ≤ ~50. Target 60 fps; hard floor 30 fps at v1 acceptance scale.

## Testing strategy

- Contract tests per mechanic in `tests/sim/` using scenario helpers: build world → submit commands → step N → assert (growth happened, vehicle count > 0, field values in range, budget changed…).
- Pure-function unit tests for road-graph derivation, footprint search, L-path drag expansion, demand math.
- Determinism gate: synthetic playtest + replay selfCheck (see above) in `npm test`.
- Renderer/UI verified through the browser game-testing loop (`render_game_to_text()`, screenshots), not unit tests. `render_game_to_text()` reports: tick, population, treasury, demand, vehicle count, camera, active tool, and a coarse ASCII map — enough for an agent to close the loop without pixels.
- Harness adapters have browser-free contract tests for marker conversion, replay inspection, and the civ-engine visual playtest host; they assert that the visual loop maps actions to `PlayerInput`/`advance` rather than `command`.

## Key decisions

| # | Decision | Why |
|---|---|---|
| 1 | Sim on civ-engine in a worker, renderer on protocol messages only | determinism, headless tests, main-thread frame budget |
| 2 | Grid-aligned roads; road graph derived, traffic on graph not cells | engine-native fit; graph keeps A* small and caches effective |
| 3 | Roads/terrain/fields as bulk messages, not per-cell entities | thousands of cells would drown the entity diff stream |
| 4 | Citizens = household entities (≈3 pop each), capped vehicle agents | Skylines-credible agent traffic at browser-safe scale |
| 5 | Derived caches (graph/layers/occupancy) rebuilt from entities + mirror components via one `rebuildDerived` | save/load/replay correctness with non-serialized engine utilities |
| 6 | Vanilla-TS HUD, no React | small UI surface; avoids a framework dependency in the render path |
