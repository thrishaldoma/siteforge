/**
 * §7.6's rung table, each rung driven to a verdict on synthetic controls.
 *
 * Rank 5 fires **zero times** on the only real target (0041 §5), so without
 * these it would be a rung nobody can prove fires — §13's first vacuity mode,
 * and the reason `silentRungs` is in the report as well.
 */
import { describe, expect, it } from 'vitest';
import { assessControlBindings, type UrlTarget } from '@siteforge/shared';
import { urlBindingRungs, type BindableControl } from './binding.js';

const BASE = 'http://127.0.0.1:3803/';
const rungs = urlBindingRungs(BASE);

const control = (over: Partial<BindableControl> = {}): BindableControl => ({
  controlId: 'ctl_1',
  gapId: 'gap_1',
  routeId: 'r',
  tag: 'a',
  attributes: {},
  form: null,
  allowedOrigins: ['http://127.0.0.1:3803'],
  ...over,
});

const run = (c: BindableControl) => assessControlBindings({ controls: [c], rungs });
const target = (c: BindableControl): UrlTarget | undefined => run(c).bound[0]?.target;

describe('rank 1 — not a control', () => {
  it('declines a landmark', () => {
    // Deliberately without an href, so this row stays green under the
    // precedence sabotage and only the row named for precedence fails. §13:
    // the assertion must exclude what the broken version also outputs.
    const report = run(control({ tag: 'header', attributes: { 'aria-label': 'main navigation' } }));
    expect(report.bound).toEqual([]);
    expect(report.declined[0]).toMatchObject({ rank: 1, rung: 'not-a-control', reason: 'landmark' });
  });

  it('OUTRANKS href — a landmark with an href still binds nothing', () => {
    // The discriminating case. A filter applied after extraction would have
    // bound this and then removed it, or not removed it at all.
    expect(target(control({ tag: 'nav', attributes: { href: '/projects' } }))).toBeUndefined();
  });

  it('says nothing about an ordinary control', () => {
    expect(target(control({ tag: 'a', attributes: { href: '/projects' } }))?.path).toBe('/projects');
  });
});

describe('rank 2 — not ours', () => {
  it('declines another origin', () => {
    const report = run(control({ attributes: { href: 'https://vikunja.io' } }));
    expect(report.declined[0]).toMatchObject({ rank: 2, reason: 'external-origin' });
  });

  it('declines a non-http scheme', () => {
    expect(run(control({ attributes: { href: 'mailto:x@y.test' } })).declined[0]).toMatchObject({
      reason: 'non-http-scheme',
    });
  });

  it('declines a download', () => {
    expect(
      run(control({ attributes: { href: '/report.csv', download: '' } })).declined[0],
    ).toMatchObject({ reason: 'download' });
  });

  it('OUTRANKS form-action — an external form action binds nothing', () => {
    // 0041 §2.1's concrete reason the declines are ranks: this is a rank-3 hit.
    const report = run(
      control({ tag: 'button', form: { action: 'https://evil.test/submit', method: 'post' } }),
    );
    expect(report.bound).toEqual([]);
    expect(report.declined[0]).toMatchObject({ rank: 2, reason: 'external-origin' });
  });

  it('is not fooled by a prefix — 127.0.0.1.evil.test is not 127.0.0.1', () => {
    // §13's identifier rule: parsed, never prefix-tested. A `startsWith`
    // against the allow-list would admit this.
    const report = run(
      control({
        attributes: { href: 'https://127.0.0.1.evil.test/x' },
        allowedOrigins: ['http://127.0.0.1:3803'],
      }),
    );
    expect(report.declined[0]).toMatchObject({ reason: 'external-origin' });
  });

  it('is not fooled by a port prefix — :38030 is not :3803', () => {
    // The case a `startsWith` against the allow-list admits *and* that parses,
    // so it would go on to bind a path on a foreign origin.
    expect(run(control({ attributes: { href: 'http://127.0.0.1:38030/x' } })).declined[0])
      .toMatchObject({ reason: 'external-origin' });
  });

  it('catches a protocol-relative escape', () => {
    expect(run(control({ attributes: { href: '//evil.test/x' } })).declined[0]).toMatchObject({
      reason: 'external-origin',
    });
  });

  it('FAILS CLOSED on a URL that does not parse — no decline, and no binding', () => {
    // `https://127.0.0.1:3803.evil.test` has an invalid port, so it throws in
    // the parser and rank 2 has no origin to judge. It must not then fall
    // through and bind: rank 4 cannot parse it either, so the control is
    // unbound and the gap stands. The dangerous outcome here is a *binding*,
    // and there is none.
    const report = run(control({ attributes: { href: 'https://127.0.0.1:3803.evil.test/x' } }));
    expect(report.bound).toEqual([]);
    expect(report.unbound).toEqual(['ctl_1']);
  });

  it('THROWS on an empty allow-list rather than declaring everything foreign', () => {
    // `.every([])` is `true` and `includes` on an empty list is `false`; either
    // way an empty crawl scope would answer confidently. §13's empty-container
    // rule: it is the caller failing to say what it meant.
    expect(() => run(control({ attributes: { href: '/x' }, allowedOrigins: [] }))).toThrow(
      /no allowed origins/,
    );
  });
});

