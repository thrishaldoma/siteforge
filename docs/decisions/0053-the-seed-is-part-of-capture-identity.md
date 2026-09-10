# 0053 — The seed is part of capture identity, and a rate is not its movement

*Status: §1–§4 are design and prediction, **committed before the seed changed
again and before the crawl ran**. §5 onward is written after.*

[[0051]] added three fields to one task and predicted five metric movements.
Three predictions failed, for a cause the prediction did not contain: **the
seed changed what the crawl could reach**, not only what the fields held. A
task with an assignee has interactive widgets a bare task does not; probes
fired them, a new endpoint matched, and every denominator called fixed moved.

Two things follow, and they are prerequisites for trusting anything measured
after them.

1. **No score is comparable across a seed change**, and nothing recorded which
   seed produced a capture — so nothing could refuse the comparison.
2. **A rate that moved is not a result until its movement is decomposed.**
   `field-type` went 0.9000 → 0.9433 with its miss count byte-identical at 25,
   on a denominator that went 250 → 441. A gate cleared entirely by
   denominator growth.

---

## 1. Seed state is capture identity, and the id is derived

`manifest.seedState` (`packages/schema/src/seed-state.ts`), a two-armed union
rather than an optional field: a target nobody seeded still has to *say* so,
because an absent field reads exactly like a run that forgot to record one.

The id is `sha256(imageDigest ⧺ programHash ⧺ account)`, newline-joined, where
`programHash` is a digest of the seed function's own source. Four properties,
each chosen against a failure this repository has already had:

- **Derived, never declared.** A hand-written `seedVersion: 2` is a version
  nobody is obliged to bump, which is §13's derived-field-carried-as-a-literal
  defect. `PIN.seed.toString()` cannot be forgotten.
- **Recomputed by the schema.** `CaptureManifestSchema` recomputes the id from
  the three inputs the manifest carries, so a hand-edited artifact cannot
  declare an identity its own inputs do not produce — which would re-open
  exactly the comparison the id exists to close.
- **Deliberately over-sensitive.** The comment block lives *inside* `seed()`,
  so editing a comment bumps the id and marks two captures incomparable. That
  is the safe direction and it is the reason for the choice rather than an
  accident of it: an over-sensitive id costs a re-measure, an under-sensitive
  one renders a delta across two different targets and reads as a result. Said
  here rather than left for a reviewer to discover, because a noisy gate nobody
  expected is a gate that gets muted.
- **The password is not an input** (§3.3). A digest is not a credential, but an
  exception argued once is an exception somebody widens later — and the
  password is not a seed variable in any case: changing it changes who signs
  in, not what exists.

### 1.1 What the id identifies, and what it does not

**The seed program, and the image it ran against. Not the database state it
achieved.** 0051 §1 found `PUT /api/v1/tasks/1/assignees` answering 201 and
populating nothing, so a program that runs to completion is not evidence about
the state it produced. A reader who takes this for a state hash will believe
two equal ids mean two equal databases; they mean two equal *inputs*.

Stating the difference is the whole of the mitigation, and that is honest
rather than complacent: hashing the achieved state would mean reading the
database back, which is a second measurement with its own failure modes and no
consumer asking for it.

### 1.2 `unseeded` is never equal to anything, including itself

Two crawls of a target nobody seeded carry no evidence that the target held
still between them. Treating the absence of a seed as a *shared* identity is
the silent comparison this module exists to refuse — and it is exactly what an
`===` on an optional field would have got wrong, because two omitted fields
compare equal.

Three producers record `unseeded` with a reason: the northwind fixture (a site
siteforge does not own), rung 3 (rows authored in `crud-app.mjs` and versioned
with the crawler; no grade report is produced from that capture) and the
one-page spike (an arbitrary URL).

### 1.3 The third instance of an instrument moving its subject

Not a new observation, a third one, and §13 now carries it in that form:

