/**
 * Piece 3 — endpoints and auth.
 *
 * Turns each observed `EndpointDescriptor` into the `ApiOperation` codegen
 * consumes. Most of it is faithful transcription; the two places judgement
 * enters are the store effect and the auth verdict, and both fail closed.
 *
 * **The effect is what the handler does to the store**, and the unclassifiable
 * case is `custom` carrying a gap — never "treat it as a create because most
 * POSTs are". §13's rule about defaults by category: for this one the safe
 * answer is that codegen stubs it and the operator is told.
 *
 * **The auth verdict is copied, never re-derived.** Capture watched the wire;
 * this stage did not. Re-deriving a three-valued verdict from a status code
 * here would be a second opinion formed with strictly less evidence, and the
 * schema would reject any disagreement anyway — `requiresAuth` must equal
 * `resolveAuthRequirement(authEvidence)`.
 */
import {
  deriveEndpointId,
  type ApiOperation,
  type EndpointDescriptor,
  type JsonSchemaNode,
  type StoreEffect,
} from '@siteforge/schema';
import { shortHash } from '@siteforge/schema';
import { fieldNameOf, rowOf, soleType, type RowShape } from './entities.js';

const gapId = (label: string): string => `gap_${shortHash(label).slice(0, 12)}`;

/** Which entity a row belongs to, once the rows have been deduplicated. */
export type EntityOfRow = (row: RowShape) => string | null;

const scalarProjection = (
  properties: Readonly<Record<string, JsonSchemaNode>>,
  prefix: string,
): Array<{ pointer: string; field: string }> =>
  Object.entries(properties)
    .filter(([, node]) => soleType(node) !== 'object' && soleType(node) !== 'array')
    // The pointer keeps the wire spelling; the field takes the model's. A
    // projection that renamed the pointer would make the clone read a field the
    // real API never sent.
    .flatMap(([wire]) => {
      const field = fieldNameOf(wire);
      return field === null ? [] : [{ pointer: `${prefix}/${wire}`, field }];
    })
    .sort((a, b) => a.field.localeCompare(b.field));

/**
 * What this operation does to the store.
 *
 * Read off the method and the shape of what came back, and nothing else. A GET
 * returning an array of rows is a list; a GET returning one row is a read; a
 * POST or PUT carrying a body is a create; a PATCH or PUT with a path parameter
 * is an update; a DELETE is a delete. Everything else is `custom` with a gap,
 * including every 2xx that carried no row at all — a settings document, a
 * capability blob, a token mint.
 *
 * `session-create` is deliberately not guessed. §8 wants a login to mint a
 * session rather than create a row, but capture cannot tell the two apart from
 * the wire, and a wrong guess here builds an auth flow out of a create.
 */
export function effectOf(
  endpoint: EndpointDescriptor,
  row: RowShape | null,
  entityOf: EntityOfRow,
): StoreEffect {
  const entity = row === null ? null : entityOf(row);
  const custom = (why: string): StoreEffect => ({
    kind: 'custom',
    gapId: gapId(`effect:${endpoint.endpointId}`),
    summary: why,
  });
  if (entity === null || row === null) {
    return custom(
      `${endpoint.method} ${endpoint.pathPattern} returned no row this stage recognises, so what it does to the store is not known. §7: a gap, not a guess.`,
    );
  }
  const projection = scalarProjection(row.properties, row.fromList ? '/[]' : '');
  const hasPathParam = endpoint.params.path.length > 0;
  if (endpoint.method === 'GET' && row.fromList) {
    return { kind: 'list', entity, rowsAt: row.rowsAt, projection, filters: [], pagination: null };
  }
  if (endpoint.method === 'GET') {
    return {
      kind: 'read',
      entity,
      rowsAt: row.rowsAt,
      projection,
      select: { from: 'path-param', name: endpoint.params.path[0]?.name ?? 'id', matches: 'id' },
    };
  }
  const input = Object.keys(endpoint.requestBodySchema?.properties ?? {})
    .flatMap((wire) => {
      const field = fieldNameOf(wire);
      return field === null ? [] : [{ pointer: `/${wire}`, field }];
    })
    .sort((a, b) => a.field.localeCompare(b.field));
  if ((endpoint.method === 'POST' || endpoint.method === 'PUT') && !hasPathParam && input.length > 0) {
    return {
      kind: 'create',
      entity,
      rowsAt: row.rowsAt,
      projection,
      input,
      generated: Object.keys(row.properties).filter((n) => n === 'id'),
    };
  }
  if ((endpoint.method === 'PATCH' || endpoint.method === 'POST' || endpoint.method === 'PUT') && hasPathParam && input.length > 0) {
    return {
      kind: 'update',
      entity,
      rowsAt: row.rowsAt,
      projection,
      select: { from: 'path-param', name: endpoint.params.path[0]!.name, matches: 'id' },
      input,
    };
  }
  if (endpoint.method === 'DELETE' && hasPathParam) {
    return {
      kind: 'delete',
      entity,
      select: { from: 'path-param', name: endpoint.params.path[0]!.name, matches: 'id' },
    };
  }
  return custom(
    `${endpoint.method} ${endpoint.pathPattern} carries a row but no request body this stage could map to store input, so the mutation it performs is not known.`,
  );
}

type ParamType = ApiOperation['pathParams'][number]['type'];

const paramType = (t: string): ParamType =>
  t === 'number' || t === 'integer' || t === 'boolean' ? t : 'string';

/** One observed endpoint, as the operation codegen consumes. */
export function operationOf(endpoint: EndpointDescriptor, entityOf: EntityOfRow): ApiOperation {
  const row = rowOf(endpoint);
  return {
    // Recomputed, never copied: §13's rule for a derived field, and the reason
    // an operation joins to a capture endpoint without a second key to keep in
    // step. The schema recomputes it again and rejects a mismatch.
    operationId: deriveEndpointId(endpoint.method, endpoint.pathPattern),
    method: endpoint.method,
    pathPattern: endpoint.pathPattern,
    pathParams: endpoint.params.path.map((p) => ({
      name: p.name,
      type: paramType(p.type),
      required: true,
      binds: null,
    })),
    queryParams: endpoint.params.query.map((p) => ({
      name: p.name,
      type: paramType(p.type),
      required: p.required,
      binds: null,
    })),
    request: endpoint.requestBodySchema ?? null,
    responses: endpoint.responses.map((r) => ({
      status: r.status,
      contentType: r.contentType,
      schema: r.schema ?? null,
    })),
    requiresAuth: endpoint.requiresAuth,
    authEvidence: endpoint.authEvidence,
    discovery: { kind: 'observed' },
    effect: effectOf(endpoint, row, entityOf),
  };
}
