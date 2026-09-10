/**
 * Path normalisation — §5's "URL patterns, not URLs".
 *
 * Moved here from `packages/capture/scripts/infer-endpoints.mjs` when §7.6
 * landed (0041 §3.1). Capture normalises the URLs it observed; infer normalises
 * the URLs it *binds* out of a control's attributes. 0015 §2 matches an
 * inferred endpoint to a spec endpoint on path **shape**, so two normalisers
 * would compare two grammars, and the mismatch would surface as an
 * `endpoint-identity` miss with no visible cause — §13's duplicated-derived-
 * value drift, across a stage boundary where it is hardest to see.
 *
 * A `.mjs` script cannot be imported by a TypeScript package, which is the
 * mechanical reason it moved rather than being re-exported.
 */

/** Path segments that are clearly identifiers rather than route structure. */
const ID_SEGMENT = [
  /^[0-9]+$/,
  /^[a-z]{2,5}_[0-9a-z]+$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
];

/**
 * A version segment, which is not a collection.
 *
 * The naming rule below rests on a claim — *the segment before an identifier is
 * the resource that identifier identifies* — and `/api/v1/8` is a
 * counterexample: `v1` names no resource, so `:v1` would be a wrong name rather
 * than an unhelpful one. Excluding it makes the claim true instead of adding an
 * exception to it, which is the only kind of special case worth having here.
 */
const VERSION_SEGMENT = /^v\d+$/i;

const NOT_A_PLURAL_S = /(?:ss|us|is)$/i;

/**
 * A crude singular. `projects` → `project`, `entries` → `entry`.
 *
 * Deliberately not shared with infer's `entityNameFor`, which does the same
 * thing for a different consumer: §13's rule about a check and the thing it
 * checks sharing a code path applies here for a weaker but real reason — that
 * one names an entity and this one names a path parameter, and folding them
 * would make a rename in either a silent change to the other.
 */
const singular = (word: string): string =>
  word.endsWith('ies')
    ? `${word.slice(0, -3)}y`
    : word.endsWith('sses') || word.endsWith('ses')
      ? word.slice(0, -2)
      : // A trailing `s` is not always a plural: `status` → `statu` and
        // `analysis` → `analysi` are the shapes this stops. Crude on purpose —
        // the point is a readable name, and an over-stripped one is worse than
        // an unstripped one because it is not a word at all.
        word.endsWith('s') && !NOT_A_PLURAL_S.test(word)
        ? word.slice(0, -1)
        : word;

export interface PathParamObservation {
  readonly name: string;
  readonly value: string;
}

export interface NormalizedPath {
  readonly pattern: string;
  readonly params: readonly PathParamObservation[];
}

/**
 * `/api/todos/td_1` → `/api/todos/:todo`, with the observed value recorded.
 *
 * **Every hole used to be called `:id`,** which is not a name — it is a
 * placeholder, and `/projects/2/views/3/tasks` became
 * `/projects/:id/views/:id/tasks`, two parameters indistinguishable from each
 * other. That costs codegen a route it cannot generate (`params.id` twice) and
 * it costs any reader of the model the ability to say which hole is which.
 *
 * The name comes from the **collection segment that precedes the hole**,
 * singularised: the segment before an identifier is the resource the identifier
 * identifies. Where there is no such segment — a hole in first position, or one
 * preceded by another hole — it stays `id`, because there is nothing to name it
 * after and inventing one would be worse than the placeholder.
 *
 * **This is not an attempt to match a document.** Measured against Vikunja's
 * own OpenAPI document, which is internally inconsistent — `/projects/{id}`,
 * `/projects/{projectID}` and `/projects/{project}` all appear for the same
 * resource — the old `:id` was *right* 3 times in 5 and this rule is right
 * once. `path-param-naming` is ungated for exactly that reason (0015 §3:
 * "capture infers a name from observed values and has no way to know the spec
 * calls it `owner`"), and the score is expected to fall. §13's rule is no
 * fitting to the metric, not no fixing of defects the metric happened to
 * reveal, and the defect here is the collision rather than the disagreement.
 */
export function normalizePath(pathname: string): NormalizedPath {
  const params: PathParamObservation[] = [];
  const used = new Map<string, number>();
  const segments = pathname.split('/');
  const pattern = segments
    .map((seg, i) => {
      if (!seg || !ID_SEGMENT.some((re) => re.test(seg))) return seg;
      const previous = segments[i - 1];
      const namesAResource =
        previous !== undefined &&
        previous.length > 0 &&
        !VERSION_SEGMENT.test(previous) &&
        !ID_SEGMENT.some((re) => re.test(previous));
      const base = namesAResource
        ? singular(previous).replace(/[^A-Za-z0-9]/g, '') || 'id'
        : 'id';
      // Distinctness is the property being bought, so a repeated base gets a
      // positional suffix rather than colliding: `/items/1/items/2` has two
      // holes and they are not the same parameter.
      const seen = used.get(base) ?? 0;
      used.set(base, seen + 1);
      const name = seen === 0 ? base : `${base}${seen + 1}`;
      params.push({ name, value: seg });
      return `:${name}`;
    })
    .join('/');
  return { pattern, params };
}
