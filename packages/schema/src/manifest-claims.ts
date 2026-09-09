/**
 * Every field in `manifest.json`, and whether anything backs it or reads it.
 *
 * `manifest.json` is the project's own claim about its outputs, and two of its
 * fields were fiction at once:
 *
 *   - `contentHash` was computed by three drivers, written into every manifest,
 *     and **never once compared**. M1's "recrawl is idempotent modulo timestamps"
 *     was that field, so the gate had not run — not run narrowly, not run wrong,
 *     never run. An inverted comparison in it would have read exactly the same.
 *   - `determinism.frozen` named four globals `capture-site.mjs` froze **none**
 *     of, while `rung3` and the spike both installed a shim. The field whose
 *     entire job is to say the run was deterministic was the one with nothing
 *     behind it.
 *
 * Neither was findable by reading the manifest, because both look exactly like
 * the working version from inside the file. So §13's `NarrowingRecord` shape is
 * applied to the manifest itself: **a claim carries its evidence, and a claim
 * nothing reads is deleted or declared.**
 *
 * Two questions, and they are independent — `contentHash` failed the second and
 * `frozen` the first:
 *
 *   1. **backed** — does something in the repository actually do what the field
 *      asserts about the run?
 *   2. **read** — does anything consume it, ever?
 *
 * A field can be honestly unread: `toolVersions` exists so a human can tell a
 * Chromium upgrade from a real diff, which is a use no code performs. That is
 * why the answer is a *declared reason* rather than a boolean — the same shape
 * as `NOT_FROZEN` and `trackedByUnwalked`, and for the same reason. An
 * exemption someone had to write down is one the next reader can argue with; an
 * absent check is not.
 *
 * This takes both sides as parameters (§13). The schema's own leaf list is one
 * side, so a field added to `CaptureManifestSchema` is covered the day it lands
 * rather than the day someone remembers.
 */

/** Why a manifest field is there, which decides what "backed" means for it. */
export type ClaimKind =
  /** Recomputable from other artifacts. The schema should recompute it. */
  | 'derived'
  /** Recorded from the run. Nothing can recompute it; it is the evidence. */
  | 'observed'
  /** An input the operator or a pin chose. Backed by whatever applies it. */
  | 'configured';

export interface ManifestClaim {
  /** Dotted leaf path, `[]` for an array hop — `schemaLeafPaths`' language. */
  readonly path: string;
  readonly kind: ClaimKind;
  /**
   * What makes the claim true — the function that applies it, or recomputes it.
   * `null` means nothing does, which for a `derived` or `configured` field is
   * the `frozen` failure.
   */
  readonly backedBy: string | null;
  /**
   * What consumes the field. Empty means nothing does — the `contentHash`
   * failure — and then `unreadReason` must say why that is acceptable.
   */
  readonly readBy: readonly string[];
  /** Required exactly when `readBy` is empty. A declared exemption, not a gap. */
  readonly unreadReason?: string | undefined;
}

export interface ManifestClaimReport {
  /** `derived`/`configured` claims with nothing behind them. The `frozen` shape. */
  readonly unbacked: readonly string[];
  /** Claims nothing reads and that offer no reason. The `contentHash` shape. */
  readonly unread: readonly string[];
  /** Claims that name a path the schema does not have. Drift, or a typo. */
  readonly notInSchema: readonly string[];
  /** Schema leaves nobody classified. A field added without anyone deciding. */
  readonly unclassified: readonly string[];
  /** Read-and-unread declared together — an exemption that stopped being one. */
  readonly reasonGivenButRead: readonly string[];
}

/**
 * Reconcile the declared claims against the schema, both directions.
 *
 * A set difference each way rather than a count, for `assessScopeAgreement`'s
 * reason: an aggregate hides a partial loss, and one field added while another
 * is removed nets to zero.
 */
export function assessManifestClaims(input: {
  readonly claims: readonly ManifestClaim[];
  /** Leaf paths of the manifest schema, from `schemaLeafPaths`. */
  readonly schemaLeaves: readonly string[];
}): ManifestClaimReport {
  const { claims, schemaLeaves } = input;
  if (schemaLeaves.length === 0) {
    // An empty leaf list makes every difference below come out clean, which is
    // the permissive answer and the one §13's empty-container rule forbids. A
    // manifest schema with no leaves is the caller passing the wrong thing.
    throw new Error('assessManifestClaims: the manifest schema produced no leaves');
  }
  const declared = new Set(claims.map((c) => c.path));
  const inSchema = new Set(schemaLeaves);

  return {
    unbacked: claims
      .filter((c) => c.kind !== 'observed' && c.backedBy === null)
      .map((c) => c.path)
      .sort(),
    unread: claims
      .filter((c) => c.readBy.length === 0 && (c.unreadReason ?? '') === '')
      .map((c) => c.path)
      .sort(),
    notInSchema: [...declared].filter((p) => !inSchema.has(p)).sort(),
    unclassified: [...inSchema].filter((p) => !declared.has(p)).sort(),
    reasonGivenButRead: claims
      .filter((c) => c.readBy.length > 0 && (c.unreadReason ?? '') !== '')
      .map((c) => c.path)
      .sort(),
  };
}
