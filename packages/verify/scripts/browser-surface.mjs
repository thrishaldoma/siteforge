#!/usr/bin/env node
/**
 * Does this target's **browser** talk to the API its document describes?
 *
 * The question 0015 §1 never asked, and the one that decides whether a ground
 * truth can ground anything. Infer's input is a capture — what a Playwright
 * crawl saw on the wire. If the site's pages never call the documented surface,
 * then every endpoint infer emits is out-of-universe, every scored category has
 * an empty model side, and the grade reports vacuous across the board. Not a bad
 * score: no score.
 *
 * It is the modality rule one level up. 0015 established that a document grounds
 * a claim about declared shape and only observation grounds a claim about
 * runtime behaviour. This adds: **neither grounds a claim about a surface the
 * crawl never reaches.** Auth failed the first test; the whole of Gitea fails
 * this one.
 *
 * So it is a **selection criterion** for a ground truth, and criteria are
 * measured rather than assumed — cheaply, before anyone transcribes a baseline
 * or writes a capture driver for a target that cannot be scored. The stronger
 * form is the one that matters: not "is the path under the base path" but
 * **"does the document declare an operation of this shape"**, because that is
 * exactly what the grader will try to match against.
 *
 *   node browser-surface.mjs                    # read the committed measurements
 *   node browser-surface.mjs --write <target>   # boot, seed, crawl, re-measure
 *
 * Needs Docker and a browser, so it is milestone-gate work like the snapshot
 * script beside it. The committed JSON is what `verify:clean` reads.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PIN } from './gitea-snapshot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const recordPath = (id) => join(FIXTURES, id, 'browser-surface.json');

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One candidate ground truth, with everything needed to reproduce its number.
 *
 * The launch, the seed and the page list are all pinned here for the reason the
 * snapshot script pins its container: a crawl that varies produces a number
 * meaning "we looked somewhere else" that reads as "the site changed".
 *
 * Credentials are fixture-local by construction — this script creates the
 * container and throws it away, so these are not credentials for anything (§3.3
 * governs a *target's* credentials, which are never written down).
 */
const TARGETS = {
  gitea: {
    image: PIN.image,
    containerPort: PIN.containerPort,
    port: 3803,
    env: PIN.env,
    rootUrlEnv: 'GITEA__server__ROOT_URL',
    /** Where the document lives, and how to get it. */
    spec: { path: '/swagger.v1.json', auth: 'none' },
    universe: PIN.basePath,
    readyPath: '/api/v1/version',
    async seed({ origin, api }) {
      docker('exec', '-u', 'git', 'sf-surface-gitea', 'gitea', 'admin', 'user', 'create',
        '--username', 'sfadmin', '--password', 'sf-local-fixture-only',
        '--email', 'sfadmin@localhost.test', '--admin', '--must-change-password=false');
      const basic = Buffer.from('sfadmin:sf-local-fixture-only').toString('base64');
      const post = (path, body) => api(path, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await post('/api/v1/user/repos', { name: 'hello', description: 'seeded fixture', private: false, auto_init: true, default_branch: 'main' });
      for (const label of [
        { name: 'bug', color: 'd73a4a', description: 'Something is not working' },
        { name: 'enhancement', color: 'a2eeef', description: 'New feature or request' },
        { name: 'question', color: 'd876e3', description: 'Further information is requested' },
      ]) await post('/api/v1/repos/sfadmin/hello/labels', label);
      for (const milestone of [
        { title: 'v0.1', description: 'first cut', state: 'open' },
        { title: 'v0.2', description: 'second', state: 'open' },
      ]) await post('/api/v1/repos/sfadmin/hello/milestones', milestone);
      for (let i = 1; i <= 4; i += 1) {
        await post('/api/v1/repos/sfadmin/hello/issues', { title: `Seeded issue ${i}`, body: `body ${i}`, labels: [1] });
      }
      void origin;
    },
    /** Signed out: it is the weaker claim, and it already settles the question. */
    login: null,
    pages: [
      '/', '/explore/repos', '/explore/users', '/user/login',
      '/sfadmin/hello', '/sfadmin/hello/issues', '/sfadmin/hello/issues/1',
      '/sfadmin/hello/labels', '/sfadmin/hello/milestones',
      '/sfadmin/hello/releases', '/sfadmin/hello/activity', '/sfadmin',
    ],
  },

  directus: {
    image: 'directus/directus@sha256:eb326f679ae847c0a776f93b972761dc2ebe84980e0b9d274a6bc31cd62809f7',
    tagAtPull: '11',
    containerPort: 8055,
    port: 3810,
    env: {
      KEY: 'sf-local-key',
      SECRET: 'sf-local-secret',
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: 'sf-local-fixture-only',
      DB_CLIENT: 'sqlite3',
      DB_FILENAME: '/tmp/data.db',
      WEBSOCKETS_ENABLED: 'false',
    },
    rootUrlEnv: 'PUBLIC_URL',
    spec: { path: '/server/specs/oas', auth: 'bearer' },
    /** Its API is served at the root; `/admin` is the SPA in front of it. */
    universe: '/',
    readyPath: '/server/health',
    seed: null,
    /**
     * Signed in, because the admin SPA is the whole browser surface — an
     * anonymous crawl of Directus sees a login screen and nothing else, so the
     * signed-out measurement would be vacuous rather than informative. The
     * asymmetry with Gitea is the finding, not an inconsistency.
     */
    login: async (page, origin) => {
      await page.goto(`${origin}/admin/login`, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.fill('input[type="email"]', 'admin@example.com');
      await page.fill('input[type="password"]', 'sf-local-fixture-only');
      await page.keyboard.press('Enter');
      await wait(4000);
    },
    pages: [
      '/admin/content', '/admin/users', '/admin/files', '/admin/settings/data-model',
      '/admin/settings/roles', '/admin/activity', '/admin/settings/project',
    ],
  },
};

// ---------------------------------------------------------------------------

/** Every parameter-looking segment to a positional hole. The grader's own key. */
const shapeOf = (path) =>
  path
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) =>
      (s.startsWith('{') && s.endsWith('}')) ||
      /^\d+$/.test(s) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/.test(s)
        ? '*'
        : s,
    )
    .join('/');

