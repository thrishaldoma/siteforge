/**
 * Phase ordering is enforced here, not documented anywhere.
 *
 * §13: documented conventions are what §3.4 and the same-origin rule both were,
 * and both turned out to be unenforced for as long as they were prose.
 */
import { describe, expect, it } from 'vitest';
import {
  POLICY_BY_CREDENTIAL_SOURCE,
  classifyControlHazard,
  decideNavigation,
  isOperationalError,
  operationalKind,
  planProbeSchedule,
  rethrowIfDefect,
  sameOrigin,
  terminatesAfterSchedule,
  OperationalError,
  allowedOrigins,
} from './index.js';

interface Ctl { name: string; hazard: 'target-destructive' | 'session-destructive' | 'out-of-scope' | null }
const CONTROLS: Ctl[] = [
  { name: 'Delete all todos', hazard: 'target-destructive' },
  { name: 'Show details', hazard: null },
  { name: 'Sign out', hazard: 'session-destructive' },
  { name: 'Help (external)', hazard: 'out-of-scope' },
  { name: 'Delete account', hazard: 'target-destructive' },
  { name: 'Add todo', hazard: null },
];

const plan = (over: Partial<Parameters<typeof planProbeSchedule<Ctl>>[0]> = {}) =>
  planProbeSchedule<Ctl>({
    controls: CONTROLS,
    hazardOf: (c) => c.hazard,
    allowDestructive: false,
    neverFire: (c) => c.name === 'Delete account',
    policy: 'credentialed',
    ...over,
  });

