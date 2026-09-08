/**
 * The rung-3 gate, as one command: serve the CRUD app, capture both auth
 * contexts, assert the gates, stop.
 *
 *   pnpm rung3
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['RUNG3_PORT'] ?? 8789);

const app = spawn(process.execPath, [join(HERE, 'crud-app.mjs'), String(PORT)], { stdio: 'inherit' });
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
    // Deliberately distinctive. The password used to be 'rung-three', which is
    // also this fixture's siteId — so it appeared in every artifact and the
    // §3.4 gate flagged all 24 of them. The gate was right: a literal scan
    // cannot tell a leaked password from a password that happens to be a word
    // the artifacts legitimately contain, and the answer to that is not to
    // weaken the scan.
    SITEFORGE_PASS: 'pw-8Qv3n2Lx-rung3',
  },
});
const code = await new Promise((resolve) => child.on('close', resolve));
stop();
process.exit(code ?? 1);
