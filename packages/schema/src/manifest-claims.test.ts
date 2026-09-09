/**
 * Every field in `manifest.json`, and what backs it and reads it.
 *
 * `manifest.json` is the project's own claim about its outputs, and the audit
 * that produced this file found three fields that were fiction at once:
 *
 *   - **`contentHash`** — computed by three drivers, written into every
 *     manifest, and never once compared. M1's "recrawl is idempotent modulo
 *     timestamps" *was* that field, so the gate had not run.
 *   - **`determinism.frozen`** — named four globals `capture-site.mjs` froze
 *     none of.
 *   - **`determinism.prefersReducedMotion`** — asserted `reduce` on every
 *     capture while **four of six contexts did not set it**, both crawl
 *     contexts among them. §6 opens with it as a setup requirement.
 *
 * None was findable by reading the manifest: each looks exactly like the
 * working version from inside the file. So the `NarrowingRecord` shape is
 * applied to the manifest — a claim carries its evidence, and a claim nothing
 * reads is declared or deleted.
 *
 * The schema's leaf list is derived, never typed (§13's freeze rule), so a
 * field added to `CaptureManifestSchema` fails here the day it lands rather
 * than the day someone remembers.
 */
import { describe, expect, it } from 'vitest';
import { CaptureManifestSchema } from './manifest.js';
import { schemaLeafPaths } from './site-model/needs.js';
import { assessManifestClaims, type ManifestClaim } from './manifest-claims.js';

/**
 * The ledger.
 *
 * `backedBy` names what makes the claim true. `readBy` names what consumes it —
 * and where nothing does, `unreadReason` has to say why that is acceptable, in
 * the `NOT_FROZEN` style: an exemption someone wrote down is one the next
 * reader can argue with, and an absent check is not.
 */
