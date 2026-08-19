# Defect register

Every bug or visual defect the user reports gets an entry here, the session it is reported: **symptom** as they saw it, **investigation** that located it, **root cause** in the code, and **how it is checked from now on**.

Fleet canon, and it is neither the devlog nor [lessons.md](lessons.md): the devlog records what a session did, a lesson records a transferable rule and is deleted once a gate enforces it, and this file records *the defect itself* — so a symptom the user has already paid to describe once is recognised on sight the next time, and so the "future check" line is a standing list of what the gates still cannot see.

An entry stays after its fix ships. Mark the fix and its gate inline rather than deleting it; the value is the symptom→cause pairing, not the open/closed state.

Newest first.

## The standing checks this register has bought

| Check | Runs | Catches |
|---|---|---|
| `tests/rendering/assembly-joints.test.ts` | `npm test` | Any solid in a service, leisure, or utility model that is not joined to the rest of that model. Traces every primitive the model emits and asserts they form one connected body. |
| `tests/rendering/trees.test.ts` — "seats every canopy on the trunk it grows from" | `npm test` | A canopy that clears its trunk, measured at the joint's *narrowest* azimuth. |
| `npm run visual:sweep` | Before calling any visual change done | What the eye catches and no assertion does. Photographs every model from four azimuths at two distances plus the city at two more, assembles one contact sheet per subject, and fails on a frame that drew nothing, a lost WebGL context, or a page error. Review the `sheet-<subject>.png` sheets, not the loose frames. |

The sweep's `grazing` preset exists because of the first entry below: a part floating off its support is invisible from any steep view, so a near-eye-level pass is not optional.

---

## 2026-08-19 — Tree canopies hovering above their trunks

**Status:** fixed in `f2a8505`, gated by the canopy joint contract in `trees.test.ts`.

**Symptom.** Reported in chat: *"tree body is separated from trunk."* A bare brown trunk stub stands in the grass with its foliage floating above it, most obvious on the round-canopied broadleaf and the narrow columnar; the cone-canopied conifer looked fine.

**Investigation.** Measured the geometry rather than eyeballing it: per archetype, the trunk's bounding-box top against the lower canopy's bounding-box floor. Conifer 0.340 vs 0.340 (flush), broadleaf 0.480 vs 0.580, columnar 0.500 vs 0.576. Then before/after screenshots at an identical camera, which is what made the size of it obvious — the visible gap reads far larger than 0.1, because a faceted canopy tapers to a narrow bottom edge and only reaches trunk width well above its lowest point.

**Root cause.** `createCanopyGeometry` placed each layer by its *nominal* height box, `centerY = trunkHeight + lift + height / 2`. `DodecahedronGeometry(1, 0)` bottoms out at −φ/√3 ≈ −0.934, so it fills only 93.4% of that box vertically and its real floor sits 3.3% of its height above the nominal one — silently, in a direction nothing measured. `lift` therefore lied about where the foliage started, for the two faceted archetypes only.

**Fix.** Seat each layer by its **computed** lowest vertex, so a future canopy shape cannot be seated wrong, and add a per-archetype `canopySink` that settles the whole foliage stack onto the trunk (conifer 0.05, broadleaf 0.15, columnar 0.16).

**How it is checked from now on.** `trees.test.ts` asserts the canopy reaches below the trunk top *and* is wider than the trunk where they meet — measured at the section polygon's **narrowest** side, not its widest. That distinction is the whole check: the first version of the test used the widest, which passes a canopy that still shows daylight (0.158 wide facing the faceted bottom edge, 0.040 perpendicular to it, against a 0.075 trunk radius), and trees are randomly rotated under a free camera. Narrowest section at the trunk top moved 0.000 → 0.318 / 0.141 / 0.085 against trunk radii 0.055 / 0.075 / 0.060.

**Class.** *A part of an assembly detached from the part below it.* Generalised to every composed model by `assembly-joints.test.ts`, which found the next entry on its first run.

---

## 2026-08-19 — School flag attached to nothing

**Status:** fixed the same session. Found by the class audit above, not by a human.

**Symptom.** None visible. The first run of `assembly-joints.test.ts` reported the school's flag as a disconnected group with a nearest gap of 0.0017.

**Investigation.** The flag's inner edge started at `f.u(0.46) + 0.013` — the flagpole's radius. The pole is drawn as a 6-sided tube, so it only reaches that radius at a vertex; between vertices it falls back to the inradius, 0.013·cos 30° ≈ 0.0113.

**Root cause.** "Attach at the radius" is wrong for every faceted primitive in this renderer. A polygonal tube is narrower than its nominal radius almost everywhere on its surface.

**Fix.** Start the flag at the pole's axis, so its first 0.013 is socketed inside the post.

**How it is checked from now on.** `assembly-joints.test.ts`, permanently. It was fixed despite being sub-pixel at any reachable zoom, because the alternative was widening the audit's tolerance from float noise to 100× float noise, which would blind it to gaps that *are* visible.

---

## Known gaps

What the standing checks do **not** cover. Named so a green run is not mistaken for full coverage.

- **Grown RCI buildings are missing from the sweep scene.** The scene builds roads, all six services, both power plants, a pump, utility runs, and R/C/I zones, and the zones stay empty: 22 zoned cells, demand `r: 0.25`, power 440 and water 300 supplied, advisor stuck on "Zone R, C and I within 2 cells of a road". Tried and did not fix it: linking the road to the real highway gateway column (which did clear the highway advisory), zoning all three kinds, keeping every pipe and power line off the zone rows, running utilities alongside each strip, advancing 900 s. The sweep reports it as a failed scene step with every counter, so the gap is loud rather than silent.
- **Buildings' own geometry is not joint-audited.** `building-archetype-geometry.ts` merges its parts into one `BufferGeometry` with no part list, so the connectivity audit has nothing to walk.
- **Bounds-level connectivity is coarse.** Two solids whose bounding boxes overlap can still show daylight between their surfaces — exactly the shallow-sink canopy case. Only a shape-aware check like the tree contract catches that, and only trees have one.
- **Nothing compares frames between runs.** The sweep proves a frame drew something; it cannot tell you a colour changed.
