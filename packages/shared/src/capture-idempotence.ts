/**
 * M1's idempotency check, which had never been run.
 *
 * §12 M1: *"Recrawl is idempotent modulo timestamps."* The repository's answer
 * to that is `manifest.contentHash`, and two things were wrong with it:
 *
 *  1. **It is written and never compared.** Every driver computes it and puts
 *     it in the manifest; nothing anywhere reads two of them and asserts they
 *     match. It is not a gate whose scope is too narrow — it is the §13
 *     staleness shape, a comparison that has never once run, and an inverted
 *     one would have read exactly the same.
 *  2. **Its scope is routes.** `deriveRouteContentHash({dom, styles, states})`,
 *     hashed over route content only, so `flows/`, `flows/skipped-controls.json`,
 *     `network/endpoints.json`, `assets/`, `coverage.json` and the gap list are
 *     outside it by construction. `locate/not-found` moving 16 → 19 on an
 *     unchanged pinned digest lives in the second of those, which is why it
 *     was invisible.
 *
 * So this compares the **whole tree**, and it takes the trees as parameters so
 * something other than a real crawl can drive it to a failing verdict.
 *
 * ### What "modulo timestamps" is allowed to mean
 *
 * Exactly one thing, and it is derived rather than chosen: `VOLATILE_ARTIFACT_KEYS`
 * is `['provenance']`, and the schema already asserts that every volatile field
 * lives inside it. So the canonical form of an artifact is itself with
 * `provenance` removed, and **anything else that differs is a finding**.
 *
 * That direction matters more than it looks. The tempting way to use this is to
 * exempt whatever turns up different until the diff comes out clean, which is
 * fitting the measurement to the result — the thing 0025's threshold discipline
 * exists to prevent, one artifact over. A file-level exemption therefore has to
 * be declared with a reason, the same way `NOT_FROZEN` and `trackedButUnwalked`
 * entries are, and an exemption that turns out **not** to differ is reported
 * too: a declared volatility nobody can observe is a claim the artifact does
 * not support.
 *
 * ### `claimExceeded` — where the hash agreed and something it cannot see did not
 *
 * Point 2 above says `contentHash`'s scope is narrower than its name. Saying so
 * in a docstring is prose, and 0035's ruling is that a claim and its reach get
 * stated **beside each other**, with something comparing the difference. This is
 * that something.
 *
 * Per route, the caller supplies the hash each run recorded and the partition of
 * that route's files into the ones the hash is computed over and the ones it is
 * not. The finding is the conjunction: **the hash was identical across every run
 * and an uncovered file under the same route was not.** That is not a second
 * copy of `unstable` — it is the case in which a reader trusting the field would
 * be wrong, and it is silent in every other report this function produces.
 *
 * The partition is a parameter rather than a literal here, and the driver
 * derives the covered side from `ROUTE_CONTENT_HASH_INPUTS` — the constant
 * `deriveRouteContentHash` itself iterates. A fourth input to the hash therefore
 * moves this check's covered side on the day it lands, not the day someone
 * remembers. Hard-coding `['dom','styles','states']` in two packages is the
 * duplicated-derived-value drift 0031 §2.4 ruled on.
 */

/** A file whose bytes genuinely cannot repeat, declared with why. */
export interface VolatileExemption {
  /** Matched as a full path segment or a complete relative path, never a prefix. */
  readonly path: string;
  readonly reason: string;
}

