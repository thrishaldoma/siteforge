/**
 * The two forces that shaped `SiteModel`, written down so they can be checked.
 *
 * §5 says SiteModel is "derived backwards from what codegen consumes. Do not
 * define it by forward-transforming `CaptureModel`." That is a rule about how a
 * schema was written, which normally means it is a rule nothing can enforce —
 * and a rule nothing enforces is the shape this repo keeps finding at the
 * bottom of its bugs.
 *
 * So both forces are tables here, and the gate runs **in both directions**:
 *
 *   forward   every need and every scored category resolves to a path that
 *             exists in the model — nothing a consumer requires is missing;
 *   backward  every leaf in the model is claimed by some need or category —
 *             nothing is here that no consumer asked for.
 *
 * The backward direction is the one that matters. A `SiteModel` that reads as a
 * renamed `CaptureModel` passes the forward check easily: it contains
 * everything, including everything needed. It fails the backward check on its
 * first section, because nothing in §8, §9 or §10 asks for a DOM tree or a
 * computed-style table. "Infer earned nothing" stops being a judgement call and
 * becomes a failing test.
 *
 * Each need quotes the sentence that demands it. A need nobody can trace to the
 * operating manual is a need somebody invented to justify a field.
 */
import { GRADE_CATEGORIES, type GradeCategoryId } from '../grade-contract.js';

/**
 * A path into the model. `[]` is "each element of"; a union branch contributes
 * its own leaves at the same path.
 */
export type ModelPath = string;

export interface CodegenNeed {
  readonly id: string;
  /** Where in the operating manual the requirement is written. */
  readonly source: string;
  readonly quote: string;
  /** What codegen (or verify, or envkit) emits with it. */
  readonly emits: string;
  readonly reads: readonly ModelPath[];
}

/**
 * One entry per sentence that demands an input.
 *
 * Derived from §8, §9 and §10 — from what the consumers must produce, never
 * from what `CaptureModel` happens to contain. Several of these are the reason
 * a section exists at all: `store-effect` and `seed` have no counterpart in
 * capture, and writing them is what forced `StoreEffect`'s two-directional
 * field mapping.
 */
