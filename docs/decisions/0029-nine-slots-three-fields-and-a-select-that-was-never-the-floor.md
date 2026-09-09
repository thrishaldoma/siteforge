# 0029 — Nine slots, three fields, and a `<select>` that was never the floor

*Status: accepted. Supersedes the reading of `narrowing.recall` given in 0026 §4.*

## 1. The correction, first

Last turn I reported that `narrowing.recall 0.0000 0/9` and
`entity-narrowing.recall 0.0000 0/1` are **model-side floors, not target
properties**, on the strength of six `<select>` elements sitting in the captured
DOM that our extractor discarded.

That is wrong. The `<select>` finding was real and the extractor was broken, but
neither of those facts is about these two metrics. I looked at what the model
lacked and never at what the denominators *are*.

They are nine slots and one slot over **three distinct fields**, and no
inference this project could produce moves either number.

## 2. The nine

Reproduced by `packages/verify/scripts/narrowing-denominator.mjs`, which
rebuilds the grader's own construction — `matchEndpoints`, then
`modelFieldPointers`, then the same `status#pointer` key — rather than
approximating it. The first approximation came out at 8, which looked close
enough to trust and was not: the grader treats a `200` response field and a
request field as separate slots, and `POST /tasks/:task` declares
`repeat_mode` on both sides.

| # | endpoint | pointer | truth declares | model emits | observed |
|---|---|---|---|---|---|
| 1 | `GET /api/v1/projects` | `/[]/views/[]/bucket_configuration_mode` | `integer` enum `["0","1","2"]` | `string`, no narrowing | `["manual","none"]` |
| 2 | `GET /api/v1/projects` | `/[]/views/[]/view_kind` | `integer` enum `["0","1","2","3"]` | `string`, no narrowing | `["gantt","kanban","list","table"]` |
| 3 | `GET /api/v1/projects/:project` | `/views/[]/bucket_configuration_mode` | `integer` enum `["0","1","2"]` | `string`, no narrowing | `["manual","none"]` |
| 4 | `GET /api/v1/projects/:project` | `/views/[]/view_kind` | `integer` enum `["0","1","2","3"]` | `string`, no narrowing | `["gantt","kanban","list","table"]` |
| 5 | `GET /api/v1/tasks/all` | `/[]/repeat_mode` | `integer` enum `["0","1","2"]` | `integer`, no narrowing | *nothing* |
| 6 | `GET /api/v1/projects/:project/views/:view/tasks` | `/[]/repeat_mode` | `integer` enum `["0","1","2"]` | `integer`, no narrowing | *nothing* |
| 7 | `GET /api/v1/tasks/:task` | `/repeat_mode` | `integer` enum `["0","1","2"]` | `integer`, no narrowing | *nothing* |
| 8 | `POST /api/v1/tasks/:task` | `/repeat_mode` (response) | `integer` enum `["0","1","2"]` | `integer`, no narrowing | *nothing* |
| 9 | `POST /api/v1/tasks/:task` | `/repeat_mode` (request) | `integer` enum `["0","1","2"]` | `integer`, no narrowing | *nothing* |

`entity-narrowing.recall`'s single slot is `models.Task` property 25, which is
`repeat_mode`. The tenth slot is the same field a sixth time.

Three field names: `view_kind`, `bucket_configuration_mode`, `repeat_mode`.

## 3. Why no inference reaches them

`narrowingAgrees` asks whether every value the truth declares is in the set the
model claims. The nine split cleanly in two, and neither half is a floor we can
raise.

### 3.1 Four slots: the document is wrong about the wire

Vikunja's Swagger declares `view_kind` an integer enum of `0..3`. The API
returns `"list"`, `"gantt"`, `"kanban"`, `"table"`. `bucket_configuration_mode`
is declared `0..2` and returns `"manual"`, `"none"`.

To score these the model must emit `["0","1","2","3"]` for a field it watched
return `"list"`. That is not a harder inference, it is a **false** one, and §7.5
exists to forbid exactly it: narrowing must be justified by evidence, and the
evidence here says the opposite of what the document says. A grader that could
only be satisfied by contradicting the observation is measuring the document, not
the model.

