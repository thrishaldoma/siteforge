# 0051 — The seeded instance is the binding constraint

*Status: §1–§3 are the measurement design and the prediction, **committed
before the seed changed and before the crawl ran**. §4 onward is written
after.*

Three numbers badged as inference have turned out to be substantially about
capture: `response-field-presence`'s recall ([[0046]], [[0048]]), the
skipped-control spread (0040 §2.1), and now `field-type`, whose 21 of 25
disagreements are the model saying `null` against a document saying `array`
or `object` ([[0048]] §5.2).

The ruling: before more infer work, **measure what a richer seed would
move.**

This is not seed-tuning to move a score. The seed is a real deliverable with
its own requirements — §8 builds the mock store from captured responses and
§10's task validators read seeded state — and inference numbers have been
read off a target in a degenerate state: a Vikunja whose every task has no
assignee, no label, no reminder and no attachment.

---

## 1. What is being changed, and what is not

Three fields, added to one task in `PINS.vikunja.seed`:

```
POST /api/v1/tasks/1   { assignees: [{id, username}], reminders: [{reminder, …}] }
PUT  /api/v1/tasks/1/labels   { label_id: 1 }
```

**Verified against a booted container before committing**, because a seed
call that fails is a hard failure by design and finding that out nine minutes
into a crawl is expensive. Two things the probe found that prose would have
got wrong:

- the **task update replaces**, so assignees and reminders must go in one
  `POST`; setting them in two calls silently clears the first;
