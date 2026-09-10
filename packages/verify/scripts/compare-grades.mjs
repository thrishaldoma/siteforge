#!/usr/bin/env node
/**
 * Compare two gradings — or refuse, which is the point (decision 0053).
 *
 *   node compare-grades.mjs <before.json> <after.json>
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
import { readFileSync } from 'node:fs';
import { GradeRunSchema } from '../../schema/dist/index.js';
import { assessGradeComparability } from '../dist/grade/compare.js';

const [beforePath, afterPath] = process.argv.slice(2);
if (beforePath === undefined || afterPath === undefined) {
  console.error('usage: compare-grades.mjs <before.json> <after.json>');
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
  console.log(
    `  ${m.id.padEnd(34)} ${rate(m.before).padStart(7)} → ${rate(m.after).padEnd(8)} ` +
    `${`${m.before.numerator}/${m.before.denominator}`.padStart(8)} → ${`${m.after.numerator}/${m.after.denominator}`.padEnd(9)} ` +
    `${String(m.missesBefore).padStart(4)} → ${String(m.missesAfter).padEnd(4)}${moved}`,
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
