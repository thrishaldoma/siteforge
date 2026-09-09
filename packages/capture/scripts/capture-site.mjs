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
 * **It probes** (0024): §6's loop fires every non-hazardous candidate in a
 * fresh page, classifies the rest by who absorbs the harm, and writes `flows/`
 * plus `flows/skipped-controls.json`. Roughly half the clicks on this target
 * time out for a reason nobody has established — three diagnoses were wrong in
 * a row — so each failure records *which of the click's four preconditions was
 * unmet* rather than a fourth hypothesis, and the run prints the distribution.
 *
 * **What it does not do, said rather than omitted:** no `--responsive` pass, so
 * every probe is at 1280×800; and the probe vocabulary is `click` only, so a
 * discovered `textbox` is never typed into.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import * as S from '../../schema/dist/index.js';
import {
  allowedOrigins as deriveAllowedOrigins,
  assessAssetBodies,
  assetKind,
  decideNavigation,
  isTextualAsset,
  formatFindings,
  isUnder,
  operationalKind,
  pathSegments,
  rethrowIfDefect,
  sameOrigin,
  scanCaptureTree,
  NEVER_FIRE_NAMES,
  TARGET_DESTRUCTIVE_TERMS,
  SESSION_DESTRUCTIVE_TERMS,
  classifyControlHazard,
  planProbeSchedule,
} from '../../shared/dist/index.js';
import {
  assertPermitted,
  installEscapeGuards,
  installOriginGuard,
  scrubDeep,
  scrubHarFile,
  selectorClassNames,
  sha256,
  writeAssetBodies,
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

/** §6's flag. We own the pinned container, so a delete flow could yield real observations. */
const ALLOW_DESTRUCTIVE = process.argv.includes('--allow-destructive');
/**
 * Crawl an already-running container and leave it running.
 *
 * For the idempotence measurement only, and it is the discriminator: every
 * ordinary run does `docker rm -f` and a fresh `docker run`, so two ordinary
 * runs differ in *both* our timing and the target's state — a fresh database,
 * new id sequences, new clocks. Holding the container still separates the two
 * without anyone having to reason about which fields look like target state.
 */
const REUSE_CONTAINER = process.argv.includes('--reuse-container');
/** Boot and seed as usual, then leave the container running for the next crawl. */
const HOLD_CONTAINER = process.argv.includes('--hold-container');

const gaps = [];
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
 *
 * **Every rejection is terminated here, and counted.** A probe ends by closing
 * its page, and a body still arriving at that moment makes `allHeaders()`
 * reject — into a promise nothing is awaiting any more, because `settle()` has
 * already spliced it away. That is an *uncatchable* crash: it killed a 25-minute
 * run at `request.allHeaders: Target page, context or browser has been closed`.
 *
 * A rejected observation is a **dropped observation**, which §13 calls the
 * failure mode of this whole project, so it is counted rather than swallowed —
 * and a rejection that is not the page closing becomes a finding, which fails
 * the run at the end. Throwing is not available: this is an event handler, and
 * there is nowhere for the throw to go except back into an unhandled rejection.
 */
const PAGE_CLOSED = /Target (?:page, context or browser has been closed|closed)/i;
let lostObservations = 0;
/**
 * Every undriveable control's diagnostic, flat, for the distribution printed at
 * the end of the run.
 *
 * The ruling that produced it: instrument, do not diagnose — and then look at
 * the *distribution* rather than at the first case. Half of sixty is a big
 * enough population for the shape of the failure to be visible, and three wrong
 * hypotheses were argued from one example each.
 */
const undriveable = [];

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
              // **The body, kept.** It was hashed and thrown away until now, so
              // `assets/index.json` advertised a `localPath` for a file that had
              // never been written — and §7.6, whose whole job is to find a
              // control's handler in the captured source, had no source to
              // search. §6 says persist every response body; this is that.
              body,
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
    })().catch((err) => {
      // operational: the page closed while its body was still arriving, which
      // is what the end of every probe looks like. The exchange is lost, and
      // the count is what stops that being silent.
      if (PAGE_CLOSED.test(String(err))) { lostObservations += 1; return; }
      // Anything else is a defect. It cannot be rethrown from here without
      // becoming the unhandled rejection this handler exists to prevent, so it
      // is surfaced as a finding and the run fails on it at the end.
      finding('recorder-failed', `${response.url()}: ${String(err).split('\n')[0]}`);
    }));
  });
};

/**
 * §6's determinism shim: `Date.now`, `performance.now`, `Math.random` and
 * `crypto.randomUUID`, frozen against the run seed.
 *
 * *"You need this here as well as in the clone, or your 'identical' recrawls
 * will never be identical."* Measured, and the sentence is exact: without it,
 * **every `dom.json` of all seven routes differed between three crawls of one
 * pinned digest**, on one node — Vikunja's avatar `<img>` carries a
 * cache-busting `?size=50&=<Date.now()>`, so one live clock reading moved the
 * DOM hash of every page it appears on.
 *
 * `rung3.mjs` and `spike-one-page.mjs` both installed one. This driver did not,
 * and wrote `determinism.frozen: ['Date.now', …]` into its manifest anyway — a
 * derived claim with no evidence behind it, which is the failure §13 is mostly
 * about. `DETERMINISM_FROZEN` below is now the single source for both the shim
 * and the manifest, so the artifact cannot claim a freeze that did not happen.
 */
const FROZEN_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z');
const DETERMINISM_FROZEN = ['Date.now', 'performance.now', 'Math.random', 'crypto.randomUUID'];

const freezeClocks = ({ seed, epoch }) => {
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
};

