# Lessons

The one-line form of every lesson this repo has paid for. Read this file at session start; it is short by construction.

Each rule links into [lessons-evidence.md](lessons-evidence.md), which holds the war story and the anchor. Open that only when a rule is in doubt, or the work is in that area — it is not session-start reading.

A new lesson is an entry there plus one line here. Run `npm run lessons:check` to keep the two in step: a rule always has an entry, and an entry always has a rule.

When a lesson becomes a gate — a test, a lint rule, a fixed command — delete both halves. The machine enforces it, so nobody needs to read it.

## Rules

- A cleared drag ghost is not harness evidence of what the player attempted ([evidence](lessons-evidence.md#a-cleared-drag-ghost-is-not-harness-evidence-of-what-the-player-attempted))
- world.query() returns a single-use Generator ([evidence](lessons-evidence.md#worldquery-returns-a-single-use-generator))
- setPointerCapture throws for synthetic pointer events ([evidence](lessons-evidence.md#setpointercapture-throws-for-synthetic-pointer-events))
- Background tabs throttle rAF to zero → stale camera matrixWorld breaks picking ([evidence](lessons-evidence.md#background-tabs-throttle-raf-to-zero-stale-camera-matrixworld-breaks-picking))
- Preview-tab viewport can boot at 1px wide ([evidence](lessons-evidence.md#preview-tab-viewport-can-boot-at-1px-wide))
- Optional parameters on load-bearing paths become silent dead code ([evidence](lessons-evidence.md#optional-parameters-on-load-bearing-paths-become-silent-dead-code))
- Derived-state changes must be mirrored in BOTH the live mutation path and rebuildDerived ([evidence](lessons-evidence.md#derived-state-changes-must-be-mirrored-in-both-the-live-mutation-path-and-rebuildderived))
- "Coexists over an existing owner" needs re-ownership in EVERY demolition path, not just the one you were thinking about ([evidence](lessons-evidence.md#coexists-over-an-existing-owner-needs-re-ownership-in-every-demolition-path-not-just-the-one-you-were-thinking-about))
- preview_screenshot can hang while the page is healthy — capture the canvas yourself ([evidence](lessons-evidence.md#previewscreenshot-can-hang-while-the-page-is-healthy-capture-the-canvas-yourself))
- The utility abandonment grace was silently bypassed by the score path ([evidence](lessons-evidence.md#the-utility-abandonment-grace-was-silently-bypassed-by-the-score-path))
- A "consecutive" streak counter must reset on the healthy branch, not only on abandon/recover ([evidence](lessons-evidence.md#a-consecutive-streak-counter-must-reset-on-the-healthy-branch-not-only-on-abandonrecover))
- The client mirror tick lags the worker tick — anchor harness annotations to the worker ([evidence](lessons-evidence.md#the-client-mirror-tick-lags-the-worker-tick-anchor-harness-annotations-to-the-worker))
- Never gate on a piped test run — the pipe eats the exit code ([evidence](lessons-evidence.md#never-gate-on-a-piped-test-run-the-pipe-eats-the-exit-code))
- A headless playtest tab stops rAF — a "screenshot" must pump its own presentation frame ([evidence](lessons-evidence.md#a-headless-playtest-tab-stops-raf-a-screenshot-must-pump-its-own-presentation-frame))
- A "current problems" count restricted to live entities goes blind exactly when everything dies ([evidence](lessons-evidence.md#a-current-problems-count-restricted-to-live-entities-goes-blind-exactly-when-everything-dies))
- A "coexists over an existing owner" overlay is a bug magnet — make it own nothing instead ([evidence](lessons-evidence.md#a-coexists-over-an-existing-owner-overlay-is-a-bug-magnet-make-it-own-nothing-instead))
- A "green migration" claim is only as good as which gates actually ran ([evidence](lessons-evidence.md#a-green-migration-claim-is-only-as-good-as-which-gates-actually-ran))
- Immediate entity-id recycling must be handled at both sides of a render diff ([evidence](lessons-evidence.md#immediate-entity-id-recycling-must-be-handled-at-both-sides-of-a-render-diff))
- A utility reach halo must mirror the conduction closure, not supplied status ([evidence](lessons-evidence.md#a-utility-reach-halo-must-mirror-the-conduction-closure-not-supplied-status))
- A shared heightfield also needs shared triangle and lifecycle contracts ([evidence](lessons-evidence.md#a-shared-heightfield-also-needs-shared-triangle-and-lifecycle-contracts))
- Backdrop-filter can corrupt an otherwise-correct headless screenshot ([evidence](lessons-evidence.md#backdrop-filter-can-corrupt-an-otherwise-correct-headless-screenshot))
- A DEV guard only tree-shakes recorder code when all recorder state stays inside it ([evidence](lessons-evidence.md#a-dev-guard-only-tree-shakes-recorder-code-when-all-recorder-state-stays-inside-it))
- A green determinism result is vacuous when it checked no segments ([evidence](lessons-evidence.md#a-green-determinism-result-is-vacuous-when-it-checked-no-segments))
- A browser performance fixture must share the boot world's seed ([evidence](lessons-evidence.md#a-browser-performance-fixture-must-share-the-boot-worlds-seed))
- Visual bathymetry must read raw elevation before the land-surface projection ([evidence](lessons-evidence.md#visual-bathymetry-must-read-raw-elevation-before-the-land-surface-projection))
- Water motion should animate lighting before it animates the mechanical plane ([evidence](lessons-evidence.md#water-motion-should-animate-lighting-before-it-animates-the-mechanical-plane))
- Gates cannot pass from inside an agent worktree because CRLF inflates every pinned byte size ([evidence](lessons-evidence.md#gates-cannot-pass-from-inside-an-agent-worktree-because-crlf-inflates-every-pinned-byte-size))
