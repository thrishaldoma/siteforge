/**
 * Rung-2 measurement target: a local static site with the things
 * `https://example.com` does not have.
 *
 * example.com is 17 nodes with no stylesheet, no images, no fonts, no script and
 * no scroll — so "the schema survived a real page" meant very little. This site
 * exists to drive the extraction paths that were never exercised:
 *
 *   external stylesheet   → styles.table, and CSSOM rule extraction
 *   :hover/:focus/:checked/:disabled/[aria-expanded]/[data-state]
 *                         → states.entries with source 'cssom'  (§6's "highest-value trick")
 *   @font-face            → styles.fonts + a font asset
 *   images, some lazy     → assets, and states.entries with source 'scroll'
 *   a page several
 *   viewports tall + a
 *   sticky header         → the scroll pass, sticky-transition
 *
 * Everything is generated into memory and served from 127.0.0.1, which
 * allowlist.txt already permits (§3.1). Nothing binary is committed.
 *
 *   node packages/capture/scripts/test-site.mjs [port]
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

/* ------------------------------------------------------------------- assets */

import { FONT_AVAILABLE, FONT_PATH, png } from './test-assets.mjs';

/**
 * The second origin, when rung 2 runs one (see test-cdn.mjs). Empty means the
 * page is self-contained, which is how this file behaves when run by hand.
 */
const CDN = process.env['RUNG2_CDN_ORIGIN'] ?? '';

/* -------------------------------------------------------------------- pages */

