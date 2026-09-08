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

**The scored-field list is fixed at step 2 and does not move for step 3.** If
defining SiteModel makes a scored field awkward to represent, *SiteModel*
changes. The list's whole value as a second derivation force depends on being
independent of the model it constrains; a list that bends around SiteModel is a
list derived from SiteModel, and derives nothing.

That is a claim about a sequence, and a sequence is only real if something
outside anyone's memory holds it:

- the contract module is committed, with its digest, **before
  `site-model.ts` stops being a placeholder** — so the freeze predates the thing
  it constrains rather than being asserted about it afterwards;
- the contract module **must not import the model layer**, and a test asserts
  its import graph is free of `site-model.js`. An import is how "independent"
  quietly stops being true;
- it lives in `packages/schema`, not in `packages/verify` (§9), because §14 puts
  the inter-stage contract there and because the infer stage report has to be
  able to recompute against it (§7.1).

---

## 1. Ground truth

**A self-hosted Gitea, graded against its own published OpenAPI spec.**

Gitea serves a machine-readable description of its API: the Swagger UI at
`/api/swagger`, and the spec document itself as JSON at `/swagger.v1.json`. It
gives us endpoints, methods, path and query parameters, response status codes,
and field types, all written by people who were not us. Declared auth it does
*not* give us, which is §4 and was found by fetching rather than by reading.

**Measured, against the pinned image rather than against anyone's deployment**
(the 200 from `gitea.com` that first suggested this path is evidence about
somebody's server, and substituting it for the container's own answer is the
same substitution that disqualifies the rung-3 app):

| | |
|---|---|
| image | `gitea/gitea@sha256:87a67ee0…adc43bef` (tag 1.27.3 at pull time) |
| spec | `GET /swagger.v1.json` → 200, 870 698 bytes, parses as Swagger 2.0 |
| surface | 308 paths, 482 operations, 222 definitions, `basePath: /api/v1` |
| path-param arity | 58 paths with none, then 59 / 78 / 90 / 23 with one to four |

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

### Snapshot staleness

A committed snapshot is a cache, and an unchecked cache drifts into testing a
spec no server serves. So the milestone gate **begins** by booting a container
at the pinned digest, re-fetching the spec, and diffing it against the
committed snapshot. **Disagreement fails the gate.** The fix is a commit that
updates the snapshot and shows the diff in review — never a flag, never a
tolerance.

Two details, because a staleness gate that fails for the wrong reason is worse
than not having one: it gets muted, and then it is a gate nobody is checking.

- **The container's launch is pinned in the same committed script that fetches
  it** — image digest, published port, and the full environment. Half of what a
  Swagger document says about itself is a function of how the server was
  started, so a launch that varies produces a diff that means "the port moved"
  and reads as "the spec changed".
- **The volatile-field list is derived from measurement, not from judgement.**
  A general "ignore fields that vary between runs" clause is the vacuous
  spelling of this gate — it is exactly wide enough to hide the change the gate
  exists to catch, and it cannot be told from the honest version by reading it.

  **Measured: the list is empty.** Two containers at the same digest, launched
  on different ports with different `ROOT_URL`s, served **byte-identical**
  documents — 15 768 leaves, zero differing, same sha256. The document declares
  no `host`, its `basePath` is the constant `/api/v1`, and `info.version` is
  fixed by the digest. So the staleness gate is a **sha256 comparison of the
  whole document**, with no normalisation and no exemptions, and a test asserts
  the exemption list is empty — adding the first entry means deleting an
  assertion, in a diff someone reads.

### Ground truth has to match the claim's modality

The auth finding is an instance of a rule, and the rule is the part that will
recur.

**A document grounds a claim about declared shape. Only observation grounds a
claim about runtime behaviour.** `requiresAuth` is a claim about what the server
does to an uncredentialed request; the document declares an intent, the server
has a behaviour, and here they differ on 13 of 50 endpoints. Scoring the
behavioural claim against the declaration charges infer for the gap between two
things that were never the same thing.

