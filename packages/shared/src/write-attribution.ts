/**
 * Every write the crawl saw belongs to exactly one owner (0044).
 *
 * The contamination reading rests entirely on knowing which probe issued which
 * write, and that knowledge has failed twice in one turn — first by not being
 * recorded at all for probes that timed out after clicking (128 probes, zero
 * writes attributed, on a crawl that watched the browser send two), and then
 * as a live risk of being recorded against the *wrong* probe, because an
 * observation is pushed after its response body resolves and a slow body lands
 * in a later probe's window.
 *
 * The second is the dangerous one. A lost write makes a drift point look
 * unexplained, which reports `confounded` — cautious, and correct about its own
 * uncertainty. A **misattributed** write makes a drift point look *explained*,
 * which reports `per-probe-required` — a confident answer that is wrong.
 *
 * So the check is a conservation law rather than a threshold: a write was
 * either issued inside some probe's window or outside every probe's, and those
 * two counts must add to the total exactly. There is no allowance to argue
 * about and no tolerance to fit to the data — which matters, because the
 * obvious alternative ("probe writes should be roughly the crawl total minus
 * sign-in") is exactly the kind of stand-in §13 keeps finding.
 *
 * `lost` sits beside the verdict rather than inside it. An exchange whose body
 * never arrived because the page closed under it was never in the total, so it
 * cannot break conservation — and a reading taken while several went missing
 * is still worth less than one taken while none did.
 */

export interface WriteAttribution {
  /** Non-GET/HEAD/OPTIONS exchanges the crawl recorded, in total. */
  readonly crawlWideWrites: number;
  /** Of those, the ones tagged to some probe's window. */
  readonly attributedWrites: number;
  /** Of those, the ones recorded while no probe window was open — sign-in, the anonymous sweep. */
  readonly outsideProbeWrites: number;
  /** Exchanges dropped because the page closed before the body arrived. Context, not a term. */
  readonly lost: number;
}

export interface AttributionFinding {
  readonly problem: 'not-conserved' | 'negative-count';
  readonly detail: string;
}

/**
 * Whether the attribution adds up. `null` means it does.
 *
 * Takes its inputs as parameters so a test can drive it to a failing verdict
 * without a crawl — §13, and the reason is not ceremony: this gate's only
 * other caller needs Docker and eight minutes, so an inline version of it is
 * one nobody can prove fires.
 */
export function assessWriteAttribution(input: WriteAttribution): AttributionFinding | null {
  const { crawlWideWrites, attributedWrites, outsideProbeWrites, lost } = input;
  // Ordered first: a negative count means the caller is computing these from
  // different populations, and the sum could still reconcile by accident.
  for (const [name, value] of [
    ['crawlWideWrites', crawlWideWrites],
    ['attributedWrites', attributedWrites],
    ['outsideProbeWrites', outsideProbeWrites],
    ['lost', lost],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      return {
        problem: 'negative-count',
        detail: `${name} is ${value}, which is not a count. These are populations of recorded exchanges; a non-integer or negative one means they are being derived from different things and any sum over them is meaningless.`,
      };
    }
  }
  const owned = attributedWrites + outsideProbeWrites;
  if (owned === crawlWideWrites) return null;
  const direction = owned < crawlWideWrites
    ? `${crawlWideWrites - owned} write(s) have no owner — recorded by the crawl and claimed by neither a probe nor the gaps between them`
    : `${owned - crawlWideWrites} write(s) are claimed twice — the two populations overlap, so a probe is being credited with traffic that was also counted outside it`;
  return {
    problem: 'not-conserved',
    detail: `${direction}. ${attributedWrites} attributed + ${outsideProbeWrites} outside ≠ ${crawlWideWrites} observed${lost > 0 ? ` (${lost} further exchange(s) were lost to a closing page and are outside this total)` : ''}. The contamination reading rests on write ownership, and a misattributed write makes a drift point look explained — which reports a confident answer rather than an uncertain one.`,
  };
}
