/**
 * Infer's judgement, tested on inputs chosen to break it.
 *
 * Every function here takes its input as a parameter — this session's rule —
 * so each is driven to the answer it should refuse to give, not only the one it
 * should produce.
 */
import { describe, expect, it } from 'vitest';
import type { EndpointDescriptor, JsonSchemaNode } from '@siteforge/schema';
import {
  dedupeRows,
  entityNameFor,
  fieldNameOf,
  fieldType,
  keyOf,
  rowOf,
  shapeIdentity,
  soleType,
  type RowShape,
} from './entities.js';
import { narrowingFor, narrowingObjection } from './narrowing.js';
import { effectOf } from './operations.js';
import { cluster, sameColour } from './tokens.js';
import { leafText, structuralHash } from './components.js';

const str: JsonSchemaNode = { type: 'string' };
const int: JsonSchemaNode = { type: 'integer' };

const row = (properties: Record<string, JsonSchemaNode>, over: Partial<RowShape> = {}): RowShape => ({
  sources: ['get-a'],
  rowsAt: '',
  properties,
  required: [],
  fromList: true,
  ...over,
});

const endpoint = (over: Partial<EndpointDescriptor>): EndpointDescriptor =>
  ({
    endpointId: 'get-api-things',
    method: 'GET',
    pathPattern: '/api/things',
    origin: 'http://127.0.0.1:3803',
    params: { path: [], query: [], headers: [] },
    requestBodySchema: null,
    responses: [],
    requiresAuth: 'unknown',
    authEvidence: [],
    discovery: { kind: 'observed' },
    samples: [],
    observedOn: [],
    isMutation: false,
    ...over,
  }) as EndpointDescriptor;

describe('a nullable type is one type and a nullability claim', () => {
  it('reads the type through a union, and drops the null', () => {
    expect(soleType({ type: ['string', 'null'] } as JsonSchemaNode)).toBe('string');
    expect(soleType(str)).toBe('string');
    expect(soleType(undefined)).toBeUndefined();
  });

  it('defaults an unrecognised type to string, because widening is free (§7.5)', () => {
    expect(fieldType({ type: 'object', properties: {} })).toBe('json');
    expect(fieldType({} as JsonSchemaNode)).toBe('string');
  });
});

describe('rows are recognised, never guessed at', () => {
  it('reads an array of objects as a list and a bare object as an item', () => {
    const list = rowOf(endpoint({
      responses: [{ status: 200, contentType: 'application/json', schema: { type: 'array', items: { type: 'object', properties: { id: int } } } }],
    }) );
    expect(list?.fromList).toBe(true);
    const item = rowOf(endpoint({
      responses: [{ status: 200, contentType: 'application/json', schema: { type: 'object', properties: { id: int } } }],
    }));
    expect(item?.fromList).toBe(false);
  });

  it('declines a shape it does not recognise rather than inventing one', () => {
    // §7's standing rule. A scalar, an array of scalars and an envelope this
    // does not understand are all "no row", and the effect that follows is
    // `custom` with a gap.
    for (const schema of [
      { type: 'string' } as JsonSchemaNode,
      { type: 'array', items: { type: 'string' } } as JsonSchemaNode,
    ]) {
      expect(rowOf(endpoint({ responses: [{ status: 200, contentType: 'application/json', schema }] }))).toBeNull();
    }
    expect(rowOf(endpoint({ responses: [] }))).toBeNull();
  });

  it('ignores a non-2xx body: an error envelope is not the resource', () => {
    expect(rowOf(endpoint({
      responses: [{ status: 404, contentType: 'application/json', schema: { type: 'object', properties: { message: str } } }],
    }))).toBeNull();
  });
});

