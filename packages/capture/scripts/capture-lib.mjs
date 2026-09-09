/**
 * Shared capture primitives: the code that runs inside the page, the selector
 * grammar, the §3.1 permission gate, and the §3.4 scrubber.
 *
 * Extracted so the rung drivers cannot drift apart. These are the parts that
 * will move into `packages/capture` proper; the drivers around them are still
 * measurement rigs.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import selectorParser from 'postcss-selector-parser';
import { hasScheme, hostMatchesAllowEntry } from '../../shared/dist/index.js';
import * as S from '../../schema/dist/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** AX roles §6 treats as interaction candidates. */
/**
 * §6's discovery roles.
 *
 * `option` is deliberately absent. An `<option>` is not independently
 * activatable — you drive the `combobox` that owns it — so probing one can only
 * time out. It was in this set, and every run produced three "could not be
 * driven" findings that were noise standing between a reader and a real one.
 * The options themselves are not lost: they are the enum evidence a `<select>
 * carries (§7.5), read from the DOM rather than by clicking.
 */
export const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'combobox', 'tab', 'menuitem',
  'radio', 'searchbox', 'slider', 'spinbutton', 'switch',
]);

/* --------------------------------------------------------- selector grammar */

const STATE_PSEUDOS = new Set(S.STATE_PSEUDO_CLASSES);

/**
 * The class names a set of selectors actually uses, parsed.
 *
 * `cssomText.includes(className)` was still here: the whole stylesheet's
 * selectors joined into one string, substring-tested to decide whether a class
 * the probe observed is already explained by CSS. It is round 8's bug exactly —
 * `.is-open` in the sheet "explains" a new class `open`, `[data-open]` explains
 * it too, and `.opened` explains it as well. Every false match hides a
 * JS-driven state the probe just found, which is the one thing probing is for.
 *
 * Parsing the selectors gives the class *tokens*, so `open` and `is-open` are
 * two names rather than one substring of the other.
 */
export function selectorClassNames(selectorTexts) {
  const names = new Set();
  for (const text of selectorTexts) {
    try {
      selectorParser((sel) => {
        sel.walkClasses((node) => names.add(node.value));
      }).processSync(text, { lossless: false });
    } catch {
      // operational: postcss throws on selectors real stylesheets contain.
      // A selector that will not parse contributes no class names, which makes
      // a class look *unexplained* rather than explained — the safe direction:
      // an extra probed state is noise, a missed one is a silent drop.
      continue;
    }
  }
  return names;
}

/**
 * Classify one selector by **parsing** it.
 *
 * Returns the state markers it carries and the base selector to match against
 * the resting DOM. All three rung-2 extraction bugs were one bug — string
 * operations on a grammar — so there are no string operations here.
 */
export function analyseSelector(selectorText) {
  const states = new Set();
  let base = selectorText;
  try {
    const root = selectorParser((sel) => {
      sel.walk((node) => {
        if (node.type === 'pseudo') {
          // `::before` and friends are not states and cannot be queried.
          if (node.value.startsWith('::')) { node.remove(); return; }
          if (STATE_PSEUDOS.has(node.value)) {
            states.add(node.value);
            // Strip only a bare, top-level state pseudo. `a:not(:visited)` must
            // not become `a:not()` — removing one inside a functional pseudo
            // inverts or widens what the selector means.
            const topLevel = node.parent?.parent?.type === 'root';
            if (topLevel && (node.nodes === undefined || node.nodes.length === 0)) node.remove();
          }
          return;
        }
        if (node.type === 'attribute') {
          const attr = node.attribute.toLowerCase();
          // Any aria-*/data-* attribute is a state candidate, whatever its value.
          // An enumerated list always trails what sites actually write.
          if (/^(?:aria|data)-[a-z0-9-]+$/.test(attr)) states.add(`[${attr}]`);
        }
      });
    }).processSync(selectorText, { lossless: false });
    base = root;
  } catch {
    // operational: postcss throws on selectors real stylesheets contain; page context, no helpers
    // An unparseable selector is recorded as-is and matched as-is; if that also
    // fails, matching yields nothing rather than a wrong set.
    return { states: [...states], base: selectorText, parsed: false };
  }
  return { states: [...states], base: base.trim(), parsed: true };
}

