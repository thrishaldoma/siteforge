# DECISION 0008 — split the action type; encode coverage as invariants

**Status:** ACCEPTED (operator ruling)
**Raised:** M1, after the rung-2 measurement
**Affects:** `flows.ts`, `states.ts`, new `coverage.ts`, new `shared/element-ref.ts`, §6

## 1. `ActionSchema` is split, not bridged

Two types, no shared parent:

| | lifetime | lives |
|---|---|---|
| `FlowStep.target: ActionTarget` | durable | on disk, in `flows/*.trace.json` |
| `EnvAction.ref: ElementRef` | episode-scoped | memory, never persisted |

A shared type would let an ephemeral ref be written to a file.

### The subtlety that shapes `ActionTarget`

§9 replays a recorded flow **against a DOM codegen generated**, not against the
original's. The clone's node ids are computed from a different tree; its class
names and selectors come from Tailwind and generated components. **`nodeId` and
`selector` do not transfer.**

So the weak fields are quarantined under a field named for what they are:

```ts
ActionTarget = {
  role, name,                               // load-bearing
  entityRef: EntityRef | null,              // load-bearing, when present
  diagnostic: { nodeId, selector, boundingBox },  // explains failure; never resolves
}
```

Naming them `diagnostic` is the point. As flat siblings of `role` and `name`
they read as equally usable, and someone resolves against `selector` by reflex
because it looks like the direct route. It is the one that cannot work.

### `entityRef` is infer's, not capture's

Entity identity does not exist until §7.4 infers the data model from
`endpoints.json`. Capture writes `null` — the schema rejects anything else — and
the M2 SiteModel carries the enriched version, leaving the capture artifact
immutable (§4). This is what lets replay use the same entity-first order as §10.

### One resolver, in `shared`

`packages/shared/src/element-ref.ts` holds `ElementRef`, `TargetResolver`,
`ResolutionOutcome`, and `StaleRefError`, consumed by §9 replay and §10 envkit.

§9 is where it gets hardened: replay meets real re-renders at M2, years of
project-time before `envkit` exists. Better the gate finds the sharp edges than
the RL loop. **Contract now; implementation at M2's behavioral gate.**

## 2. Selector matching is parsing

All three rung-2 extraction bugs were one bug — **string operations on a
grammar**:

- `[aria-expanded]` never matches `[aria-expanded="true"]` by substring, so every
  attribute-state rule was dropped.
- Regex alternation put `focus` before `focus-visible`, so `.btn:focus-visible`
  stripped to `.btn-visible` and matched nothing.
- Pseudo-elements and nested pseudos were handled by the same blunt replace.

Now `postcss-selector-parser`, matching **nodes**: pseudo-class nodes whose value
is an interaction pseudo, and attribute nodes whose attribute is any `aria-*` or
`data-*` regardless of value. Only *bare, top-level* state pseudos are stripped
for base matching — `a:not(:visited)` must not become `a:not()`.

`StateSelectorSchema` widened from an 8-member enum to `pseudo | [aria-*|data-*]`.
An enumerated list will always trail what sites write, and what it misses it
misses silently.

## 3. Coverage invariants

`coverage.json` per capture: what the raw input held, against what extraction
produced, plus the contradictions no correct run can produce. A broken invariant
**fails the run** — the schema requires `stage-report.status === 'failed'`.

### Two properties, both learned the hard way

The mechanism was tested by reintroducing the fixed `[aria-*]` bug and checking
that it fired. **It did not — twice.**

**First failure: shared derivation.** `observed.cssAttributeStateRules` was
counted using the same selector parser the extractor used. The sabotage broke
both sides at once, so the invariant went *vacuous* rather than failing.
→ The observed side must use an independent, cruder detector. Observed counts now
come from a raw regex over selector text. Over-counting there is safe — it makes
the invariant stricter. Sharing a code path is not.

**Second failure: aggregate comparison.** The invariant read "attribute-state
rules in the input → `statesCssom` non-empty", and `statesCssom` was a total.
With attribute extraction fully broken, nine surviving pseudo-class entries kept
the total non-zero and the invariant held.
→ Compare like with like. `statesCssom` split into `statesCssomPseudo` and
`statesCssomAttribute`.

On the third attempt the sabotage was caught.

That an invariant can be written twice, look right both times, and detect
nothing is the argument for testing the detector by breaking the thing it
watches — not for trusting that it works because it is green.

**Standing rule:** whenever a rung finds a silent drop, add the invariant that
would have caught it. The list is meant to grow.

## 4. Rung gates are declarative

`packages/capture/scripts/rungs.mjs` declares each rung's expected-non-empty set
and its known-empty set, so a gate is asserted rather than read off a console. A
category declared known-empty that starts producing output is reported as a stale
declaration, not failed — that direction is good news.