Recording this as a *result*, not a defect: these four are unreachable at any
inference quality, permanently, while the document says what it says.

### 3.2 Five slots: nothing was observed at all

`repeat_mode` is observed as an integer, and **no integer node anywhere in the
capture carries a single observed value** — 0 of 68, against 273 of 324 string
nodes. §7.5's own rule settles it before any ladder runs: zero observations
justify nothing.

That count is a real defect and it is fixed in §5 below. It is not, however, a
route to these five slots, for the reason in §6.

## 4. The extractor, fixed anyway

The `<select>` finding stands on its own and is not about recall.

`capture-lib.mjs` queried `select[name], select[id]`. On the pinned Vikunja that
matched **none of six**: a Vue SPA binds through `v-model` and has no reason to
emit either attribute, so every select carried nothing but `data-v-321f61a6`.
Six selects and 632 options in, zero UI constraints out, and nothing failed —
§7.5's *primary* evidence, silently unreachable on any framework-rendered page.

`[name]` is how a **form posts** a control. A control's identity is that it is a
`<select>`. The attribute requirement was a form-submission reflex surviving into
a codebase that reads controls rather than posting them.

It was three gates, not one:

1. the selector itself;
2. `if (!node.name …) continue` in the consumer — and
   `getAttribute('name') ?? select.id` yields `''` for an unnamed select, which
   is falsy, so a fixed selector alone would have been undone here;
3. the consumer's index is **keyed by field name**, so an unnamed control cannot
   be a member of it at all. That one is not a guard to delete. It is the data
   structure, and replacing it is the binding problem (0030).

Radio groups keep their `[name]` requirement, and that is a different rule rather
than an inconsistency: HTML groups radios *by name*, so the attribute is what
makes several inputs one control. A nameless radio is not an option set with
nothing to read; it is not an option set.

The two consumers were byte-identical copies in `capture-site.mjs` and
`rung3.mjs`, both carrying the same guard — so the fix is one
`collectUiConstraints`, or it would have been undone twice.

## 5. The integer that recorded nothing

`inferSchema`'s `examples` recording lived inside the `string` branch. The
terminal `return { type: kind, … }` dropped the observed values of every
integer, number and boolean in the capture.

This is not a grading concern and would not have been found by chasing one. §8
seeds the mock store "from real captured responses" — so **every numeric field in
the generated clone was seeding from nothing at all**, on every target, since the
inferencer was written.

Recording an observation is not narrowing. `examples` constrains nothing, and
§7.5's rule runs the other way: widening is free and what was actually seen is
the cheapest evidence there is.

## 6. Predictions, written before the measurement

§13: a variant that changed nothing reports the same "nothing moved" a real null
result reports, and only a prediction written beforehand can tell them apart.
Here exact non-movement is the *correct* outcome, which is the case that reads
like failure without this section.

| metric | before | predicted after | why |
|---|---|---|---|
| `narrowing.recall` | 0.0000 0/9 | **0.0000 0/9, byte-identical** | 4 slots need a claim the wire contradicts; 5 need values a seeded instance does not exhibit. Neither change in this turn touches either. |
| `entity-narrowing.recall` | 0.0000 0/1 | **0.0000 0/1** | the same `repeat_mode`. |
| `entity-narrowing.precision` | vacuous | **vacuous** | the six selects are all on `user-settings-general` and constrain none of the three fields; and they are unnamed, so the index cannot hold them until 0030 lands. |
| every other graded metric | — | **unchanged** | the model's field set, types and endpoints are untouched. `examples` is not a scored field. |
| `coverage.extracted.uiConstraintSelects` | absent | **6** | the input side is 6 and the invariant is an equality. |
| `coverage.extracted.scalarKindsWithExamples` | absent | **matches `bodyScalarKinds`** | same. |

If `narrowing.recall` *moves*, something is wrong: on this target it can only
move by emitting a narrowing the observation contradicts.

