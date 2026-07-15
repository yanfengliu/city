# Voxel buildings-lane migration plan

Status: proposed from 2026-07-15. City-owned. This plan covers the first slice only: moving
one opaque building instance lane onto the sibling `voxel` renderer while City keeps every
other lane, its simulation, and its visual semantics unchanged.

## Why City is doing this

The owner's stated direction is that every game in this fleet is eventually rendered in a 3D
voxel art style with `voxel` as its graphics engine. City is therefore not lending itself to
another package's validation; this is the first step of City's own migration.

The route is the one AoE2 already walked: adopt lane by lane through an embedded, borrowed
renderer, then promote to a standalone sole-renderer host once the lanes have moved. AoE2 is
live on `voxel` today as a sole renderer, and it got there after an initial opt-in
composition. Embedded mode is the on-ramp, not the destination.

That has a consequence worth stating plainly, because it decides what to do when this hurts:
**if the embedded boundary fights City's ownership, that is a `voxel` defect to fix, not a
reason for City to retreat.** Every later migration in the fleet walks through the same door,
and City is the first real host to open it — AoE2 never used embedded mode, and `voxel`'s only
other coverage is a fixture it wrote for itself, which cannot discover that its own boundary is
wrong.

This is also the C-02 deliverable of `../voxel/docs/plans/v1-implementation.md`.

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

### The lane collapses from three batches to one — but do not credit that to Voxel

City needs three wall `InstancedMesh`es because it keys archetypes by zone, but **walls do not
actually vary by zone** — all three use the same `unitBox` geometry and the same shared
material, and zone affects only the per-instance color. As one keyed Voxel batch, the wall
lane is a single draw call instead of three.

That is a real improvement and it is **not a benefit of adopting Voxel**. City could merge its
three wall meshes into one instanced mesh today, unilaterally, in a few lines. The finding
came from the migration trace, not from the migration. It is recorded here so nobody later
mistakes it for the payoff, and so that the payoff is judged on what it actually is: the first
lane of City's move to a voxel-rendered art style, and the first real host to exercise Voxel's
embedded boundary.

The honest offsetting cost: City's shared `MeshLambertMaterial` is used by walls, roofs,
details, and frontages, so while walls live in Voxel there are two equivalent Lambert
materials alive (City's, minus walls; Voxel's, for walls). That is a second shader program for
the duration of the slice, and it disappears as the remaining opaque layers follow.

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

## Rollback, and what a failure actually means

The lane is flagged until parity holds. If any exit item fails, drop the flag and the adapter;
`BuildingsView` is unchanged underneath and City loses nothing that day. The
`Scene.onAfterFrame` hook is additive and may stay.

But rollback is a schedule decision, not a verdict. Because the fleet's direction is that City
ends up voxel-rendered, a failure here is a `voxel` bug report with a reproduction, and the
next move is to fix `voxel` and retry — not to conclude City should keep its own renderer.
The one outcome that would genuinely re-open the strategy is discovering that the embedded
boundary cannot express City's ownership at all, and that is worth knowing early, on one layer
of boxes, rather than later on terrain.

## Explicit non-goals

Voxel does not take City's terrain, water, camera, picker, capture, shadow policy, worker
protocol, simulation model, or composition root in this slice, and City gains no dependency on
Voxel's voxel-chunk path — that path is reachable only through a package-internal option and is
irrelevant to buildings.

## Known tension to resolve later, not now

`voxel` currently declares as explicit non-goals several things City's renderer does today:
engine-owned shadow-map/quality policy, post-processing (City uses ACES tone mapping), liquids
and water, and GPU particle systems. City also has roughly thirty-five render lanes. "Every
lane of City runs on `voxel`" and "`voxel` is not a general-purpose replacement for Three.js"
cannot both stay true forever.

Nothing about this slice depends on resolving that: buildings are instanced opaque boxes, well
inside `voxel`'s stated scope, and the borrowed-renderer boundary is designed for exactly this
mixed period. The question comes due when a lane arrives that `voxel` has deliberately
excluded — water is the likely first — and the answer belongs in `voxel`'s roadmap, as an
explicit scope revision with its own evidence gates, rather than being decided by accretion
here.
