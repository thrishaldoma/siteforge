/**
 * The observed side of `selects-imply-option-set-controls`, counted from the
 * captured DOM tree.
 *
 * §13 requires an invariant's observed side to be derived independently of the
 * extraction it checks, and this invariant needs that more than most: **the bug
 * was in the selector itself.** `select[name], select[id]` matched none of six
 * `<select>` elements on a Vue SPA, because a component that binds through
 * `v-model` has no reason to emit either attribute. An observed side that asked
 * the page the same question would have returned zero as well, and the check
 * would have read green over a page holding six.
 *
 * So this walks `dom.json` — a tree built by a different traversal for a
 * different purpose — and counts by tag. Deliberately cruder than the
 * extractor: it does not look at options, values, or whether anything could be
 * bound. Over-counting is safe against a `>=`, and here the comparison is an
 * equality precisely because both sides are counting the same simple thing.
 */

/** The subset of a captured DOM node this counter reads. */
export interface OptionSetDomNode {
  readonly nodeType: string;
  readonly tag?: string | undefined;
  readonly attributes?: Readonly<Record<string, string>> | undefined;
  readonly children?: readonly OptionSetDomNode[] | undefined;
}

export interface OptionSetCounts {
  /** `<select>` elements, however they are spelled. */
  readonly selects: number;
  /**
   * Distinct `name` values among `input[type=radio]`.
   *
   * By name because HTML groups radios by name — several inputs sharing one is
   * *one* control. Counting the inputs would compare a control count against an
   * element count and the equality would fail on every correct run.
   */
  readonly radioGroups: number;
}

/** Count the option-set controls a captured DOM tree holds. */
export function countOptionSetsInDom(root: OptionSetDomNode | null): OptionSetCounts {
  let selects = 0;
  const radioNames = new Set<string>();
  const walk = (node: OptionSetDomNode): void => {
    if (node.nodeType === 'element') {
      if (node.tag === 'select') selects += 1;
      if (node.tag === 'input' && node.attributes?.['type'] === 'radio') {
        const name = node.attributes?.['name'];
        // A radio with no name is not a member of a group at all, so it is not
        // an option-set control and must not be counted as one. Unlike a
        // `<select>`, where the attribute was never load-bearing.
        if (name !== undefined && name !== '') radioNames.add(name);
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (root !== null) walk(root);
  return { selects, radioGroups: radioNames.size };
}

/**
 * The observed side of `scalar-values-imply-recorded-examples`.
 *
 * `examples` was recorded only inside `inferSchema`'s `string` branch, so every
 * integer, number and boolean in the capture lost its observed values — 0 of 68
 * numeric nodes carried one, against 273 of 324 string nodes. §8 seeds the mock
 * store from captured responses, so that is a hole in the seed data, not a
 * grading artefact.
 *
 * **Counted by JSON kind, not by node.** The two sides count different
 * populations — raw values in bodies against nodes in a schema — so an equality
 * over either is not available: deduplication, the depth cap and array folding
 * all legitimately separate them. Kind is the granularity where they *are*
 * comparable, and it is granular enough to do the job §13 asks of it: with
 * booleans surviving and integers dropped, a single total would still hold,
 * and this does not.
 *
 * The walk is deliberately cruder than `inferSchema` — no dedup, no identity,
 * no depth limit — because it must not share a code path with the thing it
 * checks.
 */
export type ScalarKind = 'integer' | 'number' | 'boolean';

/** Which scalar kinds appear as leaves anywhere in these parsed bodies. */
export function scalarKindsInBodies(bodies: readonly unknown[]): Set<ScalarKind> {
  const kinds = new Set<ScalarKind>();
  const walk = (value: unknown): void => {
    if (typeof value === 'boolean') kinds.add('boolean');
    else if (typeof value === 'number') kinds.add(Number.isInteger(value) ? 'integer' : 'number');
    else if (Array.isArray(value)) for (const v of value) walk(v);
    else if (typeof value === 'object' && value !== null) {
      for (const v of Object.values(value)) walk(v);
    }
  };
  for (const body of bodies) walk(body);
  return kinds;
}

/** The subset of a schema node this counter reads. */
export interface ExampleBearingNode {
  readonly type?: unknown;
  readonly examples?: readonly unknown[] | undefined;
  readonly properties?: Readonly<Record<string, ExampleBearingNode>> | undefined;
  readonly items?: ExampleBearingNode | undefined;
}

/** Which scalar kinds have at least one schema node carrying observed values. */
export function scalarKindsWithExamples(roots: readonly (ExampleBearingNode | null | undefined)[]): Set<ScalarKind> {
  const kinds = new Set<ScalarKind>();
  const walk = (node: ExampleBearingNode | null | undefined): void => {
    if (node === null || node === undefined) return;
    const types = Array.isArray(node.type) ? node.type : [node.type];
    if (node.examples !== undefined && node.examples.length > 0) {
      for (const t of types) {
        if (t === 'integer' || t === 'number' || t === 'boolean') kinds.add(t);
      }
    }
    for (const child of Object.values(node.properties ?? {})) walk(child);
    walk(node.items);
  };
  for (const r of roots) walk(r);
  return kinds;
}
