# 0025 — Two observations of one entity

**Status:** accepted
**Date:** 2026-09-10
**Context:** §7.4 (data model inference), §7.5 (narrowing and its evidence),
§13 (deduplicate by entity identity before any frequency heuristic), 0023 (the
inference suite), 0024 §6 (`entity-identity.precision 0.600` on the real model)

0024 measured `entity-identity.precision` at **0.6000 (3/5)** against the pinned
Vikunja, with one ambiguity:

```
ambiguous: models.Task ← All | Task
```

Infer emits **two** entities for one declared definition. `/api/v1/tasks/all`
names one `All`, `/api/v1/tasks/:task` names the other `Task`, and `dedupeRows`
keeps them apart because `shapeIdentity` is exact and the list view returns
fewer fields than the item view.

**This is the enum finding again, in the identity position.** There, a field was
called an enum because sampling was thin — a property of the observer read as a
property of the thing. Here, an entity's identity comes from *the route that
surfaced it* rather than from the entity, so two observations of one thing read
as two things. The rest of this document is written **before** the merge was
implemented or measured, which is the point of it: §13's rule that a threshold
declared after the fact cannot be distinguished from a tuned one.

---

## 1. What may not be used as evidence

**The declared definitions are the grader's oracle.** `models.Task` is what
`entity-identity` scores against, so merging on "these two rows resolve to one
definition" would be fitting to the metric — the model would agree with the
document because it read the document. Excluded absolutely, and the same
argument that keeps the truth loader target-independent (0018).

**The route is what produced the defect.** `/tasks/all` and `/tasks/:task` are
the reason there are two entities; a merge rule reading paths would be curing
the disease with the pathogen. Excluded.

**And the evidence that would actually settle it is not in the artifact.**

The ground-truth rung for entity identity is *value overlap on the key*: if
`GET /tasks/all` returned rows with `id ∈ {1,2,3}` and `GET /tasks/:task`
returned `id = 2`, those are not similar shapes, they are **the same record**,
and that is an observation rather than a heuristic. It is what §7.4 already does
for foreign keys (`RelationSchema.evidence: 'value-overlap'`).

It is unavailable here. `infer-endpoints.mjs` writes `examples` only for
**string** fields, and only `distinct.slice(0, 5)` of them. Vikunja's `id` is an
integer, so the capture carries **no key values at all** — not a truncated
sample, none. So this design is a shape heuristic because the observation was
thrown away upstream, and that is a capture gap rather than a preference. It is
recorded in §5 and it is the thing to fix before this rule is trusted further.

---

## 2. The rule, declared

Two row shapes are one entity when **all four** hold.

### 2.1 Containment, not similarity

One row's canonical scalar field set is a **subset** of the other's.

A list view is a *projection* of the item view, and a projection is a subset by
construction — it drops fields, it never adds one. Jaccard similarity scores
such a pair at `|A∩B| / |A∪B|`, so a list returning four of an item's fourteen
fields reads **0.29**: symmetric similarity punishes the projection for being a
projection, which is exactly the case this rule exists to catch. Containment is
the relation that actually holds between the two observations.

### 2.2 The same key

`keyOf` returns the same field for both. A projection keeps the key it is
addressed by; two rows keyed on different fields are two entities however much
their names overlap.

### 2.3 A unique container — and this is the condition carrying the weight

The narrower row must be contained in **exactly one** wider row. Two candidate
containers, and no merge happens.

Containment alone over-merges, and no floor fixes it: `Project{id, title,
description, created, updated}` is a subset of `Task{…}` at any size you like.
What defeats that case is not improbability but **ambiguity** — a
metadata-shaped row is contained in *several* wider rows, so requiring the
container to be unique makes coincidence disqualifying rather than merely
unlikely. A row that could be a projection of two different entities is not
evidence about either.

This is the same discipline the grader's `matchEntities` already applies in both
directions (0023 §2): an ambiguous pairing is a miss on both sides, never
resolved by keeping the better-scoring candidate.

### 2.4 A floor: `MERGE_MIN_SHARED_FIELDS = 4`