export const CODEGEN_NEEDS: readonly CodegenNeed[] = [
  {
    id: 'tailwind-theme',
    source: '§8 Frontend',
    quote: 'Tailwind configured from tokens.json. Use tokens, not arbitrary values',
    emits: 'tailwind.config.ts theme extension',
    reads: [
      'tokens.colors[].name',
      'tokens.colors[].snappedFrom[]',
      'tokens.colors[].usageCount',
      'tokens.colors[].value',
      'tokens.fontSizes[].name',
      'tokens.fontSizes[].snappedFrom[]',
      'tokens.fontSizes[].usageCount',
      'tokens.fontSizes[].value',
      'tokens.radii[].name',
      'tokens.radii[].snappedFrom[]',
      'tokens.radii[].usageCount',
      'tokens.radii[].value',
      'tokens.shadows[].name',
      'tokens.shadows[].snappedFrom[]',
      'tokens.shadows[].usageCount',
      'tokens.shadows[].value',
      'tokens.spacing[].name',
      'tokens.spacing[].snappedFrom[]',
      'tokens.spacing[].usageCount',
      'tokens.spacing[].value',
    ],
  },
  {
    id: 'fonts',
    source: '§8 Frontend',
    quote: 'bundle only self-hostable, permissively licensed fonts … substitute a metric-compatible open alternative and record the swap',
    emits: 'app/fonts.ts and the GAPS entry for each substitution',
    reads: [
      'fonts[].assetSha256',
      'fonts[].family',
      'fonts[].gapId',
      'fonts[].licence',
      'fonts[].reason',
      'fonts[].source',
      'fonts[].substitutedWith',
    ],
  },
  {
    id: 'assets',
    source: '§8 Frontend',
    quote: 'SVGs inlined as components; raster assets copied into public/ under their content hash',
    emits: 'public/<hash>.<ext> and components/icons/*.tsx',
    reads: [
      'assets[].componentName',
      'assets[].emit',
      'assets[].gapId',
      'assets[].originalUrls[]',
      'assets[].publicPath',
      'assets[].sha256',
    ],
  },
  {
    id: 'components',
    source: '§8 Frontend',
    quote: 'One file per component, colocated with its story-like fixture',
    emits: 'components/<Name>.tsx plus its fixture',
    reads: [
      'components[].componentId',
      'components[].kind',
      'components[].name',
      'components[].props[].entity',
      'components[].props[].name',
      'components[].props[].required',
      'components[].props[].type',
      'components[].root.attributes[].name',
      'components[].root.attributes[].value.entity',
      'components[].root.attributes[].value.field',
      'components[].root.attributes[].value.kind',
      'components[].root.attributes[].value.prop',
      'components[].root.attributes[].value.text',
      'components[].root.children[].componentId',
      'components[].root.children[].itemProp',
      'components[].root.children[].kind',
      'components[].root.children[].over.entity',
      'components[].root.children[].props[].name',
      'components[].root.children[].props[].value.entity',
      'components[].root.children[].props[].value.field',
      'components[].root.children[].props[].value.kind',
      'components[].root.children[].props[].value.prop',
      'components[].root.children[].props[].value.text',
      'components[].root.children[].value.entity',
      'components[].root.children[].value.field',
      'components[].root.children[].value.kind',
      'components[].root.children[].value.prop',
      'components[].root.children[].value.text',
      'components[].root.classes[]',
      'components[].root.role',
      'components[].root.stateVariants[].classes[]',
      'components[].root.stateVariants[].state',
      'components[].root.tag',
    ],
  },
  {
    id: 'pages',
    source: '§8 Frontend + §7.3',
    quote: 'Emit a Next.js app … Distinguish layout (shared shell, nav, footer) from page content',
    emits: 'app/<pattern>/page.tsx and app/layout.tsx',
    reads: [
      'layouts[].layoutId',
      'layouts[].name',
      'layouts[].root.attributes[].name',
      'layouts[].root.attributes[].value.entity',
      'layouts[].root.attributes[].value.field',
      'layouts[].root.attributes[].value.kind',
      'layouts[].root.attributes[].value.prop',
      'layouts[].root.attributes[].value.text',
      'layouts[].root.children[].componentId',
      'layouts[].root.children[].itemProp',
      'layouts[].root.children[].kind',
      'layouts[].root.children[].over.entity',
      'layouts[].root.children[].props[].name',
      'layouts[].root.children[].props[].value.entity',
      'layouts[].root.children[].props[].value.field',
      'layouts[].root.children[].props[].value.kind',
      'layouts[].root.children[].props[].value.prop',
      'layouts[].root.children[].props[].value.text',
      'layouts[].root.children[].value.entity',
      'layouts[].root.children[].value.field',
      'layouts[].root.children[].value.kind',
      'layouts[].root.children[].value.prop',
      'layouts[].root.children[].value.text',
      'layouts[].root.classes[]',
      'layouts[].root.entityAnchor.entity',
      'layouts[].root.entityAnchor.keyField',
      'layouts[].root.role',
      'layouts[].root.stateVariants[].classes[]',
      'layouts[].root.stateVariants[].state',
      'layouts[].root.tag',
      'routes[].content.componentId',
      'routes[].content.element.attributes[].name',
      'routes[].content.element.attributes[].value.entity',
      'routes[].content.element.attributes[].value.field',
      'routes[].content.element.attributes[].value.kind',
      'routes[].content.element.attributes[].value.prop',
      'routes[].content.element.attributes[].value.text',
      'routes[].content.element.classes[]',
      'routes[].content.element.entityAnchor.entity',
      'routes[].content.element.entityAnchor.keyField',
      'routes[].content.element.role',
      'routes[].content.element.stateVariants[].classes[]',
      'routes[].content.element.stateVariants[].state',
      'routes[].content.element.tag',
      'routes[].content.itemProp',
      'routes[].content.kind',
      'routes[].content.over.entity',
      'routes[].content.props[].name',
      'routes[].content.props[].value.entity',
      'routes[].content.props[].value.field',
      'routes[].content.props[].value.kind',
      'routes[].content.props[].value.prop',
      'routes[].content.props[].value.text',
      'routes[].content.value.entity',
      'routes[].content.value.field',
      'routes[].content.value.kind',
      'routes[].content.value.prop',
      'routes[].content.value.text',
      'routes[].dataSources[]',
      'routes[].layoutId',
      'routes[].pathPattern',
      'routes[].templateId',
    ],
  },
  {
    id: 'auth-redirect',
    source: '§6 Authenticated capture',
    quote: 'the clone must reproduce the redirect-to-login behavior',
    emits: 'the middleware that gates a route for an anonymous visitor',
    reads: [
      'routes[].requiresAuth',
      'routes[].unauthenticatedBehavior.kind',
      'routes[].unauthenticatedBehavior.status',
      'routes[].unauthenticatedBehavior.to',
    ],
  },
  {
    id: 'store-tables',
    source: '§8 Mock backend',
    quote: 'In-memory store implementing snapshot(): State and restore(s: State): void',
    emits: 'the store: one table per entity, with its key',
    reads: [
      'entities[].fields[].name',
      'entities[].fields[].optional',
      'entities[].fields[].type',
      'entities[].key.field',
      'entities[].key.kind',
      'entities[].name',
      'entities[].relations[].evidence',
      'entities[].relations[].field',
      'entities[].relations[].observedOverlap.distinctValues',
      'entities[].relations[].observedOverlap.matched',
      'entities[].relations[].references.entity',
      'entities[].relations[].references.field',
    ],
  },
  {
    id: 'seed',
    source: '§8 Mock backend',
    quote: 'Seeded from seeds/<seed>.json, generated from real captured responses after scrubbing',
    emits: 'seeds/<seed>.json',
    reads: [
      'entities[].seed.derivedFrom[]',
      'entities[].seed.distinctRecords',
      'entities[].seed.rows[]',
    ],
  },
  {
    id: 'handlers',
    source: '§8 Mock backend',
    quote: 'Implement every endpoint in endpoints.json. Mutations actually mutate the store',
    emits: 'one Fastify route handler per operation',
    reads: [
      'operations[].effect.credentialFields[].field',
      'operations[].effect.credentialFields[].pointer',
      'operations[].effect.entity',
      'operations[].effect.filters[].from',
      'operations[].effect.filters[].matches',
      'operations[].effect.filters[].name',
      'operations[].effect.gapId',
      'operations[].effect.generated[]',
      'operations[].effect.identityEntity',
      'operations[].effect.input[].field',
      'operations[].effect.input[].pointer',
      'operations[].effect.kind',
      'operations[].effect.pagination.kind',
      'operations[].effect.pagination.pageSize',
      'operations[].effect.pagination.params[]',
      'operations[].effect.projection[].field',
      'operations[].effect.projection[].pointer',
      'operations[].effect.rowsAt',
      'operations[].effect.select.from',
      'operations[].effect.select.matches',
      'operations[].effect.select.name',
      'operations[].effect.summary',
      'operations[].method',
      'operations[].operationId',
      'operations[].pathParams[].binds.entity',
      'operations[].pathParams[].binds.field',
      'operations[].pathParams[].name',
      'operations[].pathParams[].required',
      'operations[].pathParams[].type',
      'operations[].pathPattern',
      'operations[].queryParams[].binds.entity',
      'operations[].queryParams[].binds.field',
      'operations[].queryParams[].name',
      'operations[].queryParams[].required',
      'operations[].queryParams[].type',
      'operations[].request.additionalProperties',
      'operations[].request.const',
      'operations[].request.description',
      'operations[].request.enum[]',
      'operations[].request.examples[]',
      'operations[].request.format',
      'operations[].request.identifier.evidence[]',
      'operations[].request.identifier.pathParamOf[]',
      'operations[].request.maxItems',
      'operations[].request.minItems',
      'operations[].request.narrowing.distinctRecords',
      'operations[].request.narrowing.distinctValues',
      'operations[].request.narrowing.format',
      'operations[].request.narrowing.gapId',
      'operations[].request.narrowing.kind',
      'operations[].request.narrowing.matched',
      'operations[].request.narrowing.reviewRequired',
      'operations[].request.narrowing.total',
      'operations[].request.narrowing.uiConstraint.control',
      'operations[].request.narrowing.uiConstraint.nodeId',
      'operations[].request.narrowing.uiConstraint.optionValues[]',
      'operations[].request.narrowing.uiConstraint.routeId',
      'operations[].request.nullable',
      'operations[].request.required[]',
      'operations[].request.type',
      'operations[].request.type[]',
      'operations[].responses[].contentType',
      'operations[].responses[].schema.additionalProperties',
      'operations[].responses[].schema.const',
      'operations[].responses[].schema.description',
      'operations[].responses[].schema.enum[]',
      'operations[].responses[].schema.examples[]',
      'operations[].responses[].schema.format',
      'operations[].responses[].schema.identifier.evidence[]',
      'operations[].responses[].schema.identifier.pathParamOf[]',
      'operations[].responses[].schema.maxItems',
      'operations[].responses[].schema.minItems',
      'operations[].responses[].schema.narrowing.distinctRecords',
      'operations[].responses[].schema.narrowing.distinctValues',
      'operations[].responses[].schema.narrowing.format',
      'operations[].responses[].schema.narrowing.gapId',
      'operations[].responses[].schema.narrowing.kind',
      'operations[].responses[].schema.narrowing.matched',
      'operations[].responses[].schema.narrowing.reviewRequired',
      'operations[].responses[].schema.narrowing.total',
      'operations[].responses[].schema.narrowing.uiConstraint.control',
      'operations[].responses[].schema.narrowing.uiConstraint.nodeId',
      'operations[].responses[].schema.narrowing.uiConstraint.optionValues[]',
      'operations[].responses[].schema.narrowing.uiConstraint.routeId',
      'operations[].responses[].schema.nullable',
      'operations[].responses[].schema.required[]',
      'operations[].responses[].schema.type',
      'operations[].responses[].schema.type[]',
      'operations[].responses[].status',
    ],
  },
  {
    id: 'session-check',
    source: '§8 Mock backend',
    quote: 'Auth is a real (if trivially simple) session check, because agents must be able to fail at logging in',
    emits: "the session middleware, via resolveAuthForCodegen(requiresAuth)",
    reads: [
      'operations[].authEvidence[].absentFrom',
      'operations[].authEvidence[].contextId',
      'operations[].authEvidence[].header',
      'operations[].authEvidence[].kind',
      'operations[].authEvidence[].observedCount',
      'operations[].authEvidence[].presentIn',
      'operations[].authEvidence[].status',
      'operations[].authEvidence[].to',
      'operations[].requiresAuth',
    ],
  },
  {
    id: 'synthesized-endpoints',
    source: '§8 Mock backend + §7.6',
    quote: 'Where infer bound a skipped control to a URL, implement it fully against the store; the gap records that it was synthesized',
    emits: 'a handler with a synthesized response shape, and its gap',
    reads: [
      'operations[].discovery.controlId',
      'operations[].discovery.evidence',
      'operations[].discovery.gapId',
      'operations[].discovery.kind',
    ],
  },
  {
    id: 'determinism-ids',
    source: '§8 Determinism harness',
    quote: 'IDs from a seeded counter, never crypto.randomUUID()',
    emits: 'lib/determinism.ts and the store id allocator',
    reads: [
      'entities[].fields[].generatedBy',
    ],
  },
  {
    id: 'entity-anchors',
    source: '§10 Action space',
    quote: 'data-sf-entity="product:MUG-BLUE", emitted by codegen from the mock backend’s own ids',
    emits: 'the data-sf-entity attribute on rendered entity subtrees',
    reads: [
      'components[].root.entityAnchor.entity',
      'components[].root.entityAnchor.keyField',
    ],
  },
  {
    id: 'behaviour-wiring',
    source: '§7.7 + §8',
    quote: 'Convert flows/ transitions into declarative specs: {trigger, precondition, effect}',
    emits: 'the client handler behind each control',
    reads: [
      'behaviours[].behaviourId',
      'behaviours[].effect.componentId',
      'behaviours[].effect.entity',
      'behaviours[].effect.fields[].name',
      'behaviours[].effect.fields[].pointer',
      'behaviours[].effect.gapId',
      'behaviours[].effect.kind',
      'behaviours[].effect.operationId',
      'behaviours[].effect.state',
      'behaviours[].effect.summary',
      'behaviours[].effect.toTemplate',
      'behaviours[].precondition',
      'behaviours[].trigger.accessibleName',
      'behaviours[].trigger.componentId',
      'behaviours[].trigger.onTemplate',
      'behaviours[].trigger.role',
    ],
  },
  {
    id: 'visual-gate',
    source: '§9 Visual gate',
    quote: 'Render clone route at the captured viewport, screenshot, compare',
    emits: 'the per-route comparison list',
    reads: [
      'routes[].instances[]',
      'sourceCapture.contentHash',
      'sourceCapture.siteId',
    ],
  },
  {
    id: 'behavioral-gate',
    source: '§9 Behavioral gate',
    quote: 'Replay every flows/*.trace.json against the clone … Assert the same network calls fired',
    emits: 'the replay plan',
    reads: [
      'behaviours[].derivedFrom.flowId',
      'behaviours[].networkCalls[]',
    ],
  },
  {
    id: 'merge-review',
    source: '§7.5 Type narrowing, and the evidence it requires',
    quote:
      'Any inference that narrows a type records its evidence in the model and lands in GAPS.md as review-required',
    emits: 'the GAPS.md entry for an entity whose identity was derived rather than observed',
    reads: [
      'entities[].mergedFrom.gapId',
      'entities[].mergedFrom.kind',
      'entities[].mergedFrom.reviewRequired',
      'entities[].mergedFrom.sources[]',
    ],
  },
  {
    id: 'site-identity',
    source: '§4 Stage contract',
    quote: 'each stage reads and writes files on disk only',
    emits: 'envs/<site-id>/',
    reads: [
      'siteId',
    ],
  },
];

