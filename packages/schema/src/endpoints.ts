/**
 * `network/endpoints.json` — the observed HTTP surface, normalized.
 *
 * §5: "method, path-pattern, params, response schema", and the key rule:
 * "Response schemas, not just responses. For each endpoint, infer a JSON Schema
 * across all observed responses. That schema becomes the mock backend's data model."
 *
 * Samples are carried alongside the schema — not instead of it — because §8 seeds
 * the mock store "from real captured responses after scrubbing", and reaching back
 * into `session.har` for that would mean seeding from an unvalidated artifact.
 *
 * Header *values* are never recorded. §3.3 keeps credentials out of every capture
 * artifact, so `headers` records presence and sensitivity only. That is enough for
 * codegen to implement §8's session check and impossible to leak a token through.
 */
import { z } from 'zod';
import {
  AbsoluteUrlSchema,
  EndpointIdSchema,
  HttpMethodSchema,
  RouteIdSchema,
  Sha256Schema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { JsonSchemaNodeSchema } from './json-schema.js';
import { GapIdSchema } from './gap.js';

export const ParamPrimitiveTypeSchema = z.enum([
  'string',
  'number',
  'integer',
  'boolean',
  'unknown',
]);

/** A path or query parameter, with the values actually observed. */
export const ParamDescriptorSchema = z.strictObject({
  name: z.string().min(1),
  type: ParamPrimitiveTypeSchema,
  required: z.boolean(),
  /** Scrubbed observed values, capped. Feeds seed generation and task instantiation. */
  examples: z.array(z.string()).max(10),
});

/**
 * A request header, by name only.
 *
 * `sensitive: true` marks headers whose value is a credential — `authorization`,
 * `cookie`, `x-csrf-token`. The value is never captured for any header, but the
 * flag tells codegen which ones its session check must actually enforce.
 */
export const HeaderDescriptorSchema = z.strictObject({
  name: z.string().min(1).toLowerCase(),
  required: z.boolean(),
  sensitive: z.boolean(),
});

/** One scrubbed response body, retained for §8 seed generation. */
export const ResponseSampleSchema = z.strictObject({
  sampleId: z.string().regex(/^sample_[0-9a-f]{8}$/, 'expected sample_<8 hex>'),
  status: z.int().min(100).max(599),
  contentType: z.string().min(1),
  /** Post-scrub. Emails, tokens, and PII are already redacted (§3.4). */
  body: z.unknown(),
  bytes: z.int().nonnegative(),
  /** The route whose page load triggered this request. */
  observedOn: RouteIdSchema,
});

export const ResponseDescriptorSchema = z.strictObject({
  status: z.int().min(100).max(599),
  contentType: z.string().min(1),
  /** Inferred across every observation of this (endpoint, status) pair. */
  schema: JsonSchemaNodeSchema.nullable(),
  observedCount: z.int().positive(),
});

export const EndpointDescriptorSchema = z
  .strictObject({
  endpointId: EndpointIdSchema,
  method: HttpMethodSchema,
  /** Normalized: `/api/products/1183` becomes `/api/products/:id`. */
  pathPattern: z.string().regex(/^\//, 'expected a path beginning with /'),
  origin: z.string().min(1),

  params: z.strictObject({
    path: z.array(ParamDescriptorSchema),
    query: z.array(ParamDescriptorSchema),
    headers: z.array(HeaderDescriptorSchema),
  }),
  requestBodySchema: JsonSchemaNodeSchema.nullable(),

  /**
   * Empty only for an endpoint that was discovered but never invoked — §6 skips
   * destructive actions, so `DELETE /api/account` can be known from a button
   * without any response ever having been observed. Enforced below: no responses
   * means a stub is mandatory.
   */
  responses: z.array(ResponseDescriptorSchema),
  samples: z.array(ResponseSampleSchema),

  /** §8: "Mutations actually mutate the store." Derived from method and observed effects. */
  isMutation: z.boolean(),
  /** Observed to 401/403 without a session. Drives §8's session check. */
  requiresAuth: z.boolean(),
  /** Requests actually seen on the wire. Zero for a discovered-but-never-invoked endpoint. */
  observedCount: z.int().nonnegative(),
  observedOn: z.array(RouteIdSchema).min(1),

  /**
   * Set when inference could not produce a usable schema. §7: "A stubbed endpoint
   * returning `501` with `X-Siteforge-Stub: true` is infinitely more useful in an
   * RL env than a plausible hallucinated one."
   */
  stub: z
    .strictObject({
      reason: z.enum(['schema-inference-failed', 'insufficient-observations', 'non-json-body']),
      gapId: GapIdSchema,
    })
    .optional(),
  })
  .superRefine((endpoint, ctx) => {
    if (endpoint.responses.length === 0 && !endpoint.stub) {
      ctx.addIssue({
        code: 'custom',
        path: ['stub'],
        message:
          'an endpoint with no observed response must be stubbed — §7: a stub is useful, a guess corrupts every trajectory that touches it',
      });
    }
    // Samples exist to seed the mock store (§8); one that does not correspond to
    // an observed response is a sample of something that never happened.
    const statuses = new Set(endpoint.responses.map((r) => r.status));
    endpoint.samples.forEach((s, i) => {
      if (!statuses.has(s.status)) {
        ctx.addIssue({
          code: 'custom',
          path: ['samples', i, 'status'],
          message: `sample claims status ${s.status}, which this endpoint never returned`,
        });
      }
    });
  });

export const EndpointIndexSchema = z.strictObject({
  ...artifactEnvelope('endpoint-index'),
  endpoints: z.array(EndpointDescriptorSchema),
  /** The raw log these were normalized from (§5: `network/session.har`). */
  har: z.strictObject({
    path: z.literal('network/session.har'),
    sha256: Sha256Schema,
    entryCount: z.int().nonnegative(),
  }),
  /** Requests to hosts outside the target origin. Recorded; never reproduced (§8). */
  thirdPartyOrigins: z.array(
    z.strictObject({
      origin: AbsoluteUrlSchema,
      requestCount: z.int().positive(),
      gapId: GapIdSchema.optional(),
    }),
  ),
});

export type ParamPrimitiveType = z.infer<typeof ParamPrimitiveTypeSchema>;
export type ParamDescriptor = z.infer<typeof ParamDescriptorSchema>;
export type HeaderDescriptor = z.infer<typeof HeaderDescriptorSchema>;
export type ResponseSample = z.infer<typeof ResponseSampleSchema>;
export type ResponseDescriptor = z.infer<typeof ResponseDescriptorSchema>;
export type EndpointDescriptor = z.infer<typeof EndpointDescriptorSchema>;
export type EndpointIndex = z.infer<typeof EndpointIndexSchema>;
