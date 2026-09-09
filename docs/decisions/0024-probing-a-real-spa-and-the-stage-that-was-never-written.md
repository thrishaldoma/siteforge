# 0024 — Probing a real SPA, and the stage that was never written

**Status:** accepted
**Date:** 2026-09-09
**Context:** §6 (behaviour probing), 0010 (skipped controls), 0011 (hazards),
0021 (`synthesized-endpoint` vacuous), 0023 (the inference suite)

0021 recorded `synthesized-endpoint` as vacuous and attributed it to the
driver: *"`capture-site.mjs` declares no behaviour probing, so
`flows/skipped-controls.json` holds `controls: []` and there is nothing to
bind. That is this driver's limitation and not the target's."*

The driver now probes. The category is still vacuous, and the reason turns out
to be somewhere else entirely.

---

## 1. What the probe pass does

§6's loop, against the pinned Vikunja: discover candidates from the a11y tree,
event listeners, pseudo-class rules and `cursor: pointer`; classify each by
**who absorbs the harm** (0011); order them with `planProbeSchedule`; fire the
ordinary ones in a fresh page each; record the transition.

The classification moved to `@siteforge/shared` on the way — it was `rung3.mjs`'s
local constants, and two crawlers disagreeing about whether the same button is
safe to press is §13's schema drift with a hazard attached.

**Session-destructive controls get their own login**, as 0011 requires: a
disposable *context* is not enough, because `storageState` carries the cookie
while the session lives on the server, so cloning the crawl's state and clicking
"Sign out" ends the crawl too. Not exercised on this target — Vikunja's sign-out
sits behind a menu and no candidate's accessible name matches the terms, so
`coverage.observed.sessionDestructiveControls` is 0 and that invariant is
vacuous. It is written because the scheduler will hand one over the moment a
target has one, and firing it in the shared context would silently end every
probe after it.

---

## 2. Four defects the first real runs produced

All four were invisible against the rung-3 fixture, and all four are properties
of driving a real single-page app rather than a fixture that holds still.

### Half the probes timed out, and the first two diagnoses were both wrong

The first run reported **33 of 92 probes undriveable**, every one of them a
sidebar link, on every route: `probe-not-driveable: link " Projects": timeout`.

This section is longer than the defect deserves because the *method* is the
part worth keeping.

**Diagnosis one: we clicked before the layout settled.** A standalone script
against the pinned container clicked the same link in **17ms**. `runProbe`
called `settle()` after `goto`, and `settle()` races the *pending response*
list, which on a freshly loaded page is usually empty — so it returned
immediately, and Playwright requires an element to hold the same bounding box
across two animation frames before it will click. Plausible, specific, and
wrong. A fixed `waitForTimeout(900)` was shipped against it and **both runs
fired exactly 59 probes**. That equality is what says the diagnosis was wrong
rather than the fix insufficient — a partial fix moves the number.

**Diagnosis two: the response recorder.** The standalone script lacked
`attachRecorders`, which awaits `response.body()` on every response, and this
target is served by a service worker. Also plausible. Also wrong: with the
recorder and the origin interceptor and the escape guards all installed, the
click took **52ms**.

**What both reproductions had in common is what made them useless.** Each ran
*one* probe. The failure is a function of *position in the loop* — the early
probes on a route succeed and the later ones do not, which is visible in the
run's own numbers (10 fired of 18 attempted, 4 of 14, 5 of 13) and invisible to
any one-shot script. A reproduction that cannot exhibit the failure is not
evidence about the failure, however carefully it controls everything else; it
is the precondition rule from 0019 in a new place, where "reached nothing" and
"reached everything and found nothing" render identically.

**Diagnosis three: `waitUntil: 'networkidle'` on the probe's `goto`.** The
target registers a service worker and polls in the background, so network idle
is not a state it reliably reaches. Shipped, and also wrong — 9 fired of 18
where `networkidle` gave 10 of 18. (Kept anyway: a 15s ceiling on a state that
may never arrive is the wrong shape whatever else is true, and it is faster. It
is claimed as nothing more.)

**Then the guessing stopped.** All three arguments were made against one word:
`operationalKind` reported `timeout` for all 51, which says a clock ran out and
not *which* clock, so it pointed at the click — where a timeout is expected —
and no evidence in the artifact could distinguish the hypotheses. A `step()`
wrapper that labels the operation and rethrows costs three lines. One run:

