# 0031 — The manifest, audited against itself

*Status: accepted. Gate: `assessManifestClaims` + `packages/shared/src/manifest-claims.test.ts`.*

## 1. Why the manifest specifically

`manifest.json` is the project's own claim about its outputs — "everything
needed to reproduce the crawl", per its own docstring. Two of its fields were
fiction, and both were found by accident rather than by a check:

- **`contentHash`** was computed by three drivers, written into every manifest,
  and **never once compared**. §12's M1 gate — "recrawl is idempotent modulo
  timestamps" — *was* that field. So the gate had not run narrowly, or run
  wrongly; it had never run, and an inverted comparison in it would have read
  exactly the same from outside (0028).
- **`determinism.frozen`** named four globals `capture-site.mjs` froze **none**
  of, while `rung3` and the spike both installed a shim. The field whose entire
  job is to assert the run was deterministic was the one with nothing behind it.

Neither was visible by reading the file, because a claim with nothing behind it
looks exactly like one that works. Two in one artifact is a pattern, not two
accidents, so the audit was ordered.

## 2. What the audit found

### 2.1 `prefersReducedMotion` — a third one, live

§6 opens with `prefers-reduced-motion: reduce` as a setup requirement, and every
manifest this driver wrote asserted it.

**Four of six contexts did not set it.** The two that did were the probe
contexts. The four that did not were `acquireStorageState`, the anonymous
sweep, and — the two that matter — **both crawl contexts**, the ones that
capture every route, every screenshot and every DOM in the artifact.

The mechanism is worth stating because it is why `guardContext` did not save it:
`reducedMotion` is a **`newContext` option**, not settable afterwards.
`guardContext` takes a context that already exists, so it can add an init script
and a route handler and can never repair an option that was already wrong. A
chokepoint that runs after construction cannot enforce a construction argument.

`locale`, `timezoneId`, `userAgent` and `viewport` were in the same state one
step short of failure: repeated as literals at six call sites, agreeing by
coincidence. Backed by coincidence is indistinguishable from backed, until
someone edits five of six.

**Fixed** by making the constructor the chokepoint — `newGuardedContext(browser,
extra)` merges `CONTEXT_DEFAULTS` and then guards — and by having the manifest
*read* `CONTEXT_DEFAULTS` rather than repeat it. `determinism.test.mjs` asserts
exactly one `.newContext(` call in the file and that the manifest reads the
constant, which is the same shape as the assertion that caught `frozen`.

### 2.2 `contentHash`'s docstring overclaims its scope

The comment says "over every *content* artifact — routes, assets, endpoints,
flows". The derivation is `sha256` over each route's
`deriveRouteContentHash({dom, styles, states})`, so `assets/`, `network/`,
`flows/` and `coverage.json` are outside it **by construction**.

Not fixed here, and the reason is recorded rather than deferred silently:
widening the derivation changes the value on every existing capture, and
narrowing the name is a rename in a schema `capture-model.ts` recomputes. Both
are breaking changes to an artifact contract, and an audit is the wrong place to
make one. The ledger records the true scope; the docstring is the next reader's
problem and now says so.

### 2.3 `crawl.sameOriginOnly` is `z.literal(true)`

A claim that cannot be false carries no information. Kept — §6 names the
property and the artifact is the only place the guarantee is written down — but
declared unread with the note that the actual enforcement is `allowedOrigins` at
the interceptor, which is what a reader should check instead.

### 2.4 Eight `counts.*`, one recomputed

`counts.gaps` is checked against `stageReport.gaps.length`. The other seven were
not. `contexts`, `routes`, `patterns` and `flows` are trivially recomputable from
the arrays beside them, and §13 says where recomputation is possible, recompute.
They are now recorded in the ledger as read by the schema's `superRefine`.

`patterns[].observedUrlCount` is the one derived field that genuinely **cannot**
be recomputed, and the reason is worth keeping: it counts distinct URLs seen
*before* the instance cap, so the artifacts that would be its evidence are
exactly the ones the cap declined to write. Recording it is the point — it is how
a reader knows three route directories stand for thirty URLs.

## 3. The shape of the check

`assessManifestClaims` takes both sides as parameters (§13) and answers two
independent questions per field. `contentHash` failed the second and `frozen`
the first, which is why one boolean would not have found both:

1. **backed** — does something actually do what the field asserts?
2. **read** — does anything consume it?

Five verdicts, and three of them are set differences:

- `unbacked` — a `derived` or `configured` claim with nothing behind it;
- `unread` — nothing reads it *and* no reason is declared;
- `notInSchema` / `unclassified` — the ledger against the schema, **both
  directions**, because a count nets an addition against a removal
  (`assessScopeAgreement`'s argument);
- `reasonGivenButRead` — an exemption that stopped being one, which is how a
  declared list rots.

The schema side is **derived** from `CaptureManifestSchema` via
`schemaLeafPaths`, never typed out, so a field added to the manifest fails the
day it lands rather than the day someone remembers. That is §13's freeze rule:
the weak form covers the edge someone thought of.

### 3.1 Unread is a declared reason, not a boolean

Some fields are honestly unread, and flattening that to "unread is a bug" would
produce a check nobody could keep green. `toolVersions.playwright` exists so a
human holding two disagreeing captures can tell a browser upgrade from a real
diff — a use no code performs, and none should: a difference is not an error
until a person decides which capture was right. `permission.assertionText` is
§3.1's requirement that the artifact carry the assertion, and no machine can tell
a true assertion of permission from a false one.

So the answer is a reason in the `NOT_FROZEN` / `trackedButUnwalked` style. An
exemption someone had to write down is one the next reader can argue with. An
absent check is not.

Nine fields carry one. Every other field of 65 is backed and read.

## 4. The sabotage

`manifest-field-added-unclassified` adds an ordinary optional field to
`CaptureManifestSchema` and leaves it out of the ledger. Reachable because it is
**how both of the original fictions got there** — a field added without anyone
deciding what stands behind it.

One thing about that gate is worth recording, because it was wrong first: the
gate is `pnpm -s test:manifest-claims`, which builds `@siteforge/schema` before
running. `shared` resolves `@siteforge/schema` to `dist`, so a patch to the
schema *source* was invisible to the plain test command — the gate passed while
sabotaged. A sabotage the gate cannot see reads exactly like a gate that works,
which is the fourth vacuity mode arriving through the build graph rather than
through the source. The harness's own residue check then caught the second half:
a gate that builds compiles the patch into `dist/`, and reverting the source
leaves it there.

## 5. Open

- `contentHash`'s scope: widen the derivation or rename the field. Breaking
  either way; the ledger records what it actually covers meanwhile.
- `crawl.sameOriginOnly` should probably go. Deleting a schema field is a
  breaking change and this audit did not make one.
