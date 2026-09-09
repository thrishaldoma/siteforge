/**
 * The mutation harness (0015 §8).
 *
 * A grader that scores everything highly is the vacuous invariant with a number
 * on it. The hand-authored baseline scores ~1.0 **by construction** — it was
 * transcribed from the ground truth — so the baseline is not evidence of
 * anything. The deltas are.
 *
 * Perturbations are applied to the grader's *arguments*, not to the working
 * tree. That is not a shortcut around 0014's "executed, not authored" rule; it
 * is what the rule looks like when the gate is a pure function. There is no
 * source to patch: the sabotaged state **is** a different argument, it is really
 * constructed, really graded, and the assertion is on the numbers that came
 * back. What `sabotage/` buys with a git patch — a defect that is run rather
 * than described — is free here.
 *
 * Four rules, each learned the expensive way:
 *
 *   - **Every row asserts on the metric it names**, never on the gate's overall
 *     verdict. `identifier` is vacuous at baseline because its truth side is not
 *     built, so the gate is already red and "the gate fails" would be satisfied
 *     by a syntax error in fourteen rows at once. §13's discriminating property.
 *   - **At least one row must hold a score still.** A grader that drops every
 *     number on any change passes a table of drops while measuring nothing —
 *     the mirror image of the vacuous invariant.
 *   - **Every mutated model must still parse.** A perturbation producing an
 *     artifact infer could never emit is the unreachable-input vacuity mode:
 *     correct behaviour on impossible input says nothing about real input.
 *   - **Every row states why a real infer reaches this state**, for the same
 *     reason `sabotage/` does.
 */
import {
  GRADE_CATEGORIES,
  GRADE_METRICS,
  SiteModelSchema,
  type GradeCategoryId,
  type SiteModel,
} from '@siteforge/schema';
import { gradeSiteModel, type GradeInput, type GradeReport, type MetricResult } from './grade.js';
import type { TruthModel } from './truth/swagger2.js';

export interface MustMove {
  readonly metric: string;
  readonly direction: 'up' | 'down' | 'toVacuous';
  /** Absolute movement required. A count metric moves in whole units. */
  readonly minimum: number;
}

export interface Mutation {
  readonly id: string;
  readonly change: string;
  /** §13: why a real infer, or a real edit, arrives at this state. */
  readonly reachable: string;
  readonly mustMove: readonly MustMove[];
  /**
   * Metrics that must come back **exactly** where they were. `'all'` is the pure
   * control: a change the grader could plausibly key on and must not.
   */
  readonly mustHold: readonly string[] | 'all';
  /**
   * The category whose truth side does not exist yet, when that is why this row
   * cannot assert anything. The harness checks the block against the truth
   * itself, so the row turns itself back on the day the truth side lands.
   */
  readonly blockedBy?: GradeCategoryId;
  /** Both sides are inputs: a mutation may perturb the model or the truth. */
  readonly apply: (input: GradeInput) => GradeInput;
  /**
   * The two empty cases are about the grader rather than about a model, and they
   * are excluded from the per-category completeness assertion — a row that names
   * "every category" would otherwise satisfy it for a category nobody perturbs.
   */
  readonly wholeSide?: true;
}

// ---------------------------------------------------------------------------
// Editing helpers. Every one deep-clones, so a mutation cannot leak into the
// baseline and turn the next row's delta into noise.
// ---------------------------------------------------------------------------

const cloneModel = (model: SiteModel): SiteModel => structuredClone(model) as SiteModel;

/** Re-parse after editing: a model infer could not emit is not a mutation. */
const legal = (model: SiteModel): SiteModel => SiteModelSchema.parse(model);

type MutableNode = {
  type?: unknown;
  properties?: Record<string, MutableNode>;
  items?: MutableNode;
  enum?: unknown[];
  format?: string;
  narrowing?: unknown;
};

/**
 * Rewrite every reference to an operation id.
 *
 * `operationId` is recomputed from `(method, pathPattern)` — §13's rule for
 * derived fields — so touching a path renames the operation, and a route's
 * `dataSources` or an entity's `pathParamOf` left naming the old id is a parse
 * error rather than a grading input. Following the rename here is what keeps a
 * path mutation a *reachable* one: infer emits a consistent model or none.
 */
