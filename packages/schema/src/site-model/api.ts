/**
 * The HTTP surface as codegen has to *implement* it, not as capture saw it.
 *
 * This is the section that decides SiteModel's shape, so it is written first.
 * Everything else here — tokens, assets, fonts — is a flat list that follows
 * from §8 in ten minutes. This one does not, because it is the place where
 * capture's artifacts genuinely run out.
 *
 * `network/endpoints.json` records that `POST /api/cart/items` was sent
 * `{sku, quantity}` and answered `{id, items[], subtotal}`. §8 requires codegen
 * to produce a Fastify handler where "mutations actually mutate the store", and
 * nothing in that record says **which store rows change, or how**. The gap
 * between those two sentences is `StoreEffect`, and it is the clearest single
 * answer to what infer is for: a SiteModel that reads as a renamed
 * `CaptureModel` would carry the request and response and still leave codegen
 * unable to write the handler.
 *
 * Two directions of field mapping, and both are needed:
 *
 *   request pointer  → entity field   (`input`)      what a write does
 *   entity field     → response pointer (`projection`) what a read returns
 *
 * With only the first, codegen cannot answer a GET. With only the second, it
 * cannot service a POST. With neither it cannot seed the store either, because
 * §8 seeds "from real captured responses" and the projection is exactly the
 * lens that turns a captured body into rows.
 */
import { z } from 'zod';
import { EndpointIdSchema, HttpMethodSchema } from '../primitives.js';
import { deriveEndpointId, patternParams } from '../identity.js';
import { AuthEvidenceSchema, AuthRequirementSchema, resolveAuthRequirement } from '../auth.js';
import { JsonSchemaNodeSchema } from '../json-schema.js';
import { GapIdSchema } from '../gap.js';
import { BindingEvidenceKindSchema, ControlIdSchema } from '../controls.js';
import { EntityNameSchema, FieldNameSchema } from './entities.js';

/**
 * A pointer into a request or response *value*.
 *
 * RFC 6901 with one addition: `/[]` is an array element. `/[]/owner/login` is
 * the login of the owner of every item in a list response.
 *
 * The convention is not chosen here — it was fixed by the grader's ground-truth
 * loader before this file existed (decision 0015 §0: the scored-field list is a
 * derivation force on SiteModel, and if a scored field is awkward to represent,
 * SiteModel moves). `response-field-presence` is scored on
 * `(endpoint, status, pointer)` triples, so the model has to speak the same
 * pointer language the score is computed in. A test in `packages/verify`
 * asserts every pointer the truth loader emits parses as one of these.
 */
export const SchemaPointerSchema = z
  .string()
  .regex(/^(\/(\[\]|[^/]+))*$/, 'expected a JSON pointer, with /[] for an array element');

/** One end of the lens between a payload and the store. */
export const FieldMappingSchema = z.strictObject({
  pointer: SchemaPointerSchema,
  field: FieldNameSchema,
});

/**
 * How a handler finds the row it acts on.
 *
 * `matches` names the entity field the incoming value is compared against, and
 * it is *not* assumed to be the primary key: `/api/products/:slug` selects a
 * Product by `slug` while the store keys it by `sku`. Collapsing the two is how
 * a clone 404s on every detail page.
 */
export const RowSelectorSchema = z.strictObject({
  from: z.enum(['path-param', 'query-param', 'body', 'session']),
  name: z.string().min(1),
  matches: FieldNameSchema,
});

/** §8's mock paginates over the seed; this says how the real one did. */
export const PaginationSchema = z.strictObject({
  kind: z.enum(['page-number', 'offset-limit', 'cursor']),
  params: z.array(z.string().min(1)).min(1),
  pageSize: z.int().positive(),
});

const withProjection = {
  entity: EntityNameSchema,
  /** Where the entity payload sits in the body. `''` is the whole body. */
  rowsAt: SchemaPointerSchema,
  projection: z.array(FieldMappingSchema).min(1),
};

/**
 * What the handler does to the store.
 *
 * The unclassifiable case is `custom`, and it carries a gap rather than a
 * guess — §7's standing rule, and §13's fail-closed-by-category: for this
 * category the safe default is "codegen stubs it and the operator is told",
 * never "treat it as a create because most POSTs are".
 */
