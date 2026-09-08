# DECISION 0010 — narrowing needs evidence, auth needs three states

**Status:** RECORDED. Implemented across schema, capture and the rung drivers.
**Raised:** operator rulings following rung 3
**Affects:** `JsonSchemaNode`, `EndpointDescriptor`, `RouteMeta`, `CaptureModel`,
`COVERAGE_INVARIANTS`, CLAUDE.md §5–§8 and §13
**Closes:** decision 0009 §5 (open)

Four rulings, one theme: **a value that was never observed must not be
representable as one that was.** Every item below is a case of the model having
no way to say "nothing was learned here", and defaulting to a confident answer
instead.

---

## 1. Narrowing a type requires evidence

Rung 3 inferred `title: enum [4 literal todo titles]` from 23 observations of 4
records. The root cause was sample size, not enum logic: n was 4 wearing n=23's
clothes.

### What landed

**Deduplication by entity identity, before any frequency heuristic** — not only
enums. `dedupeByIdentity` collapses repeated observations of a record by its
identity key, or by deep value where it has none. Everything downstream counts
the result, never the observation list.

**A ranked evidence ladder**, in `classifyStringField`:

| rank | evidence | settles |
|---|---|---|
| 1 | UI constraint: a `<select>`/radio group whose options cover the values | yes — ground truth |
| 2 | ≥20 distinct records and a value/record ratio ≤0.3 | yes |
| 3 | slug-like value shape | supporting only |

Hard exclusions, checked first and not overridable: uniqueness ratio ≥0.9,
values observed as a path parameter, sentence-like values.

**The invariant is structural, not advisory.** `NarrowingRecord` carries the
counts the narrowing was drawn from, and `JsonSchemaNodeSchema` rejects an enum
with fewer than `ENUM_MIN_DISTINCT_RECORDS` (20) behind it and no `uiConstraint`.
An unjustified enum does not parse. The refinement lives *inside* the `z.lazy`
object, so it fires at every nesting depth without anyone walking the tree.

`enum` and `const` additionally require `reviewRequired: true` and a `gapId`;
`CaptureModelSchema` walks the response schemas and collects those gap ids, so a
narrowing gap is as unskippable as a stubbed endpoint's. `format` records its
evidence but forces no review gap: it annotates a shape without closing a domain,
and is only claimed when every observation matched.

### Two interpretations worth stating

**"Distinct values stay flat while distinct records grow" is longitudinal; one
capture gives a final count, not a trajectory.** Read statically, as the floor
and ratio the ruling itself specifies.

**The path-parameter exclusion is matched by value, not by name.**
`normalizePath` collapses every id segment to the literal `:id` and
`params.path` hardcodes `name: 'id'` — so a name comparison would test against a
constant. Value overlap also catches `listId` pointing at `/api/lists/:id`, which
no name rule would, and that overlap *is* §7.4's foreign key. It lands on
`JsonSchemaNode.identifier.pathParamOf`, which is what §7.4 reads.

### Measured

Rung 3 now infers, from the same four todo records:

```
status: ENUM ['open','doing','done']  via select (records=4)
title:  string  examples ["Read the CSSOM instead of hovering", …]
id:     string  identifier ['path-param-value-overlap'] → ['patch-api-todos-id']
```

Both fields have low cardinality across four records. One is an enum and one is
not, and the difference is a `<select>` in the DOM. That is the ladder working in
both directions in a single artifact — the crud app grew a status filter so the
positive case is exercised by a real crawl rather than asserted in a fixture.

---

## 2. Auth is three-valued, and derived

`requiresAuth: boolean` had nowhere to put "no evidence" except `false`, and
`false` is the expensive direction: it makes every §10 auth task bypassable.

`AuthRequirement` is `required | not-required | unknown`, and the verdict is
**derived, not declared** — `RouteMeta` and `EndpointDescriptor` both refine that
`requiresAuth === resolveAuthRequirement(authEvidence)`. Writing `not-required`
without an observed anonymous success is unrepresentable, not discouraged.