function renameOperation(model: SiteModel, from: string, to: string): void {
  model.routes = model.routes.map((route) => ({
    ...route,
    dataSources: route.dataSources.map((id) => (id === from ? to : id)),
  }));
  model.entities = model.entities.map((entity) => ({
    ...entity,
    fields: entity.fields.map((field) => ({
      ...field,
      pathParamOf: field.pathParamOf.map((id) => (id === from ? to : id)),
    })),
    seed:
      entity.seed === null
        ? null
        : { ...entity.seed, derivedFrom: entity.seed.derivedFrom.map((id) => (id === from ? to : id)) },
  }));
  model.behaviours = model.behaviours.map((behaviour) => ({
    ...behaviour,
    networkCalls: behaviour.networkCalls.map((id) => (id === from ? to : id)),
    effect:
      'operationId' in behaviour.effect && behaviour.effect.operationId === from
        ? { ...behaviour.effect, operationId: to }
        : behaviour.effect,
  }));
}

function operation(model: SiteModel, id: string): SiteModel['operations'][number] {
  const found = model.operations.find((o) => o.operationId === id);
  if (found === undefined) throw new Error(`the baseline has no operation ${id}`);
  return found;
}

/** The 200/201 response schema of one operation, as a mutable tree. */
function responseSchema(model: SiteModel, id: string): MutableNode {
  const op = operation(model, id);
  const response = op.responses.find((r) => r.status === 200 || r.status === 201);
  if (response?.schema == null) throw new Error(`${id} has no success response schema`);
  return response.schema as unknown as MutableNode;
}

const itemOf = (node: MutableNode): MutableNode => (node.items ?? node) as MutableNode;

