/**
 * Structured comparison for the identifier grammars this repo keeps getting
 * wrong with string operations.
 *
 * `includes()` on a CSS selector and `endsWith()` on a path are one mistake:
 * a string operation against a grammar with delimiters, where the operation
 * cannot see the delimiters or where the value is anchored. It has now cost
 * this project, in order:
 *
 *   - `.btn:focus-visible` read as `.btn-visible`, and every
 *     `[aria-expanded="true"]` rule dropped (decision 0008, selectors);
 *   - `packages/capture/` hidden from the catch linter by the bare name
 *     `capture` (paths);
 *   - `endsWith('auth/storage-state.json')` exempting a file at any depth from
 *     §3.4's content scan (paths, inside a security gate);
 *   - `href.startsWith(ORIGIN)` calling `http://origin@evil.example` and
 *     `https://example.com.evil.net` same-origin (URLs);
 *   - `cssomText.includes('flag')` treating a new class as explained by the
 *     attribute name `data-flagged` (selectors again, and it was dropping a
 *     probed state on every rung-3 run).
 *
 * Origins live in `crawl-scope.ts` (`sameOrigin`, `isUnder`) because the crawl
 * boundary owns them. Selectors are parsed with `postcss-selector-parser` in
 * capture. Paths and MIME types are here.
 */

/* ------------------------------------------------------------------- paths */

/**
 * A path pattern: an exact relative path, or a glob anchored at one end.
 *
 * Deliberately small. Every pattern says where it is anchored, because the
 * whole bug class is patterns that quietly match anywhere.
 */
export type PathPattern =
  /** Exactly this root-relative path. */
  | { kind: 'exact'; path: string }
  /** This path or anything beneath it, compared by segment. */
  | { kind: 'under'; path: string }
  /** A basename at any depth — spelled out, never inferred from a bare name. */
  | { kind: 'anyDepthName'; name: string }
  /** A file extension, compared as a real extension and not a suffix. */
  | { kind: 'extension'; ext: string };

export class PathPatternError extends Error {
  override readonly name = 'PathPatternError';
}

/** Split a path into non-empty segments, tolerating either separator. */
export const pathSegments = (path: string): string[] =>
  path.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');

/**
 * Parse the anchored mini-syntax used in configuration.
 *
 *   `/a/b`      exact          `a/b` and nothing else
 *   `/a/b/**`   under          `a/b`, `a/b/c`, …
 *   `**​/name`   anyDepthName   any path whose last segment is `name`
 *   `*.ext`     extension      any path whose final extension is `.ext`
 *
 * A bare name throws. That is the entire point: `capture` as a pattern is what
 * hid a package, and there is no spelling of it here that does not say whether
 * it means the root or any depth.
 */
export function parsePathPattern(pattern: string): PathPattern {
  // identifier: paths — this function *is* the parser, and these read the
  // anchoring markers of the pattern mini-syntax rather than comparing a path.
  if (pattern.startsWith('**/')) {
    const name = pattern.slice(3);
    if (name.length === 0 || name.includes('/')) {
      throw new PathPatternError(`'**/' must be followed by a single name, got ${JSON.stringify(pattern)}`);
    }
    return { kind: 'anyDepthName', name };
  }
  // identifier: paths — pattern mini-syntax markers, as above.
  if (pattern.startsWith('*.')) return { kind: 'extension', ext: pattern.slice(1) };
  // identifier: paths — pattern mini-syntax markers, as above.
  if (pattern.startsWith('/')) {
    // identifier: paths — pattern mini-syntax markers, as above.
    if (pattern.endsWith('/**')) return { kind: 'under', path: pattern.slice(1, -3) };
    return { kind: 'exact', path: pattern.slice(1) };
  }
  throw new PathPatternError(
    `path pattern ${JSON.stringify(pattern)} is unanchored. Use '/exact/path', '/dir/**', '**/name' or '*.ext' — a bare name matches at any depth by accident, which is how packages/capture/ disappeared.`,
  );
}

/**
 * Is `want` a segment-wise prefix of `got`? **Throws on an empty `want`.**
 *
 * Three copies of these two lines existed — `inUniverse` in the grader,
 * `isUnder` on the crawl boundary, and `matchPath`'s `under` branch — and each
 * decided the empty case by accident, because `[].every(…)` is `true`. An empty
 * prefix therefore matched every path in existence: the predicate did not become
 * permissive, it stopped being a predicate. The grader's universe filter admitted
 * an entire SPA that way (0019).
 *
 * Empty is not a prefix meaning *everything*; it is the caller failing to say
 * what it meant. Where "everything" is a real option the caller expresses it
 * separately — `isUnder` has `pathPrefix: undefined` for exactly that — so
 * throwing here costs nothing legitimate and converts a silent universal match
 * into a stack trace.
 *
 * @throws if `want` is empty.
 */
export function isSegmentPrefix(want: readonly string[], got: readonly string[]): boolean {
  if (want.length === 0) {
    throw new Error(
      'isSegmentPrefix received an empty prefix, which would match every path. An empty container must never silently admit: say "everything" explicitly if that is what you mean.',
    );
  }
  // empty: thrown on above — this function is where the decision is made
  return want.every((segment, i) => got[i] === segment);
}

