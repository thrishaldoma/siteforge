/**
 * The grader's metric side, pinned at the last commit before infer started.
 *
 * The firewall in 0020 is procedural: *do not read the grader's source while
 * writing infer.* No check can enforce reading, and this session weakens it
 * further — the same author wrote the grader an hour before infer began. What
 * a check **can** enforce is that the grader did not move afterwards. "It
 * didn't change" is verifiable where "I didn't read it" is not, so it is the
 * half worth writing down.
 *
 * A hash per file, asserted as a complete set. Any change to a frozen file
 * fails the suite with one instruction: **say why in a decision document**, in
 * the same commit. That is not a bar against changing the grader — a defect
 * found later still has to be fixed — it is a bar against changing it
 * *quietly*, while infer's score is the thing being watched. A threshold nudged
 * during a scoring run is indistinguishable from a threshold that was always
 * there.
 *
 * ## What is in the set, and what is deliberately not
 *
 * **In: the metric side.** `grade.ts` computes the categories, `match.ts`
 * decides identity and the universe, `fields.ts` enumerates what is scoreable,
 * `vocabulary.ts` decides which narrowings count, and `grade-contract.ts` holds
 * the thresholds and denominators. These are the files whose definitions could
 * shape an inference strategy, which is the failure 0015 §0 ordered the steps
 * to prevent.
 *
 * **Out: the truth side** — `truth/swagger2.ts` and the per-target sources. A
 * truth loader encodes what a document says, not what counts as a good score,
 * and it changes every time a target is added: Vikunja's arrival rewrote it
 * this week and a third target will again. A freeze that breaks on ordinary
 * additive work teaches people to bump it without reading, which is worse than
 * no freeze. The carve-out is stated here so it is checkable rather than
 * assumed — the same standard the narrowing exclusion is held to.
 *
 * **Known seam:** `pathShape` lives in `truth/swagger2.ts` and `match.ts`
 * imports it, so one definition that affects endpoint identity sits outside the
 * frozen set. Named rather than restructured around, because moving it would be
 * a change to the grader made for the freeze's convenience.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repo-relative, so a message names a path the reader can open. */
export const FROZEN_FILES: readonly string[] = [
  'packages/verify/src/grade/grade.ts',
  'packages/verify/src/grade/match.ts',
  'packages/verify/src/grade/fields.ts',
  'packages/verify/src/grade/vocabulary.ts',
  'packages/schema/src/grade-contract.ts',
];

/**
 * sha256 per frozen file, at `d842a31` — Vikunja adopted, infer not started.
 *
 * Updating one of these is a decision, not a chore. The commit that changes it
 * carries the entry in `docs/decisions/` that says why.
 */
export const GRADER_FREEZE: Readonly<Record<string, string>> = {
  'packages/verify/src/grade/grade.ts':
    'd9c92097a58f059461aab69fc851b13af07e1f5e4c4ec70f932826a61becad13',
  'packages/verify/src/grade/match.ts':
    'd5d355d57b074adb2e4b3aaceead61cf9f15012bb1fcee17ccccbc4f4a0b1a7d',
  'packages/verify/src/grade/fields.ts':
    '77728390c7d19166e1c08d625a56a327c1f41c7677f14520433a058876b0372a',
  'packages/verify/src/grade/vocabulary.ts':
    '8f4a65a5e0d04beb8e665385c750cbbd29031b4855b580c1758cd0b4e7685400',
  'packages/schema/src/grade-contract.ts':
    '074f62a070e8b1c5b25b7529424a644f71cc378f01dd9e9b7c4264ba056fd893',
};

/**
 * Which frozen files moved, and which the pin has lost track of.
 *
 * Both directions. A file added to the metric side without a pin is as much a
 * hole as a pinned file changing — the freeze's whole claim is that it covers
 * the set, so it is asserted as the set and not as the absence of a known-bad
 * member. Takes both sides as parameters: the real run supplies the files on
 * disk, a test supplies a pair that disagrees.
 */
export function assessGraderFreeze(
  actual: Readonly<Record<string, string>>,
  pinned: Readonly<Record<string, string>> = GRADER_FREEZE,
): string[] {
  const problems: string[] = [];
  for (const [file, hash] of Object.entries(pinned)) {
    const now = actual[file];
    if (now === undefined) {
      problems.push(`${file} is pinned by the grader freeze but was not found on disk.`);
    } else if (now !== hash) {
      problems.push(
        `${file} changed after the freeze.\n    pinned ${hash}\n    now    ${now}\n  The grader was pinned at the last commit before infer started (0020). Changing it now is allowed and must be *said*: add the entry to docs/decisions/ explaining what moved and why, and update the hash in the same commit. A threshold nudged during a scoring run reads exactly like one that was always there.`,
      );
    }
  }
  for (const file of Object.keys(actual)) {
    if (!(file in pinned)) {
      problems.push(
        `${file} is part of the grader's metric side but carries no pin. The freeze is asserted as a complete set; add it to GRADER_FREEZE or say why it belongs to the truth side.`,
      );
    }
  }
  return problems;
}

/** The hashes as they are right now. The real run's half of the comparison. */
export function readFrozenFiles(repo = join(HERE, '..', '..', '..', '..')): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of FROZEN_FILES) {
    out[file] = createHash('sha256').update(readFileSync(join(repo, file))).digest('hex');
  }
  return out;
}