const FABRICATED_ENUM_EVIDENCE = {
  kind: 'enum' as const,
  distinctRecords: 31,
  distinctValues: 3,
  uiConstraint: null,
  reviewRequired: true as const,
  gapId: 'gap_000000000001',
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const LABELS = 'get-api-v1-repos-owner-repo-labels';
const MILESTONES = 'get-api-v1-repos-owner-repo-milestones';
const CREATE_LABEL = 'post-api-v1-repos-owner-repo-labels';

export const MUTATIONS: readonly Mutation[] = [
  {
    id: 'narrowing-widened',
    change: 'drop the enum on Milestone.state, leaving it a plain string',
    reachable:
      'the ordinary outcome of a thin crawl: §7.5 refuses an enum below 20 distinct records, so infer widens to string whenever the sample is small',
    mustMove: [{ metric: 'narrowing.recall', direction: 'down', minimum: 0.04 }],
    mustHold: ['narrowing.precision', 'field-type.accuracy', 'endpoint-identity.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const state = itemOf(responseSchema(model, MILESTONES)).properties!['state']!;
      delete state.enum;
      delete state.narrowing;
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'narrowing-fabricated',
    change: 'give Label.color an enum it does not have, with evidence that parses',
    reachable:
      'exactly what §7.5 exists to prevent and what it looked like before the floor: three distinct colours across thirty-one labels reads as a closed domain to any cardinality heuristic',
    mustMove: [{ metric: 'narrowing.precision', direction: 'down', minimum: 0.02 }],
    mustHold: ['endpoint-identity.precision', 'response-field-presence.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const color = itemOf(responseSchema(model, LABELS)).properties!['color']!;
      color.enum = ['d73a4a', 'a2eeef', 'd876e3'];
      color.narrowing = FABRICATED_ENUM_EVIDENCE;
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'endpoint-deleted',
    change: 'drop GET /api/v1/repos/:owner/:repo/topics from the model',
    reachable:
      'a crawl that never reached the page issuing it, or an inference pass that dropped an endpoint with no entity behind it',
    mustMove: [{ metric: 'endpoint-identity.recall', direction: 'down', minimum: 1 / 15 }],
    mustHold: ['endpoint-identity.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      model.operations = model.operations.filter(
        (o) => o.operationId !== 'get-api-v1-repos-owner-repo-topics',
      );
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'endpoint-hallucinated',
    change: 'add GET /api/v1/repos/:owner/:repo/stars, which the spec does not declare',
    reachable:
      '§7 calls this the cardinal sin and it is the easiest one to commit: a path assembled from a URL template in page source rather than from a request that was actually issued',
    mustMove: [{ metric: 'endpoint-identity.precision', direction: 'down', minimum: 1 / 16 }],
    mustHold: ['endpoint-identity.recall', 'synthesized-endpoint.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const template = structuredClone(operation(model, LABELS));
      model.operations = [
        ...model.operations,
        {
          ...template,
          operationId: 'get-api-v1-repos-owner-repo-stars',
          pathPattern: '/api/v1/repos/:owner/:repo/stars',
        },
      ];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'auth-opened',
    change: 'record GET /api/v1/user/emails as publicly readable, on fabricated anonymous evidence',
    reachable:
      'the 0014 failure exactly: a 401 answering a *signed-in* request misread as evidence about anonymous access, or an anonymous probe whose rejection was swallowed',
    mustMove: [{ metric: 'auth.under-gate-count', direction: 'up', minimum: 1 }],
    mustHold: ['auth.evidence-coverage', 'endpoint-identity.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, 'get-api-v1-user-emails') as {
        requiresAuth: string;
        authEvidence: unknown[];
      };
      // The verdict is derived, so the evidence has to move with it or the model
      // will not parse — and a model that does not parse tests nothing.
      op.authEvidence = [
        { kind: 'anonymous-success', status: 200, observedCount: 1, contextId: 'anon-desktop' },
      ];
      op.requiresAuth = 'not-required';
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'auth-gated-without-evidence',
    change: 'strip the anonymous-success evidence from GET /api/v1/version, leaving it `unknown`',
    reachable:
      'an anonymous re-issue that never ran, or ran and had its rejection swallowed. §8 then gates the endpoint, which is the safe direction and still wrong here',
    mustMove: [
      { metric: 'auth.over-gate-rate', direction: 'up', minimum: 0.3 },
      { metric: 'auth.evidence-coverage', direction: 'down', minimum: 0.06 },
    ],
    mustHold: ['auth.under-gate-count', 'auth.truth-coverage'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, 'get-api-v1-version') as {
        requiresAuth: string;
        authEvidence: unknown[];
      };
      op.authEvidence = [];
      op.requiresAuth = 'unknown';
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'auth-default-on-a-gated-endpoint',
    change: 'strip the 401 evidence from GET /api/v1/user/stopwatches, leaving it `unknown`',
    reachable: 'the same swallowed probe, on an endpoint the fail-closed default happens to get right',
    // The row that proves evidence coverage is a separate axis: this endpoint
    // stays gated, so the leak count does not move and neither does the
    // over-gate rate. Only the quality of the reason changed.
    mustMove: [{ metric: 'auth.evidence-coverage', direction: 'down', minimum: 0.06 }],
    mustHold: ['auth.under-gate-count', 'auth.over-gate-rate', 'auth.truth-coverage'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, 'get-api-v1-user-stopwatches') as {
        requiresAuth: string;
        authEvidence: unknown[];
      };
      op.authEvidence = [];
      op.requiresAuth = 'unknown';
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'field-type-changed',
    change: 'type Label.id as a string instead of an integer',
    reachable:
      'a JSON body where the value arrived quoted, or a default-to-string that was never narrowed — §7.5 makes string the default, so this is the direction inference errs in',
    mustMove: [{ metric: 'field-type.accuracy', direction: 'down', minimum: 0.005 }],
    mustHold: ['response-field-presence.precision', 'response-field-presence.recall'],
    apply: (input) => {
      const model = cloneModel(input.model);
      itemOf(responseSchema(model, LABELS)).properties!['id']!.type = 'string';
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'response-field-deleted',
    change: 'drop Label.url from the labels list response',
    reachable: 'a field absent from every body the crawl happened to see — an empty list has no shape at all',
    mustMove: [{ metric: 'response-field-presence.recall', direction: 'down', minimum: 0.005 }],
    mustHold: ['response-field-presence.precision', 'endpoint-identity.recall'],
    apply: (input) => {
      const model = cloneModel(input.model);
      delete itemOf(responseSchema(model, LABELS)).properties!['url'];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'response-field-fabricated',
    change: 'add Label.slug, which Gitea does not return',
    reachable:
      'a field read off a page template rather than out of a response body, which is the same mistake as a hallucinated endpoint one level down',
    mustMove: [{ metric: 'response-field-presence.precision', direction: 'down', minimum: 0.005 }],
    mustHold: ['response-field-presence.recall'],
    apply: (input) => {
      const model = cloneModel(input.model);
      itemOf(responseSchema(model, LABELS)).properties!['slug'] = { type: 'string' };
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'request-field-fabricated',
    change: 'add a `slug` field to the create-label request body',
    reachable: 'a form input that never reaches the wire, read as a body field',
    mustMove: [{ metric: 'request-field-presence.precision', direction: 'down', minimum: 0.05 }],
    mustHold: ['request-field-presence.recall', 'response-field-presence.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, CREATE_LABEL);
      (op.request as unknown as MutableNode).properties!['slug'] = { type: 'string' };
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'request-field-deleted',
    change: 'drop `is_archived` from the create-label request body',
    reachable: 'a body field no observed request happened to carry, which is the common case for optional inputs',
    mustMove: [{ metric: 'request-field-presence.recall', direction: 'down', minimum: 0.05 }],
    mustHold: ['request-field-presence.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, CREATE_LABEL);
      delete (op.request as unknown as MutableNode).properties!['is_archived'];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'path-param-dropped',
    change: 'model the labels list as /api/v1/repos/:repo/labels — one hole instead of two',
    reachable:
      'a URL normaliser that collapsed two adjacent id segments into one, which is what every path-pattern inferencer risks on `/owner/repo`',
    mustMove: [
      { metric: 'path-param-arity.accuracy', direction: 'down', minimum: 0.05 },
      // **Declared as a coupled pair**, not omitted. An arity error is by
      // construction also a shape miss — identity matches on the positional
      // shape, and a hole is part of it — so these two cannot be isolated by any
      // perturbation, on any spec. That is a property of the denominators rather
      // than of Gitea. 0016's ruling applies: coupled metrics genuinely move
      // together, and forcing exactly-one here would produce a false claim.
      { metric: 'endpoint-identity.precision', direction: 'down', minimum: 0.05 },
    ],
    mustHold: ['path-param-naming.accuracy'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, LABELS) as {
        operationId: string;
        pathPattern: string;
        pathParams: Array<{ name: string }>;
      };
      op.pathPattern = '/api/v1/repos/:repo/labels';
      op.operationId = 'get-api-v1-repos-repo-labels';
      op.pathParams = op.pathParams.filter((p) => p.name !== 'owner');
      renameOperation(model, LABELS, 'get-api-v1-repos-repo-labels');
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'synthesized-hallucinated',
    change: 'bind a control to DELETE /api/v1/repos/:owner/:repo/purge, which does not exist',
    reachable:
      '§7.6 reads a URL out of a form action for a control capture never fired. A stale action attribute, or a client-side route mistaken for an API path, produces exactly this',
    mustMove: [{ metric: 'synthesized-endpoint.precision', direction: 'down', minimum: 0.4 }],
    mustHold: ['auth.under-gate-count'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const template = structuredClone(operation(model, 'delete-api-v1-repos-owner-repo'));
      model.operations = [
        ...model.operations,
        {
          ...template,
          operationId: 'delete-api-v1-repos-owner-repo-purge',
          pathPattern: '/api/v1/repos/:owner/:repo/purge',
        },
      ];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'unprobeable-operation-added',
    change: 'add PUT /api/v1/repos/:owner/:repo/topics, a mutation the spec does declare',
    reachable:
      'the ordinary case: a crawl that reaches the repo settings page observes the topics form and infer emits the endpoint it posts to. Every mutation infer learns about lands here',
    // The row that proves the split is a split. Adding a mutation moves the
    // count and must leave the rate exactly where it was — if evidence coverage
    // moved, the two populations are still averaged and the split bought nothing.
    mustMove: [{ metric: 'auth.unprobeable-count', direction: 'up', minimum: 1 }],
    mustHold: ['auth.evidence-coverage', 'auth.under-gate-count', 'auth.over-gate-rate'],
    apply: (input) => {
      const model = cloneModel(input.model);
      const template = structuredClone(operation(model, 'get-api-v1-repos-owner-repo-topics'));
      model.operations = [
        ...model.operations,
        {
          ...template,
          operationId: 'put-api-v1-repos-owner-repo-topics',
          method: 'PUT',
          // A mutation §6 never re-issues anonymously, so nothing settles it.
          requiresAuth: 'unknown',
          authEvidence: [],
          responses: [],
        },
      ];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'identifier-mispointed',
    change: 'point Label.id.pathParamOf at the milestones endpoint instead',
    reachable:
      'value overlap between two integer id columns in the same repo, which is precisely the collision §7.5 warns the name heuristic cannot see either',
    blockedBy: 'identifier',
    mustMove: [{ metric: 'identifier.precision', direction: 'down', minimum: 0.05 }],
    mustHold: ['endpoint-identity.precision'],
    apply: (input) => {
      const model = cloneModel(input.model);
      model.entities = model.entities.map((e) =>
        e.name !== 'Label'
          ? e
          : {
              ...e,
              fields: e.fields.map((f) =>
                f.name !== 'id' ? f : { ...f, pathParamOf: ['get-api-v1-repos-owner-repo-milestones-id'] },
              ),
            },
      );
      return { ...input, model: legal(model) };
    },
  },

  // --- the controls -------------------------------------------------------
  {
    id: 'path-param-renamed',
    change: 'rename the labels endpoint parameters to :org and :project',
    reachable:
      'the normal case, not an error: capture infers a parameter name from observed values and has no way to know the document calls it `owner`',
    // §13's named example, and the row without which this whole table proves
    // nothing: a grader that drops every score on any change satisfies every
    // row above and measures none of them. Identity is scored on the positional
    // shape, so it must not notice.
    mustMove: [{ metric: 'path-param-naming.accuracy', direction: 'down', minimum: 0.05 }],
    mustHold: [
      'endpoint-identity.precision',
      'endpoint-identity.recall',
      'path-param-arity.accuracy',
      'response-field-presence.precision',
      'response-field-presence.recall',
    ],
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, LABELS) as {
        operationId: string;
        pathPattern: string;
        pathParams: Array<{ name: string }>;
      };
      op.pathPattern = '/api/v1/repos/:org/:project/labels';
      op.pathParams = [{ ...op.pathParams[0]!, name: 'org' }, { ...op.pathParams[1]!, name: 'project' }];
      // The id is derived from the pattern, so it follows. Nothing the grader
      // scores reads it — identity is the positional shape — which is exactly
      // what this row is here to demonstrate.
      op.operationId = 'get-api-v1-repos-org-project-labels';
      renameOperation(model, LABELS, 'get-api-v1-repos-org-project-labels');
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'query-param-added',
    change: 'add the `page` query parameter the labels endpoint really accepts',
    reachable:
      'infer will emit query parameters — they are in the document and on the wire. 0015 leaves them unscored for now, and this asserts that "unscored" is true rather than intended',
    mustMove: [],
    mustHold: 'all',
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, LABELS) as { queryParams: unknown[] };
      op.queryParams = [{ name: 'page', type: 'integer', required: false, binds: null }];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'out-of-universe-added',
    change: 'add POST /user/login, a web-UI route the spec never describes',
    reachable:
      "the crawl will see it: Gitea's own sign-in form posts to a path outside /api/v1, and infer emits what capture observed. 0015 counts it out-of-universe and scores it neither way, and this asserts that 'never scored' is true rather than intended — a grader that let it into the precision denominator would charge infer for a correct observation",
    mustMove: [],
    mustHold: 'all',
    apply: (input) => {
      const model = cloneModel(input.model);
      const template = structuredClone(operation(model, 'get-api-v1-version'));
      model.operations = [
        ...model.operations,
        { ...template, operationId: 'post-user-login', method: 'POST', pathPattern: '/user/login' },
      ];
      return { ...input, model: legal(model) };
    },
  },
  {
    id: 'empty-response-added',
    change: 'declare the 404 the labels endpoint returns, which carries no schema',
    reachable:
      'capture observes a 404 during the crawl and infer records the status. Gitea declares the response too, with no body — so there is nothing to compare and nothing may move',
    mustMove: [],
    mustHold: 'all',
    apply: (input) => {
      const model = cloneModel(input.model);
      const op = operation(model, LABELS) as {
        responses: Array<{ status: number; contentType: string; schema: unknown }>;
      };
      op.responses = [...op.responses, { status: 404, contentType: 'application/json', schema: null }];
      return { ...input, model: legal(model) };
    },
  },

  // --- the two that catch a bad grader rather than a bad model -------------
  {
    id: 'truth-emptied',
    change: 'grade against a ground truth with no endpoints in it',
    reachable:
      "the loader's floors stop this today, and this is the second layer that reports a bug in the first — the pattern this repo already uses for the origin check. A second ground truth (0015's open list nominates Wagtail) arrives with a loader whose floors have not been written yet",
    wholeSide: true,
    mustMove: [],
    mustHold: [],
    apply: (input) => ({
      ...input,
      truth: { ...input.truth, endpoints: [] } as TruthModel,
    }),
  },
  {
    id: 'model-emptied',
    change: 'grade a model that inferred no API at all',
    reachable:
      'the correct output for a static marketing site, which is M2\'s own visual-gate target — so the grader will genuinely be handed one of these',
    wholeSide: true,
    mustMove: [],
    mustHold: [],
    apply: (input) => {
      const model = cloneModel(input.model);
      model.operations = [];
      model.entities = [];
      model.routes = model.routes.map((r) => ({
        ...r,
        dataSources: [],
        content: {
          kind: 'element',
          element: {
            tag: 'main',
            role: null,
            classes: [],
            attributes: [],
            stateVariants: [],
            entityAnchor: null,
            children: [],
          },
        },
      }));
      return { ...input, model: legal(model) };
    },
  },
];

// ---------------------------------------------------------------------------
// Is the table itself well formed? (0015 §8's completeness assertions)
// ---------------------------------------------------------------------------

export function assessMutationTable(
  mutations: readonly Mutation[],
  categories: readonly GradeCategoryId[] = GRADE_CATEGORIES,
): string[] {
  const problems: string[] = [];
  const metricIds = new Set(GRADE_METRICS.map((m) => m.id));
  const categoryOf = new Map(GRADE_METRICS.map((m) => [m.id, m.category]));

  if (mutations.length === 0) {
    problems.push('no mutations declared — a harness that perturbs nothing reports success.');
  }
  // §13, applied to this harness as to every other: a table made only of drops
  // is satisfied by a grader that fires on any change at all.
  if (!mutations.some((m) => m.mustHold === 'all' || m.mustHold.length > 0)) {
    problems.push(
      'no control declared. Without a row that must leave a score exactly where it was, a grader\n' +
      'that drops every number on any edit passes every other row here — see §13.',
    );
  }
  for (const mutation of mutations) {
    if (mutation.reachable.length < 20) {
      problems.push(`${mutation.id}: no reachability note. Say what a real infer does to arrive here.`);
    }
    const named = [...mutation.mustMove.map((m) => m.metric), ...(mutation.mustHold === 'all' ? [] : mutation.mustHold)];
    for (const metric of named) {
      if (!metricIds.has(metric)) problems.push(`${mutation.id}: names ${metric}, which is not a contract metric.`);
    }
    if (mutation.mustMove.length === 0 && mutation.mustHold !== 'all' && mutation.wholeSide !== true) {
      problems.push(`${mutation.id}: moves nothing and holds nothing, so it asserts nothing.`);
    }
  }

  // Every scored category has a mutation that names it, and the set of named
  // categories equals the scored set exactly. The two whole-side rows are
  // excluded: they concern every category at once, and counting them would let
  // them satisfy this for a category nobody actually perturbs.
  const covered = new Set<GradeCategoryId>();
  for (const mutation of mutations) {
    if (mutation.wholeSide === true) continue;
    for (const move of mutation.mustMove) {
      const category = categoryOf.get(move.metric);
      if (category !== undefined) covered.add(category);
    }
  }
  const missing = categories.filter((c) => !covered.has(c));
  if (missing.length > 0) {
    problems.push(
      `no mutation moves ${missing.join(', ')} — a category nobody perturbs is a category nobody knows fires.`,
    );
  }
  const extra = [...covered].filter((c) => !categories.includes(c));
  if (extra.length > 0) problems.push(`the table names ${extra.join(', ')}, which is not a scored category.`);

  return problems;
}

// ---------------------------------------------------------------------------
// Running them
// ---------------------------------------------------------------------------

export interface MetricDelta {
  readonly metric: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly beforeVacuous: boolean;
  readonly afterVacuous: boolean;
}

export interface MutationResult {
  readonly mutation: Mutation;
  readonly report: GradeReport;
  readonly deltas: readonly MetricDelta[];
  /** Assertions that did not hold, in the words a reader has to act on. */
  readonly failures: readonly string[];
  readonly blocked: boolean;
}

const valueOf = (metrics: readonly MetricResult[], id: string): MetricResult => {
  const found = metrics.find((m) => m.id === id);
  if (found === undefined) throw new Error(`no metric ${id} in the report`);
  return found;
};

const show = (m: MetricResult): string => (m.vacuous ? 'vacuous' : String(m.value));

/**
 * Apply one mutation, grade, and check its declared claims.
 *
 * Nothing here reads the report's overall `passed`. Every assertion is on the
 * metric the row names, because the gate is already red at baseline — the
 * `identifier` truth side is not built — and a row asserting "the gate fails"
 * would be satisfied by any error at all.
 */
export function runMutation(baseline: GradeReport, mutation: Mutation, input: GradeInput): MutationResult {
  const report = gradeSiteModel(mutation.apply(input));
  const failures: string[] = [];
  const ungrounded = new Set(baseline.notDerived.map((n) => n.category));
  const blocked = mutation.blockedBy !== undefined && ungrounded.has(mutation.blockedBy);

  const deltas = GRADE_METRICS.map((metric) => {
    const before = valueOf(baseline.metrics, metric.id);
    const after = valueOf(report.metrics, metric.id);
    return {
      metric: metric.id,
      before: before.value,
      after: after.value,
      beforeVacuous: before.vacuous,
      afterVacuous: after.vacuous,
    };
  });

  if (mutation.wholeSide === true) {
    // §6, pinned. `TP/(TP+FP)` with no predictions is conventionally 1.0, so the
    // thing to assert is that *nothing* reports a score — not that the gate
    // failed, which it already had.
    const reporting = report.metrics.filter((m) => !m.vacuous && (m.value ?? 0) > 0);
    if (reporting.length > 0) {
      failures.push(
        `${reporting.map((m) => `${m.id}=${String(m.value)}`).join(', ')} still reports a score against an empty side. §6: a zero denominator must read vacuous, never 1.0.`,
      );
    }
    if (!report.metrics.some((m) => m.vacuous)) {
      failures.push('nothing reported vacuous, so the empty side went unnoticed entirely.');
    }
    return { mutation, report, deltas, failures, blocked };
  }

  if (blocked) return { mutation, report, deltas, failures, blocked };

  for (const claim of mutation.mustMove) {
    const before = valueOf(baseline.metrics, claim.metric);
    const after = valueOf(report.metrics, claim.metric);
    if (claim.direction === 'toVacuous') {
      if (!after.vacuous || before.vacuous) {
        failures.push(`${claim.metric} was expected to go vacuous and read ${show(after)}.`);
      }
      continue;
    }
    if (before.vacuous || after.vacuous) {
      failures.push(
        `${claim.metric} cannot show a delta: it read ${show(before)} before and ${show(after)} after.`,
      );
      continue;
    }
    const delta = (after.value ?? 0) - (before.value ?? 0);
    const moved = claim.direction === 'up' ? delta : -delta;
    if (moved < claim.minimum) {
      failures.push(
        `${claim.metric} moved ${delta.toFixed(4)} (${show(before)} → ${show(after)}), less than the ${claim.direction === 'up' ? '+' : '-'}${claim.minimum} this row declares. The grader did not notice: ${mutation.change}.`,
      );
    }
  }

  const held = mutation.mustHold === 'all' ? GRADE_METRICS.map((m) => m.id) : mutation.mustHold;
  for (const metric of held) {
    const before = valueOf(baseline.metrics, metric);
    const after = valueOf(report.metrics, metric);
    if (before.value !== after.value || before.vacuous !== after.vacuous) {
      failures.push(
        `${metric} moved from ${show(before)} to ${show(after)} on a change this row says it must not see. The grader is keyed on the edit rather than on the property, so every row that moves it proves nothing.`,
      );
    }
  }
  return { mutation, report, deltas, failures, blocked };
}

export interface HarnessResult {
  readonly baseline: GradeReport;
  readonly results: readonly MutationResult[];
  readonly tableProblems: readonly string[];
  /** Rows whose category truth side now exists, so their block must be lifted. */
  readonly staleBlocks: readonly string[];
}

export function runMutationHarness(
  input: GradeInput,
  mutations: readonly Mutation[] = MUTATIONS,
): HarnessResult {
  const baseline = gradeSiteModel(input);
  const staleBlocks = mutations
    .filter(
      (m) =>
        m.blockedBy !== undefined &&
        !baseline.notDerived.some((n) => n.category === m.blockedBy),
    )
    .map((m) => m.id);
  return {
    baseline,
    results: mutations.map((m) => runMutation(baseline, m, input)),
    tableProblems: assessMutationTable(mutations),
    staleBlocks,
  };
}
