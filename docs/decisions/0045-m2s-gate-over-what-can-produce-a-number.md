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

### 1.2 Corrected: the crawl more than doubled, and five graded numbers moved

> **This section said the opposite when first written, and the error is
> instructive.** The claim was "no graded number moved", from an A/B that
> swapped the *capture* and re-graded. But `grade:capture` reads the model
> from `envs/<site>/site-model.json` and only the **observed** list from the
> capture — so without re-running infer, both grades scored the *same stale
> model*, and the one metric that moved (`conservation`) was the only one that
> reads the observed list. A measurement whose failure mode produces a
> plausible answer, which is §13's own warning, in the document arguing about
> coverage. Redone with infer re-run against each capture:

Landing state independence (0044 §5) took completed flows from **53 to 113**
and undriveable controls from 75 to 33 — the largest change to what the crawl
actually exercises in the project's history. Graded before and after, on
captures whose endpoint sets differ:

| metric | baseline capture | after |
|---|---|---|
| `request-field-presence.recall` | 0.5155 (50/97) | **0.9333 (14/15)** ✓ |
| `request-field-presence.precision` | 0.6494 (50/77) | 0.7368 (14/19) |
| `field-type.accuracy` | 0.8969 (287/320) | **0.9000 (225/250)** ✓ *boundary* |
| `response-field-presence.precision` | 0.4538 (270/595) | 0.4207 (236/561) |
| `response-field-presence.recall` | 0.4954 (270/545) | 0.5153 (236/458) |

**A change to the crawler moved five inference metrics and carried two over
their gates.** `field-type` is marked *boundary* deliberately: it reads
exactly its `≥ 0.9` gate, with zero margin, on a denominator that moved
320 → 250 in the same change. A gate passing by nothing on a shifted
denominator is not a result to lean on.

*Amended after 0047 and 0048.* A fresh crawl of the same pinned digest, with
the map fix changing the model, reports **`0.9000` on `225/250` again —
numerator and denominator both byte-identical.** §13 says exact
non-movement is the first thing to disbelieve, so it was checked rather than
noted: `field-type` is scored over fields present on *both* sides, and every
field 0047 removed was model-only, so none of them was ever in this
denominator. The stability is real and it is a statement about the crawl's
determinism in this region, not about the metric. **The gate is still met
with zero margin and is still not a result to lean on** — and per the
ruling, the threshold is not being tuned to move it off the line. The next
real change to matched-field types will move it, and that is when it becomes
a number. That is the opposite of the original claim and a stronger form
of the same argument: these numbers are substantially about **capture**, which
is 0021's finding reached a second way (0046 §4.1).

It bears on the question directly. A second target would extend the grader's
reach over `operations` and `entities` — the parts whose scores turn out to
move with the crawler — while the 267 leaves no category touches stay
untouched.

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
| ~~`synthesized-endpoint`~~ | **CORRECTED — yes, 5** | see §2.2. Filed here as emitting nothing on the strength of a `0/0`, which is the exact mistake the deferral classes exist to prevent |

One clarification the grader forced: **`narrowing.recall` is not vacuous** —
it reads `0.000  0/5`, a real and failing number, because the document does
declare 7 enum claims on matched response fields. What makes the *category*
unusable is the divergence budget: `narrowing` carries field-level divergence
on 4 of 9 scored slots against a 0.45 cap, and the grader's own verdict is
"this document is not fit for grading narrowing on this target". So the
blocking reason is the contradiction, not silence — and it is already
machine-checked rather than a matter of opinion.

### 2.2 The gate caught this table's own error on its first run

`DEFERRALS` and `countEmissions` landed with the classes above. Run against
the model, the transition guard immediately failed:

```
synthesized-endpoint: class-changed — declared emits-nothing, the model emits 5
```

**`synthesized-endpoint` was filed `emits-nothing` on the strength of the
grader reading `vacuous 0/0`** — and that denominator counts *in-universe*
synthesized endpoints, not emitted ones. §7.6 binds 5 controls by `href` to
SPA routes outside `/api/v1`, so they score nothing and exist anyway. §8
implements a `bound-from-control` endpoint against the store, and 0015 calls
such claims "the highest-hallucination-risk claims in the model" — so those 5
reach codegen unchecked.

Reading a filtered denominator as an emission count is precisely the confusion
the two classes exist to prevent, and it was made in the document that
introduced them. Re-declared `emits-but-unscored`, with an expiry on codegen
implementing bound-from-control endpoints.

**So three of the five emit nothing**, and two are tracked risks. Deferring them cannot produce a silent
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
| `synthesized-endpoint` | **emits 5, unscoreable** | all 5 bind by `href` to SPA routes outside `/api/v1`, so the universe filter excludes them from the denominator while they stay in the model |
| `identifier.*` | unimplemented stage | not derived; §7.4's `pathParamOf` has no producer |
| `entity-relation.*` | target limitation + schema | `RelationSchema` cannot express the one reachable relation |

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
