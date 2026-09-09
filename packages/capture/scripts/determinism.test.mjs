/**
 * The manifest's determinism claim, checked against the shim that backs it.
 *
 * `capture-site.mjs` wrote `determinism.frozen: ['Date.now', 'performance.now',
 * 'Math.random', 'crypto.randomUUID']` into every manifest it produced, and
 * installed **no shim at all** — `rung3.mjs` and `spike-one-page.mjs` both had
 * one and this driver never did. Three crawls of one pinned digest then differed
 * in every `dom.json`, on Vikunja's avatar `<img>` and its cache-busting
 * `?size=50&=<Date.now()>`.
 *
 * §13: a derived field carries the evidence it was derived from. A list of
 * frozen globals is a claim about what the shim does, so it is checked against
 * the shim rather than typed twice and hoped over. Crude on purpose — it reads
 * the source and looks for the name — but a false pass needs someone to mention
 * a global without freezing it, which is a smaller lie than the one this stops.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'capture-site.mjs'), 'utf8');

const shimBody = (() => {
  const start = source.indexOf('const freezeClocks =');
  expect(start, 'capture-site.mjs has no freezeClocks').toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\n};', start));
})();

const claimed = (() => {
  const m = /const DETERMINISM_FROZEN = \[([^\]]*)\]/.exec(source);
  expect(m, 'capture-site.mjs has no DETERMINISM_FROZEN').not.toBeNull();
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

describe('the manifest claims exactly the clocks the shim freezes', () => {
  it('freezes every global it claims to freeze', () => {
    expect(claimed.length).toBeGreaterThan(3);
    for (const name of claimed) {
      // `Date.now` is frozen as a static on a subclass, so the member is what
      // appears in the source, not the dotted pair.
      const member = name.split('.').pop();
      expect(shimBody, `the manifest claims ${name} is frozen and the shim never touches it`)
        .toContain(member);
    }
  });

  it('installs the shim on the context chokepoint, not at a call site', () => {
    // Six contexts are created here. A shim installed next to one of them is a
    // shim missing from five, and the missing one is always whichever context
    // was added last — the same argument §13 makes about the escape guards.
    const guard = source.slice(source.indexOf('const guardContext ='));
    expect(guard.slice(0, 400)).toContain('addInitScript(freezeClocks');
    // And nowhere else, or there are two policies again.
    expect(source.split('addInitScript(').length - 1).toBe(1);
  });

  it('every context this driver opens goes through that chokepoint', () => {
    // The property the chokepoint depends on. A bare `browser.newContext(` that
    // is not wrapped is a context with a live clock and no origin guard.
    const bare = [...source.matchAll(/(?<!guardContext\(await )(?:browser|chromium)\.newContext\(/g)];
    expect(bare.map((m) => source.slice(Math.max(0, m.index - 60), m.index + 20))).toEqual([]);
  });

  it('the manifest reads the constant rather than repeating the list', () => {
    const manifest = source.slice(source.indexOf("write('manifest.json'"));
    expect(manifest).toContain('frozen: DETERMINISM_FROZEN');
    expect(manifest).toContain('frozenEpochMs: FROZEN_EPOCH_MS');
  });
});
