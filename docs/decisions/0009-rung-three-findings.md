# DECISION 0009 — what rung 3 found

**Status:** RECORDED. Fixes applied; two limitations accepted and one open.
**Raised:** M1, rung 3 — a local CRUD app, both auth contexts
**Affects:** endpoint inference, probing, `COVERAGE_INVARIANTS`

Rung 3 targeted the three paths rung 2 could not reach: `endpoints[]`, `flows/`,
and `states.probed`. All three now hold against a real app with a real session.
Five findings, in descending order of how much damage they would have done.

## 1. Enum inference invented a data model (fixed)

The naive rule — few distinct values, many observations — produced this from 23
observations of 4 todo records:

```
title:  enum ["Read the CSSOM instead of hovering", "Stop trusting green checks", …]
id:     enum ["td_1", "td_2", "td_3", "td_4"]
listId: enum ["lst_1", "lst_2"]
```

§5 makes the response schema "the mock backend's data model" and §8 seeds the
store from it. Codegen would have emitted a store where a todo's title can only
be one of four literals — §7's "a hallucinated endpoint silently corrupts every
trajectory that touches it", arriving through the enum heuristic rather than
through a missing endpoint.

**No hand-written fixture would produce this.** It needs many observations of few
records, which is what a real list endpoint gives you and what a fixture author
never bothers to write.

Now an enum requires: a non-identifier field name, 2–6 distinct values, at least
3× as many observations as distinct values, every value a short spaceless token,
and no shared prefix with a varying numeric tail (`td_1`, `td_2` is an id scheme,
not an enum). Everything else records `examples`, which carries the same
information for seeding and review **without constraining the store**. An enum is
a hard constraint; guessing one is expensive and guessing none costs nothing.

## 2. Every flow recorded zero network calls (fixed)

Two compounding races:

- The response handler is async. Reading `observations` immediately after a click
  saw nothing, and closing the page cancelled the in-flight read. Fixed by
  tracking handler promises and settling them before each read.
- `waitForLoadState('networkidle')` resolves *immediately* when the page is
  already idle — which it is, at the instant of the click, before the handler's
  `fetch` has been issued. §6 says "wait for network idle **or 2s**"; the `or` is
  load-bearing. Fixed with a settle delay before the idle wait.

Symptom: 29 exchanges across GET, PATCH and POST collapsed to a single GET
endpoint, and `flows[].networkCalls` was empty everywhere.

## 3. `xhr-implies-endpoints` was satisfied by the loss (fixed)

The existing invariant only required `endpoints` non-empty. One surviving GET
endpoint satisfied it while PATCH and POST vanished. Non-emptiness does not catch
a *partial* drop.

New invariant, per the standing rule:

```
methods-imply-endpoint-methods
  every HTTP method seen in XHR traffic must appear in some endpoint descriptor
```

Observed methods are counted from raw method strings — no path normalization, no
grouping, nothing the inferencer touches — keeping the two sides independent, as
decision 0008 requires.

## 4. `requiresAuth` is not inferable without an anonymous attempt (fixed for GET)

Every endpoint came back `requiresAuth: false`, because the anonymous context is
redirected to `/login` before any XHR runs — so the crawl never observed a 401.

Capture now re-issues each distinct **GET** endpoint once anonymously, purely to
record what an unauthenticated caller gets. `GET /api/todos` is correctly
`requiresAuth: true` (`200×23, 401×3`).

**Accepted limitation:** mutation endpoints stay `requiresAuth: false` unless a
401 happens to be observed. Learning otherwise would mean issuing a PATCH or
DELETE anonymously, which changes the target's state — capture must not do that.
Worth a gap at M2 rather than a guess.

## 5. The `responses: []` + stub case is infer's, not capture's (open)

The hand-written fixture models `DELETE /api/account` as a *stubbed endpoint*
with zero observed responses — the case decision 0003 §11 added to the schema.

Rung 3 shows capture cannot produce it. §6 skips destructive controls, so the
request is never issued and the endpoint's URL is never learned. The skipped
control becomes a gap; there is no endpoint descriptor to attach a stub to.

An endpoint that was never called can only be recovered by reading a `<form
action>` or a `fetch()` call out of the page source — which is §7's job, not §6's.

**Open:** either infer populates stubbed endpoints from static analysis at M2, or
the fixture's `delete-api-account` entry should be relabelled as an infer-stage
artifact. It is currently a shape the producing stage cannot produce, which is
exactly the drift §13 warns about — found only because a real crawl was run
beside it.

## What rung 3 confirmed works

- Path normalization: `/api/todos/td_1` → `/api/todos/:id`, values recorded as
  path-param examples.
- `required` as the *intersection* across observations, so a field absent from one
  response is not required.
- `format: date-time` detection on ISO strings.
- Mutation detection from method; 400 responses captured from a real validation
  failure (submitting the form empty).
- Header capture by name and sensitivity only — no cookie value anywhere in the
  artifacts (§3.3), verified by the fixture suite's credential scan.
- Both contexts end to end: `root--anon-desktop--i0` records the 302 to `/login`,
  `root--auth-desktop--i0` records the app, and `storage-state.json` is written
  chmod 600 and gitignored.
- §6's destructive heuristic skipped "Sign out" and "Delete all todos", each with
  a gap that resolves against the stage report.
