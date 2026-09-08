# DECISION 0012 — a boundary that prevents, and a catch that cannot lie

**Status:** RECORDED. Implemented.
**Raised:** operator rulings closing M1
**Affects:** `packages/shared` (crawl scope, errors, probe schedule), `capture-lib`,
both rung drivers, `CaptureManifest`, `CoverageReport`, `pnpm lint`,
CLAUDE.md §6 and §13

M1 is closed. These gate M2. The shape they share: a rule that was true by
inspection, enforced nowhere.

---

## 1. The crawl boundary moves to a chokepoint

§6 says "same-origin only", and that was enforced by not *following* off-origin
links. A control that calls `window.open` reaches another origin without any link
being followed — and §6's behaviour probing clicks controls. The rule was open to
exactly the thing the stage does.

`context.route('**/*')` now aborts a main-frame navigation whose origin is not in
`manifest.crawl.allowedOrigins`, which derives from the crawl scope in one place.
`page.on('popup')` records and closes; `download` records and cancels.

**Subresources to any origin are allowed and recorded**, which is the half that
keeps capture working: fonts, images, scripts and XHR from CDNs are how real
sites render, and §8 localizes them later.

### The hole the wiring test found on its first run

The predicate was right and the wiring was not. Playwright's `request.frame()`
**throws** for a popup's first navigation — the frame is not attached yet — and
the guard treated an unresolvable frame as "not a main frame", i.e. as a
subresource, i.e. allowed. Measured with `requestfinished`:

```
https://example.net/partner  → FINISHED (left the machine)
```

The popup handler did fire, and closed the popup — *after* the request had
completed. Detection is not prevention.

The rule is now: an unclassifiable **subresource** is allowed, an unclassifiable
**navigation** is treated as a main-frame navigation and blocked. A navigation is
never a font. After the fix:

```
https://example.net/partner  → blocked: net::ERR_BLOCKED_BY_CLIENT
https://example.net/link     → blocked: net::ERR_BLOCKED_BY_CLIENT   (target=_blank)
https://example.net/pixel.png → allowed (a foreign subresource, as required)
```

This is why the test could not be a pure predicate test. `decideNavigation` was
correct throughout; the defect was in what the caller fed it. A unit test of the
decision would have passed while the request left the machine.

The popup's recorded origin is now `null` — it is still on `about:blank`, because
the router aborted the navigation before it committed. That the popup never
reaches the foreign origin at all is the chokepoint winning the race.

The post-click origin check stays as a second layer, and reports
`origin-guard-hole` rather than an out-of-scope classification: if it fires, the
interceptor missed something and that is a defect.

---

## 2. The catch taxonomy

Two classes: **operational** (timeout, aborted navigation, detached element,
refused connection — expected, recoverable, becomes a gap) and **everything
else** (defects, which must propagate). `rethrowIfDefect(err)` is the idiom.

`isOperationalError` matches Playwright's errors on message text, because there
is no class to `instanceof` across the process boundary — but a `ReferenceError`,
`TypeError` or `SyntaxError` is **never** operational whatever its message says.
That exclusion is the whole point: a text-only matcher would re-admit the exact
defect the taxonomy exists to keep out, and there is a test that a
`ReferenceError('Timeout 30000ms exceeded')` still propagates.

`pnpm lint` enforces it repo-wide: every `catch` binds an error and either calls
`rethrowIfDefect`/`isOperationalError` or `throw`s, unless it carries
`// operational: <reason>`. 21 catch blocks, all annotated or converted.

### The linter reproduced the bug it was written to prevent

Its first run reported 8 catches across 53 files. The real number is 21 across
66. `IGNORED_DIRS` contained `'capture'` — matching `packages/capture/` — so it
skipped the entire crawler.

That is the third time an unanchored *name* match has hidden the capture package
from a tool in this repo: `.gitignore` first, then this. The linter now reports
how many catches it examined, and a test asserts that count is non-zero and that
`packages/capture/scripts` is in its file list. A scanner that finds nothing
because its glob missed everything reports success, which is the vacuous-check
failure in a new costume.

Also fixed: the scanner matched the word `catch` inside its own error message.
Strings and comments are blanked (offset-preserving) before scanning.

### Findings now fail the run

Rung 3 printed `FINDINGS (3)` and exited 0. A gate that reports a problem and
returns success is the pattern this milestone has been removing. Findings are
fatal now — which immediately forced the noise behind them to be fixed rather
than tolerated: `option` was in `INTERACTIVE_ROLES`, and an `<option>` is not
independently activatable, so probing one could only ever time out. Three
"could not be driven" findings per run, standing between a reader and a real one.
The options are not lost; they are the enum evidence a `<select>` carries (§7.5),
read from the DOM rather than by clicking.