| instrument | what it perturbed | how it showed |
|---|---|---|
| the **held-container control** (0032 §2.1) | holding the target still, to separate our timing from its state — while the crawl mutates the target | two held-container crawls differed on *more* paths (43) than two fresh ones (34) |
| the **contaminating write** (0043 §2) | probe *k* reads probe *k−1*'s writes, so the pass is a function of its own position | fired-control counts of 9/18, 3/14, 8/24 down one run |
| the **seed** (this) | enriching the fixture changed which controls existed, so which endpoints matched, so every denominator | three of five predictions failed, all on denominators called fixed |

The shape is one shape: **a change made in order to measure something changed
what was being measured.** The first two were found by a number moving the
wrong way; this one by a prediction failing. None was visible by reading the
instrument.

---

## 2. Every grade report names its seed, and a comparison across two refuses

`grade-capture.mjs` printed to a console and nothing wrote a report to disk, so
every comparison in this record has been made by a human reading two terminal
scrollbacks — which is precisely where a seed change is invisible.

- **`grade-run.json`** is the persisted artifact, carrying the seed state, the
  metrics version and contract digest, and every metric's numerator and
  denominator.
- **`assessGradeComparability`** takes two of them as parameters and either
  refuses with a reason or returns a decomposed delta. It refuses on a seed-id
  difference, on a metrics-version difference, and on a contract-digest
  difference — three ways two reports can be about different things.
- The refusal is the *primary* path, not a warning printed above a table
  (0019): where "refused" and "compared" both render a delta, the wrong answer
  is already the answer.

**And a control, because a table of refusals proves nothing about
discrimination** (§13): two reports with the *same* seed id and different
numbers must still compare and render a delta. The sabotage asserts on the
refusal and its stated reason rather than on "no delta appeared", because a
broken gate that compares regardless **still prints a delta** — asserting a
delta appeared cannot tell the two states apart.

---

## 3. A rate reports its absolute movement, and a gate cleared by a denominator is a finding

`field-type` 0.9000 (225/250) → 0.9433 (416/441): the rate rose 0.043, cleared
its 0.90 gate, and **the miss count did not move at all** — 25 before, 25
after. The gate was cleared by 191 new fields entering the denominator.

So every rate carries its miss count, and a comparison says which of the three
numbers moved. The finding the grader prints is deliberately *wider* than the
case that motivated it, because the record contains the same non-result with
the sign flipped:

| | before | after | misses | denominator |
|---|---|---|---|---|
| `field-type` (0051 §4) | 0.9000 | 0.9433 | 25 → **25**, flat | 250 → 441, **grew** |
| `field-type` (0045 §1.2) | 0.8969 | 0.9000 | 33 → 25, fell | 320 → 250, **shrank** |
| `request-field-presence.recall` (0045 §1.2) | 0.5155 | 0.9333 | 47 → 1, fell | 97 → **15**, collapsed |

All three crossed a gate; not one is a like-for-like comparison. A rule keyed
only on "misses flat or rising" passes two of the three instances in this
repository's own record, which is the vacuity mode where a gate is written
against the single case its author had in mind.

**So the rule is structural and carries no threshold:** a metric that crossed
its gate while its denominator changed *at all* is reported as
`gate-crossed-on-a-changed-denominator`. There is nothing to tune, and
"material" never has to be defined. Separately, and independent of any gate, a
metric whose rate moved in a direction its own miss count does not support is
reported as `rate-moved-against-its-miss-count`.

### 3.2 The sweep found a case the rule as first written missed

Item 2's last clause: sweep the record for other gates cleared while the miss
count did not fall. Done by running **every** before/after metric pair in the
decision record through `decomposeMovement` — by the gate rather than by hand,
which is how the sweep turned up something no reading of the tables had:

