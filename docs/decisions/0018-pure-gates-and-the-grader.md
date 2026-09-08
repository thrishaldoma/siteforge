# 0018 — Pure gates, and the grader they made testable

Status: accepted

Two rulings, and they turn out to be one thing. **Every gate takes its inputs as
parameters, with the real run as one caller.** Then the grader — the first gate
in this repo written *before* the stage it measures — is a pure function of a
model, a truth and an observed endpoint list, so its mutation harness is not a
git patch but a different argument.

---

## 1. A gate nobody can prove fires

This repo has now named three vacuity modes: an invariant that never fires, one
that fires on everything, and one whose input no real run can reach. They share
a root, and the root is not about invariants:

> **A gate that can only be run against the input it passes on is a gate nobody
> can prove fires.**

Never-fires, fires-on-everything and unreachable-input are three ways of not
knowing, and the fix for all three is the same: separate the judgement from the
wiring, so the judgement can be handed an input that breaks it.

### What the audit found

Most of the repo was already in this shape — `lintCatches(file, text)`,
`scanText(rel, text, literals)`, `COVERAGE_INVARIANTS[].holds(o, e)`,
`assessDivergenceBudget`, `assessClaims`. Five were not.

| gate | was | now | driven to a **failing** verdict by |
|---|---|---|---|
| scan non-vacuity (`minFiles`, `mustReach`) | inside `walkFiles`, reachable only through a real directory tree | `assessScanCoverage(paths, expect, where)` | `scan-walker.test.ts` — a path list, and a prefix that is not a path |
| `.gitignore` anchoring | inline in a test, input = this repo's `.gitignore` | `assessGitignoreAnchoring(text)` | `repo-hygiene.test.ts` — `capture/`, and a negation judged on what follows the `!` |
| workspace packages tracked | inline in a test, input = this repo's git | `assessTrackedPackages(entries)` | a package with zero tracked files; a package with files whose manifest is ignored |
| sabotage table well-formedness (6 checks) | inline in `main()`, input = the real table | `assessSabotageTable(entries, patchIds)` | `sabotage-table.test.ts` — no controls, unpaired control, control naming a control, orphan patch, missing note |
| **snapshot staleness** | inline in `main()`, **downstream of a Docker boot** | `assessSnapshot({served, committedSpec, committedPin, servedProbe, committedProbe})` | `snapshot-staleness.test.ts` — each of its three findings, offline |
| Gitea truth floors | inside `loadGiteaTruth`, reached by copying a fixture tree | `buildGiteaTruth(snapshot)` | a one-operation document handed straight in |

The staleness gate is the one that mattered. It protects the ground truth
everything downstream is scored against, and until this turn it **could not be
run at all** without Docker — so it had never once executed, let alone failed.
An inverted comparison in it would have read exactly like a working one. It now
has seven tests and reports all three findings at once rather than the first.

**The rule is not satisfied by a signature change.** The audit table's last
column is the deliverable: a converted gate with no test driving it to a
*failure* is a refactor recorded as a gate. §13 says so now.

Two things deliberately did **not** change:

- **The truth floors still throw.** §6 draws a line and pure-ness must not erase
  it: *category* vacuity is a scored outcome, because a denominator nobody
  exercised is information. A truth that did not load is not — every number
  computed from it would be about the empty set, so the run stops. "Pure" means
  the input arrives as a parameter, not that every gate returns a report.
- **`main()` still exists.** Each script keeps its entry-point guard so importing
  it for the rule does not boot a container or patch the working tree.

---

## 2. The grader

Written against the frozen contract and the truth snapshot only. It imports
`@siteforge/schema`, `./match.js`, `./fields.js`, `./truth/gitea.js` — and a test
asserts that **whole list**, not the absence of the word `infer`.

### Two field walkers, one shared number

The truth side walks Swagger 2.0 with `$ref` resolution and a cycle stop; the
model side walks the closed recursive subset `packages/schema` defines. They are
separate on purpose — §13's rule about an invariant's observed side applies to a
grader's two sides identically, and a shared walk would move both at once, so a
wrong pointer convention would score 1.0 instead of failing.

