/**
 * The narrowing exclusion, and the checks that keep it from being tuning.
 *
 * Excluding `int64` from the narrowing denominator removed 22 of 40 recall
 * misses on the baseline slice. That is exactly the shape of tuning, and the
 * only thing separating it is that the exclusion is a property of the
 * vocabulary rather than of the score. This file is where that distinction stops
 * being an argument and becomes a check.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JsonStringFormatSchema } from '@siteforge/schema';
import { loadGiteaTruth } from './truth/gitea.js';
import {
  EXPRESSIBLE_FORMATS,
  UNEXPRESSIBLE_FORMATS,
  assessFormatVocabulary,
  isExpressibleFormat,
} from './vocabulary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = loadGiteaTruth();
const declaredFormats = truth.endpoints
  .flatMap((e) => [...e.responseFields, ...e.requestFields])
  .map((f) => f.format)
  .filter((f): f is string => f !== null);

describe('the exclusion predicate cannot depend on how anything scored', () => {
  it('imports nothing but the schema that defines the vocabulary', () => {
    // The whole import list, not the absence of one name. A reachable path to a
    // model, a report or a score is a path by which the exclusion could be made
    // a function of the misses it removes.
    const source = readFileSync(join(HERE, 'vocabulary.ts'), 'utf8');
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['@siteforge/schema']);
  });

  it('decides on a format string alone', () => {
    // A predicate that could see a field, an endpoint or a model is one that
    // could be narrowed later to whichever cases were scoring badly.
    const source = readFileSync(join(HERE, 'vocabulary.ts'), 'utf8');
    expect(source).toContain('isExpressibleFormat = (format: string): boolean');
  });

  it('derives the expressible set from the schema rather than restating it', () => {
    // A format added to JsonStringFormatSchema stops being excluded the day it
    // lands, not the day somebody remembers this file exists.
    expect([...EXPRESSIBLE_FORMATS].sort()).toEqual([...JsonStringFormatSchema.options].sort());
  });
});

describe('an exclusion is only legitimate when the vocabulary cannot make the claim', () => {
  it('excludes nothing the model can express', () => {
    // The anti-tuning assertion. Everything else here is bookkeeping; this is
    // the line between a vocabulary fact and a shrunk denominator.
    for (const entry of UNEXPRESSIBLE_FORMATS) {
      expect(isExpressibleFormat(entry.format), `${entry.format} is expressible`).toBe(false);
    }
  });

  it('objects when an excluded format turns out to be expressible', () => {
    // Driven to fire. The real list cannot produce this — if it could, the
    // assertion above would already have failed — so the input is synthetic,
    // which is the only way to watch this branch work at all.
    const problems = assessFormatVocabulary(
      ['email'],
      [{ format: 'email', reason: 'inconvenient: 396 of these and we matched none' }],
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('shrinking a denominator to remove misses');
  });

  it('gives every excluded family a reason about the vocabulary', () => {
    for (const entry of UNEXPRESSIBLE_FORMATS) {
      expect(entry.reason.length).toBeGreaterThan(60);
      // The reason has to be about what the model can say, not about the score.
      expect(entry.reason).toMatch(/SiteModel|JsonStringFormatSchema|model/);
    }
  });
});

describe('every format the truth declares is on one side, by name', () => {
  it('the pinned Gitea snapshot is completely classified', () => {
    expect([...new Set(declaredFormats)].sort()).toEqual(['date-time', 'email', 'int64', 'uint64']);
    expect(assessFormatVocabulary(declaredFormats)).toEqual([]);
  });

  it('objects to a format nobody has classified', () => {
    // A refresh introducing `int32`, or a second ground truth, fails the suite
    // until someone writes down which side it is on. Silence would drop it from
    // the narrowing denominator without anyone deciding to.
    const problems = assessFormatVocabulary([...declaredFormats, 'int32']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("declares format 'int32'");
    expect(problems[0]).toContain('Name it and say why');
  });

  it('says nothing about a truth that declares only expressible formats', () => {
    expect(assessFormatVocabulary(['date-time', 'email', 'uri'])).toEqual([]);
  });
});
