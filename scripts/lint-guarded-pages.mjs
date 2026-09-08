#!/usr/bin/env node
/**
 * Every page the crawler opens must carry the escape guards.
 *
 * `installOriginGuard` sits on the context and stops off-origin *requests*
 * (decision 0012). It cannot see the escapes that are not requests: a popup,
 * a `target="_blank"`, a download. Those are page-level events, so the guard
 * for them is page-level too — and a page-level guard is one you can forget at
 * a `newPage()` that gets added later.
 *
 * This linter exists because I audited that property by hand, found it already
 * held, and discovered the open item claiming otherwise in docs/decisions/0012
 * was simply stale. A property checked by reading is a property checked once.
 * §13: make it a gate or it is prose.
 *
 * Escape hatch: `// unguarded: <reason>` on the line above, for a page that
 * genuinely must not be guarded (a test asserting what happens without one).
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { blankNonCode } from './lint-catch.mjs';
import { REPO_SOURCE_EXPECTATION, walkFiles } from '../packages/shared/dist/index.js';

/** Code that must appear soon after the page is created, on the same variable. */
const GUARD = 'installEscapeGuards';
/**
 * How far after the `newPage()` the guard may sit. Wide enough for a comment
 * and a blank line, narrow enough that a guard attached after a `goto` — by
 * which point a popup could already have opened — does not count.
 */
const WINDOW = 400;

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function lintGuardedPages(file, text) {
  const violations = [];
  let examined = 0;
  const code = blankNonCode(text);
  // `const page = await ctx.newPage()`, and the unassigned `await x.newPage()`.
  const re = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)?await\s+[\w$.[\]]+\.newPage\s*\(\s*\)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    examined += 1;
    const line = lineOf(code, m.index);
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    if (/\/\/\s*unguarded:/.test(text.slice(prevStart, lineStart))) continue;

    const name = m[1];
    if (!name) {
      violations.push({
        file, line,
        message: 'newPage() result is not bound, so no escape guard can be attached to it. Assign it and call installEscapeGuards(page, { onBlocked }).',
      });
      continue;
    }
    const after = code.slice(m.index + m[0].length, m.index + m[0].length + WINDOW);
    // The guard must name *this* page: `installEscapeGuards(otherPage)` nearby
    // is exactly the copy-paste slip worth catching.
    if (!new RegExp(`${GUARD}\\s*\\(\\s*${name}\\b`).test(after)) {
      violations.push({
        file, line,
        message: `page \`${name}\` is opened without ${GUARD}(${name}, { onBlocked }). A popup, target="_blank" or download from this page would escape unrecorded — the context router does not see them. Justify with \`// unguarded: <reason>\`.`,
      });
    }
  }
  return { examined, violations };
}

export function lintRepo(repo, roots = ['packages', 'scripts'], expect = REPO_SOURCE_EXPECTATION) {
  let examined = 0;
  const violations = [];
  const { files } = walkFiles({ root: repo, within: roots, profile: 'source', expect });
  for (const file of files) {
    const result = lintGuardedPages(relative(repo, file), readFileSync(file, 'utf8'));
    examined += result.examined;
    violations.push(...result.violations);
  }
  return { files: files.length, examined, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.cwd();
  const { files, examined, violations } = lintRepo(repo);
  console.log(`\nlint:pages — ${examined} page(s) opened across ${files} source file(s)\n`);
  if (violations.length > 0) {
    for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}\n      ${v.message}`);
    console.log(`\n✗ ${violations.length} page(s) can let an escape go unrecorded.`);
    process.exit(1);
  }
  console.log('✓ every page opened carries the escape guards.');
}
