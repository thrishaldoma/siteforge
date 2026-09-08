# DECISION 0003 — judgement calls made while defining `CaptureModel`

**Status:** DECIDED by the implementer, recorded for review
**Raised:** M0
**Affects:** `packages/schema`

CLAUDE.md §5 specifies the capture layout but not the shape of every file in it.
These are the calls made where it was silent. None of them blocked M0; each is
reversible now and expensive later, so they are written down rather than left
implicit. Object if any is wrong.

---

### 1. Every artifact carries a common envelope

`{ modelVersion, artifact, scrubbed: true, provenance }`.

- `artifact` is a literal discriminator, so a file read from the wrong path fails
  to parse instead of being coerced.
- `scrubbed: z.literal(true)` makes an unscrubbed artifact *unrepresentable*.
  §3.4 says the scrubber "must redact ... before any artifact is written"; a
  boolean would only document that rule, a literal enforces it.
- `provenance` is the **only** place a timestamp, duration, or run id may appear.
  `VOLATILE_ARTIFACT_KEYS` exports that list. M1's "recrawl is idempotent modulo
  timestamps" then reduces to `hash(omit(artifact, 'provenance'))` rather than a
  per-artifact ignore-list that will drift.

### 2. `manifest.contentHash` excludes the manifest and the stage report

Hash over the *content* artifacts — routes, assets, endpoints, flows — sorted by
path. Including the manifest would make it self-referential; including
`stage-report.json` would fold run metadata into a site fingerprint.

### 3. CSSOM rules live in `states.json`, discriminated from probed observations

§5 lists no file for §6's extracted pseudo-class rules, and `styles.json` is
per-node computed style, which they are not. They go in `states.json` under
`source: 'cssom'`, alongside `source: 'probed'` and `source: 'scroll'`.

Keeping the discriminator matters: a CSSOM rule is the site's own *specification*
of what hover looks like; a probe is one *observation*. Merging them would let
infer treat a lucky poke with the same confidence as a stylesheet rule, and §7's
"when confidence is low, write a gap, not an invention" becomes unenforceable.

§6's scroll findings (lazy load, infinite scroll, sticky/fixed, IntersectionObserver
reveals) also land here as `source: 'scroll'`; the scroll *screenshots* are
indexed from `meta.json`.

### 4. A flow is an ordered sequence; a probe is a flow of length one

