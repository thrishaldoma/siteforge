# 0044 — Measuring which probes contaminate which, and what the first instrument said instead

*Status: in progress. §1 and §2 are written **before** the measurement and are
not edited afterwards; §3 records what came back.*

---

## 1. What is being measured, and why a single number decides it

0043 ruled (a) — reset target state between probes — and left **granularity**
open, with the instruction to decide it from measurement rather than from
principle. Per-probe reset is the strong form and may be prohibitively slow
against a container; per-route may be enough. The two differ in exactly one
observable:

| contamination scope | granularity it forces |
|---|---|
| **within-route** — probe *k* on route R reads probe *j<k*'s writes | **per-probe**; a route boundary is too coarse to help |
| **cross-route only** — a route's own probes leave each other alone | **per-route** is sufficient |

`assessProbeContamination` answers the first from one run: each probe loads its
route fresh, so absent contamination the pre-state is constant down a route's
probe loop. The second is cross-run and needs the series.

The fingerprint is two hashes, not one. §6's shim freezes *our* clock and not
the server's, so a relative timestamp re-rendering would read as a write. Tag
sequence moves when a row appears; text moves for either.

### 1.1 The negative control, and the commitment that goes with it

The pass supplies its own control: **a probe whose calls were all reads must
not move the next probe's pre-state.** If structure drifts across a read-only
prefix, the fingerprint is tracking something other than our writes and the
verdict is `confounded`.

**Committed in advance: `confounded` is a result, and it will be reported as
one.** It says the granularity question cannot be answered by this instrument
on this target, and the response is to name what a better instrument needs —
*not* to relax the control until an answer appears. Weakening a control after
seeing the data is fitting the measurement to the answer.

## 2. Predictions, written before the run

Per §13: a variant reports the same "nothing moved" whether it is a null result
or a broken experiment, and only a prediction written beforehand tells them
apart.

| # | quantity | prediction |
|---|---|---|
| 1 | `conserved` — every observed write is either a probe's or outside every probe | **true in all four runs.** This is a construction, not a discovery; it fails only if the tagging is wrong |
| 2 | writes attributed to probes, per run | **1–3.** The aborted series observed exactly two browser-issued writes — `POST /api/v1/user/settings/general` and `POST /api/v1/tasks/1` |
| 3 | `mutatingProbes` | **1–3**, following (2) |
| 4 | verdict | **`confounded`, most likely.** The aborted run 1 had 4 structural drift points and at most ~2 could be downstream of a write, so unexplained drift is expected to survive |
| 5 | skipped controls | **near 83, range within 79–86.** The 84 · 83 · 79 prior came from a *commit range*; this series is one commit and one flag set, so it is the better baseline rather than a target to reproduce |
| 6 | abandoned on the deadline | **0–1 per run** |

### 2.1 The prediction that matters most, and why it is uncomfortable

If (2) holds, **the probe pass writes about twice per crawl.** 0040 §2 gives the
mechanism making M1's debt structural as "firing a control on a task manager
creates, updates and deletes rows". Two writes in ~128 probes is that mechanism
being *real but tiny*, and it would mean the 84 · 83 · 79 spread is mostly
**not** accumulated state — leaving probe ordering, timeouts and position in
the loop as the dominant term, none of which a reset touches.

That does not re-open 0043's ruling: §6 requires non-contamination whatever the
magnitude. It does change what the reset can be expected to buy, and the honest
form of the claim is a fraction of the variance rather than a fix.

## 2.2 Prediction 2 was wrong, and the instrument was rebuilt around why

*Written after a run that was then discarded, and before the series that
counts. §2 above is left exactly as committed at `258337e`.*

Predicted 1–3 writes per crawl. **Measured 55**, with 51 of 128 probes marked
mutating — and the probes doing it were sidebar navigation links, the same set
on every route.

They were `POST /api/v1/user/token`. **Vikunja renews its JWT on page load**,
so almost every probe made a write, over HTTP, that changes nothing any later
probe can read. The auth HAR shows 3 POSTs against the diagnostics' 55 because
probe contexts are not HAR-recorded, which is why the composition was invisible
until the paths were written down.

The consequence is the dangerous direction again. `afterMutating` was true
nearly everywhere, so nearly every drift point looked **explained**, and the
verdict would have been a confident `per-probe-required`. It came out
`confounded` only because the first few probes on each route ran before the
nav links did — luck, not the instrument working.

Three changes, all of them moving a judgement to where it can be tested:

1. Observations are **phase-tagged at event time** — `load` or `action` — from
   a per-page reference, so a response body resolving late cannot move a write
   across the boundary. The pre-snapshot is the moment a probe stops observing
   and starts acting.
