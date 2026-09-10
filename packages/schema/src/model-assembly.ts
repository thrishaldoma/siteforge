/**
 * SiteModel parts the capture fills and infer assembles as `[]`.
 *
 * The sweep that followed `GAPS.md`. That defect was §13's **third vacuity
 * cause at the top level** — the producer runs, the consumer was never
 * written, the artifact is full and the output is empty — and the ruling asked
 * whether other deliverables named in the spec have the same shape.
 *
 * Three do, and all three are a hardcoded empty array in infer's model
 * assembly:
 *
 * | part | the capture holds | the model carries |
 * |---|---|---|
 * | `fonts` | 70 `@font-face` descriptors, 2 families | 0 |
 * | `assets` | 46 entries, 2.79 MB content-addressed | 0 |
 * | `behaviours` | 122 flow traces | 0 |
 *
 * ### Why a literal `[]` is worse than an unimplemented stage
 *
 * §13's table has four causes for an empty category and only the fourth —
 * *declined on evidence* — means nothing is missing. **An empty array is how
 * all four spell themselves.** So `assets: []` reads exactly like the enum
 * ladder correctly declining, and the next reader has no way to tell that 46
 * captured assets are being dropped on the floor. That is the fail-open
 * direction, and it is why these are declared with the *input count* beside
 * them rather than left as a `TODO`: the declaration is falsifiable, a comment
 * is not.
 *
 * A `[]` where nothing was captured is a different claim and belongs in a
 * different row, so declaring one here where the input is empty **fails** —
 * filing a target or driver limitation under this cause sends the next reader
 * to a package with nothing wrong in it (§13).
 *
 * ### The transition is the gate, same as the deferrals
 *
 * A part declared here that starts assembling must fail until the declaration
 * is removed. Otherwise the record rots in the direction that reads clean: the
 * work gets done and the file still says it did not.
 */

/** Parts of `SiteModel` this table can speak about. */
export type ModelPartId = 'fonts' | 'assets' | 'behaviours' | 'components' | 'entities' | 'operations';

export interface ModelAssemblyGap {
  readonly part: ModelPartId;
  /** The capture-side count this is measured against, by name. */
  readonly input: string;
  /** The section that requires the assembly. */
  readonly spec: string;
  readonly reason: string;
}

/**
 * Declared as of the sweep. Each row is a measured hole, not a suspicion.
 *
 * `components` is deliberately **not** here. `inferComponents` runs and
 * returns nothing on this target, which is a producer applying its rule — a
 * different cause, and the one where nothing may be missing at all. Putting it
 * in this table would claim work is undone that may not be.
 */
export const MODEL_ASSEMBLY_GAPS: readonly ModelAssemblyGap[] = [
  {
    part: 'fonts',
    input: 'fonts',
    spec: '§7 emits a font set; §8 substitutes a metric-compatible open face for a licensed one and records the swap in GAPS.md',
    reason:
      'capture extracts every @font-face from the CSSOM and writes the descriptors into routes/*/styles.json, and the model assembly is the literal `fonts: []`. Nothing downstream can substitute a font it was never told about, so §8’s licensed-webfont handling has no input.',
  },
  {
    part: 'assets',
    input: 'assets',
    spec: '§8 copies raster assets into public/ under their content hash and inlines SVGs as components',
    reason:
      'assets/index.json maps originalUrl to a content-addressed local path with sha256, mime and referencedBy, and the model assembly is the literal `assets: []`. The bodies are on disk and unreferenced by anything that would emit them.',
  },
  {
    part: 'behaviours',
    input: 'flows',
    spec: '§7.7 converts flows/ transitions into declarative {trigger, precondition, effect} specs',
    reason:
      'the probe pass writes a trace per fired control and the model assembly is the literal `behaviours: []`. §6 calls that tuple set “the functional specification”, and §9’s behavioural gate replays it — so this is the input to the gate that decides whether the clone behaves like the target.',
  },
];

export type ModelAssemblyProblem =
  /** The capture filled an input and the model part is empty, undeclared. */
  | 'undeclared-empty'
  /** A declared gap now assembles. Remove the row. */
  | 'declared-but-assembled'
  /** Declared here while the capture input is empty — the wrong cause. */
  | 'declared-without-input';

export interface ModelAssemblyFinding {
  readonly part: ModelPartId;
  readonly problem: ModelAssemblyProblem;
  readonly detail: string;
}

/**
 * Both sides as parameters (§13), so a test can drive every verdict without a
 * crawl: `inputs` is what capture produced, `parts` is what the model carries.
 */
export function assessModelAssembly(input: {
  readonly declared: readonly ModelAssemblyGap[];
  readonly inputs: Readonly<Record<string, number>>;
  readonly parts: Readonly<Record<string, number>>;
}): ModelAssemblyFinding[] {
  const findings: ModelAssemblyFinding[] = [];
  const declaredBy = new Map(input.declared.map((g) => [g.part, g]));

  for (const gap of input.declared) {
    const held = input.parts[gap.part] ?? 0;
    if (held > 0) {
      findings.push({
        part: gap.part,
        problem: 'declared-but-assembled',
        detail:
          `declared as never assembled and the model now carries ${held}. The work landed and ` +
          'the record did not move — remove the row.',
      });
      continue;
    }
    const available = input.inputs[gap.input] ?? 0;
    if (available === 0) {
      findings.push({
        part: gap.part,
        problem: 'declared-without-input',
        detail:
          `declared against capture input '${gap.input}', which is 0. An empty output with an ` +
          'empty input is a target or driver limitation, not an unassembled artifact, and filing ' +
          'it here sends the next reader to the wrong package (§13).',
      });
    }
  }

  /**
   * The direction that finds the next one. Walks the *capture* side, so a part
   * nobody declared is caught by its input being full rather than by anyone
   * remembering the part exists.
   */
  for (const [part, held] of Object.entries(input.parts)) {
    if (held > 0 || declaredBy.has(part as ModelPartId)) continue;
    const available = input.inputs[part] ?? 0;
    if (available > 0) {
      findings.push({
        part: part as ModelPartId,
        problem: 'undeclared-empty',
        detail:
          `the capture holds ${available} and the model carries 0, with no declaration. An empty ` +
          'array is how all four vacuity causes spell themselves, so this must be declared or ' +
          'assembled rather than left to read as a correct decline.',
      });
    }
  }
  return findings;
}
