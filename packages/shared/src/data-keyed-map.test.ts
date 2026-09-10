import { describe, expect, it } from 'vitest';
import type { JsonSchemaNode } from '@siteforge/schema';
import {
  MAP_MIN_AGREEMENT,
  MAP_MIN_SIBLINGS,
  detectDataKeyedMap,
  schemasUnify,
} from './data-keyed-map.js';

const str: JsonSchemaNode = { type: 'string' };
const num: JsonSchemaNode = { type: 'number' };
const obj = (props: Record<string, JsonSchemaNode>): JsonSchemaNode =>
  ({ type: 'object', properties: props });

/** One route group: a few named operations, each `{method, path}`. */
const routeGroup = (ops: readonly string[]): JsonSchemaNode =>
  obj(Object.fromEntries(ops.map((o) => [o, obj({ method: str, path: str })])));

/**
 * The motivating shape, at its measured size: 28 groups whose operation sets
 * differ. `filters` has four, `labels` has five — which is exactly what made
 * the first, identity-based rule read agreement as 0.1429.
 */
const routesResponse = (): Record<string, JsonSchemaNode> => {
  const sets = [
    ['create', 'delete', 'read_one', 'update'],
    ['create', 'delete', 'read_all', 'read_one', 'update'],
    ['create', 'read_all'],
  ];
  return Object.fromEntries(
    Array.from({ length: 28 }, (_, i) => [`group_${i}`, routeGroup(sets[i % 3]!)]),
  );
};

describe('schemasUnify', () => {
  it('is open on keys — a property on one side only is the map property', () => {
    expect(schemasUnify(routeGroup(['create']), routeGroup(['create', 'delete']))).toBe(true);
  });

  it('rejects a disagreement on a SHARED key, which is where a record fails', () => {
    expect(schemasUnify(obj({ id: num }), obj({ id: str }))).toBe(false);
  });

  it('rejects a type mismatch outright', () => {
    expect(schemasUnify(str, num)).toBe(false);
  });

  it('recurses, so a deep disagreement is still a disagreement', () => {
    expect(schemasUnify(
      obj({ a: obj({ b: obj({ c: str }) }) }),
      obj({ a: obj({ b: obj({ c: num }) }) }),
    )).toBe(false);
  });

  /**
   * Value-derived annotations are ignored. Two route groups hold different
   * data and are the same shape; comparing examples would make this a test
   * of the seeded instance rather than of the structure — 0021's finding.
   */
  it('ignores examples and narrowing, which describe values not shape', () => {
    expect(schemasUnify(
      { type: 'string', examples: ['PUT'] },
      { type: 'string', examples: ['DELETE', 'GET'] },
    )).toBe(true);
  });
});

describe('detectDataKeyedMap', () => {
  /** The case the whole rule exists for. R2 as first declared read 0.1429. */
  it('FIRES on 28 route groups whose operation sets differ', () => {
    const props = routesResponse();
    const found = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(found).not.toBeNull();
    expect(found?.evidence.siblings).toBe(28);
    expect(found?.evidence.agreeing).toBe(28);
    expect(found?.evidence.observedKeys).toHaveLength(28);
  });

  /**
   * The value schema is the UNION of what unified, not the modal instance.
   * Picking one would throw away the operations only some groups offer, and
   * §8 seeds the store from this.
   */
  it('merges every observed operation into the value schema', () => {
    const props = routesResponse();
    const found = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(Object.keys(found!.valueSchema.properties ?? {}).sort())
      .toEqual(['create', 'delete', 'read_all', 'read_one', 'update']);
  });

  /**
   * A real record type. 29 siblings, more than the routes response has, and
   * it must be rejected on type disagreement rather than by a margin.
   */
  it('does NOT fire on a Task — heterogeneous field types', () => {
    const task = {
      id: num, title: str, description: str, done: { type: 'boolean' } as JsonSchemaNode,
      ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, i % 2 ? num : str])),
    };
    expect(detectDataKeyedMap({ properties: task, keySets: [Object.keys(task)] })).toBeNull();
  });

  /** R1. The deliberate false negative: the inner route groups are 4–9 keys. */
  it('does NOT fire below the sibling floor, however uniform', () => {
    const props = Object.fromEntries(
      Array.from({ length: MAP_MIN_SIBLINGS - 1 }, (_, i) => [`k${i}`, obj({ method: str, path: str })]),
    );
    expect(detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] })).toBeNull();
  });

  it('fires at exactly the floor, so the boundary is tested from both sides', () => {
    const props = Object.fromEntries(
      Array.from({ length: MAP_MIN_SIBLINGS }, (_, i) => [`k${i}`, obj({ method: str, path: str })]),
    );
    expect(detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] })).not.toBeNull();
  });

  /**
   * R3. Twelve strings unify trivially, and a record of twelve string fields
   * is an ordinary thing for an API to return. Without this the rule would
   * eat them.
   */
  it('does NOT fire on scalar values, however many and however uniform', () => {
    const props = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, str]));
    expect(detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] })).toBeNull();
  });

  it('does NOT fire when too few siblings unify', () => {
    // Half `{method, path}`, half `{quantity: number}` — a disagreement on a
    // shared key is absent, but the modal schema only covers half.
    const props = Object.fromEntries(Array.from({ length: 20 }, (_, i) =>
      [`k${i}`, i % 2 ? obj({ method: str }) : obj({ method: num })]));
    const found = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(found).toBeNull();
  });

  it('admits one outlier, since the threshold is 0.9 rather than 1.0', () => {
    const props = Object.fromEntries(Array.from({ length: 20 }, (_, i) =>
      [`k${i}`, i === 0 ? obj({ method: num }) : obj({ method: str })]));
    const found = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(found?.evidence.agreeing).toBe(19);
    expect(19 / 20).toBeGreaterThanOrEqual(MAP_MIN_AGREEMENT);
  });

  /**
   * Iteration order must never decide (0042). The modal schema is the one the
   * most siblings unify with, so an outlier sitting first must not drag the
   * verdict with it.
   */
  it('picks the modal value schema, not the first', () => {
    const props = Object.fromEntries(Array.from({ length: 20 }, (_, i) =>
      [`k${String(i).padStart(2, '0')}`, i === 0 ? obj({ method: num }) : obj({ method: str })]));
    const found = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(found).not.toBeNull();
    expect(found?.valueSchema.properties?.['method']).toEqual(str);
  });

  it('records key-set instability where observations allow, and nothing where they do not', () => {
    const props = routesResponse();
    const one = detectDataKeyedMap({ properties: props, keySets: [Object.keys(props)] });
    expect(one?.evidence).toMatchObject({ observations: 1, keySetsSeen: 1 });
    const two = detectDataKeyedMap({
      properties: props,
      keySets: [Object.keys(props), Object.keys(props).slice(0, 20)],
    });
    expect(two?.evidence).toMatchObject({ observations: 2, keySetsSeen: 2 });
  });
});