2. A probe records **`actionWritePaths`**, a list, not a count. *Which* write it
   was decides whether it could contaminate.
3. `NON_CONTAMINATING_WRITES` declares the writes that cannot, each with its
   reason, and the report counts what it waved through — so an exemption
   resting on the declaration rather than on the data is visible from outside.
   The bar is not "unimportant" but "cannot change what a later probe reads".

Conservation now ranges over **ownership** rather than phase: a page-load write
still belongs to the probe whose page made it, and netting it out would break
the law on a crawl where nothing was misattributed.

**Revised prediction: 1–3 contaminating writes per crawl** — the two seen
directly are `POST /api/v1/user/settings/general` and `POST /api/v1/tasks/1` —
and the verdict stays **`confounded`**, on the same reasoning as prediction 4.
The commitment in §1.1 is unchanged.

---

## 3. What came back

Four crawls, one commit (`dc58243`), identical flags, mean 474.7s.

### 3.1 The predictions, scored

| # | prediction | outcome |
|---|---|---|
| 1 | `conserved` true in all four | **✓** — and the write composition is *identical* every run: 55 crawl writes = 52 on probe pages + 3 outside, 52 action-phase, 1 contaminating |
| 2 | 1–3 writes per crawl | **✗ as written (55), ✓ as revised.** §2.2 |
| 3 | `mutatingProbes` 1–3 | **✓ — exactly 1, four times, spread 0** |
| 4 | verdict `confounded` | **✓, 4 of 4** |
| 5 | skipped controls near 83, within 79–86 | **✓ — 84 · 83 · 84 · 84** |
| 6 | 0–1 abandoned | **✓ — 0 · 0 · 0 · 0** |

### 3.2 The spread is 1, and the prior 79 was a commit-range artifact

```
skipped controls    84 · 83 · 84 · 84     N=4, range 83–84, spread 1
probes run         128 · 128 · 128 · 128  spread 0
contaminating       1 · 1 · 1 · 1         spread 0
abandoned           0 · 0 · 0 · 0         spread 0
```

0043 §1.2 recorded 84 · 83 · 79 and read three distinct values in three draws
as "the count takes a new value nearly every run". Those came from a **commit
range**. Held at one commit with one flag set the spread is **1**, and two of
the four runs are identical. The earlier triple was measuring us changing the
code, which is the mechanism-versus-repeat distinction 0040 §3 drew, applied to
a series nobody had checked for it.

This does not make the count deterministic — a spread of 1 is still a spread,
and §7.6's input still moves. It makes it a far smaller term than the ruling
was written against.

### 3.3 The verdict is `confounded`, and the reason is the finding

`confounded`, 4 of 4: 3–4 structural drift points per run, 2–3 of them with no
write to explain them. Per §1.1 that is reported as the result. But the drift
points are *the same ones every run*, which is what made them diagnosable:

| drift point | runs | after a write? |
|---|---|---|
| `tasks-id` #4 → #5 | **4/4** | **yes** — `POST /api/v1/tasks/1` |
| `projects-id` #13 → #14 | **4/4** | no |
| `projects-id` #14 → #15 | **4/4** | no |
| `projects-id` #0 → #1 | 1/4 | no |

Probes 13, 14 and 15 on `projects-id` are the project **view switches** —
Gantt, Table, Kanban. Each made one GET and wrote nothing.

**Measured directly rather than inferred** (0032 §5 is the document that spent
itself on a mechanism read off the wrong evidence). Click Gantt, then reload
the route:

```
baseline, fresh context                1303 tags
after Gantt, SAME context, new page    3070 tags   ≠ changed
after Gantt, NEW context, same server  1303 tags   = back to baseline
```

`localStorage` holds `projectView`, `lastVisited`, `projectHistory`,
`navigation-child-projects-open`, `menuActiveDesktopPreference`.

**The contamination is client-side, and the server is not involved.** A new
context against the same server returns to baseline.

### 3.4 So the granularity answer is per-probe, and it is mostly not about the target

§6 says "for each candidate, in a fresh page **context**". The code called
`newGuardedContext` once per *route* and `ctx.newPage()` per probe — a fresh
page inside a shared context, which in Playwright differ by exactly one thing:
client storage. The spec was right; the implementation read "page context" as
"page".

| mechanism | drift points | fix | cost |
|---|---|---|---|
| **client state** in a shared context | **3 of 4** | a context per probe | milliseconds |
| **server state** — one task update | **1 of 4** | 0043's target reset | tens of seconds per probe |