/**
 * Where each scored category (0015 §3) reads its claim from.
 *
 * The frozen list constrains the model, never the other way round: if a
 * category had no path here, the model would have to grow one.
 */
export const SCORED_FIELD_PATHS: Readonly<Record<GradeCategoryId, readonly ModelPath[]>> = {
  // ---- suite: inference (0023) ---------------------------------------------
  //
  // `operations[].effect.entity` is the pairing key and appears under every
  // entity category that needs one: pairing is through the matched operation and
  // never by name, so `entities[].name` is read to *report* a pair and never to
  // form one.
  'entity-identity': [
    'entities[].name',
    'entities[].key.field',
    'entities[].key.kind',
    'operations[].effect.entity',
  ],
  'entity-field-presence': [
    'entities[].fields[].name',
    'entities[].fields[].optional',
    'operations[].effect.entity',
  ],
  'entity-relation': [
    'entities[].relations[].field',
    'entities[].relations[].references.entity',
    'entities[].relations[].references.field',
    'entities[].relations[].evidence',
  ],
  'entity-narrowing': [
    'entities[].fields[].narrowing.kind',
    'entities[].fields[].narrowing.distinctValues',
    'entities[].fields[].narrowing.uiConstraint.optionValues[]',
    'operations[].effect.entity',
  ],
  // ---- suite: capture-fidelity ---------------------------------------------
  'endpoint-identity': [
    'operations[].method',
    'operations[].pathPattern',
  ],
  'path-param-arity': [
    'operations[].pathParams[].name',
  ],
  'path-param-naming': [
    'operations[].pathParams[].name',
  ],
  'request-field-presence': [
    'operations[].request.additionalProperties',
    'operations[].request.const',
    'operations[].request.description',
    'operations[].request.enum[]',
    'operations[].request.examples[]',
    'operations[].request.format',
    'operations[].request.identifier.evidence[]',
    'operations[].request.identifier.pathParamOf[]',
    'operations[].request.maxItems',
    'operations[].request.minItems',
    'operations[].request.narrowing.distinctRecords',
    'operations[].request.narrowing.distinctValues',
    'operations[].request.narrowing.format',
    'operations[].request.narrowing.gapId',
    'operations[].request.narrowing.kind',
    'operations[].request.narrowing.matched',
    'operations[].request.narrowing.reviewRequired',
    'operations[].request.narrowing.total',
    'operations[].request.narrowing.uiConstraint.control',
    'operations[].request.narrowing.uiConstraint.nodeId',
    'operations[].request.narrowing.uiConstraint.optionValues[]',
    'operations[].request.narrowing.uiConstraint.routeId',
    'operations[].request.nullable',
    'operations[].request.required[]',
    'operations[].request.type',
    'operations[].request.type[]',
  ],
  'response-field-presence': [
    'operations[].responses[].contentType',
    'operations[].responses[].schema.additionalProperties',
    'operations[].responses[].schema.const',
    'operations[].responses[].schema.description',
    'operations[].responses[].schema.enum[]',
    'operations[].responses[].schema.examples[]',
    'operations[].responses[].schema.format',
    'operations[].responses[].schema.identifier.evidence[]',
    'operations[].responses[].schema.identifier.pathParamOf[]',
    'operations[].responses[].schema.maxItems',
    'operations[].responses[].schema.minItems',
    'operations[].responses[].schema.narrowing.distinctRecords',
    'operations[].responses[].schema.narrowing.distinctValues',
    'operations[].responses[].schema.narrowing.format',
    'operations[].responses[].schema.narrowing.gapId',
    'operations[].responses[].schema.narrowing.kind',
    'operations[].responses[].schema.narrowing.matched',
    'operations[].responses[].schema.narrowing.reviewRequired',
    'operations[].responses[].schema.narrowing.total',
    'operations[].responses[].schema.narrowing.uiConstraint.control',
    'operations[].responses[].schema.narrowing.uiConstraint.nodeId',
    'operations[].responses[].schema.narrowing.uiConstraint.optionValues[]',
    'operations[].responses[].schema.narrowing.uiConstraint.routeId',
    'operations[].responses[].schema.nullable',
    'operations[].responses[].schema.required[]',
    'operations[].responses[].schema.type',
    'operations[].responses[].schema.type[]',
    'operations[].responses[].status',
  ],
  'field-type': [
    'entities[].fields[].type',
    'operations[].responses[].schema.type',
  ],
  narrowing: [
    'entities[].fields[].narrowing.distinctRecords',
    'entities[].fields[].narrowing.distinctValues',
    'entities[].fields[].narrowing.format',
    'entities[].fields[].narrowing.gapId',
    'entities[].fields[].narrowing.kind',
    'entities[].fields[].narrowing.matched',
    'entities[].fields[].narrowing.reviewRequired',
    'entities[].fields[].narrowing.total',
    'entities[].fields[].narrowing.uiConstraint.control',
    'entities[].fields[].narrowing.uiConstraint.nodeId',
    'entities[].fields[].narrowing.uiConstraint.optionValues[]',
    'entities[].fields[].narrowing.uiConstraint.routeId',
  ],
  identifier: [
    'entities[].fields[].pathParamOf[]',
    'entities[].relations[].evidence',
    'entities[].relations[].field',
    'entities[].relations[].observedOverlap.distinctValues',
    'entities[].relations[].observedOverlap.matched',
    'entities[].relations[].references.entity',
    'entities[].relations[].references.field',
  ],
  'synthesized-endpoint': [
    'operations[].discovery.controlId',
    'operations[].discovery.evidence',
    'operations[].discovery.gapId',
    'operations[].discovery.kind',
  ],
  auth: [
    'operations[].authEvidence[].absentFrom',
    'operations[].authEvidence[].contextId',
    'operations[].authEvidence[].header',
    'operations[].authEvidence[].kind',
    'operations[].authEvidence[].observedCount',
    'operations[].authEvidence[].presentIn',
    'operations[].authEvidence[].status',
    'operations[].authEvidence[].to',
    'operations[].requiresAuth',
  ],
};

