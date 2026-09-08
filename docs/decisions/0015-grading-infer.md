# 0015 — Grading infer against a spec somebody else wrote

Status: accepted (design). No implementation this turn.

Infer is the first stage whose output cannot be checked by re-reading its input.
Capture is gradeable against the page it crawled; infer produces claims —
"this field is an enum", "this endpoint requires auth" — that are either true of
the real system or silently wrong. §7 exists because a hallucinated endpoint
"silently corrupts every trajectory that touches it". Nothing in the pipeline
currently notices.

This specifies the grader. It is written **before** infer, and it is measured by
a mutation harness like every other gate here.

---

## 0. Sequencing, because `SiteModel` is still reserved

`packages/schema/src/site-model.ts` is a placeholder: decision 0001 held the
name and deferred the design to M2, and §5 says SiteModel is "derived backwards
from what codegen consumes. Do not define it by forward-transforming
`CaptureModel`."

That makes the order here slightly unusual, and it is worth stating plainly
before anything else:

1. **Ground-truth loader** + a committed spec snapshot. Depends on nothing in
   this repo's model layer; the vocabulary is the spec's.
2. **The scored-field contract** — §3 below. Written in the ground truth's
   vocabulary (endpoints, methods, path parameters, auth, field types), so it
   can be settled before SiteModel exists.
3. **SiteModel**, designed at M2. The scored-field list becomes a second
   backward-derivation force alongside "what codegen consumes": a field the
   grader scores is a field SiteModel must carry.
4. **The grader**, against SiteModel and the truth snapshot.
5. **The mutation harness** and the known-correct model.
6. **Then `packages/infer`.**

Steps 1–2 are the part that must not wait. They are what stops the metric being
shaped around what infer happens to emit.

---

## 1. Ground truth

**A self-hosted Gitea, graded against its own published OpenAPI spec.**

Gitea serves a machine-readable description of its API: the Swagger UI at
`/api/swagger`, and the spec document itself as JSON (`/swagger.v1.json` at the
time of writing — the loader must fetch it, assert it parses, and fail loudly if
the path has moved rather than falling back to anything). It gives us endpoints,
methods, path and query parameters, declared auth, response status codes, and
field types, all written by people who were not us.

**Not the rung-3 CRUD app.** We wrote that server. Grading against it measures
whether infer agrees with the model already in our heads, which is precisely the
failure §7 warns about and precisely why generated fixtures could not validate
capture: a fixture built from the same beliefs as the code confirms the beliefs.
The rung-3 app keeps its job — exercising capture's mechanisms against something
we can make inflict specific hazards (§13). It is disqualified from grading
inference for the same reason it is good at the other thing.

§13 already nominates Gitea as the M3+ target and forbids developing against
production sites we do not own. This runs a local container.

### Pinning

- The Gitea container is pinned **by image digest**, not by tag. A tag moves and
  the ground truth moves with it, silently.
- The fetched spec is **committed as a snapshot** under
  `packages/verify/fixtures/gitea/` alongside the digest it came from. The
  grader's unit tests and the mutation harness read the snapshot, so they run
  offline in milliseconds and belong in `verify:clean`.
- Re-fetching the spec from a live container is a separate, explicit step whose
  only job is to update the snapshot. It asserts the digest matches; a digest
  change is a deliberate commit with a diff someone reads.
- The full capture-then-grade run against a live Gitea is the **milestone gate**,
  run on demand. It is far too heavy for `verify:clean`, and saying so here
  prevents someone quietly making the fast suite depend on Docker.

### The graded universe

- **Only requests under `/api/v1/`.** The spec describes that surface and not
  the web UI's own routes. An endpoint infer emits for `/user/login` is neither
  correct nor a hallucination against a document that never mentions it;
  scoring it either way is noise. Everything outside is counted and reported as
  `out-of-universe`, never scored.
- Endpoints the crawl never touched are not infer's failure. See the recall
  denominators in §3.

