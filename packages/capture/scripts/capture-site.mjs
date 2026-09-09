#!/usr/bin/env node
/**
 * A capture of a real, pinned, self-hosted app — the input infer is scored on.
 *
 *   node capture-site.mjs vikunja        # boot, seed, crawl, write capture/vikunja/
 *
 * **Written beside `rung3.mjs`, not by generalising it.** Both `rung 3` and
 * `rung 3 --allow-destructive` are steps in `verify:clean`, and rung 3's job is
 * to be a fixture that can inflict the hazards it tests (§13) — refactoring the
 * driver that produces the definition of green, to serve a different purpose,
 * risks the gate for no gain. The machinery both want is already extracted:
 * `capture-lib.mjs`, `capture-route.mjs`, `infer-endpoints.mjs`.
 *
 * **The target description comes from the pin.** Image digest, tmpfs mounts,
 * fixture account, seed and sign-in all live in `verify/scripts/snapshot.mjs`
 * beside the ground-truth snapshot, so a crawl and the document it will be
 * scored against cannot be of different instances. The sign-in in particular is
 * not obvious — Vikunja's form ignores Playwright's `fill` and the SPA eats the
 * first characters typed into it — and rediscovering that here is how a crawl
 * silently captures a login screen.
 *
 * **Milestone-gate work, deliberately outside `verify:clean`.** It needs Docker,
 * and `capture/` is gitignored and treated as sensitive (§3.4), so the artifact
 * cannot be committed the way a snapshot can. What is committed is this script
 * and the digest it boots, which is what makes the capture reproducible.
 *
 * **What it does not do, said rather than omitted:** no behaviour probing. §6's
 * probe loop — click every candidate, diff the a11y tree, record the transition
 * — is what produces `flows/`, and this driver does not run it. Every route is
 * still captured in full (CSSOM state rules, a11y tree, event listeners, scroll
 * steps, computed styles), and the API surface is recorded from the network, so
 * everything the grader scores is here. `flows` is empty and the run says so.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as S from '../../schema/dist/index.js';
import {
  allowedOrigins as deriveAllowedOrigins,
  assetKind,
  decideNavigation,
  formatFindings,
  isUnder,
  pathSegments,
  sameOrigin,
  scanCaptureTree,
} from '../../shared/dist/index.js';
import {
  assertPermitted,
  installEscapeGuards,
  installOriginGuard,
  scrubDeep,
  scrubHarFile,
  sha256,
} from './capture-lib.mjs';
import { captureRoute } from './capture-route.mjs';
import { inferEndpoints } from './infer-endpoints.mjs';
import { PINS } from '../../verify/scripts/snapshot.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * What a *crawl* needs that a truth snapshot does not: which pages to visit,
 * and where the API lives relative to everything else the browser asks for.
 */
const TARGETS = {
  vikunja: {
    pin: PINS.vikunja,
    hostPort: 3803,
    apiPrefix: '/api/v1',
    siteId: 'vikunja',
    /** The SPA's own routes. `/` is in both contexts on purpose — it is the one
     *  page whose behaviour differs by session, which is what settles auth. */
    pages: [
      { path: '/', urlPattern: '/' },
      { path: '/projects', urlPattern: '/projects' },
      { path: '/projects/2', urlPattern: '/projects/:id', pathParams: { id: '2' } },
      { path: '/labels', urlPattern: '/labels' },
      { path: '/teams', urlPattern: '/teams' },
      { path: '/tasks/1', urlPattern: '/tasks/:id', pathParams: { id: '1' } },
      { path: '/user/settings/general', urlPattern: '/user/settings/general' },
    ],
    /** Where an unauthenticated visitor lands. Read, never assumed. */
    loginPath: '/login',
  },
};

const TARGET_ID = process.argv.find((a) => Object.hasOwn(TARGETS, a)) ?? 'vikunja';
const TARGET = TARGETS[TARGET_ID];
const PIN = TARGET.pin;
const ORIGIN = `http://127.0.0.1:${TARGET.hostPort}`;
const OUT = join(REPO, 'capture', TARGET.siteId);
const SEED = 42;
const RUN_ID = `run_${S.shortHash(`capture-${TARGET.siteId}`)}`;
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/153.0.0.0 Safari/537.36 siteforge/0.1.0';
const CONTAINER = `siteforge-capture-${TARGET.siteId}`;

