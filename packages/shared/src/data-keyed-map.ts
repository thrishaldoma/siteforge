/**
 * A response object whose **keys are data** is a map, not a record type.
 *
 * 0046 diagnosed `response-field-presence.precision` at 0.4207 and found 307
 * of 308 false positives in one endpoint: `GET /api/v1/routes` returns 28
 * route groups, infer enumerated each key as a schema property and reached
 * 307 pointers, and the document declares the whole thing as one field.
 *
 * Not hallucination — every key was in an observed body, which is what §5
 * asks for. The category error is one level up: **the values of the response
 * became the shape of the response.** 28 groups produce 307 fields; 280
 * groups would produce 3 070, and none of them is a claim about schema.
 *
 * ### The bias, and why it points this way
 *
 * A record says *these keys exist*. A map says *any key may exist*. Against
 * §8, which turns response schemas into the mock backend's data model, **the
 * map is the permissive direction** — the clone accepts keys the real API
 * would reject. That is a wrong enum's asymmetry pointed the other way, so
 * the rule prefers **false negatives**: a small map left as a record costs a
 * few declared fields the API also has, while a record collapsed to a map
 * loses its schema entirely and nothing downstream can check it again.
 *
 * ### The rule (0047 §2, §6), and the one thing measurement changed
 *
 * R1 `siblings >= 12` · R2′ *the sibling value schemas unify* · R3 *the value
 * schema is an object with properties*.
 *
 * R2 was first declared as full recursive structural **identity**, and
 * measured: it fired on nothing, including the case it was built for. The 28
 * route groups do not carry identical key sets — `filters` has `{create,
 * delete, read_one, update}`, `labels` has those plus `read_all` — so
 * identity read every group as a different shape and agreement came out at
 * 0.1429 against a 0.90 threshold.
 *
 * **Unification is the comparison that separates the two cases on the
 * property that actually distinguishes them.** A record type's fields differ
 * in *type* — `id: number` beside `title: string` — and fail at the first
 * pair. A data-keyed map's values differ only in *which keys they carry*,
 * which is what "the keys are data" means. The threshold did not move; the
 * comparison did, and 0047 §5 records that it moved after a failed run.
 *
 * Two of the three signals the ruling named are deliberately absent:
 *
 * - **"Keys that look like data"** is lexical, standing in for a structural
 *   property — §13's substring-for-token family. `filters`, `labels` and
 *   `projects` are identifier-shaped words. R2′ carries the same information
 *   structurally and naming cannot fool it.
 * - **Key-set instability across observations** is the strongest signal in
 *   principle and is **silent on this target**: the motivating response has
 *   `observedCount: 1`. Requiring it would build a detector that cannot fire
 *   on its own motivating instance — §13's fourth vacuity mode. It is
 *   recorded in the evidence as `keySetsSeen` and required of nobody.
 */

import type { JsonSchemaNode } from '@siteforge/schema';

/** R1. Below this the false-positive cost dominates (0047 §1.1). */
export const MAP_MIN_SIBLINGS = 12;
/** R2′. A sibling agrees when it unifies with the modal value schema. */
export const MAP_MIN_AGREEMENT = 0.9;

/**
 * Do two schemas describe the same kind of thing?
 *
 * Recursive, and **open on keys**: a property present in only one side is
 * permitted, because that permission is the map property being tested for. A
 * property present in both must unify, which is where a record type fails —
 * its fields disagree on `type` at the first shared name.
 *
 * `examples`, `narrowing`, `identifier` and `description` are ignored: they
 * are annotations over observed *values*, and two groups holding different
 * data are still the same shape. Including them would make the comparison a
 * test of the instance rather than of the structure — 0021's finding, which
 * this whole document exists downstream of.
 */
export function schemasUnify(a: JsonSchemaNode, b: JsonSchemaNode): boolean {
  const typeOf = (n: JsonSchemaNode): string =>
    (Array.isArray(n.type) ? [...n.type].sort().join('|') : n.type) ?? 'unknown';
  if (typeOf(a) !== typeOf(b)) return false;

  if (a.properties !== undefined || b.properties !== undefined) {
    const pa = a.properties ?? {};
    const pb = b.properties ?? {};
    for (const key of Object.keys(pa)) {
      const left = pa[key];
      const right = pb[key];
      // A key on one side only is the map property, not a disagreement.
      if (left === undefined || right === undefined) continue;
      if (!schemasUnify(left, right)) return false;
    }
  }

  if (a.items !== undefined && b.items !== undefined && !schemasUnify(a.items, b.items)) {
    return false;
  }
  // An array whose item schema is known on one side and not the other says
  // nothing either way: one of the two was observed empty.

  const av = typeof a.additionalProperties === 'object' ? a.additionalProperties : null;
  const bv = typeof b.additionalProperties === 'object' ? b.additionalProperties : null;
  if (av !== null && bv !== null && !schemasUnify(av, bv)) return false;

  return true;
}

