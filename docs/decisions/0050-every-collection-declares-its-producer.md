# 0050 — Every collection declares its producer, and the surface is smaller than 0045 said

*Status: accepted. The empty-array class becomes one structural gate, and
0045's leaf count is corrected — it does not reproduce.*

---

## 1. Three declared rows fix three collections

[[0047]]'s sweep found `fonts`, `assets` and `behaviours` assembled as a
hardcoded `[]` while the capture held 70 font descriptors, 46 assets and 122
flow traces. It recorded them as three declared rows.

**That fixes three collections and nothing else.** A collection added to
`SiteModel` tomorrow arrives undeclared and unexamined — which is exactly how
these three arrived. So the gate is driven from **the schema's own list of
collections**: `collectionsOf(SiteModelSchema)` returns every array-valued
member, every one must carry a declaration of its producer and its input, and
one that does not fails.

`collectionsOf` **throws** rather than returning `[]` when it cannot read the
shape. A gate that silently reads no collections reports exactly what it
reports when every collection is declared.

The input counts above are read live from `coverage.json` at grade time, not
stored. One of them is a **draw**: `flows` is
`coverage.extracted.controlsFired`, written by the probe pass, and it read
113 and then 114 within a single turn on an unchanged capture. The gate only
ever asks whether it is **non-zero**, which is a property the draw has in
every run; the tests use synthetic counts for the same reason, since a test
pinning 114 would fail on the next crawl for a reason about the target
(§13: a number from a non-deterministic pass is reported with its spread or
with its run, never as a bare figure).

| collection | producer | input | assembles |
|---|---|---|---|
| `fonts` | *nothing — a literal `[]`* | `fonts` 70 | **no** |
| `assets` | *nothing — a literal `[]`* | `assets` 46 | **no** |
| `behaviours` | *nothing — a literal `[]`* | `flows` **114 — a draw** | **no** |
| `components` | `inferComponents` | **uncounted** | no |
| `layouts` | `inferLayout` | uncounted | yes |
| `routes` | `routeTemplates` | `endpoints` 21 | yes |
| `entities` | `inferEntities` | `endpoints` 21 | yes |
| `operations` | `observedOperations` + `bindSkippedControls` | `endpoints` 21 | yes |

Five verdicts, each a way a declaration goes quietly wrong: an **undeclared**
collection; a **stale** declaration for a part the schema dropped; a declared
gap that has **started assembling**; a gap declared against an **input that is
also empty** (a target or driver limitation, filed in the wrong place); and a
collection declared as assembling that has **gone empty**.

### 1.1 An uncounted input is declared, never guessed

`components` has no `coverage.json` counter — nothing counts repeated DOM
subtrees. `input: null` says so, and a `null` input requires a reason, so the
blind spot cannot be silent. The first wiring guessed `interactionCandidates`
(2085) and the gate immediately reported `inferComponents` — a producer that
*runs* — as an artifact nobody assembles. §13: an unmeasured limitation
cannot be ranked, and inventing the measurement is worse than declaring the
blind spot.

### 1.2 The scope exclusion is in the gate

A stage nobody built is not a producer without a consumer. `codegen`,
`envkit` and `cli` are three-line scaffolds, so `tokens.json`,
`verify/history.jsonl` and the control plane are stages that do not exist
rather than instances of this defect. `SCAFFOLD_STAGES` names them in code
and a declaration naming one is exempt from the empty check.

**The exemption is checked rather than trusted.** A collection declared as
produced by a scaffold that turns out to carry entries fails
(`scaffold-is-producing`) — because then it is not a scaffold, and the
exemption has outlived its reason. An exemption nobody can revoke is how a
scope exclusion becomes a permanent hole.

---

## 2. 0045's leaf count does not reproduce

0045 §1 said `SiteModel` has **421 leaves**, of which **384** are claimed by a
consumer and **267** consumed and never scored. That was load-bearing: it is
the whole "unchecked surface" argument for option 1.

**Re-measured with the instrument 0045 names** — `assessModelCoverage`, which
resolves `MODEL_NEEDS` against `schemaLeafPaths`:

| | 0045 said | measured now |
|---|---|---|
| total leaves | 421 | **318** |
| claimed by a consumer | 384 | **290** |
| claimed by a scored category | 139 | **96** |
| **consumed and never scored** | **267** | **207** |

**How 421 was produced is not recoverable, and that is the point.** Nothing
pinned it: `site-model.test.ts` asserted only `leaves.length > 100`, which a
count falling from 421 to 318 satisfies the whole way down. So a miscount and
a drift are indistinguishable from here, and no reconstruction is offered
rather than a plausible one being invented. What can be said: this turn
*added* leaves (`MapRecord`'s six), so the schema has not shrunk, and the
original figure was therefore too high when it was written.

**Pinned now**, as an exact triple, so the next reader inherits a number
something checks — and a floor is what failed here, because a floor cannot
catch a count that moves downward.

### 2.1 And a third of what is left describes a surface that is not produced

The ruling's point, measured. Of the 207 consumed-and-never-scored leaves,
**66 sit under a collection the model produces nothing for**:

```
components 35 · behaviours 18 · fonts 7 · assets 6
```

So the honest split is:

| | leaves |
|---|---|
| consumed, produced, **never scored** | **141** |
| consumed and **never produced at all** | **66** |

### 2.2 This strengthens option 1, and sharpens it

The ruling expected strengthening rather than overturning, and that is what
the measurement says — but the argument is now two arguments rather than one,
which is better than a bigger number:

- **141 leaves are produced by infer, read by a consumer, and checked by
  nothing.** That is the deferral question's real subject, and it is still
  roughly two thirds of the scored-plus-unscored produced surface. Deferring a
  category leaves part of the model nothing has ever checked — the cost 0045
  named, and it survives the correction.
- **66 leaves are not a grading problem at all.** They describe collections
  that do not exist in any model infer has ever produced, so no gate could
  have scored them and adding a category would score nothing. They are §1's
  own machinery, now covered by the gate in §1 rather than by M2's.

Conflating the two is what made 267 read as a single unchecked surface. It
was never one: two thirds of it is ungraded output, one third is absent
output, and only the first is an argument about grading.

---

## 3. What did not change

Option 1 stands. The gate over the gradeable subset, the deferral classes,
and the standing condition that a second target remains the only source of
narrowing's truth side are all unaffected — none of them rested on the
magnitude of the number, only on its being large, and 141 is large.
