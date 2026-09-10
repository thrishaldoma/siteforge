/**
 * The catch taxonomy (§13).
 *
 * Two classes of failure, and only one of them may ever be caught:
 *
 *   **Operational** — a timeout, an aborted navigation, a detached element, a
 *   refused connection. Expected against a real site, recoverable, and the right
 *   response is a gap.
 *
 *   **Everything else** — a `ReferenceError`, a `TypeError`, a bad assumption.
 *   A defect in siteforge. Never caught; always propagates.
 *
 * The rule exists because a catch that cannot tell them apart converts a bug
 * into missing data, and missing data is strictly worse than a crash: a crash
 * stops the run, while missing data reports success and poisons every stage
 * downstream. That is not hypothetical here. Extracting a probe function left a
 * variable out of scope; the `ReferenceError` landed in a bare `catch` *after*
 * the flow had been recorded, so every probe reported success while the
 * state-detection code behind the throw silently never ran. One rung assertion
 * on a specific non-zero count is the only reason anyone noticed.
 */

/** A failure that is part of the job: the network, the page, the clock. */
export class OperationalError extends Error {
  override readonly name = 'OperationalError';

  constructor(
    message: string,
    readonly detail: { kind: OperationalKind; cause?: unknown },
  ) {
    super(message);
  }
}

export type OperationalKind =
  | 'timeout'
  | 'navigation-aborted'
  | 'element-detached'
  | 'network-refused'
  | 'target-closed'
  | 'blocked-by-policy';

/**
 * Message fragments that mark a third-party error as operational.
 *
 * Matched on text because Playwright's errors are `Error` with a `name` of
 * `TimeoutError` at best — there is no class to instanceof against across the
 * process boundary. Deliberately specific: a broad match would re-admit exactly
 * the programming errors this exists to keep out.
 */
const OPERATIONAL_SIGNATURES: readonly (readonly [RegExp, OperationalKind])[] = [
  [/\bTimeout\b|\bexceeded\b.*\bms\b|\btimeout\b/i, 'timeout'],
  [/net::ERR_ABORTED|navigation (?:was )?(?:aborted|interrupted)|frame was detached/i, 'navigation-aborted'],
  /**
   * Playwright's wording when a navigation invalidates a running `evaluate`.
   *
   * The same event as `navigation-aborted` above and none of that row's
   * spellings: the message is "Execution context was destroyed, most likely
   * because of a navigation". **It killed a nine-minute crawl** — the
   * classifier called an aborted navigation a defect, `rethrowIfDefect`
   * rethrew, and the run died on a probe whose click navigated while
   * `page.evaluate` was mid-snapshot.
   *
   * Found only because a richer seed (0051) made the task page big enough
   * for the race to open; the same probe had run clean on a thinner
   * instance. Deliberately narrow — it matches the destroyed-context wording
   * and nothing else, because widening this row is how a real defect gets
   * absorbed into a gap.
   */
  [/execution context was destroyed|execution context is not available/i, 'navigation-aborted'],
  [/element is not attached|node is detached|element handle is disposed/i, 'element-detached'],
  [/net::ERR_CONNECTION_REFUSED|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i, 'network-refused'],
  [/target (?:page, context or browser has been )?closed|browser has been closed/i, 'target-closed'],
  [/net::ERR_BLOCKED_BY_CLIENT|blockedbyclient/i, 'blocked-by-policy'],
];

/**
 * Whether an error is one the caller is allowed to absorb.
 *
 * A `ReferenceError` or `TypeError` is never operational, whatever its message
 * says — those are the defects the taxonomy exists to let through, and matching
 * them on text would be a hole big enough to drive the original bug back in.
 */
export function isOperationalError(err: unknown): boolean {
  if (err instanceof OperationalError) return true;
  if (err instanceof ReferenceError || err instanceof TypeError || err instanceof SyntaxError) {
    return false;
  }
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError') return true;
  const text = `${err.name}: ${err.message}`;
  return OPERATIONAL_SIGNATURES.some(([re]) => re.test(text));
}

/** The kind, for a gap's detail. `null` when the error is not operational. */
export function operationalKind(err: unknown): OperationalKind | null {
  if (err instanceof OperationalError) return err.detail.kind;
  if (!isOperationalError(err) || !(err instanceof Error)) return null;
  if (err.name === 'TimeoutError') return 'timeout';
  const text = `${err.name}: ${err.message}`;
  return OPERATIONAL_SIGNATURES.find(([re]) => re.test(text))?.[1] ?? null;
}

/**
 * Re-raise anything that is not operational.
 *
 * The one-line idiom every `catch` in this repo is expected to open with, and
 * what `pnpm lint` looks for:
 *
 * ```js
 * } catch (err) {
 *   rethrowIfDefect(err);
 *   // …handle the operational case
 * }
 * ```
 */
export function rethrowIfDefect(err: unknown): void {
  if (!isOperationalError(err)) throw err;
}
