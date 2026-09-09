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
 * ## Controls
 *
 * A table made only of defects proves nothing about isolation. A gate that
 * fails on *any* edit to the file satisfies every row above it, and reads
 * exactly like a gate that discriminates — the mirror image of the vacuous
 * invariant this repo keeps finding. So the table also carries **controls**:
 * patches that change the same code a defect attacks, preserve its meaning, and
 * must leave the gate **green**.
 *
 * A control has to be a change the gate could plausibly have keyed on and
 * should not. Re-spelling `matchPath(rel, P)` as `matchesAnyPath(rel, [P])` is
 * one: identical anchoring, different call, on the exact line
 * `secret-gate-path-suffix` rewrites. Renaming a local or reflowing whitespace
 * is *not* — it demonstrates only that the gate is not deranged, which is the
 * vacuous spelling of the same idea.
 *
 * Two are declared, not eight. The rule (§13) is at least one, because the
 * marginal control is worth much less than the first and every patch is one
 * more thing that rots.
 *
 * ## Reachability
 *
 * Every entry states, in `reachable`, why the state it produces is one a real
 * run or a real edit can arrive at, and the harness refuses to run without it.
 *
 * This is a third way a mutation harness goes quiet, alongside never-fires and
 * fires-on-everything: **a gate behaving correctly on input no run can reach
 * proves nothing about the input it will actually see.** It was found in the
 * coverage table — a sabotage that set `endpoints: 0` while leaving three of
 * them carrying auth evidence, green since the day it was written — and the
 * audit that followed found two here:
 *
 *   - `selector-substring-match` parsed the selector, discarded the parse, and
 *     added the raw text. Nobody writes that. Rewritten as a hand-rolled `\w`
 *     tokeniser, which omits the hyphen a class name may contain — the family
 *     of mistake this repo has hit five times.
 *   - `walker-mustreach-disabled` iterated `[] as readonly string[]`. Nobody
 *     writes that either. Rewritten as the check deleted, which is what
 *     removing a slow assertion actually looks like.
 *
 * Both gates fired under the old patches, and both would have kept firing while
 * saying nothing about a reachable regression.
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
 * One entry per patch.
 *
 * `reachable` — why a real run or a real edit arrives at this state. Required
 * on every entry, defect and control alike.
 *
 * `kind: 'defect'` — the bug it reintroduces, the gate that must notice, and
 * the words that prove it noticed *that* rather than tripping over the patch.
 *
 * `kind: 'control'` — a meaning-preserving change to the same code, naming the
 * defect it is the control for. The gate must stay green. There is no `expect`
 * because there is no output to discriminate: the discriminating property of a
 * control is the exit code, and the pairing is what makes it a control rather
 * than a no-op.
 */
