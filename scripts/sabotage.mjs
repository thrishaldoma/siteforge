#!/usr/bin/env node
/**
 * `pnpm sabotage` — run every gate's sabotage in its sabotaged state.
 *
 * A sabotage test that was never executed while sabotaged is an assertion about
 * a counterfactual nobody checked. This repo has now been bitten by that twice
 * inside the sabotage practice itself:
 *
 *   - the §3.4 storage-state test asserted the nested file *appeared* in the
 *     findings, which was true under the bug too (it was reported for its mode,
 *     not its contents) — caught by chance, while running the sabotage by hand;
 *   - the first attempt at the selector sabotage patched the parsed token set
 *     rather than the raw selector text, so it reproduced a weaker bug than the
 *     real one and passed.
 *
 * So: every gate carries its sabotage as a committed patch, and this harness
 * applies it, asserts the gate fails **for the stated reason**, reverts, and
 * asserts the tree came back byte for byte.
 *
 * Three things are deliberately hard failures rather than skips:
 *
 *   1. **A patch that does not apply.** Surrounding code moves and patches rot.
 *      "12 sabotages, 3 skipped" tells you nothing about those 3, which is the
 *      vacuous-check shape one level up.
 *   2. **A gate that fails for the wrong reason.** A patch that introduces a
 *      syntax error also makes the command exit non-zero, and would "pass" a
 *      harness that only checked the exit code. Each entry names a string that
 *      must appear in the failing output — the discriminating property, the
 *      thing that differs between correct and broken.
 *   3. **A revert that leaves residue.** The tree hash is compared before and
 *      after; anything left behind turns the next gate's result into noise.
 *
 * ## Controls
 *
 * A table made only of defects proves nothing about isolation. A gate that
 * fails on *any* edit to the file satisfies every row above it, and reads
 * exactly like a gate that discriminates — the mirror image of the vacuous
 * invariant this repo keeps finding. So the table also carries **controls**:
 * patches that change the same code a defect attacks, preserve its meaning, and
 * must leave the gate **green**.
 *
 * A control has to be a change the gate could plausibly have keyed on and
 * should not. Re-spelling `matchPath(rel, P)` as `matchesAnyPath(rel, [P])` is
 * one: identical anchoring, different call, on the exact line
 * `secret-gate-path-suffix` rewrites. Renaming a local or reflowing whitespace
 * is *not* — it demonstrates only that the gate is not deranged, which is the
 * vacuous spelling of the same idea.
 *
 * Two are declared, not eight. The rule (§13) is at least one, because the
 * marginal control is worth much less than the first and every patch is one
 * more thing that rots.
 *
 * ## Reachability
 *
 * Every entry states, in `reachable`, why the state it produces is one a real
 * run or a real edit can arrive at, and the harness refuses to run without it.
 *
 * This is a third way a mutation harness goes quiet, alongside never-fires and
 * fires-on-everything: **a gate behaving correctly on input no run can reach
 * proves nothing about the input it will actually see.** It was found in the
 * coverage table — a sabotage that set `endpoints: 0` while leaving three of
 * them carrying auth evidence, green since the day it was written — and the
 * audit that followed found two here:
 *
 *   - `selector-substring-match` parsed the selector, discarded the parse, and
 *     added the raw text. Nobody writes that. Rewritten as a hand-rolled `\w`
 *     tokeniser, which omits the hyphen a class name may contain — the family
 *     of mistake this repo has hit five times.
 *   - `walker-mustreach-disabled` iterated `[] as readonly string[]`. Nobody
 *     writes that either. Rewritten as the check deleted, which is what
 *     removing a slow assertion actually looks like.
 *
 * Both gates fired under the old patches, and both would have kept firing while
 * saying nothing about a reachable regression.
 *
 * Runs last in `verify:clean`, because it mutates the working tree.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Semantic edits, not `git apply`. Two patches rotted in one turn from
// ordinary commits moving context lines while the expression they target sat
// unchanged (0042). `find`/`replace` is anchored on the expression itself.
import {
  applySemanticEdit,
  assessSemanticEdit,
  revertSemanticEdit,
} from '../packages/shared/dist/index.js';

const REPO = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) dir = dirname(dir);
  return dir;
})();
const PATCHES = join(REPO, 'sabotage');

/**
 * One entry per patch.
 *
 * `reachable` — why a real run or a real edit arrives at this state. Required
 * on every entry, defect and control alike.
 *
 * `kind: 'defect'` — the bug it reintroduces, the gate that must notice, and
 * the words that prove it noticed *that* rather than tripping over the patch.
 *
 * `kind: 'control'` — a meaning-preserving change to the same code, naming the
 * defect it is the control for. The gate must stay green. There is no `expect`
 * because there is no output to discriminate: the discriminating property of a
 * control is the exit code, and the pairing is what makes it a control rather
 * than a no-op.
 */
