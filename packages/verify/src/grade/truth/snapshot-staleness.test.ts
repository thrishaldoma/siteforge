/**
 * The staleness gate, run offline.
 *
 * 0015 amendment 2: the milestone gate re-fetches the spec from the pinned
 * digest and diffs it against the committed snapshot, because a committed
 * snapshot is a cache and an unchecked cache drifts into testing a spec no
 * server serves.
 *
 * Until this file existed, that gate could not run without Docker — the
 * comparison sat downstream of a container boot inside `main()`. So the gate
 * that protects the ground truth was the one gate in the repo nobody had ever
 * seen fail, and an inverted comparison in it would have read exactly like a
 * working one. The three findings now take their inputs as parameters:
 * `main()` supplies bytes fetched from a container, this file supplies bytes
 * that disagree.
 *
 * Both directions, per §13: each finding is driven to fire, and a snapshot that
 * agrees is driven to produce nothing — a gate that objects to every input is as
 * uninformative as one that objects to none.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — a .mjs script with no type declarations. Importing it must
// not boot a container; `main()` is behind the entry-point guard.
import { assessSnapshot, PINS } from '../../../scripts/snapshot.mjs';

const PIN = PINS.gitea;

interface ProbeEntry {
  method: string;
  specPath: string;
  status: number | null;
}

const sha256 = (text: string): string =>
  createHash('sha256').update(Buffer.from(text)).digest('hex');

const SPEC = '{"swagger":"2.0","paths":{}}';
const PROBE: ProbeEntry[] = [
  { method: 'GET', specPath: '/version', status: 200 },
  { method: 'GET', specPath: '/user', status: 401 },
];

/** A snapshot where everything agrees. Each test breaks exactly one thing. */
const agreeing = () => ({
  servedSpec: Buffer.from(SPEC),
  committedSpec: Buffer.from(SPEC),
  committedPin: { specSha256: sha256(SPEC) },
  servedProbe: PROBE.map((e) => ({ ...e })),
  committedProbe: { entries: PROBE.map((e) => ({ ...e })) },
});

const rules = (findings: Array<{ rule: string }>): string[] => findings.map((f) => f.rule);

describe('the committed snapshot is what the pinned image serves', () => {
  it('says nothing when every side agrees', () => {
    expect(assessSnapshot(agreeing())).toEqual([]);
  });

  it('fires when the served document differs by a single byte', () => {
    // No normalisation and no tolerance: measured, two containers at this digest
    // served byte-identical documents, so any difference is a real change.
    const input = { ...agreeing(), servedSpec: Buffer.from(`${SPEC} `) };
    expect(rules(assessSnapshot(input))).toContain('spec-drift');
  });

  it('fires when pin.json was hand-edited away from the spec beside it', () => {
    const input = { ...agreeing(), committedPin: { specSha256: 'f'.repeat(64) } };
    expect(rules(assessSnapshot(input))).toEqual(['pin-disagrees']);
  });

  it('fires when the anonymous sweep moved, because the auth truth is built from it', () => {
    // §4: the auth truth side is measured, not declared. A 200 that becomes a
    // 401 silently rewrites which endpoints the grader believes are public.
    const input = agreeing();
    input.servedProbe[0]!.status = 401;
    const findings = assessSnapshot(input);
    expect(rules(findings)).toEqual(['probe-drift']);
    expect(findings[0]!.message).toContain('GET /version: 200 → 401');
  });

  it('fires when the sweep gained or lost an endpoint, not only when a status moved', () => {
    // A drift count of zero with a different sweep size is the case a
    // per-entry comparison alone would call clean.
    const input = agreeing();
    input.servedProbe.push({ method: 'GET', specPath: '/signing-key.gpg', status: 404 });
    expect(rules(assessSnapshot(input))).toEqual(['probe-drift']);
  });

  it('reports all three together rather than the first', () => {
    // §13: counts disaggregated to the granularity of the failure. Each names a
    // different repair — re-fetch, un-edit the pin, re-run the sweep.
    const input = {
      servedSpec: Buffer.from('{"swagger":"2.0"}'),
      committedSpec: Buffer.from(SPEC),
      committedPin: { specSha256: 'a'.repeat(64) },
      servedProbe: [],
      committedProbe: { entries: PROBE },
    };
    expect(rules(assessSnapshot(input)).sort()).toEqual(['pin-disagrees', 'probe-drift', 'spec-drift']);
  });

  it('the launch is pinned in the same file that fetches from it', () => {
    // Amendment 2: half of what a Swagger document says about itself is a
    // function of how the server was started, so a launch that varies produces a
    // diff meaning "the port moved" that reads as "the spec changed".
    expect(PIN.image).toMatch(/^gitea\/gitea@sha256:[0-9a-f]{64}$/);
    expect(Object.keys(PIN.env).length).toBeGreaterThan(0);
    expect(PIN.volatileFields).toEqual([]);
  });
});