/**
 * The evidence a map claim rests on.
 *
 * Mirrors `NarrowingRecord`: a derived field carries what it was derived
 * from, and the schema rejects a value the evidence does not support (§13).
 */
export interface MapEvidence {
  readonly kind: 'data-keyed-map';
  readonly siblings: number;
  readonly agreeing: number;
  readonly observations: number;
  readonly keySetsSeen: number;
  /**
   * The keys, kept rather than discarded.
   *
   * Not decoration. §8 seeds the mock store from captured responses, so
   * dropping `properties` without keeping the keys would trade a precision
   * defect for an empty store — the clone would declare a map and have
   * nothing to put in it.
   */
  readonly observedKeys: readonly string[];
}

export interface MapDetection {
  readonly valueSchema: JsonSchemaNode;
  readonly evidence: MapEvidence;
}

/**
 * Should this object node be represented as a map?
 *
 * Takes the built properties and the observed key sets as parameters, so the
 * judgement can be driven without a crawl (§13). Returns `null` for every
 * node that stays a record — which is the overwhelming majority, by design.
 */
export function detectDataKeyedMap(input: {
  readonly properties: Readonly<Record<string, JsonSchemaNode>>;
  /** One entry per observed body this node appeared in. */
  readonly keySets: readonly (readonly string[])[];
}): MapDetection | null {
  const keys = Object.keys(input.properties);
  if (keys.length < MAP_MIN_SIBLINGS) return null; // R1

  const values = keys.map((k) => input.properties[k]).filter((v): v is JsonSchemaNode => v !== undefined);
  // R3, checked before R2′: a map of scalars is indistinguishable from a
  // record of scalar fields, and twelve strings would unify trivially.
  // empty: `values` cannot be empty here — R1 above returned unless there were
  // at least 12 keys, and each maps to a defined node. If it somehow were,
  // `.every([])` is `true` and the permissive answer would admit a map with no
  // values at all, so the guard is stated rather than inferred from R1.
  if (values.length === 0) return null;
  if (!values.every((v) => v.type === 'object' && v.properties !== undefined)) return null;

  /**
   * The modal schema is the one the most siblings unify with, not the first.
   * Iteration order must never decide (0042) — and here the first sibling
   * being an outlier would drag the whole verdict with it.
   */
  let best: { schema: JsonSchemaNode; agreeing: number } | null = null;
  for (const candidate of values) {
    const agreeing = values.filter((v) => schemasUnify(candidate, v)).length;
    if (best === null || agreeing > best.agreeing) best = { schema: candidate, agreeing };
  }
  // empty: `values` is non-empty — R1 already required at least 12 of them,
  // so the loop ran and `best` was assigned.
  if (best === null) return null;
  if (best.agreeing / values.length < MAP_MIN_AGREEMENT) return null; // R2′

  /**
   * The value schema is the union of what unified, key-open.
   *
   * Merging rather than picking the modal one, because a map's value schema
   * should carry every property any instance was observed with — picking one
   * instance would throw away the operations only some route groups offer.
   */
  const merged: Record<string, JsonSchemaNode> = {};
  for (const value of values) {
    if (!schemasUnify(best.schema, value)) continue;
    for (const [name, sub] of Object.entries(value.properties ?? {})) {
      if (!(name in merged)) merged[name] = sub;
    }
  }

  // Joined on an escaped NUL rather than a space: a key may contain a
  // space, and two different key sets must not collide into one. Written
  // as '\u0000' and never as the byte — a literal NUL makes git call the
  // file binary, and no sabotage patch can be written against a file the
  // tooling cannot read (§13's fourth vacuity mode, which caught this
  // exact line).
  const distinctKeySets = new Set(input.keySets.map((s) => [...s].sort().join('\u0000')));
  return {
    valueSchema: { type: 'object', properties: merged, additionalProperties: false },
    evidence: {
      kind: 'data-keyed-map',
      siblings: keys.length,
      agreeing: best.agreeing,
      observations: input.keySets.length,
      keySetsSeen: distinctKeySets.size,
      observedKeys: [...keys].sort(),
    },
  };
}
