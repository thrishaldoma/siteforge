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

/** `/api/todos/td_1` → `/api/todos/:id`, with the observed value recorded. */
export function normalizePath(pathname) {
  const params = [];
  const pattern = pathname
    .split('/')
    .map((seg) => {
      if (seg && ID_SEGMENT.some((re) => re.test(seg))) {
        params.push(seg);
        return ':id';
      }
      return seg;
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
        pathParams: [], query: new Map(), headers: new Map(),
        byStatus: new Map(), requestBodies: [], routeIds: new Set(),
        anonRefused: 0, anonSucceeded: 0,
        authenticatedObservations: 0, unauthenticatedObservations: 0,
      });
    }
    const g = groups.get(key);
    params.forEach((v) => { if (!g.pathParams.includes(v)) g.pathParams.push(v); });
    for (const [name, value] of url.searchParams) {
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

    // A request that went out with no credential, from a context that has none,
    // settles the question — in whichever direction the server answered.
    //
    // A 401 answering a *signed-in* request is a different fact: it is the
    // endpoint's own failure mode, a wrong password on a login route, not a
    // statement about needing auth. Evidence is an interpretation the producer
    // makes, never an automatic consequence of a status code.
    if (!credentialed && fromAnonContext) {
      if (obs.status === 401 || obs.status === 403) g.anonRefused += 1;
      else if (obs.status >= 200 && obs.status < 300) g.anonSucceeded += 1;
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
    for (const value of g.pathParams) {
      if (!pathParamValues.has(value)) pathParamValues.set(value, new Set());
      pathParamValues.get(value).add(id);
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
        path: g.pathParams.length
          ? [{ name: 'id', type: 'string', required: true, examples: g.pathParams.slice(0, 10) }]
          : [],
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
