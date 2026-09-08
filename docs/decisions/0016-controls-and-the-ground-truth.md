# 0016 — Every mutation harness gets a control, and the ground truth arrives

Status: accepted

Two things, and the second found something the first was written to catch.

## 1. A harness of all-drops proves nothing about isolation

0015 §8's mutation table needed a **negative** row — renaming a path parameter
must move `path-param-naming` and leave `endpoint-identity` exactly where it
was — because a grader that drops every score on any change passes a table made
entirely of drops while measuring nothing.

That is not local to the grader. It is the mirror image of the vacuous
invariant this repo keeps finding: one never fires, the other always does, and
**both read as green**. So §13 now carries it as a standing rule for every
mutation harness, and the existing ones were audited against it.

### The audit, mechanically

`grep -rln 'sabotage\|reintroduc\|perturb'` over `packages/` and `scripts/`,
rather than a list from memory — finding things by deliberately looking is the
habit that does not scale, and it is the same argument that produced
`lint:identifiers`.

| harness | perturbs | negative case |
|---|---|---|
| `scripts/sabotage.mjs` | source, by committed patch | **added** — two controls |
| `packages/schema/src/coverage-sabotage.test.ts` | extraction counts | **added** — each drop fails alone |
| `packages/capture/scripts/rungs.test.mjs` | rung count tables | **added** — a count no rule names moves nothing |
| `packages/shared/src/secret-scan.test.ts` | planted credentials | already had two |
| `packages/shared/src/lint-catch.test.ts` | source fixtures | already had one |
| `packages/shared/src/lint-guarded-pages.test.ts` | source fixtures | already had one |
| `packages/shared/src/lint-identifiers.test.ts` | source fixtures | already had one |
| `packages/verify/src/grade/truth/gitea.test.ts` | snapshot + paths | **written with two** |

### The controls in `sabotage.mjs`

An entry is now `kind: 'defect'` or `kind: 'control'`. A control names the
defect it pairs with, changes the same code, preserves its meaning, and the gate
must stay **green**. The harness refuses to run with none declared.

Two, not eight. The marginal control is worth much less than the first, and
every patch is one more thing that rots — the failure mode this harness already
treats as a hard error.

- `secret-gate-exemption-respelled` — `matchPath(rel, P)` written as
  `matchesAnyPath(rel, [P])`, on the exact line `secret-gate-path-suffix`
  rewrites. Identical anchoring, different call.
- `walker-ignore-anchored-addition` — a fifth, correctly anchored ignore
  pattern in the array `walker-unanchored-ignore` un-anchors.

Both had to be changes the gate **could plausibly have keyed on**: a test
pinning the literal `SOURCE_IGNORE` array, or the literal text of the exemption,
would catch the defect for the wrong reason and be unreadable as different.
Renaming a local or reflowing whitespace is the vacuous spelling of a control —
it demonstrates only that the gate is not deranged.

### It caught something on its first execution

The isolation assertion added to `coverage-sabotage.test.ts` — each drop must
leave every *other* invariant holding — failed immediately on
`xhr-implies-endpoints`. The sabotage set `endpoints: 0` while leaving
`endpointsWithAuthEvidence: 3`, which is a capture no run can produce: three
endpoints carrying auth evidence in a capture with no endpoints. It also broke
`credentialed-traffic-implies-auth-evidence`, and that second failure was the
tell.

§13 already says *the sabotage must reproduce the actual defect*. This was a
sabotage reproducing an impossible one, and it had been green for as long as it
had existed. A rule added for isolation found a faithfulness bug, which is the
argument for adding rules to tables rather than to memories.

## 2. Step 1 of 0015's sequence: the ground truth is real now

`packages/verify/fixtures/gitea/`, from a container pinned by image digest.
The open item — "the spec path is stated from documentation, not from a fetch" —
is closed, and closing it turned up two things.

**The staleness gate needs no normalisation.** Two containers at the same
digest, different ports, different `ROOT_URL`s, served **byte-identical**
documents: 15 768 leaves, zero differing. So the comparison is a sha256 of the
whole file, `volatileFields` is empty, and a test asserts it stays empty. The
predicted failure mode — a gate that fails because the port moved and reads as
"the spec changed" — does not exist here, and it was cheaper to measure than to
argue about.

**The document has no per-endpoint auth, and that rewrote 0015 §4.** One global
`security` block, seven schemes, and not one of 482 operations overriding it.
`GET /version` and `GET /user` are structurally identical in the document; the
server answers 200 and 401. Thirteen of the fifty zero-parameter GETs answer
anonymously against a document that says every one needs a token.

Grading `requiresAuth` against *declared* auth fails three ways: the over-gate
denominator is zero and §6 scores that vacuous; forced through, it marks infer
wrong for correctly observing a public read; and the known-divergence list would
absorb 26% of one category against a 5% total cap.

That last one is worth sitting with. **Amendment 1 fired on its first contact
with real data** — the per-category rule was ruled in this round precisely so
that exclusions could not be produced in response to a bad score, and the very
first look at the ground truth produced the concentration it describes. Had the
rule not existed, thirteen individually-justified entries would have been the
obvious fix.

So the auth truth side is **measured**: an anonymous sweep against the pinned
container, committed beside the spec, each entry carrying the status it
observed. A different code path from capture's anonymous re-issue, because §13's
rule about an invariant's observed side applies to a grader's truth side
identically. And it fails closed by category: **404 is `required`, never
"absent"** — Gitea answers 404 rather than 403 for resources it will not confirm
exist, so reading 404 as "not a real endpoint" would delete a gated endpoint
from the truth set and turn a correct inference into a hallucination. A default
chosen in one category producing a wrong answer in another is the exact shape
§13 already names.

## 3. Step 2: the contract, committed before the model

`packages/schema/src/grade-contract.ts`. Ten categories, seventeen metrics, each
naming its denominator in prose because three bare rates get averaged by the
next reader.

The freeze is mechanical rather than remembered: `GRADE_CONTRACT_DIGEST` is a
committed constant a test recomputes, so moving a threshold moves two lines in
one commit. It is not tamper-proof and is not meant to be; it is un-quiet.

Independence is mechanical too. The module's **entire** import list is asserted
to be `['node:crypto', 'zod']` — asserting the absence of `site-model.js` would
only cover the direct edge, and there is no local edge at all to follow.

It lives in `packages/schema` rather than beside the grader because §7.1's stage
report has to be validated against it, and turn 2's ruling forbids duplicating a
derived value across two artifacts. Infer's first stage report carries the
category list and no scores; the schema recomputes the list, so a report that
restates it and drops one does not parse.

## Open

- The anonymous sweep covers the 50 zero-parameter GETs. The other 432
  operations are `unobserved` and counted as such. Parameterised endpoints need
  a deterministically seeded container — fixed user, repo, issue, created
  through the API — and that script is milestone-gate work.
- `/signing-key.gpg` and `/signing-key.pub` answer 404 on an unconfigured
  instance. Safe under the rule above, but whether a documented path the server
  does not serve is a spec divergence or a configuration difference needs the
  seeded container to tell apart.
- `identifier`'s truth side is not derived; the loader names it, so the category
  fails as unbuilt rather than as infer's miss.
- The two controls cover two of eleven defects. Whether the other nine need one
  is a judgement about which gates could plausibly key on a diff, and it was
  made once, here.