What they *do* share is `MAX_FIELD_DEPTH`, and that sharing is required rather
than tolerated: the depth is not a property of either walker, it is the boundary
of what is comparable. A test walks the same six-deep shape through both
vocabularies — **with an array in it**, because `/[]` costs a level and that is
exactly where two implementations drift — and a second compares them on a real
shape out of the snapshot.

### Three definitions fixed before the first score

None of these is a threshold; the contract's table does not move and
`GRADE_CONTRACT_DIGEST` does not change. All three are recorded here because
they were settled on first contact with the data, and 0015 §5 is explicit that
adjusting a metric *after* seeing a score cannot be told from tuning.

**Enum agreement is spec values ⊆ model values.** Not equality, and not the
reverse. §13 decides the direction: a wrong enum makes valid states of the real
system unrepresentable in the clone, so an enum that *omits* a value the spec
allows is the failure this category exists to catch. One carrying an extra value
is over-permissive — the cheap direction, and indistinguishable from a spec
running behind its server. A `const` is an enum of one under the same rule.

**Arity is scored over a weaker match than identity.** Endpoints match on
`(method, positional shape)`, which folds arity *into* identity — so every
matched pair agrees on it by construction and `path-param-arity` would report a
perfect score it could never lose. The denominator is therefore the shape-matched
pairs *plus* the endpoints whose literal segments uniquely match a spec endpoint
of a different arity: "found the right resource, wrong number of holes". Only a
unique skeleton counterpart counts, because `repos/*/*/labels` also shares a
skeleton with `repos/*/*/labels/*`, and inventing an arity error out of that
ambiguity would move a miss from one category into another for nothing.

**The truth side of `narrowing` is restricted to claims the model can make.**
Measured: of the 5 508 formats Gitea's document declares, **3 380 are
`int64`/`uint64`** — integer width annotations, which `JsonStringFormatSchema` is
string-only and cannot express at all. On the baseline slice they accounted for
22 of 40 supposed recall misses, none of which any model could ever have hit.
This is the auth modality finding in a smaller key: scoring a claim against a
vocabulary the model does not speak measures the gap between two languages and
reports it as inference quality.

### `resolveAuthForCodegen`, not a boolean

The grader decides "does the clone gate this endpoint" by calling the same
resolver codegen calls. Reading `requiresAuth === 'required'` would classify
every `unknown` as open, score a model nobody ships, and silently convert the
evidence-coverage row of the mutation table into a second under-gate row. §8's
"never read the field as a boolean" is a rule about the grader too.

---

## 3. The mutation harness, and what it caught

0015 §7: the hand-authored baseline's near-1.0 score is **not** evidence — it was
transcribed from the ground truth, so scoring it well is circular. The deltas
are the evidence.

**Applied, measured, reverted — as a data transform.** 0014 settled that a
sabotage must be *executed* rather than authored, and committed patches were how
that was achieved for a gate wired into the filesystem. Where the gate is a pure
function there is no source to patch: the sabotaged state **is** a different
argument. It is really constructed, really graded, and the assertion is on the
numbers that came back. This is the point at which this turn's two halves meet —
the purity ruling is what makes the mutation harness possible in this form.

Four rules, each a §13 rule applied here:

- **Every row asserts on the metric it names**, never on the gate's verdict. The
  gate is *already red* at baseline (the `identifier` truth side is not built),
  so "the gate fails" would be satisfied by a syntax error in fourteen rows at
  once. The two empty-side rows assert that **nothing reports a score**, which is
  §6's actual property.
- **Every mutated model re-parses against `SiteModelSchema`.** A perturbation
  producing an artifact infer could never emit is the unreachable-input mode.
  This has teeth: `operationId` is recomputed from the pattern, so a path
  mutation renames the operation and every reference — `dataSources`,
  `pathParamOf`, `seed.derivedFrom` — has to follow, or the model does not parse
  and the row fails for the wrong reason.
- **Three controls**, and none is the vacuous spelling. Renaming a path parameter
  must move naming and leave identity exactly where it was (0015 §8 names this
  one). Adding a query parameter must move nothing, which asserts that "query
  parameters are unscored" is *true* rather than intended. Adding an
  out-of-universe operation must move nothing, which asserts the universe filter
  excludes rather than merely labels.
- **The blocked row is blocked by a fact.** `identifier-mispointed` cannot assert
  anything while the `identifier` truth side does not exist, so it declares
  `blockedBy: 'identifier'` and the harness checks that against
  `truth.notDerived`. The day someone builds that truth side, the harness fails
  and demands the row be enabled. §13: a known gap is a failing gate or it is not
  tracked.