`AUTH_EVIDENCE_SETTLES` is a table rather than a chain of conditionals because it
is also the documentation: exactly two kinds settle `required`, one settles
`not-required`, and the corroborating kinds settle nothing however many
accumulate. Conflict resolves to `required` — the safe reading of a contradiction
is the one that does not hand an agent a free bypass.

`CaptureModelSchema` additionally rejects anonymous evidence recorded against a
context that crawls signed in. Without that check, `anonymous-success` sourced
from an authenticated crawl would settle `not-required` on an endpoint nobody
ever tried without a session — the same bug, one level down.

**`unauthenticatedBehavior` gained an `unknown` variant** for the same reason:
`accessible` on a route captured only under a signed-in context is a claim about
a request nobody made. The cross-field rules are deliberately **one-directional**
(`not-required ⇒ accessible`, `unknown behaviour ⇒ unknown requirement`). Pinning
a five-variant union to the verdict in both directions is how a legitimate
observation becomes unrepresentable — the lesson `responses.min(1)` already
taught, when it blocked the never-invoked endpoint.

**Codegen resolves `unknown` closed for mutations and open for reads**
(`resolveAuthForCodegen`). The asymmetry follows the cost and was not generalised
beyond what was ruled: a wrongly-gated GET costs an agent a login step, while
gating every public read would break the anonymous crawl the clone also has to
reproduce.

### A subtlety the fixture now records

**A 401 is only evidence of a requirement when it answers an *uncredentialed*
request.** The login endpoint returns 401 for a wrong password; reading that as
"login requires auth" is circular. Evidence is an interpretation the producer
makes, never an automatic consequence of a status code.

### Two findings from wiring it up

**The fixture could not justify its own verdicts.** `post-api-checkout` claimed
`requiresAuth: true` with nothing behind it, and was observed on an *anonymous*
route — which under the new rule would settle `not-required`. It is now recorded
as observed while signed in, evidence `all-observations-authenticated`, verdict
`unknown` — deliberately preserving the rung-3 shape so the fixture demonstrates
the third state and §8's fail-closed path end to end.

**Playwright's `request.headers()` omits cookies.** Auth evidence read from it
meant `all-observations-authenticated` could never fire: two of three endpoints
recorded no evidence at all, and the `cookie` header never appeared in
`params.headers`, so §8's session check would have had nothing to enforce. Both
silent. Fixed by reading `await request.allHeaders()` and reducing to header
*names* at the source, so a header value has no path to an artifact (§3.3).

---

## 3. Skipped controls: capture records the control, infer binds the URL

Decision 0009 §5 asked whether infer should populate stubbed endpoints or the
fixture should be relabelled. The answer was neither — the concept was conflated.

```
capture → flows/skipped-controls.json   role, name, nodeId, route, gap.
                                        Control-level. No endpoint entry.
infer   → binds to a URL via <form action> / fetch() in source.
          On success: an endpoint with responses: [] and the gap carried through.
          On failure: the gap stands alone.
```

**Why the skipped `FlowTrace` could not carry this**, checked before writing a
new artifact: a skipped flow is forced to `steps: []`, and role/name/nodeId live
on `FlowStep.target`. So in a skipped flow they survive only as prose inside
`name`/`description`. The new file is the structured half the empty step list
threw away, not a second copy of it. A correct invariant had a side effect nobody
designed: it evicted metadata that was only incidentally living in the record.

**The ownership rule is enforced, not documented.** `EndpointDescriptor` gained
`discovery: observed | bound-from-control`, and `EndpointIndexSchema` — the
*capture* artifact — rejects anything but `observed`, and rejects zero-observation
endpoints. The fixture's `delete-api-account` moved to
`fixtures/infer/northwind-supply/bound-endpoints.json`, and a test asserts the
capture index refuses it. A fixture in a shape its producing stage cannot produce
is a lie, and this one was found only because a real crawl was run beside it.