```
by operational kind:  { 'click/timeout': 51 }
```

It is the click, definitively, and never was the navigation. Three lines of
instrumentation were cheaper than the fourth hypothesis, and §13 now carries
the rule.

**What remains unexplained is left unexplained**, which is the point of having
measured it. The click times out for roughly half the controls, the same
controls click in 17ms in isolation, and the rate depends on position in the
loop. Each one is recorded as `precondition-unmet` carrying `click/timeout`, so
the claim in the artifact is exactly what is known: this control was fired and
would not move. Not a guess about why.

### A budget on successes does not bound anything

`MAX_PROBES_PER_ROUTE` capped *successes*. An undriveable control still costs a
page load plus the click timeout and consumes no budget, so on
`/user/settings/general` — 668 distinct candidates — the loop would have kept
trying for over an hour to land its twelfth success. The run had to be killed.

Bounding successes bounds the **output**; bounding attempts bounds the **cost**.
`MAX_ATTEMPTS_PER_ROUTE` is the one that makes the pass terminate, and a probe
pass whose runtime is a function of how undriveable the page is will always be
the one that gets killed and then quietly disabled.

### An SPA that navigates while you are navigating to it

The anonymous re-issue pass crashed: `Navigation to ".../login" is interrupted
by another navigation to ".../login"`. The bundle redirects itself the moment it
finds no token, so the `goto` races the page's own navigation.

Tolerated **narrowly** — only the interruption, and the landing is then asserted
rather than assumed. A blanket catch here would be the §13 failure with real
consequences: a probe page that never loaded makes every anonymous verdict
`unknown`, and §8 resolves `unknown` for a read to *required* only because this
sweep is trusted to have run.

### A rejection with nowhere to go

`attachRecorders` awaits `request.allHeaders()` on every response. A probe ends
by closing its page, and a body still arriving at that moment makes it reject —
into a promise nothing awaits any more, because `settle()` has already spliced
it away. An **uncatchable** crash, which killed a 25-minute run at
`request.allHeaders: Target page, context or browser has been closed`.

Every rejection is now terminated in the handler. A closed page is operational
and the lost exchange is **counted**, because a dropped observation is the
failure mode this whole project is organised around and a swallowed one is
invisible; anything else becomes a finding, which fails the run at the end.
Throwing is not available here — an event handler has nowhere to throw except
back into an unhandled rejection, and §13's "defects must propagate" has to be
served some other way when the stack cannot carry them.

Measured on the clean run: **3** observations lost, out of 1608.

---

## 3. A control that was fired and would not resolve

`SkipCauseSchema` already had `precondition-unmet` for this and there was no gap
category to point its required `gapId` at; rung 3 filed it under
`destructive-action-skipped`, which is a false claim about a control whose only
problem is a missing precondition. Added `interaction-not-reproducible` (§14:
fix the schema rather than work around it).

The consequence is that an undriveable control is now **structured** rather than
a console line: role, name, nodeId, route and gap, in
`flows/skipped-controls.json`. §7.6 can look for its handler in the captured
source; it cannot read a finding.

---

## 4. The finding that matters: §7.6 does not exist

`skipped-controls.json` is populated. `synthesized-endpoint.precision` is still
vacuous, and 0021's attribution was wrong — not because the driver was fine, but
because fixing the driver was never sufficient.

**`packages/infer` has no code path that can emit `bound-from-control`.**
Verified two ways:

- `readCapture` loads `manifest.json`, `network/endpoints.json` and `routes/`.
  It never opens `flows/`, so the skipped controls are not an input to the stage
  meant to bind them.
- `operations.ts` writes `discovery: { kind: 'observed' }` as a literal, on
  every operation. There is no branch that produces any other kind.

So the category is not vacuous because no control was skipped. It is vacuous
because **the stage that would bind one was never written**, and it would have
stayed vacuous with a hundred controls in the file. That is a third kind of
cause, and it is worth separating from the two 0021 named:

