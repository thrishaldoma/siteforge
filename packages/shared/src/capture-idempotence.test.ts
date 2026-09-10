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

/**
 * `claimExceeded` — the case a reader of `contentHash` gets wrong.
 *
 * Modelled on the real one: measured at `65840f2`, three read-only crawls of
 * the pinned Vikunja agreed on `user-settings-general`'s `contentHash` while
 * two of that route's scroll PNGs differed. Every other finding this gate
 * produces was silent about it — `unstable` listed the PNGs without saying the
 * certifying field had not moved, which is the whole point.
 */
describe('a contentHash that agreed while something it cannot see did not', () => {
  const covers = ['routes/s/dom.json', 'routes/s/styles.json', 'routes/s/states.json'];
  const uncovered = ['routes/s/shot.full.png', 'routes/s/scroll/0000.png'];
  const stableCovered = { [covers[0]!]: 'd', [covers[1]!]: 's', [covers[2]!]: 't' };

  it('FIRES when the hash reproduced and an uncovered artifact did not', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { ...stableCovered, [uncovered[0]!]: 'png', [uncovered[1]!]: 'A' }),
        tree('r2', { ...stableCovered, [uncovered[0]!]: 'png', [uncovered[1]!]: 'B' }),
      ],
      exempt: [],
      claims: [{ routeId: 's', hashPerRun: ['c304', 'c304'], covers, uncovered }],
    });
    expect(report.claimExceeded).toEqual([
      { routeId: 's', contentHash: 'c304', unstableUncovered: ['routes/s/scroll/0000.png'] },
    ]);
    expect(report.claimsSupplied).toBe(1);
  });

  it('stays silent when the hash moved too — then the field is not misleading anyone', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'routes/s/dom.json': 'd1', [uncovered[1]!]: 'A' }),
        tree('r2', { 'routes/s/dom.json': 'd2', [uncovered[1]!]: 'B' }),
      ],
      exempt: [],
      claims: [{ routeId: 's', hashPerRun: ['aaa', 'bbb'], covers, uncovered }],
    });
    // The PNG is still a hard failure; it is just not a *claim* failure.
    expect(report.unstable.map((u) => u.path)).toContain('routes/s/scroll/0000.png');
    expect(report.claimExceeded).toEqual([]);
  });

  it('stays silent when everything reproduced', () => {
    const files = { ...stableCovered, [uncovered[1]!]: 'A' };
    const report = assessCaptureIdempotence({
      runs: [tree('r1', files), tree('r2', files)],
      exempt: [],
      claims: [{ routeId: 's', hashPerRun: ['c304', 'c304'], covers, uncovered }],
    });
    expect(report.claimExceeded).toEqual([]);
  });

  it('reports how many claims it checked, so nothing-checked cannot read as nothing-wrong', () => {
    const report = assessCaptureIdempotence({
      runs: [tree('r1', { 'a.json': 'x' }), tree('r2', { 'a.json': 'x' })],
      exempt: [],
    });
    expect(report.claimExceeded).toEqual([]);
    expect(report.claimsSupplied).toBe(0);
  });

  it('does not treat every-run-null as agreement on a hash', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { [uncovered[1]!]: 'A' }),
        tree('r2', { [uncovered[1]!]: 'B' }),
      ],
      exempt: [],
      claims: [{ routeId: 's', hashPerRun: [null, null], covers, uncovered }],
    });
    expect(report.claimExceeded).toEqual([]);
  });

  it('THROWS on a claim that does not span every run', () => {
    expect(() =>
      assessCaptureIdempotence({
        runs: [tree('r1', {}), tree('r2', {}), tree('r3', {})],
        exempt: [],
        claims: [{ routeId: 's', hashPerRun: ['c304', 'c304'], covers, uncovered }],
      }),
    ).toThrow(/does not span every run|2 hash\(es\) for 3 run/);
  });

  it('THROWS when a path is declared both covered and uncovered', () => {
    expect(() =>
      assessCaptureIdempotence({
        runs: [tree('r1', {}), tree('r2', {})],
        exempt: [],
        claims: [
          { routeId: 's', hashPerRun: ['c', 'c'], covers, uncovered: [...uncovered, covers[0]!] },
        ],
      }),
    ).toThrow(/both covered and uncovered/);
  });
});

/**
 * The negative control (§13): a perturbation the gate could plausibly key on
 * and must not.
 *
 * A table of nothing but firing cases is satisfied by a check that fires on
 * any change. Widening the *covered* side is the change that must leave
 * `claimExceeded` empty — an artifact the hash genuinely covers cannot exceed
 * it, because its movement would have moved the hash.
 */
describe('control — a covered artifact moving is not a claim failure', () => {
  it('leaves claimExceeded empty when the unstable file is on the covered side', () => {
    const report = assessCaptureIdempotence({
      runs: [
        tree('r1', { 'routes/s/dom.json': 'd1', 'routes/s/scroll/0000.png': 'A' }),
        tree('r2', { 'routes/s/dom.json': 'd2', 'routes/s/scroll/0000.png': 'A' }),
      ],
      exempt: [],
      claims: [
        {
          routeId: 's',
          // A capture where dom moved but the recorded hash did not is not
          // reachable — `CaptureModelSchema` recomputes it — so the claim
          // records the disagreement the artifacts imply.
          hashPerRun: ['h1', 'h2'],
          covers: ['routes/s/dom.json'],
          uncovered: ['routes/s/scroll/0000.png'],
        },
      ],
    });
    expect(report.unstable.map((u) => u.path)).toEqual(['routes/s/dom.json']);
    expect(report.claimExceeded).toEqual([]);
  });
});
