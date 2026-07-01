# Game Design

All numeric values here are initial tuning values and live in `src/sim/constants/`; playtesting adjusts constants, not this doc, unless a mechanic changes shape. RNG: every stochastic choice uses `world.random()`. All cadenced systems declare `interval`/`intervalOffset` as listed to stagger load. `intervalOffset` MUST be < `interval` (the engine throws otherwise), and offsets stagger modulo the system's own interval — perfect global staggering is impossible (growth's interval 4 occupies residues 1 and 5 mod 8), so the goal is that HEAVY systems avoid each other; cheap ones may coincide. Authoritative cadences: growth 4/1; move-in 8/3; trips 8/2 (phase 3); employment 8/4 (phase 3); pollution 8/0; noise 8/6; level 16/5; landValue 16/12; demand 32/14; power flood-fill 8/7 (phase 5); water flood-fill 8/1 (phase 5); congestion epoch 64/12 (phase 3); budget 1024/0.

## Map and time

- Fixed grid 128x128 cells. 1 cell ≈ 8 m; 1 cell = 1 render unit. Sim runs at 20 TPS; speeds pause/1x/2x/4x (worker maps 1x/2x/4x to engine setSpeed; pause to engine pause/resume; renderer unaffected).
- Terrain: seeded simplex elevation in [0,1]; water where elevation < 0.35; everything else is flat buildable land. Tree mask: land cells where a second noise octave > 0.62 get decorative trees; any occupancy-claiming placement (building growth, roads, services, utilities) clears trees on its footprint. Map edges guaranteed to contain at least one water body ≥ 60 cells (re-roll seed offset until true) so water pumps and water-proximity value always exist.
- Day = 2048 ticks (visual day/night only). Budget interval = 1024 ticks (income and upkeep are defined per budget interval; the budget system runs at interval 1024, offset 0).

## Roads

- One road type in v1: two-lane road. Cost 10/cell, upkeep `ROAD_UPKEEP_PER_CELL` per budget interval (see Economy for the authoritative value). Placement: click-drag produces an L-shaped cell path (dominant axis first); each cell becomes a road cell. Validators: cells are land, in unlocked area (v1: whole map), not water, not occupied by a building footprint; treasury covers total cost. Bulldozing a road cell refunds 25%.
- Road graph (game-owned, not engine): nodes at road cells whose road-neighbor count ≠ 2 or whose 2 neighbors are non-collinear (corners); edges are maximal straight runs between nodes, weight = cell count. Edge identity is a geometry key (string of the two endpoint cells + the first path cell), so edges whose geometry survives a rebuild keep their identity. Full rebuild on any road change; `topologyVersion++`; path cache cleared; in-flight vehicles remap via the geometry-key map (see Traffic). Cells store their containing edge id for O(1) access-node lookup.
- Edge capacity = 6 vehicles per cell of length. Congestion c = vehiclesOnEdge / capacity, quantized to buckets 0–3 at thresholds 0.4 / 0.75 / 1.0.

## Zoning and building growth

- Zones: residential (R), commercial (C), industrial (I), low density. Zone tool paints land cells within Chebyshev distance 2 of a road cell (this matches the maximum growth reach of a 2x2 footprint anchored on a road-adjacent cell — distance-3 cells could never develop); dezone erases. Zoning is free; zoned cells render as colored grid tint (R green, C blue, I yellow-orange).
- Growth system (interval 4, offset 1): while zone demand > 0, up to 4 growth attempts per run per zone type. An attempt picks a random zoned, empty, road-adjacent (4-dir) cell; tries a 2x2 footprint of same-zone empty cells first, else 1x1; requires footprint free in OccupancyGrid. Spawns a level-1 building entity with the footprint blocked (v1 buildings are unrotated boxes).
- Capacity per building = perCellBase(zone, level) x footprintCells, measured in citizen units (see Demand). Residents (R): L1 1, L2 2, L3 3 per cell. Job slots: C L1 1, L2 2, L3 3; I L1 1, L2 2, L3 2 per cell.
- Desirability score per building, evaluated by the level system (interval 16, offset 5), is zone-aware. R and C: `score = 0.5 x landValue(cell) + 8 x serviceCoverageCount(0–4) + 10 x (powered && watered) - taxPenalty`, where taxPenalty = 2 x max(0, taxRate(zone) - 9). Industrial: `score = 0.1 x landValue(cell) + 8 x serviceCoverageCount + (powered && watered ? 10 : 0) + 15` (industrial base) — the low land-value weight plus the base keeps industrial clusters from abandoning over their own pollution. With neutral inputs (landValue 30, no coverage, utilities satisfied) the R/C score is 25 — intentionally stable at level 1, because level-down triggers only when score < 25 (strictly below). Level-up to 2 at score ≥ 45 for 3 consecutive evaluations; to 3 at score ≥ 70 for 3 consecutive evaluations AND education coverage. Level-down at score < 25. Abandonment: score < 12 for 10 consecutive evaluations, or utilities-only lack (score fine but unpowered-or-unwatered) for 30 consecutive evaluations — the longer grace gives the player time to fix networks → abandoned (no taxes, evicts residents/jobs, grey render, excluded from all demand/capacity aggregates, emits no pollution or noise). Recovery: 5 consecutive healthy evaluations un-abandons at level 1, where "healthy" is the exact complement of abandonment: score ≥ 12 AND powered AND watered. Bulldoze always allowed (no refund for grown buildings).
- Industrial buildings emit pollution; commercial emit noise (see Fields). Abandoned buildings emit neither.

