import { describe, expect, it } from 'vitest';
import {
  assessProbeContamination,
  isContaminatingWrite,
  NON_CONTAMINATING_WRITES,
  type ProbeObservation,
} from './probe-contamination.js';

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
  actionWritePaths: [],
  ...o,
});

/** A write that counts. Spelled once so a rename of the declaration breaks here too. */
const WROTE = { actionWritePaths: ['POST /api/v1/tasks/1'] };

describe('assessProbeContamination', () => {
  it('reports per-probe-required when structure moves after a write on the same route', () => {
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, ...WROTE }),
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
    // A write exists elsewhere in the pass, so this is a real control failure
    // rather than the instrument seeing nothing at all.
    const report = assessProbeContamination({
      probes: [
        probe({ routeId: 'r2', attemptIndex: 0, ...WROTE }),
        probe({ attemptIndex: 0 }),
        probe({ attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('confounded');
    expect(report.unexplainedDrift).toHaveLength(1);
  });

  it('reports instrument-silent before confounded when nothing wrote at all', () => {
    // Ordering, asserted. With no write anywhere there is no positive case for
    // the negative control to be a control against, and calling it a failed
    // control sends the reader after a confound in the fingerprint instead of
    // after the attribution. This is the shape a real crawl produced: 0 writes
    // attributed to 128 probes on a target the same crawl watched being
    // written to.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0 }),
        probe({ attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('instrument-silent');
    expect(report.unexplainedDrift).toHaveLength(1);
  });

  it('does not let a mutating probe elsewhere explain another route s drift', () => {
    // `afterMutating` is per route. A write on r1 says nothing about r2, and
    // crediting it across routes would convert the confounded verdict into a
    // confident one.
    const report = assessProbeContamination({
      probes: [
        probe({ routeId: 'r1', attemptIndex: 0, ...WROTE }),
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
        probe({ attemptIndex: 0, ...WROTE }),
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

  it('does not let a route s own drift be excused by that route s later write', () => {
    // `afterMutating` is a prefix property: only a write at or before the
    // earlier probe can explain the change. A write that happens afterwards is
    // downstream of the drift and cannot have caused it.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0 }),
        probe({ attemptIndex: 1, preStructureHash: 'S2', ...WROTE }),
      ],
    });
    expect(report.verdict).toBe('confounded');
  });

  it('reports no-comparable-pairs rather than a clean run when nothing snapshotted', () => {
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, preStructureHash: null, preTextHash: null }),
        probe({ attemptIndex: 1, ...WROTE }),
        probe({ attemptIndex: 2, preStructureHash: null, preTextHash: null }),
      ],
    });
    expect(report.verdict).toBe('no-comparable-pairs');
    expect(report.comparedPairs).toBe(0);
    expect(report.skippedPairs).toBe(2);
  });

  it('does not count a write that cannot change what a later probe reads', () => {
    // The finding that forced this field to be paths rather than a boolean:
    // Vikunja renews its JWT on page load, so 51 of 128 probes read as
    // mutating and nearly every drift point looked explained.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, actionWritePaths: ['POST /api/v1/user/token'] }),
        probe({ attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('instrument-silent');
    expect(report.mutatingProbes).toBe(0);
    expect(report.ignoredWrites).toBe(1);
    expect(report.ignoredWriteKinds).toEqual(['POST /api/v1/user/token']);
  });

  it('still counts a real write made alongside an ignored one', () => {
    // The exemption is per write, not per probe. A probe that renews its token
    // *and* updates a task has mutated, and folding the two together is how a
    // declared exemption quietly becomes a blanket one.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 0, actionWritePaths: ['POST /api/v1/user/token', 'POST /api/v1/tasks/1'] }),
        probe({ attemptIndex: 1, preStructureHash: 'S2' }),
      ],
    });
    expect(report.verdict).toBe('per-probe-required');
    expect(report.mutatingProbes).toBe(1);
    expect(report.ignoredWrites).toBe(1);
  });

  it('declares a reason for every non-contaminating write', () => {
    // Same rule as every other declared exemption here: an entry with no
    // argument is indistinguishable from one added to make a number behave.
    for (const [write, reason] of NON_CONTAMINATING_WRITES) {
      expect(write, 'a declared write is METHOD /path').toMatch(/^[A-Z]+ \//);
      expect(reason.length, `${write} needs a reason`).toBeGreaterThan(40);
      expect(isContaminatingWrite(write)).toBe(false);
    }
    expect(isContaminatingWrite('POST /api/v1/tasks/1')).toBe(true);
  });

  it('orders by declared index, so the artifact s array order cannot decide', () => {
    // 0042, one level down: the drift direction is a property of the loop's
    // order, and reading it off the file's order would make the answer depend
    // on how the writer happened to append.
    const report = assessProbeContamination({
      probes: [
        probe({ attemptIndex: 2, preStructureHash: 'S2' }),
        probe({ attemptIndex: 0, ...WROTE }),
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
        probe({ attemptIndex: 0, ...WROTE }),
        probe({ attemptIndex: 1, preStructureHash: null, preTextHash: null }),
        probe({ attemptIndex: 2, preStructureHash: 'S2' }),
      ],
    });
    expect(report.comparedPairs).toBe(0);
    expect(report.skippedPairs).toBe(2);
    expect(report.verdict).toBe('no-comparable-pairs');
  });
});
