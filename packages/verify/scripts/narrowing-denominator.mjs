#!/usr/bin/env node
/**
 * What `narrowing.recall` is actually scoring, field by field.
 *
 *   node narrowing-denominator.mjs vikunja
 *
 * `narrowing.recall 0.0000 0/9` was reported twice as a model-side floor — once
 * as vacuous, then as "the extractor discards the UI evidence". Both readings
 * came from looking at what the *model* lacked. Neither looked at what the nine
 * are, and the nine are the answer: ten slots across the two narrowing recalls
 * cover **three distinct fields**, and no inference this project could produce
 * moves either metric.
 *
 * The denominator is a matched pair's truth-declared narrowings intersected
 * with the pointers the model also emitted, so it cannot be read off either side
 * alone. This reproduces the grader's own construction — `matchEndpoints`, then
 * `modelFieldPointers`, then the same `status#pointer` key — rather than
 * approximating it, because an approximation that came out at 8 instead of 9
 * would have looked close enough to trust.
 *
 * It reports rather than gates. The decomposition is an argument about a metric
 * and belongs in a document; what belongs in the repository is the means to
 * check that argument without rebuilding it from memory.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SiteModelSchema } from '../../schema/dist/index.js';
import { matchEndpoints } from '../dist/grade/match.js';
import { modelFieldPointers } from '../dist/grade/fields.js';
import { loadVikunjaTruth } from '../dist/grade/truth/vikunja.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const TRUTHS = { vikunja: loadVikunjaTruth };
const siteId = process.argv[2] ?? 'vikunja';
const loadTruth = TRUTHS[siteId];
if (loadTruth === undefined) {
  console.error(`no ground truth for '${siteId}'. Known: ${Object.keys(TRUTHS).join(', ')}`);
  process.exit(1);
}

/**
 * What this reads, before it reads it.
 *
 * §13's discriminator: does "reached nothing" render the same as "reached
 * everything and found nothing"? Here it did. Run against a read-only capture —
 * which `capture-idempotence --no-probe` leaves on disk — the model shrinks, the
 * table gets shorter, and the conclusion at the bottom still prints *"every slot
 * falls in one of those two"*. A smaller correct-looking answer, from an input
 * that cannot support it.
 *
 * `assessMeasurementPreconditions` in `browser-surface.mjs` is the same fix for
 * the same shape. This one is smaller: say what was read, and refuse the input
 * that produces the plausible wrong answer.
 */
