# 0023 — Grading what infer emits: the `inference` suite

**Status:** proposed (specification for review), implementation to follow in this
turn
**Date:** 2026-09-09
**Context:** 0015 (grading design), 0018 (modality and vocabulary rules), 0020
(the grader pin), 0021 (nothing measures `model.entities`), 0022 (the suite
rename)

0022 renamed the existing ten categories `capture-fidelity`, because 0021
measured that every one of them scores a capture artifact. This specifies the
second suite: categories that score what **infer** produces, `model.entities`
first, which today no metric reads at all.

Everything below the line marked *Measured* is a number from the pinned truth
and the real capture, taken before any category was implemented. That ordering
is the point — 0015 §5 is explicit that a definition settled after seeing a
score cannot be told from tuning.

---

## 1. The modality, and why it points the other way from auth

0018 fixed the rule: **a document grounds a claim about declared shape; only
observation grounds a claim about runtime behaviour.** On `requiresAuth` that
rule pointed away from the document — the claim is about what a server *does* to
an uncredentialed request, and Vikunja's document declares one global security
block that says nothing per-operation.

Entity structure is the other case, and it is worth stating as a **consequence
of the same rule rather than as an exception to it**:

`model.entities` is a claim about *shape* — these are the tables the mock store
will have, these are their columns, this column holds a closed domain.
Swagger 2.0 `definitions` is a declaration of exactly that, written by people
who were not us, complete where a crawl is a sample. So for this suite the
document is not merely admissible, it is the **only** independent source: the
alternative is the response bodies capture recorded, which are infer's own
input. 0015 already worked this through for response shape — "a truth side that
is the system's own input is not an oracle; it is a mirror" — and entities are
that argument one level down, because §7.4 derives entities *from* those same
bodies.

The test each category has to pass is independence, not proximity. That is what
picks the column, and here it picks the declaration.

**One consequence, stated up front:** the document declares shapes, so it
grounds *what a table looks like*. It does **not** declare which of its 80
definitions are tables, and §3 does not pretend otherwise.

---

## 2. Matching, before anything is scored

A model entity is paired to a definition **through the matched operation**,
never by name.

Every `StoreEffect` of kind `list`/`read`/`create`/`update`/`delete` names an
`entity`. Every operation matched by 0015 §2 has a spec counterpart, and that
counterpart's 2xx response has a root schema (or, for an array response, an
element schema) that resolves to a named definition. That gives a pair:

> the model says *"this operation's rows are entity `Project`"*; the document
> says *"this operation returns `models.Project`"*.

Three properties, each one carried over from 0015 §2 deliberately:

- **Never by name.** `entityNameFor` derives a name from a path segment and has
  no way to know the document calls it `models.Project`. Folding naming into
  identity would make every entity a miss for a cosmetic reason and hide the
  real misses behind the noise — the same argument that keeps
  `path-param-naming` a separate category.
- **One-to-one.** A model entity pairing with two definitions, or two model
  entities pairing with one, is an **ambiguity**: reported as its own count,
  scored as a miss on both sides, never resolved by picking the better pair.
  This is where an over- or under-merging dedup shows up.
- **The precision denominator is `model.entities`, not distinct entity names.**
  Found by getting it wrong: the first measurement keyed pairs by
  `effect.entity`, so the seven entities the no-dedup ablation produces — which
  carry only four distinct names — collapsed into four keys and the metric
  reported *identical* numbers for both models. Counting names instead of
  entities is the aggregate-hides-a-partial-loss mistake (§13) in the
  denominator.

---

## 3. The categories

| category | metric | denominator | grounded? |
|---|---|---|---|
| `entity-identity` | precision | **model entities** reachable from a matched operation | yes |
| `entity-identity` | recall | — | **notDerived**, §3.1 |
| `entity-field-presence` | precision | entity fields the model emitted, on paired entities | yes |
| `entity-field-presence` | recall | properties the document declares, on paired entities | yes |
| `entity-relation` | precision / recall | — | **notDerived**, §3.2 |
| `entity-narrowing` | precision | narrowings the model emitted on paired entity fields | yes |
| `entity-narrowing` | recall | **enum** claims the document declares on paired entity fields | yes |