const gapId = (label) => `gap_${S.shortHash(label).slice(0, 12)}`;

const findings = [];
const finding = (severity, what) => findings.push({ severity, what });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const envelope = (artifact) => ({
  modelVersion: S.CAPTURE_MODEL_VERSION,
  artifact,
  scrubbed: true,
  provenance: { recordedAt: new Date(0).toISOString(), runId: RUN_ID },
});

const CONTEXTS = [
  {
    contextId: 'anon-desktop',
    label: 'Anonymous · 1280×800 · en-US',
    auth: { mode: 'anonymous' },
    viewport: VIEWPORT,
    locale: { language: 'en-US', timezone: 'UTC' },
    variant: null,
  },
  {
    contextId: 'auth-desktop',
    label: 'Signed in · 1280×800 · en-US',
    auth: {
      mode: 'storage-state',
      storageStatePath: 'auth/storage-state.json',
      acquiredBy: 'scripted',
      expiresAt: null,
      credentialSource: 'env',
    },
    viewport: VIEWPORT,
    locale: { language: 'en-US', timezone: 'UTC' },
    variant: null,
  },
];

const ALLOWED_ORIGINS = deriveAllowedOrigins({ origin: ORIGIN });
const blockedNavigations = [];
const onBlocked = (event) => blockedNavigations.push(event);

// ---------------------------------------------------------------------------
// The container
// ---------------------------------------------------------------------------

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

function requireDocker() {
  if (docker('info', '--format', '{{.ServerVersion}}').status !== 0) {
    console.error('\nthis needs a running Docker daemon — it boots the pinned image.');
    console.error('It is milestone-gate work and deliberately absent from verify:clean.\n');
    process.exit(1);
  }
}

async function boot() {
  docker('rm', '-f', CONTAINER);
  // No fallback. A default env var name is a default that is wrong for every
  // app but one, and the failure it produces is an app that boots, serves, and
  // tells its own frontend to call a port nothing is listening on — which looks
  // like a broken selector thirty seconds later.
  if (!PIN.rootUrlEnv) throw new Error(`${TARGET_ID}'s pin does not say which env var carries its public URL`);
  const env = Object.entries({ ...PIN.env, [PIN.rootUrlEnv]: `${ORIGIN}/` })
    .flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const started = docker(
    'run', '-d', '--name', CONTAINER,
    '-p', `127.0.0.1:${TARGET.hostPort}:${PIN.containerPort}`,
    ...(PIN.runArgs ?? []), ...env, PIN.image,
  );
  if (started.status !== 0) throw new Error(`could not start the pinned container:\n${started.stderr}`);
  for (let i = 0; i < 90; i += 1) {
    // operational: the container is still booting; a refused connection is what the loop is for
    const probe = await fetch(`${ORIGIN}${TARGET.apiPrefix}/info`).catch(() => null);
    if (probe?.status === 200) return;
    await wait(1000);
  }
  throw new Error(`${TARGET_ID} never became ready at ${TARGET.apiPrefix}/info`);
}

// ---------------------------------------------------------------------------
// The crawl
// ---------------------------------------------------------------------------

const observations = [];
const pendingResponses = [];
const allAssets = new Map();

const settle = async (ms = 8000) => {
  const pending = pendingResponses.splice(0);
  await Promise.race([Promise.allSettled(pending), wait(ms)]);
};

/**
 * Record every API exchange, and every subresource, from one page.
 *
 * Header **names** only, read from `allHeaders()` — `request.headers()` omits
 * cookies, so auth evidence read from it can never fire. Values never leave
 * this function (§3.3).
 */
