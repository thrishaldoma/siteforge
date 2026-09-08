/**
 * `SiteModel` — Stage 2's output, and Stage 3's only input.
 *
 * Decision 0017. §5: "derived backwards from what codegen consumes. Do not
 * define it by forward-transforming `CaptureModel`." Two forces shaped it and
 * they were kept independent on purpose:
 *
 *   1. **What codegen consumes** — `CODEGEN_NEEDS` in `./needs.js`, one entry
 *      per sentence in §8, §9 and §10 that demands an input, each anchored to
 *      the sentence and each naming a path into this model.
 *   2. **The scored-field list** — frozen in `../grade-contract.js` before this
 *      file existed. Where a scored field was awkward to represent, this model
 *      moved; the list did not.
 *
 * And the gate that keeps them honest runs in both directions: nothing needed
 * or scored may be missing, and **nothing here may be unclaimed**. That second
 * direction is what a renamed `CaptureModel` fails — a `dom` section, or a
 * `styles` table, is a section no consumer asked for, and it fails the suite
 * rather than a review.
 */
import { z } from 'zod';
import { SiteIdSchema, Sha256Schema, EndpointIdSchema } from '../primitives.js';
import { siteArtifactEnvelope } from './artifact.js';
import { EntitySchema } from './entities.js';
import { ApiOperationSchema } from './api.js';
import {
  AssetPlanSchema, ComponentSchema, DesignTokensSchema, FontPlanSchema,
  LayoutSchema, RouteTemplateSchema, type ChildNodeShape, type ElementNodeShape,
} from './presentation.js';
import { BehaviourSchema } from './behaviour.js';

export * from './artifact.js';
export * from './entities.js';
export * from './api.js';
export * from './presentation.js';
export * from './behaviour.js';
export * from './needs.js';

/** Walk a content tree, yielding every node. Used by the cross-reference pass. */
function* walkChildren(child: ChildNodeShape): Generator<ChildNodeShape> {
  yield child;
  if (child.kind === 'element') yield* walkElement(child.element);
  if (child.kind === 'repeat') yield* walkChildren(child.child);
}

function* walkElement(element: ElementNodeShape): Generator<ChildNodeShape> {
  for (const child of element.children) yield* walkChildren(child);
}

