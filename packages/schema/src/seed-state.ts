/**
 * Seed state is part of capture identity (decision 0053).
 *
 * 0051 changed one task's `assignees`, `labels` and `reminders` and predicted
 * five metric movements. Three predictions failed, for a cause the prediction
 * did not contain: **the seed changed what the crawl could reach.** A task with
 * an assignee has interactive widgets a bare task does not, probes fired them,
 * a new endpoint matched, and every denominator predicted as fixed moved. So
 * the seed is not a property of the *content* a capture holds — it is a
 * property of the *instance* the crawl ran against, and two captures taken
 * under different seeds are captures of two different targets.
 *
 * Nothing recorded which seed produced a capture, so nothing could refuse the
 * comparison. This is the third instance of an instrument moving its subject,
 * after the held-container control (0032 §2.1) and the contaminating write
 * (0043 §2); §13 carries it in that form.
 *
 * ### What the id identifies, and what it does not
 *
 * The seed **program**, and the image it ran against. Not the database state it
 * achieved. That distinction is not pedantry: 0051 §1 found
 * `PUT /api/v1/tasks/1/assignees` answering 201 and populating nothing, so a
 * program that runs to completion is not evidence about the state it produced.
 * A reader who takes this for a state hash will believe two equal ids mean two
 * equal databases, and they mean two equal *inputs*.
 *
 * ### Deliberately over-sensitive
 *
 * The program half is a digest of the seed function's own source, comments
 * included — so editing a comment inside `seed()` changes the id and marks the
 * two captures incomparable. That is the safe direction and it is the reason
 * for the choice rather than an accident of it: an id that is too sensitive
 * refuses a comparison that would have been sound, and an id that is not
 * sensitive enough renders a delta across two targets. The first costs a
 * re-measure; the second is the defect this exists to prevent, and it is
 * invisible.
 *
 * The alternative — a hand-declared version string — is a declaration nobody is
 * obliged to bump, which is the same class of defect as a derived field carried
 * as a literal (§13). Deriving it means it cannot be forgotten.
 *
 * ### The password is excluded, and that is §3.3 rather than tidiness
 *
 * The account half carries the username and email, never the password. A digest
 * is not a credential, but the rule is that a capture artifact does not take a
 * password as an input at all, and an exception argued once is an exception
 * somebody widens later. The fixture password is not a seed variable in any
 * case: changing it changes who signs in, not what exists.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Sha256Schema } from './primitives.js';

/**
 * The inputs a seed state is identified by.
 *
 * Three, and each is a way two instances differ while the other two agree: a
 * different image seeds different defaults, a different program creates
 * different rows, a different account owns them.
 */
export interface SeedStateInputs {
  /** The pinned image the program ran against, by digest. */
  readonly imageDigest: string;
  /** The seed program's own source — `PIN.seed.toString()`. */
  readonly program: string;
  /** The fixture account the rows belong to. Never a password (§3.3). */
  readonly account: string;
}

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * The digest of the seed program, reported beside the id so a reader can see
 * which half moved. Two captures at the same image with different program
 * hashes ran different seeds; the same program hash at two images did not.
 */
export const seedProgramHash = (program: string): string => sha256Hex(program);

/**
 * The identity, over the three parts as they are *recorded*.
 *
 * Newline-joined rather than concatenated: `a|b` and `ab|` are the same string
 * under concatenation and different seeds, which is the identifier-grammar
 * mistake §13 keeps finding in a smaller key.
 *
 * Split from `computeSeedStateId` because the manifest carries `programHash`
 * and not the program — recomputing from what the artifact holds is the whole
 * point of a recomputed field, and a second hashing path here would be two
 * derivations to drift apart.
 */
export function seedStateIdFrom(parts: {
  readonly imageDigest: string;
  readonly programHash: string;
  readonly account: string;
}): string {
  return sha256Hex([parts.imageDigest, parts.programHash, parts.account].join('\n'));
}

/** The identity, from the seed program itself. What a capture driver calls. */
export function computeSeedStateId(inputs: SeedStateInputs): string {
  return seedStateIdFrom({
    imageDigest: inputs.imageDigest,
    programHash: seedProgramHash(inputs.program),
    account: inputs.account,
  });
}

/**
 * What a capture records about the instance it crawled.
 *
 * A union rather than an optional, because "this target was not seeded" is a
 * statement a run has to make rather than a field it may omit. A real website
 * has no seed and the honest record of that is `source: 'unseeded'` carrying
 * the reason — an absent field would read the same as a run that forgot.
 */
export const SeedStateSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('fixture-seed'),
    /** The pinned image, by digest — half of what makes the instance what it is. */
    imageDigest: z.string().min(1),
    /** sha256 of the seed program's source. */
    programHash: Sha256Schema,
    /** The fixture account. Never a password. */
    account: z.string().min(1),
    /**
     * `computeSeedStateId` over the three above, recomputed by the manifest's
     * own refinement. A derived field carries the evidence it was derived from
     * and the schema rejects a value that evidence does not support (§13).
     */
    id: Sha256Schema,
    /** For a report line. Never the identity — two labels may agree and two ids may not. */
    label: z.string().min(1),
  }),
  z.strictObject({
    source: z.literal('unseeded'),
    /** Why there is no seed. A target nobody owns, a static site, a live crawl. */
    reason: z.string().min(1),
  }),
]);

export type SeedState = z.infer<typeof SeedStateSchema>;

/**
 * Do two artifacts describe the same instance?
 *
 * `unseeded` is never equal to anything, including another `unseeded`. Two
 * crawls of a target nobody seeded have no evidence that the target held still
 * between them, and treating "no seed" as a shared identity is exactly the
 * silent comparison this module exists to refuse.
 */
export function sameSeedState(a: SeedState, b: SeedState): boolean {
  return a.source === 'fixture-seed' && b.source === 'fixture-seed' && a.id === b.id;
}

/** The id in a form short enough for a report line, or the reason there is none. */
export function seedStateLabel(state: SeedState): string {
  return state.source === 'fixture-seed'
    ? `${state.label} (${state.id.slice(0, 12)}…)`
    : `unseeded — ${state.reason}`;
}
