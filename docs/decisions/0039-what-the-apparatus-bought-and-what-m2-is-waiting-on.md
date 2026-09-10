# 0039 — What the apparatus bought, and what M2 is waiting on

*Status: accepted. An assessment, with a recommendation and one specific piece
of unbuilt product named.*

The question: the trade has been correct so far because each apparatus finding
invalidated something already built. Is that still true, or has the apparatus
started costing more than the stage it measures?

---

## 1. The discriminator, because "the apparatus found something" is too weak

An audit always finds something. The useful test is narrower and it is the one
this repository already applies to its own gates: **did the finding invalidate a
number or a claim somebody had already written down and acted on?** A finding
that corrects a belief nobody held is tidying. A finding that invalidates a
quoted number means every decision downstream of that number was taken on bad
information.

Scored that way, four turns, four for four.

| turn | what the apparatus found | what it invalidated | cost of finding it later |
|---|---|---|---|
| **0031** — the manifest audited against itself | three manifest claims with nothing behind them: `contentHash` never compared, `determinism.frozen` naming four globals no shim froze, `prefersReducedMotion: reduce` asserted while **four of six contexts** did not set it | every manifest ever written, and the M1 gate itself — §12's "recrawl is idempotent" *was* `contentHash`, so M1 had never been gated at all | the two crawl contexts are the ones that produce every route, screenshot and DOM. Every artifact in the repository was captured under conditions the manifest misdescribed. Found at M4 it invalidates the determinism gate's inputs, not just its claim |
| **0034** — limitations recorded against the wrong thing | `inferSchema` recorded `examples` inside its `string` branch only: **0 of 68 numeric nodes** carried an observed value against 273 of 324 strings. Recorded as "the key-value rung's shortcoming"; the mechanism is called on every capture on every target | §8 seeds the mock store from captured responses, so **every numeric field in every generated clone** was seeding from nothing | this is the M3 deliverable. Found after codegen ships, it is silently wrong seed data in every environment, and an RL agent's trajectories are the thing that reveals it |
| **0037** — every self-selecting gate declares what it cannot see | writing the eleven controls **corrected four of the eleven declarations** — three patches tripped a *different* gate than the one declared, and `lint-identifiers` turned out to catch a slice-built prefix it was declared blind to | four written-down statements about coverage were wrong, in a document whose entire subject is coverage | prose could not have produced that evidence. The declarations would have read correct indefinitely; the cost is not a date, it is that nobody would ever have looked |
| **this turn** — 0038 | the read-only idempotence baseline of **4 of 81** was three draws of a bimodal variable that happened to agree. And `contentHash` certifies a route while two of that route's screenshots move | 0028's "the deterministic core is deterministic: 77 of 81 paths reproduce byte for byte" and 0032 §3's "every screenshot reproduces exactly" — both false as written. 0032 §4.2 was one turn from landing an "equality against 4 at N=2" gate | that gate is the sharp end. It fails when two runs disagree and passes when they agree, and **neither outcome is about the crawler** — a coin flip wired to a red light, in the check that is supposed to be M1's gate. It would have been debugged as a crawler defect |

The pattern is consistent and it is not "the apparatus is thorough". It is that
**this project's characteristic defect is a claim with nothing behind it**, and
such a claim is invisible to reading — 0031 says it, 0018 says it, 0028 says it,
and it just happened again in a place four documents had already inspected. A
number quoted in two decision documents and about to become a gate turned out to
be a sampling artifact. Reading harder would not have found it; measuring at
N=5 did, in six minutes.

### 1.1 The cost side, unsoftened

Three items, and they are real.

- **The rotted sabotage patch (this turn).** `verify:clean` was red at HEAD
  because an ordinary product commit moved the lines a patch was anchored
  against. This is pure maintenance — no defect was caught, and the tax scales
  with the number of committed patches (23 sabotages plus 11 controls today).
- **`revealInScrollableAncestor` (0032 §6.4).** Designed, argued, landed,
  instrumented — and it recovered **zero** controls on this target. Kept on a
  class argument that is still sound, and honestly labelled unexercised, but it
  is a turn spent for no measured gain here.
- **This turn's shape.** One product change (`contentHash`'s scope and its
  sibling check), and the rest is measurement, correction and write-up.

An honest reading of the cost side is that roughly one turn in four is
apparatus maintenance rather than apparatus payoff, and the maintenance tax is
growing with the patch count. That is the number to watch. It is not yet the
dominant term.

### 1.2 So: is the trade still correct?

**Yes, and the argument is four-for-four on invalidated quoted numbers, not a
general claim about rigour.** Every one of the four findings above landed on
something that had already been built or already been asserted. None of them was
a hypothetical hardening.

But that argument has a shelf life, and §3 is where it runs out.

---

## 2. What infer emits today, against M2

### 2.1 Emitted

`packages/infer` is ~1 400 lines across `entities`, `operations`, `components`,
`tokens`, `narrowing`, `capture`, `variant`. It produces:

- **operations** — transcribed from `capture/network/endpoints.json`;
- **entities** — 4, derived from `StoreEffect`s over those operations;
- **tokens** — 16 colours clustered;
- **components** — repeated-subtree extraction;
- **narrowings** — carried onto entity fields where the ladder rules for one.

### 2.2 Graded, and what each number is actually about

Ten `capture-fidelity` categories and five `inference` ones. The honest
partition, from 0021 and 0023:

