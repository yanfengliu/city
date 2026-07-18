# Portable prompt — starting this work in another game repo

Copy the block below into another game repository to kick off the same kind of work.
It is written to be self-contained: it states the goals and the working discipline without assuming this repo's stack, file layout, or engine.

Delete any numbered section that does not apply to the target game.
The discipline section at the end is the part that makes the rest land, so keep it.

---

## The prompt

Read the repo's `AGENTS.md` / `CLAUDE.md` and its design docs first, then work through the items below.
Treat each numbered item as a separate deliverable: explore, plan, implement with tests, verify in the running game, then commit and push before starting the next one.
Do not batch them into one giant commit.

**1. One colour language for every overlay/inspection view.**
Whatever the player is inspecting, a colour must mean the same thing on every map.
Adopt this ramp and apply it everywhere: grey = nothing to report here (unaffected, or outside the system); a deep blue = the infrastructure itself (the thing the player placed — plant, lines, pipes, the service building); green = what that infrastructure delivers (the buildings/tiles it serves), with a fainter shade for bare "in reach" area; yellow = under-served but coping; red = failing, on the edge of being lost.
One glance should separate cause (blue) from effect (green) from trouble (yellow/red).
Crucially, the infrastructure **and the things it affects** must be tinted together — if only the ground is painted while the buildings on it stay neutral, the view has failed its job.
Put the palette and the grading functions in one shared module, and have the legend/key derive its swatches from that same module so the key can never drift from what is drawn.
Where a system's absence is a nuisance rather than a catastrophe (e.g. coverage that only affects desirability), stop at blue/green/grey and never escalate to red — colouring it red overstates the stakes and teaches the player the wrong thing.
While an overlay is active, desaturate the rest of the world so the overlay is the only colour on screen.

**2. Severity must come from real simulation state, not a guess.**
Distinguish "just lost the service" from "about to be abandoned/destroyed" using the actual counter or timer the simulation already keeps, and expose it to the presentation layer as a normalised 0–1 value so the renderer needs no simulation constants.
If every problem currently renders as one flat red, that is the bug to fix.

**3. Error and rejection messages are a product surface.**
Find every place the game refuses an action, fails, or throws, and make the message say what happened, which specific input caused it, and what would satisfy it.
Never a bare "Validation failed", "invalid input", or a silent boolean false.
Name the offending coordinate/value/limit: `(45, 31) is water — build on dry land` beats `cannot build here`; `costs $500 but the treasury holds $10` beats `not enough money`; `unknown service "policeStation" — expected one of fireStation, police, clinic, school` beats anything.
A diagnostic that forces a human or an agent to read the source to learn why is itself a defect.
Write the tests so they assert message **content** — the coordinate, the rule, the shortfall — because a test that only checks for a non-empty string will happily pass a useless message.

**4. Agent realism: things that occupy space, obey rules, and have a purpose.**
If the game has moving agents (vehicles, walkers, units), audit them for these properties and fix what is missing:
they must not pass through each other (enforce a following distance / minimum gap per lane or path, ordered deterministically so nobody overtakes on a single lane);
they must obey the rules the world implies (keep to the correct side of the road, stop at a red light, yield at a junction);
they must be visibly individual rather than clones (derive paint/model/clothing variation from a stable hash of the agent's identity so it is deterministic across frames, saves, and replays);
and they must be going somewhere for a reason, not wandering.
Do not encode traffic state in the agents' colour — that duplicates the traffic overlay's job and prevents colour from meaning identity.
Add a design document that states the target model, the phases, and the contracts (tests) that define "done"; implement one phase at a time.

**5. Visual identity of placed buildings.**
Any building the player places deliberately should have its own silhouette, readable at normal play zoom — distinct massing, roof shape, and one signature accent per kind, not recoloured boxes.
Build them from shared low-poly geometry primitives, keep every tunable in a style module (no magic numbers inline), and keep the output deterministic for identical input.

**6. UI that never moves.**
Any always-visible bar or panel must not shift, grow, wrap, or re-flow as live values change.
Give numeric fields fixed-width slots and tabular figures, reserve the maximum width for text that changes length (titles, ranks), keep button metrics identical between active and inactive states, and position transient elements (toasts, badges, banners) absolutely so they can never displace the layout.
Verify it by driving real state changes and sampling the element rectangles before and after — not by eye.

---

## Working discipline (keep this part)

Scale the approach to the task: trivial changes directly; substantial work as explore → plan → implement → verify.

Write the failing test first for anything behavioural, and make it assert the real contract rather than the shape of the implementation.
A test that cannot fail for the right reason is worse than no test.

Run the repo's full gates (tests, typecheck, lint, build — whatever exists) before every commit that touches code.
Never gate on piped test output: a pipeline can swallow the exit code, so redirect to a file and check the status explicitly.

**Verify in the actual running game, not just in tests.**
Launch it, drive the real code path the player would take (click the real button, issue the real command), and look at the result — a screenshot for anything visual.
Several defects in this kind of work are invisible to unit tests and obvious on screen: tinting that gets erased by a later shader pass, a "de-emphasised" object that stays vivid because its colour lives in vertex data a material tint can only multiply, a legend that disagrees with the map.
If you claim something works, have observed evidence for it.

Keep documentation part of the change, in the same commit — design docs for what the system should do, and a running progress log recording what shipped, what the evidence was, and what was deliberately left out.

Commit each coherent, verified unit promptly with a message that explains **why** the change exists, not just what moved, and push when the task is done.
Never commit failing or half-finished work as a checkpoint.

If the request names something the game does not actually have (a system, a field, a mechanic), say so plainly instead of inventing it — surface the gap and offer to build it as separate, properly scoped work.