export const SABOTAGES = [
  {
    id: 'secret-gate-path-suffix',
    bug: "§3.4's exemption matches any path ending in auth/storage-state.json",
    reachable: 'the code as shipped, until decision 0014 replaced it with an anchored match',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'not the one at the tree root',
  },
  {
    id: 'origin-prefix-match',
    bug: 'sameOrigin() compares a URL prefix instead of the parsed origin',
    reachable: 'the classifier as shipped: href.startsWith(ORIGIN), which called a foreign link same-origin',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'an origin is a parsed component',
  },
  {
    // Scoped honestly: this reproduces the *helper* returning raw text, which
    // is not the defect that shipped. The shipped defect was in the caller and
    // is `probe-detector-substring` below — the two are separate entries
    // because this patch, applied alone, leaves rung 3 reporting the right
    // count. Measured; §13 says a sabotage must reproduce the actual defect,
    // and this one only reproduces half of it.
    id: 'selector-substring-match',
    bug: 'selectorClassNames tokenises the selector with a regex instead of parsing it',
    reachable: 'a hand-rolled \\w tokeniser, which does not admit the hyphen a class name may contain — the string-op-against-a-grammar mistake, five occurrences so far',
    gate: ['pnpm', '-s', 'test', '--project', 'capture'],
    expect: 'an attribute-value token was reported as a class name',
  },
  {
    // The defect exactly as it shipped, in the caller, gated by the rung that
    // measures the consequence. Costs a 22-second run and is worth it: this is
    // the one that was silently dropping a state on every capture.
    id: 'probe-detector-substring',
    bug: 'the probe asks whether the joined selector text contains a class name',
    reachable: 'the detector as shipped, dropping one state on every rung-3 run',
    gate: ['pnpm', '-s', 'rung3', '--allow-destructive'],
    expect: 'expects statesProbed exactly 3, got 2',
  },
  {
    id: 'walker-unanchored-ignore',
    bug: "the walker's ignore list carries a bare name again",
    reachable: 'the IGNORED_DIRS entry that hid packages/capture for eight commits',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'unanchored',
  },
  {
    id: 'walker-mustreach-disabled',
    bug: 'the walker stops enforcing that a scan reached what it claims to cover',
    reachable: 'the check deleted outright, which is what removing an assertion someone finds slow or noisy looks like',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'never reached',
  },
  {
    id: 'gap-count-not-recomputed',
    bug: 'the model stops recomputing manifest.counts.gaps against the stage report',
    reachable: 'the schema as it stood before 0014 added the recompute',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'One run, one number',
  },
  {
    id: 'catch-lint-promise-rule-removed',
    bug: 'the catch linter stops examining .catch(fn) handlers',
    reachable: 'the linter as it stood before 0013 added the rule, with nine handlers unlinted under it',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'promiseHandlers',
  },
  {
    id: 'grade-digest-not-frozen',
    bug: 'a scored-field threshold moves without the contract digest moving with it',
    reachable: 'a threshold edited and the constant beneath it left alone, which is the entire reason the constant exists',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'the contract table moved without its digest',
  },
  {
    id: 'infer-report-contract-optional',
    bug: "infer's stage report stops having to carry the scored-field contract",
    reachable: 'one branch of the biconditional deleted, which is how a required field becomes optional-and-encouraged',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'an infer report with no scored-field contract parsed',
  },
  {
    id: 'truth-404-as-absent',
    bug: 'a 404 to an anonymous caller is read as "no such endpoint" rather than as gated',
    reachable: 'the naive reading of the status code, and the one anyone writes who has not met Gitea\'s existence-hiding 404',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'must classify as required, never absent',
  },
  {
    id: 'sitemodel-unclaimed-field',
    bug: 'a field lands in SiteModel that no codegen need and no scored category asks for',
    reachable: 'an OPTIONAL convenience field added to a section that is already claimed. Optional matters: a required one breaks the fixture parse first, and the harness rejected the first version of this patch for failing on the wrong reason — which is also why optional is the realistic shape, since it is the addition that costs nothing to make',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'the model carries a field no consumer asked for',
  },
  {
    id: 'sitemodel-undeclared-share',
    bug: 'a second claimant starts reading a leaf without the overlap being declared',
    reachable: 'a need that legitimately grows a reader — a page template does describe the fetch it issues, so reading operations[].method is a reasonable thing to add, and adding it without touching SHARED_CLAIMS is the default way to add it',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'two claimants read one leaf without saying so',
  },

  {
    id: 'grade-empty-truth-scores',
    bug: 'a ground truth with no endpoints still lets categories report a score',
    reachable:
      'the grader as written this morning. `endpoint-identity.recall` is computed against the OBSERVED list and never reads the truth at all, so it reported 1.000 inside a report whose truth side was empty — found by the truth-emptied mutation on the harness\'s first run, hours after the code was written',
    gate: ['pnpm', '-s', 'grade:baseline'],
    expect: 'still reports a score against an empty side',
    change: 'drop the empty-truth ungrounding from gradeSiteModel',
  },
  {
    id: 'binary-source-check-removed',
    bug: 'a NUL byte in a source file stops being noticed, so its diffs are unreadable and no patch can be authored against it',
    reachable:
      'the check deleted outright — the same shape as walker-mustreach-disabled, and the likeliest fate of a whole-repo byte scan somebody finds slow. It landed today because a NUL really did reach grade.ts and really did make git call the file binary',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'nul-byte',
    change: 'stop looking for a NUL byte in assessToolingHostileSource',
  },
  {
    id: 'narrowing-exclusion-tuned',
    bug: 'a format the model CAN express is excluded from the narrowing denominator, on a reason about the misses rather than about the vocabulary',
    reachable:
      'the good-faith version of tuning, and the exact thing the int64 exclusion sets a precedent for. Somebody sees 396 declared `email` formats that the model matched none of, writes a plausible sentence, and the denominator shrinks. It reads identical to the honest exclusion beside it',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'shrinking a denominator to remove misses',
    change: "add 'email' to UNEXPRESSIBLE_FORMATS with a reason about the score",
  },
  {
    id: 'probeable-includes-mutations',
    bug: 'evidence coverage counts mutations as probeable again, re-merging the two populations the split exists to separate',
    reachable:
      'the natural simplification: `discovery.kind === \'observed\'` looks like the whole condition, and dropping the method test reads as removing a redundant clause. §6 forbids re-issuing a mutation anonymously, which is the fact the method test encodes',
    gate: ['pnpm', '-s', 'grade:baseline'],
    expect: 'auth.unprobeable-count',
    change: 'drop the GET test from isProbeableRead',
  },
  {
    id: 'infer-reads-the-grader',
    bug: "packages/infer imports the grader, so a category's definition can reach an inference strategy as code",
    reachable:
      'the ordinary shortcut, and the one 0015 §0 ordered the steps to prevent. infer needs a threshold, the number is already written down in the contract, and importing it is one line that typechecks and reads as reuse rather than as fitting to the metric. The score is meant to be the only channel',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'The score is the only channel',
    change: 'import GRADE_CONTRACT into packages/infer/src/index.ts',
  },
  {
    id: 'surface-exclusion-widened',
    bug: "the static-asset exclusion grows a clause about which endpoints 'count', and drops paths the document describes",
    reachable:
      "the second edit anyone makes to an exclusion list. `/info` really is a health check and an avatar really is an image, so the sentence writes itself — and the exclusion stops being a property of the request and becomes a judgement about which parts of the surface are interesting. That judgement is a denominator",
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'the exclusion removes a path that was scored',
    change: 'add a NOT_APP_SURFACE clause to isCandidateApiCall',
  },
  {
    id: 'surface-measured-logged-out',
    bug: 'a signed-in measurement that only reached /info and /login — eight crawled login screens, reported as a verdict',
    reachable:
      'not hypothetical: the script produced exactly this record, and it was committed. Vikunja ignores Playwright fill, hydrates over the field it painted and ate the first five characters, so the login failed and every page below was the login screen. The verdict printed was confident and wrong',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'measured a login screen',
    change: 'truncate the vikunja record to the surface a logged-out crawl reaches',
  },
  {
    id: 'empty-prefix-admits-everything',
    bug: 'the crawl boundary compares segments with a bare `.every`, so an empty path prefix admits every path on the origin',
    reachable:
      'this is the code that was there, in three places, for the life of the project. `[].every(…)` is true, and nobody writes a prefix predicate thinking about the empty prefix — the grader shipped the same three lines and its universe filter admitted an entire admin SPA. §6 makes this one the crawl boundary',
    gate: ['pnpm', '-s', 'lint'],
    expect: 'true is the permissive answer',
    change: 'inline the prefix comparison in isUnder instead of calling isSegmentPrefix',
  },
  {
    id: 'precondition-login-unchecked',
    bug: 'the surface measurement stops asserting that its session established, so a crawl of eight login screens reports `disjoint`',
    reachable:
      'the redundancy argument, which is true and beside the point: measure() does throw earlier, and somebody removing a duplicated check would leave exactly this. The failure it guards produces the verdict the script exists to produce, which is why the assertion has to be the primary gate rather than a second opinion',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'every page below it is a login screen',
    change: 'drop the session precondition from assessMeasurementPreconditions',
  },
  {
    id: 'grader-moved-after-the-freeze',
    bug: "a narrowing threshold drops from 0.98 to 0.9 after the grader was pinned, with no decision entry saying why",
    reachable:
      'the shape of every metric that ever got tuned. Infer scores 0.94 on narrowing precision, 0.98 looks harsh in the moment, and one character makes the run green. Nothing about the edit says it happened during a scoring run rather than a year earlier — which is the whole reason the pin exists, since "it did not move" is checkable and "I did not read it" is not',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'changed after the freeze',
    change: 'lower narrowing.precision from 0.98 to 0.9 in the frozen contract',
  },
  {
    id: 'grader-module-added-without-a-pin',
    bug: 'a new scoring module lands beside the frozen ones, holding thresholds lifted out of the pinned contract, and no pinned hash moves',
    reachable:
      'the tidying edit that defeats the pin without touching it. Factoring two thresholds out of `grade-contract.ts` into `thresholds.ts` is ordinary housekeeping, every pinned file still hashes the same, and the numbers are now outside the freeze — which is why the set has to be read off the disk rather than off the pin. The first version of the check derived its keys from `FROZEN_FILES`, so this patch would have applied cleanly and the suite would have stayed green',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'carries no pin',
    change: 'add packages/verify/src/grade/thresholds.ts, pinned by nothing',
  },
  {
    id: 'build-residue-ignores-javascript',
    bug: 'the compiled-residue check skips .js files, which is every file it exists to compare',
    reachable:
      'the exclusion that looks like noise-reduction and removes the whole subject. `.tsbuildinfo` is genuinely expected to move and is genuinely skipped, so a second extension in the same condition reads as more of the same — and .js is the only thing under dist/ that carries the sabotaged code. This is the shape that let dist/ hold a sabotaged grader for a whole session: nothing about a silent exclusion says it removed the finding',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'differs after the run',
    change: 'skip .js in assessBuildResidue, beside the legitimate .tsbuildinfo skip',
  },
  {
    id: 'variant-noop-exempted',
    bug: 'the piece whose variant measured nothing is exempted from the check that says so',
    reachable:
      'what happens the second time the harness goes red on a row somebody has already explained to themselves. The narrowings variant really does produce an identical model and the capture really does hold no enums, so "exempt it, the reason is understood" is the reasonable-sounding edit — and it puts the row back in the table reporting `0 metrics moved`, which is what a real null result reports. The exemption is the shape §13 already caught in the secret gate',
    gate: ['pnpm', '-s', 'test', '--project', 'infer'],
    expect: 'measured nothing',
    change: 'exempt the narrowings piece from assessVariantIsMeasurable',
  },
  {
    id: 'truth-allof-alias-unfollowed',
    bug: 'the truth walk follows only a bare `$ref`, so every `allOf: [{$ref}]` alias resolves to an untyped object',
    reachable:
      "the code as shipped, for the life of the project. Gitea's document uses the idiom zero times so nothing was wrong while Gitea was the target, and Vikunja's uses it 32 times — the defect arrived by changing target rather than by editing code, which is the way nobody looks for. It also fails in the flattering direction: the truth side under-claims, so `response-field-presence.recall` went UP and read as `the crawl's reach`",
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'no enum-bearing response fields were enumerated',
    change: 'drop the soleAllOfRef call from deref, leaving the bare $ref branch',
  },
  {
    id: 'notderived-scoped-to-category',
    bug: 'a per-metric `notDerived` entry ungrounds its whole category, so a metric that IS derivable reads vacuous',
    reachable:
      "the simplification anybody makes on reading two maps built from one list: `notDerived` was per-category for three decisions and the second map looks redundant. It is not — `narrowing`'s zero-formats argument grounds precision and NOT recall, and `entity-identity`'s grounds precision while recall is unbuildable. Collapsing it silently returns a real number to `vacuous`, which reads as a limitation of the ground truth rather than as a lost measurement",
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    expect: 'PRECISION is not derived',
    change: 'build notDerivedByCategory from every entry, ignoring `metric`',
  },
  {
    id: 'scope-untracked-excusable',
    bug: 'the walked-but-untracked direction becomes excusable, so a source file no clone contains can be waved through',
    reachable:
      "the symmetry argument, which is wrong and reads as tidiness: one direction consults `excused` and the other does not, so making both consult it looks like removing a special case. It is the special case that matters — a committed file outside every scanner is a real thing to excuse, and a scanned file outside every clone is the packages/capture defect, which stayed green for eight commits precisely because something local could see it. The patch also spells the prefix test as `startsWith`, which is the substring-for-segment mistake in the same line",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'walked-but-untracked',
    change: 'consult `excused` in the walked-but-untracked loop too',
  },
  {
    id: 'merge-container-ambiguity-ignored',
    bug: 'a narrow row is folded into the FIRST wider row that contains it, rather than only into a unique one',
    reachable: 'the obvious way to make the containment pass merge more, and the shape someone reaches for when a projection they expected to fold did not. `containers[0]` is already on the next line, so the edit is deleting the only thing standing between it and a guess',
    gate: ['pnpm', '-s', 'test', '--project', 'infer'],
    expect: 'REFUSES to merge when two wider rows could each be the container',
    change: 'accept any container instead of exactly one',
  },
  {
    id: 'merge-floor-tuned',
    bug: 'MERGE_MIN_SHARED_FIELDS is lowered so thinner rows merge',
    reachable: 'the exact adjustment 0025 §2.4 forbids in writing — "if 4 over-merges on this target, that is a finding to report, not a number to move". A threshold with a score attached is the one number everyone is tempted by, which is why the gate reads the decision document rather than the constant',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: '0025 no longer states the floor it declared',
    change: 'the declared floor moved from 4 to 1, with the document left alone',
  },

  {
    id: 'asset-bodies-counted-not-differenced',
    bug: 'the index and the directory are compared by count, so one missing file and one orphan net out to clean',
    reachable: 'the cheap early return anyone adds to a two-way set difference — "if the totals match there is nothing to find" is true almost always, and this repository has already shipped the same reasoning once, in the coverage table where an aggregate hid a category that had disappeared entirely',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'reports BOTH directions rather than a count that nets them out',
    change: 'short-circuit both set differences when the two totals are equal',
  },

  {
    id: 'shape-veto-above-the-ladder',
    bug: "the slug-shape test is restored above the ranking, so it vetoes §7.5's own primary evidence",
    reachable: "HEAD until this turn, and §7.5's prose said to do it — the section had a 'hard exclusions, regardless of the above' tier, and this was in it. That is the point: every individual line read correctly, and the defect was the *tier*. A shape heuristic ranked last among reasons to believe was first among reasons to disbelieve, and no review of the ranking could see it because it was not in the ranking",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'lets a UI constraint narrow a domain of numeric codes',
    change: 'the ENUM_TOKEN check is reinstated above the UI-constraint branch',
  },

  {
    id: 'driver-does-not-parse',
    bug: 'a capture driver has a syntax error, and every gate stays green',
    reachable: 'it happened. A dropped closing paren in `capture-site.mjs` survived `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` — all four green — because `tsc` does not read `.mjs`, the lint scripts and `determinism.test.mjs` read this file as *text*, and `verify:clean` runs rung 2 and rung 3, neither of which imports the real driver. It was found by a nine-minute crawl dying on the first line of `node`. The patch reinstates exactly the character that was missing',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'capture-site.mjs',
    change: 'the closing paren of the reveal call is dropped',
  },

  {
    id: 'landmark-defers-to-href',
    bug: "§7.6's rank 1 yields to rank 4 when the control has an href, so a landmark binds a URL",
    reachable: "the reasoning is almost persuasive, which is what makes it the one to guard: *a <header> with an href is navigable, so why decline it?* Because rank 1 is not about whether a URL exists, it is about whether the element is a control at all — and a wrapper element carrying an href it never activates on is exactly what the 7 Vikunja `banner` entries are. Landing this is the unranked-veto bug (0033 §4.2) inverted: instead of a condition sitting above the ladder, a ranked condition quietly stops outranking the one below it, and the ranking's declared order stops describing what runs",
    gate: ['pnpm', '-s', 'test', '--project', 'infer'],
    // The precedence, not the decline. Under the bug rank 1 still declines
    // every landmark that has no href — which is most of them — so a test
    // asserting "a landmark is declined" passes in both states. §13: the
    // assertion must exclude what the broken version also outputs.
    expect: 'a landmark with an href still binds nothing',
    change: 'rank 1 returns null instead of declining when the control carries an href',
  },

  {
    id: 'claim-check-drops-the-conjunction',
    bug: '`claimExceeded` reports every route with a moved screenshot, instead of only the routes whose contentHash claimed to certify them',
    reachable: "the simplification the finding invites. What a reader wants out of it is *which screenshots moved*, and the `agreed` guard reads like a filter you can drop without losing any of them — dropping it does not remove a single path from the output, it only adds routes whose hash moved too. That turns the finding back into a second copy of `unstable`, which is precisely the state 0038 exists to leave: on the real trees it would report `tasks-id` alongside `user-settings-general`, and `tasks-id`'s hash did move, so the field misled nobody there",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    // The conjunction, not the presence of the finding. Under the bug
    // `claimExceeded` is still non-empty and still names the real route, so
    // "it reported user-settings-general" passes in both states — §13's rule
    // that the assertion must exclude what the broken version also outputs.
    // The discriminating case is the route whose hash *moved*: correct is
    // silent, broken is not.
    expect: 'stays silent when the hash moved too',
    change: 'the `hashPerRun` agreement guard is deleted, so the finding no longer requires the claim to have held',
  },

  {
    id: 'divergence-slot-ignores-its-endpoint',
    bug: 'a field-scope divergence entry excludes its slot on every endpoint, not just the one whose exchange it recorded',
    reachable: "the simplification anyone reaches for once two entries name the same pointer — Vikunja's four are `view_kind` and `bucket_configuration_mode` twice each, so keying on the pointer alone looks like deduplication rather than a widening. It makes one recorded exchange justify an exclusion everywhere the field name appears, which is exactly what 0015's per-entry evidence rule forbids: `view_kind` being wrong on `/projects` is not evidence about any other endpoint",
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    // The lookup's own assertion, not the freeze's. `changed after the freeze`
    // is what *every* edit to grade.ts produces, so it could not tell this bug
    // from a rename — §13's rule that an assertion must exclude what the broken
    // version also outputs. `slotsForEndpoint` is extracted so there is
    // something to assert against.
    expect: 'covers only the endpoint whose exchange the entry recorded',
    change: 'the slot exclusion is looked up by pointer alone, dropping the endpoint from the key',
  },

  {
    id: 'manifest-field-added-unclassified',
    bug: 'a field is added to the manifest schema without anyone deciding what backs it or reads it',
    reachable: "how both of the manifest's fictions got there. `determinism.frozen` named four globals no shim froze, and `prefersReducedMotion` asserted `reduce` while four of six contexts did not set it — neither was findable by reading the manifest, because a claim with nothing behind it looks exactly like one that works. The patch adds an ordinary optional field, which is the least ceremonious way anyone adds one",
    // `schema`'s own tests import `./manifest.js` relatively, so they run
    // against the source and this gate compiles nothing. The first version
    // lived in `shared`, which resolves `@siteforge/schema` to `dist` — so it
    // needed a build, the build wrote the sabotaged declaration into `dist/`,
    // and the residue check caught it. A gate about the schema's own fields
    // belongs beside the schema, next to `evaluateCoverage`.
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    expect: 'networkWaitSeconds',
    change: 'an optional field is added to CaptureManifestSchema and left out of the claim ledger',
  },

  {
    id: 'select-extraction-requires-a-name',
    bug: 'the option-set extractor queries `select[name], select[id]`, so a framework-rendered select is invisible',
    reachable: "HEAD until this turn, and the state every Vikunja capture was taken in — six `<select>` elements and 632 `<option>`s produced zero UI constraints because a Vue SPA binds through `v-model` and emits neither attribute. Nobody writes an attribute filter to exclude anything; it gets written because `[name]` is how a *form* posts a control, and that reflex survives into a codebase where the control is read rather than posted",
    gate: ['pnpm', '-s', 'test', '--project', 'capture'],
    // The string the *broken* version prints and the correct one cannot. Not
    // the whole vitest diff line: every other row here matches a fragment of
    // *our* text, and pinning a test runner's array formatting means the next
    // vitest upgrade makes this gate fail "for the wrong reason".
    expect: "select[name], select[id]",
    change: 'the attribute filter is restored to the extractor',
  },

  {
    id: 'idempotence-accepts-one-run',
    bug: 'the idempotence check accepts a single crawl and pronounces it stable',
    reachable: 'off by one in a guard, and the state it produces is the one M1 was actually in for the whole life of the project — `manifest.contentHash` computed once per run and never compared, which is exactly "one crawl, reported stable". The patch reinstates the condition the tool was written to end',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    expect: 'THROWS on a single run rather than reporting it stable',
    change: 'the minimum-runs guard admits one run instead of requiring two',
  },

  // ---- controls: the gate must NOT fire ------------------------------------

  /*
   * Field-of-view controls (0037). Each puts a real defect in a region a gate
   * cannot see and asserts the gate stays **green** — which is the only way to
   * tell "cannot see it" from "there was nothing to see". `controlFor` names the
   * gate whose blind spot is being pinned, and `field-of-view.declarations.ts`
   * points back here, so neither list can drift from the other.
   */
  {
    kind: 'field-of-view',
    id: 'fov-false-operational-reason',
    controlFor: 'lint-catch',
    change: 'a swallow whose `// operational:` reason is false',
    gate: ['pnpm', '-s', 'lint'],
    reachable: "the reason is prose and the linter accepts it on its face. Anyone writing a catch under time pressure writes the reason that makes the linter pass, which is the one failure mode a textual gate for this cannot have.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-page-without-newpage',
    controlFor: 'lint-guarded-pages',
    change: 'a page obtained from context.pages() rather than newPage()',
    gate: ['pnpm', '-s', 'lint'],
    reachable: "`installEscapeGuards` is required at every page, and the linter matches the *call*. A page arriving by any other route is not a call it can match, and §13 already records that a page-level guard is one you can forget at the next newPage().",
  },

  {
    kind: 'field-of-view',
    id: 'fov-runtime-built-comparison',
    controlFor: 'lint-identifiers',
    change: 'an identifier comparison assembled from variables at runtime',
    gate: ['pnpm', '-s', 'lint'],
    reachable: "the grammar it enforces is a source grammar. `path.slice(0, built.length) === built` is a prefix test the linter cannot see, and prefix-instead-of-segment is the exact defect it exists to stop.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-empty-admits-without-every',
    controlFor: 'lint-empty-admits',
    change: 'an empty container admitting via .filter().length === 0 instead of .every()',
    gate: ['pnpm', '-s', 'lint'],
    reachable: "§13 argues `.some()` out of scope on the operator; every other spelling is simply unchecked. `filter(...).length === 0` is `every` with different words and returns the permissive answer on empty — which is how `inUniverse` admitted every path in existence.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-untracked-and-ignored-file',
    controlFor: 'assessScopeAgreement',
    change: 'a source path that is both walker-ignored and untracked',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    reachable: "the gate reconciles two views and cannot see outside their union. A file under a gitignored directory that is also never committed is in neither, which is the one place a set difference between them is blind.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-driver-imports-nothing',
    controlFor: 'scripts-parse',
    change: 'a driver importing a module that does not exist',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    reachable: "`node --check` parses and does not execute, deliberately — these drivers need Docker to do anything else. So a syntactically perfect file with an unresolvable import passes, and fails at the first line of a real run, which is exactly how the paren was found.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-baseline-changed-under-the-freeze',
    controlFor: 'assessGraderFreeze',
    change: 'a scoring-relevant edit inside baseline/, which the freeze does not walk',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    reachable: "the carve-out is argued and correct — a new target adds a baseline and that must not read as the grader moving — but it is still a region where a scoring input can change without the freeze noticing. 0018 states the carve-out; nothing proved it was a real hole.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-residue-outside-dist',
    controlFor: 'assessBuildResidue',
    change: 'residue written outside dist/, where the build signature does not look',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
    reachable: "the signature was built over dist/ because dist/ is where two wrong scores came from. `.siteforge-cache/` is written by the pipeline by design (§13 caches LLM calls by input hash) and no cleanliness check observes it.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-artifact-written-after-the-scan',
    controlFor: 'scanCaptureTree',
    change: 'an artifact written after the §3.4 scan line',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    reachable: "the scan is a line near the end of a 1700-line driver, and being last is an ordering nobody enforces. One careless append below it is a file under `capture/` that no gate ever reads — and §3.4 is the gate whose failure is a leaked credential rather than a bad score.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-extraction-with-no-invariant',
    controlFor: 'evaluateCoverage',
    change: 'an extraction counted in coverage.json with no invariant reading it',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    reachable: "§6 says the list is meant to grow one silent drop at a time, so a new count landing without an invariant is the normal way this happens — `controlsFired` and `controlsUndriveable` were both added exactly like this, deliberately and with the reason written down.",
  },

  {
    kind: 'field-of-view',
    id: 'fov-exemption-hides-a-real-difference',
    controlFor: 'assessCaptureIdempotence',
    change: 'an EXEMPT entry covering a path that genuinely should reproduce',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
    reachable: "the tool's own docstring names this as the list's failure mode: 'the tempting way to use this tool is to add whatever turns up different until the report comes out clean.' `exemptedAndStable` catches an exemption that never varies; it cannot catch one that varies for a real reason.",
  },


  {
    kind: 'control',
    id: 'sitemodel-declared-share',
    controlFor: 'sitemodel-undeclared-share',
    change: 'the same extra claimant on the same leaf, with the two-way share split into a declared three-way one — a legitimate overlap, written down',
    gate: ['pnpm', '-s', 'test', '--project', 'schema'],
    reachable: 'the correct way to add the reader the defect patch adds carelessly, and the pair is the whole point: the gate must reject the overlap only while it is unwritten',
  },

  {
    kind: 'control',
    id: 'secret-gate-exemption-respelled',
    controlFor: 'secret-gate-path-suffix',
    reachable: 'an ordinary refactor to another correct API already exported from shared',
    change: 'the §3.4 exemption re-spelled as matchesAnyPath(rel, [P]) — the same anchored comparison through a different call, on the line the defect rewrites',
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
  },
  {
    kind: 'control',
    id: 'walker-ignore-anchored-addition',
    controlFor: 'walker-unanchored-ignore',
    reachable: 'the ignore list is meant to grow; this is what growing it correctly looks like',
    change: "a fifth ignore pattern, '**/coverage', correctly anchored — the same array the defect un-anchors",
    gate: ['pnpm', '-s', 'test', '--project', 'shared'],
  },
  {
    kind: 'control',
    id: 'truth-allof-order-swapped',
    controlFor: 'truth-allof-alias-unfollowed',
    reachable:
      'the ordinary re-spelling of a two-branch lookup as a `??` chain, on the exact line the defect rewrites. Equivalent on every node either committed document contains — none carries both spellings — so it differs only on a node neither has, which is what makes it meaning-preserving here and not merely tidier',
    change: 'check the allOf alias first and fall back to the bare $ref, instead of the reverse',
    gate: ['pnpm', '-s', 'test', '--project', 'verify'],
  },
  {
    kind: 'control',
    id: 'merge-uniqueness-destructured',
    controlFor: 'merge-container-ambiguity-ignored',
    reachable: 'destructuring a list whose first element is about to be used is an ordinary tidy-up, and it lands on the exact line the defect rewrites',
    change: 'the uniqueness test spelled as a destructure — `only === undefined || rest.length > 0` — instead of a length comparison',
    gate: ['pnpm', '-s', 'test', '--project', 'infer'],
  },
];

