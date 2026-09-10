import { describe, expect, it } from 'vitest';
import {
  DEFERRALS, assessDeferrals, assessSeedExpiry, countEmissions, type EmissionSource,
} from './deferral.js';

/**
 * A model that emits one of everything, at depth.
 *
 * Every counter is driven to **non-zero** here, and that direction is the
 * point: a broken counter reads `0`, which leaves a category sitting in
 * `emits-nothing` and the transition guard silent forever. Zero is the
 * failing-open value, so a test that only ever sees zero proves nothing.
 */
const EMITTING: EmissionSource = {
  operations: [
    {
      discovery: { kind: 'bound-from-control' },
      requestSchema: {
        type: 'object',
        properties: {
          // nested, so a counter that only looks at the root fails here
          nested: {
            type: 'object',
            properties: { when: { type: 'string', narrowing: { kind: 'format' } } },
          },
          rows: { type: 'array', items: { type: 'string', identifier: { pathParamOf: ['x'] } } },
        },
      },
      responses: [{ schema: { type: 'object', narrowing: { kind: 'enum' } } }],
    },
    { discovery: { kind: 'observed' }, responses: [{ schema: { type: 'string' } }] },
  ],
  entities: [
    { fields: [{ narrowing: { kind: 'enum' } }, {}], relations: [{ field: 'a' }] },
    { fields: [{}], relations: [] },
  ],
};

describe('emission counters', () => {
  it('counts every deferred category to a non-zero value', () => {
    expect(countEmissions(EMITTING)).toEqual({
      narrowing: 2,
      identifier: 1,
      'entity-narrowing': 1,
      'entity-relation': 1,
      'synthesized-endpoint': 1,
    });
  });

  it('keeps narrowing and entity-narrowing apart, on one model', () => {
    // The discriminating case. Both read a NarrowingRecord, on different
    // paths; one counter covering both would report the same number for each
    // and collapse `emits-but-unscored` into `emits-nothing`. On the real
    // capture that is 43 and 0.
    const operationsOnly: EmissionSource = {
      operations: [{ responses: [{ schema: { narrowing: { kind: 'format' } } }] }],
      entities: [{ fields: [{}], relations: [] }],
    };
    const counts = countEmissions(operationsOnly);
    expect(counts.narrowing).toBe(1);
    expect(counts['entity-narrowing']).toBe(0);
  });

  it('reads zero from an empty model without throwing', () => {
    expect(countEmissions({})).toEqual({
      narrowing: 0, identifier: 0, 'entity-narrowing': 0, 'entity-relation': 0,
      'synthesized-endpoint': 0,
    });
  });
});

describe('assessDeferrals', () => {
    // The real emissions: narrowing 43, synthesized-endpoint 5, the rest zero.
  const nothing = { narrowing: 43, identifier: 0, 'entity-narrowing': 0, 'entity-relation': 0, 'synthesized-endpoint': 5 };

  it('accepts the declared table against the emissions it describes', () => {
    expect(assessDeferrals({ deferrals: DEFERRALS, emissions: nothing })).toEqual([]);
  });

  it('fails a category that starts emitting while declared emits-nothing', () => {
    // The transition the whole table exists to catch, and the one that already
    // happened once: nobody decided to ship 43 unscored narrowings.
    const findings = assessDeferrals({
      deferrals: DEFERRALS,
      emissions: { ...nothing, 'entity-relation': 3 },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe('entity-relation');
    expect(findings[0]?.problem).toBe('class-changed');
  });

  it('fails a tracked risk that emits nothing, rather than calling it safe', () => {
    const findings = assessDeferrals({ deferrals: DEFERRALS, emissions: { ...nothing, narrowing: 0 } });
    expect(findings.map((f) => f.problem)).toEqual(['deferral-unexercised']);
  });

  it('fails a deferral with no counter, rather than passing it silently', () => {
    const { narrowing: _drop, ...missing } = nothing;
    const findings = assessDeferrals({ deferrals: DEFERRALS, emissions: missing });
    expect(findings[0]?.problem).toBe('class-changed');
    expect(findings[0]?.detail).toContain('nothing counts what it emits');
  });

  it('refuses a tracked risk with no expiry', () => {
    const findings = assessDeferrals({
      deferrals: [{ category: 'narrowing', kind: 'emits-but-unscored', reason: 'x' }],
      emissions: nothing,
    });
    expect(findings.map((f) => f.problem)).toEqual(['undeclared-expiry']);
  });

  it('declares a reason for every deferral, and an expiry for every tracked risk', () => {
    for (const d of DEFERRALS) {
      expect(d.reason.length, `${d.category} needs a reason`).toBeGreaterThan(60);
      if (d.kind === 'emits-but-unscored') {
        expect((d.expiry ?? '').length, `${d.category} needs an expiry`).toBeGreaterThan(40);
      }
    }
  });
});

describe('assessSeedExpiry', () => {
  it('stays silent while codegen produces no seeds', () => {
    // Today's state, and the reason this can land now: codegen is a stub.
    expect(assessSeedExpiry({ seedFiles: [], narrowingScored: false })).toBeNull();
  });

  it('fires the moment a seed exists while narrowing is unscored', () => {
    const f = assessSeedExpiry({ seedFiles: ['envs/vikunja/seeds/42.json'], narrowingScored: false });
    expect(f?.problem).toBe('expiry-fired');
    expect(f?.detail).toContain('envs/vikunja/seeds/42.json');
  });

  it('stays silent once narrowing is scored, which is the deferral ending properly', () => {
    expect(assessSeedExpiry({ seedFiles: ['envs/vikunja/seeds/42.json'], narrowingScored: true })).toBeNull();
  });
});
