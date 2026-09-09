/**
 * RUNG 3 — a local CRUD app, both auth contexts, end to end.
 *
 * Targets the three paths rung 2 could not reach, and that codegen leans on
 * hardest:
 *
 *   endpoints[]     inferred from real XHR traffic (§5, §8)
 *   flows/          §6 behavior probing: "This tuple set IS the functional spec."
 *   states.probed   the JS-driven changes absent from the CSSOM by construction
 *
 * Plus both capture contexts (§6, decision 0004): anonymous is redirected to
 * /login; authenticated gets the app.
 *
 *   pnpm rung3
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as S from '../../schema/dist/index.js';
import {
  assertPermitted, boundaryGaps, installEscapeGuards, installOriginGuard, scrub, scrubDeep,
  selectorClassNames,
  scrubHarFile, sha256, writeAssetBodies,
} from './capture-lib.mjs';
import { captureRoute } from './capture-route.mjs';
import { inferEndpoints } from './infer-endpoints.mjs';
import {
  allowedOrigins as deriveAllowedOrigins, decideNavigation, formatFindings, operationalKind,
  assetKind, isTextualAsset, isUnder, originOf, pathSegments, rethrowIfDefect, sameOrigin,
  scanCaptureTree,
  NEVER_FIRE_NAMES, SESSION_DESTRUCTIVE_TERMS, TARGET_DESTRUCTIVE_TERMS, classifyControlHazard,
} from '../../shared/dist/index.js';
import { checkRung } from './rungs.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = Number(process.env['RUNG3_PORT'] ?? 8789);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const OUT = join(REPO, 'capture', 'rung3');
const SITE_ID = 'rung-three';
const SEED = 42;
const RUN_ID = `run_${S.shortHash('rung3')}`;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 siteforge/0.1.0-rung3';

// §3.3: credentials come from the environment, never from a config file and
// never baked into capture. The runner supplies the local fixture app's own.
const USER = process.env['SITEFORGE_USER'];
const PASS = process.env['SITEFORGE_PASS'];

const envelope = (artifact, externalDigests) => ({
  modelVersion: S.CAPTURE_MODEL_VERSION,
  artifact, scrubbed: true,
  provenance: {
    recordedAt: new Date().toISOString(), runId: RUN_ID,
    ...(externalDigests ? { externalDigests } : {}),
  },
});

const CONTEXTS = [
  {
    contextId: 'anon-desktop', label: 'Anonymous · 1280×800 · en-US',
    auth: { mode: 'anonymous' }, viewport: VIEWPORT,
    locale: { language: 'en-US', timezone: 'UTC' }, variant: null,
  },
  {
    contextId: 'auth-desktop', label: 'Signed in · 1280×800 · en-US',
    auth: {
      mode: 'storage-state', storageStatePath: 'auth/storage-state.json',
      acquiredBy: 'scripted', expiresAt: null, credentialSource: 'env',
    },
    viewport: VIEWPORT, locale: { language: 'en-US', timezone: 'UTC' }, variant: null,
  },
];

/** Routes to crawl, per context. `/` behaves differently in each — that is the point. */
const PLAN = [
  { contextId: 'anon-desktop', path: '/', urlPattern: '/', requiresAuth: true },
  { contextId: 'anon-desktop', path: '/login', urlPattern: '/login', requiresAuth: false },
  { contextId: 'auth-desktop', path: '/', urlPattern: '/', requiresAuth: true },
];

const findings = [];
const finding = (severity, what) => findings.push({ severity, what });

/**
 * The crawl boundary, from one source (§6, decision 0012).
 *
 * Derived from the crawl scope rather than written at each call site, so the
 * manifest, the router and the post-click check cannot disagree about where the
 * boundary is.
 */
const ALLOWED_ORIGINS = deriveAllowedOrigins({ origin: ORIGIN });

/** Everything the chokepoint refused, for the manifest and the rung gate. */
const blockedNavigations = [];
const onBlocked = (event) => {
  blockedNavigations.push(event);
  console.log(`      ⤫ blocked ${event.kind} → ${event.origin ?? event.url ?? 'target recorded by the router'}`);
};
const guardContext = async (context) => {
  await installOriginGuard(context, {
    allowedOrigins: ALLOWED_ORIGINS, onBlocked, decide: decideNavigation,
  });
  return context;
};

/* --------------------------------------------------------------------- run */

assertPermitted(ORIGIN);
if (!USER || !PASS) {
  console.error('✗ SITEFORGE_USER / SITEFORGE_PASS are required (§3.3). The rung3 runner sets them.');
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'network'), { recursive: true });
mkdirSync(join(OUT, 'auth'), { recursive: true });

const browser = await chromium.launch();

/** Every API exchange seen, across every context. Feeds §5 endpoint inference. */
const observations = [];
/**
 * Response handlers are async, and reading `response.text()` resolves after the
 * click that caused it. Without tracking the in-flight promises, a probe reads
 * `observations` before they land and closes the page underneath them — which is
 * why every flow recorded zero network calls and only GET was ever seen.
 */
const pendingResponses = [];
/**
 * Bounded on purpose.
 *
 * A response handler awaits `response.text()` and `request.allHeaders()`, both
 * of which round-trip to the browser. When a context closes underneath one, the
 * promise can stay pending — and an unbounded `allSettled` then waits forever.
 * Dropping an observation is a loss the coverage invariants would report; a
 * hung crawl reports nothing at all, so the timeout is the safer failure.
 */
const settleResponses = async (ms = 4000) => {
  const pending = pendingResponses.splice(0);
  if (pending.length === 0) return;
  let timer;
  const expired = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), ms); });
  const outcome = await Promise.race([Promise.allSettled(pending).then(() => 'settled'), expired]);
  clearTimeout(timer);
  if (outcome === 'timeout') {
    finding('response-settle-timeout', `${pending.length} response read(s) did not settle in ${ms}ms`);
  }
};
const attachApiRecorder = (page, routeIdRef, { anonymousProbe = false } = {}) => {
  page.on('response', (response) => {
    pendingResponses.push((async () => {
      const request = response.request();
      const url = response.url();
      if (!isUnder(url, { origin: ORIGIN, pathPrefix: '/api' })) return;
      const contentType = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      let body;
      if (assetKind(contentType) === 'json') {
        // operational: a 204 has no body; a non-JSON body is not ours to parse
        try { body = JSON.parse(await response.text()); } catch { /* empty 204 */ }
      }
      let requestBody;
      const post = request.postData();
      // operational: a form-encoded request body is not JSON, which is normal
      if (post) { try { requestBody = JSON.parse(post); } catch { /* form-encoded */ } }
      // `request.headers()` omits cookies — it returns what the page set, not
      // what the network stack sent. Reading auth evidence from it meant
      // "every observation carried a credential" could never fire, silently.
      // `allHeaders()` includes them; only the NAMES are kept, here at the
      // source, so a header value has no path to an artifact at all (§3.3).
      const requestHeaderNames = Object.keys(await request.allHeaders());
      observations.push({
        method: request.method(), url, status: response.status(), contentType,
        body, requestBody, requestHeaderNames, routeId: routeIdRef.current,
        contextId: (routeIdRef.current ?? '').split('--')[1] ?? null,
        // Marks a request deliberately issued without a session. Only these can
        // settle an auth verdict: a 401 answering a signed-in request is the
        // endpoint's own failure mode, not a statement about needing auth.
        anonymousProbe,
      });
    })());
  });
};

