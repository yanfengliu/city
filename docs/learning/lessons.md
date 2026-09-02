# Lessons

A staging area, not a destination. A lesson lands here the session it is learned, and leaves as soon as it has a gate.

Each rule is one line, linked into [lessons-evidence.md](lessons-evidence.md), which holds the war story and the anchor. Open that only when a rule is in doubt, or the work is in that area — it is not session-start reading.

A new lesson is an entry there plus one line here. Run `npm run lessons:check` to keep the two in step: a rule always has an entry, and an entry always has a rule.

When a lesson becomes a gate — a test, a lint rule, a schema check, a fixed command — delete both halves in the same commit as the gate. The machine enforces it, and the claim is written in the machine's own header, so nobody needs to read it here. Knowledge with no mechanical trigger goes to the fleet constitution (stage it in `canon-candidates.md`) or, if it is true only here, to `docs/policies/local-rules.md`. Anything that fits neither was folklore and is dropped.

The list being empty is the healthy state. `docs/learning/gate-proofs.md` records which gate replaced each lesson and the mutation that proved the gate catches it; `docs/learning/defect-register.md` is separate and permanent — it is the standing list of what the gates could not see.

## Rules
