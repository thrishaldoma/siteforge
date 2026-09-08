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
    reads: ['tokens.colors', 'tokens.spacing', 'tokens.radii', 'tokens.shadows', 'tokens.fontSizes'],
  },
  {
    id: 'fonts',
    source: '§8 Frontend',
    quote: 'bundle only self-hostable, permissively licensed fonts … substitute a metric-compatible open alternative and record the swap',
    emits: 'app/fonts.ts and the GAPS entry for each substitution',
    reads: ['fonts.source', 'fonts.family', 'fonts.assetSha256', 'fonts.licence', 'fonts.substitutedWith', 'fonts.reason', 'fonts.gapId'],
  },
  {
    id: 'assets',
    source: '§8 Frontend',
    quote: 'SVGs inlined as components; raster assets copied into public/ under their content hash',
    emits: 'public/<hash>.<ext> and components/icons/*.tsx',
    reads: ['assets.emit', 'assets.sha256', 'assets.componentName', 'assets.publicPath', 'assets.originalUrls', 'assets.gapId'],
  },
  {
    id: 'components',
    source: '§8 Frontend',
    quote: 'One file per component, colocated with its story-like fixture',
    emits: 'components/<Name>.tsx plus its fixture',
    reads: ['components.componentId', 'components.name', 'components.kind', 'components.props', 'components.root'],
  },
  {
    id: 'pages',
    source: '§8 Frontend + §7.3',
    quote: 'Emit a Next.js app … Distinguish layout (shared shell, nav, footer) from page content',
    emits: 'app/<pattern>/page.tsx and app/layout.tsx',
    reads: ['layouts.layoutId', 'layouts.name', 'layouts.root', 'routes.templateId', 'routes.pathPattern', 'routes.layoutId', 'routes.content', 'routes.dataSources'],
  },
  {
    id: 'auth-redirect',
    source: '§6 Authenticated capture',
    quote: 'the clone must reproduce the redirect-to-login behavior',
    emits: 'the middleware that gates a route for an anonymous visitor',
    reads: ['routes.requiresAuth', 'routes.unauthenticatedBehavior'],
  },
  {
    id: 'store-tables',
    source: '§8 Mock backend',
    quote: 'In-memory store implementing snapshot(): State and restore(s: State): void',
    emits: 'the store: one table per entity, with its key',
    reads: ['entities.name', 'entities.key', 'entities.fields', 'entities.relations'],
  },
  {
    id: 'seed',
    source: '§8 Mock backend',
    quote: 'Seeded from seeds/<seed>.json, generated from real captured responses after scrubbing',
    emits: 'seeds/<seed>.json',
    reads: ['entities.seed'],
  },
  {
    id: 'handlers',
    source: '§8 Mock backend',
    quote: 'Implement every endpoint in endpoints.json. Mutations actually mutate the store',
    emits: 'one Fastify route handler per operation',
    reads: [
      'operations.operationId', 'operations.method', 'operations.pathPattern',
      'operations.pathParams', 'operations.queryParams', 'operations.request',
      'operations.responses', 'operations.effect',
    ],
  },
  {
    id: 'session-check',
    source: '§8 Mock backend',
    quote: 'Auth is a real (if trivially simple) session check, because agents must be able to fail at logging in',
    emits: "the session middleware, via resolveAuthForCodegen(requiresAuth)",
    reads: ['operations.requiresAuth', 'operations.authEvidence'],
  },
  {
    id: 'synthesized-endpoints',
    source: '§8 Mock backend + §7.6',
    quote: 'Where infer bound a skipped control to a URL, implement it fully against the store; the gap records that it was synthesized',
    emits: 'a handler with a synthesized response shape, and its gap',
    reads: ['operations.discovery'],
  },
  {
    id: 'determinism-ids',
    source: '§8 Determinism harness',
    quote: 'IDs from a seeded counter, never crypto.randomUUID()',
    emits: 'lib/determinism.ts and the store id allocator',
    reads: ['entities.fields'],
  },
  {
    id: 'entity-anchors',
    source: '§10 Action space',
    quote: 'data-sf-entity="product:MUG-BLUE", emitted by codegen from the mock backend’s own ids',
    emits: 'the data-sf-entity attribute on rendered entity subtrees',
    reads: ['components.root.entityAnchor'],
  },
  {
    id: 'behaviour-wiring',
    source: '§7.7 + §8',
    quote: 'Convert flows/ transitions into declarative specs: {trigger, precondition, effect}',
    emits: 'the client handler behind each control',
    reads: ['behaviours.behaviourId', 'behaviours.trigger', 'behaviours.precondition', 'behaviours.effect'],
  },
  {
    id: 'visual-gate',
    source: '§9 Visual gate',
    quote: 'Render clone route at the captured viewport, screenshot, compare',
    emits: 'the per-route comparison list',
    reads: ['routes.instances', 'sourceCapture.siteId', 'sourceCapture.contentHash'],
  },
  {
    id: 'behavioral-gate',
    source: '§9 Behavioral gate',
    quote: 'Replay every flows/*.trace.json against the clone … Assert the same network calls fired',
    emits: 'the replay plan',
    reads: ['behaviours.derivedFrom', 'behaviours.networkCalls'],
  },
  {
    id: 'site-identity',
    source: '§4 Stage contract',
    quote: 'each stage reads and writes files on disk only',
    emits: 'envs/<site-id>/',
    reads: ['siteId'],
  },
];