`responses: []` now requires *either* a stub *or* a binding, so §7 stays
unskippable either way while the ruling's "implement it fully" path is legal.

### Destructive endpoints are implemented in the clone

Danger is to the **target**, not to a local mock. `DELETE /api/account` is free in
the clone, so codegen implements it against the store; a dead button teaches an
agent the control is inert, and "delete your account" is a legitimate §10 task
with a clean state-based validator. New gap stub `synthesized-endpoint` records
that the response shape came from the inferred data model rather than the wire.

**What deliberately did not land:** any synthesized response *shape* in
`CaptureModel`. That would be forward-transforming into `SiteModel`, which turn
3 ruled against — `SiteModel` is derived backwards from what codegen consumes,
at M2. Today's landing is the schema contract, the gap variant, the relabelled
fixture, and the §7/§8 prose.

---

## 4. Invariants: the standing rule, and its retroactive debt

Both properties learned the hard way are now §13 conventions rather than one
decision's footnote, and both are enforced:

1. the observed side must be derived **independently** of the extractor;
2. counts must be **disaggregated to the granularity of the failure** — prefer
   an equality over a non-emptiness assertion wherever the data allows one.

**No invariant lands without a sabotage test.** Auditing this found the rule had
been followed by hand and never checked in: **zero** of the nine existing
invariants had one. `coverage-sabotage.test.ts` now carries a case per invariant —
each naming the bug it actually caught — asserting that the invariant reports
`holds: false, vacuous: false` when the drop is reintroduced, and goes vacuous
only when the input genuinely held nothing.

The completeness test is the part that makes the rule stick: the sabotage table
must equal `COVERAGE_INVARIANTS` exactly, so an invariant added without a
sabotage case fails the suite. Verified by regressing the aggregate-masking bug
into `coverage.ts` and watching two tests fail.

**New invariant** (`credentialed-traffic-implies-auth-evidence`), per the standing
rule, for the drop in §2: when credentialed requests were seen, **every** endpoint
must record the observations its verdict rests on. The observed side counts raw
header names on the wire, sharing no code with the inferencer; the assertion is
an equality, so losing one endpoint's evidence fails while the others keep theirs.

---

## 5. Also found: the HAR was never scrubbed (§3.4)

Scanning rung-3 artifacts for credentials during this work turned up live session
cookies in `network/*.har` — `Cookie: sid=sess_00000001`, in the clear.

Playwright writes the HAR itself at context close, with no hook to scrub on the
way out. `capture/` being gitignored satisfies half of §3.4; the other half —
"redact tokens, cookies, emails … **before any artifact is written**" — was not
satisfied at all. A HAR is exactly the artifact somebody attaches to a bug report.

`scrubHarFile` now rewrites it immediately after `browser.close()`, redacting
values for `cookie`, `set-cookie`, `authorization`, `x-csrf-token`, `x-api-key`
and every cookie entry. Header and cookie **names** survive, because §8's session
check needs to know a credential was required. Rung 3 reports what it redacted;
the HARs contain no session value.

Pre-existing, unrelated to these four rulings, and worth stating plainly: the
credential scan that found it is not part of any gate. It ran because this work
touched the credential path. That is luck, not process.

---

## Open

- **Mutation endpoints stay `unknown`** unless a 401 is incidentally observed.
  Resolving them means issuing a PATCH or DELETE anonymously, which changes the
  target's state. §8 fails them closed, which is the right cost.
- **`credentialed-traffic-implies-auth-evidence` compares endpoint counts.** A
  properly disaggregated version would compare per-endpoint, which needs coverage
  data `coverage.json` does not carry yet. The equality assertion is the strongest
  form the current shape allows; noted rather than overclaimed.
- **No gate scans artifacts for credentials.** §3.4 is enforced by the scrubber
  and by review, not by a check that fails the run. §5 above is the argument for
  adding one.
