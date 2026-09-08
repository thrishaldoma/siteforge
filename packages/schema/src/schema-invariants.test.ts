/**
 * Guard tests.
 *
 * The fixture suite proves the schema *accepts* a well-formed capture. These
 * prove it *rejects* a malformed one — which is the half that actually protects
 * the pipeline, since §13's failure mode is a stage quietly writing something the
 * next stage misreads.
 *
 * Each case mutates a real fixture rather than building a toy object, so the test
 * fails if the invariant stops holding *and* if the fixture drifts out from under it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  CAPTURE_MODEL_VERSION,
  CaptureManifestSchema,
  CaptureModelSchema,
  DomDocumentSchema,
  EndpointIndexSchema,
  FlowTraceSchema,
  GapSchema,
  JsonSchemaNodeSchema,
  RouteCaptureSchema,
  RouteIdSchema,
  RouteMetaSchema,
  SITE_MODEL_VERSION,
  SiteModelSchema,
  StateDeltasDocumentSchema,
  StyleSheetDocumentSchema,
} from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'capture', 'northwind-supply');
const load = <T,>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
const clone = <T,>(v: T): T => structuredClone(v);

const MUG = 'product-id--i0--1280x800';
const routeMeta = load<Record<string, unknown>>(`routes/${MUG}/meta.json`);
const routeDom = load<Record<string, unknown>>(`routes/${MUG}/dom.json`);
const routeStyles = load<Record<string, unknown>>(`routes/${MUG}/styles.json`);
const routeStates = load<Record<string, unknown>>(`routes/${MUG}/states.json`);
const manifest = load<Record<string, unknown>>('manifest.json');
const endpoints = load<Record<string, unknown>>('network/endpoints.json');
const addToCart = load<Record<string, unknown>>('flows/add-mug-to-cart.trace.json');
const deleteAccount = load<Record<string, unknown>>('flows/delete-account.trace.json');

/* --------------------------------------------------------------- envelope */

