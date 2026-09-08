/**
 * The crawl boundary, as one decision function.
 *
 * §6 crawls same-origin only. That was enforced by *not following* off-origin
 * links, which is not the same thing: a control that calls `window.open` or
 * assigns `location` reaches another origin without any link being followed, and
 * §6's behaviour probing clicks controls. Nothing stopped it.
 *
 * So the boundary moves to a chokepoint — one predicate, consulted by
 * `context.route('**\/*')` before anything else, deriving its allowed set from
 * the crawl scope rather than from a literal list at each call site.
 *
 * **Subresources to any origin are allowed and recorded.** Fonts, images,
 * scripts and XHR from CDNs are how real sites render; §8 localizes them later.
 * Blocking them would break capture on every site worth cloning, so the rule is
 * narrow on purpose: *main-frame navigations* only.
 */

export interface NavigationDecision {
  blocked: boolean;
  /** Why, for the record. `null` when allowed. */
  reason: 'off-origin-navigation' | null;
  origin: string | null;
}

/**
 * The origin of a URL, or null when it has none (opaque `data:`/`blob:`, or an
 * unparseable string). Exported because "is this subresource foreign?" is now
 * asked by the rung gates too, and a second implementation would be a second
 * opinion about `new URL('data:…').origin` — which returns the *string* "null".
 */
export const originOf = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // operational: a request URL that will not parse has no origin to compare.
    return null;
  }
  // `about:blank` and `data:` parse fine and report the *string* `"null"` — an
  // opaque origin, not a host. Comparing that against the allowed set would
  // block the blank page a popup opens on before it navigates anywhere, which
  // is exactly the request the guard needs to see rather than abort.
  return parsed.origin && parsed.origin !== 'null' ? parsed.origin : null;
};

/**
 * Whether a request must be aborted at the chokepoint.
 *
 * `isMainFrame` means *any* page's top frame, not only the crawler's — which is
 * broader than "the page's main frame" and deliberately so. A popup has its own
 * main frame, so the narrower test would let a `window.open` to another origin
 * issue its request before the popup handler could close it. Sub-frames are
 * excluded because §11 requires third-party iframes to load: they get a
 * screenshot placeholder and a gap, which needs them rendered.
 */
/**
 * Is `url` on exactly this origin?
 *
 * Never `url.startsWith(origin)`. A URL is a grammar with delimiters, and a
 * prefix test cannot see them — both of these pass a prefix check and neither
 * is same-origin:
 *
 *   http://127.0.0.1:8789@evil.example/x   → origin http://evil.example  (userinfo)
 *   https://example.com.evil.net/x         → origin https://example.com.evil.net
 *
 * The second matters most: it needs no port on the legitimate origin, which is
 * every real target. Parse and compare the component.
 */
export function sameOrigin(url: string, origin: string): boolean {
  const parsed = originOf(url);
  return parsed !== null && parsed === origin;
}

/**
 * Is `url` on this origin *and* under this path prefix?
 *
 * The prefix is compared by **path segment**, so `/api` matches `/api/todos`
 * and not `/api-docs` — the same delimiter blindness one level down.
 */
export function isUnder(url: string, scope: { origin: string; pathPrefix?: string }): boolean {
  if (!sameOrigin(url, scope.origin)) return false;
  if (scope.pathPrefix === undefined) return true;
  const segments = (p: string): string[] => p.split('/').filter((x) => x.length > 0);
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // operational: sameOrigin already parsed this successfully, so reaching
    // here would be a defect in URL itself; treat as out of scope regardless.
    return false;
  }
  const want = segments(scope.pathPrefix);
  const got = segments(pathname);
  return want.every((seg, i) => got[i] === seg);
}

export function decideNavigation(request: {
  url: string;
  isNavigation: boolean;
  /**
   * `'unknown'` when the frame could not be resolved. Playwright's
   * `request.frame()` throws for a popup's very first navigation, because the
   * frame is not attached yet — and that is precisely the request this guard
   * exists to stop.
   */
  isMainFrame: boolean | 'unknown';
  allowedOrigins: ReadonlySet<string>;
}): NavigationDecision {
  const origin = originOf(request.url);
  if (!request.isNavigation) return { blocked: false, reason: null, origin };
  // An unclassifiable *subresource* is allowed — that is the rule that keeps
  // fonts and CDN scripts loading, and it is what makes capture work on real
  // sites. An unclassifiable *navigation* is not a subresource: it is a new
  // page being opened, and treating it as safe is the hole that let a
  // `window.open` to another origin complete before the popup handler could
  // close it. Measured: the request finished, off-origin, off-machine.
  const mainFrame = request.isMainFrame === 'unknown' ? true : request.isMainFrame;
  if (!mainFrame) return { blocked: false, reason: null, origin };
  if (origin === null || request.allowedOrigins.has(origin)) {
    return { blocked: false, reason: null, origin };
  }
  return { blocked: true, reason: 'off-origin-navigation', origin };
}

/**
 * The origins a crawl may navigate to, from the crawl scope.
 *
 * One source. A literal list at each call site is how the same boundary ends up
 * enforced three different ways, two of them stale.
 */
export function allowedOrigins(scope: {
  origin: string;
  /** Origins the operator additionally permitted, e.g. an auth provider. */
  additional?: readonly string[];
}): Set<string> {
  return new Set([scope.origin, ...(scope.additional ?? [])]);
}
