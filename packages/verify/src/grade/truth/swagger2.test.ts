/**
 * The ground truth loads, or says nothing at all.
 *
 * Decision 0015. Three kinds of test here, and the third is the one §13 added
 * this round:
 *
 *   - it loads what was measured (the snapshot is not silently thin);
 *   - each floor fires when the thing it protects is removed;
 *   - **and at least one perturbation must leave a value exactly where it was.**
 *     A loader that reacts to every change is as uninformative as one that
 *     reacts to none.
 */
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TruthLoadError,
  type Snapshot,
  classifyAnonymousStatus,
  pathParameterNames,
  pathShape,
} from './swagger2.js';
import { buildGiteaTruth, loadGiteaTruth } from './gitea.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures', 'gitea');

interface EditableSnapshot {
  pin: Record<string, unknown>;
  probe: { entries: Array<{ method: string; specPath: string; status: number | null }> };
}

/** A copy of the snapshot with one file rewritten, for the floor tests. */
function snapshotWith(edit: (files: EditableSnapshot) => void): string {
  const root = mkdtempSync(join(tmpdir(), 'sf-truth-'));
  cpSync(FIXTURES, root, { recursive: true });
  const files: EditableSnapshot = {
    pin: JSON.parse(readFileSync(join(root, 'pin.json'), 'utf8')),
    probe: JSON.parse(readFileSync(join(root, 'anon-probe.json'), 'utf8')),
  };
  edit(files);
  writeFileSync(join(root, 'pin.json'), JSON.stringify(files.pin));
  writeFileSync(join(root, 'anon-probe.json'), JSON.stringify(files.probe));
  return root;
}

/** The committed snapshot as a value, for the callers that take one. */
function readCommittedSnapshot(): Snapshot {
  const specBytes = readFileSync(join(FIXTURES, 'swagger.v1.json'));
  return {
    spec: JSON.parse(specBytes.toString('utf8')),
    specBytes,
    pin: JSON.parse(readFileSync(join(FIXTURES, 'pin.json'), 'utf8')),
    probe: JSON.parse(readFileSync(join(FIXTURES, 'anon-probe.json'), 'utf8')),
  };
}

describe('the pinned Gitea snapshot is the ground truth', () => {
  const truth = loadGiteaTruth();

  it('loads the surface that was measured against the pinned digest', () => {
    expect(truth.counts).toMatchObject({ paths: 308, operations: 482, definitions: 222 });
    expect(truth.image).toMatch(/^gitea\/gitea@sha256:/);
  });

  it('carries both auth classes, which the document could not have supplied', () => {
    // The measurement that rewrote §4: one global `security` block, no operation
    // overriding it, and 13 of 50 zero-parameter GETs answering 200 anyway.
    expect(truth.counts.authNotRequired).toBe(13);
    expect(truth.counts.authRequired).toBe(37);
  });

  it('reports how much of the surface the sweep actually covered', () => {
    // 432 unobserved, because parameterised endpoints need a seeded instance.
    // Stated, not implied: a denominator quietly covering 50 of 482 endpoints
    // while the report reads whole-surface is the failure this field prevents.
    expect(truth.counts.authUnobserved).toBe(482 - 50);
  });

  it('enumerates response and request fields through $ref, including enums', () => {
    const issues = truth.endpoints.find((e) => e.method === 'GET' && e.specPath === '/repos/{owner}/{repo}/issues');
    expect(issues?.responseFields.some((f) => f.pointer === '/[]/state')).toBe(true);
    const post = truth.endpoints.find((e) => e.method === 'POST' && e.specPath === '/repos/{owner}/{repo}/issues');
    expect(post?.requestFields.some((f) => f.pointer === '/title')).toBe(true);
    expect(truth.endpoints.flatMap((e) => e.responseFields).some((f) => f.enumValues !== null)).toBe(true);
  });

  it('names the category whose truth side it does not derive', () => {
    // Rather than letting it score. §6 makes an empty truth side vacuous and
    // failing; this says the failure is "unbuilt", not "infer missed it".
    expect(truth.notDerived.map((n) => n.category)).toEqual(['identifier']);
  });
});