/**
 * Where each scored category (0015 §3) reads its claim from.
 *
 * The frozen list constrains the model, never the other way round: if a
 * category had no path here, the model would have to grow one.
 */
export const SCORED_FIELD_PATHS: Readonly<Record<GradeCategoryId, readonly ModelPath[]>> = {
  'endpoint-identity': ['operations.method', 'operations.pathPattern'],
  'path-param-arity': ['operations.pathParams'],
  'path-param-naming': ['operations.pathParams'],
  'request-field-presence': ['operations.request'],
  'response-field-presence': ['operations.responses'],
  'field-type': ['operations.responses', 'entities.fields'],
  narrowing: ['entities.fields'],
  identifier: ['entities.fields', 'entities.relations'],
  'synthesized-endpoint': ['operations.discovery'],
  auth: ['operations.requiresAuth', 'operations.authEvidence'],
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
  'modelVersion',
  'artifact',
  'scrubbed',
  'provenance.recordedAt',
  'provenance.durationMs',
  'provenance.runId',
  'provenance.externalDigests',
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
 * It would be an easy loophole, so it is narrow: each entry names the claim it
 * justifies **and the refinement that reads it**. Evidence nothing enforces is
 * not evidence, it is a field with a story attached — and it would sail through
 * the backward check while carrying exactly the kind of unread weight that
 * check exists to find.
 */
export interface EvidenceClaim {
  readonly path: ModelPath;
  readonly justifies: ModelPath;
  readonly enforcedBy: string;
}

export const EVIDENCE_REQUIRED: readonly EvidenceClaim[] = [
  {
    path: 'components.evidence',
    justifies: 'components.kind',
    enforcedBy: 'ComponentSchema: §7.2 extracts a component from a subtree seen at least 3 times',
  },
  {
    path: 'components.derivedFrom',
    justifies: 'components.evidence',
    enforcedBy: 'ComponentSchema: a component cannot claim more distinct routes than it names',
  },
];

// ---------------------------------------------------------------------------

const segments = (path: ModelPath): string[] => path.split('.').filter((s) => s.length > 0);

/**
 * Does a claim cover a leaf?
 *
 * By segment, never by string prefix: `routes.templateId` must not be covered
 * by a claim on `routes.template`. The identifier rule (§13) applies to a
 * model path exactly as it does to a URL — a grammar with a delimiter, and a
 * `startsWith` cannot see it.
 */
export function claimCovers(claim: ModelPath, leaf: ModelPath): boolean {
  const c = segments(claim);
  const l = segments(leaf);
  if (c.length > l.length) return false;
  return c.every((segment, i) => segment === l[i]);
}

type ZodLike = { _zod?: { def?: Record<string, unknown> } };

/**
 * Every leaf path in a zod schema.
 *
 * Array elements do not add a segment: `operations.effect.kind` rather than
 * `operations[].effect.kind`, because a claim is about the field, not about the
 * cardinality. Union branches contribute their leaves at the same path, which
 * is why `operations.effect.entity` appears once for six branches that have it.
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
      return recurse(def['element'], prefix);
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
  /** Claims that name a path the model does not have. */
  readonly unresolved: ReadonlyArray<{ by: string; path: ModelPath }>;
  /**
   * Claims coarse enough to cover a whole top-level section.
   *
   * `reads: ['components']` passes the backward check for every field anyone
   * ever adds under `components`, which is the realistic way this gate rots:
   * not a bogus section, a legitimate section quietly accreting fields nobody
   * consumes. A claim must therefore be a leaf itself, or name a field within a
   * section. The interior of a field it names is covered — enumerating every
   * leaf of a recursive element tree would be unmaintainable, and a rule nobody
   * can maintain is one that gets deleted.
   */
  readonly tooCoarse: ReadonlyArray<{ by: string; path: ModelPath }>;
}

/** The bidirectional gate. Both directions, one pass. */
export function assessModelCoverage(schema: unknown): ModelCoverageReport {
  const leaves = [...new Set(schemaLeafPaths(schema))].sort();
  const claims: Array<{ by: string; path: ModelPath }> = [
    ...CODEGEN_NEEDS.flatMap((need) => need.reads.map((path) => ({ by: `need:${need.id}`, path }))),
    ...GRADE_CATEGORIES.flatMap((category) =>
      (SCORED_FIELD_PATHS[category] ?? []).map((path) => ({ by: `scored:${category}`, path }))),
    ...UNCLAIMED_BY_DESIGN.map((path) => ({ by: 'envelope', path })),
    ...EVIDENCE_REQUIRED.map((claim) => ({ by: `evidence:${claim.justifies}`, path: claim.path })),
  ];
  const unresolved = claims.filter((claim) => !leaves.some((leaf) => claimCovers(claim.path, leaf)));
  const unclaimed = leaves.filter((leaf) => !claims.some((claim) => claimCovers(claim.path, leaf)));
  const leafSet = new Set(leaves);
  const tooCoarse = claims.filter(
    (claim) => segments(claim.path).length < 2 && !leafSet.has(claim.path),
  );
  return { leaves, unclaimed, unresolved, tooCoarse };
}

export type { GradeCategoryId };
