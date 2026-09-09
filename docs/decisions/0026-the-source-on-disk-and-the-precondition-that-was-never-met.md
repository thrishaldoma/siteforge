# 0026 — The source on disk, and the precondition that was never met

**Status:** accepted
**Date:** 2026-09-10
**Context:** §3.4 (the scrubber is a gate), §5 (`assets/`), §6 (persist every
response body; behaviour probing), §7.6 (binding skipped controls), §13 (a
reproduction that cannot exhibit the failure; an error taxonomy needs the
operation), 0024 (probing a real SPA)

Two rulings, and they turn out to be the same shape: **an artifact that
described something it did not contain, and an error that named a symptom
instead of a condition.** In both cases the fix was to record the fact rather
than to argue about it.

---

## 1. The index described a file that was never written

`assets/index.json` gives every asset a `localPath` of
`assets/files/<sha256>.<ext>`. The driver hashed each response body, recorded
its length, and **threw the bytes away**. So the path named a file that did not
exist — for every asset, in every capture this driver has ever produced — and
nothing failed, because nothing had ever opened one.

§6 is explicit: *"persist **every** response body content-addressed by
sha256."* This was not a judgement call that went the other way; it was a line
of the manual that had never been implemented, wearing an index that made it
look like it had.

The cost landed on §7.6. Binding a skipped control means finding its handler in
the captured source, and 0024 §4 concluded the source was unavailable on this
target — *"`capture-site.mjs` writes the asset index but not the asset bodies —
so the bundle is not on disk to search."* That half was right. The other half of
that paragraph was pessimism, and §4 below measures it.

**Three drivers had the same defect**, which is why the writer is now one
function in `capture-lib.mjs` rather than a loop in each: `capture-site.mjs`,
`rung3.mjs` and `spike-one-page.mjs` all hashed the body and dropped it, and the
spike's own comment above the map read *"Content-addressed asset capture (§6:
persist every response body)"*. Whether an asset is text the scrubber may
rewrite is a judgement two crawlers must not be able to disagree about — §13 has
been bitten by that once already, over whether a button was safe to press.

### The gate that would have caught it

`assessAssetBodies` reconciles the index against a `readdirSync`, **both ways**:
indexed-without-file, file-without-entry, and stored-bytes-that-do-not-hash-to-
what-the-entry-claims. Both ways and not as counts — §13's scope rule in a
smaller place, because one missing file and one orphan is a green total over two
real defects.

The disk side is a directory listing rather than the writer's own record of what
it wrote. A writer checked against its own log agrees with itself whatever it
actually did, which is the same failure as a coverage invariant counting its
input with the extractor's parser (§6).

---

## 2. Content addressing and redaction pull against each other

§3.4 requires the scrubber to redact before any artifact is written. §6 requires
bodies content-addressed by sha256. A redacted bundle does not hash to the name
it is filed under, so one of the two claims has to give.

**The file keeps the wire hash**, and the divergence is recorded rather than
resolved. That hash *is* the asset's identity — it is what `assetId` holds, what
dedup keys on, and what a `referencedBy` entry resolves through — so renaming
the file after redaction would break the index to preserve a property nobody
reads. `AssetEntry.stored` carries `verbatim` or `redacted { sha256, bytes,
redactions }`, so a reader who hashes the file and finds a mismatch is reading a
stated fact instead of discovering a bug. `AssetEntrySchema` also recomputes
`localPath` from `sha256` — the claim that went unchecked in the first place.

**Text only, and the argument is not "binary is safe".** A string substitution
run over a JPEG replaces bytes inside a container and produces an image that no
longer decodes, so `isTextualAsset` decides by mime and binary is stored
verbatim. That is not a hole in §3.4: `scanCaptureTree` reads every file as
latin1, binary included, so a credential in an image **fails the run** rather
than being silently rewritten. Redaction is what we do where we can do it
without destroying the artifact; failing is what we do everywhere else.

The scrub itself round-trips through **latin1**, not utf8. latin1 is a bijection
between bytes and code points 0–255, so every byte the patterns do not match
comes back exactly as it went in — a bundle that is not valid UTF-8 is not
quietly rewritten into replacement characters on the way through. The patterns
are ASCII, so nothing is lost by decoding this way.

### Measured

46 files, **2.8MB**, of which 27 are the SPA's script chunks. One redaction
fired: **three email addresses inside the main bundle**, `index-BdIWn3Ve.js`.
That is the case the ruling anticipated, and it is the difference between a
scrubber that is wired in and one that is dead code on this path.

