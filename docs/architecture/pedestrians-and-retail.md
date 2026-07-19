# Pedestrians and retail activity

## Scope

One citizen entity remains one household of roughly three people. A visible pedestrian is a household member performing the household's current activity, not a decorative agent and not an extra population entity. The bounded activity cycle is `home → work → home → shop → home`; work may be in commercial or industrial buildings, while shopping is always at a commercial building. Household wallets, store inventory, freight, and an industrial production chain remain deferred.

## Deterministic activity state

The citizen component keeps the logical phase and optional next activity/shop assignment. A moving walker is a separate entity owned by that citizen. Its `pedestrianPath` component contains the immutable road-cell path, citizen and destination generations, purpose, and outbound/return direction. Its small `pedestrian` component contains only segment index and fractional progress, so each tick dirties motion data without copying the full path into the recorder diff.

The trip system considers a bounded, rotating set of eligible citizens. Short work commutes walk; longer work commutes retain graph-routed vehicles. Shopping always walks to the nearest eligible commercial building in the same road component. All randomness uses `world.random()` and all entity/candidate scans have explicit stable ordering.

## Exact road access

Pedestrians route between the actual first road cells adjacent to each building footprint. They use a topology-versioned road-cell path cache with deterministic four-neighbor order. This is intentionally separate from vehicle graph routing: resolving an interior road cell to one compressed edge endpoint can collapse two buildings on the same long street to the same graph node and make a trip teleport.

Road topology changes clear the pedestrian cache and validate every remaining path cell. A route that references a removed road is cancelled, increments `disconnectedTrips`, restores the citizen to the logical origin phase with retry backoff, and never credits a retail visit.

## Valid destinations and settlement

A work arrival is valid only while the citizen still owns that work assignment and the destination entity generation matches. Newly spawned vehicles store that destination identity; missing or partial identity metadata from a legacy in-flight vehicle fails closed to a home/work retry, and unassigning a workplace synchronously retires every owned vehicle. A shopping destination must be a live, staffed, powered, watered commercial building with a matching generation. The shopping assignment is stored through the at-shop wait so the return leg cannot accidentally target a recycled entity id.

Only a valid outbound shopping arrival increments `pendingRetailVisits` and `completedShoppingTrips`. The budget system converts pending visits into commercial retail tax as `visits × spendPerVisit × commercialTaxRate / 100`, reports that amount separately as `retailIncome`, includes it in total income, and clears the pending count exactly once. Population-based commercial demand remains as the bootstrap path so a new city does not require completed shopping trips before its first shop can grow.

## Worker and renderer boundary

The worker projects the full active pedestrian list each tick as `{id, generation, fromCell, toCell, t, purpose, outbound}`. Long paths stay inside the worker. The renderer interpolates one current road-cell segment, offsets opposing directions onto separate curbside sidewalk lanes, and samples the shared terrain surface. A stable id/generation hash keeps each live identity's purpose-family top, independent lower garment, skin tone, and body proportions consistent while it moves.

Pedestrians use seven fixed-capacity instanced batches: three for the rigid body (tops, lower garments, heads) and four for the swinging limbs (left/right legs, left/right arms), with a small front cue for facing. Limb geometry is authored with the joint at the origin so an instance matrix can rotate it about hip or shoulder; the walk cycle is a pure function of distance travelled, so a paused game holds its pose and no clock is involved. They do not cast shadows, so moving agents do not invalidate the cached 2048-square shadow map. Empty-list cleanup and entity-generation replacement are explicit, and the global simulation/render cap bounds both ECS and GPU work.
