---
name: multi-cli-review
description: Use when running the multi-CLI (Codex + Claude) adversarial code review on high-risk changes or full-codebase audits — routes to the fleet-canonical runbook (pins, commands, output extraction, failure modes) plus city-specific notes.
---

# Multi-CLI review — city stub

**Read the fleet-canonical runbook now:** `../loop-ops/docs/skills/multi-cli-review.md` — current review model pins (the fleet's single bump site), exact CLI commands, `-o` output extraction, Windows gotchas, and failure modes. Do not act from memory of an older per-repo copy of this skill.

city-specific notes:

- Reviewer pin sites in scripts: NONE (verified 2026-07-10 — no repo script hard-codes a reviewer model).
- App-facing LLM pins: none to bump from here — the visual-loop harness LLM is env-var-driven (`CITY_LLM_VISUAL_LOOP_COMMAND` in `scripts/llm-visual-loop.mjs`; deterministic scripted agent by default), not a pinned model string.
- Unreachable-CLI notes go to `PROGRESS.md` — this repo has no devlog, so the canonical's "devlog or progress log" maps to PROGRESS.md here.
- Review capture home: the canonical default `tmp/review-runs/<objective>/<date>/<iteration_number>/` (never staged; cleaned up after synthesis) — no repo override.
