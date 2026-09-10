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
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CaptureManifestSchema, DEFERRALS, GRADE_SUITES, GradeRunSchema, MODEL_COLLECTIONS,
  SiteModelSchema, assessDeferrals, assessModelAssembly, assessSeedExpiry, collectionsOf,
  countEmissions, seedStateLabel, shortHash,
} from '../../schema/dist/index.js';
import { missesOf } from '../dist/grade/compare.js';
import { gradeSiteModel } from '../dist/grade/grade.js';
import { loadVikunjaTruth } from '../dist/grade/truth/vikunja.js';
import { KNOWN_DIVERGENCE } from '../dist/grade/known-divergence.js';

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
/**
 * Which instance the graded capture was taken against (0053).
 *
 * From the capture's own manifest, never from anything the grader knows: a
 * grade report that derived this from its own inputs would be describing the
 * grading rather than the thing graded.
 */
const manifest = CaptureManifestSchema.parse(
  JSON.parse(readFileSync(join(REPO, 'capture', siteId, 'manifest.json'), 'utf8')),
);
/**
 * The observed side, from the capture and nothing else.
 *
 * `statuses` is carried because 0049's exclusion turns on whether the crawl
 * *saw* a status the document is silent about — read from the artifact, never
 * from the model, or a status infer invented would excuse itself.
 */
const observed = capture.endpoints.map((e) => ({
  method: e.method,
  pathPattern: e.pathPattern,
  statuses: (e.responses ?? []).map((r) => String(r.status)),
}));

const gateOf = (metric) => {
  if (metric.gate === null) return 'reported';
  const arrow = metric.gate.direction === 'atLeast' ? '≥' : '≤';
  return `${arrow} ${metric.gate.value}${metric.gate.kind === 'structural' ? ' !' : ''}`;
};

const report = gradeSiteModel({
  model, truth: loadTruth(), observed, divergence: KNOWN_DIVERGENCE,
});

console.log(`\ngrade — ${siteId}, inferred from a real capture${without === null ? '' : `  (without ${without})`}`);
console.log(`  metrics v${report.metricsVersion}, contract ${report.contractDigest.slice(0, 16)}…`);
// The seed, on every report. A number read without it is a number about an
// instance nobody named (0053 §1).
console.log(`  seed: ${seedStateLabel(manifest.seedState)}\n`);
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
  console.log('  metric                                value       n/d  misses    gate');
  for (const metric of metrics) {
    const mark = metric.vacuous ? '✗' : metric.passed === false ? '✗' : '✓';
    const value = metric.vacuous
      ? 'vacuous'
      : metric.kind === 'count'
        ? String(metric.numerator)
        : metric.value.toFixed(4);
    /**
     * The miss count, beside every rate (0053 §3).
     *
     * `field-type` read 0.9000 → 0.9433 with its miss count byte-identical at
     * 25, on a denominator that went 250 → 441. A table carrying only the rate
     * could not have shown that, and did not. The absolute number of wrong
     * answers is what a denominator cannot dilute.
     */
    const misses = metric.vacuous ? '' : `miss ${String(missesOf(metric)).padStart(4)}`;
    console.log(
      `  ${mark} ${metric.id.padEnd(34)} ${value.padStart(7)}  ${`${metric.numerator}/${metric.denominator}`.padStart(8)}  ${misses.padEnd(10)}${gateOf(metric)}`,
    );
    if (metric.conservation) {
      console.log(`      conservation check, not a measurement — ${metric.conservation}`);
    }
    if (metric.vacuous && metric.emptyDenominator) {
      console.log(`      ${metric.emptyDenominator}`);
    }
  }
}
/**
 * The known-divergence budget, printed whenever the list is non-empty.
 *
 * Not optional output. `assessDivergenceBudget` computes a verdict that nothing
 * rendered until 0033, which is `manifest.contentHash` in a second place — a
 * check that runs, produces an answer, and reaches nobody is indistinguishable
 * from one that never ran. The concentration signal firing *is* the information
 * here (0033 §3.1), so hiding it would defeat the reason the entries were
 * registered rather than argued.
 */