const attachRecorders = (page, routeIdRef, { anonymousProbe = false } = {}) => {
  page.on('response', (response) => {
    pendingResponses.push((async () => {
      const request = response.request();
      const url = response.url();
      const contentType = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      if (!isUnder(url, { origin: ORIGIN, pathPrefix: TARGET.apiPrefix })) {
        if (request.resourceType() !== 'document') {
          // operational: a body already discarded by the browser is not an asset we can hash
          const body = await response.body().catch(() => null);
          if (body) {
            allAssets.set(url, {
              sha256: sha256(body), mime: contentType || 'application/octet-stream',
              bytes: body.length, status: response.status(),
              sameOrigin: sameOrigin(url, ORIGIN),
            });
          }
        }
        return;
      }
      let body;
      if (contentType === 'application/json') {
        // operational: a 204 has no body, and a non-JSON body is not ours to parse
        try { body = JSON.parse(await response.text()); } catch { /* empty or not json */ }
      }
      let requestBody;
      const post = request.postData();
      // operational: a form-encoded request body is not JSON, which is normal
      if (post) { try { requestBody = JSON.parse(post); } catch { /* form-encoded */ } }
      const requestHeaderNames = Object.keys(await request.allHeaders());
      observations.push({
        method: request.method(), url, status: response.status(), contentType,
        body, requestBody, requestHeaderNames,
        routeId: routeIdRef.current,
        contextId: (routeIdRef.current ?? '').split('--')[1] ?? null,
        anonymousProbe,
      });
    })());
  });
};

const guardContext = async (context) => {
  await installOriginGuard(context, { allowedOrigins: ALLOWED_ORIGINS, onBlocked, decide: decideNavigation });
  return context;
};

