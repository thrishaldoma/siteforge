# 0043 — The probe pass has a non-terminating tail, so M1 gets (a)

*Status: accepted. The M1 ruling 0040 §4 dated, with the measurement that
decides it. One half of the fix landed; the other is named and not built.*

---

## 1. The shape question, and the answer neither branch anticipated

0040 §4's acceptance of an open M1 expired the moment §7.6 landed, because
`flows/skipped-controls.json` sits under `flows/` and §7.6 reads it. The
ruling asked for the bound's *shape* first — bimodal like the screenshots
(0038), or unbounded — with N declared against the distribution.

### 1.1 N=4, justified before running

Written down first. The instrument answers the shape question directly:
`assessCaptureIdempotence` reports `distinct` per unstable path, so bimodal
means every unstable path reads `distinct <= 2` for any N, and unbounded means
`distinct` grows with N. **N=3 cannot discriminate** — three draws of an
unbounded variable also read 2 whenever two collide, which is precisely the
trap 0038 fell into. N=4 is the minimum that can falsify bimodality in one
observation.

The repeat count is the weak justification, so the design also carried the
strong one: the **read-only crawl is a mechanism perturbation** that shares
every code path except the probe pass, and it is already measured.

### 1.2 It did not complete, and that is the finding

| run | outcome |
|---|---|
| 1 | **475.9s** — 7 routes, 22 endpoints, 84 gaps, 74 undriveable |
| 2 | **hung at 38:16** — idle event loop, node at 0% CPU, the page polling notifications and nothing else. Sampled, then killed |
| 3, 4 | never ran |

Load was ruled out rather than assumed: the host was at 1.8 when the hang was
diagnosed, and the container was still answering.

**So the distribution is not bimodal and not merely unbounded — it has a
non-terminating tail.** A draw can produce no artifact at all. That is a third
possibility the ruling's two branches did not include, and it is worse than
either.

The finite draws agree. Skipped-control counts across the runs that finished
this turn, same commit range, same pinned digest:

```
84 · 83 · 79        (and one run that produced none)
```

**Three distinct values in three completed draws.** Bimodality is falsified
without needing the N=4 comparison at all — the count §7.6 consumes takes a new
value nearly every run.

---

## 2. The ruling: (a), and it is two fixes rather than one

### 2.1 Why not (b)

(b) was admissible "only if the variance provably cannot reach `flows/` entries
that §7.6 consumes". It provably **can**: the skipped-control count is 84, 83,
79 across three runs, and `report.binding.considered` follows it. A hung run
supplies nothing at all. The condition (b) was offered under is measurably
false, so (b) is out on its own terms rather than on judgement.

### 2.2 Why not (c)

Re-scoping M1's gate to exclude the probe pass does not stop the probe pass
feeding a graded stage. It would make the gate green while `synthesized-
endpoint`'s denominator continued to move run to run — a gate whose scope was
narrowed to exclude the thing that was wrong, which is the shape 0037's audit
exists to catch.

### 2.3 So (a) — but the measurement changed what (a) is

The ruling's (a) is "make the pass independent by resetting target state
between probes". **That addresses one of two defects.** Resetting state fixes
*non-independence* — probe k reading probe k−1's writes, 0032 §2.1. It does
nothing about an await that never settles, which is what hung run 2, and the
hang is the more urgent of the two because a non-independent run still produces
an artifact and a hung one does not.

There is also an ordering constraint that is not a preference: **you cannot fix
(a) until you can run N crawls, and today you cannot.** Every claim about
whether resetting state helped needs a before-and-after over several runs, and
several runs need each one to end.

So (a) is two pieces in a forced order.

**Landed this turn — the wall clock.** §6's budget is a *count* of attempts per
route; `PROBE_DEADLINE_MS` (default 45s) bounds each probe, and an expiry is a
**recorded gap** rather than a crash. Driven to its failing verdict against the
real target at 1ms — 132 abandoned, run still green — and at the default it
fires **once** on an ordinary crawl. That once is the hang, caught and
absorbed: the same defect that cost 38 minutes now costs 45 seconds and a line
in the artifact.

