#!/usr/bin/env node
/**
 * `pnpm grade:baseline` — the grader run against the hand-authored model, and
 * every mutation delta beside it.
 *
 * Two tables, because they say different things and only one of them is
 * evidence. The baseline scores ~1.0 by construction: it was transcribed from
 * the ground truth, so scoring it well is circular and 0015 §7 says so in as
 * many words. The deltas are what shows the grader measures anything at all.
 *
 * It reads the committed snapshot, runs offline in milliseconds, and belongs in
 * `verify:clean` with the rest of the fast suite. It never touches Docker: the
 * live capture-then-grade run against a real Gitea is the milestone gate.
 */
import { GRADE_SUITES } from '../../schema/dist/index.js';
import {
  GITEA_BASELINE,
  GITEA_OBSERVED,
  gradeSiteModel,
  loadGiteaTruth,
  runMutationHarness,
} from '../dist/index.js';

const pct = (metric) => {
  if (metric.vacuous) return 'vacuous';
  return metric.kind === 'count' ? String(metric.value) : metric.value.toFixed(4);
};

const gateOf = (metric) => {
  if (metric.gate === null) return 'reported';
  const arrow = metric.gate.direction === 'atLeast' ? '≥' : '≤';
  return `${arrow} ${metric.gate.value}${metric.gate.kind === 'structural' ? ' !' : ''}`;
};

const input = {
  model: GITEA_BASELINE,
  truth: loadGiteaTruth(),
  observed: GITEA_OBSERVED,
  divergence: [],
};

const report = gradeSiteModel(input);

console.log(`\ngrade — the hand-authored baseline against the pinned Gitea snapshot`);
console.log(`  metrics v${report.metricsVersion}, contract ${report.contractDigest.slice(0, 16)}…\n`);
console.log(
  `  matched ${report.matching.matched} endpoint(s), ` +
  `${report.matching.unmatchedOperations} unmatched, ` +
  `${report.matching.outOfUniverse} out-of-universe, ` +
  `${report.matching.ambiguous.length} ambiguous, ` +
  `${report.matching.arityMismatches} arity mismatch(es)`,
);
console.log(
  `  crawl coverage ${report.crawlCoverage.observed}/${report.crawlCoverage.specTotal} ` +
  `spec operations — a property of CAPTURE, reported and not gated`,
);
console.log(
  `  auth truth: ${report.auth.observedRequired} required, ${report.auth.observedNotRequired} public, ` +
  `${report.auth.indeterminate} indeterminate, ${report.auth.unobserved} unobserved\n`,
);

// Grouped by suite, and a conservation check says so on its own line rather
// than sitting in the column of measurements (0022).
for (const suite of GRADE_SUITES) {
  console.log(`  ── ${suite} ${'─'.repeat(Math.max(0, 60 - suite.length))}`);
  console.log(`  ${'metric'.padEnd(34)} ${'value'.padStart(8)} ${'n/d'.padStart(9)}  gate`);
  for (const metric of report.metrics.filter((m) => m.suite === suite)) {
    console.log(
      `  ${metric.passed ? '✓' : '✗'} ${metric.id.padEnd(32)} ${pct(metric).padStart(8)} ` +
      `${`${metric.numerator}/${metric.denominator}`.padStart(9)}  ${gateOf(metric)}` +
      (metric.conservation ? `\n      conservation check, not a measurement — ${metric.conservation}` : '') +
      (metric.vacuous ? `\n      ${metric.emptyDenominator}` : ''),
    );
  }
  console.log('');
}
console.log(
  `\n  ${report.passed ? '✓ every category passed' : `✗ failed: ${report.failedCategories.join(', ')}`}`,
);

// ---------------------------------------------------------------------------

const harness = runMutationHarness(input);

console.log(`\n\nmutation deltas — ${harness.results.length} perturbations of the same inputs\n`);
if (harness.tableProblems.length > 0) {
  for (const problem of harness.tableProblems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
if (harness.staleBlocks.length > 0) {
  for (const id of harness.staleBlocks) {
    console.error(`  ✗ ${id} is marked blocked, but its truth side now exists. Enable the row.`);
  }
  process.exit(1);
}

let failed = 0;
for (const result of harness.results) {
  const moved = result.deltas.filter(
    (d) => d.before !== d.after || d.beforeVacuous !== d.afterVacuous,
  );
  const mark = result.blocked ? '–' : result.failures.length === 0 ? '✓' : '✗';
  console.log(`  ${mark} ${result.mutation.id.padEnd(34)} ${result.mutation.change}`);
  if (result.blocked) {
    console.log(`      blocked: the ${result.mutation.blockedBy} truth side is not derived yet`);
    continue;
  }
  for (const delta of moved) {
    const before = delta.beforeVacuous ? 'vacuous' : delta.before?.toFixed(3);
    const after = delta.afterVacuous ? 'vacuous' : delta.after?.toFixed(3);
    console.log(`      ${delta.metric.padEnd(32)} ${String(before).padStart(8)} → ${String(after).padStart(8)}`);
  }
  if (moved.length === 0) console.log('      (nothing moved — this row is a control)');
  for (const failure of result.failures) {
    console.log(`      ✗ ${failure}`);
    failed += 1;
  }
}

console.log('');
if (failed > 0) {
  console.log(`✗ ${failed} declared claim(s) did not hold.\n`);
  process.exit(1);
}
console.log(
  '✓ every mutation moved the metric it names, and every control held its scores exactly.\n',
);
