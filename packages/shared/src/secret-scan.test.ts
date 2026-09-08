/**
 * Sabotage tests for the §3.4 gate.
 *
 * §13: no gate lands without a test that plants the thing it exists to catch and
 * proves it fails. This one is worth more than most, because the leak it was
 * written for survived two rungs and a hand review: `network/*.har` carried
 * `Cookie: sid=sess_00000001` in the clear, and everything looked green.
 */
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { SECRET_RULES, scanCaptureTree, scanText, credentialLiterals } from './secret-scan.js';

/**
 * One planted credential per rule. The completeness assertion at the bottom
 * requires this to cover `SECRET_RULES` exactly, so a rule added without a test
 * fails the suite — the same mechanism the coverage invariants use, for the same
 * reason: §13's rule was "followed by hand" there too, right up until an audit
 * found none of the nine had a test.
 */
const PLANTED: Record<string, string> = {
  'cookie-header': 'Cookie: sid=sess_00000001; Path=/',
  'authorization-header': 'Authorization: Basic dXNlcjpwYXNzd29yZA==',
  'bearer-token': 'Bearer abcdefghijklmnopqrstuvwxyz012345',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  'session-cookie-value': 'set-cookie: session=abc123def456; HttpOnly',
  'private-key': '-----BEGIN RSA PRIVATE KEY-----',
  'vendor-token': 'AKIAIOSFODNN7EXAMPLE',
};

const roots: string[] = [];
const makeTree = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'sf-secret-'));
  roots.push(root);
  mkdirSync(join(root, 'network'), { recursive: true });
  mkdirSync(join(root, 'routes', 'root--anon-desktop--i0'), { recursive: true });
  mkdirSync(join(root, 'auth'), { recursive: true });
  // A scrubbed HAR: header NAMES survive, because §8's session check needs to
  // know a credential was required. Only values go.
  writeFileSync(join(root, 'network', 'session.har'), JSON.stringify({
    log: { entries: [{ request: { headers: [{ name: 'Cookie', value: '[REDACTED]' }], cookies: [{ name: 'sid', value: '[REDACTED]' }] } }] },
  }));
  writeFileSync(join(root, 'routes', 'root--anon-desktop--i0', 'dom.json'), JSON.stringify({ root: { tag: 'html' } }));
  writeFileSync(join(root, 'auth', 'storage-state.json'), JSON.stringify({ cookies: [{ name: 'sid', value: 'sess_00000001' }] }));
  chmodSync(join(root, 'auth', 'storage-state.json'), 0o600);
  return root;
};

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/**
 * A minimal but real PNG carrying a `tEXt` chunk.
 *
 * A screenshot is exactly where a credential rides along unnoticed: capture
 * tooling writes URLs and headers into image metadata all the time, and nobody
 * greps a PNG. What this proves is that binary files are scanned at all, not
 * skipped by extension — see the offset test below for what `latin1` buys.
 */