The narrower set must have at least four fields. This excludes the degenerate
case and nothing more — `{id}` is a subset of everything, and a one-field row
carries no shape to be similar *with*.

Four, and the reasoning is what makes it declarable rather than fitted: an
identity key is shared by construction (`IDENTITY_KEYS` is how `keyOf` finds
one), and `created`/`updated` are shared for free by nearly every row of nearly
every REST API. A floor of four therefore means **at least one domain field had
to coincide as well**, on top of the three any two rows of one API supply
without meaning anything.

The precedent for a declared count floor is `ENUM_MIN_DISTINCT_RECORDS = 20`,
and it answers §13's standing objection to numeric proxies: that rule is about a
count *standing in for a shape* ("at least two segments" for "terminates at a
schema leaf"). Here the count is not a proxy — it **is** the evidence strength,
the same way twenty distinct records is.

**Declared now and not adjusted afterwards.** If 4 over-merges on this target,
that is a finding to report in §4, not a number to move.

---

## 3. The merge carries its evidence

Per §13 — *a derived field carries the evidence it was derived from, and the
schema rejects a value that evidence does not support* — and shaped after
`NarrowingRecord`, for the same reason it exists.

A merge is a narrowing of the model's *identity* claim. Getting it wrong has the
same character as a wrong enum: the mock backend gets one table where the real
system has two, so the wider row's fields appear on rows that never carried
them, silently, on every trajectory that touches either. So it gets the same
treatment — the counts travel with the claim, `reviewRequired: true`, and a gap
id, and `MergeRecordSchema.superRefine` rejects a merge the counts do not
justify. An unjustified merge does not parse.

```
mergedFrom: {
  kind: 'field-set-containment',
  sources: [<endpointId>, …],   // ≥ 2, the endpoints whose rows became one
  narrowerFields: n,            // |smaller|
  widerFields: m,               // |larger|
  sharedFields: k,              // |smaller ∩ larger| — and k === n, or it is not containment
  keyField: <field>,
  reviewRequired: true,
  gapId: <gap>,
}
```

`sharedFields !== narrowerFields` is rejected as not-containment, and
`narrowerFields < MERGE_MIN_SHARED_FIELDS` is rejected as below the floor. Both
are properties the record can be checked against on its own, without the rows —
which is the point: a reader of the model can tell whether the merge was
justified without re-running infer.

---

## 4. Prediction, written before the measurement

§13's new rule — *write down the number you expect, and assert the input
actually differs*. What follows was recorded before the merge ran.

| metric | today | predicted after | why |
|---|---|---|---|
| `entity-identity.precision` | 0.6000 (3/5) | **1.0000 (4/4)** if `All ⊆ Task` and `Task` is its unique container; **0.6000 unchanged** otherwise | the two ambiguous entities become one paired entity, or they do not |
| `entity-field-presence.*` | 1.0000 (29/29), 0.9063 (29/32) | **both move** | `Task` is unpaired today, so its fields are in neither tally; a merged `Task` becomes paired and its whole field set enters both. Precision most likely **falls** — the item view is wide and the document will not declare all of it |
| `entity-narrowing.*` | vacuous (0/0) | **possibly non-vacuous** | the contract's denominator of 1 is `models.Task.repeat_mode`, reachable only through a paired `Task` |
| every `capture-fidelity` metric | — | **byte-identical** | the merge is in infer; that suite scores a capture artifact. If any of them moves, the change reached something it must not have, and that is the finding rather than the score |

The last row is the assertion, not a hope: it is the falsifiable half, and it is
cheap because "exactly unchanged" is a much narrower claim than "roughly the
same".

**A null result is a legitimate outcome here.** If `All` carries even one field
`Task` lacks, nothing merges, `entity-identity.precision` reads 0.6000 again,
and §4's job is to report that as the result — with the field sets, so the next
reader can see *why* rather than being told the rule did not fire.

---

## 5. Measured

Both models graded against the same pinned truth, the second with
`--without merge`, so "unchanged" is an A/B rather than a memory.

| metric | without merge | with merge | §4 said |
|---|---|---|---|
| `entity-identity.precision` | 0.6000 (3/5) | **1.0000 (4/4)** | 1.0000 (4/4) — **right** |
| `entity-field-presence.precision` | 1.0000 (29/29) | 1.0000 (58/58) | "moves, most likely falls" — moved, **did not fall** |
| `entity-field-presence.recall` | 0.9063 (29/32) | **0.9355 (58/62)** | "moves" — right, direction **wrong** |
| `entity-narrowing.recall` | vacuous (0/0) | 0.0000 (0/1) | "possibly non-vacuous" — right |
| `entity-narrowing.precision` | vacuous | vacuous | — |
| `entity-identity.recall` | vacuous | vacuous | — (`notDerived`, 0023 §3.1) |
| **every `capture-fidelity` metric** | — | **identical to the digit** | **right** |

`ambiguous: models.Task ← All | Task` is gone; the report reads `0 ambiguous`.

### Where the prediction was wrong, and what that says

**Field presence did not fall.** The merged entity contributed 29 fields, every
one of them declared — `entity-field-presence.precision` stayed at 1.0000 with
its counts doubled, and recall went *up*, from 0.9063 to 0.9355. The reasoning
behind the prediction was that a wide item view would emit fields the document
does not declare. It emits none. That is a fact about Vikunja's document being
complete over this definition, and it is worth more than the guess it replaced:
the fields infer reads off the wire are all in the spec, so the field-presence
recall shortfall is four fields infer **missed**, not fields it invented.

**And the containment ran the other way.** 0024 said "the list view returns
fewer fields than the item view". Measured: `/tasks/all` and
`/projects/:project/views/:view/tasks` return **27** scalar fields and
`/tasks/:task` returns **25**. The *list* is the wider observation on this
target — the item view is the projection.

The rule survived a reversal of the direction its own motivating story assumed,
and it survived it because it never reads which endpoint is which. §2.1 argues
containment from the shape of a projection; had it been implemented as "fold the
list into the item", it would have done nothing here. That is the difference
between a rule about shapes and a rule about routes, and it is the second time
in this document that reading the route would have been the mistake.

### The number that did not move, and why it is the assertion

Nine `capture-fidelity` metrics and five auth metrics are identical between the
two runs — same values, same numerators, same denominators. That is the
falsifiable half of §4, and it holds: the merge is an inference change and the
suite beside it scores a capture artifact (0022). Had `response-field-presence`
twitched, the finding would have been that the merge reached into the capture
side, and the score would have been the wrong thing to look at.

### One thing got worse, and it is cosmetic

The surviving entity is named **`All`**, because `entityNameFor` names an entity
from the first source's path and the container's first source is
`/api/v1/tasks/all`. It was already an open item in 0024; the merge makes it
more visible rather than causing it. Nothing scored moves — the grader pairs
through `effect.entity` and never by name (0023 §2) — but codegen would emit a
table called `All`, and §7.2's rule is that a name comes from what the thing is.
Left as an open item rather than fixed here, because picking the "better" source
path is a heuristic that wants its own argument.

---

## Open

- **The key-value rung.** `examples` is string-only and capped at five, so the
  observation that would settle identity outright is discarded by capture. The
  fix is a capture change (record the key field's observed values, scrubbed),
  and until it lands every merge here rests on shape rather than on records.
- A merge is `reviewRequired` and mints a gap, and nothing yet *reads* those
  gaps back — the same standing weakness as every other review-required
  narrowing. `need:merge-review` declares the consumer §7.5 requires; it is not
  built.
- **`entityNameFor` names the merged entity `All`.** Cosmetic today and wrong
  tomorrow: the name reaches codegen as a table name. Choosing between a merge's
  source paths is a heuristic, and it wants an argument before it gets one.
- `entity-narrowing.recall` is now `0.0000 (0/1)` rather than vacuous. The
  denominator is `models.Task.repeat_mode` and infer narrows nothing there, so
  the enum ladder has been scored on an entity field for the first time and
  reads zero. Whether that is a defect or the ladder correctly declining thin
  evidence is a question this document does not answer.
