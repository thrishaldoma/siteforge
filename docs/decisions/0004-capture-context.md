# DECISION 0004 — capture conditions are a declared context, not id syntax

**Status:** ACCEPTED (operator ruling) — supersedes the viewport half of 0002 and
items 9 and 15 of 0003
**Raised:** M0 review
**Affects:** `RouteIdSchema`, `CaptureManifest`, `RouteMeta`, `CaptureModel`

## What was wrong

Auth was a `RouteMeta` field (0003 §9). Viewport was worse: it was **three
things at once** — a literal `<width>x<height>` suffix inside `RouteIdSchema`'s
regex, a denormalized `RouteMeta.viewport`, and a `manifest.viewports` list.

Two consequences, both latent until something needed a third dimension:

1. **`manifest.auth` was singular.** One auth mode per crawl. The model could not
   express §6's "Crawl authenticated and anonymous route sets separately" in one
   run at all. Auth was not merely in the wrong place; the axis did not exist.

2. **The viewport axis was hardcoded.** Adding locale or §11's pinned A/B variant
   meant editing an id regex — a breaking schema change for what is really just
   another crawl setting.

Both are the same mistake at different stages of progression: a capture condition
modelled ad hoc instead of as an instance of a kind.

## The resolution

A **`CaptureContext`** is the set of browser conditions a route was captured
under:

```ts
{ contextId, label, auth, viewport, locale, variant }
```

Declared once in `manifest.contexts`, referenced by every route:

```
routeId  = <pattern-slug>--<context-id>--i<instance>
           product-id--anon-desktop--i1
           about--auth-desktop--i0
```

Adding a capture dimension is now **declaring a context**. `RouteIdSchema` never
changes again.

`RouteMeta` keeps `requiresAuth` and `unauthenticatedBehavior`, because those are
facts about the *site* — the route is gated, and here is what an anonymous
visitor gets. Which state the crawler was in is the context's business.

## Crawl budget

Contexts multiply captures: N contexts is up to N times the routes. §6's caps are
therefore per-context, under a global ceiling:

```ts
budget: {
  maxInstancesPerPattern,   // per (pattern, context) — §6's "3 instances"
  maxRoutesPerContext,      // §6's --max-routes (default 40), within a context
  maxRoutesTotal,           // hard ceiling across every context
  maxDepth,
}
```

Without `maxRoutesTotal`, declaring six contexts silently costs six times as
much. `CaptureModelSchema` enforces all four against the routes actually present,
so a capture that blew its budget fails to load rather than being discovered
later by a surprising bill.

## Shared content

Most routes render identically across contexts — a marketing page is the same
logged in and out — so storing one copy per context is waste in an artifact set
§5 already works to keep small.

`RouteMeta.content` is a discriminated union:

- `{ kind: 'captured', contentHash, renderedSize, screenshots, pageMetrics }`
- `{ kind: 'shared', contentHash, canonicalRouteId }`

A shared route writes **only `meta.json`**. `contentHash` is
`deriveRouteContentHash({dom, styles, states})`: the artifacts canonicalised with
`provenance` **and `routeId`** stripped, so two contexts that produced the same
page agree on it. The model rejects a pointer that does not resolve, points at
another pointer, disagrees on the hash, or comes from a different URL — and it
recomputes the hash from the artifacts, so a wrong one cannot deduplicate two
pages that are not equal.

### The prerequisite nobody would have guessed

This only works because `deriveA11yRef` was changed to derive from `nodeId`
alone. It previously took `(routeId, nodeId)`, which meant two byte-identical
captures produced *different* refs, their artifacts could never hash equal, and
the pointer would have silently never fired. Refs only need uniqueness within one
observation, and nodeIds already provide it.

## What this removes

0003 §15 described frame content boxes as pseudo-viewports that
`manifest.viewports` had to tolerate, with an inverse rule licensing the
exception. That entire special case existed only because dimensions were spelled
into the id. An embedded route now inherits its parent's context and records the
frame box as `content.renderedSize`; the model checks that a top-level route
rendered at its context's viewport and an embedded one at its frame box. No
exception, no licence.
