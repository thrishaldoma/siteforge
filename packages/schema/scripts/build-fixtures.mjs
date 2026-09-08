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
import * as S from '../dist/index.js';
import { materialize, sha256, short16, short12 } from './lib-dom.mjs';
import {
  ASSET, GAP, ORIGIN, PRODUCTS, SITE_ID,
  SIZE_GUIDE_BOX, SIZE_GUIDE_ROUTE_ID,
  aboutPage, accountOrdersPage, homePage, productPage, sizeGuidePage,
} from './lib-site.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'fixtures', 'capture', SITE_ID);

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
function write(relPath, schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    console.error(`\n✗ ${relPath} does not satisfy its schema:\n`);
    console.error(JSON.stringify(parsed.error.issues.slice(0, 12), null, 2));
    process.exit(1);
  }
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const abs = join(OUT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, json);
  written.push({ path: relPath, sha256: sha256(json), bytes: Buffer.byteLength(json), artifact: value });
  return value;
}

/* ------------------------------------------------------------------- routes */

const PAGES = [
  { routeId: ROUTE.home, page: homePage(), urlPattern: '/', url: `${ORIGIN}/`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'home', confidence: 0.94, rationale: 'Unique layout at the origin root; no sibling shares its structure.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 0,
    discoveredFrom: { kind: 'entry' }, scrollHeight: 2100, scrollSteps: 4,
    redirectChain: [{ from: 'http://example.com/', to: `${ORIGIN}/`, status: 301 }] },

  { routeId: ROUTE.mug, page: productPage(PRODUCTS[0], { mobile: false }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/mug-blue-12oz`, pathParams: { id: 'mug-blue-12oz' },
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'product-detail', confidence: 0.97, rationale: 'Structural hash matches instance i1 at 0.98 similarity.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/mug-blue-12oz',
    scrollHeight: 1400, scrollSteps: 2 },

  { routeId: ROUTE.notebook, page: productPage(PRODUCTS[1], { mobile: false }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/notebook-a5-dot`, pathParams: { id: 'notebook-a5-dot' },
    contextId: 'anon-desktop', instanceIndex: 1,
    template: { name: 'product-detail', confidence: 0.97, rationale: 'Structural hash matches instance i0 at 0.98 similarity.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/notebook-a5-dot',
    scrollHeight: 1400, scrollSteps: 2 },

  { routeId: ROUTE.mugMobile, page: productPage(PRODUCTS[0], { mobile: true }), urlPattern: '/product/:id',
    url: `${ORIGIN}/product/mug-blue-12oz`, pathParams: { id: 'mug-blue-12oz' },
    contextId: 'anon-mobile', instanceIndex: 0,
    template: { name: 'product-detail', confidence: 0.95, rationale: 'Same template as the desktop capture; layout differs by media query only.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/product/mug-blue-12oz',
    scrollHeight: 1900, scrollSteps: 3 },

  { routeId: ROUTE.sizeGuide, page: sizeGuidePage(), urlPattern: '/embeds/size-guide',
    url: `${ORIGIN}/embeds/size-guide`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'embed-table', confidence: 0.72, rationale: 'Standalone document with no shared shell; single table body.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 2,
    embedded: true, scrollHeight: 420, scrollSteps: 1 },

  // Captured in two contexts. The page does not depend on the session, so the
  // second capture stores a pointer rather than a duplicate (decision 0004).
  { routeId: ROUTE.aboutAnon, page: aboutPage(), urlPattern: '/about', url: `${ORIGIN}/about`, pathParams: {},
    contextId: 'anon-desktop', instanceIndex: 0,
    template: { name: 'prose', confidence: 0.88, rationale: 'Shell plus a heading and two paragraphs; no data regions.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/about',
    scrollHeight: 900, scrollSteps: 1 },

  { routeId: ROUTE.aboutAuth, page: aboutPage(), urlPattern: '/about', url: `${ORIGIN}/about`, pathParams: {},
    contextId: 'auth-desktop', instanceIndex: 0,
    template: { name: 'prose', confidence: 0.88, rationale: 'Shell plus a heading and two paragraphs; no data regions.' },
    requiresAuth: false, unauth: { kind: 'accessible' }, depth: 1,
    discoveredFromRoute: ROUTE.home, discoveredFromHref: '/about',
    scrollHeight: 900, scrollSteps: 1, sharedWith: ROUTE.aboutAnon },

  { routeId: ROUTE.orders, page: accountOrdersPage(), urlPattern: '/account/orders', url: `${ORIGIN}/account/orders`,
    pathParams: {}, contextId: 'auth-desktop', instanceIndex: 0,
    template: { name: 'account-table', confidence: 0.81, rationale: 'Shares the shell with every route; body is a single data table.' },
    requiresAuth: true, unauth: { kind: 'redirect', to: '/login', status: 302 }, depth: 1,
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
    requiresAuth: p.requiresAuth, unauthenticatedBehavior: p.unauth,
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
const byUrl = Object.fromEntries(FILES.map((f) => [f.url, {
  assetId: f.id, originalUrl: f.url,
  localPath: `assets/files/${f.id}.${f.ext}`,
  sha256: f.id, mime: f.mime, bytes: f.bytes, kind: f.kind, status: 200,
  sameOrigin: f.sameOrigin ?? true, fromCache: false, referencedBy: [],
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

const productSchema = {
  type: 'object',
  properties: {
    sku: { type: 'string' },
    slug: { type: 'string' },
    title: { type: 'string' },
    price: { type: 'number' },
    currency: { type: 'string', enum: ['USD'] },
    categoryId: { type: 'string' },
    inStock: { type: 'boolean' },
    imageUrl: { type: 'string', format: 'uri' },
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
    isMutation: false, requiresAuth: false, observedCount: 1, observedOn: [ROUTE.home],
  },
  {
    endpointId: 'get-api-products-id', method: 'GET', pathPattern: '/api/products/:slug', origin: ORIGIN,
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
    isMutation: false, requiresAuth: false, observedCount: 3, observedOn: [ROUTE.mug, ROUTE.notebook, ROUTE.mugMobile],
  },
  {
    endpointId: 'get-api-cart', method: 'GET', pathPattern: '/api/cart', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader }, requestBodySchema: null,
    responses: [{
      status: 200, contentType: 'application/json', observedCount: 2,
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'number' } }, required: ['sku', 'quantity', 'unitPrice'], additionalProperties: false } },
          subtotal: { type: 'number' },
        },
        required: ['id', 'items', 'subtotal'], additionalProperties: false,
      },
    }],
    samples: [sample('cart-two', 200, { id: 'cart_0001', items: [{ sku: 'MUG-BLUE-12OZ', quantity: 2, unitPrice: 18 }], subtotal: 36 }, ROUTE.mug)],
    isMutation: false, requiresAuth: false, observedCount: 2, observedOn: [ROUTE.mug],
  },
  {
    endpointId: 'post-api-cart-items', method: 'POST', pathPattern: '/api/cart/items', origin: ORIGIN,
    params: { path: [], query: [], headers: [...sessionHeader, { name: 'content-type', required: true, sensitive: false }] },
    requestBodySchema: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' } }, required: ['sku', 'quantity'], additionalProperties: false },
    responses: [{
      status: 201, contentType: 'application/json', observedCount: 1,
      schema: { type: 'object', properties: { id: { type: 'string' }, items: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, quantity: { type: 'integer' }, unitPrice: { type: 'number' } }, required: ['sku', 'quantity', 'unitPrice'], additionalProperties: false } }, subtotal: { type: 'number' } }, required: ['id', 'items', 'subtotal'], additionalProperties: false },
    }],
    samples: [sample('cart-add', 201, { id: 'cart_0001', items: [{ sku: 'MUG-BLUE-12OZ', quantity: 2, unitPrice: 18 }], subtotal: 36 }, ROUTE.mug)],
    isMutation: true, requiresAuth: false, observedCount: 1, observedOn: [ROUTE.mug],
  },
  {
    endpointId: 'post-api-checkout', method: 'POST', pathPattern: '/api/checkout', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader },
    requestBodySchema: { type: 'object', properties: { cartId: { type: 'string' }, paymentToken: { type: 'string' } }, required: ['cartId', 'paymentToken'], additionalProperties: false },
    responses: [{ status: 201, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string', enum: ['placed'] }, total: { type: 'number' } }, required: ['orderId', 'status', 'total'], additionalProperties: false } }],
    samples: [sample('checkout', 201, { orderId: 'NW-10428', status: 'placed', total: 30.5 }, ROUTE.mug)],
    isMutation: true, requiresAuth: true, observedCount: 1, observedOn: [ROUTE.mug],
  },
  {
    endpointId: 'get-api-account-orders', method: 'GET', pathPattern: '/api/account/orders', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader }, requestBodySchema: null,
    responses: [{
      status: 200, contentType: 'application/json', observedCount: 1,
      schema: { type: 'array', items: { type: 'object', properties: { orderId: { type: 'string' }, placedAt: { type: 'string', format: 'date-time' }, status: { type: 'string', enum: ['placed', 'shipped', 'delivered'] }, total: { type: 'number' } }, required: ['orderId', 'placedAt', 'status', 'total'], additionalProperties: false } },
    }],
    samples: [sample('orders', 200, [
      { orderId: 'NW-10428', placedAt: '2026-08-14T09:02:11.000Z', status: 'delivered', total: 30.5 },
      { orderId: 'NW-10391', placedAt: '2026-07-02T16:44:03.000Z', status: 'delivered', total: 18 },
    ], ROUTE.orders)],
    isMutation: false, requiresAuth: true, observedCount: 1, observedOn: [ROUTE.orders],
  },
  {
    endpointId: 'post-api-auth-login', method: 'POST', pathPattern: '/api/auth/login', origin: ORIGIN,
    params: { path: [], query: [], headers: [{ name: 'content-type', required: true, sensitive: false }] },
    requestBodySchema: { type: 'object', properties: { email: { type: 'string', format: 'email' }, password: { type: 'string' } }, required: ['email', 'password'], additionalProperties: false },
    responses: [
      { status: 200, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { userId: { type: 'string' }, displayName: { type: 'string' } }, required: ['userId', 'displayName'], additionalProperties: false } },
      { status: 401, contentType: 'application/json', observedCount: 1, schema: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false } },
    ],
    // Request bodies are never sampled for this endpoint: they carry credentials (§3.3).
    samples: [sample('login-ok', 200, { userId: 'usr_0001', displayName: '[REDACTED:NAME]' }, ROUTE.orders)],
    isMutation: true, requiresAuth: false, observedCount: 2, observedOn: [ROUTE.orders],
  },
  {
    endpointId: 'delete-api-account', method: 'DELETE', pathPattern: '/api/account', origin: ORIGIN,
    params: { path: [], query: [], headers: sessionHeader }, requestBodySchema: null,
    // Never invoked: §6's destructive heuristic skipped it, so there is no observed
    // response to infer a schema from. It becomes a 501 stub rather than a guess.
    responses: [],
    samples: [],
    isMutation: true, requiresAuth: true, observedCount: 0, observedOn: [ROUTE.orders],
    stub: { reason: 'insufficient-observations', gapId: GAP.stubbedDelete },
  },
];

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
    detail: '§6 skips destructive actions unless --allow-destructive. The control was discovered via the a11y tree and CDP listeners, but never clicked, so its transition is unknown. The clone renders the button; activating it hits the stubbed endpoint.',
    stub: { kind: 'omitted', detail: 'Button renders and is focusable; its click handler posts to the 501 stub.' },
  },
  {
    gapId: GAP.stubbedDelete, stage: 'capture', category: 'endpoint-stubbed', severity: 'degraded',
    subject: { endpointId: 'delete-api-account' },
    summary: 'DELETE /api/account has no observed response; stubbed 501.',
    detail: 'Because the destructive probe was skipped, no response was ever observed and no schema could be inferred. §7 requires a 501 stub rather than a plausible invention, so a trajectory that reaches it fails visibly instead of silently succeeding against fabricated data.',
    stub: { kind: 'http-501', header: 'X-Siteforge-Stub: true', endpointId: 'delete-api-account' },
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
  documentHeightRatio: 2100 / 800,
  axInteractiveRoles: capturedRoutes.reduce(
    (n, r) => n + findAll(r.root, (x) => x.interaction !== undefined).length, 0),
  subresourceRequests: FILES.length,
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
  scrollSteps: capturedRoutes.reduce((n, r) => n + r.spec.scrollSteps, 0),
  interactionCandidates: observed.axInteractiveRoles,
  assets: FILES.length,
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

console.log(`✓ fixtures written to ${OUT.replace(process.cwd() + '/', '')}`);
console.log(`  ${written.length} artifacts · ${routes.size} routes · ${ENDPOINTS.length} endpoints · 3 flows · ${GAPS.length} gaps`);
console.log(`  contentHash ${contentHash.slice(0, 16)}…`);