§6's behavior probing yields single actions, but §10's tasks ("add two items and
complete checkout") need many, and §9 replays `flows/*.trace.json` — replay
implies sequence. One `FlowTrace` type covers both, with `kind: 'probe' |
'scripted' | 'recorded'`.

The schema enforces the chain: step indices are ordered, and each step's
`pre.domHash` must equal the previous step's `post.domHash`. A trace that does not
chain is not a trace of anything.

### 5. Endpoint descriptors carry scrubbed response samples, not just schemas

§5 says "response schemas, not just responses" — *not just*, not *instead of*.
§8 seeds the mock store "from real captured responses after scrubbing", and the
only other home for those bodies is `session.har`, which no schema validates.
Samples are capped and validated against the endpoint's observed statuses.

### 6. Request headers are recorded by name and sensitivity, never by value

`{ name, required, sensitive }`. §3.3 keeps credentials out of every artifact, but
codegen still needs to know `authorization` was required in order to implement
§8's session check. Recording presence without value gives it that and makes a
token leak structurally impossible. Enforced by `strictObject` — a header
descriptor carrying a `value` fails to parse.

### 7. `assets/index.json` is keyed by original URL

§5 writes it as `originalUrl → {...}`, and lookup-by-URL is the real access
pattern when codegen rewrites references. `referencedBy` is a typed discriminated
union (`dom-attribute`, `css-url`, `font-face`, `network`, `asset-import`) because
codegen rewrites each kind differently.

### 8. Interaction candidates live on the DOM element, not in a new file

§6 requires recording bounding box, a11y role and name, a stable selector, and
whether a state delta was observed — but §5's layout defines no candidates file.
They attach to the element as `interaction`, which keeps the layout intact and
colocates the data with the node it describes. §10's runtime `actionSpace` is
enumerated live from the same discovery sources, which is what keeps the two
consistent.

### 9. Auth state is a field on `RouteMeta`, not part of the route id

> **SUPERSEDED by [0004](0004-capture-context.md).** Flagged below as "the
> weakest call here", and it was: auth is now one dimension of a declared
> `CaptureContext`, referenced by the route id. The review also found a second
> problem this call had hidden — `manifest.auth` was singular, so the model could
> not represent §6's two route sets in one run at all. Retained for the record.


Decision 0002 made `routeId` a composite of pattern + instance + viewport. Auth
was *not* added as a fourth axis; the id is long enough. Instead `RouteMeta`
carries `authState` plus `unauthenticatedBehavior`
(`accessible | redirect | status | empty-shell`), which reproduces §6's
"the clone must reproduce the redirect-to-login behavior" without a second capture
of the same route.

**This is the weakest call here.** If M6 finds that anonymous and authenticated
captures of one URL genuinely need separate DOM trees, auth becomes a key axis and
this is a breaking change to `RouteIdSchema`. Flagged deliberately.

### 10. The JSON Schema subset is closed, not `unknown`

A hand-defined recursive subset covering `type`, `nullable`, `properties`,
`required`, `additionalProperties`, `items`, `enum`, `const`, `format`, `anyOf`,
`examples`. `$ref`, `allOf`, and conditional subschemas are rejected — they cannot
be inferred from observed examples, so a producer emitting one has a bug that
should fail loudly. `z.unknown()` would have made the infer→codegen contract a
convention, which §13 identifies as the expensive failure mode.

### 11. An endpoint may have zero observed responses if it is stubbed

Surfaced by the fixtures: §6 skips destructive actions, so `DELETE /api/account`
is known from a button but was never invoked. `responses` may be empty **only**
when `stub` is present. The original `min(1)` would have forced capture to
fabricate a response or crash.

### 12. `CaptureModel` is a logical aggregate, never a file

§4: "each stage reads and writes files on disk only." Nothing writes
`capture-model.json`. A loader walks the directory and produces one; the schema's
`superRefine` catches the drift that a directory walk can introduce — files in one
route directory disagreeing about which route they describe, or a manifest listing
routes that were not loaded.

### 13. `auth/storage-state.json` is deliberately not schematized

§5 lists it in the capture tree, so its absence from `packages/schema` is a
choice, not an oversight. Two reasons:

- It is **Playwright's** format, not ours. Mirroring it in zod would create a
  second source of truth that silently rots when Playwright changes it.
- §3.3 forbids credentials in any artifact, and that file is nothing but
  credentials. A schema for it would be a schema for the one thing we are trying
  not to have a schema for.

`CaptureManifest.auth` records the *path*, the acquisition mode, the credential
source, and the expiry — everything a later run needs in order to decide whether
to reuse it — and none of the contents. `capture` writes the file chmod 600; the
root `.gitignore` excludes it.

### 14. Identifier derivation lives in the contract, not in each producer

> **Extended by [0005](0005-nodeid-is-structural-not-content.md).** The principle
> stands and paid off immediately: because derivation was centralised, the review
> could find and fix a second stability bug (data churn, not just restyling) in
> one place. The note below about excluding `class` is now the narrower half of a
> broader rule.


`src/identity.ts` exports `deriveNodeId`, `deriveContentFingerprint`,
`deriveStyleId`, `canonicalizeStyleDeclarations`, `deriveA11yRef`, and
`deriveRouteId`.

`NodeIdSchema` only constrains the *format*. If capture computed ids one way and
the fixtures another, both would validate while describing different worlds, and
§5's "they must survive re-crawls so diffs are meaningful" would be quietly
false. Every producer calls these; the fixture suite recomputes every id in the
fixtures from its stored inputs, so a divergent reimplementation fails a test.

One consequence worth naming: **`class` is excluded from the content
fingerprint.** §11 says CSS-in-JS classnames are hashed and unstable, so folding
one into an id would change every nodeId on the page whenever the site rebuilds.
`style` is excluded for the same reason — computed style is addressed by
`styleId`.

### 15. An embedded route's viewport is the frame's content box

> **OBSOLETE, see [0004](0004-capture-context.md).** This special case existed
> only because viewport dimensions were spelled into the route id. With contexts,
> an embedded route inherits its parent's context and records the frame box as
> `content.renderedSize`; there is no undeclared-viewport exception to license.
> Retained for the record.


§11 recurses same-origin iframes as nested routes, which collides with decision
0002: a frame renders at its content box, not at a browser viewport, so
`manifest.viewports` will not list it.

Rather than widen `viewports` to include frame boxes — which would make it mean
two different things — `RouteMeta.embeddedIn` records the parent frames
(`routeId`, `nodeId`, `contentBox`), and a non-empty `embeddedIn` is what
licenses a viewport that no browser viewport declares. The fixture suite asserts
the inverse rule: any route at an undeclared viewport must be an embed, and its
viewport must equal its content box.

`embeddedIn` is an array because one embed can be reached from several parents;
instance deduplication (§6) collapses them to one capture.
