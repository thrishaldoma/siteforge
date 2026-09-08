# 0017 — SiteModel, derived backwards

Status: accepted

Decision 0001 held the name and deferred the design to M2. This is that design.
§5's instruction is the whole of it: "derived backwards from what codegen
consumes. Do not define it by forward-transforming `CaptureModel`."

That is a rule about how a schema was written, which normally means a rule
nothing can enforce. Most of this note is about making it enforceable.

## 1. The two forces, and why they stay apart

| force | where it lives | what it is |
|---|---|---|
| what codegen consumes | `CODEGEN_NEEDS` | one entry per sentence in §8, §9 or §10 that demands an input, quoting the sentence |
| the scored-field list | `SCORED_FIELD_PATHS` against the frozen contract | 0015's ten categories, committed before this file existed |

They are independent on purpose. The scored list was frozen while
`site-model.ts` was still a placeholder, so it could not be bent around what the
model turned out to make convenient — and where a scored field was awkward, the
model moved. The needs list is derived from what the *consumers must emit*,
anchored to the operating manual rather than to what capture happens to hold; a
need nobody can trace to a sentence is a need somebody invented to justify a
field.

## 2. The gate runs in both directions, and only one of them can fail usefully

- **forward** — every need and every scored category resolves to a path that
  exists.
- **backward** — every leaf in the model is claimed by some need or category.

The forward direction is nearly free: a model containing everything contains
everything needed. **A renamed `CaptureModel` passes it.** The backward
direction is the one that fails, on the first section nothing asked for — a
`dom` tree, a computed-style table. "Infer earned nothing" stops being a
judgement call.

Two properties keep it from rotting:

- **A claim must terminate at a schema leaf**, reaching through collections
  element-wise: `entities[].fields[].type`, never `entities.fields`. The first
  version of this rule counted segments, which is the same proxy-for-structure
  mistake as `endsWith` on a path — two segments is not a statement about the
  schema, and `entities.fields` has two and covers twelve leaves. The check now
  asks whether the path *is* a leaf.

  It costs 377 explicit claims across 298 leaves, and that is the price of the
  property: adding a field to the model requires naming a consumer for it.
- **Two claimants on one leaf declare themselves.** A scored category and a
  codegen need genuinely read the same field for different reasons, and that is
  fine — written down. Silent co-claiming is not: `field-type` and `narrowing`
  both read `entities.fields` for a while and the gate reported clean, because
  nothing anywhere said they overlapped. `SHARED_CLAIMS` names the exact
  claimant set per leaf; an undeclared overlap fails, a stale declaration fails,
  and a third claimant absorbed into an entry that already looked close enough
  fails. The honest case is the path-parameter pair — arity and naming cover
  identical leaves and ask different questions of them.

Both directions are tested against schemas built to fail them, and the negative
case holds a reordered model still.

### What the backward pass found on its first run

Four unclaimed leaves: `components.evidence` and `components.derivedFrom`. No
consumer reads them; they exist because §13 requires a derived field to carry
the evidence it was derived from.

The tempting fixes were both wrong — deleting real evidence, or writing a need
that pretends codegen reads it. Instead there is a third **claimant**, and it is
narrow: an `EVIDENCE_REQUIRED` entry names the claim it justifies *and the
refinement that reads it*. Evidence nothing enforces is not evidence, it is a
field with a story attached. One of the two had no refinement, so it got one — a
component cannot claim more distinct routes than it names.

Note the shape: this is a claimant, not a third derivation force. The two forces
above are what shaped the model.

## 3. `StoreEffect`, written first because it decides everything else

`endpoints.json` records that `POST /api/cart/items` was sent `{sku, quantity}`
and answered a cart. §8 requires a handler where "mutations actually mutate the
store". **Nothing in that record says which rows change, or how.** The gap
between those two sentences is the clearest single answer to what infer is for,
and a model that carried the request and the response forward would leave
codegen exactly where capture left it.

Two directions of field mapping, and both are load-bearing:

```
request pointer  → entity field     input        what a write does
entity field     → response pointer projection   what a read returns
```

With only the first, codegen cannot answer a GET. With only the second it cannot
service a POST. With neither it cannot seed the store either, because §8 seeds
"from real captured responses" and the projection is exactly the lens that turns
a captured body into rows.

`session-create` is a kind of its own: §8 wants "a real (if trivially simple)
session check, because agents must be able to fail at logging in", and a login is
not a create. Capture cannot tell them apart from the wire.

The unclassifiable case is `custom`, and it carries a `gapId` — §7's standing
rule, and §13's fail-closed-by-category. For this category the safe default is
"codegen stubs it and the operator is told", never "treat it as a create because
most POSTs are".

### The pointer convention was decided elsewhere, and that is the point