/**
 * Two kinds of entry assert a gate stays **green**, and they pair with different
 * things.
 *
 * A `control` pairs with a **defect**: the same code touched in a benign way, so
 * a gate that fires on any edit at all is told apart from one that discriminates.
 *
 * A `field-of-view` control pairs with a **gate**: a real defect placed in a
 * region that gate cannot see, asserting it stays green. That is the only way to
 * tell "cannot see it" from "there was nothing to see", and `controlFor` would
 * be the wrong field — there is no sibling defect, and demanding one would force
 * a fiction (0037).
 */
export const isControl = (s) => s.kind === 'control' || s.kind === 'field-of-view';
export const isFieldOfView = (s) => s.kind === 'field-of-view';
const DEFECTS = SABOTAGES.filter((s) => !isControl(s));
const CONTROLS = SABOTAGES.filter(isControl);

/**
 * Is the table itself well formed? One message per problem, never a throw.
 *
 * Every one of these checks used to sit inline in `main()`, where the only
 * table it could ever see was the real one — which passes. A gate reachable
 * only through the input it passes on is a gate nobody can prove fires, and
 * that is the root these four checks share with the vacuous invariant and the
 * unreachable patch they exist to prevent. Here the table and the directory
 * listing arrive as parameters, so a test can hand it a table with no controls
 * and watch it object.
 *
 * `patchIds` is the sorted list of `sabotage/*.patch` basenames.
 */
