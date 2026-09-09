# 0030 — Binding an unnamed control, and the mechanism §7.6 shares with it

*Status: design, declared before implementation. Nothing here is built yet.*

## 1. What has to be bound, and to what

Two problems in this repository have the same shape and different targets.

| | the control | the target | where it lands |
|---|---|---|---|
| **§7.6** | one capture never fired (`flows/skipped-controls.json`, 80 entries) | a **URL** | an endpoint with `discovery: bound-from-control`, `responses: []` |
| **this** | one capture *saw* but cannot key (6 unnamed `<select>`s) | an API **field** | `NarrowingRecord.uiConstraint` on that field |

Calling that "one mechanism" is only true if it is written as one. A shared
docstring over two implementations is what §13's schema-drift rule is about, and
the two `collectUiConstraints` copies in `capture-site.mjs` and `rung3.mjs` are
the same failure one level down — both carried the same wrong guard, so fixing
one would have left the other.

So the shared thing is a record, not a function:

```
ControlBinding {
  controlId                        // the control, either way
  target: { kind: 'url', … }       // §7.6
        | { kind: 'field', … }     // this
  evidence: BindingEvidence[]      // ranked, and every rung that fired is kept
  rank: the strongest rung present
  gapId                            // review-required, like every narrowing
}
```

Ranked evidence with *every* rung recorded rather than the winner alone, because
that is what `NarrowingRecord` does and for the same reason: a derived field
carries the evidence it was derived from, and "rank 2 agreed with rank 4" is a
different claim from "rank 2 fired".

## 2. The ranking, declared before anything is measured

The ruling's order, with one column the ruling did not ask for and which turns
out to matter more than the order does: **whether the rung can run at all today.**

| # | evidence | strength | runnable today? |
|---|---|---|---|
| 1 | drive the control, observe the request it causes | direct — it is the API telling us | **no.** Two separate reasons, §2.1 |
| 2 | option values overlap values observed in a request field | strong, and value-based | **yes** — §2.2 |
| 3 | accessible name or label text matches a field name | weak; a name comparison | yes |
| 4 | DOM proximity to a labelled form region | weakest; positional | yes |

### 2.1 Rank 1 cannot run, and saying so is the point

The ruling anticipated the coverage ceiling — "the controls most worth binding
may be the ones we can't drive". True, and it is the *second* obstacle. The
first is that **the probe vocabulary has no verb but `click`.** Selecting an
option is `selectOption`, and no such step exists. In §13's taxonomy that is
**unimplemented stage**, not driver limitation: the artifact is full, the code
path does not exist.

Then the ceiling: 71 of 128 driven controls would not resolve, and the six
`<select>`s all live on `user-settings-general`, the route with 668 candidates
and a 20-attempt budget.

Recording it this way is the discipline the manifest audit (0031) exists to
enforce, applied before the fact: **a ranking whose primary rung cannot run and
does not say so is a claim with nothing behind it.** Rank 1 is declared-for-later
with the reason, not silently at the top of a list.

### 2.2 Rank 2 is the one to build, and the mechanism already exists

`classifyStringField` matches path parameters **by value, not by name**, because
path normalisation collapses every id segment to the literal `:id` so a name
comparison tests against a constant. Rank 2 is that same test against a different
population: the option values a control offers, against the values observed in a
request field.

`observedKeyValues` (0027) is the beginning of that population. It is currently
primary-key fields only, deliberately, and widening it is a separate decision —
not one to make as a side effect of this.

Rank 2 is also the rung that cannot be satisfied by coincidence in the way ranks
3 and 4 can. A name match is a string agreeing with a string; a value overlap is
the control offering something the API was seen to receive.

## 3. What extraction already delivers, and what it does not

0029 landed the extraction. The capture now records **6 selects of 6**, and
`uiConstraintsBindable` reads **0**: the index is keyed by field name, and none
of the six has one.

That gap — `uiConstraintSelects − uiConstraintsBindable` — is the size of this
problem, measured, in `coverage.json`, on every run. It is deliberately *not* an
invariant: asserting it would be asserting that a target names its form controls,
which is not ours to require.

The option values themselves need no new artifact. `dom.json` holds every
`<select>` and its `<option>` children already, so binding reads what is on
disk rather than requiring a re-crawl. **No unread evidence file is being
written for a future stage** — that is precisely the mistake 0031 documents.

## 4. What this must not do

- **Not widen the narrowing ladder as a side effect.** A binding produces
  `uiConstraint` evidence; the ladder decides. §7.5's exclusions run first and
  keep running first.
- **Not let a rank-3 name match narrow a type.** §7.5 ranks UI constraint above
  cardinality *because it is ground truth*, and "a control is called `mode` and
  so is a field" is not ground truth about a domain. Ranks 3 and 4 are for
  review-required gaps and for corroborating rank 2, never for a narrowing on
  their own.
- **Not score against the truth document while designing.** 0029 §3.1 is the
  standing reason: for the fields this project can currently reach, the document
  and the wire disagree, so tuning a binding rule until a metric moves would be
  tuning toward a contradiction.

## 5. Prediction, for when it is built

On this target, rank 2 binds **nothing**: the six selects are on
`user-settings-general`, whose settings PATCH carries `language`, `week_start`,
`timezone` and `default_project_id`, and none of the three fields in the
narrowing denominator (0029 §2) is among them. So the honest expected outcome of
implementing binding here is `uiConstraintsBindable` rising above zero while
**every graded metric stays exactly where it is.**

Written down now, before the work, for §13's reason: a null result and a change
that did not reach the measurement report identically, and only a prediction
made in advance tells them apart.