/* ------------------------------------------------- §3.1 permission gate */

export function assertPermitted(url) {
  const host = new URL(url).hostname;
  const entries = readFileSync(join(REPO, 'allowlist.txt'), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const match = entries.find((e) =>
    hostMatchesAllowEntry(host, e));
  if (!match) {
    console.error(`✗ ${host} is not in allowlist.txt and --i-have-permission was not passed (§3.1).`);
    process.exit(1);
  }
  return match;
}

/* --------------------------------------------------------- §3.4 scrubber */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * §3.4 names tokens before it names emails, and this scrubber only ever did
 * emails.
 *
 * Found by the gate, on the first real site: Vikunja answers `POST
 * /api/v1/login` with `{ "token": "eyJ…" }`, so the JWT went into the inferred
 * response schema as a `const` and four of them reached
 * `network/endpoints.json`. Nothing in the rung-3 fixture returns a credential
 * in a body, so two rungs of green said nothing about this.
 *
 * Deliberately a **second implementation** of the same idea as
 * `secret-scan.ts`'s rules, not a shared constant. The scanner is the check on
 * the scrubber; one regex behind both would mean a hole in it removes the
 * finding and the redaction together, and the run would report clean. Over-
 * redacting here is free — this is capture output, not the document.
 */
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g;

/**
 * The scrub, and how many redactions it made.
 *
 * One implementation rather than a `scrub` beside a `countRedactions`: two
 * would drift, and the count is what `AssetEntry.stored` reports, so a count
 * disagreeing with the redaction is a claim about the artifact that the
 * artifact does not support. Tallied through the same sequence the replacement
 * runs in, because the patterns overlap — `Bearer eyJ…` is matched by JWT
 * first, and counting the two independently would report two redactions where
 * one happened.
 */
export function scrubCounting(text) {
  let redactions = 0;
  const tally = (replacement) => () => {
    redactions += 1;
    return replacement;
  };
  const out = text
    .replace(JWT, tally('[REDACTED:TOKEN]'))
    .replace(BEARER, tally('Bearer [REDACTED:TOKEN]'))
    .replace(EMAIL, tally('[REDACTED:EMAIL]'));
  return { text: out, redactions };
}

export const scrub = (text) => scrubCounting(text).text;
export function scrubDeep(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
}

/**
 * Write every captured body under `assets/files/<sha256>.<ext>`, and describe
 * what was written.
 *
 * §6: "persist **every** response body content-addressed by sha256." Neither
 * driver did — both hashed the body, recorded its length and dropped the bytes,
 * so `assets/index.json` advertised a `localPath` for a file that had never
 * existed. §7.6, whose job is to find a control's handler *in the captured
 * source*, had no source to search.
 *
 * **One implementation for both crawlers**, not because it is shorter but
 * because §13 has already been bitten by two drivers disagreeing about the same
 * judgement — there, whether a button was safe to press. Whether an asset is
 * text the scrubber may rewrite is the same kind of decision, and a capture
 * whose redaction policy depends on which script produced it is not one policy.
 *
 * ### The scrub, and why it round-trips through latin1
 *
 * §3.4 redacts before any artifact is written, and redaction changes the bytes,
 * so a scrubbed body no longer hashes to the name it is filed under. The file
 * keeps the **wire** hash — that is the asset's identity, what `assetId` holds
 * and what a reference resolves through — and `stored` records the divergence,
 * so a reader who hashes the file and finds a mismatch is reading a stated fact
 * rather than finding a bug.
 *
 * latin1 rather than utf8 because it is a bijection between bytes and code
 * points 0–255: every byte the patterns do not match comes back exactly as it
 * went in, so a bundle that is not valid UTF-8 is not quietly rewritten into
 * replacement characters. The patterns are ASCII, so nothing is lost.
 *
 * Text only. A substitution run over a JPEG replaces bytes inside a container
 * and yields an image that no longer decodes — and that is not a hole in §3.4,
 * because `scanCaptureTree` reads every file as latin1 and a credential in an
 * image fails the run instead of being silently rewritten.
 */
export function writeAssetBodies({ allAssets, outDir, fs, isTextualAsset, assetKind }) {
  const entries = {};
  const files = [];
  for (const [url, a] of allAssets) {
    const ext = (a.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
    const localPath = `assets/files/${a.sha256}.${ext}`;
    const asText = a.body !== undefined && isTextualAsset(a.mime) ? a.body.toString('latin1') : null;
    const scrubbed = asText === null ? null : scrubCounting(asText);
    const changed = scrubbed !== null && scrubbed.redactions > 0;
    const bytes = changed ? Buffer.from(scrubbed.text, 'latin1') : a.body;

    if (bytes !== undefined) {
      const abs = join(outDir, localPath);
      fs.mkdirSync(dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes);
      files.push({ localPath, storedSha256: sha256(bytes) });
    }

    entries[url] = {
      assetId: a.sha256, originalUrl: url, localPath,
      sha256: a.sha256, mime: a.mime, bytes: a.bytes,
      // Parsed type/subtype, one table. `includes('css')` matched
      // `application/x-not-css` and a `charset=x-csserror` parameter alike.
      kind: assetKind(a.mime),
      status: a.status, sameOrigin: a.sameOrigin, fromCache: false,
      stored: changed
        ? { kind: 'redacted', sha256: sha256(bytes), bytes: bytes.length, redactions: scrubbed.redactions }
        : { kind: 'verbatim' },
      referencedBy: [],
    };
  }
  return { entries, files };
}

/* ------------------------------------------------------------- in-page walk */

/** Stamps every element with its depth-first ordinal, so CDP can map back to it. */
export const STAMP = () => {
  let i = 0;
  const walk = (el) => {
    el.setAttribute('data-sf-idx', String(i));
    i += 1;
    for (const child of el.children) walk(child);
  };
  walk(document.documentElement);
  return i;
};
export const UNSTAMP = () => {
  for (const el of document.querySelectorAll('[data-sf-idx]')) el.removeAttribute('data-sf-idx');
};

/**
 * §6's highest-value trick, in one pass: read the rules straight out of the
 * CSSOM rather than brute-force hovering every element.
 *
 * This half only *collects*. Deciding which selectors are state selectors is a
 * grammar question and is done in Node with a real selector parser — doing it
 * with `String.includes` is what silently dropped every `[aria-expanded="true"]`
 * rule (decision 0008).
 */
export const COLLECT_CSSOM = () => {
  const rules = [];
  const fonts = [];
  const blocked = [];
  const cssUrls = [];
  // Coarse, independent counts over raw selector text. Deliberately NOT the
  // selector parser: a coverage invariant whose two sides share a code path
  // cannot detect a bug in that path -- it goes vacuous instead of failing.
  // Over-counting here is safe (it makes the invariant stricter); sharing is not.
  const RAW_PSEUDO = /:(?:hover|focus|focus-visible|focus-within|active|checked|indeterminate|disabled|enabled|target|visited|open)\b/;
  const RAW_ATTR_STATE = /\[(?:aria|data)-[a-zA-Z0-9-]+/;
  let rawPseudoRules = 0;
  let rawAttrStateRules = 0;

  const declarationsOf = (style) => {
    const out = {};
    for (const property of style) out[property] = style.getPropertyValue(property);
    return out;
  };
  const collectUrls = (style, href) => {
    for (const property of style) {
      for (const m of style.getPropertyValue(property).matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
        cssUrls.push({ url: m[2], property, stylesheetHref: href ?? null });
      }
    }
  };

  Array.from(document.styleSheets).forEach((sheet, sheetIndex) => {
    let list;
    try { list = sheet.cssRules; } catch { blocked.push(sheet.href ?? '(inline)'); return; }
    const visit = (ruleList, mediaQuery) => {
      Array.from(ruleList).forEach((rule, ruleIndex) => {
        const kind = rule.constructor.name;
        if (kind === 'CSSMediaRule') { visit(rule.cssRules, rule.conditionText); return; }
        if (kind === 'CSSSupportsRule') { visit(rule.cssRules, mediaQuery); return; }
        if (kind === 'CSSFontFaceRule') {
          fonts.push({
            family: (rule.style.getPropertyValue('font-family') || '').replace(/^["']|["']$/g, ''),
            src: rule.style.getPropertyValue('src'),
            weight: rule.style.getPropertyValue('font-weight') || undefined,
            style: rule.style.getPropertyValue('font-style') || undefined,
            display: rule.style.getPropertyValue('font-display') || undefined,
          });
          return;
        }
        if (kind !== 'CSSStyleRule') return;
        const raw = rule.selectorText ?? '';
        if (RAW_PSEUDO.test(raw)) rawPseudoRules += 1;
        if (RAW_ATTR_STATE.test(raw)) rawAttrStateRules += 1;
        collectUrls(rule.style, sheet.href);
        rules.push({
          selector: rule.selectorText ?? '',
          declarations: declarationsOf(rule.style),
          stylesheetHref: sheet.href ?? undefined,
          sheetIndex, ruleIndex,
          ...(mediaQuery ? { mediaQuery } : {}),
        });
      });
    };
    visit(list, undefined);
  });
  return {
    rules, fonts, blocked, cssUrls,
    stylesheetCount: document.styleSheets.length,
    rawPseudoRules, rawAttrStateRules,
  };
};

/** Resolve base selectors (state stripped, computed in Node) to stamped elements. */
export const MATCH_SELECTORS = (selectors) =>
  selectors.map((sel) => {
    if (!sel) return [];
    try {
      return Array.from(document.querySelectorAll(sel))
        .map((el) => Number(el.getAttribute('data-sf-idx')))
        .filter((n) => Number.isInteger(n));
    // operational: CDP node lookup on an element that detached mid-pass
    } catch { return []; }
  });

/** One scroll step's observable state, for diffing against the previous step. */
export const SCROLL_PROBE = () => {
  const out = {};
  for (const el of document.querySelectorAll('[data-sf-idx]')) {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    out[el.getAttribute('data-sf-idx')] = {
      opacity: cs.opacity, position: cs.position, boxShadow: cs.boxShadow,
      transform: cs.transform, visibility: cs.visibility,
      viewportTop: Math.round(box.top),
      loaded: el.tagName === 'IMG' ? (el.naturalWidth > 0 ? '1' : '0') : undefined,
    };
  }
  return { probe: out, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight };
};

/** Runs in the browser. Returns a flat list; ids are derived in Node from schema. */
export const EXTRACT = (properties) => {
  const IMPLICIT_ROLE = {
    a: 'link', button: 'button', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', img: 'img', nav: 'navigation',
    main: 'main', header: 'banner', footer: 'contentinfo', ul: 'list', ol: 'list',
    li: 'listitem', p: 'paragraph', table: 'table', form: 'form', section: 'region',
    input: 'textbox', select: 'combobox', textarea: 'textbox', article: 'article',
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && !el.hasAttribute('href')) return null;
    if (tag === 'input') {
      const t = (el.getAttribute('type') ?? 'text').toLowerCase();
      return { checkbox: 'checkbox', radio: 'radio', button: 'button', submit: 'button', search: 'searchbox' }[t] ?? 'textbox';
    }
    return IMPLICIT_ROLE[tag] ?? null;
  };
  const nameOf = (el) =>
    el.getAttribute('aria-label') ??
    el.getAttribute('alt') ??
    (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

  const out = [];
  const walk = (node, parentPath, counts, parentIndex) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (!value) return;
      const n = (counts.get('#text') ?? 0) + 1;
      counts.set('#text', n);
      out.push({ kind: 'text', structuralPath: `${parentPath}/#text[${n}]`, value, parentIndex });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node;
    const tag = el.tagName.toLowerCase();
    const n = (counts.get(tag) ?? 0) + 1;
    counts.set(tag, n);
    const path = parentPath === '' ? tag : `${parentPath}/${tag}[${n}]`;

    const attributes = {};
    let sfIdx = null;
    for (const attr of el.attributes) {
      if (attr.name === 'data-sf-idx') { sfIdx = Number(attr.value); continue; }
      attributes[attr.name] = attr.value;
    }

    const cs = getComputedStyle(el);
    const declarations = {};
    for (const property of properties) {
      const value = cs.getPropertyValue(property);
      if (value !== '') declarations[property] = value;
    }

    const box = el.getBoundingClientRect();
    const role = roleOf(el);
    const index = out.length;
    out.push({
      kind: 'element', sfIdx, structuralPath: path, tag, attributes, declarations,
      ownText: Array.from(el.childNodes)
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => (c.nodeValue ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean).join(' '),
      boundingBox: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height },
      role, name: role ? nameOf(el) : null,
      cursorPointer: cs.getPropertyValue('cursor') === 'pointer',
      shadow: el.shadowRoot ? 'open' : (el.tagName.includes('-') ? 'maybe-closed' : null),
      parentIndex,
    });

    const childCounts = new Map();
    for (const child of el.childNodes) walk(child, path, childCounts, index);
  };
  walk(document.documentElement, '', new Map(), null);

  /**
   * Controls that constrain a field's domain.
   *
   * This is the primary evidence for an enum in response-schema inference, and
   * the only kind that is actually ground truth: a <select> with four options
   * means the API cannot receive a fifth, however thin the sampling was. Read
   * here because we have the UI that drives the API — a field is an enum because
   * the DOM constrains it, not because we did not look at enough rows.
   */
  const constraints = [];
  for (const select of document.querySelectorAll('select[name], select[id]')) {
    const values = [...select.options].map((o) => o.value).filter((v) => v !== '');
    if (values.length === 0) continue;
    constraints.push({
      control: 'select',
      name: select.getAttribute('name') ?? select.id,
      sfIdx: Number(select.getAttribute('data-sf-idx')),
      optionValues: [...new Set(values)],
    });
  }
  const radioGroups = new Map();
  for (const radio of document.querySelectorAll('input[type=radio][name]')) {
    const name = radio.getAttribute('name');
    if (!radioGroups.has(name)) radioGroups.set(name, { values: [], sfIdx: Number(radio.getAttribute('data-sf-idx')) });
    if (radio.value !== '') radioGroups.get(name).values.push(radio.value);
  }
  for (const [name, g] of radioGroups) {
    if (g.values.length === 0) continue;
    constraints.push({
      control: 'radio-group', name, sfIdx: g.sfIdx, optionValues: [...new Set(g.values)],
    });
  }

  return {
    nodes: out,
    uiConstraints: constraints,
    doctype: document.doctype ? document.doctype.name : null,
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    url: location.href,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  };
};

/**
 * Redact credentials from a HAR that Playwright has already written.
 *
 * §3.4 requires the scrubber to redact "tokens, cookies, emails … before any
 * artifact is written", and `capture/` is treated as sensitive. Playwright writes
 * the HAR itself, at context close, with no hook to scrub on the way out — so it
 * lands with live `Cookie` and `Set-Cookie` values in it. Gitignoring the
 * directory satisfies the other half of §3.4 and not this half: the file is still
 * a credential sitting on disk, and a HAR is exactly the artifact somebody
 * attaches to a bug report.
 *
 * Rewritten in place immediately after close. Header and cookie *names* survive,
 * because §8's session check needs to know a cookie was required; only values go.
 */
export function scrubHarFile({ readFileSync, writeFileSync }, path) {
  const SENSITIVE = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'x-api-key']);
  let har;
  try {
    har = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // operational: a HAR that is absent or truncated has nothing to redact
    return { redactedHeaders: 0, redactedCookies: 0 };
  }
  let redactedHeaders = 0;
  let redactedCookies = 0;
  const scrubHeaders = (headers) => {
    for (const h of headers ?? []) {
      if (SENSITIVE.has(String(h.name).toLowerCase())) {
        h.value = '[REDACTED]';
        redactedHeaders += 1;
      }
    }
  };
  const scrubCookies = (cookies) => {
    for (const c of cookies ?? []) {
      c.value = '[REDACTED]';
      redactedCookies += 1;
    }
  };
  for (const entry of har?.log?.entries ?? []) {
    scrubHeaders(entry.request?.headers);
    scrubHeaders(entry.response?.headers);
    scrubCookies(entry.request?.cookies);
    scrubCookies(entry.response?.cookies);
  }
  writeFileSync(path, JSON.stringify(har));
  return { redactedHeaders, redactedCookies };
}

/**
 * The crawl boundary, installed at a chokepoint.
 *
 * §6 is same-origin only, and that used to be enforced by not *following*
 * off-origin links — which a control calling `window.open` or assigning
 * `location` walks straight past, and §6's behaviour probing clicks controls.
 * Detection after the fact is not prevention: by the time the post-click origin
 * check fires, the request has already left for a site we do not own.
 *
 * So: one predicate, consulted before anything else, on every request.
 *
 * **Subresources to any origin are allowed and recorded.** Fonts, images,
 * scripts and XHR from CDNs are how real sites render, and §8 localizes them
 * later. Only main-frame navigations are blocked.
 */
export async function installOriginGuard(context, { allowedOrigins, onBlocked, decide }) {
  const origins = new Set(allowedOrigins);

  // Awaited: `context.route` is async, and a guard registered after the first
  // navigation has already started is not a chokepoint.
  await context.route('**/*', async (route) => {
    const request = route.request();
    let isMainFrame;
    try {
      isMainFrame = request.frame().parentFrame() === null;
    } catch {
      // Throws for requests with no attached frame: service workers, some
      // prefetches — and a popup's first navigation. The predicate decides what
      // that means, and it depends entirely on whether the request is a
      // navigation. Reported as 'unknown' rather than guessed here.
      // operational: Playwright throws when no frame is attached yet.
      isMainFrame = 'unknown';
    }
    const verdict = decide({
      url: request.url(),
      isNavigation: request.isNavigationRequest(),
      isMainFrame,
      allowedOrigins: origins,
    });
    if (!verdict.blocked) return route.continue();
    onBlocked({ kind: 'navigation', url: request.url(), origin: verdict.origin });
    return route.abort('blockedbyclient');
  });

  return origins;
}

/**
 * The escapes that never become a request the router can see.
 *
 * A popup gets its own page, a download never navigates, and `target="_blank"`
 * produces the first. Each is recorded and closed; none is crawled.
 */
/**
 * A URL Chromium substitutes for the one that was asked for.
 *
 * A popup whose navigation the router aborted lands here, and reading it is how
 * `chrome-error://chromewebdata/` ended up in a gap describing which origin we
 * had been protected from.
 */
const isErrorPage = (url) => hasScheme(url, 'chrome-error') || url === 'about:blank';

export function installEscapeGuards(page, { onBlocked }) {
  page.on('popup', async (popup) => {
    const raw = popup.url();
    /*
     * Measured, not assumed: for a popup the router blocked, `popup.url()` is
     * `chrome-error://chromewebdata/` at *every* moment it can be read — at the
     * event, via `mainFrame().url()`, and 300ms later. The intended URL is not
     * recoverable from the popup, so it is not invented here.
     *
     * It does not need to be. Two `window.open` calls to two foreign origins
     * produce exactly two router records, each carrying the real target — so
     * the router owns the URL, and emitting a second record naming an error
     * page would be a duplicate with strictly less information in it.
     */
    const url = isErrorPage(raw) ? null : raw;
    onBlocked({ kind: 'popup', url, origin: url === null ? null : originOrNull(url) });
    // Closed immediately and never crawled. Its own main-frame navigation is
    // already covered by the router — `parentFrame() === null` is true of a
    // popup's top frame too, which is why the guard is written that way rather
    // than comparing against one page's mainFrame().
    // operational: the popup is already recorded and is being discarded; a close that races page teardown changes nothing we go on to read.
    await popup.close().catch(() => {});
  });
  page.on('download', async (download) => {
    const url = download.url();
    onBlocked({ kind: 'download', url, origin: originOrNull(url) });
    // operational: the download is already recorded as a gap; cancelling a transfer that has already ended is not a failure.
    await download.cancel().catch(() => {});
  });
}

/**
 * The crawl boundary's refusals, as gaps.
 *
 * A cancelled download and a closed popup were being counted in a console line
 * and nowhere else. §13: a known gap recorded only in prose is not tracked —
 * cancelled-but-unrecorded is untracked, and the next stage has no way to learn
 * the control goes somewhere we declined to follow.
 *
 * Gap ids are derived from the target URL, never from a counter or from event
 * order: `manifest.contentHash` is M1's idempotency check, and an id that
 * shifted when two popups arrived in a different order would make a re-crawl of
 * an unchanged site look changed.
 */
export function boundaryGaps(events, { gapId, routeId, fallbackUrl }) {
  const gaps = [];
  // The URL is what the gap is *about* — a gap naming the origin it protected
  // you from is useful; one naming the route it happened on is much less so, and
  // one naming an error page is worse than nothing. `routeId` rides along when
  // the caller knows it.
  const on = (url) => (routeId ? { url, routeId } : { url });
  const navigations = events.filter((e) => e.kind === 'navigation');

  for (const event of navigations) {
    gaps.push({
      gapId: gapId(`off-origin-navigation:${event.url}`), stage: 'capture',
      category: 'out-of-scope-control', severity: 'info', subject: on(event.url),
      summary: `A main-frame navigation to ${event.origin ?? event.url} was blocked.`,
      detail: `${event.url} is outside the crawl's allowed origins, so the request was aborted at the router before it left the machine (§6, the crawl boundary). Subresources from other origins are still fetched and recorded; only navigation is refused. Nothing about the destination was observed, and no endpoint is created either way.`,
      stub: { kind: 'none' },
    });
  }

  for (const event of events.filter((e) => e.kind === 'popup')) {
    if (event.url === null) {
      // The router already recorded this one, with the URL this event lacks.
      // If it somehow did not, that is a hole worth a gap of its own rather
      // than a silently dropped escape.
      if (navigations.length === 0) {
        gaps.push({
          gapId: gapId('popup-target-unrecorded'), stage: 'capture',
          category: 'out-of-scope-control', severity: 'degraded', subject: on(fallbackUrl),
          summary: 'A popup was opened and closed, and its target was never recorded.',
          detail: 'The popup landed on an error page and no blocked navigation was recorded to pair it with, so the origin it would have reached is unknown. Either the popup failed for a reason unrelated to the boundary, or the router did not see its navigation.',
          stub: { kind: 'none' },
        });
      }
      continue;
    }
    gaps.push({
      gapId: gapId(`popup-not-crawled:${event.url}`), stage: 'capture',
      category: 'out-of-scope-control', severity: 'info', subject: on(event.url),
      summary: `A popup to ${event.url} was closed without being crawled.`,
      detail: '§6 records a popup and closes it immediately rather than crawling it. Its content is not captured, so the clone renders whatever opened it and the popup goes nowhere.',
      stub: { kind: 'none' },
    });
  }

  for (const event of events.filter((e) => e.kind === 'download')) {
    gaps.push({
      gapId: gapId(`download-cancelled:${event.url}`), stage: 'capture',
      category: 'out-of-scope-control', severity: 'info', subject: on(event.url),
      summary: `A download of ${event.url} was cancelled.`,
      detail: 'A file download is out-of-scope for the crawl (§6): not destructive, just not ours to fetch. It is cancelled rather than saved, so the bytes were never observed and the clone cannot serve them.',
      stub: { kind: 'omitted', detail: 'The control renders; activating it downloads nothing.' },
    });
  }

  return gaps;
}

const originOrNull = (url) => {
  try {
    const o = new URL(url).origin;
    return o && o !== 'null' ? o : null;
  } catch {
    // operational: a non-URL (`about:blank`, a blob ref) has no origin.
    return null;
  }
};
