/**
 * Every `SiteModel` collection declares its producer and its input.
 *
 * The sweep that followed `GAPS.md` found three collections the capture fills
 * and infer assembles as a hardcoded `[]`:
 *
 * | part | the capture holds | the model carries |
 * |---|---|---|
 * | `fonts` | 70 `@font-face` descriptors, 2 families | 0 |
 * | `assets` | 46 entries, 2.79 MB content-addressed | 0 |
 * | `behaviours` | 113 fired controls, 122 traces | 0 |
 *
 * ### Why a literal `[]` is worse than an unimplemented stage
 *
 * §13's table has four causes for an empty category and only the fourth —
 * *declined on evidence* — means nothing is missing. **An empty array is how
 * all four spell themselves.** So `assets: []` reads exactly like the enum
 * ladder correctly declining, and nothing distinguishes them without the
 * input count beside it. That is the fail-open direction, which is why each
 * declaration carries the capture-side count it is measured against: a
 * declaration is falsifiable, a `TODO` is not.
 *
 * ### Structural, so the next collection inherits it
 *
 * The first version of this was three declared rows, which fixes three
 * collections and nothing else — a collection added to `SiteModel` tomorrow
 * would arrive undeclared and unexamined, which is exactly how these three
 * arrived. So the gate is driven from **the schema's own list of
 * collections**: every array-valued member of `SiteModel` must have a
 * declaration, and one that does not fails. `collectionsOf` reads the schema
 * rather than a hand-typed list, per §13's rule that a freeze derives its
 * members from the definition instead of enumerating them.
 *
 * Three further refusals, each a way a declaration could go quietly wrong:
 *
 * - a declared gap whose **input is also empty** fails. An empty output with
 *   an empty input is a target or driver limitation, and filing it here
 *   sends the next reader to a package with nothing wrong in it (§13).
 * - a declared gap that **starts assembling** fails until the row is
 *   corrected. The work lands, the record does not move, and the file goes
 *   on claiming a hole that was filled — the deferral table's transition, in
 *   a second place.
 * - a collection with **no input counter at all** must say so. `components`
 *   is the case: `inferComponents` runs and returns nothing on this target,
 *   and `coverage.json` has no counter for repeated DOM subtrees. The first
 *   wiring handed it `interactionCandidates` (2085) and the gate immediately
 *   reported a producer that runs as an artifact nobody assembles. An
 *   unmeasured input is declared as unmeasured, never guessed at.
 *
 * ### The scope exclusion is in the gate, not in prose
 *
 * A stage nobody built is not a producer without a consumer. `codegen`,
 * `envkit` and `cli` are three-line scaffolds, so `tokens.json`,
 * `verify/history.jsonl` and the control plane are stages that do not exist
 * rather than instances of this defect. `SCAFFOLD_STAGES` says so in code, a
 * declaration naming one is exempt from the empty check, and a scaffold
 * stage that turns out to be producing something fails — because then it is
 * not a scaffold any more and the exemption is stale.
 */

/** Stages a collection can be produced by. */
export type ProducerStage = 'capture' | 'infer' | 'codegen' | 'envkit' | 'cli';

/**
 * Stages that are scaffolds today: three lines and an `export {}`.
 *
 * Exempt from the empty check, and the exemption is checked rather than
 * trusted — see `scaffold-is-producing` below.
 */
export const SCAFFOLD_STAGES: readonly ProducerStage[] = ['codegen', 'envkit', 'cli'];

export interface ModelCollectionDeclaration {
  /** A top-level array-valued member of `SiteModel`. */
  readonly part: string;
  /** The function that fills it, named so a reader can go and look. */
  readonly producer: string;
  readonly stage: ProducerStage;
  /**
   * The `coverage.json` counter this collection's emptiness is judged
   * against, or `null` where no counter measures its input.
   *
   * `null` is a declaration, not an omission: it says the gate is blind here
   * and why, rather than letting a guessed counter make a working producer
   * look like an unassembled artifact.
   */
  readonly input: string | null;
  /** Whether it emits anything today. */
  readonly assembles: boolean;
  /** Required whenever `assembles` is false, or `input` is null. */
  readonly reason?: string;
}

