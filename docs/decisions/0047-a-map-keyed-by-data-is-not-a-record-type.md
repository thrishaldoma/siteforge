# 0047 — A map keyed by data is not a record type

*Status: §1–§3 are the rule and its thresholds, **committed before the
detector was written or run**, per §13's prediction discipline and the
ruling's "declare the detection rule and its threshold before measuring".
§4 onward is what the measurement found and is written after.*

[[0046]] diagnosed `response-field-presence.precision` at 0.4207: 307 of 308
false positives come from one endpoint, `GET /api/v1/routes`, whose response
is an object **whose keys are data**. Infer enumerates each key as a schema
property and reaches 307 pointers; the document declares the whole thing as
one field.

The ruling: fix it in infer, as a representation problem rather than an
endpoint quirk, and record it against codegen too.

---

## 1. What the defect actually is

Not hallucination. Every key was in an observed body, and §5 says to infer a
schema across all observed responses — that is what happened. The category
error is one level up: **the values of the response became the shape of the
response.** A route map with 28 groups produces 307 fields; one with 280
groups would produce 3 070, and none of them is a claim about schema.

`JsonSchemaNode` already has the right representation — `additionalProperties`
accepts a node — so this needs no new shape for the map itself. What it needs
is the **evidence record**, for the reason §13 gives: a derived field carries
the evidence it was derived from, and the schema rejects a value that evidence
does not support.

### 1.1 The map is the permissive direction, and that decides the bias

A record with N properties says *these keys exist*. A map says *any key may
exist, and values look like this*. Against §8 — which turns response schemas
into the mock backend's data model — **the map is permissive**: the clone
accepts keys the real API would reject. That is a wrong enum's asymmetry
pointed the other way.

So, per the ruling: **prefer false negatives.** A 3-key map modelled as a
record costs little — three fields the mock declares that the API also has. A
record modelled as a map loses the schema entirely, and every field in it
stops being checkable by anything downstream.

## 2. The detection rule, declared before it was run

A node with `type: 'object'` and `properties` is re-represented as a map when
**all** of the following hold. Failing any one leaves the record type alone.

| | rule | threshold |
|---|---|---|
| **R1** | **Sibling cardinality.** The node has many direct properties | `siblings >= 12` |
| **R2** | **Value-schema agreement.** Siblings whose value schema is structurally identical to the modal value schema, as a fraction of siblings | `>= 0.90` |
| **R3** | **The value schema is an object.** A map of scalars is not distinguishable from a record of scalar fields | value `type === 'object'` with at least one property |

**R2 is the primary signal and it is structural, not lexical.** A record
type's fields have unrelated shapes — `id` is a number, `title` a string,
`created` a date-time. A data-keyed map's values are the same shape repeated,
because they are instances of one thing. Comparison is over a canonical form
of the value schema (type, property names, required, recursively) with
`examples` and observation counts stripped, so two groups holding different
*data* still compare equal.

### 2.1 What is deliberately NOT in the rule

**"Keys that look like data rather than identifiers"** — one of the three
signals the ruling named — is **excluded**. It is a lexical test standing in
for a structural property, which is §13's substring-for-token family: it
correlates with the thing meant until it does not, and `filters`, `labels`,
`notifications`, `projects` are perfectly good identifier-shaped words. R2
carries the same information structurally and cannot be fooled by naming.

**Key-set instability across observations** — the strongest signal in
principle, and the ruling named it — is **recorded when available and not
required**. Measured first, as the advisor-flagged precondition: `GET
/api/v1/routes` has `observedCount: 1` for its 200 response. **The signal is
silent on the very case that motivated the rule.** Requiring it would produce
a detector that cannot fire on its motivating instance, which is §13's fourth
vacuity mode — the sabotage cannot be written because the state cannot be
reached. So it is carried in the evidence record as `keySetsSeen` and
strengthens the case where a target offers more than one observation.

### 2.2 Justifying R1's threshold, and what would falsify it

12 is chosen from the cost asymmetry in §1.1 rather than from a distribution,
because no distribution had been measured when this was written. The
prediction that goes with it, recorded here so it cannot be retuned quietly:

> **Prediction.** On the current Vikunja capture, R1–R3 together fire on
> exactly one node — the root of `GET /api/v1/routes`'s 200 response — and
> `response-field-presence.precision` rises from 0.4207 to approximately
> 0.99, in the region [0.97, 1.00].

What would falsify the threshold rather than the rule: a genuine record type
in this capture with 12 or more properties whose value schemas agree at 0.90.
If one exists, 12 is too low and the measurement says so. §4 reports what was
found.

## 3. The evidence record

`MapRecord`, mirroring `NarrowingRecord`, so an unjustified map does not
parse:

```ts
{
  kind: 'data-keyed-map',
  siblings: number,        // R1
  agreeing: number,        // R2's numerator
  observations: number,    // how many bodies this node was seen in
  keySetsSeen: number,     // distinct key sets across those bodies
  observedKeys: string[],  // the keys, kept rather than discarded
}
```

`observedKeys` is not decoration. §8 seeds the mock store from captured
responses, and dropping `properties` without keeping the keys would leave the
seed with nothing to populate the map from — trading a precision defect for
an empty store. The schema refines `siblings >= 12` and `agreeing / siblings
>= 0.90`, so the thresholds in §2 are enforced by the contract rather than
only by the detector that applies them.

## 4. Against codegen

Recorded here because the ruling asked for it and because §8 is where the
consequence lands, not merely the score: **a map-typed response schema
generates a dictionary in the mock backend, never a 307-field type.** Codegen
is three lines today, so this is a note against the stage rather than code in
it — and the note is the deliverable, because the alternative is the stage
being written from the model and reproducing the defect faithfully.

Distinct and not answered here: whether `/api/v1/routes` belongs in the
graded universe at all. Ruled — it stays. The document declares it and the
universe filter is correct; whether the mock backend should carry a route
manifest is a §8 scoping question, and answering it from a grading
inconvenience would be scoping codegen backwards.

---

## 5. The rule as declared does not fire, and that is the first result

Written after running §2 against the capture, before any threshold was
touched.

| node | siblings | agreement | object values | R1∧R2∧R3 |
|---|---|---|---|---|
| **`GET /api/v1/routes` 200** | 28 | **0.1429** | yes | **no** |
| `GET /api/v1/tasks/:task` 200 | 29 | 0.3448 | no | no |
| `GET /api/v1/info` 200 | 19 | 0.5789 | no | no |
| `GET /api/v1/projects` 200 `[]` | 15 | 0.4667 | no | no |
| `GET /api/v1/routes` 200 `/projects` | 9 | **1.0000** | yes | no (R1) |

**The rule fires on nothing, including the case it was built for.** §2.2's
falsification clause anticipated the wrong direction — it asked what would
show the threshold too *low* — so this is a miss the declaration did not
cover, and it is recorded rather than papered over.

### 5.1 Why, and it is a fact about the data rather than the threshold

The 28 route groups do not have identical value schemas, because they do not
have identical **key sets**: `filters` carries `{create, delete, read_one,
update}`, `labels` carries those plus `read_all`, and so on. R2 compared full
recursive structural identity, so differing key sets made every group look
like a different shape.

The bottom row is the tell. One level down, `routes/projects` is nine
siblings at **1.0000** agreement — the `{method, path}` pairs are perfectly
uniform. So the structure is a **two-level map**: outer keys are route
groups, inner keys are operation names, and the leaf is uniform. Both levels
are keyed by data, and neither level has 12 uniform siblings by the identity
test.

**R2 was the wrong comparison, and R1's threshold is not what failed.** A
record type's fields differ in *type*; a data-keyed map's values differ only
in *which keys they happen to carry*. Identity cannot tell those apart.

## 6. R2′, re-declared — with the prediction, again before running

R1 and R3 stand unchanged. R2 is replaced:

> **R2′ — the sibling value schemas unify.** Two schemas unify when their
> `type` agrees and, for every property **present in both**, their values
> unify recursively. Properties present in only one side are permitted —
> that permission *is* the map property. A sibling counts as agreeing when
> it unifies with the modal value schema; the threshold stays **≥ 0.90**.

Why this is the right comparison rather than a looser one that happens to
fire: it separates the two cases on the property that actually distinguishes
them. `Task` has `id: number` beside `title: string`, so its siblings fail to
unify at the first pair and it is rejected on the first test, not by a
margin. The route groups differ only by which operations they offer, which is
precisely what "the keys are data" means.

R3 is what stops this from being loose. A record type of twelve `string`
fields would unify trivially; requiring the value schema to be an **object
with properties** means the evidence is a repeated structure rather than a
coincidence of primitive types.

> **Prediction, second attempt.** R1 ∧ R2′ ∧ R3 fire on **exactly one** node
> in this capture — the root of `GET /api/v1/routes`'s 200 response, at 28
> siblings and agreement 1.0000. Nothing else fires: `tasks/:task` (29),
> `info` (19), `projects` (15) and the two `views` nodes (12) all hold
> siblings whose types differ, so they fail R2′ outright rather than
> narrowly. `response-field-presence.precision` rises from **0.4207** into
> **[0.97, 1.00]**.

The inner `routes/*` nodes are expected **not** to collapse — 4 to 9 siblings
each, under R1's 12 — so the emitted map's value schema stays a record. That
is the false negative §1.1 asks for, taken deliberately: the outer level is
where 307 of the 308 false positives live, and collapsing a 4-key group would
be the direction that loses schema.
