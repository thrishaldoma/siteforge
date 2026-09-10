/**
 * The committed known-divergence list (0015 §1, extended by 0033).
 *
 * An OpenAPI document is hand-maintained and drifts from the server it
 * describes. When a graded claim disagrees, the score alone cannot say whether
 * infer is wrong or the document is stale — so an exclusion carries **the
 * recorded exchange**, not a belief, and "infer disagrees" is never evidence.
 *
 * This list was empty until Vikunja's four contradicted slots. Everything about
 * how they are budgeted was settled in 0033 *before* the first entry landed,
 * because 0015 is explicit that exclusions produced in response to a bad score
 * cannot be told from tuning afterwards, however well each one reads.
 *
 * The entries are frozen as a complete set by `known-divergence.test.ts`, so a
 * fifth cannot arrive without the assertion being edited by hand.
 */
import type { KnownDivergence } from '@siteforge/schema';

/** The pinned image every observation below was recorded against. */
const IMAGE = 'vikunja/vikunja@sha256:ed1f3ed467fecec0b57e9de7bc6607f8bbcbb23ffced6a81f5dfefc794cdbe3b';

/**
 * Vikunja's document declares two view fields as integer enums; the API sends
 * strings from an entirely different vocabulary.
 *
 * Not "the document is imprecise" — the two value sets are **disjoint**. To
 * score these, infer would have to claim `["0","1","2","3"]` for a field it
 * watched return `"list"` 138 times, which §7.5 forbids and should: narrowing
 * must be justified by evidence, and the evidence here says the opposite of
 * what the document says.
 *
 * So infer emitting nothing is correct behaviour, and 0015's rule applies —
 * excluded from numerator and denominator both, rather than scored as a miss
 * against a document that is wrong about its own server.
 */
const viewEnums = (
  specPath: string,
  pointer: string,
  field: 'view_kind' | 'bucket_configuration_mode',
  observedCount: number,
): KnownDivergence => ({
  scope: 'field',
  category: 'narrowing',
  method: 'GET',
  specPath,
  status: '200',
  pointer,
  specSays:
    field === 'view_kind'
      ? 'type integer, enum ["0","1","2","3"]'
      : 'type integer, enum ["0","1","2"]',
  serverDoes:
    field === 'view_kind'
      ? 'type string, values "gantt" | "kanban" | "list" | "table"'
      : 'type string, values "manual" | "none"',
  evidence: {
    request: `GET ${specPath} (${observedCount} observed exchange(s), authenticated crawl)`,
    responseStatus: 200,
    responseExcerpt:
      field === 'view_kind'
        ? `${pointer} observed as ["gantt","kanban","list","table"] — no observation was an integer or an integer-valued string`
        : `${pointer} observed as ["manual","none"] — no observation was an integer or an integer-valued string`,
    observedAt: IMAGE,
  },
});

export const KNOWN_DIVERGENCE: readonly KnownDivergence[] = [
  viewEnums('/projects', '/[]/views/[]/view_kind', 'view_kind', 138),
  viewEnums('/projects', '/[]/views/[]/bucket_configuration_mode', 'bucket_configuration_mode', 138),
  viewEnums('/projects/{id}', '/views/[]/view_kind', 'view_kind', 27),
  viewEnums('/projects/{id}', '/views/[]/bucket_configuration_mode', 'bucket_configuration_mode', 27),
];
