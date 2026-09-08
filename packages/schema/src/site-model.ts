/**
 * `SiteModel` — RESERVED. Not yet designed.
 *
 * §4's package table defines the stage contract as:
 *
 *     infer/    # capture/ → SiteModel
 *     codegen/  # SiteModel → generated app
 *
 * so `SiteModel` is the **output of Stage 2**: design tokens, extracted
 * components, route templates, the inferred data model, and behavior specs (§7).
 * The §5 capture layer is `CaptureModel`, in `./capture-model.js`.
 *
 * See docs/decisions/0001-sitemodel-is-two-layers.md for why the two names were
 * split, and for the operator's ruling that this layer is designed at M2 rather
 * than now. Writing it today would mean inventing fixtures for a model no stage
 * can yet produce, and §7's own rule is that a low-confidence guess becomes a
 * gap, not an invention.
 *
 * The name is held here so nothing else claims it. `packages/infer` must not be
 * written until this file is real (§13: "Write the zod schema before the code
 * that produces or consumes it").
 */
import { z } from 'zod';
import { SITE_MODEL_VERSION } from './version.js';

/**
 * Placeholder. Parses nothing useful on purpose: any attempt to construct a
 * SiteModel before M2 fails loudly rather than establishing a shape by accident.
 */
export const SiteModelSchema = z
  .strictObject({
    modelVersion: z.literal(SITE_MODEL_VERSION),
    reserved: z.literal(true),
  })
  .describe('Reserved for Stage 2 output. Designed at M2 — see decision 0001.');

export type SiteModel = z.infer<typeof SiteModelSchema>;
