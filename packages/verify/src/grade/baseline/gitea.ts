/**
 * The known-correct model: a `SiteModel` transcribed by hand from Gitea's spec.
 *
 * 0015 §7. Its near-1.0 score is **not** evidence the grader works — it was
 * written by reading the ground truth, so scoring it well is circular. Only the
 * mutation deltas in `../mutations.ts` are evidence. What this file is for is
 * being a *legal* model: it parses against `SiteModelSchema` including narrowing
 * evidence and every cross-reference, because decision 0011 settled that a
 * fixture in a shape its producing stage could not produce is a lie.
 *
 * **Every operation below is a literal somebody typed.** Nothing here is
 * generated from `swagger.v1.json`, and that restriction is the whole value of
 * the file: if the response pointers came from the same walk the truth side
 * uses, `response-field-presence` would read 1.0 by construction and a bug in
 * the model-side pointer convention would be unfindable. That is the
 * generated-fixture mistake, in a new place.
 *
 * **Scope: one resource family.** 0015's open list asks for repos-and-issues
 * rather than the whole surface, and this is narrower still — labels,
 * milestones and topics, plus five zero-parameter endpoints the anonymous sweep
 * actually observed. Chosen because their schemas are small enough to transcribe
 * honestly (a Repository is 163 fields at depth 4) and because between them they
 * exercise every scored category: list and item shapes, an array of scalars, a
 * request body, a real enum (`state`), real `date-time` formats, path-parameter
 * arities of two and three, both auth verdicts the sweep observed, and one
 * `bound-from-control` endpoint. The report says how much of the spec it covers,
 * because a baseline over 15 endpoints supports weaker calibration than one over
 * 80.
 */
import {
  SiteModelSchema,
  type JsonSchemaNode,
  type SiteModel,
} from '@siteforge/schema';
import type { ObservedEndpoint } from '../match.js';

// ---------------------------------------------------------------------------
// Small constructors. Typing aid only: every field name, type and pointer below
// is written out by hand, which is the property that matters.
// ---------------------------------------------------------------------------

const str: JsonSchemaNode = { type: 'string' };
const int: JsonSchemaNode = { type: 'integer' };
const bool: JsonSchemaNode = { type: 'boolean' };

/** A `date-time` string. Gitea marks these in the document; capture matched all of them. */
const stamp = (observed: number): JsonSchemaNode => ({
  type: 'string',
  format: 'date-time',
  narrowing: { kind: 'format', format: 'date-time', matched: observed, total: observed },
});

const obj = (properties: Record<string, JsonSchemaNode>, required: string[]): JsonSchemaNode => ({
  type: 'object',
  properties,
  required,
});

const arr = (items: JsonSchemaNode): JsonSchemaNode => ({ type: 'array', items });

const json = (status: number, schema: JsonSchemaNode | null) => ({
  status,
  contentType: 'application/json',
  schema,
});

/** Every observation carried a cookie: settles nothing, and says so. */
const AUTHENTICATED_ONLY = [
  { kind: 'all-observations-authenticated' as const, header: 'cookie' as const, observedCount: 4 },
];
const anonymousSuccess = (observedCount: number) => [
  { kind: 'anonymous-success' as const, status: 200, observedCount, contextId: 'anon-desktop' },
];
const unauthorized = (observedCount: number) => [
  { kind: 'unauthorized-status' as const, status: 401 as const, observedCount, contextId: 'anon-desktop' },
];

// ---------------------------------------------------------------------------
// Shapes, transcribed
// ---------------------------------------------------------------------------

const LABEL = obj(
  {
    id: int,
    name: str,
    color: str,
    description: str,
    exclusive: bool,
    is_archived: bool,
    url: str,
  },
  ['id', 'name', 'color'],
);

const MILESTONE = obj(
  {
    id: int,
    title: str,
    description: str,
    // The one real enum in this slice. Gitea's document closes the domain to two
    // values; the crawl saw 24 distinct milestones carrying two of them, which is
    // over the 20-record floor and under the 0.3 value ratio.
    state: {
      type: 'string',
      enum: ['open', 'closed'],
      narrowing: {
        kind: 'enum',
        distinctRecords: 24,
        distinctValues: 2,
        uiConstraint: null,
        reviewRequired: true,
        gapId: 'gap_4a1c07d3e9b2',
      },
    },
    open_issues: int,
    closed_issues: int,
    due_on: stamp(11),
    closed_at: stamp(6),
    created_at: stamp(24),
    updated_at: stamp(24),
  },
  ['id', 'title', 'state'],
);

