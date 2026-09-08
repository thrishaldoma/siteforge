/**
 * Each case here is a bug this repo actually shipped, or the near-miss beside
 * it. The list is the argument for the module existing: five occurrences of one
 * mistake — a string operation against a grammar with delimiters — across four
 * different grammars, three of them found by deliberately looking rather than
 * by a gate firing.
 */
import { describe, expect, it } from 'vitest';
import {
  PathPatternError,
  assetKind,
  hasScheme,
  hostMatchesAllowEntry,
  isAbsoluteUrl,
  isMime,
  matchPath,
  parseMime,
  parsePathPattern,
  pathSegments,
} from './identifiers.js';

describe('paths are compared by segment, and patterns say where they anchor', () => {
  it('refuses a bare name — the pattern that hid packages/capture', () => {
    expect(() => parsePathPattern('capture')).toThrow(PathPatternError);
    expect(() => parsePathPattern('dist')).toThrow(/unanchored/);
  });

  it('accepts each anchored spelling', () => {
    expect(parsePathPattern('/a/b')).toEqual({ kind: 'exact', path: 'a/b' });
    expect(parsePathPattern('/a/b/**')).toEqual({ kind: 'under', path: 'a/b' });
    expect(parsePathPattern('**/dist')).toEqual({ kind: 'anyDepthName', name: 'dist' });
    expect(parsePathPattern('*.map')).toEqual({ kind: 'extension', ext: '.map' });
  });

  it('rejects a **/ pattern carrying a path rather than a name', () => {
    expect(() => parsePathPattern('**/a/b')).toThrow(PathPatternError);
  });

  it('matches an exact path and nothing under or beside it', () => {
    const p = parsePathPattern('/auth/storage-state.json');
    expect(matchPath('auth/storage-state.json', p)).toBe(true);
    // §3.4's exemption, which `endsWith` gave away at any depth.
    expect(matchPath('routes/r0/auth/storage-state.json', p)).toBe(false);
    expect(matchPath('auth/storage-state.json.bak', p)).toBe(false);
  });

  it('matches a subtree by segment, so /api does not match /api-docs', () => {
    const p = parsePathPattern('/api/**');
    expect(matchPath('api', p)).toBe(true);
    expect(matchPath('api/todos/1', p)).toBe(true);
    expect(matchPath('api-docs', p)).toBe(false);
    expect(matchPath('apifoo/x', p)).toBe(false);
  });

  it('matches a basename at any depth only when asked to', () => {
    const p = parsePathPattern('**/node_modules');
    expect(matchPath('node_modules', p)).toBe(true);
    expect(matchPath('packages/x/node_modules', p)).toBe(true);
    expect(matchPath('packages/node_modules_old', p)).toBe(false);
  });

  it('matches an extension as an extension', () => {
    const p = parsePathPattern('*.js');
    expect(matchPath('a/b.js', p)).toBe(true);
    // `endsWith('.js')` says true for both of these; only one is a .js file.
    expect(matchPath('a/b.mjs', p)).toBe(false);
    expect(matchPath('a/.js', p)).toBe(false);
  });

  it('normalises separators and empty segments', () => {
    expect(pathSegments('a//b/./c')).toEqual(['a', 'b', 'c']);
    expect(pathSegments('/a/b/')).toEqual(['a', 'b']);
  });
});

describe('a MIME type is type/subtype, not a substring haystack', () => {
  it.each([
    ['text/css', 'stylesheet'],
    ['text/css; charset=utf-8', 'stylesheet'],
    ['image/png', 'image'],
    ['image/svg+xml', 'image'],
    ['font/woff2', 'font'],
    ['application/x-font-woff', 'font'],
    ['application/javascript', 'script'],
    ['text/javascript;charset=UTF-8', 'script'],
    ['application/json', 'json'],
    ['application/problem+json', 'json'],
    ['text/html', 'document'],
    ['application/xhtml+xml', 'document'],
    ['video/mp4', 'media'],
    ['application/octet-stream', 'other'],
  ])('%s is %s', (mime, kind) => {
    expect(assetKind(mime)).toBe(kind);
  });

  it.each([
    ['application/x-not-css', 'other'],
    ['text/plain; charset=x-csserror', 'other'],
    ['text/plain; filename=index.html', 'other'],
  ])('%s is %s — the false positives includes() produced', (mime, kind) => {
    // Each of these satisfies the old chain: `.includes('css')`,
    // `.includes('css')` via the parameter, `.includes('html')` via a filename.
    expect(assetKind(mime)).toBe(kind);
  });

  it('parses components and parameters', () => {
    expect(parseMime('Text/HTML; Charset="UTF-8"')).toEqual({
      type: 'text', subtype: 'html', suffix: null, parameters: { charset: 'UTF-8' },
    });
    expect(parseMime('application/problem+json')?.suffix).toBe('json');
  });

  it('returns null rather than guessing at a malformed value', () => {
    for (const bad of ['', 'text', 'text/', '/html', 'not a mime']) {
      expect(parseMime(bad), bad).toBeNull();
    }
    expect(assetKind('not a mime')).toBe('other');
  });

  it('compares an exact type/subtype ignoring parameters', () => {
    expect(isMime('text/html; charset=utf-8', 'text', 'html')).toBe(true);
    expect(isMime('text/html', 'text', 'plain')).toBe(false);
  });
});

describe('a scheme is the parsed protocol', () => {
  it('does not confuse a prefix for a scheme', () => {
    expect(hasScheme('https://x/', 'http')).toBe(false);
    expect(hasScheme('https://x/', 'https')).toBe(true);
    // `startsWith('http')` is true for both of these and for neither reason.
    expect(hasScheme('httpfoo://x/', 'http')).toBe(false);
    expect(hasScheme('chrome-error://chromewebdata/', 'chrome-error')).toBe(true);
  });

  it('is case-insensitive and rejects a relative reference', () => {
    expect(hasScheme('HTTPS://x/', 'https')).toBe(true);
    expect(hasScheme('/relative/path', 'http')).toBe(false);
    expect(hasScheme('', 'http')).toBe(false);
  });

  it('separates absolute from relative by parsing', () => {
    expect(isAbsoluteUrl('https://example.com/a')).toBe(true);
    expect(isAbsoluteUrl('data:text/plain,x')).toBe(true);
    expect(isAbsoluteUrl('/a/b')).toBe(false);
    expect(isAbsoluteUrl('a/b.png')).toBe(false);
  });
});

describe('an allowlist host is compared by label (§3.1)', () => {
  it.each([
    ['example.com', 'example.com', true],
    ['docs.example.com', 'example.com', false],
    ['docs.example.com', '.example.com', true],
    ['example.com', '.example.com', true],
    ['a.b.example.com', '.example.com', true],
  ])('%s against %s is %s', (host, entry, want) => {
    expect(hostMatchesAllowEntry(host, entry)).toBe(want);
  });

  it.each([
    ['notexample.com', 'example.com'],
    ['evilexample.com', '.example.com'],
    ['example.com.evil.net', 'example.com'],
    ['example.com.evil.net', '.example.com'],
  ])('%s must not match %s', (host, entry) => {
    // The last two are the shape that made `href.startsWith(ORIGIN)` a hole.
    expect(hostMatchesAllowEntry(host, entry)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hostMatchesAllowEntry('EXAMPLE.com', 'example.com')).toBe(true);
  });
});
