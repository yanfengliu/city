# Canon candidates

Lessons from `city` that have no mechanical trigger and are not specific to this repo. Staged for the parent to promote into `fleet/FLEET.md`; until then this file is the only copy of them, so it is complete rather than abbreviated.

Each is written in fleet-canon voice, ready to paste.

---

## When a tool reports that it applied a fix, confirm it by diffing the artifact it should have changed — a no-op reports exactly like a refusal.

**From:** city / "`npm audit fix` can report a fix it never applies"

**Why it has no gate:** the standing gate (`npm audit --audit-level=high` on the full tree and `--omit=dev`) already fails closed. What cannot be gated is the human step in the middle — believing a tool's summary instead of checking its output.

**Anchor:** `npm audit` printed "fix available via `npm audit fix`" for `brace-expansion`, `nanoid` and `postcss`; `npm audit fix --package-lock-only --dry-run` answered "up to date, audited 146 packages" and left `package-lock.json` byte-identical, without printing the "including breaking changes" line that normally explains a refusal. `npm update brace-expansion nanoid postcss --package-lock-only` then re-resolved all three (5.0.7→5.0.9, 3.3.15→3.3.18, 8.5.16→8.5.26) and both audit trees went to 0 vulnerabilities. Fix commit `7c2e8e0`.

---

## Treat a verification scaffold's first "the product is broken" as a claim about the scaffold, until its own inputs are proven accepted.

**From:** city / "A verification scaffold that hardcodes map coordinates reports its own bugs as product failures"

**Why it has no gate:** the scaffolds are throwaway task-run evidence under ignored paths; there is no standing artifact to attach a check to, and the shape of the mistake is different every time.

**Anchor:** four consecutive "product defect" reports in one browser-verification session — three "FAIL the city was lost despite the rescue" plus a power-plant panel that would not open — were all the scaffold. A district pinned at fixed coordinates on a procedural 128x128 map straddled a lake: the plant site was underwater so `cell % W` produced `NaN`, a service sat one row off a road, a power line started on the plant's own footprint, and the chosen corridor crossed water. The sim's own rejection messages identified all four ("(44, 36) is water — power lines cannot cross it"; "no cell of the footprint at (11, 3) touches a road — services must sit beside one"). Deriving every coordinate from a scanned clear block, and reading back the submission result on every placement, took it to 0 false failures.

---

## A capture transport can wedge while the page it is photographing is perfectly healthy — before debugging the page, prove the page is alive.

**From:** city / "preview_screenshot can hang while the page is healthy — capture the canvas yourself"

**Why it has no gate:** it is a property of the tool between you and the artifact, not of any code in the repo. Nothing here can assert it.

**Anchor:** `preview_screenshot` timed out at 30 s on every attempt — fresh server, fresh tab, small viewport — while `preview_eval` kept answering and the sim kept ticking. The workaround was to render and read the canvas in-page (`preserveDrawingBuffer: true` makes the buffer readable after the render) and return the data URL in slices. Related and already gated here: a capture must pump its own presentation frame, because rAF is stopped in a tab that is not painting.

---

## When a capture artifact is wrong in a way that lines up exactly with composited CSS chrome, isolate the capture compositor before you change the rendered product.

**From:** city / "Backdrop-filter can corrupt an otherwise-correct headless screenshot"

**Why it has no gate:** the product no longer uses `backdrop-filter` anywhere, and the evidence driver that carried the workaround lived under an ignored path and was deleted. There is nothing left to assert against, but the reasoning transfers to any repo capturing a page whose chrome is composited.

**Anchor:** the WebGL scene was correct and a canvas-only render was clean, but Chromium's full-page capture replaced every frosted HUD region with opaque black rectangles. The corruption aligned with the DOM elements using `backdrop-filter`, not with terrain geometry. Injecting `* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }` into the evidence page — and only the evidence page — produced a clean capture with production visuals untouched.

---

## A migration or a "we are green" claim names which gates actually ran; "green" on its own is not a claim.

**From:** city / "A 'green migration' claim is only as good as which gates actually ran" (second of that entry's two rules — the first is now gated by `tests/harness/replay-harness.test.ts`)

**Why it has no gate:** it constrains how a result is reported, not what any program does.

**Anchor:** an engine 2.0.0 fleet validation ran this repo's suite once and recorded "green". The strict-by-default flip actually bites at RECORD time inside a host `annotate` callback, where the throw was swallowed into a silent no-op — so the dogfood test was failing on `main` while the repo was believed migrated-green, and the belief persisted unchecked while other repos' evidence accumulated on top of it.
