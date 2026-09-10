import { describe, expect, it } from 'vitest';
import { assessWriteAttribution } from './write-attribution.js';

describe('assessWriteAttribution', () => {
  const base = { crawlWideWrites: 4, attributedWrites: 2, outsideProbeWrites: 2, lost: 0 };

  it('admits a crawl whose writes all have an owner', () => {
    expect(assessWriteAttribution(base)).toBeNull();
  });

  it('admits it with exchanges lost to a closing page, which are outside the total', () => {
    // `lost` must not be a term in the sum. An exchange whose body never
    // arrived was never counted, so subtracting it would break conservation on
    // a crawl where nothing was misattributed.
    expect(assessWriteAttribution({ ...base, lost: 7 })).toBeNull();
  });

  it('catches a write with no owner, which is the lost-attribution case', () => {
    const f = assessWriteAttribution({ ...base, attributedWrites: 1 });
    expect(f?.problem).toBe('not-conserved');
    expect(f?.detail).toContain('1 write(s) have no owner');
  });

  it('catches a write claimed twice, which is the misattribution case', () => {
    // The dangerous direction: overlap means a probe is credited with traffic
    // that was also counted outside it, so a drift point looks explained.
    const f = assessWriteAttribution({ ...base, attributedWrites: 3 });
    expect(f?.problem).toBe('not-conserved');
    expect(f?.detail).toContain('claimed twice');
  });

  it('reports a zero crawl as conserved rather than as a problem', () => {
    // A crawl that wrote nothing is conserved. Whether that is believable is
    // assessProbeContamination's question (`instrument-silent`), not this one —
    // two gates, two claims, and folding them together would let either hide.
    expect(assessWriteAttribution({ crawlWideWrites: 0, attributedWrites: 0, outsideProbeWrites: 0, lost: 0 })).toBeNull();
  });

  it('refuses a count that is not one, before trying to add it up', () => {
    // Ordered first on purpose: a negative term can make a broken sum
    // reconcile by accident, and then conservation passes on nonsense.
    expect(assessWriteAttribution({ ...base, attributedWrites: -1, outsideProbeWrites: 3 })?.problem)
      .toBe('negative-count');
    expect(assessWriteAttribution({ ...base, lost: 1.5 })?.problem).toBe('negative-count');
  });
});
