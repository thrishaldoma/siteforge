# DECISION 0011 — two standing gates, a three-way hazard split, and fixture legality

**Status:** RECORDED. Implemented.
**Raised:** operator rulings following decision 0010
**Affects:** `.gitignore`, `pnpm verify:clean`, `packages/shared`, `SkipCause`,
`EndpointDescriptor`, `RouteMeta`, `FlowTrace`, CLAUDE.md §6 and §13

Two of these are gates that make an existing rule enforceable. Two are
classifications that were conflating things. All four share a shape: something
was true by convention, and convention does not fail a build.

---

## 1. The fresh-clone gate

`pnpm verify:clean` clones the committed HEAD into a temp directory, installs,
builds, typechecks, tests, regenerates the fixtures, and runs both rungs — the
second one twice, with and without `--allow-destructive`. **No milestone gate in
§12 counts unless it passed there.**

The reason is not hypothetical. `packages/capture/` was matched by an unanchored
`.gitignore` pattern and had never been committed; two rungs of evidence toward
M1 came from code that existed in one working tree, and every local check passed
throughout. A gate that runs where the code already is cannot detect that.

**It refuses a dirty tree** (`--allow-dirty` overrides, loudly). A clone silently
tests HEAD, so running it with uncommitted changes reports green about code that
is not the code in front of you — the same confusion that hid the package for
eight commits. The rungs get distinct ports so a server left running locally
cannot answer for the clone and make it look green.

### Anchoring, and the deviation

Every `.gitignore` pattern is now explicitly anchored: `/x` for root-only, `**/x`
where any-depth is meant. The literal ruling was "leading slash on everything",
which would break `node_modules/` and `dist/` — pnpm puts both in every package,
so root-anchoring them stops ignoring build output anywhere but the root. `**/`
makes the any-depth match a decision on the page rather than an accident.

`repo-hygiene.test.ts` runs in the *ordinary* suite, not the slow gate, because a
check only helps if it fires before the commit. It asserts:

- every workspace package has tracked files — deliberately **unenumerated**,
  since a hand-listed set only catches paths somebody thought to list, and not
  thinking of one was the whole failure;
- no package's `package.json` is ignored;
- every pattern is anchored;
- the artifact directories are still ignored, so anchoring loosened nothing.

Sabotaged by un-anchoring `capture/`: the anchoring assertion fails. Note which
one fires — the tracked-files assertion does *not*, because git ignores
`.gitignore` for already-tracked files. That check catches a package being **born**
ignored, which is exactly when the original bug happened.

---

## 2. The §3.4 secret gate

§3.4 was prose, and prose does not fail a run. It was satisfied in one direction
— the directory was gitignored — while `network/*.har` held
`Cookie: sid=sess_00000001` in the clear for two rungs.

`scanCaptureTree` walks every file written under `capture/` and a hit **fails the
run**. Rules cover cookie and `Set-Cookie` values, `Authorization` headers,
bearer tokens, JWTs, session-cookie shapes, private keys, vendor tokens, and the
literal values of `SITEFORGE_USER`/`SITEFORGE_PASS`.

Details that matter:

- **Header *names* survive.** `params.headers` records presence and sensitivity
  and must keep doing so — §8's session check depends on it. A gate that flagged
  that would only be passable by deleting the thing codegen needs.
- **`auth/storage-state.json` is exempt from the content scan** and checked for
  mode `0600` instead, reported into the same finding list. The one artifact
  allowed to hold a credential has to prove it is protected.
- **Findings never print what they found** — half-masked excerpts, so a CI log is
  not a second copy of the leak.
- **Bytes are decoded `latin1`, not `utf8`.** Not for findability: a utf8 decode
  finds an ASCII credential too, because the decoder never swallows a following
  ASCII byte. It is for *position* — every multi-byte sequence ahead of a match
  shifts the string index off the byte offset, and a finding pointing at the
  wrong place in a 40MB HAR is not much of a finding. An earlier draft of this
  file claimed utf8 would miss it; measured, and it does not.
