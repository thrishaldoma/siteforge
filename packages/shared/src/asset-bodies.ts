/**
 * The gate on a claim `assets/index.json` made and nothing checked.
 *
 * Every entry in that index carries a `localPath`, and until this landed the
 * driver hashed each response body and threw it away — so the path named a file
 * that had never been written, for every asset, in every capture. Nothing
 * failed. §7.6's job is to find a skipped control's handler *in the captured
 * source*, and the source was not there; the category read vacuous and 0024
 * spent two turns attributing that to the wrong place.
 *
 * The shape of the failure is the one §13 keeps naming: **an artifact that
 * describes something it does not contain**. A reader cannot tell the
 * difference between "the file is missing" and "I have not looked yet" without
 * looking, and nothing was looking.
 *
 * Both sides arrive as parameters. The index side is what the run intends to
 * write; the disk side is what a directory listing actually holds, produced by
 * a plain readdir rather than by the writer's own record of what it wrote — a
 * writer that silently skipped a file would otherwise agree with itself.
 */

export interface AssetBodyReport {
  /** Indexed, and no file on disk. The `localPath` lie, itemised. */
  readonly indexedWithoutFile: readonly string[];
  /** On disk, and in no entry. An orphan nothing can reach or clean up. */
  readonly fileWithoutEntry: readonly string[];
  /** Stored bytes whose hash is not the name they are filed under. */
  readonly misaddressed: readonly string[];
}

export interface IndexedAsset {
  readonly localPath: string;
  /** The hash of the bytes actually written, which is the wire hash unless redacted. */
  readonly storedSha256: string;
}

/**
 * Reconcile the index against the directory, both ways.
 *
 * Both ways and not as counts: §13's scope rule, in a smaller place. Equal
 * totals with one file missing and one orphan present is a green aggregate over
 * two real defects, and this has already happened once in this repository at a
 * larger scale.
 */
export function assessAssetBodies(input: {
  readonly entries: readonly IndexedAsset[];
  /** Paths relative to the capture root, as found on disk. */
  readonly onDisk: readonly string[];
  /** `localPath` → sha256 of the bytes read back from disk. */
  readonly hashOnDisk: Readonly<Record<string, string>>;
}): AssetBodyReport {
  const disk = new Set(input.onDisk);
  const indexed = new Set(input.entries.map((e) => e.localPath));

  const indexedWithoutFile = input.entries
    .filter((e) => !disk.has(e.localPath))
    .map((e) => e.localPath);

  const fileWithoutEntry = input.onDisk.filter((path) => !indexed.has(path));

  // Content addressing is a claim that can be checked, so it is checked. A
  // scrubbed body is filed under the *wire* hash deliberately — that is the
  // asset's identity — so the comparison is against `storedSha256`, which the
  // entry states, and not against the filename.
  const misaddressed = input.entries
    .filter((e) => {
      const actual = input.hashOnDisk[e.localPath];
      return actual !== undefined && actual !== e.storedSha256;
    })
    .map((e) => e.localPath);

  return {
    indexedWithoutFile: [...indexedWithoutFile].sort(),
    fileWithoutEntry: [...fileWithoutEntry].sort(),
    misaddressed: [...misaddressed].sort(),
  };
}
