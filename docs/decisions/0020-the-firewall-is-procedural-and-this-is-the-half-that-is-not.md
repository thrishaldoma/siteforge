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

**The grader is pinned, and moving it is a decision.** Added after the fact, and
it is the second checkable half. `packages/verify/src/grade/freeze.ts` holds a
sha256 per metric-side file — `grade.ts`, `match.ts`, `fields.ts`,
`vocabulary.ts`, `grade-contract.ts` — taken at `d842a31`, the last commit
before infer started. A change to any of them fails the suite with one
instruction: say why here, in the same commit. *It did not move* is verifiable
where *I did not read it* is not, and the failure the pin actually guards is
narrow and real — a threshold nudged while a score is being watched is
indistinguishable, afterwards, from a threshold that was always there.
`sabotage/grader-moved-after-the-freeze.patch` is that edit: narrowing
precision 0.98 → 0.9, one character, green run.

The pin is asserted as a complete set in both directions, because a new scoring
module added beside the frozen ones is as much a hole as a frozen one changing.
**And that second direction was unreachable when it was written.**
`readFrozenFiles` derived its keys from `FROZEN_FILES`, so the files it found
were a subset of the files pinned by construction and the unpinned-module branch
could only be entered by a test handing it a synthetic key — the
unreachable-state vacuity mode, in the gate written to close a hole, exactly the
shape §13 says to audit for. It now **enumerates** `packages/verify/src/grade/`
and hashes what is there, so a `thresholds.ts` dropped into that directory
tomorrow fails the suite; verified by dropping one in and watching it fail.
Enumeration alone would only relocate the silence, so exclusions are explicit
too: `NOT_FROZEN` names `freeze.ts` (pinning the pin makes every legitimate
update a two-step edit against its own hash) and `mutations.ts` (a check *on*
the metric side, computing no score), each with its reason, and a stale
exclusion — one naming a file that is gone — is itself a failure, because it
would silently excuse whatever next takes that path. What makes an exclusion
safe is structural rather than promised: a test asserts no frozen file imports
an excused one, so an excused file cannot reach a number.

**The truth side is deliberately outside the pin.** `truth/swagger2.ts` and the
per-target sources encode what a document *says*, not what counts as a good
score, and they change whenever a target is added — Vikunja's adoption rewrote
that file the same week this pin was taken. A freeze that breaks on ordinary
additive work teaches people to bump it without reading, which is worse than no
freeze. Stated here rather than assumed, because a carve-out that removes files
from a check is the shape of weakening it, and the thing that distinguishes this
one has to be checkable: `freeze.test.ts` asserts no `/truth/` file is in the
set. One seam is named and not closed — `pathShape` lives in `truth/swagger2.ts`
and `match.ts` imports it, so a definition affecting endpoint identity sits
outside the pin. Moving it would be a change to the grader made for the
freeze's convenience, which is the wrong way round.

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