/** Does `relPath` (root-relative) match this pattern? */
export function matchPath(relPath: string, pattern: PathPattern): boolean {
  const got = pathSegments(relPath);
  switch (pattern.kind) {
    case 'exact': {
      const want = pathSegments(pattern.path);
      return got.length === want.length && want.every((s, i) => got[i] === s);
    }
    case 'under': {
      const want = pathSegments(pattern.path);
      // `/**` parses to an empty path, and used to match everything silently.
      return want.length <= got.length && isSegmentPrefix(want, got);
    }
    case 'anyDepthName':
      return got.length > 0 && got[got.length - 1] === pattern.name;
    case 'extension': {
      const last = got[got.length - 1];
      if (last === undefined) return false;
      const dot = last.lastIndexOf('.');
      return dot > 0 && last.slice(dot) === pattern.ext;
    }
  }
}

/** Convenience: does the path match any of these patterns? */
export const matchesAnyPath = (relPath: string, patterns: readonly PathPattern[]): boolean =>
  patterns.some((p) => matchPath(relPath, p));

/* --------------------------------------------------------------- mime types */

export interface MimeType {
  /** `text` in `text/html; charset=utf-8`. Lower-cased. */
  type: string;
  /** `html` in the same. Lower-cased, with any `+suffix` kept. */
  subtype: string;
  /** `html` in `application/xhtml+xml` is the *suffix*; this is `xml`. */
  suffix: string | null;
  parameters: Readonly<Record<string, string>>;
}

/**
 * Parse a `Content-Type`.
 *
 * `mime.includes('css')` is the bug this replaces: it matches
 * `application/x-not-css`, and it matches `text/plain; charset=x-csserror` on
 * the *parameter*. Type and subtype are separate tokens; compare them.
 */
export function parseMime(value: string): MimeType | null {
  const [essence, ...paramParts] = value.split(';');
  if (essence === undefined) return null;
  const trimmed = essence.trim().toLowerCase();
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) return null;
  const type = trimmed.slice(0, slash);
  const subtype = trimmed.slice(slash + 1);
  if (/[^a-z0-9!#$&^_.+-]/.test(type) || /[^a-z0-9!#$&^_.+-]/.test(subtype)) return null;
  const plus = subtype.lastIndexOf('+');
  const parameters: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    parameters[part.slice(0, eq).trim().toLowerCase()] =
      part.slice(eq + 1).trim().replace(/^"|"$/g, '');
  }
  return { type, subtype, suffix: plus > 0 ? subtype.slice(plus + 1) : null, parameters };
}

/**
 * The asset kinds §5's index distinguishes.
 *
 * One table, matched on parsed components. The alternative — a chain of
 * `includes()` over the raw header — is order-dependent and was written
 * differently in two places, which is its own bug waiting to happen.
 */
export type AssetKind =
  | 'image' | 'font' | 'stylesheet' | 'script' | 'document' | 'json' | 'media' | 'other';

const SUBTYPE_KIND: Readonly<Record<string, AssetKind>> = {
  css: 'stylesheet',
  javascript: 'script',
  ecmascript: 'script',
  json: 'json',
  html: 'document',
  xhtml: 'document',
};

export function assetKind(contentType: string): AssetKind {
  const mime = parseMime(contentType);
  if (mime === null) return 'other';
  if (mime.type === 'image') return 'image';
  if (mime.type === 'font') return 'font';
  if (mime.type === 'audio' || mime.type === 'video') return 'media';
  // `application/x-font-woff` and friends predate the `font/*` tree.
  if (mime.subtype.startsWith('x-font-') || mime.subtype === 'font-woff') return 'font';
  const base = mime.suffix !== null ? mime.subtype.slice(0, mime.subtype.lastIndexOf('+')) : mime.subtype;
  const stripped = base.startsWith('x-') ? base.slice(2) : base;
  return SUBTYPE_KIND[stripped] ?? SUBTYPE_KIND[mime.suffix ?? ''] ?? 'other';
}

/** Is this content type the given `type/subtype`, ignoring parameters? */
export function isMime(contentType: string, type: string, subtype: string): boolean {
  const mime = parseMime(contentType);
  return mime !== null && mime.type === type && mime.subtype === subtype;
}

/* ------------------------------------------------------------------ schemes */

/**
 * Does the URL use this scheme? Compared against the parsed protocol.
 *
 * `url.startsWith('http')` also accepts `httpfoo:` and — more usefully wrong —
 * says nothing about `https`. Pass schemes without the colon.
 */
export function hasScheme(url: string, ...schemes: readonly string[]): boolean {
  const colon = url.indexOf(':');
  if (colon <= 0) return false;
  const scheme = url.slice(0, colon).toLowerCase();
  if (/[^a-z0-9+.-]/.test(scheme)) return false;
  return schemes.some((s) => s.toLowerCase() === scheme);
}

/** A URL with a scheme is absolute; anything else resolves against a base. */
export const isAbsoluteUrl = (url: string): boolean => {
  try {
    void new URL(url);
    return true;
  } catch {
    // operational: a relative reference is not a failure, it is the other case.
    return false;
  }
};

/* -------------------------------------------------------------------- hosts */

/**
 * Match a host against one `allowlist.txt` entry (§3.1).
 *
 * A leading `.` means "this domain and its subdomains". Compared by **label**,
 * so `.example.com` matches `docs.example.com` and never `notexample.com` —
 * which `host.endsWith('.example.com')` would also get right, but
 * `host.endsWith('example.com')` would not, and the two are one typo apart.
 */
export function hostMatchesAllowEntry(host: string, entry: string): boolean {
  const h = host.toLowerCase().split('.').filter((x) => x.length > 0);
  const wildcard = entry.startsWith('.');
  const e = (wildcard ? entry.slice(1) : entry).toLowerCase().split('.').filter((x) => x.length > 0);
  if (e.length === 0 || h.length < e.length) return false;
  const tail = h.slice(h.length - e.length);
  if (!e.every((label, i) => tail[i] === label)) return false;
  return wildcard || h.length === e.length;
}
