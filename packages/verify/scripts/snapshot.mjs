#!/usr/bin/env node
/**
 * A ground truth: pin it, fetch it, and prove the committed copy still matches
 * what the pinned image serves.
 *
 * Decision 0015 §1. Two modes, one script on purpose — amendment 2 requires the
 * container's launch to be pinned in the same committed file that fetches from
 * it, because half of what a Swagger document says about itself is a function of
 * how the server was started, and a launch that drifts produces a diff meaning
 * "the port moved" that reads as "the spec changed".
 *
 *   node snapshot.mjs <target>          # staleness gate: boot, fetch, compare, fail on any difference
 *   node snapshot.mjs <target> --write  # update the committed snapshot; the diff is the review
 *
 * One script, a `PINS` table, one target per entry. A second target arriving as
 * a copy of this file would be two staleness gates drifting apart, and the
 * launch-is-part-of-the-pin argument below applies to each of them equally.
 *
 * The comparison is a **sha256 of the whole document**, with no normalisation
 * and no exempted fields. That is not optimism, it is a measurement: two
 * containers at this digest, on different ports with different ROOT_URLs,
 * served byte-identical documents — 15,768 leaves, zero differing. A general
 * "ignore fields that vary" clause would be exactly wide enough to hide the
 * change this gate exists to catch, and unreadable as different from the honest
 * version. If a field ever does vary, it goes in `volatileFields` **named**,
 * with the observation that put it there, and the test asserting that list is
 * empty has to be deleted in the same commit.
 *
 * The gate is milestone-gate work: it needs Docker, and `verify:clean` must not.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtureDir = (id) => join(HERE, '..', 'fixtures', id);

/**
 * The pin. Every field here is part of the launch, not a comment about it: the
 * container is started from exactly this, so a snapshot taken by this script is
 * reproducible by running this script.
 */
