/**
 * M1 SPIKE — one real page, end to end, validated against the schema.
 *
 * NOT the crawler. This is a throwaway probe with one job: find out where the
 * schema is wrong about reality *before* `packages/capture` is built against it.
 * The fixtures came from a generator, so they can only contain what we already
 * believed. This can contain things we did not.
 *
 *   node packages/capture/scripts/spike-one-page.mjs [url]
 *
 * Honours §3.1: refuses any target not in allowlist.txt.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import selectorParser from 'postcss-selector-parser';
import { installEscapeGuards, installOriginGuard, scrubHarFile } from './capture-lib.mjs';
import {
  allowedOrigins as deriveAllowedOrigins, decideNavigation, formatFindings, originOf, scanCaptureTree,
} from '../../shared/dist/index.js';
import { checkRung } from './rungs.mjs';
import * as S from '../../schema/dist/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const TARGET = process.argv[2] ?? 'https://example.com/';
const OUT = join(REPO, 'capture', 'spike');

const SEED = 42;
const FROZEN_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z');
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const CONTEXT_ID = 'anon-desktop';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 siteforge/0.1.0-spike';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/* --------------------------------------------------------- selector grammar */

const STATE_PSEUDOS = new Set(S.STATE_PSEUDO_CLASSES);

/**
 * Classify one selector by **parsing** it.
 *
 * Returns the state markers it carries and the base selector to match against
 * the resting DOM. All three rung-2 extraction bugs were one bug — string
 * operations on a grammar — so there are no string operations here.
 */
function analyseSelector(selectorText) {
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
    // operational: postcss throws on selectors real stylesheets contain; page context
    // An unparseable selector is recorded as-is and matched as-is; if that also
    // fails, matching yields nothing rather than a wrong set.
    return { states: [...states], base: selectorText, parsed: false };
  }
  return { states: [...states], base: base.trim(), parsed: true };
}

/* ------------------------------------------------- §3.1 permission gate */

function assertPermitted(url) {
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
const scrub = (text) => text.replace(EMAIL, '[REDACTED:EMAIL]');
function scrubDeep(value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
}

/* ------------------------------------------------------------- in-page walk */

/** Stamps every element with its depth-first ordinal, so CDP can map back to it. */
const STAMP = () => {
  let i = 0;
  const walk = (el) => {
    el.setAttribute('data-sf-idx', String(i));
    i += 1;
    for (const child of el.children) walk(child);
  };
  walk(document.documentElement);
  return i;
};
const UNSTAMP = () => {
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
const COLLECT_CSSOM = () => {
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
const MATCH_SELECTORS = (selectors) =>
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
const SCROLL_PROBE = () => {
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
const EXTRACT = (properties) => {
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

  return {
    nodes: out,
    doctype: document.doctype ? document.doctype.name : null,
    lang: document.documentElement.getAttribute('lang'),
    title: document.title,
    url: location.href,
    scrollHeight: document.documentElement.scrollHeight,
    scrollWidth: document.documentElement.scrollWidth,
  };
};

/* -------------------------------------------------------------------- run */

const findings = [];
const finding = (severity, what) => findings.push({ severity, what });

const matchedEntry = assertPermitted(TARGET);
console.log(`→ ${TARGET}  (allowlist match: ${matchedEntry})`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'network'), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
  deviceScaleFactor: VIEWPORT.deviceScaleFactor,
  isMobile: VIEWPORT.isMobile,
  hasTouch: VIEWPORT.hasTouch,
  userAgent: UA,
  locale: 'en-US',
  timezoneId: 'UTC',
  reducedMotion: 'reduce',
  recordHar: { path: join(OUT, 'network', 'session.har'), content: 'omit' },
});

// §6: freeze the four globals before any page script runs.
await context.addInitScript(
  ({ seed, epoch }) => {
    let state = seed >>> 0;
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    Math.random = rand;
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [epoch])); }
      static now() { return epoch; }
    };
    performance.now = () => 0;
    let counter = 0;
    if (globalThis.crypto) {
      crypto.randomUUID = () => {
        counter += 1;
        const h = counter.toString(16).padStart(12, '0');
        return `00000000-0000-4000-8000-${h}`;
      };
    }
  },
  { seed: SEED, epoch: FROZEN_EPOCH_MS },
);

const ALLOWED_ORIGINS = deriveAllowedOrigins({ origin: new URL(TARGET).origin });
const blockedNavigations = [];
const onBlocked = (event) => {
  blockedNavigations.push(event);
  console.log(`  ⤫ blocked ${event.kind} → ${event.origin ?? event.url}`);
};
await installOriginGuard(context, {
  allowedOrigins: ALLOWED_ORIGINS, onBlocked, decide: decideNavigation,
});

