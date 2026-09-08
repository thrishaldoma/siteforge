/**
 * `pnpm verify:clean` — the definition of green.
 *
 * Clone the committed HEAD into a temp directory, install, build, test, and run
 * both measurement rungs there. **No milestone gate counts unless it passed
 * here** (§12, §13).
 *
 * The reason this exists: `packages/capture/` was ignored by an unanchored
 * `.gitignore` pattern and had never been committed. Two rungs of evidence
 * toward M1 came from code that existed in exactly one working tree, and every
 * local check passed the entire time. A gate that runs where the code already is
 * cannot detect that; a gate that starts from `git clone` cannot miss it.
 *
 * Refuses a dirty tree by default. A clone silently tests HEAD, so running this
 * with uncommitted changes produces a green result about code that is not the
 * code in front of you — the same confusion that hid the capture package for
 * eight commits. `--allow-dirty` overrides, loudly.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = process.cwd();
const allowDirty = process.argv.includes('--allow-dirty');
const keep = process.argv.includes('--keep');

const run = (label, cmd, args, cwd, env = {}) => {
  process.stdout.write(`  ${label.padEnd(28)}`);
  const started = Date.now();
  try {
    execFileSync(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.log('✗');
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`.trimEnd();
    console.log('\n──────── output ────────');
    console.log(out.split('\n').slice(-40).join('\n'));
    console.log('────────────────────────');
    throw new Error(`${label} failed`);
  }
  console.log(`✓  ${((Date.now() - started) / 1000).toFixed(1)}s`);
};

const head = execSync('git rev-parse --short HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain', { cwd: REPO, encoding: 'utf8' }).trim();

console.log(`\nverify:clean — reproducing HEAD ${head} from a fresh clone\n`);

if (dirty) {
  const files = dirty.split('\n');
  if (!allowDirty) {
    console.log(`✗ the working tree has ${files.length} uncommitted change(s).`);
    console.log('');
    for (const line of files.slice(0, 12)) console.log(`    ${line}`);
    if (files.length > 12) console.log(`    … and ${files.length - 12} more`);
    console.log('');
    console.log('  This gate clones HEAD, so it would report on code that is not the code');
    console.log('  in front of you — which is exactly how an uncommitted package went');
    console.log('  unnoticed for eight commits. Commit first, or pass --allow-dirty.');
    process.exit(1);
  }
  console.log(`⚠ ${files.length} uncommitted change(s); testing HEAD ${head}, NOT your working tree.\n`);
}

const tmp = mkdtempSync(join(tmpdir(), 'siteforge-verify-'));
const clone = join(tmp, 'repo');
let failed = false;

try {
  run('git clone HEAD', 'git', ['clone', '--quiet', '--no-hardlinks', REPO, clone], tmp);
  run('pnpm install', 'pnpm', ['install', '--silent'], clone);
  run('pnpm build', 'pnpm', ['-s', 'build'], clone);
  run('pnpm typecheck', 'pnpm', ['-s', 'typecheck'], clone);
  run('pnpm lint', 'pnpm', ['-s', 'lint'], clone);
  run('pnpm test', 'pnpm', ['-s', 'test'], clone);
  run('fixtures regenerate', 'node', ['packages/schema/scripts/build-fixtures.mjs'], clone);
  // Distinct ports: a rung server left running locally must not make the clone
  // look green by answering for it.
  run('rung 2', 'pnpm', ['-s', 'rung2'], clone, { RUNG2_PORT: '8888' });
  // Rung 2 has no destructive controls, so the flag is inert — run anyway,
  // because a flag that breaks the non-destructive path is worth knowing about
  // and "inert" is a claim that should be tested rather than asserted.
  run('rung 2 --allow-destructive', 'pnpm', ['-s', 'rung2', '--allow-destructive'], clone, {
    RUNG2_PORT: '8891',
  });
  run('rung 3', 'pnpm', ['-s', 'rung3'], clone, { RUNG3_PORT: '8889' });
  run('rung 3 --allow-destructive', 'pnpm', ['-s', 'rung3', '--allow-destructive'], clone, {
    RUNG3_PORT: '8890',
  });
} catch {
  // operational: run() already printed the failing step and threw a labelled Error
  failed = true;
} finally {
  if (keep) console.log(`\n  clone kept at ${clone}`);
  else rmSync(tmp, { recursive: true, force: true });
}

console.log('');
if (failed) {
  console.log(`✗ verify:clean FAILED for ${head} — HEAD does not reproduce.`);
  process.exit(1);
}
console.log(`✓ verify:clean green: ${head} reproduces from nothing but a clone.`);
