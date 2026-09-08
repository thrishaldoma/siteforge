/**
 * The rung-3 gate, as one command: serve the CRUD app, capture both auth
 * contexts, assert the gates, stop.
 *
 *   pnpm rung3
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['RUNG3_PORT'] ?? 8789);

/**
 * Generated per run, high-entropy.
 *
 * It used to be the literal `rung-three` — which is also this fixture's siteId,
 * so it appeared in all 24 artifacts and the §3.4 gate failed the run. The gate
 * was right: a literal scanner cannot tell a leaked secret from a secret that is
 * also an ordinary word, and the fix is to make the secret distinguishable
 * rather than to teach the scanner entropy heuristics. Random makes the
 * collision impossible rather than merely unlikely.
 */
const PASSWORD = `pw-${randomBytes(18).toString('base64url')}`;

const app = spawn(process.execPath, [join(HERE, 'crud-app.mjs'), String(PORT)], {
  stdio: 'inherit',
  env: { ...process.env, RUNG3_PASSWORD: PASSWORD },
});
const stop = () => { if (!app.killed) app.kill(); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });
await new Promise((r) => setTimeout(r, 800));

// §3.3: capture reads credentials only from the environment. These are the local
// fixture app's own, supplied by the runner — never baked into capture code.
// Flags are forwarded, not swallowed: `pnpm rung3 --allow-destructive` has to
// reach the driver, and a runner that quietly drops them makes the gate lie
// about what it exercised.
const child = spawn(process.execPath, [join(HERE, 'rung3.mjs'), ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUNG3_PORT: String(PORT),
    SITEFORGE_USER: 'operator@localhost',
    SITEFORGE_PASS: PASSWORD,
  },
});
const code = await new Promise((resolve) => child.on('close', resolve));
stop();
process.exit(code ?? 1);
