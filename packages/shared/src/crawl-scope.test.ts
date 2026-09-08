/**
 * Origin identity, compared as a parsed component and never as a prefix.
 *
 * `href.startsWith(ORIGIN)` classified controls in rung 3. Two URLs pass that
 * test and are not same-origin:
 *
 *   http://127.0.0.1:8789@evil.example/x  → origin http://evil.example
 *   https://example.com.evil.net/x        → origin https://example.com.evil.net
 *
 * The second needs no port on the legitimate origin, which is every real
 * target. The consequence was contained — the router chokepoint compares parsed
 * origins, so the navigation was still blocked — but the *classifier* called a
 * foreign link same-origin, so no out-of-scope gap was recorded and the control
 * was fired rather than declined. Defence in depth held; the outer layer was
 * wrong.
 */
import { describe, expect, it } from 'vitest';
import { allowedOrigins, decideNavigation, isUnder, sameOrigin } from './crawl-scope.js';

const ORIGIN = 'http://127.0.0.1:8789';
const PORTLESS = 'https://example.com';

/** Every one of these passes `startsWith` and is a different origin. */
const PREFIX_IMPOSTORS = [
  [`${ORIGIN}@evil.example.net/x`, 'userinfo makes the host something else'],
  [`${PORTLESS}.evil.net/x`, 'a suffixed host, for an origin with no port'],
  [`${PORTLESS}.evil.net/`, 'the same, bare'],
] as const;

describe('an origin is a parsed component, not a string prefix', () => {
  it.each(PREFIX_IMPOSTORS)('rejects %s — %s', (url) => {
    const against = url.startsWith(ORIGIN) ? ORIGIN : PORTLESS;
    // The property the fix is about: the impostor passes the old test.
    expect(url.startsWith(against)).toBe(true);
    expect(sameOrigin(url, against)).toBe(false);
  });

  it.each([
    [`${ORIGIN}/ok`, ORIGIN],
    [`${ORIGIN}/`, ORIGIN],
    [`${ORIGIN}/deep/path?q=1#frag`, ORIGIN],
    [`${PORTLESS}/ok`, PORTLESS],
  ])('accepts %s', (url, origin) => {
    expect(sameOrigin(url, origin)).toBe(true);
  });

  it('rejects a URL with no origin at all rather than throwing', () => {
    expect(sameOrigin('data:text/html,<p>', ORIGIN)).toBe(false);
    expect(sameOrigin('not a url', ORIGIN)).toBe(false);
    expect(sameOrigin('about:blank', ORIGIN)).toBe(false);
  });

  it('distinguishes scheme, host and port', () => {
    expect(sameOrigin('https://127.0.0.1:8789/x', ORIGIN)).toBe(false);
    expect(sameOrigin('http://127.0.0.2:8789/x', ORIGIN)).toBe(false);
    expect(sameOrigin('http://127.0.0.1:8790/x', ORIGIN)).toBe(false);
    // localhost and 127.0.0.1 are different origins, which is what rung 2's
    // two-origin fixture rests on.
    expect(sameOrigin('http://localhost:8789/x', ORIGIN)).toBe(false);
  });
});

describe('a path prefix is compared by segment', () => {
  it.each([
    [`${ORIGIN}/api`, true],
    [`${ORIGIN}/api/`, true],
    [`${ORIGIN}/api/todos`, true],
    [`${ORIGIN}/api/todos/1`, true],
  ])('%s is under /api', (url, want) => {
    expect(isUnder(url, { origin: ORIGIN, pathPrefix: '/api' })).toBe(want);
  });

  it.each([
    [`${ORIGIN}/api-docs`],
    [`${ORIGIN}/apifoo/x`],
    [`${ORIGIN}/`],
    [`${ORIGIN}/other/api`],
  ])('%s is not under /api', (url) => {
    // `/api-docs`.startsWith('/api') is true; the segment comparison is the
    // reason this answers correctly.
    expect(isUnder(url, { origin: ORIGIN, pathPrefix: '/api' })).toBe(false);
  });

  it('checks the origin before the path', () => {
    expect(isUnder(`${ORIGIN}@evil.example.net/api/todos`, {
      origin: ORIGIN, pathPrefix: '/api',
    })).toBe(false);
  });

  it('matches any path when no prefix is given', () => {
    expect(isUnder(`${ORIGIN}/anything`, { origin: ORIGIN })).toBe(true);
    expect(isUnder('https://elsewhere.net/anything', { origin: ORIGIN })).toBe(false);
  });
});

describe('the chokepoint was already parsing, and stays that way', () => {
  const scope = allowedOrigins({ origin: ORIGIN });

  it('blocks the impostor origins it would have to be tricked by', () => {
    for (const [url] of PREFIX_IMPOSTORS) {
      const decision = decideNavigation({
        url, isNavigation: true, isMainFrame: true, allowedOrigins: scope,
      });
      expect(decision.blocked, `${url} reached the target`).toBe(true);
    }
  });

  it('still allows the real origin', () => {
    expect(decideNavigation({
      url: `${ORIGIN}/page`, isNavigation: true, isMainFrame: true, allowedOrigins: scope,
    }).blocked).toBe(false);
  });
});