- **Known limit:** a credential inside a compressed stream (a gzipped HAR body, a
  PNG `IDAT`) is not findable by any text scan. The scrubber has to keep it from
  being written; this gate catches what the scrubber missed, not what it hid.

Sabotage tests plant a live cookie in a HAR, a bearer token in a PNG `tEXt`
chunk, and a `SITEFORGE_PASS` literal in a DOM artifact, and prove each fails.

### What it caught immediately

The rung-3 fixture's password was `rung-three` — which is also its `siteId`, so
it appeared in all 24 artifacts and the gate failed the run. The gate was right:
a literal scan cannot distinguish a leaked password from a password that happens
to be a word the artifacts legitimately contain, and the answer to that is not to
weaken the scan. The fixture password is now distinctive.

---

## 3. Control hazards, split three ways

One "destructive" bucket conflated three unrelated things, and got both of the
interesting ones wrong.

| hazard | who absorbs it | what capture does |
|---|---|---|
| `target-destructive` | a system we do not own | never fire. The only hazard producing `responses: []` |
| `session-destructive` | us, and only us | **fire it**, on a session of its own |
| `out-of-scope` | nobody; it is not ours | no endpoint either way |

**`session-destructive` is deliberately absent from `SkipCauseSchema`.** A control
whose only cost is our own session must be captured, so "skipped because it would
log us out" is not a sentence the schema can express. If firing one fails, that
is `precondition-unmet` — a different and honest claim.

### A disposable context is not enough

The ruling said to fire these "in a disposable context cloned from current
`storageState`, then discard the context." That does not work, and the mechanism
needed one correction: `storageState` carries the **cookie**, but the session
lives in a map on the server, and `POST /api/auth/logout` deletes it. Cloning the
crawl's state into a throwaway context and clicking "Sign out" ends the crawl's
session too — the context is disposable, the session is shared.

So each session-destructive probe gets **its own login**, and only that session
dies. Where a target offers no non-interactive re-auth (§6's headful `--auth`
path), the pass has to run last instead and the crawl ends signed out.

The fixture's logout handler was returning 204 without touching the session map,
which made the hazard one it could not actually inflict. It deletes the session
now, because a probe that cannot break anything proves nothing about the
mechanism protecting against it. The session id generator was
`sessions.size + 1`, which reissues a live id after any logout — monotonic now,
since sessions are created and destroyed on purpose.

### Destructive probes run last, even when allowed

Firing "Delete all todos" inline emptied the store for every probe after it, and
`statesProbed` went from 1 to 0. §6's "each probe runs in a fresh page context,
so probes cannot contaminate each other's preconditions" is about the browser,
not the server. Allowed destructive probes are deferred to a pass after all
ordinary probing.

### Measured, with `--allow-destructive` on both rungs

```
GET    /api/todos        auth=required   obs=33
PATCH  /api/todos/:id    auth=unknown    obs=5
POST   /api/todos        auth=unknown    obs=1
DELETE /api/todos        auth=unknown    obs=1     ← fired, real observations
POST   /api/auth/logout  auth=unknown    obs=1     ← session-destructive, captured

skipped: Delete account   target-destructive  "delete"          ← designated
skipped: Help (external)  out-of-scope        https://example.net
skipped: Email support    out-of-scope        mailto:
```

`POST /api/auth/logout` is now an ordinary endpoint with real observations: no
gap, not synthesized. "Delete account" is the one control designated never-fire,
so the synthesized path keeps its coverage against a real crawl rather than only
against a fixture. Rung 2 has no destructive controls, so the flag is inert
there; it is run with and without anyway, because a flag that breaks the
non-destructive path is worth knowing about.

### A silent drop found while doing it

Extracting the probe body into a reusable `runProbe` left a stray `probed += 1`
referencing a variable that no longer existed in scope. It threw `ReferenceError`
**after** the flow was recorded, and the bare `catch` swallowed it — so every
probe looked successful while the state-detection code after the throw silently
never ran. `statesProbed` went 1 → 0 and the only reason anyone noticed is that a
rung gate asserts it non-empty.

