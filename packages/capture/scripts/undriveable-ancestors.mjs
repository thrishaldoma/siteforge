#!/usr/bin/env node
/**
 * Why an element whose `scrollIntoViewIfNeeded` *succeeds* stays off-screen.
 *
 *   node undriveable-ancestors.mjs vikunja
 *
 * The probe diagnostics ended in a shape with no next instrument in it:
 * `scrollIntoView succeeded 51`, `in view after false 49`, `occluded after
 * nothing 69`. Both candidate explanations were out by observation — the call
 * resolves every time, and nothing is on top afterwards — leaving one mechanical
 * candidate: the nearest scrollable ancestor is not the viewport.
 *
 * That is a **static** question and the capture already answers it.
 * `CAPTURED_CSS_PROPERTIES` includes `position`, `overflow-x`, `overflow-y` and
 * `transform`, `styles.json` holds the computed value of each, and `dom.json`
 * holds the tree. So this reads committed evidence rather than running a fourth
 * probe experiment — reproducible, re-runnable, and it cannot perturb the probe
 * pass whose non-determinism is being bounded separately (0032).
 *
 * **Boxes are reported and deliberately excluded from the conclusion.**
 * `dom.json` records `box.x + scrollX` — document coordinates, at extraction
 * time — while the diagnostic's `inViewport` is `getBoundingClientRect` in
 * viewport coordinates on a fresh page at probe time. Different frames, different
 * moments. Re-deriving off-screen-ness from these would produce a number that
 * looks like confirmation and is not.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const siteId = process.argv[2] ?? 'vikunja';
const ROOT = join(REPO, 'capture', siteId);

const skipped = JSON.parse(readFileSync(join(ROOT, 'flows/skipped-controls.json'), 'utf8'));
const targets = skipped.controls.filter(
  (c) => c.diagnostic?.scrollIntoView === 'succeeded' && c.diagnostic?.inViewportAfterScroll === false,
);
if (targets.length === 0) {
  console.log('\nno control scrolled successfully and stayed off-screen; nothing to explain.\n');
  process.exit(0);
}

const cache = new Map();
function routeData(routeId) {
  if (!cache.has(routeId)) {
    const dom = JSON.parse(readFileSync(join(ROOT, 'routes', routeId, 'dom.json'), 'utf8'));
    const styles = JSON.parse(readFileSync(join(ROOT, 'routes', routeId, 'styles.json'), 'utf8'));
    cache.set(routeId, {
      dom,
      table: new Map(styles.table.map((s) => [s.styleId, s.declarations])),
    });
  }
  return cache.get(routeId);
}

/** The chain from `<html>` down to the node, each with its computed style. */
function chainFor(routeId, nodeId) {
  const { dom, table } = routeData(routeId);
  let found = null;
  const walk = (node, path) => {
    if (found !== null) return;
    const here = [...path, node];
    if (node.nodeId === nodeId) {
      found = here;
      return;
    }
    for (const child of node.children ?? []) if (child.nodeType === 'element') walk(child, here);
  };
  walk(dom.root, []);
  return found?.map((n) => ({ node: n, style: table.get(n.styleId) ?? {} })) ?? null;
}

const describe = (n) => {
  const cls = (n.attributes?.class ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  return `${n.tag}${cls ? `.${cls}` : ''}`;
};

/**
 * Is this ancestor a scroll container, a clip, a transform, or out of flow?
 *
 * The four properties the ruling named, and nothing else. A property that is
 * merely unusual is not evidence; these four are the ones that decide which box
 * `scrollIntoViewIfNeeded` scrolls and what it can reach.
 */
const notable = (d) =>
  [
    d['overflow-x'] !== 'visible' || d['overflow-y'] !== 'visible'
      ? `overflow ${d['overflow-x']}/${d['overflow-y']}`
      : null,
    d.transform !== undefined && d.transform !== 'none' ? `transform ${d.transform}` : null,
    d.position === 'fixed' || d.position === 'sticky' ? `position ${d.position}` : null,
  ].filter((x) => x !== null);

console.log(`\nundriveable ancestors — ${siteId}`);
console.log(`${targets.length} control(s) scrolled successfully and stayed off-screen\n`);

const byRoute = new Map();
for (const c of targets) byRoute.set(c.routeId, (byRoute.get(c.routeId) ?? 0) + 1);
for (const [routeId, n] of byRoute) console.log(`  ${String(n).padStart(3)}  ${routeId}`);

const tally = new Map();
let missing = 0;
for (const c of targets) {
  const chain = chainFor(c.routeId, c.nodeId);
  if (chain === null) {
    missing += 1;
    continue;
  }
  // Strict ancestors: an element's own overflow cannot clip it out of view.
  for (const { node, style } of chain.slice(0, -1)) {
    const flags = notable(style);
    if (flags.length === 0) continue;
    const key = `${describe(node)}  ${flags.join(' · ')}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
}

console.log(`\nancestors that scroll, clip, transform, or leave the flow${missing > 0 ? `  (${missing} node(s) absent from dom.json)` : ''}:\n`);
for (const [key, n] of [...tally].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}/${targets.length}  ${key}`);
}

const one = targets[0];
console.log(`\none chain in full — ${one.routeId} ${one.nodeId} ${JSON.stringify(one.name)}:\n`);
for (const [i, { node, style }] of (chainFor(one.routeId, one.nodeId) ?? []).entries()) {
  const b = node.boundingBox;
  console.log(
    `  ${String(i).padStart(2)} ${describe(node).slice(0, 34).padEnd(34)}` +
    ` pos ${String(style.position ?? '?').padEnd(8)}` +
    ` overflow ${String(`${style['overflow-x']}/${style['overflow-y']}`).padEnd(16)}` +
    ` transform ${String(style.transform ?? '?').slice(0, 26).padEnd(26)}` +
    // Document coordinates at capture time. Reported, never concluded from.
    ` box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}×${Math.round(b.height)}`,
  );
}
console.log('');