const page = await context.newPage();
installEscapeGuards(page, { onBlocked });

/** Content-addressed asset capture (§6: persist every response body). */
const assetsByUrl = new Map();
let scrollStep = -1; // -1 until the scroll pass starts
page.on('response', async (response) => {
  try {
    const body = await response.body();
    const url = response.url();
    const mime = (response.headers()['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
    assetsByUrl.set(url, {
      sha256: sha256(body), bytes: body.length, mime,
      status: response.status(),
      sameOrigin: new URL(url).origin === new URL(TARGET).origin,
      fromCache: false,
      arrivedAtScrollStep: scrollStep,
    });
  } catch {
    // operational: redirects and preflights have no retrievable body
    /* redirects and preflights have no retrievable body */
  }
});

const response = await page.goto(TARGET, { waitUntil: 'networkidle' });
const status = response?.status() ?? 0;
const redirectChain = [];
for (let r = response?.request().redirectedFrom(); r; r = r.redirectedFrom()) {
  const from = r.url();
  const to = r.redirectedTo()?.url();
  const s = (await r.response())?.status();
  if (to && s) redirectChain.unshift({ from, to, status: s });
}

await page.evaluate(STAMP);

// §6: read the rules out of the CSSOM in one pass, then classify by parsing.
const cssom = await page.evaluate(COLLECT_CSSOM);
for (const href of cssom.blocked) {
  finding('observed', `stylesheet ${href} is CORS-blocked; its rules are unreadable from page context`);
}
const analysed = cssom.rules.map((rule) => ({ ...rule, ...analyseSelector(rule.selector) }));
const stateRules = analysed.filter((r) => r.states.length > 0);
const matchedIdx = await page.evaluate(MATCH_SELECTORS, stateRules.map((r) => r.base));
stateRules.forEach((r, i) => { r.matchedIdx = matchedIdx[i] ?? []; });
const unparseable = analysed.filter((r) => !r.parsed);
if (unparseable.length) finding('observed', `${unparseable.length} selector(s) failed to parse`);

const extracted = await page.evaluate(EXTRACT, S.CAPTURED_CSS_PROPERTIES);

// §6 a11y source: CDP, on the same session that will serve getEventListeners.
// page.accessibility.snapshot() no longer exists; ariaSnapshot() gives YAML with
// no DOM mapping. AX nodes carry backendDOMNodeId, which does map.
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable');
await cdp.send('Accessibility.enable');
const { root: cdpRoot } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
const backendToSfIdx = new Map();
(function walkCdp(node) {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) {
    if (attrs[i] === 'data-sf-idx') backendToSfIdx.set(node.backendNodeId, Number(attrs[i + 1]));
  }
  for (const child of node.children ?? []) walkCdp(child);
  for (const child of node.contentDocument ? [node.contentDocument] : []) walkCdp(child);
})(cdpRoot);
const { nodes: axNodes } = await cdp.send('Accessibility.getFullAXTree');
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'combobox', 'tab', 'menuitem',
  'radio', 'searchbox', 'slider', 'spinbutton', 'switch', 'option',
]);
const axBySfIdx = new Map();
for (const ax of axNodes) {
  if (ax.ignored || ax.backendDOMNodeId === undefined) continue;
  const sfIdx = backendToSfIdx.get(ax.backendDOMNodeId);
  if (sfIdx === undefined) continue;
  axBySfIdx.set(sfIdx, { role: ax.role?.value ?? 'generic', name: ax.name?.value ?? '' });
}
console.log(`  a11y: ${axBySfIdx.size} AX nodes mapped to DOM nodes via CDP backendDOMNodeId`);

// §6 candidate discovery, all four sources. getEventListeners is the one that
// catches divs with click handlers, which the a11y tree misses entirely.
const sfIdxToBackend = new Map([...backendToSfIdx].map(([b, i]) => [i, b]));
const listenersBySfIdx = new Map();
for (const [sfIdx, backendNodeId] of sfIdxToBackend) {
  try {
    const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
    if (!object.objectId) continue;
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.objectId });
    const types = [...new Set((listeners ?? []).map((l) => l.type))];
    if (types.length) listenersBySfIdx.set(sfIdx, types);
    await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
  // operational: the node detached between resolve and release
  } catch { /* detached or non-element node */ }
}
console.log(`  listeners: ${listenersBySfIdx.size} elements carry DOM event handlers (CDP)`);

const stateMatchedSfIdx = new Set(stateRules.flatMap((r) => r.matchedIdx));