describe('a path shape is built from segments (§2, §13)', () => {
  it('does not confuse a prefix for a path', () => {
    expect(pathShape('/api/v1/repos')).not.toBe(pathShape('/api/v1/repos-archive'));
  });

  it('normalises both parameter spellings to the same positional hole', () => {
    expect(pathShape('/api/v1/repos/{owner}/{repo}/issues')).toBe('api/v1/repos/*/*/issues');
    expect(pathShape('/api/v1/repos/:owner/:repo/issues')).toBe('api/v1/repos/*/*/issues');
  });

  /**
   * The negative case (§13), at the level where it starts.
   *
   * §2 scores parameter names and refuses to match on them, because capture
   * infers a name from observed values and cannot know the document calls it
   * `owner`. If renaming moved the shape, every endpoint would be a miss for a
   * cosmetic reason and the real misses would be invisible underneath. So the
   * rename has to leave the shape byte-identical — and the arity change beside
   * it has to move it, or this is just an assertion that a function is constant.
   */
  it('holds the shape still when a parameter is renamed, and moves it when arity changes', () => {
    const original = '/api/v1/repos/{owner}/{repo}/issues';
    expect(pathShape('/api/v1/repos/{login}/{project}/issues')).toBe(pathShape(original));
    expect(pathParameterNames('/api/v1/repos/{login}/{project}/issues')).toEqual(['login', 'project']);
    expect(pathShape('/api/v1/repos/{owner}/issues')).not.toBe(pathShape(original));
  });
});

describe('an anonymous status is classified fail-closed for the auth category', () => {
  it('reads 200 as public and 401/403 as gated', () => {
    expect(classifyAnonymousStatus(200)).toBe('not-required');
    expect(classifyAnonymousStatus(401)).toBe('required');
    expect(classifyAnonymousStatus(403)).toBe('required');
  });

  it('reads 404 as gated, never as absent', () => {
    // Gitea answers 404 rather than 403 for resources it will not confirm exist
    // to an anonymous caller. Reading that as "not a real endpoint" would delete
    // a gated endpoint from the truth set and turn a correct inference into a
    // hallucination — a wrong answer in a second category, caused by a default
    // chosen in this one.
    expect(classifyAnonymousStatus(404), 'a 404 to an anonymous caller must classify as required, never absent')
      .toBe('required');
  });

  it('says indeterminate when it cannot decide, rather than guessing', () => {
    expect(classifyAnonymousStatus(null)).toBe('indeterminate');
    expect(classifyAnonymousStatus(500)).toBe('indeterminate');
  });
});

describe('a truth that did not load reports nothing (§6)', () => {
  it('throws when the public set is empty, naming the denominator that would go vacuous', () => {
    const root = snapshotWith(({ probe }) => {
      for (const entry of probe.entries) if (entry.status === 200) entry.status = 401;
    });
    expect(() => loadGiteaTruth({ root })).toThrow(TruthLoadError);
    expect(() => loadGiteaTruth({ root })).toThrow(/over-gate denominator would be zero/);
  });

  it('throws when the gated set is empty', () => {
    const root = snapshotWith(({ probe }) => {
      probe.entries = probe.entries.filter((e) => e.status === 200);
    });
    expect(() => loadGiteaTruth({ root })).toThrow(/anonymous sweep did not run/);
  });

  it('throws when pin.json and the spec beside it disagree', () => {
    const root = snapshotWith(({ pin }) => { pin['specSha256'] = 'b'.repeat(64); });
    expect(() => loadGiteaTruth({ root })).toThrow(/hand-edited/);
  });

  it('throws with an instruction when there is no snapshot at all', () => {
    const empty = mkdtempSync(join(tmpdir(), 'sf-truth-empty-'));
    expect(() => loadGiteaTruth({ root: empty })).toThrow(/snapshot\.mjs gitea --write/);
  });

  /**
   * The negative case again, for the floors. Every test above removes something
   * and watches the loader refuse; this one changes something the floors have no
   * business caring about and watches it load unchanged. Without it, a loader
   * that threw on any edited snapshot would pass all four.
   */
  it('loads unchanged when an unrelated pin field moves', () => {
    const root = snapshotWith(({ pin }) => { pin['tagAtPull'] = 'irrelevant'; pin['hostPort'] = 9999; });
    const truth = loadGiteaTruth({ root });
    expect(truth.counts).toEqual(loadGiteaTruth().counts);
  });
});

