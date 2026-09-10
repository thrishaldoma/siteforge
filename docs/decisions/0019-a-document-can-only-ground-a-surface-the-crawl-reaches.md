# 0019 — A document can only ground a surface the crawl reaches

Status: accepted

Decision 0015 §1 chose Gitea as the ground truth because it publishes an OpenAPI
document written by people who were not us. That reasoning is still right and
the target is still wrong, for a reason nobody checked:

**Gitea's browser never calls Gitea's API.**

---

## What was measured

`packages/verify/scripts/browser-surface.mjs`, against the pinned image, on a
deterministically seeded instance — an admin, a public repo, three labels, two
milestones, four issues:

| | Gitea | Directus | Vikunja |
|---|---|---|---|
| document | 480 operation shapes | 126 operation shapes | 143 operation shapes |
| pages crawled | 12, signed out | 7, signed in | 8, signed in |
| XHR / fetch paths | **1** | 24 | 18 |
| form actions | 5 | 0 | 0 |
| **declared by the document** | **0 of 6** | **17 of 24** | **16 of 18** |
| universe | `/api/v1` | `/` | `/api/v1` |
| verdict | disjoint | overlapping | overlapping |

All three re-measured by the same script after two defects in it were fixed;
see "What the measurement itself got wrong" below.

Gitea's one XHR is `GET /sfadmin/hello/issues/1/content-history/overview`. Its
forms post to `/user/login` and `/sfadmin/hello/issues/new`. The API at
`/api/v1/` exists for external clients, and the web UI is server-rendered
templates that never touch it.

Signed out for Gitea and signed in for Directus, and the asymmetry is the
finding rather than an inconsistency: an anonymous Gitea crawl already reaches
the repo, issue, label and milestone pages — the whole subject area — while an
anonymous Directus crawl sees a login screen and nothing else.

## Why it is fatal to grading

Infer's input is a capture. Every endpoint it can emit from a Gitea crawl is a
web route, and the graded universe is `/api/v1/`. So:

- `endpoint-identity` precision: every emitted endpoint is out-of-universe →
  denominator 0 → **vacuous**.
- `endpoint-identity` recall: the observed set has nothing in-universe →
  denominator 0 → **vacuous**.
- every category scored over matched pairs: no pairs → **vacuous**.

The grade would report nothing at all. Not a low score — §6's vacuity outcome,
across the board, permanently, for a reason with nothing to do with infer.

## The rule it generalises

0015 established the modality rule: a document grounds a claim about declared
shape, and only observation grounds a claim about runtime behaviour. This is the
same rule one level up:

> **Neither grounds a claim about a surface the crawl never reaches.**

Auth failed the first test — the document declared one global `security` block
and the server behaved otherwise, so behaviour had to be measured. Gitea fails
this one wholesale. Both were invisible from the documentation and obvious after
one fetch, which is the third time in this project that fetching beat reading.

It is now a **selection criterion in §13**, and a mechanical one. The comparison
is deliberately the strong form: not "is the observed path under the document's
base path" but "does the document declare an operation of this **shape**",
because shape-matching is exactly what the grader will attempt. A prefix test
would have called Directus's `/roles/me` described when the document has no such
operation.

## What it does not invalidate

Everything built against the Gitea snapshot stands on its own:

- the **truth loader** (482 operations, `$ref` resolution, the fail-closed 404
  classification) is a Swagger 2.0 reader and its next target will be a
  different document, not a different kind of work;
- the **grader** never mentions Gitea; it takes a truth, a model and an observed
  list;
- the **mutation harness** is where the evidence lives, and its inputs are a
  transcribed baseline and a snapshot — neither needs a capture. Twenty-one
  perturbations still demonstrate that each category moves when its subject
  breaks, and that three controls hold;
- the **anonymous auth sweep** measured real behaviour of a real server and the
  404-is-`required` finding is a property of Gitea, still true.

What is invalidated is the claim that a Gitea *capture* could ever be scored
against it. That claim was never tested because nothing in the repository could
contradict it — §13's own warning about a gap recorded only in prose, arriving
this time as an assumption recorded only in prose.

## Tracked, and self-unblocking

`browser-surface.test.ts` asserts the Gitea record is `disjoint` **and fails the
day it stops being** — the same shape as the mutation harness's blocked row,
which is tied to `truth.notDerived` rather than to a note. A Gitea release that
starts calling its own API turns the suite red and says the grade-against-Gitea
path is unblocked, rather than leaving a stale note nobody revisits.

The criterion also carries its own non-vacuity check: a test asserts that
Directus, measured by the same script with the same comparison, comes back
`overlapping`. Without it, "disjoint" could as easily mean the measurement is
broken as that the target is.

## Open — the target decision

Directus passes the *stated* criterion — its browser calls the API its document
describes — and it is the obvious candidate: a Vue admin SPA over a documented
REST API, one container, sqlite, boots in eight seconds. Passing the criterion
turned out not to be the same as being adoptable, and the gap between those two
is itself the finding of this section.

**Blocker — its universe is the origin root.** Directus serves its API at `/`
and its admin SPA at `/admin`. `inUniverse(path, basePath)` compares leading
segments, so with `basePath = '/'` the base segment list is empty and
`[].every(...)` is `true` for every path in existence. The universe filter does
not become permissive; it stops existing. Concretely, what it currently does is
hold `POST /user/login` out of the Gitea score because that is a web route and
not an API operation — under a root universe that operation, every `/admin/*`
navigation and every static asset would land in `endpoint-identity.precision`'s
denominator as unmatched predictions. The category would be measuring how much
of the SPA the crawler saw.

