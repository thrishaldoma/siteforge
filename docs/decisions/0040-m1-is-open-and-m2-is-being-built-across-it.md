# 0040 — M1 is open, M2 is being built across it, and this is the acknowledgement

*Status: accepted, and **its expiry has fired**. §4's conditional acceptance
ended when §7.6 landed; the ruling is 0043 — option (a), in two pieces, one of
them built. Read this for the bound and the sweep, and 0043 for what was
decided.*

§12: *"Milestone gates. Do not start a milestone before the previous one's gate
is green."* We are working on M2. **M1's gate is not green and never has been.**
This entry exists so that fact stops being carried implicitly across turns and
cannot surface at M5 as a surprise.

---

## 1. The bound

§12's M1 text is "recrawl is idempotent modulo timestamps". Measured against the
pinned Vikunja, read-only and with probing, across 0028, 0032 and 0038:

| population | paths | owner | status |
|---|---|---|---|
| **probe pass**, all under `flows/` | **30** | M1 | **open — this is the debt** |
| target clock — a `<time datetime>` seeded server-side | 4 | the target | permanent; recorded, not fixed (0032 §3) |
| rasteriser, two states on rounded `<select>` corners | 3 paths / 51 px | M1 | open, bounded, mechanism unnamed (0038 §2.5) |

The read-only side is now **fully characterised**, which matters for
attribution: everything not in rows 2 and 3 is the probe pass, and there is
nothing left to argue about which side a difference came from.

## 2. The mechanism: the probe pass writes

Not timing, and this is the part that makes the debt structural rather than
flaky.

§6's behaviour probing fires controls. Firing a control on a task manager
**creates, updates and deletes rows**. So:

- runs are **not independent** — the second crawl reads the first crawl's
  mutations, which is why holding one container still made the count *worse*
  (0032 §2.1): a control condition that perturbs its own subject;
- the number of controls that resolve depends on **position in the loop** (9
  fired of 18 attempted, 3 of 14, 8 of 24 … on the latest run), which is why
  every single-shot reproduction has exonerated every hypothesis put to it
  (0024);
- so the artifacts under `flows/` differ between runs on an unchanged target.

### 2.1 And that reaches the work being started this turn

`flows/skipped-controls.json` is under `flows/`. Its control count was **60** on
one run and **84** on the run taken this turn, same pinned digest, same
crawler.

§7.6 reads that file. So **§7.6's input is non-deterministic**, and therefore so
is its output: the set of bound controls, and `synthesized-endpoint`'s
denominator, vary run to run. When that category finally produces a number, the
number has no single value — it has a distribution, and reporting it as a point
estimate would be the mistake §3 is about.

This is the sharpest available reason the debt is not freely deferrable. It is
not "M1 is untidy"; it is that an M2 metric inherits an M1 defect through an
artifact.

## 3. The sample-size sweep

Ordered because the bimodal finding (0038) generalises past screenshots: **a
uniform sample of a bimodal variable is indistinguishable from a constant**, and
N=3 has backed most stability claims in this project. Swept, not re-run.

Two justification kinds, and only one of them is an argument:

- **mechanism-perturbed** — the runs differ in the thing the measured quantity
  could plausibly be a function of. A designed contrast. Sound at N=2.
- **repeat** — the runs are the same run again. Justified by a budget, and it
  tells you only that N draws agreed.

| claim | N | kind | verdict |
|---|---|---|---|
| spec snapshot `volatileFields: []` (0015 §1, Gitea; 0021, Vikunja) — gates the truth everything is scored against | 2 | **mechanism-perturbed**: different ports, `ROOT_URL`s and secrets, which is what a served document could vary with. 15 768 leaves, zero differing | **sound.** The strongest small-N claim here, and the template for the rule |
| read-only idempotence `4 of 81` (0028 §5, 0032 §3) | 3 | **repeat** | **wrong, corrected.** 0038: three draws that agreed; the fourth was 7 |
| "the deterministic core is deterministic: 77 of 81 reproduce byte for byte" (0028) | 3 | **repeat** | **false as written** (0038 §2.4.1) |
| "every screenshot … reproduces exactly" (0032 §3) | 3 | **repeat** | **false as written** (0038 §2.4.1) |
| reduced motion "exactly 4 both times" (0032 §3.1) | 2 + 2 | **repeat** | **verdict survives, evidence does not** — both samples were in the same raster state. The claim now rests on the residual being a server-written timestamp (0038 §2.4.1) |
| probing sweep variance, N=3 (0028) | 3 | **repeat, and explicitly justified by the distribution**: 87 of 166 paths moved, traceable to one clock, so more runs refine a magnitude rather than the finding | **sound.** A large effect needs few draws; that is a distribution argument, not a budget one |
| `endpoint-identity` etc. unchanged across the merge (0025) | 2 | **mechanism-perturbed**: the two runs differ by the merge under test, and the assertion is that a *different* population did not move | **sound.** It is a control, not a stability claim |
| Vikunja browser/document overlap, 16 of 18 (0019, 0021) | 1 | single measurement | **marked.** A selection criterion applied once to choose a target, not a gate. Re-measuring is cheap and nobody has |

