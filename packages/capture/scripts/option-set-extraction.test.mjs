/**
 * The option-set extractor takes every `<select>`, whatever it is spelled with.
 *
 * The query was `select[name], select[id]`. On the pinned Vikunja it matched
 * **none of six** — a Vue SPA binds through `v-model` and emits neither
 * attribute, so every one of them carried only `data-v-321f61a6`. Six `<select>`
 * elements and 632 `<option>`s in the captured DOM produced zero UI constraints,
 * which is §7.5's *primary* evidence for an enum, and nothing failed.
 *
 * Asserted against the source rather than by driving a browser, for the reason
 * `determinism.test.mjs` gives: the extractor is a page function that only
 * exists inside `page.evaluate`, so there is no seam to hand a DOM to. That
 * makes this crude, and the crudeness is bounded — a false pass needs the query
 * to *mention* an attribute filter it does not apply, which nobody writes.
 *
 * `countOptionSetsInDom` is the other half and is properly unit-tested: it
 * derives the observed side of `selects-imply-option-set-controls` from
 * `dom.json`, so the two sides of the invariant share no code. That separation
 * is the whole reason the invariant can fail — an observed side that asked the
 * page the same question would have returned zero too.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, 'capture-lib.mjs'), 'utf8');

/** Every `querySelectorAll` argument in the extractor, as written. */
const queries = [...source.matchAll(/querySelectorAll\('([^']+)'\)/g)].map((m) => m[1]);

describe('option-set extraction is not gated on an attribute', () => {
  it('queries selects by tag alone', () => {
    const selectQueries = queries.filter((q) => /(^|,\s*)select\b/.test(q));
    // An equality over the whole set, not `not.toContain('[name]')`: §13's
    // freeze rule. The weak form covers the one spelling someone thought of,
    // and `select[data-v-321f61a6]` would sail past it.
    expect(selectQueries).toEqual(['select']);
  });

  it('keeps the [name] requirement on radio groups, which is a different rule', () => {
    // HTML groups radios *by name* — it is what makes several inputs one
    // control. A nameless radio is not an option set with nothing to read; it
    // is not an option set. Dropping this requirement too would have been
    // consistency mistaken for correctness.
    expect(queries.filter((q) => q.includes('radio'))).toEqual(['input[type=radio][name]']);
  });

  it('emits a select that offers no usable option value, rather than dropping it', () => {
    // The count this feeds is compared against `dom.json` for equality, so a
    // silent decline here is indistinguishable from never having looked —
    // which is the state the whole change came out of. The consumer drops it.
    const block = source.slice(source.indexOf("querySelectorAll('select')"));
    const body = block.slice(0, block.indexOf('const radioGroups'));
    expect(body).not.toMatch(/if \(values\.length === 0\) continue;/);
    expect(body).toContain('constraints.push');
  });
});
