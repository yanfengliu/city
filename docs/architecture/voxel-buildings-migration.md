# Voxel buildings-lane migration plan

Status: proposed from 2026-07-15. City-owned. This plan covers the first slice only: moving
one opaque building instance lane onto the sibling `voxel` renderer while City keeps every
other lane, its simulation, and its visual semantics unchanged.

This is the C-02 deliverable of `../voxel/docs/plans/v1-implementation.md`. Voxel's 1.0 claim
requires a second real consumer; City's requirement is different and is the one this document
serves: adopt shared rendering only where it costs City nothing it currently owns.

## What City owns today (traced 2026-07-15)

`src/rendering/scene.ts`:

- The `WebGLRenderer`, including `ACESFilmicToneMapping`, exposure 1.15, and
  `shadowMap.enabled` with `PCFSoftShadowMap` and `autoUpdate = false` plus explicit
  `needsUpdate` invalidation.
- The `PerspectiveCamera`, `MapControls`, terrain-conforming camera target, and flight.
- The animation loop (`renderer.setAnimationLoop`), resize, and `captureCanvasAtCssSize`.
- One draw per presentation pass in `presentFrame(now)`:

      water wave time -> updateFlight -> controls.update -> conformCameraTargetToTerrain
        -> frameCallbacks(now) -> renderer.render(scene, camera)

`src/rendering/buildings-mesh.ts` (`BuildingsView`):

- Three zone archetypes (`R`, `C`, `I`), each with five instanced layers sharing one slot
  layout: `walls`, `roofs`, `details`, `windows`, `frontages`.
- An `upsert(view)` / `remove(id)` stream with an `id -> {zone, slot}` map, swap-remove, and
  capacity doubling (`grow`).
- Per-instance matrix and color only. No per-instance animation.
- `walls`, `roofs`, `details` cast and receive shadows; `windows` and `frontages` do not.
- A shared `MeshLambertMaterial` for the opaque layers and a separate emissive
  `windowMaterial` whose `emissiveIntensity` is driven per frame by `setNightGlow(night)`.
- `setTerrainSurface(surface)` rewrites every instance, because each matrix is anchored to
  `surface.footprintRange(...)`.

`src/app/game.ts` composes `buildingsView.group` into the scene and drives `setNightGlow` and
`setTerrainSurface` from its own frame callback and terrain events.

## The slice

Move **the `walls` layer of all three zone archetypes** to a Voxel instance batch. Nothing
else.

Why walls:

- Genuinely opaque, one shared `MeshLambertMaterial`, per-instance matrix and color only.
- No emissive, no per-frame material mutation. `setNightGlow` touches only `windowMaterial`,
  so the slice cannot regress the night-glow behavior.
- Uses the plain unit `BoxGeometry`, which is indexed and expressible as a Voxel geometry
  resource without authoring anything new.
- Casts and receives shadows, which exercises the one thing City must not lose: Voxel's
  neutral per-batch cast/receive flags while City keeps shadow-map policy.

Explicitly out of the slice: `roofs` (geometry varies by zone — a pyramid for `R`, the unit box
for `C`/`I` — so it needs two geometry resources and a per-zone split), `details`, `windows`
(emissive, and the only layer `setNightGlow` mutates per frame), and `frontages` (custom
archetype geometry). Also out: terrain, water, roads, zones, vehicles, pedestrians, networks,
structures, overlays, FX, the picker, and capture.

### The lane collapses from three batches to one

Worth noting because it is the slice's only expected win: City needs three wall
`InstancedMesh`es because it keys archetypes by zone, but **walls do not actually vary by
zone** — all three use the same `unitBox` geometry and the same shared material, and zone
affects only the per-instance color. As one keyed Voxel batch, the whole wall lane is a single
draw call instead of three.

The offsetting cost is honest and small: City's shared `MeshLambertMaterial` is used by walls,
roofs, details, and frontages, so while walls live in Voxel there are two equivalent Lambert
materials alive (City's, minus walls; Voxel's, for walls). That is a second shader program for
the duration of the slice, and it disappears when the remaining opaque layers follow.

## Why the slot layouts may safely diverge

`BuildingsView.remove` swap-removes across all five layers together, so slots stay parallel.
Once `walls` moves to Voxel, that parallelism breaks — and this is fine, because Voxel batches
are addressed by opaque instance **key**, not by slot. City sends `upsert(key = building id)`
and `remove(key)`; Voxel owns its own slot mapping internally.

