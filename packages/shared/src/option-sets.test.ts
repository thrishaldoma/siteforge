import { describe, expect, it } from 'vitest';
import { countOptionSetsInDom, type OptionSetDomNode } from './option-sets.js';

const el = (
  tag: string,
  attributes: Record<string, string> = {},
  children: OptionSetDomNode[] = [],
): OptionSetDomNode => ({ nodeType: 'element', tag, attributes, children });

describe('countOptionSetsInDom', () => {
  it('counts a <select> that carries no name and no id', () => {
    // The regression itself. Vikunja's six selects carry only a Vue scoped-style
    // attribute, and `select[name], select[id]` matched none of them.
    const dom = el('body', {}, [
      el('select', { 'data-v-321f61a6': '' }, [el('option', { value: 'list' })]),
      el('select', { 'data-v-321f61a6': '' }, [el('option', { value: 'kanban' })]),
    ]);
    expect(countOptionSetsInDom(dom).selects).toBe(2);
  });

  it('counts a radio group once per name, not once per input', () => {
    const dom = el('form', {}, [
      el('input', { type: 'radio', name: 'mode' }),
      el('input', { type: 'radio', name: 'mode' }),
      el('input', { type: 'radio', name: 'other' }),
    ]);
    expect(countOptionSetsInDom(dom).radioGroups).toBe(2);
  });

  it('does not count a nameless radio, because it is not in a group', () => {
    // Not the same rule as <select>: HTML groups radios *by name*, so the
    // attribute is load-bearing here and incidental there.
    const dom = el('form', {}, [el('input', { type: 'radio' }), el('input', { type: 'radio', name: '' })]);
    expect(countOptionSetsInDom(dom).radioGroups).toBe(0);
  });

  it('finds controls at any depth, and ignores text nodes', () => {
    const dom = el('div', {}, [
      { nodeType: 'text' },
      el('div', {}, [el('fieldset', {}, [el('select', {})])]),
    ]);
    expect(countOptionSetsInDom(dom)).toEqual({ selects: 1, radioGroups: 0 });
  });

  it('returns zeroes for an absent tree rather than throwing', () => {
    expect(countOptionSetsInDom(null)).toEqual({ selects: 0, radioGroups: 0 });
  });
});