/**
 * Paths exempt from the backward direction, as a complete list.
 *
 * The envelope is infrastructure every artifact carries; no consumer "needs" it
 * in the sense the table means. Named individually rather than matched by a
 * rule, because a rule wide enough to catch these is wide enough to excuse a
 * section someone did not want to justify.
 */
export const UNCLAIMED_BY_DESIGN: readonly ModelPath[] = [
  'artifact',
  'modelVersion',
  'provenance.durationMs',
  'provenance.externalDigests',
  'provenance.recordedAt',
  'provenance.runId',
  'scrubbed',
];

/**
 * The third claimant: fields that exist so the schema can refuse a value the
 * evidence does not support.
 *
 * Not a third derivation force — the two in the header are what shaped the
 * model. This is §13's standing rule, which applies to every schema in the
 * repo: "A derived field carries the evidence it was derived from, and the
 * schema rejects a value that evidence does not support."
 *
 * It would be an easy loophole, and the cheapest way to silence an unclaimed
 * leaf, so it is the narrowest of the three claimants: each entry names the
 * claim it justifies, **the file and refinement that read it**, and a test
 * opens that file and checks the refinement actually mentions the field.
 * Evidence nothing enforces is not evidence, it is a field with a story
 * attached — and a story is all `enforcedBy` would be if it stayed prose.
 */
