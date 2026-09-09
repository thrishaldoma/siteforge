# 0027 — Key values, as ground truth for a merge

**Status:** accepted
**Date:** 2026-09-10
**Context:** §3.4 (`capture/` is sensitive), §5 (response schemas), §7.4, §7.5
(narrowing and its evidence), 0025 (the entity merge rule and the rung it could
not reach)

0025 merged entities on **field-set containment** and took
`entity-identity.precision` from 0.600 to 1.000. It also recorded what it could
not use:

> The ground-truth rung for entity identity is *value overlap on the key*: if
> `GET /tasks/all` returned rows with `id ∈ {1,2,3}` and `GET /tasks/:task`
> returned `id = 2`, those are not similar shapes, they are **the same record**.
> […] It is unavailable here. `infer-endpoints.mjs` writes `examples` only for
> **string** fields, and only `distinct.slice(0, 5)` of them. Vikunja's `id` is
> an integer, so the capture carries **no key values at all**.

This records what will be captured, and — more importantly — what will not.

---

## 1. The purpose is validation, not a better rule

**The merge rule does not change.** Field-set containment reached 1.000 on this
target and stays the mechanism. What is missing is any way to tell whether it
reached 1.000 *for the right reason*: a shape heuristic that happens to agree
with the oracle on four entities is not distinguishable, from inside, from one
that is correct.

Key values make that checkable. If the rows behind two merged endpoints share
key values, the merge united two observations of the same records — an
observation, not an inference. If they share none, the containment was a
coincidence the rule could not see, and the merge is wrong however good the
score looks.

So this is an **instrument for auditing the merge**, and it is deliberately not
wired into the merge decision. Making it evidence would mean a merge fails when
the crawl happened to see disjoint pages of one collection, which is a property
of the crawl rather than of the entities — the same mistake as scoring recall
over all spec definitions instead of the reachable ones (0023).

---

## 2. What qualifies as key-bearing, mechanically

**The field `keyOf` selects, for a row that became an entity. Nothing else.**

`keyOf(properties)` already exists, already runs on every row, and picks the
first member of `IDENTITY_KEYS` the row carries, classifying it `surrogate` or
`business`. It is the same function `Entity.key` is built from, so the values
recorded are values of the field the model *already claims* is the key.

This definition was chosen because it cannot drift:

- it is **not a name heuristic.** "Fields ending in `Id`" is exactly what §7.5
  forbids for foreign keys, and for the same reason — path normalisation
  collapses id segments to `:id`, so name comparison tests against a constant.
- it is **not "fields that look unique".** Uniqueness is a property of the
  sample, and a thin sample makes every field look unique. That is the enum
  finding wearing different clothes.
- it is **already computed.** A second definition of "the key" would be schema
  drift between two stages, and §13's first working convention is about exactly
  that.

A row with no `keyOf` result records nothing. An entity is not required to have
a key today, and inventing one to have something to record would be worse than
having nothing.

## 3. Why not widen `examples`

`examples` is capped at five distinct values, on string fields only, and §5
calls it "scrubbed sample values, **for human review** of the inference". That
cap is not an accident of implementation; it is what makes the field a review
aid rather than a data extract.

Widening it — all fields, or a higher cap — changes the artifact's character:

- **§3.4 exposure scales with how much you take.** `capture/` is sensitive
  precisely because it holds real data from a real instance. Five values of a
  string field is a sample; every value of every field is the database. The
  scrubber runs either way, and a scrubber is a filter for *known* shapes — the
  defence against unknown ones is not collecting them.
- **The seeding argument does not need it.** §8 seeds from captured responses,
  and it reads bodies, not `examples`.
- **Nothing asked for it.** This decision has one purpose, and it is served by
  one field per entity.

So: key fields only, and the cap for them is stated in §4 rather than removed.

## 4. What is recorded

On the **endpoint descriptor**, not inside the response schema:

```
observedKeyValues: {
  field: 'id',          // what `keyOf`'s rule selected
  values: [ … ],        // scrubbed, sorted, capped
  distinctObserved: n,  // how many there were before the cap
  truncated: boolean,   // whether the cap bit
} | null
```

The first draft of this section put it on the schema node beside `examples`, and
that is wrong twice over.

`JsonSchemaNode` is **shared between the capture model and SiteModel** — an
operation's response schema is the same type — so a field added there grows
SiteModel's claim surface, and `needs.ts` requires every leaf to have a consumer
that asks for it. There is no codegen need and no scored category for a capture
audit aid, so it would have to be claimed by something invented for the purpose.
`EndpointDescriptor` is capture-only, and nothing downstream is obliged to
notice.

The better reason is that it is the truer home. Key values are a fact about
**what this endpoint's rows contained**, not about the shape those rows had, and
the schema node describes the shape. Putting an observation inside a shape
description is the category error §5 avoids elsewhere by keeping `examples`
explicitly labelled as review material.

Three properties, and each is there because of a way this could mislead:

- **`distinctObserved` is the count before the cap**, so a comparison across two
  endpoints knows whether an empty intersection means "no shared records" or
  "we kept the first twenty of nine hundred each". Without it a truncated
  overlap test reports a false negative and looks like a real one.
- **`truncated` is stated rather than inferred** from `values.length === CAP`,
  because a collection of exactly CAP distinct values is not truncated and the
  two must not read alike.
- **The values are scrubbed**, through the same `scrubDeep` path as every other
  captured value. A key can be an email in an API that keys users by address.

**Cap: 200.** Higher than `examples`' five, because five values out of a
collection is useless for an overlap test — the test is whether two endpoints
saw the same records, and a five-value sample of two hundred rows will show an
empty intersection almost every time. Two hundred is chosen to cover a seeded
fixture instance whole; against a production-sized collection it truncates, and
`truncated` says so rather than the number quietly meaning something else.

## 5. What it is compared against, and what that costs

Nothing, yet, in the pipeline. The comparison is a **report**: for each merge,
the size of the key-value intersection between the container's endpoints and
the projections'. High overlap corroborates; zero overlap contradicts.

Deliberately not a gate. A gate would have to decide what an empty intersection
means, and it has two meanings — the merge is wrong, or the crawl saw disjoint
pages — that the capture cannot tell apart. §7's standing rule applies: when
confidence is low, record the fact, not the verdict.

---

## Open

- Composite keys. `keyOf` returns one field, so a row keyed on a pair records
  the first one and the overlap test is weaker than it looks. Not a problem on
  this target and not solved here.
- The report has no consumer beyond a human reading it, which is the same
  standing weakness every `reviewRequired` claim in this repository has.
