/**
 * The class names a stylesheet's state rules actually use.
 *
 * This is the fast gate for round 8's bug in its latest disguise. The probe's
 * detector asked whether the joined selector text *contained* a class name;
 * `.todo[data-flagged="true"]` contains "flag", so a new class `flag` looked
 * already explained by CSS and the probed state was discarded. Measured on
 * rung 3: statesProbed 2 where it should be 3.
 */
import { describe, expect, it } from 'vitest';
import { selectorClassNames } from './capture-lib.mjs';

describe('selector class names are parsed, not searched for', () => {
  it('returns the class tokens a selector uses', () => {
    const names = selectorClassNames(['.btn:hover', '.todo[data-done="true"] .title']);
    expect([...names].sort()).toEqual(['btn', 'title', 'todo']);
  });

  it('does not report a class merely contained in an attribute name', () => {
    // The exact collision the rung-3 fixture now inflicts.
    const names = selectorClassNames(['.todo[data-flagged="true"] .title']);
    expect(names.has('flag')).toBe(false);
    expect(names.has('flagged')).toBe(false);
    expect(names.has('todo')).toBe(true);
  });

  it('does not report a class merely contained in a longer class', () => {
    const names = selectorClassNames(['.is-open', '.opened']);
    expect(names.has('open')).toBe(false);
    expect(names.has('is-open')).toBe(true);
  });

  it('ignores ids, elements and pseudo-classes', () => {
    const names = selectorClassNames(['#panel', 'a:visited', 'div > span']);
    expect([...names]).toEqual([]);
  });

  it('treats an unparseable selector as contributing nothing', () => {
    // The safe direction: a class then looks *unexplained* and gets probed.
    // An extra probed state is noise; a missing one is a silent drop.
    // `.a)` is a selector the parser genuinely throws on — measured, because
    // postcss-selector-parser is lenient about most malformed input and
    // happily returns a junk token for `.a{` rather than raising.
    expect([...selectorClassNames(['.a)', '.real'])].sort()).toEqual(['real']);
  });

  it('never claims a real class from a malformed selector', () => {
    // The property that actually matters about leniency: junk tokens are
    // harmless because they cannot equal a class the page uses.
    for (const junk of ['.a{', '.a..b', '@media', '[']) {
      expect(selectorClassNames([junk]).has('real')).toBe(false);
    }
  });

  it('is empty for an empty sheet, rather than matching everything', () => {
    expect([...selectorClassNames([])]).toEqual([]);
  });
});