/**
 * The one place a context is made, so neither guard can be forgotten.
 *
 * §13 already says every page the crawler opens carries the escape guards and
 * `pnpm lint` says so. The determinism shim is the same kind of obligation —
 * per-context, invisible when missing, and easy to omit at the next
 * `newContext()` — so it goes through the same chokepoint rather than becoming
 * a second thing to remember. Six call sites here, and the one that mattered
 * was whichever got added last.
 */
const guardContext = async (context) => {
  await installOriginGuard(context, { allowedOrigins: ALLOWED_ORIGINS, onBlocked, decide: decideNavigation });
  await context.addInitScript(freezeClocks, { seed: SEED, epoch: FROZEN_EPOCH_MS });
  return context;
};


// ---------------------------------------------------------------------------
// §6's behaviour probing
// ---------------------------------------------------------------------------

/**
 * The probe budget, per route.
 *
 * A Vikunja route offers 133–807 interaction candidates, most of them
 * decorative spans that `cursor: pointer` swept in. §6's "for each candidate"
 * is not affordable against a real SPA, so the budget is stated as a number
 * here rather than implied by whatever the loop got through — and the count of
 * candidates *declined for budget* is written into the coverage report, so a
 * shallow probe pass is visible rather than indistinguishable from a thorough
 * one that found nothing.
 */
const MAX_PROBES_PER_ROUTE = 12;

/**
 * And a cap on **attempts**, which is the one that actually bounds the clock.
 *
 * The first version budgeted successes only. A control that cannot be driven
 * still costs a page load plus the click timeout and does not consume the
 * budget, so on `/user/settings/general` — 668 distinct candidates — the loop
 * would have kept trying for over an hour to land its twelfth success. Bounding
 * successes bounds the *output*; bounding attempts bounds the *cost*, and a
 * probe pass whose runtime is a function of how undriveable the page is will
 * always be the one that has to be killed.
 */
const MAX_ATTEMPTS_PER_ROUTE = 24;

const flows = new Map();
const skippedControls = [];
const probedStates = new Map();
let budgetDeclined = 0;

/** Flat a11y tree: a probe needs a valid root plus the addressable elements. */
const buildA11yTree = (captured) => ({
  ref: S.deriveDocumentA11yRef(captured.extracted.url),
  role: 'RootWebArea',
  name: captured.extracted.title,
  children: captured.built
    .filter((n) => n.nodeType === 'element' && n.a11y)
    .map((n) => ({ ref: n.a11y.ref, role: n.a11y.role, name: n.a11y.name, nodeId: n.nodeId, children: [] })),
});

/**
 * A control this pass discovered and refused to activate (decision 0010).
 *
 * Capture stops at the control: it never learns the URL, because learning it
 * would mean clicking, which is the thing §6 declines to do. §7.6 binds these
 * to a URL by reading `<form action>` and `fetch()` out of the captured source,
 * which is why no endpoint is created here — inventing one is the §7 failure
 * this whole machinery exists to prevent.
 */