### 3.1 `entity-identity` recall is not derivable, and that was measured three ways

The recall denominator wants "the tables a faithful mock of this API needs". The
document does not say. Three candidate criteria were tried against the ten
definitions reachable as a 2xx response root of a matched operation:

| criterion | verdict |
|---|---|
| every reachable response root | 10 entities. Infer emits 4, so recall reads **0.400** — and **none of the six misses is an inference defect**: `models.Team`, `models.TaskComment` and `notifications.DatabaseNotification` came back **empty** from the seeded instance, so no row was ever observed; `auth.Token`, `models.Message` and `v1.vikunjaInfos` are a token mint, a "deleted" envelope and a capability blob, which §7 explicitly says are *correctly* declined. |
| has an identity-key property | borrows `IDENTITY_KEYS` from infer, so a bug in it moves both sides — §13's rule about an invariant's observed side, applied to a truth side. |
| addressable by id — returned by an operation whose path ends in a parameter | Wrong in **both** directions: `models.Message` qualifies because `DELETE /projects/{id}` returns it, and `v1.UserWithSettings` does not qualify though `GET /user` plainly returns a row. |

So the honest reading is the first row's: **a recall metric here would report the
crawl's seeding and the document's habit of declaring envelope types, and call
it inference quality.** That is 0015 §3's argument for endpoint recall being
over *observed*, one level down, and repeating the mistake with a new name would
be worse than not having the number.

`notDerived`, with the reason, exactly as `identifier` is. Reported beside it as
a property of **capture**, not gated: how many reachable response roots came
back empty (measured: 3 of 10). Two numbers, two subjects.

*Precision is still real.* It falls when infer emits an entity that pairs with
nothing, and when two entities pair with one definition — which is what an
under-merging dedup does. See §5.

### 3.2 `entity-relation` is not derivable either, and for a vocabulary reason

The document declares **one** relation reachable from a matched operation:
`models.Task.labels → models.Label`, an array of embedded `Label` objects.

`RelationSchema` cannot express it. It carries `field` (a scalar field of this
entity), `references: {entity, field}`, and value-overlap evidence — a scalar
foreign key. A to-many embed is not that shape, and `FieldTypeSchema` has no
array member either.

Meanwhile the scalar foreign keys that *would* be expressible — `Task.project_id`,
`Task.bucket_id`, `ProjectView.project_id` — are declared by the document as
bare `integer` with a prose description. Nothing machine-readable links them to
`models.Project`.

So the truth side is empty after the vocabulary restriction, and this is
0018's `UNEXPRESSIBLE_FORMATS` argument rather than a shortfall: *you may
exclude a claim the vocabulary cannot make and never one it can.* One reachable
relation, zero expressible.

**This is a gap in SiteModel, not only in the truth side**, and it is recorded
as one — the same shape as `uint64`'s unsignedness. A to-many association is a
real thing about a real API that `SiteModel` currently cannot say, so the mock's
`Task` will carry a `labels` JSON blob instead of a join. Named here; not fixed
here, because widening `RelationSchema` while a score is being watched is the
thing 0020 exists to prevent.

### 3.3 `entity-narrowing` is enum-only, on both sides

The document declares **zero formats** (0021, re-confirmed: no occurrence of the
string in 368KB). Silence about a field is not a claim that the field is
unconstrained, so scoring the model's 43 `date-time` narrowings against it would
mark every correct one a false positive for the document's reticence.

So both sides are restricted to **enums**, and the restriction is a property of
the vocabulary the document speaks rather than of the misses it removes — the
line `vocabulary.ts` is held to. A `const` is an enum of one, under 0018's
existing rule; agreement is **spec values ⊆ model values**, unchanged.