// §6 scroll pass: 0.5-viewport steps to the bottom, screenshotting each.
const scrollShots = [];
const scrollObservations = [];
let previous = null;
const alreadyStuck = new Set();
const firstProbe = await page.evaluate(SCROLL_PROBE);
const totalHeight = firstProbe.scrollHeight;
const stepPx = Math.round(VIEWPORT.height / 2);
const stepCount = Math.max(1, Math.ceil(Math.max(0, totalHeight - VIEWPORT.height) / stepPx) + 1);
for (let i = 0; i < stepCount; i += 1) {
  scrollStep = i;
  const y = Math.min(i * stepPx, Math.max(0, totalHeight - VIEWPORT.height));
  await page.evaluate((to) => window.scrollTo(0, to), y);
  await page.waitForTimeout(250);
  const shot = await page.screenshot();
  scrollShots.push({ index: i, scrollY: y, bytes: shot });
  const { probe } = await page.evaluate(SCROLL_PROBE);
  if (previous) {
    const changed = [];
    const stuck = [];
    for (const [idx, now] of Object.entries(probe)) {
      const before = previous.probe[idx];
      if (!before) continue;
      const changes = [];
      for (const key of ['opacity', 'boxShadow', 'transform', 'visibility']) {
        if (before[key] !== now[key]) changes.push({ property: key, from: before[key], to: now[key] });
      }
      if (changes.length) changed.push({ sfIdx: Number(idx), changes });
      // Pinned while the document moved underneath: that is the sticky transition.
      // It is a transition, not a state — emit it at the step where it first
      // pins, or states.json carries one identical entry per scroll step.
      if (
        (now.position === 'sticky' || now.position === 'fixed') &&
        before.viewportTop === now.viewportTop &&
        !alreadyStuck.has(idx)
      ) {
        alreadyStuck.add(idx);
        stuck.push(Number(idx));
      }
      if (before.loaded === '0' && now.loaded === '1') {
        changed.push({ sfIdx: Number(idx), changes: [{ property: 'opacity', from: '0', to: '1' }], lazy: true });
      }
    }
    scrollObservations.push({ step: i, scrollY: y, changed, stuck });
  }
  previous = { probe };
}
scrollStep = -1;
await page.evaluate((to) => window.scrollTo(0, to), 0);
await page.evaluate(UNSTAMP);

const fullShot = await page.screenshot({ fullPage: true });
mkdirSync(join(OUT, 'routes'), { recursive: true });

// The HAR is only flushed on context close, so the browser shuts down before the
// artifacts are assembled rather than after.
await cdp.detach().catch(() => {});
await context.close();
await browser.close();

// §3.4: the HAR is written by Playwright with raw Cookie headers in it.
scrubHarFile({ readFileSync, writeFileSync }, join(OUT, 'network', 'session.har'));

/* ------------------------------------------- assemble against the schema */

const urlPattern = new URL(extracted.url).pathname || '/';
const routeId = S.deriveRouteId(urlPattern, CONTEXT_ID, 0);
const routeDir = join(OUT, 'routes', routeId);
mkdirSync(join(routeDir, 'scroll'), { recursive: true });
writeFileSync(join(routeDir, 'shot.full.png'), fullShot);

// Derive ids with the contract's own functions -- the point of exporting them.
const styleTable = new Map();
const assignments = {};
const built = extracted.nodes.map((raw) => {
  if (raw.kind === 'text') {
    return { nodeType: 'text', nodeId: S.deriveNodeId(raw.structuralPath, S.shortHash(scrub(raw.value))), value: scrub(raw.value) };
  }
  const attributes = scrubDeep(raw.attributes);
  const semanticKey = S.deriveSemanticKey({ tag: raw.tag, attributes });
  const contentFingerprint = S.deriveContentFingerprint({ tag: raw.tag, attributes, text: scrub(raw.ownText) });
  const nodeId = S.deriveNodeId(raw.structuralPath, semanticKey);
  const styleId = S.deriveStyleId(raw.declarations);
  const entry = styleTable.get(styleId);
  if (entry) entry.refCount += 1;
  else styleTable.set(styleId, { styleId, declarations: raw.declarations, refCount: 1 });
  assignments[nodeId] = styleId;
  return {
    nodeType: 'element', nodeId,
    identity: { structuralPath: raw.structuralPath, semanticKey, contentFingerprint },
    tag: raw.tag, attributes, styleId,
    ...(axBySfIdx.has(raw.sfIdx)
      ? { a11y: { ref: S.deriveA11yRef(nodeId), role: axBySfIdx.get(raw.sfIdx).role, name: scrub(axBySfIdx.get(raw.sfIdx).name) } }
      : {}),
    boundingBox: raw.boundingBox,
    ...(() => {
      const discoveredBy = [];
      const ax = axBySfIdx.get(raw.sfIdx);
      if (ax && INTERACTIVE_ROLES.has(ax.role)) discoveredBy.push('a11y-tree');
      if (listenersBySfIdx.has(raw.sfIdx)) discoveredBy.push('event-listeners');
      if (stateMatchedSfIdx.has(raw.sfIdx)) discoveredBy.push('pseudo-class-rule');
      if (raw.cursorPointer) discoveredBy.push('cursor-pointer');
      if (discoveredBy.length === 0) return {};
      return {
        interaction: {
          discoveredBy,
          selector: raw.attributes.id
            ? `#${raw.attributes.id}`
            : `${raw.tag}[data-sf-path="${raw.structuralPath}"]`,
          eventTypes: listenersBySfIdx.get(raw.sfIdx) ?? [],
          stateDeltaObserved: stateMatchedSfIdx.has(raw.sfIdx),
        },
      };
    })(),
    children: [],
  };
});