### The harness found a real defect on its first run

`endpoint-identity.recall` is computed against the **observed** endpoint list and
never reads the truth at all — so with the ground truth emptied it happily
reported **1.000**, inside a report whose entire truth side was gone. Precision
and the synthesized rate had the mirror problem: a real `0.000`, which reads as a
terrible model rather than as no ground truth.

That is exactly the shape §6 exists to forbid, arrived at from a direction the
vacuity rule as written could not see: the rule asks whether a *denominator* is
empty, and this denominator was not. A truth with nothing in the graded universe
now ungrounds **every** category. The loader's floors are the first layer and
stop this today; this is the second, and it reports a bug in the first — the same
arrangement as the post-click origin check behind the router chokepoint.

It is now `sabotage/grade-empty-truth-scores.patch`, whose reachability note is
the shortest in the table: *the grader as written this morning.*

### And the practice caught a problem in itself, for the third time

Generating that patch failed: `git diff` printed **"Binary files differ"**. A
stray NUL byte had landed inside a template literal in `grade.ts`, which compiled,
tested and committed without a murmur. Nothing would have said so — the file's
diffs were simply unreadable in review, and no sabotage patch could be authored
against it at all. That is the vacuity mode one step earlier than the three §13
names: not a gate that cannot fire, but a gate whose sabotage cannot be *written*.

So it is a gate now (`assessSourceBytes`, over every source file the repo-wide
walker reaches — `packages/verify/src` included, verified rather than assumed),
and it carries its own patch, deleting the check the way somebody would who found
a whole-repo byte scan slow.

---

## 4. Measured

The baseline covers **15 operations** — the label and milestone families, plus
five zero-parameter endpoints the anonymous sweep observed, and one
`bound-from-control` delete. 14 of them observed by the (declared) crawl, against
482 spec operations in the universe.

Twelve metrics read 1.000, which is circular and means nothing. Two results are
worth reading:

**`identifier` is vacuous, and the report says why** — "foreign keys derivable
from the spec — this truth side is not derived". Unbuilt, not missed.

**`auth.evidence-coverage` is 0.667 against a 0.70 gate, and the baseline is not
wrong.** Ten of fifteen operations carry an observation; the five that do not are
the four mutations and the bound control. §6 forbids re-issuing a mutation
anonymously — it would change the target's state — so a mutation's auth verdict
can *never* rest on an anonymous probe. On an API surface that is roughly 60%
mutations, a 0.70 floor on evidence coverage is close to structurally
unreachable, and padding the baseline with read endpoints until it cleared would
be tuning the input to the metric.

Recorded rather than fixed. 0015 §5 says every calibration number is provisional
until the first Gitea run and that changing one requires a decision note with the
measured distribution. **This is that first run, and this is that measurement** —
but a 15-endpoint baseline is thin evidence for recalibrating, and the number to
recalibrate against is the one a real capture produces. The threshold stays where
it is until then, failing visibly, which is what §13 asks for.

---

## Open

- The baseline is 15 of 482 operations. Widening it is transcription work with a
  linear cost and no cleverness in it; the categories are all exercised, so the
  next increment buys calibration confidence rather than coverage of the grader.
- ~~`path-param-arity` has no mutation that leaves `endpoint-identity` still.~~
  Resolved, and it is structural rather than a gap in the search. Identity
  matches on the positional shape and a parameter hole is *part* of that shape,
  so an arity error is by construction also a shape miss: the two metrics cannot
  be isolated by any perturbation, on any spec. The `path-param-dropped` row now
  **declares** both, which is 0016's coupled-pair ruling — forcing exactly-one
  would have produced a false claim. (The denominator itself is not thin: 64 of
  Gitea's 413 skeleton groups contain endpoints of differing arity, so there is
  no shortage of real confusions for the category to catch.)
- The `identifier` truth side, and the parameterised auth sweep, both still wait
  on the deterministically-seeded container from 0015's open list.
- `narrowing.recall` is now 1.000 on a slice with one enum and eleven formats.
  That is a small number of narrowings to conclude anything from.
- Query parameters remain unscored, now with a control asserting it.