The denominators themselves must also not move. They are a property of the truth
document and of which endpoints matched, and nothing here touches either.

## 6.1 Measured

Capture re-run against the pinned digest, infer re-run, graded. Every prediction
held.

| metric | predicted | measured |
|---|---|---|
| `narrowing.recall` | 0/9 | **0.0000 0/9** |
| `entity-narrowing.recall` | 0/1 | **0.0000 0/1** |
| `entity-narrowing.precision` | vacuous | **vacuous** |
| `endpoint-identity.precision` | unchanged | 0.9545 21/22 |
| `request-field-presence` | unchanged | 0.6494 50/77 · 0.5155 50/97 |
| `response-field-presence` | unchanged | 0.4538 270/595 · 0.4954 270/545 |
| `field-type.accuracy` | unchanged | 0.8969 287/320 |
| `entity-identity.precision` | unchanged | 1.0000 4/4 |
| `entity-field-presence` | unchanged | 1.0000 58/58 · 0.9355 58/62 |
| `auth.*` | unchanged | evidence 1.0000 17/17 · truth 0.6190 13/21 · under-gate 0 |
| `uiConstraintSelects` | 6 | **6**, equal to `domSelectElements` |
| `uiConstraintsBindable` | 0 | **0** — the whole gap is 0030's |
| `scalarKindsWithExamples` | equal to observed | **2 = 2** |

**And the input demonstrably differed**, which is the half that makes a null
result a result: numeric nodes carrying observed values went **0 of 68 → 68 of
68** in the capture, 86 of 86 in the model. `assessVariantIsMeasurable`'s rule
applied by hand — an artifact that did not change reports the same "nothing
moved" a real null result reports.

`scalarKindsWithExamples` reads 2 rather than 3 because Vikunja's JSON carries
integers and booleans and no fractional numbers. Both sides say 2; the equality
is comparing like with like.

One thing was wrong first time and is worth recording. `bodyScalarKinds` came
back **0 against an extracted 2**, so the invariant read *vacuous* rather than
*failing*: `observation.body` is already parsed by the route handler, and
re-parsing it threw on every exchange. §13's first vacuity mode, wearing a green
tick — and found only by reading the number instead of the ✓, which is the
argument for printing both sides of every invariant rather than a verdict.

## 6.2 Re-measured at HEAD, after the reduced-motion fix

§6.1 was measured at `5108730`. 0031 §2.1 then changed what a context *is* —
`prefers-reduced-motion: reduce` now applies to both crawl contexts, which
previously ran without it. That is a capture-behaviour change, so §6.1's numbers
are stamped to a commit that no longer describes the driver, and the grade has
to be taken again rather than assumed to carry.

Run-to-run stability does not answer this. 0032 §3.1 shows the read-only
idempotence residual is **exactly 4 before and after**, but reproducing perfectly
says nothing about whether the artifact *changed* — a different capture that
reproduces is still a different capture.

Predicted before running:

| | prediction | why |
|---|---|---|
| every graded metric | **unchanged** | reduced motion suppresses animation; it does not alter API traffic, and every scored category reads endpoints and fields. |
| `uiConstraintSelects` | **6** | the six selects are static markup. |
| `controlsUndriveable` | **the one number genuinely at risk** | 49 of 51 timeouts are on a `position: fixed` sidebar that carries an animated `transform` (0032 §5). Suppressing animation is the one change that could plausibly move it, in either direction. |

Measured at `eb0465f`:

| metric | §6.1 | at HEAD |
|---|---|---|
| `narrowing.recall` | 0.0000 0/9 | **0.0000 0/9** |
| `entity-narrowing.recall` | 0.0000 0/1 | **0.0000 0/1** |
| `endpoint-identity.precision` | 0.9545 21/22 | **0.9545 21/22** |
| `request-field-presence` | 0.6494 · 0.5155 | **0.6494 · 0.5155** |
| `response-field-presence` | 0.4538 · 0.4954 | **0.4538 · 0.4954** |
| `field-type.accuracy` | 0.8969 287/320 | **0.8969 287/320** |
| `entity-identity.precision` | 1.0000 4/4 | **1.0000 4/4** |
| `entity-field-presence` | 1.0000 58/58 · 0.9355 58/62 | **1.0000 58/58 · 0.9355 58/62** |
| `uiConstraintSelects` | 6 | **6** |
| `controlsUndriveable` | 71 | **66** — the one that moved, and it decomposes |

