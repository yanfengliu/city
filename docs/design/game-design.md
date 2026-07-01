# Game Design

All numeric values here are initial tuning values and live in `src/sim/constants/`; playtesting adjusts constants, not this doc, unless a mechanic changes shape. RNG: every stochastic choice uses `world.random()`. All cadenced systems declare `interval`/`intervalOffset` as listed to stagger load.

## Map and time

- Fixed grid 128x128 cells. 1 cell ≈ 8 m; 1 cell = 1 render unit. Sim runs at 20 TPS; speeds pause/1x/2x/4x (engine speed control; renderer unaffected).
- Terrain: seeded simplex elevation in [0,1]; water where elevation < 0.35; everything else is flat buildable land. Tree mask: land cells where a second noise octave > 0.62 get decorative trees (removed automatically when the cell is built on). Map edges guaranteed to contain at least one water body ≥ 60 cells (re-roll seed offset until true) so water pumps and water-proximity value always exist.
- Day = 2048 ticks (visual day/night only). Budget interval = 1024 ticks (income and upkeep are defined per budget interval).

## Roads

- One road type in v1: two-lane road. Cost 10/cell, upkeep 0.5/cell per budget interval... (see Economy for scale). Placement: click-drag produces an L-shaped cell path (dominant axis first); each cell becomes a road cell. Validators: cells are land, in unlocked area (v1: whole map), not water, not occupied by a building footprint; treasury covers total cost. Bulldozing a road cell refunds 25%.
- Road graph (game-owned, not engine): nodes at road cells whose road-neighbor count ≠ 2 or whose 2 neighbors are non-collinear (corners); edges are maximal straight runs between nodes, weight = cell count. Full rebuild on any road change; `topologyVersion++`; path cache cleared. Cells store their containing edge id for O(1) access-node lookup.
- Edge capacity = 6 vehicles per cell of length. Congestion c = vehiclesOnEdge / capacity, quantized to buckets 0–3 at thresholds 0.4 / 0.75 / 1.0.

## Zoning and building growth

- Zones: residential (R), commercial (C), industrial (I), low density. Zone tool paints land cells within Chebyshev distance 3 of a road cell; dezone erases. Zoning is free; zoned cells render as colored grid tint (R green, C blue, I yellow-orange).
- Growth system (interval 4, offset 1): while zone demand > 0, up to 4 growth attempts per run per zone type. An attempt picks a random zoned, empty, road-adjacent (4-dir) cell; tries a 2x2 footprint of same-zone empty cells first, else 1x1; requires footprint free in OccupancyGrid. Spawns a level-1 building entity with the footprint blocked, facing its road.
- Capacity per building = perCellBase(zone, level) x footprintCells. Residents (R): L1 3, L2 5, L3 8 per cell. Job slots: C L1 2, L2 4, L3 6; I L1 3, L2 5, L3 7 per cell.
- Desirability score per building, evaluated by the level system (interval 16, offset 5): `score = 0.5 x landValue(cell) + 8 x serviceCoverageCount(0–4) + 10 x (powered && watered) - taxPenalty`, where taxPenalty = 2 x max(0, taxRate(zone) - 9). Level-up to 2 at score ≥ 45 for 3 consecutive evaluations; to 3 at score ≥ 70 for 3 consecutive evaluations AND education coverage. Level-down at score < 25. Abandonment: score < 12, or unpowered-or-unwatered, for 10 consecutive evaluations → abandoned (no taxes, evicts residents/jobs, grey render). Recovery: 5 consecutive healthy evaluations un-abandons at level 1. Bulldoze always allowed (no refund for grown buildings).
- Industrial buildings emit pollution; commercial emit noise (see Fields).

## Demand (RCI)

Recomputed every 32 ticks (offset 9). Let P = population, H = housing capacity, jobsTotal/jobsFilled, U = unemployed citizens, V = H - P (vacancy).

- R = clamp[-1,1]( (0.8 x (jobsTotal - jobsFilled) + 12 - 0.5 x V) / 50 ) - taxDemandPenalty(R)
- C = clamp[-1,1]( (0.10 x P - commercialJobSlots) / 30 ) - taxDemandPenalty(C)
- I = clamp[-1,1]( (1.2 x U + 0.03 x P - 0.4 x industrialJobSlots) / 40 ) - taxDemandPenalty(I)
- taxDemandPenalty(zone) = 0.05 x max(0, taxRate(zone) - 9). Growth requires demand > 0 for that zone.

## Citizens and employment

- One citizen entity ≈ one household of 3 people (population display = 3 x citizens). Components: home (building id), work (building id | none). Target scale ≤ 2,000 citizen entities (≈ 6,000 population).
- Move-in system (interval 8, offset 3): if R demand > 0 and vacancies exist, spawn `min(freeCapacityShare, 1 + floor(Rdemand x 5))` citizens into residential buildings with space (deterministic pick via world.random). Move-out: abandoned/bulldozed homes evict; evicted citizens leave the city (despawned) if no vacancy found within one evaluation.
- Employment system (interval 8, offset 4): assigns unemployed citizens to buildings with free job slots, nearest-first (findNearest over job buildings), up to 32 assignments per run. Bulldozed/abandoned workplaces unassign their workers.

## Traffic

