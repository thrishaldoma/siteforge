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

*(to be written from the run)*
