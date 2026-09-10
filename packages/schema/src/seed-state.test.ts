/**
 * The seed identity, driven to each of its verdicts on synthetic input.
 *
 * §13: a gate takes its inputs as parameters and something other than the real
 * run has to be able to call it. Every case here is three strings, so nothing
 * about this file needs a container.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  computeSeedStateId,
  sameSeedState,
  seedProgramHash,
  seedStateIdFrom,
  seedStateLabel,
  type SeedState,
} from './seed-state.js';
import { CaptureManifestSchema } from './manifest.js';

const INPUTS = {
  imageDigest: 'vikunja/vikunja@sha256:ed1f3ed4',
  program: 'async seed() { await call("/register"); }',
  account: 'sfadmin',
};

const seeded = (overrides: Partial<Extract<SeedState, { source: 'fixture-seed' }>> = {}): SeedState => {
  const base = {
    source: 'fixture-seed' as const,
    imageDigest: INPUTS.imageDigest,
    programHash: seedProgramHash(INPUTS.program),
    account: INPUTS.account,
    label: 'vikunja fixture seed',
  };
  const merged = { ...base, ...overrides };
  return { ...merged, id: overrides.id ?? seedStateIdFrom(merged) };
};

describe('the seed state id', () => {
  it('moves when the program moves', () => {
    const before = computeSeedStateId(INPUTS);
    const after = computeSeedStateId({ ...INPUTS, program: `${INPUTS.program} // and one more call` });
    expect(after).not.toBe(before);
  });

  it('moves when the image moves, with the program held still', () => {
    expect(computeSeedStateId({ ...INPUTS, imageDigest: 'vikunja/vikunja@sha256:0000' }))
      .not.toBe(computeSeedStateId(INPUTS));
  });

  it('moves when the account moves', () => {
    expect(computeSeedStateId({ ...INPUTS, account: 'someone-else' }))
      .not.toBe(computeSeedStateId(INPUTS));
  });

  /**
   * The control. §13: a table made only of drops proves nothing about
   * isolation — a gate that fires on *any* change satisfies every row above.
   * Re-running the same seed program against the same image must produce the
   * same id, or the identity is a timestamp and every comparison refuses.
   */
  it('does NOT move when the same inputs are hashed again', () => {
    expect(computeSeedStateId(INPUTS)).toBe(computeSeedStateId({ ...INPUTS }));
  });

  /**
   * The joining is not concatenation. `a|b` and `ab|` are one string under
   * concatenation and two different seeds — the identifier-grammar family §13
   * keeps finding, here in three fields rather than in a path.
   */
  it('does not collide when a boundary moves between two fields', () => {
    const left = seedStateIdFrom({ imageDigest: 'ab', programHash: 'c', account: 'd' });
    const right = seedStateIdFrom({ imageDigest: 'a', programHash: 'bc', account: 'd' });
    expect(left).not.toBe(right);
  });

  it('recomputes from what the artifact carries, not from the program', () => {
    expect(seedStateIdFrom({
      imageDigest: INPUTS.imageDigest,
      programHash: seedProgramHash(INPUTS.program),
      account: INPUTS.account,
    })).toBe(computeSeedStateId(INPUTS));
  });
});

describe('sameSeedState', () => {
  it('agrees for two captures of one seeded instance', () => {
    expect(sameSeedState(seeded(), seeded())).toBe(true);
  });

  it('refuses across a seed change', () => {
    expect(sameSeedState(seeded(), seeded({ programHash: seedProgramHash('different') }))).toBe(false);
  });

  /**
   * `unseeded` is never equal to anything, including itself.
   *
   * Two crawls of a target nobody seeded carry no evidence that the target held
   * still between them. Treating the absence of a seed as a shared identity is
   * the silent comparison the whole module exists to refuse, and it is the one
   * an `===` on an optional field would have got wrong.
   */
  it('refuses two unseeded captures of each other', () => {
    const a: SeedState = { source: 'unseeded', reason: 'a live site nobody owns' };
    expect(sameSeedState(a, { ...a })).toBe(false);
  });

  it('refuses a seeded capture against an unseeded one', () => {
    expect(sameSeedState(seeded(), { source: 'unseeded', reason: 'no fixture' })).toBe(false);
  });
});

/**
 * Built on the committed fixture rather than on a manifest typed out here.
 *
 * A hand-written one is a manifest in a shape no producer produces (0011), and
 * the first draft of this file proved it: three cases failed on a `modelVersion`
 * and a `runId` that had nothing to do with the seed, which is a test reporting
 * on its own fixture instead of on the subject.
 */
describe('the manifest recomputes the id', () => {
  const FIXTURE = JSON.parse(
    readFileSync(
      new URL('../fixtures/capture/northwind-supply/manifest.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;

  const manifest = (state: SeedState): unknown => ({ ...FIXTURE, seedState: state });

  it('accepts an id its own inputs produce', () => {
    expect(CaptureManifestSchema.safeParse(manifest(seeded())).success).toBe(true);
  });

  it('rejects a declared id the inputs do not support', () => {
    const result = CaptureManifestSchema.safeParse(manifest(seeded({ id: 'f'.repeat(64) })));
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('its own inputs produce');
  });

  it('accepts an unseeded capture, which has no id to recompute', () => {
    const state: SeedState = { source: 'unseeded', reason: 'a static marketing site' };
    expect(CaptureManifestSchema.safeParse(manifest(state)).success).toBe(true);
  });
});

describe('seedStateLabel', () => {
  it('names the seed and abbreviates the id', () => {
    expect(seedStateLabel(seeded())).toMatch(/^vikunja fixture seed \([0-9a-f]{12}…\)$/);
  });

  it('says why there is no seed rather than printing nothing', () => {
    expect(seedStateLabel({ source: 'unseeded', reason: 'a live site' })).toBe('unseeded — a live site');
  });
});