describe('entity identity is what the row is, not where it was found', () => {
  it('merges two endpoints that return the same shape', () => {
    const merged = dedupeRows([
      row({ id: int, title: str }, { sources: ['get-projects'] }),
      row({ id: int, title: str }, { sources: ['get-project'] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toEqual(['get-projects', 'get-project']);
  });

  it('does NOT merge a partial list view into its item view, and that is deliberate', () => {
    // The known cost, asserted so it is a decision rather than a surprise: a
    // list returning four of an item's fourteen fields becomes its own entity.
    // Merging on subset would fix it and would also fuse two genuinely
    // different rows that happen to share their scalars. §7.5 one level up —
    // an over-merge makes real states unrepresentable, an under-merge only
    // makes the model longer. Splitting is free.
    expect(dedupeRows([
      row({ id: int, title: str }),
      row({ id: int, title: str, description: str }),
    ])).toHaveLength(2);
  });

  it('keeps two genuinely different rows apart', () => {
    expect(dedupeRows([row({ id: int, title: str }), row({ id: int, email: str })])).toHaveLength(2);
  });

  it('takes required as the intersection, never the union', () => {
    // A field absent from one observation of the row is not required, however
    // consistently the other showed it.
    const merged = dedupeRows([
      row({ id: int, title: str }, { required: ['id', 'title'] }),
      row({ id: int, title: str }, { required: ['id'] }),
    ]);
    expect(merged[0]!.required).toEqual(['id']);
  });

  it('identifies by scalars only, so a nested object cannot split one entity in two', () => {
    expect(shapeIdentity(row({ id: int, owner: { type: 'object', properties: {} } })))
      .toBe(shapeIdentity(row({ id: int })));
  });

  it('names an entity from its resource, never Entity3 (§7.2)', () => {
    expect(entityNameFor('/api/v1/projects')).toBe('Project');
    expect(entityNameFor('/api/v1/labels/:id')).toBe('Label');
    expect(entityNameFor('/api/v1/categories')).toBe('Category');
    expect(entityNameFor('/api/v1/user/settings/general')).toBe('General');
  });

  it('calls a store-generated id a surrogate key, which the schema requires', () => {
    // §10: an entity anchor must not be keyed on a value that changes between
    // seeds, and an integer `id` is a counter.
    expect(keyOf({ id: int })).toEqual({ field: 'id', kind: 'surrogate' });
    expect(keyOf({ slug: str })).toEqual({ field: 'slug', kind: 'business' });
    expect(keyOf({ title: str })).toBeNull();
  });
});

describe('a wire name and a model name are kept apart', () => {
  it('camel-cases the model name and leaves the pointer alone', () => {
    expect(fieldNameOf('hex_color')).toBe('hexColor');
    expect(fieldNameOf('id')).toBe('id');
    expect(fieldNameOf('parent-project-id')).toBe('parentProjectId');
  });

  it('declines a name it cannot spell rather than inventing one', () => {
    expect(fieldNameOf('123')).toBeNull();
    expect(fieldNameOf('')).toBeNull();
    expect(fieldNameOf('___')).toBeNull();
  });
});

describe('a narrowing is carried only where the evidence justified it', () => {
  it('carries an enum that came with its counts', () => {
    const node: JsonSchemaNode = {
      type: 'string',
      enum: ['open', 'done'],
      narrowing: { kind: 'enum', distinctRecords: 40, distinctValues: 2, uiConstraint: null },
    };
    expect(narrowingFor(node).enumValues).toEqual(['open', 'done']);
  });

  it('refuses an enum record with no values, which `every` would have passed', () => {
    const node: JsonSchemaNode = {
      type: 'string',
      enum: [],
      narrowing: { kind: 'enum', distinctRecords: 40, distinctValues: 0, uiConstraint: null },
    };
    expect(narrowingFor(node)).toEqual({ narrowing: null, enumValues: null });
  });

  it('objects to a thin enum with no UI constraint behind it (§7.5)', () => {
    const objection = narrowingObjection('state', {
      kind: 'enum', distinctRecords: 4, distinctValues: 2, uiConstraint: null,
    });
    expect(objection).toContain('low cardinality is not evidence of a closed domain');
  });

  it('allows a thin enum the DOM constrains, which is the primary evidence', () => {
    expect(narrowingObjection('state', {
      kind: 'enum', distinctRecords: 4, distinctValues: 2,
      uiConstraint: { control: 'select', routeId: 'r--anon-desktop--i0', nodeId: 'n_1', optionValues: ['open', 'done'] },
    })).toBeNull();
  });
});

describe('what an operation does to the store is read, and otherwise refused', () => {
  const entityOf = () => 'Thing';

  it('reads a list, an item, a create and a delete off method and shape', () => {
    const listRow = row({ id: int, title: str });
    expect(effectOf(endpoint({}), listRow, entityOf).kind).toBe('list');
    expect(effectOf(endpoint({}), { ...listRow, fromList: false }, entityOf).kind).toBe('read');
    expect(effectOf(
      endpoint({ method: 'PUT', requestBodySchema: { type: 'object', properties: { title: str } } }),
      listRow, entityOf,
    ).kind).toBe('create');
    expect(effectOf(
      endpoint({ method: 'DELETE', params: { path: [{ name: 'id', type: 'string', required: true, examples: ['1'] }], query: [], headers: [] } }),
      listRow, entityOf,
    ).kind).toBe('delete');
  });

  it('refuses to call a POST a create when it cannot see what it created', () => {
    // §13's default-by-category: the safe answer here is that codegen stubs it
    // and the operator is told, never "most POSTs are creates".
    const effect = effectOf(endpoint({ method: 'POST' }), null, entityOf);
    expect(effect.kind).toBe('custom');
    if (effect.kind === 'custom') expect(effect.gapId).toMatch(/^gap_[0-9a-f]{12}$/);
  });

  it('refuses when the row belongs to no entity it declared', () => {
    const effect = effectOf(endpoint({}), row({ id: int }), () => null);
    expect(effect.kind).toBe('custom');
  });
});

describe('tokens cluster what was painted (§7.1)', () => {
  it('snaps a brand blue and its typo together', () => {
    expect(sameColour('rgb(26, 115, 232)', 'rgb(26, 115, 233)')).toBe(true);
    expect(sameColour('rgb(26, 115, 232)', 'rgb(200, 20, 20)')).toBe(false);
  });

  it('never merges a transparent value with an opaque one', () => {
    // `rgba(0,0,0,0)` is "no colour", not black, and merging them would give
    // every unstyled element the text colour.
    expect(sameColour('rgba(0, 0, 0, 0)', 'rgb(0, 0, 0)')).toBe(false);
  });

  it('keeps the most-used spelling and records what snapped into it', () => {
    const [first] = cluster(
      [{ value: 'rgb(26, 115, 232)', count: 40 }, { value: 'rgb(26, 115, 233)', count: 2 }],
      sameColour,
    );
    expect(first!.value).toBe('rgb(26, 115, 232)');
    expect(first!.count).toBe(42);
    expect([...first!.snappedFrom].sort()).toEqual(['rgb(26, 115, 232)', 'rgb(26, 115, 233)']);
  });
});

describe('components are found by structure, never by class name', () => {
  const el = (tag: string, children: unknown[] = []) => ({ nodeType: 'element', tag, children });
  const text = (value: string) => ({ nodeType: 'text', text: value });

  it('hashes tags and nesting, so a CSS-in-JS rename cannot hide a repeat', () => {
    const a = { ...el('li', [el('span', [text('one')])]), attributes: { class: 'css-1a2b' } };
    const b = { ...el('li', [el('span', [text('two')])]), attributes: { class: 'css-9z8y' } };
    expect(structuralHash(a as never)).toBe(structuralHash(b as never));
  });

  it('reads the leaves, which is what says whether a repeat is a component', () => {
    expect(leafText(el('li', [el('span', [text('one')]), text('  ')]) as never)).toEqual(['one']);
  });
});
