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
 * Enum inference, rewritten after rung 3 produced this from 23 observations of
 * four todo records:
 *
 *     title: enum ["Read the CSSOM instead of hovering", …]
 *     id:    enum ["td_1", "td_2", "td_3", "td_4"]
 *
 * §5 makes this schema the mock backend's data model, so codegen would have
 * emitted a store where a todo's title can only be one of four literals. That is
 * §7's hallucinated-model failure arriving through a heuristic rather than
 * through a missing endpoint, and it is silent: every trajectory touching the
 * field is corrupted and nothing reports an error.
 *
 * The root cause was sample size, not enum logic. n was 4, wearing n=23's
 * clothes. Three rules follow, and the first is the general one:
 *
 *  1. **Deduplicate by entity identity before any frequency heuristic** — not
 *     only for enums. A list endpoint polled six times is not six times the
 *     evidence.
 *  2. **An enum needs evidence of a CLOSED domain.** Low cardinality is not that.
 *  3. **Default to `string`.** Narrowing must be justified; widening is free.
 */

/** Keys that identify a record, so repeated observations of it collapse to one. */
const IDENTITY_KEYS = ['id', '_id', 'uuid', 'guid', 'slug', 'key', 'sku', 'code'];

const identityOf = (obj) => {
  for (const k of IDENTITY_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' || typeof v === 'number') return `${k}:${v}`;
  }
  return null;
};

/**
 * Collapse repeated observations of the same record.
 *
 * By identity where a record has one, by deep value otherwise — two identical
 * responses are one piece of evidence either way. Everything downstream counts
 * what this returns, never the raw observation list.
 */
export function dedupeByIdentity(values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      out.push(v);
      continue;
    }
    const key = identityOf(v) ?? `~${JSON.stringify(v)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** A value that could belong to a closed domain: slug-like, no whitespace, short. */
const ENUM_TOKEN = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
/** Below this many distinct records, low cardinality is a thin sample. */
export const ENUM_MIN_DISTINCT_RECORDS = 20;
/** Above this value-to-record ratio the values track the records: it is data. */
export const ENUM_MAX_VALUE_RATIO = 0.3;
/** At or above this, the field is unique per record — free text or a key. */
const UNIQUENESS_EXCLUDES_ENUM = 0.9;
const IDENTIFIER_NAME = /^(?:id|uuid|guid|slug|key|token|ref|href|url|.*Id|.*_id)$/i;

/**
 * Decide what a string field is, and record why.
 *
 * Returns `{ enumValues, narrowing, identifier }`, any of which may be null.
 * Hard exclusions are checked first and neither kind of evidence overrides them.
 */
export function classifyStringField({
  key, distinct, recordCount, uiConstraints, pathParamValues, mintGap,
}) {
  const ratio = recordCount > 0 ? distinct.length / recordCount : 1;

  // ---- hard exclusion: these values are somebody's path parameter.
  //
  // Matched by VALUE, not by name. `normalizePath` collapses every id segment to
  // the literal `:id`, so a name comparison would test against a constant.
  // Overlap also catches `listId` pointing at `/api/lists/:id`, which no name
  // rule would — and that is exactly the foreign key §7.4 needs.
  const overlap = distinct.filter((v) => pathParamValues?.has(v));
  if (overlap.length > 0) {
    const pathParamOf = [...new Set(overlap.flatMap((v) => [...pathParamValues.get(v)]))].sort();
    return {
      enumValues: null,
      narrowing: null,
      identifier: { pathParamOf, evidence: ['path-param-value-overlap'] },
    };
  }

  // ---- hard exclusion: near-unique per record. Free text or an identifier.
  if (recordCount > 1 && ratio >= UNIQUENESS_EXCLUDES_ENUM) {
    const named = Boolean(key) && IDENTIFIER_NAME.test(key);
    return {
      enumValues: null,
      narrowing: null,
      identifier: named
        ? { pathParamOf: [], evidence: ['identifier-name', 'unique-per-record'] }
        : null,
    };
  }

  // ---- hard exclusion: sentence-like values are never a domain.
  if (!distinct.every((v) => ENUM_TOKEN.test(v))) {
    return { enumValues: null, narrowing: null, identifier: null };
  }

  // ---- primary evidence: the UI constrains the field.
  //
  // Ground truth, and the only kind that is. A <select> with four options means
  // the API cannot receive a fifth, however thin the sampling was. A field is an
  // enum because the DOM constrains it, not because we did not look at enough
  // rows — and we captured the UI that drives this API, so use it.
  const constraint = key ? uiConstraints?.get(key.toLowerCase()) : undefined;
  if (constraint && distinct.every((v) => constraint.optionValues.includes(v))) {
    return {
      enumValues: [...constraint.optionValues],
      narrowing: {
        kind: 'enum',
        distinctRecords: recordCount,
        distinctValues: distinct.length,
        uiConstraint: constraint,
        reviewRequired: true,
        gapId: mintGap({ field: key, basis: 'ui-constraint', values: constraint.optionValues }),
      },
      identifier: null,
    };
  }

  // ---- corroboration: cardinality stayed flat while records accumulated.
  //
  // Read statically, because one capture yields a final count rather than a
  // trajectory — which is what the floor and the ratio encode.
  if (
    distinct.length >= 2 &&
    recordCount >= ENUM_MIN_DISTINCT_RECORDS &&
    distinct.length <= recordCount * ENUM_MAX_VALUE_RATIO
  ) {
    return {
      enumValues: [...distinct],
      narrowing: {
        kind: 'enum',
        distinctRecords: recordCount,
        distinctValues: distinct.length,
        uiConstraint: null,
        reviewRequired: true,
        gapId: mintGap({ field: key, basis: 'corroborated-cardinality', values: distinct }),
      },
      identifier: null,
    };
  }

  return { enumValues: null, narrowing: null, identifier: null };
}

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

/** Slug for an endpoint id: `get-api-todos-id`. */
export const endpointId = (method, pattern) =>
  `${method.toLowerCase()}${pattern.replace(/[/:]+/g, '-').replace(/-+$/, '').toLowerCase()}`
    .replace(/-{2,}/g, '-');

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