export interface EvidenceClaim {
  readonly paths: readonly ModelPath[];
  readonly justifies: ModelPath;
  /** File under `site-model/` whose refinement reads it. Checked, not trusted. */
  readonly file: string;
  readonly schema: string;
  readonly why: string;
}

export const EVIDENCE_REQUIRED: readonly EvidenceClaim[] = [
  {
    paths: [
      'components[].evidence.distinctRoutes',
      'components[].evidence.occurrences',
      'components[].evidence.varyingLeaves',
    ],
    justifies: 'components[].kind',
    file: 'presentation.ts',
    schema: 'ComponentSchema',
    why: '§7.2 extracts a component from a subtree seen at least 3 times',
  },
  {
    paths: [
      'components[].derivedFrom.routeIds[]',
    ],
    justifies: 'components[].evidence.distinctRoutes',
    file: 'presentation.ts',
    schema: 'ComponentSchema',
    why: 'a component cannot claim more distinct routes than it names',
  },
  {
    paths: [
      'entities[].mergedFrom.narrowerFields',
      'entities[].mergedFrom.widerFields',
      'entities[].mergedFrom.sharedFields',
    ],
    justifies: 'entities[].name',
    file: 'entities.ts',
    schema: 'MergeRecordSchema',
    why:
      'decision 0025: where two observed row shapes were recorded as one entity, the identity is ' +
      'derived rather than observed, and §13 requires a derived field to carry the evidence it was ' +
      'derived from. These three are the evidence proper — containment is `sharedFields === ' +
      'narrowerFields`, and the floor is on `narrowerFields`. A merge is a narrowing of the identity ' +
      'claim and is dangerous in the same direction a wrong enum is: §5 turns this model into the ' +
      'store, so one table where the real system has two puts the wider row’s fields on rows that ' +
      'never carried them',
  },
  {
    paths: [
      'entities[].mergedFrom.keyField',
    ],
    justifies: 'entities[].key.field',
    file: 'entities.ts',
    schema: 'EntitySchema',
    why:
      'the merge says both rows keyed on this field, so an entity keying on another one is a record ' +
      'describing a different merge than the one that happened. Recomputable, therefore recomputed — ' +
      'checked in `EntitySchema` rather than in `MergeRecordSchema` because the entity’s own key is ' +
      'what it has to agree with, and the record alone cannot see it',
  },
];

