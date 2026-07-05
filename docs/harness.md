# LLM playtest → annotate → replay harness

A harness that lets an LLM (Claude, driving the running game through the automation hooks) **playtest** the game, **annotate** findings tied to the exact game tick, and **replay** the recorded session deterministically to jump back to any finding and debug the precise state that produced it.

## Prior art

Both were studied before building this (`../civ-engine`, `../aoe2`).

**civ-engine** provides the whole record/replay substrate — this harness is thin glue over it:

- `SessionRecorder({ world, sink, snapshotInterval })` — `connect()` wraps `world.submitWithResult` and listens to per-tick diffs/executions, writing an initial snapshot, periodic snapshots (default every 1000 ticks), and a terminal snapshot. `addMarker(NewMarker)` records an annotation at a tick with optional `refs` (entities/cells/tickRange) and arbitrary `data: JsonValue`. `toBundle()` returns a `SessionBundle`.
- `SessionReplayer.fromBundle(bundle, { worldFactory })` — `openAt(tick)` returns a paused, queryable `World` replayed to that tick; `selfCheck()` runs a 3-stream determinism check (serialized state vs events vs command executions) and pinpoints the first differing path.
- `snapshotAtTick(bundle, tick)` — folds tick diffs from the nearest snapshot to return the `WorldSnapshot` at any tick **without constructing a World** (pure data).
- The `Marker` primitive + a read-only **MCP corpus server** for offline bundle interrogation.
- Determinism contract (all input via `world.submit()`, all randomness via `world.random()`, no wall-clock in systems, sliced/queue state lives in components) — the city already honors it; `tests/sim/replay.test.ts` is the project's `selfCheck` gate.

**aoe2** proves the end-to-end shape for an LLM and supplies the patterns we copy:

- In-browser agent API (`window.__AOE2_TEST__`): a **bounded** text snapshot, `advanceTicks(n)` with the sim **paused between calls**, `dispatchAgentCommand` with **rejection feedback fed back** to the next decision, and `getRecorderBundle()` to export the session.
- Findings are a structured `ConformanceFinding[]` (`category / area / observed / expected / severity / suggestion`) and are **injected into the bundle as engine `Marker`s**, so the replay timeline renders them for free — no bespoke annotation store.
- A headless `replay-inspect` script opens the bundle at sampled ticks and prints ground-truth state; findings are grounded in deterministic metrics computed from the trace before any LLM judgement.

## How it maps onto the city

The city runs the sim in a Web Worker; the main thread drives it with `{type:'command'}` / `advance` messages and observes via `render_game_to_text()` + frame diffs. So:

- **Record** lives in the worker: a `SessionRecorder` connected to `world` from boot, torn down and restarted on New/Load (each city is one session, seeded by `currentSeed`).
- **Annotate** is a main-thread → worker message that calls `recorder.addMarker({ tick: world.tick, data: finding })`.
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
| `annotate(finding)` | Record a `PlaytestFinding` as a marker at the current tick. Returns the tick it was anchored to. |
| `findings()` | The findings recorded this session (authoritative worker ticks). |
| `inspectAt(tick)` | Replay to `tick` and resolve the exact deterministic state there (`{ tick, summary }`); the tick is clamped to the recorded range, and `summary` is `null` (with `error`) if folding fails, so the call always settles. Also stashed on `lastInspection`. |
| `selfCheck()` | Run civ-engine's 3-stream determinism check over the recorded session; returns `{ ok, checkedSegments, ... }` (or `null` + `error` on failure). Also stashed on `lastSelfCheck`. |
| `getBundle()` | The full annotated `SessionBundle` (commands + snapshots + markers) for offline analysis / regression; also stashed on `lastBundle`. |

The async methods (`inspectAt` / `selfCheck` / `getBundle`) return a Promise **and** stash their result on `last*`, so an automation eval can trigger then read the stash a beat later (Promises don't survive a `preview_eval` boundary). Each reply is **id-correlated**, so overlapping calls resolve to their own request rather than mis-matching.

## Finding format (`PlaytestFinding`)

```ts
interface PlaytestFinding {
  category: 'bug' | 'balance' | 'ux' | 'missing-feature' | 'visual' | 'perf';
  severity: 'low' | 'medium' | 'high';
  area: string;        // free-form subsystem, e.g. 'onboarding', 'traffic', 'economy'
  observed: string;    // what the run showed
  suggestion?: string; // proposed improvement / next step
}
```

Stored as a civ-engine `Marker`: `{ kind: 'annotation', tick, text: "[category] area: observed", data: finding }`.

## Headless summary

`simSummary(world)` (in `src/sim/summary.ts`) reads a compact text state straight from a `World` — pop, treasury, demand, buildings by zone/level, abandoned, employed, vehicles, roads, structures, disconnected trips. It needs no browser, so the replay-inspect test/tool can print ground-truth state at any replayed tick.

## The loop

1. **Play** — drive the game (`__harness.command`, `__harness.advance`, read `__harness.state`).
2. **Annotate** — on noticing something, `__harness.annotate({ category, severity, area, observed, suggestion })`; it anchors to the current tick.
3. **Debug** — `__harness.inspectAt(finding.tick)` resolves the exact deterministic state at the finding (read `__harness.lastInspection` a beat later). `__harness.selfCheck()` confirms the replay reproduced the session — it takes a terminal snapshot first so the *whole* live session is covered (a still-connected recorder only has periodic snapshots, so without it the tail after the last one would go unchecked; a non-zero `checkedSegments` with `ok` is the real green). A failure is itself a determinism bug worth fixing.
4. **Keep** — `__harness.getBundle()` exports the annotated session; it round-trips through `SessionReplayer` for offline inspection or as a regression fixture.

## Verified by

`tests/harness/replay-harness.test.ts` records a scripted session, annotates a marker, replays via `SessionReplayer`, asserts `selfCheck().ok`, and checks `simSummary` at the marker tick — the whole pipeline, browser-free.

## Deferred (possible extensions)

- An autonomous runner (Playwright + an LLM-agent decision loop + cost budget) like aoe2's `playtest-llm.mjs`, for unattended campaigns. The record/annotate/replay core here is exactly what that runner would sit on.
- Rendering markers on a scrubbable in-app replay timeline (aoe2 gets this for free from its replay UI; the city has no replay UI yet — `replayTo` covers the interactive need).
- Wiring civ-engine's MCP corpus server over a directory of exported bundles for cross-run trend analysis.
