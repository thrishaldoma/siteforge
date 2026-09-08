/**
 * The two forces, checked — and checked in the direction that can fail.
 *
 * Decision 0017. The forward direction (nothing needed is missing) is easy to
 * satisfy and easy to satisfy *vacuously*: a model containing everything
 * contains everything needed. The backward direction (nothing here is
 * unclaimed) is the one a renamed `CaptureModel` fails, so most of this file is
 * about proving that direction fires.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CAPTURE_MODEL_VERSION,
  CODEGEN_NEEDS,
  EVIDENCE_REQUIRED,
  GRADE_CATEGORIES,
  SCORED_FIELD_PATHS,
  SITE_MODEL_VERSION,
  SiteModelSchema,
  assessModelCoverage,
  claimCovers,
  schemaLeafPaths,
} from '../index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('the model is claimed in both directions', () => {
  const coverage = assessModelCoverage(SiteModelSchema);

  it('resolves every claim, leaves nothing unclaimed, and names no whole section', () => {
    expect(coverage.unresolved, 'a consumer reads a path the model does not have').toEqual([]);
    expect(coverage.unclaimed, 'the model carries a field no consumer asked for').toEqual([]);
    expect(coverage.tooCoarse, 'a claim covers a whole section').toEqual([]);
    // A floor, so a walker that silently stopped enumerating cannot report
    // perfect coverage of nothing.
    expect(coverage.leaves.length).toBeGreaterThan(100);
  });

  /**
   * The discriminating case: a model that reads as a renamed `CaptureModel`.
   *
   * It passes the forward check — everything needed is still there — and fails
   * here, on the section nothing in §8, §9 or §10 asks for. This is what makes
   * "infer earned nothing" a failing test rather than a judgement call.
   */
  it('rejects a section no consumer asked for — a forward-transformed capture', () => {
    const renamed = z.strictObject({
      ...(SiteModelSchema as unknown as { shape?: never }, {}),
      siteId: z.string(),
      dom: z.array(z.strictObject({ nodeId: z.string(), tag: z.string() })),
      styles: z.array(z.strictObject({ styleId: z.string(), declarations: z.string() })),
    });
    const result = assessModelCoverage(renamed);
    expect(result.unclaimed.sort()).toEqual([
      'dom.nodeId', 'dom.tag', 'styles.declarations', 'styles.styleId',
    ]);
  });

  /**
   * The realistic failure, which is not a bogus section: a legitimate section
   * quietly growing a field nobody consumes.
   */
  it('rejects a new field accreting inside a section that is otherwise claimed', () => {
    const withExtra = z.strictObject({
      siteId: z.string(),
      operations: z.array(z.strictObject({
        method: z.string(), pathPattern: z.string(),
        cacheHint: z.string(),
      })),
    });
    expect(assessModelCoverage(withExtra).unclaimed).toEqual(['operations.cacheHint']);
  });

  it('rejects a claim on a path the model does not have', () => {
    const shrunk = z.strictObject({ siteId: z.string() });
    const result = assessModelCoverage(shrunk);
    expect(result.unresolved.length).toBeGreaterThan(10);
    expect(result.unresolved.map((u) => u.path)).toContain('operations.effect');
  });

  /**
   * The negative case (§13). Everything above removes or adds something and
   * watches the gate react; none of them can tell that apart from a gate that
   * rejects every schema it is handed.
   */
  it('holds still for a model that only reorders and renames nothing', () => {
    const reordered = z.strictObject({
      behaviours: SiteModelSchema.shape.behaviours,
      operations: SiteModelSchema.shape.operations,
      ...SiteModelSchema.shape,
    });
    const result = assessModelCoverage(reordered);
    expect(result.unclaimed).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });
});