---

## 3. Session-destructive probing, enforced rather than documented

`manifest.crawl.sessionProbePolicy` records whether session-destructive probing
was unrestricted, derived from `credentialSource` and recomputed by the schema:

| policy | meaning | probing |
|---|---|---|
| `credentialed` | env/keychain creds; re-auth is non-interactive | run freely, each on its own fresh login |
| `interactive` | headful human login, unrepeatable | run **last**, once, then the crawl terminates |
| `not-applicable` | no authenticated context | nothing to spend |

Named for what it governs rather than for the auth mechanism: the question a
consumer asks is never "how did we log in", it is "could we afford to throw this
session away".

`planProbeSchedule` returns every control in execution order with its phase and
whether it will be fired, and a test asserts the ordering directly — no browser,
no rung. Under `interactive` the session budget is 1: the second
session-destructive control is scheduled and declined `session-budget-spent`, and
`terminatesAfterSchedule` reports that the crawl must stop.

**Coverage is mode-aware.** `session-destructive-controls-are-fired` requires
every such control to be fired, and is vacuous under `interactive` — where one
unrepeatable session means at most one can be. Holding an interactive capture to
a credentialed one's standard would fail a run that did everything it could.

---

## 4. Fixture apps must be able to inflict their hazard

The sabotage rule one level up, and the audit found two:

**The logout handler returned 204 without touching the session map.** Fixed in
0011; it made "session-destructive" a hazard the fixture could not cause.

**The details panel toggled `.is-open`, and the stylesheet styled it** — while a
comment three lines above claimed "No CSS rule keys off .is-open". The probe
worked only because `cssomText` holds *state* rules and that is a plain class
selector, so the fixture was testing a different property than the one it
advertised. Worse, keeping the class handed the detector exactly the class diff
it keys on: the fixture was engineering the signal.

The honest version sets `style.display` and changes no class at all. The detector
then found nothing — which was a real finding about the detector, not the
fixture. §6's probing exists for state CSS cannot express, and inline style is
the commonest form of it. The detector now diffs per-element inline style as
`attributeChanges` alongside class diffs, and `statesProbed` went from 1 to 2.

Also added: a control with **no href** that calls `window.open`, so the boundary
has something real to stop. It is the reason §1's hole was measurable rather than
theoretical.

---

## 5. Rung credentials are random

Endorsed and generalized. `SITEFORGE_PASS` is now
`pw-${randomBytes(18).toString('base64url')}`, generated per run and passed to
both the fixture app and the capture driver.

No entropy heuristics in the scanner. A literal scanner cannot distinguish a
leaked secret from a secret that is also an ordinary word — that is not a defect
in the scanner, it is the nature of literal matching — and the fix is to make the
secret distinguishable. Random makes the collision impossible rather than merely
unlikely.

---

## Addendum: the open item was wrong, and that is the finding

This document originally listed, as open, that one page in the route-capture
path lacked `installEscapeGuards`. Auditing it found the opposite: all six
`newPage()` call sites — four in rung 3, one in the spike, one in the
origin-guard test — were already guarded. The note was stale, and nothing in
the repository could tell me so.

That is the same failure as the rule it describes. A page-level guard attached
by remembering is a property that holds until someone adds a `newPage()`; a
note claiming it is broken is a property nobody re-checks. Both were prose.

`scripts/lint-guarded-pages.mjs` now runs in `pnpm lint`: every `await
x.newPage()` must bind its result and call `installEscapeGuards` on *that*
binding within the next few lines, or carry `// unguarded: <reason>`. The
sabotage test deletes a guard from the real `rung3.mjs` and asserts the linter
fails — a synthetic string would only have proved the regex compiles.

The window is deliberately narrow. A guard attached after the page's first
`goto` is a guard that was not installed when it mattered, and the linter
rejects it for the same reason it rejects no guard at all.

---

## Open

- **A guarded context blocks the navigation, and the popup then sits on
  `chrome-error://chromewebdata/`.** Recorded as a popup with a null origin,
  which reads oddly in a gap. Cosmetic.
- **The `interactive` path has no rung.** Both rung targets are scripted, so
  `sessionProbePolicy: 'interactive'` is exercised only by unit tests of the
  scheduler. A headful rung is not worth building for this alone; when M6 tests
  `--auth` end to end, that is the moment.
- **Downloads are cancelled but never recorded as a gap.** They are recorded as a
  blocked event; nothing yet turns that into a `GAPS.md` entry.
