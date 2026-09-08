/**
 * §7.7: "Convert `flows/` transitions into declarative specs:
 * `{trigger, precondition, effect}`. Effects are typed — `navigate`,
 * `mutate-entity`, `toggle-ui-state`, `open-overlay`, `submit-form`. Anything
 * that does not fit a known effect type is a gap, not a guess."
 *
 * A `FlowTrace` records `{preHash, action, postHash, domDelta, networkCalls[]}`
 * — two opaque hashes and a diff. Codegen cannot wire a button to a store
 * mutation from a hash. The typed effect is the whole distance between the two,
 * and §9's behavioural gate replays the trace against the clone to check the
 * translation was faithful.
 *
 * The unfittable case is `unclassified`, in the model and carrying a gap,
 * rather than absent. §13: a gap recorded only in prose is not tracked — an
 * effect that simply did not make it into the model is invisible to everything
 * downstream, including the operator reading `GAPS.md`.
 */
import { z } from 'zod';
import { EndpointIdSchema, FlowIdSchema } from '../primitives.js';
import { GapIdSchema } from '../gap.js';
import { ComponentIdSchema } from './presentation.js';
import { EntityNameSchema } from './entities.js';

/**
 * What the agent acts on.
 *
 * Role and accessible name, not a selector: §10 resolves refs by entity anchor
 * then by role+name, and a selector "breaks the moment the agent causes a
 * re-render". The trigger has to be expressed in the vocabulary the action
 * space is enumerated in, or a generated task cannot address it.
 */
export const BehaviourTriggerSchema = z.strictObject({
  role: z.string().min(1),
  accessibleName: z.string().min(1),
  /** Where it appears. A template pattern, not a captured URL. */
  onTemplate: z.string().regex(/^tpl_/),
  componentId: ComponentIdSchema.nullable(),
});

export const BehaviourEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('navigate'), toTemplate: z.string().regex(/^tpl_/) }),
  z.strictObject({
    kind: z.literal('mutate-entity'),
    operationId: EndpointIdSchema,
    entity: EntityNameSchema,
  }),
  z.strictObject({ kind: z.literal('toggle-ui-state'), state: z.string().min(1) }),
  z.strictObject({ kind: z.literal('open-overlay'), componentId: ComponentIdSchema }),
  z.strictObject({
    kind: z.literal('submit-form'),
    operationId: EndpointIdSchema,
    /** Which form fields feed which request pointers. Codegen wires the submit. */
    fields: z.array(z.strictObject({ name: z.string().min(1), pointer: z.string().min(1) })),
  }),
  z.strictObject({ kind: z.literal('unclassified'), gapId: GapIdSchema, summary: z.string().min(1) }),
]);

export const BehaviourSchema = z
  .strictObject({
    behaviourId: z.string().regex(/^bhv_[a-z0-9]+(-[a-z0-9]+)*$/),
    trigger: BehaviourTriggerSchema,
    /** A store predicate that must hold first, in prose. Null when there is none. */
    precondition: z.string().min(1).nullable(),
    effect: BehaviourEffectSchema,
    /**
     * The trace this was read off, and the calls it made. §9's behavioural gate
     * replays the first and asserts the second, so a behaviour that names
     * neither is one nothing can check.
     */
    derivedFrom: z.strictObject({ flowId: FlowIdSchema }),
    networkCalls: z.array(EndpointIdSchema),
  })
  .superRefine((behaviour, ctx) => {
    // An effect that names an operation must have been observed calling it.
    // Otherwise the behavioural gate asserts a call the model invented.
    const named =
      behaviour.effect.kind === 'mutate-entity' || behaviour.effect.kind === 'submit-form'
        ? behaviour.effect.operationId
        : null;
    if (named !== null && !behaviour.networkCalls.includes(named)) {
      ctx.addIssue({
        code: 'custom', path: ['effect', 'operationId'],
        message: `the effect calls ${named} but the trace recorded no such call — §9 would assert a request that was never seen`,
      });
    }
  });

export type BehaviourTrigger = z.infer<typeof BehaviourTriggerSchema>;
export type BehaviourEffect = z.infer<typeof BehaviourEffectSchema>;
export type Behaviour = z.infer<typeof BehaviourSchema>;
