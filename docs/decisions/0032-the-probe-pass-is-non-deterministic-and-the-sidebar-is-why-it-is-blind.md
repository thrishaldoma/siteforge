# 0032 — The probe pass is non-deterministic, and the sidebar is why it is blind

*Status: accepted. Two open defects, both bounded, neither fixed.*

## 1. M1 is not green by its own text

§12: "**M1 — Capture.** … Recrawl is idempotent modulo timestamps." §12 also
says do not start a milestone before the previous one's gate is green.

The idempotence instrument reports **34 of 165 paths** not reproducing on a full
crawl of the pinned Vikunja. So M1's gate does not pass, and it has not passed at
any point in this project's history — the field that was supposed to be the gate
was never compared (0028).

Writing that plainly, because the alternative is the staleness shape this
repository keeps finding: a document that assigns the defect to a future
milestone while calling the current one done. **This is M1 debt, owned by M1.**

## 2. The bound

Measured at commit `72d9bc9`, three fresh containers each time, and re-measured
after the reduced-motion fix (0031 §2.1) landed.

| condition | crawl | paths not reproducing |
|---|---|---|
| full crawl, with probing | 477s | **34 of 165** |
| one container held still, ×2 | 474s | 43 — *worse*, see §2.1 |
| **read-only, no probing** | **51s** | **4 of 81** |

### 2.1 The held-container control perturbs what it holds still

Holding one container across two runs made the count *worse*, and that is a
finding rather than noise: **the crawl is not read-only.** Probing writes rows,
so the second crawl reads the first crawl's mutations. A control condition that
changes its own subject.

The read-only crawl is what separated target from tool, and it is the condition
the baseline is expressed in.

## 3. The read-only residual is four paths and one attribute

Not four mechanisms. Four *paths* carrying one difference:

```
manifest.json                                   (the contentHash below)
network/endpoints.json                          (samples only)
routes/tasks-id--auth-desktop--i0/dom.json      ← the one real difference
routes/tasks-id--auth-desktop--i0/meta.json     (its contentHash)
```

Diffed byte for byte, the whole of it is:

```
- datetime=2026-09-09T23:19:33.000Z
+ datetime=2026-09-09T23:20:25.000Z
```

A `<time datetime>` on the seeded task's created timestamp, 52 seconds apart
because that is how long a run takes. Everything else in all seven routes — every
screenshot, every asset, every inferred schema — reproduces exactly.

**This is target state, and the determinism shim structurally cannot reach it.**
The value was written server-side, by the container's clock, before a browser
existed. §13's taxonomy: a target property to record, not a bug to fix.

So the baseline is **4, not 0**, and the instrument is deliberately red against
it. Compare against 4. Do not exempt the path: an exemption added to make a
report come out clean is fitting the measurement to the answer, and this is the
tool whose entire purpose is to notice that.

### 3.1 Reduced motion did not move it

The 4 was measured before the `prefersReducedMotion` fix and again after. It is
**exactly 4 both times, on the same path, from the same attribute.**

§13: exact non-movement is a stronger signal than a small movement. What it says
here is narrow and useful — the read-only residual was never animation-driven, so
the fix's value is elsewhere (four contexts now do what §6 requires and the
manifest asserts) and the baseline survives the change unmodified.

## 4. What is actually ours: 30 paths, all in the probe pass

`34 (full) − 4 (read-only) = 30`, and every one is under `flows/`. That is our
non-determinism, §8 calls it a hard failure, and it is **not fixed** — measured
and bounded.

Three properties of it, from the run's own numbers:

- the failure rate depends on **position in the loop** (9 fired of 18 attempted,
  4 of 14, 9 of 24 …), which is why every single-shot reproduction of it has
  exonerated every hypothesis put to it (0024);
- the pass **mutates the target**, so runs are not independent (§2.1);
- 71 of 128 driven controls do not resolve at all, and §5 says why.

### 4.1 Owner

**M1.** Not M4. M4's determinism gate is about the *generated clone* — "same seed
+ same action sequence → byte-identical state hash". This is about the capture,
and §12 puts capture in M1. Recording the owner because a defect with no
milestone drifts into permanently-measured-and-tolerated, which is what this
entry exists to prevent.

### 4.2 What runs the check

`verify:clean` cannot absorb 8 minutes, and a tolerated-red gate nobody runs is
`contentHash` again — a check whose absence and whose failure look identical.

So: **read-only, N=2, asserted as an equality against 4.** An equality also fails
when the number *improves*, which is wanted — a drop below 4 means the target
changed or the instrument broke, and both need a person. It is not wired into
`verify:clean` in this turn; the number and the command are recorded here so the
next run has something to disagree with.

## 5. Why 71 controls cannot be driven