**Compounding it — the document is incomplete relative to its own admin.** Seven
of the 24 observed paths are undeclared: `/dashboards`, `/panels`,
`/notifications`, `/translations`, `/policies/me/globals`, `/roles/me`, `/auth`.
Against `endpoint-identity` precision those read as hallucinations, and 7/24 is
far past the 5% known-divergence cap. On its own this is a calibration problem
and arguably an *informative* one — genuine spec drift is what the divergence
list exists for. On top of a universe that admits everything it is not
separable: there would be no way to tell an undeclared-but-real endpoint from a
`/admin` route the filter should have excluded.

So: **`endpoint-identity.precision` is structurally broken against Directus
until both are solved**, and the honest statement is that Directus passes the
criterion and is not ready to adopt. Recording that distinction is the point —
"passes the criterion" was about to be read as "is the target".

## The criterion the blocker adds

The measurement script tested one property. Directus fails a second one that was
never written down because Gitea satisfied it silently:

> **The graded universe must be expressible as a path prefix**, and the
> browser's non-API traffic must fall outside it.

That is what makes out-of-universe a meaningful count rather than an empty set,
and it is now part of the §13 selection criterion alongside the overlap test. A
target whose API shares an origin root with its UI needs the universe expressed
as "paths the document declares", which is circular: the model's predictions
would be filtered by the very document they are scored against, and a
hallucinated endpoint would be excluded from the denominator for being
hallucinated.

## What the measurement itself got wrong

Two defects in `browser-surface.mjs`, both of the kind this project keeps
finding, and both fixed before the numbers above were taken:

- **A silently logged-out crawl.** Vikunja's login form ignores Playwright's
  `fill` — Vue's `v-model` never sees the single input event — and Enter does
  not submit it. Typing instead exposed a second problem: the SPA hydrates over
  the field it has already painted and eats whatever was typed first, so
  `sfadmin` arrived as `in` and the server answered, accurately, *wrong username
  or password*. The run then crawled eight login screens and printed
  `2 of 4 … disjoint` with no indication anything had gone wrong. That verdict is
  indistinguishable from the Gitea finding and entirely false. The script now
  waits for hydration, reads each field back after typing, and **fails loudly if
  the page is still on the login route** — a `loggedOutPath` per target.
- **A denominator made of JavaScript.** Vikunja is a PWA whose service worker
  precaches 236 locale chunks and icons, all reported by Chromium as `fetch`, so
  `resourceType` cannot separate them from API calls. Unfiltered, the criterion
  measured bundle size: `2 of 239`. The exclusion is a closed list of file
  extensions applied to the observed path alone — never the document, never the
  verdict — and it is asserted **inert against every verdict already
  committed**, so an exclusion chosen for its effect on an answer would fail the
  suite. The count it cuts is written into the fixture rather than discarded.

The second is the narrowing exclusion's argument reused verbatim, which is the
value of having written that argument down: shrinking a denominator is the shape
of tuning, and what makes an instance legitimate is a property of the input that
somebody else can check.

## What a passing target looks like

Both criteria together, plus §12's M3 shape (a CRUD app), plus §13's "a
self-hosted open-source app you control":

1. the browser calls the documented API (Gitea fails);
2. the API sits under a path prefix the UI does not share (Directus fails);
3. the document is machine-readable and written by someone other than us.

Adopting any target means a new snapshot, a new transcribed baseline, and
re-pointing §13's nominated M3 target. A target whose document is Swagger 2.0
additionally reuses the existing truth loader; an OpenAPI 3.0.1 target needs a
second one written alongside it.

## Recommendation — Vikunja

Measured because Directus's blocker asked for a candidate with a prefixed
universe, and it satisfies every criterion above:

- **16 of 18** observed paths declared by its own document, the best overlap of
  the three, and the one miss inside the universe is genuine drift the
  divergence list is for: the browser calls `GET /api/v1/avatar/sfadmin` and the
  document declares `/api/v1/{username}/avatar`. One divergence in 17
  in-universe paths.
- **`/api/v1` is a real prefix.** `GET /` — the SPA shell — is observed and
  falls outside it, which is precisely the traffic a root universe would have
  scored as a hallucinated endpoint. The universe filter filters.
- **Swagger 2.0, `basePath: /api/v1`, 143 operations.** The existing truth
  loader reads this document; no second loader is needed. 143 against Gitea's
  482 also makes a transcribed baseline a smaller job.
- **It is a todo app**, which is the shape §12 names for M3 and §13 names as a
  self-hosted app to develop against. One container, sqlite, ready in one
  second.

Known costs, stated rather than discovered later: it needs `--tmpfs` mounts
because every writable path in the image is root-owned while the process runs as
uid 1000; creation is `PUT`, not `POST`; and its login form needs the typing
workaround above. All three are in the target table.

The decision is still the operator's — it re-points §13's nominated M3 target —
but the measurement now names one candidate that passes both criteria rather
than one that passes the stated one and fails the unstated one.

---

## Addendum — a third criterion, of a different kind (0041 §8)

The two criteria above decide whether a target can be graded **at all**. A
third decides whether **one category** — `synthesized-endpoint` — can produce a
number, so it never disqualifies a target by itself and sits beside them on the
checklist rather than above them: *do the skipped controls carry an `href` or
`<form action>` that resolves inside the graded universe?* Measured on Vikunja:
**0 of 84**, which is why that category is honestly vacuous there whatever
infer does. Stated in full at 0041 §8, and it wants running at the same time as
`browser-surface.mjs`.