describe('probe phases run in an order the scheduler guarantees', () => {
  it('never schedules a later phase before an earlier one', () => {
    const rank = { ordinary: 0, 'session-destructive': 1, 'target-destructive': 2 };
    const seen = plan().map((s) => rank[s.phase]);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('schedules every control exactly once', () => {
    const names = plan().map((s) => s.control.name).sort();
    expect(names).toEqual(CONTROLS.map((c) => c.name).sort());
  });

  it('fires ordinary controls and declines out-of-scope ones in the first phase', () => {
    const ordinary = plan().filter((s) => s.phase === 'ordinary');
    expect(ordinary.filter((s) => s.fire).map((s) => s.control.name)).toEqual(['Show details', 'Add todo']);
    expect(ordinary.filter((s) => !s.fire).map((s) => s.declineReason)).toEqual(['out-of-scope']);
  });

  it('never fires a target-destructive control without --allow-destructive', () => {
    const targets = plan().filter((s) => s.phase === 'target-destructive');
    // Mapped rather than `every`: a planner that returned no target-destructive
    // schedules at all would satisfy `every` and this test would report that
    // nothing fired, which is true and worthless.
    expect(targets.map((s) => s.fire)).toEqual([false, false]);
    expect(targets.map((s) => s.declineReason)).toEqual(['target-destructive', 'target-destructive']);
  });

  it('fires allowed destructive controls but keeps the designated one declined', () => {
    const targets = plan({ allowDestructive: true }).filter((s) => s.phase === 'target-destructive');
    expect(targets.filter((s) => s.fire).map((s) => s.control.name)).toEqual(['Delete all todos']);
    expect(targets.filter((s) => !s.fire).map((s) => s.control.name)).toEqual(['Delete account']);
  });

  it('fires destructive controls only after every ordinary probe has run', () => {
    // The ordering that took statesProbed from 1 to 0 when it was violated:
    // a destructive probe empties the store for everything measured after it.
    const schedule = plan({ allowDestructive: true });
    const lastOrdinary = schedule.map((s) => s.phase).lastIndexOf('ordinary');
    const firstDestructive = schedule.findIndex((s) => s.phase === 'target-destructive');
    expect(firstDestructive).toBeGreaterThan(lastOrdinary);
  });
});

describe('session-destructive probing depends on whether a session can be replaced', () => {
  it('fires every session-destructive control when re-auth is non-interactive', () => {
    const many = [...CONTROLS, { name: 'Switch account', hazard: 'session-destructive' as const }];
    const fired = planProbeSchedule<Ctl>({
      controls: many, hazardOf: (c) => c.hazard, allowDestructive: false,
      neverFire: () => false, policy: 'credentialed',
    }).filter((s) => s.phase === 'session-destructive' && s.fire);
    expect(fired.map((s) => s.control.name)).toEqual(['Sign out', 'Switch account']);
  });

  it('spends exactly one session under interactive auth, and terminates', () => {
    // A headful human login cannot be repeated, so there is one session to
    // spend. Spending it early would end the crawl mid-capture.
    const many = [...CONTROLS, { name: 'Switch account', hazard: 'session-destructive' as const }];
    const schedule = planProbeSchedule<Ctl>({
      controls: many, hazardOf: (c) => c.hazard, allowDestructive: false,
      neverFire: () => false, policy: 'interactive',
    });
    const session = schedule.filter((s) => s.phase === 'session-destructive');
    expect(session.filter((s) => s.fire)).toHaveLength(1);
    expect(session.filter((s) => !s.fire).map((s) => s.declineReason)).toEqual(['session-budget-spent']);
    expect(terminatesAfterSchedule(schedule, 'interactive')).toBe(true);
  });

  it('does not terminate a credentialed crawl', () => {
    expect(terminatesAfterSchedule(plan(), 'credentialed')).toBe(false);
  });

  it('fires none when there is no authenticated context at all', () => {
    const schedule = plan({ policy: 'not-applicable' });
    expect(schedule.filter((s) => s.phase === 'session-destructive' && s.fire)).toHaveLength(0);
  });

  it('derives the policy from the credential source, not from a second field', () => {
    expect(POLICY_BY_CREDENTIAL_SOURCE.env).toBe('credentialed');
    expect(POLICY_BY_CREDENTIAL_SOURCE['os-keychain']).toBe('credentialed');
    expect(POLICY_BY_CREDENTIAL_SOURCE['interactive-only']).toBe('interactive');
  });
});

describe('the crawl boundary is one predicate', () => {
  const origins = allowedOrigins({ origin: 'https://shop.example.com' });

  it('blocks a main-frame navigation to another origin', () => {
    const d = decideNavigation({
      url: 'https://evil.example.net/', isNavigation: true, isMainFrame: true, allowedOrigins: origins,
    });
    expect(d).toEqual({ blocked: true, reason: 'off-origin-navigation', origin: 'https://evil.example.net' });
  });

  it('allows subresources from any origin — blocking them breaks every real site', () => {
    for (const url of ['https://cdn.example.net/f.woff2', 'https://fonts.gstatic.com/a.woff2']) {
      expect(decideNavigation({ url, isNavigation: false, isMainFrame: true, allowedOrigins: origins }).blocked)
        .toBe(false);
    }
  });

  it('allows a sub-frame navigation off-origin, because §11 needs the iframe to render', () => {
    expect(decideNavigation({
      url: 'https://widgets.example.net/reviews', isNavigation: true, isMainFrame: false, allowedOrigins: origins,
    }).blocked).toBe(false);
  });

  it('allows same-origin navigation', () => {
    expect(decideNavigation({
      url: 'https://shop.example.com/cart', isNavigation: true, isMainFrame: true, allowedOrigins: origins,
    }).blocked).toBe(false);
  });

  it('lets an origin-less URL through rather than failing closed on it', () => {
    // about:blank and data: have no origin to compare, and a popup opens on
    // about:blank before it navigates. Failing closed here would abort the
    // request the guard is supposed to inspect.
    for (const url of ['about:blank', 'data:text/html,hi']) {
      expect(decideNavigation({ url, isNavigation: true, isMainFrame: true, allowedOrigins: origins }).blocked)
        .toBe(false);
    }
  });

  it('takes its allowed set from the crawl scope, plus anything explicitly permitted', () => {
    const withAuth = allowedOrigins({
      origin: 'https://shop.example.com', additional: ['https://accounts.example.com'],
    });
    expect(decideNavigation({
      url: 'https://accounts.example.com/login', isNavigation: true, isMainFrame: true, allowedOrigins: withAuth,
    }).blocked).toBe(false);
  });
});

describe('the catch taxonomy distinguishes a bad site from a bad program', () => {
  it.each([
    ['a Playwright timeout', Object.assign(new Error('Timeout 2000ms exceeded.'), { name: 'TimeoutError' })],
    ['an aborted navigation', new Error('page.goto: net::ERR_ABORTED at https://x/')],
    ['a detached element', new Error('element is not attached to the DOM')],
    ['a refused connection', new Error('connect ECONNREFUSED 127.0.0.1:8789')],
    ['a closed target', new Error('Target page, context or browser has been closed')],
    ['our own policy block', new Error('net::ERR_BLOCKED_BY_CLIENT')],
    ['an explicit OperationalError', new OperationalError('nope', { kind: 'timeout' })],
  ])('treats %s as operational', (_label, err) => {
    expect(isOperationalError(err)).toBe(true);
    expect(operationalKind(err)).not.toBeNull();
    expect(() => rethrowIfDefect(err)).not.toThrow();
  });

  it.each([
    ['a ReferenceError — the exact defect that hid', new ReferenceError('probed is not defined')],
    ['a TypeError', new TypeError('Cannot read properties of undefined')],
    ['a plain Error', new Error('something unexpected')],
    ['a thrown string', 'not even an error'],
  ])('never treats %s as operational', (_label, err) => {
    expect(isOperationalError(err)).toBe(false);
    expect(() => rethrowIfDefect(err)).toThrow();
  });

  it('does not let a defect pass by wearing an operational message', () => {
    // The hole a text-only matcher would leave: the class wins over the text.
    const liar = new ReferenceError('Timeout 30000ms exceeded');
    expect(isOperationalError(liar)).toBe(false);
    expect(() => rethrowIfDefect(liar)).toThrow(ReferenceError);
  });
});

describe('a control is classified by who absorbs the harm, not by one bucket', () => {
  // These lists and this ordering were `rung3.mjs`'s locals until a second
  // driver needed them. Two crawlers disagreeing about whether the same button
  // is safe to press is §13's schema drift with a hazard attached, so the
  // judgement moved here and both import it — which also makes it testable
  // without driving a browser.
  // The real parsed comparison, not a stub. A `startsWith` double would pass
  // the prefix test below while asserting the opposite of what it claims — and
  // `lint:identifiers` said so, on this line, which is the rule working.
  const ORIGIN = 'http://127.0.0.1:3803';
  const classify = (name: string, href?: string) =>
    classifyControlHazard({ name, href, isSameOrigin: (h) => sameOrigin(h, ORIGIN) });

  it('separates the three hazards §6 used to conflate', () => {
    // The failure that produced the split: one "destructive" bucket put
    // "Sign out" and "Delete account" together, which left POST /logout
    // uncaptured while §10's auth tasks depend on it.
    expect(classify('Delete your Vikunja Account').hazard).toBe('target-destructive');
    expect(classify('Sign out').hazard).toBe('session-destructive');
    expect(classify('Save').hazard).toBe(null);
  });

  it('reads "delete account" as target-destructive, not as a session action', () => {
    // Order matters and is the reason it is written down. Signing out is a side
    // effect of deleting an account, so a session-first classifier would call
    // this recoverable and fire it.
    expect(classify('Delete account and log out')).toEqual({
      hazard: 'target-destructive',
      matchedTerm: 'delete',
    });
  });

  it('names the term that classified it, because the schema demands the evidence', () => {
    // `SkippedControlSchema` refuses a target-destructive skip with no
    // `matchedTerm`: a derived field carries what it was derived from.
    expect(classify('Remove label').matchedTerm).toBe('remove');
    expect(classify('Revoke token').matchedTerm).toBe('revoke');
  });

  it('puts a foreign origin out of scope ahead of any term match', () => {
    // A `mailto:` named "Delete" is still not ours to fire, so scope is decided
    // before hazard.
    expect(classify('Delete', 'mailto:ops@example.com')).toEqual({
      hazard: 'out-of-scope',
      outOfScopeTarget: 'mailto:',
    });
    expect(classify('Powered by Vikunja', 'https://vikunja.io/')).toEqual({
      hazard: 'out-of-scope',
      outOfScopeTarget: 'https://vikunja.io',
    });
  });

  it('decides the origin by the caller’s parsed comparison, never a prefix test', () => {
    // §13's identifier rule. `http://127.0.0.1:3803@evil.example/x` satisfies a
    // `startsWith` against the origin and is a foreign host; the caller passes
    // its parsed `sameOrigin` in so this cannot reinvent the mistake.
    expect(classify('Go', 'http://127.0.0.1:3803@evil.example/x').hazard).toBe('out-of-scope');
    expect(classify('Go', 'http://127.0.0.1:3803/projects').hazard).toBe(null);
  });

  it('is case-insensitive on the name, because a button shouts', () => {
    // Measured on the real target: Vikunja renders a `button "DELETE"`.
    expect(classify('DELETE').hazard).toBe('target-destructive');
  });

  it('leaves an ordinary control alone even when its href is same-origin', () => {
    // The negative case. A classifier that flagged anything with an href would
    // decline the whole navigation surface and probe nothing.
    expect(classify('Projects', 'http://127.0.0.1:3803/projects')).toEqual({ hazard: null });
  });
});