const CSS = `${CDN ? `@font-face {
  font-family: "Siteforge Remote";
  src: url("${CDN}/cdn/font.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
.remote-note { font-family: "Siteforge Remote", serif; }
` : ''}
@font-face {
  font-family: "Siteforge Test";
  src: url("/fonts/siteforge-test.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
:root { --ink: #1c1917; --muted: #78716c; --accent: #2563eb; --line: #e7e5e4; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Siteforge Test", ui-sans-serif, system-ui, sans-serif;
  color: var(--ink);
  background: #fafaf9 url("/img/texture.png") repeat;
  font-size: 16px; line-height: 1.6;
}
.site-header {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; gap: 24px;
  padding: 16px 32px; background: #fff; border-bottom: 1px solid var(--line);
}
.brand { display: inline-flex; text-decoration: none; color: var(--ink); font-weight: 600; }
.nav { display: flex; gap: 20px; margin-left: auto; list-style: none; margin-block: 0; padding-left: 0; }
.nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
main { max-width: 960px; margin: 0 auto; padding: 48px 32px; }
h1 { font-size: 40px; line-height: 1.15; margin: 0 0 24px; letter-spacing: -0.5px; }
h2 { font-size: 22px; margin: 48px 0 12px; }
p  { margin: 0 0 16px; max-width: 68ch; }
.card-grid { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 24px; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 16px; background: #fff; }
.card img { display: block; width: 100%; height: auto; border-radius: 8px; }
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--accent); color: #fff; border: 0; border-radius: 6px;
  padding: 10px 16px; font-size: 14px; cursor: pointer;
  transition: background-color 120ms ease;
}

/* --- the state rules §6 reads straight out of the CSSOM --- */
.btn:hover              { background: #1d4ed8; }
.btn:active             { background: #1e40af; }
.btn:focus-visible      { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled           { opacity: .5; cursor: not-allowed; }
.nav a:hover            { color: var(--ink); text-decoration: underline; }
.nav a:focus            { outline: 2px solid var(--accent); }
.opt input:checked + span { font-weight: 600; color: var(--accent); }
.opt input:disabled + span { color: var(--muted); }
.accordion[data-state="open"] .panel { display: block; }
.accordion[data-state="closed"] .panel { display: none; }
.trigger[aria-expanded="true"] { font-weight: 600; }
.trigger[aria-expanded="true"]::after { content: "−"; }
.trigger[aria-expanded="false"]::after { content: "+"; }
@media (max-width: 700px) {
  .card-grid { grid-template-columns: 1fr; }
  .btn:hover { background: var(--accent); }
}
`;

const section = (i) => `
  <h2>Section ${i}</h2>
  <p>Paragraph ${i}. This page is intentionally several viewports tall so the
     scroll pass has somewhere to go, and so lazy images below the fold actually
     load late rather than on first paint.</p>
  <div class="card-grid">
    ${[0, 1, 2].map((j) => `
    <article class="card" data-card="${i}-${j}">
      <img src="/img/card-${(i + j) % 4}.png" alt="Card ${i}-${j}" width="280" height="180"
           loading="${i === 0 ? 'eager' : 'lazy'}">
      <h3>Card ${i}-${j}</h3>
      <p>Some copy for card ${i}-${j}.</p>
      <button class="btn" type="button" data-action="pick-${i}-${j}">Choose</button>
    </article>`).join('')}
  </div>`;

const INDEX = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Siteforge rung-2 target</title>
<link rel="stylesheet" href="/style.css">
<link rel="icon" href="/img/icon.png">
</head>
<body>
<header class="site-header">
  <a class="brand" href="/">Rung Two</a>
  <ul class="nav">
    <li><a href="/">Home</a></li>
    <li><a href="/about.html">About</a></li>
  </ul>
</header>
<main>
  <h1>A static page with the parts example.com lacks</h1>
  <p>External stylesheet, a web font, images, pseudo-class rules, and enough
     height to scroll.</p>
${CDN ? `  <p class="remote-note">This paragraph is set in a font fetched from another
     origin, next to an image from that same origin — both subresources, both
     allowed and recorded by the crawl boundary.</p>
  <img src="${CDN}/cdn/hero.png" alt="Served by the second origin" width="240" height="120">
` : ''}

  <div class="accordion" data-state="closed">
    <button class="trigger btn" type="button" aria-expanded="false" aria-controls="panel">Details</button>
    <div class="panel" id="panel">Panel content, hidden until the accordion opens.</div>
  </div>

  <p>
    <label class="opt"><input type="checkbox" checked> <span>Checked option</span></label>
    <label class="opt"><input type="checkbox" disabled> <span>Disabled option</span></label>
  </p>
  <p><button class="btn" type="button" disabled>Disabled action</button></p>

  <!--
    An escape the crawl must refuse. Rung 2 is a static capture with no probing,
    so this fires on load: the boundary's block branch has to be exercised by
    the same fixture that exercises its allow branch, or a guard that blocks
    everything and a guard that blocks nothing both look green here.
    example.net is IANA-reserved and the request is aborted at the router, so
    nothing leaves the machine.
  -->
  <script>
    window.addEventListener('DOMContentLoaded', () => {
      window.open('https://example.net/partner', '_blank');
    });
  </script>

  ${[0, 1, 2, 3, 4].map(section).join('\n')}
</main>
<script>
  document.querySelector('.trigger').addEventListener('click', (e) => {
    const box = e.currentTarget.closest('.accordion');
    const open = box.dataset.state === 'open';
    box.dataset.state = open ? 'closed' : 'open';
    e.currentTarget.setAttribute('aria-expanded', String(!open));
  });
</script>
</body>
</html>`;

const ABOUT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>About — rung two</title>
<link rel="stylesheet" href="/style.css"></head>
<body>
<header class="site-header"><a class="brand" href="/">Rung Two</a></header>
<main><h1>About</h1><p>A second route, so the crawl frontier has an edge to follow.</p></main>
</body>
</html>`;

const ROUTES = new Map([
  ['/', [INDEX, 'text/html; charset=utf-8']],
  ['/about.html', [ABOUT, 'text/html; charset=utf-8']],
  ['/style.css', [CSS, 'text/css; charset=utf-8']],
  ['/img/texture.png', [png(16, 16, [246, 245, 244]), 'image/png']],
  ['/img/icon.png', [png(32, 32, [37, 99, 235]), 'image/png']],
  ['/img/card-0.png', [png(280, 180, [219, 234, 254]), 'image/png']],
  ['/img/card-1.png', [png(280, 180, [254, 226, 226]), 'image/png']],
  ['/img/card-2.png', [png(280, 180, [220, 252, 231]), 'image/png']],
  ['/img/card-3.png', [png(280, 180, [254, 249, 195]), 'image/png']],
]);

const port = Number(process.argv[2] ?? 8787);
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/fonts/siteforge-test.woff2') {
    if (!FONT_AVAILABLE) { res.writeHead(404).end(); return; }
    const body = readFileSync(FONT_PATH);
    res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': body.length });
    res.end(body);
    return;
  }
  const hit = ROUTES.get(path);
  if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }
  const [body, type] = hit;
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  res.writeHead(200, { 'content-type': type, 'content-length': buf.length });
  res.end(buf);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`rung-2 target on http://127.0.0.1:${port}/`);
  console.log(`  font: ${FONT_AVAILABLE ? '@fontsource/inter (OFL 1.1, lockfile-pinned)' : 'MISSING — run pnpm install'}`);
});
