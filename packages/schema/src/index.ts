/**
 * `@siteforge/schema` — the contract between stages.
 *
 * CLAUDE.md §4: "zod schemas for SiteModel — the contract". §14: "Begin at
 * `packages/schema` ... Everything else follows from a schema that is right."
 *
 * Two layers live here (docs/decisions/0001-sitemodel-is-two-layers.md):
 *
 *   `CaptureModel`  Stage 1 output → Stage 2 input.  §5's `capture/` tree.
 *   `SiteModel`     Stage 2 output → Stage 3 input.  §7's inference. Reserved for M2.
 *
 * §13: "Write the zod schema before the code that produces or consumes it. Schema
 * drift between stages is the failure mode that will cost you the most time."
 */

export { CAPTURE_MODEL_VERSION, SITE_MODEL_VERSION } from './version.js';

export * from './primitives.js';
export * from './identity.js';
export * from './context.js';
export * from './auth.js';
export * from './artifact.js';
export * from './json-schema.js';
export * from './a11y.js';
export * from './gap.js';
export * from './manifest.js';
export * from './manifest-claims.js';
export * from './route.js';
export * from './dom.js';
export * from './styles.js';
export * from './states.js';
export * from './assets.js';
export * from './endpoints.js';
export * from './flows.js';
export * from './controls.js';
export * from './coverage.js';
export * from './grade-contract.js';
export * from './deferral.js';
export * from './stage-report.js';
export * from './capture-model.js';
export * from './site-model/index.js';
export * from './model-assembly.js';
