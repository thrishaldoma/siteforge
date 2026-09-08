# DECISION 0007 — homogeneous collections get positional-only ids

**Status:** OPEN — needs an operator ruling before M5
**Raised:** M0 review, after decision 0005 landed
**Affects:** `identity.ts`, and §10's action space

## The observation

Decision 0005 made `nodeId = hash(structuralPath | semanticKey)`, where
`semanticKey` covers `tag`, `id`, `name`, `type`, `role`, and the `data-test*`
hooks. Measured against the project's own fixture:

```
product cards on the home route: 3
  article[1]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=MUG-BLUE-12OZ
  article[2]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=NB-A5-DOT
  article[3]  semanticKey=ab7c90bfab1d3ecd  contentFingerprint=7a096888b9337f3b  data-sku=PEN-FINE-4PK

add-to-cart buttons: 3   distinct semanticKeys: 1
```

All three cards share one semantic key, so their nodeIds differ **only** by
position. The content fingerprint does not disambiguate them either: an
`<article>` has no *direct* text (its text lives in descendant `<h3>`/`<p>`), and
`data-sku` is in neither `SEMANTIC_ATTRIBUTES` nor `CONTENT_ATTRIBUTES`.

This is not a regression from 0005 — under the previous scheme the discriminator
would have been `class`, identical across all three. 0005 made it visible.

## Why it matters at M5, not at M1

For **diffing** (§5), positional ids are correct and desirable. The existing test
`is stable under content churn and unstable under structural change` asserts
exactly that, and should keep asserting it.

For **addressing** (§10) they are dangerous. `deriveA11yRef(nodeId)` inherits the
property, and §10's refs are what an agent acts on. Insert a product at the front
of the grid: `article[1]`'s nodeId is unchanged, so the ref stays valid and now
points at a *different product*. The agent adds the wrong item to the cart and
nothing errors.

§10 chose refs over selectors because "selectors break the moment the agent
causes a re-render." A broken selector fails loudly. A positional ref that
silently retargets is strictly worse than the thing §10 was avoiding.

One function is currently serving two requirements that want opposite properties.

## Options

**A — separate the two.** Keep `nodeId` positional for diffing; give runtime refs
their own derivation that folds in the content fingerprint. Refs then break
loudly when the thing under them changes, which is what §10 wants. Compatible
with the shared-content pointer (identical renderings have identical
fingerprints, so they still hash equal). Cost: two id schemes to keep straight,
and a ref goes stale when a price ticker updates mid-episode.

**B — disambiguate homogeneous collections.** Extend `SEMANTIC_ATTRIBUTES` with
conventional item keys (`data-sku`, `data-id`, `data-key`, `data-item-id`,
`data-index`). Cheap, and it fixes the common case — but it is site-convention
guesswork, and a site that uses none of them is back to positional.

**C — accept it, and constrain the environment.** Document that refs are
positional within a collection and require the mock backend to keep collection
order stable across a reset (§8 already seeds deterministically, so within one
episode this may hold). Cheapest; pushes the risk into every task validator.

## Recommendation

**A**, with **B** as a cheap additional signal. The failure mode C tolerates is a
silently wrong trajectory, and §10's entire argument for state-based validators
over DOM-based ones is that silent wrongness is the thing to design out.

Not implemented. This wants a ruling, not a default.
