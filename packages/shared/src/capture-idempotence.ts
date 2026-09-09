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

  return {
    runs: input.runs.length,
    comparedPaths,
    unstable,
    inconsistentlyPresent,
    exemptedAndVarying,
    exemptedAndStable,
  };
}
