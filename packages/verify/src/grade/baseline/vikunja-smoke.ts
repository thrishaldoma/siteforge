/**
 * Two operations, transcribed by hand, so a bad first score can be attributed.
 *
 * **Not a baseline.** The Gitea baseline exists to calibrate the grader, and 22
 * mutation deltas already demonstrate that every category moves when its
 * subject breaks. Transcribing 15 more Vikunja operations would duplicate that
 * evidence rather than produce any.
 *
 * What this is for: infer's model must not be the first thing the Vikunja truth
 * ever meets. If it were, a wrong number would have two explanations — a truth
 * side nobody has scored against, and an inference pass nobody has run — and no
 * way to tell them apart. Two operations settle the first: matching finds them,
 * fields line up, and the categories that can be grounded report a number.
 *
 * `GET /api/v1/info` is the one public read in the whole API, and
 * `GET /api/v1/labels` is a gated list. Between them they cover both auth
 * verdicts the sweep observed, a nested object, an array of scalars, and an
 * array-of-objects row shape.
 */
import { SiteModelSchema, type JsonSchemaNode, type SiteModel } from '@siteforge/schema';
import type { ObservedEndpoint } from '../match.js';

const str: JsonSchemaNode = { type: 'string' };
const int: JsonSchemaNode = { type: 'integer' };
const bool: JsonSchemaNode = { type: 'boolean' };
const obj = (properties: Record<string, JsonSchemaNode>, required: string[] = []): JsonSchemaNode => ({
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

/**
 * No `format: date-time` on `created`/`updated`, and the omission is the point.
 *
 * Vikunja's document declares no formats at all, so `narrowing` is `notDerived`
 * for this target. Claiming one here would be transcribing what the *values*
 * look like rather than what the document says, and this file's job is to test
 * the truth side against a model, not to anticipate what infer will find.
 */
const RAW = {
  modelVersion: '1.0.0',
  artifact: 'site-model',
  scrubbed: true,
  provenance: { recordedAt: '2026-09-09T10:00:00.000Z', runId: 'run_2f81c604ab7d9e35' },
  siteId: 'vikunja-smoke',
  sourceCapture: { siteId: 'vikunja-smoke', contentHash: '0'.repeat(64) },
  tokens: { colors: [], spacing: [], radii: [], shadows: [], fontSizes: [] },
  fonts: [],
  assets: [],
  components: [],
  layouts: [
    {
      layoutId: 'lay_vikunja-shell',
      name: 'VikunjaShell',
      root: {
        tag: 'div',
        role: null,
        classes: [],
        attributes: [],
        stateVariants: [],
        entityAnchor: null,
        children: [{ kind: 'slot' }],
      },
    },
  ],
  entities: [
    {
      name: 'Label',
      key: { field: 'id', kind: 'surrogate' },
      fields: [
        { name: 'id', type: 'integer', optional: false, generatedBy: 'counter', narrowing: null, pathParamOf: [] },
        { name: 'title', type: 'string', optional: false, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'description', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
        { name: 'hexColor', type: 'string', optional: true, generatedBy: 'none', narrowing: null, pathParamOf: [] },
      ],
      relations: [],
      seed: null,
    },
  ],
  routes: [
    {
      templateId: 'tpl_labels',
      pathPattern: '/labels',
      layoutId: 'lay_vikunja-shell',
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
                  tag: 'span',
                  role: null,
                  classes: [],
                  attributes: [],
                  stateVariants: [],
                  entityAnchor: { entity: 'Label', keyField: 'id' },
                  children: [{ kind: 'text', value: { kind: 'entity-field', entity: 'Label', field: 'title' } }],
                },
              },
            },
          ],
        },
      },
      dataSources: ['get-api-v1-labels'],
      instances: ['labels--auth-desktop--i0'],
      requiresAuth: true,
      unauthenticatedBehavior: { kind: 'redirect', to: '/login' },
    },
  ],
  behaviours: [],
  operations: [
    {
      operationId: 'get-api-v1-info',
      method: 'GET',
      pathPattern: '/api/v1/info',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [
        json(
          200,
          obj({
            auth: obj({
              local: obj({ enabled: bool }),
              openid_connect: obj({ enabled: bool, providers: arr(obj({})) }),
            }),
            available_migrators: arr(str),
            caldav_enabled: bool,
            demo_mode_enabled: bool,
            email_reminders_enabled: bool,
            enabled_background_providers: arr(str),
            frontend_url: str,
            legal: obj({ imprint_url: str, privacy_policy_url: str }),
            link_sharing_enabled: bool,
            max_file_size: str,
            motd: str,
            public_teams_enabled: bool,
            registration_enabled: bool,
            task_attachments_enabled: bool,
            task_comments_enabled: bool,
            totp_enabled: bool,
            user_deletion_enabled: bool,
            version: str,
            webhooks_enabled: bool,
          }),
        ),
      ],
      requiresAuth: 'not-required',
      authEvidence: [
        { kind: 'anonymous-success' as const, status: 200, observedCount: 1, contextId: 'anon-desktop' },
      ],
      discovery: { kind: 'observed' },
      effect: {
        kind: 'custom',
        gapId: 'gap_4b7d20e9c518',
        summary: 'server capability document; no store entity behind it',
      },
    },
    {
      operationId: 'get-api-v1-labels',
      method: 'GET',
      pathPattern: '/api/v1/labels',
      pathParams: [],
      queryParams: [],
      request: null,
      responses: [
        json(
          200,
          arr(
            obj({
              id: int,
              title: str,
              description: str,
              hex_color: str,
              created: str,
              updated: str,
              created_by: obj({ id: int, username: str }),
            }),
          ),
        ),
      ],
      requiresAuth: 'required',
      authEvidence: [
        { kind: 'unauthorized-status' as const, status: 401 as const, observedCount: 1, contextId: 'anon-desktop' },
      ],
      discovery: { kind: 'observed' },
      effect: {
        kind: 'list',
        entity: 'Label',
        rowsAt: '',
        projection: [
          { pointer: '/[]/id', field: 'id' },
          { pointer: '/[]/title', field: 'title' },
          { pointer: '/[]/hex_color', field: 'hexColor' },
        ],
        filters: [],
        pagination: null,
      },
    },
  ],
};

export const VIKUNJA_SMOKE: SiteModel = SiteModelSchema.parse(RAW);

/** What a crawl of the seeded instance touched, for these two. Frozen as data. */
export const VIKUNJA_SMOKE_OBSERVED: readonly ObservedEndpoint[] = [
  { method: 'GET', pathPattern: '/api/v1/info' },
  { method: 'GET', pathPattern: '/api/v1/labels' },
];
