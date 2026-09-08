# DECISION 0002 — one route pattern maps to many captured artifacts

**Status:** ACCEPTED (operator ruling, M0) — Option A: composite route-id, flat directories
**Raised:** M0, while defining the route-level schemas
**Affects:** `meta.json`, `dom.json`, `styles.json`, `states.json`, `scroll/`, `shot.full.png`

## The conflict

§5 draws exactly one of each artifact per route:

    routes/<route-id>/
    ├── meta.json
    ├── dom.json
    ├── styles.json
    ├── states.json
    ├── scroll/NNNN.png
    └── shot.full.png

But two other rules in CLAUDE.md multiply that by up to six:

1. **§6 crawl frontier** — "Deduplicate by URL pattern with a cap of **3 instances per
   pattern**." `/product/1183` and `/product/902` are one route but two DOMs.
2. **§6 setup** — `--responsive` adds a **second viewport** (390×844). Same route,
   different DOM, different computed styles, different screenshots.

So `/product/:id` under `--responsive` yields up to 3 × 2 = 6 distinct
(dom, styles, states, screenshots) tuples, and §5's layout has room for one.

## What rules out the obvious collapse

Do not collapse instances into a single representative. §7.2 defines a component as "a
subtree appearing **≥3 times** with varying leaf text" — the 3-instance cap in §6 exists
precisely to feed that inference. Keeping one instance per pattern would starve
component extraction of the varying-leaf-text signal it is built on.

The three DOMs must stay distinct. This is therefore a **layout** question, not a data
question.

## Options

### Option A — composite route-id, flat directory (recommended)

`route-id` becomes the full capture key. `meta.json` carries the grouping fields.

    routes/product-id--i0--1280x800/{meta,dom,styles,states}.json
    routes/product-id--i1--1280x800/...
    routes/product-id--i0--390x844/...

    meta.json: { routeId, urlPattern: "/product/:id", instanceIndex: 0,
                 viewport: {w:1280,h:800}, url, title, status, templateGuess, requiresAuth }

- Matches §5's drawn layout literally — every route dir has exactly one of each file.
- Every directory is self-contained and independently diffable, which is what M1's
  "recrawl is idempotent modulo timestamps" check wants to hash.
- Gives §7.2 and §9 a flat list of units to iterate, which is the shape both want.
- "Route identity is the pattern" (§5) survives as the `urlPattern` field.
- Cost: `templateGuess` / `requiresAuth` repeat across siblings; 40 routes × 3 × 2 = up
  to 240 directories.

### Option B — nested captures under a route

    routes/product-id/
    ├── meta.json                    # pattern-level: templateGuess, requiresAuth
    └── captures/i0--1280x800/{dom,styles,states}.json, scroll/, shot.full.png

- No duplicated pattern-level metadata; grouping is structural, not by field.
- Deviates from a layout §5 draws explicitly, and adds a directory level every consumer
  must walk.

### Option C — instance map inside each file

`dom.json` becomes `{ "i0--1280x800": tree, "i1--1280x800": tree }`.

- Preserves the filenames but makes each file a map and multiplies its size. Rejected:
  it defeats per-instance diffing and makes streaming a single DOM impossible.

## Recommendation

**Option A.** It is the only option that keeps §5's drawn layout true, and the
redundancy it costs is two scalar fields per directory.

If Option A is taken, note the naming consequence: `<route-id>` is really a *route
capture id*. §5's path stays as written.