**Not landed — resetting target state between probes.** Named, owned by M1,
and the next thing. It now has a precondition it did not have this morning: the
pass terminates, so the before-and-after can actually be measured.

### 2.4 The justification is §6's own requirement, and nothing else

**§6 already requires this.** "Probes cannot contaminate each other's
preconditions" is in the capture spec; 0032 §2.1 measured that the crawl
violates it; and §6's own note that "a fresh page context does not undo a
mutation" says the browser-side half was never sufficient on its own. This is
finishing a requirement, not adding one, and it needs no argument from any
later stage.

*A second justification was raised and withdrawn — that §8's snapshot/restore
would be reused, so building this now is work not repeated. It does not hold:
§8's reset is an in-memory structured-clone store inside the generated Fastify
app required to run in under 50ms, while resetting a pinned Vikunja container
is a database-file restore or a sequence of API calls against somebody else's
server. Same words, no shared code. Recorded as withdrawn rather than deleted,
because it was weighed when the ruling was made; it carries no weight now.*

---

## 3. What M1's gate can say now, and what it still cannot

The read-only side is fully characterised (0038): 4 target-clock paths, plus 3
raster paths whenever both states are drawn. The probe side is characterised
as *unbounded with a non-terminating tail*, which is not a number and must not
be written as one.

**So M1's gate stays the read-only crawl, and it is not an equality against 4.**
0038 §2.4 already ruled out the equality; this adds that the probing crawl
cannot be gated at all until §2.3's second half lands, because a gate over a
population that sometimes fails to exist is a gate whose red and whose absence
look identical.

The honest statement, and the one M2 work should carry: **`synthesized-
endpoint`'s denominator is drawn from a distribution, not measured.** It reads
`vacuous 0/0` on Vikunja for reasons unrelated to this (0041 §7.2), so nothing
is currently being concluded from it — but the first target where it is
non-vacuous inherits this, and the number will need an N and a spread.

*Amended (0048): §7.6 has since landed and the cause has changed. The model
now emits **five** `bound-from-control` operations and the category still
reads `0/0`, because all five were bound by `href` to SPA routes outside the
`/api/v1` universe — so the denominator, which counts in-universe
synthesized endpoints, is empty while the model carries five unscored
claims. The `0/0` was never evidence that the model emits nothing, and
reading it that way mis-filed the category's deferral class in 0045.*

---

## 4. Open

- **Reset target state between probes.** M1, next, unblocked by §2.3.
  *Amended ([[0053]] §6): the granularity is decided and the measurement that
  decided it is on record. One probe on `tasks-id` — the due-date quick-set
  widget, which exists only on a seeded-rich task — issued `POST /tasks/1` and
  moved the pre-state of **all fourteen probes after it on that route**, none of
  which recovered. Within-route, so a route-boundary reset is refuted rather
  than merely unsupported; and the negative control held over sixteen
  consecutive read-only pairs. **Per-probe**, with the undo scoped to match the
  do: a database snapshot taken immediately **before each probe**, never a
  container recreate and never a snapshot at seed time, both of which restore
  more than the probe changed. Not built; the remaining work is the mechanism.*
- **Where the hang actually is.** Bounded, not diagnosed. The event loop was
  idle with a promise pending; `waitForLoadState` at the login path carries no
  explicit timeout but Playwright's 30s default applies, so it is not that.
  Deliberately not guessed at — 0032 §5 spent a document on a mechanism read
  off the wrong evidence and had to retract it. The deadline makes it
  *countable*, which is the precondition for finding it: `deadline-abandoned`
  is in the run report on every crawl.
- Re-run the N=4 shape measurement once the pass terminates reliably. The
  prediction stands and the instrument is unchanged.