`secrets: clean (§3.4)` over the enlarged tree — the scan now covers 2.8MB of
minified JavaScript it had never seen.

---

## 3. Instrument, do not diagnose

0024 §2 records three consecutive wrong diagnoses of the probe timeouts, each
argued from one word: `operationalKind` reported `timeout` for all 51. `step()`
answered *which clock* — `click/timeout`, never `goto`. This is the next
question down, and it was not going to be answered by a fourth hypothesis.

**What is recorded per timeout is not a guess at the answer.** They are
Playwright's own actionability conditions, which are precisely what `click`
blocks on: the element must be **visible**, **stable** across two animation
frames, **receiving pointer events**, and **enabled**. A timeout means one of
those never became true, and recording all four says which. Beside them:
whether the centre point was in the viewport, whether a main-frame navigation
was in flight, what `elementFromPoint` returned, and `attemptIndex` — position
in the route's probe loop, the one variable no single-shot reproduction can
vary and the one the per-route counts pointed at.

`null` is kept distinct from `false` throughout. A check that could not be made
because the element detached is not a check that came back negative, and
collapsing the two would make "we could not look" read as "it was not visible"
in exactly the summary the whole exercise exists to produce.

### The distribution

70 undriveable controls on the pinned digest, 51 of them `click/timeout`:

```
step              click/timeout 51 · locate/not-found 19
visible           true 51 · null 19
stable            true 51 · null 19
receives pointer  false 50 · null 19 · true 1
enabled           true 50 · null 19 · false 1
in viewport       false 49 · null 19 · true 2
navigation open   false 70
occluded by       centre is outside the viewport 49 · (nothing) 20 · svg 1
attempt index     4-7 27 · 8-11 25 · 20-23 8 · 16-19 5 · 12-15 3 · 0-3 2
```

**49 of 51 timed-out clicks are on an element whose centre point is outside the
viewport.** Visible, stable and enabled the entire time — and off-screen, so it
cannot receive a pointer event, which is the condition `click` is waiting on.

**That is one observation, not two.** The `in viewport` row and the
`centre is outside the viewport` row both read 49, and they agree because the
second is *derived from* the first — `elementFromPoint` returns null when the
point is off-screen, so the occlusion field reports which of the two reasons for
null applies rather than measuring anything independently. Reading the matching
counts as corroboration would be the §13 failure about an invariant whose two
sides share a code path, committed in the write-up of a tool built to avoid
guessing. The finding does not need the inflation: one measurement of 49 of 51
is enough.

Three claims are now **excluded by observation** rather than by argument:

- *the layout had not settled* — `stable` is true in all 51, measured as two
  bounding boxes 150ms apart;
- *a navigation was interfering* — `navigationPending` is false in all 70;
- *the element was not there yet* — `visible` is true in all 51, and the two
  genuine outliers are one disabled control and one covered by an `svg`.

### The discriminating measurement, and what it rules out

The obvious next question — *can it not be scrolled into view, or does it scroll
and get intercepted?* — is one measurement rather than a fourth hypothesis. The
probe now calls `scrollIntoViewIfNeeded` after the failure and looks again:

```
scrollIntoView    succeeded 51 · (not attempted) 19
in view after     false 49 · null 19 · true 2
occluded after    (nothing) 69 · svg 1
```

**`scrollIntoViewIfNeeded` succeeded on all fifty-one, and forty-nine centres
are still outside the viewport afterwards, with nothing on top of them.**

Both candidate explanations are out. It is not that Playwright cannot scroll the
element — the call resolves, every time. It is not that it arrives and something
intercepts — after the scroll, sixty-nine of seventy report nothing at the
centre point at all, and the one exception is an `svg`.

What is left is narrower and entirely mechanical: **the scroll reports success
and the element's centre remains off-screen.** That is the signature of an
element whose position no scroll can change — inside a clipped or transformed
container, or one whose scrollable ancestor is not the viewport — so
`scrollIntoViewIfNeeded` correctly finds nothing to scroll and returns, while the
element never becomes clickable.

**Why it is that, on this page, is still not established here**, and the ruling
is the reason: three diagnoses were wrong and a fourth would cost more than the
unknown. What has changed is that the question now has one candidate rather than
three, and answering it means reading the SPA's layout for those controls rather
than reasoning about Playwright.