```
! 0025       entity-identity.precision        0.6000 → 1.0000    3/5 → 4/4     miss   2 → 0   CROSSED
      gate-crossed-on-a-changed-denominator
! 0025       entity-field-presence.recall     0.9063 → 0.9355  29/32 → 58/62   miss   3 → 4
      rate-moved-against-its-miss-count
! 0045/0046  request-field-presence.recall    0.5155 → 0.9333  50/97 → 14/15   miss  47 → 1   CROSSED
      gate-crossed-on-a-changed-denominator
! 0045/0046  field-type.accuracy              0.8969 → 0.9000 287/320 → 225/250 miss 33 → 25  CROSSED
      gate-crossed-on-a-changed-denominator
! 0045/0046  response-field-presence.precision 0.4538 → 0.4207 270/595 → 236/561 miss 325 → 325
      rate-moved-against-its-miss-count
! 0051       field-type.accuracy              0.9000 → 0.9433 225/250 → 416/441 miss 25 → 25
      rate-moved-against-its-miss-count
! 0051       seed-coverage                    0.7904 → 0.8147 362/458 → 444/545 miss 96 → 101
      rate-moved-against-its-miss-count

7 of 13 movements in the record carry a finding.
```

**Seven of thirteen.** Three findings were new to this sweep and none had been
noticed when the number was written:

- **0025's `entity-field-presence.recall` rose 0.9063 → 0.9355 while its misses
  went 3 → 4.** 0025 recorded that its *direction* prediction was wrong and did
  not record that the metric got absolutely worse while its rate got better.
- **0025's `entity-identity.precision` crossed its gate on a denominator that
  fell 5 → 4** — which is the merge removing an entity object, so part of the
  crossing is fewer things counted rather than fewer things wrong.
- **0046's `response-field-presence.precision` *fell* 0.4538 → 0.4207 with its
  miss count byte-identical at 325.** It reads as a regression in two documents
  and is the denominator moving, 595 → 561.

That last one is why the rule is symmetric rather than keyed on "rose". An
improvement the misses do not back is a pass nobody earned; a regression they do
not back is a scare nobody caused. Both are a denominator being read as quality,
and only the first was in the case that motivated the rule — §13's warning about
a rule written against the single instance its author had in mind, arriving one
paragraph after the rule was written.

### 3.1 The miss count needs a direction, and half the metrics do not have a gate

`misses` is `denominator − numerator` for a metric where higher is better and
`numerator` for one where lower is better (`auth.over-gate-rate`,
`auth.under-gate-count`). Where a metric is gated, the direction is
`gate.direction` and is therefore already part of the contract digest.

Where it is **not** gated — five metrics are reported-only — there is no
direction to read, and defaulting to "higher is better" would be a guess that
is right until it is not. `REPORTED_ONLY_POLARITY` declares those five, and a
test asserts the declared set **equals** the gateless set exactly (§13's freeze
rule: a complete set, never the absence of a known-bad member), so a new
reported-only metric fails the suite until someone decides which way it reads.

Deliberately not in the contract table: nothing about *what is measured*
changes, so `METRICS_VERSION` and `GRADE_CONTRACT_DIGEST` do not move. A digest
bump would say a threshold or a denominator had changed, and neither has.

---

## 4. `attachments`, and the seed requirement it establishes

0051's own ruling: **the seed must populate every collection-valued field of
every entity the environment poses tasks about.** It left `attachments` out as
"a different kind of seed step" and measured what that cost — **46 of the 82
remaining recall misses**, up from the 29 it started at, because the
newly-matched task-update endpoint declares the field too. *A field left out of
the seed does not stay where it was.*

The requirement now lives in CLAUDE.md §8 rather than only in a decision doc,
because it is a property of the seed the mock store is built from and not a
note about one measurement.

