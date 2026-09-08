#!/usr/bin/env node
/**
 * Rung-2's second origin: a stand-in CDN serving a font and an image.
 *
 * The off-origin guard has two branches and only one of them had ever run.
 * Blocking a main-frame navigation to another origin is measured by rung 3;
 * *allowing* a subresource from another origin was asserted only in a unit
 * test, and the rung's own report counted foreign subresources against a
 * fixture that served everything from one origin — a number that was
 * structurally zero and proved nothing (decision 0012).
 *
 * A guard that blocked subresources would break capture on every real site
 * (§6: "Fonts, images, scripts and XHR from CDNs are needed to render"), which
 * makes this the more dangerous half to get wrong: the failure is a clone with
 * no typography rather than a crash.
 *
 * Hermetic: bound to 127.0.0.1, which `allowlist.txt` permits (§3.1), and a
 * different *origin* from the page server purely by host and port. Nothing
 * leaves the machine.
 *
 *   node packages/capture/scripts/test-cdn.mjs [port]
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { FONT_AVAILABLE, FONT_PATH, png } from './test-assets.mjs';

const port = Number(process.argv[2] ?? 8790);

/** Deliberately different bytes from anything the page origin serves. */
const ROUTES = new Map([
  ['/cdn/hero.png', [png(240, 120, [12, 74, 110]), 'image/png']],
]);

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  // CORS is required for a cross-origin font; without it Chromium fetches the
  // file and then refuses to use it, and the capture records a request whose
  // response never becomes an asset.
  res.setHeader('access-control-allow-origin', '*');

  if (path === '/cdn/font.woff2') {
    if (!FONT_AVAILABLE) { res.writeHead(404).end(); return; }
    const body = readFileSync(FONT_PATH);
    res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': body.length });
    res.end(body);
    return;
  }
  const hit = ROUTES.get(path);
  if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
  const [buf, type] = hit;
  res.writeHead(200, { 'content-type': type, 'content-length': buf.length });
  res.end(buf);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`rung-2 cdn origin on http://127.0.0.1:${port}/`);
});