### Known divergence

An OpenAPI document is hand-maintained and drifts from the server. Some Gitea
endpoints answer anonymous reads the spec marks as requiring a token, and the
reverse happens too. When a graded field disagrees, the score alone cannot tell
you whether infer is wrong or the spec is stale.

**Decide before the first run, or the first bad run produces exclusions
indistinguishable from tuning:**

- A committed `known-divergence.json`: one entry per excluded field, each
  carrying the endpoint, the field, what the spec says, what the server actually
  does, and **the evidence for that claim** — a recorded request/response, not a
  belief. Same shape as `NarrowingRecord`: the justification travels with the
  exclusion, and an entry without evidence does not parse.
- Excluded fields are removed from both numerator and denominator, and the
  report states how many were excluded per category.
- A test asserts the list stays **≤ 5% of graded endpoints**. Past that, the
  ground truth is not fit for grading and the problem is the target, not the
  threshold.
- An entry may only be added on evidence that **the spec** is wrong. "Infer
  disagrees" is not evidence.

---

## 2. Matching an inferred endpoint to a spec endpoint

Before anything is scored, the two sides have to be aligned, and the alignment
is where a grader quietly becomes generous.

- Match on **(method, path shape)** where the path is parsed into segments and
  every parameter segment is normalised to a positional hole:
  `/api/v1/repos/{owner}/{repo}/issues` and `/api/v1/repos/:owner/:repo/issues`
  both become `api/v1/repos/*/*/issues`.
- Parsed, by segment, never string-compared. §13's identifier rule, and this is
  the fifth grammar it applies to: a prefix or substring test here would match
  `/api/v1/repos-archive` against `/api/v1/repos`.
- **Parameter names are scored, not matched on.** Capture infers a name from
  observed values and has no way to know the spec calls it `owner`. Folding
  naming into identity would make every endpoint a miss for a cosmetic reason
  and hide real misses behind the noise. Arity is part of the shape; naming is
  its own category.
- Matching is one-to-one. An inferred endpoint matching two spec entries, or
  vice versa, is a **matching ambiguity** — reported as its own count, scored as
  a miss on both sides, never resolved by picking the better-scoring pair.

---

## 3. The scored categories

Per-field precision and recall, **reported per category and never blended into
one number.** §13: an aggregate lets a partial loss hide inside a surviving
total. There is no overall score. The gate is a conjunction: every category
passes its own threshold.

A "field" is a distinct addressable claim: an endpoint, a path parameter, a
response field at a JSON pointer, a narrowing on such a field.

| category | unit | precision denominator | recall denominator |
|---|---|---|---|
| `endpoint-identity` | (method, path shape) | endpoints infer emitted, in-universe | endpoints **capture observed**, in-universe |
| `path-param-arity` | endpoint | matched endpoints | matched endpoints |
| `path-param-naming` | parameter | matched parameters | matched parameters |
| `request-field-presence` | (endpoint, JSON pointer) | fields infer emitted | fields the spec declares, on matched endpoints |
| `response-field-presence` | (endpoint, status, JSON pointer) | fields infer emitted | fields the spec declares, on matched endpoints |
| `field-type` | matched field | fields infer typed | fields the spec types |
| `narrowing` | matched field carrying enum/const/format | narrowings infer emitted | narrowings the spec declares |
| `identifier` | field with `identifier.pathParamOf` | identifiers infer emitted | foreign keys derivable from the spec |
| `synthesized-endpoint` | endpoint with `discovery: bound-from-control` | synthesized endpoints emitted | *(not scored — see below)* |
| `auth` | endpoint | — three metrics, §4 | — |

Four denominator choices carry the design:

**Recall for `endpoint-identity` is over what capture observed, not over the
spec.** Gitea's spec has hundreds of endpoints and a crawl will touch a few
dozen. Scoring infer's recall against the whole spec measures the crawler's
reach and calls it inference quality. Crawl coverage — `observed / spec-total` —
is reported beside the score as a property of **capture**, and is not gated
here. Two numbers, two subjects.

