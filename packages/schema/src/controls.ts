/**
 * `flows/skipped-controls.json` — controls §6 discovered but refused to activate.
 *
 * §6 skips destructive actions by heuristic and logs each as a gap. Rung 3 showed
 * that the gap alone is not enough for the next stage to do anything with.
 *
 * The reasoning that produced this file (decision 0010): capture cannot know the
 * URL of a control it never fired, and should not try — firing it is exactly what
 * §6 refuses to do against a target we do not own. But capture *does* know the
 * control exists, and that is a different fact with a different owner:
 *
 *   capture  →  the control: role, accessible name, node, route, gap. No endpoint.
 *   infer    →  binds it to a URL by reading `<form action>` and `fetch()` out of
 *               the captured source. On success it emits an endpoint with no
 *               observed responses, carrying this gap id forward. On failure the
 *               gap stands alone.
 *
 * A skipped `FlowTrace` cannot carry this. It is forced to `steps: []`, and role,
 * name and nodeId live on `FlowStep.target` — so in a skipped flow they survive
 * only as prose inside `name` and `description`. This file is the structured half
 * that the empty step list threw away, not a second copy of it.
 */
import { z } from 'zod';
import { FlowIdSchema, NodeIdSchema, RouteIdSchema, SiteIdSchema } from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { GapIdSchema } from './gap.js';

export const ControlIdSchema = z
  .string()
  .regex(/^ctl_[0-9a-f]{12}$/, 'expected ctl_<12 hex>');

/** Why the control was discovered but never activated. */
export const SkipCauseSchema = z.enum([
  /** §6's destructive heuristic: `delete`, `remove`, `cancel subscription`, … */
  'destructive-heuristic',
  'auth-required',
  'precondition-unmet',
  /** §2: abort rather than bypass. */
  'bot-protection',
]);

export const SkippedControlSchema = z
  .strictObject({
    controlId: ControlIdSchema,
    /** Where the control was found. */
    routeId: RouteIdSchema,
    nodeId: NodeIdSchema,
    /**
     * Accessible role and name, from the same CDP a11y pass §6 uses for discovery.
     * These are what infer matches against when it looks for the control's handler
     * in the captured source — and what §10 would resolve a ref by, if the clone
     * ever implements the control.
     */
    role: z.string().min(1),
    name: z.string(),
    cause: SkipCauseSchema,
    /** The heuristic term that matched, for `destructive-heuristic`. */
    matchedTerm: z.string().min(1).optional(),
    /** §6: "Log every skip as a gap." Not optional — this is what makes it so. */
    gapId: GapIdSchema,
    /** The placeholder flow recording the un-run probe, when one was written. */
    flowId: FlowIdSchema.nullable(),
  })
  .superRefine((control, ctx) => {
    if (control.cause === 'destructive-heuristic' && control.matchedTerm === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['matchedTerm'],
        message: 'a control skipped by the destructive heuristic must name the term that matched it',
      });
    }
  });

export const SkippedControlIndexSchema = z.strictObject({
  ...artifactEnvelope('skipped-control-index'),
  siteId: SiteIdSchema,
  /**
   * Empty is a real and common answer, which is why this artifact is never
   * absent: "nothing was skipped" and "nobody looked" must not be the same value.
   */
  controls: z.array(SkippedControlSchema),
});

export type ControlId = z.infer<typeof ControlIdSchema>;
export type SkipCause = z.infer<typeof SkipCauseSchema>;
export type SkippedControl = z.infer<typeof SkippedControlSchema>;
export type SkippedControlIndex = z.infer<typeof SkippedControlIndexSchema>;
