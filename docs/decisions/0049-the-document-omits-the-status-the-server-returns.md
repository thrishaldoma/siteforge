# 0049 — The document omits the status the server returns

*Status: §1 refutes a stated mechanism with measurement. §2–§3 are the rule
and the prediction, committed before the change. §4 onward is written after.*

> **Fixture note (0052).** The capture-derived figures in this document were
> measured against the pinned Vikunja digest
> `sha256:ed1f3ed4…` with the seed **as it stood before [[0051]]**, whose every
> task had `assignees`, `labels`, `reminders` and `attachments` null. 0051
> changed the seed, so these numbers describe an instance that no longer
> exists. They are not reconstructed — they were correct about what they
> measured.

The ruling was: *"infer currently unions bodies across status codes, so a
401's `{message}` becomes a field of the 200 response. Same granularity you
applied to the recall denominator, applied to the model."*

**There is no union.** Measured three ways, below. The 18 residual false
positives from [[0047]] §7.1 have a different cause, and the fix is in the
grader rather than in infer.

---

## 1. The union does not exist, and infer has always grouped by status

| check | result |
|---|---|
| `infer-endpoints.mjs:296` groups observations into `byStatus` before inferring, one `inferSchema` per bucket | per-status **by construction** |
| `GET /api/v1/labels` 200 | a clean array of label objects — `created, created_by, description, hex_color, id, title, updated`. No `message` |
| every endpoint holding **both** a success and an error body (15 of them) | **0** error keys present in any success schema |

So the granularity the ruling asked for is already there, and applying it
again would change nothing. **Exact non-movement would have been the
outcome**, which §13 says to predict rather than discover.

### 1.1 What the 18 actually are

Every one is a `(status, pointer)` at a status **the document does not
declare for that operation**:

```
GET /labels          model [200, 401]   document [200, 500]
GET /tasks/{id}      model [200, 401]   document [200, 404, 500]
GET /notifications   model [401]        document [200, 403, 500]
GET /user/settings/totp  model [401, 412]  document [200, 500]
…16 endpoints, model-only status 401; one also 412
```

Vikunja's server answers an uncredentialed request with `401 {"message": …}`.
Its Swagger declares 401 response fields **twice in the entire document**.
The server does it everywhere; the document says it almost nowhere.

### 1.2 So two of the ruling's three parts stand

- **The mechanism** — refuted, above.
- **The §8 note** — stands, and is now *more* load-bearing rather than less.
  The model already carries these bodies correctly, so codegen must not drop
  them: the mock backend has to return the right shape per status, and the
  401 body is exactly what §10's auth tasks hit. Recorded in §5.
- **"The probe was right; the union was wrong"** — the probe was right, and
  §6's anonymous re-issue is why these bodies exist at all. What is wrong is
  **the grader charging infer for a document omission.**

## 2. Why not eighteen known-divergence entries

`KNOWN_DIVERGENCE` is the existing mechanism for a document that disagrees
with its server, and this is that. But the field-scope cap is
`denominator × 0.05` = `254 × 0.05` = **12.7**, so eighteen entries would put
`response-field-presence` **over cap** and the grader would report the
document unfit for grading the category. That verdict would be false: the
document is fine for the other 236 fields.

More importantly it would read as **eighteen judgements**. It is one:

> **A `(operation, status)` slot the document declares no response for, and
> the crawl observed, is scored in neither direction.**

One rule with eighteen instances is the honest description of a *systematic*
omission, and a systematic omission is exactly what a per-slot list hides.

### 2.1 The predicate reads the document and the observation, never the model

The same discipline the ruling set for the recall denominator. Two
conditions, both outside infer's output:

1. **the document declares no response at that `(operation, status)`** — read
   from the truth snapshot;
2. **the crawl observed that status for that endpoint** — read from
   `capture/network/endpoints.json`, which is committed data.

Condition 2 is what stops this becoming a licence. A status infer *invented*
— one the crawl never saw — is not excluded and stays a false positive,
which is the hallucination this category exists to catch. Reading "the model
has a response at this status" instead would exclude exactly the claims the
metric is for.

That needs the observed side to carry statuses, so `ObservedEndpoint` gains
`statuses`. It comes from the capture artifact, never recomputed from the
model — §13's rule that an invariant's observed side must be derived
independently of the thing it checks.

## 3. Prediction, before the change

1.0000 is the **arithmetic consequence** of excluding the eighteen already
enumerated, so on its own it is not falsifiable. The falsifiable form:

> - **exactly 18** model-side slots are excluded, and no others;
> - **no truth-side field is removed** — `observed-body-recall` stays
>   `236/362` and `seed-coverage` stays `362/458`;
> - `field-type` stays `225/250`, since every excluded slot is model-only and
>   was never in a matched-field denominator;
> - `response-field-presence.precision` reads **1.0000 (236/236)**;
> - `endpoint-identity.precision` does not move.

Any of those five failing means the predicate is reaching something it should
not.