export const SiteModelSchema = z
  .strictObject({
    ...siteArtifactEnvelope('site-model'),
    siteId: SiteIdSchema,
    /**
     * The capture this was inferred from, by content hash.
     *
     * §4's stage contract has every stage read and write files on disk, so the
     * join has to be recorded rather than remembered. §9 also needs it: the
     * visual gate compares a rendered template against the screenshots of the
     * routes it names, and those live in that capture and no other.
     */
    sourceCapture: z.strictObject({ siteId: SiteIdSchema, contentHash: Sha256Schema }),

    tokens: DesignTokensSchema,
    fonts: z.array(FontPlanSchema),
    assets: z.array(AssetPlanSchema),
    components: z.array(ComponentSchema),
    layouts: z.array(LayoutSchema).min(1),
    routes: z.array(RouteTemplateSchema).min(1),
    entities: z.array(EntitySchema),
    operations: z.array(ApiOperationSchema),
    behaviours: z.array(BehaviourSchema),
  })
  .superRefine((model, ctx) => {
    const componentIds = new Set(model.components.map((c) => c.componentId));
    const layoutIds = new Set(model.layouts.map((l) => l.layoutId));
    const templateIds = new Set(model.routes.map((r) => r.templateId));
    const entityNames = new Set(model.entities.map((e) => e.name));
    const operationIds = new Set(model.operations.map((o) => o.operationId));

    const missing = (path: (string | number)[], what: string): void => {
      ctx.addIssue({ code: 'custom', path, message: `${what} is referenced but not defined` });
    };

    for (const [i, route] of model.routes.entries()) {
      if (!layoutIds.has(route.layoutId)) missing(['routes', i, 'layoutId'], route.layoutId);
      for (const [j, source] of route.dataSources.entries()) {
        if (!operationIds.has(source)) missing(['routes', i, 'dataSources', j], source);
      }
      // A page cannot contain the hole a layout leaves for it.
      for (const node of walkChildren(route.content)) {
        if (node.kind === 'slot') {
          ctx.addIssue({
            code: 'custom', path: ['routes', i, 'content'],
            message: 'a slot belongs to a layout; a page template is what fills one',
          });
        }
        if (node.kind === 'component' && !componentIds.has(node.componentId)) {
          missing(['routes', i, 'content'], node.componentId);
        }
        if (node.kind === 'repeat' && !entityNames.has(node.over.entity)) {
          missing(['routes', i, 'content'], node.over.entity);
        }
      }
    }

    for (const [i, layout] of model.layouts.entries()) {
      const slots = [...walkElement(layout.root)].filter((n) => n.kind === 'slot').length;
      if (slots !== 1) {
        ctx.addIssue({
          code: 'custom', path: ['layouts', i, 'root'],
          message: `a layout has exactly one slot for its page; this one has ${slots}`,
        });
      }
    }

    for (const [i, component] of model.components.entries()) {
      for (const node of walkElement(component.root)) {
        if (node.kind === 'component' && !componentIds.has(node.componentId)) {
          missing(['components', i, 'root'], node.componentId);
        }
      }
      const anchors = [component.root, ...[...walkElement(component.root)]
        .flatMap((n) => (n.kind === 'element' ? [n.element] : []))];
      for (const element of anchors) {
        const anchor = element.entityAnchor;
        if (anchor !== null && !entityNames.has(anchor.entity)) {
          missing(['components', i, 'root'], anchor.entity);
        }
      }
    }

    for (const [i, operation] of model.operations.entries()) {
      const effect = operation.effect;
      if ('entity' in effect && !entityNames.has(effect.entity)) {
        missing(['operations', i, 'effect', 'entity'], effect.entity);
      }
      if (effect.kind === 'session-create' && !entityNames.has(effect.identityEntity)) {
        missing(['operations', i, 'effect', 'identityEntity'], effect.identityEntity);
      }
    }

    for (const [i, behaviour] of model.behaviours.entries()) {
      if (!templateIds.has(behaviour.trigger.onTemplate)) {
        missing(['behaviours', i, 'trigger', 'onTemplate'], behaviour.trigger.onTemplate);
      }
      for (const [j, call] of behaviour.networkCalls.entries()) {
        if (!operationIds.has(call)) missing(['behaviours', i, 'networkCalls', j], call);
      }
    }

    // §8 builds a store table per entity. One nothing reads or writes is a
    // table the clone carries and no trajectory can ever touch — which means
    // the entity was inferred from something other than the API surface, and
    // saying so now beats debugging an empty table in the clone.
    const touched = new Set<string>();
    for (const operation of model.operations) {
      const effect = operation.effect;
      if ('entity' in effect) touched.add(effect.entity);
      if (effect.kind === 'session-create') touched.add(effect.identityEntity);
    }
    for (const [i, entity] of model.entities.entries()) {
      if (!touched.has(entity.name)) {
        ctx.addIssue({
          code: 'custom', path: ['entities', i, 'name'],
          message: `no operation reads or writes ${entity.name}; codegen would emit a store table nothing can reach`,
        });
      }
    }

    // Seeds have to come from operations that exist, or `reset` loads rows
    // nothing can explain.
    for (const [i, entity] of model.entities.entries()) {
      for (const [j, from] of (entity.seed?.derivedFrom ?? []).entries()) {
        if (!operationIds.has(from)) missing(['entities', i, 'seed', 'derivedFrom', j], from);
      }
    }
  });

export type SiteModel = z.infer<typeof SiteModelSchema>;

/**
 * §8 seeds the store "from real captured responses after scrubbing", and this
 * is that plan — derived, not stored. A `seeds` section would be a second copy
 * of a fact the entities already carry, and turn 2's ruling on
 * `manifest.counts.gaps` is that one side computes and the other references.
 */
export function seedSources(model: SiteModel): Array<{ entity: string; from: readonly string[] }> {
  return model.entities.map((entity) => ({
    entity: entity.name,
    from: entity.seed?.derivedFrom ?? [],
  }));
}

/** Endpoints §8 will gate because nothing was ever observed (0014). */
export function authUnknownOperations(model: SiteModel): string[] {
  return model.operations
    .filter((o) => o.requiresAuth === 'unknown')
    .map((o) => o.operationId satisfies z.infer<typeof EndpointIdSchema>)
    .sort();
}
