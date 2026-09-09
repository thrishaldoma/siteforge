/**
 * A variant that changed nothing is not a null result.
 *
 * `--without <piece>` exists to ask what a piece of infer buys, by disabling it
 * and grading both models. The answer is read as "N metrics moved" — and **a
 * variant that produced an identical model reports zero moved, which is exactly
 * what a genuine null result reports.** The two render identically, which is
 * this session's sharp precondition rule (§13): a measurement whose failure
 * mode produces its own expected output carries no information about its own
 * validity, so the precondition is asserted as the primary gate and the
 * measurement runs downstream of it.
 *
 * It has already happened once, in the table this harness was written to fill.
 * `--without narrowings` was reported as "identical operations, 0 metrics
 * moved", implying the narrowing ladder buys nothing measurable. What actually
 * happened: every one of the capture's 43 narrowing records is
 * `kind: 'format'` (`date-time`), `narrowedField` carries only `enum` records
 * onto an entity field — a format annotates a shape without closing a domain —
 * so no entity field held a narrowing for the flag to strip, and the two models
 * were byte-identical. The row said nothing about the ladder. It said the
 * ladder had no enum to rule on.
 */

/** Problems that make a variant's result unreadable. Empty when it measured something. */
export function assessVariantIsMeasurable(
  piece: string,
  baseline: string,
  variant: string,
): string[] {
  if (baseline !== variant) return [];
  return [
    `--without ${piece} produced a byte-identical model, so it measured nothing. Whatever the grader reports for this variant, "0 metrics moved" means the piece was never exercised — not that the piece moves no metric, which is what that row would otherwise be read as. Either the capture contains no input this piece acts on (say so, and treat the row as vacuous), or the flag does not reach the code it names.`,
  ];
}
