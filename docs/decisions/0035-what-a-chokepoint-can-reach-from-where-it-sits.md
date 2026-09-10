# 0035 — What a chokepoint can reach from where it sits

*Status: accepted. Audit + one §13 rule.*

## 1. The finding that generalised

0031 §2.1: every manifest asserted `determinism.prefersReducedMotion: 'reduce'`,
and **four of six contexts did not set it** — both crawl contexts among them,
which is every route, screenshot and DOM in the artifact.

The interesting part is not that a field was wrong. It is *why the chokepoint
did not catch it*. `guardContext` is cited throughout this repository as the
place every browser context is made safe, and it is: origin guard, determinism
shim, one call, asserted by a test that forbids a bare `newContext(`.

But `guardContext` takes a context that **already exists**. `reducedMotion` is a
`newContext` *option*. A guard that attaches after construction can add an init
script and a route handler and can never repair an argument that was already
wrong — so the guarantee was never inside the thing everyone pointed at.

**Nothing was wrong with the chokepoint. It was cited for something outside its
reach.** That is a different failure from a guard with a hole, and it does not
look like one from any call site.

## 2. The audit question

Not "does everything go through the guard" — that was true here — but:

> **What exists, or is emitted, before this attaches; and what does it decide
> that this cannot change afterwards?**

Four chokepoints, and they answered differently, which is the argument for
asking rather than assuming.

### 2.1 `guardContext` — reach was narrower than the claim

Fixed. `newGuardedContext(browser, extra)` merges `CONTEXT_DEFAULTS` and *then*
guards, so a construction argument is enforced by the constructor.
`determinism.test.mjs` asserts exactly one `.newContext(` call in the file and
that the manifest reads the same constant it applies.

### 2.2 `installEscapeGuards` — a real window, provably empty

There is a genuine gap between `context.newPage()` and the listener attaching,
and the source says so: `// unguarded: guarded on the next line`.

It is empty, and the argument is mechanical rather than hopeful: `popup` and
`download` are consequences of *navigation*, and a page that has not navigated
cannot emit either. The window exists and contains no events it could miss.

Recorded because "we checked and the reach equals the claim" is a result, and an
audit that reports only its failures cannot be told from one that stopped early.

### 2.3 The §3.4 scrubber — the claim is wider than the reach, and known

§3.4: the scrubber "must redact tokens, cookies, emails … **before any artifact
is written**". Playwright writes the HAR itself, at context close, with no hook —
so `scrubHarFile` rewrites it afterwards.

The true reach is *our* writes, plus a rewrite for the one artifact we do not
write. Between `context.close()` and `scrubHarFile` there is a real window in
which a file holding live `Cookie` and `Set-Cookie` values exists on disk, and a
crash inside it leaves that file there. Already known and already handled as well
as Playwright allows; what this audit adds is that **the claim in §3.4 is wider
than any implementation of it can be**, and a reader should know which half is a
guarantee and which is a repair.

### 2.4 `scanCaptureTree` — an ordering, not a chokepoint

§13 calls §3.4 "a gate, not a note. Every file written under `capture/` is
scanned." The reach is every file that **existed when the scan ran**, and the
scan is a line near the end of a 1700-line driver.

Today nothing writes after it — verified. But that is an *ordering* somebody has
to preserve, not a property anything enforces: a write added below line 1748 is
unscanned and no gate says a word. The distance between "every file written" and
"every file present at one moment" is exactly one careless append.

Not restructured here. Recording it because the gap is the kind that reads as
closed for years and then is not, and because §3.4 is the one gate in this
repository whose failure is a leaked credential rather than a bad score.

## 3. And the same shape, pointed at the test suite

Found while landing 0032's ancestor scroll: a dropped closing paren in
`capture-site.mjs` survived **`pnpm build`, `pnpm typecheck`, `pnpm lint` and
`pnpm test`, all four green.** It was found by a nine-minute crawl dying on the
first line of `node`.

Every gate behaved correctly. `tsc` does not read `.mjs`. The lint scripts read
this file as *text*, and so does `determinism.test.mjs` — the only test that
looks at this driver at all. `verify:clean` runs rung 2 and rung 3, neither of
which imports the real driver, because it needs Docker and a live target.

So the union of every gate covered this file's **contents** and never its
**syntax** — the same reach-versus-claim gap, one level up, in the machinery that
is supposed to find these. `scripts-parse.test.ts` runs `node --check` over every
shipped `.mjs`, with a `mustReach` floor naming `capture-site.mjs` so a walk that
found nothing cannot report a clean parse of nothing, and
`sabotage/driver-does-not-parse.patch` reinstates exactly the character that was
missing.

## 4. The rule

Added to §13 beside `.gitignore` is not a scope boundary, because they are the
same shape: one is a guard whose scope comes from the wrong **view**, the other a
guard whose scope comes from the wrong **moment**.

> State a chokepoint's reach beside its claim, and where they differ, either move
> the guard or narrow the claim.