function recordSkip({ routeId, record, candidate, flowId, label, cause, matchedTerm, outOfScopeTarget }) {
  const id = gapId(`${cause}:${label}`);
  gaps.push({
    gapId: id,
    stage: 'capture',
    category: cause === 'out-of-scope' ? 'out-of-scope-control' : 'destructive-action-skipped',
    severity: cause === 'out-of-scope' ? 'info' : 'degraded',
    subject: { routeId, nodeId: candidate.nodeId, flowId },
    summary: cause === 'out-of-scope'
      ? `${label} leaves the site (${outOfScopeTarget}); not exercised.`
      : `${label} was not fired (target-destructive, matched "${matchedTerm}").`,
    detail: cause === 'out-of-scope'
      ? `The control targets ${outOfScopeTarget}, which is not ours to exercise. §6 crawls same-origin only; the clone renders the control and it goes nowhere. No endpoint is created either way.`
      : `Irreversible against the target, so §6 never activates it. Discovered via ${candidate.interaction.discoveredBy.join(' + ')}; its transition is unknown. Recorded as a skipped control so §7.6 can bind it to a URL from the captured source.`,
    stub: cause === 'out-of-scope'
      ? { kind: 'none' }
      : { kind: 'omitted', detail: 'Control renders and is focusable; infer binds it and codegen implements it against the mock store.' },
  });
  flows.set(flowId, {
    ...envelope('flow-trace'),
    flowId, siteId: TARGET.siteId, kind: 'probe',
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
  // The structured half. A skipped `FlowTrace` is forced to `steps: []` and
  // role/name/nodeId live on `FlowStep.target`, so without this the control
  // survives only as prose and infer cannot look for its handler.
  skippedControls.push({
    controlId: `ctl_${sha256(`${routeId}:${candidate.nodeId}`).slice(0, 12)}`,
    routeId, nodeId: candidate.nodeId,
    role: candidate.a11y.role, name: candidate.a11y.name,
    cause,
    ...(cause === 'target-destructive' ? { matchedTerm } : { outOfScopeTarget }),
    gapId: id, flowId,
    // Declined, never driven. There is no element state to have observed, and
    // the schema rejects a diagnostic on a control nobody fired.
    diagnostic: null,
  });
}

/**
 * Label which operation failed, so a timeout names its own cause.
 *
 * Three diagnoses of the probe timeouts were wrong in a row, and each was
 * plausible because the recorded kind was `timeout` for all of them — a value
 * that says a clock ran out and not which clock. `operationalKind` is a
 * taxonomy of *error shapes*; this is the missing half, the operation. Cheaper
 * than a fourth hypothesis, and it makes the next run answer the question
 * instead of supporting a guess.
 */
class ProbeStepError extends Error {
  constructor(stepName, cause) {
    super(`${stepName}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = cause instanceof Error ? cause.name : 'Error';
    this.stepName = stepName;
    this.cause = cause;
  }
}

const step = async (stepName, run) => {
  try {
    return await run();
  } catch (err) {
    rethrowIfDefect(err);
    throw new ProbeStepError(stepName, err);
  }
};

/**
 * A session acquired for one probe and thrown away after (§6, decision 0011).
 *
 * Its own context and its own sign-in, because the thing being protected is the
 * *server-side* session and a cloned `storageState` shares it.
 */
async function acquireStorageState(browser) {
  const ctx = await guardContext(await browser.newContext({
    viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
  }));
  // unguarded: guarded on the next line
  const page = await ctx.newPage();
  installEscapeGuards(page, { onBlocked });
  await PIN.signIn(page, ORIGIN, { wait });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/**
 * A control that was fired and would not move.
 *
 * Deduplicated by (route, node): the same control reached from two probes is
 * one undriveable control, and seven identical console lines per sidebar link
 * is what this replaced.
 */
function recordUndriveable({ routeId, candidate, label, kind, diagnostic }) {
  const controlId = `ctl_${sha256(`${routeId}:${candidate.nodeId}`).slice(0, 12)}`;
  if (skippedControls.some((c) => c.controlId === controlId)) return;
  const id = gapId(`precondition-unmet:${routeId}:${label}`);
  gaps.push({
    gapId: id, stage: 'capture', category: 'interaction-not-reproducible', severity: 'degraded',
    subject: { routeId, nodeId: candidate.nodeId },
    summary: `${label} was fired and did not resolve (${kind}).`,
    detail: `Discovered via ${candidate.interaction.discoveredBy.join(' + ')} and activated, but the action did not complete: ${kind}. Recorded as precondition-unmet rather than as a decision to skip — nothing here was declined, which is why the schema has no \`session-destructive\` or \`undriveable\` cause to reach for. §7.6 can still bind it from the captured source.`,
    stub: { kind: 'omitted', detail: 'Control renders and is focusable; its transition is not reproduced.' },
  });
  skippedControls.push({
    controlId, routeId, nodeId: candidate.nodeId,
    role: candidate.a11y.role, name: candidate.a11y.name,
    cause: 'precondition-unmet', gapId: id, flowId: null,
    diagnostic,
  });
  undriveable.push({ routeId, label, ...diagnostic });
}

/**
 * What was true of the control when the action gave up.
 *
 * Not a hypothesis: these are the four conditions Playwright's `click` is
 * waiting on, so recording them says *which* precondition was never met rather
 * than repeating that a clock ran out. Everything here is best-effort and
 * `null` on failure — the element may have detached and the page may have gone,
 * and a check that could not be made must not read as `false`.
 *
 * Every probe here is bounded well under the click's own 5s: the diagnostic
 * runs after a failure, and a diagnostic that hangs turns one slow probe into a
 * stalled run.
 */
async function diagnoseUndriveable({ page, locator, candidate, step, attemptIndex, navigationPending }) {
  // operational: the element detached or the page closed while we were asking about it
  const ask = async (fn) => { try { return await fn(); } catch (err) { rethrowIfDefect(err); return null; } };

  const box = await ask(() => locator.boundingBox({ timeout: 1000 }));
  // Stability is a claim about two frames, so it takes two observations — the
  // same thing Playwright measures, and the condition an animating sidebar
  // fails.
  const box2 = box === null ? null : await ask(async () => {
    await page.waitForTimeout(150);
    return locator.boundingBox({ timeout: 1000 });
  });
  const stable = box === null || box2 === null
    ? null
    : box.x === box2.x && box.y === box2.y && box.width === box2.width && box.height === box2.height;

  const viewport = page.viewportSize() ?? VIEWPORT;

  /**
   * The occlusion check, run **on the element** rather than on the page.
   *
   * The first version compared `elementFromPoint`'s tag against the target's
   * and reported `span.button-text` and `svg` as occluders — the element's own
   * children, which is what a hit test on a button with an icon inside it
   * returns. A descendant is not something painted on top; `el.contains(hit)`
   * is the question, and comparing rendered descriptions was a string stand-in
   * for it (§13, the substring-for-token family).
   *
   * `inViewport` is the **centre point**, not the whole box: the centre is what
   * a click targets and what `elementFromPoint` is asked about, so a box hanging
   * one pixel over the fold is not the thing being measured.
   */
  const hitTest = await ask(() => locator.evaluate((el, vp) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const centreInViewport = cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height;
    const hit = document.elementFromPoint(cx, cy);
    const describe = (node) =>
      `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}` +
      `${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`;
    if (hit === null) {
      return {
        centreInViewport,
        // Distinguished from an occluder on purpose: `elementFromPoint` returns
        // null when the point is outside the viewport, so this is a different
        // fact from "something else is on top" and must not be tallied with it.
        occludedBy: centreInViewport ? 'nothing at the centre point' : 'centre is outside the viewport',
      };
    }
    return {
      centreInViewport,
      occludedBy: hit === el || el.contains(hit) ? null : describe(hit),
    };
  }, viewport, { timeout: 1000 }));

  const inViewport = hitTest === null ? null : hitTest.centreInViewport;
  const occludedBy = hitTest === null ? null : hitTest.occludedBy;

  /**
   * The discriminating measurement, and the last thing done to this page.
   *
   * 49 of 51 timeouts were on an element whose centre sits outside the
   * viewport. Two explanations fit that equally well — Playwright cannot scroll
   * it into view, or it scrolls fine and something intercepts once it is there
   * — and a fourth hypothesis is what the ruling forbids. So the page is asked:
   * scroll, then look again.
   *
   * `runProbe` closes the page immediately after this returns, which is what
   * makes it safe to mutate: a scroll changes what a later probe would see, and
   * the failure rate is suspected to depend on position in the loop, so an
   * instrument that leaked into the next probe would be measuring itself.
   */
  const scrollIntoView = box === null
    ? null
    : (await ask(async () => {
        await locator.scrollIntoViewIfNeeded({ timeout: 1500 });
        return 'succeeded';
      })) ?? 'failed';
  const afterScroll = scrollIntoView === 'succeeded' ? await ask(() => locator.evaluate((el, vp) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      centreInViewport: cx >= 0 && cy >= 0 && cx <= vp.width && cy <= vp.height,
      occludedBy: hit === null
        ? null
        : hit === el || el.contains(hit)
          ? null
          : `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}` +
            `${typeof hit.className === 'string' && hit.className ? `.${hit.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`,
    };
  }, viewport, { timeout: 1000 })) : null;

  return {
    step,
    selector: candidate.interaction.selector,
    attemptIndex,
    visible: await ask(() => locator.isVisible({ timeout: 1000 })),
    stable,
    // `null` when the hit test could not run at all — reporting `false` would
    // invent an occlusion that was never observed.
    receivesPointerEvents: hitTest === null ? null : occludedBy === null,
    enabled: await ask(() => locator.isEnabled({ timeout: 1000 })),
    inViewport,
    navigationPending,
    occludedBy,
    scrollIntoView,
    inViewportAfterScroll: afterScroll === null ? null : afterScroll.centreInViewport,
    occludedByAfterScroll: afterScroll === null ? null : afterScroll.occludedBy,
  };
}

/**
 * Fire one control and record the transition (§6's behaviour probing).
 *
 * The tuple this writes — `{preHash, action, postHash, networkCalls, urlChanged}`
 * — *is* the functional specification §9's behavioural gate replays. Each probe
 * runs in a fresh page so probes cannot contaminate each other's preconditions.
 */
async function runProbe({ ctx, routeId, record, candidate, flowId, label, cssomClasses, attemptIndex = 0, destructive = false }) {
  let ran = false;
  // unguarded: guarded on the next line
  const page = await ctx.newPage();
  installEscapeGuards(page, { onBlocked });
  attachRecorders(page, { current: routeId });
  /**
   * Whether a main-frame navigation was in flight when the click gave up.
   *
   * A page navigating under the probe is the one hypothesis of the three in
   * 0024 §2 that the artifact could never confirm or refute, because nothing
   * recorded it. Counted rather than flagged: the `goto` at the top of every
   * probe is one, so "a navigation happened" is not the question — "one was
   * still open" is.
   */
  let navigationsStarted = 0;
  let navigationsSettled = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navigationsSettled += 1; });
  page.on('request', (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigationsStarted += 1;
  });
  let locator = null;
  try {
    /**
     * `domcontentloaded`, not `networkidle`.
     *
     * This target registers a service worker and polls in the background, so
     * network idle is not a state it reliably reaches, and a 15s ceiling per
     * probe on a state that may never arrive is the wrong shape whatever else
     * is true. **It is not why the probes time out** — that was the third of
     * three wrong diagnoses, and `step()` below settled the question by
     * labelling the operation: all 51 failures are `click/timeout`, not
     * `goto/timeout`. Kept because it is right on its own terms and faster;
     * claimed as nothing more.
     */
    await step('goto', () =>
      page.goto(`${ORIGIN}${record.plan.path}`, { waitUntil: 'domcontentloaded', timeout: 15_000 }));
    await page.waitForTimeout(900);
    locator = page.getByRole(candidate.a11y.role, { name: candidate.a11y.name, exact: true }).first();
    if ((await locator.count()) === 0) {
      // A control discovered on the captured page and absent from the freshly
      // loaded one. It was never a console line and never a record either — a
      // silent drop that survived because the session-destructive branch was
      // the only caller that noticed a `false` return.
      recordUndriveable({
        routeId, candidate, label, kind: 'locate/not-found',
        diagnostic: {
          step: 'locate/not-found', selector: candidate.interaction.selector, attemptIndex,
          visible: null, stable: null, receivesPointerEvents: null, enabled: null,
          inViewport: null, navigationPending: navigationsStarted > navigationsSettled,
          occludedBy: null, scrollIntoView: null, inViewportAfterScroll: null, occludedByAfterScroll: null,
        },
      });
      await page.close();
      return false;
    }

    const snap = async () => page.evaluate(() => ({
      url: location.href,
      html: document.documentElement.outerHTML,
      classes: [...document.querySelectorAll('*')].map((e) => e.className).join('|'),
      attrs: [...document.querySelectorAll('*')]
        .map((e) => [...e.attributes].map((a) => `${a.name}=${a.value}`).join(',')).join('|'),
      // Per-element, as an array so it diffs positionally. A JS-driven state
      // need not touch a class at all, and a detector reading only class diffs
      // finds nothing there while reporting success.
      inlineStyles: [...document.querySelectorAll('*')].map((e) => e.getAttribute('style') ?? ''),
    }));

    await settle(2000);
    const before = await step('snap-before', snap);
    const netBefore = observations.length;
    await step('click', () => locator.click({ timeout: 5000 }));
    // §6 says network idle or 2s. `networkidle` alone is not enough: on an
    // already-idle page it resolves before the click's fetch is even issued.
    await page.waitForTimeout(400);
    // operational: a settle timeout is expected on a page holding a connection open; the snapshot is taken either way
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    await settle(2000);
    const after = await step('snap-after', snap);

    // Second layer behind the router chokepoint. If this fires, the interceptor
    // has a hole — a defect, not a classification.
    // operational: a page on about:blank has no origin to compare
    const afterOrigin = (() => { try { return new URL(after.url).origin; } catch { return null; } })();
    if (afterOrigin && !ALLOWED_ORIGINS.has(afterOrigin)) {
      finding('origin-guard-hole', `${label} reached ${afterOrigin} — the interceptor did not stop it`);
    }

    const networkCalls = observations.slice(netBefore);
    const snapshot = (state, hash) => ({
      url: state.url, routeId, domHash: hash, a11yHash: S.shortHash(state.attrs), focusedRef: null,
    });

    ran = true;
    flows.set(flowId, {
      ...envelope('flow-trace'),
      flowId, siteId: TARGET.siteId, kind: 'probe',
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
        pre: snapshot(before, S.shortHash(before.html)),
        post: snapshot(after, S.shortHash(after.html)),
        domDelta: { addedNodeIds: [], removedNodeIds: [], attributeChanges: [], textChanges: [], styleChanges: [] },
        a11yDelta: { added: [], removed: [], changed: [] },
        networkCalls: networkCalls.map((o) => ({
          endpointId: null, method: o.method, url: scrubDeep(o.url),
          pathPattern: new URL(o.url).pathname, status: o.status,
          isMutation: !['GET', 'HEAD', 'OPTIONS'].includes(o.method),
        })),
        urlChanged: before.url !== after.url,
        waitStrategy: 'network-idle',
      }],
      outcome: 'completed', destructive, gapIds: [],
    });

    // A change no extracted CSSOM rule mentions is JS-driven, which is the only
    // case §6 reserves probing for. Two shapes, and the second was invisible
    // until rung 3: a class the stylesheet does not describe, or an inline style
    // with no class involved at all.
    if (before.html !== after.html) {
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
      if (unexplainedClasses.length > 0 || attributeChanges.length > 0) {
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
    // Two error classes and only one may be caught (§13). A candidate that
    // cannot be driven is operational — a timeout, a detached element, a page
    // that navigated away. Anything else is a defect and must propagate: this
    // catch in rung 3 once swallowed a ReferenceError thrown *after* the flow
    // was recorded, so every probe reported success while the state detection
    // behind it silently never ran.
    rethrowIfDefect(err);
    // `precondition-unmet`, which is a different and honest claim from "we
    // declined to fire it" — nothing here was declined. Recorded structurally
    // rather than as a bare finding, because §13's rule about a gap in prose
    // applies: infer can still look for this control's handler in the source,
    // and it cannot read a console line.
    const kind = `${err instanceof ProbeStepError ? err.stepName : 'unknown-step'}/${operationalKind(err) ?? 'unknown'}`;
    // And the next question down: which of the click's four preconditions was
    // never met. Instrument, do not diagnose — the distribution is the answer,
    // and it is written into the artifact rather than argued about here.
    const diagnostic = locator === null
      ? {
          step: kind, selector: candidate.interaction.selector, attemptIndex,
          visible: null, stable: null, receivesPointerEvents: null, enabled: null,
          inViewport: null, navigationPending: navigationsStarted > navigationsSettled,
          occludedBy: null, scrollIntoView: null, inViewportAfterScroll: null, occludedByAfterScroll: null,
        }
      : await diagnoseUndriveable({
          page, locator, candidate, step: kind, attemptIndex,
          navigationPending: navigationsStarted > navigationsSettled,
        });
    recordUndriveable({ routeId, candidate, label, kind, diagnostic });
  }
  await settle(2000);
  await page.close();
  return ran;
}

/**
 * Probe one route's controls, in the order the scheduler says.
 *
 * Phase ordering is `planProbeSchedule`'s and not this loop's: ordinary, then
 * session-destructive, then target-destructive. A fresh *page* does not undo a
 * mutation, so a destructive probe firing early would empty the store for every
 * probe after it — §6's "probes cannot contaminate each other's preconditions"
 * is about the browser, not the server.
 */
async function probeRoute({ browser, storageState, routeId, record }) {
  const candidates = record.captured.built.filter(
    (n) => n.nodeType === 'element' && n.interaction && n.a11y && n.a11y.name.trim().length > 0,
  );
  // Distinct by (role, name): an SPA renders the same control in a list many
  // times, and firing forty identical "Done" buttons measures one transition
  // forty times while spending the whole budget.
  const distinct = [...new Map(candidates.map((c) => [`${c.a11y.role}:${c.a11y.name}`, c])).values()];
  const cssomClasses = selectorClassNames(record.captured.stateRules.map((r) => r.selector));

  const schedule = planProbeSchedule({
    controls: distinct,
    hazardOf: (candidate) =>
      classifyControlHazard({
        name: candidate.a11y.name,
        href: candidate.attributes?.href,
        isSameOrigin: (href) => sameOrigin(href, ORIGIN),
      }).hazard,
    allowDestructive: ALLOW_DESTRUCTIVE,
    neverFire: (candidate) => NEVER_FIRE_NAMES.includes(candidate.a11y.name.toLowerCase()),
    policy: 'credentialed',
  });

  const ctx = await guardContext(await browser.newContext({
    viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
    reducedMotion: 'reduce', storageState,
  }));
  let fired = 0;
  let attempted = 0;
  let sessionFired = 0;
  for (const { control: candidate, phase, fire, declineReason } of schedule) {
    const label = `${candidate.a11y.role} "${candidate.a11y.name}"`;
    const flowId = `probe-${S.shortHash(`${routeId}:${label}`).slice(0, 10)}`;
    const { matchedTerm, outOfScopeTarget } = classifyControlHazard({
      name: candidate.a11y.name,
      href: candidate.attributes?.href,
      isSameOrigin: (href) => sameOrigin(href, ORIGIN),
    });

    if (!fire) {
      if (declineReason === 'target-destructive' || declineReason === 'out-of-scope') {
        recordSkip({ routeId, record, candidate, flowId, label, cause: declineReason, matchedTerm, outOfScopeTarget });
      }
      continue;
    }

    /**
     * Session-destructive: fire it, and **never from the shared context**.
     *
     * §6 and decision 0011: the harm is to us, not to the target, so it must be
     * captured — `POST /api/v1/user/token` and logout are ordinary endpoints §8
     * has to implement and §10's auth tasks depend on them. But a disposable
     * *context* is not enough: `storageState` carries the cookie while the
     * session lives on the server, so cloning the crawl's state and clicking
     * "Sign out" ends the crawl's session too.
     *
     * Each one therefore gets its own login, and only that session dies. This
     * target has a scripted sign-in, so the policy is `credentialed` and the
     * crawl survives; under §6's `interactive` policy there is one session to
     * spend and the scheduler caps this at one, after everything else.
     *
     * Not exercised on Vikunja today — its sign-out sits behind a menu and no
     * candidate's accessible name matches the terms, so
     * `coverage.observed.sessionDestructiveControls` is 0 and the invariant is
     * vacuous. Written because the scheduler will hand one over the moment a
     * target has one, and firing it in the shared context would silently end
     * every probe after it.
     */
    if (phase === 'session-destructive') {
      const ownState = await acquireStorageState(browser);
      const ownCtx = await guardContext(await browser.newContext({
        viewport: VIEWPORT, userAgent: UA, locale: 'en-US', timezoneId: 'UTC',
        reducedMotion: 'reduce', storageState: ownState,
      }));
      const ran = await runProbe({
        ctx: ownCtx, routeId, record, candidate, flowId, label, cssomClasses, attemptIndex: attempted,
      });
      await ownCtx.close();
      if (ran) sessionFired += 1;
      continue;
    }

    if (fired >= MAX_PROBES_PER_ROUTE || attempted >= MAX_ATTEMPTS_PER_ROUTE) {
      budgetDeclined += 1;
      continue;
    }
    // Position in this route's loop, passed down because it is the variable the
    // failure rate appears to depend on and the one a single-shot reproduction
    // structurally cannot vary (§13).
    const attemptIndex = attempted;
    attempted += 1;
    if (await runProbe({ ctx, routeId, record, candidate, flowId, label, cssomClasses, attemptIndex })) fired += 1;
  }
  await ctx.close();
  return { fired, attempted, sessionFired, candidates: distinct.length };
}

/**
 * The distribution, not the first case.
 *
 * Three diagnoses of these timeouts were wrong in a row, each argued from one
 * example, and the ruling that followed was to instrument and then look at the
 * *shape*. So this prints margins rather than a verdict: which precondition was
 * unmet, and how the failures fall across position in the route's loop.
 *
 * There is deliberately no conclusion drawn here and none written into the
 * artifact. A distribution with no explanation is an honest deliverable; a
 * fourth hypothesis is not.
 */
function reportUndriveableDistribution() {
  /**
   * The ceiling first, because it is the number that constrains every later
   * stage: a control that never resolved has no transition for §9 to replay and
   * no observation for §7.6 to build on. Printed beside the crawl's coverage
   * rather than buried in the findings, per ruling 3.
   */
  const completed = [...flows.values()].filter((f) => f.outcome === 'completed').length;
  const reachable = completed + undriveable.length;
  const pct = reachable === 0 ? 0 : Math.round((completed / reachable) * 100);
  console.log(
    `\n  behaviour ceiling: ${completed} of ${reachable} driven control(s) produced a transition (${pct}%)` +
    ` · ${undriveable.length} would not resolve · ${budgetDeclined} declined on budget`,
  );
  if (undriveable.length === 0) {
    console.log('  undriveable: none');
    return;
  }
  const tally = (of) => {
    const counts = {};
    for (const d of undriveable) {
      const key = String(of(d));
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k} ${n}`)
      .join(' · ');
  };

  console.log(`\n  undriveable: ${undriveable.length}, by what was true when the action gave up`);
  console.log(`    step              ${tally((d) => d.step)}`);
  console.log(`    visible           ${tally((d) => d.visible)}`);
  console.log(`    stable            ${tally((d) => d.stable)}`);
  console.log(`    receives pointer  ${tally((d) => d.receivesPointerEvents)}`);
  console.log(`    enabled           ${tally((d) => d.enabled)}`);
  console.log(`    in viewport       ${tally((d) => d.inViewport)}`);
  console.log(`    navigation open   ${tally((d) => d.navigationPending)}`);
  console.log(`    occluded by       ${tally((d) => d.occludedBy ?? '(nothing)')}`);
  // The discriminator: did the page scroll it into view when asked, and was
  // anything on top of it once it got there.
  console.log(`    scrollIntoView    ${tally((d) => d.scrollIntoView ?? '(not attempted)')}`);
  console.log(`    in view after     ${tally((d) => d.inViewportAfterScroll)}`);
  console.log(`    occluded after    ${tally((d) => d.occludedByAfterScroll ?? '(nothing)')}`);
  // The variable no single-shot reproduction can vary. Bucketed rather than
  // listed, because the question is whether the rate rises with position.
  console.log(`    attempt index     ${tally((d) => `${Math.floor(d.attemptIndex / 4) * 4}-${Math.floor(d.attemptIndex / 4) * 4 + 3}`)}`);
}

/**
 * Land the anonymous probe page on the login route.
 *
 * The SPA redirects itself the moment it finds no token, so a `goto` here races
 * the bundle's own navigation and Playwright rejects with "interrupted by
 * another navigation". That is the page doing exactly what it is supposed to,
 * not a failure to land — and the `waitForURL` below is what actually
 * establishes that we got there, so the rejection is operational and the
 * outcome is still checked.
 *
 * Narrow on purpose: only the interruption is tolerated. A refused connection
 * or a real timeout still propagates, because a probe page that never loaded
 * would make every anonymous verdict `unknown`, and §8 resolves `unknown` for a
 * read to *required* only because this sweep is trusted to have run.
 */
async function landOnLogin(page) {
  try {
    await page.goto(`${ORIGIN}${TARGET.loginPath}`, { waitUntil: 'networkidle', timeout: 20_000 });
  } catch (err) {
    // operational: the SPA navigated itself while we were navigating to the same place
    if (!/interrupted by another navigation/i.test(String(err))) throw err;
  }
  // Whatever the goto did, this is the assertion that we are somewhere the
  // in-page `fetch` can run from — same origin, document loaded.
  await page.waitForLoadState('domcontentloaded');
  const landed = new URL(page.url()).origin === ORIGIN;
  if (!landed) throw new Error(`the anonymous probe page ended up at ${page.url()}, not on ${ORIGIN}`);
}

async function main() {
  requireDocker();
  assertPermitted(ORIGIN);
  console.log(`\ncapture — ${TARGET_ID} at ${PIN.image}\n`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'network'), { recursive: true });
  mkdirSync(join(OUT, 'auth'), { recursive: true });

  if (REUSE_CONTAINER) {
    // Asserted, not assumed: crawling a container that is not there produces a
    // capture of connection errors, and this flag exists to make two runs
    // comparable — a run against nothing is comparable to nothing.
    // operational: the absent container is the condition being detected here, not an error to propagate
    const probe = await fetch(`${ORIGIN}${TARGET.apiPrefix}/info`).catch(() => null);
    if (probe?.status !== 200) {
      throw new Error(`--reuse-container was passed but nothing is serving ${ORIGIN}${TARGET.apiPrefix}/info`);
    }
  } else {
    await boot();
  }
  const api = (path, init) => fetch(`${ORIGIN}${path}`, init);
  if (REUSE_CONTAINER) {
    // Already seeded by the crawl that booted it. Re-registering the fixture
    // account against a live instance fails, and the point of holding the
    // container is that its state does not move between crawls.
    console.log('  seeded (by the crawl holding this container)');
  } else {
    await PIN.seed({ origin: ORIGIN, api });
    console.log('  seeded');
  }

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
     * §6's behaviour probing, before the anonymous re-issue.
     *
     * The probes generate real observations, so they run while the credentialed
     * session is live and *before* the anonymous sweep — a probe's traffic is
     * ordinary crawl traffic and belongs in the endpoint index, while the
     * sweep's is deliberately uncredentialed and is tagged as such.
     */
    for (const [routeId, record] of routes) {
      const { fired, attempted, sessionFired, candidates } = await probeRoute({
        browser, storageState: state, routeId, record,
      });
      console.log(
        `  probe ${routeId.padEnd(34)} ${String(fired).padStart(2)} fired of ${String(attempted).padStart(2)} attempted, ` +
        `${String(candidates).padStart(3)} distinct candidate(s)` +
        (sessionFired > 0 ? ` · ${sessionFired} session-destructive on their own login` : ''),
      );
    }
    await settle();
    reportUndriveableDistribution();
    console.log(
      `  flows: ${flows.size} (${[...flows.values()].filter((f) => f.outcome === 'skipped').length} skipped) · ` +
      `skipped controls: ${skippedControls.length} · budget-declined: ${budgetDeclined}` +
      (lostObservations > 0 ? ` · observations lost to a closing page: ${lostObservations}` : ''),
    );

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
    await landOnLogin(anonPage);
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
        await landOnLogin(anonPage);
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
  if (!REUSE_CONTAINER && !HOLD_CONTAINER) docker('rm', '-f', CONTAINER);

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
/**
 * §6's probe loop now runs, so the warning that said it did not is gone.
 *
 * What remains is a *budget*, which is a different and smaller claim: a Vikunja
 * route offers 133–807 interaction candidates and firing all of them is not
 * affordable, so `MAX_PROBES_PER_ROUTE` caps it and the count declined for
 * budget is reported. A shallow pass and a thorough one that found nothing must
 * not render identically.
 */
const warnings = [
  ...(lostObservations === 0 ? [] : [{
    code: 'observations-lost-to-page-close',
    message:
      `${lostObservations} response(s) arrived after the page that requested them had closed, so the exchange was not recorded. A probe ends by closing its page, so a few are expected; a large number means the settle window is too short and the endpoint index is missing traffic — which is a silent drop, and the reason this is counted rather than swallowed.`,
  }]),
  ...(budgetDeclined === 0 ? [] : [
  {
    code: 'probe-budget-reached',
    message:
      `${budgetDeclined} fireable control(s) were not probed because a per-route budget was spent (${MAX_PROBES_PER_ROUTE} successes or ${MAX_ATTEMPTS_PER_ROUTE} attempts, whichever came first). Their transitions are unknown and no flow was written for them — this is a limit of the driver, not a property of the target, and the number is here so a shallow probe pass is visible rather than indistinguishable from a thorough one that found nothing.`,
  }]),
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
  // CSSOM-derived states plus anything probing found that no rule explains.
  const entries = [...captured.stateEntries, ...(probedStates.get(routeId) ?? [])];
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

/**
 * The bodies, on disk, content-addressed — §6's "persist **every** response
 * body", which this driver had never done.
 *
 * The writer is shared with rung 3 (`writeAssetBodies`), because whether an
 * asset is text the scrubber may rewrite is a judgement two crawlers must not
 * be able to disagree about, and §13 has already been bitten by that once.
 */
const { entries: assetEntries, files: assetFiles } = writeAssetBodies({
  allAssets,
  outDir: OUT,
  fs: { mkdirSync, writeFileSync },
  isTextualAsset,
  assetKind,
});

/**
 * The index and the directory, reconciled both ways.
 *
 * The disk side is a `readdirSync`, not the list the writer just built: a
 * writer compared against its own record of what it wrote agrees with itself
 * whatever it actually did, which is the same shape as an invariant counting
 * its input with the extractor's own parser (§6).
 */
{
  const dir = join(OUT, 'assets', 'files');
  const onDisk = existsSync(dir)
    ? readdirSync(dir).map((name) => `assets/files/${name}`)
    : [];
  const hashOnDisk = Object.fromEntries(
    onDisk.map((rel) => [rel, sha256(readFileSync(join(OUT, rel)))]),
  );
  const bodies = assessAssetBodies({ entries: assetFiles, onDisk, hashOnDisk });
  for (const path of bodies.indexedWithoutFile) {
    finding('asset-body-missing', `${path} is indexed and was never written — the index describes a file it does not contain`);
  }
  for (const path of bodies.fileWithoutEntry) {
    finding('asset-body-orphan', `${path} is on disk and in no index entry — nothing can reach it and nothing will clean it up`);
  }
  for (const path of bodies.misaddressed) {
    finding('asset-body-misaddressed', `${path} does not hash to what its entry says was stored`);
  }
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
  /**
   * Session-destructive controls **discovered**, counted from the classifier
   * over every candidate — deliberately not from the firing pass, because §13
   * requires an invariant's observed side to be derived independently of the
   * extraction it checks. Counting what was fired would move both sides
   * together and the invariant would go vacuous instead of failing.
   */
  sessionDestructiveControls: [...routes.values()].reduce(
    (n, r) =>
      n +
      [...new Map(
        r.captured.built
          .filter((x) => x.nodeType === 'element' && x.interaction && x.a11y && x.a11y.name.trim().length > 0)
          .map((x) => [`${x.a11y.role}:${x.a11y.name}`, x]),
      ).values()].filter((x) =>
        SESSION_DESTRUCTIVE_TERMS.some((t) => x.a11y.name.toLowerCase().includes(t)),
      ).length,
    0,
  ),
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
  // Fired, from the flows actually written. The other side of the invariant.
  /**
   * The behaviour ceiling (0026 §3, ruling 3). Not a defect count: a control
   * that cannot be driven is one §9's behavioural gate can never replay and
   * §7.6 has to recover from source or not at all, so it caps what any
   * downstream stage can learn about this target.
   */
  controlsFired: [...flows.values()].filter((f) => f.outcome === 'completed').length,
  controlsUndriveable: undriveable.length,
  sessionDestructiveFired: [...flows.values()].filter(
    (f) => f.outcome === 'completed' && f.destructive === false &&
      SESSION_DESTRUCTIVE_TERMS.some((t) => f.name.toLowerCase().includes(t)),
  ).length,
  a11yNodes: [...routes.values()].reduce((n, r) => n + r.captured.built.filter((x) => x.a11y).length, 0),
};
const invariants = S.evaluateCoverage(observed, extracted);
const broken = invariants.filter((i) => !i.vacuous && !i.holds);
write('coverage.json', S.CoverageReportSchema, {
  ...envelope('coverage-report'),
  siteId: TARGET.siteId, routeIds: [...routes.keys()], observed, extracted, invariants,
});

for (const [flowId, flow] of flows) {
  write(`flows/${flowId}.trace.json`, S.FlowTraceSchema, flow);
}

write('flows/skipped-controls.json', S.SkippedControlIndexSchema, {
  ...envelope('skipped-control-index'), siteId: TARGET.siteId, controls: skippedControls,
});

write('manifest.json', S.CaptureManifestSchema, {
  ...envelope('capture-manifest'),
  siteId: TARGET.siteId,
  target: { entryUrl: `${ORIGIN}/`, origin: ORIGIN },
  permission: { source: 'allowlist', matchedEntry: '127.0.0.1' },
  contexts: CONTEXTS,
  userAgent: UA,
  determinism: {
    // Both halves from the constants the shim itself uses. A hand-written list
    // beside an uninstalled shim is what this manifest said for three crawls.
    seed: SEED, frozenEpochMs: FROZEN_EPOCH_MS,
    frozenTimezone: 'UTC', frozenLocale: 'en-US',
    frozen: DETERMINISM_FROZEN,
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
  flowIds: [...flows.keys()],
  contentHash: sha256([...routeArtifacts.values()].map((r) => r.meta.content.contentHash).sort().join('\n')),
  counts: {
    contexts: CONTEXTS.length, routes: routes.size, capturedRoutes: routes.size,
    patterns: new Set([...routes.values()].map((r) => r.plan.urlPattern)).size,
    assets: Object.keys(assetEntries).length, endpoints: endpoints.length,
    flows: flows.size, gaps: gaps.length,
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
