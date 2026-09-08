/**
 * §3.4, as code.
 *
 * "`capture/` is treated as sensitive: it is gitignored, and the scrubber ...
 * must redact tokens, cookies, emails, and anything matching the PII patterns
 * **before any artifact is written**."
 *
 * That was prose, and prose does not fail a run. It was satisfied in exactly one
 * direction — the directory was gitignored — while `network/*.har` sat on disk
 * with `Cookie: sid=sess_00000001` in the clear for two rungs. Gitignoring keeps
 * a credential out of a commit; it does nothing about the artifact somebody
 * attaches to a bug report, and it is not what §3.4 asks for.
 *
 * So: every file written under `capture/` is scanned, and a hit **fails the
 * run**. Not a warning, not a gitignore.
 *
 * Two design notes that matter:
 *
 *   - Every file is scanned, binary included: a screenshot's `tEXt` chunk is a
 *     perfectly good place for a credential to ride along unnoticed.
 *   - Bytes are decoded `latin1`, not `utf8`, so `offset` is a true byte offset.
 *     A utf8 decode does not usually hide an ASCII credential — the decoder
 *     never swallows a following ASCII byte — but every multi-byte sequence
 *     before it shifts the string index away from the byte position, and a
 *     finding that points at the wrong place in a 40MB HAR is not much of a
 *     finding. latin1 is 1 byte to 1 code unit, always.
 *
 * Known limit: a credential inside a *compressed* stream (a gzipped HAR body, a
 * PNG `IDAT`) is not findable by any text scan. The scrubber has to keep it from
 * being written; this gate catches what the scrubber missed, not what it hid.
 *   - `auth/storage-state.json` is the one file that is *supposed* to hold a
 *     session (§5). It is exempt from the content scan and checked for mode 0600
 *     instead, reported into the same finding list: the one file allowed to
 *     contain a credential has to prove it is protected.
 */

import { readFileSync, statSync } from 'node:fs';
import { CAPTURE_TREE_EXPECTATION, walkFiles, type ScanExpectation } from './scan-walker.js';
import { join, relative, sep } from 'node:path';

/** A credential-shaped thing found in an artifact. */
export interface SecretFinding {
  /** Path relative to the scanned root. */
  file: string;
  /** Which rule matched. */
  rule: string;
  /** Byte offset into the file, so a big HAR can be looked at directly. */
  offset: number;
  /** The match, truncated and partially masked — a finding must not itself leak. */
  excerpt: string;
  detail: string;
}

export interface SecretRule {
  id: string;
  pattern: RegExp;
  detail: string;
}

/**
 * What counts as a credential.
 *
 * Deliberately broad: a false positive costs one line in a scrubber, and a false
 * negative ships a session token. `Cookie:`/`Set-Cookie:` require a `name=value`
 * so a header recorded by name alone — which is what the endpoint descriptors
 * do, and must keep doing for §8's session check — does not trip the scan.
 */
