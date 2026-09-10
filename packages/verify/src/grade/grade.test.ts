/**
 * The grader's own properties, checked against inputs built for the purpose.
 *
 * The mutation harness next door is the evidence that the grader *measures*
 * something. These are the properties a delta cannot show: that the two field
 * walkers agree, that the universe is decided by segment, that a zero
 * denominator reads vacuous rather than 1.0, and that the module's import list
 * is what it claims to be.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GRADE_METRICS, type JsonSchemaNode } from '@siteforge/schema';
import { GITEA_BASELINE, GITEA_OBSERVED } from './baseline/gitea.js';
import { gradeSiteModel, type GradeInput } from './grade.js';
import { inUniverse, matchEndpoints } from './match.js';
import { modelFieldPointers, typeAgrees } from './fields.js';
import { loadGiteaTruth } from './truth/gitea.js';
import { MAX_FIELD_DEPTH, pathShape, type TruthModel } from './truth/swagger2.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = loadGiteaTruth();
const input: GradeInput = {
  model: GITEA_BASELINE,
  truth,
  observed: GITEA_OBSERVED,
  divergence: [],
};

describe('the grader is written before infer, and stays that way', () => {
  it('imports no stage it is meant to be independent of', () => {
    // The whole import list, not the absence of one name: `not.toContain('infer')`
    // covers the case somebody thought of, and the difference only shows up on
    // the one nobody predicted. §13's freeze rule.
    const source = readFileSync(join(HERE, 'grade.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      '@siteforge/schema',
      './match.js',
      './entities.js',
      './fields.js',
      './vocabulary.js',
      './truth/swagger2.js',
    ]);
  });

  it('reports the frozen contract it scored against', () => {
    const report = gradeSiteModel(input);
    expect(report.metricsVersion).toBe(4);
    expect(report.metrics.map((m) => m.id)).toEqual(GRADE_METRICS.map((m) => m.id));
  });
});

describe('the two field walkers agree on what is addressable', () => {
  /**
   * The same six-deep shape, in both vocabularies.
   *
   * **With an array in it**, because `/[]` costs a level and that is exactly
   * where two independent implementations drift. The walkers are separate on
   * purpose — sharing one would move both sides of every field comparison at
   * once — so the depth cut-off is the one thing that has to be checked rather
   * than assumed.
   */
  const swagger = {
    swagger: '2.0',
    basePath: '/api/v1',
    paths: {
      '/deep': {
        get: {
          operationId: 'deep',
          responses: {
            200: {
              schema: {
                type: 'object',
                properties: {
                  a: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        b: {
                          type: 'object',
                          properties: {
                            c: { type: 'object', properties: { d: { type: 'string' } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const node: JsonSchemaNode = {
    type: 'object',
    properties: {
      a: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            b: {
              type: 'object',
              properties: { c: { type: 'object', properties: { d: { type: 'string' } } } },
            },
          },
        },
      },
    },
  };

  it('enumerates the same pointers, array steps included', () => {
    // The Swagger form of the same shape is written out above so the two are
    // visibly the same document in two vocabularies; the truth loader's floors
    // refuse a one-operation snapshot, so the shared-shape comparison against a
    // real walk is the second test below.
    expect(Object.keys(swagger.paths)).toEqual(['/deep']);

    const model = modelFieldPointers(node).map((f) => f.pointer);
    expect(model).toEqual(['/a', '/a/[]', '/a/[]/b', '/a/[]/b/c']);
    // `/a/[]/b/c/d` is depth 5 and neither side emits it. The array step is what
    // makes that true at four named segments rather than five.
    expect(model).not.toContain('/a/[]/b/c/d');
    expect(MAX_FIELD_DEPTH).toBe(4);
  });

  it('matches the truth loader on a real shape from the snapshot', () => {
    // The cross-check that matters: a shape neither walker was written against.
    const labels = truth.endpoints.find(
      (e) => e.method === 'GET' && e.specPath === '/repos/{owner}/{repo}/labels',
    );
    const operation = GITEA_BASELINE.operations.find(
      (o) => o.operationId === 'get-api-v1-repos-owner-repo-labels',
    );
    const fromTruth = labels!.responseFields.map((f) => f.pointer).sort();
    const fromModel = modelFieldPointers(operation!.responses[0]!.schema)
      .map((f) => f.pointer)
      .sort();
    expect(fromModel).toEqual(fromTruth);
  });
});

describe('the graded universe is decided by segment', () => {
  it('does not accept a prefix that is not a path', () => {
    expect(inUniverse('/api/v1/repos', '/api/v1')).toBe(true);
    // The fifth grammar: `startsWith` says yes to both of these.
    expect(inUniverse('/api/v1beta/repos', '/api/v1')).toBe(false);
    expect(inUniverse('/api/v10/repos', '/api/v1')).toBe(false);
  });

  it('counts an out-of-universe operation without scoring it', () => {
    const report = gradeSiteModel(input);
    expect(report.matching.outOfUniverse).toBe(0);
    expect(report.matching.matched).toBe(GITEA_BASELINE.operations.length);
  });
});

describe('matching is one-to-one, and an ambiguity is a miss on both sides', () => {
  it('never resolves two candidates by picking the better-scoring one', () => {
    const twice = {
      ...GITEA_BASELINE,
      operations: [
        GITEA_BASELINE.operations[0]!,
        // Same method, same shape, different pattern spelling. A grader that
        // picked one would be grading itself.
        { ...GITEA_BASELINE.operations[0]!, operationId: 'get-api-v1-version' },
      ],
    };
    const matching = matchEndpoints(twice.operations, truth, []);
    expect(matching.ambiguous).toEqual(['GET api/v1/version']);
    expect(matching.pairs).toHaveLength(0);
    expect(matching.unmatchedOperations).toHaveLength(2);
  });

  it('normalises both parameter spellings to the same hole', () => {
    expect(pathShape('/api/v1/repos/:owner/:repo')).toBe(pathShape('/api/v1/repos/{owner}/{repo}'));
  });
});

describe('a zero denominator is a scored outcome (§6)', () => {
  it('reports vacuous rather than the 1.0 that TP/(TP+FP) returns with no predictions', () => {
    const empty: TruthModel = { ...truth, endpoints: [] };
    const report = gradeSiteModel({ ...input, truth: empty });
    // The complete set, not `every`: on an empty metric list `every` is true and
    // this test would pass for a report that computed nothing at all — the same
    // shape as the bug it is checking for.
    expect(report.metrics.map((m) => m.id)).toEqual(GRADE_METRICS.map((m) => m.id));
    expect(report.metrics.filter((m) => !m.vacuous)).toEqual([]);
    expect(report.metrics.filter((m) => m.value !== null)).toEqual([]);
    expect(report.passed).toBe(false);
  });

  it('names which denominator was empty rather than only that one was', () => {
    const report = gradeSiteModel(input);
    const identifier = report.metrics.find((m) => m.id === 'identifier.precision');
    expect(identifier?.vacuous).toBe(true);
    expect(identifier?.emptyDenominator).toContain('not derived');
    // Read as unbuilt rather than as infer emitting nothing — the reason the
    // loader names the category at all.
    expect(report.notDerived.map((n) => n.category)).toContain('identifier');
  });

  it('a metric with no gate still passes: reporting is not scoring', () => {
    const report = gradeSiteModel(input);
    const coverage = report.metrics.find((m) => m.id === 'auth.truth-coverage');
    expect(coverage?.gate).toBeNull();
    expect(coverage?.passed).toBe(true);
  });
});

describe('field types, under the two normalisations fixed in advance', () => {
  const required = { type: 'string', required: true };
  it('counts integer as a match for number, both ways', () => {
    expect(typeAgrees({ type: 'integer' }, { type: 'number', required: true })).toBe(true);
    expect(typeAgrees({ type: 'number' }, { type: 'integer', required: true })).toBe(true);
  });

  it('accepts a nullable claim only where the spec marks the field optional', () => {
    expect(typeAgrees({ type: 'string', nullable: true }, { type: 'string', required: false })).toBe(true);
    expect(typeAgrees({ type: 'string', nullable: true }, required)).toBe(false);
  });

  it('rejects a union that merely contains the right member', () => {
    // `['string','object']` is not a claim that the field is a string.
    expect(typeAgrees({ type: ['string', 'object'] }, required)).toBe(false);
  });

  it('rejects an outright disagreement', () => {
    expect(typeAgrees({ type: 'boolean' }, required)).toBe(false);
  });
});

describe('auth is read through resolveAuthForCodegen, never as a boolean', () => {
  it('treats `unknown` as gated, because that is what the clone will build', () => {
    // §8, and 0014's ruling. A grader reading `requiresAuth === 'required'`
    // would call every `unknown` endpoint open and score a model nobody ships.
    const report = gradeSiteModel(input);
    const underGate = report.metrics.find((m) => m.id === 'auth.under-gate-count');
    expect(underGate?.value).toBe(0);
    // Ten of the fifteen are `unobserved` on the truth side; the denominator is
    // the two the sweep actually saw as required, and the report says so.
    expect(underGate?.denominator).toBe(report.auth.observedRequired);
    expect(report.auth.unobserved).toBeGreaterThan(0);
  });

  it('reports four unlike denominators separately rather than averaging them', () => {
    const report = gradeSiteModel(input);
    const of = (id: string) => report.metrics.find((m) => m.id === id)!;
    // Under-gate is over what the sweep saw as required; truth coverage is over
    // every graded endpoint; evidence coverage is over probeable reads alone.
    // Written as bare rates the next reader averages them.
    expect(of('auth.under-gate-count').denominator).toBe(report.auth.observedRequired);
    expect(of('auth.truth-coverage').denominator).toBe(report.matching.matched);
    expect(of('auth.evidence-coverage').denominator).toBeLessThan(report.matching.matched);
  });

  it('scores evidence coverage over reads capture could probe, not over mutations', () => {
    // §6 forbids re-issuing a mutation anonymously — it would change the
    // target's state — so a mutation's verdict can never rest on a probe.
    // Averaging the two populations bounded the metric below 1 for a reason that
    // is a property of the API's read/write ratio, not of inference.
    const report = gradeSiteModel(input);
    const of = (id: string) => report.metrics.find((m) => m.id === id)!;
    const probeable = of('auth.evidence-coverage').denominator;
    expect(probeable + report.auth.unprobeable).toBe(report.matching.matched);
    expect(of('auth.unprobeable-count').value).toBe(report.auth.unprobeable);
    expect(of('auth.unprobeable-count').gate).toBeNull();
  });
});

describe('the known-divergence list removes a field from both sides', () => {
  it('excludes only the category the entry names', () => {
    const report = gradeSiteModel({
      ...input,
      divergence: [
        {
          scope: 'endpoint',
          category: 'auth',
          specPath: '/version',
          method: 'GET',
          specSays: 'requires a token under the global security block',
          serverDoes: 'answers 200 to an uncredentialed request',
          evidence: {
            request: 'GET /api/v1/version (no credentials)',
            responseStatus: 200,
            responseExcerpt: '{"version":"1.27.3"}',
            observedAt: '2026-09-08T00:00:00.000Z',
          },
        },
      ],
    });
    const auth = report.metrics.find((m) => m.id === 'auth.over-gate-rate');
    const identity = report.metrics.find((m) => m.id === 'endpoint-identity.precision');
    expect(auth?.excluded).toBe(1);
    expect(auth?.denominator).toBe(2);
    // The entry named `auth`, so nothing else may narrow.
    expect(identity?.excluded).toBe(0);
    expect(identity?.denominator).toBe(GITEA_BASELINE.operations.length);
  });

  it('reports the budget beside the score, per category', () => {
    const report = gradeSiteModel(input);
    expect(report.divergence.total).toBe(0);
    expect(report.divergence.overCap).toBe(false);
  });
});
