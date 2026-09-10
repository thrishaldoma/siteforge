# 0037 — What each gate cannot see

*Status: accepted. Standing audit + one §13 rule + 11 controls.*

## 1. Fifth instance, so it stops being a rule

| # | the gate | its claim | what it could not see |
|---|---|---|---|
| 1 | every filesystem check | "the source is checked" | `packages/capture`, hidden from **git** by an unanchored `.gitignore` — never committed at all |
| 2 | `lint-catch` | "every catch is classified" | 8 of its 21 catch blocks, hidden from the **filesystem** view by a bare `capture` in the ignore list |
| 3 | `pnpm sabotage`'s cleanliness check | "the tree came back byte for byte" | `dist/`, gitignored, so a sabotaged build survived a revert and two wrong scores were read off it |
| 4 | `guardContext` | "every context is guarded" | a `newContext` **option** — it attaches after construction, so four of six contexts ran without `prefers-reduced-motion` |
| 5 | build + typecheck + lint + test | "the code is checked" | whether a `.mjs` **parses**; a dropped paren passed all four |

In every one **the gate behaved correctly.** Nothing was miswritten. The claim was
broader than the coverage, and that gap is invisible from inside the gate and
from outside it, because a gate that cannot see a region reports exactly what it
reports when the region is clean.

Four rules already existed for the individual instances. A fifth means the rule
was not the problem.

## 2. The audit's own scope, stated so it is not convenient

**Not every gate has a field of view.** `assessGitignoreAnchoring(text)` is handed
one string; `assessDivergenceBudget(entries, n, denominators)` is handed its
entries. A gate whose subject *is* its parameter has no selection to get wrong,
and declaring a blind region for it would be padding — which §13 warns is what
makes the next reader stop believing the list.

So the audit is over the gates that **select their own subject**: they walk a
tree, read a directory, or scan a moment in time. Thirteen of them.

## 3. Most blind regions need a pointer, not a patch

A blind region is only a *hole* when nothing else covers it. `scripts-parse`
cannot see a TypeScript syntax error — and `tsc` can, so that region is
`coveredBy` a sibling. Naming the sibling is the whole work.

A region with `coveredBy: null` is one **nobody** covers, and that one is proved:
`provenBy` names a control in `sabotage/` that puts a real defect in the region
and asserts the gate stays **green**. That is the only way to tell *cannot see
it* from *there was nothing to see*, and it reuses the harness's existing control
kind rather than inventing a second mechanism — a generalisation of §13's rule
that every mutation table carries a perturbation which must not move the thing it
names.

`field-of-view.declarations.ts` and `scripts/sabotage.mjs` are reconciled **both
directions**, so neither list can drift from the other.

## 4. The eleven, and what writing them found

| gate | blind to | proved by |
|---|---|---|
| `lint-catch` | an `// operational:` reason that is false | `fov-false-operational-reason` |
| `lint-guarded-pages` | a page from `context.pages()` rather than `newPage()` | `fov-page-without-newpage` |
| `lint-identifiers` | a comparison compiled into a `RegExp` at runtime | `fov-runtime-built-comparison` |
| `lint-empty-admits` | `.filter(…).length === 0` — `every` in other words | `fov-empty-admits-without-every` |
| `assessScopeAgreement` | a path in neither view | `fov-untracked-and-ignored-file` |
| `scripts-parse` | anything past syntax — an unresolvable import | `fov-driver-imports-nothing` |
| `assessGraderFreeze` | `baseline/`, which it does not walk | `fov-baseline-changed-under-the-freeze` |
| `assessBuildResidue` | residue outside `dist/` | `fov-residue-outside-dist` |
| `scanCaptureTree` | a file written after the scan line | `fov-artifact-written-after-the-scan` |
| `evaluateCoverage` | an extraction with no invariant | `fov-extraction-with-no-invariant` |
| `assessCaptureIdempotence` | an `EXEMPT` entry hiding a real difference | `fov-exemption-hides-a-real-difference` |

**Four of the eleven declarations were wrong, and the controls found it.**

- `lint-identifiers` **does** catch `path.slice(0, built.length) === built`. My
  declaration said a source grammar could not see a runtime-built comparison; it
  sees more than I claimed, and the region had to be narrowed to a `RegExp`
  compiled from a variable.
- Three patches tripped a *different* gate than the one under test — `startsWith`
  in the `lint-empty-admits` patch woke `lint-identifiers`, and the
  `assessBuildResidue` patch edited a **grader-frozen** file, so the freeze fired
  instead.

None of that was visible in prose. Every one of the four read as a correct
declaration until a patch was written against it, which is the argument for the
expense: a blind region asserted and never tested is the same kind of claim as a
gate nobody watched fire.

## 5. Open

- `scanCaptureTree`'s region is the one that matters most and the one this
  turn only *pinned*: §3.4 is the gate whose failure is a leaked credential
  rather than a bad score, and "the scan is last" remains an ordering in a
  1700-line driver rather than a property anything enforces. The control proves
  the hole is real; closing it is a restructuring.
- `evaluateCoverage`'s region is by design — §6 says the invariant list is meant
  to grow one silent drop at a time — so its control pins a *policy*, not a
  defect. Recorded that way rather than filed as debt.
