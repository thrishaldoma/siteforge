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

/**
 * What a control's activation would cost, classified by **who absorbs the harm**.
 *
 * §6's original heuristic had one bucket — "destructive" — and it conflated
 * three unrelated things. "Sign out" and "Delete account" both match a
 * destructive term, and treating them alike was backwards in both directions: it
 * left `POST /api/auth/logout` uncaptured and filed a core auth flow as
 * unreliable, while §10's auth tasks depend on logout working.
 */
export const ControlHazardSchema = z.enum([
  /**
   * Irreversible against a system we do not own. **Never fire** (§6, §13).
   * The only hazard that yields an endpoint with no observed responses.
   */
  'target-destructive',
  /**
   * Ends our session and nothing else: logout, switch account, revoke own
   * token. Harmless to the target, so **fire it** — in a disposable context on
   * a session acquired for the purpose, which is then thrown away. Yields real
   * observations and an ordinary endpoint: no gap, never synthesized.
   */
  'session-destructive',
  /** External origin, `mailto:`, a file download. Not destructive, just not ours. */
  'out-of-scope',
]);

/**
 * Why the control was discovered but never activated.
 *
 * `session-destructive` is deliberately **absent**. A control whose only cost is
 * our own session must be captured, not skipped, so "skipped because it would
 * log us out" is not a sentence this schema can express. If firing one fails,
 * that is `precondition-unmet` — a different and honest claim.
 */
export const SkipCauseSchema = z.enum([
  /** Irreversible against the target. See `ControlHazardSchema`. */
  'target-destructive',
  /** Not ours to exercise: another origin, a mail client, a download. */
  'out-of-scope',
  'auth-required',
  'precondition-unmet',
  /** §2: abort rather than bypass. */
  'bot-protection',
]);

/**
 * What was true of the control at the moment the action timed out.
 *
 * Three diagnoses of the Vikunja probe timeouts were wrong in a row (0024 §2),
 * and each was argued from the single word `timeout`. `step()` then established
 * *which* operation ran out of clock — the click, never the navigation — and
 * this is the next question down: **which of the click's preconditions was
 * never met.**
 *
 * The four fields are not a guess at the answer, they are Playwright's own
 * actionability checks, which is what `click` is waiting on when it times out:
 * the element must be *visible*, *stable* (the same box across two animation
 * frames), *receiving pointer events* (nothing painted on top of it), and
 * *enabled*. Recording all four at the moment of failure means the next run
 * answers the question rather than supporting whichever hypothesis is fashionable.
 *
 * `attemptIndex` is the fifth, and it is the one no reproduction outside the
 * loop can vary: the run's own per-route counts (10 fired of 18 attempted, 4 of
 * 14, 5 of 13) say the failure rate depends on position, and a single-shot
 * harness always exercises position zero. §13's rule about a reproduction that
 * cannot exhibit the failure exists because of this exact measurement.
 *
 * **It is a record, not an explanation.** Nothing downstream reads a cause out
 * of it; the distribution is for a human to look at.
 */
export const ProbeDiagnosticSchema = z.strictObject({
  /** The operation that ran out of clock, as `step()` labelled it: `click/timeout`. */
  step: z.string().min(1),
  /** The stable selector the probe drove, so the case can be re-run by hand. */
  selector: z.string().min(1),
  /** Position in this route's probe loop, counting attempts. Zero-based. */
  attemptIndex: z.int().nonnegative(),
  /**
   * Playwright's four actionability conditions, as observed after the failure.
   * `null` where the check could not be made — the element had detached, or the
   * page had gone — which is itself an answer and must not read as `false`.
   */
  visible: z.boolean().nullable(),
  stable: z.boolean().nullable(),
  receivesPointerEvents: z.boolean().nullable(),
  enabled: z.boolean().nullable(),
  /** Whether the element's box was inside the viewport at the time. */
  inViewport: z.boolean().nullable(),
  /** Whether the page had a main-frame navigation in flight when the click gave up. */
  navigationPending: z.boolean(),
  /** What `elementFromPoint` returned at the element's centre, when something else did. */
  occludedBy: z.string().nullable(),
});

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
    /** The heuristic term that matched, for `target-destructive`. */
    matchedTerm: z.string().min(1).optional(),
    /** What put the control outside scope: the origin, `mailto:`, the download URL. */
    outOfScopeTarget: z.string().min(1).optional(),
    /** §6: "Log every skip as a gap." Not optional — this is what makes it so. */
    gapId: GapIdSchema,
    /** The placeholder flow recording the un-run probe, when one was written. */
    flowId: FlowIdSchema.nullable(),
    /**
     * Present exactly when the control was **fired** and would not resolve.
     * A control that was declined was never driven, so there is no element
     * state to record and an empty diagnostic would be an invented observation.
     */
    diagnostic: ProbeDiagnosticSchema.nullable(),
  })
  .superRefine((control, ctx) => {
    // Fixture legality (decision 0011): a derived field carries the evidence it
    // was derived from, and the schema rejects a value that evidence does not
    // support. `cause` is a classification, so it names what classified it.
    if (control.cause === 'target-destructive' && control.matchedTerm === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['matchedTerm'],
        message: 'a control skipped as target-destructive must name the term that classified it',
      });
    }
    if (control.cause === 'out-of-scope' && control.outOfScopeTarget === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['outOfScopeTarget'],
        message: 'a control skipped as out-of-scope must say what put it out of scope',
      });
    }
    // The same rule as the two above, in the direction that matters more: a
    // declined control carrying element state would be claiming an observation
    // nobody made, and a fired one without it is the measurement not taken.
    if (control.cause === 'precondition-unmet' && control.diagnostic === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['diagnostic'],
        message:
          'a control that was fired and would not resolve must record what was true of it at the ' +
          'time. Three wrong diagnoses were argued from a bare `timeout` (0024 §2); this is the field ' +
          'that stops the fourth.',
      });
    }
    if (control.cause !== 'precondition-unmet' && control.diagnostic !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['diagnostic'],
        message: `a ${control.cause} control was never driven, so there is no element state to have observed`,
      });
    }
    if (control.cause !== 'target-destructive' && control.matchedTerm !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['matchedTerm'],
        message: `a ${control.cause} skip does not come from a term match`,
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
export type ControlHazard = z.infer<typeof ControlHazardSchema>;
export type SkipCause = z.infer<typeof SkipCauseSchema>;
export type ProbeDiagnostic = z.infer<typeof ProbeDiagnosticSchema>;
export type SkippedControl = z.infer<typeof SkippedControlSchema>;
export type SkippedControlIndex = z.infer<typeof SkippedControlIndexSchema>;
