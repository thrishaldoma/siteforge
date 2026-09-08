# Schema fixtures — Northwind Supply

One coherent capture, not a bag of per-type blobs.

```
capture/northwind-supply/
├── manifest.json
├── stage-report.json                    # 5 gaps, 2 warnings
├── assets/index.json                    # 8 assets, 30 typed references
├── network/endpoints.json               # 8 endpoints, 1 stubbed
├── flows/
│   ├── add-mug-to-cart.trace.json       # scripted, 3 steps, 2 network calls
│   ├── toggle-product-details.trace.json# probe, 1 step, JS-driven
│   └── delete-account.trace.json        # skipped by §6's destructive heuristic
└── routes/                              # <pattern>--<context>--i<instance>
    ├── root--anon-desktop--i0/           # home; reached via an http→https 301
    ├── product-id--anon-desktop--i0/     # /product/mug-blue-12oz
    ├── product-id--anon-desktop--i1/     # /product/notebook-a5-dot  (2nd instance)
    ├── product-id--anon-mobile--i0/      # same URL, mobile context
    ├── embeds-size-guide--anon-desktop--i0/  # nested: a same-origin iframe (§11)
    ├── about--anon-desktop--i0/          # captured
    ├── about--auth-desktop--i0/          # meta.json only — points at the above
    └── account-orders--auth-desktop--i0/ # authenticated context
```

## Three capture contexts

Decision 0004: everything that changes how a page renders is a declared context,
referenced by the route id — never spelled into it.

| contextId | auth | viewport | variant |
|---|---|---|---|
| `anon-desktop` | anonymous | 1280×800 | `homepage-hero=control`, pinned by cookie |
| `anon-mobile` | anonymous | 390×844 | same |
| `auth-desktop` | storage-state | 1280×800 | none |

`/about` is captured under two of them. It renders identically, so the second
directory holds **only `meta.json`** with a `shared` pointer at the first — which
is what the content-hash mechanism is for, and why 8 route directories contain 7
routes' worth of artifacts.

## Why they look like this

The fixtures exist to answer "is the schema right", and this schema's risk is
referential, not per-field. A `dom.json` that parses in isolation proves nothing
about whether its nodeIds resolve in `styles.json`. So the fixtures form one
consistent world and `src/fixtures.test.ts` asserts the joins:

| Assertion | What it protects |
|---|---|
| every styled nodeId exists in `dom.json`, and every element has exactly one assignment | style/DOM drift |
| every styleId resolves; no orphan table entries; `refCount` matches actual usage | §5's 400MB → 4MB claim, measured |
| every nodeId in `states.json` exists in `dom.json` | state deltas pointing at ghosts |
| every scroll state indexes a real screenshot | §6's scroll pass |
| every asset `referencedBy` names a real route, node, styleId, family, or endpoint | asset rewriting in codegen |
| every endpoint a flow calls exists, with matching method/path/status/mutation | §9's "assert the same network calls fired" |
| every flow target resolves in both the a11y tree and the DOM | §10's ref-based action space |
| every `gapId` referenced anywhere is defined in `stage-report.json` | §1's "explicitly stubbed, not silently faked" |
| `manifest.contentHash` recomputes from the content artifacts | M1's "recrawl is idempotent modulo timestamps" |
| every nodeId, styleId, a11y ref and routeId recomputes from `identity.ts` | capture reimplementing the id scheme differently |
| nodeIds survive restyling and content churn, and move only on structural change | decision 0005 — prices and timestamps relocating every node |
| every route resolves to a declared context, and rendered at that context's viewport | contexts drifting from the routes that claim them |
| §6's caps hold per (pattern, context), under the global ceiling | contexts multiplying the crawl without bound |
| every shared pointer resolves, does not chain, and its hash recomputes | deduplicating two pages that are not equal |
| every same-origin iframe names a nested route that lists the parent in `embeddedIn` | §11's iframe recursion |
| every redirect chain terminates at `meta.url`, and `dom.documentUrl` agrees | the three URL fields drifting apart |
| every route's viewport is declared in the manifest, unless it is an embed | frame content boxes leaking into `viewports` |

