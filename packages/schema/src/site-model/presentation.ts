/**
 * Everything codegen needs to emit a Next.js app: tokens, fonts, assets,
 * components, layouts and route templates.
 *
 * Each section exists because a sentence in §8 requires it, and none of them is
 * a renamed capture artifact. There is no `dom`, no `styles`, no `states` here:
 * a component is a *cluster* of subtrees with the varying parts lifted into
 * props, a token is a *snap* of near-identical values onto one name, and an
 * asset entry is a *decision* about how to emit the bytes. Those three verbs
 * are what infer does; carrying the trees and the computed styles forward
 * instead would leave codegen exactly where capture left it.
 */
import { z } from 'zod';
import { RouteIdSchema, Sha256Schema } from '../primitives.js';
import { GapIdSchema } from '../gap.js';
import { EntityNameSchema, FieldNameSchema } from './entities.js';
import { EndpointIdSchema } from '../primitives.js';

const TokenNameSchema = z.string().regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/, 'expected a kebab-case token name');

/**
 * One design token, with the raw values it absorbed.
 *
 * §7.1: "a site with `#1a73e8` and `#1a73e9` has one brand blue and a typo".
 * Snapping is a narrowing, so it carries its evidence (§13) — `snappedFrom`
 * lets a reviewer see that two greys became one, and lets the visual gate
 * explain a diff that a bare token table could not.
 */
export const DesignTokenSchema = z.strictObject({
  name: TokenNameSchema,
  value: z.string().min(1),
  snappedFrom: z.array(z.string().min(1)).min(1),
  usageCount: z.int().positive(),
});

/**
 * §7.1's caps, as schema rather than as advice: "Aim for ≤16 colors, ≤8 spacing
 * steps." A token set that blew the cap is a clustering that did not happen,
 * and `bg-[#1a73e8]` scattered through the output is §8's stated symptom of it.
 */
export const DesignTokensSchema = z.strictObject({
  colors: z.array(DesignTokenSchema).max(16),
  spacing: z.array(DesignTokenSchema).max(8),
  radii: z.array(DesignTokenSchema).max(6),
  shadows: z.array(DesignTokenSchema).max(6),
  fontSizes: z.array(DesignTokenSchema).max(10),
});

/**
 * §8: "bundle only self-hostable, permissively licensed fonts. For licensed
 * webfonts, substitute a metric-compatible open alternative and record the swap
 * in `GAPS.md`. Do not rehost licensed WOFF2 files."
 *
 * The substitution branch cannot be represented without its gap.
 */
export const FontPlanSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('bundled'),
    family: z.string().min(1),
    assetSha256: Sha256Schema,
    licence: z.string().min(1),
  }),
  z.strictObject({
    source: z.literal('substituted'),
    family: z.string().min(1),
    substitutedWith: z.string().min(1),
    reason: z.enum(['licence-forbids-rehosting', 'not-self-hostable']),
    gapId: GapIdSchema,
  }),
  z.strictObject({ source: z.literal('system'), family: z.string().min(1) }),
]);

/**
 * §8: "SVGs inlined as components; raster assets copied into `public/` under
 * their content hash."
 *
 * A decision per asset, not a copy of the asset index: the index says what was
 * downloaded, this says what gets written and under what name.
 */
export const AssetPlanSchema = z.discriminatedUnion('emit', [
  z.strictObject({
    emit: z.literal('inline-svg'),
    sha256: Sha256Schema,
    componentName: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    originalUrls: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    emit: z.literal('public-file'),
    sha256: Sha256Schema,
    publicPath: z.string().regex(/^\/[\w./-]+$/, 'expected a path under public/'),
    originalUrls: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({
    emit: z.literal('omitted'),
    sha256: Sha256Schema,
    gapId: GapIdSchema,
    originalUrls: z.array(z.string().min(1)).min(1),
  }),
]);

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Where a piece of rendered text or an attribute value comes from. */
export const BindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), text: z.string() }),
  z.strictObject({ kind: z.literal('prop'), prop: FieldNameSchema }),
  z.strictObject({
    kind: z.literal('entity-field'),
    entity: EntityNameSchema,
    field: FieldNameSchema,
  }),
]);

export const ComponentIdSchema = z.string().regex(/^cmp_[a-z0-9]+(-[a-z0-9]+)*$/, 'expected cmp_<kebab-name>');

/**
 * A state a rule in the captured stylesheet defined for this element.
 *
 * Carried as *classes to apply under a condition* rather than as the original
 * selector: codegen emits Tailwind variants, and a selector would have to be
 * re-parsed downstream to do that. §6 extracts them from the CSSOM; this is the
 * form they take once they belong to a component rather than to a page.
 */
export const StateVariantSchema = z.strictObject({
  state: z.enum([
    'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'checked',
    'indeterminate', 'disabled', 'enabled', 'target', 'visited', 'open',
  ]),
  classes: z.array(z.string().min(1)).min(1),
});

export interface ElementNodeShape {
  tag: string;
  role: string | null;
  classes: string[];
  attributes: Array<{ name: string; value: z.infer<typeof BindingSchema> }>;
  stateVariants: Array<z.infer<typeof StateVariantSchema>>;
  /**
   * §10: codegen emits `data-sf-entity="product:MUG-BLUE"` "from the mock
   * backend's own ids". Which node carries it is a judgement about what the
   * subtree *is*, which is precisely what capture cannot make.
   */
  entityAnchor: { entity: string; keyField: string } | null;
  children: ChildNodeShape[];
}

