#!/usr/bin/env node
/**
 * M1's idempotency check, run for the first time.
 *
 *   node capture-idempotence.mjs vikunja --runs 4
 *   node capture-idempotence.mjs vikunja --runs 2 --reuse-container
 *
 * §12 M1 says "recrawl is idempotent modulo timestamps" and the repository's
 * answer was `manifest.contentHash` — computed by every driver, written into
 * every manifest, and **never once compared**. Nor would it have helped:
 * `deriveRouteContentHash({dom, styles, states})` covers route content, so
 * `flows/`, `network/`, `assets/` and `coverage.json` are outside it by
 * construction, which is why `locate/not-found` moving 16 → 19 was invisible.
 *
 * This crawls N times, keeps every tree, and hands them all to
 * `assessCaptureIdempotence`. The canonical form of a JSON artifact is
 * `stableArtifactHash` — itself with `provenance` stripped — which is the
 * schema's own definition of "modulo timestamps" rather than a second one
 * invented here. Everything else is hashed as raw bytes.
 *
 * **`--reuse-container` is the attribution half.** An ordinary run tears the
 * container down and boots a fresh one, so two of them differ in our timing
 * *and* in the target's state — new database, new id sequences, new clocks.
 * Two runs against one live container hold the target still, so a difference
 * that survives is ours. §8 makes our own non-determinism a hard failure; the
 * target's is a property to record.
 */
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessCaptureIdempotence } from '../../shared/dist/index.js';
import { stableArtifactHash } from '../../schema/dist/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const siteId = process.argv[2] ?? 'vikunja';
const runsAt = process.argv.indexOf('--runs');
const RUNS = runsAt === -1 ? 3 : Number(process.argv[runsAt + 1]);
const REUSE = process.argv.includes('--reuse-container');
const NO_PROBE = process.argv.includes('--no-probe');

if (!Number.isInteger(RUNS) || RUNS < 2) {
  console.error(`--runs must be an integer of at least 2; got ${process.argv[runsAt + 1]}`);
  process.exit(1);
}

/**
 * Files that genuinely cannot repeat, each with the reason it cannot.
 *
 * Declared here and nowhere else, and deliberately short. The failure mode this
 * list has is growing: the tempting way to use this tool is to add whatever
 * turns up different until the report comes out clean, which is fitting the
 * measurement to the answer. Anything not listed that varies is a finding.
 */
const EXEMPT = [
  {
    path: 'session.har',
    reason: 'Playwright writes wall-clock timings and per-request durations into the HAR itself; decision 0006 keeps its digest out of every artifact body for the same reason',
  },
  {
    path: 'anon-desktop.har',
    reason: 'as above — one HAR per capture context',
  },
  {
    path: 'auth-desktop.har',
    reason: 'as above — one HAR per capture context',
  },
  {
    path: 'auth',
    reason: 'holds the live session cookie (§3.4, mode 0600). A token that repeated between crawls would be the finding',
  },
];

/** Canonical content of one file: the schema's own "modulo timestamps", or raw bytes. */
function digestOf(abs) {
  const bytes = readFileSync(abs);
  // Parsed, not a suffix test: `endsWith` is the substring-for-token family §13
  // keeps finding, and a file literally named `.json` would satisfy it.
  if (extname(abs) !== '.json') return createHash('sha256').update(bytes).digest('hex');
  try {
    return stableArtifactHash(JSON.parse(bytes.toString('utf8')));
  } catch {
    // operational: a JSON file this tool cannot parse is compared as bytes rather
    // than skipped — skipping would remove it from the comparison silently.
    return createHash('sha256').update(bytes).digest('hex');
  }
}

function treeOf(root, label) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else files[relative(root, abs).split(sep).join('/')] = digestOf(abs);
    }
  };
  walk(root);
  return { label, files };
}

const captureRoot = join(REPO, 'capture', siteId);
const holding = join(REPO, 'capture', `.idempotence-${siteId}`);
rmSync(holding, { recursive: true, force: true });
mkdirSync(holding, { recursive: true });

console.log(`\nidempotence — ${siteId}, ${RUNS} crawl(s)${REUSE ? ', one container held still' : ', a fresh container each time'}${NO_PROBE ? ', read-only (no probing)' : ''}\n`);

const trees = [];
const durations = [];
for (let i = 0; i < RUNS; i += 1) {
  const started = Date.now();
  const args = [join(REPO, 'packages/capture/scripts/capture-site.mjs'), siteId];
  // The first crawl boots and seeds and then holds the container; the rest
  // reuse it. Using the driver's own boot rather than a second copy of the pin
  // here — a measurement whose setup is duplicated is one that can be set up
  // two different ways.
  if (REUSE) args.push(i === 0 ? '--hold-container' : '--reuse-container');
  if (NO_PROBE) args.push('--no-probe');
  const run = spawnSync('node', args, { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  durations.push(Number(seconds));
  if (run.status !== 0) {
    console.error(`\n✗ crawl ${i + 1} failed; idempotence cannot be measured over a failed run.`);
    console.error((run.stdout ?? '').split('\n').slice(-25).join('\n'));
    process.exit(1);
  }
  const kept = join(holding, `run-${i + 1}`);
  cpSync(captureRoot, kept, { recursive: true });
  trees.push(treeOf(kept, `run-${i + 1}`));
  const counts = /(\d+) route\(s\), (\d+) endpoint\(s\), (\d+) gap\(s\)/.exec(run.stdout ?? '');
  const undriveable = /undriveable: (\d+)/.exec(run.stdout ?? '');
  console.log(
    `  run ${i + 1}  ${seconds}s  ${counts ? `${counts[1]} routes · ${counts[2]} endpoints · ${counts[3]} gaps` : ''}` +
    `${undriveable ? ` · ${undriveable[1]} undriveable` : ''}`,
  );
}

if (REUSE) {
  spawnSync('docker', ['rm', '-f', `siteforge-capture-${siteId}`], { encoding: 'utf8' });
}

const report = assessCaptureIdempotence({ runs: trees, exempt: EXEMPT });

console.log(`\n  compared ${report.comparedPaths} path(s) across ${report.runs} run(s)`);
console.log(`  mean crawl ${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)}s\n`);

const show = (title, rows) => {
  if (rows.length === 0) return;
  console.log(`  ${title} (${rows.length}):`);
  for (const r of rows.slice(0, 40)) {
    console.log(`    ${r.path.padEnd(56)} ${r.distinct} distinct, present in ${r.presentIn}/${report.runs}`);
  }
  if (rows.length > 40) console.log(`    … and ${rows.length - 40} more`);
};
show('content changed between runs', report.unstable);
show('present in some runs and not others', report.inconsistentlyPresent);

if (report.exemptedAndVarying.length > 0) {
  console.log(`  exempt and varying, as declared: ${report.exemptedAndVarying.join(', ')}`);
}
if (report.exemptedAndStable.length > 0) {
  // A declared volatility nobody can observe is a claim the artifact does not
  // support, and it is what an exemption added to silence a diff looks like
  // once the real cause is fixed.
  console.log(`  ⚠ exempt but never varied — the exemption is not earning its place: ${report.exemptedAndStable.join(', ')}`);
}

const broken = report.unstable.length + report.inconsistentlyPresent.length;
console.log('');
if (broken === 0) {
  console.log(`✓ ${siteId} recrawls identically across ${report.runs} runs, modulo provenance.`);
} else {
  console.log(`✗ ${broken} path(s) did not reproduce. §8 makes our own non-determinism a hard failure;`);
  console.log('  a difference that survives --reuse-container is ours, one that does not is the target\'s.');
  process.exitCode = 1;
}
