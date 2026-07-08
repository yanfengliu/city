# LLM playtest -> annotate -> replay -> improve harness

A harness that lets an LLM drive the running game through player-surface automation hooks, record evidence-rich findings tied to exact game ticks, replay the recorded session deterministically, verify or reject claims, and carry confirmed findings into the recursive self-improvement loop.

## Prior art

Both were studied before building this (`../civ-engine`, `../aoe2`).

**civ-engine** provides the whole record/replay substrate — this harness is thin glue over it:

- `SessionRecorder({ world, sink, snapshotInterval })` — `connect()` wraps `world.submitWithResult` and listens to per-tick diffs/executions, writing an initial snapshot, periodic snapshots (default every 1000 ticks), and a terminal snapshot. `addMarker(NewMarker)` records an annotation at a tick with optional `refs` (entities/cells/tickRange) and arbitrary `data: JsonValue`. `toBundle()` returns a `SessionBundle`.
- `SessionReplayer.fromBundle(bundle, { worldFactory })` — `openAt(tick)` returns a paused, queryable `World` replayed to that tick; `selfCheck()` runs a 3-stream determinism check (serialized state vs events vs command executions) and pinpoints the first differing path.
- `snapshotAtTick(bundle, tick)` — folds tick diffs from the nearest snapshot to return the `WorldSnapshot` at any tick **without constructing a World** (pure data).
- The `Marker` primitive + a read-only **MCP corpus server** for offline bundle interrogation.
- The v1.3.0 **visual playtest loop contracts** (`VisualPlaytestHost`, `VisualPlaytestObservation`, `VisualPlaytestAction`, `VisualPlaytestFinding`, `runVisualPlaytestLoop`) — zero-dependency interfaces for browser-game agents that need screenshot/text/control/state observations plus real player-surface actions.
- The v1.4.0 **recursive improvement finding contracts** (`ImprovementFinding`, `ImprovementEvidenceRef`, `improvementFindingToMarker`, `improvementFindingsFromMarkers`) — the cross-game payload for findings that must survive past a single visual report and enter the run -> record -> find -> verify -> classify -> promote/propose -> rerun -> compare -> learn loop.
- Determinism contract (all input via `world.submit()`, all randomness via `world.random()`, no wall-clock in systems, sliced/queue state lives in components) — the city already honors it; `tests/sim/replay.test.ts` is the project's `selfCheck` gate.

**aoe2** proves the end-to-end shape for an LLM and supplies the patterns we copy:

- In-browser agent API (`window.__AOE2_TEST__`): a **bounded** text snapshot, `advanceTicks(n)` with the sim **paused between calls**, `dispatchAgentCommand` with **rejection feedback fed back** to the next decision, and `getRecorderBundle()` to export the session.
- Findings are structured (`category / area / observed / expected / severity / suggestion`) and are **injected into the bundle as engine `Marker`s**, so the replay timeline renders them for free — no bespoke annotation store. City now writes the shared `ImprovementFinding` envelope for new runs and only reads legacy city payloads when migrating old bundles.
- A headless `replay-inspect` script opens the bundle at sampled ticks and prints ground-truth state; findings are grounded in deterministic metrics computed from the trace before any LLM judgement.

## How it maps onto the city

The city runs the sim in a Web Worker; the main thread drives it with `{type:'command'}` / `advance` messages and observes via `render_game_to_text()` + frame diffs. So:

- **Record** lives in the worker: a `SessionRecorder` connected to `world` from boot, torn down and restarted on New/Load (each city is one session, seeded by `currentSeed`).
- **Annotate** is a main-thread -> worker message that normalizes a `CityImprovementFindingInput`, maps it into civ-engine's shared `ImprovementFinding`, and calls `recorder.addMarker(improvementFindingToMarker(...))` with the worker's current tick. New markers do not emit `data.playtestFinding`; that shape is read only for old bundles.
- **Replay-debug** is `inspectAt(tick)`: the worker folds `snapshotAtTick(recorder.toBundle(), tick)` into a throwaway probe sim (the live world is untouched) and returns the exact deterministic `simSummary` there — so you can jump to any finding's tick and read ground-truth state without a world swap.
- **Verify** with `SessionReplayer.selfCheck()` — the same check the project already gates on.