export type ChildNodeShape =
  | { kind: 'element'; element: ElementNodeShape }
  | { kind: 'text'; value: z.infer<typeof BindingSchema> }
  | { kind: 'component'; componentId: string; props: Array<{ name: string; value: z.infer<typeof BindingSchema> }> }
  | { kind: 'slot' }
  | { kind: 'repeat'; over: { entity: string }; itemProp: string; child: ChildNodeShape };

export const ElementNodeSchema: z.ZodType<ElementNodeShape> = z.lazy(() =>
  z.strictObject({
    tag: z.string().min(1),
    role: z.string().min(1).nullable(),
    classes: z.array(z.string().min(1)),
    attributes: z.array(z.strictObject({ name: z.string().min(1), value: BindingSchema })),
    stateVariants: z.array(StateVariantSchema),
    entityAnchor: z
      .strictObject({ entity: EntityNameSchema, keyField: FieldNameSchema })
      .nullable(),
    children: z.array(ChildNodeSchema),
  }),
);

export const ChildNodeSchema: z.ZodType<ChildNodeShape> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('element'), element: ElementNodeSchema }),
    z.strictObject({ kind: z.literal('text'), value: BindingSchema }),
    z.strictObject({
      kind: z.literal('component'),
      componentId: ComponentIdSchema,
      props: z.array(z.strictObject({ name: FieldNameSchema, value: BindingSchema })),
    }),
    /** Where a layout's page content goes. Layouts have exactly one. */
    z.strictObject({ kind: z.literal('slot') }),
    z.strictObject({
      kind: z.literal('repeat'),
      over: z.strictObject({ entity: EntityNameSchema }),
      itemProp: FieldNameSchema,
      child: ChildNodeSchema,
    }),
  ]),
);

export const ComponentPropSchema = z.strictObject({
  name: FieldNameSchema,
  type: z.enum(['string', 'number', 'boolean', 'entity', 'node']),
  required: z.boolean(),
  entity: EntityNameSchema.nullable(),
});

/**
 * §7.2: "A subtree appearing ≥3 times with varying leaf text is a component
 * with props."
 *
 * The threshold is in the schema, over **distinct routes and occurrences**, so
 * a one-off subtree promoted to a component does not parse. A `template` is
 * exempt: a page shell legitimately appears once.
 */
export const ComponentSchema = z
  .strictObject({
    componentId: ComponentIdSchema,
    /** Named from a11y names and content (§7.2), never `Div7`. */
    name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
    kind: z.enum(['primitive', 'composite', 'template']),
    props: z.array(ComponentPropSchema),
    root: ElementNodeSchema,
    evidence: z.strictObject({
      occurrences: z.int().positive(),
      distinctRoutes: z.int().positive(),
      varyingLeaves: z.int().nonnegative(),
    }),
    derivedFrom: z.strictObject({ routeIds: z.array(RouteIdSchema).min(1) }),
  })
  .superRefine((component, ctx) => {
    if (component.kind !== 'template' && component.evidence.occurrences < 3) {
      ctx.addIssue({
        code: 'custom', path: ['evidence', 'occurrences'],
        message: `§7.2 extracts a component from a subtree seen at least 3 times; this one was seen ${component.evidence.occurrences}. Two occurrences is a coincidence.`,
      });
    }
    // Evidence that is not checked is a field with a story attached. A
    // component claiming three distinct routes has to name at least three.
    if (component.derivedFrom.routeIds.length < component.evidence.distinctRoutes) {
      ctx.addIssue({
        code: 'custom', path: ['derivedFrom', 'routeIds'],
        message: `claims ${component.evidence.distinctRoutes} distinct routes but names ${component.derivedFrom.routeIds.length}`,
      });
    }
    if (component.props.length > 0 && component.evidence.varyingLeaves === 0) {
      ctx.addIssue({
        code: 'custom', path: ['props'],
        message: 'a component with props needs leaves that varied between occurrences; nothing varied here, so the props are invented',
      });
    }
  });

// ---------------------------------------------------------------------------
// Layouts and routes
// ---------------------------------------------------------------------------

export const LayoutSchema = z.strictObject({
  layoutId: z.string().regex(/^lay_[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
  /** §7.3's "shared shell, nav, footer", with one `slot` for the page. */
  root: ElementNodeSchema,
});

/**
 * §7.3: routes grouped by shared structure, one template per pattern.
 *
 * `instances` names the captured routes this template was generalised from, and
 * §9's visual gate reads it — a template with nowhere to compare against is a
 * page the visual gate silently skips.
 */
export const RouteTemplateSchema = z.strictObject({
  templateId: z.string().regex(/^tpl_[a-z0-9]+(-[a-z0-9]+)*$/),
  pathPattern: z.string().regex(/^\//),
  layoutId: z.string().min(1),
  content: ChildNodeSchema,
  /** Operations the page calls to fill itself. Codegen wires the fetch. */
  dataSources: z.array(EndpointIdSchema),
  instances: z.array(RouteIdSchema).min(1),
  /** §6: the clone must reproduce redirect-to-login. */
  requiresAuth: z.boolean(),
  unauthenticatedBehavior: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('redirect'), to: z.string().min(1) }),
      z.strictObject({ kind: z.literal('status'), status: z.int().min(100).max(599) }),
      z.strictObject({ kind: z.literal('renders-anyway') }),
    ])
    .nullable(),
});

export type DesignTokens = z.infer<typeof DesignTokensSchema>;
export type FontPlan = z.infer<typeof FontPlanSchema>;
export type AssetPlan = z.infer<typeof AssetPlanSchema>;
export type Binding = z.infer<typeof BindingSchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type RouteTemplate = z.infer<typeof RouteTemplateSchema>;
