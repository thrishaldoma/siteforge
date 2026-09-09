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
import { GapIdSchema } from '../gap.js';
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

/**
 * The smallest field set a merge may be drawn from (decision 0025 §2.4).
 *
 * Four, and the reasoning is what makes it a declared threshold rather than a
 * fitted one: an identity key is shared by construction — `keyOf` finds it in
 * `IDENTITY_KEYS` — and `created`/`updated` are shared for free by nearly every
 * row of nearly every REST API. A floor of four therefore requires **at least
 * one domain field to have coincided as well**, on top of the three any two
 * rows of one API supply without meaning anything.
 *
 * Same character as `ENUM_MIN_DISTINCT_RECORDS`, and it answers the same
 * objection: §13 warns against a threshold on a count *standing in for a shape*
 * ("at least two segments" for "terminates at a schema leaf"). This count is
 * not a proxy — it is the evidence strength itself.
 *
 * It is also the smallest part of the rule. Containment alone over-merges at
 * any floor (`Project{id,title,description,created,updated}` is a subset of
 * `Task`), and what defeats that is the **uniqueness of the container**, which
 * `dedupeRows` enforces and no schema can see. This excludes the degenerate
 * case — `{id}` is a subset of everything — and nothing more.
 */
export const MERGE_MIN_SHARED_FIELDS = 4;

/**
 * Why two observed row shapes were recorded as one entity.
 *
 * A merge is a narrowing of the model's *identity* claim, and it is dangerous
 * in the same direction a wrong enum is (§7.5): the mock backend gets one table
 * where the real system has two, so the wider row's fields appear on rows that
 * never carried them — silently, on every trajectory touching either. §5 turns
 * this model into that store, which is what makes a silent one expensive.
 *
 * So it is shaped after `NarrowingRecord` deliberately: the counts travel with
 * the claim, review is mandatory, a gap is minted, and the refinement below
 * rejects a merge those counts do not support. An unjustified merge does not
 * parse.
 *
 * **Not the route, and not the declared definitions.** The route is what
 * produced the under-merge in the first place, and the definitions are the
 * grader's oracle — reading either would be fitting to the metric (0025 §1).
 * Field-set containment is the whole of the evidence, which is why the
 * unavailable rung is named in 0025 rather than quietly approximated: capture
 * discards the key values that would settle identity by observation.
 */
export const MergeRecordSchema = z
  .strictObject({
    kind: z.literal('field-set-containment'),
    /** The endpoints whose rows became this one entity. */
    sources: z.array(EndpointIdSchema).min(2),
    /** `|smaller|` — the projection's scalar field count. */
    narrowerFields: z.int().positive(),
    /** `|larger|` — the container's. */
    widerFields: z.int().positive(),
    /** `|smaller ∩ larger|`. Equal to `narrowerFields`, or it was not containment. */
    sharedFields: z.int().nonnegative(),
    /** Both rows key on it. A projection keeps the key it is addressed by. */
    keyField: FieldNameSchema,
    /** Always. A merged identity is reviewed by a human or it is not trusted. */
    reviewRequired: z.literal(true),
    gapId: GapIdSchema,
  })
  .superRefine((m, ctx) => {
    if (m.sharedFields !== m.narrowerFields) {
      ctx.addIssue({
        code: 'custom',
        path: ['sharedFields'],
        message:
          `${m.sharedFields} of the narrower row's ${m.narrowerFields} fields are shared, so it is ` +
          'not a subset. A list view is a projection of an item view — it drops fields and never ' +
          'adds one; a row carrying a field the other lacks is a different entity.',
      });
    }
    if (m.widerFields < m.narrowerFields) {
      ctx.addIssue({
        code: 'custom',
        path: ['widerFields'],
        message: `the container has ${m.widerFields} fields and the contained row has ${m.narrowerFields}`,
      });
    }
    if (m.narrowerFields < MERGE_MIN_SHARED_FIELDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['narrowerFields'],
        message:
          `${m.narrowerFields} fields is not evidence of one entity (need ${MERGE_MIN_SHARED_FIELDS}). ` +
          'An identity key plus two timestamps is what any two rows of one API share for free.',
      });
    }
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
    /**
     * Present when two observed row shapes were recorded as one entity, and
     * carrying the evidence for it (decision 0025). `null` is the ordinary
     * case: one endpoint's row, no identity claim beyond what was observed.
     */
    mergedFrom: MergeRecordSchema.nullable(),
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
    // The merge says both rows keyed on this field; if the entity keys on
    // another, the record describes a different merge than the one that
    // happened. Recomputable, therefore recomputed (§13).
    if (entity.mergedFrom && entity.mergedFrom.keyField !== entity.key.field) {
      ctx.addIssue({
        code: 'custom', path: ['mergedFrom', 'keyField'],
        message: `the merge was justified on ${entity.mergedFrom.keyField} but ${entity.name} keys on ${entity.key.field}`,
      });
    }
    // The container's field count is a claim about this entity's own fields:
    // the wider row won its properties, so the merged entity carries them.
    if (entity.mergedFrom && entity.mergedFrom.widerFields > entity.fields.length) {
      ctx.addIssue({
        code: 'custom', path: ['mergedFrom', 'widerFields'],
        message:
          `the merge claims a container of ${entity.mergedFrom.widerFields} fields but ${entity.name} ` +
          `carries ${entity.fields.length}`,
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
export type MergeRecord = z.infer<typeof MergeRecordSchema>;
export type Entity = z.infer<typeof EntitySchema>;