export const StoreEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('list'),
    ...withProjection,
    filters: z.array(RowSelectorSchema),
    pagination: PaginationSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal('read'), ...withProjection, select: RowSelectorSchema }),
  z.strictObject({
    kind: z.literal('create'),
    ...withProjection,
    input: z.array(FieldMappingSchema).min(1),
    /** Fields the store fills itself. §8's seeded counter reads this. */
    generated: z.array(FieldNameSchema),
  }),
  z.strictObject({
    kind: z.literal('update'),
    ...withProjection,
    select: RowSelectorSchema,
    input: z.array(FieldMappingSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('delete'),
    entity: EntityNameSchema,
    select: RowSelectorSchema,
  }),
  /**
   * §8: "Auth is a real (if trivially simple) session check, because agents must
   * be able to fail at logging in." A login is not a create — it mints a session
   * — and capture cannot tell the two apart from the wire.
   */
  z.strictObject({
    kind: z.literal('session-create'),
    identityEntity: EntityNameSchema,
    credentialFields: z.array(FieldMappingSchema).min(1),
  }),
  z.strictObject({ kind: z.literal('session-destroy') }),
  z.strictObject({
    kind: z.literal('custom'),
    gapId: GapIdSchema,
    summary: z.string().min(1),
  }),
]);

/** How the operation came to be known. §7.6's binding is the risky one. */
export const OperationDiscoverySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('observed') }),
  z.strictObject({
    kind: z.literal('bound-from-control'),
    controlId: ControlIdSchema,
    evidence: BindingEvidenceKindSchema,
    gapId: GapIdSchema,
  }),
]);

export const OperationParamSchema = z.strictObject({
  name: z.string().min(1),
  type: z.enum(['string', 'number', 'integer', 'boolean']),
  required: z.boolean(),
  /** Where this value lives in the store, when it names one. */
  binds: z.strictObject({ entity: EntityNameSchema, field: FieldNameSchema }).nullable(),
});

export const OperationResponseSchema = z.strictObject({
  status: z.int().min(100).max(599),
  contentType: z.string().min(1),
  schema: JsonSchemaNodeSchema.nullable(),
});

export const ApiOperationSchema = z
  .strictObject({
    operationId: EndpointIdSchema,
    method: HttpMethodSchema,
    pathPattern: z.string().regex(/^\//, 'expected a path beginning with /'),
    pathParams: z.array(OperationParamSchema),
    queryParams: z.array(OperationParamSchema),
    request: JsonSchemaNodeSchema.nullable(),
    responses: z.array(OperationResponseSchema),
    /**
     * Three-valued, and derived (§5). `resolveAuthForCodegen` turns `unknown`
     * into a gate; it is never read as a boolean here.
     */
    requiresAuth: AuthRequirementSchema,
    authEvidence: z.array(AuthEvidenceSchema),
    discovery: OperationDiscoverySchema,
    effect: StoreEffectSchema,
  })
  .superRefine((operation, ctx) => {
    // Same rule the capture layer enforces: a verdict the observations do not
    // support is unrepresentable, not merely discouraged.
    const derived = resolveAuthRequirement(operation.authEvidence);
    if (derived !== operation.requiresAuth) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiresAuth'],
        message: `records ${operation.requiresAuth} but the evidence supports ${derived}`,
      });
    }
    // §7.6: an endpoint bound from a control was never fired, so it has no
    // observed responses. One that has them was not bound from a control.
    if (operation.discovery.kind === 'bound-from-control' && operation.responses.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['responses'],
        message:
          'an operation bound from a skipped control was never fired, so it cannot carry an observed response. §8 synthesizes its shape from the data model and the gap records that it did.',
      });
    }
    // The id is recomputed, not trusted — §13's rule for derived fields, and
    // the reason a SiteModel operation joins to a capture endpoint without a
    // second key to keep in step.
    const derivedId = deriveEndpointId(operation.method, operation.pathPattern);
    if (derivedId !== operation.operationId) {
      ctx.addIssue({
        code: 'custom',
        path: ['operationId'],
        message: `is '${operation.operationId}' but ${operation.method} ${operation.pathPattern} derives '${derivedId}'`,
      });
    }
    // Every path parameter the pattern declares has to be one the operation
    // describes. A pattern and a parameter list that disagree is a handler
    // codegen cannot route. Parsed by `patternParams`, never by a string scan.
    const declared = patternParams(operation.pathPattern);
    const described = operation.pathParams.map((p) => p.name);
    if (declared.join(',') !== described.join(',')) {
      ctx.addIssue({
        code: 'custom',
        path: ['pathParams'],
        message: `the pattern declares [${declared.join(', ')}] but the operation describes [${described.join(', ')}]`,
      });
    }
  });

export type SchemaPointer = z.infer<typeof SchemaPointerSchema>;
export type FieldMapping = z.infer<typeof FieldMappingSchema>;
export type RowSelector = z.infer<typeof RowSelectorSchema>;
export type StoreEffect = z.infer<typeof StoreEffectSchema>;
export type OperationDiscovery = z.infer<typeof OperationDiscoverySchema>;
export type ApiOperation = z.infer<typeof ApiOperationSchema>;
