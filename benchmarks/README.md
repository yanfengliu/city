# Headless render benchmark

`npm run benchmark:render` compares two already-built production trees in strict A–B–B–A order. Each run loads the generated seed-12345 `fixtures/performance-city-save.json`, advances once, then pauses at tick 1203 with 453 buildings and 88 vehicles. It warms 1,800 renderer calls so shader compilation and GPU clocks settle, then captures 600 calls. Matching the fixture seed to the worker's boot seed is deliberate: the current load lifecycle ignores a second `ready` terrain payload, so a different seed would render the loaded entities over the wrong terrain. The page's animation loop is stopped and the driver pumps the real Three.js render call directly, avoiding headless requestAnimationFrame throttling. Every timed call ends with `gl.finish()` so `renderMs` includes GPU completion; renderer calls and submitted triangles are recorded separately.

Build the before ref in a separate checkout/worktree and the current tree normally, then run:

```powershell
npm.cmd run benchmark:render -- --before-dir C:\path\to\before\dist --after-dir dist --before-ref <sha> --after-ref <sha-or-working-tree> --output output\performance\render-benchmark.json
```

The driver always launches Chromium headless, starts loopback servers on ephemeral ports, and closes both browser and servers in `finally`. A result contains the exact run order, fixture hash/seed, a path/byte/SHA-256 manifest for both served production trees, browser/GPU/host metadata, pooled percentiles, summaries, and every raw per-frame sample. Committed result files under `results/` are historical evidence, not a cross-machine performance promise. Regenerate the deterministic fixture with `npm run benchmark:fixture`.

The default `--browser-channel chrome` uses installed stable Chrome so Windows can expose its normal D3D11 GPU path; pass a different Playwright channel explicitly when comparing another browser. The selected channel and actual WebGL renderer are stored in the result.

## Recorder profile

`npm run benchmark:recorder` retains the second optimization's controlled headless proxy. It builds the same seed-3 acceptance city four times in recorded–lean–lean–recorded order, installs one protocol-like no-op diff listener in every run, steps 3,000 timed ticks, and adds `SessionRecorder` + `MemorySink` only to recorded runs. The result records raw wall times, throughput, JSON-equivalent bundle bytes, final city counts, host data, and a content manifest covering the driver, scenario, package/lockfile, every game sim source, and every executed civ-engine runtime module. This intentionally measures simulation/diff/retention overhead, not browser heap or full worker projection cost.

```powershell
npm.cmd run benchmark:recorder -- --source-ref <sha-or-working-tree> --output benchmarks\results\2026-07-12-recorder-profile.json
```
