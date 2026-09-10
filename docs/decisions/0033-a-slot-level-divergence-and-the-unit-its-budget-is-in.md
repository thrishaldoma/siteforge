# 0033 — A slot-level divergence, and the unit its budget is in

*Status: accepted. Declared before implementing, and before the first entry lands.*

## 1. What is being registered

0029 §3.1 found four scored slots where Vikunja's Swagger declares one thing and
the recorded exchange shows another:

| endpoint | pointer | the document says | the server sent |
|---|---|---|---|
| `GET /api/v1/projects` | `/[]/views/[]/view_kind` | `integer` enum `["0","1","2","3"]` | `"list"`, `"gantt"`, `"kanban"`, `"table"` |
| `GET /api/v1/projects` | `/[]/views/[]/bucket_configuration_mode` | `integer` enum `["0","1","2"]` | `"manual"`, `"none"` |
| `GET /api/v1/projects/:project` | `/views/[]/view_kind` | as above | as above |
| `GET /api/v1/projects/:project` | `/views/[]/bucket_configuration_mode` | as above | as above |

0029 §8 proposed a fifth vacuity cause for these. **Rejected, and rightly**:
§13's taxonomy is about a category having nothing to score, and this is not
that. The document is wrong about its own server, and 0015 already has the
policy for exactly that — "an OpenAPI document is hand-maintained and drifts
from the server", with the exclusion carrying "a recorded request/response, not
a belief".

Nothing is added to §13.

## 2. The policy was written for endpoints, and these are fields

`KnownDivergenceSchema` identifies an entry by `method` + `specPath`, and
`exclusions()` removes that endpoint from a category. Neither can name
`/[]/views/[]/view_kind`.

Excluding the whole endpoint would be far too coarse: `GET /api/v1/projects`
contributes dozens of correctly-scored fields to `response-field-presence` and
`field-type`, and removing it to fix two narrowing slots would silently move
four other categories. So `scope` becomes explicit:

- **`endpoint`** — the existing shape, unchanged.
- **`field`** — adds the response `status` and the RFC 6901 `pointer`, in the
  grader's own pointer language, and excludes exactly that slot from exactly
  that category.

Both carry the same mandatory `evidence`, and an entry without it still does not
parse. That is 0015's `NarrowingRecord` requirement and it is not relaxed for
the new scope: the observed exchange is what separates "the spec is stale" from
"infer disagrees", which 0015 says is not evidence.

## 3. The budget is in two units, and that is the whole answer

`cap = gradedEndpoints × 0.05` is 21 × 0.05 = **1.05**. Counting four *slots*
against it would trip `overCap`, whose message is a global verdict — "the ground
truth is not fit for grading" — on the strength of a comparison between four
fields and twenty-one endpoints.

That is §13's compare-like-with-like, in the budget: **an endpoint exclusion and
a slot exclusion are not the same unit, so they cannot share a denominator.**

- `endpoint`-scope entries are budgeted against **graded endpoints**, exactly as
  before. Unchanged, and this list has none.
- `field`-scope entries are budgeted against **the denominator of the category
  they exclude from** — for `narrowing`, the 9 slots of `narrowing.recall`.

Without this split the cap is not a threshold that is too tight or too loose; it
is a ratio between two different things, and moving it would not help.

### 3.1 On a 9-slot category, 5% is 0.45 — so any entry concentrates

Stated rather than left for the next reader to notice, because an unstated
threshold interaction is what makes a later entry look like tuning.

The threshold is **not** mis-dimensioned for small categories, and the rule
firing on the first entry is the correct amount of scrutiny. One exclusion in a
9-slot category removes 11% of the evidence and moves the score by 11 points. A
category that small *is* fragile, and 0015's argument applies with more force
rather than less: "a spec stale exactly where infer is weakest is describing
infer, one individually-justified entry at a time."

So the concentration signal fires here, and it firing is the policy working. It
is a **trigger for re-examination, not a hard failure** — 0015's own wording,
"re-examined before another entry lands there" — and the asymmetry with the
global cap is deliberate and preserved.