if (report.divergence.total > 0) {
  const d = report.divergence;
  console.log(`\n  known divergence — ${d.total} entr(y|ies), excluded from numerator and denominator both`);
  for (const row of d.perCategory) {
    console.log(`    endpoint-scope  ${row.category}: ${row.count} of ${d.gradedEndpoints} graded endpoint(s), cap ${d.cap.toFixed(2)}`);
  }
  for (const row of d.perCategoryFields) {
    const verdict = row.overCap ? 'OVER CAP' : row.concentrated ? 'concentrated' : 'within budget';
    console.log(`    field-scope     ${row.category}: ${row.count} of ${row.denominator} scored slot(s), cap ${row.cap.toFixed(2)} — ${verdict}`);
  }
  for (const message of d.messages) console.log(`    · ${message}`);
}

/**
 * 0049's reach, printed every run.
 *
 * "One judgement, N instances" is the right shape for a systematic document
 * omission and is also the shape of an escape from a cap. What separates
 * them is that this scope is checkable independently of N — but N still has
 * to be visible, or the exclusion grows and nobody sees it.
 */
const omissions = report.documentOmissions;
if (omissions.ofModelFields > 0) {
  const share = omissions.excused / omissions.ofModelFields;
  console.log(
    `\n  document omissions (0049) — ${omissions.excused} of ${omissions.ofModelFields} model ` +
    `response field(s) excused, ${(share * 100).toFixed(1)}%: the document declares no response ` +
    'at a status the crawl observed.',
  );
}

console.log('');
/**
 * The deferrals still describing the model they defer (0045).
 *
 * Run here rather than inside `gradeSiteModel` because it is a claim about
 * *policy* against the model, not a metric: it answers "is this deferral still
 * the kind of deferral it says it is", and the answer must be checkable even
 * on a target where every metric is vacuous.
 */
const emissions = countEmissions(model);
const deferralFindings = assessDeferrals({ deferrals: DEFERRALS, emissions });
console.log('\n  deferrals (0045) — what the model claims where nothing scores it:');
for (const d of DEFERRALS) {
  const n = emissions[d.category] ?? 0;
  console.log(`    ${d.kind === 'emits-but-unscored' ? '!' : ' '} ${d.category.padEnd(22)} ${d.kind.padEnd(20)} emits ${n}`);
}

/**
 * `narrowing`'s expiry, checked rather than remembered.
 *
 * **Filesystem view, deliberately.** `/envs/*​/` is gitignored, so a seed file
 * is invisible to git by construction and a caller reading `git status` would
 * report clean forever — §13's two-views rule, which has produced three
 * separate defects here already.
 */
const seedFiles = [];
const envsRoot = join(REPO, 'envs');
if (existsSync(envsRoot)) {
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs, `${rel}/${name}`);
      // Parsed, not a suffix test: the containing directory's last *segment*
      // must be `seeds`, and the extension comes from `extname`. `endsWith`
      // here is the substring-for-token family §13 keeps finding — a directory
      // named `my-seeds` would satisfy it.
      else if (rel.split('/').at(-1) === 'seeds' && extname(name) === '.json') {
        seedFiles.push(`${rel}/${name}`);
      }
    }
  };
  walk(envsRoot, 'envs');
}
const narrowingScored = report.metrics.some((x) => x.id.startsWith('narrowing.') && !x.vacuous && x.gate !== undefined);
const seedExpiry = assessSeedExpiry({ seedFiles, narrowingScored });
if (seedExpiry !== null) {
  console.log(`\n  ✗ narrowing's deferral has expired: ${seedExpiry.detail}`);
} else {
  console.log(`    seed expiry: not fired — ${seedFiles.length} seed artifact(s) on disk, narrowing ${narrowingScored ? 'scored' : 'unscored'}`);
}

if (deferralFindings.length > 0) {
  console.log(`\n  ✗ ${deferralFindings.length} deferral(s) no longer describe the model:`);
  for (const f of deferralFindings) console.log(`    ${f.category}: ${f.problem} — ${f.detail}`);
}

/**
 * The parts capture fills and infer assembles as `[]`.
 *
 * Read from `coverage.json`, which is capture's own count of what the raw
 * input held — the independently-derived side §6 requires — rather than from
 * the artifacts again. Counting the model's inputs with the model's own
 * reader is how both sides move together and the check goes vacuous.
 */
