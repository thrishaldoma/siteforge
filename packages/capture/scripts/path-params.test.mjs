/**
 * A path parameter has a name, not a placeholder.
 *
 * Every hole used to be `:id`, so `/projects/2/views/3/tasks` normalised to
 * `/projects/:id/views/:id/tasks` — two parameters indistinguishable from each
 * other, which costs codegen a route it cannot generate (`params.id` twice) and
 * costs any reader the ability to say which hole is which.
 *
 * **The property under test is distinctness and readability, not agreement with
 * any document.** Measured against Vikunja's own OpenAPI document, which is
 * internally inconsistent about this — `/projects/{id}`, `/projects/{projectID}`
 * and `/projects/{project}` all appear for the same resource — the old `:id`
 * was right 3 times in 5 and this rule is right once. `path-param-naming` is
 * ungated for exactly that reason, and the score is expected to fall.
 */
import { describe, expect, it } from 'vitest';
import { normalizePath } from './infer-endpoints.mjs';

const names = (path) => normalizePath(path).params.map((p) => p.name);

describe('a hole is named after the collection that precedes it', () => {
  it('names each hole distinctly in a nested resource', () => {
    // The defect, on the first real site this project crawled that has one.
    const { pattern } = normalizePath('/api/v1/projects/2/views/3/tasks');
    expect(pattern).toBe('/api/v1/projects/:project/views/:view/tasks');
    expect(names('/api/v1/projects/2/views/3/tasks')).toEqual(['project', 'view']);
  });

  it('singularises the collection, including the -ies and -ses forms', () => {
    expect(names('/api/entries/9')).toEqual(['entry']);
    expect(names('/api/addresses/9')).toEqual(['address']);
    expect(names('/api/todos/td_1')).toEqual(['todo']);
    // Not over-singularised. A trailing `s` is not always a plural, and an
    // over-stripped name is worse than an unstripped one because it is not a
    // word: `statu`, `analysi`, `bu`.
    expect(names('/api/status/9')).toEqual(['status']);
    expect(names('/api/analysis/9')).toEqual(['analysis']);
    expect(names('/api/progress/9')).toEqual(['progress']);
  });

  it('never emits the same name twice in one pattern', () => {
    // The property being bought. Two holes under the same collection name is
    // the one case the rule cannot resolve from the path, so it is made
    // positional rather than allowed to collide.
    expect(names('/api/items/1/items/2')).toEqual(['item', 'item2']);
    const { pattern } = normalizePath('/api/items/1/items/2');
    expect(new Set(pattern.split('/').filter((s) => s.startsWith(':'))).size).toBe(2);
  });

  it('falls back to `id` where nothing names a resource', () => {
    // A hole in first position, and one preceded by another hole: there is
    // nothing to name it after, and inventing a name would be worse than the
    // placeholder.
    expect(names('/9')).toEqual(['id']);
    expect(names('/api/things/1/2')).toEqual(['thing', 'id']);
  });

  it('does not name a hole after a version segment', () => {
    // The rule rests on "the segment before an identifier is the resource it
    // identifies", and a version segment is a counterexample rather than an
    // exception: `:v1` would be a wrong name, not merely an unhelpful one.
    expect(normalizePath('/api/v1/8').pattern).toBe('/api/v1/:id');
    expect(normalizePath('/api/v2/8').pattern).toBe('/api/v2/:id');
    // And `v1` as a *literal* segment is untouched — only holes are named.
    expect(normalizePath('/api/v1/projects').pattern).toBe('/api/v1/projects');
  });

  it('keeps the observed value beside the name it was given', () => {
    // §5: the examples are what §7.4 reads foreign keys off, by value overlap.
    // A name without its values, or values without their position, would break
    // that — and the schema cross-checks the pattern against this list.
    expect(normalizePath('/api/v1/tasks/1/comments/5').params).toEqual([
      { name: 'task', value: '1' },
      { name: 'comment', value: '5' },
    ]);
  });

  it('leaves the path shape untouched, so endpoint identity does not move', () => {
    // Identity is the positionally-normalised shape (0015 §2), and a renamed
    // parameter must not change it. This is the same property the grader's
    // `path-param-renamed` control asserts from the other side.
    const shape = (p) =>
      p.split('/').map((s) => (s.startsWith(':') ? '*' : s)).join('/');
    expect(shape(normalizePath('/api/v1/projects/2/views/3/tasks').pattern))
      .toBe('/api/v1/projects/*/views/*/tasks');
  });
});
