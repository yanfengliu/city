# Install the retained engine archive

Status: active
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