export function assessSabotageTable(entries, patchIds) {
  const problems = [];
  const defects = entries.filter((e) => !isControl(e));
  const controls = entries.filter(isControl);

  // The completeness assertion this repo applies to every rule table: a patch
  // on disk with no entry here would never run, and an entry with no patch
  // would be a claim about a file that does not exist.
  const declared = entries.map((e) => e.id).slice().sort();
  const onDisk = patchIds.slice().sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(declared)) {
    problems.push(
      `sabotage/ and the table disagree.\n  on disk:  ${onDisk.join(', ')}\n  declared: ${declared.join(', ')}`,
    );
  }
  if (defects.length === 0) {
    problems.push('no sabotages declared — a harness that runs nothing reports success.');
  }
  // §13: a table made only of drops passes while proving nothing about
  // isolation. At least one control, and each control has to name a defect that
  // exists — an unpaired control is a patch nobody can say what it isolates.
  if (controls.length === 0) {
    problems.push(
      'no controls declared. A harness of defects alone cannot tell a gate that\n' +
      'discriminates from one that fails on any edit at all — see §13.',
    );
  }
  // §13: every entry states why a real run or a real edit reaches the state it
  // produces. A gate behaving correctly on unreachable input proves nothing
  // about reachable input, and reads exactly like a gate that works.
  const unreachable = entries.filter((e) => !e.reachable || e.reachable.length < 20);
  if (unreachable.length > 0) {
    problems.push(
      `${unreachable.map((e) => e.id).join(', ')}: no reachability note.\n` +
      'Say why a real run or a real edit arrives at this state — see §13.',
    );
  }
  const defectIds = new Set(defects.map((e) => e.id));
  for (const control of controls) {
    // A field-of-view control names a gate, and `field-of-view.declarations.ts`
    // is what reconciles that name — both directions, so neither list drifts.
    if (isFieldOfView(control)) {
      if (!control.controlFor) {
        problems.push(`field-of-view control ${control.id} names no gate.`);
      }
      continue;
    }
    if (!defectIds.has(control.controlFor)) {
      problems.push(`control ${control.id} names ${control.controlFor}, which is not a declared defect.`);
    }
  }
  return problems;
}