| status | categories | why |
|---|---|---|
| **scoring, and moving** | `endpoint-identity.precision` (0.938), `path-param-naming` (0.600), `request-field-presence` (0.737 / 0.933), `response-field-presence` (0.833 / 0.563), `field-type` (0.872), `auth.*` (all passing), `entity-identity.precision`, `entity-field-presence` (1.000 / 0.936) | real measurements — though 0021 established that the twelve `capture-fidelity` numbers score a **capture** artifact, so most of them are stage 1's, badged as stage 2's |
| **structurally unable to fail** | `endpoint-identity.recall` (1.000 16/16) | `model.operations` is a total `.map` over the observed list, so it reads 1.000 for any infer that transcribes. Not a result |
| **ungradeable — target limitation** | `narrowing.precision`, `entity-narrowing.precision`, `identifier.*`, `entity-relation.*` | the document declares zero formats in 368KB and no identifier modality; `RelationSchema` cannot express the one reachable relation. Permanent until the target changes (0021, 0023 §3.2, 0033 §4.1) |
| **ungradeable — document contradicts its server** | `narrowing.recall` | four slots where Swagger says `integer` enum and the wire says `"list"`. Registered in 0033, over its per-category cap, and that is the finding |
| **vacuous — unimplemented stage** | **`synthesized-endpoint`** | §3 |

### 2.3 Unbuilt, blocked, or ungradeable — the three are different

- **Ungradeable** (rows 3 and 4 above) is largely *not work*: §13's fourth
  vacuity cause, *declined on evidence*. The enum ladder ran and correctly
  found nothing meeting its bar. Recording it and moving on is the right
  response.
- **Blocked**: nothing is, materially. `identifier`'s truth side and the
  parameterised auth sweep both wait on a seeding script (0015, 0018), which is
  work, not a blocker.
- **Unbuilt product**: §3.

---

## 3. The recommendation: §7.6, and it is the one thing that unblocks a category

**`packages/infer` contains zero occurrences of `bound-from-control`.** §7.6 —
binding a skipped control to a URL out of a `<form action>` or a `fetch()`
literal — has never been written.

This is §13's vacuity table's **third** row, and it is the row that hides:

> **unimplemented stage** — the artifact is **full** and the category is still
> empty, and the work is usually in a *different package*.

Measured this turn, on a fresh probing crawl at `c213e6c`:

```
flows: 62 (9 skipped) · skipped controls: 84 · budget-declined: 659
endpoints: 22 inferred from 1234 API exchange(s)
```

**Eighty-four controls in `flows/skipped-controls.json`, and
`synthesized-endpoint` still scores nothing.** The input is full. The consumer
does not exist.

*(CLAUDE.md §13 says "holds 60 controls". It is 84 on this run, and the count
moves with the probe pass, which 0032 §4 established is non-deterministic. A
fixed number in the manual is the wrong shape; the claim that survives is "the
artifact is full".)*

Three reasons this is the right next piece of product rather than more
apparatus:

1. **It is the only unbuilt thing that would move a currently-vacuous graded
   category.** Everything else vacuous is the target's limit or a declined
   inference. This one is ours.
2. **`synthesized-endpoint` is scored hardest on purpose** — 0015 calls
   `bound-from-control` claims "the highest-hallucination-risk claims in the
   model", precision-only, structural threshold ≥ 0.90. So the category is
   already built, already pinned, already has a mutation row, and has never had
   an input. The apparatus for it is paid for and idle.
3. **It exercises infer's actual judgement.** 0021's uncomfortable finding is
   that the parts of infer doing §7's work are invisible to every metric —
   twelve numbers badged as infer's are largely capture's. §7.6 is §7 judgement
   that lands in a category built to score it, which is precisely the gap 0021
   identified and nothing has closed since.

**So: stop hardening, build §7.6.** Not because the hardening has gone bad — §1
says four for four — but because the argument for hardening is "it invalidates
things already built", and the fastest way to keep that argument true is to
build the next thing. An apparatus that outruns its subject starts auditing
audits, and the four-for-four record is a fact about a period in which there was
plenty of built product to invalidate.

### 3.1 The one piece of hardening that should *not* wait

Named specifically, because "keep hardening" without a target is the answer this
document is declining to give.

**0032's 30 probe-pass paths are still unfixed, and M1's gate is still not
green.** 0032 §1 states it plainly and it remains true: M1 has never passed its
own §12 text, and §12 says do not start a milestone before the previous one's
gate is green. We are working on M2 across a red M1.

That is not an argument for auditing more. It is an argument that the probe
pass's non-determinism is **product debt with a milestone owner**, and 0038 has
just removed the last excuse for confusing it with the read-only residual: the
read-only side is now fully characterised (4 target-clock paths, plus a bimodal
rasteriser worth 51 pixels), so everything else is the probe pass and there is
nothing left to attribute.

### 3.2 What is explicitly not recommended

- **A magnitude classifier for `claimExceeded`** (0038 §3.5). It needs a
  tolerance, and a tolerance fitted to the 15 and 36 pixels just measured is
  fitting the measurement to the answer.
- **Widening `contentHash`** (0038 §3.2). Decided, on two mechanical grounds.
- **Another gate audit.** 0031, 0035 and 0037 were three audits of the same
  family — a claim broader than its backing — and the fourth would be the first
  one auditing a surface the previous three already swept. The next instance of
  that family should be found by a measurement failing, not by a sweep.

---

## 4. Answer, in one line

The trade is still correct — four turns, four findings, each invalidating a
number already quoted and acted on — but the argument depends on there being
built product to invalidate, and the specific thing to build next is **§7.6**,
which has 84 controls waiting for it, a grading category already pinned and
idle, and no blocker.
