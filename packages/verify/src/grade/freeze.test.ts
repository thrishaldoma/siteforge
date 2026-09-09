/**
 * "It didn't move" is checkable where "I didn't read it" is not.
 */
import { describe, expect, it } from 'vitest';
import {
  FROZEN_FILES,
  GRADER_FREEZE,
  assessGraderFreeze,
  readFrozenFiles,
} from './freeze.js';

describe('the grader was pinned before infer started', () => {
  it('has not moved', () => {
    expect(assessGraderFreeze(readFrozenFiles())).toEqual([]);
  });

  it('pins exactly the files it lists, as a set', () => {
    expect(Object.keys(GRADER_FREEZE).sort()).toEqual([...FROZEN_FILES].sort());
  });

  it('objects when a frozen file changes, and says what to do', () => {
    const actual = { ...readFrozenFiles() };
    actual['packages/verify/src/grade/grade.ts'] = 'f'.repeat(64);
    const problems = assessGraderFreeze(actual);
    expect(problems.join('\n')).toContain('changed after the freeze');
    expect(problems.join('\n')).toContain('docs/decisions/');
    expect(problems).toHaveLength(1);
  });

  it('objects to a metric-side file that carries no pin', () => {
    // The other direction, and the one a "did any pinned file change?" check
    // cannot see: a new scoring module added beside the frozen ones is outside
    // the freeze until somebody remembers it.
    const problems = assessGraderFreeze(
      { ...readFrozenFiles(), 'packages/verify/src/grade/thresholds.ts': 'a'.repeat(64) },
    );
    expect(problems.join('\n')).toContain('carries no pin');
    expect(problems).toHaveLength(1);
  });

  it('objects when a pinned file is gone', () => {
    const problems = assessGraderFreeze({}, { 'a/b.ts': 'c'.repeat(64) });
    expect(problems.join('\n')).toContain('was not found on disk');
  });

  it('does not pin the truth side, and says why', () => {
    // The carve-out, asserted rather than assumed. A truth loader encodes what
    // a document says, not what counts as a good score, and it changes every
    // time a target is added — Vikunja rewrote it this week.
    expect(FROZEN_FILES.filter((f) => f.includes('/truth/'))).toEqual([]);
  });
});
