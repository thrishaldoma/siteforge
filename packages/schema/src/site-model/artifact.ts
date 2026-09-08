/**
 * The envelope for a Stage 2 artifact.
 *
 * Separate from `artifactEnvelope` because that one pins
 * `modelVersion: CAPTURE_MODEL_VERSION`. A SiteModel written under it would
 * claim to be a capture model — the two contracts version independently, and
 * §5 calls changing either a breaking change.
 */
import { z } from 'zod';
import { ProvenanceSchema } from '../artifact.js';
import { SITE_MODEL_VERSION } from '../version.js';

/** The kinds of artifact the infer stage writes. */
export const SiteArtifactKindSchema = z.enum(['site-model']);

export function siteArtifactEnvelope<K extends z.infer<typeof SiteArtifactKindSchema>>(kind: K) {
  return {
    modelVersion: z.literal(SITE_MODEL_VERSION),
    artifact: z.literal(kind),
    /**
     * Inherited, not re-asserted lightly: SiteModel carries seed rows projected
     * out of captured response bodies (§8 seeds "from real captured responses
     * after scrubbing"), so a SiteModel built from an unscrubbed capture would
     * carry credentials into `envs/`, which is not gitignored.
     */
    scrubbed: z.literal(true),
    provenance: ProvenanceSchema,
  };
}

export type SiteArtifactKind = z.infer<typeof SiteArtifactKindSchema>;