function requireFullCapture(captureRoot, capture) {
  const problems = [];
  // The directory survives a read-only run and `skipped-controls.json` is
  // written either way, so neither is the discriminator. A *trace* is: it only
  // exists where a control was actually driven, and a crawl that drove nothing
  // saw only the traffic page loads caused.
  const flows = existsSync(join(captureRoot, 'flows'))
    ? readdirSync(join(captureRoot, 'flows')).filter((f) => f.startsWith('probe-'))
    : [];
  if (flows.length === 0) {
    problems.push(
      'the capture holds no probe traces — a read-only crawl, so its endpoint set is a subset ' +
      'of what a full one reaches and the denominator would be read off the wrong input',
    );
  }
  if (capture.endpoints.length === 0) problems.push('the capture recorded no endpoints');
  if (problems.length > 0) {
    console.error(`\ncannot read the denominator from this capture:`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nre-run `node packages/capture/scripts/capture-site.mjs` first.\n');
    process.exit(1);
  }
}

const model = SiteModelSchema.parse(
  JSON.parse(readFileSync(join(REPO, 'envs', siteId, 'site-model.json'), 'utf8')),
);
const capture = JSON.parse(
  readFileSync(join(REPO, 'capture', siteId, 'network', 'endpoints.json'), 'utf8'),
);
requireFullCapture(join(REPO, 'capture', siteId), capture);

const truth = loadTruth();
const { pairs } = matchEndpoints(
  model.operations,
  truth,
  capture.endpoints.map((e) => ({ method: e.method, pathPattern: e.pathPattern })),
);

/** The grader's response key. Status is part of the pointer's identity. */
const responseKey = (status, pointer) => `${status}#${pointer}`;

const rows = [];
for (const { operation: op, truth: tr } of pairs) {
  const modelResponse = new Map();
  for (const r of op.responses) {
    for (const f of modelFieldPointers(r.schema)) {
      modelResponse.set(responseKey(r.status, f.pointer), f.node);
    }
  }
  const truthResponse = new Map(
    tr.responseFields.map((f) => [responseKey(f.status, f.pointer), f]),
  );
  const modelRequest = new Map(modelFieldPointers(op.request).map((f) => [f.pointer, f.node]));
  const truthRequest = new Map(tr.requestFields.map((f) => [f.pointer, f]));

  for (const [side, m, t] of [
    ['response', modelResponse, truthResponse],
    ['request', modelRequest, truthRequest],
  ]) {
    for (const [key, tf] of t) {
      if (tf.enumValues === null && tf.format === null) continue;
      const node = m.get(key);
      // Not emitted by the model: the pointer never matched, so it is out of the
      // narrowing denominator and inside `response-field-presence` instead.
      if (node === undefined) continue;
      rows.push({ where: `${op.method} ${op.pathPattern}`, side, key, tf, node });
    }
  }
}

const narrowingOf = (n) =>
  n.enum !== undefined ? `enum ${JSON.stringify(n.enum)}`
    : n.const !== undefined ? `const ${JSON.stringify(n.const)}`
      : n.format !== undefined ? `format ${n.format}`
        : null;

// What it read, printed beside what it concluded. A count with no inputs beside
// it cannot be told from a count taken over the wrong inputs.
console.log(`\nnarrowing.recall denominator — ${siteId}`);
console.log(
  `  read ${capture.endpoints.length} observed endpoint(s), ${model.operations.length} model operation(s), ` +
  `${truth.endpoints.length} spec endpoint(s)`,
);
console.log(`  ${rows.length} field(s) over ${pairs.length} matched pair(s)\n`);
for (const r of rows) {
  const truthValues = r.tf.enumValues
    ? `enum ${JSON.stringify(r.tf.enumValues)}`
    : `format ${r.tf.format}`;
  console.log(`  ${r.where}  [${r.side}] ${r.key}`);
  console.log(`      truth  ${String(r.tf.type).padEnd(8)} ${truthValues}`);
  console.log(
    `      model  ${String(JSON.stringify(r.node.type)).padEnd(8)} ` +
    `${narrowingOf(r.node) ?? 'no narrowing'}   observed ${JSON.stringify(r.node.examples ?? null)}`,
  );
}

/**
 * Why each slot cannot score, grouped.
 *
 * `narrowingAgrees` asks whether every value the truth declares is in the set
 * the model claims. So a slot is reachable only if the model could emit the
 * truth's values *without contradicting what the crawl observed* — and §7.5
 * forbids emitting them anyway.
 */
const contradicted = rows.filter(
  (r) =>
    r.tf.enumValues !== null &&
    Array.isArray(r.node.examples) &&
    r.node.examples.length > 0 &&
    !r.node.examples.some((v) => r.tf.enumValues.includes(String(v))),
);
const unobserved = rows.filter(
  (r) => r.node.examples === undefined || r.node.examples.length === 0,
);
const fields = new Set(rows.map((r) => r.key.split('/').pop()));

console.log(`\n  distinct field names behind those ${rows.length} slots: ${[...fields].sort().join(', ')}`);
console.log(`  the document declares values the wire contradicts:        ${contradicted.length}`);
console.log(`  no value was observed at all, so nothing can be narrowed: ${unobserved.length}`);
if (contradicted.length + unobserved.length === rows.length && rows.length > 0) {
  console.log('\n  every slot falls in one of those two, so the metric is unreachable on this');
  console.log('  target at any inference quality. See docs/decisions/0029.');
}
