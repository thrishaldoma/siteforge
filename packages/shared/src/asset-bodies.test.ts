/**
 * The reconciliation, driven to each verdict on synthetic input.
 *
 * The gate exists because `assets/index.json` claimed a `localPath` for a file
 * that was never written, in every capture, and nothing failed. So the test
 * that matters is the one where the index looks perfectly well-formed and the
 * directory is empty — which is exactly the state the repository was in.
 */
import { describe, expect, it } from 'vitest';
import { assessAssetBodies, isTextualAsset } from './index.js';

const hash = (n: string): string => n.repeat(64).slice(0, 64);
const entry = (sha: string, ext = 'javascript') => ({
  localPath: `assets/files/${sha}.${ext}`,
  storedSha256: sha,
});

describe('the index and the directory are reconciled both ways', () => {
  it('passes when every entry has its file and every file has its entry', () => {
    const a = entry(hash('a'));
    const report = assessAssetBodies({
      entries: [a],
      onDisk: [a.localPath],
      hashOnDisk: { [a.localPath]: a.storedSha256 },
    });
    expect(report).toEqual({ indexedWithoutFile: [], fileWithoutEntry: [], misaddressed: [] });
  });

  it('catches the state the repository was actually in: a full index over an empty directory', () => {
    const report = assessAssetBodies({
      entries: [entry(hash('a')), entry(hash('b'))],
      onDisk: [],
      hashOnDisk: {},
    });
    expect(report.indexedWithoutFile).toHaveLength(2);
    // And says nothing false about the other direction.
    expect(report.fileWithoutEntry).toEqual([]);
  });

  it('catches an orphan file no entry points at', () => {
    const a = entry(hash('a'));
    const report = assessAssetBodies({
      entries: [a],
      onDisk: [a.localPath, `assets/files/${hash('c')}.css`],
      hashOnDisk: { [a.localPath]: a.storedSha256 },
    });
    expect(report.fileWithoutEntry).toEqual([`assets/files/${hash('c')}.css`]);
  });

  it('reports BOTH directions rather than a count that nets them out', () => {
    // §13's scope rule in a smaller place: one missing and one orphan is a
    // green aggregate over two real defects.
    const report = assessAssetBodies({
      entries: [entry(hash('a'))],
      onDisk: [`assets/files/${hash('b')}.js`],
      hashOnDisk: { [`assets/files/${hash('b')}.js`]: hash('b') },
    });
    expect(report.indexedWithoutFile).toHaveLength(1);
    expect(report.fileWithoutEntry).toHaveLength(1);
  });

  it('catches a file whose bytes are not what the entry says was stored', () => {
    const a = entry(hash('a'));
    const report = assessAssetBodies({
      entries: [a],
      onDisk: [a.localPath],
      hashOnDisk: { [a.localPath]: hash('d') },
    });
    expect(report.misaddressed).toEqual([a.localPath]);
  });

  it('does not call a missing file misaddressed as well — one defect, one finding', () => {
    const a = entry(hash('a'));
    const report = assessAssetBodies({ entries: [a], onDisk: [], hashOnDisk: {} });
    expect(report.misaddressed).toEqual([]);
  });
});

describe('only text is handed to the scrubber', () => {
  it('accepts the bodies §7.6 has to search', () => {
    for (const mime of ['text/javascript', 'application/javascript', 'text/css', 'application/json', 'text/html']) {
      expect(isTextualAsset(mime), mime).toBe(true);
    }
  });

  it('accepts SVG, which is markup wearing an image type', () => {
    // The one image kind that can carry a URL, a script or an email. Decided by
    // the `+xml` suffix, not by the type — a rule keyed on `image/` would send
    // this to the binary path and leave it unredacted.
    expect(isTextualAsset('image/svg+xml')).toBe(true);
  });

  it('refuses the containers a substitution would corrupt', () => {
    for (const mime of ['image/jpeg', 'image/png', 'font/woff2', 'video/mp4', 'application/octet-stream']) {
      expect(isTextualAsset(mime), mime).toBe(false);
    }
  });

  it('ignores parameters, so a charset does not change the answer', () => {
    expect(isTextualAsset('text/javascript; charset=utf-8')).toBe(true);
  });
});
