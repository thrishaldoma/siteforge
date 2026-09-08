#!/usr/bin/env node
/**
 * `pnpm lint` — no string operations on an identifier grammar.
 *
 * `includes()` on a selector and `endsWith()` on a path are one mistake, not
 * two: a string operation against a grammar with delimiters, where the
 * operation cannot see the delimiters or where the value is anchored. Five
 * occurrences, four grammars, three of them found by deliberately looking
 * rather than by a gate firing — which is why this exists.
 *
 * The rule is deliberately narrow. It fires only when the *receiver* names a
 * value from one of the four grammars, because a rule that fires on every
 * `.includes()` in the repo would collect sixty exemptions and every exemption
 * is a place someone stopped thinking. Array membership (`['GET'].includes(m)`)
 * and parsed-node checks are not this bug and are not flagged.
 *
 * The real fix is upstream: `sameOrigin`, `matchPath`, `assetKind`,
 * `hasScheme`, `hostMatchesAllowEntry` in `@siteforge/shared`, plus
 * `postcss-selector-parser` for selectors. This linter is the backstop for the
 * `.mjs` crawler scripts, which have no types to brand.
 *
 * Escape hatch: `// identifier: <which grammar, and why the string op is
 * right>` on the line above. Naming the grammar is the point — it is the
 * question that catches the mistake.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { REPO_SOURCE_EXPECTATION, walkFiles } from '../packages/shared/dist/index.js';
import { blankNonCode } from './lint-catch.mjs';

/**
 * Receivers whose values come from one of the four grammars.
 *
 * A closed list, taken from an audit rather than guessed. Matched on the last
 * identifier of the receiver expression, so `a.mime` and `mime` both count.
 */
const IDENTIFIER_RECEIVERS = new Set([
  // URLs and their parts
  'url', 'href', 'src', 'uri', 'origin', 'pathname', 'finalUrl', 'entryUrl',
  'originalUrl', 'targetUrl', 'requestUrl', 'location',
  // filesystem and artifact paths
  'path', 'filepath', 'filePath', 'relPath', 'relDir', 'abs', 'rel', 'dir',
  'pattern', 'route', 'routeId',
  // CSS selectors
  'selector', 'selectorText', 'cssomText', 'stateSelectors',
  // media types
  'mime', 'mimeType', 'contentType', 'type',
]);

const BANNED = ['endsWith', 'startsWith', 'includes'];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** The run of `//` lines immediately above the line containing `index`. */
function precedingComment(text, index) {
  const lines = text.slice(0, index).split('\n');
  lines.pop();
  const block = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('//')) break;
    block.unshift(line);
  }
  return block.join('\n');
}

/** Lint one file's text. Returns `{ examined, violations }`. */
export function lintIdentifiers(file, text) {
  const violations = [];
  let examined = 0;
  const code = blankNonCode(text);
  // `<receiver>.<method>(` where receiver ends in an identifier we care about.
  const re = new RegExp(String.raw`([A-Za-z_$][\w$]*)\s*\.\s*(${BANNED.join('|')})\s*\(`, 'g');
  let m;
  while ((m = re.exec(code)) !== null) {
    const receiver = m[1];
    const method = m[2];
    if (!IDENTIFIER_RECEIVERS.has(receiver)) continue;
    examined += 1;
    const index = m.index;
    // The whole contiguous comment block above, not just one line: a reason
    // worth writing rarely fits on one, and a marker the linter cannot see is
    // an exemption that silently is not one.
    if (precedingComment(text, index).includes('identifier:')) continue;
    violations.push({
      file,
      line: lineOf(code, index),
      message: `${receiver}.${method}() is a string operation on an identifier grammar. Use the parsed comparison — sameOrigin/isUnder for URLs, matchPath for paths, assetKind/isMime for media types, a selector parser for selectors — or justify it with \`// identifier: <grammar, and why>\`.`,
    });
  }
  return { examined, violations };
}

export function lintRepo(repo, roots = ['packages', 'scripts'], expect = REPO_SOURCE_EXPECTATION) {
  let examined = 0;
  const violations = [];
  const { files } = walkFiles({ root: repo, within: roots, profile: 'source', expect });
  for (const file of files) {
    const result = lintIdentifiers(relative(repo, file), readFileSync(file, 'utf8'));
    examined += result.examined;
    violations.push(...result.violations);
  }
  return { files: files.length, examined, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.cwd();
  const { files, examined, violations } = lintRepo(repo);
  console.log(`\nlint:identifiers — ${examined} identifier comparison(s) across ${files} source file(s)\n`);
  if (violations.length > 0) {
    for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}\n      ${v.message}`);
    console.log(`\n✗ ${violations.length} string operation(s) on an identifier grammar.`);
    process.exit(1);
  }
  console.log('✓ every identifier comparison is structured.');
}
