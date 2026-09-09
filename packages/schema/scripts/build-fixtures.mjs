/**
 * Generates packages/schema/fixtures/ — one coherent capture of the Northwind
 * Supply fixture site.
 *
 * The output is a real `capture/<site-id>/` tree, not a bag of isolated blobs,
 * because the schema's actual risk is referential: nodeIds that must resolve
 * across files, styleIds that must exist in the table, endpoints that flows must
 * name. Isolated per-type fixtures cannot exercise any of that.
 *
 * Every artifact is validated against the compiled schema before it is written,
 * so a schema change that the fixtures violate fails here rather than in the test
 * suite with a less useful message.
 *
 *   pnpm --filter @siteforge/schema build && node scripts/build-fixtures.mjs
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as S from '../dist/index.js';
import { materialize, sha256, short16, short12 } from './lib-dom.mjs';
import {
  ASSET, GAP, ORIGIN, PRODUCTS, SITE_ID,
  SIZE_GUIDE_BOX, SIZE_GUIDE_ROUTE_ID,
  aboutPage, accountOrdersPage, homePage, productPage, sizeGuidePage,
} from './lib-site.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'capture', SITE_ID);
/**
 * Infer-stage fixtures live outside `capture/` because the stage that produces a
 * shape is part of the contract. Rung 3 found a stubbed `DELETE /api/account`
 * sitting in the capture artifact — a shape §6 cannot produce, because it never
 * fires the control and so never learns the URL. Keeping it there made the
 * fixture a lie about who owns what (decision 0010).
 */
const OUT_INFER = join(HERE, '..', 'fixtures', 'infer', SITE_ID);

const RUN_ID = `run_${short16('northwind-run-1')}`;
const RECORDED_AT = '2026-09-08T11:24:07.000Z';
const SEED = 42;
const prov = (durationMs) => ({ recordedAt: RECORDED_AT, runId: RUN_ID, ...(durationMs !== undefined ? { durationMs } : {}) });
const envelope = (artifact, durationMs, externalDigests) => ({
  modelVersion: S.CAPTURE_MODEL_VERSION,
  artifact,
  scrubbed: true,
  provenance: { ...prov(durationMs), ...(externalDigests ? { externalDigests } : {}) },
});

const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const LOCALE = { language: 'en-US', timezone: 'UTC' };
const HERO_VARIANT = { experiment: 'homepage-hero', variant: 'control', pinnedBy: 'cookie', bestEffort: false };

/**
 * Three capture contexts (decision 0004). §6 requires the anonymous and
 * authenticated sets to be crawled separately; `--responsive` adds the mobile
 * viewport; §11's pinned variant rides along on the same mechanism.
 */
const CONTEXTS = [
  { contextId: 'anon-desktop', label: 'Anonymous · 1280×800 · en-US · hero=control',
    auth: { mode: 'anonymous' }, viewport: DESKTOP, locale: LOCALE, variant: HERO_VARIANT },
  { contextId: 'anon-mobile', label: 'Anonymous · 390×844 · en-US · hero=control',
    auth: { mode: 'anonymous' }, viewport: MOBILE, locale: LOCALE, variant: HERO_VARIANT },
  { contextId: 'auth-desktop', label: 'Signed in · 1280×800 · en-US · no experiment',
    auth: {
      mode: 'storage-state', storageStatePath: 'auth/storage-state.json',
      acquiredBy: 'interactive-headful', expiresAt: '2026-09-15T11:24:07.000Z',
      credentialSource: 'os-keychain',
    },
    viewport: DESKTOP, locale: LOCALE, variant: null },
];
const contextById = new Map(CONTEXTS.map((c) => [c.contextId, c]));

const ROUTE = {
  home: 'root--anon-desktop--i0',
  mug: 'product-id--anon-desktop--i0',
  notebook: 'product-id--anon-desktop--i1',
  mugMobile: 'product-id--anon-mobile--i0',
  sizeGuide: SIZE_GUIDE_ROUTE_ID,
  aboutAnon: 'about--anon-desktop--i0',
  aboutAuth: 'about--auth-desktop--i0',
  orders: 'account-orders--auth-desktop--i0',
};

/* ------------------------------------------------------------------ helpers */

const walk = (node, fn) => {
  fn(node);
  if (node.nodeType === 'element') node.children.forEach((c) => walk(c, fn));
};
const findAll = (root, pred) => {
  const out = [];
  walk(root, (n) => { if (n.nodeType === 'element' && pred(n)) out.push(n); });
  return out;
};
const findOne = (root, pred) => {
  const [first] = findAll(root, pred);
  if (!first) throw new Error('fixture builder: expected to find a node, found none');
  return first;
};
const hasClass = (n, c) => (n.attributes.class ?? '').split(/\s+/).includes(c);
const shot = (path, w, h, label) => ({ path, sha256: sha256(`northwind-shot:${label}`), width: w, height: h });

/** Canonical JSON with sorted keys, for hashing. */
const canon = (v) => {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
};
/** Hash an artifact with its volatile fields removed (see VOLATILE_ARTIFACT_KEYS). */
const stableHash = (artifact) => {
  const copy = { ...artifact };
  for (const k of S.VOLATILE_ARTIFACT_KEYS) delete copy[k];
  return sha256(canon(copy));
};

const written = [];
function write(relPath, schema, value, root = OUT) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error(`\n✗ ${relPath} does not satisfy its schema:\n`);
    console.error(JSON.stringify(parsed.error.issues.slice(0, 12), null, 2));
    process.exit(1);
  }
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, json);
  if (root === OUT) {
    written.push({ path: relPath, sha256: sha256(json), bytes: Buffer.byteLength(json), artifact: value });
  }
  return value;
}

/* ------------------------------------------------------------------- routes */

/**
 * Every anonymous-context route in this fixture was reached anonymously and
 * rendered, which is what settles `not-required`. The verdict is derived from
 * this list, never written beside it — see `resolveAuthRequirement`.
 */
const ANON_OK = [{ kind: 'anonymous-success', status: 200, observedCount: 1, contextId: 'anon-desktop' }];

