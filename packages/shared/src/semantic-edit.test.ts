/**
 * The edit mechanism, driven to every verdict without a filesystem.
 *
 * The two that matter are `absent` (the target moved — re-anchor) and
 * `ambiguous` (two matches, so scan order would decide which call site gets
 * sabotaged). The second is the within-rung determinism rule applied to the
 * harness that checks the rules.
 */
import { describe, expect, it } from 'vitest';
import { applySemanticEdit, assessSemanticEdit, revertSemanticEdit } from './index.js';

const edit = { file: 'x.ts', find: 'a === b', replace: 'a !== b' };

describe('a semantic edit', () => {
  it('applies when its expression occurs exactly once', () => {
    expect(applySemanticEdit(edit, 'if (a === b) return;')).toBe('if (a !== b) return;');
  });

  it('is INDIFFERENT to the neighbourhood, which is the whole point', () => {
    // The two rots this replaced: a comment grew above the call, an import
    // joined the block. Both would have broken a context-anchored patch.
    const before = 'if (a === b) return;';
    const after = '// a new comment\nimport x from "y";\n\nif (a === b) return;\n// and below\n';
    expect(assessSemanticEdit(edit, before)).toBeNull();
    expect(assessSemanticEdit(edit, after)).toBeNull();
  });

  it('FAILS when the expression is gone, and says the target moved', () => {
    const finding = assessSemanticEdit(edit, 'if (a == b) return;');
    expect(finding?.problem).toBe('absent');
    expect(finding?.detail).toMatch(/the code itself changed, not its neighbourhood/);
  });

  it('FAILS when the expression occurs twice, rather than editing the first', () => {
    const finding = assessSemanticEdit(edit, 'if (a === b) x();\nif (a === b) y();');
    expect(finding?.problem).toBe('ambiguous');
    expect(finding?.detail).toMatch(/occurs 2 times/);
  });

  it('FAILS a no-op, which would pass its gate for the wrong reason', () => {
    expect(assessSemanticEdit({ file: 'x', find: 'q', replace: 'q' }, 'q')?.problem).toBe('no-op');
  });

  it('FAILS when the result would be ambiguous to revert', () => {
    // Applying would produce two copies of the replacement, so the undo could
    // not know which it made.
    const finding = assessSemanticEdit(
      { file: 'x', find: 'a === b', replace: 'a !== b' },
      'if (a === b) x();\nif (a !== b) y();',
    );
    expect(finding?.problem).toBe('replacement-ambiguous');
  });

  it('round-trips', () => {
    const text = 'if (a === b) return;';
    expect(revertSemanticEdit(edit, applySemanticEdit(edit, text))).toBe(text);
  });
});

describe('the create form', () => {
  const create = { file: 'new.ts', find: null, replace: 'export const x = 1;\n' };

  it('creates a file that is not there', () => {
    expect(applySemanticEdit(create, null)).toBe('export const x = 1;\n');
  });

  it('REFUSES to create one that already exists — that is overwriting, not adding', () => {
    expect(assessSemanticEdit(create, 'something else')?.problem).toBe('already-present');
  });

  it('reverts to deletion rather than to an empty file', () => {
    // An empty module left in the frozen grade directory is residue, and the
    // residue check would rightly fail on it.
    expect(revertSemanticEdit(create, 'export const x = 1;\n')).toBeNull();
  });

  it('reports an edit against a file that is not there', () => {
    expect(assessSemanticEdit(edit, null)?.problem).toBe('absent');
  });
});