**Precision for `endpoint-identity` is over what infer emitted**, because that
is the hallucination measure and hallucination is §7's cardinal sin.

**`synthesized-endpoint` has precision only.** These are §7.6's
`bound-from-control` endpoints with `responses: []` — a URL read out of a
`<form action>` or a `fetch()` literal for a control capture never fired. They
are the highest-hallucination-risk claims in the model and are scored hardest.
Recall is meaningless: not binding a control is a gap, which is the correct
outcome, not a miss.

**`narrowing` precision matters and recall barely does.** §13: narrowing must be
justified, widening is free. A missed enum costs an over-permissive mock; a
wrong enum makes valid states of the real system unrepresentable in the clone
and corrupts every trajectory through the field. Recall is reported, not gated.

Field-type comparison is against the spec's JSON type, with two normalisations
fixed in advance so they cannot be argued after seeing a score: `integer`
counts as a match for `number`, and a nullable type matches its non-nullable
counterpart when the spec marks the field optional. Everything else is a miss.

---

## 4. `requiresAuth`, which is not a symmetric problem

Since 0014, `resolveAuthForCodegen` fails closed: `unknown` resolves to
required, reads included. That changes what a good score means, and a naive
accuracy number would now actively mislead.

**A degenerate infer that marks every endpoint `required` never under-gates.**
It would score perfectly on the metric that matters most. So auth is not scored
as accuracy, precision or recall. It is three numbers over **three different
denominators**, and they are never combined:

| metric | numerator | denominator | why |
|---|---|---|---|
| **under-gate count** | endpoints infer leaves open where the spec says auth is required | endpoints where **truth == required** | the invisible failure |
| **over-gate rate** | endpoints infer gates where the spec says public | endpoints where **truth == not-required** | the visible, cheap failure |
| **evidence coverage** | endpoints resolved from recorded evidence rather than the fail-closed default | **all graded endpoints** | what stops the degenerate model scoring well |

Naming the denominator in the table is deliberate. Written as three bare rates,
the next reader averages them.

The asymmetry, restated from 0014 because the grader has to encode it: a
wrongly-gated read costs an agent one login step and is **visible** in the
trajectory. A wrongly-public gated read is invisible — every §10 auth task
reading through it is bypassable, and the trajectory reads as success while
proving nothing. These are not two instances of "wrong".

So:

- **Under-gate count must be zero.** Structural, not calibration. One instance
  fails the gate. There is no rate here because a rate invites trading a leak
  against volume.
- **Over-gate rate is bounded but nonzero-tolerant.** Failing closed on a
  genuinely unknown endpoint is correct behaviour, not an error, and infer
  should not be pushed to guess `not-required` to improve a number.
- **Evidence coverage is the real quality signal.** It measures how much of the
  auth verdict rests on something observed — an anonymous success, a 401 to an
  uncredentialed request, a context diff — rather than on the default. A model
  that gates everything has an under-gate count of zero and evidence coverage
  near zero, and fails on the third number. That is the whole point of the
  third number.

Endpoints on the known-divergence list are excluded from all three, and the
count of exclusions is reported next to them.

---

## 5. Thresholds, and what happens below them

Two kinds of threshold, and the doc marks which is which, because a later change
to one is calibration and to the other is a retreat:

