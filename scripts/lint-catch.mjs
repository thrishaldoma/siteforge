/**
 * `pnpm lint` — the catch taxonomy (§13), enforced.
 *
 * Two classes of failure: operational (a timeout, an aborted navigation, a
 * detached element — expected, recoverable, becomes a gap) and everything else
 * (programming errors, which must always propagate). A `catch` that cannot tell
 * them apart converts a bug into missing data, and missing data is strictly
 * worse than a crash: a crash stops the run, missing data reports success and
 * poisons every stage downstream.
 *
 * That is not a hypothetical. A stray `probed += 1` left behind by an extraction
 * threw `ReferenceError` after a flow had been recorded, landed in a bare
 * `catch`, and every probe reported success while the code behind the throw
 * silently never ran.
 *
 * The rule: every `catch` binds an error, and its body either calls
 * `rethrowIfDefect` / `isOperationalError` or `throw`s. A `catch` that genuinely
 * wants to swallow must say so with `// operational:` and a reason — visible in
 * review, and greppable.
 *
 * The walk, its ignore rules and its non-vacuity guarantee come from
 * `@siteforge/shared`'s `walkFiles` — this file owns the catch rule and nothing
 * else. Its own private walker was the third instance of a bare directory name
 * hiding `packages/capture/` from a tool in this repo.
 */
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
// From dist, like every other script here (`packages/capture/scripts` imports
// `../../schema/dist/index.js`). `pnpm lint` builds shared first; a linter that
// cannot load its walker must fail loudly rather than fall back to one of its
// own, which is the duplication this import exists to end.
import { REPO_SOURCE_EXPECTATION, walkFiles } from '../packages/shared/dist/index.js';

/**
 * Blank out strings, template literals and comments, keeping every offset.
 *
 * Without this the scanner matched the word `catch` inside its own error
 * message and reported itself. Characters are replaced one-for-one with spaces
 * so line numbers and brace matching stay exact.
 */
export function blankNonCode(text) {
  const out = text.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      blank(i, end === -1 ? text.length : end);
      i = end === -1 ? text.length : end;
    } else if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      blank(i, end === -1 ? text.length : end + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let k = i + 1;
      while (k < text.length) {
        if (text[k] === '\\') { k += 2; continue; }
        if (text[k] === ch) break;
        k += 1;
      }
      blank(i, k + 1);
      i = k + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** The span from `open` to its matching close, for any bracket pair. */
function spanAt(text, open, [openCh, closeCh]) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === openCh) depth += 1;
    else if (ch === closeCh) {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

/** The body of the block starting at `open`, by brace matching. */
function blockAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Lint one file's text. Returns `{ examined, violations }`. */
export function lintCatches(file, text) {
  const violations = [];
  let examined = 0;
  // Code positions come from the blanked copy; the excuse comment is read from
  // the original, because blanking removes comments by design.
  const code = blankNonCode(text);
  const re = /\bcatch\s*(\(([^)]*)\))?\s*\{/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    examined += 1;
    const binding = (m[2] ?? '').trim();
    const open = code.indexOf('{', m.index + 5);
    const body = blockAt(code, open);
    const line = lineOf(code, m.index);
    // The excuse may sit inside the body, or on the line above — a one-line
    // `} catch { return null; }` has nowhere to put a comment inside it.
    const bodyText = text.slice(open, open + body.length);
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const nearby = text.slice(prevStart, lineStart) + bodyText;
    const excused = /\/\/\s*operational:/.test(nearby);

    if (!binding) {
      if (excused) continue;
      violations.push({
        file, line,
        message: 'bare `catch {}` cannot tell a timeout from a ReferenceError. Bind the error and call rethrowIfDefect(err), or justify it with `// operational: <reason>`.',
      });
      continue;
    }
    const handles = /rethrowIfDefect|isOperationalError|\bthrow\b/.test(body);
    if (!handles && !excused) {
      violations.push({
        file, line,
        message: `catch (${binding}) swallows every error, defects included. Call rethrowIfDefect(${binding}) first, or justify it with \`// operational: <reason>\`.`,
      });
    }
  }

  /*
   * `.catch(fn)` is the same swallow with different syntax, and it was
   * invisible to the rule above — nine of them sat in the crawler while the
   * linter reported every catch accounted for. `await popup.close().catch(() =>
   * {})` discards a defect exactly as `try/catch` would.
   */
  const promiseRe = /\.catch\s*\(/g;
  while ((m = promiseRe.exec(code)) !== null) {
    examined += 1;
    const open = code.indexOf('(', m.index);
    const handler = spanAt(code, open, ['(', ')']);
    const line = lineOf(code, m.index);
    const lineStart = text.lastIndexOf('\n', m.index) + 1;
    const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
    const nearby = text.slice(prevStart, lineStart) + text.slice(open, open + handler.length);
    if (/\/\/\s*operational:/.test(nearby)) continue;
    if (/rethrowIfDefect|isOperationalError|\bthrow\b/.test(handler)) continue;
    violations.push({
      file, line,
      message: `.catch(${handler.slice(1, -1).trim().slice(0, 40)}) swallows every rejection, defects included. Call rethrowIfDefect first, or justify it with \`// operational: <reason>\`.`,
    });
  }

  return { examined, violations };
}

export function lintRepo(repo, roots = ['packages', 'scripts'], expect = REPO_SOURCE_EXPECTATION) {
  let examined = 0;
  const violations = [];
  // The walker enforces "this scan reached the directories it claims to cover".
  // It used to be an assertion in this file's test, which is exactly the kind of
  // per-scanner habit that gets forgotten by the next scanner.
  const { files } = walkFiles({ root: repo, within: roots, profile: 'source', expect });
  for (const file of files) {
    const result = lintCatches(relative(repo, file), readFileSync(file, 'utf8'));
    examined += result.examined;
    violations.push(...result.violations);
  }
  return { files: files.length, examined, violations };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.cwd();
  const { files, examined, violations } = lintRepo(repo);
  console.log(`\nlint:catch — ${examined} catch block(s) across ${files} source file(s)\n`);
  if (violations.length > 0) {
    for (const v of violations) console.log(`  ✗ ${v.file}:${v.line}\n      ${v.message}`);
    console.log(`\n✗ ${violations.length} catch block(s) can swallow a defect.`);
    process.exit(1);
  }
  console.log('✓ every catch distinguishes an operational failure from a defect.');
}
