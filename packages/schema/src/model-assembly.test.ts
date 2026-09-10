import { describe, expect, it } from 'vitest';
import {
  MODEL_ASSEMBLY_GAPS,
  type ModelAssemblyGap,
  assessModelAssembly,
} from './model-assembly.js';

/** The measured Vikunja state: the three declared holes, and nothing else. */
const VIKUNJA_INPUTS = { fonts: 70, assets: 46, flows: 122, components: 0, entities: 4, operations: 21 };
const VIKUNJA_PARTS = { fonts: 0, assets: 0, behaviours: 0, components: 0, entities: 4, operations: 26 };

describe('MODEL_ASSEMBLY_GAPS', () => {
  it('agrees with the model infer actually produces today', () => {
    expect(assessModelAssembly({
      declared: MODEL_ASSEMBLY_GAPS,
      inputs: VIKUNJA_INPUTS,
      parts: VIKUNJA_PARTS,
    })).toEqual([]);
  });

  it('declares the three measured holes and nothing speculative', () => {
    expect(MODEL_ASSEMBLY_GAPS.map((g) => g.part)).toEqual(['fonts', 'assets', 'behaviours']);
  });

  /**
   * `components` is the row that must NOT be here. `inferComponents` runs and
   * returns nothing, which is a producer applying its rule — §13's fourth
   * cause, where nothing may be missing. Declaring it would claim work is
   * undone that nobody has shown is undone.
   */
  it('excludes components, whose producer runs', () => {
    expect(MODEL_ASSEMBLY_GAPS.map((g) => g.part)).not.toContain('components');
  });

  it('names a spec section and a capture input on every row', () => {
    for (const gap of MODEL_ASSEMBLY_GAPS) {
      expect(gap.spec).toMatch(/§/);
      expect(gap.input.length).toBeGreaterThan(0);
      expect(gap.reason.length).toBeGreaterThan(40);
    }
  });
});

describe('assessModelAssembly', () => {
  /**
   * The sweep's own finding, driven to a failing verdict: a part the capture
   * fills and the model leaves empty, with nobody having written it down.
   * This is the state `fonts`, `assets` and `behaviours` were in before the
   * table existed, and it is what finds the fourth one.
   */
  it('FAILS an undeclared part whose capture input is full', () => {
    const findings = assessModelAssembly({
      declared: [],
      inputs: { fonts: 70 },
      parts: { fonts: 0 },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ part: 'fonts', problem: 'undeclared-empty' });
    expect(findings[0]?.detail).toContain('70');
  });

  /**
   * The transition, and the reason this is a gate rather than a comment: the
   * work lands, the record does not move, and the file goes on claiming a
   * hole that was filled. Exactly the deferral table's `class-changed`.
   */
  it('FAILS a declared gap that has started assembling', () => {
    const findings = assessModelAssembly({
      declared: MODEL_ASSEMBLY_GAPS,
      inputs: VIKUNJA_INPUTS,
      parts: { ...VIKUNJA_PARTS, fonts: 2 },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ part: 'fonts', problem: 'declared-but-assembled' });
  });

  /**
   * §13's vacuity table made checkable. An empty output with an empty input is
   * a target or driver limitation; filing it as an unassembled artifact sends
   * the next reader to a package with nothing wrong in it.
   */
  it('FAILS a row declared against a capture input that is empty', () => {
    const findings = assessModelAssembly({
      declared: MODEL_ASSEMBLY_GAPS,
      inputs: { ...VIKUNJA_INPUTS, fonts: 0 },
      parts: VIKUNJA_PARTS,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ part: 'fonts', problem: 'declared-without-input' });
  });

  /**
   * The negative control (§13): a change the check could plausibly key on and
   * must not. An unrelated part growing is ordinary progress, and a gate that
   * fired on it would be a gate that fires on everything.
   */
  it('does NOT fire when an undeclared, assembling part changes size', () => {
    expect(assessModelAssembly({
      declared: MODEL_ASSEMBLY_GAPS,
      inputs: VIKUNJA_INPUTS,
      parts: { ...VIKUNJA_PARTS, operations: 40 },
    })).toEqual([]);
  });

  /**
   * Both directions of the empty case, because `0 and 0` is the reading that
   * makes the check vacuous: it must stay silent where nothing was captured
   * and speak where something was.
   */
  it('is silent on a part with no input and no output', () => {
    expect(assessModelAssembly({ declared: [], inputs: { fonts: 0 }, parts: { fonts: 0 } })).toEqual([]);
  });

  it('reports every undeclared hole rather than the first', () => {
    const findings = assessModelAssembly({
      declared: [],
      inputs: { fonts: 70, assets: 46 },
      parts: { fonts: 0, assets: 0 },
    });
    expect(findings.map((f) => f.part).sort()).toEqual(['assets', 'fonts']);
  });

  it('reads the declared input name, not the part name', () => {
    // `behaviours` is assembled from `flows`, so a check keyed on the part
    // name would read `inputs.behaviours` — undefined — and go silent.
    const gap: ModelAssemblyGap = MODEL_ASSEMBLY_GAPS.find((g) => g.part === 'behaviours')!;
    expect(gap.input).toBe('flows');
    expect(assessModelAssembly({
      declared: [gap],
      inputs: { flows: 0 },
      parts: { behaviours: 0 },
    }).map((f) => f.problem)).toEqual(['declared-without-input']);
  });
});