/**
 * Leaves more than one claimant reads, declared.
 *
 * Silent co-claiming is how `field-type` and `narrowing` both came to read
 * `entities.fields` while the gate reported clean: two claims covering the same
 * ground, neither of them wrong, and nothing anywhere saying they overlapped. A
 * declared share is fine — a scored category and a codegen need genuinely read
 * the same field for different reasons. An **undeclared** one fails.
 *
 * The `by` set must match exactly. A third claimant appearing on a shared leaf
 * is a new fact about the model, and it has to be written down rather than
 * absorbed by an entry that already looked close enough.
 */
export interface SharedClaim {
  readonly by: readonly string[];
  readonly paths: readonly ModelPath[];
  readonly why: string;
}

export const SHARED_CLAIMS: readonly SharedClaim[] = [
  {
    by: [
      'need:store-tables',
      'scored:field-type',
    ],
    paths: [
      'entities[].fields[].type',
    ],
    why:
      'codegen types the store column from it; the grader scores whether the type is right. One field, two questions.',
  },
  {
    by: [
      'need:store-tables',
      'scored:entity-relation',
      'scored:identifier',
    ],
    paths: [
      'entities[].relations[].evidence',
      'entities[].relations[].field',
      'entities[].relations[].references.entity',
      'entities[].relations[].references.field',
    ],
    why:
      'a foreign key is the join the store needs, the identifier claim `identifier` scores off observed value overlap, and the relation claim `entity-relation` scores against the document. Three readers of one fact, and 0023 §3.2 is why the third exists separately: `identifier` asks whether the overlap was really observed, `entity-relation` asks whether the document agrees a relation is there at all.',
  },
  {
    by: [
      'need:store-tables',
      'scored:identifier',
    ],
    paths: [
      'entities[].relations[].observedOverlap.distinctValues',
      'entities[].relations[].observedOverlap.matched',
    ],
    why:
      'the overlap counts are evidence for the claim rather than the claim itself, so `entity-relation` does not read them — it scores the relation against a declaration, which has no counts in it. Split out from the entry above for exactly that reason.',
  },
  // ---- the inference suite's shares (0023) ---------------------------------
  {
    by: [
      'need:store-tables',
      'scored:entity-identity',
    ],
    paths: [
      'entities[].key.field',
      'entities[].key.kind',
      'entities[].name',
    ],
    why:
      "the store names its tables and keys its rows from these; `entity-identity` scores whether the set of tables is right. The name is read to *report* a pair and never to form one — 0023 §2 pairs through the matched operation, and the `entity-renamed` mutation holds every score still to prove it.",
  },
  {
    by: [
      'need:store-tables',
      'scored:entity-field-presence',
    ],
    paths: [
      'entities[].fields[].name',
      'entities[].fields[].optional',
    ],
    why:
      'codegen declares the store column from these; the grader scores whether the column should exist at all. One field, two questions — the same shape as the `field-type` share above it.',
  },
  {
    by: [
      'need:handlers',
      'scored:entity-field-presence',
      'scored:entity-identity',
      'scored:entity-narrowing',
    ],
    paths: [
      'operations[].effect.entity',
    ],
    why:
      "the handler needs to know which table it writes; all three entity categories need it as the *pairing key*, because 0023 §2 pairs a model entity to a declared definition through the operation rather than by name. Four readers of one field, and the three graders read it for the same reason.",
  },
  {
    by: [
      'scored:entity-narrowing',
      'scored:narrowing',
    ],
    paths: [
      'entities[].fields[].narrowing.distinctValues',
      'entities[].fields[].narrowing.kind',
      'entities[].fields[].narrowing.uiConstraint.optionValues[]',
    ],
    why:
      "one narrowing record, scored twice against different truth sides: `narrowing` compares it with what the document declares about a *response field*, `entity-narrowing` with what it declares about the *entity column* §8 builds the store from. 0023 §3.3 is why both read `distinctValues` and `uiConstraint.optionValues` — `NarrowingRecord` carries the evidence for an enum and not its value set, so agreement is presence plus cardinality except where a UI constraint supplies real values.",
  },
  {
    by: [
      'need:session-check',
      'scored:auth',
    ],
    paths: [
      'operations[].authEvidence[].absentFrom',
      'operations[].authEvidence[].contextId',
      'operations[].authEvidence[].header',
      'operations[].authEvidence[].kind',
      'operations[].authEvidence[].observedCount',
      'operations[].authEvidence[].presentIn',
      'operations[].authEvidence[].status',
      'operations[].authEvidence[].to',
      'operations[].requiresAuth',
    ],
    why:
      'codegen gates a route from the verdict; the grader scores the verdict and the evidence underneath it. 0014 is the reason the evidence is shared and not just the verdict.',
  },
  {
    by: [
      'need:synthesized-endpoints',
      'scored:synthesized-endpoint',
    ],
    paths: [
      'operations[].discovery.controlId',
      'operations[].discovery.evidence',
      'operations[].discovery.gapId',
      'operations[].discovery.kind',
    ],
    why:
      'codegen implements a bound endpoint against the store; the grader scores whether the URL was real. Same field, and the highest-hallucination-risk claim in the model.',
  },
  {
    by: [
      'need:handlers',
      'scored:endpoint-identity',
    ],
    paths: [
      'operations[].method',
      'operations[].pathPattern',
    ],
    why:
      'codegen routes on (method, path pattern) and 0015 §2 matches on the same pair. If they ever read different fields, a graded endpoint is not the endpoint that shipped.',
  },
  {
    by: [
      'need:handlers',
      'scored:path-param-arity',
      'scored:path-param-naming',
    ],
    paths: [
      'operations[].pathParams[].name',
    ],
    why:
      'one list, three readers: codegen routes on it, one metric counts the entries, the other compares the names. These two metrics cover identical leaves and do different work — which is exactly the case an undeclared share would have hidden, and the case this table exists to make visible.',
  },
  {
    by: [
      'need:handlers',
      'scored:request-field-presence',
    ],
    paths: [
      'operations[].request.additionalProperties',
      'operations[].request.const',
      'operations[].request.description',
      'operations[].request.enum[]',
      'operations[].request.examples[]',
      'operations[].request.format',
      'operations[].request.identifier.evidence[]',
      'operations[].request.identifier.pathParamOf[]',
      'operations[].request.maxItems',
      'operations[].request.minItems',
      'operations[].request.narrowing.distinctRecords',
      'operations[].request.narrowing.distinctValues',
      'operations[].request.narrowing.format',
      'operations[].request.narrowing.gapId',
      'operations[].request.narrowing.kind',
      'operations[].request.narrowing.matched',
      'operations[].request.narrowing.reviewRequired',
      'operations[].request.narrowing.total',
      'operations[].request.narrowing.uiConstraint.control',
      'operations[].request.narrowing.uiConstraint.nodeId',
      'operations[].request.narrowing.uiConstraint.optionValues[]',
      'operations[].request.narrowing.uiConstraint.routeId',
      'operations[].request.nullable',
      'operations[].request.required[]',
      'operations[].request.type',
      'operations[].request.type[]',
    ],
    why:
      'codegen validates the request body against it; the grader scores which fields infer claimed were in it.',
  },
  {
    by: [
      'need:handlers',
      'scored:response-field-presence',
    ],
    paths: [
      'operations[].responses[].contentType',
      'operations[].responses[].schema.additionalProperties',
      'operations[].responses[].schema.const',
      'operations[].responses[].schema.description',
      'operations[].responses[].schema.enum[]',
      'operations[].responses[].schema.examples[]',
      'operations[].responses[].schema.format',
      'operations[].responses[].schema.identifier.evidence[]',
      'operations[].responses[].schema.identifier.pathParamOf[]',
      'operations[].responses[].schema.maxItems',
      'operations[].responses[].schema.minItems',
      'operations[].responses[].schema.narrowing.distinctRecords',
      'operations[].responses[].schema.narrowing.distinctValues',
      'operations[].responses[].schema.narrowing.format',
      'operations[].responses[].schema.narrowing.gapId',
      'operations[].responses[].schema.narrowing.kind',
      'operations[].responses[].schema.narrowing.matched',
      'operations[].responses[].schema.narrowing.reviewRequired',
      'operations[].responses[].schema.narrowing.total',
      'operations[].responses[].schema.narrowing.uiConstraint.control',
      'operations[].responses[].schema.narrowing.uiConstraint.nodeId',
      'operations[].responses[].schema.narrowing.uiConstraint.optionValues[]',
      'operations[].responses[].schema.narrowing.uiConstraint.routeId',
      'operations[].responses[].schema.nullable',
      'operations[].responses[].schema.required[]',
      'operations[].responses[].schema.type[]',
      'operations[].responses[].status',
    ],
    why:
      'codegen shapes the response from it; the grader scores which fields infer claimed the endpoint returns.',
  },
  {
    by: [
      'need:handlers',
      'scored:field-type',
      'scored:response-field-presence',
    ],
    paths: [
      'operations[].responses[].schema.type',
    ],
    why:
      'the response schema\'s own type node: codegen builds the payload from it, one metric asks whether the field is there and the other whether its type is right.',
  },
];

