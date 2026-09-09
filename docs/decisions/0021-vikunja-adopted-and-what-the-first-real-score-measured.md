# 0021 — Vikunja adopted, and what the first real score turned out to measure

**Status:** accepted
**Date:** 2026-09-09
**Context:** 0015 (step order), 0019 (browser/document overlap), 0020 (the grader pin)

## The target

Vikunja, pinned at `vikunja/vikunja@sha256:ed1f3ed4…`, replaces Gitea as the M3
ground truth. It satisfies both selection criteria and Gitea satisfies neither
usefully:

| | Gitea | Directus | Vikunja |
|---|---|---|---|
| declared by its own document | 0 of 6 | 17 of 24 | **16 of 18** |
| universe | `/api/v1` | `/` | `/api/v1` |
| document | Swagger 2.0, 482 ops | OAS 3.0.1, 126 | Swagger 2.0, 143 |
| verdict | disjoint | overlapping, root universe | **adopted** |

Swagger 2.0 means the existing truth loader reads it; the loader was generalised
into `truth/swagger2.ts` with a per-target `TruthSource`, rather than copied.
The document was measured byte-identical across two boots on different ports
with different public URLs and JWT secrets, so `volatileFields: []` is a
measurement.

## Two properties of the document that change what can be claimed

**It declares no formats at all.** Zero occurrences of the string `format` in
368KB, and seven enums. Gitea declared 5 508 formats. Silence about a field is
not a claim that the field is unconstrained, so scoring a model's narrowings
against this document would mark a correct `date-time` on `created` as a false
positive for the document's reticence. `narrowing` is therefore `notDerived` for
this target, on the same modality argument as `identifier` — and
`vikunja.test.ts` fails the day a release starts declaring formats, so the
category unblocks itself rather than waiting for someone to remember.

**Its API is almost entirely gated.** 24 of 25 zero-parameter GETs answer 401;
the single public read is `GET /api/v1/info`. Vikunja is a personal task
manager, so this is a property of the API rather than a thin measurement. The
consequence is recorded rather than tuned around: `auth.over-gate-rate`'s
denominator is the endpoints the truth calls public, so against this target it
is **one**, and the metric is coarse. Vikunja's public-endpoint floor is `>= 1`
where Gitea's is `>= 5`, and that difference is the measurement, not a
relaxation.

## What running it found

Four defects, all invisible until a real site was crawled:

- **`inferEndpoints` emitted one path parameter regardless of arity.** Every
  operation got a single `id`. `/projects/:id/views/:id/tasks` is the first
  nested resource this project has seen; neither the rung-3 fixture nor the
  hand-written Gitea baseline has one. Caught by the schema's own cross-check
  between the pattern and the parameter list. Now one entry per hole, positional.
- **The §3.4 scrubber only ever redacted emails**, though §3.4 names tokens
  first. Vikunja answers `POST /api/v1/login` with `{"token":"eyJ…"}`, so four
  JWTs reached `network/endpoints.json`. The secret gate caught them and failed
  the run. The scrubber now redacts JWT and bearer shapes, as a **second
  implementation** of the scanner's rules rather than a shared constant — the
  scanner is the check on the scrubber, and one regex behind both would remove
  the finding and the redaction together.
- **An uncredentialed request from the authenticated context settled nothing.**
  `POST /api/v1/login` is uncredentialed by definition and happens during
  sign-in, so the context test recorded no evidence at all and the coverage
  invariant fired. Success now settles `not-required` whatever context it came
  from — an endpoint you cannot have a session for cannot require one — while
  **refusal still settles `required` only from a deliberate anonymous probe**,
  because §6 already wrote down why a 401 is often the endpoint's own failure
  mode. Two categories, two defaults.
- **`acquiredBy` had no value for a scripted login**, and rung 3 was calling its
  own scripted login `interactive-headful`. §14: fix the schema. Added
  `scripted`, and rung 3 now says what it does.

## The finding that matters most

**Three of infer's four pieces do not move any graded category.** Measured, not
argued: the same capture was inferred four times, once with each piece disabled,
and graded each time.

| variant | model changed | metrics moved |
|---|---|---|
| without entity dedup | 4 → 7 entities, operations differ | **0** |
| without narrowings | identical operations | **0** |
| without components/tokens | 16 → 0 colours | **0** |

A fifth piece is not merely invisible but **absent**: `synthesized-endpoint`
scores §7.6's binding of skipped controls, and `capture-site.mjs` declares no
behaviour probing, so `flows/skipped-controls.json` holds `controls: []` and
there is nothing to bind. That is this driver's limitation and not the target's,
which is why it is recorded apart from the two vacuities below.

