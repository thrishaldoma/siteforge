#!/usr/bin/env node
/**
 * Compare two gradings — or refuse, which is the point (decision 0053).
 *
 *   node compare-grades.mjs <site>                       # committed baseline vs the last grading
 *   node compare-grades.mjs <before.json> <after.json>   # two explicit files
 *
 * **The baseline is committed and the working report is not**, which is
 * deliberate and is the half that makes the comparison durable. `grade-capture`
 * writes `envs/<site>/grade-run.json`, and `/envs/*​/` is gitignored — so that
 * file is overwritten by the next grading and is invisible to git. A comparator
 * whose only *before* side lives there would still depend on somebody having
 * copied a file aside, which is the terminal-scrollback problem with an extra
 * step. The baseline lives beside the truth snapshot in
 * `packages/verify/fixtures/<site>/grade-run.json`, and promoting a run to it is
 * an explicit commit whose diff someone reads — the same shape as the snapshot
 * staleness gate, and for the same reason.
 *
 * The refusal is the **primary** path rather than a warning printed above a
 * table. 0019's rule: where "refused" and "compared" both render a delta, the
 * wrong answer is already the answer — and a seed change is invisible in a
 * table, which is how 0051's before/after column pair came to describe two
 * different Vikunjas.
 *
 * The judgement is `assessGradeComparability`, which takes two parsed reports
 * and nothing else. This file is wiring: read, parse, render, exit.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GradeRunSchema } from '../../schema/dist/index.js';
import { assessGradeComparability } from '../dist/grade/compare.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');

const args = process.argv.slice(2);
let beforePath;
let afterPath;
if (args.length === 1) {
  beforePath = join(REPO, 'packages', 'verify', 'fixtures', args[0], 'grade-run.json');
  afterPath = join(REPO, 'envs', args[0], 'grade-run.json');
  if (!existsSync(beforePath)) {
    console.error(`no committed baseline at packages/verify/fixtures/${args[0]}/grade-run.json.`);
    console.error('Promote a grading to it in a commit someone reads, then compare against it.');
    process.exit(2);
  }
  if (!existsSync(afterPath)) {
    console.error(`no grading at envs/${args[0]}/grade-run.json — run \`pnpm grade:capture ${args[0]}\` first.`);
    process.exit(2);
  }
} else if (args.length === 2) {
  [beforePath, afterPath] = args;
} else {
  console.error('usage: compare-grades.mjs <site> | compare-grades.mjs <before.json> <after.json>');
  process.exit(2);
}

const load = (path) => GradeRunSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
const before = load(beforePath);
const after = load(afterPath);

const result = assessGradeComparability({ before, after });

if (!result.comparable) {
  console.log(`\n✗ these two gradings do not compare — ${result.refusals.length} reason(s):\n`);
  for (const r of result.refusals) console.log(`  ${r.kind}\n    ${r.detail}\n`);
  console.log('  No delta is rendered. A number carried across this line would be about two targets.\n');
  process.exit(1);
}

console.log(`\ngrade comparison — ${after.siteId}, seed ${result.seedState}\n`);
console.log('  metric                              value            n/d              misses    ');
for (const m of result.movements) {
  const rate = (x) => (x.vacuous ? 'vacuous' : x.kind === 'count' ? String(x.numerator) : x.value.toFixed(4));
  const moved =
    m.numeratorDelta !== 0 || m.denominatorDelta !== 0
      ? m.missesDelta === 0 ? '  (denominator only)' : ''
      : '  (unmoved)';
  // `—` where a side was vacuous. `denominator − numerator` is arithmetically
  // defined for an ungrounded category and means nothing: `narrowing.precision`
  // reads 0/103 because the document declares no formats at all, and printing
  // "103" here would put a figure where the grader prints `vacuous`.
  const miss = (x) => (x === null ? '—' : String(x));
  console.log(
    `  ${m.id.padEnd(34)} ${rate(m.before).padStart(7)} → ${rate(m.after).padEnd(8)} ` +
    `${`${m.before.numerator}/${m.before.denominator}`.padStart(8)} → ${`${m.after.numerator}/${m.after.denominator}`.padEnd(9)} ` +
    `${miss(m.missesBefore).padStart(4)} → ${miss(m.missesAfter).padEnd(4)}${moved}`,
  );
}

if (result.onlyBefore.length > 0 || result.onlyAfter.length > 0) {
  console.log(`\n  metrics on one side only — before: ${result.onlyBefore.join(', ') || 'none'}; after: ${result.onlyAfter.join(', ') || 'none'}`);
}

/**
 * The findings, printed after the table and never folded into it.
 *
 * A movement that is not the movement it looks like has to read as a *finding*
 * rather than as a row a reader might scan past — which is what happened to
 * `field-type` for a whole turn.
 */
if (result.findings.length === 0) {
  console.log('\n  ✓ no metric moved in a way its rate misreports.\n');
} else {
  console.log(`\n  ${result.findings.length} finding(s) — a rate that is not the movement it looks like:\n`);
  for (const f of result.findings) console.log(`  ! ${f.metric}  ${f.kind}\n      ${f.detail}\n`);
}