The two only need to agree on which building ids exist, which they already do: both are driven
by the same `upsert`/`remove` stream. City's remaining four layers keep their existing
swap-remove untouched.

This is the property to assert in tests: after an arbitrary interleaving of upserts and
removes, the set of Voxel instance keys equals `BuildingsView`'s live id set, and each key's
matrix equals what City would have written to its wall slot.

## Ownership boundary

Voxel embeds with City owning everything it owns today:

    host: {
      kind: 'embedded',
      renderer,              // borrowed; Voxel never resizes or configures it
      scene,                 // borrowed; Voxel adds one root
      camera,                // borrowed PerspectiveCamera
      drawOwnership: 'host',
      viewportOwnership: 'host',
      captureOwnership: 'host',
    }

Consequences to honor:

- Voxel must not touch `toneMapping`, `shadowMap.enabled/type/autoUpdate/needsUpdate`,
  `setSize`, `setPixelRatio`, or `setAnimationLoop`.
- Shadow participation crosses the boundary as neutral per-batch `castShadow` / `receiveShadow`
  flags. Voxel creates no lights and no shadow system for this lane; City's existing
  `shadowMap.needsUpdate` invalidation continues to drive updates.
- Capture stays `captureCanvasAtCssSize`. Voxel issues no extra draw.
- City's day/night, tone mapping, and camera remain the only source of visual grading.

## The one City-side change required

`presentFrame` runs `frameCallbacks(now)` **before** `renderer.render(...)` and has no
after-draw hook. Voxel's embedded protocol needs both sides of the draw:

    frameCallbacks(now)                 -> runtime.prepareFrame(context) -> ticket
    renderer.render(scene, camera)      -> this draw is the acknowledgement
    (new) afterFrameCallbacks(now)      -> runtime.commitFrame(ticket)

So `Scene` gains an `onAfterFrame(callback)` hook and `presentFrame` invokes it after the
draw. This is additive, is used by nothing else initially, and keeps the draw itself
untouched. `screenshot()` shares `presentFrame`, so captures continue to see a committed
frame.

Failure policy: if `prepareFrame` returns unavailable, City draws exactly as it does today and
the lane simply shows its previous revision — no seam, no throw. If the draw throws, City
calls `abortFrame(ticket)` so Voxel restores its previously displayed revision.

## Terrain coupling

`setTerrainSurface` currently rewrites every instance because matrices are anchored to
`footprintRange`. The adapter re-emits every wall instance on that event. That is a whole-lane
update by design and is the honest cost of the anchor; it is not a per-frame cost, and it
should be measured rather than assumed cheap.

## Sequence

1. Add `voxel` as a `file:../voxel` dependency, mirroring the existing `civ-engine` link.
   Verify exactly one Three runtime resolves — City is on `three@^0.185.1` and Voxel's peer is
   `>=0.185.1 <0.186.0`, so they dedupe, but this must be asserted, not assumed.
2. Add `Scene.onAfterFrame`.
3. Add a City-owned adapter translating the wall lane's upsert/remove/terrain stream into
   Voxel batch transactions. City simulation types stay in City; the adapter is the only place
   that knows both vocabularies.
4. Put the lane behind a flag so both paths can run and be compared.
5. Prove parity, then delete City's wall mesh path.

## Exit evidence

- Identity: Voxel's live instance keys equal `BuildingsView`'s live id set across an arbitrary
  upsert/remove/regrow interleaving.
- Visual: wall geometry, per-building tint/level lightening, and abandoned decay jitter are
  unchanged; night glow is unaffected.
- Shadows: walls still cast and receive under City's existing shadow-map policy.
- Bundling: exactly one Three.js runtime.
- Ownership: renderer settings, camera, viewport, animation loop, and capture are
  byte-for-byte what they are today.
- Budgets: the wall lane draws in one call rather than three, per-update cost is no worse than
  the growable batch it replaces, and the whole-lane terrain-change cost is measured rather
  than assumed.
- Teardown: disposing the runtime removes only the Voxel root and its resources.
- City's own gates stay green: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build`.

## Rollback

The lane is flagged until parity holds. If any exit item fails, drop the flag and the adapter;
`BuildingsView` is unchanged underneath and City loses nothing. The `Scene.onAfterFrame` hook
is additive and may stay.

## Explicit non-goals

Voxel does not take City's terrain, water, camera, picker, capture, shadow policy, worker
protocol, simulation model, or composition root in this slice, and City gains no dependency on
Voxel's voxel-chunk path — that path is reachable only through a package-internal option and is
irrelevant to buildings.