## What each route is there to exercise

- **`/product/:id` at `i0` and `i1`** — decision 0002's composite route id. The two
  instances have *identical* structural paths and *different* content hashes,
  which is precisely §7.2's component-extraction signal.
- **`/product/:id` at `390x844`** — the viewport axis of the same key. Same
  template, different computed styles (`grid` becomes `flex-column`, smaller type).
- **home** — three `ProductCard` subtrees with varying leaf text, so §7.2's "≥3
  repeats" threshold is actually reachable.
- **`/account/orders`** — `authState: authenticated`, `requiresAuth: true`, and
  `unauthenticatedBehavior: redirect → /login`, which is §6's "the clone must
  reproduce the redirect-to-login behavior" without giving auth its own key axis.
- **`/embeds/size-guide`** — a same-origin iframe recursed into as a nested route
  (§11). It inherits its parent's context and records the frame's content box
  (640×420) as `content.renderedSize`; `embeddedIn` lists both desktop product
  routes as parents.
- **`<nw-rating>` on the product pages** — a **closed** shadow root. Unlike the
  open `<nw-search>`, its content is unreachable: `element.shadowRoot` returns
  `null` from page context by design. That is a permanent capability limit, so the
  host carries a required `gapId` and the schema will not accept a closed root
  without one.
- **home** also carries a non-empty `redirectChain` (`http://` → `https://`),
  which every real crawl hits and which pins the relationship between `meta.url`,
  `dom.documentUrl`, and the chain's last hop.
- **every shell route** — an open shadow root (`<nw-search>`, flattened with
  `data-siteforge-shadow`) and a third-party iframe (placeholder + gap), covering
  two more rows of §11.

## Honest limitations

These are hand-built, not crawled. Specifically:

- **Screenshot and asset bytes do not exist.** Every `sha256` is a stable hash of
  a label, so the files are content-addressed and deterministic but nothing is on
  disk under `assets/files/`. Fine for schema review; a real capture writes bytes.
- **Style declarations are abridged.** A real capture records the full
  `siteforge/v1` property set per node; these carry 8–25 properties each. The
  schema permits this — properties at their initial value are omitted — but it
  means the dedupe ratios here (~0.6–0.8) are far worse than a real page's
  (~0.05), because these pages have 45 nodes rather than 3,000. The tests assert
  that dedupe *happens*, not that it hits a particular ratio.
- **DOM trees are ~45 nodes.** Enough to exercise every structural rule; small
  enough to read in a diff.
- **No credentials, anywhere.** `src/fixtures.test.ts` scans every fixture for
  email addresses, bearer tokens, JWTs, credential-valued keys, and `Set-Cookie`.
  Realism is the goal, but §3.3/§3.4 make fixtures the most likely place for an
  accidental violation, so the scan is a test rather than a convention.

## Union variants no fixture instantiates yet

Deliberately listed rather than quietly omitted, since anything unexercised is
unreviewed:

- `discoveredFrom: { kind: 'redirect' }` — the chain itself is covered, but no
  route was *found* by following one.
- `permission: { source: 'cli-flag' }` — this is an allowlisted crawl, so §3.1's
  `--i-have-permission` path is unwitnessed.
- `variant.pinnedBy: 'observed-only'` and `bestEffort: true` — the case where
  siteforge could not force an A/B variant and just recorded what it was served.
- `StageStatus: 'ok'` (this run has gaps), `propertySet: 'full'`,
  `UnauthenticatedBehavior` variants `status` and `empty-shell`, and the
  `network` asset-reference kind.

None of these is a correctness risk the way the iframe, viewport, and content-churn
cases were — they are shapes the schema already constrains, just not yet witnessed.

## Regenerating

```
pnpm fixtures
```

`scripts/build-fixtures.mjs` validates every artifact against the compiled schema
before writing it, so a schema change that the fixtures violate fails at
generation with a pointed error rather than in the test suite with a vague one.
Editing the JSON by hand will be overwritten — change `scripts/lib-site.mjs`
instead.