## Demand (RCI)

Recomputed every 32 ticks (interval 32, offset 14). ALL sim math uses citizen entities (households) as the canonical unit; population = 3 x citizens applies only in UI display. Abandoned buildings are excluded from ALL aggregates (jobs, capacity, slots). Let P = citizen count, jobsTotal/jobsFilled, U = unemployed citizens, V = free housing capacity in citizen units.

- R = clamp[-1,1]( (0.8 x (jobsTotal - jobsFilled) + 4 - 0.5 x V) / 16 ) - taxDemandPenalty(R)
- C = clamp[-1,1]( (0.30 x P - commercialJobSlots) / 10 ) - taxDemandPenalty(C)
- I = clamp[-1,1]( (1.2 x U + 0.09 x P - 0.4 x industrialJobSlots) / 13 ) - taxDemandPenalty(I)
- taxDemandPenalty(zone) = 0.05 x max(0, taxRate(zone) - 9). Growth requires demand > 0 for that zone.

## Citizens and employment

- One citizen entity ≈ one household of 3 people (population display = 3 x citizens). Components: home (building id), work (building id | none). Target scale ≤ 2,000 citizen entities (≈ 6,000 population).
- Move-in system (interval 8, offset 3): if R demand > 0 and vacancies exist, spawn `min(freeHousingCapacity, 1 + floor(Rdemand x 5))` citizens into residential buildings with space (deterministic pick via world.random), where freeHousingCapacity = Σ over non-abandoned R buildings of (capacity - residents), in citizen entities. Move-out: abandoned/bulldozed homes evict; evicted citizens leave the city (despawned) if no vacancy found within one evaluation.
- Employment system (interval 8, offset 4; phase 3): assigns unemployed citizens to buildings with free job slots, nearest-first (findNearest over job buildings), up to 32 assignments per run. Bulldozed/abandoned workplaces unassign their workers.

## Traffic

- Trip system (interval 8, offset 2; phase 3): each run, up to 24 employed citizens without an active trip (deterministic rotation by entity id) start a commute round trip: request path homeAccessNode → workAccessNode. Global cap: 600 concurrent vehicles; requests beyond cap wait (FIFO). Unroutable trips cancel and increment a `disconnectedTrips` counter (surfaced in UI as a warning).
- Pathfinding: `findPath` over the road graph (nodes/edges), batched via a `PathRequestQueue` budgeted at 8 resolutions/tick. PathCache key is (fromNode, toNode) only; a single monotonic `pathVersion` counter bumps on EITHER topology change or congestion-epoch change (no packed-version arithmetic), invalidating stale entries; `clearCache()` on topology change. Edge cost = length x (1 + 0.5 x congestionBucket).
- Vehicles: entity with `travel` component {path: edgeId[], edgeIndex, t ∈ [0,1), speed}. Per tick: advance t by (cellsPerTick / edgeLength); cellsPerTick = 0.35 x max(0.25, 1 - 0.25 x bucket(currentEdge)). Engine position = integer cell under current travel position (for spatial queries); renderer reads `travel` for smooth interpolation. On edge change, update per-edge vehicle counts. Arrival: vehicle despawns, citizen waits 64–128 ticks at destination, then return trip; after returning, cooldown 256–512 ticks before next commute roll.
- Topology changes vs in-flight vehicles: edge identity is a geometry key (string of the two endpoint cells + the first path cell). On graph rebuild the sim remaps in-flight vehicles' edge ids via the geometry-key map; vehicles referencing vanished edges despawn (counted in `disconnectedTrips`; the citizen's trip is cancelled). Vehicle views and the `roads` message carry `topologyVersion`; the renderer keeps the previous graph until no vehicle view references it.
- Congestion epoch system (interval 64, offset 12; phase 3): recompute buckets for all edges; if any bucket changed, congestionEpoch++ (new paths see new costs; existing vehicles keep their route).

## Fields (civ-engine Layer<number>)