/** One crawl's artifacts: relative path → digest of the canonical content. */
export interface CaptureTree {
  readonly label: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface UnstablePath {
  readonly path: string;
  /** How many distinct canonical contents appeared across the runs. */
  readonly distinct: number;
  /** How many runs contained the file at all. */
  readonly presentIn: number;
}

/**
 * One route's `contentHash` claim, and the partition of that route's files into
 * what it covers and what it does not.
 *
 * `hashPerRun` is what each run's `meta.json` recorded, in run order — read off
 * the artifact rather than recomputed, because the question is whether the
 * *recorded field* misleads a reader, and `CaptureModelSchema` already asserts
 * the recomputation separately.
 */
export interface ContentHashClaim {
  readonly routeId: string;
  /** `null` where the run did not record one — a route absent from that run. */
  readonly hashPerRun: readonly (string | null)[];
  /** Relative paths the hash is computed over. */
  readonly covers: readonly string[];
  /** Relative paths under the same route that it is not. */
  readonly uncovered: readonly string[];
}

/** A route whose recorded `contentHash` agreed while something outside it moved. */
export interface ClaimExceeded {
  readonly routeId: string;
  /** The value every run agreed on. */
  readonly contentHash: string;
  /** Uncovered paths under this route that did not reproduce. */
  readonly unstableUncovered: readonly string[];
}

export interface IdempotenceReport {
  readonly runs: number;
  readonly comparedPaths: number;
  /** Present everywhere, and its content changed. The hard failure. */
  readonly unstable: readonly UnstablePath[];
  /** Present in some runs and missing from others — a different defect, reported apart. */
  readonly inconsistentlyPresent: readonly UnstablePath[];
  /** Exempt and genuinely varying: expected, and listed so the exemption stays honest. */
  readonly exemptedAndVarying: readonly string[];
  /** Exempt and identical every time: the exemption is not earning its place. */
  readonly exemptedAndStable: readonly string[];
  /**
   * Routes where `contentHash` reproduced and an artifact it does not cover did
   * not. Empty when no claims were supplied — and the driver is required to
   * supply them, see `claimsSupplied`.
   */
  readonly claimExceeded: readonly ClaimExceeded[];
  /**
   * How many claims were checked. Zero is reported rather than passed over: a
   * `claimExceeded` of `[]` means "nothing exceeded its claim" only if something
   * was checked, and otherwise means "nothing was checked" — the two render
   * identically (0019), so the count is what tells them apart.
   */
  readonly claimsSupplied: number;
}

/**
 * Segment-wise, never a prefix.
 *
 * `startsWith` would make an exemption for `auth` cover `authors/`, which is
 * the substring-for-token family §13 keeps finding. A path matches when it is
 * the exemption exactly, or when the exemption is one of its segments.
 */
function isExempt(path: string, exempt: readonly VolatileExemption[]): boolean {
  const segments = path.split('/');
  return exempt.some((e) => e.path === path || segments.includes(e.path));
}

export function assessCaptureIdempotence(input: {
  readonly runs: readonly CaptureTree[];
  readonly exempt: readonly VolatileExemption[];
  /**
   * Optional only in the type. The driver always supplies these, and
   * `claimsSupplied` is in the report so a caller that stopped doing so is
   * visible rather than silently green.
   */
  readonly claims?: readonly ContentHashClaim[];
}): IdempotenceReport {
  // A comparison of one run is not a comparison. Throwing rather than returning
  // a clean report, because "no runs differed" over a single run is the
  // permissive answer and reads exactly like success (§13's empty-container
  // family — this is the `.every([])` shape with a directory in place of a list).
  if (input.runs.length < 2) {
    throw new Error(
      `idempotence needs at least two runs to compare and got ${input.runs.length}. ` +
      'A single crawl cannot disagree with itself, and reporting it as stable is the ' +
      'vacuous answer M1 has been getting for free since the check was written.',
    );
  }
  for (const e of input.exempt) {
    if (e.reason.trim().length === 0) {
      throw new Error(`the exemption for '${e.path}' states no reason`);
    }
  }

  const allPaths = [...new Set(input.runs.flatMap((r) => Object.keys(r.files)))].sort();
  const unstable: UnstablePath[] = [];
  const inconsistentlyPresent: UnstablePath[] = [];
  const exemptedAndVarying: string[] = [];
  const exemptedAndStable: string[] = [];
  let comparedPaths = 0;

  for (const path of allPaths) {
    const present = input.runs.filter((r) => Object.hasOwn(r.files, path));
    const distinct = new Set(present.map((r) => r.files[path]!)).size;
    const varying = distinct > 1 || present.length !== input.runs.length;

    if (isExempt(path, input.exempt)) {
      (varying ? exemptedAndVarying : exemptedAndStable).push(path);
      continue;
    }
    comparedPaths += 1;

    // Two different defects, reported apart rather than netted into one count.
    // A file that appears in six runs of ten is not a file whose bytes moved,
    // and a report that conflated them would send the reader to the wrong
    // question.
    if (present.length !== input.runs.length) {
      inconsistentlyPresent.push({ path, distinct, presentIn: present.length });
      continue;
    }
    if (distinct > 1) unstable.push({ path, distinct, presentIn: present.length });
  }

  // ---- the claim, against what it cannot see -----------------------------
  //
  // Derived from `unstable` rather than by a second pass over the trees: one
  // walk decides what moved, and this reads that verdict. A second traversal
  // here would be the shared-code-path mistake §13 names for an invariant's
  // observed side, pointed the other way — two walks that could disagree about
  // the same file.
  const unstablePaths = new Set([
    ...unstable.map((u) => u.path),
    ...inconsistentlyPresent.map((u) => u.path),
  ]);
  const claims = input.claims ?? [];
  const claimExceeded: ClaimExceeded[] = [];

  for (const claim of claims) {
    if (claim.hashPerRun.length !== input.runs.length) {
      throw new Error(
        `claim for ${claim.routeId} carries ${claim.hashPerRun.length} hash(es) for ` +
        `${input.runs.length} run(s). A claim that does not span every run cannot be ` +
        'checked against them, and defaulting it either way invents an observation.',
      );
    }
    const overlap = claim.covers.filter((p) => claim.uncovered.includes(p));
    if (overlap.length > 0) {
      throw new Error(
        `claim for ${claim.routeId} lists ${overlap.join(', ')} as both covered and ` +
        'uncovered. The partition is the whole content of this check.',
      );
    }
    // Length-guarded rather than left to `.every([])`, which returns `true` on
    // empty and would report every route's hash as "agreed" for a claim that
    // carries no hashes at all. §13's empty-container rule.
    if (claim.hashPerRun.length === 0) continue;
    const agreed = new Set(claim.hashPerRun).size === 1;
    if (!agreed) continue;
    // Agreement on `null` is not agreement on a hash — it is every run failing
    // to record one, and treating that as "the claim held" would report a
    // finding against a field nobody wrote. Fails closed for this category
    // (§13): no claim, so nothing to exceed.
    const contentHash = claim.hashPerRun[0];
    if (contentHash === null || contentHash === undefined) continue;

    const unstableUncovered = claim.uncovered.filter((p) => unstablePaths.has(p)).sort();
    if (unstableUncovered.length > 0) {
      claimExceeded.push({ routeId: claim.routeId, contentHash, unstableUncovered });
    }
  }

  return {
    runs: input.runs.length,
    comparedPaths,
    unstable,
    inconsistentlyPresent,
    exemptedAndVarying,
    exemptedAndStable,
    claimExceeded,
    claimsSupplied: claims.length,
  };
}
