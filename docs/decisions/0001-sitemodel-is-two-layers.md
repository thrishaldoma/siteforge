# DECISION 0001 — `SiteModel` names two different things in CLAUDE.md

**Status:** ACCEPTED (operator ruling, M0) — two layers: `CaptureModel` (§5) + `SiteModel` (§7, deferred to M2)
**Raised:** M0, while defining `packages/schema`
**Affects:** every package (this is the name of the contract)

## The conflict

CLAUDE.md uses `SiteModel` for two different artifacts, and both readings are plain.

**Reading A — §4, the package table.** The stage contract is written as data flow:

    infer/    # capture/ → SiteModel
    codegen/  # SiteModel → generated app

Here `SiteModel` is unambiguously the **output of Stage 2 (Infer)**: design tokens,
extracted components, route templates, the data model, behavior specs (§7). It is
explicitly *not* `capture/`, because `capture/` is named separately as infer's input.

**Reading B — §5, the section heading.** §5 is titled "The SiteModel" and its body is
the `capture/<site-id>/` directory tree — manifest, routes, dom, styles, states,
assets, network, flows. Its "Key schema rules" (dedupe styles, stable node IDs, URL
patterns, response schemas) are all Stage 1 concerns. §14 reinforces this: "define the
full `SiteModel` in zod... Then build `packages/capture` against those fixtures."

These cannot both be true. §4 says infer *produces* SiteModel; §14 says capture is
built against it.

## Why it can't be deferred

This is the exported name of the project's spine. Every package imports it. Renaming
after Stage 1 exists touches every import and every fixture.

## Proposed resolution

Two layers, both living in `packages/schema`, each independently versioned:

| Layer | Produced by | Consumed by | Contents |
|---|---|---|---|
| `CaptureModel` | Stage 1 Capture | Stage 2 Infer | §5's directory tree, verbatim |
| `SiteModel` | Stage 2 Infer | Stage 3 Codegen | §7's tokens, components, templates, data model, behavior specs |

`SiteModel` keeps the §4 meaning because §4 is the load-bearing one: it defines what
flows between stages. Codegen consuming a thing called `SiteModel` that is actually raw
capture output would be actively misleading.

The operator's M0 task list enumerates exactly the §5 members ("manifest, route meta,
normalized DOM tree, deduped style table, state deltas, asset index, endpoint
descriptors, flow traces, and the SiteModel that ties them together"). Under this
resolution the thing that ties them together is `CaptureModel`.

## Open sub-question

Does the Stage 2 `SiteModel` get defined in this M0 pass, or at the start of M2?

§13 requires "the zod schema before the code that produces or consumes it" — satisfied
either way, as long as it lands before `packages/infer` does. Defining it now means
designing §7's output with no capture data to test it against.

**Recommendation:** define `CaptureModel` completely now; reserve the `SiteModel` name
with a stub and a `modelVersion`, and design it at M2. Fixtures for a model we cannot
yet produce would be guesses, and §7's own rule is that guesses become gaps.