async function main() {
  requireDocker();
  assertPermitted(ORIGIN);
  console.log(`\ncapture — ${TARGET_ID} at ${PIN.image}\n`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'network'), { recursive: true });
  mkdirSync(join(OUT, 'auth'), { recursive: true });

  await boot();
  const api = (path, init) => fetch(`${ORIGIN}${path}`, init);
  await PIN.seed({ origin: ORIGIN, api });
  console.log('  seeded');

  const browser = await chromium.launch();
  const routes = new Map();
  const anonymousOutcomes = new Map();

  // --- anonymous context: what does a visitor with no session get? ----------
  {
    const context = await guardContext(await browser.newContext({
      viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
      recordHar: { path: join(OUT, 'network', 'anon-desktop.har'), content: 'omit' },
    }));
    const routeIdRef = { current: null };
    // unguarded: guarded on the next line — installEscapeGuards cannot be called
    // on a page that does not exist yet
    const page = await context.newPage();
    installEscapeGuards(page, { onBlocked });
    attachRecorders(page, routeIdRef);
    // Segment comparison, never a prefix test on the string: `/login` must not
    // be satisfied by `/not-login`, and `/loginhelp` is a different page.
    const loginSegment = pathSegments(TARGET.loginPath)[0];
    const onLogin = (u) => pathSegments(new URL(u, ORIGIN).pathname)[0] === loginSegment;
    for (const { path, urlPattern } of TARGET.pages) {
      routeIdRef.current = `${urlPattern.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}--anon-desktop--i0`;
      // operational: a page that will not load records the outcome it produced
      const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => null);
      await wait(700);
      const redirectedToLogin = onLogin(page.url());
      anonymousOutcomes.set(urlPattern, {
        status: response?.status() ?? 0,
        redirectedToLogin,
        ok: (response?.status() ?? 0) === 200 && !redirectedToLogin,
      });
    }
    await settle();
    await context.close();
    const redirected = [...anonymousOutcomes.values()].filter((o) => o.redirectedToLogin).length;
    console.log(`  anonymous: ${anonymousOutcomes.size} route(s), ${redirected} redirected to ${TARGET.loginPath}`);
  }

  // --- authenticated context: the real crawl --------------------------------
  {
    const context = await guardContext(await browser.newContext({
      viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
      recordHar: { path: join(OUT, 'network', 'auth-desktop.har'), content: 'omit' },
    }));
    // The sign-in exchange happens before any route is entered, and it is a
    // real observation of a real endpoint. It gets the login route's id rather
    // than null: `observedOn` is a list of route ids, and a null in it is a
    // claim that an endpoint was seen nowhere.
    const routeIdRef = { current: 'login--auth-desktop--i0' };
    // unguarded: guarded on the next line
    const page = await context.newPage();
    installEscapeGuards(page, { onBlocked });
    attachRecorders(page, routeIdRef);
    await PIN.signIn(page, ORIGIN, { wait });
    const state = await context.storageState();
    const statePath = join(OUT, 'auth', 'storage-state.json');
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    chmodSync(statePath, 0o600); // §5: the one artifact allowed to hold a credential
    console.log('  signed in');

    const cdp = await context.newCDPSession(page);
    for (const page_ of TARGET.pages) {
      const { path, urlPattern } = page_;
      const routeId = `${urlPattern.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}--auth-desktop--i0`;
      routeIdRef.current = routeId;
      // operational: a route that will not load is recorded as what it was
      const response = await page.goto(`${ORIGIN}${path}`, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => null);
      await wait(900);
      const routeDir = join(OUT, 'routes', routeId);
      mkdirSync(routeDir, { recursive: true });
      const captured = await captureRoute({
        page, cdp, routeId, url: page.url(), viewport: VIEWPORT, routeDir, envelope,
      });
      routes.set(routeId, {
        captured, context: CONTEXTS[1], plan: page_,
        status: response?.status() ?? 0, finalUrl: page.url(), redirectChain: [],
      });
      console.log(
        `  ${routeId.padEnd(34)} nodes ${String(captured.built.length).padStart(4)} · ` +
        `cssom ${String(captured.stateRules.length).padStart(3)} · ` +
        `candidates ${captured.built.filter((n) => n.interaction).length}`,
      );
    }
    await settle();

    /**
     * §6: re-issue each distinct GET anonymously, and never a mutation.
     *
     * The signed-in crawl learns nothing about whether an endpoint is gated —
     * every request carried a token. Only a request deliberately sent without
     * one settles it, in whichever direction the server answers.
     */
    const getUrls = [...new Set(
      observations.filter((o) => o.method === 'GET' && !o.anonymousProbe).map((o) => o.url),
    )].sort();
    const anonContext = await guardContext(await browser.newContext({
      viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
    }));
    const anonRef = { current: 'probe--anon-desktop--i0' };
    // unguarded: guarded on the next line
    const anonPage = await anonContext.newPage();
    installEscapeGuards(anonPage, { onBlocked });
    attachRecorders(anonPage, anonRef, { anonymousProbe: true });
    /**
     * The probe runs from a page so the request goes through the recorder and
     * carries the context's (empty) cookie jar. That page belongs to an SPA,
     * which navigates itself: landing on /login, the bundle decides where it
     * wants to be and rewrites the history, destroying the execution context
     * mid-probe. The first run died on route four with "Execution context was
     * destroyed", after the crawl had already succeeded — a late failure that
     * would have been easy to paper over with a swallowed catch.
     *
     * So: settle first, and re-land once if it happens anyway. A probe that
     * still cannot run is recorded as a failure and never as an absence, since
     * §8 resolves a missing verdict for a read to *required* only because the
     * sweep is trusted to have run.
     */
    await anonPage.goto(`${ORIGIN}${TARGET.loginPath}`, { waitUntil: 'networkidle' });
    await wait(3000);
    const probeFailures = [];
    const inPage = async (u) => anonPage.evaluate(async (target) => {
      try {
        const r = await fetch(target, { headers: { accept: 'application/json' } });
        return { ok: true, status: r.status };
      } catch (err) {
        // operational: a network-level rejection in the page, returned as a
        // value so the caller can tell it from a probe that learned something
        return { ok: false, error: String(err) };
      }
    }, u);
    for (const url of getUrls) {
      let outcome;
      try {
        outcome = await inPage(url);
      } catch (err) {
        // operational: the SPA navigated under us and took the execution
        // context with it. Re-land and try once; a second failure is recorded.
        if (!/Execution context was destroyed/.test(String(err))) throw err;
        await anonPage.goto(`${ORIGIN}${TARGET.loginPath}`, { waitUntil: 'networkidle' });
        await wait(1500);
        // operational: a second destroyed context is a probe that did not run
        outcome = await inPage(url).catch((again) => ({ ok: false, error: String(again) }));
      }
      if (!outcome.ok) probeFailures.push({ url, error: outcome.error });
      await anonPage.waitForTimeout(60);
    }
    await settle();
    await anonContext.close();
    console.log(`  auth probe: re-issued ${getUrls.length} GET endpoint(s) anonymously`);
    for (const f of probeFailures) {
      finding('auth-probe-failed',
        `the anonymous re-issue of ${f.url} did not complete (${f.error}); its requirement stays 'unknown', which §8 resolves to required`);
    }
    await context.close();
  }
  await browser.close();
  docker('rm', '-f', CONTAINER);

  // --- §3.4 before anything else touches the tree ---------------------------
  for (const context of CONTEXTS) {
    const harPath = join(OUT, 'network', `${context.contextId}.har`);
    if (existsSync(harPath)) scrubHarFile({ readFileSync, writeFileSync }, harPath);
  }

  return { routes, anonymousOutcomes };
}