| category | metric | threshold | kind |
|---|---|---|---|
| `endpoint-identity` | precision | ≥ 0.95 | calibration |
| `endpoint-identity` | recall (vs observed) | ≥ 0.90 | calibration |
| `path-param-arity` | accuracy | ≥ 0.95 | calibration |
| `path-param-naming` | accuracy | reported only | — |
| `request-field-presence` | precision / recall | ≥ 0.95 / ≥ 0.90 | calibration |
| `response-field-presence` | precision / recall | ≥ 0.95 / ≥ 0.90 | calibration |
| `field-type` | accuracy | ≥ 0.90 | calibration |
| `narrowing` | precision | ≥ 0.98 | **structural** |
| `narrowing` | recall | reported only | — |
| `identifier` | precision / recall | ≥ 0.90 / ≥ 0.80 | calibration |
| `synthesized-endpoint` | precision | ≥ 0.90 | **structural** |
| `auth` | under-gate count | **= 0** | **structural** |
| `auth` | over-gate rate | ≤ 0.20 | calibration |
| `auth` | evidence coverage | ≥ 0.70 | calibration |

**Every calibration number here is provisional until the first Gitea run.** You
cannot calibrate a threshold before you have a measurement, and presenting these
as settled invites reading a later adjustment as a failure rather than as the
calibration it is. Changing one requires a decision note recording the measured
distribution that justified it. Changing a **structural** threshold requires
overturning the argument behind it, not a measurement: narrowing precision is
near-1 because a wrong enum is silent corruption, and the under-gate count is
zero because that failure is invisible.

### A field below the threshold

A graded field infer got wrong is a **review item**, and there are exactly three
permitted responses, in order of preference:

1. **Fix infer.**
2. **Widen the claim** and record a review-required gap. An unsupportable enum
   becomes `string`; an unsupportable `identifier` becomes an ordinary field.
   This is §7's standing rule — a gap, not an invention — and §13's: narrowing
   must be justified, widening is free. Note that `requiresAuth` cannot be
   widened this way: the safe direction is already the default, so an auth miss
   is always case 1 or 3.
3. **Add it to the known-divergence list**, only on evidence that the *spec* is
   wrong, with the recorded exchange that proves it.

Adjusting the metric is not on the list. Neither is a per-field exception in the
grader.

### A category below the threshold

**M2's infer gate fails.** §13: never `--force` past a failing gate — add the
gap and let it fail visibly. M2 is green when the visual gate passes on the
static marketing site **and** this grade passes on Gitea; the two use different
targets because a static marketing site has no API to infer anything from, and
grading against one would be the vacuous check with a number on it.

---

## 6. Vacuity is a scored outcome, not an exception

Every rate here has a denominator that can be zero, and a zero denominator is
where graders lie: `TP / (TP + FP)` with no predictions is conventionally 1.0,
and a category nobody exercised then reports perfect.

- Each category in the report carries `vacuous: true` plus **which denominator
  was zero**, and the gate treats vacuous as failure.
- Not a thrown exception. Throwing loses which category was empty, and §13
  requires counts disaggregated to the granularity of the failure.
- The ground-truth loader asserts a floor on what it loaded (endpoint count,
  and that the `/api/v1/` universe is non-empty) before any comparison runs.
  A grader whose truth failed to load must not report anything.

---

## 7. Written before infer, and kept that way

The constraint is not chronology for its own sake. A metric authored after the
thing it measures gets shaped around what that thing produces and then scores it
well — the same circularity that disqualifies the rung-3 app as ground truth.

- The category table, denominators and thresholds live in one committed module
  with a `METRICS_VERSION`. A test asserts a digest of that table matches a
  committed constant, so changing a threshold requires updating the digest in
  the same commit. It cannot be done quietly; it shows up in review.
- Changing anything in that table after infer's first commit requires a decision
  note stating what was measured and why.
- The **known-correct model** — a hand-authored SiteModel transcribed from the
  Gitea spec — is the mutation baseline. It must parse against SiteModel's
  schema, including narrowing evidence, so it is a *legal* model and not a
  transcription (decision 0011: a fixture in a shape its producing stage cannot
  produce is a lie).
- **Its near-1.0 score is not evidence the grader works.** It was derived from
  the ground truth; scoring it well is circular. Only the mutation deltas in §8
  are evidence.

---

## 8. The mutation harness