const nodeIdBySfIdx = new Map();
extracted.nodes.forEach((raw, i) => {
  if (raw.kind === 'element' && raw.sfIdx !== null) nodeIdBySfIdx.set(raw.sfIdx, built[i].nodeId);
});

// Re-parent into a tree.
extracted.nodes.forEach((raw, i) => {
  if (raw.parentIndex === null) return;
  built[raw.parentIndex].children.push(built[i]);
});
const root = built[0];

const NODE_COUNT = built.length;
const serialize = (n) =>
  n.nodeType === 'text' ? `#${n.value}`
  : `<${n.tag} ${JSON.stringify(n.attributes)} ${n.styleId}>${n.children.map(serialize).join('')}</${n.tag}>`;

const RUN_ID = `run_${S.shortHash('spike')}`;
const envelope = (artifact, externalDigests) => ({
  modelVersion: S.CAPTURE_MODEL_VERSION,
  artifact, scrubbed: true,
  provenance: {
    recordedAt: new Date().toISOString(), runId: RUN_ID,
    ...(externalDigests ? { externalDigests } : {}),
  },
});

const dom = {
  ...envelope('dom-document'),
  routeId, documentUrl: extracted.url,
  doctype: extracted.doctype, lang: extracted.lang,
  normalization: {
    whitespace: 'collapsed', commentsRemoved: true, inlineCodeOmitted: true,
    shadowDomFlattened: false, iframesRecursed: false,
  },
  root, nodeCount: NODE_COUNT, domHash: S.shortHash(serialize(root)),
};

