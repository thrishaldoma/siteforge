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
import { z } from 'zod';
import { CAPTURE_MODEL_VERSION } from './version.js';
import { IsoTimestampSchema } from './primitives.js';

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

export type RunId = z.infer<typeof RunIdSchema>;
export type Provenance = z.infer<typeof ProvenanceSchema>;
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;
