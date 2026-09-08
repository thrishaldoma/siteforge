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
    e.startsWith('.') ? host === e.slice(1) || host.endsWith(e) : host === e);
  if (!match) {
    console.error(`✗ ${host} is not in allowlist.txt and --i-have-permission was not passed (§3.1).`);
    process.exit(1);
  }
  return match;
}

/* --------------------------------------------------------- §3.4 scrubber */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export const scrub = (text) => text.replace(EMAIL, '[REDACTED:EMAIL]');
export function scrubDeep(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
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
export function installEscapeGuards(page, { onBlocked }) {
  page.on('popup', async (popup) => {
    const url = popup.url();
    onBlocked({ kind: 'popup', url, origin: originOrNull(url) });
    // Closed immediately and never crawled. Its own main-frame navigation is
    // already covered by the router — `parentFrame() === null` is true of a
    // popup's top frame too, which is why the guard is written that way rather
    // than comparing against one page's mainFrame().
    await popup.close().catch(() => {});
  });
  page.on('download', async (download) => {
    const url = download.url();
    onBlocked({ kind: 'download', url, origin: originOrNull(url) });
    await download.cancel().catch(() => {});
  });
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
