# 0013 — One walker, two origins, and failing closed by category

Status: accepted

Five operator rulings, landed in order. Each of them turned something that was
true by inspection into something a gate enforces.

## 1. One scanner walker

Four scanners had grown three private file walkers: the catch linter, the
page-guard linter, the secret gate, and the repo-hygiene audit. One of them
carried the bare name `capture` in its ignore list, so `packages/capture/` was
skipped entirely and the linter reported success over 8 of its 21 catch blocks.
That was the third time an unanchored name match hid a package from a tool here.

`walkFiles` in `@siteforge/shared` is the only implementation now, and two
properties are structural rather than remembered:

- **Ignore patterns must be anchored.** `/path` is exact; `**/name` matches at
  any depth *because it says so*. An unanchored bare name throws at module load,
  so the bug that started this cannot be written in the new code.
- **`expect` is a required parameter.** A scan declares how many files it must
  see and which directories it must reach, and gets a thrown `VacuousScanError`
  rather than a green tick when it doesn't. The "must reach
  `packages/capture/scripts`" assertion that used to live in one linter's test
  is now `REPO_SOURCE_EXPECTATION`, and applies to every scanner at once.

**The profile split is load-bearing.** §3.4's gate must scan *every* file under
`capture/` — "not a chosen list: the point of the gate is that it does not
depend on somebody having thought of the artifact that leaked". A single shared
ignore list reaching the secret gate would have quietly weakened the strongest
gate in the repo during a refactor whose entire purpose was removing vacuous
checks. So the `tree` profile's ignore list is empty **by construction**: there
is no parameter through which a caller could give it one, and a test asserts
that an `ignore` option passed anyway is inert.

`pnpm lint` builds shared first. A linter that cannot load its walker fails
loudly rather than falling back to a private one.

## 2. Rung 2 gets a second origin

The crawl boundary has two branches and only one had ever executed. Blocking an
off-origin main-frame navigation was measured by rung 3; *allowing* a subresource
from another origin was asserted only in a unit test, because every fixture
served everything from one origin. That is why the report line deleted in 0012
could only ever print zero.

Rung 2 now serves the page from `localhost:8788` and its font plus one image
from `127.0.0.1:8790`. Two origins, both loopback, both in `allowlist.txt`,
nothing leaving the machine — `localhost` and `127.0.0.1` differ as origins
while resolving to the same interface, which was measured before being relied
on. The page also calls `window.open` to a foreign origin and starts a download
on load, so **one fixture exercises both branches**: a guard that blocked
everything would pass `blockedOffOriginNavigations` and fail `foreignAssets`,
and a guard that blocked nothing would do the reverse.

All three are rung gates rather than console lines, and the runner asserts the
second origin is **not** in `allowedOrigins` — a subresource allowed because it
was allowlisted would prove nothing about the guard.

The sabotage is on the assertion, not the guard. A fault-injection switch that
made the predicate block subresources would be a flag that weakens the boundary,
shipped in a repo whose §13 says never `--force` past a failing gate.
`rungs.test.mjs` sabotages every gate key instead, with the test table generated
from the rule table so the two cannot drift.

## 3. Every boundary refusal becomes a gap

A cancelled download and a closed popup were counted in a console line and
recorded nowhere. §13: a known gap recorded only in prose is not tracked, so the
next stage had no way to learn that a control leads somewhere the crawl declined
to follow.

Gap ids are derived from the target URL, never from a counter or arrival order:
`manifest.contentHash` is M1's idempotency check, and an id that moved when two
popups arrived in a different order would make a re-crawl of an unchanged site
look changed. The same URL produces the same id in rung 2 and rung 3.

Rung 2's fixture actually starts a download now. A cancel handler tested against
a fixture that never downloads is the logout-returning-204 problem again.

## 4. The gap names the origin, not the error page

The popup gap said `chrome-error://chromewebdata/`.

Measured before fixing: for a popup whose navigation the router aborted,
`popup.url()` gives that error page at **every** moment it can be read — at the
event, via `mainFrame().url()`, and 300 ms later. The hypothesis that the popup
event carries the intended URL before the block resolves is false, so the URL is
not recoverable from the popup and is not invented.

It does not need to be. Two `window.open` calls to two foreign origins produce
**exactly two** router records, each carrying the real target. The router owns
the URL; the popup handler no longer emits a rival record naming an error page.
A popup the router never saw still produces a gap of its own — silence there
would be a dropped escape, and that is the one case correlation machinery would
have covered.

## 5. Unclassifiable fails closed *by category*

A default gets chosen against the common case and then applied to every case,
including the one where it is dangerous. `request.frame()` throws for a popup's
first navigation, and "a request I cannot classify is a subresource" was correct
for subresources and let a `window.open` to another origin complete.

Auditing for that shape found three more:

| fallback | common case it suited | where it was dangerous |
|---|---|---|
| `.catch(() => {})` on the anonymous auth probe | the fetch returns, or answers 401 | a rejection records no evidence, so `requiresAuth` stays `unknown` — and §8 resolves `unknown` to **not-required for reads**. One swallowed rejection publishes a gated endpoint in the clone and makes every §10 auth task through it bypassable |
| §3.4's exemption matched `endsWith('auth/storage-state.json')` | one file, at the tree root | *any* file at *any* depth ending that way skipped the content scan. The unanchored-path bug again, this time inside the secret gate |
| a credential shorter than the scannable floor was skipped | real passwords are long | the gate reported clean on a value it never searched for, and said nothing |

The length floor itself is right — a two-character literal matches every
artifact. Skipping *silently* is what was wrong, so an unscannable credential is
now a finding naming the variable.

`pnpm lint` covers `.catch(fn)` as well as `catch {}`: the same swallow in
different syntax was invisible for nine call sites, and the linter had been
reporting every catch accounted for. Eight of the nine were genuinely
operational and now carry a specific `// operational:` reason; the ninth was the
auth probe.

### The test that was vacuous

The first version of the storage-state sabotage asserted the nested file
*appeared* in the findings. It passed under the old matcher too — the file was
reported for its mode rather than its contents, so the assertion could not tell
the two apart. Asserting on the **rule** (`cookie-header`) rather than the
filename makes it fail under `endsWith` and pass under `===`, which is the
property the fix is about.

## Found along the way

`manifest.counts.gaps` was computed before `narrowingGaps` was appended, so the
manifest said 3 while `stage-report.json` carried 4 — two artifacts of one run
disagreeing about a quantity both report, with nothing comparing them. Both
runners now assert the two agree, and the check is sabotage-verified.

Rung 3's gate read `rungCounts` while its printout read `extracted`, so a
passing gate printed `✗`. A green run with a red line in it teaches you to stop
reading the lines.

## Open

- `installEscapeGuards` and the router both observe escapes, and the pairing
  between a blocked popup and its router record is exact but *assumed* rather
  than enforced: nothing fails if a future Playwright emits one without the
  other. The fallback gap covers the visible half of that.
- The `interactive` session-probe policy still has no rung (carried from 0012).
- `boundaryGaps` is called once per run with every event, so it cannot say
  which route an escape happened on. Rung 2 has one route and passes it; rung 3
  passes none, and those gaps are subjected on the URL alone. The URL is exact;
  the route is simply absent rather than wrong. Threading the current route
  through `onBlocked` would fix it.
