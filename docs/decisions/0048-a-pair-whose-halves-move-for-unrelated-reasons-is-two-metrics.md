# 0048 — A pair whose halves move for unrelated reasons is two metrics

*Status: accepted. Contract v5, digest changed in the same commit as the
table. The audit in §3 is the general form the ruling asked for.*

[[0046]] diagnosed `response-field-presence` at precision 0.4207 / recall
0.5153 and found the two halves have **different subjects**:

- **precision** is one endpoint's map-valued response modelled as a record
  type — an inference defect, fixed in [[0047]], and one a richer seed makes
  *worse* because more route groups mean more spurious fields;
- **recall** is bounded above by seed coverage — 62 of its 208 misses come
  from five endpoints this instance never populates, where no body was
  observed and no schema could exist whatever infer does.

The ruling: split the pair, and generalise the rule.

---

## 1. The split

| id | over | gate |
|---|---|---|
| `response-field-presence.precision` | unchanged — response fields infer emitted, on matched endpoints | ≥ 0.95 |
| `response-field-presence.observed-body-recall` | spec fields on matched endpoints **whose body the crawl observed** | ≥ 0.9 |
| `response-field-presence.seed-coverage` | matched endpoints with an observed body, over all matched endpoints | **reported** |

Three properties, each deliberate.

**Precision's denominator does not move.** It counts what the model emitted,
which is empty for exactly the endpoints the new denominator drops — so they
never contributed to it. The number before and after the split is directly
comparable, which matters because this turn also changed the model underneath
it ([[0047]]) and two simultaneous shifts in one number would be
uninterpretable.

**Recall is renamed, not just re-scoped.** `recall` over a denominator the
crawl chose is a number the next reader compares against another target's
recall and draws a conclusion about infer from. The id has to carry the
restriction or the restriction is a footnote.

**Seed coverage is reported and never gated.** It is the excluded population,
kept visible — the same treatment `auth.unprobeable-count` got in v2. Gating
it would make it a target, and the way to hit a seed-coverage target is to
seed for the metric.

### 1.1 The precedent is v2, and it is the same argument

`auth.evidence-coverage` averaged probeable reads with mutations, whose
verdict can never rest on a probe because §6 forbids re-issuing a mutation
anonymously. Two populations, different achievable ceilings, one number that
was bounded below for a reason that is a property of the API rather than of
infer. The remedy then was to score over the population the metric is about
and report the other half beside it. This is that, on a different pair.

## 2. What the split does not do

It does not make `response-field-presence` a good number. It makes it two
numbers that are each about one thing. Recall over observed-body endpoints
was **0.6188** at diagnosis time, against a 0.9 gate — still red, and now red
about something specific: 146 of the remaining misses are null-valued nested
subtrees (`assignees: null`, `attachments: null`), where the model reaches 12
depth-4 pointers against the document's 80. That is a real limit of union-
over-observed-bodies and it is the next thing this category needs.

## 3. The audit — every P/R pair, and the discriminator

The ruling asked to generalise. The test: **do the two halves have different
achievable ceilings, for reasons that are not inference quality?**

| pair | verdict |
|---|---|
| `endpoint-identity` precision / conservation | **already split**, 0022. The second was renamed off `recall` because both its sides come from the observed list |
| `auth.*` | **already split**, 0018 §5 — the precedent this one follows |
| `response-field-presence` | **split here** |
| `request-field-presence` | see §3.1 — measured |
| `entity-field-presence` | see §3.1 — measured |
| `narrowing` precision / recall | recall ungated; both deferred, and the document declares zero formats. The ceiling is the *document's*, already recorded as a known divergence over cap |
| `identifier` precision / recall | **cannot be assessed.** Both sides emit nothing, so the halves have never both produced a number. Recorded as a condition on the deferral rather than a verdict |
| `entity-identity` precision / recall | recall `NOT DERIVED`, gate null — the denominator prose already says the document cannot ground it |
| `entity-relation` precision / recall | both `NOT DERIVED` |
| `entity-narrowing` precision / recall | recall's denominator is 1 and it is reported coarse |

The pairs whose recall is `NOT DERIVED` with `gate: null` are **already
handled**: the denominator prose is the split, made by declining to score
rather than by adding a metric. They are listed so the audit is visibly
exhaustive rather than a list of the ones that moved.

### 3.1 The two live candidates, measured rather than assumed

Reported in §4 after the re-run, because splitting for symmetry is how a
contract acquires metrics nobody needed. `entity-field-presence` is the one
to expect: its own `why` half-admits the problem — "both sides describe the
same server, so it measures document/server agreement" — and its recall
denominator is *every* property the document declares on paired entities,
which has the same unobserved-collection ceiling response recall had. If the
measurement says the effect is negligible, the finding is that
`response-field-presence` was the only pair that needed splitting, and that
is a result.

## 4. Measured

*Filled in after the crawl and re-infer, so that these numbers are of a model
built by the [[0047]] fix rather than the one that motivated it.*
