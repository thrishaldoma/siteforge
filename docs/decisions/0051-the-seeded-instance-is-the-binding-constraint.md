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
