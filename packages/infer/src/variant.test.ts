/**
 * The precondition on the per-piece measurement, driven to its failing verdict.
 */
import { describe, expect, it } from 'vitest';
import { assessVariantIsMeasurable } from './variant.js';

describe('a variant that changed nothing is not a null result', () => {
  it('refuses a byte-identical variant, because "0 metrics moved" would read as evidence', () => {
    const problems = assessVariantIsMeasurable('narrowings', '{"a":1}', '{"a":1}');
    expect(problems.join('\n')).toContain('measured nothing');
    expect(problems.join('\n')).toContain('never exercised');
    expect(problems).toHaveLength(1);
  });

  it('names the piece, so the message says which row is unreadable', () => {
    expect(assessVariantIsMeasurable('dedupe', 'x', 'x').join('\n')).toContain('--without dedupe');
  });

  it('holds still when the variant genuinely changed the model', () => {
    expect(assessVariantIsMeasurable('dedupe', '{"a":1}', '{"a":2}')).toEqual([]);
  });
});
