/**
 * `pnpm lint` — an empty container must never silently admit (§13).
 *
 * `[].every(…)` is `true`. That is correct set theory and a dangerous default,
 * because in every use in this repository `true` is the permissive answer: the
 * path is in scope, the claim agrees, the value is admitted. So a predicate
 * written over a collection that can be empty says *yes* precisely when it has
 * nothing to go on.
 *
 * It has a track record now. `inUniverse(path, '/')` produced an empty segment
 * list and admitted every path in existence — the grader's universe filter did
 * not become permissive, it stopped being a filter, and `endpoint-identity`
 * would have absorbed an entire admin SPA (0019). The audit that followed found
 * the same two lines written three times — the grader's universe, the crawl
 * boundary in `isUnder`, and `matchPath`'s `under` branch — each deciding the
 * empty case by accident and each differently. Two more sat elsewhere: a
 * document declaring `enum: []` made every model claim agree with it, and
 * `classifyStringField` would have returned a fully-justified enum for a field
 * nothing was ever observed for.
 *
 * The rule is not "never call `.every`". It is that the emptiness decision has
 * to be **visible at the call site**: a length guard on the same line or just
 * above it, or an `// empty:` comment saying what an empty container means
 * here. Same shape as `// operational:` — greppable, and visible in review.
 *
 * **`.some()` is deliberately not covered**, and the reason is a property of
 * the operator rather than of how many sites it would flag. `.some()` returns
 * `false` on empty, which is the *restrictive* answer wherever it is used to
 * detect a problem — 41 sites here, essentially all of that shape — and
 * permissive only in the rarer "require a witness" use, where the absence of a
 * witness is the finding and reads correctly anyway. `.every()` has one
 * direction and it is the dangerous one. If a `.some()` instance ever bites,
 * that argument is what has to be shown wrong first.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_SOURCE_EXPECTATION, walkFiles } from '../packages/shared/dist/index.js';
import { blankNonCode } from './lint-catch.mjs';

/** How far above the call an emptiness guard still counts as "at the call site". */
const GUARD_LINES = 3;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Lint one file's text. Returns `{ examined, violations }`. */
export function lintEmptyAdmits(file, text) {
  const violations = [];
  let examined = 0;
  const code = blankNonCode(text);
  // The receiver is whatever identifier chain the call hangs off. A call on a
  // parenthesised expression has no name to guard, so it is always flagged.
  const re = /([A-Za-z_$][\w$.[\]'"]*)\.every\s*\(/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    examined += 1;
    const receiver = m[1];
    const line = lineOf(code, m.index);
    const lines = text.split('\n');
    const from = Math.max(0, line - 1 - GUARD_LINES);
    const window = lines.slice(from, line).join('\n');
    // `.length` on the same receiver, anywhere in the window: an equality, a
    // floor, a `> 0`, or a throw. Which one it is is the author's business;
    // that they made the decision is this rule's.
    const guarded = new RegExp(`${receiver.replace(/[.[\]$'"]/g, '\\$&')}\\s*\\.length`).test(window);
    if (guarded) continue;
    if (/\/\/\s*empty:/.test(window)) continue;
    violations.push({
      file,
      line,
      message: `${receiver}.every(…) is true when ${receiver} is empty, and true is the permissive answer. Guard on ${receiver}.length, or say what empty means with \`// empty: <reason>\`.`,
    });
  }
  return { examined, violations };
}

export function lintRepo(repo, roots = ['packages', 'scripts'], expect = REPO_SOURCE_EXPECTATION) {
  let examined = 0;
  const violations = [];
  const { files } = walkFiles({ root: repo, within: roots, profile: 'source', expect });
  for (const file of files) {
    const result = lintEmptyAdmits(relative(repo, file), readFileSync(file, 'utf8'));
    examined += result.examined;
    violations.push(...result.violations);
  }
  return { files: files.length, examined, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.cwd();
  const { files, examined, violations } = lintRepo(repo);
  console.log(`\nlint:empty — ${examined} every() predicate(s) across ${files} source file(s)\n`);
  if (violations.length > 0) {
    for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}\n      ${v.message}`);
    console.log(`\n✗ ${violations.length} predicate(s) admit everything when handed nothing.`);
    process.exit(1);
  }
  console.log('✓ every empty container fails closed, throws, or says what it means.');
}
