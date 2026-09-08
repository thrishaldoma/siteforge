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
const CDN_PORT = Number(process.env['RUNG2_CDN_PORT'] ?? 8790);

/**
 * Two origins, both loopback.
 *
 * The page is served from `localhost` and its font and one image from
 * `127.0.0.1` — the same machine, a different *origin*, and nothing that
 * leaves it. Both hosts are in `allowlist.txt` (§3.1).
 *
 * This exists because the crawl boundary has an allow branch that had never
 * run: subresources from any origin are permitted and recorded, and only a
 * fixture with a second origin can show that. A guard that blocked them would
 * pass every test we had and break capture on every real site.
 */
const cdn = spawn(process.execPath, [join(HERE, 'test-cdn.mjs'), String(CDN_PORT)], { stdio: 'inherit' });
const CDN_ORIGIN = `http://127.0.0.1:${CDN_PORT}`;
const site = spawn(process.execPath, [join(HERE, 'test-site.mjs'), String(PORT)], {
  stdio: 'inherit',
  env: { ...process.env, RUNG2_CDN_ORIGIN: CDN_ORIGIN },
});
const stop = () => {
  if (!site.killed) site.kill();
  if (!cdn.killed) cdn.kill();
};
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

await new Promise((r) => setTimeout(r, 800));

const spike = spawn(
  process.execPath,
  [join(HERE, 'spike-one-page.mjs'), `http://localhost:${PORT}/`],
  { stdio: 'inherit', env: { ...process.env, RUNG2_CDN_ORIGIN: CDN_ORIGIN } },
);
const code = await new Promise((resolve) => spike.on('close', resolve));
stop();
process.exit(code ?? 1);