// ---------------------------------------------------------------------------

const { routes, anonymousOutcomes } = await main();

/**
 * A `<select>` in the captured DOM is the primary evidence for an enum (§7.5).
 * Ground truth about the domain, and the only kind: the API cannot receive an
 * option the UI has no way to send.
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

/** Routes whose anonymous verdict a client-side redirect left unsettled. */
const clientRedirectRoutes = [];

const gaps = [];
const mintGap = ({ field, basis, values }) => {
  const id = gapId(`narrowing:${field}:${basis}`);
  if (!gaps.some((g) => g.gapId === id)) {
    gaps.push({
      gapId: id, stage: 'capture', category: 'inferred-type-narrowed', severity: 'info',
      subject: { url: `${ORIGIN}${TARGET.apiPrefix}` },
      summary: `\`${field}\` narrowed to an enum of ${values.length} on ${basis} evidence.`,
      detail: `The field \`${field}\` is typed as a closed set rather than a string, on ${basis} evidence: ${JSON.stringify(values)}. §5 makes this schema the mock backend's data model, so a wrong narrowing makes the clone reject values the real API accepts. Review-required: narrowing must be justified, widening is free.`,
      stub: { kind: 'none' },
    });
  }
  return id;
};

const endpoints = inferEndpoints(observations, {
  scrub: scrubDeep, sha256, uiConstraints, mintGap, anonContextId: 'anon-desktop',
});
console.log(`  endpoints: ${endpoints.length} inferred from ${observations.length} API exchange(s)`);

/**
 * §6 was not run, and that is a property of this driver rather than of the site.
 *
 * A `Gap` is something about the *target* that could not be cloned, and its
 * categories say so — there is no member for "the tool did not do this part",
 * and inventing one would put a driver limitation in the same list as a
 * licensed webfont. It is a stage warning instead, and `manifest.flowIds` is
 * empty beside it, so the absence is stated in two artifacts rather than
 * inferred from one.
 */
const warnings = [
  {
    code: 'no-behaviour-probing',
    message:
      "this driver crawls and records; it does not fire controls. §6's probe loop — click every candidate, diff the a11y tree, record the transition — produces flows/, and it did not run. Interaction candidates were discovered and counted; none was fired, so flows is empty by construction rather than by a silent drop.",
  },
];

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