const CLAIMS: ManifestClaim[] = [
  // ---- envelope ----------------------------------------------------------
  { path: 'modelVersion', kind: 'configured', backedBy: 'MODEL_VERSION', readBy: ['artifactEnvelope'] },
  { path: 'artifact', kind: 'configured', backedBy: 'artifactEnvelope', readBy: ['artifactEnvelope'] },
  { path: 'scrubbed', kind: 'observed', backedBy: 'scrubDeep', readBy: ['scanCaptureTree (§3.4)'] },
  {
    path: 'provenance.recordedAt', kind: 'observed', backedBy: 'the run clock',
    readBy: ['VOLATILE_ARTIFACT_KEYS', 'stableArtifactHash'],
  },
  {
    path: 'provenance.durationMs', kind: 'observed', backedBy: 'the run clock',
    readBy: ['VOLATILE_ARTIFACT_KEYS', 'stableArtifactHash'],
  },
  {
    path: 'provenance.runId', kind: 'observed', backedBy: 'the run',
    readBy: ['VOLATILE_ARTIFACT_KEYS', 'stableArtifactHash'],
  },
  {
    path: 'provenance.externalDigests', kind: 'observed', backedBy: 'PINS',
    readBy: ['snapshot.mjs staleness gate'],
  },
  { path: 'siteId', kind: 'configured', backedBy: 'the CLI argument', readBy: ['every driver', 'CaptureModelSchema'] },

  // ---- target and permission ---------------------------------------------
  { path: 'target.entryUrl', kind: 'configured', backedBy: 'the CLI argument', readBy: ['the crawl frontier'] },
  {
    path: 'target.origin', kind: 'derived', backedBy: 'originOf(entryUrl)',
    readBy: ['CaptureManifestSchema superRefine (must be in allowedOrigins)'],
  },
  { path: 'permission.source', kind: 'observed', backedBy: 'assertPermitted', readBy: ['assertPermitted'] },
  { path: 'permission.matchedEntry', kind: 'observed', backedBy: 'allowlist.txt', readBy: ['assertPermitted'] },
  { path: 'permission.flag', kind: 'observed', backedBy: 'assertPermitted', readBy: ['assertPermitted'] },
  {
    path: 'permission.assertionText', kind: 'observed', backedBy: 'the text the CLI printed',
    readBy: [],
    unreadReason:
      '§3.1 requires the artifact to carry the assertion rather than only the fact one was made. Its reader is a human auditing what was claimed, and there is no check that could substitute — a machine cannot tell a true assertion of permission from a false one.',
  },

  // ---- contexts ----------------------------------------------------------
  { path: 'contexts[].contextId', kind: 'configured', backedBy: 'CaptureContextSchema', readBy: ['RouteIdSchema', 'CaptureModelSchema'] },
  { path: 'contexts[].label', kind: 'configured', backedBy: 'the driver', readBy: ['the capture report'] },
  { path: 'contexts[].auth.mode', kind: 'observed', backedBy: 'acquireStorageState', readBy: ['deriveSessionProbePolicy'] },
  { path: 'contexts[].auth.storageStatePath', kind: 'observed', backedBy: 'storageState()', readBy: ['scanCaptureTree (§3.4 mode 0600)'] },
  { path: 'contexts[].auth.acquiredBy', kind: 'observed', backedBy: 'the login pass', readBy: ['deriveSessionProbePolicy'] },
  {
    path: 'contexts[].auth.expiresAt', kind: 'observed', backedBy: 'the session cookie',
    readBy: [],
    unreadReason:
      'a session that has expired is observed as a failed re-auth, not predicted from this field. Recorded so a stale capture can be explained after the fact; acting on it would be trusting the target\'s own clock claim.',
  },
  { path: 'contexts[].auth.credentialSource', kind: 'observed', backedBy: '§3.3 env or keychain', readBy: ['deriveSessionProbePolicy'] },
  { path: 'contexts[].viewport.width', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.viewport', readBy: ['newGuardedContext', 'the visual gate'] },
  { path: 'contexts[].viewport.height', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.viewport', readBy: ['newGuardedContext', 'the visual gate'] },
  { path: 'contexts[].viewport.deviceScaleFactor', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.viewport', readBy: ['newGuardedContext'] },
  { path: 'contexts[].viewport.isMobile', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.viewport', readBy: ['newGuardedContext'] },
  { path: 'contexts[].viewport.hasTouch', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.viewport', readBy: ['newGuardedContext'] },
  { path: 'contexts[].locale.language', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.locale', readBy: ['newGuardedContext'] },
  { path: 'contexts[].locale.timezone', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.timezoneId', readBy: ['newGuardedContext'] },
  {
    path: 'contexts[].variant.experiment', kind: 'observed', backedBy: '§11 A/B pinning',
    readBy: [], unreadReason: '§11 requires recording that a variant was pinned; no driver pins one yet, so the field is present and null on every capture this repository produces.',
  },
  {
    path: 'contexts[].variant.variant', kind: 'observed', backedBy: '§11 A/B pinning',
    readBy: [], unreadReason: 'as above — the other half of the same unrealised record.',
  },
  {
    path: 'contexts[].variant.pinnedBy', kind: 'observed', backedBy: '§11 A/B pinning',
    readBy: [], unreadReason: 'as above.',
  },
  {
    path: 'contexts[].variant.bestEffort', kind: 'observed', backedBy: '§11 A/B pinning',
    readBy: [], unreadReason: 'as above.',
  },

  // ---- determinism: the two that were fiction ----------------------------
  { path: 'userAgent', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.userAgent', readBy: ['newGuardedContext'] },
  { path: 'determinism.seed', kind: 'configured', backedBy: 'SEED', readBy: ['freezeClocks', 'determinism.test.mjs'] },
  { path: 'determinism.frozenEpochMs', kind: 'configured', backedBy: 'FROZEN_EPOCH_MS', readBy: ['freezeClocks', 'determinism.test.mjs'] },
  { path: 'determinism.frozenTimezone', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.timezoneId', readBy: ['newGuardedContext', 'determinism.test.mjs'] },
  { path: 'determinism.frozenLocale', kind: 'configured', backedBy: 'CONTEXT_DEFAULTS.locale', readBy: ['newGuardedContext', 'determinism.test.mjs'] },
  { path: 'determinism.frozen[]', kind: 'configured', backedBy: 'freezeClocks', readBy: ['determinism.test.mjs'] },
  {
    path: 'determinism.prefersReducedMotion', kind: 'configured',
    backedBy: 'CONTEXT_DEFAULTS.reducedMotion',
    readBy: ['newGuardedContext', 'determinism.test.mjs'],
  },

  // ---- crawl -------------------------------------------------------------
  { path: 'crawl.budget.maxInstancesPerPattern', kind: 'configured', backedBy: 'the frontier', readBy: ['the frontier', 'CaptureModelSchema'] },
  { path: 'crawl.budget.maxRoutesPerContext', kind: 'configured', backedBy: 'the frontier', readBy: ['the frontier', 'CaptureModelSchema'] },
  { path: 'crawl.budget.maxRoutesTotal', kind: 'configured', backedBy: 'the frontier', readBy: ['the frontier', 'CrawlBudgetSchema refine'] },
  { path: 'crawl.budget.maxDepth', kind: 'configured', backedBy: 'the frontier', readBy: ['the frontier'] },
  {
    path: 'crawl.sameOriginOnly', kind: 'configured', backedBy: 'z.literal(true)',
    readBy: [],
    unreadReason:
      'a claim that cannot be false, so it carries no information — it is a `z.literal(true)` nothing can set otherwise. Kept because §6 names the property and removing it from the artifact would remove the only place the guarantee is written; the enforcement is `allowedOrigins` at the interceptor, which is what a reader should check. Flagged here rather than deleted: deleting a schema field is a breaking change and this audit is not the place to make one.',
  },
  { path: 'crawl.allowedOrigins[]', kind: 'derived', backedBy: 'deriveAllowedOrigins', readBy: ['installOriginGuard', 'CaptureManifestSchema superRefine'] },
  { path: 'crawl.allowDestructive', kind: 'configured', backedBy: 'the --allow-destructive flag', readBy: ['planProbeSchedule', 'classifyControlHazard'] },
  { path: 'crawl.sessionProbePolicy', kind: 'derived', backedBy: 'deriveSessionProbePolicy', readBy: ['CaptureManifestSchema superRefine', 'COVERAGE_INVARIANTS'] },
  { path: 'crawl.destructiveTerms[]', kind: 'configured', backedBy: 'TARGET_DESTRUCTIVE_TERMS', readBy: ['classifyControlHazard'] },

  // ---- tool versions -----------------------------------------------------
  {
    path: 'toolVersions.siteforge', kind: 'observed', backedBy: 'package.json',
    readBy: [],
    unreadReason: '§6: pinned so a re-crawl on a different build is not mistaken for a real diff. The reader is whoever is holding two captures that disagree, and no check can do that job — a difference is not an error until a human decides which capture was right.',
  },
  {
    path: 'toolVersions.playwright', kind: 'observed', backedBy: 'package.json',
    readBy: [], unreadReason: 'as above — and this is the one that actually moves.',
  },
  {
    path: 'toolVersions.browser', kind: 'observed', backedBy: 'browser.version()',
    readBy: [], unreadReason: 'as above.',
  },

  // ---- the index ---------------------------------------------------------
  { path: 'patterns[].urlPattern', kind: 'derived', backedBy: 'the frontier', readBy: ['CaptureModelSchema'] },
  {
    path: 'patterns[].observedUrlCount', kind: 'derived', backedBy: 'the frontier',
    readBy: [],
    unreadReason:
      'distinct URLs seen *before* the instance cap, so nothing on disk can recompute it — the artifacts that would be its evidence are the ones the cap declined to write. Recording it is the point: it is how a reader knows three route directories stand for thirty URLs. Unlike `counts.*` below, this one is genuinely not recomputable.',
  },
  { path: 'patterns[].routeIds[]', kind: 'derived', backedBy: 'the frontier', readBy: ['CaptureModelSchema'] },
  { path: 'routeIds[]', kind: 'derived', backedBy: 'the frontier', readBy: ['CaptureModelSchema'] },
  { path: 'flowIds[]', kind: 'derived', backedBy: 'the probe pass', readBy: ['CaptureModelSchema'] },

  // ---- the hash the whole audit started from -----------------------------
  {
    path: 'contentHash', kind: 'derived',
    backedBy: 'sha256 over each route\'s deriveRouteContentHash',
    readBy: ['capture-idempotence.mjs (0028)'],
  },

  // ---- counts ------------------------------------------------------------
  { path: 'counts.contexts', kind: 'derived', backedBy: 'contexts.length', readBy: ['CaptureManifestSchema superRefine'] },
  { path: 'counts.routes', kind: 'derived', backedBy: 'routeIds.length', readBy: ['CaptureManifestSchema superRefine'] },
  { path: 'counts.capturedRoutes', kind: 'derived', backedBy: 'the routes holding artifacts', readBy: ['CaptureModelSchema'] },
  { path: 'counts.patterns', kind: 'derived', backedBy: 'patterns.length', readBy: ['CaptureManifestSchema superRefine'] },
  { path: 'counts.assets', kind: 'derived', backedBy: 'the asset index', readBy: ['CaptureModelSchema'] },
  { path: 'counts.endpoints', kind: 'derived', backedBy: 'endpoints.length', readBy: ['CaptureModelSchema'] },
  { path: 'counts.flows', kind: 'derived', backedBy: 'flowIds.length', readBy: ['CaptureManifestSchema superRefine'] },
  { path: 'counts.gaps', kind: 'derived', backedBy: 'gaps.length', readBy: ['CaptureModelSchema superRefine'] },
];

const leaves = [...new Set(schemaLeafPaths(CaptureManifestSchema))];

describe('every manifest claim is backed by something and read by something', () => {
  const report = assessManifestClaims({ claims: CLAIMS, schemaLeaves: leaves });

  it('has nothing the schema declares and this ledger does not classify', () => {
    // One direction of the set difference. A field added to the schema without
    // anyone deciding what backs it is how `frozen` and `prefersReducedMotion`
    // both happened.
    expect(report.unclassified).toEqual([]);
  });

  it('has nothing in the ledger the schema no longer declares', () => {
    // The other direction, because a count would net a removal against an
    // addition — `assessScopeAgreement`'s argument.
    expect(report.notInSchema).toEqual([]);
  });

  it('has no derived or configured claim with nothing behind it', () => {
    expect(report.unbacked).toEqual([]);
  });

  it('has no claim that is neither read nor declared unread', () => {
    expect(report.unread).toEqual([]);
  });

  it('has no stale exemption — a reason given for a claim something reads', () => {
    expect(report.reasonGivenButRead).toEqual([]);
  });
});
