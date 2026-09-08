/**
 * `flows/<flow-id>.trace.json` — recorded interaction traces.
 *
 * §6: "This tuple set **is** the functional specification. The generated clone is
 * correct when it reproduces these transitions."
 *
 * A flow is an **ordered sequence** of steps, not a single action. §6's behavior
 * probing produces flows of length 1; §10's tasks ("Add a blue mug and a notebook
 * to your cart and complete checkout") require many. One type covers both, with
 * `kind` recording which it is.
 *
 * The action vocabulary here is the same one §10 exposes as the runtime action
 * space. §10 requires `actionSpace` be enumerated "using the same discovery logic
 * as capture" — that only holds if both ends speak the same `Action` type, which
 * is why it lives in `schema` and not in `capture` or `envkit`.
 */
import { z } from 'zod';
import {
  A11yRefSchema,
  EndpointIdSchema,
  FlowIdSchema,
  HttpMethodSchema,
  NodeIdSchema,
  RouteIdSchema,
  ShortHashSchema,
  SiteIdSchema,
  StyleIdSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { A11yNodeSchema } from './a11y.js';
import { GapIdSchema } from './gap.js';

/**
 * The action vocabulary, shared between recorded flows and §10's runtime action
 * space. `hover` is capture-only (used by §6's probing); everything else is
 * exactly §10's list.
 */
export const ActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('click'), ref: A11yRefSchema }),
  z.strictObject({ type: z.literal('type'), ref: A11yRefSchema, text: z.string() }),
  z.strictObject({ type: z.literal('select'), ref: A11yRefSchema, option: z.string() }),
  z.strictObject({ type: z.literal('scroll'), dx: z.number(), dy: z.number() }),
  z.strictObject({ type: z.literal('key'), key: z.string().min(1) }),
  z.strictObject({ type: z.literal('goto'), url: z.string().min(1) }),
  z.strictObject({ type: z.literal('back') }),
  z.strictObject({ type: z.literal('done') }),
  /** Capture-only: §6 uses hover probing to resolve JS-driven state changes. */
  z.strictObject({ type: z.literal('hover'), ref: A11yRefSchema }),
]);

/**
 * How to find the action's target.
 *
 * Both addressings are recorded on purpose. `selector` re-resolves the element
 * during capture-time replay; `ref` is what §10 hands an agent, because
 * "selectors break the moment the agent causes a re-render".
 */
export const ActionTargetSchema = z.strictObject({
  ref: A11yRefSchema,
  nodeId: NodeIdSchema,
  selector: z.string().min(1),
  role: z.string().min(1),
  name: z.string(),
});

/** §6: "Snapshot DOM hash + URL + a11y tree." */
export const FlowSnapshotSchema = z.strictObject({
  url: z.string().min(1),
  routeId: RouteIdSchema.nullable(),
  domHash: ShortHashSchema,
  a11yHash: ShortHashSchema,
  focusedRef: A11yRefSchema.nullable(),
});