/** §6: sign in by hand is the real path; a local fixture app is scripted. */
async function acquireStorageState() {
  const ctx = await guardContext(await browser.newContext({ viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC' }));
  const page = await ctx.newPage();
  installEscapeGuards(page, { onBlocked });
  await page.goto(`${ORIGIN}/login`, { waitUntil: 'networkidle' });
  await page.fill('#email', USER);
  await page.fill('#password', PASS);
  await Promise.all([page.waitForURL(`${ORIGIN}/`), page.click('button[type=submit]')]);
  const state = await ctx.storageState();
  await ctx.close();
  const path = join(OUT, 'auth', 'storage-state.json');
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
  chmodSync(path, 0o600); // §5
  return state;
}

const storageState = await acquireStorageState();
console.log(`  auth: signed in, storageState has ${storageState.cookies.length} cookie(s), chmod 600`);

const routes = new Map();
const allAssets = new Map();

for (const context of CONTEXTS) {
  const ctx = await guardContext(await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
    ...(context.auth.mode === 'storage-state' ? { storageState } : {}),
    recordHar: { path: join(OUT, 'network', `${context.contextId}.har`), content: 'omit' },
  }));
  await ctx.addInitScript(({ seed, epoch }) => {
    let state = seed >>> 0;
    Math.random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 0x100000000; };
    const RealDate = Date;
    Date = class extends RealDate {
      constructor(...a) { super(...(a.length ? a : [epoch])); }
      static now() { return epoch; }
    };
    performance.now = () => 0;
    let n = 0;
    if (globalThis.crypto) crypto.randomUUID = () => `00000000-0000-4000-8000-${(n += 1).toString(16).padStart(12, '0')}`;
  }, { seed: SEED, epoch: Date.parse('2026-01-01T00:00:00.000Z') });

  const page = await ctx.newPage();

  installEscapeGuards(page, { onBlocked });
  const routeIdRef = { current: null };
  attachApiRecorder(page, routeIdRef);
  page.on('response', async (response) => {
    const url = response.url();
    if (isUnder(url, { origin: ORIGIN, pathPrefix: '/api' })) return;
    try {
      const buf = await response.body();
      const mime = (response.headers()['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
      allAssets.set(url, {
        sha256: sha256(buf), bytes: buf.length, mime, status: response.status(),
        sameOrigin: sameOrigin(url, ORIGIN),
        // Kept, not dropped: §6 says persist every response body, and an index
        // naming a file nobody wrote is a claim the artifact cannot support.
        body: buf,
      });
    // operational: a redirect response has no retrievable body
    } catch { /* redirect */ }
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
  // operational: the domain may already be enabled on this session; the calls that need it fail loudly on their own if it is not.
  await cdp.send('DOMDebugger.enable').catch(() => {});

  for (const plan of PLAN.filter((p) => p.contextId === context.contextId)) {
    const routeId = S.deriveRouteId(plan.urlPattern, context.contextId, 0);
    routeIdRef.current = routeId;
    const routeDir = join(OUT, 'routes', routeId);

    const response = await page.goto(`${ORIGIN}${plan.path}`, { waitUntil: 'networkidle' });
    const redirectChain = [];
    for (let r = response?.request().redirectedFrom(); r; r = r.redirectedFrom()) {
      const to = r.redirectedTo()?.url();
      const status = (await r.response())?.status();
      if (to && status) redirectChain.unshift({ from: r.url(), to, status });
    }

    const captured = await captureRoute({
      page, cdp, routeId, url: page.url(), viewport: context.viewport, routeDir, envelope,
    });

    routes.set(routeId, {
      plan, context, captured, redirectChain,
      status: response?.status() ?? 0,
      finalUrl: page.url(),
    });
    console.log(
      `  ${routeId.padEnd(28)} ${plan.path} → ${page.url().replace(ORIGIN, '')}  ` +
      `nodes ${captured.built.length} · cssom ${captured.stateRules.length} · candidates ` +
      `${captured.built.filter((n) => n.interaction).length}`,
    );
  }

  // operational: detaching from a session whose page is closing; nothing is read from it afterwards.
  await cdp.detach().catch(() => {});
  await ctx.close();
}

/* ------------------------------------------ §6 behavior probing → flows/ */

/** §6: skip destructive actions by heuristic unless --allow-destructive. */
/**
 * Fire one control and record what happened.
 *
 * Extracted so the session-destructive pass can reuse it verbatim against a
 * disposable context. Two callers, one probe: a second copy would drift, and the
 * whole point of firing logout is that it is an *ordinary* observation.
 */
async function runProbe({ ctx, routeId, record, candidate, flowId, label, cssomClasses, destructive = false }) {
  let ran = false;
  // §6: each probe runs in a fresh page context, so probes cannot contaminate
  // each other's preconditions.
  const page = await ctx.newPage();
  installEscapeGuards(page, { onBlocked });
  attachApiRecorder(page, { current: routeId });
  try {
    await page.goto(`${ORIGIN}${record.plan.path}`, { waitUntil: 'networkidle', timeout: 10_000 });
    const locator = page.getByRole(candidate.a11y.role, { name: candidate.a11y.name, exact: true }).first();
    if (!(await locator.count())) { await page.close(); return false; }

    const snap = async () => page.evaluate(() => ({
      url: location.href,
      html: document.documentElement.outerHTML,
      classes: [...document.querySelectorAll('*')].map((e) => e.className).join('|'),
      attrs: [...document.querySelectorAll('*')]
        .map((e) => [...e.attributes].map((a) => `${a.name}=${a.value}`).join(',')).join('|'),
      // Per-element inline style, as an array so it can be diffed positionally.
      // A JS-driven state need not touch a class at all — the crud app's details
      // panel sets `style.display` and nothing else — and a detector that only
      // reads class diffs finds nothing there while reporting success.
      inlineStyles: [...document.querySelectorAll('*')].map((e) => e.getAttribute('style') ?? ''),
      focused: document.activeElement?.getAttribute('aria-label') ?? null,
    }));

    await settleResponses();
    const before = await snap();
    const netBefore = observations.length;
    await locator.click({ timeout: 2000 });
    // §6: "Wait for network idle or 2s." networkidle alone is not enough --
    // when the page is already idle it resolves before the click's fetch has
    // even been issued, and the page then closes underneath the request.
    await page.waitForTimeout(400);
    // operational: a settle timeout is the expected outcome on a page holding a connection open, and the snapshot after it is taken either way.
    await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
    await settleResponses();
    const after = await snap();

    // Second layer. The chokepoint is what *prevents* an off-origin navigation;
    // this only reports that the chokepoint has a hole. If it ever fires, the
    // interceptor missed something and that is a defect, not a classification.
    // operational: a page on about:blank has no origin to compare
    const afterOrigin = (() => { try { return new URL(after.url).origin; } catch { return null; } })();
    if (afterOrigin && !ALLOWED_ORIGINS.has(afterOrigin)) {
      finding('origin-guard-hole', `${label} reached ${afterOrigin} — the interceptor did not stop it`);
    }

    const networkCalls = observations.slice(netBefore);

    const changed = before.html !== after.html;
    const preHash = S.shortHash(before.html);
    const postHash = S.shortHash(after.html);
    const snapshot = (s, h) => ({
      url: s.url, routeId, domHash: h, a11yHash: S.shortHash(s.attrs), focusedRef: null,
    });

    ran = true;
    flows.set(flowId, {
      ...envelope('flow-trace'),
      flowId, siteId: SITE_ID, kind: 'probe',
      name: `Click ${label}`,
      startRouteId: routeId,
      discoveredBy: candidate.interaction.discoveredBy[0],
      initialA11yTree: buildA11yTree(record.captured),
      steps: [{
        index: 0,
        action: { type: 'click' },
        target: {
          role: candidate.a11y.role, name: candidate.a11y.name, entityRef: null,
          diagnostic: {
            nodeId: candidate.nodeId,
            selector: candidate.interaction.selector,
            boundingBox: candidate.boundingBox,
          },
        },
        pre: snapshot(before, preHash),
        post: snapshot(after, postHash),
        domDelta: { addedNodeIds: [], removedNodeIds: [], attributeChanges: [], textChanges: [], styleChanges: [] },
        a11yDelta: { added: [], removed: [], changed: [] },
        networkCalls: networkCalls.map((o) => ({
          endpointId: null, method: o.method, url: scrub(o.url),
          pathPattern: new URL(o.url).pathname, status: o.status,
          isMutation: !['GET', 'HEAD', 'OPTIONS'].includes(o.method),
        })),
        urlChanged: before.url !== after.url,
        waitStrategy: 'network-idle',
      }],
      outcome: 'completed', destructive, gapIds: [],
    });

    // A change no extracted CSSOM rule mentions is JS-driven, which is exactly
    // the case §6 reserves probing for. Two shapes, and the second one used to
    // be invisible: a class the stylesheet does not describe, or an inline
    // style with no class involved at all.
    if (changed) {
      // Both of these were substring tests against token sets. `before.classes`
      // is every class on the page joined together, so `.includes('open')` was
      // satisfied by an existing `is-open` and the new class looked old; and
      // `cssomText` is every selector joined together, so `.includes('open')`
      // was satisfied by `.is-open` and the new class looked explained. Both
      // errors point the same way: fewer states observed than really changed.
      const beforeClasses = new Set(before.classes.split('|').join(' ').split(/\s+/).filter(Boolean));
      const newClasses = before.classes === after.classes ? [] :
        [...new Set(after.classes.split('|').join(' ').split(/\s+/).filter(Boolean))]
          .filter((c) => !beforeClasses.has(c));
      const unexplainedClasses = newClasses.filter((c) => !cssomClasses.has(c));

      const attributeChanges = [];
      const width = Math.min(before.inlineStyles.length, after.inlineStyles.length);
      for (let i = 0; i < width; i += 1) {
        if (before.inlineStyles[i] === after.inlineStyles[i]) continue;
        attributeChanges.push({
          attribute: 'style',
          from: before.inlineStyles[i] || null,
          to: after.inlineStyles[i] || null,
        });
      }

      if (unexplainedClasses.length || attributeChanges.length) {
        const list = probedStates.get(routeId) ?? [];
        list.push({
          source: 'probed', nodeId: candidate.nodeId, trigger: 'click',
          reason: 'absent-from-cssom',
          styleChanges: [], attributeChanges: attributeChanges.slice(0, 10),
          classChanges: { added: [...new Set(unexplainedClasses)], removed: [] },
          subtreeChanged: true,
        });
        probedStates.set(routeId, list);
      }
    }
  } catch (err) {
    // The taxonomy, at the site that taught us we needed one. A candidate that
    // cannot be driven is ordinary: a timeout, a detached element, a page that
    // navigated away. A ReferenceError is not, and this catch used to swallow
    // one — thrown *after* the flow was recorded, so every probe reported
    // success while the state detection behind it silently never ran.
    rethrowIfDefect(err);
    finding('probe-not-driveable', `${label}: ${operationalKind(err) ?? 'unknown'}`);
  }
  await settleResponses();
  await page.close();
  return ran;
}

/**
 * §6's heuristic, split by **who absorbs the harm** (decision 0011).
 *
 * The old single list put "Sign out" and "Delete account" in the same bucket,
 * which was wrong in both directions at once: it left `POST /api/auth/logout`
 * uncaptured while §10's auth tasks depend on it, and it would have filed a core
 * auth flow in GAPS.md as unreliable.
 */
/** Controls the operator declines to fire even with --allow-destructive. */
const NEVER_FIRE = NEVER_FIRE_NAMES;

/**
 * Classify a candidate.
 *
 * The lists and the ordering moved to `@siteforge/shared` when `capture-site`
 * needed them: two crawlers disagreeing about whether the same button is safe
 * to press is §13's schema drift with a hazard attached. The origin comparison
 * stays the caller's parsed `sameOrigin`, so nothing here reinvents it.
 */
const classifyControl = (candidate) =>
  classifyControlHazard({
    name: candidate.a11y.name,
    href: candidate.interaction?.href ?? candidate.attributes?.href ?? '',
    isSameOrigin: (href) => sameOrigin(href, ORIGIN),
  });

/**
 * Controls §6 discovered and refused to fire (decision 0010).
 *
 * Capture stops at the control. It never learns the URL, because learning it
 * would mean clicking — which is the thing §6 declines to do. Binding these to
 * endpoints is §7's job, by reading `<form action>` and `fetch()` out of the
 * captured source, and that is why no endpoint entry is created here.
 */
const skippedControls = [];

/** §6's flag. We own both rung targets, so delete flows can yield real observations. */
const ALLOW_DESTRUCTIVE = process.argv.includes('--allow-destructive');

/**
 * Session-destructive controls, deferred to a pass of their own.
 *
 * They must be fired — logout is an ordinary endpoint §8 has to implement and
 * §10's auth tasks depend on — but firing one from the crawl's own context ends
 * the crawl. See the pass below for why a *fresh* session, not a cloned one.
 */
const sessionDestructive = [];
let sessionDestructiveFired = 0;


/**
 * Target-destructive controls the operator allowed, deferred for the same
 * reason: they mutate shared state, so anything probed after them is probed
 * against a store they emptied.
 */
const deferredDestructive = [];
const gapId = (label) => `gap_${S.shortHash(label).slice(0, 12)}`;
const gaps = [];
const flows = new Map();
const probedStates = new Map(); // routeId -> entries

const authRoute = [...routes.entries()].find(([id]) => id.startsWith('root--auth-desktop'));

if (authRoute) {
  const [routeId, record] = authRoute;
  // Four "Bump" buttons are one behaviour probed four times. §6's probing budget
  // is better spent on distinct (role, name) pairs -- and without this, the cap
  // is exhausted on repeats before reaching the controls that reveal anything.
  const seen = new Set();
  const candidates = record.captured.built.filter((n) => {
    if (n.nodeType !== 'element' || !n.interaction || !n.a11y) return false;
    const key = `${n.a11y.role}\u0000${n.a11y.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Which classes/attributes any extracted CSSOM rule already explains. §6 uses
  // probing only for the changes CSS cannot express, so this decides what needs one.
  const cssomClasses = selectorClassNames(record.captured.stateRules.map((r) => r.selector));

  const probeCtx = await guardContext(await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', storageState,
  }));
  const probeIdRef = { current: routeId };
  let probed = 0;
  const MAX_PROBES = 16;

  for (const candidate of candidates) {
    if (probed >= MAX_PROBES) break;
    const label = `${candidate.a11y.role} "${candidate.a11y.name}"`;
    const { hazard, matchedTerm, outOfScopeTarget } = classifyControl(candidate);
    const flowId = `probe-${S.shortHash(label).slice(0, 10)}`;

    // Session-destructive: fire it, but not from this context — logout deletes
    // the server-side session, and cloning storageState clones the *cookie*,
    // not the session. Deferred to a pass that gets its own login (0011 §2).
    if (hazard === 'session-destructive') {
      sessionDestructive.push({ routeId, record, candidate, flowId, label, cssomClasses, matchedTerm, destructive: true });
      continue;
    }

    const declined = hazard === 'target-destructive'
      && (!ALLOW_DESTRUCTIVE || NEVER_FIRE.includes(candidate.a11y.name.toLowerCase()));

    // Allowed and destructive: fire it, but last. A fresh *page* context does
    // not undo a mutation — "Delete all todos" empties the store for every
    // probe that follows, and §6's "probes cannot contaminate each other's
    // preconditions" is about the browser, not the server. Firing it inline
    // took statesProbed from 1 to 0 the first time this ran.
    if (hazard === 'target-destructive' && !declined) {
      deferredDestructive.push({ routeId, record, candidate, flowId, label, cssomClasses, destructive: true });
      continue;
    }

    if (declined || hazard === 'out-of-scope') {
      const cause = hazard === 'out-of-scope' ? 'out-of-scope' : 'target-destructive';
      const id = gapId(`${cause}:${label}`);
      gaps.push({
        gapId: id, stage: 'capture',
        category: cause === 'out-of-scope' ? 'out-of-scope-control' : 'destructive-action-skipped',
        severity: cause === 'out-of-scope' ? 'info' : 'degraded',
        subject: { routeId, nodeId: candidate.nodeId, flowId },
        summary: cause === 'out-of-scope'
          ? `${label} leaves the site (${outOfScopeTarget}); not exercised.`
          : `${label} was not fired (target-destructive, matched "${matchedTerm}").`,
        detail: cause === 'out-of-scope'
          ? `The control targets ${outOfScopeTarget}, which is not ours to exercise. §6 crawls same-origin only; the clone renders the control and it goes nowhere. No endpoint is created either way.`
          : `Irreversible against the target, so §6 never activates it${ALLOW_DESTRUCTIVE ? ' — and it stays declined even under --allow-destructive, by explicit designation' : ' without --allow-destructive'}. Discovered via ${candidate.interaction.discoveredBy.join(' + ')}; its transition is unknown. Recorded as a skipped control so §7.6 can bind it to a URL from the source.`,
        stub: cause === 'out-of-scope'
          ? { kind: 'none' }
          : { kind: 'omitted', detail: 'Control renders and is focusable; infer binds it and codegen implements it against the mock store.' },
      });
      flows.set(flowId, {
        ...envelope('flow-trace'),
        flowId, siteId: SITE_ID, kind: 'probe',
        name: `${candidate.a11y.name} (not run)`,
        description: cause === 'out-of-scope'
          ? 'Discovered as an interaction candidate; targets another origin.'
          : 'Discovered as an interaction candidate and declined as target-destructive.',
        startRouteId: routeId,
        discoveredBy: candidate.interaction.discoveredBy[0],
        initialA11yTree: buildA11yTree(record.captured),
        steps: [], outcome: 'skipped', destructive: cause === 'target-destructive',
        skipReason: {
          cause: cause === 'out-of-scope' ? 'precondition-unmet' : 'destructive-heuristic',
          ...(cause === 'target-destructive' ? { matchedTerm } : {}),
          gapId: id,
        },
        gapIds: [id],
      });
      // The structured half (decision 0010). A skipped flow is forced to
      // `steps: []`, and role/name/nodeId live on `FlowStep.target` — so without
      // this the control survives only as prose, and infer cannot bind it to a
      // URL by looking for its handler in the captured source.
      skippedControls.push({
        controlId: `ctl_${sha256(`${routeId}:${candidate.nodeId}`).slice(0, 12)}`,
        routeId, nodeId: candidate.nodeId,
        role: candidate.a11y.role, name: candidate.a11y.name,
        cause,
        ...(cause === 'target-destructive' ? { matchedTerm } : { outOfScopeTarget }),
        gapId: id, flowId,
        // Declined, never driven: no element state to have observed.
        diagnostic: null,
      });
      continue;
    }

    if (await runProbe({ ctx: probeCtx, routeId, record, candidate, flowId, label, cssomClasses })) probed += 1;
  }
  await probeCtx.close();
  const skipped = [...flows.values()].filter((f) => f.outcome === 'skipped').length;
  console.log(`  probes: ${probed} run, ${skipped} skipped as destructive, ${candidates.length} distinct candidates`);
}

function buildA11yTree(captured) {
  // Flat tree: the probe only needs a valid root plus the addressable elements.
  const children = captured.built
    .filter((n) => n.nodeType === 'element' && n.a11y)
    .map((n) => ({ ref: n.a11y.ref, role: n.a11y.role, name: n.a11y.name, nodeId: n.nodeId, children: [] }));
  return {
    ref: S.deriveDocumentA11yRef(captured.extracted.url),
    role: 'RootWebArea', name: captured.extracted.title, children,
  };
}

/* ------------------------------------------------- assemble and validate */

await settleResponses();

/**
 * Session-destructive controls: fired, each on a session of its own.
 *
 * The harm these do is to us, not to the target — logging out is not vandalism,
 * and `POST /api/auth/logout` is an ordinary endpoint §8 must implement for real
 * while §10's auth tasks depend on it working. Skipping them left a core auth
 * flow uncaptured and would have filed it in GAPS.md as unreliable.
 *
 * **A disposable *context* is not enough.** `storageState` carries the cookie;
 * the session lives in a map on the server, and logout deletes it. Cloning the
 * crawl's storage state into a throwaway context and clicking "Sign out" ends
 * the crawl's session too — the browser context is disposable, the session is
 * shared. So each probe gets its own login, and only that session dies.
 *
 * Where a target offers no non-interactive re-auth (§6's headful `--auth` path),
 * this pass has to run last instead, and the crawl ends with a dead session.
 * Here it is scripted, so it does not.
 */
/**
 * Allowed destructive probes, last of all.
 *
 * Order is the whole point: these mutate the store, so every probe that runs
 * after one is measuring a different application. They come after the ordinary
 * probes for exactly the reason the session pass comes after everything.
 */
if (deferredDestructive.length) {
  const ctx = await guardContext(await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', storageState,
  }));
  let fired = 0;
  for (const item of deferredDestructive) {
    if (await runProbe({ ctx, ...item })) fired += 1;
  }
  await ctx.close();
  await settleResponses();
  console.log(`  destructive: fired ${fired} of ${deferredDestructive.length} allowed control(s), after all other probing`);
}

if (sessionDestructive.length) {
  for (const item of sessionDestructive) {
    const ownState = await acquireStorageState();
    const ctx = await guardContext(await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
      storageState: ownState,
    }));
    const ran = await runProbe({ ctx, ...item });
    await ctx.close();
    if (ran) sessionDestructiveFired += 1;
    if (!ran) {
      // It could not be driven. That is `precondition-unmet` — an honest and
      // different claim from "we declined to fire it", which is why the schema
      // has no `session-destructive` skip cause to reach for here.
      const id = gapId(`session-probe-failed:${item.label}`);
      gaps.push({
        gapId: id, stage: 'capture', category: 'destructive-action-skipped', severity: 'degraded',
        subject: { routeId: item.routeId, nodeId: item.candidate.nodeId },
        summary: `${item.label} is session-destructive but could not be driven.`,
        detail: 'Fired on a session of its own so the crawl would survive it, and the click did not resolve. Recorded as precondition-unmet rather than as a decision to skip: nothing here was declined.',
        stub: { kind: 'omitted', detail: 'Control renders; its effect is not reproduced.' },
      });
      skippedControls.push({
        controlId: `ctl_${sha256(`${item.routeId}:${item.candidate.nodeId}`).slice(0, 12)}`,
        routeId: item.routeId, nodeId: item.candidate.nodeId,
        role: item.candidate.a11y.role, name: item.candidate.a11y.name,
        cause: 'precondition-unmet', gapId: id, flowId: null,
        /**
         * Driven and unresolved, and this fixture does not instrument the
         * failure the way the site driver does.
         *
         * All `null` rather than a plausible-looking set of booleans: the
         * checks were not made, and "we did not look" must not read as "the
         * element was not visible" in a distribution. Rung 3's controls all
         * resolve today, so this path is the fixture reporting a defect in
         * itself — §13's rule that a fixture must be able to inflict the hazard
         * it tests, in the direction of the fixture failing to.
         */
        diagnostic: {
          step: 'session-probe/did-not-resolve',
          selector: item.candidate.interaction.selector,
          attemptIndex: 0,
          visible: null, stable: null, receivesPointerEvents: null, enabled: null,
          inViewport: null, navigationPending: null, occludedBy: null,
          scrollIntoView: null, inViewportAfterScroll: null, occludedByAfterScroll: null,
        },
      });
    }
  }
  await settleResponses();
  console.log(`  session-destructive: fired ${sessionDestructiveFired} of ${sessionDestructive.length}, each on its own session`);
}

/**
 * §6 records "which routes require which" auth. That is only inferable for an
 * endpoint the *anonymous* crawl actually touched — and it never does, because
 * the anonymous session is redirected to /login before any XHR runs. So each
 * distinct GET endpoint observed while signed in is re-issued once anonymously,
 * purely to record what an unauthenticated caller gets.
 *
 * Deliberately GET-only: re-issuing a mutation to learn its auth behaviour would
 * change the target's state, which capture must not do.
 */
const anonCtx = await guardContext(await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'UTC' }));
const anonPage = await anonCtx.newPage();
installEscapeGuards(anonPage, { onBlocked });
const anonRouteRef = { current: [...routes.keys()].find((k) => k.includes('anon-desktop')) };
attachApiRecorder(anonPage, anonRouteRef, { anonymousProbe: true });
await anonPage.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
const getUrls = [...new Set(observations.filter((o) => o.method === 'GET').map((o) => o.url))];
/*
 * A probe that failed is not a probe that found nothing.
 *
 * This swallowed the rejection, and the consequence ran a long way: no response
 * recorded means no `anonymous-success` and no 401 either, so the endpoint
 * stays `unknown` — and §8 resolves `unknown` to *not-required* for reads. A
 * transient failure here would therefore publish a gated read in the clone,
 * making every §10 auth task through it trivially bypassable. The failure has
 * to be louder than the absence it would otherwise be mistaken for.
 */
const anonProbeFailures = [];
for (const url of getUrls) {
  const outcome = await anonPage.evaluate(async (u) => {
    try {
      const response = await fetch(u, { headers: { accept: 'application/json' } });
      return { ok: true, status: response.status };
    } catch (err) {
      // operational: a network-level rejection in the page. Returned as a
      // value rather than swallowed, so the caller can tell it apart from a
      // probe that ran and learned the endpoint is public.
      return { ok: false, error: String(err) };
    }
  }, url);
  if (!outcome.ok) anonProbeFailures.push({ url, error: outcome.error });
  await anonPage.waitForTimeout(80);
}
await settleResponses();
await anonCtx.close();
console.log(`  auth probe: re-issued ${getUrls.length} GET endpoint(s) anonymously`);
for (const failure of anonProbeFailures) {
  finding('auth-probe-failed',
    `the anonymous re-issue of ${failure.url} did not complete (${failure.error}); its auth requirement stays 'unknown', which §8 resolves to not-required for a read`);
}

await browser.close();

// §3.4: Playwright writes the HAR itself, with live Cookie values in it. Scrub
// before anything else touches the directory.
{
  let redacted = 0;
  for (const context of CONTEXTS) {
    const harPath = join(OUT, 'network', `${context.contextId}.har`);
    if (!existsSync(harPath)) continue;
    redacted += scrubHarFile({ readFileSync, writeFileSync }, harPath).redactedHeaders;
  }
  console.log(`  har: redacted ${redacted} credential header(s) (§3.4)`);
}

/**
 * Field domains the UI constrains — the primary evidence for an enum, and the
 * only kind that is ground truth. Read out of the DOM we already captured:
 * `<select name=x>` and radio groups say what values the API can receive,
 * whatever the sampling happened to show.
 */
const uiConstraints = new Map();
for (const [routeId, record] of routes) {
  for (const node of record.captured.selectControls ?? []) {
    if (!node.name || node.optionValues.length === 0) continue;
    uiConstraints.set(node.name.toLowerCase(), {
      control: node.control, routeId, nodeId: node.nodeId, optionValues: node.optionValues,
    });
  }
}

/** Every narrowing lands in GAPS.md as review-required (§7). */
const narrowingGaps = [];
const mintGap = ({ field, basis, values }) => {
  const id = gapId(`narrowing:${field}:${basis}`);
  if (!narrowingGaps.some((g) => g.gapId === id)) {
    narrowingGaps.push({
      gapId: id, stage: 'capture', category: 'inferred-type-narrowed', severity: 'info',
      subject: { url: `${ORIGIN}/api` },
      summary: `\`${field}\` narrowed to an enum of ${values.length} on ${basis} evidence.`,
      detail: `The field \`${field}\` is typed as a closed set rather than a string, on ${basis} evidence: ${JSON.stringify(values)}. §5 makes this schema the mock backend's data model, so if the narrowing is wrong the clone will reject values the real API accepts, silently, on every trajectory that touches the field. Recorded as review-required because narrowing must be justified and widening is free.`,
      stub: { kind: 'none' },
    });
  }
  return id;
};

const endpoints = inferEndpoints(observations, {
  scrub: scrubDeep, sha256, uiConstraints, mintGap, anonContextId: 'anon-desktop',
});
console.log(`  endpoints: ${endpoints.length} inferred from ${observations.length} API exchanges`);

const written = [];
let failed = 0;
function write(relPath, schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    failed += 1;
    console.log(`  ✗ ${relPath}`);
    for (const issue of parsed.error.issues.slice(0, 6)) {
      const where = issue.path.join('.').slice(0, 110);
      console.log(`      ${where || '(root)'}: ${issue.message}`);
      finding('schema-rejects-reality', `${relPath} · ${where}: ${issue.message}`);
    }
    return null;
  }
  const abs = join(OUT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, `${JSON.stringify(value, null, 2)}\n`);
  written.push(relPath);
  return value;
}

/**
 * What the anonymous crawl actually got for each URL pattern.
 *
 * This is the only thing that settles a route's auth verdict. The authenticated
 * capture of `/` cannot tell you whether `/` needs a session; only the anonymous
 * attempt at `/` can, which is why the verdict is keyed by pattern rather than
 * by route.
 */
const anonymousOutcomes = new Map();
for (const [, record] of routes) {
  if (record.context.auth.mode !== 'anonymous') continue;
  // Segment comparison: `/login` must not be satisfied by `/not-login` or by a
  // query string that happens to contain the word.
  const onLogin = (u) => pathSegments(new URL(u, ORIGIN).pathname)[0] === 'login';
  const redirectedToLogin = onLogin(record.finalUrl) && !onLogin(record.plan.path);
  anonymousOutcomes.set(record.plan.urlPattern, {
    redirectedToLogin,
    ok: !redirectedToLogin && record.status >= 200 && record.status < 300,
    status: record.redirectChain[0]?.status ?? record.status,
  });
}

const routeArtifacts = new Map();
for (const [routeId, record] of routes) {
  const { captured, context, plan } = record;
  const extraStates = probedStates.get(routeId) ?? [];
  const entries = [...captured.stateEntries, ...extraStates];
  const states = {
    ...envelope('state-deltas'),
    routeId, entries,
    stats: {
      cssomRules: entries.filter((e) => e.source === 'cssom').length,
      probedNodes: entries.filter((e) => e.source === 'probed').length,
      scrollSteps: entries.filter((e) => e.source === 'scroll').length,
    },
  };
  const contentHash = S.deriveRouteContentHash({ dom: captured.dom, styles: captured.styles, states });
  /**
   * The auth verdict, derived from what the anonymous crawl actually saw rather
   * than declared in the plan. `unknown` is a legitimate outcome: a pattern the
   * anonymous context never reached has settled nothing, and recording `false`
   * there is the bug rung 3 found (decision 0010).
   */
  const anonSeen = anonymousOutcomes.get(plan.urlPattern);
  const authEvidence = [];
  let behaviour = { kind: 'unknown' };
  if (anonSeen?.redirectedToLogin) {
    authEvidence.push({
      kind: 'anonymous-redirect-to-login', to: '/login',
      status: anonSeen.status || 302, contextId: 'anon-desktop',
    });
    behaviour = { kind: 'redirect', to: '/login', status: 302 };
  } else if (anonSeen?.ok) {
    authEvidence.push({
      kind: 'anonymous-success', status: 200, observedCount: 1, contextId: 'anon-desktop',
    });
    behaviour = { kind: 'accessible' };
  }

  const meta = {
    ...envelope('route-meta'),
    routeId, siteId: SITE_ID,
    urlPattern: plan.urlPattern, contextId: context.contextId, instanceIndex: 0,
    url: record.finalUrl, pathParams: {}, canonicalUrl: record.finalUrl,
    title: scrub(captured.extracted.title), status: record.status,
    redirectChain: record.redirectChain,
    templateGuess: { name: 'unknown', confidence: 0.2, rationale: 'Rung-3 crawl; too few routes to group.' },
    requiresAuth: S.resolveAuthRequirement(authEvidence),
    authEvidence,
    unauthenticatedBehavior: behaviour,
    depth: 0, discoveredFrom: { kind: 'entry' }, embeddedIn: [],
    content: {
      kind: 'captured', contentHash,
      renderedSize: { width: context.viewport.width, height: context.viewport.height },
      screenshots: captured.screenshots,
      pageMetrics: captured.pageMetrics,
    },
    gapIds: [],
  };
  routeArtifacts.set(routeId, { meta, dom: captured.dom, styles: captured.styles, states });
  write(`routes/${routeId}/meta.json`, S.RouteMetaSchema, meta);
  write(`routes/${routeId}/dom.json`, S.DomDocumentSchema, captured.dom);
  write(`routes/${routeId}/styles.json`, S.StyleSheetDocumentSchema, captured.styles);
  write(`routes/${routeId}/states.json`, S.StateDeltasDocumentSchema, states);
}

// The same writer the site driver uses. Two crawlers must not be able to
// disagree about whether an asset is text the scrubber may rewrite (§13).
const { entries: assetEntries } = writeAssetBodies({
  allAssets,
  outDir: OUT,
  fs: { mkdirSync, writeFileSync },
  isTextualAsset,
  assetKind,
});
const assetIndex = {
  ...envelope('asset-index'),
  byUrl: assetEntries,
  stats: {
    assetCount: Object.keys(assetEntries).length,
    distinctFiles: new Set(Object.values(assetEntries).map((a) => a.sha256)).size,
    totalBytes: Object.values(assetEntries).reduce((n, a) => n + a.bytes, 0),
  },
};
write('assets/index.json', S.AssetIndexSchema, assetIndex);

const endpointIndex = write('network/endpoints.json', S.EndpointIndexSchema, {
  ...envelope('endpoint-index', { 'network/anon-desktop.har': sha256(RUN_ID) }),
  endpoints,
  har: { path: 'network/session.har', entryCount: observations.length },
  thirdPartyOrigins: [],
});

for (const [flowId, flow] of flows) write(`flows/${flowId}.trace.json`, S.FlowTraceSchema, flow);

const totalStates = [...routeArtifacts.values()].flatMap((r) => r.states.entries);
const observed = {
  stylesheets: 1,
  cssPseudoClassRules: [...routes.values()]
    .reduce((n, r) => n + r.captured.cssom.rawPseudoRules, 0),
  cssAttributeStateRules: [...routes.values()]
    .reduce((n, r) => n + r.captured.cssom.rawAttrStateRules, 0),
  cssFontFaceRules: [...routes.values()].reduce((n, r) => n + r.captured.cssom.fonts.length, 0),
  harXhrEntries: observations.length,
  harDistinctMethods: new Set(observations.map((o) => o.method)).size,
  documentHeightRatio: Math.max(
    ...[...routes.values()].map((r) => r.captured.pageMetrics.scrollHeight / VIEWPORT.height)),
  axInteractiveRoles: [...routes.values()].reduce((n, r) => n + r.captured.interactiveAx, 0),
  subresourceRequests: Object.keys(assetEntries).length,
  // Counted from raw header names on the wire, sharing no code with the endpoint
  // inferencer — a bug in one must not move both sides (decision 0008).
  sessionProbePolicy: 'credentialed',
  // Counted at discovery, before any of them ran — the observed side of the
  // invariant must not be derived from what the firing pass produced.
  sessionDestructiveControls: sessionDestructive.length,
  harCredentialedRequests: observations.filter((o) =>
    (o.requestHeaderNames ?? []).some((h) => ['cookie', 'authorization'].includes(h.toLowerCase()))).length,
};
const extracted = {
  styleTableEntries: [...routeArtifacts.values()].reduce((n, r) => n + r.styles.table.length, 0),
  statesCssomPseudo: totalStates.filter((e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith(':'))).length,
  statesCssomAttribute: totalStates.filter((e) => e.source === 'cssom' && e.stateSelectors.some((x) => x.startsWith('['))).length,
  statesProbed: totalStates.filter((e) => e.source === 'probed').length,
  statesScroll: totalStates.filter((e) => e.source === 'scroll').length,
  fonts: [...routeArtifacts.values()].reduce((n, r) => n + r.styles.fonts.length, 0),
  endpoints: endpoints.length,
  endpointDistinctMethods: new Set(endpoints.map((e) => e.method)).size,
  scrollSteps: [...routes.values()].reduce((n, r) => n + r.captured.pageMetrics.scrollSteps, 0),
  interactionCandidates: [...routes.values()]
    .reduce((n, r) => n + r.captured.built.filter((x) => x.interaction).length, 0),
  assets: Object.keys(assetEntries).length,
  endpointsWithAuthEvidence: endpoints.filter((e) => e.authEvidence.length > 0).length,
  // The behaviour ceiling. This fixture drives everything it discovers, which
  // is what makes the number worth recording here too: a rung whose controls
  // stop resolving is a fixture that has stopped being able to inflict the
  // hazards it tests (§13), and that is invisible without a count.
  controlsFired: [...flows.values()].filter((f) => f.outcome === 'completed').length,
  controlsUndriveable: skippedControls.filter((c) => c.cause === 'precondition-unmet').length,
  sessionDestructiveFired: sessionDestructiveFired,
  a11yNodes: [...routes.values()]
    .reduce((n, r) => n + r.captured.built.filter((x) => x.a11y).length, 0),
};
const invariants = S.evaluateCoverage(observed, extracted);
const broken = invariants.filter((i) => !i.vacuous && !i.holds);

const coverage = {
  ...envelope('coverage-report'),
  siteId: SITE_ID, routeIds: [...routes.keys()], observed, extracted, invariants,
};
write('coverage.json', S.CoverageReportSchema, coverage);

/*
 * Every gap must be in the list before the manifest counts them.
 *
 * `narrowingGaps` used to be appended *after* this write, so
 * `manifest.counts.gaps` said 3 while `stage-report.json` carried 4 — two
 * artifacts of one run disagreeing about a quantity both report. Adding the
 * boundary gaps at the same seam would have widened the gap rather than
 * revealed it; a test now asserts the two agree.
 */
gaps.push(...narrowingGaps);
gaps.push(...boundaryGaps(blockedNavigations, { gapId, fallbackUrl: `${ORIGIN}/` }));

const manifest = write('manifest.json', S.CaptureManifestSchema, {
  ...envelope('capture-manifest'),
  siteId: SITE_ID,
  target: { entryUrl: `${ORIGIN}/`, origin: ORIGIN },
  permission: { source: 'allowlist', matchedEntry: '127.0.0.1' },
  contexts: CONTEXTS,
  userAgent: UA,
  determinism: {
    seed: SEED, frozenEpochMs: Date.parse('2026-01-01T00:00:00.000Z'),
    frozenTimezone: 'UTC', frozenLocale: 'en-US',
    frozen: ['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID'],
    prefersReducedMotion: 'reduce',
  },
  crawl: {
    budget: { maxInstancesPerPattern: 3, maxRoutesPerContext: 40, maxRoutesTotal: 100, maxDepth: 3 },
    sameOriginOnly: true,
    allowedOrigins: [...ALLOWED_ORIGINS],
    // Scripted login, credentials from the environment (§3.3), so a replacement
    // session can be had without a human — session-destructive probes run freely.
    sessionProbePolicy: 'credentialed',
    allowDestructive: ALLOW_DESTRUCTIVE,
    destructiveTerms: [...TARGET_DESTRUCTIVE_TERMS, ...SESSION_DESTRUCTIVE_TERMS],
  },
  toolVersions: { siteforge: '0.1.0-rung3', playwright: '1.63.0', browser: 'chromium-headless-shell' },
  patterns: [...new Set([...routes.values()].map((r) => r.plan.urlPattern))].map((urlPattern) => ({
    urlPattern, observedUrlCount: 1,
    routeIds: [...routes.entries()].filter(([, r]) => r.plan.urlPattern === urlPattern).map(([id]) => id),
  })),
  routeIds: [...routes.keys()], flowIds: [...flows.keys()],
  contentHash: sha256([...routeArtifacts.values()].map((r) => r.meta.content.contentHash).sort().join('\n')),
  counts: {
    contexts: CONTEXTS.length, routes: routes.size, capturedRoutes: routes.size,
    patterns: new Set([...routes.values()].map((r) => r.plan.urlPattern)).size,
    assets: Object.keys(assetEntries).length, endpoints: endpoints.length,
    flows: flows.size, gaps: gaps.length,
  },
});

const skippedControlIndex = write('flows/skipped-controls.json', S.SkippedControlIndexSchema, {
  ...envelope('skipped-control-index'),
  siteId: SITE_ID,
  controls: skippedControls,
});

const report = write('stage-report.json', S.StageReportSchema, {
  ...envelope('stage-report'),
  stage: 'capture', siteId: SITE_ID,
  status: broken.length ? 'failed' : gaps.length ? 'ok-with-gaps' : 'ok',
  inputs: [], outputs: written.map((p) => ({ path: p, sha256: sha256(p), bytes: 0 })),
  warnings: [], gaps,
});

/*
 * Two artifacts of one run must not disagree about a quantity both report.
 * They did: `narrowingGaps` was appended after the manifest was built, so
 * manifest.counts.gaps said 3 while stage-report.json carried 4. Nothing
 * failed, because nothing compared them.
 */
if (manifest.counts.gaps !== report.gaps.length) {
  finding('artifact-disagreement',
    `manifest.counts.gaps is ${manifest.counts.gaps} but stage-report.json has ${report.gaps.length}; a gap was added after the manifest was built`);
}

const model = S.CaptureModelSchema.safeParse({
  modelVersion: S.CAPTURE_MODEL_VERSION, siteId: SITE_ID,
  manifest, routes: Object.fromEntries(routeArtifacts), assets: assetIndex,
  endpoints: endpointIndex, flows: Object.fromEntries(flows),
  skippedControls: skippedControlIndex,
  stageReport: report, coverage,
});

console.log(model.success ? '  ✓ CaptureModel assembles' : '  ✗ CaptureModel');
if (!model.success) {
  failed += 1;
  for (const issue of model.error.issues.slice(0, 10)) {
    const where = issue.path.join('.').slice(0, 110);
    console.log(`      ${where}: ${issue.message}`);
    finding('schema-rejects-reality', `CaptureModel · ${where}: ${issue.message}`);
  }
}

/* ------------------------------------------------------------------ gates */

console.log('');
console.log('  COVERAGE INVARIANTS');
for (const inv of invariants) {
  if (inv.vacuous) { console.log(`    · ${inv.id} (vacuous)`); continue; }
  console.log(`    ${inv.holds ? '✓' : '✗'} ${inv.id}`);
}
// The crud app is single-origin, so this is legitimately zero and rung 3
// declares it known-empty. Passed explicitly rather than left undefined so the
// declaration is checked against a measurement rather than against absence.
const foreignAssetCount = Object.keys(assetEntries)
  .filter((u) => { const o = originOf(u); return o !== null && o !== ORIGIN; }).length;
const rungCounts = {
  ...extracted,
  foreignAssets: foreignAssetCount,
  blockedOffOriginNavigations: blockedNavigations.filter((e) => e.kind === 'navigation').length,
  cancelledDownloads: blockedNavigations.filter((e) => e.kind === 'download').length,
};
const { spec, failures, surprises } = checkRung(3, rungCounts);
console.log('');
console.log(`  RUNG 3 — ${spec.label}`);
// `rungCounts`, not `extracted` — the display and the gate must read the same
// value. They briefly did not, and the report printed ✗ against a measurement
// the gate had already passed, which is the more dangerous direction of the
// same bug: a green run with a red line in it teaches you to ignore the lines.
for (const key of spec.expectNonEmpty) {
  console.log(`    ${rungCounts[key] > 0 ? '✓' : '✗'} ${key.padEnd(22)} ${rungCounts[key] ?? 0}`);
}
for (const [key, want] of Object.entries(spec.expectExactly ?? {})) {
  const got = rungCounts[key] ?? 0;
  console.log(`    ${got === want ? '✓' : '✗'} ${key.padEnd(22)} ${got}  (exactly ${want})`);
}
for (const key of spec.knownEmpty) {
  console.log(`    · ${key.padEnd(22)} ${rungCounts[key] ?? 0}  (known-empty at this rung)`);
}
console.log('');
console.log(`  contexts exercised: ${[...new Set([...routes.values()].map((r) => r.context.contextId))].join(', ')}`);
console.log(`  flows: ${flows.size} (${[...flows.values()].filter((f) => f.outcome === 'skipped').length} skipped destructive) · gaps: ${gaps.length}`);
/**
 * The crawl boundary, asserted in the run rather than only in a unit test.
 *
 * The fixture has a control that calls `window.open` to another origin — no
 * href, nothing for a link-following rule to catch. If nothing was blocked,
 * either the control stopped being probed or the chokepoint has a hole, and
 * both are worth failing over.
 */
const blockedOffOrigin = blockedNavigations.filter((b) => b.kind === 'navigation');
if (blockedOffOrigin.length === 0) {
  finding('origin-guard-inert', 'no off-origin navigation was blocked, but the fixture has a control that attempts one');
} else {
  console.log(`  boundary: blocked ${blockedOffOrigin.length} off-origin navigation(s), ${blockedNavigations.length - blockedOffOrigin.length} popup/download`);
}
// The other half of the guard — that a foreign *subresource* still goes out — is
// asserted in scripts/origin-guard.test.mjs against a page that actually
// requests one. It is deliberately not counted here: this fixture serves
// everything from its own origin, so the number would be structurally zero and
// a reader would take it as evidence of something it cannot show.

for (const f of failures) finding('rung-gate', `rung 3 expects ${f.key} ${f.expected}, got ${f.actual}`);
for (const s2 of surprises) finding('rung-declaration-stale', `${s2} is declared known-empty at rung 3 but produced output`);

/**
 * §3.4, enforced. Every file under `capture/` is scanned before the run is
 * allowed to pass, and a hit fails it — not a warning, not a gitignore. The
 * prose version of this rule was satisfied in exactly one direction for two
 * rungs while `network/*.har` held a live session cookie.
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
if (findings.length === 0 && !broken.length) {
  console.log('✓ rung 3 green: endpoints, flows and probed states all validated against a real app.');
} else {
  console.log(`FINDINGS (${findings.length + broken.length}):`);
  for (const b of broken) console.log(`  [silent-drop] ${b.id}: ${b.description}`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.what}`);
}

// Findings fail the run. A gate that prints a problem and exits 0 is the
// pattern this whole milestone has been removing: §3.4 was prose, the
// same-origin rule was prose, and both were satisfied in exactly one direction
// for as long as nothing failed on them.
process.exit(
  failed > 0 || secrets.length > 0 || failures.length > 0 || broken.length > 0 || findings.length > 0
    ? 1
    : 0,
);
