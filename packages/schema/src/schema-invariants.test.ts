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
  EndpointDescriptorSchema,
  EndpointIndexSchema,
  EntitySchema,
  FlowTraceSchema,
  GapSchema,
  JsonSchemaNodeSchema,
  MERGE_MIN_SHARED_FIELDS,
  MergeRecordSchema,
  RouteCaptureSchema,
  RouteIdSchema,
  RouteMetaSchema,
  SITE_MODEL_VERSION,
  SkippedControlSchema,
  SiteModelSchema,
  StateDeltasDocumentSchema,
  StyleSheetDocumentSchema,
} from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'capture', 'northwind-supply');
const load = <T,>(rel: string): T => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as T;
const clone = <T,>(v: T): T => structuredClone(v);

const MUG = 'product-id--anon-desktop--i0';
const routeMeta = load<Record<string, unknown>>(`routes/${MUG}/meta.json`);
const routeDom = load<Record<string, unknown>>(`routes/${MUG}/dom.json`);
const routeStyles = load<Record<string, unknown>>(`routes/${MUG}/styles.json`);
const routeStates = load<Record<string, unknown>>(`routes/${MUG}/states.json`);
const manifest = load<Record<string, unknown>>('manifest.json');
const report = load<Record<string, unknown>>('stage-report.json');
const endpoints = load<Record<string, unknown>>('network/endpoints.json');
/**
 * The infer-stage fixture (decision 0010). It lives outside `capture/` because
 * the stage that can produce a shape is part of the contract, and this one is a
 * shape §6 cannot produce.
 */
const inferFixture = JSON.parse(
  readFileSync(join(ROOT, '..', '..', 'infer', 'northwind-supply', 'bound-endpoints.json'), 'utf8'),
) as { endpoints: unknown[]; gaps: unknown[] };
const boundEndpoint = inferFixture.endpoints[0] as Record<string, unknown>;
const skippedControls = load<Record<string, unknown>>('flows/skipped-controls.json');
/**
 * Most model tests load one route to isolate one rule. The real control index
 * points at `/account/orders` and at a flow, and those pointers are checked — so
 * a partial model gets an empty index. "Nothing was skipped" is a legitimate
 * capture; a control pointing into a route nobody loaded is not.
 */