Every graded metric is identical, so the prediction held where it mattered. The
number flagged as at risk did move, and it splits in a way worth keeping:

| | §6.1 | at HEAD |
|---|---|---|
| `click/timeout` | 51 | **51** |
| `in viewport false` | 49 | **49** |
| ancestors under `aside.menu-container` | 45/49 | **45/49** |
| `locate/not-found` | 20 | **15** |

The sidebar half is **byte-identical**, which §13 reads as the strong signal:
suppressing animation did not reach that mechanism at all — consistent with
0032 §5, where the cause is layout (`position: fixed` over `overflow: auto`)
rather than motion. All five recovered controls come from `locate/not-found`,
the failure where the element was never found, which is the one an in-flight
transition could plausibly cause.

## 7. Invariants added

§6's standing rule: whenever a rung finds a silent drop, add the invariant that
would have caught it. Three drops, three invariants, three sabotage cases.

- **`selects-imply-option-set-controls`** — an equality. The observed side comes
  from `dom.json`'s node tree via `countOptionSetsInDom`, **never** from the
  extractor's own `querySelectorAll`. That independence matters more here than
  anywhere else in the table, because *the bug was in the selector*: an observed
  side that asked the page the same question would have returned zero too, and
  the check would have read green over a page holding six.
- **`radio-groups-imply-option-set-controls`** — split from the above rather
  than totalled with it, so surviving radio groups cannot mask every select
  disappearing. That is 0008's lesson, where nine pseudo-class entries kept
  `statesCssom` non-zero while attribute states were entirely gone.
- **`scalar-values-imply-recorded-examples`** — compared **by kind**, because
  the two sides count different populations (values in bodies against nodes in a
  schema) and dedup, array folding and the depth cap legitimately separate them.
  Kind is where they are comparable, and it is granular enough: a driver losing
  only integers fails this, and would not fail a single total.

## 8. A fifth cause for the vacuity table, proposed not adopted

§13's taxonomy has four causes for a vacuous or unmovable category: target
limitation, driver limitation, unimplemented stage, declined on evidence.

§3.1 fits none of them. The truth is not silent (target limitation). The harness
ran and the artifact is full (driver limitation). The stage exists and produced a
correct answer (unimplemented stage). And the producer did not *decline* — it
correctly refused a claim the ground truth demands.

The candidate fifth cause is **the ground truth is wrong about the wire**: the
document declares a field's type and vocabulary, the API demonstrably speaks
another, and agreement is only purchasable by contradicting the observation. Its
permanence is the document's, not ours. Its tell is that the model and truth both
have a value set and the two are *disjoint* — distinct from disagreeing.

Not added to §13 in this turn. §13's own warning applies — a rule with one
motivating instance and no tool it breaks is padding — and this one changes how a
whole metric is read, so it is the user's call. The four fields are recorded here
rather than filed under a row that would send the next reader to a package with
nothing wrong in it.

## 9. Open

- **`repeat_mode` needs an integer path in §7.5's ladder**, which does not exist:
  `classifyStringField` is string-only. Deliberately not added in this turn. It
  is unasked-for, it is the one change that could produce a *wrong* narrowing,
  and §3.2 shows it cannot score — a seeded instance exhibiting one repeat mode
  supplies `["0"]` where the truth wants `["0","1","2"]`, and
  `narrowingAgrees` still fails.
- The six extracted selects are now in the capture and **nothing reads them**,
  because the index is keyed by name. That gap is the size of the binding
  problem and is measured as `uiConstraintSelects − uiConstraintsBindable`.
  0030 is the design.