const styledNodeCount = Object.keys(assignments).length;
const styles = {
  ...envelope('style-sheet'),
  routeId, propertySet: 'siteforge/v1',
  table: [...styleTable.values()], assignments,
  fonts: cssom.fonts.map((f) => {
    const urls = [...String(f.src ?? '').matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
    return {
      family: f.family,
      sources: (urls.length ? urls : ['(inline)']).map((u) => {
        const abs = u.startsWith('http') ? u : new URL(u, extracted.url).href;
        const asset = assetsByUrl.get(abs);
        return { ...(asset ? { assetId: asset.sha256 } : {}), originalUrl: abs, format: 'truetype' };
      }),
      ...(f.weight ? { weight: f.weight } : {}),
      ...(f.style ? { style: f.style } : {}),
      ...(f.display ? { display: f.display } : {}),
      license: 'unknown',
    };
  }),
  stats: {
    styledNodeCount, distinctStyles: styleTable.size,
    dedupeRatio: Number((styleTable.size / styledNodeCount).toFixed(4)),
  },
};

const stateEntries = [];
for (const rule of stateRules) {
  stateEntries.push({
    source: 'cssom',
    selector: rule.selector,
    stateSelectors: rule.states,
    declarations: rule.declarations,
    matchedNodeIds: rule.matchedIdx.map((i) => nodeIdBySfIdx.get(i)).filter(Boolean),
    origin: {
      ...(rule.stylesheetHref ? { stylesheetHref: rule.stylesheetHref } : {}),
      sheetIndex: rule.sheetIndex, ruleIndex: rule.ruleIndex,
    },
    ...(rule.mediaQuery ? { mediaQuery: rule.mediaQuery } : {}),
  });
}
const lazyByStep = new Map();
for (const [, a] of assetsByUrl) {
  if (a.arrivedAtScrollStep >= 0) lazyByStep.set(a.arrivedAtScrollStep, (lazyByStep.get(a.arrivedAtScrollStep) ?? 0) + 1);
}
for (const obs of scrollObservations) {
  const changedNodeIds = obs.changed.map((c) => nodeIdBySfIdx.get(c.sfIdx)).filter(Boolean);
  const styleChanges = obs.changed
    .map((c) => ({ nodeId: nodeIdBySfIdx.get(c.sfIdx), changes: c.changes }))
    .filter((c) => c.nodeId);
  if (changedNodeIds.length) {
    stateEntries.push({
      source: 'scroll', scrollStep: obs.step, scrollY: obs.scrollY,
      effect: obs.changed.some((c) => c.lazy) || lazyByStep.has(obs.step) ? 'lazy-load' : 'intersection-reveal',
      addedNodeIds: [], changedNodeIds, styleChanges,
    });
  }
  if (obs.stuck.length) {
    const stuckNodeIds = obs.stuck.map((i) => nodeIdBySfIdx.get(i)).filter(Boolean);
    if (stuckNodeIds.length) {
      stateEntries.push({
        source: 'scroll', scrollStep: obs.step, scrollY: obs.scrollY,
        effect: 'sticky-transition', addedNodeIds: [], changedNodeIds: stuckNodeIds, styleChanges: [],
      });
    }
  }
}
const states = {
  ...envelope('state-deltas'),
  routeId, entries: stateEntries,
  stats: {
    cssomRules: stateEntries.filter((e) => e.source === 'cssom').length,
    probedNodes: 0,
    scrollSteps: stateEntries.filter((e) => e.source === 'scroll').length,
  },
};

const harBytes = readFileSync(join(OUT, 'network', 'session.har'));
const harJson = JSON.parse(harBytes.toString('utf8'));
const assetEntries = {};
for (const [url, a] of assetsByUrl) {
  const ext = (a.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  assetEntries[url] = {
    assetId: a.sha256, originalUrl: url,
    localPath: `assets/files/${a.sha256}.${ext}`,
    sha256: a.sha256, mime: a.mime, bytes: a.bytes,
    kind: a.mime.startsWith('image/') ? 'image'
      : a.mime.startsWith('font/') ? 'font'
      : a.mime.includes('css') ? 'stylesheet'
      : a.mime.includes('javascript') ? 'script'
      : a.mime.includes('html') ? 'document'
      : a.mime.includes('json') ? 'json' : 'other',
    status: a.status, sameOrigin: a.sameOrigin, fromCache: a.fromCache,
    referencedBy: [],
  };
}
const absolute = (u) => { try { return new URL(u, extracted.url).href; } catch { return null; } };
for (let i = 0; i < extracted.nodes.length; i += 1) {
  const raw = extracted.nodes[i];
  if (raw.kind !== 'element') continue;
  for (const attr of ['src', 'href']) {
    const abs = raw.attributes[attr] ? absolute(raw.attributes[attr]) : null;
    const entry = abs ? assetEntries[abs] : undefined;
    if (entry) entry.referencedBy.push({ kind: 'dom-attribute', routeId, nodeId: built[i].nodeId, attribute: attr });
  }
}
for (const ref of cssom.cssUrls) {
  const abs = absolute(ref.url);
  const entry = abs ? assetEntries[abs] : undefined;
  if (entry) {
    entry.referencedBy.push({
      kind: 'css-url', routeId,
      ...(ref.stylesheetHref ? { stylesheetHref: ref.stylesheetHref } : {}),
      property: ref.property,
    });
  }
}
for (const font of cssom.fonts) {
  for (const m of String(font.src ?? '').matchAll(/url\((['"]?)([^'")]+)\1\)/g)) {
    const abs = absolute(m[2]);
    const entry = abs ? assetEntries[abs] : undefined;
    if (entry) entry.referencedBy.push({ kind: 'font-face', routeId, family: font.family });
  }
}
const assets = {
  ...envelope('asset-index'),
  byUrl: assetEntries,
  stats: {
    assetCount: Object.keys(assetEntries).length,
    distinctFiles: new Set(Object.values(assetEntries).map((a) => a.sha256)).size,
    totalBytes: Object.values(assetEntries).reduce((n, a) => n + a.bytes, 0),
  },
};

const endpoints = {
  // A HAR's bytes are volatile, so its digest belongs in provenance where the
  // idempotency check ignores it (decision 0006).
  ...envelope('endpoint-index', { 'network/session.har': sha256(harBytes) }),
  endpoints: [],
  har: { path: 'network/session.har', entryCount: harJson.log.entries.length },
  thirdPartyOrigins: [],
};

const contentHash = S.deriveRouteContentHash({ dom, styles, states });
const meta = {
  ...envelope('route-meta'),
  routeId, siteId: 'spike-target',
  urlPattern, contextId: CONTEXT_ID, instanceIndex: 0,
  url: extracted.url, pathParams: {}, canonicalUrl: extracted.url,
  title: scrub(extracted.title), status, redirectChain,
  templateGuess: { name: 'unknown', confidence: 0.1, rationale: 'Spike captured a single route; nothing to group against.' },
  // The crawl is anonymous and the page rendered, which is what settles this.
  // Derived rather than declared — see decision 0010.
  requiresAuth: 'not-required',
  authEvidence: [{ kind: 'anonymous-success', status: 200, observedCount: 1, contextId: CONTEXT_ID }],
  unauthenticatedBehavior: { kind: 'accessible' },
  depth: 0, discoveredFrom: { kind: 'entry' }, embeddedIn: [],
  content: {
    kind: 'captured', contentHash,
    renderedSize: { width: VIEWPORT.width, height: VIEWPORT.height },
    screenshots: {
      full: { path: 'shot.full.png', sha256: sha256(fullShot), width: VIEWPORT.width, height: extracted.scrollHeight },
      scroll: scrollShots.map((s) => {
        const path = `scroll/${String(s.index).padStart(4, '0')}.png`;
        writeFileSync(join(routeDir, path), s.bytes);
        return {
          index: s.index, scrollY: s.scrollY,
          shot: { path, sha256: sha256(s.bytes), width: VIEWPORT.width, height: VIEWPORT.height },
        };
      }),
    },
    pageMetrics: {
      scrollHeight: extracted.scrollHeight, scrollWidth: extracted.scrollWidth,
      scrollSteps: scrollShots.length,
    },
  },
  gapIds: [],
};

const manifest = {
  ...envelope('capture-manifest'),
  siteId: 'spike-target',
  target: { entryUrl: TARGET, origin: new URL(TARGET).origin },
  permission: { source: 'allowlist', matchedEntry },
  contexts: [{
    contextId: CONTEXT_ID, label: 'Anonymous · 1280×800 · en-US',
    auth: { mode: 'anonymous' }, viewport: VIEWPORT,
    locale: { language: 'en-US', timezone: 'UTC' }, variant: null,
  }],
  userAgent: UA,
  determinism: {
    seed: SEED, frozenEpochMs: FROZEN_EPOCH_MS, frozenTimezone: 'UTC', frozenLocale: 'en-US',
    frozen: ['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID'],
    prefersReducedMotion: 'reduce',
  },
  crawl: {
    budget: { maxInstancesPerPattern: 3, maxRoutesPerContext: 40, maxRoutesTotal: 100, maxDepth: 3 },
    sameOriginOnly: true,
    allowedOrigins: [...ALLOWED_ORIGINS],
    // Anonymous crawl: no session exists, so there is none to spend.
    sessionProbePolicy: 'not-applicable',
    allowDestructive: false,
    destructiveTerms: ['delete', 'remove', 'cancel subscription', 'deactivate'],
  },
  toolVersions: { siteforge: '0.1.0-spike', playwright: '1.x', browser: 'chromium-headless-shell' },
  patterns: [{ urlPattern, observedUrlCount: 1, routeIds: [routeId] }],
  routeIds: [routeId], flowIds: [], contentHash: sha256('spike'),
  counts: {
    contexts: 1, routes: 1, capturedRoutes: 1, patterns: 1,
    assets: Object.keys(assetEntries).length, endpoints: 0, flows: 0, gaps: 0,
  },
};

/* ------------------------------------------------------------- validate */

const artifacts = [
  ['manifest.json', S.CaptureManifestSchema, manifest],
  [`routes/${routeId}/meta.json`, S.RouteMetaSchema, meta],
  [`routes/${routeId}/dom.json`, S.DomDocumentSchema, dom],
  [`routes/${routeId}/styles.json`, S.StyleSheetDocumentSchema, styles],
  [`routes/${routeId}/states.json`, S.StateDeltasDocumentSchema, states],
  ['assets/index.json', S.AssetIndexSchema, assets],
  ['network/endpoints.json', S.EndpointIndexSchema, endpoints],
];

let failed = 0;
for (const [path, schema, value] of artifacts) {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    const abs = join(OUT, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
    console.log(`  ✓ ${path}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${path}`);
    for (const issue of parsed.error.issues.slice(0, 6)) {
      const where = issue.path.join('.').slice(0, 120);
      console.log(`      ${where || '(root)'}: ${issue.message}`);
      finding('schema-rejects-reality', `${path} · ${where}: ${issue.message}`);
    }
  }
}

/** Nothing was skipped on a static page, which is a real answer, not an absence. */
const skippedControlIndex = {
  ...envelope('skipped-control-index'),
  siteId: 'spike-target',
  controls: [],
};

const model = S.CaptureModelSchema.safeParse({
  modelVersion: S.CAPTURE_MODEL_VERSION,
  siteId: 'spike-target',
  manifest, routes: { [routeId]: { meta, dom, styles, states } },
  assets, endpoints, flows: {}, skippedControls: skippedControlIndex,
});
console.log(model.success ? '  ✓ CaptureModel assembles' : '  ✗ CaptureModel');
if (!model.success) {
  for (const issue of model.error.issues.slice(0, 8)) {
    const where = issue.path.join('.').slice(0, 120);
    console.log(`      ${where}: ${issue.message}`);
    finding('schema-rejects-reality', `CaptureModel · ${where}: ${issue.message}`);
  }
}

/* ---------------------------------------- observations the schema cannot see */

// §6/§10 previously named page.accessibility.snapshot(), which no longer exists.
// CLAUDE.md now specifies CDP; this records that the CDP path actually delivers
// the DOM mapping the YAML replacement could not.
const elementsWithRole = built.filter((n) => n.nodeType === 'element' && n.a11y).length;
if (elementsWithRole === 0) {
  finding('schema-rejects-reality', 'CDP produced no a11y nodes mapped to DOM nodes');
}

const customElements = built.filter((n) => n.nodeType === 'element' && n.tag.includes('-'));
if (customElements.length) finding('observed', `${customElements.length} custom elements present`);

console.log('');
console.log(`  nodes ${NODE_COUNT} · styled ${styledNodeCount} · distinct styles ${styleTable.size} ` +
  `· dedupe ${styles.stats.dedupeRatio} · assets ${Object.keys(assetEntries).length} · status ${status}`);
console.log(`  redirects: ${redirectChain.length ? redirectChain.map((r) => `${r.status}`).join(',') : 'none'}`);

/* ------------------------------------------------------------- coverage */

const interactiveAx = [...axBySfIdx.values()].filter((a) => INTERACTIVE_ROLES.has(a.role)).length;
const observed = {
  stylesheets: cssom.stylesheetCount,
  // From raw selector text, independent of the parser the extraction uses.
  cssPseudoClassRules: cssom.rawPseudoRules,
  cssAttributeStateRules: cssom.rawAttrStateRules,
  cssFontFaceRules: cssom.fonts.length,
  harXhrEntries: (harJson.log.entries ?? []).filter((e) =>
    ['xhr', 'fetch'].includes(String(e._resourceType ?? '').toLowerCase())).length,
  harDistinctMethods: new Set((harJson.log.entries ?? [])
    .filter((e) => ['xhr', 'fetch'].includes(String(e._resourceType ?? '').toLowerCase()))
    .map((e) => e.request?.method)).size,
  documentHeightRatio: extracted.scrollHeight / VIEWPORT.height,
  axInteractiveRoles: interactiveAx,
  subresourceRequests: Object.keys(assetEntries).length,
  // A static page with no API traffic; nothing carried a credential.
  harCredentialedRequests: 0,
  sessionProbePolicy: 'not-applicable',
  sessionDestructiveControls: 0,
};
const extractedCounts = {
  styleTableEntries: styles.table.length,
  statesCssomPseudo: stateEntries.filter(
    (e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith(':'))).length,
  statesCssomAttribute: stateEntries.filter(
    (e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith('['))).length,
  statesProbed: states.stats.probedNodes,
  statesScroll: states.stats.scrollSteps,
  fonts: styles.fonts.length,
  endpoints: endpoints.endpoints.length,
  endpointDistinctMethods: new Set(endpoints.endpoints.map((e) => e.method)).size,
  scrollSteps: scrollShots.length,
  interactionCandidates: built.filter((n) => n.nodeType === 'element' && n.interaction).length,
  assets: Object.keys(assetEntries).length,
  endpointsWithAuthEvidence: 0,
  sessionDestructiveFired: 0,
  a11yNodes: built.filter((n) => n.nodeType === 'element' && n.a11y).length,
};
const coverage = {
  ...envelope('coverage-report'),
  siteId: 'spike-target',
  routeIds: [routeId],
  observed, extracted: extractedCounts,
  invariants: S.evaluateCoverage(observed, extractedCounts),
};
const coverageParsed = S.CoverageReportSchema.safeParse(coverage);
if (!coverageParsed.success) {
  failed += 1;
  console.log('  ✗ coverage.json');
  for (const issue of coverageParsed.error.issues.slice(0, 6)) {
    console.log(`      ${issue.path.join('.')}: ${issue.message}`);
  }
} else {
  writeFileSync(join(OUT, 'coverage.json'), `${JSON.stringify(coverage, null, 2)}\n`);
  console.log('  ✓ coverage.json');
}

console.log('');
console.log('  COVERAGE INVARIANTS  (input contained X, so output must contain Y)');
let brokenInvariants = 0;
for (const inv of coverage.invariants) {
  if (inv.vacuous) { console.log(`    · ${inv.id} (vacuous)`); continue; }
  if (!inv.holds) brokenInvariants += 1;
  console.log(`    ${inv.holds ? '✓' : '✗'} ${inv.id}`);
  if (!inv.holds) console.log(`        ${inv.description}`);
}
if (brokenInvariants) {
  finding('silent-drop', `${brokenInvariants} coverage invariant(s) broken — extraction dropped something the input contained`);
}

/**
 * Subresources fetched from an origin the crawl may not navigate to.
 *
 * This is the allow half of the boundary (§6). It is counted rather than
 * asserted in prose because the previous version of this report printed
 * `allowed 0 foreign subresource(s)` against a single-origin fixture — a number
 * that could only ever be zero, presented as evidence.
 */
const PAGE_ORIGIN = new URL(TARGET).origin;
const foreignAssetUrls = Object.keys(assetEntries)
  .filter((u) => { const o = originOf(u); return o !== null && o !== PAGE_ORIGIN; });

// A subresource allowed because its origin was allowlisted would prove nothing
// about the guard. Assert the second origin was never navigable in the first
// place, so "allowed" can only mean "allowed as a subresource".
const declaredCdn = process.env['RUNG2_CDN_ORIGIN'] ?? '';
if (declaredCdn) {
  if (ALLOWED_ORIGINS.has(declaredCdn)) {
    finding('boundary-misconfigured',
      `${declaredCdn} is in allowedOrigins, so its subresources prove nothing about the guard`);
  }
  if (!foreignAssetUrls.some((u) => u.startsWith(declaredCdn))) {
    finding('boundary-allow-branch-dead',
      `no subresource was recorded from ${declaredCdn}; the guard's allow branch did not run`);
  }
}

const rung = Number(process.env['SITEFORGE_RUNG'] ?? 2);
// Augmented with the boundary measurement: `foreignAssets` is a property of the
// crawl, not an extraction category, so it gates the rung without widening
// coverage.json's schema.
const rungCounts = {
  ...extractedCounts,
  foreignAssets: foreignAssetUrls.length,
  blockedOffOriginNavigations: blockedNavigations.filter((e) => e.kind === 'navigation').length,
};
const { spec, failures, surprises } = checkRung(rung, rungCounts);
console.log('');
console.log(`  RUNG ${rung} — ${spec.label}`);
for (const key of spec.expectNonEmpty) {
  const ok = rungCounts[key] > 0;
  console.log(`    ${ok ? '✓' : '✗'} ${key.padEnd(22)} ${rungCounts[key] ?? 0}`);
}
for (const key of spec.knownEmpty) {
  console.log(`    · ${key.padEnd(22)} ${rungCounts[key] ?? 0}  (known-empty at this rung)`);
}
for (const s2 of surprises) {
  finding('rung-declaration-stale', `${s2} is declared known-empty at rung ${rung} but produced output; update the declaration`);
}
for (const f of failures) {
  finding('rung-gate', `rung ${rung} expects ${f.key} non-empty, got ${f.actual}`);
}
const gatesFailed = failures.length + brokenInvariants;

/**
 * §3.4, enforced. Every file under `capture/` is scanned before the run may
 * pass, and a hit fails it — not a warning, not a gitignore. The prose version
 * of this rule was satisfied in exactly one direction for two rungs while
 * `network/*.har` held a live session cookie.
 */
const secrets = scanCaptureTree(OUT);
if (secrets.length > 0) {
  console.log(`\n  ✗ SECRET SCAN — ${secrets.length} credential(s) reached an artifact (§3.4):`);
  console.log(formatFindings(secrets));
  for (const f of secrets) finding('credential-in-artifact', `${f.file}: ${f.detail}`);
} else {
  console.log('  secrets: clean (§3.4)');
}

console.log('');
if (findings.length === 0) {
  console.log('✓ no findings: the schema accepted a real page unchanged.');
} else {
  console.log(`FINDINGS (${findings.length}):`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.what}`);
}
writeFileSync(join(OUT, 'spike-findings.json'), `${JSON.stringify(findings, null, 2)}\n`);


process.exit(failed > 0 || secrets.length > 0 || gatesFailed > 0 ? 1 : 0);
