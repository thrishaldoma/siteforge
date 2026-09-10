/**
 * The declarations. One per gate that selects its own subject (0037).
 *
 * Kept beside `assessFieldOfView` rather than scattered next to each gate, for
 * the reason `NOT_FROZEN` and the manifest ledger are kept in one place: the
 * completeness claim is over the *set*, and a set spread across nine files is
 * one nobody can read as a set. Each entry names its gate, so the reader who
 * arrives from the gate finds it in one grep.
 */
import type { FieldOfView } from './field-of-view.js';

/** Gates that select their own subject, and therefore have a field of view. */
export const SELF_SELECTING_GATES = [
  'walkFiles(source)',
  'assessToolingHostileSource',
  'assessScopeAgreement',
  'lint-catch',
  'lint-guarded-pages',
  'lint-identifiers',
  'lint-empty-admits',
  'scripts-parse',
  'scanCaptureTree',
  'assessGraderFreeze',
  'assessBuildResidue',
  'evaluateCoverage',
  'assessCaptureIdempotence',
] as const;

export const FIELD_OF_VIEW: readonly FieldOfView[] = [
  {
    gate: 'walkFiles(source)',
    covers: 'files under packages/ and scripts/ that survive SOURCE_IGNORE, with a minFiles floor and mustReach prefixes',
    blindTo: [
      {
        region: 'anything matching SOURCE_IGNORE — node_modules, dist, fixtures, capture',
        why: 'the ignore list is the selection. A bare name in it once removed packages/capture from every linter at once, and the linters reported success.',
        coveredBy: 'assessScopeAgreement',
      },
      {
        region: 'files tracked by git that the filesystem walk never reaches',
        why: 'a walk is one of two views of the repository and cannot see the other',
        coveredBy: 'assessScopeAgreement',
      },
    ],
  },
  {
    gate: 'assessToolingHostileSource',
    covers: 'the bytes of every walked source file: NUL, invalid UTF-8, mixed line endings, lone CR',
    blindTo: [
      {
        region: 'whether the file is valid in its own language',
        why: 'it reads bytes, deliberately — the point is to catch what makes a file stop behaving like text before any parser is asked',
        coveredBy: 'scripts-parse',
      },
    ],
  },
  {
    gate: 'assessScopeAgreement',
    covers: 'the set difference between git\'s view and the walker\'s, both directions, at file granularity',
    blindTo: [
      {
        region: 'a file in neither view — untracked and ignored',
        why: 'it reconciles two views and cannot see outside their union',
        coveredBy: null,
        provenBy: 'fov-untracked-and-ignored-file',
      },
    ],
  },
  {
    gate: 'lint-catch',
    covers: 'catch blocks and .catch(fn) handlers, textually, in every walked source file',
    blindTo: [
      {
        region: 'whether the reason a swallow gives is true',
        why: 'an `// operational:` comment is accepted on its face; no analysis reads the caught error',
        coveredBy: null,
        provenBy: 'fov-false-operational-reason',
      },
    ],
  },
  {
    gate: 'lint-guarded-pages',
    covers: 'newPage() call sites, textually, in every walked source file',
    blindTo: [
      {
        region: 'a page obtained without calling newPage — context.pages(), a popup handler',
        why: 'it matches a call, so a page arriving by any other route is not a call it can match',
        coveredBy: null,
        provenBy: 'fov-page-without-newpage',
      },
    ],
  },
  {
    gate: 'lint-identifiers',
    covers: 'identifier comparisons written as string operations, textually',
    blindTo: [
      {
        region: 'a comparison built at runtime from variables',
        why: 'the grammar it checks is a source grammar',
        coveredBy: null,
        provenBy: 'fov-runtime-built-comparison',
      },
    ],
  },
  {
    gate: 'lint-empty-admits',
    covers: '.every() predicates, textually, requiring a length guard or an `// empty:` reason',
    blindTo: [
      {
        region: 'every other way an empty container admits — .filter().length === 0, a for-loop that never runs',
        why: '.some() is excluded on the argument that it returns the restrictive answer on empty; the rest is unchecked, and the rule says so',
        coveredBy: null,
        provenBy: 'fov-empty-admits-without-every',
      },
    ],
  },
  {
    gate: 'scripts-parse',
    covers: 'node --check over every walked .mjs, with a mustReach floor naming capture-site.mjs',
    blindTo: [
      {
        region: 'TypeScript source',
        why: 'node --check cannot read it, and it is compiled anyway',
        coveredBy: 'walkFiles(source)',
      },
      {
        region: 'anything beyond syntax — an unresolvable import, a throw at module load',
        why: '--check parses and does not execute, deliberately: this driver needs Docker to do anything else',
        coveredBy: null,
        provenBy: 'fov-driver-imports-nothing',
      },
    ],
  },
  {
    gate: 'scanCaptureTree',
    covers: 'every file present under capture/<site> and capture/<site>-diagnostics at the moment each scan runs — two roots, because §3.4 claims everything under capture/ and the diagnostics tree sits beside the artifact rather than inside it',
    blindTo: [
      {
        region: 'a file written after the scan line',
        why: 'it is an ordering in a 1700-line driver, not a chokepoint — nothing enforces that the scan is last',
        coveredBy: null,
        provenBy: 'fov-artifact-written-after-the-scan',
      },
    ],
  },
  {
    gate: 'assessGraderFreeze',
    covers: 'sha256 of every file in packages/verify/src/grade, plus grade-contract.ts, as a set read off the disk',
    blindTo: [
      {
        region: 'truth/ and baseline/',
        why: 'subdirectories are not walked, and the carve-out is argued: a new target adds a baseline, which must not read as the grader moving',
        coveredBy: null,
        provenBy: 'fov-baseline-changed-under-the-freeze',
      },
    ],
  },
  {
    gate: 'assessBuildResidue',
    covers: 'the hash of every built file, before a gate runs and after the source is restored and rebuilt',
    blindTo: [
      {
        region: 'artifacts a gate writes outside dist/ — capture/, envs/, .siteforge-cache/',
        why: 'the signature is over build output, which is the residue that had already produced two wrong scores',
        coveredBy: null,
        provenBy: 'fov-residue-outside-dist',
      },
    ],
  },
  {
    gate: 'evaluateCoverage',
    covers: 'the declared input/output contradictions in COVERAGE_INVARIANTS, per capture',
    blindTo: [
      {
        region: 'any extraction with no invariant written for it',
        why: 'the list is the coverage, and §6 says so — it is meant to grow, one silent drop at a time',
        coveredBy: null,
        provenBy: 'fov-extraction-with-no-invariant',
      },
    ],
  },
  {
    gate: 'assessCaptureIdempotence',
    covers: 'every path in the capture tree across N runs, canonicalised, minus the declared EXEMPT list',
    blindTo: [
      {
        region: 'the exempt paths — the HARs and auth/',
        why: 'each carries a reason and each is reported when it varies; the failure mode of the list is growing until the report comes out clean',
        coveredBy: null,
        provenBy: 'fov-exemption-hides-a-real-difference',
      },
    ],
  },
];
