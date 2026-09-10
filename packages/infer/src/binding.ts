/**
 * Piece 5 — §7.6, binding a control capture never fired to the URL it reaches.
 *
 * The ranking is declared in 0041 §2 and this is its implementation. The record
 * and the evaluator are `@siteforge/shared`'s `assessControlBindings`, shared
 * with 0030's select binding; what lives here is the **rung table**, because
 * the rungs are what differ between the two problems.
 *
 * §7.6: *"For each entry in `flows/skipped-controls.json`, look for the
 * control's handler in the captured source — a `<form action>`, a `fetch()`
 * literal — and bind it to a URL. … On failure the gap stands alone. This is
 * infer's job and not capture's: capture never fired the control, so it never
 * learned the URL."*
 *
 * ### The two declines are ranks, not a filter
 *
 * 0033 §4.2's rule. "Skip landmarks and external origins, then run the ladder"
 * is the unranked veto verbatim — and it is not a hypothetical here, because a
 * `<form action="https://external/">` is a rank-3 hit that must not bind. Both
 * declines are evaluable standalone (rank 1 reads the tag, rank 2 reads the
 * origin of the control's own URL attribute), which is what makes them rungs
 * rather than post-filters wearing a rank.
 */
import {
  assessControlBindings,
  normalizePath,
  type BindingReport,
  type BindingRung,
  type UrlTarget,
} from '@siteforge/shared';
import {
  deriveEndpointId,
  patternParams,
  type ApiOperation,
  type DomNode,
  type SkippedControlIndex,
} from '@siteforge/schema';
import type { Capture } from './capture.js';

/**
 * A skipped control with the DOM facts the rungs read, resolved by the caller.
 *
 * Resolution happens once, outside the rungs, so a rung is a pure function of
 * facts rather than of a tree walk — §13's rule that a gate takes its inputs as
 * parameters, applied one level down.
 */
export interface BindableControl {
  readonly controlId: string;
  readonly gapId: string;
  readonly routeId: string;
  /** The control's own tag, lowercased. `null` when the node was not found. */
  readonly tag: string | null;
  /** The control's own attributes. Empty when the node was not found. */
  readonly attributes: Readonly<Record<string, string>>;
  /** `action`/`method` of the nearest ancestor `<form>`, when there is one. */
  readonly form: { readonly action: string; readonly method: string | null } | null;
  /** Origins the crawl declared in scope. `manifest.crawl.allowedOrigins`. */
  readonly allowedOrigins: readonly string[];
}

/**
 * Elements that are landmarks rather than controls.
 *
 * Named as tags rather than as a11y roles on purpose: the role is what put
 * these in the candidate set in the first place (0041 §6 — `banner` is not one
 * of §6's candidate roles, so they arrived by another path), and re-reading the
 * same role to exclude them would be trusting the classification that was
 * already wrong once.
 */
const LANDMARK_TAGS = new Set(['header', 'footer', 'nav', 'aside', 'main', 'section', 'article']);

/** Schemes that are not an HTTP surface at all. §6's out-of-scope hazard. */
const NON_HTTP_SCHEME = /^(?!https?:)[a-z][a-z0-9+.-]*:/i;

const urlAttribute = (c: BindableControl): string | null =>
  c.attributes['href'] ?? c.form?.action ?? c.attributes['action'] ?? null;

/**
 * Resolve against the route's own origin so a relative path can be compared.
 *
 * Parsed, never prefix-tested: §13's identifier rule. A `startsWith` against
 * the allow-list admits `http://127.0.0.1:38030/x` for an allowed
 * `http://127.0.0.1:3803`, and that URL parses, so it would go on to bind a
 * path on a foreign origin.
 *
 * **`URL.canParse` rather than `try/catch`,** and the reason is the error
 * taxonomy rather than style: `new URL('nonsense')` throws a `TypeError`, and
 * §13 says a `TypeError` is *never* operational — `rethrowIfDefect` would
 * rethrow it. But an unparseable `href` is ordinary input from a real page, not
 * a defect in this code. Rather than argue the taxonomy into a special case,
 * ask the question that has an answer without throwing.
 */
const parsed = (raw: string, base: string): URL | null =>
  URL.canParse(raw, base) ? new URL(raw, base) : null;

/** Looks like a path rather than a class name or an arbitrary token. */
const PATH_LIKE = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * The rungs, in rank order. 0041 §2.
 *
 * `base` is any absolute URL on the crawl's origin — relative attributes are
 * resolved against it, and it is passed rather than derived so the rungs stay
 * pure.
 */