/**
 * The categories this loader does not yet supply a truth side for.
 *
 * §13: a known gap recorded only in prose is not tracked — it is a failing
 * gate, a skipped test naming it, or it is not tracked at all. `notDerived` is
 * a field, and no grader reads it yet, so the field alone is prose in JSON.
 * This is the skipped test.
 */
/**
 * The floors, driven directly rather than through a copied directory.
 *
 * The tests above reach them by writing a temp tree, which is the IO caller's
 * path and the slow one. `buildGiteaTruth` takes the snapshot as a parameter, so
 * a document thin enough to trip the surface floors can be handed straight in —
 * and those are the floors the committed snapshot can never exercise, because it
 * is not thin.
 */
describe('the floors, on a snapshot small enough to trip them', () => {
  const spec = { swagger: '2.0', paths: { '/version': { get: { operationId: 'getVersion' } } } };
  const specBytes = Buffer.from(JSON.stringify(spec));
  const thin: Snapshot = {
    spec,
    specBytes,
    pin: { specSha256: createHash('sha256').update(specBytes).digest('hex'), basePath: '/api/v1' },
    probe: { entries: [{ method: 'GET', specPath: '/version', status: 200 }] },
  };

  it('refuses a document with one operation, naming the measured surface', () => {
    expect(() => buildGiteaTruth(thin)).toThrow(TruthLoadError);
    expect(() => buildGiteaTruth(thin)).toThrow(/only 1 operations loaded; the pinned image serves 482/);
  });

  it('reports every broken floor at once, not the first', () => {
    // A snapshot this thin breaks the operation count, the path-parameter count,
    // the definition count and both auth denominators. A loader reporting one of
    // them sends someone to fix a document that is wrong in five ways.
    expect(() => buildGiteaTruth(thin)).toThrow(/(?:\n {2}- [^\n]+){5}/);
  });

  it('loads the real snapshot through the same function the wiring calls', () => {
    // The rule's other caller. Without this the tests above would pass against a
    // set of floors no real snapshot could clear.
    expect(buildGiteaTruth(readCommittedSnapshot()).counts.operations).toBe(482);
  });
});

describe('not built yet, and named so the absence is not mistaken for a score', () => {
  it.skip('scores `identifier` against foreign keys derivable from the spec', () => {
    // Needs value-overlap reasoning across endpoints, which the document does
    // not supply on its own. Until then the category has an empty truth side,
    // which §6 scores vacuous and fails — the correct outcome, but the reason
    // has to be readable as "unbuilt" rather than as "infer emitted nothing".
  });

  it.skip('sweeps parameterised endpoints against a deterministically seeded Gitea', () => {
    // 432 of 482 operations are `unobserved` because they need a fixed user,
    // repo and issue created through the API first. `auth.truth-coverage`
    // reports the shortfall as a number so the auth metrics cannot be read as
    // whole-surface claims.
  });
});

describe('the staleness gate compares bytes, and the exemption list is empty', () => {
  it('has no volatile fields, because two containers served identical documents', () => {
    // 0015 amendment 2. Adding the first exemption means deleting this
    // assertion, in a diff someone reads — which is the point.
    const pin = JSON.parse(readFileSync(join(FIXTURES, 'pin.json'), 'utf8'));
    expect(pin.volatileFields).toEqual([]);
  });
});
