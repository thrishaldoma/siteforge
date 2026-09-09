/**
 * The idempotence gate, driven to each verdict on synthetic trees.
 *
 * It exists because M1's check was never a comparison, so the first thing to
 * establish is that this one can actually fail — a gate nobody has seen fail is
 * the shape that produced the problem it is answering.
 */
import { describe, expect, it } from 'vitest';
import { assessCaptureIdempotence, type CaptureTree } from './index.js';

const tree = (label: string, files: Record<string, string>): CaptureTree => ({ label, files });
const HAR = { path: 'network/session.har', reason: 'Playwright writes timings into it' };

describe('a recrawl is idempotent, and something checks', () => {
  it('passes when two runs wrote the same bytes everywhere', () => {
    const files = { 'manifest.json': 'aa', 'routes/x/dom.json': 'bb' };
    const report = assessCaptureIdempotence({
      runs: [tree('r1', files), tree('r2', files)],
      exempt: [],
    });
    expect(report.unstable).toEqual([]);
    expect(report.inconsistentlyPresent).toEqual([]);
    expect(report.comparedPaths).toBe(2);
  });

  it('catches a file whose content moved', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'flows/skipped-controls.json': 'sixteen' }),
        tree('r2', { 'flows/skipped-controls.json': 'nineteen' }),
      ],
      exempt: [],
    });
    expect(report.unstable).toEqual([
      { path: 'flows/skipped-controls.json', distinct: 2, presentIn: 2 },
    ]);
  });

  it('reports a file missing from one run apart from one whose bytes moved', () => {
    // Two different defects. A file that appears in two runs of three is not a
    // file whose content changed, and netting them into one count sends the
    // reader to the wrong question.
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'a.json': 'x', 'b.json': 'y' }),
        tree('r2', { 'a.json': 'x' }),
        tree('r3', { 'a.json': 'z', 'b.json': 'y' }),
      ],
      exempt: [],
    });
    expect(report.unstable.map((u) => u.path)).toEqual(['a.json']);
    expect(report.inconsistentlyPresent).toEqual([{ path: 'b.json', distinct: 1, presentIn: 2 }]);
  });

  it('counts how many distinct values a path took, not merely that it varied', () => {
    const report = assessCaptureIdempotence({
      runs: [tree('r1', { 'a': '1' }), tree('r2', { 'a': '2' }), tree('r3', { 'a': '1' })],
      exempt: [],
    });
    expect(report.unstable[0]).toEqual({ path: 'a', distinct: 2, presentIn: 3 });
  });

  it('THROWS on a single run rather than reporting it stable', () => {
    // The empty-container family with a directory in place of a list: one crawl
    // cannot disagree with itself, and "nothing differed" is the permissive
    // answer that reads exactly like success. This is the answer M1's check has
    // been getting for free since it was written.
    expect(() => assessCaptureIdempotence({ runs: [tree('r1', { a: 'x' })], exempt: [] }))
      .toThrow(/at least two runs/);
    expect(() => assessCaptureIdempotence({ runs: [], exempt: [] })).toThrow(/at least two runs/);
  });

  it('refuses an exemption with no reason', () => {
    expect(() => assessCaptureIdempotence({
      runs: [tree('r1', {}), tree('r2', {})],
      exempt: [{ path: 'network/session.har', reason: '   ' }],
    })).toThrow(/states no reason/);
  });
});

describe('an exemption is declared, segment-wise, and stays honest', () => {
  it('excuses a declared volatile file', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'network/session.har': 'one' }),
        tree('r2', { 'network/session.har': 'two' }),
      ],
      exempt: [HAR],
    });
    expect(report.unstable).toEqual([]);
    expect(report.exemptedAndVarying).toEqual(['network/session.har']);
  });

  it('reports an exemption that never varied, so a dead one is visible', () => {
    // A declared volatility nobody can observe is a claim the artifact does not
    // support — and it is the shape an exemption added to silence a diff takes
    // once the real cause is fixed.
    const report = assessCaptureIdempotence({
      runs: [tree('r1', { 'network/session.har': 'same' }), tree('r2', { 'network/session.har': 'same' })],
      exempt: [HAR],
    });
    expect(report.exemptedAndStable).toEqual(['network/session.har']);
    expect(report.exemptedAndVarying).toEqual([]);
  });

  it('matches a segment or a whole path, never a prefix', () => {
    // `startsWith('auth')` would excuse `authors/`, which is the
    // substring-for-token family §13 keeps finding.
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'auth/storage-state.json': 'a', 'authors/list.json': 'a' }),
        tree('r2', { 'auth/storage-state.json': 'b', 'authors/list.json': 'b' }),
      ],
      exempt: [{ path: 'auth', reason: 'holds a live session' }],
    });
    expect(report.exemptedAndVarying).toEqual(['auth/storage-state.json']);
    expect(report.unstable.map((u) => u.path)).toEqual(['authors/list.json']);
  });
});
