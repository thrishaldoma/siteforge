# 0038 — The baseline was a coin that came up heads three times

*Status: accepted. One gate landed (`claimExceeded`), one baseline corrected,
one mechanism open and bounded.*

Two questions were asked separately and they stayed separate, which was right:
the attribution of 4 → 7 turned out to have nothing to do with the scope of
`contentHash`, and each answer would have been muddied by the other.

---

## 1. `verify:clean` was red at HEAD, and the cause is worth one paragraph

`ad35d63` — the previous turn's last commit — added the out-of-flow ancestor
field inside `revealInScrollableAncestor`, which moved the context lines
`sabotage/driver-does-not-parse.patch` was anchored against. The patch stopped
applying and the harness failed it, as §13 requires ("a patch that no longer
applies … `3 skipped` tells you nothing about those 3").

Regenerated: the patch drops **the same character**, the closing paren of the
`page.evaluate` call, and `node --check` reports the same
`SyntaxError: missing ) after argument list`. Only the context moved.

Recorded because the *category* matters for §5's assessment: this is apparatus
maintenance triggered by an ordinary product commit, not a defect the apparatus
caught. It is a cost, and it is on the cost side of the ledger there.

---

## 2. Attribution: not load, not cold start, and the baseline of 4 was luck

### 2.1 Predicted first

Written before the run, per 0032 §6.2:

| hypothesis | prediction at N=5, read-only, fresh container, quiet host |
|---|---|
| **H1** host cold-start | 7 unstable; run-1 odd; runs 2–5 identical |
| **H2** load | 4 unstable; all five runs agree on every PNG |
| **H3** per-run raster noise | >2 distinct hashes, or the odd run is not run-1 |

### 2.2 Measured

Load average 1.6–1.8, nothing else running, five crawls at 50.6s each — the
same 51s 0032 recorded, so the host was in the same condition the baseline was
taken in.

**7 of 81.** H2 is refuted: the machine was quiet and the number did not move.

**The odd run is run-3.** H1 is refuted: there is no first-run effect.

So H3, but sharper than "noise". Across the five runs the two scroll
screenshots take exactly **two** values, and run-3's are byte-identical to the
values *last turn's run-1* produced:

```
scroll/0000.png   run-1 f0cb51b8  run-2 f0cb51b8  run-3 51e2700c  run-4 f0cb51b8  run-5 f0cb51b8
scroll/0001.png   run-1 528f4d13  run-2 528f4d13  run-3 8a915b48  run-4 528f4d13  run-5 528f4d13
shot.full.png     identical in all five
```

Eight read-only crawls are now on record across two sessions. Six landed in one
state, two in the other. **This is bimodal, not drift** — two stable raster
outcomes, no third value in eight draws, and the choice is made per crawl.

### 2.3 What the difference actually is

Decoded and differenced pixel by pixel rather than reported as "the file
changed":

- `scroll/0000.png`: **15 pixels.** `scroll/0001.png`: **36 pixels.**
- Every one is **±1 in one or two channels**. No pixel differs by 2.
- Every one lies on the **rounded corner of a `<select>` box** — two of the six
  on the page, at document y 766–801 and y 923–958. Both screenshots show the
  same document region, so it is one element pair seen twice.
- Within a run the two shots always agree on which state they are in, so the
  state is fixed **per page load**, not per screenshot.

`user-settings-general` is the **only route of the seven with any `<select>`
element at all** (six of them; every other route has zero). So this is not "one
route in seven is flaky" — it is the only route carrying the affected widget.

This is a rasteriser antialiasing difference. It is **ours**, not the target's:
no bytes crossed the wire differently, `dom.json` and `styles.json` for this
route are byte-identical in all five runs, and the server never saw the
difference. It is not animation — 0032 §3.1 already measured that reduced
motion moves this number by exactly zero.

### 2.4 The baseline correction, which is the real finding

0028 and 0032 both record **4 of 81** and 0032 §4.2 turns it into an assertion:
"read-only, N=2, asserted as an equality against 4."

That number was measured at N=3, and at N=3 all three crawls happened to land in
the same raster state. **A uniform sample of a bimodal variable reads exactly
like a constant** — this is the repository's own precondition rule (0019, 0026)
arriving in a place nobody was looking for it, because the failure mode and the
expected output are the same output.

So the honest baseline is not a number:

> **4 paths always differ** (the `<time datetime>` on the seeded task, written
> server-side before a browser existed — 0032 §3, unchanged and still the
> target's).
> **3 more differ whenever the run set draws both raster states**, which any
> sufficiently long run set does.

And 0032 §4.2's proposed gate — an equality against 4 at N=2 — would have been
**a coin flip wired to a red light**. It fails whenever the two runs disagree and
passes whenever they agree, and neither outcome is about the crawler. Not
landed, and this is the reason it must not be landed in that form. Recorded here
before anyone reaches for it.

### 2.5 What is still open, and what it is not

The mechanism that picks the state. It is per page load, confined to one widget
type, and stable in its two outcomes — which is enough to bound it and not
enough to name it. Deliberately **not** guessed at: 0032 §5 spent a decision
document on a mechanism read off a computed style and had to retract it in §6.3,
and the discipline that came out of that (0032 §6.5, §13's computed-value rule)
says the next step is an instrument, not a fourth hypothesis.

It is **M1 debt**, like the 30 probe-pass paths, and it is smaller than them:
51 pixels on one route of one target.

What it is *not* is a reason to widen `contentHash`. See §3.

---

## 3. `contentHash`'s scope: narrowed, and a sibling covers the rest

0031 §5 left this open as "widen the derivation or rename the field. Breaking
either way." It is neither.

### 3.1 The evidence, which decides it

The same three preserved trees say it in one line:

```
content.contentHash   c304d067…  c304d067…  c304d067…     ← identical
scroll/0000.png       51e2700c   f0cb51b8   f0cb51b8      ← not
```

The field certifying that route's determinism reproduced while two of the
route's own screenshots did not, and `meta.json` — which records the PNG
digests — moved with them. That is the whole of the user's objection, on
committed evidence.

### 3.2 Narrowed, and the argument is mechanical rather than aesthetic

Two reasons, and the first is the one that actually forecloses widening:

1. **`contentHash` is a deduplication key, not only a certificate.**
   `RouteContentSchema`'s `shared` arm points one route at another and
   `CaptureModelSchema` rejects a mismatch, with the reason in its own comment:
   *"or the shared-content pointer would deduplicate pages that are not equal."*
   Two contexts rendering one page identically **must** agree on it. §2 has just
   measured a per-page-load coin flip in the rasteriser, so folding rasters in
   would break dedup for pages that are equal, and grow an artifact set §5 works
   hard to keep small. Widening is not expensive here; it is wrong.

2. **The two halves have different residuals, and only one supports an
   equality.** `dom`/`styles`/`states` reproduce **exactly** — 81 paths, five
   runs, zero difference outside the target's clock. So `contentHash` is a
   legitimate equality with no slack. The rasters are not. A hash over both
   never reproduces, and a gate that fires on every run is filed by §13 *with*
   the vacuous ones, not opposite them: never-fires and always-fires are two
   ways of not discriminating.

The prompt's own reasoning — pixel output has different stability properties —
is right, and these are the two properties, measured.

Narrowing also sidesteps 0031 §2.2's objection entirely. **No existing capture's
value changes and nothing is renamed**; a docstring stops overclaiming and a
sibling check appears. The artifact contract is untouched.

### 3.3 The sibling: `claimExceeded`

`assessCaptureIdempotence` gains one finding. Per route it is handed the hash
each run recorded and the partition of that route's files into what the hash is
computed over and what it is not, and it reports the **conjunction**:

> the hash was identical across every run **and** an artifact it does not cover
> was not.

Three properties, each earned by a §13 rule:

- **The conjunction is the content.** Without it the finding is a second copy of
  `unstable` — on the real trees it would also report `tasks-id`, whose hash
  *did* move and which therefore misled nobody. That is the negative control,
  and it is what `sabotage/claim-check-drops-the-conjunction.patch` deletes:
  dropping the guard removes no path from the output, only adds routes, so it
  reads as tidying rather than widening. The assertion is on the discriminating
  case, because under the bug the finding is still non-empty and still names the
  real route.
- **The partition is derived, not typed out.** `ROUTE_CONTENT_HASH_INPUTS` is
  exported from `packages/schema` and **iterated by `deriveRouteContentHash`
  itself**, so the list is the derivation rather than a description of it. A
  fourth input moves the checker's covered side the day it lands. Two hardcoded
  copies in two packages is 0031 §2.4's duplicated-derived-value drift.
- **`claimsSupplied` is reported.** `claimExceeded: []` means "nothing exceeded
  its claim" only if something was checked; otherwise it means "nothing was
  checked", and the two render identically (0019). The count is what separates
  them.

It fires on the real evidence, naming exactly one route:

```
contentHash agreed and something it does not cover did not (1):
  user-settings-general--auth-desktop--i0  c304d067ec1f…
    …/meta.json  …/scroll/0000.png  …/scroll/0001.png
contentHash claims checked: 7
```

### 3.4 No field-of-view entry, on 0037's own rule

The claims arrive as **parameters**. 0037: *"a gate handed its subject as a
parameter has no selection to get wrong, and declaring a blind region for it is
padding."* The existing `assessCaptureIdempotence` declaration covers the
tree walk, which is unchanged. Stated because the absence of an entry beside a
new finding is otherwise the kind of thing a later audit reads as an oversight.

### 3.5 What is deliberately not built

**Magnitude.** The gate compares digests, so a ±1-LSB wobble on 15 pixels and a
completely different page are the same finding. That cost something real this
turn: three paths read as "the crawl got less deterministic" when they are 51
pixels of antialiasing, and the framing of this entire item followed from the
digest rather than from the difference.

A classifier that decoded the rasters and split *sub-pixel* from *divergent*
would fix it. It is **not built**, on purpose, and this is the reason: it needs
a tolerance, a tolerance chosen to accommodate the 15 and 36 we just measured is
fitting the measurement to the answer, and 0032 §3 already refused exactly that
move ("do not exempt the path"). It wants a distribution from more than one
target before it gets a number. Named here so it is tracked rather than
remembered.

---

## 4. Open

- The raster state's mechanism (§2.5). M1 debt, bounded at 51 pixels on one
  route, instrument-first when it is taken.
- 0032 §4.2's "equality against 4" must not be landed as written (§2.4).
- Magnitude classification in `claimExceeded` (§3.5).
- `crawl.sameOriginOnly` — still 0031 §5's, untouched here.