- Trip system (interval 8, offset 2): each run, up to 24 employed citizens without an active trip (deterministic rotation by entity id) start a commute round trip: request path homeAccessNode → workAccessNode. Global cap: 600 concurrent vehicles; requests beyond cap wait (FIFO). Unroutable trips cancel and increment a `disconnectedTrips` counter (surfaced in UI as a warning).
- Pathfinding: `findPath` over the road graph (nodes/edges), batched via a `PathRequestQueue` budgeted at 8 resolutions/tick; cache key (from, to, congestionEpoch) with passabilityVersion = topologyVersion x 1024 + congestionEpoch. Edge cost = length x (1 + 0.5 x congestionBucket).
- Vehicles: entity with `travel` component {path: edgeId[], edgeIndex, t ∈ [0,1), speed}. Per tick: advance t by (cellsPerTick / edgeLength); cellsPerTick = 0.35 x max(0.25, 1 - 0.25 x bucket(currentEdge)). Engine position = integer cell under current travel position (for spatial queries); renderer reads `travel` for smooth interpolation. On edge change, update per-edge vehicle counts. Arrival: vehicle despawns, citizen waits 64–128 ticks at destination, then return trip; after returning, cooldown 256–512 ticks before next commute roll.
- Congestion epoch system (interval 64, offset 12): recompute buckets for all edges; if any bucket changed, congestionEpoch++ (new paths see new costs; existing vehicles keep their route).

## Fields (civ-engine Layer<number>)

| Field | blockSize | cadence | rule |
|---|---|---|---|
| pollution | 2 | interval 8, offset 0 | decay x0.88, then each industrial building adds 6 x level at its block with radial falloff (radius 3 blocks, linear); coal plant adds 30. Clamp 0..100. |
| noise | 2 | interval 8, offset 6 | decay x0.85; road cells emit 1 + 2 x congestionBucket; commercial adds 4 x level. Clamp 0..100. |
| landValue | 4 | interval 16, offset 10 | value = 30 + 15 x nearWater(≤6 cells) + 8 x serviceCoverageCount + 4 x nearTrees(≤3) - 0.4 x pollution - 0.25 x noise, clamp 0..100. |
| coverage x4 | 4 | rebuilt on service build/demolish | 1 inside service radius, else 0. |

Layer states are mirrored into `world.setState('<name>Layer', ...)` on each recompute cadence so save/load and replay stay correct.

## Services (player-placed, 2x2 footprint, must touch a road)

| Service | Cost | Upkeep/interval | Radius (cells) | Effect |
|---|---|---|---|---|
| Fire station | 400 | 8 | 24 | coverage → desirability + land value |
| Police station | 400 | 8 | 24 | same |
| Clinic | 500 | 10 | 32 | same |
| School | 500 | 10 | 32 | same + gates building level 3 |

No fire/crime/health incidents in v1 (documented later-phase candidates).

## Utilities

- Power: coal plant (800, upkeep 16, capacity 400 units, pollution source, 3x3 footprint) and wind turbine (300, upkeep 6, capacity 40, 1x1). Power line cost 4/cell. Conduction network = plant footprints + power line cells + powered building footprints; a building is connected if its footprint is within Chebyshev 2 of the network. Recomputed by flood-fill every 8 ticks (offset 7). Demand: 1 unit x level x footprintCells per building; if total connected demand exceeds capacity, buildings are powered in ascending entity-id order until budget exhausts (deterministic brownout).
- Water: pump (500, upkeep 10, capacity 300 units, must be orthogonally adjacent to water) and pipes (3/cell, placeable on any land cell incl. under roads/buildings — pipes are a separate sub-grid overlay). Building connected if footprint within Chebyshev 2 of a pipe network reachable from a pump. Flood-fill every 8 ticks (offset 11). Demand 1 x level x cells. No separate sewage in v1.
- Unpowered or unwatered buildings cannot level up and accumulate abandonment (see Growth); they render a bounce icon (⚡/💧) like the reference game.

## Economy

- Treasury starts at 20,000. Each budget interval (1024 ticks): income = Σ buildings taxRate(zone)/100 x taxBase x level x footprintCells, taxBase R 20, C 30, I 30 (abandoned pay nothing); expenses = Σ upkeep (services, utilities) + 0.5/road cell... = roads 0.05/cell. Tax sliders per zone 0–20%, default 9%.
- Placement validators reject any purchase the treasury cannot cover. Treasury may go negative from upkeep; while negative, all purchases are blocked and a "city is broke" warning shows.

## UI surface (v1)

Toolbar: select/inspect, road, bulldoze, zone R/C/I, dezone, services x4, coal/wind, power line, pump, pipe. Top HUD: treasury (+ per-interval delta), population, RCI demand bars, day counter, speed controls. Overlays menu: pollution, noise, land value, power, water, traffic (edge congestion coloring). Click a building → info panel (zone, level, residents/jobs, powered/watered, score inputs). Event toasts from sim events (first building grown, building abandoned, broke, disconnected trips).

## Save/load

`world.serialize()` (layers/occupancy already mirrored into world state) + game meta {saveVersion: 1, seed, engineVersion}. One localStorage slot + JSON export/import. Load = fresh world via world-factory, `applySnapshot`, rebuild derived caches (road graph, layers from state, occupancy).

## Definition of "fully functioning" (v1 acceptance)

From an empty map a player (or the automated playtest) can: build a road network, zone, place power+water, and reach ≥ 1,000 population with visibly moving traffic; congestion emerges when overloading one artery and re-routes after building an alternative; overlays reflect sim fields; taxes/upkeep produce a live budget that can go broke and recover; save → reload reproduces the city; determinism self-check passes; 128x128 city at target scale holds ≥ 30 fps render / 20 TPS sim on this dev machine.
