# Review 0: implementation

## Target

City commit d4534cea49641fd911ebf56e9e523a2efb04587c, tree d06321549fcad3705229f41de5ba7e6376539c96 against base bc318fc10a3573e28142a8ca09159eb6942ca656. Retained engine adoption, dependency repair, CI and provenance contracts.

## Reviewers and coverage

Independent in-session gpt-6-astra/xhigh, read-only exact candidate and retained evidence. External reviewer CLI source export was rejected earlier in the parent engine task and was not retried. No external CLI result is claimed.

## Reports

### gpt-6-astra / xhigh

Reviewed staged tree `d06321549fcad3705229f41de5ba7e6376539c96` against base `bc318fc10a3573e28142a8ca09159eb6942ca656`.

**One actionable finding:**

- **[P2] Recommend City’s scripts-disabled recovery command.** scripts/check-engine.mjs:9 tells users to run bare `npm ci` after any guard failure. City deliberately requires `npm ci --ignore-scripts` because its remaining linked voxel dependency has `prepare: npm run build`, which can rebuild the shared sibling’s dist. Following the guard’s advice defeats that protection. Change the diagnostic to the documented command and pin it in a rejection-path test.

No other material findings:

- Manifest, lock, and pin agree on the supplied retained engine 2.8.1 URL and SHA-512 integrity. Physical-directory, resolved-entry containment, and runtime-version checks remain sound within their documented scope; archive-byte validation belongs to `npm ci`.
- Native-child guard tests exercise the real Node implementation without City’s browser aliases. Acceptance and negative controls cover the relevant drift classes.
- CI preserves voxel checkout/build ordering, scripts-disabled City installation, explicit engine verification, pinned actions, and artifact-history enforcement.
- The benchmark’s source list retains the installed engine package/dist and adds guard/pin files. Unchanged scripts/frame-pacing-manifest.mjs:22 recursively reads those files; unchanged scripts/benchmark-frame-pacing.mjs:361 fingerprints them before and after building.
- Lock changes introduce no unexpected registry source, new install script, or changed artifact under an unchanged version. Direct tool upgrades stay within their existing major versions.

Evidence inspected: recorded stdout reports **133 files / 894 tests passed**; the process receipt records exit `0` and no stopped leftovers. The built worker measures **164,480 bytes**, below the unchanged **166,000-byte** limit. All three recorded voxel hashes still match. Baseline audit evidence contains the reported four high and eleven moderate findings.

Limits: no installs, tests, builds, audits, browser runs, benchmarks, or network requests were executed. Final audit/typecheck/lint results remain author-reported rather than independently rerun. The final staged comparison returned `0`; no files or index entries changed.

## Findings and disposition

F0 accepted: use the documented scripts-disabled install in the failure diagnostic. Seven existing manifest/lock/version rejection cases now require that safe command; they all failed against the original diagnostic and pass after the change. The accepted path and remaining six negative cases continue to pass. Focused repair review follows in round1.

## Verification

Before the review, all four repository gates and both high-severity audits passed on the exact reviewed tree. The repair's focused suite passes13 cases after7 RED failures. Root final gates and hosted CI remain delivery steps; no visual/gameplay change is claimed.

## Round outcome

One material integration finding, repaired locally and awaiting focused independent verification. Original reviewed bytes are recoverable at d4534ce.