const noControls = (): unknown => ({ ...clone(skippedControls), controls: [] });
const addToCart = load<Record<string, unknown>>('flows/add-mug-to-cart.trace.json');
const aboutAnon = load<Record<string, unknown>>('routes/about--anon-desktop--i0/meta.json');
const aboutAuth = load<Record<string, unknown>>('routes/about--auth-desktop--i0/meta.json');
const aboutDom = load<Record<string, unknown>>('routes/about--anon-desktop--i0/dom.json');
const aboutStyles = load<Record<string, unknown>>('routes/about--anon-desktop--i0/styles.json');
const aboutStates = load<Record<string, unknown>>('routes/about--anon-desktop--i0/states.json');
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
    ['product-id--anon-desktop--i0', true],
    ['root--auth-mobile-de--i2', true],
    ['product-id', false],
    ['product-id--anon-desktop', false],
    ['product-id--i0', false],
    // The old scheme spelled the viewport into the id; it must no longer parse,
    // or a stale capture would be silently readable as a current one.
    ['product-id--i0--1280x800', false],
    ['Product-Id--anon-desktop--i0', false],
    ['product-id--anon_desktop--i0', false],
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

  it('rejects a click with no target', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, unknown>>;
    delete steps[1]!['target'];
    const result = FlowTraceSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must say which element');
  });

  it('rejects a target on an action that addresses no element', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, unknown>>;
    steps[0]!['action'] = { type: 'scroll', dx: 0, dy: 200 };
    const result = FlowTraceSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must carry no target');
  });

  it('rejects a capture that filled in entityRef (§7.4 is infer\'s job)', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, Record<string, unknown>>>;
    steps[1]!['target']!['entityRef'] = 'product:MUG-BLUE';
    const result = FlowTraceSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('populated by infer');
  });

  it('rejects a runtime ref smuggled into a recorded action', () => {
    const bad = clone(addToCart);
    const steps = bad['steps'] as Array<Record<string, Record<string, unknown>>>;
    steps[1]!['action']!['ref'] = 'el_0123456789ab';
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
  it('rejects an endpoint with no observed response, no stub and no binding (§7)', () => {
    const bad = clone(boundEndpoint) as Record<string, unknown>;
    bad['discovery'] = { kind: 'observed' };
    const result = EndpointDescriptorSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('stubbed or bound');
  });

  it('accepts a zero-response endpoint that is bound to the control it came from', () => {
    // The shape decision 0010 hands to infer: no responses, but a gap id that
    // reaches GAPS.md by the binding rather than by a 501 stub.
    expect(EndpointDescriptorSchema.safeParse(clone(boundEndpoint)).success).toBe(true);
  });

  it('keeps a bound endpoint out of the capture artifact (decision 0010)', () => {
    // The ownership rule, enforced rather than documented. Capture never fired
    // the control, so it never learned the URL; a capture artifact claiming this
    // shape is a fixture lying about which stage produced it.
    const bad = clone(endpoints);
    (bad['endpoints'] as unknown[]).push(clone(boundEndpoint));
    const result = EndpointIndexSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('which capture cannot do');
  });

  it('rejects a sample of a status the endpoint never returned', () => {
    const bad = clone(endpoints);
    const list = bad['endpoints'] as Array<Record<string, unknown>>;
    const products = list.find((e) => e['endpointId'] === 'get-api-products')!;
    (products['samples'] as Array<Record<string, unknown>>)[0]!['status'] = 418;
    expect(EndpointIndexSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a digest of the HAR in the artifact body (decision 0006)', () => {
    const bad = clone(endpoints) as Record<string, Record<string, unknown>>;
    bad['har']!['sha256'] = 'a'.repeat(64);
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

/* ------------------------------------------------ the narrowing contract (§7) */

describe('narrowing a type requires evidence (decision 0010)', () => {
  const uiConstraint = {
    control: 'select',
    routeId: 'account-orders--auth-desktop--i0',
    nodeId: `n_${'a'.repeat(16)}`,
    optionValues: ['open', 'doing', 'done'],
  };
  const enumNode = (narrowing: unknown): unknown => ({
    type: 'string',
    enum: ['open', 'doing', 'done'],
    narrowing,
  });
  const gapId = `gap_${'b'.repeat(12)}`;

  it('accepts an enum a UI control constrains, however thin the sample', () => {
    // The rung-3 shape, done right: four records is nowhere near the floor, but
    // a <select> with three options is ground truth about the domain. A field is
    // an enum because the DOM constrains it, not because sampling was thin.
    expect(JsonSchemaNodeSchema.safeParse(enumNode({
      kind: 'enum', distinctRecords: 4, distinctValues: 3,
      uiConstraint, reviewRequired: true, gapId,
    })).success).toBe(true);
  });

  it('rejects the exact enum rung 3 invented: low cardinality, thin sample, no control', () => {
    // 23 observations of 4 todos is n=4. Without a control behind it this is a
    // small sample wearing a domain's clothes, and §5 would make it the mock
    // backend's data model.
    const result = JsonSchemaNodeSchema.safeParse(enumNode({
      kind: 'enum', distinctRecords: 4, distinctValues: 3,
      uiConstraint: null, reviewRequired: true, gapId,
    }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not evidence of a closed domain');
  });

  it('accepts an enum corroborated by cardinality that stayed flat as records grew', () => {
    expect(JsonSchemaNodeSchema.safeParse(enumNode({
      kind: 'enum', distinctRecords: 40, distinctValues: 3,
      uiConstraint: null, reviewRequired: true, gapId,
    })).success).toBe(true);
  });

  it('rejects an enum whose values track its records, even past the floor', () => {
    // 30 distinct values across 40 records is data, not a domain.
    const many = { type: 'string', enum: Array.from({ length: 30 }, (_, i) => `v${i}`),
      narrowing: { kind: 'enum', distinctRecords: 40, distinctValues: 30, uiConstraint: null, reviewRequired: true, gapId } };
    const result = JsonSchemaNodeSchema.safeParse(many);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('this is data, not a domain');
  });

  it('rejects a control that does not actually cover the observed values', () => {
    const result = JsonSchemaNodeSchema.safeParse(enumNode({
      kind: 'enum', distinctRecords: 4, distinctValues: 9,
      uiConstraint, reviewRequired: true, gapId,
    }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('does not constrain this field');
  });

  it('makes an enum on an identity field unrepresentable', () => {
    // The hard exclusion: values observed as somebody's path parameter are a key,
    // and a key's value set is open by definition. `id: enum ["td_1".."td_4"]`
    // cannot be written at all.
    const result = JsonSchemaNodeSchema.safeParse({
      type: 'string',
      enum: ['td_1', 'td_2', 'td_3'],
      narrowing: { kind: 'enum', distinctRecords: 40, distinctValues: 3, uiConstraint: null, reviewRequired: true, gapId },
      identifier: { pathParamOf: ['patch-api-todos-id'], evidence: ['path-param-value-overlap'] },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('an id, not an enum');
  });

  it('lets a field be an identifier without narrowing anything', () => {
    // Widening is free: this is what §7.4 reads to derive a foreign key.
    expect(JsonSchemaNodeSchema.safeParse({
      type: 'string',
      identifier: { pathParamOf: ['patch-api-todos-id'], evidence: ['path-param-value-overlap'] },
      examples: ['td_1', 'td_2'],
    }).success).toBe(true);
  });

  it('requires an enum to be reviewable: no gap id, no enum', () => {
    const { gapId: _g, ...noGap } = {
      kind: 'enum', distinctRecords: 4, distinctValues: 3, uiConstraint, reviewRequired: true, gapId,
    };
    expect(JsonSchemaNodeSchema.safeParse(enumNode(noGap)).success).toBe(false);
  });
});

/* --------------------------------------------------------- JSON Schema subset */


describe('merging two rows into one entity requires evidence (decision 0025)', () => {
  const merge = (over: Record<string, unknown> = {}): unknown => ({
    kind: 'field-set-containment',
    sources: ['get-api-v1-tasks-all', 'get-api-v1-tasks-id'],
    narrowerFields: 4,
    widerFields: 14,
    sharedFields: 4,
    keyField: 'id',
    reviewRequired: true,
    gapId: `gap_${'c'.repeat(12)}`,
    ...over,
  });

  /**
   * The threshold is a *declaration*, and this is what makes it one.
   *
   * 0025 states the floor and the reasoning before the measurement, precisely so
   * a later adjustment cannot be confused with tuning. A constant nothing checks
   * is a number someone can move in the same commit that reports the score it
   * moved — so the code and the document are compared, and lowering the floor
   * fails until the argument for the new one is written down.
   */
  it('agrees with the floor decision 0025 declares', () => {
    const doc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'decisions',
        '0025-two-observations-of-one-entity.md'),
      'utf8',
    );
    expect(doc, '0025 no longer states the floor it declared').toContain(
      `MERGE_MIN_SHARED_FIELDS = ${MERGE_MIN_SHARED_FIELDS}`,
    );
  });

  it('accepts a projection wholly contained in its item view', () => {
    expect(MergeRecordSchema.safeParse(merge()).success).toBe(true);
  });

  it('rejects a merge that is not containment — the narrower row had a field of its own', () => {
    // A list view drops fields and never adds one. `sharedFields < narrowerFields`
    // means the two rows disagree about what the entity has, which is the
    // definition of two entities.
    const result = MergeRecordSchema.safeParse(merge({ sharedFields: 3 }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('not a subset');
  });

  it('rejects a merge below the declared floor, and names the floor', () => {
    const result = MergeRecordSchema.safeParse(merge({ narrowerFields: 3, sharedFields: 3 }));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain(String(MERGE_MIN_SHARED_FIELDS));
  });

  it('accepts exactly at the floor — the boundary is a decision, so it is asserted', () => {
    expect(MergeRecordSchema.safeParse(merge({
      narrowerFields: MERGE_MIN_SHARED_FIELDS,
      sharedFields: MERGE_MIN_SHARED_FIELDS,
    })).success).toBe(true);
  });

  it('rejects a container narrower than the row it contains', () => {
    expect(MergeRecordSchema.safeParse(merge({ widerFields: 2 }).valueOf()).success).toBe(false);
  });

  it('rejects a merge of one endpoint with itself', () => {
    // Two sources or it is not a merge. `.min(2)` rather than a refinement,
    // because a one-source record describes nothing that happened.
    expect(MergeRecordSchema.safeParse(merge({ sources: ['get-api-v1-tasks-id'] })).success).toBe(false);
  });

  it('rejects a merge whose key is not the key the entity ended up with', () => {
    // Checked on the entity rather than on the record, because the record alone
    // cannot see the entity's key. Recomputable, therefore recomputed (§13).
    const entity = (mergedFrom: unknown): unknown => ({
      name: 'Task',
      key: { field: 'id', kind: 'surrogate' },
      fields: [{ name: 'id', type: 'integer', optional: false, generatedBy: 'counter', narrowing: null, pathParamOf: [] }],
      relations: [],
      mergedFrom,
      seed: null,
    });
    expect(EntitySchema.safeParse(entity(null)).success).toBe(true);
    const wrong = EntitySchema.safeParse(entity(merge({ keyField: 'slug', widerFields: 1 })));
    expect(wrong.success).toBe(false);
    expect(JSON.stringify(wrong)).toContain('but Task keys on id');
  });

  it('rejects a merge claiming a container wider than the entity it produced', () => {
    // The counts are a claim about this entity's own fields: the wider row won
    // its properties, so an entity carrying fewer than `widerFields` is a
    // record of a merge that did not happen here.
    const result = EntitySchema.safeParse({
      name: 'Task',
      key: { field: 'id', kind: 'surrogate' },
      fields: [{ name: 'id', type: 'integer', optional: false, generatedBy: 'counter', narrowing: null, pathParamOf: [] }],
      relations: [],
      mergedFrom: merge(),
      seed: null,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('carries 1');
  });
});


describe('a control that was fired records what was true of it (0024 §2, ruling 3)', () => {
  const base = {
    controlId: `ctl_${'a'.repeat(12)}`,
    routeId: 'account-orders--anon-desktop--i0',
    nodeId: `n_${'b'.repeat(16)}`,
    role: 'button',
    name: 'Quick filter',
    gapId: `gap_${'c'.repeat(12)}`,
    flowId: null,
  };
  const diagnostic = {
    step: 'click/timeout',
    selector: 'main button.quick-filter',
    attemptIndex: 7,
    visible: true, stable: true, receivesPointerEvents: false, enabled: true,
    inViewport: true, navigationPending: false, occludedBy: 'div.toast-stack',
  };

  it('accepts a driven control carrying its diagnostic', () => {
    expect(SkippedControlSchema.safeParse({
      ...base, cause: 'precondition-unmet', diagnostic,
    }).success).toBe(true);
  });

  it('rejects a driven control with no diagnostic — the measurement not taken', () => {
    const result = SkippedControlSchema.safeParse({
      ...base, cause: 'precondition-unmet', diagnostic: null,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('must record what was true of it');
  });

  it('rejects a DECLINED control carrying one — an observation nobody made', () => {
    // The direction that matters more. A control that was never driven has no
    // element state, and a diagnostic on it would be invented data of exactly
    // the kind §7 exists to prevent.
    const result = SkippedControlSchema.safeParse({
      ...base, cause: 'target-destructive', matchedTerm: 'delete', diagnostic,
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain('never driven');
  });

  it('keeps `null` distinct from `false` on every actionability check', () => {
    // A check that could not be made — the element detached, the page went — is
    // not a check that came back negative, and collapsing the two would make
    // "we could not look" read as "it was not visible" in the distribution.
    expect(SkippedControlSchema.safeParse({
      ...base, cause: 'precondition-unmet',
      diagnostic: { ...diagnostic, visible: null, stable: null, receivesPointerEvents: null, enabled: null, inViewport: null },
    }).success).toBe(true);
    // Including `navigationPending`, which was a required boolean until rung 3
    // — a producer that does not track navigations — showed that forcing it to
    // `false` records an observation nobody made.
    expect(SkippedControlSchema.safeParse({
      ...base, cause: 'precondition-unmet',
      diagnostic: { ...diagnostic, navigationPending: null },
    }).success).toBe(true);
  });
});

describe('the JSON Schema subset is closed', () => {
  it('accepts what response inference emits', () => {
    expect(JsonSchemaNodeSchema.safeParse({
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          narrowing: { kind: 'format', format: 'uuid', matched: 12, total: 12 },
        },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
      additionalProperties: false,
    }).success).toBe(true);
  });

  it('rejects a narrowing with no evidence recorded, at any depth', () => {
    // Widening is free; narrowing is a claim. A bare `format` nested three levels
    // down must fail exactly as it does at the root — the refinement lives inside
    // the lazy object so it fires everywhere without anyone walking the tree.
    const result = JsonSchemaNodeSchema.safeParse({
      type: 'object',
      properties: {
        page: {
          type: 'object',
          properties: { items: { type: 'array', items: { type: 'string', format: 'uuid' } } },
        },
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('records no evidence');
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
      skippedControls: noControls(),
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
      skippedControls: noControls(),
    });
    expect(result.success).toBe(false); // …but not in place.
  });
});

/* ------------------------------------------------------- contexts and budget */

describe('capture contexts (decision 0004)', () => {
  const model = (overrides: Record<string, unknown> = {}): unknown => ({
    modelVersion: CAPTURE_MODEL_VERSION,
    siteId: 'northwind-supply',
    manifest: clone(manifest),
    routes: {
      [MUG]: { meta: clone(routeMeta), dom: clone(routeDom), styles: clone(routeStyles), states: clone(routeStates) },
    },
    assets: load('assets/index.json'),
    endpoints: clone(endpoints),
    flows: {},
    skippedControls: noControls(),
    stageReport: clone(report),
    ...overrides,
  });

  it('accepts a route whose context the manifest declares', () => {
    const m = model();
    (m as Record<string, unknown>)['manifest'] = clone(manifest);
    // Trim the manifest's route list to the single route we pass in.
    ((m as Record<string, Record<string, unknown>>)['manifest'])['routeIds'] = [MUG];
    ((m as Record<string, Record<string, unknown>>)['manifest'])['patterns'] = [
      { urlPattern: '/product/:id', observedUrlCount: 1, routeIds: [MUG] },
    ];
    expect(CaptureModelSchema.safeParse(m).success).toBe(true);
  });

  it('rejects a manifest whose gap count disagrees with the stage report', () => {
    // Not hypothetical: narrowing gaps were appended after the manifest was
    // built, so the manifest said 3 while the report carried 4, and nothing
    // compared them. One run, one number.
    const m = model() as Record<string, unknown>;
    const report = (m as { stageReport?: { gaps: unknown[] } }).stageReport;
    const manifest = (m as { manifest: { counts: { gaps: number } } }).manifest;
    manifest.counts.gaps = (report?.gaps.length ?? 0) + 1;
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('One run, one number');
  });

  it('rejects a route referencing a context the manifest never declared', () => {
    const m = model() as Record<string, Record<string, Record<string, Record<string, unknown>>>>;
    m['routes']![MUG]!['meta']!['contextId'] = 'anon-tablet';
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not declared in the manifest');
  });

  it('rejects a top-level route that did not render at its context viewport', () => {
    const m = model() as Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>>;
    m['routes']![MUG]!['meta']!['content']!['renderedSize'] = { width: 999, height: 800 };
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("viewport");
  });

  it('rejects a budget whose global ceiling is below its per-context cap', () => {
    const m = clone(manifest) as Record<string, Record<string, Record<string, number>>>;
    m['crawl']!['budget']!['maxRoutesTotal'] = 5;
    m['crawl']!['budget']!['maxRoutesPerContext'] = 40;
    expect(CaptureManifestSchema.safeParse(m).success).toBe(false);
  });

  it('rejects a capture that blew the per-(pattern, context) instance cap', () => {
    const m = model() as Record<string, Record<string, unknown>>;
    (m['manifest'] as Record<string, Record<string, Record<string, number>>>)['crawl']!['budget']!['maxInstancesPerPattern'] = 0;
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('over the cap of 0');
  });

  it('rejects a capture that blew the global route ceiling', () => {
    const m = model() as Record<string, Record<string, unknown>>;
    (m['manifest'] as Record<string, Record<string, Record<string, number>>>)['crawl']!['budget']!['maxRoutesTotal'] = 0;
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('global ceiling');
  });
});

describe('shared content pointers (decision 0004)', () => {
  const twoRoutes = (mutate: (anon: Record<string, unknown>, auth: Record<string, unknown>) => void = () => {}) => {
    const anon = clone(aboutAnon);
    const auth = clone(aboutAuth);
    mutate(anon, auth);
    const m = clone(manifest) as Record<string, unknown>;
    m['routeIds'] = ['about--anon-desktop--i0', 'about--auth-desktop--i0'];
    m['patterns'] = [{
      urlPattern: '/about', observedUrlCount: 1,
      routeIds: ['about--anon-desktop--i0', 'about--auth-desktop--i0'],
    }];
    return {
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest: m,
      routes: {
        'about--anon-desktop--i0': { meta: anon, dom: clone(aboutDom), styles: clone(aboutStyles), states: clone(aboutStates) },
        'about--auth-desktop--i0': { meta: auth },
      },
      assets: load('assets/index.json'),
      endpoints: clone(endpoints),
      flows: {},
      skippedControls: noControls(),
      stageReport: clone(report),
    };
  };

  it('accepts a pointer whose hash matches its canonical route', () => {
    expect(CaptureModelSchema.safeParse(twoRoutes()).success).toBe(true);
  });

  it('rejects a shared route that also stores artifacts', () => {
    const m = twoRoutes() as Record<string, Record<string, Record<string, unknown>>>;
    m['routes']!['about--auth-desktop--i0']!['dom'] = clone(aboutDom);
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must not exist');
  });

  it('rejects a captured route that is missing its artifacts', () => {
    const m = twoRoutes() as Record<string, Record<string, Record<string, unknown>>>;
    delete m['routes']!['about--anon-desktop--i0']!['styles'];
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('missing from a captured route');
  });

  it('rejects a pointer whose hash disagrees with its canonical route', () => {
    const m = twoRoutes((_anon, auth) => {
      (auth['content'] as Record<string, string>)['contentHash'] = 'f'.repeat(64);
    });
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('not actually shared');
  });

  it('rejects a pointer at a route that does not exist', () => {
    const m = twoRoutes((_anon, auth) => {
      (auth['content'] as Record<string, string>)['canonicalRouteId'] = 'ghost--anon-desktop--i0';
    });
    expect(CaptureModelSchema.safeParse(m).success).toBe(false);
  });

  it('rejects a pointer at another pointer (no chains)', () => {
    const m = twoRoutes((anon, auth) => {
      anon['content'] = {
        kind: 'shared',
        contentHash: (auth['content'] as Record<string, string>)['contentHash'],
        canonicalRouteId: 'about--auth-desktop--i0',
      };
    }) as Record<string, Record<string, Record<string, unknown>>>;
    delete m['routes']!['about--anon-desktop--i0']!['dom'];
    delete m['routes']!['about--anon-desktop--i0']!['styles'];
    delete m['routes']!['about--anon-desktop--i0']!['states'];
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('must not chain');
  });

  it('rejects a content hash that the artifacts do not actually produce', () => {
    const m = twoRoutes((anon) => {
      (anon['content'] as Record<string, string>)['contentHash'] = '0'.repeat(64);
    });
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('the artifacts hash to');
  });
});

describe('closed shadow roots are a permanent gap (§11)', () => {
  it('rejects a closed root that names no gap', () => {
    const bad = clone(routeDom);
    let touched = 0;
    const walk = (n: Record<string, unknown>): void => {
      if (n['nodeType'] !== 'element') return;
      const host = n['shadowHost'] as Record<string, unknown> | undefined;
      if (host && host['mode'] === 'closed') {
        delete host['gapId'];
        touched += 1;
      }
      (n['children'] as Record<string, unknown>[]).forEach(walk);
    };
    walk(bad['root'] as Record<string, unknown>);
    expect(touched, 'fixture no longer contains a closed shadow root').toBeGreaterThan(0);
    expect(DomDocumentSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects referenced gaps when there is no stage report at all', () => {
    // The escape hatch: stageReport is optional for a capture in progress, which
    // must not become a way to name gaps nothing will ever define.
    const m = {
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest: (() => {
        const x = clone(manifest) as Record<string, unknown>;
        x['routeIds'] = [MUG];
        x['patterns'] = [{ urlPattern: '/product/:id', observedUrlCount: 1, routeIds: [MUG] }];
        return x;
      })(),
      routes: {
        [MUG]: { meta: clone(routeMeta), dom: clone(routeDom), styles: clone(routeStyles), states: clone(routeStates) },
      },
      assets: load('assets/index.json'),
      endpoints: clone(endpoints),
      flows: {},
      skippedControls: noControls(),
      // no stageReport
    };
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('no stage report to define it');
  });

  it('rejects a gapId that the stage report never defines', () => {
    const m = {
      modelVersion: CAPTURE_MODEL_VERSION,
      siteId: 'northwind-supply',
      manifest: (() => {
        const x = clone(manifest) as Record<string, unknown>;
        x['routeIds'] = [MUG];
        x['patterns'] = [{ urlPattern: '/product/:id', observedUrlCount: 1, routeIds: [MUG] }];
        return x;
      })(),
      routes: {
        [MUG]: { meta: clone(routeMeta), dom: clone(routeDom), styles: clone(routeStyles), states: clone(routeStates) },
      },
      assets: load('assets/index.json'),
      endpoints: clone(endpoints),
      flows: {},
      skippedControls: noControls(),
      stageReport: (() => {
        const r = clone(report) as Record<string, unknown[]>;
        r['gaps'] = [];
        return r;
      })(),
    };
    const result = CaptureModelSchema.safeParse(m);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('never defines');
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

  it.each([
    [':hover', true],
    [':focus-visible', true],
    ['[aria-expanded]', true],
    ['[data-state]', true],
    // Widened deliberately: an enumerated list will always trail what sites write.
    ['[data-collapsed]', true],
    ['[aria-current]', true],
    // Values are normalized away, so a valued form is not a state selector.
    ['[data-state="open"]', false],
    // Not a state at all.
    [':nth-child(2)', false],
    ['[href]', false],
    ['.btn', false],
  ])('state selector %s -> %s', (selector, ok) => {
    const bad = clone(routeStates);
    const entries = bad['entries'] as Array<Record<string, unknown>>;
    const cssom = entries.find((e) => e['source'] === 'cssom')!;
    cssom['stateSelectors'] = [selector];
    expect(StateDeltasDocumentSchema.safeParse(bad).success).toBe(ok);
  });
});

/* -------------------------------------------------------------- SiteModel */

describe('coverage invariants gate the run (decision 0008)', () => {
  const coverage = load<Record<string, unknown>>('coverage.json');

  const modelWith = (cov: unknown, status: string): unknown => ({
    modelVersion: CAPTURE_MODEL_VERSION,
    siteId: 'northwind-supply',
    manifest: (() => {
      const x = clone(manifest) as Record<string, unknown>;
      x['routeIds'] = [MUG];
      x['patterns'] = [{ urlPattern: '/product/:id', observedUrlCount: 1, routeIds: [MUG] }];
      return x;
    })(),
    routes: {
      [MUG]: { meta: clone(routeMeta), dom: clone(routeDom), styles: clone(routeStyles), states: clone(routeStates) },
    },
    assets: load('assets/index.json'),
    endpoints: clone(endpoints),
    flows: {},
    skippedControls: noControls(),
    stageReport: { ...clone(report), status },
    coverage: cov,
  });

  it('accepts a capture whose invariants all hold', () => {
    const cov = clone(coverage) as Record<string, unknown>;
    cov['routeIds'] = [MUG];
    expect(CaptureModelSchema.safeParse(modelWith(cov, 'ok-with-gaps')).success).toBe(true);
  });

  it('forces the stage to fail when an invariant is broken', () => {
    const cov = clone(coverage) as Record<string, Array<Record<string, unknown>>>;
    (cov as Record<string, unknown>)['routeIds'] = [MUG];
    cov['invariants']![0]!['vacuous'] = false;
    cov['invariants']![0]!['holds'] = false;
    const result = CaptureModelSchema.safeParse(modelWith(cov, 'ok-with-gaps'));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("must be 'failed'");
  });

  it('accepts a broken invariant only alongside a failed stage', () => {
    const cov = clone(coverage) as Record<string, Array<Record<string, unknown>>>;
    (cov as Record<string, unknown>)['routeIds'] = [MUG];
    cov['invariants']![0]!['vacuous'] = false;
    cov['invariants']![0]!['holds'] = false;
    expect(CaptureModelSchema.safeParse(modelWith(cov, 'failed')).success).toBe(true);
  });

  it('rejects coverage that aggregates a route which was not loaded', () => {
    const cov = clone(coverage) as Record<string, unknown>;
    cov['routeIds'] = ['ghost--anon-desktop--i0'];
    const result = CaptureModelSchema.safeParse(modelWith(cov, 'ok-with-gaps'));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('was not loaded');
  });
});

describe('SiteModel is designed, and no longer the placeholder (decisions 0001, 0017)', () => {
  it('stamps its own version rather than the capture contract’s', () => {
    // The two coincide at 1.0.0 today. What is checked is that the envelope is
    // built from the SiteModel constant — see site-model.test.ts, which asserts
    // it at the source. Here: a SiteModel does not parse under a version it was
    // not stamped with.
    expect(SITE_MODEL_VERSION.length).toBeGreaterThan(0);
    expect(CAPTURE_MODEL_VERSION.length).toBeGreaterThan(0);
  });

  it('no longer accepts the reserved placeholder shape', () => {
    // Decision 0001 held the name with `{modelVersion, reserved: true}` so that
    // nothing could establish a shape by accident. That shape is now wrong, and
    // an artifact still written in it must fail rather than parse as an empty
    // model — which is what a `.optional()` on every section would have allowed.
    expect(SiteModelSchema.safeParse({ modelVersion: SITE_MODEL_VERSION, reserved: true }).success).toBe(false);
    expect(SiteModelSchema.safeParse({ modelVersion: '1.0.0', tokens: {}, components: [] }).success).toBe(false);
  });
});
