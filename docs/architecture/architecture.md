# Architecture

## Overview

Two threads. A Web Worker owns the simulation: a civ-engine `World` plus game systems, stepped on a fixed cadence (20 TPS, speed-scaled). The main thread owns presentation: a Three.js scene, DOM HUD, and input. They speak a typed, JSON/structured-clone-safe protocol; the renderer never touches the World.

```text
main thread                      │ worker
                                 │
input → tool logic → Command ────┼──▶ ClientAdapter → world.submit → validators
                                 │        World.step() @ 20 TPS × speed
Three.js scene ◀── RenderStore ◀─┼─── RenderAdapter (snapshot + per-tick diffs)
DOM HUD       ◀── UiStore     ◀──┼─── frame payload (stats, demand, treasury, events)
overlay plane ◀── FieldStore  ◀──┼─── field chunks (on each field's cadence)
```

## Module boundaries

- `src/sim/` — pure game logic on civ-engine. No DOM, no Three, no timers, no Math.random/Date.now. Everything deterministic and headless-testable. Exports `createCityWorld(config)` (the world-factory) and shared types.
- `src/protocol/` — message types both sides import. No logic beyond type guards. Every payload must be structured-clone-safe plain data.
- `src/worker/` — thin host: instantiate world via factory, run the loop (setTimeout-based, speed/pause aware), pump ClientAdapter/RenderAdapter messages over postMessage. No game rules here.
- `src/rendering/` — Three.js only. Consumes protocol messages into a RenderStore (entity views keyed by id+generation), builds/updates GPU resources. Never imports `sim/`.
- `src/ui/` — DOM HUD (vanilla TS, no framework; keep it lean). Reads UiStore, dispatches commands via a single `submitCommand` funnel.
- `src/app/` — composition root: boot worker, wire stores, input → active tool → command, render loop.
- `src/persistence/` — save/load: requests snapshot from worker, versions it, localStorage + file export/import; load path re-creates the worker world from snapshot.

## Worker protocol (v1)

Client → worker: `{type:'command', name, data}` (one per player action; validated in-sim), `{type:'setSpeed', speed: 0|1|2|4}`, `{type:'requestSnapshot'}` (save), `{type:'loadSnapshot', snapshot, meta}`, `{type:'setFieldSubscriptions', fields[]}` (active overlay only).

Worker → client: `{type:'ready', gridW, gridH, terrain, seed}` (once; terrain is static after gen), `{type:'renderSnapshot'|'renderTick'}` (RenderAdapter passthrough), `{type:'frame', tick, stats, events}` (every tick; small), `{type:'field', name, blockSize, cells}` (sparse block updates on that field's cadence, only when subscribed), `{type:'snapshot', snapshot, meta}` (save response), `{type:'commandRejected', name, code, message}` (surfaced as UI toast).

Projected render views are minimal per archetype: buildings `{kind:'building', zone, level, cells:[x,y,w,h], abandoned, powered, watered}`; vehicles `{kind:'vehicle', travel:{edge, t}}` (renderer resolves geometry via its road-graph mirror); roads are NOT entities in the render stream — road cell set + derived graph geometry arrive as a `{type:'roads', version, cells, edges}` message on topology change (cheaper than per-cell entities and the renderer needs edges for vehicle interpolation anyway).

## Rendering plan

- Terrain: one static mesh from the `ready` terrain (vertex-colored plane; water as a second translucent plane slightly below y=0). Trees: `InstancedMesh`, rebuilt only when tree cells change (building placement).
- Roads: merged BufferGeometry regenerated per 16x16-cell chunk on road changes (chunk dirty-set from the `roads` message diff). Simple quad strips with lane-line texture; intersections as flat quads.
- Buildings: one `InstancedMesh` per (zone, level) archetype (9) + abandoned variant tint via instance color. Procedural low-poly box+roof geometry, footprint-scaled. Rebuild instance buffers incrementally from render diffs.
- Vehicles: single `InstancedMesh` (capacity 600). Per frame: for each vehicle view, sample its edge polyline at `t` (+ per-tick lerp between last two sim states, renderer-owned), set instance matrix. Instance color by speed (white→red) for readable congestion.
- Field overlays: one 64x64 (or 32x32 for blockSize 4) `DataTexture` per active field on a transparent plane above terrain; updated from sparse `field` messages. Only the active overlay is subscribed.
- Camera: `MapControls` (orbit/pan/zoom, angle-clamped). Picking: raycast against the ground plane → cell coords; tools draw ghost previews client-side and validate optimistically (authoritative validation in-sim; rejection → toast + ghost flash).
- Day/night (phase 6): renderer-local sun/ambient animation keyed to sim day fraction from `frame`.

## Sim internals worth pinning

- System registry: single ordered registration list in `world-factory.ts` (deterministic registration order is a replay contract). Phases: input = command handlers only; update = growth/citizens/traffic/utilities; postUpdate = fields, demand, economy; output = stats projection.
- Road graph, OccupancyGrid, Layers, and the PathRequestQueue are game-owned singletons living OUTSIDE World state — with their authoritative source mirrored INTO world state: road cells (component per road cell entity? No — road cells live in a `roadCells` world-state record), layer states, and pending trips as component data. After `applySnapshot` (load/replay), `rebuildDerived(world)` reconstructs graph/occupancy/layers/queue from world state. This function is the single choke point keeping derived caches honest.
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

## Key decisions

| # | Decision | Why |
|---|---|---|
| 1 | Sim on civ-engine in a worker, renderer on protocol messages only | determinism, headless tests, main-thread frame budget |
| 2 | Grid-aligned roads; road graph derived, traffic on graph not cells | engine-native fit; graph keeps A* small and caches effective |
| 3 | Roads/terrain/fields as bulk messages, not per-cell entities | thousands of cells would drown the entity diff stream |
| 4 | Citizens = household entities (≈3 pop each), capped vehicle agents | Skylines-credible agent traffic at browser-safe scale |
| 5 | Derived caches (graph/layers/occupancy) rebuilt from world state via one `rebuildDerived` | save/load/replay correctness with non-serialized engine utilities |
| 6 | Vanilla-TS HUD, no React | small UI surface; avoids a framework dependency in the render path |