// ---------------------------------------------------------------------------

const segments = (path: ModelPath): string[] => path.split('.').filter((s) => s.length > 0);

/**
 * A claim must **terminate at a schema leaf**, and reach through collections
 * element-wise: `entities[].fields[].type`, never `entities.fields`.
 *
 * The earlier rule counted segments, which is the same proxy-for-structure
 * mistake as `endsWith` on a path: two segments is not a statement about the
 * schema, it just usually corresponded to one. `entities.fields` has two
 * segments and covers twelve leaves.
 */
export const isLeafClaim = (claim: ModelPath, leaves: ReadonlySet<string>): boolean =>
  leaves.has(claim);

/** A path that names a real interior node but stops short of a leaf. */
export function isInteriorPath(claim: ModelPath, leaves: Iterable<string>): boolean {
  const prefix = `${claim}.`;
  for (const leaf of leaves) {
    if (leaf === claim) return false;
    if (leaf.slice(0, prefix.length) === prefix) return true;
    // A collection reached without saying so: `entities.fields` against
    // `entities[].fields[].type`. Worth telling apart from a typo, because the
    // fix is different — add the `[]`, not the field name.
    if (leaf.replace(/\[\]/g, '').slice(0, prefix.length) === prefix) return true;
  }
  return false;
}

type ZodLike = { _zod?: { def?: Record<string, unknown> } };

/**
 * Every leaf path in a zod schema.
 *
 * **Array elements add a `[]` segment.** `operations[].effect.kind`, never
 * `operations.effect.kind`: a claim has to say it is reaching through a
 * collection, because "the field, not the cardinality" was a convenience that
 * let a claim name a container and mean everything inside it.
 *
 * Union branches contribute their leaves at the same path, which is why
 * `operations[].effect.entity` appears once for the six branches that have it.
 */