So the granularity question has the same shape 0043's had: **neither branch on
offer.** The ruling asked per-probe versus per-route *for a target reset*, and
the answer is that per-probe is required, that the cheap half was never on the
target, and that the expensive half addresses **one write in 128 probes**.

### 3.5 What this says about 0043's ruling, which is not a request to re-open it

0040 §2 gives the mechanism making M1's debt structural: "firing a control on a
task manager **creates, updates and deletes rows**". Measured, that is **one
write per 128 probes**, identically in four crawls. It is real — `tasks-id`
#4 → #5 is contamination, caught, four times out of four — and it is small.

§6 requires non-contamination whatever the magnitude, so (a) stands on its own
terms and 0043 §2.4 is unchanged. What changes is the expected return: a target
reset cannot reach the client-state contamination, and it cannot be a large
part of the residual variance when the whole residual it could touch is one
write. The honest form of the claim is a **fraction**, and the fraction is
1 of 4 measured contamination points.

### 3.6 The hang did not recur

`deadline-abandoned` is 0 in all four runs, so there is **no distribution to
look at** — the ruling's "one instance per crawl means four samples" did not
hold, because the rate is lower than one per crawl. Four clean crawls put it
below roughly 1 in 4 rather than at 1 in 1. The instrument is in place and
costs nothing when it does not fire; the sample count is 0 and no mechanism is
claimed.

### 3.7 What a better contamination instrument needs

Named, per §1.1's commitment, rather than reached by relaxing the control:

1. **A client-state fingerprint.** The negative control is defined over server
   writes, so client-state contamination has no write to point at and lands as
   "unexplained". Snapshotting `localStorage` per probe alongside the DOM would
   let the same conjunction be tested — *storage changed **and** the next
   pre-state moved* — and would have named this mechanism directly instead of
   leaving the verdict at `confounded`.
2. **A settledness precondition.** A pre-state is compared across probes
   without ever being checked for stability against *itself*. Snapshotting
   twice, milliseconds apart, and declining the comparison when the two differ
   would separate "the page is still rendering" from "the page renders
   differently now" — the same shape as `capture-route.mjs`'s sticky detector,
   which requires the declared value **and** a runtime condition.

The 1-of-4 `projects-id` #0 → #1 point is the one this would settle: it is the
only drift point that is not reproducible, which is what an unsettled render
looks like and what contamination does not.

### 3.8 The fix was built, measured and reverted

A context per probe — §6's own text — was implemented and run. It costs most
of the pass:

| route | fired before | fired with a context per probe |
|---|---|---|
| `root` | 9 of 18 | **1 of 18** |
| `projects` | 3 of 14 | **1 of 14** |
| `projects-id` | 8 of 24 | **5 of 24** |

A brand-new context has no warm cache and no service worker, so the SPA
hydrates cold on every probe and the control is not present when the probe
looks for it. Removing the contamination by removing nine tenths of the
transitions the pass exists to record is not a trade worth making, so it is
reverted (`63eeb12`) and the measurement is a comment at the decision site.

**The prediction committed with that change is unscored.** It said the
`projects-id` drift points would disappear and `tasks-id` #4 → #5 would
remain. The crawl was killed once the regression was clear, so that was never
measured — and reporting the routes that had already come in would be reading
a run that was stopped for a reason unrelated to what it was predicting.

Two candidate remedies, named and **not** guessed between:

1. **A longer post-load settle.** If the loss is cold hydration, it is a
   timing constant, and 128 probes × a couple of seconds is a few minutes of
   crawl. Cheap to test and it either recovers the fired count or it does not.
2. **Clear the non-session storage keys, keeping the context warm.** Targeted
   at the measured mechanism. The complication is that the JWT lives in
   `localStorage` (`token`), so a blanket clear signs the crawl out — this
   needs a declared allowlist, in the shape `NON_CONTAMINATING_WRITES` already
   uses.

Which one is right is a measurement, not an argument, and it is the same
mistake as the one this document opens with to pick now.

---

## 4. Open

- **The client-state remedy.** One of §3.8's two, chosen by measuring. This is
  the larger half of the contamination and it is the cheap half to fix.
- **0043's target reset.** Still owed, still required by §6, and now with its
  return measured: **1 of 4** contamination points, one write per 128 probes.
- **The client-state fingerprint and the settledness precondition** (§3.7),
  either of which would move the verdict off `confounded`.
- **The hang.** Zero samples in four crawls, so the rate is below 1 in 4 rather
  than the 1 in 1 the ruling assumed. Instrument in place, nothing to look at
  yet.