The remaining candidate from the scroll discriminator was "a scrollable ancestor
that is not the viewport, or a clipped/transformed container". That is a
**static** question, and the capture already answers it —
`CAPTURED_CSS_PROPERTIES` carries `position`, `overflow-x`, `overflow-y` and
`transform`, `styles.json` has the computed value of each, `dom.json` has the
tree. `packages/capture/scripts/undriveable-ancestors.mjs` reads committed
evidence rather than running a fourth probe experiment, which also means it
cannot perturb the pass §4 is bounding.

Re-measured at `f523c21` after reduced motion landed on both crawl contexts
(0031 §2.1): the total fell 71 → 66, and **every number in this section is
unchanged** — `click/timeout` 51, centre off-screen 49, and the tally below
identical. All five recovered controls are `locate/not-found` (20 → 15), a
different failure. That the layout half did not move by a single control is the
evidence that it *is* layout.

Of the 49 controls that scrolled successfully and stayed off-screen:

```
  49/49  html.light                      overflow hidden/auto
  45/49  aside.is-active.menu-container  overflow auto/auto · transform matrix(1, 0, 0, 1, 0, 0) · position fixed
   2/49  div.project-card                overflow hidden/hidden
   1/49  div.show-project.tasktext       overflow hidden/hidden
```

**45 of 49 sit inside one element** that is a scroll container
(`overflow: auto`), out of flow (`position: fixed`), and transformed — three of
the four properties at once. Vikunja's sidebar navigation.

The mechanical consequence, stated once and not elaborated: **the nearest
scrollable ancestor is not the viewport, and scrolling a `position: fixed`
container's scrollport cannot change where its contents sit in the viewport.**
That is what produces "the call succeeded and the centre is still off-screen"
without any further hypothesis.

Boxes are printed by the script and excluded from that conclusion on purpose:
`dom.json` records `box.x + scrollX` in document coordinates at extraction time,
and the diagnostic's `inViewport` is `getBoundingClientRect` in viewport
coordinates at probe time. Different frames, different moments. Re-deriving
off-screen-ness across them would produce a number that looks like confirmation
and is not.

### 5.1 One mechanism, not two corroborating rows

`receivesPointerEvents: false` is 50 and `inViewport: false` is 49, and the
cross-tabulation is 49 — the same controls. `elementFromPoint` returns null
outside the viewport, so the hit test fails **because** the centre is off-screen.
One fact reported twice through one code path, which is the correction 0026
already had to make once.

### 5.2 The prize is 7, not 45

The 45 are the *same seven* sidebar links re-encountered on all seven routes
(7 × 7 = 49, less the 4 elsewhere). So 45 is what behavioural capture lost and
**7** is how much distinct behaviour a fix would recover. Both are true and they
answer different questions; quoting only the larger one would oversell it.

## 6. The fix — `revealInScrollableAncestor`

Scroll the *ancestor* rather than the element: walk up to the nearest scrollable
ancestor that is not the document scroller, and drive its `scrollTop`/
`scrollLeft` so the element's **centre** lands in the middle of that scrollport.
Centre rather than edge, because the centre is what a click targets and what
`elementFromPoint` is asked about — aligning an edge can leave the centre
outside, which is the state this exists to end.

**The justification is the class, not the count.** Seven distinct controls on
Vikunja understates it: capture could not drive *anything* inside a
`position: fixed` overflow container, and a fixed sidebar over a scrolling pane
is one of the most common layouts on the web. The 45 are what one such container
cost on one small app.

### 6.1 Confined on purpose, so the baseline stays a control

It is in the **probe action path** and deliberately not in a shared locator
helper. The read-only crawl has no probe pass, so its baseline of 4 is only a
control while the change cannot reach it — a shared helper would move both, and a
moved read-only number could no longer tell *the change overreached* from *the
target drifted*. §2.1 is the precedent: an instrument that perturbs its own
subject stops being one.

`diagnoseUndriveable` is untouched for the same reason. It runs after the timeout
and calls `scrollIntoViewIfNeeded` as an instrument; if it began reading a page
the action path had already scrolled, the before/after distributions in §5 would
stop comparing the same thing.

### 6.2 Predicted before running

| | before | predicted |
|---|---|---|
| `click/timeout` | 51 | **falls** — this is the population the fix addresses |
| centre off-screen after scroll | 49 | falls with it |
| `locate/not-found` | 15 | **unchanged** — a different failure, and nothing here touches it |
| read-only idempotence | 4 of 81 | **exactly 4** — the read-only crawl has no probe pass |
| every graded metric | — | at risk, and reported either way: more driven controls means more observed traffic, so `endpoint-identity` and the field categories *may* legitimately move |

A moved read-only number is the signal that the change reached further than
intended, and it would be a finding rather than a nuisance.

## 7. Open

- The 30 probe-pass paths: **unfixed**, owned by M1, bounded here.
- Ancestor scrolling: designed above, unbuilt, and it invalidates §2's numbers
  when it lands.
- `contentHash`'s scope (0031 §2.2) still excludes `flows/`, which is where all
  30 of the unstable paths are. The idempotence tool compares the full artifact
  set and does not depend on it — but anyone reaching for `contentHash` as the
  M1 gate should know it cannot see this.