- `PUT /api/v1/tasks/1/assignees` returns **201 and does not populate the
  field** — the task-update form is what works. (`GET
  /api/v1/tasks/1/assignees` answers 500 on this instance, which is the
  target's business and is noted, not chased.)

**`attachments` is deliberately left out.** It needs multipart and a real
file on disk, which is a different kind of seed step and adds a surface §3.4
would have to reason about. The ruling said cheapest version first. What that
costs is measured rather than discovered: **29 of the 126 recall misses sit
under `attachments`** and cannot resolve.

## 2. The gap, split by the field that owns it

Measured on the current capture, so the prediction is bounded by data rather
than by hope:

| owning field | recall misses | field-type misses |
|---|---|---|
| `labels` | 30 | 3 |
| **`attachments`** | **29** | 3 |
| `assignees` | 21 | 3 |
| `reminders` | 12 | 3 |
| everything else | 34 | 13 |
| **total** | **126** | **25** |

So seeding the three reachable fields addresses **63 of 126** recall misses
and **9 of 25** field-type ones. Nothing else is expected to move.

All four are `required: false` in the document, which matters: `typeAgrees`
accepts a nullable claim only where the spec marks the field optional, so a
schema unioning `null` with an observed array — which is what infer will emit
once one task has a value and three do not — **will** agree.

## 3. Prediction, and one metric is comparable while the other is not

The trap this turn has already been bitten by twice. Stated so the report
cannot slide past it:

- **`observed-body-recall` is comparable across the change.** Its denominator
  is truth-side — response fields the *document* declares — and the seed does
  not move it. `236/362 → N/362` is a clean read.
- **`field-type.accuracy` is not comparable.** Newly-matched fields under the
  populated arrays enter its denominator, and most will be types infer gets
  right. **The rate can rise while nothing is fixed.** So the prediction is
  on the *miss count*, and the report must carry the miss count beside the
  rate.

> **Predicted:**
> 1. `observed-body-recall` rises from **0.6519 (236/362)** into
>    **[0.75, 0.83]** — 272 to 299 of 362 — with the denominator **exactly
>    362**, unchanged. A denominator that moves means the seed changed which
>    statuses were observed, which it should not.
> 2. `field-type` **misses fall from 25 to 16 ± 3**; its denominator **rises
>    above 250**; the rate goes **above 0.92**, off the 0.9000 boundary. The
>    rate alone is not the result.
> 3. `response-field-presence.precision` **stays ≥ 0.95**. New fields come
>    from observed bodies at declared statuses, so they should mostly match.
> 4. `seed-coverage` stays **362/458**. The seed adds values, not statuses.
> 5. `entity-field-presence.recall` rises from **0.9355 (58/62)**: two of its
>    four misses are `subscription`, which is untouched, so at most two move.

If (1) lands and (2)'s miss count falls, seed richness is worth a design
decision rather than an ad-hoc fix — and per the ruling that decision belongs
to §10, since task validators need seeded state anyway.

If the recall move is small, the finding is that the 100 subtree pointers are
deeper than one populated task reaches, and the subtree-denominator question
comes back with better information than it has now.

### 3.1 Everything measured before this change is of a different instance

Stated rather than left implicit. The pinned digest is unchanged, but the
**seed is part of the fixture**, so every capture-derived number in 0046
through 0050 describes an instance that no longer exists. They are not
invalidated — they were correct about what they measured — but a later
reader comparing across this line is comparing two targets.

---

## 4. Measured — and the seed changed more than the field values

> **The rate deltas in this table are uncontrolled ([[0053]] §1).** The
> `before` and `after` columns are two *different instances* — that is §4's own
> finding, arrived at from inside the table — so no rate delta here is a
> like-for-like comparison and none should be quoted as one. Nothing recorded
> which seed produced which capture, so nothing could refuse the comparison at
> the time; `manifest.seedState` now does, and a comparison across two seed ids
> now refuses rather than rendering a delta.
>
> **What stands and what does not**, marked rather than reconstructed (0052):
>
> - the **per-field miss counts** in §4.1 — `labels` 30 → 2, `assignees` 21 → 4,
>   `reminders` 12 → 0 — stand as statements about their own instances, and the
>   ruling in §5 rests on them;
> - the **rate deltas in this table** do not. Every denominator moved, which is
>   what §4 says;
> - §4.2's finding stands and is *strengthened*: `field-type`'s miss count was
>   byte-identical at 25 across the change, so the rate movement was denominator
>   growth whatever else was true. 0053 §3 makes that a finding the grader
>   prints, and a sweep found **six more** such movements in this record.
>
> Two of this table's rows carry a 0053 finding when run through the gate:
> `field-type.accuracy` and `seed-coverage`, both `rate-moved-against-its-miss-count`
> — `seed-coverage`'s misses went **96 → 101** while its rate rose, which was
> not noticed here.

| metric | before | after | predicted |
|---|---|---|---|
| `observed-body-recall` | 0.6519 (236/362) | **0.8153 (362/444)** | value ✓, **denominator ✗** |
| `field-type.accuracy` | 0.9000 (225/250) | **0.9433 (416/441)** | rate ✓, denominator ✓, **miss count ✗** |
| `response-field-presence.precision` | 1.0000 (236/236) | **1.0000 (362/362)** | ✓ |
| `seed-coverage` | 0.7904 (362/458) | **0.8147 (444/545)** | **✗** |
| `entity-field-presence.recall` | 0.9355 (58/62) | **0.9032 (56/62)** | **✗ — it fell** |
| `request-field-presence.precision` | 0.7368 (14/19) | **0.5267 (79/150)** | not predicted at all |

**Two of five predictions held. Three failed, and they failed for one root
cause I did not anticipate: the seed changed *what the crawl could reach*,
not only what the fields contained.**

A task with an assignee, a label and a reminder has interactive widgets a
bare task does not. Probes fired them, the browser issued
`POST /api/v1/tasks/{id}`, and a **new endpoint matched** — 21 matched
against 20, 22 observed against 21. Every denominator I predicted as fixed
moved because of that, and my stated falsifier for the recall denominator
("a denominator that moves means the seed changed which statuses were
observed") named the wrong mechanism: it was which *endpoints* matched.

### 4.1 What the seed actually bought, per field

The clean measurement, because it is per-field rather than per-metric:

| owning field | recall misses before | after |
|---|---|---|
| `labels` | 30 | **2** |
| `assignees` | 21 | **4** |
| `reminders` | 12 | **0** |
| **the three seeded** | **63** | **6** |
| `attachments` (left out) | 29 | 46 |
| everything else | 34 | 30 |

**57 of 63 misses under the three seeded fields resolved.** That is the
answer to the ruling's question, and it is unambiguous. `attachments` grew
from 29 to 46 because the new matched endpoint declares it too — the field
left out of the seed got *worse*, which is the cost of leaving it out,
measured.

### 4.2 The field-type miss count did not fall, and that is two effects cancelling

Predicted 25 → 16 ± 3. Measured **25 → 25**, byte-identical, which §13 says
to disbelieve first. It is not non-movement; it is two movements:

- **response-side misses 25 → 19.** The nine under `assignees`, `labels` and
  `reminders` resolved exactly as predicted. `attachments` went 3 → 4 and
  everything else 13 → 15, both from the wider matched surface.
- **request-side misses 0 → 6.** These did not exist before, because the
  request surface did not exist before.

So the rate rising from 0.9000 to 0.9433 is **entirely denominator growth**,
250 → 441. The prediction warned that the rate alone would not be the
result, and it was right to; it was wrong about the miss count because it
only counted the response side. **`field-type` is off its boundary and
nothing about it improved.**

### 4.3 `entity-field-presence.recall` fell, and the fall is correct

`models.Task` now misses `assignees`, `labels` and `reminders` — the exact
three that were seeded. It missed only `subscription` before.

The mechanism: when those fields were `null`, infer recorded them as
ordinary scalar entity fields. Populated, they are arrays of objects, which
are not columns, so the entity extractor correctly stops emitting them —
while the document still declares them as properties, so they count as
misses.

**The metric was benefiting from the degenerate instance.** A null field
looked like a column; a real one is a relation. 0.9355 was the better score
and 0.9032 is the truer one, which is the sharpest possible illustration of
the ruling's premise.

### 4.4 A request surface nobody had ever seen

`request-field-presence.precision` fell from 0.7368 to **0.5267**, on a
denominator that went 19 → 150. Not a regression: there was almost no
request surface to be wrong about before.

The 71 false positives are almost all one operation. The SPA's task update
**sends the whole task object back** — `created_by`, `subscription`, nested
`settings`, `max_right` — where the document declares 82 request fields and
the model emits 131. Infer is recording what was on the wire.

Whether that is the client over-sending or the document under-declaring is
**not diagnosed here**, per the standing rule. It is the same shape as
[[0049]]'s document omission pointed at the request side, and it is now the
category's largest open question where before it had 19 fields and nothing
to say.

### 4.5 Two findings outside the metrics

- **The contamination verdict flipped.** `instrument-silent` before —
  0 of 148 probes caused a write that could contaminate — and
  **`per-probe-required`** now, with one structural drift point downstream of
  a write. 0043 §4's granularity question was answered "moot on this target"
  against an instance where nothing could be mutated because nothing was
  there. It is not moot any more.
- **A crawl-killing defect, found only because of the seed.** The richer task
  page took a probe's click into a navigation while `page.evaluate` was
  mid-snapshot. Playwright says *"Execution context was destroyed, most
  likely because of a navigation"* — the same event as `navigation-aborted`
  and none of that row's spellings — so the classifier called an operational
  error a defect and the run died at nine minutes. Fixed, narrowly, with a
  control.

## 5. The answer to the ruling

**Seed richness is worth a design decision.** 57 of 63 targeted misses
resolved, one metric was shown to have been scoring a degenerate instance
favourably, an entire request surface appeared, a contamination question
un-mooted itself, and a real defect surfaced — from adding three fields to
one task.

Per the ruling that decision belongs to §10, and this measurement gives it
its first requirement: **the seed must populate every collection-valued field
of every entity the environment poses tasks about**, because until it does,
inference numbers on those fields describe the fixture rather than the
inference. `attachments` is the immediate instance and its cost is measured —
46 of the remaining 82 recall misses.

**Not proposed here, per the standing rule:** the request-side divergence
(§4.4), and the subtree denominator, which the ruling parked pending exactly
this measurement. The measurement now says the subtree question is smaller
than it looked: 82 misses remain, not 126, and 46 of those are one unseeded
field rather than an inference limit.
