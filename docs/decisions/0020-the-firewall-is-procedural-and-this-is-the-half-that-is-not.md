# 0020 — The grader/infer firewall is procedural, and this is the half that is not

**Status:** accepted
**Date:** 2026-09-09
**Context:** 0015 §0 (step order), 0018 (pure gates and the grader)

## The instruction

> Do not read the grader's source while writing infer, and do not let a
> category's definition shape an inference strategy — that's fitting to the
> metric.

0015 §0 ordered the steps for exactly this: the grader is written against the
contract and the truth sides only, before infer exists, so that a score means
something when it finally arrives. A category whose definition shaped the
strategy that scores on it measures the strategy against itself.

## What this decision records

**The firewall is procedural, and this session weakens it.** The same author
wrote the grader an hour before infer starts. "Do not read it" is not a property
of the repository at that point; it is a property of a person's discipline over
one working session, and it cannot be re-established by anyone later. Every
score infer ever produces against this grader carries that caveat, and it is
recorded here rather than in a turn's prose so it survives the turn.

Two things follow, and only the first is achievable now.

**The mechanical half is enforced.** `packages/infer` may not import
`@siteforge/verify`, nor declare it a dependency —
`assessGraderFirewall` in `packages/shared/src/repo-hygiene.ts`, asserted
against the real package and driven to fail against a synthetic one, with
`sabotage/infer-reads-the-grader.patch` reintroducing the defect. It is a prefix
test, not equality: `@siteforge/verify/dist/grade/grade.js` is the same reach
spelled around a whole-name check. This closes the path by which a definition
reaches infer as *code* — a threshold read off the contract, a denominator
recomputed, a matcher reused. It closes nothing that goes through memory.

**The structural half is a target nobody has scored against.** The firewall is
only really tested when this grader meets an inference pass written without
knowledge of it — a second ground truth, or a second author. Until then the
number is evidence about the grader and weak evidence about infer, and a
category that scores unexpectedly well is the first place to look.

## Rejected

*Assert the grader's source is unread.* There is nothing to read it from. A
`git log` timestamp shows when a file was written, never who held it in mind.
Writing a check that cannot fail is the first vacuity mode and would make the
firewall look enforced.

*Weaken it to "infer may import the contract, not the grader".* The contract is
where the thresholds and denominators live. It is the more dangerous of the two.
