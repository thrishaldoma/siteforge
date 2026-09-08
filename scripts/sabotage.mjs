#!/usr/bin/env node
/**
 * `pnpm sabotage` — run every gate's sabotage in its sabotaged state.
 *
 * A sabotage test that was never executed while sabotaged is an assertion about
 * a counterfactual nobody checked. This repo has now been bitten by that twice
 * inside the sabotage practice itself:
 *
 *   - the §3.4 storage-state test asserted the nested file *appeared* in the
 *     findings, which was true under the bug too (it was reported for its mode,
 *     not its contents) — caught by chance, while running the sabotage by hand;
 *   - the first attempt at the selector sabotage patched the parsed token set
 *     rather than the raw selector text, so it reproduced a weaker bug than the
 *     real one and passed.
 *
 * So: every gate carries its sabotage as a committed patch, and this harness
 * applies it, asserts the gate fails **for the stated reason**, reverts, and
 * asserts the tree came back byte for byte.
 *
 * Three things are deliberately hard failures rather than skips:
 *
 *   1. **A patch that does not apply.** Surrounding code moves and patches rot.
 *      "12 sabotages, 3 skipped" tells you nothing about those 3, which is the
 *      vacuous-check shape one level up.
 *   2. **A gate that fails for the wrong reason.** A patch that introduces a
 *      syntax error also makes the command exit non-zero, and would "pass" a
 *      harness that only checked the exit code. Each entry names a string that
 *      must appear in the failing output — the discriminating property, the
 *      thing that differs between correct and broken.
 *   3. **A revert that leaves residue.** The tree hash is compared before and
 *      after; anything left behind turns the next gate's result into noise.
 *
 * Runs last in `verify:clean`, because it mutates the working tree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();
const PATCHES = join(REPO, 'sabotage');

/**
 * One sabotage: the bug it reintroduces, the gate that must notice, and the
 * words that prove it noticed *that* rather than tripping over the patch.
 */
const SABOTAGES = [
  {
    id: 'secret-gate-path-suffix',
    bug: "§3.4's exemption matches any path ending in auth/storage-state.json",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'not the one at the tree root',
  },
  {
    id: 'origin-prefix-match',
    bug: 'sameOrigin() compares a URL prefix instead of the parsed origin',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'an origin is a parsed component',
  },
  {
    id: 'selector-substring-match',
    bug: 'selector class names come from raw selector text, so data-flagged explains "flag"',
    gate: ['pnpm', '-s', 'test', '--project', 'capture'],
    expect: 'contained in an attribute name',
  },
  {
    id: 'walker-unanchored-ignore',
    bug: "the walker's ignore list carries a bare name again",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'unanchored',
  },
  {
    id: 'walker-mustreach-disabled',
    bug: 'the walker stops enforcing that a scan reached what it claims to cover',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'never reached',
  },
  {
    id: 'catch-lint-promise-rule-removed',
    bug: 'the catch linter stops examining .catch(fn) handlers',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'promiseHandlers',
  },
];

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

/** A hash over the tracked working tree, so residue after a revert is visible. */
const treeHash = () => {
  git('add', '-A', '--intent-to-add', '--', '.');
  return execFileSync('git', ['-C', REPO, 'diff', '--stat', 'HEAD'], { encoding: 'utf8' })
    + git('status', '--porcelain');
};

const run = (command) => {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8' });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

function main() {
  const dirty = git('status', '--porcelain').trim();
  if (dirty && !process.argv.includes('--allow-dirty')) {
    console.error('\nsabotage refuses to run against a dirty tree — it applies and reverts patches.\n');
    console.error(dirty);
    process.exit(1);
  }

  const onDisk = existsSync(PATCHES)
    ? readdirSync(PATCHES).filter((f) => f.endsWith('.patch')).map((f) => f.slice(0, -6)).sort()
    : [];
  const declared = SABOTAGES.map((s) => s.id).sort();
  // The completeness assertion this repo applies to every rule table: a patch
  // on disk with no entry here would never run, and an entry with no patch
  // would be a claim about a file that does not exist.
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    console.error(`\nsabotage/ and the table disagree.\n  on disk:  ${onDisk.join(', ')}\n  declared: ${declared.join(', ')}\n`);
    process.exit(1);
  }
  if (SABOTAGES.length === 0) {
    console.error('\nno sabotages declared — a harness that runs nothing reports success.\n');
    process.exit(1);
  }

  console.log(`\nsabotage — reintroducing ${SABOTAGES.length} fixed bug(s), one at a time\n`);
  const before = treeHash();
  let failed = 0;

  for (const sabotage of SABOTAGES) {
    const patch = join(PATCHES, `${sabotage.id}.patch`);
    process.stdout.write(`  ${sabotage.id.padEnd(34)}`);

    // 1. It must still apply. A rotted patch is a hard failure.
    const applied = run(['git', '-C', REPO, 'apply', patch]);
    if (applied.code !== 0) {
      console.log('✗  patch no longer applies');
      console.log(`      ${applied.output.trim().split('\n')[0]}`);
      console.log(`      Regenerate it: the code it patched moved. Never skip — a sabotage`);
      console.log(`      that cannot run is a gate nobody is checking.`);
      failed += 1;
      continue;
    }

    // 2. The gate must fail, and for the stated reason.
    const gate = run(sabotage.gate);
    let verdict;
    if (gate.code === 0) {
      verdict = `✗  the gate still passed — it does not catch: ${sabotage.bug}`;
      failed += 1;
    } else if (!gate.output.includes(sabotage.expect)) {
      verdict = `✗  the gate failed, but not for the stated reason (no "${sabotage.expect}")`;
      failed += 1;
    } else {
      verdict = '✓  caught';
    }

    // 3. The revert must leave nothing behind, whatever happened above.
    const reverted = run(['git', '-C', REPO, 'apply', '-R', patch]);
    if (reverted.code !== 0) {
      console.log('✗  could not revert — the tree is now dirty');
      console.log(`      ${reverted.output.trim()}`);
      process.exit(1);
    }
    if (treeHash() !== before) {
      console.log('✗  revert left residue; every later result would be noise');
      process.exit(1);
    }
    console.log(verdict);
  }

  console.log('');
  if (failed > 0) {
    console.log(`✗ ${failed} sabotage(s) did not reproduce a caught failure.\n`);
    process.exit(1);
  }
  console.log(`✓ every gate failed when its bug came back, and the tree is clean.\n`);
}

main();