> **Tick anchoring.** The sim runs in the worker; `render_game_to_text().tick` (client mirror) lags the worker's `world.tick` by the async round-trip. `annotate` anchors to the *worker's* tick, so always inspect via `finding.tick` from `findings()` — not a client-side tick you read yourself.

Nothing new is needed on the determinism side; the sim is already replay-clean.

## `window.__harness` (main thread)

Installed **only in the dev build** (`import.meta.env.DEV`), matching the DEV-gated worker recorder — a production build carries no harness.

| Method | Purpose |
|---|---|
| `state()` | Bounded JSON game state (alias of `render_game_to_text()`). |
| `advance(ms)` | Step the sim forward (alias of `advanceTime`); the sim otherwise runs at the HUD speed. |
| `command(name, data)` | Submit a sim command by name (the same path the tools use). |
| `annotate(finding)` | Record a `CityImprovementFindingInput` as a shared recursive-loop marker at the current worker tick. Defaults are conservative: `verificationStatus: "unverified"`, `nextAction: "proposalOnly"`, `disposition: "candidate"`. |
| `findings()` | The findings recorded this session (authoritative worker ticks), each with city-local input fields plus a canonical `improvement: ImprovementFinding` payload. |
| `inspectAt(tick)` | Replay to `tick` and resolve the exact deterministic state there (`{ tick, summary }`); the tick is clamped to the recorded range, and `summary` is `null` (with `error`) if folding fails, so the call always settles. Also stashed on `lastInspection`. |
| `selfCheck()` | Run civ-engine's 3-stream determinism check over the recorded session; returns `{ ok, checkedSegments, ... }` (or `null` + `error` on failure). Also stashed on `lastSelfCheck`. |
| `getBundle()` | The full annotated `SessionBundle` (commands + snapshots + markers) for offline analysis / regression; also stashed on `lastBundle`. |
| `visualHost()` | Returns a civ-engine `VisualPlaytestHost` adapter over this same harness. `observe()` captures `player.screenshot()`, visible text, HUD controls, and explicit state channels; `performAction()` maps only to player-surface actions (`player.hud`, `clickAt`, `dragAt`, `key`, `advance`) and never calls the `command` backdoor; `annotate()` converts `VisualPlaytestFinding` into the city shape, then the marker writer promotes it into `ImprovementFinding`. |