export const SABOTAGES = [
  {
    id: 'secret-gate-path-suffix',
    bug: "§3.4's exemption matches any path ending in auth/storage-state.json",
    reachable: 'the code as shipped, until decision 0014 replaced it with an anchored match',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'not the one at the tree root',
  },
  {
    id: 'origin-prefix-match',
    bug: 'sameOrigin() compares a URL prefix instead of the parsed origin',
    reachable: 'the classifier as shipped: href.startsWith(ORIGIN), which called a foreign link same-origin',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'an origin is a parsed component',
  },
  {
    // Scoped honestly: this reproduces the *helper* returning raw text, which
    // is not the defect that shipped. The shipped defect was in the caller and
    // is `probe-detector-substring` below — the two are separate entries
    // because this patch, applied alone, leaves rung 3 reporting the right
    // count. Measured; §13 says a sabotage must reproduce the actual defect,
    // and this one only reproduces half of it.
    id: 'selector-substring-match',
    bug: 'selectorClassNames tokenises the selector with a regex instead of parsing it',
    reachable: 'a hand-rolled \\w tokeniser, which does not admit the hyphen a class name may contain — the string-op-against-a-grammar mistake, five occurrences so far',
    gate: ['pnpm', '-s', 'test', '--project', 'capture'],
    expect: 'an attribute-value token was reported as a class name',
  },
  {
    // The defect exactly as it shipped, in the caller, gated by the rung that
    // measures the consequence. Costs a 22-second run and is worth it: this is
    // the one that was silently dropping a state on every capture.
    id: 'probe-detector-substring',
    bug: 'the probe asks whether the joined selector text contains a class name',
    reachable: 'the detector as shipped, dropping one state on every rung-3 run',
    gate: ['pnpm', '-s', 'rung3', '--allow-destructive'],
    expect: 'expects statesProbed exactly 3, got 2',
  },
  {
    id: 'walker-unanchored-ignore',
    bug: "the walker's ignore list carries a bare name again",
    reachable: 'the IGNORED_DIRS entry that hid packages/capture for eight commits',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'unanchored',
  },
  {
    id: 'walker-mustreach-disabled',
    bug: 'the walker stops enforcing that a scan reached what it claims to cover',
    reachable: 'the check deleted outright, which is what removing an assertion someone finds slow or noisy looks like',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'never reached',
  },
  {
    id: 'gap-count-not-recomputed',
    bug: 'the model stops recomputing manifest.counts.gaps against the stage report',
    reachable: 'the schema as it stood before 0014 added the recompute',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'One run, one number',
  },
  {
    id: 'catch-lint-promise-rule-removed',
    bug: 'the catch linter stops examining .catch(fn) handlers',
    reachable: 'the linter as it stood before 0013 added the rule, with nine handlers unlinted under it',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'promiseHandlers',
  },
  {
    id: 'grade-digest-not-frozen',
    bug: 'a scored-field threshold moves without the contract digest moving with it',
    reachable: 'a threshold edited and the constant beneath it left alone, which is the entire reason the constant exists',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'the contract table moved without its digest',
  },
  {
    id: 'infer-report-contract-optional',
    bug: "infer's stage report stops having to carry the scored-field contract",
    reachable: 'one branch of the biconditional deleted, which is how a required field becomes optional-and-encouraged',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'an infer report with no scored-field contract parsed',
  },
  {
    id: 'truth-404-as-absent',
    bug: 'a 404 to an anonymous caller is read as "no such endpoint" rather than as gated',
    reachable: 'the naive reading of the status code, and the one anyone writes who has not met Gitea\'s existence-hiding 404',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'must classify as required, never absent',
  },
  {
    id: 'sitemodel-unclaimed-field',
    bug: 'a field lands in SiteModel that no codegen need and no scored category asks for',
    reachable: 'an OPTIONAL convenience field added to a section that is already claimed. Optional matters: a required one breaks the fixture parse first, and the harness rejected the first version of this patch for failing on the wrong reason — which is also why optional is the realistic shape, since it is the addition that costs nothing to make',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'the model carries a field no consumer asked for',
  },
  {
    id: 'sitemodel-undeclared-share',
    bug: 'a second claimant starts reading a leaf without the overlap being declared',
    reachable: 'a need that legitimately grows a reader — a page template does describe the fetch it issues, so reading operations[].method is a reasonable thing to add, and adding it without touching SHARED_CLAIMS is the default way to add it',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'two claimants read one leaf without saying so',
  },

  {
    id: 'grade-empty-truth-scores',
    bug: 'a ground truth with no endpoints still lets categories report a score',
    reachable:
      'the grader as written this morning. `endpoint-identity.recall` is computed against the OBSERVED list and never reads the truth at all, so it reported 1.000 inside a report whose truth side was empty — found by the truth-emptied mutation on the harness\'s first run, hours after the code was written',
    gate: ['pnpm', '-s', 'grade:baseline'],
    expect: 'still reports a score against an empty side',
    change: 'drop the empty-truth ungrounding from gradeSiteModel',
  },
  {
    id: 'binary-source-check-removed',
    bug: 'a NUL byte in a source file stops being noticed, so its diffs are unreadable and no patch can be authored against it',
    reachable:
      'the check deleted outright — the same shape as walker-mustreach-disabled, and the likeliest fate of a whole-repo byte scan somebody finds slow. It landed today because a NUL really did reach grade.ts and really did make git call the file binary',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'nul-byte',
    change: 'stop looking for a NUL byte in assessToolingHostileSource',
  },
  // ---- controls: the gate must NOT fire ------------------------------------

  {
    kind: 'control',
    id: 'sitemodel-declared-share',
    controlFor: 'sitemodel-undeclared-share',
    change: 'the same extra claimant on the same leaf, with the two-way share split into a declared three-way one — a legitimate overlap, written down',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    reachable: 'the correct way to add the reader the defect patch adds carelessly, and the pair is the whole point: the gate must reject the overlap only while it is unwritten',
  },

  {
    kind: 'control',
    id: 'secret-gate-exemption-respelled',
    controlFor: 'secret-gate-path-suffix',
    reachable: 'an ordinary refactor to another correct API already exported from shared',
    change: 'the §3.4 exemption re-spelled as matchesAnyPath(rel, [P]) — the same anchored comparison through a different call, on the line the defect rewrites',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
  },
  {
    kind: 'control',
    id: 'walker-ignore-anchored-addition',
    controlFor: 'walker-unanchored-ignore',
    reachable: 'the ignore list is meant to grow; this is what growing it correctly looks like',
    change: "a fifth ignore pattern, '**/coverage', correctly anchored — the same array the defect un-anchors",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
  },
];

export const isControl = (s) => s.kind === 'control';
const DEFECTS = SABOTAGES.filter((s) => !isControl(s));
const CONTROLS = SABOTAGES.filter(isControl);

