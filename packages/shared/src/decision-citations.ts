/**
 * Every decision a source file cites has a document behind it.
 *
 * Found by the numbering audit: `docs/decisions/` skips 0036 and 0042, and
 * both numbers are cited from source — `0036` from the enum ladder's
 * unranked-veto test, `0042` from eight places across `binding.ts`,
 * `control-binding.ts`, `semantic-edit.ts` and `probe-contamination.ts`.
 * Neither was ever created and neither was ever deleted, so this is not a
 * withdrawal: **the decision was made, the code landed, the record was
 * never assembled.** The same shape as `GAPS.md`, one level up.
 *
 * A citation pointing at nothing is worse than no citation, because it reads
 * as a pointer to reasoning a reader could go and check. §13: a known gap
 * recorded only in prose is not tracked — and a gap recorded as a pointer to
 * a document that does not exist is not even prose.
 *
 * Both directions, per §13's set-difference rule. A cited number with no
 * document is a dangling pointer; a document nothing cites is not an error —
 * plenty of decisions are read rather than referenced — so only the first
 * direction fails, and the second is reported so the asymmetry is visible
 * rather than assumed.
 */

export interface DecisionCitation {
  readonly number: string;
  readonly file: string;
  readonly line: number;
}

export interface DanglingCitation {
  readonly number: string;
  /** Every place that cites it, so the fix is one edit rather than a hunt. */
  readonly citedFrom: readonly string[];
}

/**
 * Decision references in a source text.
 *
 * Matches a four-digit number in a decision-ish context rather than every
 * four-digit run: a bare `0042` in a hash, a port or a byte count is not a
 * citation, and a matcher that took them all would be the substring-for-token
 * family (§13) and would be turned off within a week for noise.
 */
const CITATION_FORMS: readonly RegExp[] = [
  /\bdecisions?\s+(0\d{3})\b/g,
  /(?:^|[^\w$])\((0\d{3})\)/g,
  /\b(0\d{3})\s*§/g,
  /\bsee\s+(0\d{3})\b/g,
  // `(§7.5, 0036)` — a section and a decision cited together, which is how
  // the enum ladder's rulings are referenced and the form that hid 0036 from
  // the first version of this check.
  /§[\d.]+,\s*(0\d{3})\b/g,
];

export function findDecisionCitations(file: string, source: string): DecisionCitation[] {
  const out: DecisionCitation[] = [];
  const lines = source.split('\n');
  for (const [i, line] of lines.entries()) {
    // Four forms, each naming the decision *as* a decision. A bare
    // `\b0\d{3}\b` would take a port, a byte count and `toBe(0042)`, and a
    // matcher that noisy is one somebody turns off — which is a gate that
    // does not exist. The parenthesised form requires a non-word character
    // before the paren, so a call expression is not a citation.
    for (const re of CITATION_FORMS) {
      for (const m of line.matchAll(re)) {
        const number = m[1];
        if (number === undefined) continue;
        out.push({ number, file, line: i + 1 });
      }
    }
  }
  return out;
}

/** Cited numbers with no document, and documents nobody cites. */
export function assessDecisionCitations(input: {
  readonly citations: readonly DecisionCitation[];
  /** The four-digit prefixes present in `docs/decisions/`. */
  readonly documents: readonly string[];
}): { readonly dangling: DanglingCitation[]; readonly uncited: string[] } {
  const have = new Set(input.documents);
  const byNumber = new Map<string, string[]>();
  for (const c of input.citations) {
    if (have.has(c.number)) continue;
    const at = `${c.file}:${c.line}`;
    const list = byNumber.get(c.number);
    if (list === undefined) byNumber.set(c.number, [at]);
    else list.push(at);
  }
  const dangling = [...byNumber.entries()]
    .map(([number, citedFrom]) => ({ number, citedFrom }))
    .sort((a, b) => a.number.localeCompare(b.number));

  const cited = new Set(input.citations.map((c) => c.number));
  const uncited = input.documents.filter((d) => !cited.has(d)).sort();
  return { dangling, uncited };
}
