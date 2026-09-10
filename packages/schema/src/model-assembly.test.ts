import { describe, expect, it } from 'vitest';
import {
  MODEL_COLLECTIONS,
  SCAFFOLD_STAGES,
  type ModelCollectionDeclaration,
  assessModelAssembly,
  collectionsOf,
} from './model-assembly.js';
import { SiteModelSchema } from './site-model/index.js';

/** The measured Vikunja state. */
const INPUTS = { fonts: 70, assets: 46, flows: 113, endpoints: 21 };
const PARTS = {
  fonts: 0, assets: 0, behaviours: 0, components: 0,
  layouts: 1, routes: 7, entities: 4, operations: 26,
};
const collections = () => collectionsOf(SiteModelSchema);
const assess = (over: Partial<Parameters<typeof assessModelAssembly>[0]> = {}) =>
  assessModelAssembly({
    declared: MODEL_COLLECTIONS, collections: collections(), inputs: INPUTS, parts: PARTS, ...over,
  });

describe('collectionsOf reads the schema, not a hand list', () => {
  it('finds every array-valued member of SiteModel', () => {
    // A complete set, never "contains the ones I thought of" (§13).
    expect(collectionsOf(SiteModelSchema).sort()).toEqual(
      ['assets', 'behaviours', 'components', 'entities', 'fonts', 'layouts', 'operations', 'routes'],
    );
  });

  it('throws rather than reading nothing, which would pass for a complete gate', () => {
    expect(() => collectionsOf({})).toThrow(/could not read/);
  });
});

describe('MODEL_COLLECTIONS describes the model infer produces today', () => {
  it('is clean against the measured state', () => {
    expect(assess()).toEqual([]);
  });

  it('declares every collection the schema defines', () => {
    expect(MODEL_COLLECTIONS.map((d) => d.part).sort()).toEqual(collections().sort());
  });
});

describe('assessModelAssembly', () => {
  /**
   * The structural half, and the reason this replaced three declared rows: a
   * collection added tomorrow arrives undeclared, which is exactly how fonts,
   * assets and behaviours arrived.
   */
  it('FAILS a schema collection nobody declared', () => {
    const findings = assessModelAssembly({
      declared: [], collections: ['fonts'], inputs: INPUTS, parts: { fonts: 0 },
    });
    expect(findings).toEqual([
      expect.objectContaining({ part: 'fonts', problem: 'undeclared-collection' }),
    ]);
  });

  it('FAILS a declaration for a collection the schema no longer has', () => {
    const stale: ModelCollectionDeclaration = {
      part: 'widgets', producer: 'x', stage: 'infer', input: 'fonts', assembles: true,
    };
    expect(assessModelAssembly({
      declared: [stale], collections: ['widgets'].filter(() => false), inputs: {}, parts: {},
    }).map((f) => f.problem)).toEqual(['stale-declaration']);
  });

  /** The transition: the work lands and the record does not move. */
  it('FAILS a declared gap that has started assembling', () => {
    expect(assess({ parts: { ...PARTS, fonts: 2 } }).map((f) => f.problem))
      .toEqual(['declared-but-assembles']);
  });

  /** §13's vacuity table made checkable. */
  it('FAILS a gap declared against an input that is also empty', () => {
    expect(assess({ inputs: { ...INPUTS, fonts: 0 } }).map((f) => f.problem))
      .toEqual(['declared-without-input']);
  });

  /** The other direction: a producer that stops producing. */
  it('FAILS a collection declared as assembling that has gone empty', () => {
    expect(assess({ parts: { ...PARTS, entities: 0 } }).map((f) => f.problem))
      .toEqual(['assembles-but-empty']);
  });

  it('FAILS a non-assembling collection with no reason given', () => {
    const bare: ModelCollectionDeclaration = {
      part: 'fonts', producer: 'nothing', stage: 'infer', input: 'fonts', assembles: false,
    };
    expect(assessModelAssembly({
      declared: [bare], collections: ['fonts'], inputs: INPUTS, parts: PARTS,
    }).map((f) => f.problem)).toEqual(['undeclared-reason']);
  });

  it('FAILS a null input with no reason, so a blind spot is never silent', () => {
    const bare: ModelCollectionDeclaration = {
      part: 'layouts', producer: 'inferLayout', stage: 'infer', input: null, assembles: true,
    };
    expect(assessModelAssembly({
      declared: [bare], collections: ['layouts'], inputs: INPUTS, parts: PARTS,
    }).map((f) => f.problem)).toEqual(['undeclared-reason']);
  });

  /**
   * The scope exclusion, in the gate. A stage nobody built is not a producer
   * without a consumer — but the exemption is checked, so it cannot outlive
   * the scaffold.
   */
  it('exempts a scaffold stage from the empty check', () => {
    const scaffolded: ModelCollectionDeclaration = {
      part: 'fonts', producer: 'emitFonts', stage: 'codegen', input: 'fonts', assembles: false,
      reason: 'codegen is a three-line scaffold; this collection has no producer yet at all.',
    };
    expect(assessModelAssembly({
      declared: [scaffolded], collections: ['fonts'], inputs: INPUTS, parts: PARTS,
    })).toEqual([]);
  });

  it('FAILS a scaffold that turns out to be producing — the exemption is then stale', () => {
    const scaffolded: ModelCollectionDeclaration = {
      part: 'fonts', producer: 'emitFonts', stage: 'codegen', input: 'fonts', assembles: false,
      reason: 'codegen is a three-line scaffold; this collection has no producer yet at all.',
    };
    expect(assessModelAssembly({
      declared: [scaffolded], collections: ['fonts'], inputs: INPUTS, parts: { fonts: 3 },
    }).map((f) => f.problem)).toEqual(['scaffold-is-producing']);
  });

  it('names the three scaffolds and no stage that exists', () => {
    expect([...SCAFFOLD_STAGES].sort()).toEqual(['cli', 'codegen', 'envkit']);
    expect(SCAFFOLD_STAGES).not.toContain('infer');
    expect(SCAFFOLD_STAGES).not.toContain('capture');
  });

  /**
   * The input is looked up by its DECLARED name, never by the part's.
   *
   * `behaviours` is assembled from `flows`, so a lookup keyed on the part
   * reads `inputs.behaviours` — undefined — and reports a capture holding
   * 113 traces as having no input at all. It produces a number in both
   * states, so nothing throws and nothing looks wrong. Asserted where the
   * two names differ, because a row whose part and input share a name
   * passes under the bug.
   */
  it('reads the declared input name, not the part name', () => {
    const behaviours = MODEL_COLLECTIONS.find((d) => d.part === 'behaviours')!;
    expect(behaviours.input).toBe('flows');
    expect(assessModelAssembly({
      declared: [behaviours], collections: ['behaviours'],
      inputs: { flows: 113 }, parts: { behaviours: 0 },
    })).toEqual([]);
    // And the same row against an input that really is empty must fire, so
    // the assertion above is not passing for want of any check at all.
    expect(assessModelAssembly({
      declared: [behaviours], collections: ['behaviours'],
      inputs: { flows: 0 }, parts: { behaviours: 0 },
    }).map((f) => f.problem)).toEqual(['declared-without-input']);
  });

  /** Negative control (§13): ordinary growth is not a finding. */
  it('does NOT fire when an assembling collection changes size', () => {
    expect(assess({ parts: { ...PARTS, operations: 40 } })).toEqual([]);
  });

  it('is silent on a declared gap whose input nothing counts', () => {
    // `components` — the producer runs and the gate has no counter to judge it.
    expect(assess({ parts: { ...PARTS, components: 0 } })).toEqual([]);
  });
});
