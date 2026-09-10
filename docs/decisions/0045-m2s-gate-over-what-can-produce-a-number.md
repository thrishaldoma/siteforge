# 0045 — M2's gate over the gradeable subset, and what deferring actually costs

*Status: proposed, for review. Recommends **option 1** — gate over the
gradeable subset with each deferral recorded and dated — and argues it from
what M3 needs rather than from what is convenient now.*

The question: M2's gate is defined over categories that cannot all produce
numbers on Vikunja. `narrowing` is ungradeable against a document its own
server contradicts, `synthesized-endpoint` needs a target Vikunja is not, and
`identifier` is not derived. Either gate over the gradeable subset with the
rest explicitly deferred, or add a second target and gate over the union.

The right frame was given with the question: **a category that has never
produced a number is a part of `SiteModel` nothing has ever checked.** That is
the cost of deferring, and it is the thing to weigh against a second target's
cost. So the first job is to measure that surface rather than assume it.

---

## 1. The unchecked surface, measured

`SiteModel` has **421 leaves**. `MODEL_NEEDS` already records which consumer
(§8, §9, §10) reads each one and which scored category claims it, and
`modelClaims()` computes the join — so this is read off the repository rather
than assembled by hand.

At leaf granularity, which is the granularity the question is about:

| | leaves |
|---|---|
| total | 421 |
| claimed by a consumer (§8 / §9 / §10) | 384 |
| claimed by a scored category | 139 |
| consumed **and** scored | 117 |
| **consumed and never scored** | **267** |

**267 leaves are read by a consumer and scored by nothing.** That is the
surface the question's framing points at, and it is roughly two thirds of
everything a consumer reads. The deferred categories are not the reason for
it.

By part, so the shape is visible rather than just the total:

| part | leaves | consumers claiming it | scored categories |
|---|---|---|---|
| `operations` | 160 | 3 | 11 |
| `entities` | 46 | 4 | 7 |
| `routes` | 49 | 3 | **none** |
| `components` | 49 | 2 | **none** (evidence claims only) |
| `layouts` | 40 | 1 | **none** |
| `behaviours` | 24 | 2 | **none** |
| `tokens` | 20 | 1 | **none** |
| `assets` | 12 | 1 | **none** |
| `fonts` | 11 | 1 | **none** |

**Only `operations` and `entities` have any scored category at all — 206 of
421 leaves live under them, and the remaining 215 under no scored part.** Even
inside those two, scoring is partial: 139 leaves are individually claimed by a
category, so `operations` and `entities` are not fully covered either. Nothing
here is "ungradeable"; it is simply ungraded.

### 1.1 And the gates that would cover them are not written

The obvious answer is that those parts belong to §9's visual and behavioural
gates rather than to the grader, and that is what §12 names as M2's and M3's
gates. It is also true that **neither gate exists**: `packages/verify/src`
contains `grade/` and an index, and nothing else. There is no `odiff`
comparison, no trace replay.

So the honest statement is not "the rest of `SiteModel` is checked elsewhere".
It is that **267 consumed leaves are checked by an instrument that has not been
built**, and the deferred categories in the question are a small slice of a
much larger unchecked surface.

The order of those two sentences matters. "Two thirds of `SiteModel` is
unchecked" is the scarier claim and the false one — the parts are not
*unscoreable*, they are waiting on gates §12 already names. Stopping at the
scary half is how a number gets quoted later without its second clause.

### 1.2 Measured this turn: the crawl more than doubled, and no graded number moved

Landing state independence (0044 §5) took completed flows from **53 to 113**
and undriveable controls from 75 to 33 — the largest change to what the crawl
actually exercises in the project's history. Graded before and after, on
captures whose endpoint sets differ:

```
response-field-presence.precision   0.4538  270/595   →  0.4538  270/595
request-field-presence.precision    0.6494   50/77    →  0.6494   50/77
field-type.accuracy                 0.8969  287/320   →  0.8969  287/320
entity-field-presence.recall        0.9355   58/62    →  0.9355   58/62
endpoint-identity.conservation      1.0000   22/22    →  1.0000   21/21
```

**One number moved, and it is the one that mechanically tracks the endpoint
count.** Everything else is byte-identical — §13's "exact non-movement is
data" — and the explanation is the coverage table: `behaviours` is scored by
nothing, so doubling the transitions captured cannot move a score. The single
endpoint that differs, `POST /api/v1/tasks/:task`, is unmatched and therefore
contributes to no numerator or denominator.

This is 0021's finding arriving from a new direction. It is not an argument
that the work was wasted — the transitions are what §9's behavioural gate will
replay. It is evidence about **the grader's reach**, and it bears directly on
the question: a second target extends the same reach.

## 2. What deferring each category actually costs

The cost is not uniform, and the difference decides the answer. A category
that has never produced a number is only dangerous if the model **emits** the
thing it would have scored — an unchecked claim reaching codegen is a risk, an
absent claim is a missing feature and is visible as absence.

| deferred | emits into `SiteModel`? | what deferring costs |
|---|---|---|
| **`narrowing`** | **yes — 43 `date-time` narrowings**, against a denominator of 55 scorable slots, all unscored (`vacuous 0/55`) | **real.** §8 seeds the mock store from response schemas, so a wrong narrowing makes valid states of the real system unrepresentable in the clone, silently, on every trajectory touching the field (§7.5) |
| `entity-narrowing` | **no** — `vacuous 0/0`: the model emits no enum narrowing on any paired entity field | nothing. Confirmed by grading rather than assumed; it was the one row where "emits" was a guess |
| `identifier` | **no** — hardcoded `ZERO`, not derived | nothing silently wrong. §7.4 reads foreign keys from `identifier.pathParamOf`, so the cost is a *missing* capability, visible as absence |
| `entity-relation` | **no** — `RelationSchema` cannot express the one reachable relation | as above: absence, not error |
| `synthesized-endpoint` | **no** on this target — 0041 §7.2 | nothing. All 65 extractable URLs are SPA routes; there is no claim to be wrong about |

