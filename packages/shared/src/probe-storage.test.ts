import { describe, expect, it } from 'vitest';
import {
  SESSION_STORAGE_KEYS, isSessionStorageKey, nonSessionKeys, sessionOnlyStorageState,
} from './probe-storage.js';

describe('probe client storage', () => {
  // The keys measured on the target, in the order the browser reported them.
  const OBSERVED = [
    'hideAddToHomeScreenMessage', 'token', 'navigation-child-projects-open',
    'projectHistory', 'lastVisited', 'projectView', 'menuActiveDesktopPreference', 'API_URL',
  ];

  it('drops the UI preferences and keeps the session', () => {
    expect(nonSessionKeys(OBSERVED)).toEqual([
      'hideAddToHomeScreenMessage', 'navigation-child-projects-open',
      'projectHistory', 'lastVisited', 'projectView', 'menuActiveDesktopPreference',
    ]);
  });

  it('keeps the token, because clearing it measures a login screen', () => {
    // The failure this guards is 0019's: the crawl still completes and its
    // output is indistinguishable from a clean one.
    expect(isSessionStorageKey('token')).toBe(true);
    expect(nonSessionKeys(['token'])).toEqual([]);
  });

  it('clears a key it has never seen, rather than keeping it', () => {
    // The direction is the argument. An unknown UI preference is the case this
    // exists to catch; a forgotten session key fails loudly at the next probe.
    expect(nonSessionKeys(['someFutureViewPreference'])).toEqual(['someFutureViewPreference']);
  });

  it('declares a reason for every key it keeps', () => {
    for (const [key, reason] of SESSION_STORAGE_KEYS) {
      expect(reason.length, `${key} needs a reason`).toBeGreaterThan(40);
    }
  });

  it('strips a storage state down to the session, per origin', () => {
    const stripped = sessionOnlyStorageState({
      cookies: [{ name: 'c' }],
      origins: [{
        origin: 'http://127.0.0.1:3803',
        localStorage: [
          { name: 'token', value: 'jwt' },
          { name: 'projectView', value: 'gantt' },
        ],
      }],
    });
    expect(stripped.origins?.[0]?.localStorage).toEqual([{ name: 'token', value: 'jwt' }]);
    expect(stripped.cookies).toEqual([{ name: 'c' }]);
  });

  it('passes through a state with no origins rather than inventing one', () => {
    expect(sessionOnlyStorageState({ cookies: [] })).toEqual({ cookies: [] });
  });
});