export const SECRET_RULES: readonly SecretRule[] = [
  {
    id: 'cookie-header',
    pattern: /\b(?:set-)?cookie"?\s*[:=]\s*"?\s*[A-Za-z0-9_.-]+=(?!\s*(?:\[REDACTED\]|"))[^\s;",}]+/gi,
    detail: 'a Cookie or Set-Cookie header carrying a value',
  },
  {
    id: 'authorization-header',
    pattern: /\bauthorization"?\s*[:=]\s*"?\s*(?!\[REDACTED\])[A-Za-z]+\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    detail: 'an Authorization header carrying a credential',
  },
  {
    id: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    detail: 'a bearer token',
  },
  {
    id: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    detail: 'a JSON Web Token',
  },
  {
    id: 'session-cookie-value',
    pattern: /\b(?:sid|sess|session|sessionid|jsessionid|phpsessid|connect\.sid|_session_id)=(?!\s*(?:\[REDACTED\]|"))[A-Za-z0-9._%-]{6,}/gi,
    detail: 'a session cookie value',
  },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    detail: 'a private key block',
  },
  {
    id: 'vendor-token',
    pattern: /\b(?:sk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    detail: 'a vendor API token',
  },
];

/** Half-masked, so a finding can be printed in CI without leaking what it found. */
export function maskExcerpt(match: string): string {
  const clipped = match.slice(0, 48);
  if (clipped.length <= 12) return `${clipped.slice(0, 3)}…`;
  return `${clipped.slice(0, 10)}…${'*'.repeat(Math.min(8, clipped.length - 10))}`;
}

/** Literal credentials from the environment (§3.3). Empty and short values are ignored. */
export function credentialLiterals(env: Record<string, string | undefined>): string[] {
  return ['SITEFORGE_USER', 'SITEFORGE_PASS']
    .map((k) => env[k])
    .filter((v): v is string => typeof v === 'string' && v.length >= 4);
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Scan one file's bytes.
 *
 * `text` must be a `latin1` decode of the raw bytes, so offsets are byte offsets
 * and binary containers are searchable.
 */
export function scanText(
  file: string,
  text: string,
  literals: readonly string[] = [],
): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        file,
        rule: rule.id,
        offset: m.index,
        excerpt: maskExcerpt(m[0]),
        detail: rule.detail,
      });
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  // §3.3: credentials "never written to any capture artifact, never logged".
  // Checked as literals because a password has no shape to match on.
  for (const literal of literals) {
    const re = new RegExp(escapeRegExp(literal), 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        file,
        rule: 'env-credential',
        offset: m.index,
        excerpt: maskExcerpt(m[0]),
        detail: 'the literal value of SITEFORGE_USER or SITEFORGE_PASS',
      });
    }
  }
  return findings;
}

/** The one file allowed to hold a session, and the mode it has to have. */
export const STORAGE_STATE_SUFFIX = 'auth/storage-state.json';
export const STORAGE_STATE_MODE = 0o600;

/**
 * Walk a capture tree and scan every file in it.
 *
 * Every file, not a chosen list: the point of the gate is that it does not
 * depend on somebody having thought of the artifact that leaked.
 */
export function scanCaptureTree(
  root: string,
  options: {
    env?: Record<string, string | undefined>;
    /** Overridable only to let unit tests scan a deliberately minimal tree. */
    expect?: ScanExpectation;
  } = {},
): SecretFinding[] {
  const literals = credentialLiterals(options.env ?? process.env);
  const findings: SecretFinding[] = [];

  // `tree` profile: ignores nothing, by construction. There is no parameter
  // through which this walk could be given a skip list — §3.4's gate must not
  // depend on somebody having thought of the artifact that leaked.
  const { files } = walkFiles({
    root,
    profile: 'tree',
    expect: options.expect ?? CAPTURE_TREE_EXPECTATION,
  });

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join('/');

    if (rel.endsWith(STORAGE_STATE_SUFFIX)) {
      // Exempt from the content scan — this file exists to hold the session
      // (§5) — but it has to prove it is protected, reported into the same
      // list so one gate covers both.
      const mode = statSync(abs).mode & 0o777;
      if (mode !== STORAGE_STATE_MODE) {
        findings.push({
          file: rel,
          rule: 'storage-state-mode',
          offset: 0,
          excerpt: `0${mode.toString(8)}`,
          detail: `the one artifact allowed to hold a credential must be mode 0${STORAGE_STATE_MODE.toString(8)}`,
        });
      }
      continue;
    }

    // latin1, never utf8: a utf8 decode mangles PNG tEXt chunks and every
    // other binary container into replacement characters, so a scanner that
    // uses it passes the binary case in silence.
    findings.push(...scanText(rel, readFileSync(abs).toString('latin1'), literals));
  }

  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.offset - b.offset);
}

/** Render findings for a console, without printing what was found. */
export function formatFindings(findings: readonly SecretFinding[]): string {
  return findings
    .map((f) => `    ${f.file} @${f.offset}  [${f.rule}] ${f.detail} — ${f.excerpt}`)
    .join('\n');
}
