# DECISION 0005 — nodeIds are structural + semantic, never content

**Status:** ACCEPTED (operator ruling)
**Raised:** M0 review
**Affects:** `identity.ts`, `NodeIdentity`
**Diverges from:** CLAUDE.md §5's literal wording — see "Spec consequence" below

## The bug, twice

§5 requires nodeIds that "survive re-crawls so diffs are meaningful", derived
from "a structural path hash ... plus a content fingerprint".

The first implementation folded `class` into the fingerprint. §11 says CSS-in-JS
classnames are hashed and unstable, so any rebuild of the site moved every nodeId
on the page. Fixed by excluding `class`.

That fix was incomplete, because the same argument applies to **data**. The
fingerprint still contained the node's text and its `href`, `alt`, `value`, and
`aria-label`. On a live site prices, timestamps, stock counts and product slugs
change between crawls — so every node carrying one, and nothing else, relocated.
A catalogue update read as a total page rewrite.

Both are one mistake: **treating what a node currently says as part of what it
is.**

## The rule

> Stable under restyling **and** under content change. Unstable only under
> structural change.

So identity splits three ways:

| Component | Contains | In the nodeId? |
|---|---|---|
| `structuralPath` | `html/body/main[1]/ul[1]/li[3]` | yes |
| `semanticKey` | tag + authored, data-independent attributes | yes |
| `contentFingerprint` | text + content-bearing attributes | **no** |

```
nodeId = n_<hash(structuralPath | semanticKey)>
```

`SEMANTIC_ATTRIBUTES` = `id`, `name`, `type`, `role`, `data-testid`, `data-test`,
`data-cy`. The membership rule: **a developer typed it, and it does not change
when the site's data changes.**

`CONTENT_ATTRIBUTES` = `href`, `src`, `srcset`, `alt`, `title`, `value`,
`placeholder`, `aria-label`. All of these carry data on a real site — a product
link's `href` holds a slug, an `aria-label` holds a product name.

`contentFingerprint` is still recorded on every node. It is the diff-attribution
half: two crawls agreeing on `nodeId` and differing here means *same node, new
content*, which is exactly the distinction §5 wants diffs to be able to draw. It
just does not get a vote on identity.

## Framework-generated ids

`id` is in the semantic key, but a framework-minted one is dropped —
`isFrameworkGeneratedId` covers React `useId` (`:r0:`), Radix/Headless UI
(`radix-:r7:`), Angular (`ng-*`, `_ngcontent-*`), Vue scope ids, Material UI,
Ant Design, UUIDs, and bare hash blobs.

These are the worst case available: they *look* like authored identity and are
not. React's `useId` counts up per render tree, so inserting anything above a
component renumbers everything below it. Trusting one is worse than having no id,
because it reintroduces precisely the instability the semantic key exists to
remove — silently, and only on sites that use a framework.

When an id is rejected the node falls back to its path, which is the correct
degradation.

## Spec consequence — needs an operator edit

CLAUDE.md §5 still reads:

> Derive from a structural path hash (`tag[nth-of-type]/...`) plus a content
> fingerprint, not from DOM order alone.

The second half is now wrong. Suggested replacement:

> Derive from a structural path hash (`tag[nth-of-type]/...`) plus a semantic key
> of authored, data-independent attributes — not from DOM order alone, and not
> from content. Record the content fingerprint separately so a diff can tell
> "node moved" from "node's content changed". Exclude classnames and
> framework-generated ids from identity: both look stable and are not.

Not applied — editing the spec is the operator's call.
