/**
 * A closed, recursive subset of JSON Schema.
 *
 * §5: "Response schemas, not just responses. For each endpoint, infer a JSON
 * Schema across all observed responses. That schema becomes the mock backend's
 * data model."
 *
 * Deliberately *not* `z.unknown()`. If the endpoint schema is unvalidated, the
 * contract between infer and codegen is only a convention, and §13 is explicit
 * that convention-level contracts between stages are what cost the most time.
 *
 * Deliberately *not* full draft-07 either. This covers exactly what response
 * inference can actually emit from observed JSON bodies. Anything outside it —
 * `$ref`, `allOf`, conditional subschemas — is not something you can infer from
 * examples, so a producer emitting one is a bug and should fail loudly here.
 */
import { z } from 'zod';
import { EndpointIdSchema, NodeIdSchema, RouteIdSchema } from './primitives.js';
import { GapIdSchema } from './gap.js';

export const JsonPrimitiveTypeSchema = z.enum([
  'object',
  'array',
  'string',
  'number',
  'integer',
  'boolean',
  'null',
]);

export type JsonPrimitiveType = z.infer<typeof JsonPrimitiveTypeSchema>;

export const JsonStringFormatSchema = z.enum([
  'date-time',
  'date',
  'time',
  'duration',
  'email',
  'uri',
  'uuid',
  'ipv4',
  'ipv6',
  'hostname',
]);

export type JsonStringFormat = z.infer<typeof JsonStringFormatSchema>;

/**
 * The minimum number of distinct records behind a cardinality-only enum.
 *
 * Below this, low cardinality is evidence of a small sample, not of a closed
 * domain. Rung 3 inferred `title: enum [4 literal todo titles]` from 23
 * observations of 4 records — n=4, wearing n=23's clothes.
 */
export const ENUM_MIN_DISTINCT_RECORDS = 20;

/**
 * The most distinct values a closed domain may have, as a fraction of records.
 *
 * A field whose values are nearly unique per record is free text or an
 * identifier. At 0.3, twenty records may carry at most six distinct values.
 */
export const ENUM_MAX_VALUE_RATIO = 0.3;

/**
 * The DOM control that constrains a field's domain.
 *
 * This is the primary evidence for an enum and the only kind that is actually
 * *ground truth*: a `<select>` with four options means the API cannot receive a
 * fifth value, no matter how thin the sampling was. We captured the UI that
 * drives the API — a field is an enum because the DOM constrains it, not because
 * we did not look at enough rows.
 */
export const UiConstraintSchema = z.strictObject({
  control: z.enum(['select', 'radio-group', 'datalist', 'checkbox-group']),
  routeId: RouteIdSchema,
  /** The `<select>` / fieldset element in that route's `dom.json`. */
  nodeId: NodeIdSchema,
  /** The values the control offers. The field's observed values must be a subset. */
  optionValues: z.array(z.string()).min(1),
});

/**
 * Why a field's type was narrowed below its observed JSON type.
 *
 * **Narrowing must be justified; widening is free.** `string` is always sound —
 * it admits every value the real API can produce. An enum is a hard constraint
 * that makes valid states of the real system unrepresentable in the clone, and
 * §5 turns this schema into the mock backend's data model, so a wrong one is
 * silent and corrupts every trajectory touching that field.
 *
 * So a narrowing carries its evidence *in the model*, and `enum`/`const`
 * additionally carry a gap id: §7's "when confidence is low, write a gap, not an
 * invention" applies to a narrowed type exactly as it applies to a fabricated
 * endpoint, and enum inference was violating it.
 */