describe('the artifact envelope', () => {
  it('rejects an artifact written under a different model version', () => {
    const bad = { ...clone(routeMeta), modelVersion: '0.9.0' };
    expect(RouteMetaSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an artifact read from the wrong path (kind mismatch)', () => {
    // dom.json's contents handed to the styles parser must not squeak through.
    expect(StyleSheetDocumentSchema.safeParse(clone(routeDom)).success).toBe(false);
  });

  it('makes an unscrubbed artifact unrepresentable (§3.4)', () => {
    const bad = { ...clone(routeMeta), scrubbed: false };
    const result = RouteMetaSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('scrubbed');
  });

  it('rejects unknown keys rather than silently dropping them', () => {
    const bad = { ...clone(routeMeta), templateGuessV2: { name: 'product' } };
    expect(RouteMetaSchema.safeParse(bad).success).toBe(false);
  });

  it('requires provenance, so volatile data has nowhere else to hide', () => {
    const { provenance: _p, ...bad } = clone(routeMeta);
    expect(RouteMetaSchema.safeParse(bad).success).toBe(false);
  });
});

/* ------------------------------------------------------------ identifiers */

describe('identifier shapes', () => {
  it.each([
    ['product-id--i0--1280x800', true],
    ['root--i0--390x844', true],
    ['product-id', false],
    ['product-id--1280x800', false],
    ['product-id--i0', false],
    ['Product-Id--i0--1280x800', false],
    ['product-id--i0--1280×800', false],
  ])('routeId %s -> %s', (id, ok) => {
    expect(RouteIdSchema.safeParse(id).success).toBe(ok);
  });

  it('rejects a nodeId that is not a derived hash', () => {
    const bad = clone(routeDom);
    (bad['root'] as Record<string, unknown>)['nodeId'] = 'html-body-div-1';
    expect(DomDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a style assignment keyed by something that is not a nodeId', () => {
    const bad = clone(routeStyles);
    (bad['assignments'] as Record<string, string>)['div.card'] = 's_0000000000000000';
    expect(StyleSheetDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

/* ----------------------------------------------------------------- flows */

describe('flow traces form a chain', () => {
  it('accepts the fixture unchanged', () => {
    expect(FlowTraceSchema.safeParse(clone(addToCart)).success).toBe(true);
  });

  it('rejects steps whose index is out of order', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, unknown>>;
    [steps[0], steps[1]] = [steps[1]!, steps[0]!];
    expect(FlowTraceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a step that does not start from the previous post-state', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, Record<string, unknown>>>;
    steps[1]!['pre']!['domHash'] = 'deadbeefdeadbeef';
    const result = FlowTraceSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('post-state');
  });

  it('rejects a skipped flow that recorded steps anyway', () => {
    const bad = clone(deleteAccount);
    bad['steps'] = (clone(addToCart)['steps'] as unknown[]).slice(0, 1);
    expect(FlowTraceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a skipped flow that does not say why (§6 requires the gap)', () => {
    const bad = clone(deleteAccount);
    delete bad['skipReason'];
    expect(FlowTraceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a completed flow with no steps', () => {
    const bad = clone(addToCart);
    bad['steps'] = [];
    expect(FlowTraceSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a probe carrying more than one action (§6: one action per probe)', () => {
    const bad = clone(addToCart);
    bad['kind'] = 'probe';
    expect(FlowTraceSchema.safeParse(bad).success).toBe(false);
  });
});

/* ------------------------------------------------------------- endpoints */

describe('endpoint descriptors', () => {
  it('rejects an endpoint with no observed response and no stub (§7)', () => {
    const bad = clone(endpoints);
    const list = bad['endpoints'] as Array<Record<string, unknown>>;
    const stubbed = list.find((e) => e['endpointId'] === 'delete-api-account')!;
    delete stubbed['stub'];
    const result = EndpointIndexSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('stubbed');
  });

  it('rejects a sample of a status the endpoint never returned', () => {
    const bad = clone(endpoints);
    const list = bad['endpoints'] as Array<Record<string, unknown>>;
    const products = list.find((e) => e['endpointId'] === 'get-api-products')!;
    (products['samples'] as Array<Record<string, unknown>>)[0]!['status'] = 418;
    expect(EndpointIndexSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a header descriptor that carries a value', () => {
    const bad = clone(endpoints);
    const list = bad['endpoints'] as Array<Record<string, unknown>>;
    const cart = list.find((e) => e['endpointId'] === 'get-api-cart')!;
    const headers = (cart['params'] as Record<string, unknown>)['headers'] as Array<Record<string, unknown>>;
    headers[0]!['value'] = 'session=abc123';
    expect(EndpointIndexSchema.safeParse(bad).success).toBe(false);
  });
});

/* --------------------------------------------------------- JSON Schema subset */

describe('the JSON Schema subset is closed', () => {
  it('accepts what response inference emits', () => {
    expect(JsonSchemaNodeSchema.safeParse({
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' }, tags: { type: 'array', items: { type: 'string' } } },
      required: ['id'],
      additionalProperties: false,
    }).success).toBe(true);
  });

  it('rejects keywords that cannot be inferred from examples', () => {
    for (const bad of [
      { type: 'object', $ref: '#/definitions/Product' },
      { type: 'object', allOf: [{ type: 'object' }] },
      { type: 'string', if: { const: 'a' } },
    ]) {
      expect(JsonSchemaNodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('rejects a node with no type', () => {
    expect(JsonSchemaNodeSchema.safeParse({ properties: { a: { type: 'string' } } }).success).toBe(false);
  });

  it('recurses arbitrarily deep', () => {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 25; i += 1) node = { type: 'array', items: node };
    expect(JsonSchemaNodeSchema.safeParse(node).success).toBe(true);
  });
});

/* ------------------------------------------------------------------- gaps */

describe('gaps', () => {
  const base = {
    gapId: 'gap_0123456789ab',
    stage: 'capture' as const,
    category: 'licensed-webfont' as const,
    severity: 'degraded' as const,
    summary: 'x',
    detail: 'y',
    stub: { kind: 'omitted' as const, detail: 'z' },
  };

  it('rejects a gap that names nothing', () => {
    expect(GapSchema.safeParse({ ...base, subject: {} }).success).toBe(false);
  });

  it('accepts a gap that names one thing', () => {
    expect(GapSchema.safeParse({ ...base, subject: { routeId: MUG } }).success).toBe(true);
  });

  it('rejects an unknown category rather than absorbing it', () => {
    expect(GapSchema.safeParse({ ...base, category: 'something-new', subject: { url: 'x' } }).success).toBe(false);
  });
});

/* -------------------------------------------------------- cross-file drift */

describe('cross-file drift is caught at load', () => {
  const routeCapture = { meta: routeMeta, dom: routeDom, styles: routeStyles, states: routeStates };

  it('accepts a coherent route directory', () => {
    expect(RouteCaptureSchema.safeParse(clone(routeCapture)).success).toBe(true);
  });

  it('rejects a route directory whose dom and styles disagree about a styleId', () => {
    const bad = clone(routeCapture);
    const assignments = (bad.styles as Record<string, Record<string, string>>)['assignments']!;
    const firstNodeId = Object.keys(assignments)[0]!;
    assignments[firstNodeId] = 's_ffffffffffffffff';
    const result = RouteCaptureSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('styles.json assigns');
  });

  it('rejects a route directory with an element that has no style assignment', () => {
    const bad = clone(routeCapture);
    const assignments = (bad.styles as Record<string, Record<string, string>>)['assignments']!;
    delete assignments[Object.keys(assignments)[0]!];
    const result = RouteCaptureSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('has no style assignment');
  });

  it('rejects a route directory whose files disagree about which route they are', () => {
    const bad = clone(routeCapture);
    (bad.styles as Record<string, unknown>)['routeId'] = 'root--i0--1280x800';
    const result = RouteCaptureSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('styles.json claims route');
  });

  it('rejects a model whose manifest lists a route that was not loaded', () => {
    const bad = {
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest: clone(manifest),
      routes: { [MUG]: clone(routeCapture) },
      assets: load('assets/index.json'),
      endpoints: clone(endpoints),
      flows: {},
    };
    const result = CaptureModelSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('no route directory was loaded');
  });

  it('rejects a manifest whose siteId disagrees with the capture directory', () => {
    const m = clone(manifest);
    m['siteId'] = 'somewhere-else';
    expect(CaptureManifestSchema.safeParse(m).success).toBe(true); // valid on its own…
    const result = CaptureModelSchema.safeParse({
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest: m,
      routes: {},
      assets: load('assets/index.json'),
      endpoints: clone(endpoints),
      flows: {},
    });
    expect(result.success).toBe(false); // …but not in place.
  });
});

/* ----------------------------------------------------------- states union */

describe('state deltas keep their provenance distinguishable (§6)', () => {
  it('rejects an entry with no source', () => {
    const bad = clone(routeStates);
    const entries = bad['entries'] as Array<Record<string, unknown>>;
    delete entries[0]!['source'];
    expect(StateDeltasDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('will not let a probed observation masquerade as a CSSOM rule', () => {
    const bad = clone(routeStates);
    const entries = bad['entries'] as Array<Record<string, unknown>>;
    const probed = entries.find((e) => e['source'] === 'probed')!;
    probed['source'] = 'cssom';
    expect(StateDeltasDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('only accepts the state selectors §6 enumerates', () => {
    const bad = clone(routeStates);
    const entries = bad['entries'] as Array<Record<string, unknown>>;
    const cssom = entries.find((e) => e['source'] === 'cssom')!;
    cssom['stateSelectors'] = [':visited'];
    expect(StateDeltasDocumentSchema.safeParse(bad).success).toBe(false);
  });
});

/* -------------------------------------------------------------- SiteModel */

describe('SiteModel is reserved, not implemented (decision 0001)', () => {
  it('is versioned separately from the capture model', () => {
    expect(SITE_MODEL_VERSION).not.toBe(CAPTURE_MODEL_VERSION);
    expect(SITE_MODEL_VERSION).toMatch(/reserved/);
  });

  it('cannot be constructed by accident before M2 designs it', () => {
    expect(SiteModelSchema.safeParse({ modelVersion: '1.0.0', tokens: {}, components: [] }).success).toBe(false);
    expect(SiteModelSchema.safeParse({ modelVersion: SITE_MODEL_VERSION, reserved: true }).success).toBe(true);
  });
});
