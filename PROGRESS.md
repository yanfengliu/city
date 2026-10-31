# PROGRESS

## Original prompt (2026-07-01)

> I want to build a city skyline clone both in terms of behavior and graphics. […] grid-aligned roads for now are ok. 3d graphics yes. Learn from other repos' AGENTS.md and CLAUDE.md and form your own. Write down necessary design, specs, and roadmaps to docs then start working. /goal do not stop until you have a fully functioning game.

Decisions locked: grid-aligned roads, 3D (Three.js), sim on civ-engine (file:../civ-engine) in a Web Worker, conventions distilled from civ-engine/town/townscaper/civ-sim-web AGENTS docs.

## Status

- [x] Conventions: AGENTS.md + CLAUDE.md written.
- [x] Design docs: vision, game-design, architecture, roadmap written.
- [x] Design docs adversarially reviewed against civ-engine API (23 confirmed findings folded in).
- [x] Phase 0 — scaffold
- [x] Phase 1 — rolling terrain + roads (browser-verified: elevated road drag, terrain-aware picking, and bulldoze with exact refund)
- [x] Phase 2 — zoning + growth + demand + citizens (browser-verified: 48 buildings, 96 population, demand bars, inspect panel)
- [x] Phase 3 — employment + traffic (browser-verified: vehicles commuting, 49 employed, disconnectedTrips 0)
- [x] Phase 4 — fields + services (browser-verified: pollution overlay hazes industry, fire+school placed)
- [x] Phase 5 — utilities + economy (browser-verified: coal+lines+pump+pipes power/water the town; 66 sim tests; fixes: power lines may cross roads, budget first fires at tick 1024, roadsChanged payload emptied for replay determinism — caught by the new SessionReplayer.selfCheck gate)
- [x] Phase 6 — save/load (browser-verified: exact restore incl. treasury float), Save/Load/New buttons, pause/4x verified, day/night cycle
- [x] Deep citizen identity and inspection — named persistent residents, selectable visible walkers, biographies, home/work/destination evidence, legacy-save truth, residential cycling, and generation-safe live inspection are browser-verified and covered by the four gates.
- [x] Community gardens and profile-shaped green leisure — road-served parks and gardens have distinct economics, coverage overlays, models, and household outing preferences while sharing one non-stacking green-space benefit.
- [x] Phase 7 — verification and hardening, including final-source nominal-60-Hz presentation acceptance.

- [ ] v1.1 — Living Days (direction 2026-08-17): daily routines on a shared city clock, from which rush hour and school runs emerge. Model and contracts in `simulation-realism.md` § Daily routines; phase order in `roadmap.md` § v1.1.
  - [x] D1 — routines on the clock (2026-08-17, browser-verified): `cityClock(tick)` in `src/protocol/` drives sun, HUD ("Day N · HH:MM"), and the trip system alike; commutes depart in the morning window by identity-hashed offsets, return in the evening, outings fill day/evening, nights rest. Emergent rush hour pinned by `tests/sim/rush-hour.test.ts` (seed-3 organic city: morning peak 23, evening peak 27, night mean 0.0) and photographed live (02:29 empty dark streets / 07:20 morning commute, 34 cars + 28 walkers / 17:23 evening rush). No save-format change; replay gate green; worker budget consciously raised 150k → 158k for the feature. Midday streets measure ~0 by honest consequence of the household-scale model — every household is at work — which is exactly what D2's member lives fill.
  - [x] D3 — routines feed back (2026-08-18, browser-verified): school arrivals credit `completedSchoolTrips` and stamp the home building's `schoolingTick`; education progression needs coverage AND a current stamp, so a covered-but-unreachable school stops levelling buildings instead of silently pretending (closes the D2 review's finding 3). Groceries proven by arrival join happiness. `routineGap` ('school' | 'shop') diagnoses a missing destination separately from `strandedAt` — different cause, different fix, different advisory. Contracts in `tests/sim/routine-feedback.test.ts`; 4 of 6 go red with the D3 write sites disabled. No saveVersion bump: optional component fields, legacy stamps read as satisfied. **Worker budget now 157,158 / 158,000.**
  - [x] D2 — simultaneous member lives (2026-08-18, browser-verified): the appended `memberTrip` component gives non-primary members their own generation-guarded slots — a child/teen walks to the covering school in the morning window (identity-hashed per-member offsets), dwells to the 15:00 bell, and walks home while the household's own slot keeps commuting. School choice = the education coverage field itself gates attendance (so overlay, growth's `educated`, and attendance cannot drift apart), then the nearest school SHARING THE HOME'S ROAD COMPONENT by the `nearestVenues` ranking; no covering or no reachable school means the child stays home. Walkers carry a `school` purpose (its own wardrobe palette, wired into `pedestrianStyle` by purpose — see the 2026-08-18 review; counted in `pedestrianPurposes`); the citizen panel roster names each member's whereabouts ("at school — School"). Contracts in `tests/sim/school-runs.test.ts` (simultaneity, window timing, no-school, slot↔walker invariant, mid-walk save/load equality, legacy snapshots load as everyone-home, determinism, purpose vocabulary) — mutation-checked (4 fail with the member pass disabled). No saveVersion bump: append-only component registration per the citizenProfile precedent.

v1 COMPLETE. The full acceptance checklist is covered: **≥ 1,000 population with commuting traffic** (`tests/sim/acceptance.test.ts` — a balanced road-grid city reaches ~1,000+ pop by tick ~2000, peaking ~4,900; all three zones grow, commuters flow, 0 stranded trips), congestion emerges + relieves (`congestion.test.ts`), overlays match sim fields (`fields.test.ts` + browser), budget goes broke + recovers (`utilities.test.ts` broke-escape + `economy.test.ts`), save → reload reproduces exactly (`replay.test.ts` + `utilities` save/load), determinism self-check is green (`replay.test.ts` gate + the harness `selfCheck` — 14 segments/0 divergences live), the headless sim exceeds 20 TPS at scale, and the fresh-build final-source presentation gate passes all six pause/1×/4× profiles at device DPR 1 and 2. Everything else the game could add (public transport, districts/policies, incidents, freight, player terrain sculpting/slope gameplay, freeform roads, audio) is **explicitly out of v1** per `roadmap.md`.

## Log

The dated log this file kept, from 2026-07-01 to 2026-08-23, is in [docs/devlog/progress-log.md](docs/devlog/progress-log.md), newest first. History since 2026-08-17 is in the devlog, [docs/devlog/summary.md](docs/devlog/summary.md).
