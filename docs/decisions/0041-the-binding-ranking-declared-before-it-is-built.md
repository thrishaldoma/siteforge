# 0041 — §7.6's ranking, declared before it is built

*Status: accepted. §§1–5 were committed at `8b48122`, before any code; §7 is
what the run returned. Every predicted number was exact.*

0030 declared the shared record and the *select-binding* ranking. This declares
the **URL** ranking — §7.6 — under the rule the ladder restructure produced
(0033 §4.2, §13): **no precondition above the ranked branches. A condition that
can veto the top branch is a ranked entry.**

---

## 1. One mechanism, and what "one" means here

0030 §1 settled it: *"the shared thing is a record, not a function."* Two
problems, one shape, different rung tables — because the rungs genuinely differ
(a URL binding reads DOM attributes; a field binding compares option values to
observed request values) and pretending otherwise would be the shared-docstring
mistake.

So what is shared and built once:

- **`ControlBinding`** — `controlId`, a discriminated `target`
  (`{kind:'url'}` / `{kind:'field'}`), `evidence[]` with **every rung that
  fired**, the winning `rank`, and the carried `gapId`.
- **`assessControlBindings(controls, rungs)`** — the ranked evaluator. Runs
  rungs in rank order; the first rung to return a verdict decides; every rung
  that fired is recorded, not only the winner. That is `NarrowingRecord`'s rule
  (§13: a derived field carries the evidence it was derived from) and the reason
  is the same — *"rank 2 agreed with rank 4" is a different claim from "rank 2
  fired"*.

A rung returns one of three things, and the three-way is load-bearing:
`bind` (a target), `decline` (this control gets no endpoint, ever — a *decided*
outcome), or `null` (this rung has nothing to say). Collapsing decline into
null would make an out-of-scope control fall through to a weaker rung, which is
precisely the failure §2 ranks against.

## 2. The ranking

Every entry is ranked. There is no tier above the list.

| # | rung | verdict | evidence it rests on |
|---|---|---|---|
| **1** | **not a control** | decline | the entry's tag is not an interactive element (a landmark: `<header>`, `<nav>`, `<footer>`). Binding a landmark to a URL is meaningless — it has no activation behaviour to reproduce |
| **2** | **not ours** | decline | the control's own URL attribute names an origin outside `manifest.crawl.allowedOrigins`, a non-`http(s)` scheme (`mailto:`, `tel:`), or carries `download`. §6's hazard table: out-of-scope, **"no endpoint either way"** |
| **3** | **`<form action>`** | bind | the form the control submits, method from `<form method>` defaulting to `GET` per HTML. Ground truth: the browser will submit there |
| **4** | **`href`** | bind | where the link navigates, method `GET`. Ground truth: the browser will go there, and a navigation is a GET |
| **5** | **control-local URL literal** | bind | a `data-*` attribute on the control itself whose value parses as a same-origin path. Method `GET`. The literal is *on the control*, so no association is being guessed |
| **6** | **script-chunk co-occurrence** | — | **declared, not implemented.** §2.2 |

### 2.1 Why the two declines outrank the three extractors

They answer a **prior question** — *is this ours, is this even a control* —
rather than supplying weaker evidence for the same question. That is exactly
§7.5's rank 1, which sits above the UI-constraint rung because it decides
whether the field is a key at all, not because it is stronger evidence about
enum-ness.

And they must outrank, concretely: a `<form action="https://external/">` is a
rank-3 hit and still not ours. Ranking the decline below the extractor would
emit an endpoint on another origin.

**This is the shape the ladder restructure was about.** The tempting spelling is
a precondition — *skip external origins and landmarks, then run the ladder* —
and that is the unranked veto verbatim. Written as ranks 1 and 2 it is arguable:
a reader can ask whether "not a control" really beats `<form action>`, and there
is an answer. A precondition cannot be argued with because it is not in the list
being read.

Both declines are evaluable **standalone**, which is what lets them be ranks
rather than post-filters: rank 1 reads the tag, rank 2 reads the origin of the
control's own URL attribute. Neither needs a binding to already exist. A decline
that could only be evaluated against a candidate would not be a rung, it would
be a filter wearing a rank.

