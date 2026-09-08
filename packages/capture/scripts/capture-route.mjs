/**
 * Capture one route, in one context, into schema-valid artifacts.
 *
 * Shared by every rung driver so they cannot drift. Still a measurement rig, not
 * `packages/capture` — but this is the shape that stage will take.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as S from '../../schema/dist/index.js';
import {
  COLLECT_CSSOM, EXTRACT, INTERACTIVE_ROLES, MATCH_SELECTORS, SCROLL_PROBE, STAMP, UNSTAMP,
  analyseSelector, scrub, scrubDeep, sha256,
} from './capture-lib.mjs';

const serializeDom = (n) =>
  n.nodeType === 'text'
    ? `#${n.value}`
    : `<${n.tag} ${JSON.stringify(n.attributes)} ${n.styleId}>${n.children.map(serializeDom).join('')}</${n.tag}>`;

/** Build the a11y ↔ DOM mapping CDP gives us and Playwright's API no longer does. */
export async function readAccessibility(cdp) {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const backendToSfIdx = new Map();
  (function walk(node) {
    const attrs = node.attributes ?? [];
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'data-sf-idx') backendToSfIdx.set(node.backendNodeId, Number(attrs[i + 1]));
    }
    for (const child of node.children ?? []) walk(child);
    if (node.contentDocument) walk(node.contentDocument);
  })(root);

  const { nodes } = await cdp.send('Accessibility.getFullAXTree');
  const axBySfIdx = new Map();
  for (const ax of nodes) {
    if (ax.ignored || ax.backendDOMNodeId === undefined) continue;
    const sfIdx = backendToSfIdx.get(ax.backendDOMNodeId);
    if (sfIdx === undefined) continue;
    axBySfIdx.set(sfIdx, { role: ax.role?.value ?? 'generic', name: ax.name?.value ?? '' });
  }
  return { axBySfIdx, backendToSfIdx };
}

/** §6: CDP getEventListeners — the source that catches divs with click handlers. */
export async function readEventListeners(cdp, backendToSfIdx) {
  const out = new Map();
  for (const [backendNodeId, sfIdx] of backendToSfIdx) {
    try {
      const { object } = await cdp.send('DOM.resolveNode', { backendNodeId });
      if (!object.objectId) continue;
      const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: object.objectId });
      const types = [...new Set((listeners ?? []).map((l) => l.type))];
      if (types.length) out.set(sfIdx, types);
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => {});
    // operational: the node detached between resolve and release
    } catch { /* detached or non-element */ }
  }
  return out;
}

/**
 * @returns everything the caller needs to write the route and to aggregate
 *          coverage across routes.
 */
