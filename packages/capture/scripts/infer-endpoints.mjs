import { deriveEndpointId } from '../../schema/dist/index.js';
import { classifyStringField, dedupeByIdentity } from '../../shared/dist/index.js';

/**
 * §5: "Response schemas, not just responses. For each endpoint, infer a JSON
 * Schema across all observed responses. That schema becomes the mock backend's
 * data model."
 *
 * This is the path codegen leans on hardest (§8 seeds the store from it), and it
 * is the one that ran on hand-written fixtures until rung 3.
 */

/** Path segments that are clearly identifiers rather than route structure. */
const ID_SEGMENT = [
  /^[0-9]+$/,
  /^[a-z]{2,5}_[0-9a-z]+$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{16,}$/i,
];

/**
 * A crude singular. `projects` → `project`, `entries` → `entry`.
 *
 * Deliberately not shared with infer's `entityNameFor`, which does the same
 * thing for a different consumer: §13's rule about a check and the thing it
 * checks sharing a code path applies here for a weaker but real reason — this
 * runs in capture and that runs in infer, and a stage boundary is where a
 * shared helper becomes an undeclared coupling between two artifacts.
 */
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

const singular = (word) =>
  word.endsWith('ies')
    ? `${word.slice(0, -3)}y`
    : word.endsWith('sses') || word.endsWith('ses')
      ? word.slice(0, -2)
      // A trailing `s` is not always a plural: `status` → `statu` and
      // `analysis` → `analysi` are the shapes this stops. Crude on purpose —
      // the point is a readable name, and an over-stripped one is worse than an
      // unstripped one because it is not a word at all.
      : word.endsWith('s') && !NOT_A_PLURAL_S.test(word)
        ? word.slice(0, -1)
        : word;

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
export function normalizePath(pathname) {
  const params = [];
  const used = new Map();
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

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v === 'object' ? 'object' : typeof v;
};

/* ------------------------------------------------ the narrowing contract (§7) */

/**
 * The rules themselves live in `@siteforge/shared`, not here.
 *
 * §5 puts response schemas in the capture tree, so inference runs at capture
 * today — but §7.4 derives the data model from these same schemas, and `infer`
 * will want exactly this logic when it exists. Two implementations of "is this
 * field an enum" would drift and then disagree about the same field, which is
 * §13's schema drift wearing a different hat. One implementation, imported by
 * both stages; see `shared/src/narrowing.ts` for why each rule is what it is.
 */

/**
 * Infer a JSON Schema over a set of observed values.
 *
 * `required` is the intersection of keys across observations, not the union: a
 * field absent from one response is not required, and guessing otherwise would
 * have codegen emit a store the real API can contradict.
 *
 * `ctx` carries `{key, recordCount, uiConstraints, pathParamValues, mintGap}`.
 */
export function inferSchema(values, ctx = {}) {
  const { key, recordCount } = ctx;
  const present = values.filter((v) => v !== undefined);
  if (present.length === 0) return null;

  const nullable = present.some((v) => v === null);
  const nonNull = present.filter((v) => v !== null);
  if (nonNull.length === 0) return { type: 'null' };

  const kinds = [...new Set(nonNull.map(typeOf))];
  // integer and number describe the same field observed twice.
  const merged = kinds.includes('number') ? kinds.filter((k) => k !== 'integer') : kinds;

  if (merged.length > 1) {
    return {
      anyOf: merged.map((k) => inferSchema(nonNull.filter((v) => typeOf(v) === k), ctx)).filter(Boolean),
      type: merged[0],
      ...(nullable ? { nullable: true } : {}),
    };
  }

  const kind = merged[0];
  if (kind === 'object') {
    // The deduplication that makes every frequency heuristic below honest.
    const records = dedupeByIdentity(nonNull);
    const keys = [...new Set(records.flatMap((v) => Object.keys(v)))].sort();
    const properties = {};
    for (const field of keys) {
      const sub = inferSchema(records.map((v) => v[field]), {
        ...ctx, key: field, recordCount: records.length,
      });
      if (sub) properties[field] = sub;
    }
    // empty: no records means no keys either, so this filter runs over nothing
    const required = keys.filter((k) => records.every((v) => v[k] !== undefined));
    return {
      type: 'object', properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
      ...(nullable ? { nullable: true } : {}),
    };
  }
  if (kind === 'array') {
    const items = inferSchema(dedupeByIdentity(nonNull.flat()), ctx);
    return { type: 'array', ...(items ? { items } : {}), ...(nullable ? { nullable: true } : {}) };
  }
  if (kind === 'string') {
    const distinct = [...new Set(nonNull)].sort();
    // empty: `nonNull` is non-empty — an all-null field returned `{type:'null'}` above
    if (nonNull.every((v) => /^\d{4}-\d{2}-\d{2}T/.test(v))) {
      // A format annotates a shape without closing a domain, and is claimed only
      // when every observation matched — so it records its evidence but needs no
      // review gap.
      return {
        type: 'string',
        format: 'date-time',
        narrowing: { kind: 'format', format: 'date-time', matched: nonNull.length, total: nonNull.length },
        ...(nullable ? { nullable: true } : {}),
      };
    }
    const { enumValues, narrowing, identifier } = classifyStringField({
      key,
      distinct,
      recordCount: recordCount ?? dedupeByIdentity(nonNull).length,
      uiConstraints: ctx.uiConstraints,
      pathParamValues: ctx.pathParamValues,
      mintGap: ctx.mintGap,
    });
    return {
      type: 'string',
      ...(enumValues ? { enum: enumValues, narrowing } : {}),
      ...(identifier ? { identifier } : {}),
      // Not narrowed: still record what was seen. `examples` carries the same
      // information for seeding (§8) and for review, without constraining the
      // store to it.
      ...(!enumValues ? { examples: distinct.slice(0, 5) } : {}),
      ...(nullable ? { nullable: true } : {}),
    };
  }
  return { type: kind, ...(nullable ? { nullable: true } : {}) };
}

