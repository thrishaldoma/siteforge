# DECISION 0006 — a HAR's digest cannot be a stable field

**Status:** ACCEPTED — found by the M1 spike, not by the fixtures
**Raised:** M1, first real page through Playwright
**Affects:** `EndpointIndex.har`, `ProvenanceSchema`

## How it was found

The fixtures asserted an invariant: every volatile value lives in `provenance`,
so M1's "recrawl is idempotent modulo timestamps" reduces to
`hash(omit(artifact, 'provenance'))`. 196 tests agreed.

The first real page broke it immediately. Two crawls of `https://example.com/`,
provenance stripped: **6 of 7 artifacts identical, `network/endpoints.json`
different.** The cause was `har.sha256` — a digest of a file that embeds wall
clock readings.

The fixtures could not have caught this. A generated HAR has no clock in it.

## Why the first fix was also wrong

The obvious repair is to hash a *normalised* HAR with timing fields stripped.
That was implemented, and two more live crawls showed what remained:

```
.log.pages[0].id            page@f3f2699…  vs  page@c187d43…
.log.entries[0].pageref     page@f3f2699…  vs  page@c187d43…
.log.entries[0]._frameref   frame@ea8d2f…  vs  frame@5b483a…
response.headers[age]       8460           vs  8461
response.headers[date]      …10:42:37 GMT  vs  …10:42:38 GMT
response.headers[cf-ray]    a37d58faeefc…  vs  a37d5900dc8…
```

Timings were only the first layer. Underneath are Playwright's per-run page and
frame ids, the origin CDN's per-request id, and cache age. `cf-ray` is
Cloudflare's; another origin has another name for it. Normalising these is
unbounded vendor-by-vendor work with no completion criterion — and what survives
it is just the method/URL/status list that `endpoints[]` already records stably.

## The resolution

`EndpointIndex.har` keeps `{ path, entryCount }` and carries **no digest**. The
digest moves to `provenance.externalDigests`, keyed by capture-relative path:

```ts
provenance: {
  recordedAt, runId,
  externalDigests: { 'network/session.har': '<sha256 of the file on disk>' },
}
```

Integrity is retained; the idempotency check ignores it, which is correct,
because the file it describes genuinely is not reproducible.

`entryCount` stays. It is meaningful, and it was stable across every run — a site
that races an optional request will vary it, and that is a real diff worth
seeing rather than one worth suppressing.

## Why `externalDigests` is a map rather than one HAR field

Screenshots have the same shape of problem in principle. They turned out to be
byte-identical across live crawls, so they keep their stable `sha256` in
`ScreenshotRef` — but if a target ever renders non-deterministically, its digest
has somewhere to go that does not require another schema change.

## Result

Two live crawls, provenance stripped: **7 of 7 artifacts identical**, screenshots
byte-identical. M1's idempotency requirement now holds against a real site rather
than against a generator.
