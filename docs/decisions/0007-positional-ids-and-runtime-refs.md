# DECISION 0007 — split the identifier: `nodeId` for diffing, `elementRef` for acting

**Status:** RESOLVED (operator ruling). Contract fixed now; **implementation waits
for M5**, when `envkit` exists.
**Raised:** M0 review, after decision 0005
**Affects:** `identity.ts` (unchanged), `envkit` (new type), §10

## The finding

Decision 0005 made `nodeId = hash(structuralPath | semanticKey)`. Measured
against this project's own fixture:

```
product cards on the home route: 3
  article[1]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=MUG-BLUE-12OZ
  article[2]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=NB-A5-DOT
  article[3]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=PEN-FINE-4PK

add-to-cart buttons: 3   distinct semanticKeys: 1
```

In a homogeneous collection every semantic attribute is empty, so nodeIds differ
only by structural position — and the content fingerprint does not disambiguate
either, because an `<article>` has no *direct* text and `data-sku` is in neither
attribute list.

## The ruling

**Do not reconcile the two uses. Split the identifier.**

### `nodeId` — unchanged

Structural, content-free, positional in homogeneous collections. That is correct
for §5's diffing and is not to be weakened to serve §10. The existing test
asserting that a node's id moves with its position stays as an assertion of
intent.

### `elementRef` — new, owned by `envkit`

§10's runtime refs become a separate type, **never derived from `nodeId`**.

Naming matters here: `a11yRef` keeps its current meaning — the *capture-time*
identifier on `A11yNode`, `DomElementNode.a11y`, and recorded flow targets. The
runtime thing is `elementRef`. Reusing one name for both is how the collision
becomes a bug.

### Resolution order

1. **Entity anchor.** Codegen emits `data-sf-entity="product:MUG-BLUE"` from the
   mock backend's own ids. `ref = hash(role | entityKey)`. Stable across
   insertion, reorder, and re-render, because it is anchored to identity rather
   than to position or presentation.
2. **Accessible name + role**, where no entity backs the element.
3. **Position** — last resort. The observation must mark the ref
   `positional: true`, so fragility is visible to the agent and to anyone reading
   a trajectory, rather than assumed away.

## Two hard requirements

### No leakage

`data-sf-entity` must be stripped from **both** `Observation.dom` and
`Observation.a11yTree`. The agent sees an opaque ref; the environment holds the
map.

If the agent can read entity identity off the DOM, the environment teaches a
policy that cannot survive contact with the real site — the clone would be
training against an affordance that exists nowhere else. This is the same failure
§10 already names for validators ("DOM-based validators are how agents learn to
fake success"), one level down.

### Stale refs fail loudly

- Refs are **episode-scoped**: re-enumerated on every observation, never
  persisted across `reset`.
- An action against a ref whose element identity signature has changed since the
  observation that issued it returns a typed **`StaleRefError`**.
- **Never silently retarget.**

A rejected action costs the agent one step. A retargeted click writes a corrupted
trajectory that reads as a success — it adds the wrong product to the cart and
the validator may well pass. One is a cost; the other is poison in the training
data.

## Consequence to settle at M5

`ActionSchema` currently lives in `packages/schema` and types its `ref` as
`A11yRef`, shared between recorded flows and §10's action space. Under this
ruling those are two different things:

- **Recorded flows** keep `A11yRef` — they describe a capture, and the capture is
  what it is.
- **Runtime actions** take `elementRef`.

§9 replays flows against the clone, so it must bridge the two. It can:
`ActionTarget` already carries `role`, `name`, `nodeId`, and `selector`, which is
enough to resolve a recorded step to a runtime ref by rule 2 — and once codegen
emits entity anchors, by rule 1.

§10's "Reusing that code is what keeps the action space consistent" still holds:
what is shared is the *discovery logic* (§6's four candidate sources), not the id
scheme. Worth restating in `envkit` when it is written, because the sentence
reads as if it means the ids.