// ---------------------------------------------------------------------------

const RAW = {
  modelVersion: '1.0.0',
  artifact: 'site-model',
  scrubbed: true,
  provenance: { recordedAt: '2026-09-09T09:00:00.000Z', runId: 'run_5c2b91ad3f04e716' },
  siteId: 'gitea-truth',
  sourceCapture: {
    siteId: 'gitea-truth',
    contentHash: '0'.repeat(64),
  },

  // Nothing below the API scores. A legal minimum, so the model parses as the
  // artifact codegen consumes rather than as an endpoint list wearing its name.
  tokens: {
    colors: [
      { name: 'ink', value: 'rgb(51, 51, 51)', snappedFrom: ['rgb(51, 51, 51)'], usageCount: 44 },
      { name: 'brand', value: 'rgb(76, 175, 80)', snappedFrom: ['rgb(76, 175, 80)'], usageCount: 12 },
    ],
    spacing: [],
    radii: [],
    shadows: [],
    fontSizes: [],
  },
  fonts: [],
  assets: [],
  components: [],
  layouts: [
    {
      layoutId: 'lay_gitea-shell',
      name: 'GiteaShell',
      root: {
        tag: 'div',
        role: null,
        classes: [],
        attributes: [],
        stateVariants: [],
        entityAnchor: null,
        children: [
          {
            kind: 'element',
            element: {
              tag: 'header',
              role: 'banner',
              classes: [],
              attributes: [],
              stateVariants: [],
              entityAnchor: null,
              children: [{ kind: 'text', value: { kind: 'literal', text: 'Gitea' } }],
            },
          },
          { kind: 'slot' },
        ],
      },
    },
  ],
  routes: [
    {
      templateId: 'tpl_repo-labels',
      pathPattern: '/:owner/:repo/labels',
      layoutId: 'lay_gitea-shell',
      content: {
        kind: 'element',
        element: {
          tag: 'main',
          role: null,
          classes: [],
          attributes: [],
          stateVariants: [],
          entityAnchor: null,
          children: [
            {
              kind: 'repeat',
              over: { entity: 'Label' },
              itemProp: 'label',
              child: {
                kind: 'element',
                element: {
                  tag: 'li',
                  role: null,
                  classes: [],
                  attributes: [],
                  stateVariants: [],
                  entityAnchor: { entity: 'Label', keyField: 'name' },
                  children: [{ kind: 'text', value: { kind: 'entity-field', entity: 'Label', field: 'name' } }],
                },
              },
            },
          ],
        },
      },
      dataSources: ['get-api-v1-repos-owner-repo-labels'],
      instances: ['owner-repo-labels--anon-desktop--i0'],
      requiresAuth: false,
      unauthenticatedBehavior: { kind: 'renders-anyway' },
    },
  ],

  entities: [
    {
      name: 'License',
      key: { field: 'key', kind: 'business' },
      fields: [
        { name: 'key', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'name', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'url', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: null,
    },
    {
      name: 'Email',
      key: { field: 'email', kind: 'business' },
      fields: [
        { name: 'email', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'primary', type: 'boolean', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'userId', type: 'integer', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'username', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'verified', type: 'boolean', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: null,
    },
    {
      name: 'Stopwatch',
      key: { field: 'issueIndex', kind: 'business' },
      fields: [
        { name: 'issueIndex', type: 'integer', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'issueTitle', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'repoName', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'repoOwnerName', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'seconds', type: 'integer', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'duration', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'created', type: 'timestamp', optional: false, generatedBy: 'clock', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: null,
    },
    {
      name: 'Label',
      // `name`, not `id`: §10's entity anchors must not be keyed on a value the
      // store generates, and Gitea's label ids are per-instance counters.
      key: { field: 'name', kind: 'business' },
      fields: [
        {
          name: 'id',
          type: 'integer',
          optional: false,
          generatedBy: 'counter',
          narrowing: null,
          // Observed as the `:id` segment of three endpoints — read off value
          // overlap, which is the only evidence §7.5 accepts for this.
          pathParamOf: [
            'get-api-v1-repos-owner-repo-labels-id',
            'patch-api-v1-repos-owner-repo-labels-id',
            'delete-api-v1-repos-owner-repo-labels-id',
          ],
        },
        { name: 'name', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'color', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'description', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'exclusive', type: 'boolean', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'isArchived', type: 'boolean', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'url', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: {
        rows: [
          { id: 1, name: 'bug', color: 'd73a4a', description: 'Something is not working', exclusive: false, isArchived: false, url: 'http://localhost:3801/api/v1/repos/octo/hello/labels/1' },
          { id: 2, name: 'enhancement', color: 'a2eeef', description: 'New feature or request', exclusive: false, isArchived: false, url: 'http://localhost:3801/api/v1/repos/octo/hello/labels/2' },
          { id: 3, name: 'question', color: 'd876e3', description: 'Further information is requested', exclusive: false, isArchived: false, url: 'http://localhost:3801/api/v1/repos/octo/hello/labels/3' },
        ],
        derivedFrom: ['get-api-v1-repos-owner-repo-labels'],
        distinctRecords: 3,
      },
    },
    {
      name: 'Milestone',
      key: { field: 'title', kind: 'business' },
      fields: [
        {
          name: 'id',
          type: 'integer',
          optional: false,
          generatedBy: 'counter',
          narrowing: null,
          pathParamOf: ['get-api-v1-repos-owner-repo-milestones-id'],
        },
        { name: 'title', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'description', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        {
          name: 'state',
          type: 'string',
          optional: false,
          generatedBy: 'none',
          narrowing: {
            kind: 'enum',
            distinctRecords: 24,
            distinctValues: 2,
            uiConstraint: null,
            reviewRequired: true,
            gapId: 'gap_4a1c07d3e9b2',
          },
          pathParamOf: [],
        },
        { name: 'openIssues', type: 'integer', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'closedIssues', type: 'integer', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'dueOn', type: 'timestamp', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'closedAt', type: 'timestamp', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'createdAt', type: 'timestamp', optional: false, generatedBy: 'clock', narrowing: null, pathParamOf: [] },
        { name: 'updatedAt', type: 'timestamp', optional: false, generatedBy: 'clock', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: null,
    },
    {
      name: 'Repository',
      key: { field: 'fullName', kind: 'business' },
      fields: [
        { name: 'fullName', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'name', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: ['delete-api-v1-repos-owner-repo'] },
        { name: 'owner', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: ['delete-api-v1-repos-owner-repo'] },
      ],
      relations: [],
      seed: null,
    },
  ],

  operations: [
    // --- zero-parameter endpoints, the slice the anonymous sweep observed ----
    {
      operationId: 'get-api-v1-version',
      method: 'GET',
      pathPattern: '/api/v1/version',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [json(200, obj({ version: str }, []))],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(2),
      discovery: { kind: 'observed' },
      // A server-configuration document, not a row in any store. §7's standing
      // rule: the unclassifiable case is a gap, never a guess that it is a read.
      effect: { kind: 'custom', gapId: 'gap_9f0e1b7c4d33', summary: 'returns the server version; no store entity behind it' },
    },
    {
      operationId: 'get-api-v1-licenses',
      method: 'GET',
      pathPattern: '/api/v1/licenses',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [json(200, arr(obj({ key: str, name: str, url: str }, [])))],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(1),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'License',
        rowsAt: '',
        projection: [
          { pointer: '/[]/key', field: 'key' },
          { pointer: '/[]/name', field: 'name' },
          { pointer: '/[]/url', field: 'url' },
        ],
        filters: [],
        pagination: null,
      },
    },
    {
      operationId: 'get-api-v1-settings-api',
      method: 'GET',
      pathPattern: '/api/v1/settings/api',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [
        json(
          200,
          obj(
            {
              default_paging_num: int,
              default_git_trees_per_page: int,
              default_max_blob_size: int,
              default_max_response_size: int,
              max_response_items: int,
            },
            [],
          ),
        ),
      ],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(1),
      discovery: { kind: 'observed' },
      effect: { kind: 'custom', gapId: 'gap_1d5a63b8ff20', summary: 'server settings document; no store entity behind it' },
    },
    {
      operationId: 'get-api-v1-user-emails',
      method: 'GET',
      pathPattern: '/api/v1/user/emails',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [
        json(
          200,
          arr(
            obj(
              {
                email: {
                  type: 'string',
                  format: 'email',
                  narrowing: { kind: 'format', format: 'email', matched: 2, total: 2 },
                },
                primary: bool,
                user_id: int,
                username: str,
                verified: bool,
              },
              [],
            ),
          ),
        ),
      ],
      requiresAuth: 'required',
      authEvidence: unauthorized(1),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'Email',
        rowsAt: '',
        projection: [
          { pointer: '/[]/email', field: 'email' },
          { pointer: '/[]/primary', field: 'primary' },
          { pointer: '/[]/user_id', field: 'userId' },
          { pointer: '/[]/username', field: 'username' },
          { pointer: '/[]/verified', field: 'verified' },
        ],
        filters: [],
        pagination: null,
      },
    },
    {
      operationId: 'get-api-v1-user-stopwatches',
      method: 'GET',
      pathPattern: '/api/v1/user/stopwatches',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [
        json(
          200,
          arr(
            obj(
              {
                created: stamp(3),
                duration: str,
                issue_index: int,
                issue_title: str,
                repo_name: str,
                repo_owner_name: str,
                seconds: int,
              },
              [],
            ),
          ),
        ),
      ],
      requiresAuth: 'required',
      authEvidence: unauthorized(1),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'Stopwatch',
        rowsAt: '',
        projection: [
          { pointer: '/[]/issue_index', field: 'issueIndex' },
          { pointer: '/[]/issue_title', field: 'issueTitle' },
          { pointer: '/[]/repo_name', field: 'repoName' },
          { pointer: '/[]/repo_owner_name', field: 'repoOwnerName' },
          { pointer: '/[]/seconds', field: 'seconds' },
          { pointer: '/[]/duration', field: 'duration' },
          { pointer: '/[]/created', field: 'created' },
        ],
        filters: [],
        pagination: null,
      },
    },

    // --- labels: the CRUD family -------------------------------------------
    {
      operationId: 'get-api-v1-repos-owner-repo-labels',
      method: 'GET',
      pathPattern: '/api/v1/repos/:owner/:repo/labels',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(200, arr(LABEL))],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(2),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'Label',
        rowsAt: '',
        projection: [
          { pointer: '/[]/id', field: 'id' },
          { pointer: '/[]/name', field: 'name' },
          { pointer: '/[]/color', field: 'color' },
          { pointer: '/[]/description', field: 'description' },
          { pointer: '/[]/exclusive', field: 'exclusive' },
          { pointer: '/[]/is_archived', field: 'isArchived' },
          { pointer: '/[]/url', field: 'url' },
        ],
        filters: [],
        pagination: null,
      },
    },
    {
      operationId: 'get-api-v1-repos-owner-repo-labels-id',
      method: 'GET',
      pathPattern: '/api/v1/repos/:owner/:repo/labels/:id',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
        { name: 'id', type: 'integer', required: true, binds: { entity: 'Label', field: 'id' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(200, LABEL)],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(3),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'read',
        entity: 'Label',
        rowsAt: '',
        projection: [
          { pointer: '/id', field: 'id' },
          { pointer: '/name', field: 'name' },
          { pointer: '/color', field: 'color' },
          { pointer: '/description', field: 'description' },
          { pointer: '/exclusive', field: 'exclusive' },
          { pointer: '/is_archived', field: 'isArchived' },
          { pointer: '/url', field: 'url' },
        ],
        select: { from: 'path-param', name: 'id', matches: 'id' },
      },
    },
    {
      operationId: 'post-api-v1-repos-owner-repo-labels',
      method: 'POST',
      pathPattern: '/api/v1/repos/:owner/:repo/labels',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: obj({ name: str, color: str, description: str, exclusive: bool, is_archived: bool }, [
        'name',
        'color',
      ]),
      responses: [json(201, LABEL)],
      // §6 never re-issues a mutation anonymously, so nothing settles this one.
      requiresAuth: 'unknown',
      authEvidence: AUTHENTICATED_ONLY,
      discovery: { kind: 'observed' },
      effect: {
        kind: 'create',
        entity: 'Label',
        rowsAt: '',
        projection: [
          { pointer: '/id', field: 'id' },
          { pointer: '/name', field: 'name' },
          { pointer: '/color', field: 'color' },
        ],
        input: [
          { pointer: '/name', field: 'name' },
          { pointer: '/color', field: 'color' },
          { pointer: '/description', field: 'description' },
          { pointer: '/exclusive', field: 'exclusive' },
          { pointer: '/is_archived', field: 'isArchived' },
        ],
        generated: ['id'],
      },
    },
    {
      operationId: 'patch-api-v1-repos-owner-repo-labels-id',
      method: 'PATCH',
      pathPattern: '/api/v1/repos/:owner/:repo/labels/:id',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
        { name: 'id', type: 'integer', required: true, binds: { entity: 'Label', field: 'id' } },
      ],
      queryParams: [],
      request: obj({ name: str, color: str, description: str, exclusive: bool, is_archived: bool }, []),
      responses: [json(200, LABEL)],
      requiresAuth: 'unknown',
      authEvidence: AUTHENTICATED_ONLY,
      discovery: { kind: 'observed' },
      effect: {
        kind: 'update',
        entity: 'Label',
        rowsAt: '',
        projection: [
          { pointer: '/id', field: 'id' },
          { pointer: '/name', field: 'name' },
          { pointer: '/color', field: 'color' },
        ],
        select: { from: 'path-param', name: 'id', matches: 'id' },
        input: [
          { pointer: '/name', field: 'name' },
          { pointer: '/color', field: 'color' },
          { pointer: '/description', field: 'description' },
        ],
      },
    },
    {
      operationId: 'delete-api-v1-repos-owner-repo-labels-id',
      method: 'DELETE',
      pathPattern: '/api/v1/repos/:owner/:repo/labels/:id',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
        { name: 'id', type: 'integer', required: true, binds: { entity: 'Label', field: 'id' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(204, null)],
      requiresAuth: 'unknown',
      authEvidence: AUTHENTICATED_ONLY,
      discovery: { kind: 'observed' },
      effect: { kind: 'delete', entity: 'Label', select: { from: 'path-param', name: 'id', matches: 'id' } },
    },

    // --- milestones: the enum and the timestamps ----------------------------
    {
      operationId: 'get-api-v1-repos-owner-repo-milestones',
      method: 'GET',
      pathPattern: '/api/v1/repos/:owner/:repo/milestones',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(200, arr(MILESTONE))],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(2),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'Milestone',
        rowsAt: '',
        projection: [
          { pointer: '/[]/id', field: 'id' },
          { pointer: '/[]/title', field: 'title' },
          { pointer: '/[]/state', field: 'state' },
          { pointer: '/[]/due_on', field: 'dueOn' },
        ],
        filters: [],
        pagination: null,
      },
    },
    {
      operationId: 'get-api-v1-repos-owner-repo-milestones-id',
      method: 'GET',
      pathPattern: '/api/v1/repos/:owner/:repo/milestones/:id',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
        { name: 'id', type: 'integer', required: true, binds: { entity: 'Milestone', field: 'id' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(200, MILESTONE)],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(2),
      discovery: { kind: 'observed' },
      effect: {
        kind: 'read',
        entity: 'Milestone',
        rowsAt: '',
        projection: [
          { pointer: '/id', field: 'id' },
          { pointer: '/title', field: 'title' },
          { pointer: '/state', field: 'state' },
        ],
        select: { from: 'path-param', name: 'id', matches: 'id' },
      },
    },
    {
      operationId: 'post-api-v1-repos-owner-repo-milestones',
      method: 'POST',
      pathPattern: '/api/v1/repos/:owner/:repo/milestones',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: obj(
        {
          title: str,
          description: str,
          due_on: stamp(4),
          state: {
            type: 'string',
            enum: ['open', 'closed'],
            narrowing: {
              kind: 'enum',
              distinctRecords: 24,
              distinctValues: 2,
              uiConstraint: null,
              reviewRequired: true,
              gapId: 'gap_4a1c07d3e9b2',
            },
          },
        },
        [],
      ),
      responses: [json(201, MILESTONE)],
      requiresAuth: 'unknown',
      authEvidence: AUTHENTICATED_ONLY,
      discovery: { kind: 'observed' },
      effect: {
        kind: 'create',
        entity: 'Milestone',
        rowsAt: '',
        projection: [
          { pointer: '/id', field: 'id' },
          { pointer: '/title', field: 'title' },
          { pointer: '/state', field: 'state' },
        ],
        input: [
          { pointer: '/title', field: 'title' },
          { pointer: '/description', field: 'description' },
          { pointer: '/due_on', field: 'dueOn' },
          { pointer: '/state', field: 'state' },
        ],
        generated: ['id', 'createdAt', 'updatedAt'],
      },
    },

    // --- an array of bare scalars ------------------------------------------
    {
      operationId: 'get-api-v1-repos-owner-repo-topics',
      method: 'GET',
      pathPattern: '/api/v1/repos/:owner/:repo/topics',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: null,
      responses: [json(200, obj({ topics: arr(str) }, []))],
      requiresAuth: 'not-required',
      authEvidence: anonymousSuccess(2),
      discovery: { kind: 'observed' },
      // A list of bare strings: there is no row identity to project onto, so
      // there is nothing to call a `list`.
      effect: { kind: 'custom', gapId: 'gap_71b3ce09a4d5', summary: 'returns a list of bare topic strings; no row identity to project' },
    },

    // --- the control capture refused to fire (§6, §7.6) ---------------------
    {
      operationId: 'delete-api-v1-repos-owner-repo',
      method: 'DELETE',
      pathPattern: '/api/v1/repos/:owner/:repo',
      pathParams: [
        { name: 'owner', type: 'string', required: true, binds: null },
        { name: 'repo', type: 'string', required: true, binds: { entity: 'Repository', field: 'name' } },
      ],
      queryParams: [],
      request: null,
      // Never fired, so no observed response. §8 synthesizes the shape from the
      // data model and the gap records that it did.
      responses: [],
      requiresAuth: 'unknown',
      authEvidence: [],
      discovery: {
        kind: 'bound-from-control',
        controlId: 'ctl_8c31f7a02be4',
        evidence: 'form-action',
        gapId: 'gap_2e8b40c1a976',
      },
      effect: {
        kind: 'delete',
        entity: 'Repository',
        select: { from: 'path-param', name: 'repo', matches: 'name' },
      },
    },
  ],

  behaviours: [],
};

/**
 * Parsed at load. An illegal baseline must fail on import rather than produce a
 * score — a model the producing stage could not emit is not a baseline, it is a
 * transcription of the answer key.
 */
export const GITEA_BASELINE: SiteModel = SiteModelSchema.parse(RAW);

/**
 * What the crawl saw, frozen as data.
 *
 * `endpoint-identity` recall is over this list, so it must **not** be recomputed
 * from the model: deleting an endpoint from the model would delete it from the
 * denominator too and the recall delta would read zero — the mutation would pass
 * while measuring nothing.
 *
 * It is what a crawl of this Gitea would have touched, which is the same set the
 * baseline emits: a hand-authored model scoring 1.0 on recall is circular, and
 * 0015 §7 says so. The number that matters is the delta.
 */
export const GITEA_OBSERVED: readonly ObservedEndpoint[] = [
  { method: 'GET', pathPattern: '/api/v1/version' },
  { method: 'GET', pathPattern: '/api/v1/licenses' },
  { method: 'GET', pathPattern: '/api/v1/settings/api' },
  { method: 'GET', pathPattern: '/api/v1/user/emails' },
  { method: 'GET', pathPattern: '/api/v1/user/stopwatches' },
  { method: 'GET', pathPattern: '/api/v1/repos/:owner/:repo/labels' },
  { method: 'GET', pathPattern: '/api/v1/repos/:owner/:repo/labels/:id' },
  { method: 'POST', pathPattern: '/api/v1/repos/:owner/:repo/labels' },
  { method: 'PATCH', pathPattern: '/api/v1/repos/:owner/:repo/labels/:id' },
  { method: 'DELETE', pathPattern: '/api/v1/repos/:owner/:repo/labels/:id' },
  { method: 'GET', pathPattern: '/api/v1/repos/:owner/:repo/milestones' },
  { method: 'GET', pathPattern: '/api/v1/repos/:owner/:repo/milestones/:id' },
  { method: 'POST', pathPattern: '/api/v1/repos/:owner/:repo/milestones' },
  { method: 'GET', pathPattern: '/api/v1/repos/:owner/:repo/topics' },
  // Not here: `DELETE /api/v1/repos/:owner/:repo`. §6 declined to fire the
  // control, so the crawl never observed it — that is exactly what makes it a
  // `bound-from-control` claim rather than an observation.
];