export const MODEL_COLLECTIONS: readonly ModelCollectionDeclaration[] = [
  {
    part: 'fonts',
    producer: 'nothing — the model assembly is the literal `fonts: []`',
    stage: 'infer',
    input: 'fonts',
    assembles: false,
    reason:
      'capture extracts every @font-face from the CSSOM into routes/*/styles.json and infer assembles a literal []. §8 substitutes a metric-compatible open face for a licensed one and records the swap in GAPS.md — it cannot substitute a font it was never told about.',
  },
  {
    part: 'assets',
    producer: 'nothing — the model assembly is the literal `assets: []`',
    stage: 'infer',
    input: 'assets',
    assembles: false,
    reason:
      'assets/index.json maps originalUrl to a content-addressed local path with sha256, mime and referencedBy, and infer assembles a literal []. The bodies are on disk and nothing that would emit them references them.',
  },
  {
    part: 'behaviours',
    producer: 'nothing — the model assembly is the literal `behaviours: []`',
    stage: 'infer',
    input: 'flows',
    assembles: false,
    reason:
      '§7.7 converts flows/ transitions into declarative {trigger, precondition, effect} specs and infer assembles a literal []. §6 calls that tuple set "the functional specification" and §9 replays it, so this is the input to the gate that decides whether the clone behaves like the target.',
  },
  {
    part: 'components',
    producer: 'inferComponents',
    stage: 'infer',
    input: null,
    assembles: false,
    reason:
      'the producer RUNS and returns nothing on this target, which is a rule applying rather than work undone — §13\'s fourth cause, where nothing may be missing. coverage.json has no counter for repeated DOM subtrees, so the gate is blind to whether that decline is correct, and says so rather than guessing: the first wiring handed it interactionCandidates (2085) and reported a working producer as an unassembled artifact.',
  },
  { part: 'layouts', producer: 'inferLayout', stage: 'infer', input: null, assembles: true,
    reason: 'assembles; no coverage counter measures "layouts a capture implies", and one is not needed while it is non-empty.' },
  { part: 'routes', producer: 'routeTemplates', stage: 'infer', input: 'endpoints', assembles: true },
  { part: 'entities', producer: 'inferEntities', stage: 'infer', input: 'endpoints', assembles: true },
  { part: 'operations', producer: 'observedOperations + bindSkippedControls', stage: 'infer', input: 'endpoints', assembles: true },
];

export type ModelAssemblyProblem =
  /** A `SiteModel` collection with no declaration. The structural half. */
  | 'undeclared-collection'
  /** A declaration for a part the schema does not have. */
  | 'stale-declaration'
  /** Declared as never assembled, and the model carries entries. */
  | 'declared-but-assembles'
  /** Declared as assembling, and the model is empty while its input is not. */
  | 'assembles-but-empty'
  /** Declared here while the capture input is empty — the wrong cause. */
  | 'declared-without-input'
  /** `assembles: false` or `input: null` without a reason. */
  | 'undeclared-reason'
  /** A stage declared a scaffold is producing something. */
  | 'scaffold-is-producing';

export interface ModelAssemblyFinding {
  readonly part: string;
  readonly problem: ModelAssemblyProblem;
  readonly detail: string;
}

/**
 * Every array-valued top-level member of a `SiteModel` shape.
 *
 * Read off the schema so a collection added tomorrow is covered the day it
 * lands rather than the day somebody remembers (§13).
 */