const METHODS = ['get', 'post', 'patch', 'put', 'delete'];

/** `METHOD shape` for every operation the document declares, Swagger 2 or OAS 3. */
function declaredOperations(spec) {
  const base = typeof spec.basePath === 'string' ? spec.basePath : '';
  const out = new Set();
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(item)) {
      if (!METHODS.includes(method)) continue;
      out.add(`${method.toUpperCase()} ${shapeOf(`${base}${path}`)}`);
    }
  }
  return out;
}

const methodOf = (entry) => entry.slice(0, entry.indexOf(' '));
const pathOf = (entry) => entry.slice(entry.indexOf(' ') + 1);

async function boot(id, target) {
  const name = `sf-surface-${id}`;
  docker('rm', '-f', name);
  const origin = `http://localhost:${target.port}`;
  const env = Object.entries({ ...target.env, [target.rootUrlEnv]: `${origin}/` }).flatMap(
    ([k, v]) => ['-e', `${k}=${v}`],
  );
  const run = docker('run', '-d', '--name', name, '-p', `${target.port}:${target.containerPort}`, ...env, target.image);
  if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);

  const api = (path, init) => fetch(`${origin}${path}`, init);
  for (let i = 0; i < 90; i += 1) {
    // operational: the container is not listening yet; that is what the loop is for
    const probe = await api(target.readyPath).catch(() => null);
    if (probe?.status === 200) return { name, origin, api };
    await wait(1000);
  }
  throw new Error(`${id} never answered ${target.readyPath}`);
}

/** The document, fetched from the running instance rather than read about. */
async function fetchSpec(target, origin, api) {
  if (target.spec.auth === 'none') {
    const response = await api(target.spec.path);
    return JSON.parse(await response.text());
  }
  const login = await api('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: target.env.ADMIN_EMAIL, password: target.env.ADMIN_PASSWORD }),
  });
  const token = JSON.parse(await login.text()).data.access_token;
  const response = await api(target.spec.path, { headers: { Authorization: `Bearer ${token}` } });
  void origin;
  return JSON.parse(await response.text());
}

