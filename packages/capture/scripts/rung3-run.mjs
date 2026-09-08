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
const child = spawn(process.execPath, [join(HERE, 'rung3.mjs')], {
  stdio: 'inherit',
  env: {
    ...process.env,
    RUNG3_PORT: String(PORT),
    SITEFORGE_USER: 'operator@localhost',
    SITEFORGE_PASS: 'rung-three',
  },
});
const code = await new Promise((resolve) => child.on('close', resolve));
stop();
process.exit(code ?? 1);
