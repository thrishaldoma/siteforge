/**
 * Aligning an inferred endpoint with a spec endpoint (0015 §2).
 *
 * Before anything is scored the two sides have to be lined up, and the
 * alignment is where a grader quietly becomes generous. Three rules carry it:
 *
 *   - match on **(method, positional path shape)**, parsed by segment. A prefix
 *     or substring test here would match `/api/v1/repos-archive` against
 *     `/api/v1/repos`, which is this repo's most expensive bug family and now
 *     its fifth grammar;
 *   - **parameter names are scored, not matched on.** Capture infers a name from
 *     observed values and cannot know the spec calls it `owner`. Folding naming
 *     into identity makes every endpoint a miss for a cosmetic reason and hides
 *     the real ones behind the noise;
 *   - matching is **one-to-one**. Two candidates on either side is a *matching
 *     ambiguity*: reported as its own count, scored as a miss on both sides,
 *     never resolved by picking the better-scoring pair.
 */
import type { ApiOperation } from '@siteforge/schema';
import { isSegmentPrefix } from '@siteforge/shared';
import { pathShape, type TruthEndpoint, type TruthModel } from './truth/swagger2.js';

/** An endpoint capture saw on the wire. The recall denominator, frozen as data. */
export interface ObservedEndpoint {
  readonly method: string;
  /** The URL pattern, as capture records it: `/api/v1/repos/:owner/:repo`. */
  readonly pathPattern: string;
}

export interface MatchedPair {
  readonly operation: ApiOperation;
  readonly truth: TruthEndpoint;
}

export interface Matching {
  readonly pairs: readonly MatchedPair[];
  /** In-universe model operations with no spec counterpart. Hallucinations, or crawl-only paths. */
  readonly unmatchedOperations: readonly ApiOperation[];
  /** Model operations outside `/api/v1/` — counted, never scored. */
  readonly outOfUniverse: readonly ApiOperation[];
  /** Keys where either side offered more than one candidate. */
  readonly ambiguous: readonly string[];
  /** Model operations whose literal segments match a spec endpoint of another arity. */
  readonly arityMismatches: readonly MatchedPair[];
  /** In-universe observed endpoints, and how many of them the model emitted. */
  readonly observedInUniverse: number;
  readonly observedEmitted: number;
  /** Spec operations in the universe — the crawl-coverage denominator. */
  readonly truthInUniverse: number;
}

const segments = (path: string): string[] => path.split('/').filter((s) => s.length > 0);

/**
 * Is this path inside the graded universe?
 *
 * By segment, never by prefix: `startsWith('/api/v1')` also accepts
 * `/api/v1beta/…`, which is the same mistake in the same grammar the shape
 * comparison above avoids. §13's identifier rule.
 */
export function inUniverse(path: string, basePath: string): boolean {
  // The shared predicate, which throws on an empty prefix. This function is
  // where the empty-admits family was found: `basePath: '/'` gave an empty
  // segment list, `[].every(…)` returned true, and the universe filter admitted
  // every path in existence — including an entire admin SPA (0019). §13 now
  // forbids a root universe at selection time; this makes it loud rather than
  // silent if one arrives anyway.
  return isSegmentPrefix(segments(basePath), segments(path));
}

/**
 * The literal segments, with every parameter hole dropped.
 *
 * `api/v1/repos/*​/*​/labels` and `api/v1/repos/*​/labels` share this, and that
 * is the point: it is what "the crawler found the right resource and got the
 * parameter count wrong" looks like. Used **only** to give `path-param-arity` a
 * denominator, because matching on the shape already folds arity into identity
 * and would leave the category reporting a perfect score it could never lose.
 */
const literalSkeleton = (shape: string): string =>
  shape
    .split('/')
    .filter((s) => s !== '*')
    .join('/');

const key = (method: string, shape: string): string => `${method.toUpperCase()} ${shape}`;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = keyOf(item);
    const list = out.get(k);
    if (list === undefined) out.set(k, [item]);
    else list.push(item);
  }
  return out;
}

/**
 * Line the two sides up. Pure: every input is a parameter, including the
 * observed set, which is committed data rather than something recomputed from
 * the model. Recomputing it would move both sides of a delete-an-endpoint
 * mutation and the recall delta would read zero.
 */
export function matchEndpoints(
  operations: readonly ApiOperation[],
  truth: TruthModel,
  observed: readonly ObservedEndpoint[],
): Matching {
  const outOfUniverse = operations.filter((o) => !inUniverse(o.pathPattern, truth.basePath));
  const inside = operations.filter((o) => inUniverse(o.pathPattern, truth.basePath));

  const truthInside = truth.endpoints.filter((e) => inUniverse(e.fullPath, truth.basePath));
  const truthByKey = groupBy(truthInside, (e) => key(e.method, e.shape));
  const modelByKey = groupBy(inside, (o) => key(o.method, pathShape(o.pathPattern)));

  const pairs: MatchedPair[] = [];
  const unmatchedOperations: ApiOperation[] = [];
  const ambiguous: string[] = [];

  for (const [k, candidates] of modelByKey) {
    const specs = truthByKey.get(k) ?? [];
    if (candidates.length > 1 || specs.length > 1) {
      // Never resolved by picking the better-scoring pair: that is the grader
      // grading itself. Both sides count as misses and the count is reported.
      ambiguous.push(k);
      unmatchedOperations.push(...candidates);
      continue;
    }
    const spec = specs[0];
    if (spec === undefined) unmatchedOperations.push(candidates[0]!);
    else pairs.push({ operation: candidates[0]!, truth: spec });
  }

  // Arity, over endpoints that agree on their literal segments. Only a *unique*
  // skeleton counterpart counts: `repos/*/*/labels` also shares a skeleton with
  // `repos/*/*/labels/*`, and inventing an arity error out of that ambiguity
  // would move a miss from one category into another for no reason.
  const matchedSpecs = new Set(pairs.map((p) => `${p.truth.method} ${p.truth.shape}`));
  const truthBySkeleton = groupBy(
    truthInside.filter((e) => !matchedSpecs.has(`${e.method} ${e.shape}`)),
    (e) => key(e.method, literalSkeleton(e.shape)),
  );
  const arityMismatches: MatchedPair[] = [];
  for (const operation of unmatchedOperations) {
    const candidates = truthBySkeleton.get(
      key(operation.method, literalSkeleton(pathShape(operation.pathPattern))),
    );
    if (candidates?.length === 1) arityMismatches.push({ operation, truth: candidates[0]! });
  }

  const emitted = new Set(inside.map((o) => key(o.method, pathShape(o.pathPattern))));
  const observedInside = observed.filter((o) => inUniverse(o.pathPattern, truth.basePath));

  return {
    pairs,
    unmatchedOperations,
    outOfUniverse,
    ambiguous,
    arityMismatches,
    observedInUniverse: observedInside.length,
    observedEmitted: observedInside.filter((o) => emitted.has(key(o.method, pathShape(o.pathPattern))))
      .length,
    truthInUniverse: truthInside.length,
  };
}
