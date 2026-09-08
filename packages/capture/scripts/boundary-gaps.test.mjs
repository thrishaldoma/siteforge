/**
 * The crawl boundary's refusals, as tracked gaps.
 *
 * Two bugs are pinned here.
 *
 * The first: a cancelled download and a closed popup were counted in a console
 * line and recorded nowhere. §13 — a known gap recorded only in prose is not
 * tracked — so the next stage had no way to learn that a control leads
 * somewhere the crawl declined to follow.
 *
 * The second: the popup gap named `chrome-error://chromewebdata/`, the page
 * Chromium substitutes once the router aborts the navigation. A gap naming the
 * origin it protected you from is useful; one naming an error page is not. The
 * intended URL is not recoverable from the popup — measured, at the event, via
 * `mainFrame().url()`, and 300ms later, all three give the error page — so the
 * router's record owns it, and the popup no longer emits a rival record.
 */
import { describe, expect, it } from 'vitest';
import * as S from '../../schema/dist/index.js';
import { boundaryGaps } from './capture-lib.mjs';

const gapId = (label) => `gap_${S.shortHash(label).slice(0, 12)}`;
const build = (events) =>
  boundaryGaps(events, { gapId, routeId: 'root--anon-desktop--i0', fallbackUrl: 'http://127.0.0.1:8788/' });

const NAV = { kind: 'navigation', url: 'https://example.net/partner', origin: 'https://example.net' };
const BLOCKED_POPUP = { kind: 'popup', url: null, origin: null };
const OPEN_POPUP = { kind: 'popup', url: 'http://127.0.0.1:8788/other', origin: 'http://127.0.0.1:8788' };
const DOWNLOAD = { kind: 'download', url: 'http://127.0.0.1:8788/report.csv', origin: 'http://127.0.0.1:8788' };

describe('every boundary refusal becomes a gap', () => {
  it('records a blocked navigation against the URL it protected the crawl from', () => {
    const [gap, ...rest] = build([NAV]);
    expect(rest).toEqual([]);
    expect(gap.subject.url).toBe('https://example.net/partner');
    expect(gap.summary).toContain('https://example.net');
    expect(gap.category).toBe('out-of-scope-control');
  });

  it('records a cancelled download', () => {
    const [gap] = build([DOWNLOAD]);
    expect(gap.summary).toContain('report.csv');
    expect(gap.subject.url).toBe(DOWNLOAD.url);
    // Not `none`: the control renders and does nothing, which the clone has to
    // account for.
    expect(gap.stub.kind).toBe('omitted');
  });

  it('records a popup it could crawl but chose not to', () => {
    const [gap] = build([OPEN_POPUP]);
    expect(gap.summary).toContain('closed without being crawled');
    expect(gap.subject.url).toBe(OPEN_POPUP.url);
  });

  it('lets the router own the URL when a popup was blocked', () => {
    // The pairing is exact — two window.open calls to two foreign origins
    // produce exactly two router records — so a second gap here would be a
    // duplicate carrying strictly less information.
    const gaps = build([NAV, BLOCKED_POPUP]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].subject.url).toBe(NAV.url);
  });

  it('still reports a blocked popup the router never saw', () => {
    // The one case correlation would have covered: a popup that failed for a
    // reason unrelated to the boundary. Silence here would be a dropped escape.
    const gaps = build([BLOCKED_POPUP]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].severity).toBe('degraded');
    expect(gaps[0].summary).toContain('never recorded');
  });

  it('never names an error page in any gap it writes', () => {
    const gaps = build([NAV, BLOCKED_POPUP, OPEN_POPUP, DOWNLOAD]);
    const text = JSON.stringify(gaps);
    expect(text).not.toContain('chrome-error');
    expect(text).not.toContain('about:blank');
  });

  describe('gap ids are stable, because contentHash is M1\'s idempotency check', () => {
    it('derives the id from the URL, not from arrival order', () => {
      // Output is grouped by kind, so it is already independent of the order
      // events arrived in; what matters is that the *ids* do not move.
      const a = build([NAV, DOWNLOAD]).map((g) => g.gapId).sort();
      const b = build([DOWNLOAD, NAV]).map((g) => g.gapId).sort();
      expect(a).toEqual(b);
      expect(new Set(a).size).toBe(2);
    });

    it('gives different URLs different ids', () => {
      const [one] = build([NAV]);
      const [two] = build([{ ...NAV, url: 'https://example.org/other' }]);
      expect(one.gapId).not.toBe(two.gapId);
    });

    it('gives the same URL the same id on every run', () => {
      expect(build([NAV])[0].gapId).toBe(build([NAV])[0].gapId);
    });
  });

  it('emits gaps the schema accepts — a fixture is legal or it is a lie', () => {
    for (const gap of build([NAV, BLOCKED_POPUP, OPEN_POPUP, DOWNLOAD])) {
      const parsed = S.GapSchema.safeParse(gap);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('emits nothing when the boundary refused nothing', () => {
    expect(build([])).toEqual([]);
  });
});
