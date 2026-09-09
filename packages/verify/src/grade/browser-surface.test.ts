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
}

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

  it('and the criterion is not vacuous: a candidate does pass it', () => {
    // Without this, "disjoint" could mean the measurement is broken rather than
    // that the target is. Directus's admin SPA issues 24 requests and its own
    // OpenAPI document declares 17 of them — the same script, the same
    // comparison, a different answer.
    const directus = read('directus');
    expect(directus.verdict).toBe('overlapping');
    expect(directus.describedByDocument.length).toBeGreaterThan(10);
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
});
