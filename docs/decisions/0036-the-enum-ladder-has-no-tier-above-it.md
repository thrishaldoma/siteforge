# 0036 — The enum ladder has no tier above it

*Status: accepted, and **written after the fact**. The decision was made, the
code landed and CLAUDE.md §7.5 was rewritten around it; this document was
never created. It is reconstructed here from the code and the rule, because
two source files cite `0036` and the citation pointed at nothing. See §4.*

---

## 1. The defect

§7.5 ranks the evidence for and against narrowing a field to an enum. Above
that ranking sat a separate block — a shape heuristic applied as a **hard
exclusion, regardless of the above**: a value that did not look slug-like
could not be an enum, whatever the ranked evidence said.

Rank 2 of the ladder is *UI constraint → enum*: a `<select>`, a radio group
or a fixed filter set in the captured DOM whose option values cover the
field's values. That is the only ground truth about the domain the crawl can
have — we captured the UI that drives the API.

So the hard exclusion **vetoed the ladder's own primary evidence**, and it did
so for the life of the project. `<option value="0">` is a domain of numeric
codes; the shape heuristic read it as "not slug-like" and declined.

## 2. Why nobody saw it

The veto was **above the part anyone reviews.** A reader checking whether the
ranking was right read the ranking. The tier that could overrule it was in a
different block, phrased as a precondition rather than as evidence, and
nothing in a reading of ranks 1–5 could reveal that rank 2 was unreachable
for a whole class of fields.

This is the same shape as a gate whose claim is broader than its coverage
(§13): the artefact behaves exactly as it reads, and the thing that is wrong
is what is *not* in view.

## 3. The ruling

**A condition that can veto a ranked branch is a ranked entry; if it cannot
be argued a rank, it cannot be applied.**

One ranking, and nothing sits above it. Evidence that refutes an enum is
ranked alongside evidence that supports one, in the same list, and the first
entry that fires decides. Concretely:

- Slug-likeness survives, at **rank 5 and only there**. It is the weakest
  positive signal, so it may support the weakest positive branch and may not
  refute a stronger one.
- The prose-shaped refutation is **rank 4**, and it tests for *prose* and
  nothing wider. "Not slug-like" is rank 5's concern, and using its negation
  at rank 4 is exactly how a shape heuristic came to outrank ground truth.
- Rank 2 is explicitly marked **above ranks 3 and 4**, so the precedence is
  in the ladder rather than in a reader's memory.

The rule is now in CLAUDE.md §7.5, and `narrowing.test.ts` asserts it under
the heading that cites this decision.

## 4. Why this document is dated after the code

The numbering audit found `docs/decisions/` skipping 0036 and 0042 with no
withdrawal note, and both numbers cited from source. Neither file was ever
created and neither was ever deleted — so this is not a withdrawal. **The
decision was made, the code landed, the record was never assembled**, which
is [[0047]]'s shape one level up: a producer ran and the artifact nobody
writes is the one a reader was told to go and read.

A citation pointing at nothing is worse than no citation, because it reads as
a pointer to reasoning that can be checked. `assessDecisionCitations` now
fails a cited decision with no document behind it, and it caught a third one
on its first run — a `0047` reference written an hour before the document
existed.