export const NarrowingRecordSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('enum'),
      /**
       * Distinct **records**, after deduplication by entity identity — never the
       * observation count. A list endpoint polled six times is not six times the
       * evidence, and every frequency heuristic reads this field, not `total`.
       */
      distinctRecords: z.int().nonnegative(),
      distinctValues: z.int().positive(),
      /** Ground truth when present; without it the cardinality floor applies. */
      uiConstraint: UiConstraintSchema.nullable(),
      /** Always. A narrowed type is reviewed by a human or it is not trusted. */
      reviewRequired: z.literal(true),
      gapId: GapIdSchema,
    })
    .superRefine((n, ctx) => {
      if (n.uiConstraint) {
        if (n.distinctValues > n.uiConstraint.optionValues.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['distinctValues'],
            message:
              `${n.distinctValues} distinct values were observed but the control offers only ` +
              `${n.uiConstraint.optionValues.length}, so it does not constrain this field`,
          });
        }
        return;
      }
      // The operator's invariant, structural rather than advisory: no enum from
      // fewer than 20 distinct records without a UI constraint backing it.
      if (n.distinctRecords < ENUM_MIN_DISTINCT_RECORDS) {
        ctx.addIssue({
          code: 'custom',
          path: ['distinctRecords'],
          message:
            `${n.distinctRecords} distinct records is not evidence of a closed domain ` +
            `(need ${ENUM_MIN_DISTINCT_RECORDS}, or a UI constraint). Low cardinality in a ` +
            'thin sample is a small sample, not an enum.',
        });
      }
      if (n.distinctValues > n.distinctRecords * ENUM_MAX_VALUE_RATIO) {
        ctx.addIssue({
          code: 'custom',
          path: ['distinctValues'],
          message:
            `${n.distinctValues} distinct values across ${n.distinctRecords} records is a ratio of ` +
            `${(n.distinctValues / Math.max(n.distinctRecords, 1)).toFixed(2)}, over the ` +
            `${ENUM_MAX_VALUE_RATIO} ceiling — the values track the records, so this is data, not a domain`,
        });
      }
    }),
  z.strictObject({
    kind: z.literal('const'),
    distinctRecords: z.int().nonnegative(),
    uiConstraint: UiConstraintSchema.nullable(),
    reviewRequired: z.literal(true),
    gapId: GapIdSchema,
  }),
  z
    .strictObject({
      kind: z.literal('format'),
      format: JsonStringFormatSchema,
      /**
       * A format is the one cheap narrowing: it annotates a value's shape without
       * closing its domain, and it is only claimed when *every* observation
       * matched. So it records evidence but does not force a review gap.
       */
      matched: z.int().positive(),
      total: z.int().positive(),
    })
    .superRefine((n, ctx) => {
      if (n.matched !== n.total) {
        ctx.addIssue({
          code: 'custom',
          path: ['matched'],
          message: `${n.matched} of ${n.total} observations matched ${n.format}; a partial match is not a format`,
        });
      }
    }),
]);

/**
 * A field carrying entity identity rather than data.
 *
 * The counterpart to narrowing: this *widens*, telling downstream stages not to
 * constrain the field. It is also what §7.4 needs to derive relationships —
 * "`GET /api/products` returning objects with `id, title, price, categoryId`
 * plus `GET /api/categories` gives you a two-table model with a foreign key."
 * `pathParamOf` names the endpoints whose path parameters these values were
 * actually observed as, so the foreign key is read off an observation instead of
 * guessed from a field name ending in `Id`.
 *
 * Detection is by **value overlap**, not by name: `normalizePath` collapses every
 * id segment to the literal `:id`, so a name comparison would test against a
 * constant. Overlap catches `listId` pointing at `/api/lists/:id`, which no name
 * rule would.
 */
export const IdentifierRecordSchema = z.strictObject({
  pathParamOf: z.array(EndpointIdSchema),
  evidence: z
    .array(z.enum(['path-param-value-overlap', 'identifier-name', 'unique-per-record']))
    .min(1),
});

/**
 * The recursive node type is declared by hand rather than inferred, so that this
 * package's emitted `.d.ts` names a real interface instead of an unnameable
 * inferred cycle. Optional members carry an explicit `| undefined` because
 * `exactOptionalPropertyTypes` is on.
 */