const git = (...args) => execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8' });

/**
 * A signature of the working tree, so residue after a revert is visible.
 *
 * Reads only. An earlier version ran `git add -A --intent-to-add` first, which
 * meant the "did the revert leave anything behind" *check* wrote to the index —
 * a read with a side effect, in a harness whose whole job is leaving no trace.
 * `--porcelain` already reports untracked files.
 */
const treeSignature = () => git('status', '--porcelain');

/**
 * The same signature for **compiled output**, which `git status` cannot see.
 *
 * `dist/` is gitignored, so it never appears in `--porcelain` and the residue
 * check was blind to it by construction. That is not hypothetical: several
 * gates build before they run (`grade:baseline` is
 * `pnpm --filter @siteforge/verify build && …`, `lint` builds shared), so a
 * patch gets **compiled** and reverting the source leaves the sabotaged
 * JavaScript sitting in `dist/`. This session read a score off that residue —
 * `probeable-includes-mutations` with `method === 'GET' &&` stripped out — and
 * got two auth metrics that were wrong and looked ordinary. A tool that reports
 * a confident wrong number is the failure this whole harness exists to prevent,
 * and here it was the harness producing it.
 */
function buildSignature() {
  const out = {};
  for (const pkg of readdirSync(join(REPO, 'packages'))) {
    const dist = join(REPO, 'packages', pkg, 'dist');
    if (!existsSync(dist)) continue;
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        // `.tsbuildinfo` records timestamps and is expected to move.
        else if (!entry.name.endsWith('.tsbuildinfo')) {
          out[path.slice(REPO.length + 1)] = createHash('sha256')
            .update(readFileSync(path))
            .digest('hex');
        }
      }
    };
    walk(dist);
  }
  return out;
}

