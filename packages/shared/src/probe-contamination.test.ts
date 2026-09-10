import { describe, expect, it } from 'vitest';
import { assessProbeContamination, type ProbeObservation } from './probe-contamination.js';

/**
 * Every verdict driven on synthetic input, including the two that are ways of
 * learning nothing — §13: a gate is proved only when a test drives it to each
 * of its verdicts without the real run, and the vacuous ones are exactly the
 * pair that read like a clean answer.
 */
const probe = (o: Partial<ProbeObservation> & { attemptIndex: number }): ProbeObservation => ({
  routeId: 'r1',
  label: `button "${o.attemptIndex}"`,
  preStructureHash: 'S',
  preTextHash: 'T',
  mutated: false,
  ...o,
});

describe('assessProbeContamination', () => {
  it('reports per-probe-required when structure moves after a write on the same route', () => {
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, mutated: true }),
        probe({ attemptIndex: 1, preStructureHash: 'S2', preTextHash: 'T2' }),
      ],
    });
    expect(report.verdict).toBe('per-probe-required');
    expect(report.structureDrift).toHaveLength(1);
    expect(report.contaminatedRoutes).toEqual(['r1']);
    expect(report.unexplainedDrift).toEqual([]);
  });

  it('fails the negative control when structure moves with no write before it', () => {
    // The half that makes the reading falsifiable: a read-only prefix that
    // moves means the fingerprint is tracking something other than our writes.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0 }),
        probe({ attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('confounded');
    expect(report.unexplainedDrift).toHaveLength(1);
  });

  it('does not let a mutating probe elsewhere explain another route s drift', () => {
    // `afterMutating` is per route. A write on r1 says nothing about r2, and
    // crediting it across routes would convert the confounded verdict into a
    // confident one.
    const report = assessProbeContamination({
      probes: [
        probe({ routeId: 'r1', attemptIndex: 0, mutated: true }),
        probe({ routeId: 'r1', attemptIndex: 1 }),
        probe({ routeId: 'r2', attemptIndex: 0 }),
        probe({ routeId: 'r2', attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('confounded');
    expect(report.unexplainedDrift[0]?.routeId).toBe('r2');
  });

  it('counts a text-only move separately and does not call it contamination', () => {
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, mutated: true }),
        probe({ attemptIndex: 1, preTextHash: 'T2' }),
      ],
    });
    expect(report.verdict).toBe('no-within-route-contamination');
    expect(report.textOnlyDrift).toHaveLength(1);
    expect(report.structureDrift).toEqual([]);
  });

  it('reports instrument-silent when nothing wrote, rather than reporting independence', () => {
    const report = assessProbeContamination({
      probes: [probe({ attemptIndex: 0 }), probe({ attemptIndex: 1 })],
    });
    expect(report.verdict).toBe('instrument-silent');
  });

  it('reports no-comparable-pairs rather than a clean run when nothing snapshotted', () => {
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, preStructureHash: null, preTextHash: null }),
        probe({ attemptIndex: 1, mutated: true }),
        probe({ attemptIndex: 2, preStructureHash: null, preTextHash: null }),
      ],
    });
    expect(report.verdict).toBe('no-comparable-pairs');
    expect(report.comparedPairs).toBe(0);
    expect(report.skippedPairs).toBe(2);
  });

  it('orders by declared index, so the artifact s array order cannot decide', () => {
    // 0042, one level down: the drift direction is a property of the loop's
    // order, and reading it off the file's order would make the answer depend
    // on how the writer happened to append.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 2, preStructureHash: 'S2' }),
        probe({ attemptIndex: 0, mutated: true }),
        probe({ attemptIndex: 1 }),
      ],
    });
    expect(report.verdict).toBe('per-probe-required');
    expect(report.structureDrift).toEqual([
      { routeId: 'r1', fromAttemptIndex: 1, toAttemptIndex: 2, afterMutating: true, kind: 'structure' },
    ]);
  });

  it('does not compare across a probe that never snapshotted', () => {
    // A gap in the sequence means two neighbours are not neighbours. Closing it
    // silently would compare pre-states with an unobserved probe between them.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, mutated: true }),
        probe({ attemptIndex: 1, preStructureHash: null, preTextHash: null }),
        probe({ attemptIndex: 2, preStructureHash: 'S2' }),
      ],
    });
    expect(report.comparedPairs).toBe(0);
    expect(report.skippedPairs).toBe(2);
    expect(report.verdict).toBe('no-comparable-pairs');
  });
});