export interface JsonSchemaNode {
  type: JsonPrimitiveType | JsonPrimitiveType[];
  /** Present when at least one observed instance was `null`. */
  nullable?: boolean | undefined;
  description?: string | undefined;

  /** `type: 'object'` */
  properties?: Record<string, JsonSchemaNode> | undefined;
  required?: string[] | undefined;
  additionalProperties?: boolean | JsonSchemaNode | undefined;

  /** `type: 'array'` */
  items?: JsonSchemaNode | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;

  /**
   * Emitted only with a `narrowing` record justifying it — see
   * `NarrowingRecordSchema`. Never emitted for a field carrying `identifier`.
   */
  enum?: unknown[] | undefined;
  const?: unknown | undefined;
  format?: JsonStringFormat | undefined;

  /** Why this node's type was narrowed. Required whenever it was. */
  narrowing?: NarrowingRecord | undefined;
  /** Set when the field carries entity identity. Mutually exclusive with `enum`. */
  identifier?: IdentifierRecord | undefined;

  /** Emitted when observations disagreed irreconcilably (e.g. a polymorphic list). */
  anyOf?: JsonSchemaNode[] | undefined;

  /**
   * Scrubbed sample values, for human review of the inference. Never raw — these
   * pass through the same scrubber as everything else (§3.4).
   */
  examples?: unknown[] | undefined;
}

export const JsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.lazy(() =>
  z.strictObject({
    type: z.union([JsonPrimitiveTypeSchema, z.array(JsonPrimitiveTypeSchema).min(1)]),
    nullable: z.boolean().optional(),
    description: z.string().optional(),
    properties: z.record(z.string(), JsonSchemaNodeSchema).optional(),
    required: z.array(z.string()).optional(),
    additionalProperties: z.union([z.boolean(), JsonSchemaNodeSchema]).optional(),
    items: JsonSchemaNodeSchema.optional(),
    minItems: z.int().nonnegative().optional(),
    maxItems: z.int().nonnegative().optional(),
    enum: z.array(z.unknown()).optional(),
    const: z.unknown().optional(),
    format: JsonStringFormatSchema.optional(),
    narrowing: NarrowingRecordSchema.optional(),
    identifier: IdentifierRecordSchema.optional(),
    anyOf: z.array(JsonSchemaNodeSchema).min(2).optional(),
    examples: z.array(z.unknown()).optional(),
  })
    // Inside the lazy object, so it fires at every nesting depth without anyone
    // having to walk the tree from outside and remember to recurse.
    .superRefine((node, ctx) => {
      const narrowed =
        (node.enum !== undefined && 'enum') ||
        (node.const !== undefined && 'const') ||
        (node.format !== undefined && 'format') ||
        null;
      if (narrowed && !node.narrowing) {
        ctx.addIssue({
          code: 'custom',
          path: ['narrowing'],
          message:
            `this node narrows its type with '${narrowed}' but records no evidence for it. ` +
            'Narrowing must be justified; widening is free.',
        });
      }
      if (node.narrowing && !narrowed) {
        ctx.addIssue({
          code: 'custom',
          path: ['narrowing'],
          message: `records a '${node.narrowing.kind}' narrowing but narrows nothing`,
        });
      }
      if (node.narrowing && narrowed && node.narrowing.kind !== narrowed) {
        ctx.addIssue({
          code: 'custom',
          path: ['narrowing', 'kind'],
          message: `narrows with '${narrowed}' but the evidence describes a '${node.narrowing.kind}'`,
        });
      }
      // A hard exclusion from the operator's ruling: a field whose values are
      // observed as path parameters is a key, and a key is never a closed domain.
      if (node.identifier && node.enum !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['enum'],
          message:
            'this field carries entity identity, so it is an id, not an enum — ' +
            'the value set is open by definition',
        });
      }
    }),
);

export type UiConstraint = z.infer<typeof UiConstraintSchema>;
export type NarrowingRecord = z.infer<typeof NarrowingRecordSchema>;
export type IdentifierRecord = z.infer<typeof IdentifierRecordSchema>;
