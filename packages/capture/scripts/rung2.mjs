/**
 * The rung-2 gate, as one command: serve the target, capture it, assert the
 * gates, stop.
 *
 * M2 does not start until this is green. §12's M2 is "visual gate passes on all
 * routes of a static marketing site" — which is unmeasurable if the capture of a
 * static site has never produced a stylesheet, a font, a pseudo-class rule, or a
 * scroll step.
 *
 *   pnpm rung2
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env['RUNG2_PORT'] ?? 8788);

const site = spawn(process.execPath, [join(HERE, 'test-site.mjs'), String(PORT)], { stdio: 'inherit' });
const stop = () => { if (!site.killed) site.kill(); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

await new Promise((r) => setTimeout(r, 800));

const spike = spawn(
  process.execPath,
  [join(HERE, 'spike-one-page.mjs'), `http://127.0.0.1:${PORT}/`],
  { stdio: 'inherit' },
);
const code = await new Promise((resolve) => spike.on('close', resolve));
stop();
process.exit(code ?? 1);
