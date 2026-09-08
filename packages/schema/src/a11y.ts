/**
 * The accessibility tree.
 *
 * Shared on purpose between three consumers, because they must agree:
 *   - capture (§6) records a11y role and name per candidate element;
 *   - flow traces (§6) snapshot the tree before and after every action;
 *   - the runtime `Observation` (§10) exposes it as "the primary modality —
 *     most agents use this", with `actionSpace` refs drawn from it.
 *
 * §9's behavioral gate compares "a11y-tree deltas, not pixels". That comparison
 * is only meaningful if the tree recorded at capture time and the tree produced
 * by the clone are the same shape, which is why this type lives in `schema`
 * rather than in `capture` or `envkit`.
 */
import { z } from 'zod';
import { A11yRefSchema, NodeIdSchema, type A11yRef, type NodeId } from './primitives.js';

/** Tri-state ARIA attributes, which are not booleans. */
export const TristateSchema = z.enum(['true', 'false', 'mixed']);
export type Tristate = z.infer<typeof TristateSchema>;

export interface A11yNode {
  /**
   * Stable address for this node. §10: refs, not selectors, because "selectors
   * break the moment the agent causes a re-render".
   */
  ref: A11yRef;
  role: string;
  /** The computed accessible name. Empty string when the node has none. */
  name: string;
  description?: string | undefined;
  value?: string | number | undefined;

  checked?: Tristate | undefined;
  pressed?: Tristate | undefined;
  expanded?: boolean | undefined;
  selected?: boolean | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  invalid?: boolean | undefined;
  readonly?: boolean | undefined;
  focused?: boolean | undefined;
  /** Heading level, for `role: 'heading'`. */
  level?: number | undefined;

  /**
   * Back-reference into `dom.json`, when the a11y node corresponds to a captured
   * element. Absent for generated nodes (text leaves the platform synthesises,
   * nodes inside a closed shadow root we could not attribute).
   */
  nodeId?: NodeId | undefined;

  children: A11yNode[];
}

export const A11yNodeSchema: z.ZodType<A11yNode> = z.lazy(() =>
  z.strictObject({
    ref: A11yRefSchema,
    role: z.string().min(1),
    name: z.string(),
    description: z.string().optional(),
    value: z.union([z.string(), z.number()]).optional(),
    checked: TristateSchema.optional(),
    pressed: TristateSchema.optional(),
    expanded: z.boolean().optional(),
    selected: z.boolean().optional(),
    disabled: z.boolean().optional(),
    required: z.boolean().optional(),
    invalid: z.boolean().optional(),
    readonly: z.boolean().optional(),
    focused: z.boolean().optional(),
    level: z.int().min(1).max(6).optional(),
    nodeId: NodeIdSchema.optional(),
    children: z.array(A11yNodeSchema),
  }),
);
