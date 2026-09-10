import { describe, expect, it } from 'vitest';
import type { Gap } from '@siteforge/schema';
import {
  GAPS_BEGIN,
  GAPS_END,
  GAPS_PLACEHOLDER,
  type GapRun,
  assessGapAggregation,
  renderGapsBlock,
  runHeading,
  writeGapsBlock,
} from './gaps-md.js';

const gap = (id: string, over: Partial<Gap> = {}): Gap =>
  ({
    gapId: id,
    stage: 'capture',
    category: 'destructive-action-skipped',
    severity: 'degraded',
    subject: { routeId: 'home--anon-desktop--i0' },
    summary: 'Delete account was not fired.',
    detail: 'Recorded rather than clicked.',
    stub: { kind: 'omitted', detail: 'recorded as a skipped control' },
    ...over,
  }) as Gap;

const run = (over: Partial<GapRun> = {}): GapRun => ({
  siteId: 'vikunja',
  stage: 'capture',
  runId: 'run_0001',
  capturedAt: '2026-09-10T00:00:00.000Z',
  gaps: [gap('gap_0123456789ab')],
  ...over,
});

/** The shipped file, verbatim in shape: prose, then an empty generated block. */
const shipped = [
  '# GAPS',
  '',
  'Aggregated record.',
  '',
  GAPS_BEGIN,
  GAPS_PLACEHOLDER,
  GAPS_END,
  '',
].join('\n');

const aggregated = (runs: readonly GapRun[]) => writeGapsBlock(shipped, runs);

describe('renderGapsBlock', () => {
  it('emits a row per gap, with the id present for the check to anchor on', () => {
    const block = renderGapsBlock([run({ gaps: [gap('gap_aaaaaaaaaaaa'), gap('gap_bbbbbbbbbbbb')] })]);
    expect(block).toContain('gap_aaaaaaaaaaaa');
    expect(block).toContain('gap_bbbbbbbbbbbb');
    expect(block).toContain('| severity | category | subject | stub | summary |');
    expect(block).not.toContain(GAPS_PLACEHOLDER);
  });

  it('distinguishes a clean stage from a skipped one, which is §1’s wording', () => {
    expect(renderGapsBlock([run({ gaps: [] })])).toContain('The stage ran clean');
  });

  it('is deterministic under input order, so a rerun is a no-op diff', () => {
    const a = gap('gap_aaaaaaaaaaaa');
    const b = gap('gap_bbbbbbbbbbbb');
    expect(renderGapsBlock([run({ gaps: [a, b] })])).toBe(renderGapsBlock([run({ gaps: [b, a] })]));
  });

  it('escapes a pipe so one summary cannot rewrite the table', () => {
    const block = renderGapsBlock([run({ gaps: [gap('gap_aaaaaaaaaaaa', { summary: 'a | b' })] })]);
    expect(block).toContain('a \\| b');
  });
});

describe('writeGapsBlock', () => {
  it('leaves the prose outside the markers untouched', () => {
    const out = aggregated([run()]);
    expect(out.startsWith('# GAPS\n\nAggregated record.\n')).toBe(true);
    expect(out).toContain(GAPS_BEGIN);
    expect(out).toContain(GAPS_END);
  });

  it('refuses a file with no block rather than rewriting the whole thing', () => {
    expect(() => writeGapsBlock('# GAPS\n\nno markers here\n', [run()])).toThrow(/no usable/);
  });

  it('is idempotent — aggregating the same runs twice changes nothing', () => {
    const once = aggregated([run()]);
    expect(writeGapsBlock(once, [run()])).toBe(once);
  });
});

