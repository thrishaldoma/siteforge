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

### 3.2 The split's first implementation was inert, and the number said so

Worth recording because the defect is the reason the audit is measured
rather than reasoned. The restriction was first written **per endpoint**:
exclude a matched endpoint the model has no response field for.

It reported `seed-coverage 1.0000 (20/20)` and left recall byte-identical at
0.5153. A restriction that changes nothing is either unnecessary or broken,
and §13 says which to suspect first: **exact non-movement is data.**

`GET /teams` on this instance returns `[]` at 200 — no team exists, so no
schema can be inferred — and `{"message": …}` at 401, which the anonymous
re-issue observed. An endpoint-level test asks "did the model emit *any*
response field here", the 401 error body answers yes, and all 26 of the
document's 200 fields stay in the denominator.

The restriction is **per (endpoint, status) slot**. An observed 401 does not
make a 200 collection reachable.

## 4. Measured

Against a fresh crawl of the pinned digest, with the [[0047]] fix in the
model — so these are numbers about the current model rather than the one
that motivated the split.

| metric | value | gate |
|---|---|---|
| `response-field-presence.precision` | **0.9291** (236/254) | ≥ 0.95 ✗ |
| `response-field-presence.observed-body-recall` | **0.6519** (236/362) | ≥ 0.9 ✗ |
| `response-field-presence.seed-coverage` | **0.7904** (362/458) | reported |

**96 of the 458 fields the document declares sit at slots the crawl never
observed a body for.** That is 21% of the category's old denominator, and it
was being charged to inference. Recall moves 0.5153 → 0.6519 on the same
model — the number did not improve, the denominator stopped containing
fields no inference could have reached.

Both halves are still red, and they are now red about different things:
precision about error-response bodies infer records and the document does
not declare ([[0047]] §8), recall about null-valued nested subtrees where
the model reaches 12 depth-4 pointers against the document's 80.

### 4.1 The audit's two live candidates: neither splits

**`request-field-presence` — does not split.** Its whole delta is six fields:

```
POST /login                       FN: /totp_passcode      (model 3, truth 4)
POST /user/settings/general       FP: /frontend_settings/{4 keys}, /max_right
```

The five false positives are the model enumerating a free-form object's
observed keys — [[0047]]'s defect, four keys wide, below R1's floor. That is
a claim the model makes, which is precision's subject. The one false
negative *is* a seed effect (the fixture account has no TOTP), but it is one
field in fifteen. Two populations with materially different ceilings is not
what this is.

**`entity-field-presence` — does not split**, against the expectation going
in. Its recall is 0.9355 (58/62) and the four misses are:

| definition | missing |
|---|---|
| `models.Project` | `subscription`, `views` |
| `models.Task` | `subscription` |
| `v1.UserWithSettings` | `email` |

Three of four are the observation ceiling — `subscription` is null in every
observed body, `email` is never returned — so the effect is real and it is
**four fields**. Precision is 1.0000. Splitting here would add a metric to
express a 6% ceiling on a category that passes both its gates, and a
contract acquires metrics nobody needed exactly that way.

**So the finding is that `response-field-presence` was the only pair that
needed splitting**, and that is a result rather than an absence of one. The
prediction going in was that `entity-field-presence` would split too; it was
measured instead of assumed, and the measurement said no.

---

## 5. `observed-body-recall` characterized — the honest fix is already in place

Measured after [[0049]], on the current capture. **126 misses**, and the
ruling's two categories separate cleanly:

| | misses |
|---|---|
| the **field itself** — infer reached the parent and omitted the key | **26** |
| the **subtree beneath** a missing field | **100** |

So the bulk is subtree, as 0046 found — the proportion is 79%, and the
absolute number fell from 146 to 100 because [[0049]] and the status split
removed unreachable slots from the denominator rather than because anything
was fixed.

### 5.1 The 26 are not what the ruling expected, and this is the finding

The ruling's first category was: *"`assignees: null` IS observed — infer
should emit it as nullable-unknown rather than omitting it. That's recall
infer can legitimately win."*

**Infer already emits it.** Measured on `GET /api/v1/tasks/all`'s item schema:

```
assignees     inSchema=true   inRequired=true    type "null"
attachments   inSchema=true   inRequired=true    type "null"
labels        inSchema=true   inRequired=true    type "null"
reminders     inSchema=true   inRequired=true    type "null"
subscription  inSchema=false  inRequired=false   —
```

`inRequired` is the discriminator, and it is decisive: a key is in `required`
only when it was present in **every** observed record. So `assignees` was
present in every body with the value `null`, and `inferSchema` emitted
`{type: 'null'}` for it — the nullable-unknown the ruling asked for, under a
different spelling. It is a **hit** for recall, not a miss.

`subscription` is the opposite case and the code path says which: a key that
is `undefined` in every observation makes `inferSchema` return `null` and the
key is dropped. It was never in any body, so there is nothing to emit and
nothing observed to emit it from.

So the 26 break down as:

| | count | is this recall infer can win? |
|---|---|---|
| `[]` item pointers under an always-null array | 14 | **no** — no element ever existed |
| fields **never present in any body** (`email` 7, `subscription` 5) | 12 | **no** — nothing was observed |
| fields observed as null and omitted | **0** | — already emitted |

**The honest fix closes nothing, because it is already done.** That is the
measurement the ruling asked for before anything touches the denominator, and
it is the answer: 0 of 126.

### 5.2 The always-null fields are a `field-type` cost, not a recall one

Where they *do* show up is the other metric, and it explains a number flagged
twice already. Of `field-type`'s **25** disagreements on matched response
fields, **21** are the model saying `null` against a document saying
`array` (15) or `object` (6):

```
"null" vs array    15
"null" vs object    6
"string" vs integer 4
```

So `field-type.accuracy` reading exactly `0.9000` (225/250) at its gate is
**five sixths a statement about the seeded instance** — a Vikunja with no
assignee, attachment, label or reminder on any task. Emitting `array` there
would be inventing a type from an observation that never happened, which §7.5
forbids; emitting `null` is correct and is scored as wrong.

Recorded, not fixed. It is the same class as `seed-coverage` — a ceiling that
belongs beside a metric rather than inside it — and whether `field-type`
wants the same treatment is a separate decision nobody has asked for.

### 5.3 The denominator question stays untouched, as ruled

The 100 subtree misses are pointers under a value that was never anything but
null or never present at all. Not inferable from any observation, and the
ruling was explicit that the exclusion waits until the first half is measured.
It is measured, and it closed nothing — so the subtree question is now the
*whole* of the remaining gap rather than most of it, which is worth knowing
before anyone designs the predicate.