export function schemaLeafPaths(schema: unknown, prefix = '', seen = new Set<unknown>()): string[] {
  const def = (schema as ZodLike)?._zod?.def;
  if (def === undefined) return prefix === '' ? [] : [prefix];
  if (seen.has(schema)) return [];
  const nested = new Set(seen);
  nested.add(schema);

  const type = def['type'] as string;
  const recurse = (inner: unknown, path: string): string[] => schemaLeafPaths(inner, path, nested);

  switch (type) {
    case 'object': {
      const shape = def['shape'] as Record<string, unknown>;
      return Object.entries(shape).flatMap(([key, value]) =>
        recurse(value, prefix === '' ? key : `${prefix}.${key}`));
    }
    case 'array':
      return recurse(def['element'], `${prefix}[]`);
    case 'optional':
    case 'nullable':
    case 'readonly':
    case 'default':
    case 'catch':
      return recurse(def['innerType'], prefix);
    case 'pipe':
      return recurse(def['out'] ?? def['in'], prefix);
    case 'lazy':
      return recurse((def['getter'] as () => unknown)(), prefix);
    case 'union':
      return (def['options'] as unknown[]).flatMap((option) => recurse(option, prefix));
    case 'record':
      return recurse(def['valueType'], prefix);
    default:
      return prefix === '' ? [] : [prefix];
  }
}

export interface ModelCoverageReport {
  readonly leaves: readonly string[];
  /** Leaves no need and no scored category asks for. */
  readonly unclaimed: readonly string[];
  /** Claims that name a path the model does not have at all. */
  readonly unresolved: ReadonlyArray<{ by: string; path: ModelPath }>;
  /**
   * Claims that stop at an interior node instead of a leaf.
   *
   * `reads: ['components']`, or `entities.fields` for `entities[].fields[].type`
   * — both cover every leaf underneath, which is how a section quietly accretes
   * fields nobody consumes.
   */
  readonly notALeaf: ReadonlyArray<{ by: string; path: ModelPath }>;
  /** Leaves read by more than one claimant with no entry in `SHARED_CLAIMS`. */
  readonly undeclaredShares: ReadonlyArray<{ path: ModelPath; by: readonly string[] }>;
  /** Declared shares that no longer describe a real overlap. */
  readonly staleShares: ReadonlyArray<{ path: ModelPath; declared: readonly string[]; actual: readonly string[] }>;
}

/** One reader of one path. */
export interface Claim {
  readonly by: string;
  readonly path: ModelPath;
}

/**
 * The gate, over inputs rather than over the module's own tables.
 *
 * Split out so the checks can be exercised on synthetic claim sets. A gate that
 * can only be run against the one input it passes on is a gate nobody can prove
 * fires — which is the whole of this repo's history with invariants.
 */
export function assessClaims(
  leaves: readonly string[],
  claims: readonly Claim[],
  shares: readonly SharedClaim[],
): ModelCoverageReport {
  const leafSet = new Set(leaves);
  const notALeaf = claims.filter((c) => !leafSet.has(c.path) && isInteriorPath(c.path, leaves));
  const unresolved = claims.filter((c) => !leafSet.has(c.path) && !isInteriorPath(c.path, leaves));

  const claimants = new Map<string, string[]>();
  for (const claim of claims) {
    if (!leafSet.has(claim.path)) continue;
    claimants.set(claim.path, [...(claimants.get(claim.path) ?? []), claim.by]);
  }
  const unclaimed = leaves.filter((leaf) => !claimants.has(leaf));

  const declared = new Map<string, readonly string[]>();
  for (const share of shares) {
    for (const path of share.paths) declared.set(path, [...share.by].sort());
  }
  const same = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i]);

  const undeclaredShares: Array<{ path: ModelPath; by: readonly string[] }> = [];
  for (const [path, by] of claimants) {
    if (by.length < 2) continue;
    const sorted = [...by].sort();
    if (!same(declared.get(path) ?? [], sorted)) undeclaredShares.push({ path, by: sorted });
  }
  const staleShares = [...declared]
    .map(([path, by]) => ({ path, declared: by, actual: [...(claimants.get(path) ?? [])].sort() }))
    .filter((entry) => !same(entry.declared, entry.actual));

  return { leaves: [...leaves], unclaimed, unresolved, notALeaf, undeclaredShares, staleShares };
}

/** Every claim the repo makes on the model, from the three claimant tables. */
export function modelClaims(): Claim[] {
  return [
    ...CODEGEN_NEEDS.flatMap((need) => need.reads.map((path) => ({ by: `need:${need.id}`, path }))),
    ...GRADE_CATEGORIES.flatMap((category) =>
      (SCORED_FIELD_PATHS[category] ?? []).map((path) => ({ by: `scored:${category}`, path }))),
    ...UNCLAIMED_BY_DESIGN.map((path) => ({ by: 'envelope', path })),
    ...EVIDENCE_REQUIRED.flatMap((claim) =>
      claim.paths.map((path) => ({ by: `evidence:${claim.justifies}`, path }))),
  ];
}

/** The gate: both directions, plus specificity, plus declared overlap. */
export function assessModelCoverage(schema: unknown): ModelCoverageReport {
  const leaves = [...new Set(schemaLeafPaths(schema))].sort();
  return assessClaims(leaves, modelClaims(), SHARED_CLAIMS);
}

export type { GradeCategoryId };
