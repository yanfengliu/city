# Install the retained engine archive

Status: complete
Owner: Codex root
Created: 2026-11-07
Updated: 2026-11-07

## Problem and outcome

City links a mutable sibling engine and CI builds its current main, so the compiled engine can drift independently from the game. Install the verified civ-engine 2.8.1 archive retained under producer commit 6a8ae8fa4e65c8d49c933956592e1a088c32a78b, preserving the separate voxel dependency and all simulation behavior.

## Scope

Update the engine manifest/lock, reuse Farm's reviewed installation guard and contracts, update installation documentation, and remove the engine checkout/build/cache input from CI. Preserve voxel checkout/build and artifact-history enforcement. Necessary nonmajor audit repairs of existing tools are included. Gameplay, rendering, save formats, shared dependencies, and shared source/dist builds are excluded. Root owns independent review, integration, push, and hosted acceptance.

## Approach

Use the immutable commit-named release URL directly in npm, with the verified SHA512 integrity duplicated in scripts/civ-engine-pin.json and the lock. The guard rejects differing archive identities, linked engine/node_modules directories, escaping entries, and stale Node/browser runtime versions. It runs before dev/test/build and explicitly in CI.

The isolated worktree is C:/Users/38909/Documents/worktrees/city-engine-pin-1107/city, branch codex/engine-pin-1107, base bc318fc. Its task-owned sibling voxel junction points to the existing shared checkout for reads only. Both lock regeneration and clean installs use --ignore-scripts because voxel's prepare hook builds dist. CI keeps its explicit voxel build before the City installation. Shared voxel entry hashes are recorded before and after; no shared install/build is run. The pre-existing detached Vite-consumer worktree is preserved.

## Acceptance criteria

- [x] A clean private install resolves the exact retained engine archive and both compiled runtimes report 2.8.1.
- [x] Installation and CI contracts prove the old linked/source-build paths fail and the retained-package path passes while preserving voxel ordering and artifact enforcement.
- [x] Test, typecheck, zero-warning lint, production build/bundle budget, and both high-severity audits pass under a supported Node 24 patch.
- [x] Any task-owned process exits or is cleaned up; the shared voxel entry hashes remain unchanged by this task.
- [x] The exact staged candidate receives independent in-session review before root commits and delivers it.

## Implementation steps

- [x] Read City rules, lessons, progress, architecture boundaries, and existing CI contracts; allocate work 2 through the fleet tool.
- [x] Create an independent worktree and check paths before creating its sibling mapping.
- [x] Pin the archive, prove red/green guard and CI contracts, and complete bounded audit repair.
- [x] Obtain the heavy-gate slot and run the required suite/build with owned resource cleanup.
- [x] Freeze the staged candidate for independent review and repair the resulting diagnostic finding with RED/GREEN contracts and focused re-review.
- [x] Root integrated main64e0aab and followed hosted CI42429408841 to success; private worktree retirement follows the record commit.

## Outcome

