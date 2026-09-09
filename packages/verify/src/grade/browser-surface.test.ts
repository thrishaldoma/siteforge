/**
 * Can this ground truth ground anything a crawl produces?
 *
 * 0015 §1 chose Gitea because it publishes an OpenAPI document written by people
 * who were not us. It never asked whether Gitea's **browser** talks to that API,
 * and the answer, measured, is no: twelve pages of a seeded instance issue one
 * XHR — to a non-API path — and five form actions, none naming `/api/v1`.
 *
 * That is the modality rule one level up. A document grounds a claim about
 * declared shape; observation grounds a claim about runtime behaviour; and
 * **neither grounds a claim about a surface the crawl never reaches.** Infer's
 * input is a capture, so every endpoint it emits from a Gitea crawl is
 * out-of-universe, every scored category has an empty model side, and the grade
 * reports vacuous across the board. Not a bad score — no score.
 *
 * This test is the tracked form of that, and it is written to **fail if the
 * situation improves**: the same shape as the mutation harness's blocked row.
 * The day a Gitea release starts calling its own API from a page, or somebody
 * re-measures against a target that does, this turns red and says so rather
 * than leaving a stale "blocked" note nobody revisits. §13: a known gap is a
 * failing gate, a skipped test naming it, or it is not tracked at all.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isCandidateApiCall } from '../../scripts/browser-surface.mjs';
import { inUniverse } from './match.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

interface Surface {
  target: string;
  universe: string;
  verdict: string;
  signedIn: boolean;
  pages: string[];
  declaredOperations: number;
  xhr: string[];
  formActions: string[];
  describedByDocument: string[];
  staticAssetRequests: number;
}

/**
 * The grader's own filter, asked about an observed request.
 *
 * `inUniverse` rather than a prefix test on the string: the question is
 * literally "would the grader's universe filter exclude this", so borrowing the
 * predicate is the only way the answer stays true when it changes. A substring
 * test would also have called `/api/v1` itself out of `/api/v1`.
 */
const outsideUniverse = (entry: string, universe: string): boolean =>
  !inUniverse(entry.slice(entry.indexOf(' ') + 1), universe);

/** A universe that filters is a prefix the UI's own traffic falls outside of. */
const filtersAnything = (s: Surface): boolean =>
  s.universe !== '/' && [...s.xhr, ...s.formActions].some((e) => outsideUniverse(e, s.universe));

const read = (id: string): Surface =>
  JSON.parse(readFileSync(join(FIXTURES, id, 'browser-surface.json'), 'utf8')) as Surface;

const surface = read('gitea');

describe('the browser surface and the documented surface', () => {
  it('is a measurement, not a belief', () => {
    // The crawl it stands for, so "we looked somewhere else" cannot read as
    // "the site changed" — the same reason the snapshot script pins its launch.
    expect(surface.pages.length).toBeGreaterThan(10);
    expect(surface.xhr.length + surface.formActions.length).toBeGreaterThan(0);
  });

  it('does not meet, so Gitea cannot ground a model inferred from a crawl of it', () => {
    expect(surface.describedByDocument).toEqual([]);
    expect(surface.verdict).toBe('disjoint');
  });

  it('fails the day it stops being disjoint, rather than leaving a stale note', () => {
    // Deliberately the same shape as `identifier-mispointed`'s block: tied to a
    // fact, so the work it blocks gets unblocked by the suite rather than by
    // somebody remembering. If this assertion starts failing, delete it and
    // grade against Gitea.
    expect(
      surface.describedByDocument,
      'the browser now reaches the documented surface — the grade-against-Gitea path is unblocked, and this test should be deleted',
    ).toEqual([]);
  });

  it('and the criterion is not vacuous: two candidates pass it', () => {
    // Without this, "disjoint" could mean the measurement is broken rather than
    // that the target is. Same script, same comparison, a different answer:
    // Directus's admin SPA issues 24 requests and its document declares 17;
    // Vikunja issues 18 and its document declares 16.
    for (const id of ['directus', 'vikunja']) {
      const candidate = read(id);
      expect(candidate.verdict, id).toBe('overlapping');
      expect(candidate.describedByDocument.length, id).toBeGreaterThan(10);
    }
  });
});

