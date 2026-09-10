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
metric whose rate rose while its miss count did not fall is reported as
`rate-rose-while-misses-did-not-fall` — that is 0051's case, and it is a
finding whether or not a gate was in the neighbourhood.

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
