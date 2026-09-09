# 0022 — The suite is `capture-fidelity`, and one of its metrics is not a measurement

**Status:** accepted
**Date:** 2026-09-09
**Context:** 0015 (grading design), 0018 (pure gates), 0020 (the grader pin), 0021 (the stage-boundary finding)

Three changes, and the first is a correction to 0015's premise rather than to
its code. `METRICS_VERSION` goes 2 → 3 and two frozen hashes move; §4 below is
the entry 0020 requires in the same commit.

---

## 1. The categories were named after the wrong stage

0015 built ten categories to measure infer. 0021 measured otherwise: the same
capture was inferred with each of infer's pieces disabled and graded each time,
and **no graded category moved for any of them** — entity dedup changed the
model from four entities to seven and moved nothing; the token pass changed
sixteen colours to none and moved nothing. Every metric reads
`model.operations`, and infer transcribes those from
`capture/network/endpoints.json`.

So the response schemas, the field types, the path parameters and the auth
verdict are all produced by capture's `inferEndpoints`. **Twelve numbers badged
as stage 2's were largely stage 1's.**

0021 already established that this is a labelling defect and not a misplaced
stage — §5 puts response schemas in the capture artifact ("for each endpoint,
infer a JSON Schema across all observed responses"), and §6's "deterministic, no
LLM" does not exclude them, because a schema union over observed bodies is
deterministic. **Nothing moves. The name does.**

Each metric now carries `suite: 'capture-fidelity'`, and the reports group by
it. `capture-fidelity` belongs to M1's continued-correctness gates: these are
good gates, they were wearing the wrong label, and none is deleted.

### A field, not ten renamed category ids

`endpoint-identity` and the rest keep their ids. The set is named by a `suite`
field instead, for two reasons: mangling ten category ids would churn every
document reference and every mutation row for no gain, and the suite field is
where a *second* set becomes expressible in the same frozen table.

`suite` is in the canonical form the digest is computed over. A metric moving
between suites changes what its number is a claim about, which is precisely the
quiet change the digest exists to catch — and a test drives that to a failing
verdict by recomputing over a table with one metric's suite moved, rather than
asserting the field is "included".

`GRADE_SUITES` is derived from the table, so a suite nobody uses cannot exist,
and the enum and the derived set are asserted **equal** rather than one
containing the other — the freeze-as-a-complete-set rule, which is blind in one
direction if written either way alone.

### `auth` is in `capture-fidelity`, and that was a decision

The one category that had to be decided rather than left to inherit. It is not
a field-level category and the argument for the others does not automatically
reach it.

It belongs here because `packages/infer/src/operations.ts` says so in its own
words: *"The auth verdict is copied, never re-derived. Capture watched the wire;
this stage did not."* The schema enforces it — `requiresAuth` must equal
`resolveAuthRequirement(authEvidence)` — so infer cannot disagree even if it
wanted to. 0018 §4 had already narrowed the claim to "whether the chain from
observation to verdict is faithful", and that chain is capture's.

A test asserts all five auth metrics name this suite, so the decision is
readable rather than inherited from a default.

---

## 2. `endpoint-identity.recall` is a conservation check, not a recall metric

Renamed to `endpoint-identity.conservation`.

`observedEmitted` counts observed endpoints whose `(method, pathShape)` key the
model emitted; `observed` comes from `capture/network/endpoints.json`; and
`model.operations` is a total `.map` over that same list with no filter. **Both
sides come from the observed list**, so it reads 1.000 for any stage that
transcribes the endpoint index, and no defect in inference can move it. 0021
printed `1.000` beside `path-param-naming 0.600` as though both were results.

A number that cannot fall reads as evidence and is not evidence. So:

- the metric carries a `conservation` string naming **what does move it** — a
  stage that drops an observed endpoint. That keeps the claim falsifiable
  instead of merely hedged;
- both report renderers print that sentence under the value rather than leaving
  it in the column of measurements;
- `conservation` is in the digest, because a metric silently ceasing to be a
  measurement is the same class of change as one changing subject.

It is **kept**, not deleted: dropping an observed endpoint is a real failure
mode, just not one this implementation can exhibit.

### The one number that moved, and why it is not calibration

Its gate goes `≥ 0.9 calibration` → **`≥ 1.0 structural`**. 0.9 permitted
silently losing a tenth of the observed surface, which §7 does not permit at any
rate — the required outcome for an endpoint a stage cannot carry is a gap, not a
quiet omission. There is no acceptable rate here, so the number follows from the
argument rather than from a distribution, which is what `structural` means in
0015 §5: changing it back requires overturning the argument, not producing a
measurement.

### The label is checked, not asserted in prose

The `conservation` string claims the `endpoint-deleted` mutation exercises it.
A claim in a docstring is 0012's known-gap-recorded-only-in-prose, so
`assessMutationTable` now refuses a table in which a conservation-labelled
metric has no mutation moving it, driven to that failing verdict by a test that
drops exactly that row. Without it, deleting the row would leave a metric that
cannot fall *and* nothing demonstrating what would.

---

## 3. The `allOf` alias, which had to land first

Found while measuring whether the document could ground an entity-narrowing
category, and it is recorded here because it **changed numbers 0021 reported**.

Swagger 2.0 has nowhere to write "this property is that definition, and here is
a sentence about it" — a sibling key beside `$ref` is undefined — so generators
emit the reference inside a one-member `allOf` and hang the description outside.
`deref` followed only a bare `$ref`.

**Measured: Vikunja's document uses the idiom 32 times; Gitea's uses it zero
times.** So the walk was correct for as long as Gitea was the target and became
wrong the day 0021 replaced it. *Nothing was edited to introduce this.* The
defect arrived by changing target, which is a direction nobody audits.

| metric | 0021 reported | actual |
|---|---|---|
| `response-field-presence.precision` | 0.833 205/246 | **0.955** 235/246 — fail → pass |
| `response-field-presence.recall` | 0.563 205/364 | **0.544** 235/432 |
| `field-type.accuracy` | 0.872 191/219 | **0.900** 224/249 (0.8996 — still fails) |
| `narrowing.recall` denominator | 0/0 | **0/7** |

**It failed in the flattering direction.** A truth side that under-claims does
not report a smaller truth; it shrinks the recall denominator. 0021 read 0.563
as "the crawl's reach, not a bug" — half of it was a bug, and it was on the
truth side. That is the general lesson worth keeping: *a defect whose symptom is
a better number is the one nobody investigates.*

The last row is the one that matters for what comes next. The document **can**
ground seven closed-domain claims on matched fields, where it appeared to ground
none — so 0021's reason for `narrowing` being `notDerived` is now only half
true. The zero-formats half stands and is what makes *precision* ungroundable;
the enum half does not. That asymmetry needs per-metric `notDerived`
granularity, which 0023 builds where it is load-bearing rather than bolted on
here.

Only the alias shape is unwrapped — one member, a `$ref`, no schema keyword
beside it. Anything else **throws** rather than resolving to something
plausible, for the reason above: under-claiming is invisible.
`description`/`title`/`example` are annotations and explicitly not schema
keywords, since rejecting them would refuse all 32 real occurrences — asserted
as a negative control that also fails under the *opposite* wrong implementation,
one that treats any sibling as a composition.

`truth/` is outside the pin by 0020's carve-out, so no freeze hash moved for
this.

---

## 4. What moved inside the freeze, and why — the entry 0020 requires

> A change to any of them fails the suite with one instruction: say why here, in
> the same commit.

Two of the five pinned files moved.

| file | why |
|---|---|
| `packages/schema/src/grade-contract.ts` | the `suite` field, the `conservation` label, the metric rename, `METRICS_VERSION` 3, and the digest |
| `packages/verify/src/grade/grade.ts` | the renamed id reaches `byMetric`, and `MetricResult` carries `suite`/`conservation` through to the report |

**`match.ts`, `fields.ts` and `vocabulary.ts` did not move**, and that is the
part worth reading off the list rather than the part that did. No matching rule,
no field-enumeration rule and no vocabulary exclusion changed — so nothing that
decides *identity*, *what is scoreable* or *which narrowings count* was touched
while a score was being watched. A rename that had quietly reached one of those
would appear here as a third hash.

One threshold moved (§2) and it moved **tighter**, on an argument, with the
argument written above. 0020's stated concern is "a threshold nudged while a
score is being watched"; the direction does not excuse it, so it is named
explicitly rather than folded into "the rename".

---

## Open

- `narrowing`'s `notDerived` reason is now half true for Vikunja (§3), and
  fixing it needs per-metric granularity. 0023.
- `endpoint-identity.precision` remains the only category whose *precision* is a
  real hallucination measure, and its single Vikunja miss is
  `GET /api/v1/avatar/sfadmin` against a document declaring
  `/api/v1/{username}/avatar` — genuine drift, and what the divergence list
  exists for. Still not listed, because listing it needs the recorded exchange
  proving the *spec* is wrong rather than merely different.
- The suite enum has one member. `inference` arrives with its categories in
  0023 rather than being declared empty here — a label with no members is the
  thing §1's completeness assertion exists to reject.
