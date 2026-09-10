/**
 * Every gate that selects its own subject declares what it cannot see, and
 * every region nothing else covers is proved uncovered.
 *
 * Five instances of one failure made this a standing audit rather than a rule
 * (0037). In all five the gate behaved correctly and its claim was broader than
 * its coverage — a gap invisible from inside the gate, and invisible from
 * outside, because a gate that cannot see a region reports exactly what it
 * reports when the region is clean.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a .mjs script with no type declarations.
import { SABOTAGES, isControl } from '../../../scripts/sabotage.mjs';
import { assessFieldOfView } from './field-of-view.js';
import { FIELD_OF_VIEW, SELF_SELECTING_GATES } from './field-of-view.declarations.js';

const controls: string[] = (SABOTAGES as Array<{ id: string }>)
  .filter((s) => isControl(s))
  .map((s) => s.id);

const report = assessFieldOfView({
  declared: FIELD_OF_VIEW,
  gates: [...SELF_SELECTING_GATES],
  controls,
});

describe('every gate declares its field of view', () => {
  it('has a declaration for every gate that selects its own subject', () => {
    expect(report.undeclared).toEqual([]);
  });

  it('has no declaration for a gate that no longer exists', () => {
    // The other direction. A count would net a removal against an addition —
    // `assessScopeAgreement`'s argument, applied to this list.
    expect(report.stale).toEqual([]);
  });

  it('proves every region nothing else covers is actually uncovered', () => {
    // The expensive half, and the ruling's point: a blind region asserted in
    // prose is a claim nobody has checked. A control puts a real defect there
    // and asserts the gate stays **green**, which is the only way to tell
    // "cannot see it" from "there was nothing to see".
    expect(report.unproven).toEqual([]);
  });

  it('names controls that exist in the sabotage table', () => {
    expect(report.danglingProof).toEqual([]);
  });

  it('does not prove a region that a sibling gate already covers', () => {
    // A control for a covered region asserts a gate stays green over something
    // another gate catches — true, and it would read as a hole. The distinction
    // is the whole value of the `coveredBy` field.
    expect(report.proofWithoutHole).toEqual([]);
  });

  it('points coveredBy at a gate that is itself declared', () => {
    // Otherwise a region is passed to a gate nobody has audited, which relocates
    // the silence rather than closing it.
    expect(report.danglingCover).toEqual([]);
  });
});

describe('assessFieldOfView fails closed', () => {
  it('throws on an empty inventory rather than reporting clean', () => {
    // `[].filter(…)` is empty, so every difference above comes back clean and
    // the audit passes over nothing. §13's empty-container rule.
    expect(() => assessFieldOfView({ declared: FIELD_OF_VIEW, gates: [], controls })).toThrow(
      /inventory is empty/,
    );
  });

  it('reports an undeclared gate, a stale one, and an unproven region', () => {
    // Driven to a failing verdict on synthetic input: a converted gate with no
    // such test is a refactor recorded as a gate (§13).
    const out = assessFieldOfView({
      declared: [
        { gate: 'ghost', covers: 'nothing', blindTo: [{ region: 'r', why: 'w', coveredBy: null }] },
      ],
      gates: ['real-gate'],
      controls: [],
    });
    expect(out.undeclared).toEqual(['real-gate']);
    expect(out.stale).toEqual(['ghost']);
    expect(out.unproven).toEqual(['ghost: r']);
  });
});