describe('the committed fixture is a model derived from a real capture', () => {
  const model = SiteModelSchema.parse(JSON.parse(readFileSync(
    join(HERE, '..', '..', 'fixtures', 'infer', 'northwind-supply', 'site-model.json'), 'utf8')));

  it('names the capture it came from', () => {
    expect(model.sourceCapture.siteId).toBe('northwind-supply');
    expect(model.sourceCapture.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('substitutes the one licensed font and records the gap (§8)', () => {
    // Derived: `styles.json` marks Söhne `licensed`. Rehosting it is the thing
    // §8 forbids by name, so the only representable outcome carries a gap.
    const substituted = model.fonts.filter((f) => f.source === 'substituted');
    expect(substituted).toHaveLength(1);
    expect(substituted[0]).toMatchObject({ family: 'Söhne', reason: 'licence-forbids-rehosting' });
  });

  it('leaves checkout unclassified rather than guessing it is a create', () => {
    // The single captured exchange does not say which request field lands in
    // which Order column. §7: when confidence is low, a gap, not an invention —
    // and `custom` is the only effect that cannot be written without a gapId.
    const checkout = model.operations.find((o) => o.operationId === 'post-api-checkout');
    expect(checkout?.effect.kind).toBe('custom');
  });

  it('reads a foreign key off observed path-parameter values, not off a name', () => {
    // `slug` is the identifier because /api/products/:slug was observed with
    // those values — `categoryId` is not, despite the name §7.5 warns about.
    const product = model.entities.find((e) => e.name === 'Product');
    const by = Object.fromEntries((product?.fields ?? []).map((f) => [f.name, f.pathParamOf]));
    expect(by['slug']).toEqual(['get-api-products-slug']);
    expect(by['categoryId']).toEqual([]);
  });

  it('anchors the entity subtree on a business key (§10)', () => {
    const card = model.components.find((c) => c.name === 'ProductCard');
    expect(card?.root.entityAnchor).toEqual({ entity: 'Product', keyField: 'sku' });
    expect(card?.evidence.occurrences).toBeGreaterThanOrEqual(3);
  });

  it('has a credential column the response never returned, and no credential value', () => {
    // An entity's fields are what the API takes as well as what it gives back.
    // The seed comes from the response, so no password value exists anywhere.
    const account = model.entities.find((e) => e.name === 'Account');
    expect(account?.fields.map((f) => f.name)).toContain('password');
    expect(JSON.stringify(account?.seed?.rows)).not.toContain('password');
  });

  it('carries only tokens, never raw values, on a component (§8)', () => {
    const classes = model.components.flatMap((c) => c.root.classes);
    for (const cls of classes) expect(cls).not.toMatch(/#[0-9a-f]{3,8}|rgb\(/i);
  });
});

describe('a model path is compared by segment (§13)', () => {
  it('does not let a claim cover a longer sibling name', () => {
    expect(claimCovers('routes.template', 'routes.templateId')).toBe(false);
    expect(claimCovers('routes.templateId', 'routes.templateId')).toBe(true);
    expect(claimCovers('routes', 'routes.templateId')).toBe(true);
  });
});

describe('the frozen scored-field list constrains the model, not the reverse', () => {
  it('every scored category names at least one path, and every path exists', () => {
    const leaves = schemaLeafPaths(SiteModelSchema);
    for (const category of GRADE_CATEGORIES) {
      const paths = SCORED_FIELD_PATHS[category];
      expect(paths.length, `${category} is scored but reads nothing`).toBeGreaterThan(0);
      for (const path of paths) {
        expect(leaves.some((leaf) => claimCovers(path, leaf)), `${category} reads ${path}`).toBe(true);
      }
    }
  });

  it('covers exactly the categories the contract declares', () => {
    // Whole-set, so a category added to the contract without a path here fails
    // rather than being silently unscored.
    expect(Object.keys(SCORED_FIELD_PATHS).sort()).toEqual([...GRADE_CATEGORIES].sort());
  });
});

describe('every need traces to the operating manual', () => {
  it('quotes the sentence that demands it', () => {
    for (const need of CODEGEN_NEEDS) {
      expect(need.source, `${need.id} has no source`).toMatch(/^§/);
      expect(need.quote.length, `${need.id} has no quote`).toBeGreaterThan(20);
      expect(need.emits.length).toBeGreaterThan(5);
      expect(need.reads.length).toBeGreaterThan(0);
    }
  });

  /**
   * The evidence claimant is the cheapest way to make an unclaimed leaf go
   * away, which makes it the one place the backward gate could be talked out
   * of. `enforcedBy` as prose would be a story; this opens the file it names
   * and checks the refinement really reads the field.
   *
   * Crude on purpose — it looks for the field's last segment inside the
   * `superRefine` body. A false pass needs someone to mention the name without
   * using it, which is a different and much smaller lie than the one this stops.
   */
  it('checks that every evidence field is actually read by the refinement it names', () => {
    expect(EVIDENCE_REQUIRED.length).toBeGreaterThan(0);
    for (const claim of EVIDENCE_REQUIRED) {
      const source = readFileSync(join(HERE, claim.file), 'utf8');
      expect(source, `${claim.path}: ${claim.file} has no ${claim.schema}`).toContain(claim.schema);
      const body = source.slice(source.indexOf(`export const ${claim.schema}`));
      const refinement = body.slice(body.indexOf('.superRefine('));
      const field = claim.path.split('.').pop()!;
      expect(refinement.slice(0, 2000), `${claim.schema} never reads ${field}`).toContain(`.${field}`);
      expect(claim.why.length).toBeGreaterThan(20);
    }
  });
});

describe('SiteModel is not a capture artifact', () => {
  it('stamps its own version, which today happens to equal the capture one', () => {
    // Deliberately not `expect(SITE).not.toBe(CAPTURE)`: both are '1.0.0'
    // right now, so that assertion would fail today and start passing the day
    // they diverge — a test that only works on some days is worse than none.
    // What matters is which constant the envelope is built from, so that is
    // what is asserted, at the source.
    expect(SiteModelSchema.shape.modelVersion.parse(SITE_MODEL_VERSION)).toBe(SITE_MODEL_VERSION);
    const envelope = readFileSync(join(HERE, 'artifact.ts'), 'utf8');
    expect(envelope).toContain('z.literal(SITE_MODEL_VERSION)');
    // The whole import, not the absence of one name: the prose above the code
    // in that file mentions the capture version on purpose, and a text search
    // cannot tell an explanation from a dependency.
    const versionImport = /import \{([^}]*)\} from '\.\.\/version\.js';/.exec(envelope);
    expect(versionImport?.[1]?.split(',').map((n) => n.trim())).toEqual(['SITE_MODEL_VERSION']);
    expect(CAPTURE_MODEL_VERSION.length).toBeGreaterThan(0);
  });

  /**
   * The freeze, in whole-set form (§13): the exact set of modules this
   * directory reaches into, not the absence of the one that would be
   * embarrassing. `capture-model.js` missing from a hand-written deny-list
   * proves nothing about `route.js` or `dom.js`; this list has nowhere for them
   * to hide, and the shared vocabulary it *does* import — auth, JSON Schema,
   * identity — is deliberate and visible.
   */
  it('imports exactly the shared vocabulary, and no capture artifact module', () => {
    const files = readdirSync(HERE).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    const imported = new Set<string>();
    for (const file of files) {
      const source = readFileSync(join(HERE, file), 'utf8');
      for (const match of source.matchAll(/from '\.\.\/([a-z-]+)\.js'/g)) imported.add(match[1]!);
    }
    expect([...imported].sort()).toEqual([
      'artifact', 'auth', 'controls', 'gap', 'grade-contract', 'identity',
      'json-schema', 'primitives', 'version',
    ]);
  });
});
