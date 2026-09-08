#!/usr/bin/env node
/**
 * The Gitea ground truth: pin it, fetch it, and prove the committed copy still
 * matches what the pinned image serves.
 *
 * Decision 0015 §1. Two modes, one script on purpose — amendment 2 requires the
 * container's launch to be pinned in the same committed file that fetches from
 * it, because half of what a Swagger document says about itself is a function of
 * how the server was started, and a launch that drifts produces a diff meaning
 * "the port moved" that reads as "the spec changed".
 *
 *   node gitea-snapshot.mjs            # staleness gate: boot, fetch, compare, fail on any difference
 *   node gitea-snapshot.mjs --write    # update the committed snapshot; the diff is the review
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
const FIXTURES = join(HERE, '..', 'fixtures', 'gitea');
const SPEC_FILE = join(FIXTURES, 'swagger.v1.json');
const PIN_FILE = join(FIXTURES, 'pin.json');
const PROBE_FILE = join(FIXTURES, 'anon-probe.json');

/**
 * The pin. Every field here is part of the launch, not a comment about it: the
 * container is started from exactly this, so a snapshot taken by this script is
 * reproducible by running this script.
 */
export const PIN = {
  image: 'gitea/gitea@sha256:87a67ee09d3ae0d1df5fda5dcda3e2a1f9236a45b0a59025d6e00e46adc43bef',
  tagAtPull: '1.27.3',
  containerName: 'siteforge-gitea-truth',
  /** Host port. Measured irrelevant to the document, and pinned anyway. */
  hostPort: 3801,
  containerPort: 3000,
  specPath: '/swagger.v1.json',
  /** §5's graded universe. The document's own `basePath`. */
  basePath: '/api/v1',
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
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' });

function requireDocker() {
  const info = docker('info', '--format', '{{.ServerVersion}}');
  if (info.status !== 0) {
    console.error('\nthis needs a running Docker daemon — it boots the pinned Gitea.');
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
  const env = Object.entries(PIN.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const started = docker(
    'run', '-d', '--name', PIN.containerName,
    '-p', `127.0.0.1:${PIN.hostPort}:${PIN.containerPort}`,
    ...env, PIN.image,
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
  console.log(`\ngitea ground truth — ${write ? 'refreshing the snapshot' : 'checking the committed snapshot is not stale'}`);
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
    writeFileSync(PIN_FILE, `${JSON.stringify({ ...PIN, specSha256: digest, ...counts }, null, 2)}\n`);
    writeFileSync(PROBE_FILE, `${JSON.stringify({ image: PIN.image, basePath: PIN.basePath, entries: probe }, null, 2)}\n`);
    console.log('✓ snapshot written. The diff is the review — a ground truth that changes\n  silently is not a ground truth.\n');
    return;
  }

  if (!existsSync(SPEC_FILE) || !existsSync(PIN_FILE)) {
    console.error('✗ no committed snapshot to check. Run with --write.\n');
    process.exit(1);
  }
  const committedSpec = readFileSync(SPEC_FILE);
  const committedPin = JSON.parse(readFileSync(PIN_FILE, 'utf8'));
  let stale = 0;

  if (sha256(committedSpec) !== digest) {
    console.error('✗ the spec the pinned image serves is not the committed snapshot.');
    console.error(`    committed ${sha256(committedSpec)}`);
    console.error(`    served    ${digest}`);
    console.error('  Offline tests are now testing a spec no server serves. Re-run with --write');
    console.error('  and read the diff; never widen the comparison to make this pass.');
    stale += 1;
  }
  if (committedPin.specSha256 !== sha256(committedSpec)) {
    console.error('✗ pin.json disagrees with the spec file beside it — one of them was hand-edited.');
    stale += 1;
  }
  const committedProbe = existsSync(PROBE_FILE) ? JSON.parse(readFileSync(PROBE_FILE, 'utf8')) : { entries: [] };
  const key = (e) => `${e.method} ${e.specPath}`;
  const before = new Map(committedProbe.entries.map((e) => [key(e), e.status]));
  const drifted = probe.filter((e) => before.get(key(e)) !== e.status);
  if (drifted.length > 0 || before.size !== probe.length) {
    console.error(`✗ the anonymous sweep moved on ${drifted.length} endpoint(s), and the auth truth side is built from it.`);
    for (const e of drifted.slice(0, 10)) {
      console.error(`    ${key(e)}: ${before.get(key(e)) ?? '(absent)'} → ${e.status}`);
    }
    stale += 1;
  }

  if (stale > 0) {
    console.error('');
    process.exit(1);
  }
  console.log('✓ the committed snapshot is what the pinned image serves.\n');
}

await main();
