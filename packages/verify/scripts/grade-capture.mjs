#!/usr/bin/env node
/**
 * Grade a model infer produced, against the pinned ground truth.
 *
 *   node grade-capture.mjs vikunja
 *
 * Reads three files and nothing else: the model infer wrote, the truth the
 * snapshot pinned, and the endpoint index capture recorded. **The observed list
 * comes from the capture, never from the model** — `endpoint-identity.conservation`
 * is over what the crawl touched, and recomputing it from the model would make
 * a dropped endpoint disappear from its own denominator, so it would read 1.000
 * for a model that emitted nothing. That is also why it is named a conservation
 * check rather than a recall: both sides come from the observed list, so any
 * stage that transcribes the index scores 1.000 and only a *dropped* endpoint
 * moves it.
 *
 * This direction of dependency is the allowed one: verify reads infer's output.
 * The reverse — infer importing the grader — is what 0020 forbids and
 * `assessGraderFirewall` enforces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADE_SUITES, SiteModelSchema } from '../../schema/dist/index.js';
import { gradeSiteModel } from '../dist/grade/grade.js';
import { loadVikunjaTruth } from '../dist/grade/truth/vikunja.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TRUTHS = { vikunja: loadVikunjaTruth };

const siteId = process.argv[2] ?? 'vikunja';
const loadTruth = TRUTHS[siteId];
if (loadTruth === undefined) {
  console.error(`no ground truth for '${siteId}'. Known: ${Object.keys(TRUTHS).join(', ')}`);
  process.exit(1);
}

const withoutAt = process.argv.indexOf('--without');
const without = withoutAt === -1 ? null : process.argv[withoutAt + 1];
const modelFile = without === null ? 'site-model.json' : `site-model.without-${without}.json`;
const model = SiteModelSchema.parse(
  JSON.parse(readFileSync(join(REPO, 'envs', siteId, modelFile), 'utf8')),
);
const capture = JSON.parse(
  readFileSync(join(REPO, 'capture', siteId, 'network', 'endpoints.json'), 'utf8'),
);
const observed = capture.endpoints.map((e) => ({ method: e.method, pathPattern: e.pathPattern }));

const gateOf = (metric) => {
  if (metric.gate === null) return 'reported';
  const arrow = metric.gate.direction === 'atLeast' ? '≥' : '≤';
  return `${arrow} ${metric.gate.value}${metric.gate.kind === 'structural' ? ' !' : ''}`;
};

const report = gradeSiteModel({ model, truth: loadTruth(), observed, divergence: [] });

console.log(`\ngrade — ${siteId}, inferred from a real capture${without === null ? '' : `  (without ${without})`}`);
console.log(`  metrics v${report.metricsVersion}, contract ${report.contractDigest.slice(0, 16)}…\n`);
const m = report.matching;
console.log(
  `  matched ${m.matched} endpoint(s), ${m.unmatchedOperations} unmatched, ` +
  `${m.outOfUniverse} out-of-universe, ${m.ambiguous.length} ambiguous, ${m.arityMismatches} arity mismatch(es)`,
);
/**
 * The `inference` suite's alignment, and its capture half.
 *
 * `unpairedReachable` is why `entity-identity.recall` is not a metric — and it
 * is deliberately unattributed, because the grader never sees a response body
 * and so cannot tell an empty collection from a token mint infer was right to
 * decline. 0023 §3.1 attributes them by hand.
 */
const e = report.entities;
console.log(
  `  entities: ${e.paired} paired, ${e.inScope} model entities in scope, ` +
  `${e.truthReachable} reachable in the document, ${e.ambiguous.length} ambiguous`,
);
if (e.unpairedReachable.length > 0) {
  console.log(
    `  ${e.unpairedReachable.length} reachable definition(s) paired with no entity — cause NOT attributable from here ` +
    `(an empty collection and a correctly-declined envelope look identical to the grader): ` +
    e.unpairedReachable.join(', '),
  );
}
for (const a of e.ambiguous) console.log(`  ambiguous: ${a}`);

/**
 * Grouped by suite, and a conservation check is marked rather than printed
 * beside the measurements.
 *
 * 0021 printed `endpoint-identity.recall 1.000` next to
 * `path-param-naming 0.600` as though both were results. Both sides of the
 * first come from the observed list, so it reads 1.000 for any stage that
 * transcribes the endpoint index — a number that cannot fall is not evidence,
 * and the report is where that has to be visible.
 */
for (const suite of GRADE_SUITES) {
  const metrics = report.metrics.filter((m) => m.suite === suite);
  console.log(`  ── ${suite} ${'─'.repeat(Math.max(0, 62 - suite.length))}`);
  console.log('  metric                                value       n/d  gate');
  for (const metric of metrics) {
    const mark = metric.vacuous ? '✗' : metric.passed === false ? '✗' : '✓';
    const value = metric.vacuous
      ? 'vacuous'
      : metric.kind === 'count'
        ? String(metric.numerator)
        : metric.value.toFixed(4);
    console.log(
      `  ${mark} ${metric.id.padEnd(34)} ${value.padStart(7)}  ${`${metric.numerator}/${metric.denominator}`.padStart(8)}  ${gateOf(metric)}`,
    );
    if (metric.conservation) {
      console.log(`      conservation check, not a measurement — ${metric.conservation}`);
    }
    if (metric.vacuous && metric.emptyDenominator) {
      console.log(`      ${metric.emptyDenominator}`);
    }
  }
}
console.log('');
if (report.failedCategories.length > 0) {
  console.log(`  ✗ failed: ${report.failedCategories.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  ✓ every gated category passed.');
}