export function collectionsOf(schema: unknown): string[] {
  const def = (schema as { def?: { shape?: unknown } } | undefined)?.def;
  const raw = def?.shape;
  const shape = (typeof raw === 'function' ? (raw as () => unknown)() : raw) as
    | Record<string, { def?: { type?: string } }>
    | undefined;
  if (shape === undefined) {
    throw new Error(
      'could not read the SiteModel shape. A gate that silently reads no collections ' +
      'reports exactly what it reports when every collection is declared (§13).',
    );
  }
  return Object.entries(shape)
    .filter(([, member]) => member.def?.type === 'array')
    .map(([name]) => name);
}

/**
 * Both sides as parameters (§13), so every verdict can be driven without a
 * crawl: `inputs` is what capture produced, `parts` is what the model carries,
 * `collections` is what the schema defines.
 */
export function assessModelAssembly(input: {
  readonly declared: readonly ModelCollectionDeclaration[];
  readonly collections: readonly string[];
  readonly inputs: Readonly<Record<string, number>>;
  readonly parts: Readonly<Record<string, number>>;
}): ModelAssemblyFinding[] {
  const findings: ModelAssemblyFinding[] = [];
  const byPart = new Map(input.declared.map((d) => [d.part, d]));

  // The structural half: the schema decides what must be declared.
  for (const part of input.collections) {
    if (byPart.has(part)) continue;
    findings.push({
      part,
      problem: 'undeclared-collection',
      detail:
        'SiteModel defines this collection and nothing declares its producer or its input. ' +
        'An empty array is how all four vacuity causes spell themselves, so a collection ' +
        'nobody has described cannot be told from one correctly declining.',
    });
  }

  const known = new Set(input.collections);
  for (const d of input.declared) {
    if (!known.has(d.part)) {
      findings.push({
        part: d.part,
        problem: 'stale-declaration',
        detail: 'declared here and absent from SiteModel — the collection was renamed or removed.',
      });
      continue;
    }

    const held = input.parts[d.part] ?? 0;
    const scaffold = SCAFFOLD_STAGES.includes(d.stage);

    if (scaffold) {
      // The exemption, checked rather than trusted: a scaffold that produces
      // something is not a scaffold, and the exemption is then stale.
      if (held > 0) {
        findings.push({
          part: d.part,
          problem: 'scaffold-is-producing',
          detail:
            `declared as produced by '${d.stage}', which is exempt from the empty check for ` +
            `being a scaffold, and the model carries ${held}. The stage exists now; remove the exemption.`,
        });
      }
      continue;
    }

    if ((!d.assembles || d.input === null) && (d.reason ?? '').length < 40) {
      findings.push({
        part: d.part,
        problem: 'undeclared-reason',
        detail:
          'a collection that does not assemble, or whose input nothing counts, must say why. ' +
          'Without it the row records the symptom and not the cause.',
      });
    }

    if (!d.assembles && held > 0) {
      findings.push({
        part: d.part,
        problem: 'declared-but-assembles',
        detail:
          `declared as never assembled and the model now carries ${held}. The work landed and ` +
          'the record did not move — correct the row.',
      });
      continue;
    }

    // `input: null` is a declared blind spot: there is no counter to judge
    // emptiness against, so neither direction below can be evaluated.
    if (d.input === null) continue;
    const available = input.inputs[d.input] ?? 0;

    if (!d.assembles && available === 0) {
      findings.push({
        part: d.part,
        problem: 'declared-without-input',
        detail:
          `declared against capture input '${d.input}', which is 0. An empty output with an ` +
          'empty input is a target or driver limitation, not an unassembled artifact, and ' +
          'filing it here sends the next reader to the wrong package (§13).',
      });
    }

    if (d.assembles && held === 0 && available > 0) {
      findings.push({
        part: d.part,
        problem: 'assembles-but-empty',
        detail:
          `declared as assembling and the model carries 0 while '${d.input}' holds ${available}. ` +
          'Either the producer stopped producing or the declaration is out of date.',
      });
    }
  }
  return findings;
}