export const PINS = {
 gitea: {
  specFile: 'swagger.v1.json',
  image: 'gitea/gitea@sha256:87a67ee09d3ae0d1df5fda5dcda3e2a1f9236a45b0a59025d6e00e46adc43bef',
  tagAtPull: '1.27.3',
  containerName: 'siteforge-gitea-truth',
  /** Host port. Measured irrelevant to the document, and pinned anyway. */
  hostPort: 3801,
  containerPort: 3000,
  specPath: '/swagger.v1.json',
  /** §5's graded universe. The document's own `basePath`. */
  basePath: '/api/v1',
  /**
   * The env var that tells the app what URL it is reachable at.
   *
   * Named here rather than baked into `env`, because a second caller boots this
   * image on a different port — a capture driver, say — and an app told the
   * wrong public URL sends its own frontend to a port nothing is listening on.
   * Vikunja's SPA did exactly that: it loaded, called `localhost:3802`, and
   * rendered no login form at all.
   */
  rootUrlEnv: 'GITEA__server__ROOT_URL',
  env: {
    GITEA__security__INSTALL_LOCK: 'true',
    GITEA__database__DB_TYPE: 'sqlite3',
    GITEA__database__PATH: '/tmp/gitea.db',
    GITEA__server__HTTP_PORT: '3000',
    GITEA__server__ROOT_URL: 'http://localhost:3801/',
  },
  /**
   * Fields excluded from the byte comparison. **Empty, by measurement.** See the
   * header: two containers, byte-identical documents. An entry here needs the
   * two observations that justify it and deletes an assertion in `truth.test.ts`.
   */
  volatileFields: [],
 },

 /**
  * Vikunja, adopted as the M3 ground truth (0019, 0021).
  *
  * Gitea's browser and Gitea's document are disjoint, so a Gitea capture is
  * ungradeable — every category vacuous. Vikunja passes both selection
  * criteria: 16 of 18 observed browser paths are declared by its own document,
  * and `/api/v1` is a real prefix the SPA shell falls outside of, so the
  * universe filter still filters.
  */
 vikunja: {
  specFile: 'docs.json',
  image: 'vikunja/vikunja@sha256:ed1f3ed467fecec0b57e9de7bc6607f8bbcbb23ffced6a81f5dfefc794cdbe3b',
  tagAtPull: '0.24',
  containerName: 'siteforge-vikunja-truth',
  hostPort: 3802,
  containerPort: 3456,
  specPath: '/api/v1/docs.json',
  /** The document's own `basePath`, and a prefix the UI does not share. */
  basePath: '/api/v1',
  /**
   * Every writable path in the image is root-owned while the process runs as
   * uid 1000, so sqlite and the upload directory need mounts. tmpfs rather than
   * volumes: the container is thrown away, and a volume would make the snapshot
   * depend on whatever the last run left behind.
   */
  runArgs: ['--tmpfs', '/db', '--tmpfs', '/files'],
  rootUrlEnv: 'VIKUNJA_SERVICE_PUBLICURL',
  env: {
    VIKUNJA_SERVICE_JWTSECRET: 'sf-local-fixture-only-secret',
    VIKUNJA_SERVICE_PUBLICURL: 'http://localhost:3802/',
    VIKUNJA_DATABASE_TYPE: 'sqlite',
    VIKUNJA_DATABASE_PATH: '/db/vikunja.db',
    VIKUNJA_FILES_BASEPATH: '/files',
  },
  /** Measured across two boots on different ports and PUBLICURLs. Empty. */
  volatileFields: [],

  /**
   * The fixture account. One literal, because three copies of a password is
   * three places for a crawl and a measurement to disagree about who they
   * signed in as. Never a real credential (§3.3) — a local container, thrown
   * away, seeded from nothing.
   */
  login: { username: 'sfadmin', email: 'sfadmin@localhost.test', password: 'sf-local-fixture-only' },

  /**
   * Deterministic content, so a crawl and a surface measurement see the same
   * instance. `PUT` creates in Vikunja's API and `POST` updates — worth stating,
   * because a 405 here looks like a wrong path rather than a wrong verb.
   *
   * Every call is checked. A seed that half-failed produces an empty instance,
   * and an empty instance makes no API calls — which reads as "this target's
   * browser does not call its API", the verdict the surface script exists to
   * pronounce.
   */
  async seed({ api }) {
    const { username, email, password } = PINS.vikunja.login;
    const call = async (path, method, data, token) => {
      const response = await api(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`seed ${path} → ${response.status}: ${text.slice(0, 200)}`);
      return text;
    };
    await call('/api/v1/register', 'POST', { username, email, password });
    const token = JSON.parse(await call('/api/v1/login', 'POST', { username, password })).token;
    await call('/api/v1/projects', 'PUT', { title: 'Seeded project' }, token);
    for (const title of [
      'Write the truth loader',
      'Measure the surface',
      'Transcribe a baseline',
      'Ship the grader',
    ]) await call('/api/v1/projects/2/tasks', 'PUT', { title }, token);
    for (const title of ['bug', 'enhancement', 'question'])
      await call('/api/v1/labels', 'PUT', { title }, token);

    /**
     * One task with an assignee, a reminder and a label (0051).
     *
     * Without this every task on the instance has `assignees: null`,
     * `labels: null` and `reminders: null`, so infer emits `{type:'null'}`
     * for each — correctly, since that is all it saw — and the grader scores
     * it against a document that declares arrays. **21 of `field-type`'s 25
     * disagreements and 63 of 126 recall misses were that**: numbers badged
     * as inference that were reading a degenerate instance.
     *
     * Not scoring pressure. §8 builds the mock store from captured
     * responses and §10's validators read seeded state, so an instance
     * where no task has ever been assigned or labelled cannot support the
     * tasks the environment exists to pose.
     *
     * **One `POST`, because the task update replaces.** Setting assignees
     * and then reminders in two calls silently clears the first. And it is
     * the task-update form rather than `PUT /tasks/1/assignees`, which
     * answers 201 and leaves the field null — both found by probing a
     * booted container before this was written.
     *
     * One task, not four, deliberately: the union over observed bodies then
     * sees both a populated array and a null, which is the shape a real
     * instance has and the one `nullable` is for.
     */
    await call('/api/v1/tasks/1', 'POST', {
      id: 1,
      assignees: [{ id: 1, username }],
      reminders: [{ reminder: '2099-01-01T09:00:00Z', relative_period: 0, relative_to: '' }],
    }, token);
    await call('/api/v1/tasks/1/labels', 'PUT', { label_id: 1 }, token);

    /**
     * The fourth collection-valued field, and the one 0051 left out (§8's seed
     * requirement, decision 0053).
     *
     * 0051 deferred it because "it needs multipart and a real file on disk,
     * which adds a surface §3.4 would have to reason about", and measured what
     * that cost: **46 of the 82 remaining recall misses sit under
     * `attachments`** — it got *worse* than the 29 it started at, because the
     * newly-matched task-update endpoint declares the field too. A field left
     * out of the seed is not a field left alone.
     *
     * There is no file on disk. A `Blob` in a `FormData` is a multipart body
     * built in memory, so §3.4's scanner has nothing new to reason about and
     * the crawl has no fixture file to clean up.
     *
     * **Last, and measured rather than assumed.** The task update at
     * `/tasks/1` above *replaces*, so the ordering question is real: probed
     * against a booted container, an update issued after an upload leaves
     * `attachments` intact — all four collections populated at once. That also
     * settles a crawl-time worry, since the SPA fires that same update from a
     * probe: it will not empty the field mid-crawl.
     */
    const attachment = new FormData();
    attachment.append(
      'files',
      new Blob(['siteforge fixture attachment\n'], { type: 'text/plain' }),
      'notes.txt',
    );
    const uploaded = await api('/api/v1/tasks/1/attachments', {
      method: 'PUT',
      // No Content-Type: `fetch` writes the multipart boundary itself, and one
      // set by hand is a boundary that does not match the body.
      headers: { Authorization: `Bearer ${token}` },
      body: attachment,
    });
    if (!uploaded.ok) {
      throw new Error(`seed /tasks/1/attachments → ${uploaded.status}: ${(await uploaded.text()).slice(0, 200)}`);
    }

    return token;
  },

  /** Where the SPA sits when nobody is signed in. */
  loggedOutPath: '/login',

  /**
   * Sign in, and prove it took.
   *
   * Typed, not filled, and clicked rather than submitted with Enter: Vue's
   * `v-model` on this form does not see `fill`'s single input event, and Enter
   * does not submit. Then a settle wait, because the SPA hydrates *over* the
   * field it has already painted and eats whatever was typed first — `sfadmin`
   * arrived as `in`, and the login failed with a message about a wrong password
   * that was entirely true.
   *
   * One copy, imported by both the surface measurement and the capture driver.
   * Rediscovering this in a second place is how a crawl silently measures a
   * login screen.
   */
  async signIn(page, origin, { wait }) {
    const { username, password } = PINS.vikunja.login;
    await page.goto(`${origin}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
    await wait(2500);
    for (const [selector, value] of [['#username', username], ['#password', password]]) {
      await page.click(selector);
      await page.type(selector, value, { delay: 30 });
      const typed = await page.inputValue(selector);
      if (typed !== value) throw new Error(`${selector} holds "${typed}" after typing "${value}"`);
    }
    await page.click('button:has-text("Login")');
    await wait(5000);
    if (page.url().includes(PINS.vikunja.loggedOutPath)) {
      throw new Error(
        `login did not take: still at ${page.url()}. Every page below would be the login screen, and any verdict drawn from the crawl would be about a login form.`,
      );
    }
  },
 },
};

/** The target this invocation is about. */
const TARGET = process.argv.find((a) => Object.hasOwn(PINS, a)) ?? 'gitea';
const PIN = PINS[TARGET];
const FIXTURES = fixtureDir(TARGET);
const SPEC_FILE = join(FIXTURES, PIN.specFile);
const PIN_FILE = join(FIXTURES, 'pin.json');
const PROBE_FILE = join(FIXTURES, 'anon-probe.json');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

function requireDocker() {
  const info = docker('info', '--format', '{{.ServerVersion}}');
  if (info.status !== 0) {
    console.error(`\nthis needs a running Docker daemon — it boots the pinned ${TARGET}.`);
    console.error('It is milestone-gate work and deliberately absent from verify:clean.\n');
    process.exit(1);
  }
}

async function get(path, { timeoutMs = 10_000 } = {}) {
  const url = `http://127.0.0.1:${PIN.hostPort}${path}`;
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, { signal, redirect: 'manual' });
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
}

async function bootAndFetch() {
  docker('rm', '-f', PIN.containerName);
  const env = Object.entries({
    ...PIN.env,
    [PIN.rootUrlEnv]: `http://localhost:${PIN.hostPort}/`,
  }).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const started = docker(
    'run', '-d', '--name', PIN.containerName,
    '-p', `127.0.0.1:${PIN.hostPort}:${PIN.containerPort}`,
    ...(PIN.runArgs ?? []), ...env, PIN.image,
  );
  if (started.status !== 0) throw new Error(`could not start the pinned container:\n${started.stderr}`);

  // Wait for the spec, not for the port: an open socket during Gitea's ORM
  // retry loop answers nothing, and "connection accepted" would be a readiness
  // check that is true before the thing we need exists.
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const r = await get(PIN.specPath, { timeoutMs: 5_000 });
      if (r.status === 200) return r.body;
    } catch (err) {
      // operational: the container is still booting; refused/aborted is expected
      // here and is the only reason we are in a retry loop at all.
      if (!(err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError')) throw err;
    }
    if (Date.now() > deadline) throw new Error('the pinned container never served the spec within 120s');
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * The auth truth side (§4), measured because the document cannot supply it: one
 * global `security` block, and not one of 482 operations overrides it.
 *
 * Deliberately a flat sweep and not capture's anonymous re-issue. §13's rule
 * about an invariant's observed side applies to a grader's truth side the same
 * way — share the code under test and a bug moves both sides, so the score goes
 * quiet instead of red.
 */
async function sweepAnonymous(spec) {
  const entries = [];
  for (const [specPath, item] of Object.entries(spec.paths).sort()) {
    // Parameterised paths need a deterministically seeded instance; until that
    // script exists they are absent from the sweep rather than guessed at, and
    // the loader reports the coverage rather than implying the whole surface.
    if (specPath.includes('{')) continue;
    for (const method of ['get']) {
      if (!item[method]) continue;
      let status;
      try {
        ({ status } = await get(`${PIN.basePath}${specPath}`));
      } catch (err) {
        // operational: a request that never completed is not an observation.
        // Recorded as such — never folded into a status class.
        status = null;
      }
      entries.push({ method: method.toUpperCase(), specPath, status });
    }
  }
  return entries;
}

/**
 * Is the committed snapshot still what the pinned image serves?
 *
 * Everything this returns used to be computed inline in `main()`, downstream of
 * a Docker boot — so the gate could not run at all without a container, and no
 * one had ever seen it fail. A gate reachable only through the input it passes
 * on is a gate nobody can prove fires, and this one could not even be reached.
 * Now the four inputs arrive as parameters: `main()` supplies the served bytes,
 * a test supplies a pair that disagrees.
 *
 * Returns one finding per disagreement, never a throw and never the first only.
 * The three are independent: the spec can move while the probe holds, `pin.json`
 * can be hand-edited while both hold, and each names a different repair.
 */
export function assessSnapshot({ servedSpec, committedSpec, committedPin, servedProbe, committedProbe }) {
  const findings = [];
  const served = sha256(servedSpec);
  const committed = sha256(committedSpec);

  if (served !== committed) {
    findings.push({
      rule: 'spec-drift',
      message:
        'the spec the pinned image serves is not the committed snapshot.\n' +
        `    committed ${committed}\n` +
        `    served    ${served}\n` +
        '  Offline tests are now testing a spec no server serves. Re-run with --write\n' +
        '  and read the diff; never widen the comparison to make this pass.',
    });
  }
  if (committedPin.specSha256 !== committed) {
    findings.push({
      rule: 'pin-disagrees',
      message: 'pin.json disagrees with the spec file beside it — one of them was hand-edited.',
    });
  }
  // The auth truth side is built from this sweep (§4), so it is as much a part
  // of the ground truth as the document is, and gets the same comparison.
  const key = (e) => `${e.method} ${e.specPath}`;
  const before = new Map((committedProbe.entries ?? []).map((e) => [key(e), e.status]));
  const drifted = servedProbe.filter((e) => before.get(key(e)) !== e.status);
  if (drifted.length > 0 || before.size !== servedProbe.length) {
    findings.push({
      rule: 'probe-drift',
      message:
        `the anonymous sweep moved on ${drifted.length} endpoint(s), and the auth truth side is built from it.` +
        drifted.slice(0, 10).map((e) => `\n    ${key(e)}: ${before.get(key(e)) ?? '(absent)'} → ${e.status}`).join(''),
    });
  }
  return findings;
}

const summarise = (spec) => ({
  paths: Object.keys(spec.paths).length,
  operations: Object.values(spec.paths)
    .flatMap((i) => Object.keys(i).filter((k) => ['get', 'post', 'put', 'delete', 'patch'].includes(k)))
    .length,
  definitions: Object.keys(spec.definitions ?? {}).length,
});

async function main() {
  const write = process.argv.includes('--write');
  requireDocker();
  console.log(`\n${TARGET} ground truth — ${write ? 'refreshing the snapshot' : 'checking the committed snapshot is not stale'}`);
  console.log(`  ${PIN.image}\n`);

  let body;
  let probe;
  try {
    body = await bootAndFetch();
    probe = await sweepAnonymous(JSON.parse(body.toString('utf8')));
  } finally {
    docker('rm', '-f', PIN.containerName);
  }

  const digest = sha256(body);
  const spec = JSON.parse(body.toString('utf8'));
  const counts = summarise(spec);
  console.log(`  fetched   ${body.length} bytes, sha256 ${digest.slice(0, 16)}…`);
  console.log(`  surface   ${counts.paths} paths, ${counts.operations} operations, ${counts.definitions} definitions`);
  const publicCount = probe.filter((e) => e.status === 200).length;
  console.log(`  anonymous ${probe.length} zero-parameter GETs probed, ${publicCount} answered 200\n`);

  if (write) {
    writeFileSync(SPEC_FILE, body);
    writeFileSync(PIN_FILE, `${JSON.stringify({ target: TARGET, ...PIN, specSha256: digest, ...counts }, null, 2)}\n`);
    writeFileSync(PROBE_FILE, `${JSON.stringify({ image: PIN.image, basePath: PIN.basePath, entries: probe }, null, 2)}\n`);
    console.log('✓ snapshot written. The diff is the review — a ground truth that changes\n  silently is not a ground truth.\n');
    return;
  }

  if (!existsSync(SPEC_FILE) || !existsSync(PIN_FILE)) {
    console.error('✗ no committed snapshot to check. Run with --write.\n');
    process.exit(1);
  }
  const findings = assessSnapshot({
    servedSpec: body,
    committedSpec: readFileSync(SPEC_FILE),
    committedPin: JSON.parse(readFileSync(PIN_FILE, 'utf8')),
    servedProbe: probe,
    committedProbe: existsSync(PROBE_FILE) ? JSON.parse(readFileSync(PROBE_FILE, 'utf8')) : { entries: [] },
  });

  if (findings.length > 0) {
    for (const finding of findings) console.error(`✗ ${finding.message}`);
    console.error('');
    process.exit(1);
  }
  console.log('✓ the committed snapshot is what the pinned image serves.\n');
}

// Importing this file for `PIN` or `assessSnapshot` must not boot a container.
if (import.meta.url === `file://${process.argv[1]}`) await main();