describe('assessGapAggregation', () => {
  it('passes on a file that carries every gap', () => {
    expect(assessGapAggregation({ runs: [run()], markdown: aggregated([run()]) })).toEqual([]);
  });

  /**
   * The state the repository was actually in, and the ruling's gate.
   *
   * 43 gaps in `capture/vikunja/stage-report.json`, `_No runs recorded yet._`
   * in the file. Driven to a failing verdict rather than asserted about.
   */
  it('FAILS a run whose gaps never reached the file', () => {
    const findings = assessGapAggregation({ runs: [run()], markdown: shipped });
    expect(findings.map((f) => f.problem)).toContain('run-unaggregated');
    expect(findings.map((f) => f.problem)).toContain('placeholder-retained');
  });

  it('FAILS one gap dropped from a section that otherwise exists', () => {
    // The partial loss an aggregate count would hide: the section is present,
    // the run is present, one row is not.
    const two = run({ gaps: [gap('gap_aaaaaaaaaaaa'), gap('gap_bbbbbbbbbbbb')] });
    const markdown = aggregated([run({ gaps: [gap('gap_aaaaaaaaaaaa')] })]);
    const findings = assessGapAggregation({ runs: [two], markdown });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.problem).toBe('gap-unaggregated');
    expect(findings[0]?.gapId).toBe('gap_bbbbbbbbbbbb');
  });

  it('FAILS a row no run carries — the set difference runs both ways', () => {
    const markdown = aggregated([run({ gaps: [gap('gap_aaaaaaaaaaaa'), gap('gap_bbbbbbbbbbbb')] })]);
    const findings = assessGapAggregation({
      runs: [run({ gaps: [gap('gap_aaaaaaaaaaaa')] })],
      markdown,
    });
    expect(findings.map((f) => f.problem)).toEqual(['row-without-gap']);
    expect(findings[0]?.gapId).toBe('gap_bbbbbbbbbbbb');
  });

  it('FAILS unusable markers, and reports nothing else on top of it', () => {
    const doubled = `${aggregated([run()])}\n${GAPS_BEGIN}\n${GAPS_END}\n`;
    const findings = assessGapAggregation({ runs: [run()], markdown: doubled });
    expect(findings.map((f) => f.problem)).toEqual(['markers-unusable']);
  });

  it('FAILS an end marker before its begin', () => {
    const inverted = `${GAPS_END}\nrows\n${GAPS_BEGIN}\n`;
    expect(assessGapAggregation({ runs: [run()], markdown: inverted }).map((f) => f.problem))
      .toEqual(['markers-unusable']);
  });

  /**
   * The count already lived in two artifacts and nothing compared them.
   *
   * The contract's own rule is that a derived value is computed in one place
   * and referenced from the other; adding a third store of it would be the
   * defect that rule exists to prevent, so the aggregator reconciles instead.
   */
  it('FAILS a manifest whose gap count disagrees with the records', () => {
    const r = run({ manifestGapCount: 43 });
    const findings = assessGapAggregation({ runs: [r], markdown: aggregated([r]) });
    expect(findings.map((f) => f.problem)).toEqual(['manifest-count-disagrees']);
  });

  it('agrees when the manifest count matches, so the check is not one-directional', () => {
    const r = run({ manifestGapCount: 1 });
    expect(assessGapAggregation({ runs: [r], markdown: aggregated([r]) })).toEqual([]);
  });

  /**
   * §13's precondition rule. "Nothing to aggregate" and "everything
   * aggregated" must not render identically, because the first is how this
   * check would report success on a machine with no capture tree.
   */
  it('reports no-runs-supplied rather than passing on an empty input', () => {
    expect(assessGapAggregation({ runs: [], markdown: shipped }).map((f) => f.problem))
      .toEqual(['no-runs-supplied']);
  });

  /**
   * The negative control (§13). A change the check could plausibly key on and
   * must not: the summary is reworded, which moves every rendered row, and
   * the anchor is the gap id — so nothing moves.
   */
  it('does NOT fire when a summary is reworded but the gap is the same', () => {
    const before = aggregated([run({ gaps: [gap('gap_aaaaaaaaaaaa', { summary: 'old wording' })] })]);
    const after = run({ gaps: [gap('gap_aaaaaaaaaaaa', { summary: 'entirely new wording' })] });
    expect(assessGapAggregation({ runs: [after], markdown: before })).toEqual([]);
  });

  it('keys sections on the run, so a second run of the same site is not mistaken for the first', () => {
    const first = run({ runId: 'run_0001' });
    const second = run({ runId: 'run_0002', gaps: [gap('gap_cccccccccccc')] });
    const markdown = aggregated([first]);
    expect(markdown).toContain(runHeading(first));
    const findings = assessGapAggregation({ runs: [first, second], markdown });
    expect(findings.map((f) => f.problem)).toEqual(['run-unaggregated']);
    expect(findings[0]?.runId).toBe('run_0002');
  });
});