Seeded with a `Blob` in a `FormData` — a multipart body built in memory, so
there is no file on disk and §3.4 has nothing new to reason about. Probed
against a booted container before being committed (0051 §1's practice), which
settled two things prose would have got wrong:

- `PUT /api/v1/tasks/1/attachments` answers **200** with
  `{errors, success:[{id, task_id, created_by{…}, file{…}, created}]}`, and
  `GET /api/v1/tasks/1` then carries a populated `attachments` array;
- **the replacing task update does not clear it.** All four collections are
  populated simultaneously after `POST /tasks/1`, which also settles a
  crawl-time worry: the SPA fires that same update from a probe and will not
  empty the field mid-crawl.

### 4.1 The input differs, asserted before the run

§13: a variant that changed nothing reports the same "nothing moved" a real
null result reports, so the difference is asserted in advance rather than
inferred from the outcome.

```
HEAD (0051 seed)             program b178781b1208   id c58f3a9d7fc1…
working tree (attachments)   program 021b5d2b8e95   id 3e1c347287ed…
```

### 4.2 Predicted, and this run is a new baseline rather than a delta

Stated so the report cannot slide past it — and note what §1 makes of the
comparison itself: **the previous capture carries no seed id at all**, and the
seed has changed again, so by this document's own rule the numbers below are
*not* comparable to 0051 §4. They are the first measurement of a third
instance. The predictions are therefore about the *shape* of the move, and the
per-field miss table is the number to read.

> 1. **`attachments` recall misses fall from 46 to at most 5.** The document
>    declares 17 pointers under `/attachments/[]` on the task operation; the
>    probe's own response carried 16 of them, missing only
>    `/attachments/[]/created_by/email`, which the server omits in every nested
>    user rendering it produces.
> 2. **`observed-body-recall`'s numerator rises and its denominator moves too.**
>    0051 predicted a fixed denominator and was wrong for a reason it did not
>    contain; predicting fixity again would be repeating the error. What is
>    predicted is the *direction*: more fields matched, on a denominator that
>    may grow with a wider matched surface.
> 3. **`field-type`'s response-side miss count does not fall by more than 4.**
>    0051 measured 3 field-type misses under `attachments`, and one more may
>    arrive with the populated array.
> 4. **`entity-field-presence.recall` falls again, by exactly one.**
>    `models.Task.attachments` becomes an array of objects, so the entity
>    extractor correctly stops emitting it as a column while the document still
>    declares it — the same mechanism 0051 §4.3 measured for the other three,
>    and the same conclusion: the lower number is the truer one.
> 5. **The contamination verdict stays `per-probe-required`.** More populated
>    widgets means more probes that write, not fewer.

Prediction 4 is the one worth watching. It predicts a metric getting *worse*
as a consequence of the fixture getting *better*, which is the clearest
statement available that these numbers describe an instance.

---

## 5. Measured

Crawl, infer and grade against the pinned digest with the completed seed
(`3e1c347287ed…`). **This is a new baseline, not a delta**: the previous capture
carries no seed id at all and the seed has changed again, so by §1's own rule
the two do not compare and `compare-grades.mjs` would refuse them.

| metric | this instance | gate |
|---|---|---|
| `endpoint-identity.precision` | 0.9545 · 21/22 · miss 1 | ✓ ≥ 0.95 |
| `path-param-arity.accuracy` | 1.0000 · 21/21 · miss 0 | ✓ |
| `request-field-presence.precision` | **0.5549 · 96/173 · miss 77** | ✗ ≥ 0.95 — §7 |
| `request-field-presence.recall` | 0.9897 · 96/97 · miss 1 | ✓ |
| `response-field-presence.precision` | 1.0000 · 406/406 · miss 0 | ✓ |
| `observed-body-recall` | 0.9144 · 406/444 · **miss 38** | ✓ ≥ 0.9 |
| `seed-coverage` | 0.8147 · 444/545 · miss 101 | reported |
| `field-type.accuracy` | 0.9582 · 481/502 · **miss 21** | ✓ |
| `entity-field-presence.recall` | 0.8871 · 55/62 · miss 7 | ✗ ≥ 0.9 |
| `auth.evidence-coverage` | 1.0000 · 17/17 | ✓ |

### 5.1 Five of five predictions held, and the reason is worth more than the fact

| # | predicted | measured |
|---|---|---|
| 1 | `attachments` misses **≤ 5** | **2** ✓ |
| 2 | recall numerator rises; denominator free to move | 362 → 406 numerator, denominator **444, unmoved** ✓ |
| 3 | response-side `field-type` misses fall by **≤ 4** | 19 → **15**, exactly 4 ✓ |
| 4 | `entity-field-presence.recall` falls by **exactly one** | 56/62 → **55/62** ✓ |
| 5 | contamination stays `per-probe-required` | ✓ |

This record has not had five of five before, and the difference is not
foresight. 0051's failures were all predictions of **fixity** — "the
denominator stays exactly 362", "seed-coverage stays 362/458" — and fixity is
the one thing a seed change cannot be relied on to preserve, which is §1's
whole finding. Every prediction above is about **direction and magnitude of a
miss count**, which is the number a denominator cannot dilute. The predictions
got better because §3 changed what a prediction is allowed to be about.

**One caveat stated against my own rule.** Predictions 1, 3 and 4 are phrased
as movements from 0051's numbers — *across the seed line this document says
refuses comparison*. So they are weaker claims than they read as, and the
unambiguous form is the absolute one: `attachments` owns **2 of 38** recall
misses on this instance. The tension is real and worth naming: **a rule that
refuses every cross-seed comparison also refuses the measurement of whether a
seed change helped.** What survives it is the per-field absolute count against
a fixed truth side, and that is what §5.2 reports.

### 5.2 Every remaining miss under a seeded collection is `email`

The 38 response-recall misses, by what owns them:

| owner | misses | what it is |
|---|---|---|
| `subscription` | 20 | 15 are the document declaring `subscription` on list renderings — **its own prose says** "Will only returned when retreiving one project"; 5 are a genuine seed gap, nobody is subscribed to the project |
| `email` on an embedded user | 13 | the server omits `email` in **every** nested `user.User` it renders — `created_by`, `assignees[]`, `owner`, `labels[].created_by`, `attachments[].created_by` — while the document declares it |
| everything else | 5 | one `views[].bucket_configuration[]`, one OIDC provider list, three singletons |

So `attachments` is 2 of 38 and both are `email`; `assignees` is 4 and all four
are `email`; `labels` is 2 and both are `email`; `reminders` is 0. **After the
§8 seed requirement is met, no remaining miss under a seeded collection is an
inference defect** — 33 of 38 are two systematic server/document divergences
and neither is anything infer could have done differently. That is what the
seed work was for: it did not improve inference, it **stopped the fixture from
being charged to it**.

### 5.3 What seeding a field costs, measured

Not free, and the direction is worth recording. Seeding `attachments` resolved
44 response-recall misses and **added 6 request-side false positives**: the SPA
echoes the attachment's `created_by` user object back with the task, carrying
`exp`, `type`, `max_right` and `settings` — §7's mechanism, arriving through a
newly populated field. A richer fixture makes the truth side more reachable and
the client's over-send wider at the same time.

---

## 6. Per-probe contamination, measured, and the granularity chosen

0043 §4's open item. 0051 §4.5 flipped the verdict to `per-probe-required` and
this run says *which probes contaminate which*, which is what the ruling asked
for. On `tasks-id--auth-desktop--i0`, 32 probes in loop order:

```
  0 … 16   pre-state d89e10e9 / d7224f3a     — 17 probes, 24 calls between them, all reads
 17        button "Today Thu"                — POST /api/v1/tasks/1        ← the write
 18 … 31   pre-state 9eb74880 / 7d8aba58     — 14 probes, every one of them
```

**One probe contaminated fourteen, and never recovered.** Probe 17 is the
due-date quick-set widget — a control that exists on this page *because the
task is now rich*. It set a due date; the route's structure changed at that
instant and stayed changed for every probe after it, each of which loads the
route fresh. No other route drifted.

Three properties make this a sound basis for the choice despite N=1:

- **The drift is within a route.** A reset at the route boundary would have
  fired *after* probe 31, which is the entire contaminated span. Per-route is
  refuted, not merely unsupported.
- **The negative control held.** Probes 0–16 include seven that issued reads
  and the structure did not move once across them — §6's "a purely-read prefix
  must not move the next probe's pre-state", satisfied over 16 consecutive
  pairs. So the fingerprint is not drifting on its own.
- **Refutation needs one instance; the opposite verdict would need a
  distribution.** This is the asymmetry that licenses N=1 here and it is stated
  rather than assumed (0038, 0040 §3): a single within-route contamination
  point disproves "a route boundary is enough", while concluding "per-route
  suffices" from a run that happened to contain no within-route write would be
  a claim about a distribution drawn from one draw. **The verdict is only sound
  in this direction**, and a future run with no drift must not be read as
  overturning it.

### 6.1 The ruling: per-probe, and the undo must match the do

**Granularity: per-probe.** The measurement leaves no other reading.

§13's undo rule has to be answered before this is built, and the measurement
answers it: the *do* is "whatever this probe wrote", so the undo must be
exactly that and no more.

| mechanism | what it restores | verdict |
|---|---|---|
| recreate the container | the whole instance — id sequences, clocks, seed state, everything the crawl legitimately built up | **rejected.** Restores far more than the probe changed, which is a different starting condition rather than a safer undo; and ~10s × 147 probes is the run |
| snapshot the database **at seed time**, restore per probe | every write since seeding, including earlier probes' | rejected for the same reason, one notch smaller |
| snapshot the database **immediately before each probe**, restore after | exactly what changed during that probe | **chosen.** The scope of the undo equals the scope of the do by construction, because the baseline *is* the pre-state |
| issue compensating API calls per recorded write | in principle exactly the write | rejected: needs the pre-state of every mutated resource and an inverse the API may not offer. Unbounded, and silently partial when it fails |

**Not built this turn, and that is named rather than implied.** The remaining
work is the mechanism — Vikunja's sqlite file lives on a tmpfs inside the
container, so a safe copy needs the sqlite backup API or `VACUUM INTO` rather
than a `cp` of a file the process holds open. 0043 §4 stays open with its
granularity now decided and its acceptable-mechanism set narrowed to one.

### 6.2 And the instrument is close to its own silent boundary

Stated because it bears on how much this measurement can carry: **1 of 147
probes** issued a write that could contaminate, and 23 more were waved through
as `POST /api/v1/user/token` (JWT renewal). With zero contaminating writes the
instrument reports `instrument-silent` and says nothing at all, so this run sat
one control away from producing no verdict. The finding is sound — the drift is
there, downstream of a real write, with the control holding — but the *rate* at
which a run yields such a probe is a draw, and a future run producing no drift
is uninformative rather than reassuring (§6, third property).

---

## 7. `request-field-presence.precision` 0.5549 — the cause

Diagnosed, not fixed, per the ruling. The question was: document omission,
capture artifact, or a real inference defect?

**None of the three.** The measurement is one definition and three populations.
The document declares `models.Task` for *both* sides of
`POST /api/v1/tasks/{id}` — the body parameter and the 200 response — so the
three are directly comparable:

| population | pointers |
|---|---|
| the **document** declares | 82 |
| the **server's own 200 response** to that operation carries | **78** |
| the **client's request** carries | **154** |

- **Not a document omission.** 0049's shape is the server emitting something
  the document is silent about. Here the server's own rendering is *narrower*
  than the document, not wider, and there are **zero false negatives** — the
  client sends everything the document declares. The document is not omitting;
  it sits between the two.
- **Not a capture artifact.** The bytes were on the wire. Infer transcribed an
  observed request body, which is its job.
- **Not an inference defect either**, on the consumer's own terms: §8 builds the
  mock backend's accepted body from this schema, Vikunja accepted all 154 fields
  and answered 200, so the claim is true of the server and merely *wider* than
  the document — the widening direction §7.5 and §13 call free.

### 7.1 What it is: the metric, and 0048's test fires

The model's request schema is a record of **what a client sent**. The document
declares **what the API accepts**. 0015's own modality rule decides this: *a
document grounds a claim about declared shape; only observation grounds a claim
about runtime behaviour* — and this is a behavioural record being scored against
a declaration.

0048's amendment gives the test and the remedy precedent: *do the two halves
have different achievable ceilings, for reasons that are not inference quality?*

- `request-field-presence.recall` reads **0.9897 (96/97)** — a measure of
  whether the crawl exercised the declared request surface. Ceiling: crawl
  coverage.
- `request-field-presence.precision` reads **0.5549 (96/173)** — ceiling set by
  **how much this SPA over-sends**, a property of the target's client that no
  inference could change.

That is the same shape `auth.evidence-coverage` and `response-field-presence`
were split for. **Not proposed here**, per the standing rule.

### 7.2 The mechanism, measured rather than told

68 of the 72 false positives on the task update sit *inside* a subtree the
document declares — extra properties on an embedded `user.User`, `models.Label`
or attachment:

| subtree | FPs | recurring leaves |
|---|---|---|
| `/subscription` | 22 | `user/*` — an entire user object the document does not declare there |
| `/created_by` | 18 | `exp` `type` `max_right` `settings/*` |
| `/assignees` | 14 | the same set |
| `/labels` | 7 | `exp` `max_right` `project_id` `text_color` |
| `/attachments` | 6 | `exp` `max_right` `settings` `type` |
| four top-level | 4 | `max_right` `parent_task_id` `reminder_dates` `repeat_from_current_date` |

What object is the SPA echoing? Measured three ways rather than inferred from
the names:

- **`exp` and `type` are JWT claims.** Decoded the token a fresh login returns
  from a container at the pinned digest: the payload carries
  `exp · type · id · username · name · email · isLocalUser · emailRemindersEnabled · long`.
- **`settings/*` comes from `GET /api/v1/user`.** 15 of the 24 pointers under
  `/created_by` in the request are pointer-for-pointer that endpoint's response.
- **`max_right`, `exp`, `type`, `text_color`, `parent_task_id`,
  `reminder_dates` and `repeat_from_current_date` appear in *no observed
  response body anywhere in the capture.*

So `created_by` and `assignees[]` in the request are the SPA's **own in-memory
user**, assembled from the JWT payload and `GET /user` and pushed into the task
object — never anything the server returned as that task's `created_by`. It is
the client's state going back over the wire, recorded faithfully.

---

## 8. What this turn does not claim

- **It does not claim the numbers improved.** §5 is a new baseline against a
  third instance. The one thing measured about *inference* is negative and
  useful: after the seed requirement is met, 33 of 38 remaining recall misses
  are server/document divergences infer cannot touch.
- **It does not fix `request-field-presence`.** §7 is a diagnosis. The split
  0048's test implies is a contract change and belongs to whoever makes it
  deliberately.
- **It does not close M1.** §6 chooses a granularity and rejects three
  mechanisms; the reset is not built, and the probe pass is still
  non-deterministic.
- **It does not make the seed complete in general.** `subscription` is the next
  instance and owns 5 of the 38 as a genuine seed gap — the requirement in §8
  has a queue behind it, and this turn cleared one entry.

### 8.1 One thing the harness caught about itself

The first version of the seed-id sabotage patched
`packages/schema/src/seed-state.ts` with a gate of `test --project verify`.
Verify's tests import `@siteforge/schema` as a **built** package, so the patch
was invisible to the gate and the sabotage passed — a defect reintroduced and
the gate staying green, which is the failure the harness exists to report and
did. The rule it hands forward: **a sabotage's patch must be in code the gate
actually compiles.** Within a package, vitest reads source; across one, it reads
`dist`, and a cross-package patch tests nothing unless the gate rebuilds. The
patch now sits on the deciding expression in `compare.ts`, where the gate can
see it, and the control confirms the gate discriminates the meaning rather than
the edit.
