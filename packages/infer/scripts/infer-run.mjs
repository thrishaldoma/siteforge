#!/usr/bin/env node
/**
 * Stage 2, as one command.
 *
 *   node infer-run.mjs vikunja        # capture/vikunja -> envs/vikunja/site-model.json
 *
 * §4's stage contract: files in, files out, no state held across stages. The
 * model goes to disk because that is what codegen and the grader both read, and
 * because a score computed from an in-memory object is a score of something
 * nobody can look at afterwards.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inferFromCapture } from '../dist/index.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/**
 * A variant turns one piece off, so the grader can be asked what that piece
 * bought. `--without dedupe` writes `site-model.without-dedupe.json` beside the
 * real one; nothing overwrites the model a plain run produces.
 */
const VARIANTS = {
  dedupe: { dedupeEntities: false },
  narrowings: { carryNarrowings: false },
  presentation: { presentation: false },
};

const siteId = process.argv[2] ?? 'vikunja';
const withoutAt = process.argv.indexOf('--without');
const without = withoutAt === -1 ? null : process.argv[withoutAt + 1];
if (without !== null && !Object.hasOwn(VARIANTS, without)) {
  console.error(`no such piece '${without}'. Known: ${Object.keys(VARIANTS).join(', ')}`);
  process.exit(1);
}
const captureRoot = join(REPO, 'capture', siteId);
const out = join(REPO, 'envs', siteId, without === null ? 'site-model.json' : `site-model.without-${without}.json`);

console.log(`\ninfer — ${captureRoot}${without === null ? '' : `  (without ${without})`}\n`);
const { model, report } = inferFromCapture(captureRoot, without === null ? {} : VARIANTS[without]);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(model, null, 2)}\n`);

console.log(`  rows seen        ${report.rowsSeen}`);
console.log(`  entities         ${report.entities}  ${model.entities.map((e) => e.name).join(', ')}`);
console.log(`  operations       ${report.operations}`);
console.log(`  components       ${report.components}`);
console.log(`  tokens           ${model.tokens.colors.length} colour(s), ${model.tokens.spacing.length} spacing, ${model.tokens.fontSizes.length} size(s)`);
console.log(`  route templates  ${model.routes.length}`);

const effects = {};
for (const operation of model.operations) {
  effects[operation.effect.kind] = (effects[operation.effect.kind] ?? 0) + 1;
}
console.log(`  effects          ${Object.entries(effects).map(([k, n]) => `${k} ${n}`).join(' · ')}`);

if (report.objections.length > 0) {
  console.log(`\n  ✗ ${report.objections.length} narrowing(s) §7.5 does not allow:`);
  for (const objection of report.objections) console.log(`      ${objection}`);
  process.exitCode = 1;
} else {
  console.log(`\n✓ ${out.replace(`${REPO}/`, '')}`);
}
