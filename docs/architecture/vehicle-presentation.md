# Vehicle presentation motion

Status: implemented and locally verified on 2026-07-13. The correctness gates are green; two production frame-pacing runs meet 60 Hz throughput at p95 but do not consistently pass the stricter tail-jitter gate.

## Boundary

The simulation owns roads, route progress, vehicle creation/destruction, and fixed-tick authority. The renderer owns only disposable interpolation segments between received `VehicleView` messages. Presentation state never feeds back into traffic, pathfinding, save data, commands, or replay determinism.

Vehicle identity is `(id, generation)`, not the numeric ECS id alone. `sim.worker.ts` publishes `world.getEntityGeneration(id)` with every vehicle view. A recycled id with a new generation is a new presentation object and snaps to its first sampled route pose instead of inheriting the destroyed vehicle's prior position or heading.

## Continuity contract

`VehiclesView` samples the route target when a worker message arrives. If the same vehicle generation already has a motion segment, the next segment begins at the pose that was actually presented at that arrival time, not at the prior message's target. Early, late, or jittered messages therefore remain position-continuous.

Position is interpolated linearly across the current segment. Retargeting computes the shortest angular arc once using `atan2(sin(delta), cos(delta))` and stores an equivalent unwrapped destination yaw, so turns across the `-pi`/`pi` boundary do not spin the long way around. The per-frame sampler writes into one caller-owned pose and performs neither trigonometry nor pose allocation; it applies position and yaw together before writing the instanced matrix, keeping the car body facing its displayed travel direction.

The presentation clock is injectable for deterministic tests. Production defaults to `performance.now()`, but the pure `vehicle-motion.ts` sampler imports neither Three.js nor browser globals. The renderer clamps interpolation to `[0, 1]` and bounds its observed message interval through the existing vehicle timing policy.

## Cross-game reuse decision

This behavior remains City-owned. AoE units use exact simulation-tick history plus speed-matched articulated gait, while Townscaper pedestrians follow authored daily-route splines. The shared `voxel` package should not acquire a vehicle, route, or movement-state schema until a second consumer demonstrates the same neutral data and lifecycle contract. The reusable part today is the documented principle: interpolate from the actually presented pose, use generation-aware identity, inject time, and fail closed across discontinuities.

## Verification

- Pure tests cover position interpolation, a 90-degree corner, shortest-arc wraparound, early/jittered retargeting, first-spawn placement, and an allocation-free/trig-free caller-owned frame sample.
- `VehiclesView` tests cover an early corner message from the currently presented pose and immediate reset when the same numeric id arrives with a new generation.
- The complete repository gate passes: 64 Vitest files / 264 tests, TypeScript, ESLint, and the production build. The worker bundle is 111,203 bytes against its 120,000-byte budget.
- The canonical 453-building / 936-population / 88-vehicle fixture was sampled for 600 frames per profile in Chrome 150 on Windows 11, an i9-13900KF, and an RTX 4090 at 1280x720. Across two fresh-build runs, all six DPR/speed profiles measured 59.2-60.0 FPS with p95 frame intervals of 16.8-17.5 ms and p95 render-callback work of 0.9-1.1 ms.
- Neither complete run passed every strict tail gate. The first rejected only DPR 2 / 1x for three consecutive intervals above 20 ms. The repeat rejected three profiles at p99 25.4-25.9 ms or four consecutive misses, with most rejected intervals carrying less than 1.1 ms of measured render work. This proves the named renderer has ample ordinary-frame budget, but it does **not** prove an unconditional 60 FPS floor or zero scheduler/GPU/OS jitter.
- The concise durable measurement record is `vehicle-presentation-evidence.json`; raw local traces remain under ignored `output/performance/`.
