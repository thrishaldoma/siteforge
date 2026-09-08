/**
 * Rung declarations.
 *
 * §13's test-target ladder, as data. A rung says which extracted categories its
 * target is expected to produce; the runner asserts them rather than a human
 * reading counts off a console, which is how three silent drops survived the
 * first rung-2 run.
 *
 * Coverage invariants (schema `COVERAGE_INVARIANTS`) catch *contradictions*
 * between one run's input and output. These catch a target that never exercised
 * the path at all — a different failure, and the reason rung 1 looked green.
 */
export const RUNGS = {
  1: {
    label: 'a plain static page (example.com)',
    target: 'https://example.com/',
    expectNonEmpty: ['styleTableEntries', 'assets', 'a11yNodes'],
    knownEmpty: [
      'statesCssomPseudo', 'statesCssomAttribute', 'statesProbed', 'endpoints', 'fonts',
      'foreignAssets', 'blockedOffOriginNavigations', 'cancelledDownloads',
    ],
  },
  2: {
    label: 'a local static site: external CSS, webfont, images, long scroll',
    target: 'local:test-site',
    expectNonEmpty: [
      'styleTableEntries',
      'assets',
      'fonts',
      'statesCssomPseudo',
      'statesCssomAttribute',
      'statesScroll',
      'a11yNodes',
      'interactionCandidates',
      // The crawl boundary's *allow* branch. Rung 2 serves its font and one
      // image from a second origin precisely so this can be a count rather
      // than a claim: a guard that blocked subresources would pass every other
      // gate here and break capture on every real site.
      'foreignAssets',
      // ...and the block branch, from the same page. A guard that blocked
      // everything would satisfy this one and fail `foreignAssets`; a guard
      // that blocked nothing would do the reverse. Both are needed.
      'blockedOffOriginNavigations',
      // The download branch of the boundary. A handler that cancels downloads
      // is untestable against a fixture that never starts one (§13).
      'cancelledDownloads',
    ],
    knownEmpty: ['endpoints', 'statesProbed'],
  },
  3: {
    label: 'a local CRUD app: endpoints, flows, probed states, both auth contexts',
    target: 'local:crud-app',
    expectNonEmpty: [
      'styleTableEntries',
      'assets',
      'statesCssomPseudo',
      // statesProbed is gated exactly, below — a non-emptiness check here would
      // just restate the weaker half of it.
      'endpoints',
      'interactionCandidates',
      'a11yNodes',
      'blockedOffOriginNavigations',
    ],
    /*
     * Equality where the data allows it (§13). Non-emptiness could not see the
     * silent drop that shipped: `cssomText.includes(c)` treated a new class
     * `flag` as explained by the attribute name `data-flagged`, so the fixture's
     * Flag control produced no probed state and the count sat at 2 — non-zero,
     * and wrong. An exact count is brittle by design: change the fixture and
     * you must update the declaration, which is the point.
     */
    expectExactly: { statesProbed: 3 },
    // The crud app is single-origin by design; rung 2 owns the foreign-asset
    // measurement. Declared rather than omitted so the count is still printed.
    knownEmpty: ['foreignAssets', 'cancelledDownloads'],
  },
};

/** Assert a rung's expectations against a CoverageExtracted. Returns failures. */
export function checkRung(rung, extracted) {
  const spec = RUNGS[rung];
  if (!spec) throw new Error(`no such rung: ${rung}`);
  const failures = [];
  for (const key of spec.expectNonEmpty) {
    if (!(extracted[key] > 0)) failures.push({ key, expected: 'non-empty', actual: extracted[key] ?? 0 });
  }
  // A category declared known-empty that starts producing output is good news,
  // and the declaration should be updated -- so it is reported, not failed.
  for (const [key, want] of Object.entries(spec.expectExactly ?? {})) {
    if (extracted[key] !== want) {
      failures.push({ key, expected: `exactly ${want}`, actual: extracted[key] ?? 0 });
    }
  }
  const surprises = spec.knownEmpty.filter((key) => extracted[key] > 0);
  return { spec, failures, surprises };
}
