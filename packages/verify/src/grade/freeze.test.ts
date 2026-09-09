/**
 * "It didn't move" is checkable where "I didn't read it" is not.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FROZEN_FILES,
  GRADER_FREEZE,
  NOT_FROZEN,
  assessGraderFreeze,
  readFrozenFiles,
} from './freeze.js';

/**
 * A metric side on disk, built from whatever files the caller names.
 *
 * The unpinned-file branch is only worth anything if a *real* enumeration can
 * reach it, so the test builds a tree and lets `readFrozenFiles` walk it rather
 * than handing `assessGraderFreeze` a key nothing could produce. That synthetic
 * key was the whole defect: the gate looked two-directional and was not.
 */
function metricSide(files: readonly string[]): string {
  const repo = mkdtempSync(join(tmpdir(), 'freeze-'));
  for (const file of files) {
    mkdirSync(join(repo, dirname(file)), { recursive: true });
    writeFileSync(join(repo, file), `// ${file}\n`);
  }
  return repo;
}

const REAL = [...FROZEN_FILES, ...Object.keys(NOT_FROZEN)];

describe('the grader was pinned before infer started', () => {
  it('has not moved', () => {
    expect(assessGraderFreeze(readFrozenFiles())).toEqual([]);
  });

  it('pins exactly the files it lists, as a set', () => {
    expect(Object.keys(GRADER_FREEZE).sort()).toEqual([...FROZEN_FILES].sort());
  });

  it('reads the metric side off the disk, so the set is measured and not declared', () => {
    // The completeness claim rests on this. If these keys came from
    // `FROZEN_FILES`, every file it lists would be found by definition and no
    // file it omits could ever be.
    expect(Object.keys(readFrozenFiles()).sort()).toEqual([...REAL].sort());
  });

  it('objects when a frozen file changes, and says what to do', () => {
    const actual = { ...readFrozenFiles() };
    actual['packages/verify/src/grade/grade.ts'] = 'f'.repeat(64);
    const problems = assessGraderFreeze(actual);
    expect(problems.join('\n')).toContain('changed after the freeze');
    expect(problems.join('\n')).toContain('docs/decisions/');
    expect(problems).toHaveLength(1);
  });

  it('objects to a metric-side file that carries no pin, found by walking the directory', () => {
    // The other direction, and the one a "did any pinned file change?" check
    // cannot see: a new scoring module added beside the frozen ones is outside
    // the freeze until somebody remembers it. Driven through the real walk —
    // `thresholds.ts` exists on disk, and nothing but the enumeration knows.
    const repo = metricSide([...REAL, 'packages/verify/src/grade/thresholds.ts']);
    const actual = readFrozenFiles(repo);
    expect(Object.keys(actual)).toContain('packages/verify/src/grade/thresholds.ts');

    const pinned = Object.fromEntries(FROZEN_FILES.map((f) => [f, actual[f]!]));
    const problems = assessGraderFreeze(actual, pinned);
    expect(problems.join('\n')).toContain('carries no pin');
    expect(problems).toHaveLength(1);
  });

  it('does not walk into truth/ or baseline/, and ignores tests', () => {
    const repo = metricSide([
      ...REAL,
      'packages/verify/src/grade/truth/swagger2.ts',
      'packages/verify/src/grade/baseline/vikunja-smoke.ts',
      'packages/verify/src/grade/grade.test.ts',
    ]);
    const found = Object.keys(readFrozenFiles(repo));
    expect(found.filter((f) => f.includes('/truth/') || f.includes('/baseline/'))).toEqual([]);
    expect(found.filter((f) => f.endsWith('.test.ts'))).toEqual([]);
  });

  it('objects when a pinned file is gone', () => {
    const problems = assessGraderFreeze({}, { 'a/b.ts': 'c'.repeat(64) });
    expect(problems.join('\n')).toContain('was not found on disk');
  });

  it('objects to an exclusion that no longer names a file, so it cannot excuse the next one', () => {
    const problems = assessGraderFreeze({}, {}, { 'packages/verify/src/grade/gone.ts': 'why' });
    expect(problems.join('\n')).toContain('not on the metric side any more');
  });

  it('refuses a file that is both pinned and excused', () => {
    const problems = assessGraderFreeze(
      { 'a/b.ts': 'c'.repeat(64) },
      { 'a/b.ts': 'c'.repeat(64) },
      { 'a/b.ts': 'because' },
    );
    expect(problems.join('\n')).toContain('cannot be both');
  });

  it('gives every exclusion a reason, because an unexplained one is just an omission', () => {
    for (const [file, reason] of Object.entries(NOT_FROZEN)) {
      expect(reason.length, file).toBeGreaterThan(40);
    }
  });

  it('does not pin the truth side, and says why', () => {
    // The carve-out, asserted rather than assumed. A truth loader encodes what
    // a document says, not what counts as a good score, and it changes every
    // time a target is added — Vikunja rewrote it this week.
    expect(FROZEN_FILES.filter((f) => f.includes('/truth/'))).toEqual([]);
  });

  it('excuses nothing the scoring path depends on', () => {
    // The exclusion list is where a threshold could hide, and the property that
    // makes an exclusion safe is structural rather than a promise: if no frozen
    // file imports it, it cannot reach a number. Asserted the other way round
    // from the reading — `mutations.ts` imports `grade.ts`, which is allowed
    // and is why "does it mention the metric table" would be the wrong test.
    const repo = join(import.meta.dirname, '..', '..', '..', '..');
    for (const frozen of FROZEN_FILES) {
      const text = readFileSync(join(repo, frozen), 'utf8');
      for (const excused of Object.keys(NOT_FROZEN)) {
        const specifier = `./${excused.split('/').pop()!.replace(/\.ts$/, '.js')}`;
        expect(text.includes(specifier), `${frozen} imports the excused ${excused}`).toBe(false);
      }
    }
  });
});
