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

| | Gitea | Directus |
|---|---|---|
| document | 480 operation shapes | 126 operation shapes |
| pages crawled | 12, signed out | 7, signed in |
| XHR / fetch paths | **1** | 24 |
| form actions | 5 | 0 |
| **declared by the document** | **0 of 6** | **17 of 24** |
| verdict | disjoint | overlapping |

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

Directus passes the criterion and is the obvious candidate: a Vue admin SPA over
a documented REST API, one container, sqlite, boots in eight seconds. Two things
measured about it that a reader should weigh before adopting it:

- **Its document is incomplete relative to its own admin.** Seven of the 24
  observed paths are undeclared: `/dashboards`, `/panels`, `/notifications`,
  `/translations`, `/policies/me/globals`, `/roles/me`, `/auth`. Against
  `endpoint-identity` precision those read as hallucinations, and 7/24 is far
  past the 5% known-divergence cap. That is a real calibration problem, and it
  is also *informative* — genuine spec drift is what the divergence list exists
  for, and a target with some is a better test of the mechanism than one with
  none.
- **Its universe is the origin root**, not a `/api/v1`-style prefix, so
  `inUniverse` would admit everything. The universe would have to be expressed
  as "paths the document declares" plus an explicit exclusion of `/admin`, which
  is a different shape of rule than the one the grader has.

Neither is a blocker; both are work. Adopting it means a new snapshot, a truth
loader for OpenAPI 3.0.1 alongside the Swagger 2.0 one, a new transcribed
baseline, and re-pointing §13's nominated M3 target — which is why this note
stops here rather than choosing.
