/**
 * The common envelope every artifact file on disk carries.
 *
 * Two jobs:
 *
 * 1. **Version + kind stamping.** A file that was written by an older schema, or
 *    a file read from the wrong path, fails to parse rather than being coerced
 *    into the wrong shape.
 *
 * 2. **Stable / volatile separation.** M1 requires that "recrawl is idempotent
 *    modulo timestamps". That is only mechanically checkable if the volatile
 *    fields live in exactly one, known place. They live in `provenance`, and
 *    nowhere else — no artifact may put a timestamp, duration, or run id in its
 *    own body. The idempotency check hashes the artifact with `provenance`
 *    removed; see `VOLATILE_ARTIFACT_KEYS`.
 *
 * 3. **Scrub assertion.** §3.4 requires the scrubber to run "before any artifact
 *    is written". `scrubbed: true` is a literal, so an artifact that was never
 *    scrubbed cannot be represented in this type system at all.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CAPTURE_MODEL_VERSION } from './version.js';
import { IsoTimestampSchema, type Sha256 } from './primitives.js';

/**
 * Keys excluded from the idempotency hash. Single source of truth — the capture
 * stage's re-crawl comparison and the verify stage's determinism gate both read
 * this rather than each keeping their own list.
 */
export const VOLATILE_ARTIFACT_KEYS = ['provenance'] as const;

/** Identifies one capture run. Volatile: changes on every invocation. */
export const RunIdSchema = z
  .string()
  .regex(/^run_[0-9a-f]{16}$/, 'expected run_<16 hex>');

/** Everything about an artifact that legitimately differs between two identical crawls. */
export const ProvenanceSchema = z.strictObject({
  recordedAt: IsoTimestampSchema,
  durationMs: z.number().nonnegative().optional(),
  runId: RunIdSchema,
  /**
   * Digests of side-files this artifact names whose **bytes are unavoidably
   * volatile**, keyed by capture-relative path.
   *
   * There is exactly one such file today: `network/session.har`. A HAR embeds
   * request timings, Playwright's per-run `page@…` / `frame@…` ids, and whatever
   * per-request identifiers the origin's CDN attaches (`cf-ray`, `x-request-id`,
   * `age`, `date`). Normalising those away is unbounded vendor-by-vendor work,
   * and what survives it is just the method/URL/status list that
   * `endpoints[]` already records stably.
   *
   * So the digest is kept for integrity but lives here, where the idempotency
   * check ignores it. Found by running the M1 spike against a real page twice —
   * the fixtures could not have shown this, because a generated HAR has no clock
   * in it.
   */
  externalDigests: z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/)).optional(),
});

/** The kinds of artifact file the capture stage writes. */
export const ArtifactKindSchema = z.enum([
  'capture-manifest',
  'route-meta',
  'dom-document',
  'style-sheet',
  'state-deltas',
  'asset-index',
  'endpoint-index',
  'flow-trace',
  'stage-report',
]);

/**
 * Spread into every artifact's `z.object({...})`.
 *
 * Returned as a plain field map rather than a base schema so each artifact stays
 * a single flat `z.object` — `.extend()` chains produce declaration output that
 * is painful to read, and this package's `.d.ts` is the contract others read.
 */
export function artifactEnvelope<K extends z.infer<typeof ArtifactKindSchema>>(kind: K) {
  return {
    modelVersion: z.literal(CAPTURE_MODEL_VERSION),
    artifact: z.literal(kind),
    scrubbed: z.literal(true),
    provenance: ProvenanceSchema,
  };
}

/**
 * Deterministic JSON with keys sorted at every level.
 *
 * Two artifacts that differ only in property order must hash equal, or M1's
 * idempotency check reports a diff every time a producer reorders a field.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sha256Hex = (input: string): Sha256 => createHash('sha256').update(input, 'utf8').digest('hex');

/** Hash of an artifact with its volatile fields removed. The unit of M1's check. */
export function stableArtifactHash(artifact: object): Sha256 {
  const copy: Record<string, unknown> = { ...(artifact as Record<string, unknown>) };
  for (const key of VOLATILE_ARTIFACT_KEYS) delete copy[key];
  return sha256Hex(canonicalize(copy));
}

/**
 * Hash of what a route actually *rendered*, independent of which route directory
 * it landed in.
 *
 * `routeId` is stripped along with `provenance`, so the same page captured under
 * two contexts — the common case, since most routes are identical logged in and
 * out — produces one hash and can be stored once. See `RouteMeta.content`.
 */
export function deriveRouteContentHash(artifacts: {
  dom: object;
  styles: object;
  states: object;
}): Sha256 {
  const strip = (artifact: object): string => {
    const copy: Record<string, unknown> = { ...(artifact as Record<string, unknown>) };
    for (const key of VOLATILE_ARTIFACT_KEYS) delete copy[key];
    delete copy['routeId'];
    return canonicalize(copy);
  };
  return sha256Hex([strip(artifacts.dom), strip(artifacts.styles), strip(artifacts.states)].join('\n'));
}

export type RunId = z.infer<typeof RunIdSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
