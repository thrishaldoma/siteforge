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

Three sweeps, and the third is the one that answers the attribution question.

| sweep | crawl | paths not reproducing |
|---|---|---|
| fresh container ×3, **before** the shim | 491s | **87 of 166** |
| fresh container ×3, after the shim | 477s | **34 of 165** |
| one container held still ×2 | 474s | **43 of 167** |
| fresh container ×3, **read-only** (no probing) | **50s** | **4 of 81** |

The shim removed 53 paths. Post-fix, exactly one `dom.json` still varies, and
the read-only sweep below shows it is the same file for a different reason.

**A secondary effect worth recording, because it looks like a lost measurement.**
The anonymous auth sweep reported *272 distinct GET URLs* before the shim and
*28* after. Nothing was lost: the sweep de-duplicates by URL, and the avatar's
cache-busting `?size=50&=<Date.now()>` made every fetch of one image a distinct
URL, so 244 of those re-issues were the same endpoint asked over and over.
Every `auth.*` metric scored identically across the change — `evidence-coverage`
1.0000 (17/17), `truth-coverage` 0.6190 (13/21), `under-gate-count` 0 — which is
what says the verdicts were never affected. The log line said "GET endpoint(s)"
over a count of URLs and has been corrected, because a tenfold drop under a
wrong label is exactly how a fix gets mistaken for a regression.

### The held-container discriminator does not discriminate, and that is a finding

It was built on the ruling's reasoning — hold the target still, and a difference
that survives is ours. It made things **worse**: 43 varying paths against 34,
and the endpoint count fell from 22 to 20.

**Because the crawl is not read-only.** §6's probe pass clicks controls, some of
which create and edit rows, so the second crawl of a held instance is reading
the first crawl's writes. Holding the container holds the *image* still and lets
the *data* drift, and the drift is caused by the instrument.

That is 0026's one-shot-reproduction rule in a new place: there, the
reproduction could not exhibit the failure; here, the control condition
perturbs the thing it is controlling for. Both read as valid experiments. The
tell was the direction — a discriminator that is supposed to *remove* a source
of variance and adds nine paths is not measuring what it was pointed at.

### The read-only crawl is the one that separates them

No probing, fresh container each time: **4 of 81 paths**, and they are one
mechanism.

```
routes/tasks-id--auth-desktop--i0/dom.json     <time datetime="2026-09-09T20:43:27Z">
routes/tasks-id--auth-desktop--i0/meta.json    its content hash, downstream
manifest.json                                  the aggregate, downstream
network/endpoints.json                         `samples` only — 8 of 16 endpoints
```

The `<time>` node is the seeded task's `created`, written by the container's own
clock when the fixture is seeded. `network/endpoints.json` differs in
**`samples` and nothing else** — every inferred schema, parameter, auth verdict
and evidence list is byte-identical across the three runs, because the same
timestamps ride in the recorded response bodies.

**So the attribution is:**

- **Ours:** everything above four paths. The probe pass — flow traces, probed
  state deltas, `skipped-controls.json`, `coverage.json`, `stage-report.json`
  and the route `states.json` that probing contributes to. It is timing, it is
  the same timing that produces the click timeouts (0026 §3), and §8 makes it a
  hard failure that this project has not yet paid.
- **The target's:** the four. A fresh container seeds its fixture rows at
  whatever time it boots, and nothing short of faking the container's clock
  changes that. A property to record, per the ruling, not a bug to fix — and it
  is *not* exempted here, because an exemption on `routes/*/dom.json` would hide
  every future real difference in the file to silence one node.

And the deterministic core is deterministic: **77 of 81 paths reproduce byte for
byte**, including every screenshot, every asset, every style table, and every
inferred endpoint schema.

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
| 0026's timeout distribution (51 of 51 visible, 49 of 51 off-screen) | **inside the band.** Undriveable ran 65–72 across six probing crawls. The *shape* — visible, stable, enabled, centre off-screen — is what the finding rests on, and the population it is drawn from moves by about ±5% between runs |
| endpoint count 22 | stable across three probing crawls; **20** on a held container and **16** read-only, both explained: probing discovers endpoints, and probing on a mutated instance discovers different ones |
| "3 emails redacted in the main bundle" | survives: `assets/` reproduced perfectly, all 47 paths |

---

## Open

- N=3, not N=10, on the probing sweeps. The variance was structural — 87 of 166
  paths, traceable to one clock — so more runs would have refined a magnitude
  rather than the finding. The read-only crawl costs 50 seconds rather than
  eight minutes, so N there is cheap and the number to raise first.
- **The instrument is deliberately red by four on this target.** The residue in
  §5 is the target's own seed-time row timestamps, and it is not exempted
  because an exemption on `routes/*/dom.json` would hide every future real
  difference in that file to silence one node. So compare against **4**, not 0,
  and do not "fix" it by adding an exemption — the number to watch is whether it
  moves.
- **The probe pass is non-deterministic and §8 calls that a hard failure.** It
  is not fixed here. What has changed is that it is now measured, bounded to one
  stage, and separated from the target's contribution — the next question is
  whether a deterministic probe order and a settled page can close it, or
  whether behaviour probing is inherently a sampled measurement that should
  record its own variance.
- This gate is not in `verify:clean` and cannot be: it needs Docker and eight
  minutes a run. M1's gate therefore remains a thing someone must run, which is
  the condition that let it go unrun for its whole life. The honest mitigation
  is that it now exists and fails loudly, not that it is automatic.