export function urlBindingRungs(base: string): ReadonlyArray<BindingRung<BindableControl, UrlTarget>> {
  return [
    {
      rank: 1,
      id: 'not-a-control',
      run: (c) => {
        if (c.tag === null || !LANDMARK_TAGS.has(c.tag)) return null;
        return {
          kind: 'decline',
          reason: 'landmark',
          detail: `<${c.tag}> is a landmark, not a control: it has no activation behaviour to reproduce, so there is no URL it reaches`,
        };
      },
    },
    {
      rank: 2,
      id: 'not-ours',
      run: (c) => {
        const raw = urlAttribute(c);
        if (raw === null) return null;
        if ('download' in c.attributes) {
          return {
            kind: 'decline',
            reason: 'download',
            detail: `${raw} is a download; §6's hazard table gives it no endpoint either way`,
          };
        }
        if (NON_HTTP_SCHEME.test(raw)) {
          return {
            kind: 'decline',
            reason: 'non-http-scheme',
            detail: `${raw} is not an HTTP surface`,
          };
        }
        const origin = parsed(raw, base)?.origin ?? null;
        // Length-guarded: `.every([])` is `true`, so an empty allowlist would
        // declare every origin out of scope and decline the whole input. An
        // empty crawl scope is a defect in the manifest, not a verdict.
        if (c.allowedOrigins.length === 0) {
          throw new Error(
            `control ${c.controlId} carries no allowed origins. An empty crawl scope cannot ` +
            'decide whether a URL is ours, and answering either way invents a boundary.',
          );
        }
        if (origin === null || c.allowedOrigins.includes(origin)) return null;
        return {
          kind: 'decline',
          reason: 'external-origin',
          detail: `${raw} resolves to ${origin}, which is not in the crawl scope`,
        };
      },
    },
    {
      rank: 3,
      id: 'form-action',
      run: (c) => {
        const action = c.form?.action ?? c.attributes['action'];
        if (action === undefined) return null;
        const path = parsed(action, base)?.pathname;
        if (path === undefined) return null;
        // HTML's default. Not a guess: a form with no method attribute submits
        // with GET, and that is the specification rather than a heuristic.
        const declared = (c.form?.method ?? 'get').toLowerCase();
        const method = declared === 'post' ? 'POST' : 'GET';
        return {
          kind: 'bind',
          candidates: [
            {
              target: { kind: 'url', path: normalizePath(path).pattern, method },
              detail: `<form action="${action}" method="${declared}">`,
            },
          ],
        };
      },
    },
    {
      rank: 4,
      id: 'href',
      run: (c) => {
        const href = c.attributes['href'];
        if (href === undefined) return null;
        const path = parsed(href, base)?.pathname;
        if (path === undefined) return null;
        return {
          kind: 'bind',
          candidates: [
            {
              // A navigation is a GET. Evidence, not a default.
              target: { kind: 'url', path: normalizePath(path).pattern, method: 'GET' },
              detail: `href="${href}"`,
            },
          ],
        };
      },
    },
    {
      rank: 5,
      id: 'control-local-literal',
      run: (c) => {
        // Only the control's *own* attributes. The moment this reaches past the
        // element it becomes 0041 §2.2's chunk co-occurrence, which the ranking
        // declines on a measurement.
        // Every match, never a chosen one (0042). Two path-like attributes
        // used to mean `Object.entries` order decided; the rung no longer
        // holds that choice, and the evaluator declines an ambiguity it
        // cannot resolve. No tiebreak is declared here on purpose: there is
        // no argument for `data-url` over `data-endpoint`, and inventing one
        // to avoid a decline is how a coin flip acquires a rationale.
        const candidates = Object.entries(c.attributes)
          // `data-sf-*` is **ours** — siteforge injects it (decision 0007).
          // Reading our own attribute back as if the site had authored it
          // would be the generated-fixture circularity, one attribute wide.
          .filter(([name]) => name.startsWith('data-') && !name.startsWith('data-sf-'))
          .filter(([, value]) => PATH_LIKE.test(value))
          .map(([name, value]) => ({
            target: { kind: 'url' as const, path: normalizePath(value).pattern, method: 'GET' as const },
            detail: `${name}="${value}" on the control itself`,
          }));
        return candidates.length === 0 ? null : { kind: 'bind', candidates };
      },
    },
  ];
}


/* ------------------------------------------------------- resolution and emission */

/**
 * Find each skipped control's node, its tag, its attributes and its nearest
 * ancestor `<form>`.
 *
 * One walk per route, resolving every control on it — not one walk per control.
 * A control whose node is not in `dom.json` gets `tag: null` and no attributes,
 * so every rung declines to speak and it lands in `unbound`. That is the
 * correct outcome and not a swallow: §7.6 says the gap stands alone on failure,
 * and a missing node is a failure to find evidence rather than an error.
 */
