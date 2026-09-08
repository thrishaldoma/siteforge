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
    knownEmpty: ['statesCssomPseudo', 'statesCssomAttribute', 'statesProbed', 'endpoints', 'fonts'],
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
      'statesProbed',
      'endpoints',
      'interactionCandidates',
      'a11yNodes',
    ],
    knownEmpty: [],
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
  const surprises = spec.knownEmpty.filter((key) => extracted[key] > 0);
  return { spec, failures, surprises };
}