`/[]` for an array element came from the grader's ground-truth loader, written
before this file existed. `response-field-presence` is scored on
`(endpoint, status, pointer)`, so the model has to speak the pointer language
the score is computed in. That is the frozen list constraining the model,
working exactly as 0015 §0 said it would.

## 4. The fixture is derived, not authored

Decision 0011: a fixture in a shape its producing stage cannot produce is a lie.
`build-site-fixture.mjs` reads the committed northwind-supply capture and
derives; the judgements — which entity a response describes, what a handler does
to the store, what to call a repeated subtree — live in one `JUDGEMENTS` table
where a reviewer can disagree with them. No value is typed out.

It is not infer. It is the known-correct baseline 0015 §7 asks for, and its near
match to the capture is not evidence of anything: it was derived from it.

**Four findings came out of insisting on derivation**, and none would have
appeared in a hand-authored fixture:

1. **The site has no radii and no shadows.** An empty group is a fact about a
   flat site; an empty *colour* set would mean the style table was not read. The
   builder fails on one and reports the other, and the distinction is the
   difference between a finding and a bug.
2. **Checkout's effect is not observable.** One captured exchange, and the
   response does not echo the request, so nothing says which field lands in
   which Order column. Its effect is `custom` with a gap rather than a guessed
   `create` — §7's rule, enforced by a schema that cannot express `custom`
   without a `gapId`.
3. **An entity's fields come from the request as well as the response.** No
   response ever returns a password, so a response-only derivation gives the
   login table nothing to authenticate against. No value is carried: the seed
   rows come from the response, and a column name is not a credential.
4. **The trigger of a behaviour is the step that made the call**, not the first
   step and not the last. `add-mug-to-cart` types a quantity, clicks "Add … to
   cart", then clicks "Cart" — first and last both give codegen the wrong
   control. The first version of the builder also fell back to
   `siteRoutes[0]` when a flow's start route matched no template, which put
   every unmatched flow on whichever template sorted first, silently. §13's
   fail-closed rule; it now fails.

The linter caught the builder testing a URL with `startsWith` and a path with
`startsWith` — the bug class the linter exists for, in code written the same day
the rule was restated. Fixed with `sameOrigin` and a segment rebuild, not with
exemptions. In the process: this capture entered on `http://` and was 301'd to
`https://`, so `target.entryUrl`'s origin is not the site's.

## 5. What is in it

`tokens` · `fonts` · `assets` · `components` · `layouts` · `routes` ·
`entities` · `operations` · `behaviours`.

There is no `dom`, no `styles`, no `states`, no `har`, no `coverage`. A component
is a *cluster* of subtrees with the varying parts lifted out; a token is a *snap*
of near-identical values onto one name; an asset entry is a *decision* about how
to emit bytes. Those verbs are what infer does.

Schema rules worth naming, each of them a §13 rule applied here:

- §7.2's threshold is in the schema: a non-template component seen fewer than 3
  times does not parse. Two occurrences is a coincidence.
- §7.1's caps are in the schema: more than 16 colours is a clustering that did
  not happen.
- A substituted font cannot be written without its gap, and a licensed family
  cannot be bundled.
- `requiresAuth` is recomputed from its evidence, as in the capture layer.
- An operation bound from a skipped control cannot carry an observed response —
  it was never fired.
- An entity no operation reads or writes does not parse: codegen would emit a
  store table nothing can reach.
- A business key cannot be a field the store generates, because §10's anchors
  would change between seeds and the ref map would break on reset.

## Open

- **Relations across a nested field are not derived.** `Cart.items[].sku`
  references `Product.sku` and the builder only walks scalars, so the fixture
  has no relations at all. The `identifier` category has real data
  (`Product.slug` → `get-api-products-slug`, on observed path-parameter values);
  the relation table does not.
- **Components carry no props yet.** `ProductCard` has three varying leaves and
  the builder binds them to `entity-field` directly rather than lifting them
  into props. Both are legal; which one codegen wants is a question for the
  first real emit.
- **`stateVariants` is always empty in the fixture.** The capture has six CSSOM
  state rules; mapping them onto component nodes needs the nodeId join the
  builder does not do yet.
- **A request-only field has no seed value, and M3 has to answer for it.**
  `Account.password` is a column the store needs and the response never
  returned, so the generated store has a password column with nothing in it —
  and §10's auth tasks cannot run against a login nobody can perform. Codegen
  synthesizes a credential per seeded identity, marks it synthesized in the
  model's gap record rather than passing it off as observed, and surfaces it in
  the env's task setup so an agent can be *given* the login it is asked to use.
  This is an M3 requirement, not an infer one: infer's job is to record that the
  column exists and has no observed value, which it does.