/**
 * Did the run leave compiled residue the rebuild did not undo?
 *
 * Takes both sides as parameters (§13) so a test can hand it a pair that
 * disagrees; `main()` supplies the real before-and-after.
 */
export function assessBuildResidue(before, after) {
  const problems = [];
  for (const [file, hash] of Object.entries(before)) {
    const now = after[file];
    if (now === undefined) {
      problems.push(`${file} was built before the run and is missing after it.`);
    } else if (now !== hash) {
      problems.push(
        `${file} differs after the run, and a rebuild did not restore it. A gate that builds compiles the patch into dist/, git status cannot see it because dist/ is ignored, and the next script to read dist/ scores against a sabotaged grader without a word.`,
      );
    }
  }
  return problems;
}

/** A file's text, or `null` when it is not there — the create case. */
const readOrNull = (at) => (existsSync(at) ? readFileSync(at, 'utf8') : null);

const run = (command) => {
  const [bin, ...args] = command;
  const result = spawnSync(bin, args, { cwd: REPO, encoding: 'utf8' });
  return { code: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
};

function main() {
  const dirty = git('status', '--porcelain').trim();
  // `--allow-dirty` exists for developing the harness, and it used to be
  // survivable because `git apply -R` undid only the patch. It still is — the
  // revert below undoes exactly what it did — but an edit against a file that
  // already has uncommitted changes is not: any mistake in the revert takes
  // the developer's work with it, and this harness edits **its own source**.
  // So the escape hatch is narrowed rather than removed.
  const dirtyPaths = new Set(
    dirty.split('\n').filter(Boolean).map((line) => line.slice(3).trim()),
  );
  const targeted = [
    ...new Set(
      readdirSync(PATCHES)
        .filter((f) => f.endsWith('.edit.json'))
        .flatMap((f) => JSON.parse(readFileSync(join(PATCHES, f), 'utf8')).map((e) => e.file))
        .filter((f) => dirtyPaths.has(f)),
    ),
  ];
  if (targeted.length > 0) {
    console.error(
      '\nsabotage refuses to edit a file that already has uncommitted changes, ' +
      '--allow-dirty or not:\n',
    );
    for (const f of targeted) console.error(`  ${f}`);
    console.error('\nCommit or stash them first. A revert that goes wrong here takes real work with it.\n');
    process.exit(1);
  }
  if (dirty && !process.argv.includes('--allow-dirty')) {
    console.error('\nsabotage refuses to run against a dirty tree — it applies and reverts patches.\n');
    console.error(dirty);
    process.exit(1);
  }

  // Compiled output, before anything is applied. Several gates build, so this
  // is the half of "leaves no trace" that `git status` structurally cannot see.
  const buildBefore = buildSignature();

  const onDisk = existsSync(PATCHES)
    ? readdirSync(PATCHES).filter((f) => f.endsWith('.edit.json')).map((f) => f.slice(0, -10))
    : [];
  const problems = assessSabotageTable(SABOTAGES, onDisk);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`\n${problem}`);
    console.error('');
    process.exit(1);
  }

  console.log(
    `\nsabotage — ${DEFECTS.length} fixed bug(s) reintroduced, ` +
    `${CONTROLS.length} control(s) that must change nothing\n`,
  );
  const before = treeSignature();
  let failed = 0;

  for (const sabotage of SABOTAGES) {
    const edits = JSON.parse(readFileSync(join(PATCHES, `${sabotage.id}.edit.json`), 'utf8'));
    process.stdout.write(`  ${sabotage.id.padEnd(34)}`);

    // 1. Every edit must still apply, unambiguously. Both failures are hard:
    //    `absent` means the code it targets is gone, so re-anchor it — and
    //    unlike a rotted patch that means the *target* moved rather than its
    //    neighbourhood. `ambiguous` means scan order would pick the call site.
    const findings = edits
      .map((e) => assessSemanticEdit(e, readOrNull(join(REPO, e.file))))
      .filter((f) => f !== null);
    if (findings.length > 0) {
      console.log(`✗  ${findings[0].problem}`);
      for (const f of findings) console.log(`      ${f.detail}`);
      console.log(`      Never skip — a sabotage that cannot run is a gate nobody is checking.`);
      failed += 1;
      continue;
    }
    for (const e of edits) {
      const at = join(REPO, e.file);
      writeFileSync(at, applySemanticEdit(e, readOrNull(at)));
    }

    // 2. A defect must make the gate fail, for the stated reason. A control
    //    must leave it green — a control that fails means the gate is keyed on
    //    the edit rather than on the meaning, which makes every defect row
    //    above it unfalsifiable.
    const gate = run(sabotage.gate);
    let verdict;
    if (isControl(sabotage)) {
      if (gate.code === 0) {
        verdict = `✓  unmoved   (control for ${sabotage.controlFor})`;
      } else {
        verdict = `✗  the gate fired on a meaning-preserving change: ${sabotage.change}`;
        console.log(verdict);
        console.log('      It is keyed on the edit, not on the property — so its defect row proves nothing.');
        console.log(`      ${gate.output.trim().split('\n').slice(-6).join('\n      ')}`);
        verdict = null;
        failed += 1;
      }
    } else if (gate.code === 0) {
      verdict = `✗  the gate still passed — it does not catch: ${sabotage.bug}`;
      failed += 1;
    } else if (!gate.output.includes(sabotage.expect)) {
      verdict = `✗  the gate failed, but not for the stated reason (no "${sabotage.expect}")`;
      failed += 1;
    } else {
      verdict = '✓  caught';
    }

    // 3. The revert must leave nothing behind, whatever happened above.
    //    Undo **exactly what we did**, never `git checkout --`. The harness
    //    edits its own source (`build-residue-ignores-javascript` targets this
    //    file), and restoring committed bytes would discard any other
    //    uncommitted work in it — measured the hard way while writing this.
    //    It is also the weaker, correct claim: `treeSignature()` below is what
    //    catches a gate that rewrote the file behind our backs.
    //    Assessed before it is done rather than attempted and caught: a
    //    failed revert is a defect, and `rethrowIfDefect` would rightly
    //    refuse to let a `catch` here turn it into a message.
    for (const e of edits) {
      const at = join(REPO, e.file);
      const text = readOrNull(at);
      const reverse = { file: e.file, find: e.replace, replace: e.find };
      const blocked = e.find === null ? null : assessSemanticEdit(reverse, text);
      if (blocked !== null) {
        console.log('✗  could not revert — the tree is now dirty');
        console.log(`      ${blocked.detail}`);
        process.exit(1);
      }
      const back = revertSemanticEdit(e, text ?? '');
      if (back === null) rmSync(at, { force: true });
      else writeFileSync(at, back);
    }
    if (treeSignature() !== before) {
      console.log('✗  revert left residue; every later result would be noise');
      process.exit(1);
    }
    // And the same for compiled output, **inside** the loop rather than once at
    // the end. A gate that builds leaves sabotaged JavaScript in `dist/`, and
    // the next gate that reads `dist/` without building runs against it —
    // `rung3` has no build step, so whether the run is valid would depend on
    // the table's order. That is worse than a deterministic bug: reordering the
    // rows silently changes the answer. The hash walk is nearly free and the
    // rebuild only fires for the handful of gates that compile.
    if (JSON.stringify(buildSignature()) !== JSON.stringify(buildBefore)) {
      const restored = run(['pnpm', '-s', 'build']);
      const residue =
        restored.code === 0 ? assessBuildResidue(buildBefore, buildSignature()) : ['the rebuild failed'];
      if (residue.length > 0) {
        console.log('✗  this gate compiled the patch and the rebuild did not undo it');
        for (const problem of residue) console.log(`      ${problem}`);
        process.exit(1);
      }
    }
    if (verdict !== null) console.log(verdict);
  }

  // The source came back byte for byte; `dist/` did not, because gates that
  // build compiled the patch. Rebuild from the restored source, then assert the
  // rebuild actually restored it — the same standard, applied to the artifact
  // `git status` cannot see.
  console.log('\n  restoring compiled output …');
  const rebuilt = run(['pnpm', '-s', 'build']);
  if (rebuilt.code !== 0) {
    console.log('✗  could not rebuild after the run; dist/ may hold sabotaged output');
    console.log(rebuilt.output.trim());
    process.exit(1);
  }
  const residue = assessBuildResidue(buildBefore, buildSignature());
  if (residue.length > 0) {
    console.log('✗  compiled residue survived the rebuild:');
    for (const problem of residue) console.log(`      ${problem}`);
    console.log(
      '\n   If dist/ was already stale when this run started, that is what this\n' +
      '   reports and the fix is `pnpm -s build` before `pnpm sabotage`. A false\n' +
      '   alarm here is how a check teaches people to bump past it, so the two\n' +
      '   cases are worth telling apart before acting.',
    );
    process.exit(1);
  }

  console.log('');
  if (failed > 0) {
    console.log(`✗ ${failed} entr(ies) did not behave as declared.\n`);
    process.exit(1);
  }
  console.log(
    '✓ every gate failed when its bug came back, held still when nothing changed,\n' +
    '  and both the tree and its compiled output are clean.\n',
  );
}

// Importing this file for `SABOTAGES` or `assessSabotageTable` must not apply
// patches to the working tree. The linters here already have this shape.
if (import.meta.url === `file://${process.argv[1]}`) main();