/**
 * Slug for an endpoint id.
 *
 * Re-exported from the schema rather than reimplemented: the schema recomputes
 * this field and rejects a mismatch (decision 0011), so a second copy here would
 * either be dead weight or a way to emit ids that do not parse.
 */
export const endpointId = deriveEndpointId;

/**
 * The verdict a set of observations supports. Mirrors the schema's
 * `resolveAuthRequirement`, which re-derives it and rejects a disagreement.
 */
const resolveAuth = (evidence) => {
  if (evidence.some((e) => e.kind === 'unauthorized-status' || e.kind === 'anonymous-redirect-to-login')) {
    return 'required';
  }
  if (evidence.some((e) => e.kind === 'anonymous-success')) return 'not-required';
  return 'unknown';
};

/**
 * Turn observed HTTP exchanges into `EndpointDescriptor`s.
 *
 * `observations` are `{method, url, status, contentType, body, routeId, requestBody,
 * requestHeaders, contextId}`.
 */
export function inferEndpoints(observations, { scrub, sha256, uiConstraints, mintGap, anonContextId = 'anon-desktop' }) {
  const groups = new Map();
  for (const obs of observations) {
    const url = new URL(obs.url);
    const { pattern, params } = normalizePath(url.pathname);
    const key = `${obs.method} ${pattern}`;
    if (!groups.has(key)) {
      groups.set(key, {
        method: obs.method, pattern, origin: url.origin,
        // One Set per positional hole, never one flat list. A pattern with two
        // holes has two parameters, and a value seen in the second is not an
        // example of the first — `/projects/:id/views/:id/tasks` is where the
        // flat version was found, by a schema cross-check, on the first real
        // site with a nested resource. Neither the rung-3 fixture nor the
        // hand-written Gitea baseline has one, so it had never come up.
        pathParams: [], query: new Map(), headers: new Map(),
        byStatus: new Map(), requestBodies: [], routeIds: new Set(),
        anonRefused: 0, anonSucceeded: 0,
        authenticatedObservations: 0, unauthenticatedObservations: 0,
      });
    }
    const g = groups.get(key);
    params.forEach((param, i) => {
      g.pathParams[i] ??= { name: param.name, values: new Set() };
      g.pathParams[i].values.add(param.value);
    });
    for (const [name, value] of url.searchParams) {
      // A trailing `&` or a bare `=` yields an empty name. It is not a
      // parameter, and the schema rejects one; dropping it here keeps the
      // difference between "no query string" and "a nameless field" out of the
      // artifact rather than out of the reader's way.
      if (name.length === 0) continue;
      if (!g.query.has(name)) g.query.set(name, new Set());
      g.query.get(name).add(value);
    }
    for (const name of obs.requestHeaderNames ?? Object.keys(obs.requestHeaders ?? {})) {
      const lower = name.toLowerCase();
      if (['cookie', 'authorization', 'x-csrf-token', 'x-api-key'].includes(lower)) {
        g.headers.set(lower, true);   // sensitive: presence only, never the value
      } else if (['content-type', 'accept'].includes(lower)) {
        g.headers.set(lower, false);
      }
    }
    // The free evidence already sitting in the HAR: did this request carry a
    // credential, and was it made from a context with no session?
    const credentialed = (obs.requestHeaderNames ?? Object.keys(obs.requestHeaders ?? {}))
      .some((h) => ['cookie', 'authorization'].includes(h.toLowerCase()));
    const fromAnonContext = obs.anonymousProbe === true || obs.contextId === anonContextId;
    if (credentialed) g.authenticatedObservations += 1;
    else g.unauthenticatedObservations += 1;

    /*
     * What an uncredentialed request settles, and it is not symmetric.
     *
     * **Success settles `not-required`, whatever context it came from.** A
     * request that carried no cookie and no Authorization header and got a 2xx
     * is a public endpoint; which browser context issued it changes nothing
     * about that. `POST /api/v1/login` is the case that found this — the sign-in
     * exchange is uncredentialed by definition and happens in the *authenticated*
     * context, so the context test recorded no evidence at all and the coverage
     * invariant fired. An endpoint you cannot have a session for cannot require
     * one.
     *
     * **Refusal settles `required` only from a deliberate anonymous probe.**
     * This is the asymmetry, and §6 wrote down why: a 401 is often the
     * endpoint's own failure mode rather than a statement about needing auth —
     * a wrong password on a login route answers 401 to a request that was
     * uncredentialed because it is *supposed* to be. Only a GET we re-issued on
     * purpose, knowing it succeeded with a session, makes the refusal mean what
     * it looks like. §13: the default is the safe one *for that category*, and
     * these are two categories.
     */
    if (!credentialed) {
      if (obs.status >= 200 && obs.status < 300) g.anonSucceeded += 1;
      else if (fromAnonContext && (obs.status === 401 || obs.status === 403)) g.anonRefused += 1;
    }
    if (!g.byStatus.has(obs.status)) g.byStatus.set(obs.status, { contentType: obs.contentType, bodies: [], routeIds: [] });
    const bucket = g.byStatus.get(obs.status);
    if (obs.body !== undefined) bucket.bodies.push(obs.body);
    bucket.routeIds.push(obs.routeId);
    g.routeIds.add(obs.routeId);
    if (obs.requestBody !== undefined) g.requestBodies.push(obs.requestBody);
  }

  // Pass one: every path-parameter value observed anywhere, mapped to the
  // endpoints that took it. A response field whose values appear here is a key,
  // and which endpoints they key is exactly §7.4's foreign key.
  const pathParamValues = new Map();
  for (const g of groups.values()) {
    const id = endpointId(g.method, g.pattern);
    for (const position of g.pathParams) {
      for (const value of position.values) {
        if (!pathParamValues.has(value)) pathParamValues.set(value, new Set());
        pathParamValues.get(value).add(id);
      }
    }
  }
  const schemaCtx = {
    uiConstraints,
    pathParamValues,
    mintGap: mintGap ?? (() => { throw new Error('a narrowing needs a gap id; pass mintGap'); }),
  };

  return [...groups.values()].map((g) => {
    // What was actually observed about auth, and nothing more. `unknown` is a
    // real answer: rung 3 recorded `false` for every endpoint of a fully gated
    // app, because the anonymous context never got far enough to be refused.
    const authEvidence = [];
    if (g.anonRefused > 0) {
      authEvidence.push({
        kind: 'unauthorized-status', status: 401,
        observedCount: g.anonRefused, contextId: anonContextId,
      });
    }
    if (g.anonSucceeded > 0) {
      authEvidence.push({
        kind: 'anonymous-success', status: 200,
        observedCount: g.anonSucceeded, contextId: anonContextId,
      });
    }
    if (authEvidence.length === 0 && g.authenticatedObservations > 0 && g.unauthenticatedObservations === 0) {
      // Settles nothing, but strictly better than recording `false`: it says the
      // crawl only ever saw this signed in, which is why the verdict is unknown.
      authEvidence.push({
        kind: 'all-observations-authenticated', header: 'cookie',
        observedCount: g.authenticatedObservations,
      });
    }
    const responses = [...g.byStatus.entries()].map(([status, b]) => ({
      status,
      contentType: b.contentType || 'application/json',
      schema: inferSchema(b.bodies.map((x) => scrub(x)), schemaCtx),
      observedCount: b.bodies.length || b.routeIds.length,
    }));
    const samples = [];
    for (const [status, b] of g.byStatus) {
      // Capped: §8 seeds from these, and two of a shape is enough to seed from.
      for (const body of b.bodies.slice(0, 2)) {
        const scrubbed = scrub(body);
        samples.push({
          sampleId: `sample_${sha256(JSON.stringify({ status, scrubbed })).slice(0, 8)}`,
          status,
          contentType: b.contentType || 'application/json',
          body: scrubbed,
          bytes: Buffer.byteLength(JSON.stringify(scrubbed)),
          observedOn: b.routeIds[0],
        });
      }
    }
    return {
      endpointId: endpointId(g.method, g.pattern),
      method: g.method,
      pathPattern: g.pattern,
      origin: g.origin,
      params: {
        // One entry per hole, in order. `normalizePath` writes every id segment
        // as `:id`, so they share a name — which is what the pattern declares
        // and what the schema cross-checks against.
        // One entry per hole, in order, each named after the collection segment
        // that precedes it — which is what the pattern declares and what the
        // schema cross-checks against.
        path: g.pathParams.map(({ name, values }) => ({
          name, type: 'string', required: true, examples: [...values].slice(0, 10),
        })),
        query: [...g.query.entries()].map(([name, values]) => ({
          name, type: 'string', required: false, examples: [...values].slice(0, 10),
        })),
        headers: [...g.headers.entries()].map(([name, sensitive]) => ({
          name, required: sensitive, sensitive,
        })),
      },
      requestBodySchema: inferSchema(g.requestBodies.map((x) => scrub(x)), schemaCtx),
      responses,
      samples,
      discovery: { kind: 'observed' },
      isMutation: !['GET', 'HEAD', 'OPTIONS'].includes(g.method),
      requiresAuth: resolveAuth(authEvidence),
      authEvidence,
      observedCount: [...g.byStatus.values()].reduce((n, b) => n + b.routeIds.length, 0),
      observedOn: [...g.routeIds],
    };
  });
}