The async methods (`inspectAt` / `selfCheck` / `getBundle`) return a Promise **and** stash their result on `last*`, so an automation eval can trigger then read the stash a beat later (Promises don't survive a `preview_eval` boundary). Each reply is **id-correlated**, so overlapping calls resolve to their own request rather than mis-matching.

### See & control like a player — `__harness.player`

`command` submits sim commands directly, skipping the UI. To playtest the *actual player experience* — and catch UI bugs (picking, ghost validity, tool state, buttons, shortcuts) that the backdoor masks — drive the game through `__harness.player`, which dispatches **real** pointer / keyboard / click events on the live DOM and returns a screenshot of exactly what the player sees.

| Method | Player action |
|---|---|
| `screenshot(q?)` | JPEG data URL of the rendered scene — the player's-eye view. Pumps a full presentation frame first (view sync, vehicle interpolation, level-up FX fade, camera flight) so the capture is a **live** frame, then renders. This matters headless: a playtest tab isn't painting, so the rAF loop is stopped — a bare render would freeze time-based visuals (stale vehicle positions, level-up labels that never fade). Capturing IS the frame tick, so animation advances by real wall-clock between successive screenshots, not on its own. |
| `where(x, y)` | Screen pixels for the centre of sim cell (x, y) — aim clicks at map features. `onScreen` is false if off-view. |
| `cellAt(sx, sy)` | The sim cell under a pixel (inverse of `where`). |
| `hud(label)` | Click a HUD button by visible label — "Road", "Zone R", "Coal ⚡", "2×", "Pollution", "💰 Budget", "💾 Save"… |
| `key(k)` | Press a key — a tool shortcut, `w`/`a`/`s`/`d` camera pan, `Escape`. |
| `dragMap(from, to)` | Left-drag across the map (roads, zones, lines, pipes, bulldoze, dezone). Select the tool with `hud`/`key` first. |
| `tapMap(cell)` | Left-click one cell — place a service/plant/pump, or inspect with Select. |
| `clickAt(sx,sy)` / `dragAt(sx1,sy1,sx2,sy2,button?)` | Raw-pixel gestures. |

The camera must **frame** a cell for `where`/`dragMap`/`tapMap` to reach it — you can't click what's off-screen, same as a human — so position the camera (and set an explicit viewport; a 0-size canvas makes projection NaN) before acting. Map gestures round-trip through the real `GroundPicker` (pixel → cell), so the screen↔world mapping is exact. Sim commands are async — read `state()` a beat after acting, not in the same tick.

### civ-engine visual playtest adapter

`src/harness/visual.ts` is deliberately small glue between the existing city harness and civ-engine's generic visual loop. The observation includes the screenshot data URL, a visible-text summary derived from `state()`, DOM-discovered HUD buttons when running in a browser (with static fallbacks for tests), a `Map/canvas` control for supported click/drag actions, a keyboard control, and state channels: `render_game_to_text` for the agent plus reviewer/trace-only channels for recorded findings and the latest replay diagnostics.

Action mapping preserves the "real player surface" rule: `click` with `target: "hud:<label>"` calls `player.hud(label)`, `click` with `point` calls `player.clickAt`, `drag` calls `player.dragAt`, `key` calls `player.key`, `wait` calls `advance(ms)`, and `stop` returns success. Unsupported generic actions (`hover`, `type`, `wheel`, `select`, `viewport`) are not advertised and still fail closed if supplied directly, so a loop cannot silently use a capability the city has not exposed. The adapter intentionally does not call `command(name,data)`.

## Finding format (`CityImprovementFindingInput`)

```ts
interface CityImprovementFindingInput {
  category: 'bug' | 'balance' | 'ux' | 'missing-feature' | 'visual' | 'perf';
  severity: 'low' | 'medium' | 'high';
  area: string;                  // free-form subsystem, e.g. 'onboarding', 'traffic', 'economy'
  observed: string;              // what the run showed
  expected?: string;             // what should have happened
  suggestion?: string;           // proposed improvement / next step
  verificationStatus?: 'unverified' | 'verified' | 'falsePositive' | 'fixed' | 'regressed';
  nextAction?: 'proposalOnly' | 'autoFix' | 'manualFix' | 'observeMore' | 'none';
  disposition?: 'candidate' | 'accepted' | 'rejected' | 'deferred' | 'wontFix';
  evidence?: ImprovementEvidenceRef[];
  sourceRun?: ImprovementRunManifest;
  refs?: MarkerRefs;
}
```

The city-facing type stays compact so visual agents can annotate quickly, but the marker writer promotes it into civ-engine's v1.4.0 `ImprovementFinding` contract. Defaults are deliberately cautious: new observations start as `unverified`, `proposalOnly`, and `candidate` until replay/state/screenshot evidence confirms them. The older `PlaytestFinding` type and legacy helper names remain as deprecated aliases only; do not use them for new loop code.

Stored as a civ-engine `Marker` with standardized payloads: `data.improvementLoop` for the recursive loop and `data.visualPlaytest` for visual reports. New markers intentionally do not write `data.playtestFinding`; `findingsFromMarkers()` only reads that old payload when migrating legacy bundles, synthesizes a current `ImprovementFinding`, and still falls back to `visualPlaytestFindingsFromMarkers()` for visual-only markers.

## Headless summary

`simSummary(world)` (in `src/sim/summary.ts`) reads a compact text state straight from a `World` — pop, treasury, demand, buildings by zone/level, abandoned, employed, vehicles, roads, structures, disconnected trips. It needs no browser, so the replay-inspect test/tool can print ground-truth state at any replayed tick.

## The loop

The city harness follows civ-engine's AI-native core loop:

```text
run -> record -> find -> verify -> classify -> promote/propose -> review -> rerun -> compare -> learn
```

1. **Run through the player surface** - use `__harness.visualHost()` or `__harness.player` for real screenshots, HUD clicks, map drags, keys, and waits. Use `command(name,data)` only when testing sim mechanics rather than player experience.
2. **Record evidence** - every dev harness run is recorded in the worker by `SessionRecorder`; visual observations include screenshot, visible text, controls, hidden-state channels, prior findings, and last replay diagnostics.
3. **Find and annotate** - on noticing something, call `__harness.annotate({ category, severity, area, observed, expected, suggestion, evidence })`. The worker anchors it to the authoritative tick and stores a shared `ImprovementFinding`.
4. **Verify before acting** - call `__harness.inspectAt(finding.tick)` and `__harness.selfCheck()` before treating the finding as real. A self-check failure is a determinism bug, not evidence about game design. A finding that cannot be reproduced should stay `unverified` or become `falsePositive`.
5. **Classify next action** - set or update `verificationStatus`, `nextAction`, and `disposition` when evidence is strong enough: `manualFix` for code work, `autoFix` only for bounded safe edits, `observeMore` for weak evidence, `proposalOnly` when the agent should report but not edit.
6. **Promote or propose** - confirmed failures should become tests, replay fixtures, or a focused implementation plan. Unconfirmed observations stay in the bundle as evidence but should not drive a fix by themselves.
7. **Review and rerun** - after a change, rerun the focused scenario, `selfCheck`, and the project gates. Compare the new behavior against the old finding tick or metric instead of relying on vibes.
8. **Learn** - export `__harness.getBundle()` when the run should survive. The bundle is the evidence ledger: commands, snapshots, markers, screenshots/sidecars when present, and loop findings that future agents can query.

## Verified by

`tests/harness/replay-harness.test.ts` records a scripted session, annotates a marker, replays via `SessionReplayer`, asserts `selfCheck().ok`, and checks `simSummary` at the marker tick — the whole pipeline, browser-free. It also pins the v1.4.0 `ImprovementFinding` payload, visual marker compatibility, the absence of new `data.playtestFinding` payloads, and synthetic improvement payloads for legacy city markers.

`src/harness/dogfood.ts` exposes `dogfoodRecursiveImprovementLoop()`, a headless dogfood runner for the full recursive loop. It builds a deterministic city session, records it with `SessionRecorder`, runs `runVisualPlaytestLoop()`, stores a verified/accepted `ImprovementFinding`, takes a terminal snapshot, checks replay determinism, inspects the finding tick, and returns a before/after comparison so reruns can prove behavior did not regress. The replay-harness test calls this helper directly; it is the executable evidence path for `run -> record -> find -> verify -> classify -> rerun -> compare` without needing a live browser.

`tests/harness/visual-host.test.ts` verifies the civ-engine visual host adapter browser-free: observations include screenshot/text/controls/state channels, and `runVisualPlaytestLoop()` drives HUD clicks, point clicks, drags, keys, waits, stops, and annotations through the existing `player`/`advance` surface without touching the `command` backdoor.

## Autonomous loop (`npm run playtest:llm`)

`scripts/llm-visual-loop.mjs` is the unattended runner: it boots the vite dev server plus headless Chromium, proxies civ-engine's `runVisualPlaytestLoop` through the in-page `window.__harness.visualHost()` (real pointer/keyboard events; the `command()` backdoor is never touched — pinned by `tests/harness/llm-loop-script.test.ts`), and runs with the engine's hardened options: `promptMode: 'oracleAssisted'`, `agentObservation: 'redacted'` (the engine enforces the hidden-state wall at the agent boundary), `onActionFailure: 'continue'`, and wall-clock/action budgets.

The default agent is a deterministic scripted bootstrapper (road, R/C zones, coal plant + line, then watch) so the command runs without API keys. Set `CITY_LLM_VISUAL_LOOP_COMMAND` to plug in an LLM: the command receives `{step, promptParts, controls}` on stdin — `promptParts` come from civ-engine's `buildVisualPlaytestPromptParts`, so the screenshot arrives as a typed image part — and prints a decision JSON on stdout. Tune with `CITY_VISUAL_LOOP_STEPS` and `CITY_VISUAL_LOOP_WALL_CLOCK_MS`; `CITY_PLAYTEST_URL` reuses a running server.

Each run persists append-only evidence under `output/playtests-llm/<stamp>/`: the exported session `bundle.json`, `findings.json`, `result.json` (loop outcome + replay self-check verification with skipped segments normalized to a count), and a validated engine `createImprovementRunManifest` `manifest.json`; every manifest is also appended to `output/playtests-llm/ledger.jsonl` so cross-run tooling can join ledger rows to their bundles via `sessionId`/`bundleId`.

## Deferred (possible extensions)
- Rendering markers on a scrubbable in-app replay timeline (aoe2 gets this for free from its replay UI; the city has no replay UI yet — `replayTo` covers the interactive need).
- Wiring civ-engine's MCP corpus server over a directory of exported bundles for cross-run trend analysis.
