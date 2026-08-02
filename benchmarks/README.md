# Headless render benchmark

`npm run benchmark:render` compares two already-built production trees in strict A–B–B–A order. Each run loads the generated seed-12345 `fixtures/performance-city-save.json`, advances once, then pauses at tick 1203 with 936 people, 453 buildings, 81 cars, and 17 pedestrians under the current shipping simulation. It warms 1,800 renderer calls so shader compilation and GPU clocks settle, then captures 600 calls. Matching the fixture seed to the worker's boot seed is deliberate: the current load lifecycle ignores a second `ready` terrain payload, so a different seed would render the loaded entities over the wrong terrain. The page's animation loop is stopped and the driver pumps the real Three.js render call directly, avoiding headless requestAnimationFrame throttling. Every timed call ends with `gl.finish()` so `renderMs` includes GPU completion; renderer calls and submitted triangles are recorded separately. The committed July 12 shadow-cache artifact correctly records the older 88-car interpretation produced by its historical binaries; future runs use the shared current-source fixture contract.

Build the before ref in a separate checkout/worktree and the current tree normally, then run:

```powershell
npm.cmd run benchmark:render -- --before-dir C:\path\to\before\dist --after-dir dist --before-ref <sha> --after-ref <sha-or-working-tree> --output output\performance\render-benchmark.json
```

The driver always launches Chromium headless, starts loopback servers on ephemeral ports, and closes both browser and servers in `finally`. A result contains the exact run order, fixture hash/seed, a path/byte/SHA-256 manifest for both served production trees, browser/GPU/host metadata, pooled percentiles, summaries, and every raw per-frame sample. Committed result files under `results/` are historical evidence, not a cross-machine performance promise. `npm run benchmark:fixture` generates an ignored candidate at `output/performance/performance-city-save-candidate.json` with the shipping worker flags; it never silently replaces the SHA-pinned canonical save. Promoting a candidate is a reviewed re-earn change that updates the fixture, shared fixture contract, tests, and evidence together, with `--output benchmarks/fixtures/performance-city-save.json --allow-canonical-overwrite true` reserved for that change.

The default `--browser-channel chrome` uses installed stable Chrome so Windows can expose its normal D3D11 GPU path; pass a different Playwright channel explicitly when comparing another browser. The selected channel and actual WebGL renderer are stored in the result.

## Frame-pacing acceptance

`node scripts/benchmark-frame-pacing.mjs` is the final-source 60 Hz presentation gate. Run it from the primary `city/` checkout on Node 24 with the host otherwise quiet; the OS-owned loopback lease prevents another City graphics benchmark from overlapping, but it cannot exclude unrelated browser, GPU, or sibling-repo work. The driver takes a fresh production build, loads the canonical 936-person / 453-building / 81-car / 17-pedestrian fixture state, and measures 600 live `requestAnimationFrame` intervals at pause, 1×, and 4× for device DPR 1 and device DPR 2 rendered at the 1.5 cap.

Use a unique ignored output path for the first run so an older diagnostic cannot be mistaken for the new outcome; substitute the current source ref in the filename when appropriate:

```powershell
node scripts\benchmark-frame-pacing.mjs --output output\performance\frame-pacing-e93cfb8.json
```

All six profiles must pass the thresholds recorded in the result: mean ≥58 fps, p95 ≤18.5 ms, p99 ≤25 ms, no three consecutive intervals above 20 ms, a stationary paused tick, ≥18 TPS at 1×, ≥72 TPS at 4×, exact canvas buffers, and zero browser errors. Schema 2 fingerprints the complete City, civ-engine, and voxel production inputs with CRLF-to-LF source normalization before and after the build and measurement, while the served `dist/` manifest remains a raw-byte identity. Only a passing fresh-build run may support durable acceptance; its concise outcome and provenance belong in tracked project docs, while the raw result stays ignored and is cleaned after audit. A red run is diagnostic evidence and must not be rerun repeatedly until scheduling luck turns green.

The accepted 2026-08-02 final-source run used a fresh production build and passed all six profiles with the exact canonical fixture state, DPR buffers, simulation throughput, and zero browser errors. Its concise measurements and source/binary provenance are recorded in `PROGRESS.md`; the raw per-frame result remained task-local under ignored `output/performance/` for audit and was removed afterward rather than committed as repository content.

## Recorder profile

`npm run benchmark:recorder` retains the second optimization's controlled headless proxy. It builds the same seed-3 acceptance city four times in recorded–lean–lean–recorded order, installs one protocol-like no-op diff listener in every run, steps 3,000 timed ticks, and adds `SessionRecorder` + `MemorySink` only to recorded runs. The result records raw wall times, throughput, JSON-equivalent bundle bytes, final city counts, host data, and a content manifest covering the checkout policy, driver, manifest helper, scenario, package/lockfile, every game sim source, and every executed civ-engine runtime module. Schema 2 manifest bytes and hashes canonicalize CRLF pairs to LF before fingerprinting, so Git checkout conversion is not mistaken for source drift while every other byte remains significant. This intentionally measures simulation/diff/retention overhead, not browser heap or full worker projection cost.

```powershell
npm.cmd run benchmark:recorder -- --source-ref <sha-or-working-tree> --output benchmarks\results\2026-08-02-recorder-profile.json
```
