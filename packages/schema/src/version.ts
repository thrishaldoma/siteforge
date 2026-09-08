/**
 * Model versions.
 *
 * CLAUDE.md §5: "Changing this schema is a breaking change — version it with
 * `modelVersion`." Every artifact file stamps the version it was written under,
 * so a stale file on disk fails to parse instead of being silently misread.
 *
 * Semver, applied to the *schema*, not the tool:
 *   major — a consumer written against the old version will break
 *   minor — additive: new optional fields, new enum members at the tail
 *   patch — documentation, descriptions, constraint tightening that no valid
 *           artifact could have violated
 */

/** Version of the Stage 1 capture contract (CLAUDE.md §5, §6). */
export const CAPTURE_MODEL_VERSION = '1.0.0';

/**
 * Version of the Stage 2 inference contract (CLAUDE.md §7).
 *
 * Designed at M2, backwards from what codegen consumes — decisions 0001 and
 * 0017. It versions independently of the capture contract: the two change for
 * unrelated reasons, and a SiteModel stamped with a capture version would claim
 * to be something it is not.
 */
export const SITE_MODEL_VERSION = '1.0.0';