Follow-up delivery: source24cd825 and gate record40d5fde were fast-forwarded to main and pushed on2026-11-07 after root inspected the exact local results and independent review. Hosted [CI42434776542](https://github.com/yanfengliu/city/actions/runs/42434776542) passed at exact head40d5fde2a90b8fd813285504dc2b13f96d22c7f3. The follow-up is complete; compact evidence is retained under the primary checkout's ignored tmp/engine-guard-1107/. This closure changes docs only; its triggered CI is followed before task-owned worktree and junction retirement. The foreign detached Vite-consumer checkout and shared voxel inputs are preserved.

2026-11-07 follow-up: resume this retained-engine deliverable for the independently reproduced CLI silent-success defect through filesystem aliases. Actual Node contracts first produced two junction failures with twenty passes: an invalid pin exited zero and a valid fixture printed no verification. Canonical filesystem identity, normalized for case only on Windows, fixes both; all22 contracts now pass, including the original13, direct/junction/Windows-case success and refusal, and inert imports with normal/absent/nonexistent argv. Targeted zero-warning lint, the actual physical installed engine2.8.1 check, and private npm ci --ignore-scripts pass on Node24.22.1/npm11.6.2. Shared voxel inputs remain unchanged. No dependency, gameplay, saved format, CI ordering, or policy changes are included. Raw logs stay ignored under tmp/engine-guard-1107/. Root owns pending full-gate scheduling, exact independent review, and integration; the earlier delivered adoption below remains recorded.

Delivered at main64e0aab3d7c71ba11e9b8ebdc452481ba6115de4 after local verification and independent Astra/xhigh review; hosted CI42429408841 succeeded. Original reviewed tree is recoverable at d4534ce and repair tree at4a18151; full authored rounds0/1 are retained. Producer readiness is accepted from root: engine CI42425758281 passed on6a8ae8fa4e65c8d49c933956592e1a088c32a78b; the retained archive's SHA512 is sha512-Ga0WkDVK6oVDv53VQZJNJDOVjDB4OCt92YTSx1MCKdeytlUtGalyzOQmY/34RWTASTLp+wd4bbT0HUkTINtREw==. Shared primary dependencies remain untouched; existing checkouts need README's npm ci --ignore-scripts before guarded dev/test/build. Task-owned links and temporary resources are retired after this closure record; the foreign Vite-consumer worktree stays untouched.

## Environment and initial evidence

Follow-up acceptance, 2026-11-07: independent in-session Astra/xhigh review2 accepted exact source treee0ed8e01801e8acdb4d30f4e779f6de5082864ad with no material findings. All six commands passed on Node24.22.1/npm11.6.2: npm test (133 files/903 tests,17.50 seconds), npm run typecheck, npm run lint, npm run build, npm audit --audit-level=high, and npm audit --omit=dev --audit-level=high. Worker budget remains164480/166000 bytes; the existing large-chunk warning and nine moderate development findings remain, production zero. Hidden runner51828 observed202 owned processes, stopped none, and found no leftovers. Shared voxel package/core/three hashes still match the pre-install values. Reviewed source and authored review are committed as24cd825a79d25923fd2ad9461f2279a5ecded134; root's main integration, push, and hosted acceptance remain pending. This supersedes earlier pending-gate/review prose without changing the reviewed source. Exact commands, logs, hashes, and process identities remain ignored in tmp/engine-guard-1107/.

The initial isolated install used Node 24.12.0/npm 11.7.0 and scripts disabled. The existing jsdom 30.0.1 declares Node ^24.15.0, so subsequent gates use the already available Codex runtime Node 24.22.1 without changing the machine default or downgrading jsdom. CI selects the latest Node 24 through actions/setup-node and .nvmrc, satisfying the same current minimum.

The CI contract first failed on the old engine checkout and the new guard suite first failed because the guard was absent. Initial full audit reported 11 moderate and 4 high findings; an independent audit of copied bc318fc manifests reproduced all 15 findings without installing old dependencies. Nonmajor npm audit fix with --package-lock-only --ignore-scripts removes the high findings; no --force or dependency-major change is used.

## Local verification

Clean npm ci --ignore-scripts under Node 24.22.1/npm 11.6.2 installed 187 private packages. Farm's reviewed 59-line guard is reused with City's scripts-disabled recovery diagnostic. City tests exercise it through native Node children because City's existing Vite node:path browser alias intercepts direct test imports; the browser configuration and shims remain unchanged. Thirteen guard contracts and three CI contracts pass, verifying the physical engine package, exact URL/integrity, Node/browser runtime versions, voxel build ordering, and retained artifact-history gate.

The first full suite had 893 passes and one migration-specific failure: the frame-pacing provenance test still required civ-engine to be a linked dependency. The revised contract first failed when the engine's compiled inputs disappeared. The manifest now explicitly retains the installed engine package/dist and also fingerprints the guard/pin, while the linked dependency list correctly contains only voxel. The recorder benchmark already fingerprinted the installed engine and required no change. No gameplay assertion or threshold was relaxed.

Final npm test passed 133 files and 894 tests in 18.87 seconds. Typecheck and zero-warning lint passed. Production build passed with the unchanged worker budget at 164480/166000 bytes; the existing large application-chunk warning remains. This proves the native build/test dependencies work when City installation scripts are ignored. No live visual sweep, browser interaction run, or performance benchmark was added or claimed for this installation-only change.

Root repeated all six gates after F0's diagnostic repair; each exited0 with the same894 tests and worker size. The PowerShell runner appended e s t to its test invocation, so root ran the exact unfiltered npm test separately:133 files/894 tests,18.17 seconds,exit0. Focused re-review closed F0 with no new findings. The final task-path process scan found no owned leftovers.

Both high-severity audits passed: nine moderate development findings remain; production has none. Key nonmajor repairs are Vitest 4.1.9 to 4.1.12, Vite 8.1.2 to 8.3.6, ESLint 10.6.0 to 10.14.0, brace-expansion 5.0.9 to 5.0.12, source-map-js 1.2.1 to 1.2.2, and undici 8.10.0 to 8.12.4. jsdom stays 30.0.1. Lock regeneration refreshes voxel's descriptive linked-package metadata from 1.2.0 to its already-present 1.3.0; it does not install or build voxel.

The first suite tracked hidden root PID 19256 and 146 descendants; the final suite tracked root PID 49736 and 129 descendants. Both receipts record actual exit status and zero owned leftovers requiring termination. The checked shared voxel package.json, dist/core/index.js, and dist/three/index.js hashes match their pre-install values. Raw receipts, initial/final logs, hashes, and baseline audit live only in ignored tmp/engine-pin-1107/. The task-owned sibling voxel junction must be detached before worktree-parent cleanup; the shared target and the foreign detached Vite-consumer worktree must remain untouched.

Evidence correction: the supported-Node install/gate commands explicitly invoked C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js, which reports11.6.2. Earlier11.7.0 metadata came from PATH's different npm. Root verified both commands and corrected these records; gate outcomes and installed artifact are unchanged.
## Canonical installed-path test portability follow-up — 2026-11-07

Root resumed this coherent work unit for the copied positive fixture oracle exposed by AoE2 Windows CI: the guard correctly returns a canonical real path, but two assertions compare it with the lexical fixture path. This follow-up changes only tests/config/engine-install.test.mjs and factual work/devlog records. Keep scripts/check-engine.mjs, package manifests/lock, the retained2.8.1 pin, application behavior and thresholds unchanged.

Private branch codex/engine-path-portability-1107 starts at 670ad083dfdf76e6977e8b7e45a21a3abcf55afc in C:\Users\38909\Documents\worktrees\engine-path-portability-1107\city. Fresh primary status is clean. Before private installation, create only a task-owned parent voxel junction to the existing producer, after checking the path is absent; use --ignore-scripts so its prepare/build cannot run. Preserve the foreign vite-consumers/city detached worktree and artifact admission checks. No dependency install, test execution, source edit or new review has occurred at this planning boundary.

- [x] Install private dependencies with npm ci --ignore-scripts on Node24.22.1 using explicit npm11.6.2; prove the lock remains unchanged and physical engine runtime2.8.1 resolves.
- [x] Inspect/reproduce the existing lexical-path expectation using a real checkout alias where practical; retain exact results without claiming a RED that did not occur. Compare the complete expected API/CLI installed path with await realpath(installed), preserve all existing negative/CLI/import contracts, and add a real checkout-root alias success case while package/dist junction rejection stays intact.
- [x] Run focused contracts first, retain owned-alias cleanup in finally/afterEach, and freeze the exact minimal test-only candidate for independent in-session review.
- [x] After root grants the single heavy slot, run npm test; npm run typecheck; npm run lint; npm run build; full and production high-severity audits. Farm headless browser suites own every process and clean in finally; every runner records actual exit status, runtime versions and final owned-process check. No additional visual sweep is needed for test-only expected-path correction.
- [x] Root accepted exact evidence; the reviewed source is integrated and pushed, applicable source CI passed, and compact evidence is hash-retained. Final task-owned cleanup follows the closure-record push.

Current status: the test-only correction is delivered and accepted. Final task-owned resource cleanup follows these factual closure records; all preceding implementation/gate checkpoints remain historical.

Focused implementation evidence, 2026-11-07: private npm ci --ignore-scripts --no-audit --no-fund passed under Node24.22.1/explicit npm11.6.2. Package manifest, lockfile, production guard and pin SHA256s remain identical; the actual guard verifies physical Node/browser engine2.8.1. Extending the existing positive contract with a genuine checkout junction first produced exactly1 lexical-path assertion failure and22 passes. Only the complete API/CLI expected paths were canonicalized with realpath; the alias case additionally rejects returning the lexical alias. All23 focused contracts now pass. Existing negative/shared-package/shared-dist/CLI/import contracts remain intact. New aliases are unlinked before their owned temporary parents even after assertion failure. Logs, exact RED source and frozen input/runtime bindings are ignored under tmp/engine-path-portability-1107.

Focused validation bounds: Farm and City affected-file lint passed; idle-life has no lint script. An extra direct civ-sim-web MJS lint call failed because the existing TypeScript projects exclude that file; unchanged HEAD content reproduces the identical diagnostic. The repository's normal ts/tsx lint gate remains unchanged and pending the granted full-gate slot. No browser, localhost server, full suite, dependency repair, source guard change or gameplay edit ran. Final task-path process scan found no Node/browser process; the five checked shared Voxel/pixel_lab input hashes are unchanged. This scan is not presented as a full descendant census. Root arranges exact independent review before full gates and delivery.

Full acceptance, 2026-11-07: independent native Astra/xhigh review accepted the exact test candidate with no material findings; the complete authored four-consumer report is retained in reviews/3_implementation.md. Root granted the single heavy slot and all6 required commands passed on treef62b38f7d866e2b129f7c64bbbfa740155f9a28a: 133 files/904 tests, the configured type/lint/build checks and both high-severity audits. Node24.22.1 and explicit/nested npm11.6.2 were consistent. Full audit retains9 moderate development findings, with zero high/critical findings; production audit reports0 vulnerabilities. Production worker budget remains164480/166000 bytes. The finally receipt observed222 owned processes, stopped0 and found0 leftovers; final task-path process scan is empty. All4 manifest/lock/production-guard/pin hashes and3 installed engine runtime hashes still match; all5 shared Voxel/pixel_lab hashes match. Exact source tests match the independent review. Logs and receipts remain in tmp/engine-path-portability-1107; session/gate-acceptance.json binds the shared final checks. Heavy slot was released immediately after the four sequential consumers. No new gameplay or visual verification is claimed. Root accepted source review and authorized private commits; integration, push, applicable hosted CI and final resource cleanup remain pending.

Portability delivery closure, 2026-11-07: root accepted the actual local command/process/hash receipts and authorized ordinary delivery. After fresh fetch confirmed unchanged main, source4ef01db70cf8fdabda62fae04d042fb0f0a5be8c fast-forwarded to main and pushed; remote identity was checked and the primary remained clean. Exact-head hosted CI42442820594 completed successfully (job128615467015). Complete ignored evidence is SHA256-checked under primary tmp/engine-path-portability-1107-retained, including the authored review, RED source/results, GREEN/full gates, runtime/package bindings, process receipts and shared-input preservation. The accepted source is recoverable at that commit. These factual closure records change no tested source; after their push and any triggered hosted check, cleanup removes only the inventoried task-owned junctions, private worktree/branch and session, preserving shared producers and foreign worktrees.
