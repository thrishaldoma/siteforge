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

  /** Emitted when the observed value set was small and closed. */
  enum?: unknown[] | undefined;
  const?: unknown | undefined;
  format?: JsonStringFormat | undefined;

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
    anyOf: z.array(JsonSchemaNodeSchema).min(2).optional(),
    examples: z.array(z.unknown()).optional(),
  }),
);