Four entries against a per-category budget of 0.45 also trips that category's
`overCap`, and its message is true as written: **this document is not fit for
grading `narrowing` on this target.** That is the finding, not an obstacle to it.

## 4. What it does to the score

Excluded slots leave numerator and denominator both, per 0015. Infer emitted no
narrowing for these four fields, and 0029 §3.1 is why that is *correct*: emitting
`["0","1","2","3"]` for a field observed returning `"list"` would be a claim the
evidence contradicts, and §7.5 forbids it. A grader that charged infer for
declining would be scoring the document.

Predicted, before running:

| | before | predicted |
|---|---|---|
| `narrowing.recall` | 0.0000 **0/9** | 0.0000 **0/5** |
| everything else | — | unchanged |

Still `0.0000`, and that is not a failure of the change. The remaining five are
`repeat_mode`, where **no integer value was observed at all** — a different
cause, now no longer averaged with this one. The value of the exclusion is that
the denominator stops claiming nine gradeable slots when four of them are not
gradeable.

## 4.1 `narrowing` reports failed for a different reason, and they must not merge

The category appears in `failedCategories`, and **not because of the
divergence.**

- `narrowing.recall` has `gate: null`. It is *reported*, never gated, and it is
  the metric the four exclusions touch. Ungated on Vikunja, which is where the
  ruling leaves it.
- `narrowing.precision` is gated `≥ 0.98 structural` and reads **vacuous 0/55**,
  because the document contains zero occurrences of the string `format` in
  368KB. Scoring 43 correct `date-time` narrowings against that silence would
  mark every one a false positive for the document's reticence.

Two different failures of one document — it says nothing about formats, and it
says something wrong about two enums — and the category line shows only the
first. Written down because the next reader will see `✗ narrowing` next to a
divergence entry and join them, and that would file a document's *silence* under
a document's *contradiction*: different causes, different fixes, and only one of
them is registered here.

**Narrowing stays ungradeable on this target until a document that agrees with
its own wire is available**, and that is the honest state. A category honestly
ungradeable is better than one graded against a server the document contradicts.

## 4.2 And a third thing about narrowing, which was the ladder's own shape

Landed at `0ea8ef6`, and it belongs beside §4.1 because it is the third
distinct reason `narrowing` has looked wrong on this target and the three keep
getting joined.

§7.5's ranking had a tier above the ranking: a "hard exclusion, regardless of
the above". `ENUM_TOKEN` sat in it, and 0034 §2.1 measured what that cost —
it excludes 161 of 273 string fields, and it runs **before** the UI-constraint
branch that §7.5's own text calls "ground truth about the domain, and the only
evidence that is". So a perfect `<select>` of `<option value="0">` could never
narrow anything, on any target, whatever the evidence.

The clearest statement of the bug is one sentence, and it is worth keeping in
this form because it is what makes the shape visible rather than the symptom:

> **Value shape was rank 3 when it argued for an enum and rank 0 when it argued
> against one.**

The same evidence, weighted differently depending on which way it pointed — and
the asymmetry was invisible to every reading of the ranking, because it was
written above the part anyone reviews. The fix is the rule now in §13: **a
condition that can veto a ranked branch is a ranked entry; if it cannot be
argued a rank, it cannot be applied.** Prose-likeness became rank 4 and may
refute nothing stronger; slug-likeness became a requirement of rank 5 alone, the
weakest positive branch, since it is the weakest positive signal.

Accepted as landed. No entry here changes; the divergence list and its budget
are unaffected.

## 5. What is frozen

The committed list is asserted as a **complete set**, not by an absence claim:
`expect(entries).toEqual([...the four])`, so a fifth cannot land without the
assertion being edited. §13's freeze rule — the weak form covers the one
spelling somebody thought of.

And the endpoint-scope list stays empty and asserted within cap, so the two
units cannot quietly borrow from each other.