describe('the second criterion, which Gitea satisfied silently', () => {
  /*
   * Passing the overlap test is not the same as being adoptable. Directus
   * serves its API at `/`, and `inUniverse` compares leading segments — so with
   * an empty base the filter admits every path in existence. It does not become
   * permissive; it stops existing, and `endpoint-identity.precision` absorbs
   * every `/admin` navigation the crawler made. 0019 records that as a blocker
   * rather than an open item.
   */
  it('a universe must be a prefix the browser traffic falls outside of', () => {
    expect(filtersAnything(read('vikunja')), 'vikunja').toBe(true);
    expect(filtersAnything(read('directus')), 'directus').toBe(false);
  });

  it('counts the universe root as inside it', () => {
    // No record holds a bare `GET /api/v1` today, so this edge is asserted
    // rather than observed: a substring test for `/api/v1/` would call the
    // universe's own root out-of-universe and report a filter that filters.
    // `/api/v11` is the other half — a prefix by characters, not by segments.
    expect(outsideUniverse('GET /api/v1', '/api/v1')).toBe(false);
    expect(outsideUniverse('GET /api/v1/projects', '/api/v1')).toBe(false);
    expect(outsideUniverse('GET /api/v11/projects', '/api/v1')).toBe(true);
    expect(outsideUniverse('GET /', '/api/v1')).toBe(true);
  });

  it('and Vikunja is the candidate that passes both', () => {
    const vikunja = read('vikunja');
    expect(vikunja.verdict).toBe('overlapping');
    expect(vikunja.universe).toBe('/api/v1');
    // The SPA shell is out-of-universe, which is the whole point: it is the
    // traffic a root universe would have scored as a hallucinated endpoint.
    expect(vikunja.xhr).toContain('GET /');
    expect(vikunja.describedByDocument).not.toContain('GET /');
  });
});

describe('the static-asset exclusion, and what keeps it from being tuning', () => {
  /*
   * Vikunja is a PWA: its service worker precaches 236 locale chunks and icons
   * as `fetch`, so `resourceType` cannot separate them and the denominator
   * became "how large is the JavaScript bundle". Excluding them is a shrunk
   * denominator, which is the shape of tuning — so the same three checks the
   * narrowing exclusion carries apply here.
   */
  it('reads the path and nothing else', () => {
    expect(isCandidateApiCall('/api/v1/projects')).toBe(true);
    expect(isCandidateApiCall('/assets/zh-CN-legacy-BVSd5i69.js')).toBe(false);
    expect(isCandidateApiCall('/manifest.webmanifest')).toBe(false);
    // A path with no extension is a candidate however dull it looks, and one
    // ending in an extension is not however much it looks like an endpoint.
    expect(isCandidateApiCall('/')).toBe(true);
    expect(isCandidateApiCall('/api/v1/export.xml')).toBe(false);
  });

  it('is inert against every verdict already committed', () => {
    // The anti-tuning assertion. An exclusion that changed an existing answer
    // would be an exclusion chosen for its effect on the answer.
    for (const id of ['gitea', 'directus', 'vikunja']) {
      const record = read(id);
      const dropped = [...record.xhr, ...record.formActions].filter(
        (entry) => !isCandidateApiCall(entry.slice(entry.indexOf(' ') + 1)),
      );
      expect(dropped, `${id}: the exclusion removes a path that was scored`).toEqual([]);
    }
  });

  it('a signed-in measurement shows more than the login screen', () => {
    // The state the script actually produced before the login check landed:
    // `/info` and `/login` and nothing else, from eight crawled login screens,
    // reported as a confident verdict. Reachable by definition — it was real —
    // so the fixture is checked for it rather than trusted.
    for (const id of ['directus', 'vikunja']) {
      const record = read(id);
      if (!record.signedIn) continue;
      const authenticated = record.xhr.filter((e) => !/\/(info|login|auth|health)$/.test(e));
      expect(
        authenticated.length,
        `${id}: a signed-in crawl that only reached the unauthenticated endpoints measured a login screen`,
      ).toBeGreaterThan(3);
    }
  });

  it('records what it cut, so the cut is visible in the fixture', () => {
    // 236 for Vikunja, 0 for the two that are not PWAs. A number nobody can
    // read is a denominator shrunk out of sight.
    expect(read('vikunja').staticAssetRequests).toBeGreaterThan(100);
    expect(read('gitea').staticAssetRequests).toBe(0);
  });
});