### Two defects in the instrument itself

`navigationPending` was a required boolean until rung 3 — a second producer,
which does not track navigations — had to emit one. Forcing `false` there would
record an observation nobody made in order to satisfy a type, so it is nullable
like the four beside it. "We did not look" is a third value and the schema has
to be able to hold it; that is the same argument `requiresAuth` is built on, one
artifact over.



The first pass compared `elementFromPoint`'s rendered description against the
target's and reported `span.button-text` and `svg` as occluders — the element's
own children, which is what a hit test on a button with an icon inside it
returns. A descendant is not something painted on top. `el.contains(hit)` is the
question, and comparing descriptions was a string stand-in for it — the
substring-for-token family from §13, found in a tool written to avoid guessing.
`inViewport` was also the whole box and is now the **centre point**, because the
centre is what a click targets.

### The ceiling is a coverage number, and deliberately not an invariant

`coverage.extracted` now carries `controlsFired` and `controlsUndriveable`, and
the run prints the ratio beside the crawl's other coverage. 49 of 51 timeouts
caps what §6 can observe, what §9's behavioural gate can ever replay, and what
§7.6 has to recover from source instead — which belongs next to crawl coverage
rather than in a findings list.

**No coverage invariant is attached, and the absence is a decision.** Every
invariant in that table has the same shape: *the input held X, so the output
must hold Y* — they catch extraction dropping something it was given. "Probing
must succeed" is not that. It is an assertion about the **target's**
driveability, and a target where nothing is clickable would fail a check that is
supposed to be about us. The numbers are recorded so a human can see the ceiling
move; nothing gates on them.

### And a silent drop next door

19 controls were `locate/not-found`: discovered on the captured page, absent
from the freshly loaded one. **Nothing recorded them.** `runProbe` returned
`false`, and the only caller that looked at the return was the
session-destructive branch. They are now `precondition-unmet` with a diagnostic
saying the element was never located, which is why the skipped-control count
went from 60 to 79 without the target changing.

---

## 4. §7.6 is feasible on this target after all, and 0024 said otherwise

0024 §4 closed with: *"Implementing §7.6 against this target means first
deciding whether capture stores script bodies at all"* — and, before that, that
the two target-destructive controls are *"Vue click handlers in a minified
bundle"* with no `<form action>` behind either.

The decision is made and the bodies are stored. What that makes visible is that
the second worry was overstated: **minifiers rename identifiers, not string
literals.** The main bundle carries its route table intact —

```
"/tasks/{id}"  "/tasks/{taskId}/comments"  "/tasks/{taskId}/labels"
"/tasks/{taskId}/attachments/{id}"  "/tasks/all"  "/tasks/by/upcoming"
```

— so a path literal is exactly as recoverable from a compiled SPA as from
readable source. What minification destroys is the *link* between a literal and
the control that calls it, which is the real difficulty and a different one:
finding `/tasks/{id}` in the bundle does not say the DELETE button calls it.

§7.6 is not implemented here. What has changed is that its input exists and its
difficulty has been measured rather than assumed.

---

## 5. Which kind of vacuity, in the terms §13 now has

The taxonomy landed this turn, and `synthesized-endpoint` is the case it was
written for. Applying it:

| category | cause | evidence |
|---|---|---|
| `synthesized-endpoint` | **unimplemented stage** | `flows/skipped-controls.json` holds 79 controls and `packages/infer` still has no code path emitting `bound-from-control`. Input full, output empty |
| `narrowing.precision` | **target limitation** | the document contains zero occurrences of `format` |
| `entity-relation.*` | **target limitation**, plus a SiteModel gap | Swagger 2.0 declares no scalar foreign keys, and the one association it does declare is an array `RelationSchema` cannot express |
| `entity-narrowing.precision` | **driver limitation** — see §6; the classification below was wrong | the ladder declined, but its *primary* evidence rung never reached it |

Only the two marked *target limitation* are permanent.

### The fourth cause: declined on evidence

*(The row above used to read `declined on evidence`. §6 measured why that was
wrong, and the correction is left visible rather than edited away: the reasoning
below is right, and its application to this category was not.)*

All three causes §13 names are about **work not done** — by the target, by the
driver, or by the product. `entity-narrowing.precision` is none of them: §7.5's
enum ladder ran over the merged entity's fields and emitted no narrowing, which
is a stage that worked and produced no claim.