| Field | blockSize | cadence | rule |
|---|---|---|---|
| pollution | 2 | interval 8, offset 0 | decay x0.88, then each non-abandoned industrial building adds 6 x level at its block with radial falloff (radius 3 blocks, linear); coal plant adds 30. Clamp 0..100. |
| noise | 2 | interval 8, offset 6 | decay x0.85; road cells emit 1 + 2 x congestionBucket; non-abandoned commercial adds 4 x level. Clamp 0..100. |
| landValue | 4 | interval 16, offset 12 | value = 30 + 15 x nearWater(≤6 cells) + 8 x serviceCoverageCount + 4 x nearTrees(≤3) - 0.4 x pollution - 0.25 x noise, clamp 0..100. nearTrees reads the derived tree view (initial mask minus claimed footprints; see Map). |
| coverage x4 | 4 | rebuilt on service build/demolish | 1 inside service radius, else 0. |

Layer states are mirrored into components on a dedicated singleton "mirror" entity — one component per layer, written only on that layer's recompute cadence — so save/load and replay stay correct. Components rather than world state because world-state values are JSON-fingerprinted twice per tick by the engine, while component diffs are dirty-flag-only. OccupancyGrid and other derived maps are NOT mirrored; `rebuildDerived` reconstructs them from entities.

## Services (player-placed, 2x2 footprint, must touch a road)

| Service | Cost | Upkeep/interval | Radius (cells) | Effect |
|---|---|---|---|---|
| Fire station | 400 | 8 | 24 | coverage → desirability + land value |
| Police station | 400 | 8 | 24 | same |
| Clinic | 500 | 10 | 32 | same |
| School | 500 | 10 | 32 | same + gates building level 3 |

No fire/crime/health incidents in v1 (documented later-phase candidates).

## Utilities

- Power: coal plant (800, upkeep 16, capacity 400 units, pollution source, 3x3 footprint) and wind turbine (300, upkeep 6, capacity 40, 1x1). Power line cost 4/cell. Conduction network = plant footprints + power line cells + powered building footprints; a building is connected if its footprint is within Chebyshev 2 of the network. Recomputed by flood-fill (interval 8, offset 7; phase 5). Demand: 1 unit x level x footprintCells per building; if total connected demand exceeds capacity, buildings are powered in ascending entity-id order until budget exhausts (deterministic brownout).
- Water: pump (500, upkeep 10, capacity 300 units, must be orthogonally adjacent to water) and pipes (3/cell, placeable on any land cell incl. under roads/buildings — pipes are a separate sub-grid overlay). Building connected if footprint within Chebyshev 2 of a pipe network reachable from a pump. Flood-fill (interval 8, offset 1; phase 5). Demand 1 x level x cells. No separate sewage in v1.
- Unpowered or unwatered buildings cannot level up and accumulate abandonment (see Zoning; utilities-only lack has the longer 30-evaluation grace); they render a bounce icon (⚡/💧) like the reference game.

## Economy

- Treasury starts at 20,000. Each budget interval (1024 ticks; budget system interval 1024, offset 0): income = Σ buildings taxRate(zone)/100 x taxBase x level x footprintCells, taxBase R 20, C 30, I 30 (abandoned pay nothing); expenses = Σ upkeep (services, utilities) + ROAD_UPKEEP_PER_CELL x road cells, where ROAD_UPKEEP_PER_CELL = 0.1 per budget interval (the single authoritative road-upkeep value; § Roads references it by name). Tax sliders per zone 0–20%, default 9%.
- Placement validators reject any purchase the treasury cannot cover. Treasury may go negative from upkeep; while negative, all purchases are blocked EXCEPT power and water items (plants, lines, pumps, pipes) — a broke, unpowered city otherwise has no income path and would soft-lock unrecoverably — and a "city is broke" warning shows.

## UI surface (v1)

Toolbar: select/inspect, road, bulldoze, zone R/C/I, dezone, services x4, coal/wind, power line, pump, pipe. Top HUD: treasury (+ per-interval delta), population, RCI demand bars, day counter, speed controls. Overlays menu: pollution, noise, land value, power, water, traffic (edge congestion coloring). Click a building → info panel (zone, level, residents/jobs, powered/watered, score inputs). Event toasts from sim events (first building grown, building abandoned, broke, disconnected trips).

## Save/load

`world.serialize()` (layer states already mirrored into the singleton mirror entity's components; OccupancyGrid and other derived maps are NOT mirrored — `rebuildDerived` reconstructs them from entities) + game meta {saveVersion: 1, seed, engineVersion}. One localStorage slot + JSON export/import. Load = fresh world via world-factory, `applySnapshot`, `rebuildDerived` (road graph from road cells, layers from mirror components, occupancy from entity footprints).

## Definition of "fully functioning" (v1 acceptance)

From an empty map a player (or the automated playtest) can: build a road network, zone, place power+water, and reach ≥ 1,000 population with visibly moving traffic; congestion emerges when overloading one artery and re-routes after building an alternative; overlays reflect sim fields; taxes/upkeep produce a live budget that can go broke and recover; save → reload reproduces the city; determinism self-check passes; 128x128 city at target scale holds ≥ 30 fps render / 20 TPS sim on this dev machine.