| cause | example | permanence |
|---|---|---|
| the target's document | `narrowing` — Vikunja declares no formats | until the target changes |
| the driver | *(what 0021 thought this was)* | work not yet done |
| **an unimplemented stage** | `synthesized-endpoint` — §7.6 | work not yet done, in a *different package* |

The distinction is not pedantry: someone reading 0021 goes looking at
`capture-site.mjs`, finds probing, and concludes the number should have moved.

### And it would not bind much on this target anyway

Recorded so the next attempt is not a surprise. §7.6 binds by reading
`<form action>` and `fetch()` literals out of the captured source. Vikunja is a
compiled SPA: its two target-destructive controls are Vue click handlers in a
minified bundle, there is no `<form action>` behind either, and
`capture-site.mjs` writes the asset *index* but not the asset *bodies* — so the
bundle is not on disk to search. Implementing §7.6 against this target means
first deciding whether capture stores script bodies at all.

---

## 5. Measured

Against the pinned digest, 7 routes:

```
routes                7
flows                66      57 completed, 9 skipped
  with network calls 13
  changed the URL    16
probed states        50      JS-driven, absent from the CSSOM — §6's actual purpose
skipped controls     60      51 precondition-unmet, 7 out-of-scope, 2 target-destructive
budget-declined     659      almost all of them /user/settings/general's 668 candidates
endpoints            22      up from 16: probing found 6 the crawl never reached
API exchanges      1608      up from 96
observations lost     3      to a page closing mid-response
coverage invariants   0 broken
```

Two results beyond the stated goal. **Probing found six endpoints the crawl
never reached** — firing controls is a discovery mechanism for the API surface,
not only for `flows/`. And **50 probed state deltas**, each a change no
extracted CSSOM rule explains, which is the case §6 reserves probing for in the
first place.

The two target-destructive controls are `button "DELETE"` on the task route and
`link "Delete your Vikunja Account"` on user settings. Those are what §7.6 has
to bind, and §4 is why nothing binds them.

---

## 6. What the richer capture did to the grade

Probing raised the capture from 16 endpoints to 22, and the scores moved
accordingly. Two are worth reading.

**`entity-identity.precision` fell to 0.6000 (3/5), with one ambiguity:**

```
ambiguous: models.Task ← All | Task
```

Infer emitted **two** entities for one declared definition. `/api/v1/tasks/all`
names one `All` and `/api/v1/tasks/:task` names the other `Task`, and
`dedupeRows` keeps them apart because their scalar field sets differ — the list
view returns fewer fields than the item view.

That is exactly the under-merge 0023 §2 built the ambiguity rule for, and 0023
§5 could only demonstrate it by *ablation*, on a model produced with dedup
switched off. **It now fires on the real model, unmodified.** 0023 recorded the
exactness of `shapeIdentity` as a deliberate choice — "splitting is free;
merging must be justified", because an over-merge makes valid states
unrepresentable while an under-merge only makes the model longer. That argument
still holds; what has changed is that the cost of the conservative direction now
has a number on it instead of being asserted.

**`response-field-presence.precision` fell from 0.9553 to 0.4538.** Not a
regression: the crawl now reaches 22 endpoints instead of 16, and the six new
ones are the ones probing found — mutation responses and settings payloads whose
shapes the document describes differently from what the server sent. A wider
surface is a harder one, and a precision that only looked good over the easy
sixth of it was not telling us much.

`endpoint-identity.precision` crossed its gate the other way, 0.9375 → 0.9545,
because the single drifting path (`/avatar/sfadmin`) is now one miss in 22
rather than one in 16. That is a denominator moving, not an improvement, and it
is worth naming as such.

---

## Open

- §7.6 itself. It needs a decision about whether capture writes script bodies
  (§3.4 treats `capture/` as sensitive and a bundle is large), and a realistic
  view of what can be bound out of a compiled SPA.
- `MAX_ATTEMPTS_PER_ROUTE` is 24 against 668 candidates on one route. The
  budget-declined count is reported precisely so a shallow pass is visible, but
  it is a large shortfall and the right fix is probably a better candidate
  filter rather than a bigger number — most of those 668 are `cursor: pointer`
  spans in a timezone list.
- No `--responsive` pass, so every probe is at 1280×800.
- The probe pass fires `click` only. §6's action vocabulary is wider, and a
  `textbox` candidate is discovered and then never typed into.