A grader that scores everything highly is the vacuous invariant with a number on
it. So the grader gets what every other gate here has (§13), in the executed
form 0014 settled on: committed perturbations, applied, measured, reverted.

Each entry names the perturbation, **the category that must move**, and the
**minimum delta**. Asserting only that "the score dropped" is the mistake §13
now calls out by name — assert on the discriminating property, the thing that
differs between correct and broken.

| perturbation of the known-correct model | must move | minimum |
|---|---|---|
| flip one enum to `string` | `narrowing` recall | ≥ 1 field's worth |
| give one `string` field a fabricated enum | `narrowing` precision | below its structural threshold → gate fails |
| delete one endpoint | `endpoint-identity` recall | ≥ 1/N |
| add one endpoint absent from the spec | `endpoint-identity` precision | ≥ 1/(N+1) |
| flip one `required` to `not-required` | auth **under-gate count** | 0 → 1 → gate fails |
| flip one `not-required` to `required` | auth over-gate rate **and** evidence coverage | both move |
| replace one evidence-backed verdict with the default | auth evidence coverage only | under-gate count unchanged |
| change one field's type `integer` → `string` | `field-type` accuracy | ≥ 1 field's worth |
| delete one response field | `response-field-presence` recall | ≥ 1 field's worth |
| add one fabricated response field | `response-field-presence` precision | ≥ 1 field's worth |
| point one `pathParamOf` at the wrong endpoint | `identifier` precision | ≥ 1 field's worth |
| add one `bound-from-control` endpoint absent from the spec | `synthesized-endpoint` precision | ≥ 1/(N+1) |
| **rename one path parameter** | `path-param-naming` **only** | `endpoint-identity` P and R **unchanged** |
| **empty the ground truth** | every category | all `vacuous: true`, gate fails — never 1.0 |
| **empty the model** | every category | gate fails — never 1.0 |

The last three are the ones that catch a bad grader rather than a bad model.

- The **rename** case is the negative assertion, and the table is incomplete
  without it: a grader that drops every score on any change passes every other
  row here while measuring nothing. It has to hold one score still.
- The two **empty** cases pin §6.

Two completeness assertions, in the style this repo already applies to
`COVERAGE_INVARIANTS`, `SECRET_RULES` and the rung tables:

- every scored category has **at least one** mutation whose `must move` names
  it — a category nobody perturbs is a category nobody knows fires;
- the set of categories named across the table **equals** the set of scored
  categories exactly, so adding a category without a mutation fails the suite.

The harness runs against the committed snapshot, in milliseconds, and belongs in
`verify:clean` with the rest.

---

## 9. Where it lives

`packages/verify/src/grade/`. §4's package table is unchanged — verify owns
gates, and this is a gate.

It reads `capture/`, a SiteModel, and a committed truth snapshot. It touches
**none** of the visual, behavioral or determinism machinery in §9, and it must
not be wired into the repair loop: there is no iterate-and-retry against a
ground truth, because that is training against the test set.

---

## Open

- Gitea's spec path (`/swagger.v1.json`) is stated from documentation, not from
  a fetch. The loader verifies it at snapshot time and fails loudly; the first
  implementation turn confirms it.
- The known-correct model is hand-authored, so its cost scales with the endpoint
  count. Start with one Gitea resource family (repos and issues) rather than the
  whole surface, and record how much of the spec the baseline covers — a
  baseline over 8 endpoints supports weaker calibration than one over 80, and
  the report should say which it is.
- Query parameters are not scored in this design. They are in the spec and infer
  will emit them; adding a category later is cheaper than getting the first
  version wrong across ten categories at once.
- Response *status* coverage is folded into `response-field-presence` by keying
  on `(endpoint, status, pointer)`. Whether status codes deserve their own
  category is a question for after the first run.
- A second ground truth would be worth more than tighter thresholds on this one.
  Gitea is one API's conventions; a grader tuned to it may not transfer. Wagtail
  is §13's other nominated target.