That is a real distinction and not a quibble, because the two states demand
opposite responses. Work not done is a thing to go and do. A producer that
declined is only a problem if the decline was *wrong* — and §7.5's whole design
is that declining is the free direction, so a category empty because nothing met
the evidence bar may be the ladder working exactly as specified. 0025's Open
section leaves that question open for `models.Task.repeat_mode` specifically,
and this row must not quietly answer it by filing the category under a cause
that implies missing code.

**So: when a category is vacuous, first ask whether the producer never ran or
ran and declined.** Only the first three apply to the former, and they all mean
somebody has work to do; *declined on evidence* means nobody does, and filing a
decline under one of the other three sends the next reader to a package with
nothing wrong in it. §13 now carries the fourth cause by that name.


---

## 6. The enum ladder's primary rung never reached it, and that changes §5

The open question from the turn before this one was whether Vikunja's crawl
reached any `<select>` or fixed option set — because `narrowing.recall 0.0000
(0/9)` and `entity-narrowing.recall 0.0000 (0/1)` are floors rather than
results if the UI-constraint evidence is not in the capture. Cheap to check, and
the answer is not the one either alternative anticipated.

**The evidence is in the capture. It is destroyed on the way out.**

The captured DOM holds **6 `<select>` elements with 632 `<option>` descendants
and 14 checkboxes**, all on `/user/settings/general`. The number of
`uiConstraint` records that reach any narrowing is **zero**.

The extractor is `document.querySelectorAll('select[name], select[id]')`. Every
one of Vikunja's six selects carries exactly one attribute:

```
{"data-v-321f61a6":""}
```

A Vue scoped-style marker. No `name`, no `id` — the framework binds through
`v-model`, which is compiled away. The selector matches **none of six**.

So this is a **model-side floor, not a target property**, which is the
distinction the question was asked to draw. §7.5 calls the UI constraint "the
primary evidence and the only kind that is actually ground truth", and on this
target it is discarded before inference sees it. The ladder ran on rungs two and
three alone.

**What that does to §5's table:** `entity-narrowing.precision` was filed as
*declined on evidence*, and it is not — a producer that declined because its
best evidence was withheld has not made a principled decline, it has been given
a worse input. The cause is a **driver limitation**, and the row is corrected
above. This is the fourth cause's first application and it was wrong, which is
worth keeping: the discriminator for *declined on evidence* is not "the rule
returned nothing", it is **"the rule returned nothing and had everything it
needed to say otherwise."**

Whether rung one would have fired for those nine document-declared enums is
genuinely unknown — it depends on whether the six selects constrain fields the
API returns — and that is not a question to answer by assertion.

### Extracting them and binding them are two problems, and only one is cheap

Widening the selector to catch an unnamed `<select>` is a one-line change. It
buys nothing on its own, because `uiConstraints` is a `Map` keyed by
`name.toLowerCase()` and matched against the API field name — with no `name`
attribute there is no key to match with, and the record would have nowhere to
attach.

Binding an unnamed control to a field is the real problem and it is a design
question: the label text, the `aria-label`, the `v-model` target that
minification destroyed, or the value overlap between the option set and the
field's observed values. The last is the only one that is an observation rather
than a naming guess, and it is the same argument §7.5 makes about foreign keys.
Not decided here.

---

## Open

- Why an element whose scroll *succeeds* stays off-screen. One candidate — a
  clipped or transformed container — and it is answered by reading the SPA's
  layout for those controls, not by another probe-side experiment.
- §7.6 itself: the input is on disk and the hard part is linking a literal to
  the control that calls it, not finding the literal.
- Asset bodies are stored but no `referencedBy` is populated, so the index still
  cannot say which route pulled which chunk.
- Binding an unnamed `<select>` to an API field (§6). Extraction is a line;
  the binding is a decision.
- 659 budget-declined candidates, almost all of them one settings route's 668.
  A better candidate filter, not a bigger number.
- **`locate/not-found` read 16 on one run and 19 on the next, against an
  unchanged pinned digest.** Small, and it is a non-determinism in a pipeline
  whose §8 acceptance test is a byte-identical state hash. Not chased here; the
  probable cause is which controls the SPA has rendered by the time the fresh
  page is queried, which is the same family as the timeouts above.
- `mergedFrom.sources` puts the container's endpoints first, and `entityNameFor`
  reads the first one — so the ordering is load-bearing and pinned only for the
  two-row case. A third row folding into one container would keep the name and
  reorder the record.
