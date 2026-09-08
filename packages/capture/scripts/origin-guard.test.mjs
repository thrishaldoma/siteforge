/**
 * The crawl boundary, against a real browser.
 *
 * A pure predicate test proves the decision; it does not prove the interceptor
 * is *wired*, and "the interceptor has a hole" is the whole failure the
 * post-click check exists to report. This asserts the wiring, in both
 * directions — because a guard that blocks everything passes a block-only test
 * and breaks capture on every real site.
 *
 * It found a real hole on its first run. `request.frame()` throws for a popup's
 * first navigation (the frame is not attached yet); treating that as "not a main
 * frame" let `window.open('https://elsewhere')` complete. Measured with
 * `requestfinished`: the request left the machine. A navigation whose frame
 * cannot be resolved is a new page, not a subresource.
 */
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { allowedOrigins, decideNavigation } from '../../shared/dist/index.js';
import { installEscapeGuards, installOriginGuard } from './capture-lib.mjs';

const HOME = 'http://127.0.0.1:9977';
const FOREIGN = 'https://example.net';

const PAGE = `<!doctype html><html><body>
  <a id="link" href="${FOREIGN}/link" target="_blank">link</a>
  <a id="same" href="${HOME}/other">same origin</a>
  <img id="pixel" src="${FOREIGN}/pixel.png" alt="">
  <button id="popup" type="button">popup</button>
  <script>
    document.getElementById('popup').onclick = () => window.open('${FOREIGN}/partner', '_blank');
  </script>
</body></html>`;

let browser;
beforeAll(async () => { browser = await chromium.launch(); });
afterAll(async () => { await browser?.close(); });

/** Drive the fixture page and report what each request actually did. */
async function run(interact) {
  const context = await browser.newContext();
  const blocked = [];
  const onBlocked = (event) => blocked.push(event);
  await installOriginGuard(context, {
    allowedOrigins: allowedOrigins({ origin: HOME }), onBlocked, decide: decideNavigation,
  });
  const page = await context.newPage();
  installEscapeGuards(page, { onBlocked });

  const outcome = new Map();
  context.on('requestfailed', (r) => outcome.set(r.url(), { left: false, error: r.failure()?.errorText }));
  context.on('requestfinished', (r) => { if (!outcome.has(r.url())) outcome.set(r.url(), { left: true }); });

  // Served from the route table so the test needs no server of its own.
  await page.route(`${HOME}/**`, (route) => route.fulfill({ contentType: 'text/html', body: PAGE }));
  await page.goto(`${HOME}/`);
  await interact(page);
  await page.waitForTimeout(1200);
  await context.close();
  return { blocked, outcome };
}

describe('the off-origin chokepoint prevents rather than detects', () => {
  it('stops a window.open to another origin before the request leaves', async () => {
    const { blocked, outcome } = await run(async (page) => {
      await page.click('#popup');
    });
    const partner = outcome.get(`${FOREIGN}/partner`);
    expect(partner, 'the popup navigation was never even attempted').toBeDefined();
    expect(partner.left, 'the request left the machine — the chokepoint has a hole').toBe(false);
    expect(partner.error).toContain('BLOCKED_BY_CLIENT');
    expect(blocked.map((b) => b.kind)).toContain('navigation');
  });

  it('records the popup and closes it, never crawling it', async () => {
    const { blocked } = await run(async (page) => { await page.click('#popup'); });
    const popup = blocked.find((b) => b.kind === 'popup');
    expect(popup).toBeDefined();
    // Its origin is null — the popup is still on `about:blank`, because the
    // router aborted the navigation before it committed. That the popup never
    // reaches the foreign origin at all is the chokepoint winning the race,
    // which is the whole difference between preventing and detecting.
    expect(popup.origin).toBeNull();
  });

  it('stops a target="_blank" link to another origin', async () => {
    const { outcome } = await run(async (page) => { await page.click('#link'); });
    expect(outcome.get(`${FOREIGN}/link`)?.left).toBe(false);
  });

  it('lets a foreign SUBRESOURCE through and never blocks it', async () => {
    // The half that matters just as much. Fonts, images and CDN scripts are how
    // real sites render, and §8 localizes them later — a guard that blocks them
    // breaks capture everywhere, which is the one outcome the rule names.
    const { blocked } = await run(async () => {});
    expect(blocked.map((b) => b.url)).not.toContain(`${FOREIGN}/pixel.png`);
  });

  it('lets same-origin navigation through', async () => {
    const { blocked } = await run(async (page) => {
      await page.click('#same').catch(() => {});
    });
    expect(blocked.filter((b) => b.kind === 'navigation')).toHaveLength(0);
  });
});