export const DomDeltaSchema = z.strictObject({
  addedNodeIds: z.array(NodeIdSchema),
  removedNodeIds: z.array(NodeIdSchema),
  attributeChanges: z.array(
    z.strictObject({
      nodeId: NodeIdSchema,
      attribute: z.string().min(1),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  ),
  textChanges: z.array(
    z.strictObject({ nodeId: NodeIdSchema, from: z.string(), to: z.string() }),
  ),
  styleChanges: z.array(
    z.strictObject({ nodeId: NodeIdSchema, from: StyleIdSchema, to: StyleIdSchema }),
  ),
});

/**
 * The a11y-tree delta.
 *
 * §9's behavioral gate compares "a11y-tree deltas, not pixels — the question is
 * whether the same semantic transition occurred." This is the thing it compares.
 */
export const A11yDeltaSchema = z.strictObject({
  added: z.array(
    z.strictObject({
      ref: A11yRefSchema,
      role: z.string().min(1),
      name: z.string(),
      parentRef: A11yRefSchema.nullable(),
    }),
  ),
  removed: z.array(A11yRefSchema),
  changed: z.array(
    z.strictObject({
      ref: A11yRefSchema,
      property: z.string().min(1),
      from: z.string().nullable(),
      to: z.string().nullable(),
    }),
  ),
});

/** §9: "Assert the same network calls fired against the mock API." */
export const NetworkCallSchema = z.strictObject({
  /** Null when the request did not normalize to a known endpoint. */
  endpointId: EndpointIdSchema.nullable(),
  method: HttpMethodSchema,
  /** Scrubbed. */
  url: z.string().min(1),
  pathPattern: z.string().min(1),
  status: z.int().min(100).max(599),
  isMutation: z.boolean(),
});

export const FlowStepSchema = z.strictObject({
  index: z.int().nonnegative(),
  action: ActionSchema,
  /** Absent for actions with no element target (`scroll`, `back`, `goto`, `done`). */
  target: ActionTargetSchema.optional(),
  pre: FlowSnapshotSchema,
  post: FlowSnapshotSchema,
  domDelta: DomDeltaSchema,
  a11yDelta: A11yDeltaSchema,
  networkCalls: z.array(NetworkCallSchema),
  urlChanged: z.boolean(),
  /** §6: "Wait for network idle or 2s." */
  waitStrategy: z.enum(['network-idle', 'timeout']),
});

/** How the flow came to exist. */
export const FlowKindSchema = z.enum([
  /** A single-action behavior probe from §6. Exactly one step. */
  'probe',
  /** A multi-step sequence assembled from probes or authored by the operator. */
  'scripted',
  /** Recorded from a live operator session. */
  'recorded',
]);

export const FlowOutcomeSchema = z.enum([
  'completed',
  /** The sequence failed partway; steps up to the failure are recorded. */
  'aborted',
  /** Never run. §6's destructive heuristic, or a precondition that could not be met. */
  'skipped',
]);

export const FlowTraceSchema = z
  .strictObject({
    ...artifactEnvelope('flow-trace'),
    flowId: FlowIdSchema,
    siteId: SiteIdSchema,
    kind: FlowKindSchema,
    name: z.string().min(1),
    description: z.string().optional(),

    /** Where the flow begins. Replay navigates here first. */
    startRouteId: RouteIdSchema,
    /** How the first target was discovered (§6's four candidate sources). */
    discoveredBy: z.enum([
      'a11y-tree',
      'event-listeners',
      'pseudo-class-rule',
      'cursor-pointer',
      'operator',
    ]),

    /**
     * The full a11y tree at the start. Steps carry deltas rather than whole trees,
     * so a replay can reconstruct any point without storing N copies of the tree.
     */
    initialA11yTree: A11yNodeSchema,
    steps: z.array(FlowStepSchema),

    outcome: FlowOutcomeSchema,
    /** §6: "Skip destructive actions by heuristic ... Log every skip as a gap." */
    destructive: z.boolean(),
    skipReason: z
      .strictObject({
        cause: z.enum([
          'destructive-heuristic',
          'auth-required',
          'precondition-unmet',
          'bot-protection',
        ]),
        matchedTerm: z.string().optional(),
        gapId: GapIdSchema,
      })
      .optional(),
    gapIds: z.array(GapIdSchema),
  })
  .superRefine((flow, ctx) => {
    if (flow.outcome === 'skipped') {
      if (flow.steps.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps'],
          message: 'a skipped flow must record no steps',
        });
      }
      if (!flow.skipReason) {
        ctx.addIssue({
          code: 'custom',
          path: ['skipReason'],
          message: 'a skipped flow must say why, and name the gap it wrote',
        });
      }
    } else if (flow.steps.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'a flow that was not skipped must record at least one step',
      });
    }

    if (flow.kind === 'probe' && flow.outcome !== 'skipped' && flow.steps.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: 'a probe records exactly one action',
      });
    }

    flow.steps.forEach((step, i) => {
      if (step.index !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'index'],
          message: `step index ${step.index} is out of order at position ${i}`,
        });
      }
      // The tuple only forms a chain if each step starts where the last ended.
      const prev = flow.steps[i - 1];
      if (prev && prev.post.domHash !== step.pre.domHash) {
        ctx.addIssue({
          code: 'custom',
          path: ['steps', i, 'pre', 'domHash'],
          message: `step ${i} does not start from step ${i - 1}'s post-state`,
        });
      }
    });
  });

export type Action = z.infer<typeof ActionSchema>;
export type ActionTarget = z.infer<typeof ActionTargetSchema>;
export type FlowSnapshot = z.infer<typeof FlowSnapshotSchema>;
export type DomDelta = z.infer<typeof DomDeltaSchema>;
export type A11yDelta = z.infer<typeof A11yDeltaSchema>;
export type NetworkCall = z.infer<typeof NetworkCallSchema>;
export type FlowStep = z.infer<typeof FlowStepSchema>;
export type FlowKind = z.infer<typeof FlowKindSchema>;
export type FlowOutcome = z.infer<typeof FlowOutcomeSchema>;
export type FlowTrace = z.infer<typeof FlowTraceSchema>;