### 2.2 Rank 6 is declared and not implemented, with the measurement

The idea: a control carries a Vue scope id (`data-v-bdebb1bd`); a captured
script chunk contains that id *and* API path templates; bind the control to a
template from its own chunk.

The templates are there — minification keeps them, which is what makes this
tempting:

```
"/tasks/{taskId}/comments"   "/projects/{projectId}/views/{id}"
"/tasks/{id}"                "/projects/{projectId}/views/{projectViewId}/buckets"
```

**Measured, and it is many-to-many:**

| chunk | scope ids | path literals |
|---|---|---|
| the 107 KB chunk holding the `COMMENT` button's id | **17** | 5 |
| the 1 MB main bundle, which holds most controls | **67** | **66** |

The small chunk is suggestive — its five literals include
`/tasks/{taskId}/comments`, which is genuinely what `COMMENT` calls. But 17
scope ids share it, and the bundle that holds most of the controls contains
essentially *every* template in the API. "The nearest literal to the scope id"
is positional proximity in minified output: the association is an artifact of
how the bundler laid bytes out, not of what the component calls.

A second, independent reason: **a button carries no method evidence at all.**
Rank 4 gets `GET` from the fact of navigation; rank 3 gets it from `<form
method>`. `MARK TASK DONE!` gives nothing, so even a correct path would need a
guessed verb, and §7's standing rule is that a guess becomes a gap.

Declared as a rung rather than omitted, following 0030 §2.1 — *"a ranking whose
primary rung cannot run and does not say so is a claim with nothing behind it."*
Here it is not that the rung cannot run; it is that running it would manufacture
associations. Recorded so the next person reaches for it and finds the numbers
already taken.

## 3. What a binding becomes

An `ApiOperation` with `discovery: {kind:'bound-from-control', controlId,
evidence, gapId}`, `responses: []` (the schema already rejects a bound operation
carrying one), `authEvidence: []` and therefore `requiresAuth: 'unknown'`, which
§8 resolves to *required*.

`effect` is **`custom`, with the gap id and a summary** — never a guessed
`create`/`delete`. §7.7: anything that does not fit a known effect type is a
gap, not a guess. This also means bound operations cannot invent entities, since
entity derivation reads `list`/`read`/`create`/`update`/`delete` effects only.

**Deduplicated by `(method, pathPattern)` after normalisation**, per §5's "URL
patterns, not URLs". Seven sidebar links seen on seven routes are one operation,
not 49 — and 0032 §5.2 already made this point about the same controls from the
other direction ("the prize is 7, not 45"). Every contributing `controlId` is
kept on the binding.

### 3.1 One normaliser, moved rather than copied

`normalizePath` lives in `packages/capture/scripts/infer-endpoints.mjs` and
infer cannot import a capture script. Writing a second one is not an option:
0015 §2 matches endpoints on path *shape*, so a bound operation normalised by a
different grammar from every observed one would be compared across two
languages, and the mismatch would surface as an `endpoint-identity` miss with no
visible cause.

So it moves to `packages/shared`, with its existing tests, and capture imports
it from there. §13's duplicated-derived-value rule, and §14's "fix the schema
rather than work around it" one level over.

**Firewall (0020):** `packages/shared` is not `@siteforge/verify`. `match.ts`'s
`pathShape` is the grader's and stays untouched and unread.

### 3.2 The capture-layer schema is wrong and gets fixed

`EndpointSchema.discovery`'s evidence enum is `['form-action', 'fetch-literal']`.
Neither is what this target offers, and `href` — the rung that actually fires 58
times — cannot be expressed. `OperationDiscoverySchema` on the SiteModel side
already carries `['form-action','fetch-literal','xhr-literal','href']`, so the
two are already out of step.

Per §14 the schema is fixed rather than worked around: both sides carry the same
evidence vocabulary, and `control-local-literal` joins it for rank 5.

## 4. What this must not do

Carried from 0030 §4 and still binding:

- **Not narrow a type.** A binding produces evidence; §7.5's ladder decides, and
  its exclusions keep running first.
- **Not emit an operation on a rank the ranking declines.** Rank 6 is declared,
  not run, and a future implementation of it needs its own decision entry.
- **Not score against the truth document while designing.** Nothing below was
  chosen by watching a metric.

## 5. Prediction, written before the code

Every number here is derived from the committed capture at `c213e6c`
(84 skipped controls, 65 with an `href`, 0 with a `<form action>`).

| | predicted |
|---|---|
| controls in | 84 |
| rank 1 **not a control** — declines | **7** (`<header>`, all named "main navigation") |
| rank 2 **not ours** — declines | **7** instances of one URL, `https://vikunja.io` |
| rank 3 **form-action** — binds | **0** — this target has none |
| rank 4 **href** — binds | **58** |
| rank 5 **control-local literal** — binds | **0** — no `data-*` on any control holds a path. Driven to a firing verdict by a unit test instead |
| unbound; the gap stands alone | **12** — 10 buttons, 1 checkbox, 1 textbox |
| distinct operations emitted after dedup + normalisation | **12** |
| of those, **in-universe** (`/api/v1`) | **0** |

### 5.1 So `synthesized-endpoint` stays vacuous, and that is the result

**This corrects 0039 §3**, which said §7.6 "would move a currently-vacuous
graded category". It will not, on this target, and the measurement above is why:
every extractable URL is an SPA route, and every control whose handler would
name an `/api/v1` path has no extractable literal. The claim should have read
*the only unbuilt thing that **could** move it* — the correction is made in
0039 in the same commit as the build.

The deliverable is a change of **cause**, and in this repository that is a
result rather than a consolation. Today the category is vacuous by §13's third
cause — **unimplemented stage**, the one that hides, artifact full and consumer
absent. Afterwards it is vacuous on two disjoint populations with two better
causes:

- the **58 href bindings** are excluded by the universe filter — *working*, and
  0018's control row already asserts an out-of-universe operation moves nothing;
- the **12 unbound controls** ran the ranking and it declined — §13's fourth
  cause, **declined on evidence**, which is *not work at all*.

Stating it in advance because §13 requires it: a build that never reached the
model and a genuine null result report identically, and only a prediction made
first tells them apart.

### 5.2 The input must be proved to differ

`assessVariantIsMeasurable`'s discipline applies (§13, 0021): the model **must**
change — 12 new operations — and every metric must not. If the model is
byte-identical the build did not reach it and the "nothing moved" row is
reporting a no-op.

Two discriminating checks, both free:

- **`auth.unprobeable-count` reads 3.** If the universe filter reaches this
  metric it stays 3; if it jumps by ~12 the filter has a hole, and that is a
  finding about the grader rather than about infer.
- **`endpoint-identity.precision` stays 0.938.** Its denominator is in-universe
  emissions; 12 out-of-universe additions must not touch it.

### 5.3 And the number, when it comes, needs an N

0040 §2.1: `flows/skipped-controls.json` is under `flows/`, the probe pass is
non-deterministic, and the control count moved 60 → 84 on an unchanged digest.
So every count in §5 is **one draw**. When `synthesized-endpoint` first produces
a score on some future target, it carries an N and a spread or it is a
measurement of the draw.

## 6. Noted, not fixed

Seven skipped controls have role `banner` on a `<header>`. §6's candidate roles
are `button`, `link`, `textbox`, `checkbox`, `combobox`, `tab`, `menuitem` —
`banner` is not among them, so these entered the candidate set by another route
(`getEventListeners` or `cursor: pointer`, most likely) and are landmarks rather
than controls. Rank 1 declines them correctly, so it does not block this work,
but a landmark in the interaction candidate set is a capture-side question.

---

## 7. Measured

Run against the same committed capture, at the commit after the declaration.