/**
 * Is the table itself well formed? One message per problem, never a throw.
 *
 * Every one of these checks used to sit inline in `main()`, where the only
 * table it could ever see was the real one — which passes. A gate reachable
 * only through the input it passes on is a gate nobody can prove fires, and
 * that is the root these four checks share with the vacuous invariant and the
 * unreachable patch they exist to prevent. Here the table and the directory
 * listing arrive as parameters, so a test can hand it a table with no controls
 * and watch it object.
 *
 * `patchIds` is the sorted list of `sabotage/*.patch` basenames.
 */
export function assessSabotageTable(entries, patchIds) {
  const problems = [];
  const defects = entries.filter((e) => !isControl(e));
  const controls = entries.filter(isControl);

  // The completeness assertion this repo applies to every rule table: a patch
  // on disk with no entry here would never run, and an entry with no patch
  // would be a claim about a file that does not exist.
  const declared = entries.map((e) => e.id).slice().sort();
  const onDisk = patchIds.slice().sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    problems.push(
      `sabotage/ and the table disagree.\n  on disk:  ${onDisk.join(', ')}\n  declared: ${declared.join(', ')}`,
    );
  }
  if (defects.length === 0) {
    problems.push('no sabotages declared — a harness that runs nothing reports success.');
  }
  // §13: a table made only of drops passes while proving nothing about
  // isolation. At least one control, and each control has to name a defect that
  // exists — an unpaired control is a patch nobody can say what it isolates.
  if (controls.length === 0) {
    problems.push(
      'no controls declared. A harness of defects alone cannot tell a gate that\n' +
      'discriminates from one that fails on any edit at all — see §13.',
    );
  }
  // §13: every entry states why a real run or a real edit reaches the state it
  // produces. A gate behaving correctly on unreachable input proves nothing
  // about reachable input, and reads exactly like a gate that works.
  const unreachable = entries.filter((e) => !e.reachable || e.reachable.length < 20);
  if (unreachable.length > 0) {
    problems.push(
      `${unreachable.map((e) => e.id).join(', ')}: no reachability note.\n` +
      'Say why a real run or a real edit arrives at this state — see §13.',
    );
  }
  const defectIds = new Set(defects.map((e) => e.id));
  for (const control of controls) {
    if (!defectIds.has(control.controlFor)) {
      problems.push(`control ${control.id} names ${control.controlFor}, which is not a declared defect.`);
    }
  }
  return problems;
}

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

/**
 * A signature of the working tree, so residue after a revert is visible.
 *
 * Reads only. An earlier version ran `git add -A --intent-to-add` first, which
 * meant the "did the revert leave anything behind" *check* wrote to the index —
 * a read with a side effect, in a harness whose whole job is leaving no trace.
 * `--porcelain` already reports untracked files.
 */
const treeSignature = () => git('status', '--porcelain');

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
    ? readdirSync(PATCHES).filter((f) => f.endsWith('.patch')).map((f) => f.slice(0, -6))
    : [];
  const problems = assessSabotageTable(SABOTAGES, onDisk);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`\n${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `\nsabotage — ${DEFECTS.length} fixed bug(s) reintroduced, ` +
    `${CONTROLS.length} control(s) that must change nothing\n`,
  );
  const before = treeSignature();
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

    // 2. A defect must make the gate fail, for the stated reason. A control
    //    must leave it green — a control that fails means the gate is keyed on
    //    the edit rather than on the meaning, which makes every defect row
    //    above it unfalsifiable.
    const gate = run(sabotage.gate);
    let verdict;
    if (isControl(sabotage)) {
      if (gate.code === 0) {
        verdict = `✓  unmoved   (control for ${sabotage.controlFor})`;
      } else {
        verdict = `✗  the gate fired on a meaning-preserving change: ${sabotage.change}`;
        console.log(verdict);
        console.log('      It is keyed on the edit, not on the property — so its defect row proves nothing.');
        console.log(`      ${gate.output.trim().split('\n').slice(-6).join('\n      ')}`);
        verdict = null;
        failed += 1;
      }
    } else if (gate.code === 0) {
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
    if (treeSignature() !== before) {
      console.log('✗  revert left residue; every later result would be noise');
      process.exit(1);
    }
    if (verdict !== null) console.log(verdict);
  }

  console.log('');
  if (failed > 0) {
    console.log(`✗ ${failed} entr(ies) did not behave as declared.\n`);
    process.exit(1);
  }
  console.log(
    '✓ every gate failed when its bug came back, held still when nothing changed,\n' +
    '  and the tree is clean.\n',
  );
}

// Importing this file for `SABOTAGES` or `assessSabotageTable` must not apply
// patches to the working tree. The linters here already have this shape.
if (import.meta.url === `file://${process.argv[1]}`) main();
