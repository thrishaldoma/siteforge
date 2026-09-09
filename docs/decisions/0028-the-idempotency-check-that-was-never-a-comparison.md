# 0028 — The idempotency check that was never a comparison

**Status:** accepted
**Date:** 2026-09-10
**Context:** §6 (the determinism shim), §8 (determinism is a hard fail), §12 M1
("recrawl is idempotent modulo timestamps"), §13 (a gate takes its inputs as
parameters; scope comes from one view or the other), 0026 (`locate/not-found`
read 16 then 19)

0026 recorded, as a minor open item, that one count moved between two crawls of
an unchanged pinned digest. It is not minor. Every A/B in this project assumes
capture is constant between runs, and that assumption had never been tested —
so the first question is not *why did 16 become 19* but *what else has been
moving all along.*

---

## 1. The check exists, and it is not a comparison

`manifest.contentHash` is M1's idempotency check. Three drivers compute it,
`capture-lib.mjs` calls it "M1's idempotency check" in a comment, and
`boundary-gaps.test.mjs` names it when justifying stable gap ids.

**Nothing reads two of them.** There is no code path anywhere in the repository
that takes two captures and asserts anything about them. The value is written
into an artifact and never looked at again.

That is §13's staleness-gate shape exactly — *"its comparison sat downstream of
a Docker boot inside `main()`, so it had never once run, let alone failed, and
an inverted comparison in it would have read exactly like a working one"* —
except worse, because here there is no comparison to invert. A gate nobody ran
and a gate nobody wrote are indistinguishable from the outside, and both were
being cited as evidence.

The second problem is the one the ruling anticipated: its **scope is routes**.
`deriveRouteContentHash({dom, styles, states})`, so `flows/`, `network/`,
`assets/`, `coverage.json` and the gap list sit outside it by construction —
which is where `locate/not-found` lives.

## 2. What it found on the first run

`assessCaptureIdempotence` takes the trees as parameters, compares the **whole**
file set, and treats "modulo timestamps" as exactly one thing: the schema's own
`VOLATILE_ARTIFACT_KEYS`, which is `['provenance']`. Anything else that differs
is a finding rather than a new exemption — the exemption list is where a tool
like this goes wrong, by growing until the diff comes out clean.

Three crawls of the pinned digest, N=3 (each takes 8.2 minutes; the ruling asked
for 10 and the shortfall is a wall-clock call, stated rather than hidden — the
variance turned out to be structural rather than marginal, so more runs would
have refined a magnitude, not the conclusion):

```
run 1   492.8s   7 routes · 22 endpoints · 82 gaps · 72 undriveable
run 2   490.9s   7 routes · 22 endpoints · 82 gaps · 72 undriveable
run 3   489.2s   7 routes · 22 endpoints · 75 gaps · 65 undriveable

✗ 87 of 166 paths did not reproduce
```

| artifact | unstable | stable |
|---|---|---|
| `routes/*/dom.json` | **7** | 0 |
| `routes/*/meta.json` | **7** | 0 |
| `routes/*/states.json` | 6 | 1 |
| `routes/*/styles.json` | 1 | 6 |
| `flows/probe-*.trace.json` | 61 (+5 present in some runs only) | 7 |
| `coverage.json`, `manifest.json`, `network/endpoints.json`, `stage-report.json`, `flows/skipped-controls.json` | 5 | — |
| `routes/*/shot.full.png`, `routes/*/scroll/*.png` | 0 | **18** |
| `assets/files/*`, `assets/index.json` | 0 | **47** |

**So M1's check would not have been merely too narrow — it would have been red
on every route, on every run, since the day it was written.** `dom.json` and
`states.json` are two of its three inputs and both moved. The gate that was
cited as covering this was not silent because of its scope; it was silent
because it was never called.

Two things reproduce perfectly and are worth naming: **every screenshot** and
**every content-addressed asset**. The rendering is deterministic and the bytes
the server sends are deterministic. It is the DOM *serialisation* that was not.

