/**
 * Which of the spec's narrowings the model is *able* to make.
 *
 * The `narrowing` category scores infer's claims against the document's. Gitea's
 * document declares 5 508 formats, of which **3 380 are `int64`/`uint64`** —
 * integer width annotations. `JsonStringFormatSchema` annotates string shapes
 * and nothing else, so no model this schema admits can carry one. Counting them
 * as recall misses measures the gap between two vocabularies and reports it as
 * inference quality.
 *
 * **Shrinking a denominator to remove misses is the shape of tuning.** What
 * distinguishes this from tuning is that the exclusion is a property of the
 * vocabulary rather than of any score — and that distinction has to be
 * *checkable*, or the next restriction gets justified by this one's precedent.
 * Three things make it so, and all three are asserted:
 *
 * 1. **This module's import list is frozen to `@siteforge/schema`.** The
 *    expressible set is derived from `JsonStringFormatSchema`, so a format added
 *    there stops being excluded the day it lands. Nothing here can reach a
 *    model, a report, or a score — the exclusion predicate cannot be a function
 *    of how anything did.
 * 2. **No excluded format may be one the model can express.** That is the
 *    anti-tuning assertion: you may exclude a claim the vocabulary cannot make,
 *    and never one it can. It is the line between this and shrinking a
 *    denominator because the misses were inconvenient.
 * 3. **Every format the truth declares is on one side or the other, by name,
 *    with a reason.** A refresh that introduces `int32` fails the suite until
 *    someone writes down which side it is on and why. Silence is not a default.
 */
import { JsonStringFormatSchema } from '@siteforge/schema';

export interface UnexpressibleFormat {
  readonly format: string;
  /** Why no model this schema admits could carry it. Not why it is inconvenient. */
  readonly reason: string;
}

/**
 * Format families a `SiteModel` has no way to say.
 *
 * One entry per family, each naming the vocabulary gap rather than the score.
 * Measured against the pinned Gitea snapshot; a second ground truth will add to
 * this list through the completeness check below, not by anyone remembering to.
 */
export const UNEXPRESSIBLE_FORMATS: readonly UnexpressibleFormat[] = [
  {
    format: 'int64',
    reason:
      'a storage-width annotation on an integer. `JsonStringFormatSchema` is a closed set of string shapes — date-time, email, uri and so on — so `format` is unreachable on a numeric node and no legal SiteModel can carry this. There is nothing for infer to have missed.',
  },
  {
    format: 'uint64',
    reason:
      'the unsigned width annotation, same argument. Note that unsignedness is a *domain* constraint the model genuinely cannot express either — which is a gap in SiteModel worth recording, not a narrowing infer failed to make.',
  },
];

/** The formats a model can actually claim. Derived, never typed out. */
export const EXPRESSIBLE_FORMATS: ReadonlySet<string> = new Set(JsonStringFormatSchema.options);

/**
 * Is this a narrowing the model could have made, and therefore one to score?
 *
 * Takes a format string and nothing else. The signature is the point: a
 * predicate that could see a model, a score, or a report would be a predicate
 * that could be made to depend on them.
 */
export const isExpressibleFormat = (format: string): boolean => EXPRESSIBLE_FORMATS.has(format);

/**
 * Is the vocabulary split complete over the formats this truth declares?
 *
 * One message per format that is neither expressible nor declared unexpressible,
 * and one per excluded format the model turns out to be able to express after
 * all. The second direction is the one that matters: it is what stops an
 * exclusion list from quietly becoming a list of inconvenient misses.
 */
export function assessFormatVocabulary(
  declaredFormats: readonly string[],
  /**
   * Parameters, not module constants — this session's own rule. The second
   * direction below cannot fire against the real list (by construction, if the
   * list is correct), so a check that could only ever see the real list is a
   * check nobody can prove works. The real run is one caller.
   */
  excluded: readonly UnexpressibleFormat[] = UNEXPRESSIBLE_FORMATS,
  expressible: ReadonlySet<string> = EXPRESSIBLE_FORMATS,
): string[] {
  const problems: string[] = [];
  const excludedNames = new Set(excluded.map((e) => e.format));
  for (const format of [...new Set(declaredFormats)].sort()) {
    if (expressible.has(format) || excludedNames.has(format)) continue;
    problems.push(
      `the ground truth declares format '${format}', which is neither in JsonStringFormatSchema nor in UNEXPRESSIBLE_FORMATS. Name it and say why no SiteModel can carry it — or add it to the schema so infer can. Silence would drop it from the narrowing denominator without anyone deciding to.`,
    );
  }
  for (const entry of excluded) {
    if (!expressible.has(entry.format)) continue;
    problems.push(
      `'${entry.format}' is excluded from the narrowing denominator but JsonStringFormatSchema can express it. An exclusion is only legitimate when the vocabulary cannot make the claim; excluding one it can is shrinking a denominator to remove misses.`,
    );
  }
  return problems;
}