Two things follow and both are now in §13:

- **The rule.** A gate asserting stability declares its N and justifies it
  against the distribution. "Runs are expensive" is a budget.
- **N=2 is the worst available choice against a bimodal variable**, which is
  exactly what 0032 §4.2 proposed for M1's gate. Not landed, and 0038 §2.4
  records why it must not be.

The two sound small-N claims are sound for the same reason and it is worth
stating once: **they varied the mechanism rather than the run.** That is
available cheaply almost everywhere and was simply not asked for.

### 3.1 Not re-run, per the ruling — and what that leaves

`volatileFields` and the browser-surface overlap are single- or
double-observation claims that nobody is re-measuring today. They are marked
here rather than fixed. The one that would repay a re-measure first is the
browser-surface overlap, because it is the criterion that *selected the target*
and it has an N of one.

## 4. Is building M2 across an open M1 acceptable?

**Yes, and the argument is specific rather than general.** Three conditions,
all of which currently hold:

1. **The defect is bounded and attributed.** 30 paths, all under `flows/`, one
   named mechanism (the pass mutates the target). Not "the crawler is flaky" —
   §2. A bounded defect can be reasoned around; an unbounded one cannot, and
   until 0038 the read-only side was not fully characterised, so this condition
   became true only this turn.
2. **M2's currently-scoring metrics do not read `flows/`.** The twelve
   `capture-fidelity` numbers and the five `inference` ones read
   `network/endpoints.json` and the model derived from it. Those artifacts
   reproduce exactly across five read-only runs. So today's scores are not
   sitting on the unstable population.
3. **The one M2 category that *does* read `flows/` is `synthesized-endpoint`,
   and it is vacuous** — so nothing is currently being concluded from it.

**Condition 3 expires this turn.** §7.6 is being built, which is precisely the
code that makes an M2 metric read the unstable artifact. So the acceptance is
conditional and the condition is now dated:

> **The moment `synthesized-endpoint` produces a non-vacuous number, that
> number must be reported with an N and a spread, and M1's probe-pass
> determinism stops being deferrable.** A point estimate off one crawl of a
> pass known to vary 60 → 84 on its own input would be a measurement of the
> draw.

**Fired, and settled in 0043.** The shape turned out to be neither branch the
ruling offered: the pass has a **non-terminating tail** — one crawl finished in
475.9s and the next hung at 38:16 — and its finite draws take a new value
nearly every run (skipped controls 84 · 83 · 79). Option (b) is excluded on its
own stated condition, because the variance measurably does reach what §7.6
consumes. The ruling is (a), and the measurement split it in two: a wall-clock
bound on each probe (landed) and resetting target state between probes (next,
and it could not have been measured before the first).

### 4.1 What would make it unacceptable, stated so the line is checkable

- A gate turning green on the strength of an artifact under `flows/`.
- The 30 becoming un-attributed again — i.e. a difference appearing outside the
  three populations in §1.
- M3 starting. §8's mock backend is generated from `endpoints.json` and
  `flows/`, so codegen would bake the non-determinism into the environment, and
  §8's determinism harness is not allowed to paper over it ("do not paper over
  this one").

If any of those happens the correct response is to stop and fix M1, and this
section is what a reader should hold the project to.

## 5. Open

- The 30 probe-pass paths. M1, unfixed, mechanism named, not scheduled here.
- The rasteriser's two states (0038 §2.5). M1, 51 pixels, instrument-first.
- Re-measure the browser-surface overlap at N>1 (§3.1).