export async function captureRoute({ page, cdp, routeId, url, viewport, routeDir, envelope, scroll = true }) {
  await page.evaluate(STAMP);

  const cssom = await page.evaluate(COLLECT_CSSOM);
  const analysed = cssom.rules.map((rule) => ({ ...rule, ...analyseSelector(rule.selector) }));
  const stateRules = analysed.filter((r) => r.states.length > 0);
  const matched = await page.evaluate(MATCH_SELECTORS, stateRules.map((r) => r.base));
  stateRules.forEach((r, i) => { r.matchedIdx = matched[i] ?? []; });

  const extracted = await page.evaluate(EXTRACT, S.CAPTURED_CSS_PROPERTIES);
  const { axBySfIdx, backendToSfIdx } = await readAccessibility(cdp);
  const listenersBySfIdx = await readEventListeners(cdp, backendToSfIdx);
  const stateMatchedSfIdx = new Set(stateRules.flatMap((r) => r.matchedIdx));

  // --- scroll pass (§6) ---
  const scrollShots = [];
  const scrollObservations = [];
  const alreadyStuck = new Set();
  let previous = null;
  const first = await page.evaluate(SCROLL_PROBE);
  const stepPx = Math.round(viewport.height / 2);
  const stepCount = scroll
    ? Math.max(1, Math.ceil(Math.max(0, first.scrollHeight - viewport.height) / stepPx) + 1)
    : 1;
  for (let i = 0; i < stepCount; i += 1) {
    const y = Math.min(i * stepPx, Math.max(0, first.scrollHeight - viewport.height));
    await page.evaluate((to) => window.scrollTo(0, to), y);
    await page.waitForTimeout(200);
    scrollShots.push({ index: i, scrollY: y, bytes: await page.screenshot() });
    const { probe } = await page.evaluate(SCROLL_PROBE);
    if (previous) {
      const changed = [];
      const stuck = [];
      for (const [idx, now] of Object.entries(probe)) {
        const before = previous[idx];
        if (!before) continue;
        const changes = [];
        for (const key of ['opacity', 'boxShadow', 'transform', 'visibility']) {
          if (before[key] !== now[key]) changes.push({ property: key, from: before[key], to: now[key] });
        }
        if (changes.length) changed.push({ sfIdx: Number(idx), changes });
        if ((now.position === 'sticky' || now.position === 'fixed')
          && before.viewportTop === now.viewportTop && !alreadyStuck.has(idx)) {
          alreadyStuck.add(idx);
          stuck.push(Number(idx));
        }
        if (before.loaded === '0' && now.loaded === '1') {
          changed.push({ sfIdx: Number(idx), changes: [{ property: 'opacity', from: '0', to: '1' }], lazy: true });
        }
      }
      scrollObservations.push({ step: i, scrollY: y, changed, stuck });
    }
    previous = probe;
  }
  await page.evaluate((to) => window.scrollTo(0, to), 0);
  const fullShot = await page.screenshot({ fullPage: true });
  await page.evaluate(UNSTAMP);

  // --- build the node tree with the contract's own derivations ---
  const styleTable = new Map();
  const assignments = {};
  const built = extracted.nodes.map((raw) => {
    if (raw.kind === 'text') {
      return {
        nodeType: 'text',
        nodeId: S.deriveNodeId(raw.structuralPath, S.shortHash(scrub(raw.value))),
        value: scrub(raw.value),
      };
    }
    const attributes = scrubDeep(raw.attributes);
    const semanticKey = S.deriveSemanticKey({ tag: raw.tag, attributes });
    const contentFingerprint = S.deriveContentFingerprint({ tag: raw.tag, attributes, text: scrub(raw.ownText) });
    const nodeId = S.deriveNodeId(raw.structuralPath, semanticKey);
    const styleId = S.deriveStyleId(raw.declarations);
    const entry = styleTable.get(styleId);
    if (entry) entry.refCount += 1;
    else styleTable.set(styleId, { styleId, declarations: raw.declarations, refCount: 1 });
    assignments[nodeId] = styleId;

    const ax = axBySfIdx.get(raw.sfIdx);
    const discoveredBy = [];
    if (ax && INTERACTIVE_ROLES.has(ax.role)) discoveredBy.push('a11y-tree');
    if (listenersBySfIdx.has(raw.sfIdx)) discoveredBy.push('event-listeners');
    if (stateMatchedSfIdx.has(raw.sfIdx)) discoveredBy.push('pseudo-class-rule');
    if (raw.cursorPointer) discoveredBy.push('cursor-pointer');

    return {
      nodeType: 'element', nodeId,
      identity: { structuralPath: raw.structuralPath, semanticKey, contentFingerprint },
      tag: raw.tag, attributes, styleId,
      ...(ax ? { a11y: { ref: S.deriveA11yRef(nodeId), role: ax.role, name: scrub(ax.name) } } : {}),
      boundingBox: raw.boundingBox,
      ...(discoveredBy.length
        ? {
            interaction: {
              discoveredBy,
              selector: attributes.id ? `#${attributes.id}` : `${raw.tag}[data-sf-path="${raw.structuralPath}"]`,
              eventTypes: listenersBySfIdx.get(raw.sfIdx) ?? [],
              stateDeltaObserved: stateMatchedSfIdx.has(raw.sfIdx),
            },
          }
        : {}),
      children: [],
    };
  });

  const nodeIdBySfIdx = new Map();
  extracted.nodes.forEach((raw, i) => {
    if (raw.kind === 'element' && raw.sfIdx !== null) nodeIdBySfIdx.set(raw.sfIdx, built[i].nodeId);
    if (raw.parentIndex !== null) built[raw.parentIndex].children.push(built[i]);
  });
  const root = built[0];

  // --- artifacts ---
  const dom = {
    ...envelope('dom-document'),
    routeId, documentUrl: extracted.url,
    doctype: extracted.doctype, lang: extracted.lang,
    normalization: {
      whitespace: 'collapsed', commentsRemoved: true, inlineCodeOmitted: true,
      shadowDomFlattened: false, iframesRecursed: false,
    },
    root, nodeCount: built.length, domHash: S.shortHash(serializeDom(root)),
  };

  const styledNodeCount = Object.keys(assignments).length;
  const styles = {
    ...envelope('style-sheet'),
    routeId, propertySet: 'siteforge/v1',
    table: [...styleTable.values()], assignments,
    fonts: cssom.fonts.map((f) => {
      const urls = [...String(f.src ?? '').matchAll(/url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]);
      return {
        family: f.family,
        sources: (urls.length ? urls : ['(inline)']).map((u) => ({
          originalUrl: u.startsWith('http') ? u : new URL(u, extracted.url).href,
          format: 'woff2',
        })),
        ...(f.weight ? { weight: f.weight } : {}),
        ...(f.style ? { style: f.style } : {}),
        ...(f.display ? { display: f.display } : {}),
        license: 'unknown',
      };
    }),
    stats: {
      styledNodeCount, distinctStyles: styleTable.size,
      dedupeRatio: Number((styleTable.size / Math.max(1, styledNodeCount)).toFixed(4)),
    },
  };

  const stateEntries = stateRules.map((rule) => ({
    source: 'cssom',
    selector: rule.selector,
    stateSelectors: rule.states,
    declarations: rule.declarations,
    matchedNodeIds: rule.matchedIdx.map((i) => nodeIdBySfIdx.get(i)).filter(Boolean),
    origin: {
      ...(rule.stylesheetHref ? { stylesheetHref: rule.stylesheetHref } : {}),
      sheetIndex: rule.sheetIndex, ruleIndex: rule.ruleIndex,
    },
    ...(rule.mediaQuery ? { mediaQuery: rule.mediaQuery } : {}),
  }));
  for (const obs of scrollObservations) {
    const changedNodeIds = obs.changed.map((c) => nodeIdBySfIdx.get(c.sfIdx)).filter(Boolean);
    if (changedNodeIds.length) {
      stateEntries.push({
        source: 'scroll', scrollStep: obs.step, scrollY: obs.scrollY,
        effect: obs.changed.some((c) => c.lazy) ? 'lazy-load' : 'intersection-reveal',
        addedNodeIds: [], changedNodeIds,
        styleChanges: obs.changed
          .map((c) => ({ nodeId: nodeIdBySfIdx.get(c.sfIdx), changes: c.changes }))
          .filter((c) => c.nodeId),
      });
    }
    const stuckNodeIds = obs.stuck.map((i) => nodeIdBySfIdx.get(i)).filter(Boolean);
    if (stuckNodeIds.length) {
      stateEntries.push({
        source: 'scroll', scrollStep: obs.step, scrollY: obs.scrollY,
        effect: 'sticky-transition', addedNodeIds: [], changedNodeIds: stuckNodeIds, styleChanges: [],
      });
    }
  }

  mkdirSync(join(routeDir, 'scroll'), { recursive: true });
  writeFileSync(join(routeDir, 'shot.full.png'), fullShot);
  const scrollRefs = scrollShots.map((s) => {
    const path = `scroll/${String(s.index).padStart(4, '0')}.png`;
    writeFileSync(join(routeDir, path), s.bytes);
    return {
      index: s.index, scrollY: s.scrollY,
      shot: { path, sha256: sha256(s.bytes), width: viewport.width, height: viewport.height },
    };
  });

  // Resolve each constraining control onto its captured nodeId, so the evidence
  // an enum cites points at a node that exists in dom.json.
  const selectControls = (extracted.uiConstraints ?? [])
    .map((c) => ({ ...c, nodeId: nodeIdBySfIdx.get(c.sfIdx) }))
    .filter((c) => c.nodeId !== undefined);

  return {
    dom, styles, stateEntries, built, nodeIdBySfIdx, extracted, cssom, analysed,
    axBySfIdx, stateRules, selectControls,
    interactiveAx: [...axBySfIdx.values()].filter((a) => INTERACTIVE_ROLES.has(a.role)).length,
    screenshots: {
      full: {
        path: 'shot.full.png', sha256: sha256(fullShot),
        width: viewport.width, height: extracted.scrollHeight,
      },
      scroll: scrollRefs,
    },
    pageMetrics: {
      scrollHeight: extracted.scrollHeight,
      scrollWidth: extracted.scrollWidth,
      scrollSteps: scrollRefs.length,
    },
  };
}