One clarification the grader forced: **`narrowing.recall` is not vacuous** —
it reads `0.000  0/5`, a real and failing number, because the document does
declare 7 enum claims on matched response fields. What makes the *category*
unusable is the divergence budget: `narrowing` carries field-level divergence
on 4 of 9 scored slots against a 0.45 cap, and the grader's own verdict is
"this document is not fit for grading narrowing on this target". So the
blocking reason is the contradiction, not silence — and it is already
machine-checked rather than a matter of opinion.

**Four of the five emit nothing.** Deferring them cannot produce a silent
error, because there is no output to be silently wrong. Only `narrowing` has a
live cost, and it is the one a second target could actually address — a
document that declares formats and enums supplies the truth side that
Vikunja's does not.

### 2.1 The narrowing risk is bounded on one side already

A `NarrowingRecord` carries the counts it was drawn from and the schema rejects
one the evidence does not support (§13), so a narrowing inconsistent with its
*own observations* does not parse. What no internal check can catch is the
dangerous direction: a field observed with three values across forty records
looks like a closed domain and may not be. That needs external truth or a
larger sample, and it is exactly what is being deferred.

## 3. Argued from what M3 needs

**Codegen is three lines and `export {}`.**

```
packages/codegen/src/index.ts:  // Scaffolding only: no logic yet.
```

That is the decisive fact, and it is the project's own discriminator rather
than a new one. 0039 §1.2 scores apparatus by whether a finding **invalidates
something already built**; four turns scored four for four on that test. A
second target, added now, buys grader coverage over `operations` and
`entities` — the two parts already best covered — for a consumer that does not
exist. It cannot invalidate anything, because there is nothing yet to
invalidate.

Meanwhile M3's actual dependencies are: a mock backend built from `operations`
and `entities` (scored today), and a frontend built from `tokens`,
`components`, `layouts`, `routes` (scored by nothing, gated by an unwritten
§9). The unchecked surface that will bite M3 first is the one **neither option
in the question touches.**

## 4. Recommendation: option 1, with a dated expiry

**Define M2's gate over the categories that produce numbers**, and record each
deferral with its blocking reason and its vacuity cause from §13's table:

| deferred | cause (§13) | blocking reason |
|---|---|---|
| `narrowing.precision` | target limitation | the document declares zero formats in 368KB, against **43 narrowings the model emits** |
| `narrowing.recall` | document contradicts its server | **over the divergence cap** — 4 of 9 scored slots, cap 0.45; the grader itself reports the document unfit for this category |
| `entity-narrowing.*` | declined on evidence | the model emits no enum narrowing on a paired entity field (`0/0`) |
| `identifier.*` | unimplemented stage | not derived; §7.4's `pathParamOf` has no producer |
| `entity-relation.*` | target limitation + schema | `RelationSchema` cannot express the one reachable relation |
| `synthesized-endpoint` | declined on evidence | the ranking ran and correctly bound nothing (0041 §7.2) |

Three conditions, in the shape 0040 §4 used, so this is a deferral and not a
punt:

1. **`narrowing`'s deferral expires when codegen begins seeding the store from
   response schemas.** That is the moment an unchecked narrowing reaches a
   generated environment, and it is an event in the work rather than a date.
2. **A second target remains the only thing that supplies `narrowing`'s truth
   side.** This defers the question; it does not answer it. Saying so keeps
   §12's "do not start a milestone before the previous one's gate is green"
   from being quietly reinterpreted as "green over whatever happened to score".
3. **The gate must state the count it is defined over**, so a category
   silently dropping out of the gradeable set is visible. A gate over "the ones
   that produced numbers" with no number attached is the vacuity this
   repository keeps finding.

### 4.2 And the subset is not green today

Worth stating plainly, because "gate over the gradeable subset" can be misread
as "declare victory over what passes". Graded on the current capture, the
subset **fails**: `request-field-presence` 0.649 / 0.516 against gates of 0.95
and 0.9, `response-field-presence` 0.454 / 0.495, `field-type` 0.897 against
0.9. Passing today are `endpoint-identity`, `path-param-arity`, all five
`auth.*`, `entity-identity.precision` and both `entity-field-presence` metrics.

So option 1 does not make M2 green. It makes M2's gate **a statement that can
be true or false**, which is what a gate is, and the work of turning it green
is infer's — which is the point of having it.

### 4.1 What would change the recommendation

- **§9's gates getting written.** Once the visual and behavioural gates exist,
  the ~208 unscored leaves acquire an instrument, and the marginal value of a
  second target rises because grader coverage stops being the only coverage.
- **A narrowing reaching a generated clone.** Condition 1 firing.
- **A target that passes 0019's two criteria appearing cheaply.** The cost side
  here is measured, not assumed: Gitea failed criterion 1 (browser and document
  disjoint) and Directus failed criterion 2 (no universe prefix the UI's own
  traffic falls outside). Two of the three candidates examined were rejected on
  measurement, so "add a second target" is not a small task with a known
  answer.

## 5. What this does not claim

It does not claim the deferred categories are unimportant. `narrowing` is the
one §7.5 spends its longest section on and §13 repeats: a wrong enum is
silent, and silence is the failure mode this whole apparatus exists to remove.
The claim is narrower — that on **this** target, at **this** point in the work,
three of the four deferrals cannot be silently wrong because they emit
nothing, and the fourth is better addressed when its consumer exists than by
buying a second target for a stage that is three lines long.