**Denominator: 1.** `models.Task.repeat_mode`, an enum of `[0,1,2]`, on the one
matched entity that carries one. That is coarse and it is reported as coarse —
the same treatment 0021 gave `auth.over-gate-rate`'s denominator of one, and for
the same reason: it is a property of this API and this crawl, not a threshold to
relax. A floor asserts it is `>= 1`, so the day the crawl reaches
`models.ProjectView` the number gets less coarse without anyone remembering to
look.

### 3.4 Per-metric `notDerived`

`notDerived` is currently per **category**, and §3.1 and §3.3 both need it per
**metric**: `entity-identity` precision is grounded while its recall is not.

The same granularity fixes a live half-truth in `capture-fidelity`. 0022 §3
found that `narrowing`'s stated reason — "declares no formats at all" — grounds
only the **precision** side. Post-`allOf`-fix the document declares **7** enum
claims on matched response fields, so `narrowing.recall` *is* derivable and
currently reads `vacuous` when it should read a number.

So the mechanism lands here, where it is load-bearing, and `narrowing.recall`
comes off `notDerived` as a consequence. That is a change to a
`capture-fidelity` number and it is called out rather than folded in.

---

## 4. Field comparison: a canonical form, fixed in advance

Model entity fields are camelCase (`hexColor`); the document's properties are
snake_case (`hex_color`). Comparison is on a **canonical form** — lowercased,
non-alphanumerics removed — fixed here, before any score, in the same spirit as
0015 §3's `integer`/`number` normalisation.

Not by re-implementing `fieldNameOf`: the grader must not share the transform it
is scoring, or a bug in it moves both sides.

**Every declared property is in the truth side**, scalar, object and array
alike. `FieldTypeSchema` has a `json` member that carries an object or an array,
so every property is a claim the model *can* make, and the vocabulary rule
permits excluding only claims it cannot. This matters: an earlier draft counted
scalars only, which turned the model's legitimate `createdBy: json` into a
precision miss and put `entity-field-presence.precision` at 0.810 instead of
1.000. It also means infer's dropping of array properties is a visible **recall**
miss rather than an exemption, which is correct — §8 seeds the store from these,
so a `Task` with no `labels` is a real hole in the clone.

**Open, and a genuine gap:** `EntityField` does not carry the wire name. The
mapping exists at the operation level (`FieldMapping` has both pointer and
field) but the entity itself cannot say which wire property a column came from,
which is why this category needs a canonical form at all. 0015 §0 says a field
the grader scores is a field SiteModel must carry; by that rule `EntityField`
should carry its wire name. Not changed here — it is a schema change, and §14
says to fix the schema rather than work around it, so it wants its own commit
and its own review.

---

## 5. Measured, before implementation

Against the pinned Vikunja truth and the real capture (7 routes, 16 endpoints),
computed with a standalone script so the numbers exist before any category does:

```
entity-identity.precision        1.0000    4/4
entity-identity.recall           notDerived   (3 of 10 reachable roots came back empty — capture)
entity-field-presence.precision  1.0000   58/58
entity-field-presence.recall     0.9355   58/62
entity-relation.*                notDerived   (1 reachable relation, 0 expressible)
entity-narrowing.precision       vacuous    0/0   (the model emits no enum on any entity field)
entity-narrowing.recall          0.0000     0/1
```

And the ablation that proves the suite measures **infer** rather than capture —
the thing 0021 could not find a single metric to do:

| model | `entity-identity.precision` |
|---|---|
| baseline | 1.0000 4/4 |
| `--without dedupe` | **0.5714 4/7** |

That is the first number in this project to move when a piece of infer is turned
off. 0021's table has three rows reading "0 metrics moved"; this is the column
that was missing.

### What the numbers say, which is not flattering

- **`entity-narrowing.recall` is 0.000.** The document declares
  `models.Task.repeat_mode` a closed domain of three values; infer's ladder
  declined it. Not a bug on its face — §7.5's primary evidence is a UI
  constraint and there is no `<select>` for it, and the corroboration rung wants
  20 distinct records — so this is the ladder being conservative, which is the
  direction §13 says to be conservative in. It is nonetheless the first time the
  ladder has been *scored*, and 0/1 is the score.