So, **before any field is scored, name the modality its truth comes from.** It
is one line per category and it is not obvious in advance — the auth case looked
settled right up until the fetch.

| modality | truth source | categories |
|---|---|---|
| declared shape | the committed spec snapshot | `endpoint-identity`, `path-param-arity`, `path-param-naming`, `request-field-presence`, `response-field-presence`, `field-type`, `narrowing`, `synthesized-endpoint` |
| observed behaviour | the recorded sweep against the pinned digest | `auth` |
| not yet grounded | — | `identifier` (§9's `notDerived`) |

The test each row has to pass is **independence**, not proximity: a truth source
that is downstream of infer's own input cannot score inference. That is what
picks the column, and it is why the declaration wins for response shape below
even though the behaviour is what ships.

**Response schemas are the next one to bite, and the rule decides them rather
than exempting them.** §5 makes the response schema the mock backend's data
model, so the thing that matters is what the server returns — which sounds like
the behavioural column, and therefore like observation.

It is not, and the reason is one the auth case did not have:

**Observed responses are infer's own input.** §7 derives the response schema by
generalising over the bodies capture recorded. Grading that schema against those
same bodies asks whether infer copied its input correctly — it cannot be wrong
about a field it read, and it cannot be scored on the generalisation, which is
the entire judgement §7 asks for. A truth side that is the system's own input is
not an oracle; it is a mirror, and it will read near-perfect no matter how badly
infer generalises.

The document is the only **independent** source for this claim. It is a
declaration written by people who were not us, about the same behaviour, and it
is complete where a crawl is a sample of three responses.

So this is the modality rule applied, not suspended: *only an independent source
can ground a score*, and for response shape the independent source is the
declaration. Auth had an independent behavioural source available — the server
answers a request nobody in this pipeline generalised from — and it was used.
Here there is none, and pretending capture's own bodies are one would be the
generated-fixture mistake in a new place.

An observed response sweep against the seeded container would be a *second*
truth for this category. Useful — the disagreement between a document and its
server is worth measuring — but it is not a substitute for the declaration, and
it is not more authoritative for being closer to the metal. It waits on the same
seeding script as the parameterised auth sweep.

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
- **Every entry names the scored category it excludes a field from** (§3's
  table), and the budget is per-category as well as global: **no category may
  consume more than half the 5% cap** without the list being re-examined before
  another entry lands there.

  The global cap cannot see the shape that matters. Five percent spent evenly
  across ten categories reads identically to five percent spent entirely on
  `narrowing`, and only one of those is a stale spec. A document drifting from
  its server drifts in ways uncorrelated with which claims infer finds hard; a
  divergence list that piles up exactly where infer is weakest is not describing
  the spec, it is describing infer, one entry at a time. Each entry is
  individually justified in that scenario, which is precisely why the check has
  to be on the distribution rather than on the entries.

  Stated now, before the first run, for the same reason the rest of this
  section is: exclusions produced in response to a bad score cannot be
  distinguished from tuning afterwards, however good each justification reads.
- The per-category rule is **proven to fire against a fixture list**. The real
  list is empty, and an assertion over an empty list is the vacuous check this
  repo has now found five times — it would pass for years and then be wrong on
  the first day it mattered.

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
| `auth` | endpoint | — four metrics over three unlike denominators, §4 | — |

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

### The spec cannot supply the truth side, and that is a measurement

Gitea's document declares **one global `security` block** — seven schemes, any
of which authenticates — and **not one of its 482 operations overrides it**. No
operation carries `security: []`. `GET /api/v1/version` and `GET /api/v1/user`
are structurally identical in the document; against the pinned container the
first answers **200** to an anonymous caller and the second **401**. Of the 50
zero-parameter GETs, **13 answer 200 anonymously** while the document says every
one of them needs a token.

Grading `requiresAuth` against *declared* auth therefore fails three ways, and
each is a different lesson:

1. The over-gate denominator — endpoints where truth is `not-required` — is
   **zero**. §6 says a zero denominator is `vacuous: true` and the gate fails.
   Permanently, for a reason that has nothing to do with infer.
2. Forced through anyway, it scores infer **wrong for being right**: an endpoint
   correctly resolved `not-required` on an observed anonymous 200 counts as an
   under-gate — the one failure this design says must be zero.
3. The known-divergence list would absorb the difference at 26% of a single
   category, five times the entire 5% cap. Amendment 1's per-category rule fires
   on its first contact with real data, which is the argument for having written
   it before the run rather than after.

**So the auth truth side is measured, not declared.**
`packages/verify/fixtures/gitea/anon-probe.json` records the status a fresh
container at the pinned digest returns to an uncredentialed request — today for
the 50 zero-parameter GETs, because a parameterised path needs a
deterministically seeded instance and that script is milestone-gate work. The
other 432 operations are `unobserved`, which is a fourth value and not a
missing one; `auth.truth-coverage` reports the shortfall so the auth numbers
cannot be read as whole-surface claims. Committed beside the spec snapshot, pinned by the
same digest, covered by the same staleness gate, and each entry carries the
observed status — the evidence travels with the claim, as `NarrowingRecord`
does.

Three properties keep that honest:

- **It is a different code path from capture's.** §6's anonymous re-issue runs
  inside the crawler; the sweep is a flat script that reads the spec's path list
  and issues requests. §13's rule about an invariant's observed side applies to a
  grader's truth side identically — share the extractor's code and a bug moves
  both sides, so the score goes quiet instead of red.
- **The classification fails closed by category** (§13). 200 → `not-required`.
  401/403 → `required`. **404 → `required`, never "absent"**: Gitea answers 404
  rather than 403 for resources it will not confirm exist to an anonymous
  caller, so reading 404 as "this endpoint is not real" would delete a gated
  endpoint from the truth set and convert a correct inference into a
  hallucination — a wrong answer in a second category, caused by a default in
  this one. Anything else is `indeterminate`: excluded from the auth category
  and **counted in the report**, never silently defaulted.
- **This grades something narrower than it looks, and the report says which.**
  Truth is the pinned server's behaviour and infer's evidence comes from capture
  observing that same server, so the auth category measures whether the chain
  from observation to verdict is faithful — not whether infer discovered
  anything about auth from nothing. That chain is exactly what broke in 0014, so
  it is worth measuring; the claim in the report just has to be the smaller one.

**A degenerate infer that marks every endpoint `required` never under-gates.**
It would score perfectly on the metric that matters most. So auth is not scored
as accuracy, precision or recall. It is four numbers over **three unlike
denominators**, and they are never combined:

| metric | numerator | denominator | why |
|---|---|---|---|
| **under-gate count** | endpoints infer leaves open where the truth is required | endpoints the sweep **observed** as required | the invisible failure |
| **over-gate rate** | endpoints infer gates where the truth is public | endpoints the sweep **observed** as not-required | the visible, cheap failure |
| **truth coverage** | graded endpoints the sweep observed at all | **all graded endpoints** | reported, not gated — see below |
| **evidence coverage** | endpoints resolved from recorded evidence rather than the fail-closed default | **all graded endpoints** | what stops the degenerate model scoring well |

Naming the denominator in the table is deliberate. Written as bare rates, the
next reader averages them.

**Truth coverage is the fourth number and it is there because of the third
column.** The first two are over what the sweep observed, and on the pinned
Gitea that is 50 of 482 operations — an under-gate count of zero over 37
endpoints is not the same claim as one over 482, and nothing else in the report
can tell them apart. Evidence coverage is different in kind: whether a verdict
rests on a recorded observation is a property of the *verdict*, so it needs no
truth side and genuinely is over the whole graded universe. Three denominators
that look alike and are not, which is the reason this section names every one of
them.

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
| `auth` | truth coverage | reported only | — |
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
- **The freeze starts before `SiteModel`, not before infer.** Changing anything
  in that table after `site-model.ts` stops being a placeholder requires a
  decision note stating what was measured and why. Dating the freeze to infer's
  first commit would leave the whole of M2's model design free to reshape the
  metric, which is the larger half of the risk: a scored field quietly dropped
  because it was inconvenient to represent never becomes a bad score, it becomes
  no score.
- The **known-correct model** — a hand-authored SiteModel transcribed from the
  Gitea spec — is the mutation baseline. It must parse against SiteModel's
  schema, including narrowing evidence, so it is a *legal* model and not a
  transcription (decision 0011: a fixture in a shape its producing stage cannot
  produce is a lie).
- **Its near-1.0 score is not evidence the grader works.** It was derived from
  the ground truth; scoring it well is circular. Only the mutation deltas in §8
  are evidence.

### 7.1 What is being measured is reported before how it did

Infer's **first** stage report — the one written before any grade has ever run —
carries the contract: `METRICS_VERSION`, the contract digest, and the scored
category ids in the contract's own order. No scores; there are none yet.

The reason is the same as the reason the contract is written first. A category
list that first becomes visible attached to a score is read as a score, and a
category quietly absent from the table is invisible in exactly the case that
matters — nobody notices the metric that was never reported. Separating the two
means the list can be reviewed as a list.

It is a **reference, not a copy.** Turn 2's ruling on `manifest.counts.gaps`
applies verbatim: a derived value duplicated across two artifacts drifts, and
the fix is that one side computes it and the other references it. So the
category ids in the stage report are recomputed against the contract module by
the schema — a report naming a category the contract does not have, or missing
one it does, does not parse. That is why the contract lives in
`packages/schema`: the recompute needs both in one place, and a pointer alone
(version and digest, no names) would not satisfy the ask, which is to *see* what
is measured.

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

That first point is no longer local to this document. §13 now carries it as a
standing rule for **every** mutation harness in the repo, and the existing ones
were audited against it — see decision 0016. A harness of all-drops is the
mirror image of the vacuous invariant: both pass without discriminating, and
neither is visible by reading it.

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

The **grader** is `packages/verify/src/grade/`. §4's package table is unchanged
— verify owns gates, and this is a gate.

The **contract** — the category table, denominators, thresholds and
`METRICS_VERSION` — is `packages/schema/src/grade-contract.ts`. Two reasons, both
load-bearing rather than tidiness: §7.1's stage report has to be validated
against it by the schema, and §0's freeze wants it as far as possible from the
code that consumes it. It imports nothing from `site-model.js`, and a test says
so.

The **ground-truth loader** is `packages/verify/src/grade/truth/`, reading the
snapshot committed under `packages/verify/fixtures/gitea/`.

It reads `capture/`, a SiteModel, and a committed truth snapshot. It touches
**none** of the visual, behavioral or determinism machinery in §9, and it must
not be wired into the repair loop: there is no iterate-and-retry against a
ground truth, because that is training against the test set.

---

## Open

- ~~Gitea's spec path is stated from documentation, not from a fetch.~~
  Confirmed by fetch against the pinned digest; see §1. What it turned up was
  larger than the path: the document has no per-endpoint auth at all, which
  rewrote §4's truth side.
- The anonymous sweep covers the 50 zero-parameter GETs today. Parameterised
  endpoints need a **deterministically seeded** container — a fixed user, repo
  and issue created through the API before the sweep — and that seeding script
  is part of the milestone gate, not of `verify:clean`. Until it exists the auth
  category's denominators are the zero-parameter slice, and the report says so
  rather than implying whole-surface coverage.
- Two documented paths (`/signing-key.gpg`, `/signing-key.pub`) answer 404 on an
  unconfigured instance. Under the rule above they classify `required`, which is
  safe for the auth category but leaves an open question for
  `endpoint-identity`: whether a documented path the server does not serve is a
  spec divergence or an instance-configuration difference. It needs the seeded
  container to tell apart, so it waits for the same script.
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