## 3. One node, one clock

Diffing two `dom.json` files: `nodeCount` identical, and exactly **one** node
differs, on every route that has it.

```
A: img … src=".../api/v1/avatar/sfadmin?size=50&=1788984776857"
B: img … src=".../api/v1/avatar/sfadmin?size=50&=1788985268416"
```

A cache-busting query parameter carrying `Date.now()`. One live clock reading,
in one attribute, moving the DOM hash of every page the avatar appears on — and
through it `meta.json`'s content hash, and through that the manifest's.

**§6 says to prevent exactly this, and says why:**

> Inject a shim before any page script that freezes `Date.now`,
> `performance.now`, `Math.random`, and `crypto.randomUUID` against the run
> seed — you need this here as well as in the clone, or your "identical"
> recrawls will never be identical.

`rung3.mjs` installs it. `spike-one-page.mjs` installs it. **`capture-site.mjs`
never did** — and wrote this into every manifest it produced:

```js
frozen: ['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID'],
```

A literal. A derived claim with nothing behind it, in the artifact, unconditional
— the failure mode §13 has the most rules about, in the field whose whole job is
to say the run was deterministic.

### Which side the variance is on

**Ours.** The discriminator planned for this — two crawls against one held-still
container, against two with a fresh container each — was not needed, because the
mechanism settles it: the page reads a clock we are required to freeze and did
not. §8 makes our own non-determinism a hard failure, and this is entirely ours.
The `--reuse-container` flag was built anyway and stays, because the *residue*
after this fix is the thing it is actually for.

## 4. The fix, and where it goes

On `guardContext` — the one place this driver makes a context — and not at the
six call sites. §13 already argues this for the escape guards: a per-context
obligation is one you forget at the next `newContext()`, and the one that gets
forgotten is whichever context is added last. `determinism.test.mjs` asserts
three things a comment could not: that every global the manifest claims is
frozen appears in the shim, that the shim is installed on the chokepoint and
nowhere else, and that no `browser.newContext(` in the file bypasses it.

`DETERMINISM_FROZEN` and `FROZEN_EPOCH_MS` are now single constants read by both
the shim and the manifest, so the two cannot drift apart again.

## 5. Measured after the fix

*(filled in after the second sweep)*

## 6. Which earlier results fall inside the variance band

Almost none, and for a structural reason worth stating rather than assuming.

**Every A/B in the last three turns compared two *infer* runs over one capture
directory** — `--without merge`, `--without dedupe`, `--without narrowings` — so
both sides read identical bytes and capture's variance cannot enter. 0025 §5's
"every capture-fidelity metric identical to the digit" is one infer input graded
twice, and it stands.

The comparisons that **do** cross two captures are:

| claim | status |
|---|---|
| `locate/not-found` 16 → 19 (0026) | **this finding**, not a result needing revision |
| 0024 → 0026 endpoint count 16 → 22 | survives: caused by probing being added, and 22 reproduced in all three runs |
| 0026's timeout distribution (51 of 51 visible, 49 of 51 off-screen) | **inside the band** — run 3 saw 65 undriveable where runs 1 and 2 saw 72. The 49/51 shape is a proportion from one run and is re-measured in §5 |
| "3 emails redacted in the main bundle" | survives: `assets/` reproduced perfectly, all 47 paths |

---

## Open

- N=3, not N=10. The variance was structural — 87 of 166 paths, all traceable to
  one clock — so more runs would have refined a magnitude rather than the
  finding. Worth revisiting once the tree is stable, where the question changes
  from "what varies" to "how often".
- This gate is not in `verify:clean` and cannot be: it needs Docker and eight
  minutes a run. M1's gate therefore remains a thing someone must run, which is
  the condition that let it go unrun for its whole life. The honest mitigation
  is that it now exists and fails loudly, not that it is automatic.
