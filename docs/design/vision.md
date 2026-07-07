# Vision

## What this is

A browser city-building game in the spirit of Cities: Skylines: the player draws roads, paints residential/commercial/industrial zones, places services and utilities, and watches a living city grow — buildings sprout along roads, citizens commute, traffic congests, pollution drifts, land value shifts, and the budget breathes. The clone targets the *feel* of the core loop and a recognizable 3D presentation, built with original code and art direction.

## Pillars

1. **The city is alive.** Growth, traffic, and fields respond continuously to the player's decisions. Cause and effect are observable: zone next to industry and watch land value sink; add a road and watch traffic reroute.
2. **Simulation you can trust.** The sim is deterministic, headless, and testable. Every mechanic has a contract test. What the renderer shows is a faithful projection of sim state.
3. **Readable 3D.** Low-poly, clean-silhouette buildings with zone-coded accents, smooth vehicle motion, soft daylight. Clarity over realism — the reference is Cities: Skylines' readability, not its asset fidelity.
4. **Painterly strategy readability.** Visual polish may borrow broad lessons from Age of Empires II: Definitive Edition screenshots: isometric-friendly framing, warm earth and grass, red-tile roofs, timber/stone contrast, busy-but-legible terrain, and bright strategic-game readability. This is a material-language reference only: no copied assets, silhouettes, UI, names, or source art.
5. **Desktop browser, instant play.** One canvas, no landing page, no install. 60 fps render on a mid-range laptop with a mid-size city.

## Player fantasy and loop

Mayor of a growing town. Minute-to-minute: draw roads → zone → watch demand bars → place a service or utility when growth stalls → adjust taxes when money runs short → fix the intersection everyone is honking at. Session goal: a functioning city of a few thousand citizens with visibly flowing traffic and healthy budget.

## Scope stance (v1)

- Grid-aligned roads only (freeform splines are a possible later phase; the sim design must not preclude them).
- Low-density RCI zoning, growable 1x1–2x2 buildings, 3 building levels.
- Agent-based traffic on the road graph with congestion feedback; target ~1–3k active vehicles+citizens.
- Power and water networks, four coverage services, pollution/noise/land-value fields, taxes and upkeep.
- Save/load. Speed controls. Overlay views. Day/night lighting as polish.
- Out of scope for v1: public transport, terrain sculpting, districts/policies, disasters, high-density zoning, freight economy chains, mobile.

## Non-negotiables

- Sim in a Web Worker on civ-engine; renderer consumes snapshots/diffs only.
- Automated playtesting hooks (`window.render_game_to_text()`, `window.advanceTime(ms)`) from the first playable build.
- Deterministic: same seed + same commands = same city, verified by replay self-check in CI.