export function resolveBindableControls(
  capture: Capture,
  index: SkippedControlIndex,
): BindableControl[] {
  const allowedOrigins = capture.manifest.crawl.allowedOrigins;
  const byRoute = new Map<string, typeof index.controls>();
  for (const control of index.controls) {
    const list = byRoute.get(control.routeId) ?? [];
    list.push(control);
    byRoute.set(control.routeId, list);
  }

  const out: BindableControl[] = [];
  for (const [routeId, controls] of byRoute) {
    const route = capture.routes.find((r) => r.routeId === routeId);
    const wanted = new Set(controls.map((c) => c.nodeId));
    const found = new Map<string, { tag: string; attributes: Record<string, string>; form: BindableControl['form'] }>();

    if (route !== undefined) {
      const visit = (node: DomNode, form: BindableControl['form']): void => {
        if (node.nodeType !== 'element') return;
        const here =
          node.tag === 'form'
            ? {
                action: node.attributes['action'] ?? '',
                method: node.attributes['method'] ?? null,
              }
            : form;
        if (wanted.has(node.nodeId)) {
          found.set(node.nodeId, {
            tag: node.tag,
            attributes: node.attributes,
            // A `<form>` with no action submits to its own URL; an empty
            // action is not a binding, so it is dropped rather than bound to ''.
            form: here !== null && here.action.length > 0 ? here : null,
          });
        }
        for (const child of node.children) visit(child, here);
      };
      visit(route.dom.root, null);
    }

    for (const control of controls) {
      const node = found.get(control.nodeId);
      out.push({
        controlId: control.controlId,
        gapId: control.gapId,
        routeId,
        tag: node?.tag ?? null,
        attributes: node?.attributes ?? {},
        form: node?.form ?? null,
        allowedOrigins,
      });
    }
  }
  return out;
}

export interface BoundOperations {
  readonly report: BindingReport<UrlTarget>;
  readonly operations: readonly ApiOperation[];
  /** Every control that contributed, per emitted operation id. */
  readonly contributors: ReadonlyMap<string, readonly string[]>;
}

/**
 * Turn a binding report into operations, deduplicated by `(method, pattern)`.
 *
 * §5: URL patterns, not URLs. Seven sidebar links seen on seven routes are one
 * operation, not forty-nine — and every contributing control is kept, because
 * losing them would make the binding unreviewable.
 *
 * `effect` is `custom` with the gap, never a guessed `create`/`delete`. §7.7:
 * anything that does not fit a known effect type is a gap, not a guess. This
 * also keeps a bound operation from inventing an entity, since entity
 * derivation reads only `list`/`read`/`create`/`update`/`delete`.
 */
export function bindSkippedControls(
  capture: Capture,
  index: SkippedControlIndex,
): BoundOperations {
  const base = capture.manifest.target.entryUrl;
  const controls = resolveBindableControls(capture, index);
  const report = assessControlBindings({ controls, rungs: urlBindingRungs(base) });

  const observed = new Set(
    capture.endpoints.endpoints.map((e) => deriveEndpointId(e.method, e.pathPattern)),
  );
  const byOperation = new Map<string, { binding: (typeof report.bound)[number]; controls: string[] }>();
  for (const binding of report.bound) {
    const id = deriveEndpointId(binding.target.method, binding.target.path);
    // An endpoint capture actually called is not a synthesized one. Emitting a
    // `bound-from-control` duplicate would replace an observation with a
    // weaker claim about the same thing.
    if (observed.has(id)) continue;
    const seen = byOperation.get(id);
    if (seen === undefined) byOperation.set(id, { binding, controls: [binding.controlId] });
    else seen.controls.push(binding.controlId);
  }

  const operations: ApiOperation[] = [];
  const contributors = new Map<string, readonly string[]>();
  for (const [id, { binding, controls: ids }] of [...byOperation].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rung = binding.evidence.find((e) => e.rank === binding.rank);
    const evidence = rung === undefined ? undefined : BINDING_EVIDENCE_KIND[rung.rung];
    if (rung === undefined || evidence === undefined) {
      // No default. A rung whose id is not in the vocabulary means someone
      // added a rung without deciding what the artifact records for it, and
      // guessing `href` there would write a plausible wrong provenance onto a
      // synthesized endpoint — §7's cardinal sin with a paper trail.
      throw new Error(
        `binding for ${binding.controlId} won at rank ${binding.rank} on rung ` +
        `'${rung?.rung ?? '(none)'}', which has no entry in BINDING_EVIDENCE_KIND.`,
      );
    }
    operations.push({
      operationId: id,
      method: binding.target.method,
      pathPattern: binding.target.path,
      pathParams: patternParams(binding.target.path).map((name) => ({
        name,
        type: 'string' as const,
        required: true,
        binds: null,
      })),
      queryParams: [],
      request: null,
      // The schema rejects a bound operation carrying an observed response,
      // which is the point: capture never fired this control.
      responses: [],
      // No observation, so no evidence, so `unknown` — which §8 resolves to
      // required. Never asserted; the schema recomputes it.
      requiresAuth: 'unknown',
      authEvidence: [],
      discovery: {
        kind: 'bound-from-control',
        controlId: binding.controlId,
        evidence,
        gapId: binding.gapId,
      },
      effect: {
        kind: 'custom',
        gapId: binding.gapId,
          summary: `bound from a control capture never fired (§7.6, rank ${binding.rank} ${rung.rung}); the behaviour behind it is unobserved`,
      },
    });
    contributors.set(id, ids);
  }
  return { report, operations, contributors };
}

/**
 * Rung id to the schema's evidence vocabulary.
 *
 * A map rather than a cast, so adding a rung without deciding what it records
 * fails to compile instead of writing a plausible wrong value.
 */
const BINDING_EVIDENCE_KIND: Readonly<Record<string, 'form-action' | 'href' | 'control-local-literal' | undefined>> = {
  'form-action': 'form-action',
  href: 'href',
  'control-local-literal': 'control-local-literal',
};