/** Crawl the page list and record every path the browser asked the server for. */
async function measure(target, origin) {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const xhr = new Set();
  context.on('request', (request) => {
    const type = request.resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;
    xhr.add(`${request.method()} ${new URL(request.url()).pathname}`);
  });

  const formActions = new Set();
  const page = await context.newPage();
  if (target.login) await target.login(page, origin);
  for (const path of target.pages) {
    // operational: a page that will not load is a page with no surface to record
    await page.goto(origin + path, { waitUntil: 'networkidle', timeout: 30_000 }).catch(() => {});
    await wait(1000);
    // `$$eval` is Playwright's DOM query — it runs the callback in the page, and
    // is unrelated to JavaScript's `eval`.
    const forms = await page
      .$$eval('form', (fs) =>
        fs.map((f) => `${(f.getAttribute('method') ?? 'GET').toUpperCase()} ${f.getAttribute('action') ?? '(self)'}`),
      )
      .catch(() => []);
    for (const form of forms) formActions.add(form);
  }
  await browser.close();
  return { xhr: [...xhr].sort(), formActions: [...formActions].sort() };
}

async function remeasure(id) {
  const target = TARGETS[id];
  if (target === undefined) {
    throw new Error(`no such target '${id}'. Known: ${Object.keys(TARGETS).join(', ')}`);
  }
  console.log(`\nbrowser surface — does ${id}'s browser call the API its document describes?\n`);
  let observed;
  let declared;
  const { name, origin, api } = await boot(id, target);
  try {
    if (target.seed) await target.seed({ origin, api });
    declared = declaredOperations(await fetchSpec(target, origin, api));
    observed = await measure(target, origin);
  } finally {
    docker('rm', '-f', name);
  }

  const entries = [...observed.xhr, ...observed.formActions];
  const describedBy = (entry) => declared.has(`${methodOf(entry)} ${shapeOf(pathOf(entry))}`);
  const described = entries.filter(describedBy);

  const record = {
    target: id,
    image: target.image,
    universe: target.universe,
    measuredAt: new Date().toISOString().slice(0, 10),
    signedIn: target.login !== null,
    pages: target.pages,
    declaredOperations: declared.size,
    xhr: observed.xhr,
    formActions: observed.formActions,
    /** The strong criterion: the document declares an operation of this shape. */
    describedByDocument: described,
    verdict: described.length === 0 ? 'disjoint' : 'overlapping',
  };
  writeFileSync(recordPath(id), `${JSON.stringify(record, null, 2)}\n`);

  console.log(`  document          ${declared.size} operation shape(s)`);
  console.log(`  pages crawled     ${target.pages.length}${target.login ? ' (signed in)' : ' (signed out)'}`);
  console.log(`  XHR/fetch paths   ${observed.xhr.length}`);
  for (const entry of observed.xhr) console.log(`      ${describedBy(entry) ? '✓' : ' '} ${entry}`);
  console.log(`  form actions      ${observed.formActions.length}`);
  for (const entry of observed.formActions) console.log(`      ${describedBy(entry) ? '✓' : ' '} ${entry}`);
  console.log(`\n  described by the document: ${described.length} of ${entries.length}`);
  console.log(
    described.length === 0
      ? '\n✗ DISJOINT. The browser surface and the documented surface do not meet, so this\n' +
        '  document cannot ground a model inferred from a crawl of this site.\n'
      : '\n✓ OVERLAPPING. A crawl of this site reaches the documented surface, so the\n' +
        '  document can score a model inferred from it.\n',
  );
}

function report() {
  const ids = readdirSync(FIXTURES).filter((id) => existsSync(recordPath(id)));
  if (ids.length === 0) {
    console.error('\n✗ no committed measurements. Run with --write <target>.\n');
    process.exit(1);
  }
  console.log('\nground-truth candidates — can the document score a crawl of the site?\n');
  for (const id of ids) {
    const r = JSON.parse(readFileSync(recordPath(id), 'utf8'));
    const entries = r.xhr.length + r.formActions.length;
    console.log(
      `  ${r.verdict === 'overlapping' ? '✓' : '✗'} ${id.padEnd(10)} ${String(r.describedByDocument.length).padStart(3)}/${String(entries).padEnd(3)} browser paths described by its ${r.declaredOperations}-operation document   (${r.verdict}, ${r.measuredAt})`,
    );
  }
  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.indexOf('--write');
  if (write === -1) report();
  else await remeasure(process.argv[write + 1] ?? 'gitea');
}
