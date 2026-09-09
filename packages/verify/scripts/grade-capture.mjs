#!/usr/bin/env node
/**
 * Grade a model infer produced, against the pinned ground truth.
 *
 *   node grade-capture.mjs vikunja
 *
 * Reads three files and nothing else: the model infer wrote, the truth the
 * snapshot pinned, and the endpoint index capture recorded. **The observed list
 * comes from the capture, never from the model** — `endpoint-identity.recall`
 * is over what the crawl touched, and recomputing it from the model would make
 * a dropped endpoint disappear from its own denominator, so the recall would
 * read 1.0 for a model that emitted nothing.
 *
 * This direction of dependency is the allowed one: verify reads infer's output.
 * The reverse — infer importing the grader — is what 0020 forbids and
 * `assessGraderFirewall` enforces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SiteModelSchema } from '../../schema/dist/index.js';
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
console.log('');
console.log('  metric                                value       n/d  gate');
for (const metric of report.metrics) {
  const mark = metric.vacuous ? '✗' : metric.passed === false ? '✗' : '✓';
  const value = metric.vacuous
    ? 'vacuous'
    : metric.kind === 'count'
      ? String(metric.numerator)
      : metric.value.toFixed(3);
  console.log(
    `  ${mark} ${metric.id.padEnd(34)} ${value.padStart(7)}  ${`${metric.numerator}/${metric.denominator}`.padStart(8)}  ${gateOf(metric)}`,
  );
  if (metric.vacuous && metric.emptyDenominator) {
    console.log(`      ${metric.emptyDenominator}`);
  }
}
console.log('');
if (report.failedCategories.length > 0) {
  console.log(`  ✗ failed: ${report.failedCategories.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  ✓ every gated category passed.');
}
