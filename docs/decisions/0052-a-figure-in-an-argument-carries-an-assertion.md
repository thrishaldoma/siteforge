# 0052 — A figure in an argument carries an assertion that fails when it moves

*Status: accepted. The sweep the ruling asked for, and its result is narrower
and more useful than expected.*

[[0050]] found that 0045's **421 leaves / 384 consumed / 267 unscored** — the
whole basis of an approved M2-scope argument — did not reproduce. The
instrument says 318 / 290 / 207. The only assertion behind the original was
`expect(coverage.leaves.length).toBeGreaterThan(100)`, which a count falling
from 421 to 318 satisfies the whole way down.

The ruling: sweep the record for other figures cited in decisions and gated
only by a floor or by nothing.

---

## 1. The sweep

Every decision document, scanned for load-bearing-shaped figures — bolded
counts and `N of M` constructions — cross-referenced against **assertion
sites** in the repository (`toBe`, `toEqual`, `toHaveLength`, and expected
object literals). A number appearing in a comment is prose, not a gate, so
mentions do not count.

**41 figures. 9 carry an assertion. 32 do not.**

But the 32 are not 32 instances of the same defect, and that is the finding.

## 2. Two classes, and only one of them is pinnable

| class | what it is | can it be pinned? |
|---|---|---|
| **schema-derived** | a property of code committed in this repository — leaf counts, claim joins, table sizes | **yes, exactly** |
| **fixture-derived** | a property of a captured instance — endpoints, fields, controls, flows | **no** |

Every unpinned figure in the sweep is fixture-derived. Sampled:

```
0015  15 768 leaves       Gitea's OpenAPI document
0018  396                 claims a Gitea document declares
0028  244                 re-issues in one crawl
0029  273 of 324          string nodes carrying an observed value
0033  161 of 273          string fields a filter excludes
0044  113                 completed flows in one run
0046  307                 false positives from one endpoint
```

None of these can be an equality in a test, because the thing they describe
is not in the repository. Worse, they are not even stable: **[[0051]] changed
the seed this turn**, so `0046`'s 307 and `0048`'s 126 now describe an
instance that no longer exists.

**So the only pinnable class is the schema-derived one — and it is exactly
the class that drifted.** 421 was the single figure in the sweep that both
could have been asserted and was not. It is pinned now, as an exact triple.

### 2.1 What governs the other class is already written down

§13: *a number drawn from a non-deterministic pass is reported with its
spread, or with the run that produced it — never as a bare figure.* The
fixture-derived figures are that rule's subject, and the rule is right. What
the sweep found is that the documents were not applying it consistently:
0046 through 0049 quote capture-derived counts with no statement of which
instance they describe.

Fixed by marking them rather than by recomputing them. **The figures are not
reconstructed**, per the ruling — they were correct about the instance they
measured, and inventing a present-day equivalent would replace a true
statement about the past with a guess.

## 3. The rule

> **A figure used in an argument carries an assertion that fails when it
> moves — or names the fixture it describes.**
>
> Schema-derived: an exact assertion, never a floor. A floor cannot catch a
> count that moves *downward*, which is how 421 survived.
>
> Fixture-derived: the capture, run or pinned instance it was measured
> against, stated with it. It cannot be pinned and must not pretend to be.

The failure mode the rule prevents is specific: a figure quoted in a document
becomes a fact by being read, and the further it travels from the run the
more it looks like a property of the system rather than of one measurement.
0045's 421 travelled two documents and an approval.

## 4. What was done

- **Pinned**: the leaf triple (318 / 290 / 207) plus its 141/66 split, as an
  exact equality in `site-model.test.ts`. Done in [[0050]].
- **Marked**: 0046 through 0049 now state the instance their figures describe
  and that [[0051]] superseded it.
- **Left alone**: every historical fixture-derived figure. They are
  unreproducible by construction and are recorded as such rather than
  reconstructed.
