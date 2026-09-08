/**
 * `routes/<route-id>/states.json` — pseudo-class and JS-driven state deltas.
 *
 * §6 mandates two distinct provenances for state information, and this file keeps
 * them distinguishable rather than merging them into one soup:
 *
 *   - **`cssom`** — rules read straight out of `document.styleSheets` whose
 *     selector contains `:hover`, `:focus`, `:focus-visible`, `:active`,
 *     `:checked`, `:disabled`, `[aria-expanded]`, or `[data-state]`. §6 calls this
 *     "the highest-value trick in this project": it yields the true hover/focus
 *     definitions in one pass, with no page interactions at all.
 *
 *   - **`probed`** — deltas observed by actually driving the element, used only
 *     "to resolve the handful of elements whose state changes are JS-driven and
 *     therefore absent from CSS."
 *
 *   - **`scroll`** — §6's scroll pass. Kept here rather than in a `scroll.json`
 *     because §5's layout defines no such file and these are state changes;
 *     the scroll *screenshots* are indexed from `meta.json`.
 *
 * Keeping the provenance means infer can trust `cssom` entries and treat `probed`
 * entries as evidence rather than specification.
 */
import { z } from 'zod';
import {
  CssPropertyNameSchema,
  NodeIdSchema,
  RouteIdSchema,
  StyleIdSchema,
} from './primitives.js';
import { artifactEnvelope } from './artifact.js';
import { StyleDeclarationSchema } from './styles.js';

/**
 * Interaction pseudo-classes that make a rule a state rule.
 *
 * Matched by **parsing** the selector, never by substring test — see §6 and
 * docs/decisions/0008. A literal list plus `String.includes` is what silently
 * dropped every `[aria-expanded="true"]` rule in the rung-2 measurement.
 */
export const STATE_PSEUDO_CLASSES = [
  ':hover',
  ':focus',
  ':focus-visible',
  ':focus-within',
  ':active',
  ':checked',
  ':indeterminate',
  ':disabled',
  ':enabled',
  ':target',
  ':visited',
  ':open',
] as const;

/**
 * State-bearing attribute selectors, normalized to their bare attribute name:
 * `[aria-expanded="true"]` is recorded as `[aria-expanded]`.
 *
 * **Any** `aria-*` or `data-*` attribute counts, regardless of value. §6 used to
 * name `[aria-expanded]` and `[data-state]` specifically; an enumerated list
 * will always trail what sites actually write, and the ones it misses are
 * dropped in silence.
 */
export const StateAttributePatternSchema = z
  .string()
  .regex(/^\[(?:aria|data)-[a-z0-9-]+\]$/, 'expected [aria-*] or [data-*]');

export const StateSelectorSchema = z.union([
  z.enum(STATE_PSEUDO_CLASSES),
  StateAttributePatternSchema,
]);

/** A single property's before/after values. */
export const PropertyChangeSchema = z.strictObject({
  property: CssPropertyNameSchema,
  from: z.string(),
  to: z.string(),
});

export const AttributeChangeSchema = z.strictObject({
  attribute: z.string().min(1),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/** What §6's scroll pass diffs consecutive DOM snapshots to detect. */
export const ScrollEffectSchema = z.enum([
  'lazy-load',
  'infinite-scroll',
  'sticky-transition',
  'fixed-transition',
  'intersection-reveal',
]);

/**
 * State information, discriminated by how it was obtained.
 *
 * A consumer that cannot tell a CSSOM-derived rule from a probed observation
 * cannot tell specification from evidence, and §7's rule — "when confidence is
 * low, write a gap, not an invention" — becomes unenforceable.
 */
export const StateDeltaSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('cssom'),
    /** The rule's selector text, verbatim. */
    selector: z.string().min(1),
    /** Which of §6's state patterns the selector contains. */
    stateSelectors: z.array(StateSelectorSchema).min(1),
    /** The rule's own declarations — not a computed style. */
    declarations: StyleDeclarationSchema,
    /** Nodes in `dom.json` this selector matches in its base state. */
    matchedNodeIds: z.array(NodeIdSchema),
    origin: z.strictObject({
      /** Absent for a `<style>` element or a CSSOM-injected sheet. */
      stylesheetHref: z.string().optional(),
      /** Index within `document.styleSheets`, then within `cssRules`. */
      sheetIndex: z.int().nonnegative(),
      ruleIndex: z.int().nonnegative(),
    }),
    /** Enclosing `@media` condition, when the rule is nested in one. */
    mediaQuery: z.string().optional(),
  }),

  z.strictObject({
    source: z.literal('probed'),
    nodeId: NodeIdSchema,
    trigger: z.enum(['hover', 'focus', 'active', 'click', 'keydown']),
    /**
     * Why a probe was needed at all. `absent-from-cssom` is the legitimate case
     * §6 describes; anything else is worth an operator's attention.
     */
    reason: z.enum(['absent-from-cssom', 'cssom-inaccessible', 'operator-forced']),
    styleChanges: z.array(PropertyChangeSchema),
    attributeChanges: z.array(AttributeChangeSchema),
    classChanges: z.strictObject({
      added: z.array(z.string()),
      removed: z.array(z.string()),
    }),
    /** True when the delta was structural, not just cosmetic. */
    subtreeChanged: z.boolean(),
    /** Set when the probe produced a different resolved style object. */
    resultingStyleId: StyleIdSchema.optional(),
  }),

  z.strictObject({
    source: z.literal('scroll'),
    /** Index into `meta.json`'s `screenshots.scroll`. */
    scrollStep: z.int().nonnegative(),
    scrollY: z.number().nonnegative(),
    effect: ScrollEffectSchema,
    /** Nodes added to the DOM at this step (lazy load, infinite scroll). */
    addedNodeIds: z.array(NodeIdSchema),
    /** Nodes whose computed style changed at this step (sticky, reveal). */
    changedNodeIds: z.array(NodeIdSchema),
    styleChanges: z.array(
      z.strictObject({ nodeId: NodeIdSchema, changes: z.array(PropertyChangeSchema) }),
    ),
  }),
]);

export const StateDeltasDocumentSchema = z.strictObject({
  ...artifactEnvelope('state-deltas'),
  routeId: RouteIdSchema,
  entries: z.array(StateDeltaSchema),
  stats: z.strictObject({
    cssomRules: z.int().nonnegative(),
    probedNodes: z.int().nonnegative(),
    scrollSteps: z.int().nonnegative(),
  }),
});

export type StateSelector = z.infer<typeof StateSelectorSchema>;
export type PropertyChange = z.infer<typeof PropertyChangeSchema>;
export type AttributeChange = z.infer<typeof AttributeChangeSchema>;
export type ScrollEffect = z.infer<typeof ScrollEffectSchema>;
export type StateDelta = z.infer<typeof StateDeltaSchema>;
export type StateDeltasDocument = z.infer<typeof StateDeltasDocumentSchema>;