const routeArtifacts = new Map();
for (const [routeId, record] of routes) {
  const { captured, context, plan } = record;
  const entries = captured.stateEntries;
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
   * The anonymous verdict for a *route*, and why an SPA does not supply one.
   *
   * §6's evidence kinds were written against server-rendered apps, where an
   * unauthenticated request for a gated page is answered with a 302 to the
   * login route — `anonymous-redirect-to-login` carries that status and the
   * schema requires it to be a real redirect. Vikunja's server answers **200
   * with the same JavaScript bundle for every path**; the redirect to /login
   * happens in the browser after the bundle decides it has no token.
   *
   * So the honest record is `unknown`, plus a gap that says why. Recording a
   * 302 nobody observed would be inventing the observation the whole
   * three-valued design exists to avoid, and recording `not-required` because
   * the server said 200 would be worse — §8 resolves that to a public read.
   *
   * The API-level auth verdicts are unaffected and are what the grader scores:
   * those come from re-issuing each GET without a session and reading what the
   * server actually answered, which for this target is 401.
   */
  const anonSeen = anonymousOutcomes.get(plan.urlPattern);
  const authEvidence = [];
  let behaviour = { kind: 'unknown' };
  if (anonSeen?.redirectedToLogin && anonSeen.status >= 300) {
    authEvidence.push({
      kind: 'anonymous-redirect-to-login', to: TARGET.loginPath,
      status: anonSeen.status, contextId: 'anon-desktop',
    });
    behaviour = { kind: 'redirect', to: TARGET.loginPath, status: anonSeen.status };
  } else if (anonSeen?.ok) {
    authEvidence.push({ kind: 'anonymous-success', status: 200, observedCount: 1, contextId: 'anon-desktop' });
    behaviour = { kind: 'accessible' };
  } else if (anonSeen?.redirectedToLogin) {
    clientRedirectRoutes.push(plan.urlPattern);
  }
  const meta = {
    ...envelope('route-meta'),
    routeId, siteId: TARGET.siteId,
    urlPattern: plan.urlPattern, contextId: context.contextId, instanceIndex: 0,
    url: record.finalUrl, pathParams: plan.pathParams ?? {}, canonicalUrl: record.finalUrl,
    title: scrubDeep(captured.extracted.title), status: record.status,
    redirectChain: record.redirectChain,
    templateGuess: { name: 'unknown', confidence: 0.2, rationale: 'Too few routes to group by structure.' },
    requiresAuth: S.resolveAuthRequirement(authEvidence),
    authEvidence,
    unauthenticatedBehavior: behaviour,
    depth: 0, discoveredFrom: { kind: 'entry' }, embeddedIn: [],
    content: {
      kind: 'captured', contentHash,
      renderedSize: { width: VIEWPORT.width, height: VIEWPORT.height },
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

if (clientRedirectRoutes.length > 0) {
  gaps.push({
    gapId: gapId(`spa-client-redirect:${TARGET.siteId}`),
    stage: 'capture', category: 'auth-required-not-captured', severity: 'degraded',
    subject: { url: `${ORIGIN}/` },
    summary: `${clientRedirectRoutes.length} route(s) have no anonymous auth evidence: the server answers 200 for every path and the redirect to ${TARGET.loginPath} happens in the browser.`,
    detail: `§6's route-level evidence kinds were written against server-rendered apps, where an unauthenticated request for a gated page is answered with a 302 — \`anonymous-redirect-to-login\` carries that status and the schema requires a real redirect. This target serves the same JavaScript bundle at 200 for every path, and the bundle redirects itself once it finds no token. Recording a 302 nobody observed would invent the observation the three-valued design exists to avoid, and recording \`not-required\` from the 200 would be worse: §8 resolves that to a public read. These routes are \`unknown\`. Affected: ${clientRedirectRoutes.join(', ')}. Endpoint-level auth is unaffected — it comes from re-issuing each GET without a session and reading what the server answered.`,
    stub: { kind: 'none' },
  });
}

const assetEntries = {};
for (const [url, a] of allAssets) {
  const ext = (a.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '') || 'bin';
  assetEntries[url] = {
    assetId: a.sha256, originalUrl: url, localPath: `assets/files/${a.sha256}.${ext}`,
    sha256: a.sha256, mime: a.mime, bytes: a.bytes, kind: assetKind(a.mime),
    status: a.status, sameOrigin: a.sameOrigin, fromCache: false, referencedBy: [],
  };
}
write('assets/index.json', S.AssetIndexSchema, {
  ...envelope('asset-index'),
  byUrl: assetEntries,
  stats: {
    assetCount: Object.keys(assetEntries).length,
    distinctFiles: new Set(Object.values(assetEntries).map((a) => a.sha256)).size,
    totalBytes: Object.values(assetEntries).reduce((n, a) => n + a.bytes, 0),
  },
});

write('network/endpoints.json', S.EndpointIndexSchema, {
  ...envelope('endpoint-index'),
  endpoints,
  har: { path: 'network/session.har', entryCount: observations.length },
  thirdPartyOrigins: [],
});

const totalStates = [...routeArtifacts.values()].flatMap((r) => r.states.entries);
const observed = {
  stylesheets: [...routes.values()].reduce((n, r) => n + r.captured.cssom.stylesheetCount, 0),
  cssPseudoClassRules: [...routes.values()].reduce((n, r) => n + r.captured.cssom.rawPseudoRules, 0),
  cssAttributeStateRules: [...routes.values()].reduce((n, r) => n + r.captured.cssom.rawAttrStateRules, 0),
  cssFontFaceRules: [...routes.values()].reduce((n, r) => n + r.captured.cssom.fonts.length, 0),
  harXhrEntries: observations.length,
  harDistinctMethods: new Set(observations.map((o) => o.method)).size,
  documentHeightRatio: Math.max(
    ...[...routes.values()].map((r) => r.captured.pageMetrics.scrollHeight / VIEWPORT.height)),
  axInteractiveRoles: [...routes.values()].reduce((n, r) => n + r.captured.interactiveAx, 0),
  subresourceRequests: Object.keys(assetEntries).length,
  sessionProbePolicy: 'credentialed',
  // No control was fired, so none was classified. Declared, not inferred from
  // the firing pass — the observed side must not come from what it checks.
  sessionDestructiveControls: 0,
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
  sessionDestructiveFired: 0,
  a11yNodes: [...routes.values()].reduce((n, r) => n + r.captured.built.filter((x) => x.a11y).length, 0),
};
const invariants = S.evaluateCoverage(observed, extracted);
const broken = invariants.filter((i) => !i.vacuous && !i.holds);
write('coverage.json', S.CoverageReportSchema, {
  ...envelope('coverage-report'),
  siteId: TARGET.siteId, routeIds: [...routes.keys()], observed, extracted, invariants,
});

write('flows/skipped-controls.json', S.SkippedControlIndexSchema, {
  ...envelope('skipped-control-index'), siteId: TARGET.siteId, controls: [],
});

write('manifest.json', S.CaptureManifestSchema, {
  ...envelope('capture-manifest'),
  siteId: TARGET.siteId,
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
    sessionProbePolicy: 'credentialed',
    allowDestructive: false,
    destructiveTerms: [],
  },
  toolVersions: { siteforge: '0.1.0', playwright: '1.63.0', browser: 'chromium-headless-shell' },
  patterns: [...new Set([...routes.values()].map((r) => r.plan.urlPattern))].map((urlPattern) => ({
    urlPattern, observedUrlCount: 1,
    routeIds: [...routes.entries()].filter(([, r]) => r.plan.urlPattern === urlPattern).map(([id]) => id),
  })),
  routeIds: [...routes.keys()],
  flowIds: [],
  contentHash: sha256([...routeArtifacts.values()].map((r) => r.meta.content.contentHash).sort().join('\n')),
  counts: {
    contexts: CONTEXTS.length, routes: routes.size, capturedRoutes: routes.size,
    patterns: new Set([...routes.values()].map((r) => r.plan.urlPattern)).size,
    assets: Object.keys(assetEntries).length, endpoints: endpoints.length,
    flows: 0, gaps: gaps.length,
  },
});

write('stage-report.json', S.StageReportSchema, {
  ...envelope('stage-report'),
  stage: 'capture', siteId: TARGET.siteId,
  status: broken.length || failed ? 'failed' : gaps.length ? 'ok-with-gaps' : 'ok',
  inputs: [], outputs: written.map((p) => ({ path: p, sha256: sha256(p), bytes: 0 })),
  warnings, gaps,
});

const secrets = scanCaptureTree(OUT);
if (secrets.length > 0) {
  console.log(`\n  ✗ SECRET SCAN — ${secrets.length} credential(s) reached an artifact (§3.4):`);
  console.log(formatFindings(secrets));
  for (const f of secrets) finding('credential-in-artifact', `${f.file}: ${f.detail}`);
} else {
  console.log('  secrets: clean (§3.4)');
}

console.log('');
if (findings.length === 0 && broken.length === 0 && failed === 0) {
  console.log(`✓ capture/${TARGET.siteId}: ${routes.size} route(s), ${endpoints.length} endpoint(s), ${gaps.length} gap(s).`);
} else {
  console.log(`FINDINGS (${findings.length + broken.length}):`);
  for (const b of broken) console.log(`  [silent-drop] ${b.id}: ${b.description}`);
  for (const f of findings) console.log(`  [${f.severity}] ${f.what}`);
  process.exitCode = 1;
}
