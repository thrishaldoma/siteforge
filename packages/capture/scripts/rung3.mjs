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
import { assertPermitted, scrub, scrubDeep, scrubHarFile, sha256 } from './capture-lib.mjs';
import { captureRoute } from './capture-route.mjs';
import { inferEndpoints } from './infer-endpoints.mjs';
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
      acquiredBy: 'interactive-headful', expiresAt: null, credentialSource: 'env',
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
const settleResponses = async () => {
  await Promise.allSettled(pendingResponses.splice(0));
};
const attachApiRecorder = (page, routeIdRef, { anonymousProbe = false } = {}) => {
  page.on('response', (response) => {
    pendingResponses.push((async () => {
      const request = response.request();
      const url = response.url();
      if (!url.startsWith(`${ORIGIN}/api/`)) return;
      const contentType = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      let body;
      if (contentType.includes('json')) {
        try { body = JSON.parse(await response.text()); } catch { /* empty 204 */ }
      }
      let requestBody;
      const post = request.postData();
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
  const ctx = await browser.newContext({ viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC' });
  const page = await ctx.newPage();
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
  const ctx = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    deviceScaleFactor: VIEWPORT.deviceScaleFactor,
    userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce',
    ...(context.auth.mode === 'storage-state' ? { storageState } : {}),
    recordHar: { path: join(OUT, 'network', `${context.contextId}.har`), content: 'omit' },
  });
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
  const routeIdRef = { current: null };
  attachApiRecorder(page, routeIdRef);
  page.on('response', async (response) => {
    const url = response.url();
    if (url.startsWith(`${ORIGIN}/api/`)) return;
    try {
      const buf = await response.body();
      const mime = (response.headers()['content-type'] ?? 'application/octet-stream').split(';')[0].trim();
      allAssets.set(url, {
        sha256: sha256(buf), bytes: buf.length, mime, status: response.status(),
        sameOrigin: new URL(url).origin === ORIGIN,
      });
    } catch { /* redirect */ }
  });

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('Accessibility.enable');
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

  await cdp.detach().catch(() => {});
  await ctx.close();
}

/* ------------------------------------------ §6 behavior probing → flows/ */

/** §6: skip destructive actions by heuristic unless --allow-destructive. */
const DESTRUCTIVE_TERMS = ['delete', 'remove', 'cancel subscription', 'deactivate', 'sign out'];

/**
 * Controls §6 discovered and refused to fire (decision 0010).
 *
 * Capture stops at the control. It never learns the URL, because learning it
 * would mean clicking — which is the thing §6 declines to do. Binding these to
 * endpoints is §7's job, by reading `<form action>` and `fetch()` out of the
 * captured source, and that is why no endpoint entry is created here.
 */
const skippedControls = [];
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
  const cssomText = record.captured.stateRules.map((r) => r.selector).join(' ');

  const probeCtx = await browser.newContext({
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    userAgent: UA, locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'reduce', storageState,
  });
  const probeIdRef = { current: routeId };
  let probed = 0;
  const MAX_PROBES = 16;

  for (const candidate of candidates) {
    if (probed >= MAX_PROBES) break;
    const label = `${candidate.a11y.role} "${candidate.a11y.name}"`;
    const term = DESTRUCTIVE_TERMS.find((t) => candidate.a11y.name.toLowerCase().includes(t));
    const flowId = `probe-${S.shortHash(label).slice(0, 10)}`;

    if (term) {
      const id = gapId(`destructive:${label}`);
      gaps.push({
        gapId: id, stage: 'capture', category: 'destructive-action-skipped', severity: 'degraded',
        subject: { routeId, nodeId: candidate.nodeId, flowId },
        summary: `${label} was not probed (destructive heuristic matched "${term}").`,
        detail: `§6 skips destructive actions unless --allow-destructive. The control was discovered via ${candidate.interaction.discoveredBy.join(' + ')}, but never activated, so its transition is unknown.`,
        stub: { kind: 'omitted', detail: 'Control renders and is focusable; its effect is not reproduced.' },
      });
      flows.set(flowId, {
        ...envelope('flow-trace'),
        flowId, siteId: SITE_ID, kind: 'probe',
        name: `${candidate.a11y.name} (not run)`,
        description: 'Discovered as an interaction candidate and skipped by §6’s destructive heuristic.',
        startRouteId: routeId,
        discoveredBy: candidate.interaction.discoveredBy[0],
        initialA11yTree: buildA11yTree(record.captured),
        steps: [], outcome: 'skipped', destructive: true,
        skipReason: { cause: 'destructive-heuristic', matchedTerm: term, gapId: id },
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
        cause: 'destructive-heuristic', matchedTerm: term,
        gapId: id, flowId,
      });
      continue;
    }

    // §6: each probe runs in a fresh page context, so probes cannot contaminate
    // each other's preconditions.
    const page = await probeCtx.newPage();
    attachApiRecorder(page, probeIdRef);
    try {
      await page.goto(`${ORIGIN}${record.plan.path}`, { waitUntil: 'networkidle' });
      const locator = page.getByRole(candidate.a11y.role, { name: candidate.a11y.name, exact: true }).first();
      if (!(await locator.count())) { await page.close(); continue; }

      const snap = async () => page.evaluate(() => ({
        url: location.href,
        html: document.documentElement.outerHTML,
        classes: [...document.querySelectorAll('*')].map((e) => e.className).join('|'),
        attrs: [...document.querySelectorAll('*')]
          .map((e) => [...e.attributes].map((a) => `${a.name}=${a.value}`).join(',')).join('|'),
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
      await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
      await settleResponses();
      const after = await snap();
      const networkCalls = observations.slice(netBefore);

      const changed = before.html !== after.html;
      const preHash = S.shortHash(before.html);
      const postHash = S.shortHash(after.html);
      const snapshot = (s, h) => ({
        url: s.url, routeId, domHash: h, a11yHash: S.shortHash(s.attrs), focusedRef: null,
      });

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
        outcome: 'completed', destructive: false, gapIds: [],
      });
      probed += 1;

      // A change no extracted CSSOM rule mentions is JS-driven, which is exactly
      // the case §6 reserves probing for.
      if (changed && before.classes !== after.classes) {
        const newClasses = after.classes.split('|').join(' ').split(/\s+/)
          .filter((c) => c && !before.classes.includes(c));
        const unexplained = newClasses.filter((c) => !cssomText.includes(c));
        if (unexplained.length) {
          const list = probedStates.get(routeId) ?? [];
          list.push({
            source: 'probed', nodeId: candidate.nodeId, trigger: 'click',
            reason: 'absent-from-cssom',
            styleChanges: [], attributeChanges: [],
            classChanges: { added: [...new Set(unexplained)], removed: [] },
            subtreeChanged: true,
          });
          probedStates.set(routeId, list);
        }
      }
    } catch { /* a candidate that cannot be driven is not a probe */ }
    await settleResponses();
    await page.close();
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
 * §6 records "which routes require which" auth. That is only inferable for an
 * endpoint the *anonymous* crawl actually touched — and it never does, because
 * the anonymous session is redirected to /login before any XHR runs. So each
 * distinct GET endpoint observed while signed in is re-issued once anonymously,
 * purely to record what an unauthenticated caller gets.
 *
 * Deliberately GET-only: re-issuing a mutation to learn its auth behaviour would
 * change the target's state, which capture must not do.
 */
const anonCtx = await browser.newContext({ userAgent: UA, locale: 'en-US', timezoneId: 'UTC' });
const anonPage = await anonCtx.newPage();
const anonRouteRef = { current: [...routes.keys()].find((k) => k.includes('anon-desktop')) };
attachApiRecorder(anonPage, anonRouteRef, { anonymousProbe: true });
await anonPage.goto(`${ORIGIN}/login`, { waitUntil: 'domcontentloaded' });
const getUrls = [...new Set(observations.filter((o) => o.method === 'GET').map((o) => o.url))];
for (const url of getUrls) {
  await anonPage.evaluate(
    (u) => fetch(u, { headers: { accept: 'application/json' } }).catch(() => {}), url);
  await anonPage.waitForTimeout(80);
}
await settleResponses();
await anonCtx.close();
console.log(`  auth probe: re-issued ${getUrls.length} GET endpoint(s) anonymously`);

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
  const redirectedToLogin = record.finalUrl.includes('/login') && !record.plan.path.includes('/login');
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

const assetEntries = {};
for (const [url, a] of allAssets) {
  const ext = (a.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  assetEntries[url] = {
    assetId: a.sha256, originalUrl: url, localPath: `assets/files/${a.sha256}.${ext}`,
    sha256: a.sha256, mime: a.mime, bytes: a.bytes,
    kind: a.mime.includes('css') ? 'stylesheet' : a.mime.includes('html') ? 'document'
      : a.mime.startsWith('image/') ? 'image' : a.mime.includes('javascript') ? 'script' : 'other',
    status: a.status, sameOrigin: a.sameOrigin, fromCache: false, referencedBy: [],
  };
}
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
    sameOriginOnly: true, allowDestructive: false, destructiveTerms: DESTRUCTIVE_TERMS,
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

gaps.push(...narrowingGaps);

const report = write('stage-report.json', S.StageReportSchema, {
  ...envelope('stage-report'),
  stage: 'capture', siteId: SITE_ID,
  status: broken.length ? 'failed' : gaps.length ? 'ok-with-gaps' : 'ok',
  inputs: [], outputs: written.map((p) => ({ path: p, sha256: sha256(p), bytes: 0 })),
  warnings: [], gaps,
});

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
const { spec, failures, surprises } = checkRung(3, extracted);
console.log('');
console.log(`  RUNG 3 — ${spec.label}`);
for (const key of spec.expectNonEmpty) {
  console.log(`    ${extracted[key] > 0 ? '✓' : '✗'} ${key.padEnd(22)} ${extracted[key] ?? 0}`);
}
console.log('');
console.log(`  contexts exercised: ${[...new Set([...routes.values()].map((r) => r.context.contextId))].join(', ')}`);
console.log(`  flows: ${flows.size} (${[...flows.values()].filter((f) => f.outcome === 'skipped').length} skipped destructive) · gaps: ${gaps.length}`);
for (const f of failures) finding('rung-gate', `rung 3 expects ${f.key} non-empty, got ${f.actual}`);
for (const s2 of surprises) finding('rung-declaration-stale', `${s2} is declared known-empty at rung 3 but produced output`);

console.log('');
if (findings.length === 0 && !broken.length) {
  console.log('✓ rung 3 green: endpoints, flows and probed states all validated against a real app.');
} else {
  console.log(`FINDINGS (${findings.length + broken.length}):`);
  for (const b of broken) console.log(`  [silent-drop] ${b.id}: ${b.description}`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.what}`);
}
process.exit(failed > 0 || failures.length > 0 || broken.length > 0 ? 1 : 0);
