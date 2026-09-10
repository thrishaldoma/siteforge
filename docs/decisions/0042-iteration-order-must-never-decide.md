# 0042 — Iteration order must never decide, within a rule as well as between rules

*Status: accepted, and **written after the fact**. Eight source sites cite
`0042`; the document was never created. Reconstructed from the code and the
rule — see §5, and [[0036]], which has the same history.*

---

## 1. The defect

§7.6 binds a control capture never fired to a URL by static analysis, using a
ranked ladder of evidence. Ranking fixes precedence **between** rungs. It says
nothing about **one rung matching two candidates**.

Rank 5 — "a path-like `data-*` attribute" — shipped taking the first match
from `Object.entries`. So on a control carrying two path-like `data-*`
attributes, **property enumeration order picked the binding.**

That is the same unreviewable-by-construction defect the duplicate-rank check
exists to prevent, one level down, introduced in the same turn that
implemented the rule against it.

## 2. Why a per-rule fix was refused

The obvious repair is to give rank 5 a tiebreak. That leaves every other rung
free to acquire the same defect, and leaves the next rung author to remember
a rule that is written down nowhere in the code they are editing.

**So the fix is structural: a rule cannot pick, because it never holds the
choice.** A rule reports *every* match. The evaluator resolves:

| matches | outcome |
|---|---|
| one | binds |
| several, with a **declared** tiebreak | binds by it, and records that one was applied |
| several, no tiebreak | **ambiguous decline** — reported, never resolved by picking the better one |
| none | the rule did not fire |

The ambiguous decline is 0015 §2's settled shape: an ambiguity is reported,
never resolved by preferring one side.

## 3. Three refusals, each a way the fix could have leaked

Written as hard failures rather than conventions, because each is a route
back to array order that would look like a working tiebreak:

1. **A tiebreak with no declared reason throws.** An undeclared tiebreak
   cannot be told from taking the first, so it is not a tiebreak.
2. **A tiebreak returning `0` declines** rather than falling back to array
   order. A comparator that ties has not decided, and treating a tie as a
   decision is precisely the defect.
3. **An empty match set throws** rather than recording the rule as having
   fired. A rule that matched nothing did not fire, and a fired-with-nothing
   record is a claim no observation supports.

## 4. The same rule applies to the apparatus

`assessSemanticEdit` **fails** when a sabotage's anchor matches twice, instead
of editing the first. A harness that silently edits the first of two matches
is the same defect in the tool that proves the gates work — and it would be
invisible, because the patch would still apply and the gate would still fail.

`probe-contamination.ts` carries the rule for the same reason: the drift
direction is a property of the loop's order, so verdict precedence is
declared rather than left to whichever branch is evaluated first.

## 5. Why this document is dated after the code

See [[0036]] §4. The numbering audit found 0036 and 0042 missing with no
withdrawal note and both cited from source — 0042 from `binding.ts`,
`control-binding.ts`, `semantic-edit.ts`, `probe-contamination.ts` and their
tests, eight sites in all. The decision was made, the code landed, the record
was never assembled. `assessDecisionCitations` now fails a cited decision
with no document behind it.
