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
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { SAFE_HTTP_METHODS, deriveEndpointId, patternParams } from './identity.js';
import { JsonSchemaNodeSchema } from './json-schema.js';
import { GapIdSchema } from './gap.js';
import { AuthEvidenceSchema, AuthRequirementSchema, resolveAuthRequirement } from './auth.js';
import { ControlIdSchema } from './controls.js';

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
   * How this endpoint came to be known.
   *
   * The stage that may write each kind is not the same, which is the whole point
   * (decision 0010). Capture only ever observes: an endpoint it never called is
   * an endpoint whose URL it never learned, because §6 refuses to fire the
   * control. Binding a skipped control to a URL means reading `<form action>` or
   * a `fetch()` literal out of the captured source, which is §7's job.
   * `EndpointIndexSchema` — the capture artifact — rejects anything but
   * `observed`, so the ownership rule is enforced rather than documented.
   */
  discovery: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('observed') }),
    z.strictObject({
      kind: z.literal('bound-from-control'),
      /** The `SkippedControl` this endpoint was recovered from. */
      controlId: ControlIdSchema,
      evidence: z.enum(['form-action', 'fetch-literal']),
      /** Carried forward from the skipped control; the behaviour is still unobserved. */
      gapId: GapIdSchema,
    }),
  ]),

  /**
   * Empty only for an endpoint that was discovered but never invoked — §6 skips
   * destructive actions, so `DELETE /api/account` can be known from a button
   * without any response ever having been observed. That endpoint can only come
   * from infer (see `discovery`); enforced below, it must carry either a stub or
   * a binding, so §7 stays unskippable either way.
   */
  responses: z.array(ResponseDescriptorSchema),
  samples: z.array(ResponseSampleSchema),

  /** §8: "Mutations actually mutate the store." Derived from method and observed effects. */
  isMutation: z.boolean(),
  /**
   * Whether the endpoint is gated. Drives §8's session check and §10's auth tasks.
   *
   * Three-valued, and derived from `authEvidence` rather than declared: rung 3
   * produced `false` for every endpoint of an app whose entire API is gated,
   * simply because the anonymous context never got far enough to be refused. See
   * `auth.ts`. Codegen resolves `unknown` with `resolveAuthForCodegen`.
   */
  requiresAuth: AuthRequirementSchema,
  /** The observations `requiresAuth` is derived from. May be empty — that is `unknown`. */
  authEvidence: z.array(AuthEvidenceSchema),
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
    const derivedAuth = resolveAuthRequirement(endpoint.authEvidence);
    if (derivedAuth !== endpoint.requiresAuth) {
      ctx.addIssue({
        code: 'custom',
        path: ['requiresAuth'],
        message:
          `claims '${endpoint.requiresAuth}' but its evidence supports '${derivedAuth}'. ` +
          'The verdict is derived from what was observed, not declared alongside it.',
      });
    }

    // An endpoint with nothing observed must name a gap by one route or the
    // other: a `stub` (codegen answers 501) or a `bound-from-control` binding
    // (codegen implements it against the store, and the gap records that the
    // response shape was synthesized rather than seen). What it may never be is
    // silent.
    // ---- derived fields carry their derivation (decision 0011) ----------------
    // A field the producer computed is recomputed here, so a value the rules do
    // not support cannot be written down. Observed fields are exempt; derived
    // ones are not.
    const derivedId = deriveEndpointId(endpoint.method, endpoint.pathPattern);
    if (endpoint.endpointId !== derivedId) {
      ctx.addIssue({
        code: 'custom',
        path: ['endpointId'],
        message: `is '${endpoint.endpointId}' but ${endpoint.method} ${endpoint.pathPattern} derives '${derivedId}'`,
      });
    }

    // One-directional: a safe method cannot mutate. The converse is not enforced
    // because a POST that only reads is a real thing (a search), and pinning it
    // both ways would make a legitimate observation unrepresentable.
    if ((SAFE_HTTP_METHODS as readonly string[]).includes(endpoint.method) && endpoint.isMutation) {
      ctx.addIssue({
        code: 'custom',
        path: ['isMutation'],
        message: `${endpoint.method} is a safe method and cannot be a mutation`,
      });
    }

    // A pattern that declares a parameter nobody observed is a normalization
    // that invented a segment. Note this checks that each declared parameter has
    // a recorded value — not that the segment *should* have been parameterized,
    // which no artifact records enough to decide.
    const declared = patternParams(endpoint.pathPattern).sort();
    const recorded = endpoint.params.path.map((p) => p.name).sort();
    if (declared.join(',') !== recorded.join(',')) {
      ctx.addIssue({
        code: 'custom',
        path: ['params', 'path'],
        message:
          `pattern declares [${declared.join(', ')}] but params.path records [${recorded.join(', ')}]`,
      });
    }

    if (endpoint.responses.length === 0 && !endpoint.stub && endpoint.discovery.kind !== 'bound-from-control') {
      ctx.addIssue({
        code: 'custom',
        path: ['stub'],
        message:
          'an endpoint with no observed response must be stubbed or bound to the control it came from — ' +
          '§7: a stub is useful, a guess corrupts every trajectory that touches it',
      });
    }
    if (endpoint.discovery.kind === 'bound-from-control' && endpoint.observedCount > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['observedCount'],
        message:
          `bound from a control §6 never fired, yet claims ${endpoint.observedCount} observations`,
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

/**
 * The capture-stage endpoint artifact.
 *
 * Everything in it was seen on the wire. An endpoint recovered by static analysis
 * is a legitimate `EndpointDescriptor` but not a legitimate *capture* output, and
 * the check below is what keeps that honest. Rung 3 found the hand-written
 * fixture claiming a shape its producing stage cannot produce — §13's schema
 * drift, caught only because a real crawl was finally run beside it.
 */
export const EndpointIndexSchema = z.strictObject({
  ...artifactEnvelope('endpoint-index'),
  endpoints: z.array(EndpointDescriptorSchema),
  /**
   * The raw log these endpoints were normalized from (§5: `network/session.har`).
   *
   * No digest here on purpose: a HAR's bytes differ on every crawl of an
   * unchanged site (timings, Playwright's per-run page/frame ids, CDN request
   * ids), so a hash in this artifact would be a volatile value living outside
   * `provenance` and would fail M1's idempotency check every run. The digest is
   * recorded in `provenance.externalDigests` instead.
   *
   * `entryCount` is kept because it is meaningful and usually stable; a site that
   * races an optional request will vary it, and that is a real diff worth seeing.
   */
  har: z.strictObject({
    path: z.literal('network/session.har'),
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
}).superRefine((index, ctx) => {
  index.endpoints.forEach((endpoint, i) => {
    if (endpoint.discovery.kind !== 'observed') {
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'discovery', 'kind'],
        message:
          `${endpoint.endpointId} was ${endpoint.discovery.kind}, which capture cannot do — ` +
          'it never fired the control, so it never learned the URL. Binding one is infer\'s job (decision 0010).',
      });
    }
    if (endpoint.observedCount === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['endpoints', i, 'observedCount'],
        message: `${endpoint.endpointId} appears in a capture artifact with no observations`,
      });
    }
  });
});

export type ParamPrimitiveType = z.infer<typeof ParamPrimitiveTypeSchema>;
export type ParamDescriptor = z.infer<typeof ParamDescriptorSchema>;
export type HeaderDescriptor = z.infer<typeof HeaderDescriptorSchema>;
export type ResponseSample = z.infer<typeof ResponseSampleSchema>;
export type ResponseDescriptor = z.infer<typeof ResponseDescriptorSchema>;
export type EndpointDescriptor = z.infer<typeof EndpointDescriptorSchema>;
export type EndpointIndex = z.infer<typeof EndpointIndexSchema>;