| | predicted | measured |
|---|---|---|
| controls in | 84 | **84** |
| rank 1 **not a control** — declines | 7 | **7** |
| rank 2 **not ours** — declines | 7 | **7** |
| rank 3 **form-action** — binds | 0 | **0** (reported as `never fired`) |
| rank 4 **href** — binds | 58 | **58** |
| rank 5 **control-local literal** — binds | 0 | **0** (reported as `never fired`) |
| unbound; the gap stands alone | 12 | **12** |
| distinct operations after dedup | 12 | **12** |
| in-universe | 0 | **0** |

```
binding (§7.6)   84 control(s) → 58 bound, 14 declined, 12 unbound
    bound by     href 58
    declined by  not-a-control 7 · not-ours 7
    operations   12 distinct, after dedup by (method, pattern)
    never fired  form-action, control-local-literal
```

Nine numbers, nine exact. That is worth one sentence of scepticism rather than
satisfaction: the prediction was *derived* from the committed capture by the
same reading of the same files the implementation then performed, so it is a
check that the code does what the analysis said, not an independent forecast.
What it rules out is the thing it was written to rule out — a build that did
not reach the model, reporting the same "nothing moved" a null result reports.

### 7.1 The input differed and no metric moved, and both halves were needed

`--without binding` is a new ablation, and `assessVariantIsMeasurable` passes
it: 34 operations against 22, different sha256. So the piece reaches the model.

Graded both ways, and the two reports are **identical line for line** — every
`capture-fidelity` and `inference` metric, byte for byte.

That is 0018's control row holding on real data rather than on a fixture:
*"adding an out-of-universe operation must move nothing, which asserts the
universe filter excludes rather than merely labels."* Twelve of them, and it
excluded all twelve.

Neither half alone would have said anything. Identical scores with a
byte-identical model is a no-op (0021's third ablation row); a differing model
with unchecked scores is a claim nobody tested.

### 7.2 `synthesized-endpoint` — the number, and it is `vacuous 0/0`

The category asked for. It reads:

```
✗ synthesized-endpoint.precision     vacuous       0/0  ≥ 0.9 !
    synthesized endpoints infer emitted
```

**Unchanged, and §5.1 said so in advance.** What changed is the *cause*, which
is the deliverable:

- **before** — §13's third vacuity cause, **unimplemented stage**: 84 controls
  in the artifact, no code path in `packages/infer` emitting
  `bound-from-control`. The one that hides, because the input looks right.
- **after** — two disjoint populations with two better causes. The **58**
  bindings exist and are excluded by the universe filter *working*. The **12**
  unbound ran the ranking and it declined: §13's fourth cause, **declined on
  evidence**, which is not work at all.

The category is still not measuring anything on this target, and it is now
honestly ungradeable rather than silently unbuilt. A first real number needs a
target whose controls carry API URLs in the DOM — a server-rendered app with
`<form action>` rather than a Vue SPA — which is a target-selection question
(0019's criteria) and not more infer work.

### 7.3 Two things the build changed that the design did not anticipate

- **The error taxonomy said no to `try/catch` here, and it was right.**
  `new URL('nonsense')` throws a `TypeError`, which §13 classes as *never*
  operational, so `rethrowIfDefect` would rethrow ordinary page input. Rather
  than argue the taxonomy into an exception, the code asks a question that does
  not throw: `URL.canParse`. `pnpm lint` found both catches.
- **`report.binding` needed three states, not two.** The first draft printed
  "no flows/ in this capture" for the *ablated* run, which is a false statement
  about the artifact — and precisely the 0019 conflation the field exists to
  prevent, committed by the person who wrote the field. Now `ran: false` with
  `reason: 'no-flows-in-capture' | 'disabled'`.
- **Rank 5 picked by `Object.entries` order, which is the duplicate-rank bug
  one level down.** It returned on the first path-like `data-*`, so a control
  carrying two would have had the winner decided by DOM serialisation order
  rather than by an argument — unreviewable for exactly the reason the
  evaluator throws when two rungs share a rank. It now **declines with
  `ambiguous-literal`**: 0015 §2 already settled the shape, an ambiguity is
  reported and never resolved by picking one. Fires zero times on this target,
  so no number moved; caught by review, not by a gate, which is worth noting
  since it is a latent instance of the very rule this turn implemented.