function pngWithTextChunk(keyword: string, value: string): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', Buffer.from(`${keyword}\0${value}`, 'latin1')),
    chunk('IDAT', deflateSync(Buffer.from([0x00, 0x00]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('the §3.4 secret gate fails the run on a planted credential', () => {
  it('passes a capture tree that was actually scrubbed', () => {
    expect(scanCaptureTree(makeTree(), { env: {} })).toEqual([]);
  });

  it('fails on a live Cookie value in a HAR — the leak that survived two rungs', () => {
    const root = makeTree();
    writeFileSync(join(root, 'network', 'session.har'), JSON.stringify({
      log: { entries: [{ request: { headers: [{ name: 'Cookie', value: 'sid=sess_00000001' }] } }] },
    }));
    const findings = scanCaptureTree(root, { env: {} });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.map((f) => f.rule)).toContain('session-cookie-value');
    expect(findings[0]!.file).toBe('network/session.har');
  });

  it('fails on a credential in PNG metadata — binary files are not skipped', () => {
    const root = makeTree();
    writeFileSync(
      join(root, 'routes', 'root--anon-desktop--i0', 'shot.full.png'),
      pngWithTextChunk('Comment', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'),
    );
    const findings = scanCaptureTree(root, { env: {} });
    expect(findings.map((f) => f.rule)).toContain('bearer-token');
    expect(findings[0]!.file).toBe('routes/root--anon-desktop--i0/shot.full.png');
  });

  it('fails on the literal value of SITEFORGE_PASS (§3.3)', () => {
    const root = makeTree();
    writeFileSync(join(root, 'routes', 'root--anon-desktop--i0', 'dom.json'),
      JSON.stringify({ value: 'hunter2-correct-horse' }));
    const findings = scanCaptureTree(root, { env: { SITEFORGE_PASS: 'hunter2-correct-horse' } });
    expect(findings.map((f) => f.rule)).toEqual(['env-credential']);
  });

  it('fails when storage-state is not mode 0600 rather than scanning it', () => {
    // The one file allowed to hold a credential has to prove it is protected.
    const root = makeTree();
    chmodSync(join(root, 'auth', 'storage-state.json'), 0o644);
    const findings = scanCaptureTree(root, { env: {} });
    expect(findings.map((f) => f.rule)).toEqual(['storage-state-mode']);
    expect(findings[0]!.excerpt).toBe('0644');
  });

  it.each([
    ['a JWT', 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'jwt'],
    ['an Authorization header', 'Authorization: Basic dXNlcjpwYXNzd29yZA==', 'authorization-header'],
    ['a Set-Cookie', 'set-cookie: session=abc123def456; HttpOnly', 'session-cookie-value'],
    ['a private key', '-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['a vendor token', 'AKIAIOSFODNN7EXAMPLE', 'vendor-token'],
  ])('catches %s', (_label, text, rule) => {
    expect(scanText('f.json', text).map((f) => f.rule)).toContain(rule);
  });

  it('reports a true byte offset, which is what latin1 is for', () => {
    // Not findability — a utf8 decode would locate this too, because the decoder
    // never swallows a following ASCII byte. It is the *position*: every
    // multi-byte sequence ahead of the match shifts a utf8 string index away
    // from the byte offset, and a finding pointing at the wrong place in a 40MB
    // HAR is not much of a finding.
    const root = makeTree();
    const prefix = '"title":"café — naïve résumé","h":"';
    const body = Buffer.from(`${prefix}Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345"`, 'utf8');
    writeFileSync(join(root, 'network', 'session.har'), body);
    const finding = scanCaptureTree(root, { env: {} }).find((f) => f.rule === 'bearer-token')!;
    const byteOffset = body.indexOf('Bearer');
    expect(finding.offset).toBe(byteOffset);
    // …and the utf8 string index is genuinely different, by exactly the number
    // of extra bytes the multi-byte characters ahead of it occupy.
    const utf8Index = body.toString('utf8').indexOf('Bearer');
    const extraBytes = Buffer.byteLength(prefix, 'utf8') - prefix.length;
    expect(extraBytes).toBeGreaterThan(0);
    expect(utf8Index).toBe(byteOffset - extraBytes);
  });

  it('does not trip on a header recorded by name only, which §8 needs', () => {
    // `params.headers` records presence and sensitivity, never values. If the
    // gate flagged that, the only way to pass would be to stop recording the
    // thing codegen's session check depends on.
    const byNameOnly = JSON.stringify({ headers: [{ name: 'cookie', required: true, sensitive: true }] });
    expect(scanText('endpoints.json', byNameOnly)).toEqual([]);
  });

  it('ignores short or absent env credentials rather than matching everywhere', () => {
    expect(credentialLiterals({ SITEFORGE_PASS: 'ab' })).toEqual([]);
    expect(credentialLiterals({})).toEqual([]);
  });

  it.each(Object.entries(PLANTED))('%s is caught when planted', (rule, text) => {
    expect(scanText('artifact.json', text).map((f) => f.rule)).toContain(rule);
  });

  it('has a planted credential for every rule that exists', () => {
    // Without this, a rule added to SECRET_RULES needs no test, and §13's
    // convention goes back to being followed by hand.
    expect(Object.keys(PLANTED).sort()).toEqual(SECRET_RULES.map((r) => r.id).sort());
  });

  it('never prints the credential it found', () => {
    const findings = scanText('f.har', 'Cookie: sid=sess_00000001supersecrettail');
    for (const f of findings) expect(f.excerpt).not.toContain('supersecrettail');
  });
});
