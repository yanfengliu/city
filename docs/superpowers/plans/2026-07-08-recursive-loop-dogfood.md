# Recursive Loop Dogfood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, executable dogfood path proving the city improvement loop can run through civ-engine visual-loop and recursive-finding contracts.

**Architecture:** Keep the browser `window.__harness` as the live player-surface API, and add a headless dogfood helper for CI-strength evidence. The helper should use the real city sim, `SessionRecorder`, `runVisualPlaytestLoop`, standardized `ImprovementFinding` markers, `SessionReplayer.selfCheck`, and a before/after comparison report.

**Tech Stack:** TypeScript, Vitest, civ-engine `SessionRecorder`/`runVisualPlaytestLoop`/`ImprovementFinding`, existing city sim and harness modules.

---

### Task 1: Failing Dogfood Contract Test

**Files:**
- Modify: `tests/harness/replay-harness.test.ts`
- Create: `src/harness/dogfood.ts`

- [x] **Step 1: Write the failing test**

Add a test importing `dogfoodRecursiveImprovementLoop` from `../../src/harness/dogfood` and asserting:

```ts
const report = await dogfoodRecursiveImprovementLoop();
expect(report.loop.ok).toBe(true);
expect(report.finding.verificationStatus).toBe('verified');
expect(report.finding.nextAction).toBe('none');
expect(report.finding.disposition).toBe('accepted');
expect(report.selfCheck.ok).toBe(true);
expect(report.selfCheck.checkedSegments).toBeGreaterThan(0);
expect(report.bundle.hasImprovementLoop).toBe(true);
expect(report.bundle.hasLegacyPlaytestFinding).toBe(false);
expect(report.comparison.populationDidNotRegress).toBe(true);
expect(report.before.tick).toBeLessThan(report.after.tick);
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx.cmd vitest run tests/harness/replay-harness.test.ts`

Expected: FAIL because `src/harness/dogfood.ts` does not exist.

### Task 2: Minimal Dogfood Helper

**Files:**
- Create: `src/harness/dogfood.ts`
- Modify: `tests/harness/replay-harness.test.ts`

- [x] **Step 1: Implement the helper**

Create `dogfoodRecursiveImprovementLoop()` with this exact sequence:

1. Create `createCitySim({ seed: 17, fieldsEnabled: true, utilitiesEnabled: true, highwayEnabled: true })`.
2. Connect a `SessionRecorder` with a `MemorySink`.
3. Build a small residential district using normal city commands and step the world to a stable `before` summary.
4. Run `runVisualPlaytestLoop()` for one step against a headless host that exposes `sim_summary`, `recorded_findings`, `Road`, and `Wait`.
5. In the host annotation path, convert the visual finding with `visualFindingToCityFinding()` and record it with `cityFindingToMarker()`.
6. Classify the recorded finding as `verificationStatus: "verified"`, `nextAction: "none"`, and `disposition: "accepted"`.
7. Step the world through the loop action, capture the `after` summary, take a terminal recorder snapshot, inspect the bundle, and return a typed report with self-check, marker payload, inspection, and comparison fields.

The finding must classify the result as `verificationStatus: "verified"`, `nextAction: "none"`, and `disposition: "accepted"` because this dogfood run is evidence, not a proposed gameplay fix.

- [x] **Step 2: Run focused harness test**

Run: `npx.cmd vitest run tests/harness/replay-harness.test.ts`

Expected: PASS.

### Task 3: Docs And Progress

**Files:**
- Modify: `docs/harness.md`
- Modify: `PROGRESS.md`

- [x] **Step 1: Document the dogfood runner**

Add a short section to `docs/harness.md` explaining that `dogfoodRecursiveImprovementLoop()` is the headless evidence path for the loop: run, record, find, verify, classify, rerun, compare, learn.

- [x] **Step 2: Update progress**

Add a `2026-07-08` log entry summarizing the dogfood helper, the focused test evidence, and any browser/tooling blocker encountered.

### Task 4: Verification, Review, Commit, Push

**Files:**
- Verify all touched files plus project gates.

- [x] **Step 1: Run focused checks**

Run: `npx.cmd vitest run tests/harness/replay-harness.test.ts tests/harness/visual-host.test.ts`

Expected: PASS.

- [x] **Step 2: Run full gates**

Run:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

Expected: all pass. Vite may still emit the existing large-chunk warning while exiting successfully.

- [x] **Step 3: Review diff**

Run: `git -c safe.directory=C:/Users/38909/Documents/github/city diff --check` and inspect the staged diff for unrelated changes or legacy `data.playtestFinding` emissions.

- [ ] **Step 4: Commit and push**

Run:

```powershell
git -c safe.directory=C:/Users/38909/Documents/github/city add src/harness/dogfood.ts tests/harness/replay-harness.test.ts docs/harness.md docs/superpowers/plans/2026-07-08-recursive-loop-dogfood.md PROGRESS.md
git -c safe.directory=C:/Users/38909/Documents/github/city commit -m "Test recursive improvement loop dogfood"
git -c safe.directory=C:/Users/38909/Documents/github/city push
```