- **`entity-field-presence.recall` 0.9355** — the four misses are `subscription`
  (twice), `views` and `email`. Three are object/array properties the response
  did not carry; `email` the document declares on `UserWithSettings` and the
  server did not send. Crawl reach, mostly.
- **`entity-field-presence.precision` 1.0000** reads high for a reason that is
  not infer's quality: both sides ultimately describe the same server, so it
  measures document/server agreement plus infer's naming. It can fall, and it
  is not a conservation check — but it should not be read as "the field
  extraction is perfect".

### Two findings this suite produced on its first run

- **`entityNameFor('/api/v1/tasks/all')` → `All`.** The entity backing
  `models.Task` is called `All`, because the rule takes the last literal path
  segment and `tasks/all` ends in `all`. §7.2 requires naming a component from
  what it *is*; this is that rule broken for entities. Recorded, not fixed in
  this commit — the category doing its job on its first run is the finding, and
  fixing it in the same change would make the number a claim about the fix.
- **The no-dedup ablation produces duplicate entity names** — `ProjectRow`
  twice, `TaskRow` three times — and `SiteModelSchema` accepts it. §8 keys the
  store by entity name, so two tables called `TaskRow` is not a store. The
  schema should reject it; that this ablation can produce an illegal-in-spirit
  model is a schema gap, and it is the second finding.

---

## 6. The mutation harness

Same rules as 0015 §8 and 0018 §3: applied, measured, reverted, as a different
argument. Every row asserts on the metric it names, every mutated model
re-parses, every row states why a real infer reaches the state.

| perturbation | must move | control |
|---|---|---|
| split one entity in two, both pairing to one definition | `entity-identity.precision` ↓ | |
| add an entity pairing to no definition | `entity-identity.precision` ↓ | |
| drop one field from a paired entity | `entity-field-presence.recall` ↓ | |
| add a fabricated field to a paired entity | `entity-field-presence.precision` ↓ | |
| give the enum-bearing field its declared enum | `entity-narrowing.recall` ↑ **and** `.precision` out of vacuous | |
| give a field a fabricated enum | `entity-narrowing.precision` ↓ | |
| **rename one entity** | *nothing* | ✔ matching is through the operation, never the name — so this must move nothing at all |
| **add a `json` field the document declares but the response omitted** | `entity-field-presence.recall` ↑ only | ✔ precision must hold |
| empty the entity truth side | every `inference` metric vacuous | ✔ never 1.0 |

The rename row is the one that makes the table informative rather than a list of
drops (§13): it is a change the grader could plausibly key on — the entity name
is right there in `effect.entity` — and must not.

---

## 7. Consequences for the freeze

`METRICS_VERSION` 3 → 4. `grade-contract.ts` gains the `inference` suite and
seven metrics; `grade.ts` gains the entity categories and per-metric
`notDerived`; a new `grade/entities.ts` holds the model-side entity walk and
needs a pin. `match.ts`, `fields.ts` and `vocabulary.ts` should not move, and if
one does that is a signal worth stopping on.

The truth side (`truth/swagger2.ts`, `truth/vikunja.ts`) is outside the pin by
0020's carve-out and grows the entity derivation there.

---

## Open

- `EntityField` should carry its wire name (§4). Schema change, own commit.
- `RelationSchema` cannot express a to-many association (§3.2). Schema gap.
- `SiteModelSchema` accepts duplicate entity names (§5). Schema gap.
- `entityNameFor` produces `All` for `/tasks/all` (§5).
- `entity-identity.recall` stays ungrounded until there is a document-side
  criterion for "this definition is a table", or a second target whose document
  supplies one. Widening the seeded instance so the empty collections come back
  populated would fix the *capture* half but not the criterion.
- `entity-narrowing.recall` has a denominator of 1. A crawl reaching
  `models.ProjectView` or `models.TaskRelation` would raise it to 3 or 4.