Every graded category reads `model.operations`, and infer transcribes those from
`capture/network/endpoints.json`. The response schemas, the field types and the
narrowing claims were all produced by **capture's** `inferEndpoints`. So the
parts of infer that exercise §7's judgement — the data model, the narrowing
ladder applied to entity fields, the component extraction, the token clustering
— are invisible to every metric the grader has.

**The conclusion is about the grader, not about where the code lives.** The
first draft of this note said response-schema inference was §7.5's work being
done in §6's stage, and that is wrong: §5 puts response schemas in the *capture*
artifact — "for each endpoint, infer a JSON Schema across all observed
responses", with `endpoints.json` carrying it in the layout — and §6's
"deterministic, no LLM" does not exclude them, because a schema union over
observed bodies is deterministic. The work is where the contract puts it.
Nothing should move.

What is wrong is a premise. 0015 built these categories to measure infer, and
the measurement above shows **they measure a capture artifact**: twelve numbers
badged as stage 2's are largely stage 1's. Correcting the premise is worth more
than the code change the first draft implied, because a reader of that draft
goes looking for something to relocate, and a reader of this one understands
what the number is evidence about. The grader is pinned (0020) and stays
pinned — moving the metrics onto what infer happens to produce would be fitting
the measurement to the thing measured, the failure 0015 §0 ordered the steps to
prevent. The honest response is to say what each number is a number about, which
is what the section below now does.

## The first real scores

Against the pinned truth, from a real crawl of a real seeded instance — 7
routes, 16 endpoints, 96 API exchanges:

```
✗ endpoint-identity.precision   0.938   15/16     ✗ narrowing.*        vacuous (not derived)
✓ endpoint-identity.recall      1.000   16/16     ✗ identifier.*       vacuous (not derived)
✓ path-param-arity.accuracy     1.000   15/15     ✗ synthesized-endpoint  vacuous
✓ path-param-naming.accuracy    0.600     3/5     ✓ auth.under-gate-count      0   0/7
✗ request-field-presence.P      0.737   14/19     ✓ auth.over-gate-rate    0.000   0/1
✓ request-field-presence.R      0.933   14/15     ✓ auth.truth-coverage    0.533   8/15
✗ response-field-presence.P     0.833  205/246    ✓ auth.evidence-coverage 1.000  12/12
✗ response-field-presence.R     0.563  205/364    ✓ auth.unprobeable-count     3   3/15
✗ field-type.accuracy           0.872  191/219
```

`endpoint-identity.recall` is **structurally 1.000 and is not a result.**
`observedEmitted` counts observed endpoints whose `(method, pathShape)` key the
model emitted, `observed` comes from `capture/network/endpoints.json`, and
`model.operations` is a total `.map` over that same list with no filter — so
recall is 16/16 for any infer that transcribes the endpoint index, and no defect
in this stage can move it. The Gitea baseline's own docstring says this about a
hand-authored model; it applies here for the same reason and should not be read
beside `path-param-naming` as though both were measurements. It would move only
for an infer that *drops* endpoints, which is a real failure mode and why the
metric exists — just not one this implementation can exhibit.

The two `vacuous` rows on the right have **different causes** and are recorded
apart: `narrowing` and `identifier` are the document's limits (it declares no
formats, and no identifier modality), while `synthesized-endpoint` is this
driver's — no behaviour probing ran, so no control was skipped and none could be
bound. A target limitation is permanent until the target changes; a driver
limitation is work not yet done.

The rest, as expected, and informative in specific ways. `response-field-presence`
recall of 0.563 is the crawl's reach, not a bug: capture only ever sees the
fields a response actually carried, while the document declares every optional
one. `path-param-naming` 0.600 is a real miss — every parameter is called `id`
because path normalisation collapses them, and the document calls them
`project` and `task`. The single `endpoint-identity` precision miss is
`GET /api/v1/avatar/sfadmin`, which the document declares as
`/api/v1/{username}/avatar` — genuine drift, and exactly what the divergence
list exists for.

## Costs of this target, stated

`--tmpfs` mounts (every writable path in the image is root-owned while the
process runs as uid 1000); `PUT` creates and `POST` updates; and a login form
that ignores Playwright's `fill` and eats the first characters typed into it
during hydration. All three live in one place — the pin in `snapshot.mjs`, which
also owns the seed and the sign-in, so a crawl and the document it is scored
against cannot be of different instances.

The capture itself is **not** committed: `capture/` is gitignored and §3.4
treats it as sensitive. What is committed is the driver and the digest, which is
what makes the run reproducible.