const coverage = JSON.parse(
  readFileSync(join(REPO, 'capture', siteId, 'coverage.json'), 'utf8'),
);
/**
 * Only inputs this capture actually counts.
 *
 * `components` is **absent on purpose**, and its absence is the honest
 * answer rather than a convenience: `inferComponents` reads repeated DOM
 * subtrees and `coverage.json` has no counter for those, so any number put
 * here would be a stand-in for a quantity nobody measured — and the first
 * one tried (`interactionCandidates`, 2085) made a producer that ran look
 * like an artifact nobody assembles. §13: an unmeasured limitation cannot be
 * ranked, and inventing the measurement is worse than declaring the blind
 * spot. `entities` and `operations` are here as the live negative control:
 * both have a real input and both assemble, so the check staying silent on
 * them is evidence it is not silent by construction.
 */
const assemblyInputs = {
  fonts: coverage.extracted.fonts,
  assets: coverage.extracted.assets,
  flows: coverage.extracted.controlsFired,
  endpoints: coverage.extracted.endpoints,
};
const collections = collectionsOf(SiteModelSchema);
const assembly = assessModelAssembly({
  declared: MODEL_COLLECTIONS,
  collections,
  inputs: assemblyInputs,
  parts: Object.fromEntries(collections.map((c) => [c, model[c].length])),
});
console.log('\n  model assembly (0050) — every SiteModel collection, its producer and its input:');
// Printed from the same map the assessment reads. Printing from
// `coverage.extracted[d.input]` instead put a 0 beside `behaviours`, whose
// input is `flows` and whose counter is `controlsFired` — a display that
// reads exactly like the empty-input case the check is built to reject.
for (const d of MODEL_COLLECTIONS) {
  const held = model[d.part].length;
  const input = d.input === null ? '  (uncounted)' : String(assemblyInputs[d.input] ?? 0).padStart(13);
  console.log(`    ${d.assembles ? ' ' : '!'} ${d.part.padEnd(12)} capture ${input}  ·  model carries ${held}`);
}
if (assembly.length > 0) {
  console.log(`\n  ✗ ${assembly.length} model part(s) no longer match their declaration:`);
  for (const f of assembly) console.log(`    ${f.part}: ${f.problem} — ${f.detail}`);
}

/**
 * The grading, persisted (0053 §2).
 *
 * Until now the grader printed and nothing else, so every comparison in the
 * record was a human reading two terminal scrollbacks — which is exactly where
 * a seed change is invisible. `assessGradeComparability` reads two of these.
 *
 * A **subset** of what `gradeSiteModel` computes: the identity, and each
 * metric's numerator and denominator. The matching, auth and entity blocks stay
 * in the console render rather than being copied here — a derived value in two
 * artifacts drifts, and one side referencing the other is the standing fix.
 *
 * Deterministic bytes on purpose: `recordedAt` is the epoch and `runId` is
 * derived from the site and the seed, so re-grading an unchanged model twice
 * produces an identical file and a diff of it is a real change.
 *
 * `--without` variants are **not** written. They are ablations of infer against
 * one capture, and persisting one under the same name would leave the next
 * comparison reading a deliberately crippled model as this capture's grading.
 */
if (without === null) {
  const seedKey = manifest.seedState.source === 'fixture-seed' ? manifest.seedState.id : 'unseeded';
  const gradeRun = GradeRunSchema.parse({
    artifact: 'grade-run',
    provenance: {
      recordedAt: new Date(0).toISOString(),
      runId: `run_${shortHash(`grade-${siteId}-${seedKey}`)}`,
    },
    siteId,
    seedState: manifest.seedState,
    metricsVersion: report.metricsVersion,
    contractDigest: report.contractDigest,
    metrics: report.metrics.map((m) => ({
      id: m.id, suite: m.suite, category: m.category, kind: m.kind,
      numerator: m.numerator, denominator: m.denominator, value: m.value,
      vacuous: m.vacuous, gate: m.gate, passed: m.passed,
      ...(m.conservation === undefined ? {} : { conservation: m.conservation }),
    })),
    passed: report.passed,
    failedCategories: report.failedCategories,
  });
  const outDir = join(REPO, 'envs', siteId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'grade-run.json'), `${JSON.stringify(gradeRun, null, 2)}\n`);
  console.log(`\n  wrote envs/${siteId}/grade-run.json — seed ${seedStateLabel(manifest.seedState)}`);
}

if (deferralFindings.length > 0 || seedExpiry !== null || assembly.length > 0) process.exitCode = 1;

if (report.failedCategories.length > 0) {
  console.log(`  ✗ failed: ${report.failedCategories.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('  ✓ every gated category passed.');
}