That catch now re-raises `ReferenceError`/`TypeError` as a finding. A timeout
driving a candidate is ordinary; a programming error is not, and a catch that
cannot tell them apart converts a bug into missing data.

`settleResponses` is also bounded now. It awaited every in-flight response read
with an unbounded `allSettled`, and a read whose context closed underneath it can
stay pending forever — which hung a run for seven minutes. Dropping an
observation is a loss the coverage invariants would report; a hung crawl reports
nothing.

---

## 4. Fixture legality, generalized

A fixture is legal iff it is **(a) producible by the stage that owns it** and
**(b) justifiable under the rules governing its fields**. Observed fields are
exempt from (b); derived ones are not, and the mechanism already existed —
`NarrowingRecord` carries the counts it was drawn from, so an unjustified enum
does not parse.

The audit, one row per derived field:

| field | status | note |
|---|---|---|
| `narrowing` (enum/const/format) | **schema-enforced** | carries its counts; floor and ratio checked (0010) |
| `requiresAuth` | **schema-enforced** | recomputed from `authEvidence` (0010) |
| `content.contentHash` | **schema-enforced** | recomputed from dom+styles+states |
| `endpointId` | **schema-enforced** | recomputed from method + pattern. Found drift on the first run |
| `styleId` agreement | **schema-enforced** | `dom.styleId` must equal `styles.assignments` |
| `discovery` | **schema-enforced** | capture artifact rejects `bound-from-control` (0010) |
| `params.path` vs `pathPattern` | **schema-enforced, partial** | every declared `:param` has a recorded value — this does **not** verify the segment should have been parameterized at all, which no artifact records enough to decide |
| `pathParams` vs `urlPattern` | **schema-enforced, partial** | same limitation |
| `isMutation` | **one-directional** | a safe method cannot mutate. The converse is not enforced: a POST that only reads is real |
| `destructive` | **one-directional** | skipped-as-destructive implies destructive. The converse is not: with `--allow-destructive` a destructive flow completes |
| `cause` / `matchedTerm` | **schema-enforced** | a classification names what classified it |
| `nodeId`, `styleId` derivation | **tested, not schema-enforced** | recomputed in the fixture suite. Moving a whole-tree rehash into every parse is a real cost for a property no producer has gotten wrong |
| `templateGuess` | **carries evidence** | confidence + rationale, by construction |
| `coverage.*` counts | **derived in the producer** | the invariants are the check; the observed side is independently derived |

`endpointId` justified the exercise on its own: the fixture claimed
`get-api-products-id` for `/api/products/:slug`, an id that had drifted from its
own pattern and would have had infer and codegen disagreeing about which endpoint
they meant. Capture now imports the schema's `deriveEndpointId` rather than
keeping a second copy.

---

## 5. Stage boundary: narrowing lives in `shared`

Enum and identifier rules moved to `packages/shared/src/narrowing.ts`. §5 puts
response schemas in the capture tree, so inference runs at capture today, but
§7.4 derives the data model from those same schemas and `infer` will want the
same logic. Two implementations of "is this field an enum" would drift and then
disagree about the same field.

The thresholds stay in `@siteforge/schema`, imported by the algorithm: the zod
refinement enforces them, and a second copy that drifted would let capture emit
narrowings the schema then rejects.

The secret scanner lives there too, for a different reason — it needs to be
testable TypeScript rather than an untested `.mjs` beside the crawler.

---

## Open

- **Rung 2 does not probe**, so `--allow-destructive` is inert there. Giving it a
  probe phase means sharing rung 3's loop; worth doing when a third target
  arrives, not before.
- **`session-destructive` re-auth assumes non-interactive login.** §6's real
  `--auth` path is headful and manual, so on a live target these probes must run
  last and the crawl ends signed out. Nothing enforces that ordering yet.
- **Compressed artifacts are outside the secret gate.** See §2.
- **The out-of-scope hazard is detected from `href` only.** A JS-driven
  `window.open` to another origin classifies as ordinary and would be probed.