const PAGES = [
  { routeId: ROUTE.home, page: homePage(), urlPattern: '/', url: `${ORIGIN}/`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'home', confidence: 0.94, rationale: 'Unique layout at the origin root; no sibling shares its structure.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 0,
    discoveredFrom: { kind: 'entry' }, scrollHeight: 2100, scrollSteps: 4,
    redirectChain: [{ from: 'http://example.com/', to: `${ORIGIN}/`, status: 301 }] },

  { routeId: ROUTE.mug, page: productPage(PRODUCTS[0], { mobile: false }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/mug-blue-12oz`, pathParams: { id: 'mug-blue-12oz' },
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'product-detail', confidence: 0.97, rationale: 'Structural hash matches instance i1 at 0.98 similarity.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/mug-blue-12oz',
    scrollHeight: 1400, scrollSteps: 2 },

  { routeId: ROUTE.notebook, page: productPage(PRODUCTS[1], { mobile: false }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/notebook-a5-dot`, pathParams: { id: 'notebook-a5-dot' },
    contextId: 'anon-desktop', instanceIndex: 1,
    template: { name: 'product-detail', confidence: 0.97, rationale: 'Structural hash matches instance i0 at 0.98 similarity.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/notebook-a5-dot',
    scrollHeight: 1400, scrollSteps: 2 },

  { routeId: ROUTE.mugMobile, page: productPage(PRODUCTS[0], { mobile: true }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/mug-blue-12oz`, pathParams: { id: 'mug-blue-12oz' },
    contextId: 'anon-mobile', instanceIndex: 0,
    template: { name: 'product-detail', confidence: 0.95, rationale: 'Same template as the desktop capture; layout differs by media query only.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/mug-blue-12oz',
    scrollHeight: 1900, scrollSteps: 3 },

  { routeId: ROUTE.sizeGuide, page: sizeGuidePage(), urlPattern: '/embeds/size-guide',
    url: `${ORIGIN}/embeds/size-guide`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'embed-table', confidence: 0.72, rationale: 'Standalone document with no shared shell; single table body.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 2,
    embedded: true, scrollHeight: 420, scrollSteps: 1 },

  // Captured in two contexts. The page does not depend on the session, so the
  // second capture stores a pointer rather than a duplicate (decision 0004).
  { routeId: ROUTE.aboutAnon, page: aboutPage(), urlPattern: '/about', url: `${ORIGIN}/about`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'prose', confidence: 0.88, rationale: 'Shell plus a heading and two paragraphs; no data regions.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/about',
    scrollHeight: 900, scrollSteps: 1 },

  { routeId: ROUTE.aboutAuth, page: aboutPage(), urlPattern: '/about', url: `${ORIGIN}/about`, pathParams: {},
    contextId: 'auth-desktop', instanceIndex: 0,
    template: { name: 'prose', confidence: 0.88, rationale: 'Shell plus a heading and two paragraphs; no data regions.' },
    requiresAuth: 'not-required', authEvidence: ANON_OK, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/about',
    scrollHeight: 900, scrollSteps: 1, sharedWith: ROUTE.aboutAnon },

  { routeId: ROUTE.orders, page: accountOrdersPage(), urlPattern: '/account/orders', url: `${ORIGIN}/account/orders`,
    pathParams: {}, contextId: 'auth-desktop', instanceIndex: 0,
    template: { name: 'account-table', confidence: 0.81, rationale: 'Shares the shell with every route; body is a single data table.' },
    requiresAuth: 'required',
    // Observed, not assumed: the anonymous context requested this URL and was
    // bounced. Without that probe the honest verdict would be 'unknown'.
    authEvidence: [{ kind: 'anonymous-redirect-to-login', to: '/login', status: 302, contextId: 'anon-desktop' }],
    unauth: { kind: 'redirect', to: '/login', status: 302 }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: null, scrollHeight: 900, scrollSteps: 1 },
];

const routes = new Map();
for (const p of PAGES) {
  routes.set(p.routeId, {
    spec: p,
    ...materialize(p.page.tree, { documentUrl: p.url, pageTitle: p.page.title }),
  });
}
const home = routes.get(ROUTE.home);

/* ------------------------------------------------------------ CSSOM + states */

const CSS_HREF = `${ORIGIN}/static/app.css`;

function stateEntriesFor(routeId, r, spec) {
  const entries = [];
  let ruleIndex = 0;
  const cssom = (selector, stateSelectors, declarations, matched, extra = {}) => {
    entries.push({
      source: 'cssom', selector, stateSelectors, declarations,
      matchedNodeIds: matched.map((n) => n.nodeId),
      origin: { stylesheetHref: CSS_HREF, sheetIndex: 0, ruleIndex: ruleIndex++ },
      ...extra,
    });
  };

  const primaries = findAll(r.root, (n) => hasClass(n, 'btn-primary'));
  if (primaries.length) {
    cssom('.btn-primary:hover', [':hover'], { 'background-color': 'rgb(29, 78, 216)' }, primaries);
    cssom('.btn-primary:disabled', [':disabled'], { opacity: '0.5', cursor: 'not-allowed' }, primaries);
    cssom('.btn-primary:focus-visible', [':focus-visible'], { 'outline-width': '2px', 'outline-style': 'solid', 'outline-color': 'rgb(37, 99, 235)', 'outline-offset': '2px' }, primaries);
  }
  const cardLinks = findAll(r.root, (n) => hasClass(n, 'card-link'));
  if (cardLinks.length) {
    cssom('.card-link:focus-visible', [':focus-visible'], { 'outline-width': '2px', 'outline-style': 'solid', 'outline-color': 'rgb(37, 99, 235)' }, cardLinks);
    cssom('.product-card:hover .card-img', [':hover'], { transform: 'scale(1.02)' }, cardLinks);
  }
  const triggers = findAll(r.root, (n) => hasClass(n, 'accordion-trigger'));
  if (triggers.length) {
    cssom('.accordion-trigger[aria-expanded="true"]', [':hover', '[aria-expanded]'].slice(1), { 'font-weight': '600' }, triggers);
    const panels = findAll(r.root, (n) => n.attributes.id === 'details-panel');
    cssom('.accordion[data-state="open"] #details-panel', ['[data-state]'], { display: 'block' }, panels);
  }
  const danger = findAll(r.root, (n) => hasClass(n, 'btn-danger'));
  if (danger.length) cssom('.btn-danger:hover', [':hover'], { 'background-color': 'rgb(185, 28, 28)' }, danger);

  // The search field lives in an open shadow root with an adopted stylesheet, so
  // the rule has no stylesheet href to attribute it to. A standalone embed has no
  // site shell, hence no search field and no cart button.
  const [searchInput] = findAll(r.root, (n) => n.tag === 'input' && n.attributes.type === 'search');
  if (searchInput) {
    entries.push({
      source: 'cssom', selector: 'input[type="search"]:focus', stateSelectors: [':focus'],
      declarations: { 'background-color': 'rgb(255, 255, 255)', 'outline-width': '2px', 'outline-style': 'solid', 'outline-color': 'rgb(37, 99, 235)' },
      matchedNodeIds: [searchInput.nodeId],
      origin: { sheetIndex: 1, ruleIndex: 0 },
    });
  }

  // §6: hover probing is reserved for the handful of JS-driven changes CSS cannot express.
  const [cart] = findAll(r.root, (n) => hasClass(n, 'cart-button'));
  if (cart) {
    entries.push({
      source: 'probed', nodeId: cart.nodeId, trigger: 'click', reason: 'absent-from-cssom',
      styleChanges: [], attributeChanges: [{ attribute: 'aria-expanded', from: null, to: 'true' }],
      classChanges: { added: ['is-open'], removed: [] }, subtreeChanged: true,
    });
  }

  if (routeId === ROUTE.home) {
    const imgs = findAll(r.root, (n) => n.tag === 'img' && n.attributes.loading === 'lazy');
    entries.push({
      source: 'scroll', scrollStep: 1, scrollY: 400, effect: 'lazy-load',
      addedNodeIds: [], changedNodeIds: imgs.map((n) => n.nodeId),
      styleChanges: imgs.map((n) => ({ nodeId: n.nodeId, changes: [{ property: 'opacity', from: '0', to: '1' }] })),
    });
  }
  // The header only gains its shadow once the page has actually scrolled, so a
  // route that fits in one viewport has no sticky transition to record.
  const [header] = findAll(r.root, (n) => hasClass(n, 'site-header'));
  if (spec.scrollSteps > 1 && header) {
    entries.push({
      source: 'scroll', scrollStep: 1, scrollY: spec.viewport.height / 2, effect: 'sticky-transition',
      addedNodeIds: [], changedNodeIds: [header.nodeId],
      styleChanges: [{ nodeId: header.nodeId, changes: [{ property: 'box-shadow', from: 'none', to: 'rgba(0, 0, 0, 0.06) 0px 1px 3px 0px' }] }],
    });
  }

  return entries;
}

/* -------------------------------------------------------------------- write */

rmSync(OUT, { recursive: true, force: true });

for (const [routeId, r] of routes) {
  const p = r.spec;
  const context = contextById.get(p.contextId);
  const viewport = context.viewport;

  const frameHosts = p.embedded
    ? [ROUTE.mug, ROUTE.notebook].map((parentId) => ({
        routeId: parentId,
        nodeId: findOne(routes.get(parentId).root, (n) => n.tag === 'iframe' && n.attributes.src === '/embeds/size-guide').nodeId,
        contentBox: SIZE_GUIDE_BOX,
      }))
    : [];
  const discoveredFrom = p.embedded
    ? { kind: 'iframe', routeId: frameHosts[0].routeId, nodeId: frameHosts[0].nodeId }
    : p.discoveredFrom ?? {
        kind: 'link', routeId: p.discoveredFromRoute,
        nodeId: findOne(home.root, (n) => n.attributes.href === (p.discoveredFromHref ?? '/shop')).nodeId,
      };

  // The rendered box is the context viewport, except inside a frame.
  const renderedSize = p.embedded
    ? { width: SIZE_GUIDE_BOX.width, height: SIZE_GUIDE_BOX.height }
    : { width: viewport.width, height: viewport.height };

  // Gaps are derived from what the DOM actually contains, not hand-listed, so a
  // structural change cannot leave a stale reference behind.
  const gapIds = [GAP.licensedFont];
  if (findAll(r.root, (n) => n.iframe?.sameOrigin === false).length) gapIds.unshift(GAP.thirdPartyIframe);
  if (findAll(r.root, (n) => n.shadowHost?.mode === 'closed').length) gapIds.push(GAP.closedShadowRoot);
  if (routeId === ROUTE.orders) gapIds.push(GAP.destructiveSkip);

  const dom = {
    ...envelope('dom-document', 620),
    routeId, documentUrl: p.url, doctype: 'html', lang: 'en',
    normalization: {
      whitespace: 'collapsed', commentsRemoved: true, inlineCodeOmitted: true,
      shadowDomFlattened: true,
      iframesRecursed: findAll(r.root, (n) => n.iframe?.sameOrigin === true).length > 0,
    },
    root: r.root, nodeCount: r.nodeCount, domHash: r.domHash,
  };
  const styles = {
    ...envelope('style-sheet', 410),
    routeId, propertySet: 'siteforge/v1',
    table: r.table, assignments: r.assignments,
    fonts: [{
      family: 'Söhne',
      sources: [{ assetId: ASSET.fontSohne, originalUrl: `${ORIGIN}/static/fonts/sohne-buch.woff2`, format: 'woff2' }],
      weight: '400', style: 'normal', display: 'swap', license: 'licensed',
    }],
    stats: {
      styledNodeCount: r.styledNodeCount,
      distinctStyles: r.table.length,
      dedupeRatio: Number((r.table.length / r.styledNodeCount).toFixed(4)),
    },
  };
  const entries = stateEntriesFor(routeId, r, { ...p, viewport });
  const states = {
    ...envelope('state-deltas', 780),
    routeId, entries,
    stats: {
      cssomRules: entries.filter((e) => e.source === 'cssom').length,
      probedNodes: entries.filter((e) => e.source === 'probed').length,
      scrollSteps: entries.filter((e) => e.source === 'scroll').length,
    },
  };

  const contentHash = S.deriveRouteContentHash({ dom, styles, states });
  r.contentHash = contentHash;

  let content;
  if (p.sharedWith) {
    const canonical = routes.get(p.sharedWith);
    if (canonical.contentHash !== contentHash) {
      console.error(`✗ ${routeId} is declared as sharing content with ${p.sharedWith}, but they hash differently.`);
      process.exit(1);
    }
    content = { kind: 'shared', contentHash, canonicalRouteId: p.sharedWith };
  } else {
    const scroll = Array.from({ length: p.scrollSteps }, (_, i) => ({
      index: i,
      scrollY: Math.min(i * (renderedSize.height / 2), Math.max(0, p.scrollHeight - renderedSize.height)),
      shot: shot(`scroll/${String(i).padStart(4, '0')}.png`, renderedSize.width, renderedSize.height, `${routeId}:${i}`),
    }));
    content = {
      kind: 'captured', contentHash, renderedSize,
      screenshots: { full: shot('shot.full.png', renderedSize.width, p.scrollHeight, `${routeId}:full`), scroll },
      pageMetrics: { scrollHeight: p.scrollHeight, scrollWidth: renderedSize.width, scrollSteps: p.scrollSteps },
    };
  }

  write(`routes/${routeId}/meta.json`, S.RouteMetaSchema, {
    ...envelope('route-meta', 1840),
    routeId, siteId: SITE_ID,
    urlPattern: p.urlPattern, contextId: p.contextId, instanceIndex: p.instanceIndex,
    url: p.url, pathParams: p.pathParams, canonicalUrl: p.url, title: p.page.title,
    status: 200, redirectChain: p.redirectChain ?? [],
    templateGuess: p.template,
    requiresAuth: p.requiresAuth, authEvidence: p.authEvidence, unauthenticatedBehavior: p.unauth,
    depth: p.depth, discoveredFrom, embeddedIn: frameHosts,
    content, gapIds,
  });

  // A shared route stores nothing but its pointer.
  if (p.sharedWith) continue;
  write(`routes/${routeId}/dom.json`, S.DomDocumentSchema, dom);
  write(`routes/${routeId}/styles.json`, S.StyleSheetDocumentSchema, styles);
  write(`routes/${routeId}/states.json`, S.StateDeltasDocumentSchema, states);
}

/* -------------------------------------------------------------------- assets */

const FILES = [
  { url: `${ORIGIN}/static/logo.svg`, id: ASSET.logo, mime: 'image/svg+xml', kind: 'image', bytes: 2841, ext: 'svg' },
  { url: `${ORIGIN}/static/app.css`, id: ASSET.appCss, mime: 'text/css', kind: 'stylesheet', bytes: 18422, ext: 'css' },
  { url: `${ORIGIN}/static/fonts/sohne-buch.woff2`, id: ASSET.fontSohne, mime: 'font/woff2', kind: 'font', bytes: 41208, ext: 'woff2' },
  { url: `${ORIGIN}/static/img/paper-texture.png`, id: ASSET.texture, mime: 'image/png', kind: 'image', bytes: 9134, ext: 'png' },
  { url: `${ORIGIN}/static/img/mug-blue.jpg`, id: ASSET.imgMug, mime: 'image/jpeg', kind: 'image', bytes: 87304, ext: 'jpg' },
  { url: `${ORIGIN}/static/img/notebook-a5.jpg`, id: ASSET.imgNotebook, mime: 'image/jpeg', kind: 'image', bytes: 74110, ext: 'jpg' },
  { url: `${ORIGIN}/static/img/pens-fine.jpg`, id: ASSET.imgPens, mime: 'image/jpeg', kind: 'image', bytes: 61980, ext: 'jpg' },
  { url: 'https://widgets.example.net/reviews?site=northwind', id: ASSET.reviewsPlaceholder, mime: 'image/png', kind: 'image', bytes: 14902, ext: 'png', sameOrigin: false },
];
/**
 * `app.css` carries a redaction, and every other file does not.
 *
 * A fixture where every asset is `verbatim` never exercises the state the
 * schema exists to describe — the stored bytes diverging from the wire hash —
 * and a reader of the fixture would take `verbatim` for a constant. The
 * stylesheet is the right one to redact: §3.4 names emails, and a stylesheet is
 * the sort of text body that carries an author comment with one in it.
 */
const REDACTED_STORED = {
  kind: 'redacted',
  sha256: sha256('northwind/app.css/redacted'),
  bytes: 18396,
  redactions: 1,
};
const byUrl = Object.fromEntries(FILES.map((f) => [f.url, {
  assetId: f.id, originalUrl: f.url,
  localPath: `assets/files/${f.id}.${f.ext}`,
  sha256: f.id, mime: f.mime, bytes: f.bytes, kind: f.kind, status: 200,
  sameOrigin: f.sameOrigin ?? true, fromCache: false,
  stored: f.id === ASSET.appCss ? REDACTED_STORED : { kind: 'verbatim' },
  referencedBy: [],
}]));
const resolveUrl = (v) => (v.startsWith('http') ? v : `${ORIGIN}${v}`);

for (const [routeId, r] of routes) {
  // A shared route stores no dom.json, so it can host no references; its content
  // is reached through the canonical route.
  if (r.spec.sharedWith) continue;
  walk(r.root, (n) => {
    if (n.nodeType !== 'element') return;
    for (const attr of ['src', 'href']) {
      const raw = n.attributes[attr];
      if (!raw) continue;
      const entry = byUrl[resolveUrl(raw)];
      if (entry) entry.referencedBy.push({ kind: 'dom-attribute', routeId, nodeId: n.nodeId, attribute: attr });
    }
  });
  // The page background is declared in app.css, so the texture is reached through
  // a computed `url()` rather than a DOM attribute.
  const bodyStyleId = r.assignments[findOne(r.root, (n) => n.tag === 'body').nodeId];
  const bodyDecls = r.table.find((e) => e.styleId === bodyStyleId).declarations;
  if (bodyDecls['background-image']) {
    byUrl[`${ORIGIN}/static/img/paper-texture.png`].referencedBy.push({
      kind: 'css-url', routeId, styleId: bodyStyleId, stylesheetHref: CSS_HREF, property: 'background-image',
    });
  }
  byUrl[`${ORIGIN}/static/fonts/sohne-buch.woff2`].referencedBy.push({ kind: 'font-face', routeId, family: 'Söhne' });
}
byUrl[`${ORIGIN}/static/fonts/sohne-buch.woff2`].referencedBy.push({ kind: 'asset-import', fromAssetId: ASSET.appCss });

write('assets/index.json', S.AssetIndexSchema, {
  ...envelope('asset-index', 2260),
  byUrl,
  stats: {
    assetCount: FILES.length,
    distinctFiles: new Set(FILES.map((f) => f.id)).size,
    totalBytes: FILES.reduce((a, f) => a + f.bytes, 0),
  },
});

/* ----------------------------------------------------------------- endpoints */

// Resolved from the materialized DOM rather than hand-written, so a structural
// change to the page cannot leave these pointing at nothing.
const ordersRoute = routes.get(ROUTE.orders);
const ORDER_STATUS_SELECT = findOne(ordersRoute.root, (n) => n.attributes?.id === 'order-status-filter').nodeId;
const DELETE_ACCOUNT_BUTTON = findOne(ordersRoute.root, (n) => n.attributes?.class === 'btn btn-danger').nodeId;

/* Auth evidence, by what was actually observed (decision 0010). */
const anonOk = (status, observedCount) => [
  { kind: 'anonymous-success', status, observedCount, contextId: 'anon-desktop' },
];
/** The rung-3 situation: the whole crawl was signed in, so nothing was refused. */
const authOnly = (observedCount) => [
  { kind: 'all-observations-authenticated', header: 'cookie', observedCount },
];
/** §6's anonymous re-issue of a GET, which is what settles `required`. */
const anonRefused = (observedCount) => [
  { kind: 'unauthorized-status', status: 401, observedCount, contextId: 'anon-desktop' },
];
const seenOnTheWire = { kind: 'observed' };

/** A format is the cheap narrowing: it annotates a shape without closing a domain. */
const fmt = (format, n) => ({
  format,
  narrowing: { kind: 'format', format, matched: n, total: n },
});
/** Entity identity. Widens rather than narrows, and feeds §7.4's foreign keys. */
const idField = (evidence, pathParamOf = []) => ({
  type: 'string',
  identifier: { pathParamOf, evidence },
});

const productSchema = {
  type: 'object',
  properties: {
    sku: idField(['unique-per-record']),
    // The strong case: these values were observed as the path parameter of
    // `/api/products/:slug`, so the field is a key by observation, not by name.
    slug: idField(['path-param-value-overlap', 'unique-per-record'], ['get-api-products-slug']),
    title: { type: 'string' },
    price: { type: 'number' },
    // Three products, all 'USD'. A human knows this domain is closed; capture
    // does not, and nothing in the UI constrains it. `string` + examples carries
    // the same information for seeding without making every other currency
    // unrepresentable in the clone. Narrowing must be justified; widening is free.
    currency: { type: 'string', examples: ['USD'] },
    // §7.4's own example: `categoryId` plus a categories endpoint is a foreign
    // key. No endpoint here ever took it as a path parameter, so the evidence is
    // only the name — recorded as such, and weaker for it.
    categoryId: idField(['identifier-name']),
    inStock: { type: 'boolean' },
    imageUrl: { type: 'string', ...fmt('uri', 3) },
  },
  required: ['sku', 'slug', 'title', 'price', 'currency', 'categoryId', 'inStock'],
  additionalProperties: false,
};
const productJson = (p, categoryId, inStock = true) => ({
  sku: p.sku, slug: p.slug, title: p.title,
  price: Number(p.price.replace('$', '')), currency: 'USD',
  categoryId, inStock, imageUrl: `${ORIGIN}${p.image}`,
});
const sample = (label, status, body, observedOn, contentType = 'application/json') => ({
  sampleId: `sample_${sha256(`northwind-sample:${label}`).slice(0, 8)}`,
  status, contentType, body, bytes: Buffer.byteLength(JSON.stringify(body)), observedOn,
});
const noParams = { path: [], query: [], headers: [] };
const sessionHeader = [{ name: 'cookie', required: true, sensitive: true }];

const ENDPOINTS = [
  {
    endpointId: 'get-api-products', method: 'GET', pathPattern: '/api/products', origin: ORIGIN,
    params: { path: [], query: [{ name: 'category', type: 'string', required: false, examples: ['drinkware', 'paper'] }], headers: [] },
    requestBodySchema: null,
    responses: [{ status: 200, contentType: 'application/json', observedCount: 1, schema: { type: 'array', items: productSchema } }],
    samples: [sample('products', 200, [productJson(PRODUCTS[0], 'drinkware'), productJson(PRODUCTS[1], 'paper'), productJson(PRODUCTS[2], 'paper', false)], ROUTE.home)],
    discovery: seenOnTheWire,
    isMutation: false, requiresAuth: 'not-required', authEvidence: anonOk(200, 1),
    observedCount: 1, observedOn: [ROUTE.home],
  },
  {
    endpointId: 'get-api-products-slug', method: 'GET', pathPattern: '/api/products/:slug', origin: ORIGIN,
    params: { path: [{ name: 'slug', type: 'string', required: true, examples: ['mug-blue-12oz', 'notebook-a5-dot'] }], query: [], headers: [] },
    requestBodySchema: null,
    responses: [
      { status: 200, contentType: 'application/json', observedCount: 3, schema: productSchema },
      { status: 404, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false } },
    ],
    samples: [
      sample('product-mug', 200, productJson(PRODUCTS[0], 'drinkware'), ROUTE.mug),
      sample('product-notebook', 200, productJson(PRODUCTS[1], 'paper'), ROUTE.notebook),
    ],
    discovery: seenOnTheWire,
    isMutation: false, requiresAuth: 'not-required', authEvidence: anonOk(200, 3),
    observedCount: 3, observedOn: [ROUTE.mug, ROUTE.notebook, ROUTE.mugMobile],
  },
  {
    endpointId: 'get-api-cart', method: 'GET', pathPattern: '/api/cart', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader }, requestBodySchema: null,
    responses: [{
      status: 200, contentType: 'application/json', observedCount: 2,
      schema: {
        type: 'object',
        properties: {
          id: idField(['identifier-name']),
          items: { type: 'array', items: { type: 'object', properties: { sku: idField(['identifier-name']), quantity: { type: 'integer' }, unitPrice: { type: 'number' } }, required: ['sku', 'quantity', 'unitPrice'], additionalProperties: false } },
          subtotal: { type: 'number' },
        },
        required: ['id', 'items', 'subtotal'], additionalProperties: false,
      },
    }],
    samples: [sample('cart-two', 200, { id: 'cart_0001', items: [{ sku: 'MUG-BLUE-12OZ', quantity: 2, unitPrice: 18 }], subtotal: 36 }, ROUTE.mug)],
    discovery: seenOnTheWire,
    isMutation: false, requiresAuth: 'not-required', authEvidence: anonOk(200, 2),
    observedCount: 2, observedOn: [ROUTE.mug],
  },
  {
    endpointId: 'post-api-cart-items', method: 'POST', pathPattern: '/api/cart/items', origin: ORIGIN,
    params: { path: [], query: [], headers: [...sessionHeader, { name: 'content-type', required: true, sensitive: false }] },
    requestBodySchema: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' } }, required: ['sku', 'quantity'], additionalProperties: false },
    responses: [{
      status: 201, contentType: 'application/json', observedCount: 1,
      schema: { type: 'object', properties: { id: idField(['identifier-name']), items: { type: 'array', items: { type: 'object', properties: { sku: idField(['identifier-name']), quantity: { type: 'integer' }, unitPrice: { type: 'number' } }, required: ['sku', 'quantity', 'unitPrice'], additionalProperties: false } }, subtotal: { type: 'number' } }, required: ['id', 'items', 'subtotal'], additionalProperties: false },
    }],
    samples: [sample('cart-add', 201, { id: 'cart_0001', items: [{ sku: 'MUG-BLUE-12OZ', quantity: 2, unitPrice: 18 }], subtotal: 36 }, ROUTE.mug)],
    discovery: seenOnTheWire,
    isMutation: true, requiresAuth: 'not-required', authEvidence: anonOk(201, 1),
    observedCount: 1, observedOn: [ROUTE.mug],
  },
  {
    endpointId: 'post-api-checkout', method: 'POST', pathPattern: '/api/checkout', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader },
    requestBodySchema: { type: 'object', properties: { cartId: { type: 'string' }, paymentToken: { type: 'string' } }, required: ['cartId', 'paymentToken'], additionalProperties: false },
    // `status: 'placed'` was seen once. One observation is a sample, not a
    // domain, and nothing in the UI constrains this field — so it stays a string.
    responses: [{ status: 201, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { orderId: idField(['unique-per-record']), status: { type: 'string', examples: ['placed'] }, total: { type: 'number' } }, required: ['orderId', 'status', 'total'], additionalProperties: false } }],
    samples: [sample('checkout', 201, { orderId: 'NW-10428', status: 'placed', total: 30.5 }, ROUTE.orders)],
    discovery: seenOnTheWire,
    // The rung-3 shape, preserved deliberately: every observation carried a
    // session cookie and no anonymous attempt was ever made, so this is honestly
    // `unknown`. It is a mutation, so §8 resolves it closed and gates it —
    // `resolveAuthForCodegen('unknown') === true`.
    isMutation: true, requiresAuth: 'unknown', authEvidence: authOnly(1),
    observedCount: 1, observedOn: [ROUTE.orders],
  },
  {
    endpointId: 'get-api-account-orders', method: 'GET', pathPattern: '/api/account/orders', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader }, requestBodySchema: null,
    responses: [{
      status: 200, contentType: 'application/json', observedCount: 1,
      schema: { type: 'array', items: { type: 'object', properties: {
        orderId: idField(['unique-per-record']),
        placedAt: { type: 'string', ...fmt('date-time', 2) },
        // The only enum in this capture, and the only one with ground truth
        // behind it. Note that it has three members while two were observed:
        // the domain comes from the control, not from the sample. That is the
        // whole point — a field is an enum because the DOM constrains it.
        status: {
          type: 'string',
          enum: ['placed', 'shipped', 'delivered'],
          narrowing: {
            kind: 'enum',
            distinctRecords: 2,
            distinctValues: 2,
            uiConstraint: {
              control: 'select',
              routeId: ROUTE.orders,
              nodeId: ORDER_STATUS_SELECT,
              optionValues: ['placed', 'shipped', 'delivered'],
            },
            reviewRequired: true,
            gapId: GAP.narrowedOrderStatus,
          },
        },
        total: { type: 'number' },
      }, required: ['orderId', 'placedAt', 'status', 'total'], additionalProperties: false } },
    }],
    samples: [sample('orders', 200, [
      { orderId: 'NW-10428', placedAt: '2026-08-14T09:02:11.000Z', status: 'delivered', total: 30.5 },
      { orderId: 'NW-10391', placedAt: '2026-07-02T16:44:03.000Z', status: 'shipped', total: 18 },
    ], ROUTE.orders)],
    discovery: seenOnTheWire,
    // §6 re-issues each distinct GET once anonymously, purely to learn this.
    isMutation: false, requiresAuth: 'required', authEvidence: anonRefused(1),
    observedCount: 1, observedOn: [ROUTE.orders],
  },
  {
    endpointId: 'post-api-auth-login', method: 'POST', pathPattern: '/api/auth/login', origin: ORIGIN,
    params: { path: [], query: [], headers: [{ name: 'content-type', required: true, sensitive: false }] },
    requestBodySchema: { type: 'object', properties: { email: { type: 'string', ...fmt('email', 2) }, password: { type: 'string' } }, required: ['email', 'password'], additionalProperties: false },
    responses: [
      { status: 200, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { userId: idField(['identifier-name']), displayName: { type: 'string' } }, required: ['userId', 'displayName'], additionalProperties: false } },
      { status: 401, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false } },
    ],
    // Request bodies are never sampled for this endpoint: they carry credentials (§3.3).
    samples: [sample('login-ok', 200, { userId: 'usr_0001', displayName: '[REDACTED:NAME]' }, ROUTE.home)],
    discovery: seenOnTheWire,
    // This endpoint's 401 is a wrong password, not a refusal to serve an
    // anonymous caller — so it is deliberately *not* recorded as
    // `unauthorized-status`. Evidence is an act of interpretation by the
    // producer; a 401 in the response list does not become evidence on its own.
    isMutation: true, requiresAuth: 'not-required', authEvidence: anonOk(200, 1),
    observedCount: 2, observedOn: [ROUTE.home],
  },
];

/**
 * The control §6 discovered and refused to fire.
 *
 * Capture stops here. It knows a "Delete account" button exists on
 * /account/orders; it does not know what URL that button calls, because it never
 * clicked it — and clicking destructive controls against a target we do not own
 * is precisely what §6 declines to do. Binding this to `DELETE /api/account`
 * means reading the handler out of the page source, which is §7's job, and the
 * result lives in fixtures/infer/ (decision 0010).
 */
write('flows/skipped-controls.json', S.SkippedControlIndexSchema, {
  ...envelope('skipped-control-index', 320),
  siteId: SITE_ID,
  controls: [{
    controlId: `ctl_${sha256('northwind-control:delete-account').slice(0, 12)}`,
    routeId: ROUTE.orders,
    nodeId: DELETE_ACCOUNT_BUTTON,
    role: 'button',
    name: 'Delete account',
    cause: 'target-destructive',
    matchedTerm: 'delete',
    gapId: GAP.destructiveSkip,
    flowId: 'delete-account',
    // Declined, never driven: there is no element state to have observed, and
    // the schema rejects a diagnostic here.
    diagnostic: null,
  }, {
    /**
     * The other cause, with the record that goes with it.
     *
     * A fixture carrying only declined controls never exercises
     * `precondition-unmet`, so `diagnostic` would read as permanently `null` and
     * the field it was added for would go untested by every consumer.
     */
    controlId: `ctl_${sha256('northwind-control:quick-filter').slice(0, 12)}`,
    routeId: ROUTE.orders,
    nodeId: DELETE_ACCOUNT_BUTTON,
    role: 'button',
    name: 'Quick filter',
    cause: 'precondition-unmet',
    gapId: GAP.undriveableControl,
    flowId: null,
    diagnostic: {
      step: 'click/timeout',
      selector: 'main .orders-toolbar button.quick-filter',
      attemptIndex: 7,
      // Visible, stable and enabled the whole time — and something painted on
      // top of it, which is the case none of the other three can express and
      // the reason all four are recorded rather than a verdict.
      visible: true,
      stable: true,
      receivesPointerEvents: false,
      enabled: true,
      inViewport: true,
      navigationPending: false,
      occludedBy: 'div.toast-stack',
      // The discriminator, in the state that distinguishes the two
      // explanations: the page scrolled it into view when asked, it arrived
      // inside the viewport, and something is still on top of it. That rules
      // out "cannot be scrolled" and leaves the interception.
      scrollIntoView: 'succeeded',
      inViewportAfterScroll: true,
      occludedByAfterScroll: 'div.toast-stack',
    },
  }],
});

write('network/endpoints.json', S.EndpointIndexSchema, {
  // The HAR digest is volatile, so it rides in provenance (decision 0006).
  ...envelope('endpoint-index', 1490, { 'network/session.har': sha256('northwind-har') }),
  endpoints: ENDPOINTS,
  har: { path: 'network/session.har', entryCount: 64 },
  thirdPartyOrigins: [{ origin: 'https://widgets.example.net', requestCount: 5, gapId: GAP.thirdPartyOrigin }],
});

/* --------------------------------------------------------------------- flows */

const mug = routes.get(ROUTE.mug);
const orders = routes.get(ROUTE.orders);

// role + name are the resolution path; nodeId and selector are quarantined under
// `diagnostic` because they do not survive codegen (decision 0008).
const targetFor = (r, node) => ({
  role: node.a11y.role,
  name: node.a11y.name,
  entityRef: null, // populated by infer (§7.4), never by capture
  diagnostic: {
    nodeId: node.nodeId,
    selector: node.interaction.selector,
    boundingBox: node.boundingBox,
  },
});
const nodeById = (r, id) => findOne(r.root, (n) => n.attributes.id === id);
const qty = nodeById(mug, 'qty');
const addToCart = findOne(mug.root, (n) => hasClass(n, 'btn-primary') && n.attributes.class.includes('btn '));
const cartBtn = findOne(mug.root, (n) => hasClass(n, 'cart-button'));
const cartLabel = cartBtn.children.find((c) => c.nodeType === 'text');
const accordion = findOne(mug.root, (n) => hasClass(n, 'accordion-trigger'));
const accordionBox = findOne(mug.root, (n) => hasClass(n, 'accordion'));
const panel = nodeById(mug, 'details-panel');
const mainRef = findOne(mug.root, (n) => n.tag === 'main').a11y.ref;

const h = (label) => short16(`northwind-hash:${label}`);
const snap = (domHash, a11yHash, focusedRef = null, url = `${ORIGIN}/product/mug-blue-12oz`) =>
  ({ url, routeId: ROUTE.mug, domHash, a11yHash, focusedRef });
const emptyDom = { addedNodeIds: [], removedNodeIds: [], attributeChanges: [], textChanges: [], styleChanges: [] };
const emptyA11y = { added: [], removed: [], changed: [] };

write(`flows/add-mug-to-cart.trace.json`, S.FlowTraceSchema, {
  ...envelope('flow-trace', 5120),
  flowId: 'add-mug-to-cart', siteId: SITE_ID, kind: 'scripted',
  name: 'Add two mugs to the cart',
  description: 'Set quantity, add to cart, then open the cart drawer. Exercises the one mutation endpoint the anonymous crawl could reach.',
  startRouteId: ROUTE.mug, discoveredBy: 'a11y-tree',
  initialA11yTree: mug.a11yRoot,
  steps: [
    {
      index: 0, action: { type: 'type', text: '2' }, target: targetFor(mug, qty),
      pre: snap(mug.domHash, mug.a11yHash),
      post: snap(h('mug-qty2'), h('mug-qty2-a11y'), qty.a11y.ref),
      domDelta: { ...emptyDom, attributeChanges: [{ nodeId: qty.nodeId, attribute: 'value', from: '1', to: '2' }] },
      a11yDelta: { added: [], removed: [], changed: [{ ref: qty.a11y.ref, property: 'value', from: '1', to: '2' }] },
      networkCalls: [], urlChanged: false, waitStrategy: 'timeout',
    },
    {
      index: 1, action: { type: 'click' }, target: targetFor(mug, addToCart),
      pre: snap(h('mug-qty2'), h('mug-qty2-a11y'), qty.a11y.ref),
      post: snap(h('mug-added'), h('mug-added-a11y'), addToCart.a11y.ref),
      domDelta: {
        ...emptyDom,
        attributeChanges: [{ nodeId: cartBtn.nodeId, attribute: 'aria-label', from: 'Cart, 0 items', to: 'Cart, 2 items' }],
        textChanges: [{ nodeId: cartLabel.nodeId, from: 'Cart (0)', to: 'Cart (2)' }],
      },
      a11yDelta: {
        added: [{ ref: `a11y_${short12('northwind-live:cart-status')}`, role: 'status', name: 'Added to cart', parentRef: mainRef }],
        removed: [],
        changed: [{ ref: cartBtn.a11y.ref, property: 'name', from: 'Cart, 0 items', to: 'Cart, 2 items' }],
      },
      networkCalls: [{
        endpointId: 'post-api-cart-items', method: 'POST', url: `${ORIGIN}/api/cart/items`,
        pathPattern: '/api/cart/items', status: 201, isMutation: true,
      }],
      urlChanged: false, waitStrategy: 'network-idle',
    },
    {
      index: 2, action: { type: 'click' }, target: targetFor(mug, cartBtn),
      pre: snap(h('mug-added'), h('mug-added-a11y'), addToCart.a11y.ref),
      post: snap(h('mug-drawer'), h('mug-drawer-a11y'), cartBtn.a11y.ref),
      domDelta: {
        ...emptyDom,
        attributeChanges: [{ nodeId: cartBtn.nodeId, attribute: 'aria-expanded', from: null, to: 'true' }],
      },
      a11yDelta: {
        added: [{ ref: `a11y_${short12('northwind-live:cart-drawer')}`, role: 'dialog', name: 'Your cart', parentRef: null }],
        removed: [], changed: [{ ref: cartBtn.a11y.ref, property: 'expanded', from: null, to: 'true' }],
      },
      networkCalls: [{
        endpointId: 'get-api-cart', method: 'GET', url: `${ORIGIN}/api/cart`,
        pathPattern: '/api/cart', status: 200, isMutation: false,
      }],
      urlChanged: false, waitStrategy: 'network-idle',
    },
  ],
  outcome: 'completed', destructive: false, gapIds: [],
});

write(`flows/toggle-product-details.trace.json`, S.FlowTraceSchema, {
  ...envelope('flow-trace', 1310),
  flowId: 'toggle-product-details', siteId: SITE_ID, kind: 'probe',
  name: 'Expand the product details accordion',
  description: 'Single-action behavior probe (§6). The transition is JS-driven: the CSSOM rule keys off [data-state], which script sets.',
  startRouteId: ROUTE.mug, discoveredBy: 'event-listeners',
  initialA11yTree: mug.a11yRoot,
  steps: [{
    index: 0, action: { type: 'click' }, target: targetFor(mug, accordion),
    pre: snap(mug.domHash, mug.a11yHash),
    post: snap(h('mug-accordion-open'), h('mug-accordion-open-a11y'), accordion.a11y.ref),
    domDelta: {
      ...emptyDom,
      attributeChanges: [
        { nodeId: accordion.nodeId, attribute: 'aria-expanded', from: 'false', to: 'true' },
        { nodeId: accordionBox.nodeId, attribute: 'data-state', from: 'closed', to: 'open' },
        { nodeId: panel.nodeId, attribute: 'hidden', from: '', to: null },
      ],
    },
    a11yDelta: { added: [], removed: [], changed: [{ ref: accordion.a11y.ref, property: 'expanded', from: 'false', to: 'true' }] },
    networkCalls: [], urlChanged: false, waitStrategy: 'timeout',
  }],
  outcome: 'completed', destructive: false, gapIds: [],
});

write(`flows/delete-account.trace.json`, S.FlowTraceSchema, {
  ...envelope('flow-trace', 12),
  flowId: 'delete-account', siteId: SITE_ID, kind: 'probe',
  name: 'Delete account (not run)',
  description: 'Discovered as an interaction candidate on /account/orders and skipped by §6’s destructive heuristic. Recorded so the clone knows the control exists.',
  startRouteId: ROUTE.orders, discoveredBy: 'a11y-tree',
  initialA11yTree: orders.a11yRoot,
  steps: [],
  outcome: 'skipped', destructive: true,
  skipReason: { cause: 'destructive-heuristic', matchedTerm: 'delete', gapId: GAP.destructiveSkip },
  gapIds: [GAP.destructiveSkip],
});

/* ------------------------------------------------------- manifest + report */

const contentHash = sha256(
  written
    .filter((w) => w.path !== 'manifest.json' && w.path !== 'stage-report.json')
    .map((w) => `${w.path}:${stableHash(w.artifact)}`)
    .sort()
    .join('\n'),
);

const GAPS = [
  {
    gapId: GAP.thirdPartyIframe, stage: 'capture', category: 'iframe-third-party', severity: 'degraded',
    subject: { url: 'https://widgets.example.net/reviews?site=northwind' },
    summary: 'Third-party reviews iframe replaced with a static screenshot.',
    detail: 'The footer embeds widgets.example.net, a cross-origin frame siteforge cannot recurse into. §11 requires a static screenshot placeholder. The frame is non-interactive in the clone; any task depending on review content will not be reproducible.',
    stub: { kind: 'static-screenshot', assetId: ASSET.reviewsPlaceholder },
  },
  {
    gapId: GAP.licensedFont, stage: 'capture', category: 'licensed-webfont', severity: 'degraded',
    subject: { url: `${ORIGIN}/static/fonts/sohne-buch.woff2` },
    summary: 'Söhne is licensed; substituting a metric-compatible open face.',
    detail: '§8 forbids rehosting licensed WOFF2. The captured @font-face was recorded for reference but the generated app will load Inter, whose metrics are close enough to keep the visual gate under threshold. Expect small text-width differences on dense pages.',
    stub: { kind: 'font-substitute', originalFamily: 'Söhne', substituteFamily: 'Inter', metricCompatible: true },
  },
  {
    gapId: GAP.destructiveSkip, stage: 'capture', category: 'destructive-action-skipped', severity: 'degraded',
    subject: { routeId: ROUTE.orders, flowId: 'delete-account' },
    summary: 'Delete account was not probed (destructive heuristic matched "delete").',
    detail: '§6 skips destructive actions unless --allow-destructive. The control was discovered via the a11y tree and CDP listeners, but never clicked against the target, so its transition is unknown. It is recorded in flows/skipped-controls.json with the role, name and node infer needs to bind it to a URL. The danger is to the target, not to a local mock: in the clone the endpoint is implemented fully against the store, because a dead button teaches an agent the control does nothing.',
    stub: { kind: 'omitted', detail: 'Recorded as a skipped control; infer binds it and codegen implements it against the mock store.' },
  },
  {
    gapId: GAP.undriveableControl, stage: 'capture', category: 'interaction-not-reproducible', severity: 'degraded',
    subject: { routeId: ROUTE.orders, nodeId: DELETE_ACCOUNT_BUTTON },
    summary: 'Quick filter was fired and did not resolve (click/timeout).',
    detail: 'Discovered via the a11y tree and activated, but the click never became actionable. The diagnostic on the control records which of Playwright\'s four preconditions was unmet: visible, stable and enabled were all true, and `elementFromPoint` returned a toast stack painted over the centre of the button. Recorded as precondition-unmet rather than as a decision to skip — nothing here was declined — and the cause is left as the observation rather than written up as an explanation.',
    stub: { kind: 'omitted', detail: 'Control renders and is focusable; its transition is not reproduced.' },
  },
  {
    gapId: GAP.narrowedOrderStatus, stage: 'capture', category: 'inferred-type-narrowed', severity: 'info',
    subject: { endpointId: 'get-api-account-orders', routeId: ROUTE.orders },
    summary: 'order status narrowed to an enum on the evidence of a <select>.',
    detail: 'The `status` field of GET /api/account/orders is typed as an enum of three values, though only two were observed. The evidence is the order-status <select> on /account/orders, whose options constrain the domain — the one kind of evidence that is actually ground truth about a closed set. Recorded here because every narrowing is review-required (§7): if that control is a display filter rather than the field\'s domain, this enum is wrong and the clone will reject valid states.',
    stub: { kind: 'none' },
  },
  {
    gapId: GAP.thirdPartyOrigin, stage: 'capture', category: 'iframe-third-party', severity: 'info',
    subject: { url: 'https://widgets.example.net' },
    summary: '5 requests to widgets.example.net were recorded but will not be reproduced.',
    detail: '§8 forbids outbound network from the clone. These requests are documented here and blocked by the undici agent; nothing in the generated app will attempt them.',
    stub: { kind: 'none' },
  },
  {
    gapId: GAP.closedShadowRoot, stage: 'capture', category: 'shadow-dom', severity: 'degraded',
    subject: { routeId: ROUTE.mug, url: `${ORIGIN}/product/mug-blue-12oz` },
    summary: '<nw-rating> uses a closed shadow root; its content is unreachable.',
    detail: '§11 pierces shadow roots via element.shadowRoot, which returns null for a closed root by design — there is no supported way to read one from page context. This is a permanent capability limit, not a missing feature. The host element and its computed style are captured; its subtree is not. The clone renders an empty element of the same box size.',
    stub: { kind: 'omitted', detail: 'Host element rendered at captured dimensions with no content.' },
  },
];

write('manifest.json', S.CaptureManifestSchema, {
  ...envelope('capture-manifest', 41880),
  siteId: SITE_ID,
  target: { entryUrl: 'http://example.com/', origin: ORIGIN },
  permission: { source: 'allowlist', matchedEntry: 'example.com' },
  contexts: CONTEXTS,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 siteforge/0.1.0',
  determinism: {
    seed: SEED,
    frozenEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
    frozenTimezone: 'UTC', frozenLocale: 'en-US',
    frozen: ['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID'],
    prefersReducedMotion: 'reduce',
  },
  crawl: {
    budget: {
      maxInstancesPerPattern: 3,
      maxRoutesPerContext: 40,
      // Three contexts at 40 apiece would be 120; the ceiling is what keeps a
      // run that declares more contexts from silently costing proportionally more.
      maxRoutesTotal: 100,
      maxDepth: 3,
    },
    sameOriginOnly: true,
    allowedOrigins: [ORIGIN],
    // Every authenticated context here reuses a session acquired from env
    // credentials, so a replacement can be obtained without a human.
    sessionProbePolicy: 'credentialed',
    allowDestructive: false,
    destructiveTerms: ['delete', 'remove', 'cancel subscription', 'deactivate'],
  },
  toolVersions: { siteforge: '0.1.0', playwright: '1.49.1', browser: 'chromium-131.0.6778.85' },
  patterns: [
    { urlPattern: '/', observedUrlCount: 1, routeIds: [ROUTE.home] },
    { urlPattern: '/product/:id', observedUrlCount: 12, routeIds: [ROUTE.mug, ROUTE.notebook, ROUTE.mugMobile] },
    { urlPattern: '/about', observedUrlCount: 1, routeIds: [ROUTE.aboutAnon, ROUTE.aboutAuth] },
    { urlPattern: '/account/orders', observedUrlCount: 1, routeIds: [ROUTE.orders] },
    { urlPattern: '/embeds/size-guide', observedUrlCount: 1, routeIds: [ROUTE.sizeGuide] },
  ],
  routeIds: [...routes.keys()],
  flowIds: ['add-mug-to-cart', 'toggle-product-details', 'delete-account'],
  contentHash,
  counts: {
    contexts: CONTEXTS.length,
    routes: routes.size,
    capturedRoutes: [...routes.values()].filter((r) => !r.spec.sharedWith).length,
    patterns: 5,
    assets: FILES.length,
    endpoints: ENDPOINTS.length,
    flows: 3,
    gaps: GAPS.length,
  },
});

const allStates = [...routes.values()]
  .filter((r) => !r.spec.sharedWith)
  .map((r) => stateEntriesFor(r.spec.routeId, r, { ...r.spec, viewport: contextById.get(r.spec.contextId).viewport }));
const flat = allStates.flat();
const capturedRoutes = [...routes.values()].filter((r) => !r.spec.sharedWith);
const observed = {
  stylesheets: 2,
  cssPseudoClassRules: flat.filter((e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith(':'))).length,
  cssAttributeStateRules: flat.filter((e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith('['))).length,
  cssFontFaceRules: 1,
  harXhrEntries: ENDPOINTS.filter((e) => e.observedCount > 0).length,
  harDistinctMethods: new Set(ENDPOINTS.filter((e) => e.observedCount > 0).map((e) => e.method)).size,
  documentHeightRatio: 2100 / 800,
  axInteractiveRoles: capturedRoutes.reduce(
    (n, r) => n + findAll(r.root, (x) => x.interaction !== undefined).length, 0),
  subresourceRequests: FILES.length,
  // Derived, like every other count here. Hand-writing it would let the one
  // number the auth invariant depends on drift from what the fixture contains —
  // the exact property the invariant exists to prevent. (In a real capture this
  // comes from raw header names on the wire, independent of the inferencer; a
  // synthetic fixture has no wire, so it is read back off the descriptors.)
  sessionProbePolicy: 'credentialed',
  sessionDestructiveControls: 0,
  harCredentialedRequests: ENDPOINTS
    .filter((e) => e.params.headers.some((h) => h.name === 'cookie'))
    .reduce((n, e) => n + e.observedCount, 0),
};
const extracted = {
  styleTableEntries: capturedRoutes.reduce((n, r) => n + r.table.length, 0),
  statesCssomPseudo: flat.filter(
    (e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith(':'))).length,
  statesCssomAttribute: flat.filter(
    (e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith('['))).length,
  statesProbed: flat.filter((e) => e.source === 'probed').length,
  statesScroll: flat.filter((e) => e.source === 'scroll').length,
  fonts: 1,
  endpoints: ENDPOINTS.length,
  endpointDistinctMethods: new Set(ENDPOINTS.map((e) => e.method)).size,
  scrollSteps: capturedRoutes.reduce((n, r) => n + r.spec.scrollSteps, 0),
  interactionCandidates: observed.axInteractiveRoles,
  assets: FILES.length,
  endpointsWithAuthEvidence: ENDPOINTS.filter((e) => e.authEvidence.length > 0).length,
  // This fixture's only skipped control is target-destructive; it declares no
  // session-destructive one, so the invariant is honestly vacuous rather than
  // satisfied by a number nobody produced.
  // One driven control produced a transition and one did not — the fixture
  // carries both halves of the ceiling, so neither reads as a constant.
  controlsFired: 1,
  controlsUndriveable: 1,
  sessionDestructiveFired: 0,
  a11yNodes: capturedRoutes.reduce(
    (n, r) => n + findAll(r.root, (x) => x.a11y !== undefined).length, 0),
};
const invariants = S.evaluateCoverage(observed, extracted);
write('coverage.json', S.CoverageReportSchema, {
  ...envelope('coverage-report', 30),
  siteId: SITE_ID,
  routeIds: capturedRoutes.map((r) => r.spec.routeId),
  observed, extracted, invariants,
});
const brokenInvariants = invariants.filter((i) => !i.vacuous && !i.holds);
if (brokenInvariants.length) {
  console.error(`✗ coverage invariants failed: ${brokenInvariants.map((i) => i.id).join(', ')}`);
  process.exit(1);
}

write('stage-report.json', S.StageReportSchema, {
  ...envelope('stage-report', 41880),
  stage: 'capture', siteId: SITE_ID, status: 'ok-with-gaps',
  inputs: [],
  outputs: written.map(({ path, sha256: s, bytes }) => ({ path, sha256: s, bytes })),
  warnings: [
    { code: 'instance-cap-applied', message: '12 URLs matched /product/:id; captured 3 per §6’s cap.', path: 'routes' },
    { code: 'closed-shadow-root-absent', message: 'All shadow roots encountered were open; no closed roots needed flattening.' },
  ],
  gaps: GAPS,
});

/* --------------------------------------------------- infer-stage: bound endpoint */

/**
 * What §7 makes of the skipped control, and the reason 0009 §5 is closed.
 *
 * Capture recorded a "Delete account" button and stopped. Infer reads the
 * captured source, finds the `fetch('/api/account', {method:'DELETE'})` behind
 * that button, and can now name the endpoint — with `responses: []`, because
 * nothing was ever observed, and with the capture gap carried through.
 *
 * What it is *not* is a 501. Destructive actions are dangerous against the
 * target, not against a local mock: `DELETE /api/account` is free in the clone,
 * so codegen implements it fully against the store and the gap records that the
 * response shape came from §7.4's data model rather than the wire. A dead button
 * teaches an agent the control does nothing, and "delete your account" is a
 * legitimate §10 task with a clean state-based validator.
 *
 * `EndpointIndexSchema` — the capture artifact — rejects this shape outright.
 * That rejection is the ownership rule, and `fixtures.test.ts` asserts it.
 */
const boundDeleteEndpoint = {
  endpointId: 'delete-api-account',
  method: 'DELETE',
  pathPattern: '/api/account',
  origin: ORIGIN,
  params: { path: [], query: [], headers: sessionHeader },
  requestBodySchema: null,
  discovery: {
    kind: 'bound-from-control',
    controlId: `ctl_${sha256('northwind-control:delete-account').slice(0, 12)}`,
    evidence: 'fetch-literal',
    gapId: GAP.boundDelete,
  },
  responses: [],
  samples: [],
  isMutation: true,
  // Never called, so never refused. Mutations resolve closed at codegen:
  // `resolveAuthForCodegen('unknown') === true`.
  requiresAuth: 'unknown',
  authEvidence: [],
  observedCount: 0,
  observedOn: [ROUTE.orders],
};

const boundDeleteGap = {
  gapId: GAP.boundDelete, stage: 'infer', category: 'endpoint-synthesized', severity: 'degraded',
  subject: { endpointId: 'delete-api-account', routeId: ROUTE.orders },
  summary: 'DELETE /api/account bound from a skipped control; behaviour synthesized.',
  detail: 'Capture skipped the "Delete account" button by §6’s destructive heuristic, so no request was ever issued and no response was ever seen. Infer recovered the URL from a fetch() literal in the captured source. The clone implements the endpoint fully against the mock store — deleting an account is free locally, and a control that does nothing is worse than one that works, because it teaches an agent the button is inert. The response shape is derived from the inferred data model, not observed, which is why this is a gap: if the real endpoint returns something else, a trajectory that reads the response will diverge.',
  stub: { kind: 'synthesized-endpoint', endpointId: 'delete-api-account', basis: 'inferred-data-model' },
};

write('bound-endpoints.json', z.strictObject({
  note: z.string().min(1),
  endpoints: z.array(S.EndpointDescriptorSchema).min(1),
  gaps: z.array(S.GapSchema).min(1),
}), {
  note: 'Infer-stage output. These endpoints were recovered by static analysis from controls capture refused to fire; EndpointIndexSchema rejects them, by design (decision 0010).',
  endpoints: [boundDeleteEndpoint],
  gaps: [boundDeleteGap],
}, OUT_INFER);

/* ------------------------------------ infer-stage: the FIRST stage report */

/**
 * What is being measured, reported before any score exists (0015 §7.1).
 *
 * This is infer's first report: no grade has run, so `graded` is false and
 * there are no numbers anywhere in it. The scored categories are here so the
 * list can be reviewed as a list — a category list that first becomes visible
 * attached to a score gets read as a score, and a category quietly missing from
 * the table is invisible in exactly the case that matters.
 *
 * The block is built by `inferMetricsBlock()` from the contract, not restated:
 * the schema recomputes the category list, so a fixture that drifts from
 * `GRADE_CATEGORIES` fails to parse here rather than in a review.
 *
 * `authUnknownEndpointIds` is 0014's ruling in the same artifact — derived from
 * the endpoints, never typed out. §8 gates every one of these, and a long list
 * means a shallow anonymous crawl the operator should see.
 */
const authUnknownEndpointIds = [...ENDPOINTS, boundDeleteEndpoint]
  .filter((e) => e.requiresAuth === 'unknown')
  .map((e) => e.endpointId)
  .sort();

write('stage-report.json', S.StageReportSchema, {
  ...envelope('stage-report', 12440),
  stage: 'infer', siteId: SITE_ID, status: 'ok-with-gaps',
  inputs: [{ path: 'network/endpoints.json', sha256: sha256('network/endpoints.json'), bytes: 0 }],
  outputs: [],
  warnings: [
    {
      code: 'grade-not-run',
      message: 'The scored-field contract is reported; no grade has run against this capture. §7.1 keeps the two separable on purpose.',
    },
  ],
  gaps: [boundDeleteGap],
  detail: {
    stage: 'infer',
    metrics: S.inferMetricsBlock({ graded: false }),
    authUnknownEndpointIds,
  },
}, OUT_INFER);

console.log(`✓ fixtures written to ${OUT.replace(process.cwd() + '/', '')}`);
console.log(`  ${written.length} artifacts · ${routes.size} routes · ${ENDPOINTS.length} endpoints · 3 flows · ${GAPS.length} gaps`);
console.log(`  contentHash ${contentHash.slice(0, 16)}…`);