describe('rank 3 — form action', () => {
  it('binds the action with the declared method', () => {
    expect(target(control({ tag: 'button', form: { action: '/api/v1/tasks', method: 'post' } })))
      .toEqual({ kind: 'url', path: '/api/v1/tasks', method: 'POST' });
  });

  it("defaults to GET, which is HTML's rule rather than a guess", () => {
    expect(target(control({ tag: 'button', form: { action: '/search', method: null } })))
      .toEqual({ kind: 'url', path: '/search', method: 'GET' });
  });

  it('OUTRANKS href when a control has both', () => {
    const t = target(
      control({ attributes: { href: '/navigate' }, form: { action: '/submit', method: 'post' } }),
    );
    expect(t).toEqual({ kind: 'url', path: '/submit', method: 'POST' });
  });
});

describe('rank 4 — href', () => {
  it('binds a navigation as a GET', () => {
    expect(target(control({ attributes: { href: '/labels' } })))
      .toEqual({ kind: 'url', path: '/labels', method: 'GET' });
  });

  it('normalises with the same grammar capture uses for observed URLs', () => {
    // 0041 §3.1: one normaliser, or 0015 §2's shape match compares two
    // languages. `/projects/2` must become the pattern, not stay a URL.
    expect(target(control({ attributes: { href: '/projects/2' } }))?.path).toBe('/projects/:project');
  });

  it('leaves a non-id segment alone', () => {
    expect(target(control({ attributes: { href: '/projects/new' } }))?.path).toBe('/projects/new');
  });
});

describe('rank 5 — a URL literal on the control itself', () => {
  // Fires zero times on Vikunja (0041 §5). Driven here so it is not a rung
  // nobody can prove fires.
  it('binds a path held in a data attribute', () => {
    expect(target(control({ tag: 'button', attributes: { 'data-url': '/api/v1/tasks/9' } })))
      .toEqual({ kind: 'url', path: '/api/v1/tasks/:task', method: 'GET' });
  });

  it('ignores a data attribute that is not a path', () => {
    expect(target(control({ tag: 'button', attributes: { 'data-mode': 'compact' } }))).toBeUndefined();
  });

  it('DECLINES when two data attributes are both path-like, rather than taking the first', () => {
    // `Object.entries` order would otherwise decide — the duplicate-rank
    // throw's failure, one level down. 0015 §2: an ambiguity is reported,
    // never resolved by picking one.
    const report = run(
      control({ tag: 'button', attributes: { 'data-url': '/a', 'data-endpoint': '/b' } }),
    );
    expect(report.bound).toEqual([]);
    expect(report.declined[0]).toMatchObject({ rank: 5, reason: 'ambiguous-literal' });
  });

  it('IGNORES our own data-sf-* attributes', () => {
    // Reading back an attribute siteforge injected (0007) would be the
    // generated-fixture circularity, one attribute wide.
    expect(
      target(control({ tag: 'button', attributes: { 'data-sf-path': '/html/body/button' } })),
    ).toBeUndefined();
  });
});

describe('a control no rung speaks for', () => {
  it('is unbound, and the capture gap stands alone', () => {
    // The 10 Vikunja buttons. §7.6: "On failure the gap stands alone."
    const report = run(control({ tag: 'button', attributes: { class: 'button', type: 'button' } }));
    expect(report.unbound).toEqual(['ctl_1']);
    expect(report.bound).toEqual([]);
    expect(report.declined).toEqual([]);
  });

  it('is unbound when its node was not found in the DOM at all', () => {
    const report = run(control({ tag: null }));
    expect(report.unbound).toEqual(['ctl_1']);
  });
});

/**
 * Negative control (§13): a change the table could plausibly key on, and must
 * not.
 *
 * Renaming the control and moving it to another route changes every field the
 * rungs are handed except the ones they read. If any verdict moves, a rung is
 * reading something it did not declare.
 */
describe('control — identity and route do not move a verdict', () => {
  it('binds the same target for a differently-named control on another route', () => {
    const a = target(control({ controlId: 'ctl_a', routeId: 'root', attributes: { href: '/teams' } }));
    const b = target(
      control({ controlId: 'ctl_zzz', routeId: 'user-settings', attributes: { href: '/teams' } }),
    );
    expect(a).toEqual(b);
    expect(a).toEqual({ kind: 'url', path: '/teams', method: 'GET' });
  });
});
