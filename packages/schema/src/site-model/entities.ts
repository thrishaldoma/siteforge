/**
 * The data model §8's mock backend implements, and the rows it starts with.
 *
 * §7.4 derives entities from observed response schemas; §8 turns them into an
 * in-memory store with `snapshot()`/`restore()`; §10 keys `data-sf-entity`
 * anchors off their ids. Three consumers, and each one needs something capture
 * does not record:
 *
 *   - the store needs to know which field is the **key**, and whether it is a
 *     business key or a surrogate the store must generate;
 *   - `reset` needs the **seed rows** — §8 seeds "from real captured responses
 *     after scrubbing", and the projection that turns a captured body into rows
 *     is inference, not transcription;
 *   - §10's entity anchors need a key that is *stable and meaningful*
 *     (`product:MUG-BLUE`), which a surrogate counter id is not.
 *
 * §7.4's foreign keys come off `identifier.pathParamOf` — an observation that a
 * field's values appeared as some endpoint's path parameter — and never off a
 * name ending in `Id`. Path normalisation collapses every id segment to the
 * literal `:id`, so a name comparison tests against a constant.
 */
import { z } from 'zod';
import { EndpointIdSchema } from '../primitives.js';
import { NarrowingRecordSchema } from '../json-schema.js';

/** PascalCase, singular. `Product`, not `products` or `ProductList`. */
export const EntityNameSchema = z
  .string()
  .regex(/^[A-Z][A-Za-z0-9]*$/, 'expected a PascalCase entity name');

export const FieldNameSchema = z
  .string()
  .regex(/^[a-z][A-Za-z0-9]*$/, 'expected a camelCase field name');

export const FieldTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'timestamp',
  'json',
]);

/**
 * How the store fills a field it was not given.
 *
 * §8's determinism harness: "IDs from a seeded counter, never
 * `crypto.randomUUID()`". A field marked `counter` or `clock` is the store's to
 * produce, and marking one wrongly is a determinism failure rather than a
 * cosmetic one — which is why it is a declared enum and not an inference at
 * codegen time.
 */
export const GeneratedBySchema = z.enum(['none', 'counter', 'clock', 'seeded-random']);

export const EntityFieldSchema = z.strictObject({
  name: FieldNameSchema,
  type: FieldTypeSchema,
  optional: z.boolean(),
  generatedBy: GeneratedBySchema,
  /**
   * Present only where the type was narrowed below `string`, and it carries the
   * counts it was drawn from (§13). An unjustified enum does not parse.
   */
  narrowing: NarrowingRecordSchema.nullable(),
  /**
   * The operations whose **path parameter** this field's values were observed
   * as. The `identifier` scored category is computed from this, so it is one of
   * the fields the frozen scored-field list requires SiteModel to carry.
   */
  pathParamOf: z.array(EndpointIdSchema),
});

/**
 * A foreign key, on evidence of value overlap.
 *
 * `evidence` is deliberately not `identifier-name`: §7.5 excludes name-based
 * inference for exactly this, and a relation invented from a suffix is a join
 * the clone will fail on data the real site accepts.
 */
export const RelationSchema = z.strictObject({
  field: FieldNameSchema,
  references: z.strictObject({ entity: EntityNameSchema, field: FieldNameSchema }),
  evidence: z.enum(['path-param-value-overlap', 'value-overlap']),
  observedOverlap: z.strictObject({
    distinctValues: z.int().positive(),
    matched: z.int().nonnegative(),
  }),
});

/**
 * Rows the store begins an episode with.
 *
 * Projected out of captured responses by the owning operation's
 * `effect.projection`, deduplicated by entity identity first (§13: "a list
 * endpoint polled six times is not six times the evidence"). `derivedFrom`
 * names the operations the rows came through, so a seed nobody can trace is
 * unrepresentable.
 */
export const EntitySeedSchema = z.strictObject({
  rows: z.array(z.record(z.string(), z.unknown())),
  derivedFrom: z.array(EndpointIdSchema).min(1),
  distinctRecords: z.int().nonnegative(),
});

export const EntitySchema = z
  .strictObject({
    name: EntityNameSchema,
    /**
     * `business` — a key the site itself uses and an agent can read (`sku`).
     * `surrogate` — an opaque id the store generates.
     *
     * §10 anchors `data-sf-entity` on this, so the distinction is load-bearing:
     * an anchor keyed on a surrogate counter changes between two seeds and the
     * ref map breaks on reset.
     */
    key: z.strictObject({ field: FieldNameSchema, kind: z.enum(['business', 'surrogate']) }),
    fields: z.array(EntityFieldSchema).min(1),
    relations: z.array(RelationSchema),
    seed: EntitySeedSchema.nullable(),
  })
  .superRefine((entity, ctx) => {
    const names = new Set(entity.fields.map((f) => f.name));
    if (!names.has(entity.key.field)) {
      ctx.addIssue({ code: 'custom', path: ['key'], message: `${entity.key.field} is not a field of ${entity.name}` });
    }
    for (const [index, relation] of entity.relations.entries()) {
      if (!names.has(relation.field)) {
        ctx.addIssue({
          code: 'custom', path: ['relations', index, 'field'],
          message: `${relation.field} is not a field of ${entity.name}`,
        });
      }
    }
    // A key the store generates cannot be a business key: the whole point of
    // `business` is that the site chose the value and it survives a reset.
    const keyField = entity.fields.find((f) => f.name === entity.key.field);
    if (entity.key.kind === 'business' && keyField && keyField.generatedBy !== 'none') {
      ctx.addIssue({
        code: 'custom', path: ['key', 'kind'],
        message: `${entity.key.field} is generated by the store, so it is a surrogate key. §10's entity anchors must not be keyed on a value that changes between seeds.`,
      });
    }
    for (const [index, row] of (entity.seed?.rows ?? []).entries()) {
      if (!(entity.key.field in row)) {
        ctx.addIssue({
          code: 'custom', path: ['seed', 'rows', index],
          message: `a seed row without ${entity.key.field} cannot be addressed, anchored, or reset to`,
        });
      }
    }
  });

export type EntityName = z.infer<typeof EntityNameSchema>;
export type FieldName = z.infer<typeof FieldNameSchema>;
export type EntityField = z.infer<typeof EntityFieldSchema>;
export type Relation = z.infer<typeof RelationSchema>;
export type Entity = z.infer<typeof EntitySchema>;
