# 0046 — Why `response-field-presence` reads 0.42, and it is two unrelated things

*Status: diagnosis only. No fix proposed, per the ruling — the cause is
reported and the remedy is a separate decision.*

`response-field-presence` is the first genuine red from a category measuring
what it claims to: **precision 0.4207 (236/561), recall 0.5153 (236/458)** on
the current capture and a model inferred from it.

Three causes were offered: infer under-emitting, the truth side over-counting
in the `allOf` bug's shape, or the universe filter admitting fields no
observation could reach. **None of the three is the cause.** It is two
unrelated things, one per metric.

---

## 1. Precision is one endpoint

| | fields |
|---|---|
| model-only (false positives) | 308 |
| **of which `GET /api/v1/routes`** | **307** |
| everything else, across 19 matched endpoints | **1** |

**Precision excluding that endpoint is 0.9958**, comfortably over its 0.95
gate. The number is not a broad inference failure; it is one response.

`GET /api/v1/routes` returns an object whose **keys are data**:

```
{ filters: { create: {...}, delete: {...}, read_one: {...}, update: {...} },
  labels: {...}, migration: {...}, notifications: {...}, … }   28 groups
```

Infer enumerates each key as a schema property and reaches 307 pointers; the
document declares the whole thing as **one** field. So every one of the 307 is
counted a false positive.

**This is not hallucination.** Every key was in an observed body — §5 says
"infer a JSON Schema across all observed responses", and that is what
happened. The defect is a category error one level up: **a map keyed by data
is being modelled as a record type**, so the *values* of the response become
the *shape* of the response. A route map with 28 groups produces 307 fields; a
map with 280 groups would produce 3 070, and none of them is a claim about
schema.

It also matters downstream rather than only in the score: §8 turns response
schemas into the mock backend's data model, so this endpoint would generate a
307-field type in the clone.

## 2. Recall is the seeded instance, not infer

208 truth fields have no model counterpart. Split by whether the model has
**any** field for that endpoint:

| | truth-only fields |
|---|---|
| endpoints where the model has **no** response field at all | **62** |
| endpoints with a body observed, but narrower than declared | 146 |

The 62 come from five endpoints that returned nothing to observe:

```
api/v1/teams (26) · api/v1/tasks/*/comments (14) · api/v1/notifications (8)
api/v1/tokens (8) · api/v1/user/settings/token/caldav (6)
```

The seed creates one project, four tasks and three labels — no team, no
comment, no notification, no API token, no CalDAV token. Every one of those
endpoints answers with an empty collection, so **no field is observable and
infer is correct to emit none.** 0023 §3.1 recorded the same instances as the
reason `entity-identity.recall` is not derived; it is the same cause reaching
a different metric.

The remaining 146 are the same mechanism one level in. The declared subtree
exists but the *seeded* value is `null`, so it has no children to walk:

```
"assignees":   { "type": "null" }      // truth declares an array of users
"attachments": { "type": "null" }      // truth declares an array of files
```

Visible in the depth profile — the model reaches depth 4 twelve times, the
truth eighty:

```
model pointers by depth   1: 110   2: 201   3: 222   4:  12
truth pointers by depth   1: 116   2: 155   3:  94   4:  80
```

**Recall restricted to endpoints with an observed body is 0.6188**, so even
the "partially observed" half is dominated by absent nested values rather than
by infer dropping fields it could see.

## 3. The three offered hypotheses, each answered

| hypothesis | verdict |
|---|---|
| **infer under-emitting** | **no.** Infer reflects the observed bodies faithfully. The shortfall is in what was *observable*, and emitting a field never seen would be the §7 invention this project forbids |
| **truth over-counting (`allOf` shape)** | **no evidence.** The truth-only fields are legitimately declared and genuinely absent from every observed body. No inflation found |
| **universe filter admitting unreachable fields** | **inverted.** The filter is doing its job — 5 operations are correctly out-of-universe. It is the *truth* that declares fields no observation reached, and no filter on the model side can fix that |

## 4. What the number is actually measuring

Both halves trace to one root, and it is 0021's finding arriving again:
**§5 builds response schemas as a union over observed bodies, so
`response-field-presence` is largely a measurement of the seeded instance,
not of inference.**

- Its **recall** is bounded above by seed coverage. With no team, comment,
  notification or token in the store, 62 declared fields are unreachable
  whatever infer does, and the null-valued subtrees remove most of the rest.
- Its **precision** is, on this target, a measurement of one endpoint's
  response shape.

That makes it a real red — the model genuinely disagrees with the document —
but it is not primarily a statement about §7's judgement, which is what a
category in the `inference` suite reads as. Per 0021's rule: before reading a
score as evidence about a stage, disable a piece of that stage and check the
number moves.

### 4.1 Corroboration: the state-independence work moved it

Graded before and after 0044 §5, each with infer re-run against its own
capture:

| metric | baseline capture | after |
|---|---|---|
| `request-field-presence.recall` | 0.5155 (50/97) | **0.9333 (14/15)** ✓ |
| `request-field-presence.precision` | 0.6494 (50/77) | 0.7368 (14/19) |
| `field-type.accuracy` | 0.8969 (287/320) | **0.9000 (225/250)** ✓ |
| `response-field-presence.precision` | 0.4538 (270/595) | 0.4207 (236/561) |
| `response-field-presence.recall` | 0.4954 (270/545) | 0.5153 (236/458) |

A change to the **crawler** moved five inference metrics and carried two over
their gates. That is the cleanest available demonstration that these numbers
are substantially about capture, and it is the same conclusion 0021 reached by
ablation.

## 5. How to reproduce

`matchEndpoints(model.operations, truth, observed)` gives the matched pairs;
`modelFieldPointers(pair.operation.responses[0].schema)` and
`pair.truth.responseFields` give the two pointer sets, and the diagnosis is
their set difference grouped by endpoint. No new instrument was needed — the
grader's own parts answer it, which is why this is a diagnosis and not a
measurement harness.

## 6. Open, deliberately not decided here

- **The map-valued response.** Needs a representation for "object whose keys
  are data" distinct from a record type. It touches `JsonSchemaNode`, which is
  the schema §5 calls the spine, so it is not a local edit.
- **Seed coverage.** 62 fields are unreachable until the seed creates a team,
  a comment, a notification and a token. That is capture-side work with a
  known list.
- **Whether `response-field-presence` belongs in the `inference` suite** given
  §4. 0021 raised the same question for twelve other numbers and it was not
  settled then either.
