# Review 2: implementation

## Target

Exact tree e0ed8e01801e8acdb4d30f4e779f6de5082864ad against base c9e80feec1b3b8e1352555e60331686e3ac44dee; bounded follow-up for A1, CLI invocation through filesystem aliases.

## Reviewers and coverage

Independent in-session gpt-6-astra/xhigh. Exact source and fixture review, plus retained RED/GREEN evidence. External CLI source export was rejected earlier in the parent task and was not retried; no external CLI report is claimed.

## Reports

### gpt-6-astra / xhigh

Reviewed frozen tree `e0ed8e01801e8acdb4d30f4e779f6de5082864ad` against base `c9e80feec1b3b8e1352555e60331686e3ac44dee`. The index and tracked worktree matched the frozen tree. All five changed files were inspected.

**No material findings. A1 is resolved within the reviewed scope.** The guard at `scripts/check-engine.mjs:50` uses the same canonical-path implementation as Farm and civ-sim-web. A full source comparison confirmed that City’s only checker difference is its preserved `npm ci --ignore-scripts` recovery diagnostic.

The fixture topology at `tests/config/engine-install.test.mjs:28` contains the actual copied script, physical package, matching manifests, and separate Node/browser modules. CLI tests at `tests/config/engine-install.test.mjs:103` use real Node processes and genuine junctions, require observable verification on success and explicit failure on invalid pins, and cover Windows case variation plus inert imports with normal, absent, and nonexistent arguments. New alias cleanup unlinks junctions before removing fixture roots.

Outside the changed hunks, I verified City’s existing Node subprocess adapter at `tests/config/engine-install.test.mjs:9`, which preserves real filesystem checks despite browser shims, and the unchanged scripts-disabled diagnostic at `scripts/check-engine.mjs:8`. Retained RED evidence shows two junction failures and20 passes; GREEN reports all22 passing. Documentation correctly leaves full gates and delivery pending.

Bounds: read-only exact-revision, source, fixture, and retained-log review. I did not rerun targeted lint, installation verification, tests, or full gates, and performed no network operations or writes. No gameplay, rendering, or hosted-CI acceptance is inferred.

## Findings and disposition

No material findings. Root accepts the correction; existing installation identity checks and dependency pins remain unchanged.

## Verification

Implementer evidence: two junction failures and20 passes before the fix, then22 focused passes, targeted lint/content checks and actual private2.8.1 runtime verification. Full gates and delivery remain pending in this review record and are tracked by the work plan.

## Round outcome

Independent review accepted, subject to full required gates and normal delivery.