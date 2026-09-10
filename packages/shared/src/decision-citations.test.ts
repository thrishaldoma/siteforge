import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessDecisionCitations, findDecisionCitations } from './decision-citations.js';
import { REPO_SOURCE_EXPECTATION, walkFiles } from './scan-walker.js';

const REPO = join(import.meta.dirname, '..', '..', '..');

const documents = (): string[] =>
  readdirSync(join(REPO, 'docs', 'decisions'))
    .filter((n) => /^\d{4}-/.test(n))
    .map((n) => n.slice(0, 4));

describe('findDecisionCitations', () => {
  it('catches the forms this repository actually writes', () => {
    const found = findDecisionCitations('x.ts', [
      '// decision 0011 says so',
      ' * Every match, never a chosen one (0042). Two path-like attributes',
      ' * 0023 §3.1 attributes them by hand.',
      ' * see 0038 for the raster states',
    ].join('\n'));
    expect(found.map((c) => c.number)).toEqual(['0011', '0042', '0023', '0038']);
  });

  /**
   * The negative control (§13). A four-digit run that is not a citation must
   * not be one: a matcher that took every `\b0\d{3}\b` would flag a port, a
   * byte count and half of every hash, and would be switched off for noise
   * within a week — which is a gate that does not exist.
   */
  it('does NOT match a four-digit number that is not a citation', () => {
    const found = findDecisionCitations('x.ts', [
      'const port = 8080;',
      'expect(total).toBe(0042);',
      'const hash = "0038abcd";',
      'width: 0100px',
    ].join('\n'));
    expect(found).toEqual([]);
  });
});

describe('assessDecisionCitations', () => {
  it('FAILS a citation with no document behind it', () => {
    const { dangling } = assessDecisionCitations({
      citations: [
        { number: '0042', file: 'a.ts', line: 3 },
        { number: '0042', file: 'b.ts', line: 9 },
      ],
      documents: ['0041', '0043'],
    });
    expect(dangling).toHaveLength(1);
    expect(dangling[0]?.number).toBe('0042');
    expect(dangling[0]?.citedFrom).toEqual(['a.ts:3', 'b.ts:9']);
  });

  it('reports an uncited document without failing it', () => {
    const { dangling, uncited } = assessDecisionCitations({
      citations: [{ number: '0041', file: 'a.ts', line: 1 }],
      documents: ['0041', '0043'],
    });
    expect(dangling).toEqual([]);
    expect(uncited).toEqual(['0043']);
  });

  /**
   * The gate, over the real tree. This is what the numbering audit found:
   * 0036 and 0042 cited from eight places, neither ever written.
   */
  it('every decision this repository cites has a document', () => {
    const { files, relative } = walkFiles({
      root: REPO, profile: 'source', expect: REPO_SOURCE_EXPECTATION,
    });
    const citations = files.flatMap((abs, i) =>
      findDecisionCitations(relative[i] ?? abs, readFileSync(abs, 'utf8')));
    expect(citations.length).toBeGreaterThan(50);
    const { dangling } = assessDecisionCitations({ citations, documents: documents() });
    expect(dangling.map((d) => `${d.number} (cited from ${d.citedFrom.length})`)).toEqual([]);
  });
});
