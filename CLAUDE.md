# CLAUDE.md — `siteforge`

Agent operating manual for a tool that takes a URL and produces a **self-contained, deterministic, resettable clone** of that website, usable as a reinforcement-learning environment for web agents.

> Read this file fully before writing code. When a decision here conflicts with your instinct, follow this file or open a `DECISION:` note in `docs/decisions/` and stop for review.

---

## 1. Mission

```
$ siteforge clone https://example.com --auth --out ./envs/example
$ cd ./envs/example && docker compose up
$ curl -X POST localhost:9000/reset -d '{"seed":42}'
```

After those three commands the operator must have:

- A running web app at `localhost:3000` that **looks** like the target (visual diff ≤ threshold on every captured route) and **behaves** like the target (recorded interaction traces replay successfully).
- A mock backend with seeded, inspectable, resettable state. No outbound network calls, ever.
- A control plane at `localhost:9000` exposing `reset`, `state`, `tasks`, `validate`.
- A set of generated tasks with **programmatic** success validators.
- A `GAPS.md` listing everything that could not be cloned, with each gap explicitly stubbed rather than silently faked.

"One click" means one command. It does not mean one shot — the pipeline internally loops until its own acceptance gates pass.

---

## 2. Non-goals

Do not attempt these. If a target site depends on them, record the gap and stub it.

- Recovering server-side business logic beyond what is observable at the HTTP boundary.
- Cloning canvas/WebGL/DRM-video rendering.
- Defeating bot protection (Turnstile, hCaptcha, fingerprinting walls). Abort the run with a clear message.
- Byte-identical HTML. We reproduce **rendered appearance** and **observable behavior**, not source.
- Real payments, real emails, real third-party OAuth. These become deterministic local stubs.
- Cross-browser capture. Capture depends on CDP (`Accessibility.getFullAXTree`, `DOMDebugger.getEventListeners`), so it is **Chromium-only**. Generated clones are ordinary web apps and are not restricted this way.

---

## 3. Ground rules on scope

These are engineering requirements, not decoration. Enforce them in code.

1. `siteforge` refuses to run against a target unless `--i-have-permission` is passed or the domain is in `allowlist.txt`. The CLI prints what that flag asserts.
2. Generated clones bind to loopback by default and ship with a `SITEFORGE_CLONE` banner component that is on unless `--no-banner`. A clone of a login page that is indistinguishable from the original and reachable publicly is phishing infrastructure; the banner and loopback default are what keep this a research tool.
3. Credentials come from `SITEFORGE_USER` / `SITEFORGE_PASS` env vars or the OS keychain. Never from a config file, never written to any capture artifact, never logged.
4. `capture/` is treated as sensitive: it is gitignored, and the scrubber in `packages/capture/src/scrub.ts` must redact tokens, cookies, emails, and anything matching the PII patterns before any artifact is written.

---

## 4. Stack and repo layout

TypeScript, pnpm workspaces, Node 20+. Playwright for capture. Next.js App Router + Tailwind for generated frontends. Fastify for the mock API and control plane. Vitest for unit tests, Playwright Test for behavioral tests.

```
siteforge/
├── CLAUDE.md
├── GAPS.md                      # generated per run, aggregated here
├── allowlist.txt
├── packages/
│   ├── cli/                     # `siteforge` entrypoint, orchestrates stages
│   ├── schema/                  # zod schemas for SiteModel — the contract
│   ├── capture/                 # Playwright crawler → capture/
│   ├── infer/                   # capture/ → SiteModel (LLM-assisted)
│   ├── codegen/                 # SiteModel → generated app
│   ├── verify/                  # visual + behavioral + determinism gates
│   ├── envkit/                  # control plane, gym adapters, task runtime
│   └── shared/
├── envs/                        # output: one directory per cloned site
└── docs/decisions/
```

**Stage contract:** each stage reads and writes files on disk only. No stage may hold state in memory across stages. Every stage is independently re-runnable: `siteforge capture|infer|codegen|verify`. This matters because you will iterate on `codegen` fifty times against one expensive capture.

---

## 5. The CaptureModel

`packages/schema` is the spine of the project. Define it first, in zod, and export the inferred TS types. Everything downstream imports from here. Changing this schema is a breaking change — version it with `modelVersion`.

`SiteModel` is **infer's output**, not this. It is defined at the start of M2,
derived backwards from what codegen consumes. Do not define it by
forward-transforming `CaptureModel`.

```
capture/<site-id>/
├── manifest.json            # target, timestamp, viewport, UA, seed, siteforge version
├── routes/<route-id>/
│   ├── meta.json            # url, url-pattern, title, status, template-guess
│   ├── dom.json             # normalized tree, stable nodeIds, a11y role/name per node
│   ├── styles.json          # nodeId → computed style, deduped into a styleId table
│   ├── states.json          # pseudo-class + JS-driven state deltas
│   ├── scroll/NNNN.png      # scroll-stepped screenshots
│   └── shot.full.png
├── assets/
│   ├── index.json           # originalUrl → {localPath, sha256, mime, referencedBy[]}
│   └── files/<sha256>.<ext>
├── network/
│   ├── session.har
│   └── endpoints.json       # normalized: method, path-pattern, params, response schema
├── flows/
│   ├── <flow-id>.trace.json
│   └── skipped-controls.json  # controls §6 refused to fire: role, name, node, gap
├── coverage.json            # what the input held vs what extraction produced
└── auth/storage-state.json  # gitignored, chmod 600
```

Key schema rules:

- **Deduplicate styles.** A page has thousands of nodes and maybe 200 distinct style objects. Store `styleId` references. This is the difference between a 400MB and a 4MB model.
- **Stable node IDs.** Derive from a structural path hash (`tag[nth-of-type]/...`) plus a **semantic key** of authored, data-independent attributes — not from DOM order alone, and not from content. Record the content fingerprint separately, so a diff can distinguish "node moved" from "node's content changed". Exclude classnames and framework-generated ids (React `useId`, Angular `ng-*`) from identity: both look stable and are not. They must survive re-crawls so diffs are meaningful.
- **URL patterns, not URLs.** `/product/1183` and `/product/902` collapse to `/product/:id` with two observed instances. Route identity is the pattern.
- **Response schemas, not just responses.** For each endpoint, infer a JSON Schema across all observed responses. That schema becomes the mock backend's data model — which is exactly why a narrowed type must carry its evidence (§7.5). Default to `string`.
- **Auth requirement is three-valued**, never a boolean: `required | not-required | unknown`, derived from recorded observations and not declared beside them. A crawl that only ever ran signed in has learned nothing about whether an endpoint is gated, and a boolean has nowhere to put that except `false`. Never collapse `unknown` to `false`.

---

## 6. Stage 1 — Capture

Deterministic, no LLM. This stage is a well-written crawler and nothing more.

### Setup
Fixed viewport (default 1280×800, plus 390×844 if `--responsive`). Pinned UA. `prefers-reduced-motion: reduce`. Inject a shim before any page script that freezes `Date.now`, `performance.now`, `Math.random`, and `crypto.randomUUID` against the run seed — you need this here as well as in the clone, or your "identical" recrawls will never be identical.

### Asset capture
Attach to `page.route('**/*')` and persist **every** response body content-addressed by sha256. Rewrite nothing yet. Separately, walk `document.styleSheets` and extract every `url()` reference, every `@font-face`, and every state rule.

**Identify state rules by parsing the selector, never by substring test.** Run each `selectorText` through a real selector parser (`postcss-selector-parser`) and match *nodes*: a pseudo-class node whose value is an interaction pseudo (`:hover`, `:focus`, `:focus-visible`, `:focus-within`, `:active`, `:checked`, `:indeterminate`, `:disabled`, `:enabled`, `:target`, `:visited`, `:open`), or an attribute node whose attribute is **any** `aria-*` or `data-*` — regardless of value, because an enumerated list will always trail what sites actually write. To find the nodes a state rule applies to, strip only *bare, top-level* state pseudos and query the remainder; stripping one inside `:not()`/`:is()` inverts what the selector means, and `a:not(:visited)` must not become `a:not()`.

A literal pattern list plus `String.includes` is what silently dropped every `[aria-expanded="true"]` rule in the rung-2 measurement, and turned `.btn:focus-visible` into `.btn-visible`. See docs/decisions/0008.

**That last extraction is the highest-value trick in this project.** Reading state rules straight out of the CSSOM gives you the true hover/focus definitions in one pass. Do not brute-force hover every element to discover them — that is O(n) page interactions for information already sitting in the stylesheet. Use hover probing only to resolve the handful of elements whose state changes are JS-driven and therefore absent from CSS.

### Interaction discovery
Build the candidate set from the union of:
- The accessibility tree, via CDP `Accessibility.getFullAXTree` on the **same** CDP session already opened for `getEventListeners` below — roles `button`, `link`, `textbox`, `checkbox`, `combobox`, `tab`, `menuitem`. Each AX node carries a `backendDOMNodeId` that resolves to the live element, which is what maps a11y nodes onto captured `nodeId`s. Do not use `page.accessibility.snapshot()`: it was removed from Playwright, and its replacement (`locator.ariaSnapshot()`) returns YAML with no refs and no DOM mapping. Do not reimplement accname — it is a spec you do not want to own.
- CDP `DOMDebugger.getEventListeners` on every element — catches divs with click handlers, which the a11y tree misses and which real sites are full of.
- Elements matched by the pseudo-class rules extracted above.
- `cursor: pointer` in computed style.

For each candidate, record: bounding box, a11y role and name, a stable selector, and whether a state delta was observed.

### Behavior probing
For each candidate, in a fresh page context:
1. Snapshot DOM hash + URL + a11y tree.
2. Perform the action.
3. Wait for network idle or 2s.
4. Snapshot again. Record `{preHash, action, postHash, domDelta, networkCalls[], urlChanged}`.

This tuple set **is** the functional specification. The generated clone is correct when it reproduces these transitions. Write them to `flows/`.

**Classify every candidate by who absorbs the harm** (decision 0011), because one "destructive" bucket conflates three unrelated things:

| hazard | what it costs | what to do |
|---|---|---|
| **target-destructive** | irreversible against a system we do not own | never fire (unless `--allow-destructive`, and even then an explicitly designated control stays declined). The only hazard that yields an endpoint with `responses: []` |
| **session-destructive** | ends *our* session; the target is unharmed — logout, switch account, revoke own token | **fire it**, on a session acquired for the purpose and thrown away after. Real observations, an ordinary endpoint, no gap, never synthesized |
| **out-of-scope** | nothing; it is simply not ours — external origin, `mailto:`, a file download | no endpoint either way |

A disposable *context* is not enough for the session case: `storageState` carries the cookie, but the session lives on the server and logout deletes it, so cloning the crawl's state and clicking "Sign out" ends the crawl too. Each such probe gets its own login. Where a target offers no non-interactive re-auth, run them last instead and accept that the crawl ends signed out.

**Destructive probes run last even when allowed.** A fresh page context does not undo a mutation: "Delete all todos" empties the store for every probe after it, and §6's "probes cannot contaminate each other's preconditions" is about the browser, not the server.

Log every skip as a gap, **and record the control itself** in `flows/skipped-controls.json`: role, accessible name, nodeId, route, gap id. Control-level, and no endpoint entry — capture never fired it, so it never learned the URL, and inventing one is the §7 failure this whole machinery exists to prevent. §7.6 binds it to a URL from the source.

The gap alone is not enough for the next stage to act on: a skipped `FlowTrace` is forced to `steps: []`, and role/name/nodeId live on `FlowStep.target` — so in a skipped flow they survive only as prose. This file is the structured half the empty step list threw away.

### Scroll behavior
Step scroll in 0.5-viewport increments to the bottom. Screenshot each step. Diff consecutive DOM snapshots to detect lazy loading, infinite scroll, sticky/fixed transitions, and IntersectionObserver reveals. Record scroll-triggered state changes explicitly — they are a common source of "the clone looks right on load and wrong at 40% scroll."

### Authenticated capture
`--auth` launches headful, navigates to the login route, and waits for the operator to sign in by hand (this handles MFA and CAPTCHA without any bypass logic). On success, persist `storageState`. Every subsequent run reuses it non-interactively until it expires. Anonymous and authenticated crawls are two **capture contexts** (`CaptureContext`, decision 0004), declared in the manifest and referenced by every `routeId` as `<pattern>--<context>--i<instance>`. Record which routes require auth (`RouteMeta.requiresAuth`) and what an anonymous visitor gets (`unauthenticatedBehavior`), because the clone must reproduce the redirect-to-login behavior.

**Both are three-valued and both are derived, never declared.** `requiresAuth` must equal `resolveAuthRequirement(authEvidence)`; the schema rejects a verdict the observations do not support, so `not-required` without an observed anonymous success is unrepresentable rather than merely discouraged. Use the evidence you already have:

- a **401/403 answering an uncredentialed request** settles `required` — but a 401 answering a *signed-in* one does not. That is the endpoint's own failure mode (a wrong password on a login route), not a statement about needing auth. Evidence is an interpretation the producer makes, never an automatic consequence of a status code.
- an **anonymous request that succeeded** settles `not-required`.
- **every observation carried a credential** settles nothing, but is strictly better than recording `false` — it says the crawl only ever saw this signed in, which is why the verdict is `unknown`. Read it from the full request headers: Playwright's `request.headers()` omits cookies, and reading auth evidence from it means this can never fire.
- the control appearing in an authenticated context and **not** in an anonymous one is context-diff evidence; contexts are what make it observable at all.

Re-issue each distinct **GET** endpoint once anonymously to learn what an unauthenticated caller gets. Never a mutation: issuing a PATCH or DELETE without a session to find out what happens changes the target's state, which capture must not do. Those stay `unknown`, and §8 fails them closed.

### Coverage invariants

Every extraction bug found so far has been a **silent drop**: the input contained something, the output did not, and nothing failed. Write `coverage.json` per capture — counts of what the raw input held against what extraction produced — and assert the contradictions that no correct run can produce:

| input | therefore output |
|---|---|
| stylesheets present | style table non-empty |
| CSS has interaction pseudo-classes | pseudo-class state entries non-empty |
| CSS has `aria-*`/`data-*` selectors | attribute state entries non-empty |
| CSS has `@font-face` | font descriptors non-empty |
| HAR has XHR/fetch entries | endpoints non-empty |
| document taller than 2 viewports | more than one scroll step |
| a11y tree has interactive roles | interaction candidates non-empty |
| subresources were requested | asset entries non-empty |
| credentialed requests were seen | **every** endpoint records the observations its auth verdict rests on |

A broken invariant **fails the run** — `stage-report.json` status must be `failed`, and the schema enforces that.

Two properties make an invariant actually work, both learned by reintroducing a fixed bug and watching the check stay green:

1. **The observed side must be derived independently of the extraction.** Counting inputs with the same parser the extractor uses means a bug in that parser moves both sides, and the invariant goes vacuous instead of failing. Use raw text and a cruder detector; over-counting there is safe, sharing a code path is not.
2. **It must compare like with like.** An aggregate output count lets one category mask another's disappearance.

**Standing rule:** whenever a rung finds a silent drop, add the invariant that would have caught it. The list is meant to grow.

### Crawl frontier
BFS from the entry URL. Same-origin only. Respect `--max-depth` (default 3), and the context-aware budget (decision 0004): `--max-routes` (default 40) applies **per context**, the cap of 3 instances applies **per (pattern, context)**, and `maxRoutesTotal` is a global ceiling across every context — without it, declaring six contexts silently costs six times as much. Three product pages is enough to infer the template, thirty is waste.

---

## 7. Stage 2 — Infer

This is where you, the LLM, do the work no deterministic pass can. Everything here is judgment.

1. **Design tokens.** Cluster all captured colors, spacings, radii, shadows, and font sizes into a small token set. Aim for ≤16 colors, ≤8 spacing steps. Snap near-identical values together (a site with `#1a73e8` and `#1a73e9` has one brand blue and a typo). Emit `tokens.json` and a Tailwind theme extension.

2. **Component extraction.** Find repeated DOM subtrees by structural hash across all routes. A subtree appearing ≥3 times with varying leaf text is a component with props. Name components semantically from their a11y names and content — `ProductCard`, not `Div7`. Build the component tree bottom-up: primitives, then composites, then page templates.

3. **Route templating.** Group routes by shared structure. `/product/:id` becomes one template. Distinguish layout (shared shell, nav, footer) from page content.

4. **Data model inference.** From `endpoints.json` response schemas, derive entities and relationships. `GET /api/products` returning objects with `id, title, price, categoryId` plus `GET /api/categories` gives you a two-table model with a foreign key. Write it as a Prisma-style schema in `data-model.ts`. Read foreign keys off `JsonSchemaNode.identifier.pathParamOf`, which records the endpoints whose path parameters a field's values were actually observed as — an observation, not a guess from a name ending in `Id`.

5. **Type narrowing, and the evidence it requires.** Every frequency heuristic in this stage counts **distinct records, after deduplication by entity identity** — never observations. A list endpoint polled six times is not six times the evidence.

   The default type is `string`. Narrowing must be justified; widening is free. An **enum requires evidence of a CLOSED domain, and low cardinality is not that.** Ranked:

   1. **UI constraint (primary).** A `<select>`, radio group, or fixed filter set in the captured DOM whose option values cover the field's values. This is ground truth about the domain, and the only evidence that is: we captured the UI that drives the API. A field is an enum because the DOM constrains it, not because sampling was thin.
   2. **Corroboration.** Distinct values stayed flat while distinct records grew — read statically, since one capture gives a final count rather than a trajectory: at least 20 distinct records, and a value-to-record ratio at or below 0.3.
   3. **Value shape.** Slug-like: no whitespace, short.

   Hard exclusions, regardless of the above:

   - a uniqueness ratio near 1.0 per record — free text or an identifier, never an enum;
   - values observed as a **path parameter** of any endpoint — that is a key; emit it as an identifier (`JsonSchemaNode.identifier`), not an enum. Match by **value overlap**, not by field name: path normalization collapses every id segment to the literal `:id`, so a name comparison tests against a constant;
   - values containing sentence-like text.

   **Invariant: no enum from fewer than 20 distinct records without a UI constraint backing it.** The schema enforces this — a narrowing carries the counts it was drawn from, so an unjustified enum does not parse.

   Any inference that narrows a type records its evidence in the model and lands in `GAPS.md` as review-required. A wrong enum is silent: §5 makes the response schema the mock backend's data model, so the clone rejects values the real API accepts, on every trajectory that touches the field.

6. **Binding skipped controls.** For each entry in `flows/skipped-controls.json`, look for the control's handler in the captured source — a `<form action>`, a `fetch()` literal — and bind it to a URL. On success, emit an endpoint with `discovery: bound-from-control`, `responses: []`, and the capture gap carried through; codegen implements it against the store (§8). On failure the gap stands alone. This is infer's job and not capture's: capture never fired the control, so it never learned the URL.

7. **Behavior specification.** Convert `flows/` transitions into declarative specs: `{trigger, precondition, effect}`. Effects are typed — `navigate`, `mutate-entity`, `toggle-ui-state`, `open-overlay`, `submit-form`. Anything that does not fit a known effect type is a gap, not a guess.

**Rule: when confidence is low, write a gap, not an invention.** A stubbed endpoint returning `501` with `X-Siteforge-Stub: true` is infinitely more useful in an RL env than a plausible hallucinated one, because a hallucinated endpoint silently corrupts every trajectory that touches it.

---

## 8. Stage 3 — Codegen

Emit a Next.js app plus a Fastify mock API into `envs/<site-id>/`.

### Frontend
- Tailwind configured from `tokens.json`. Use tokens, not arbitrary values; `bg-[#1a73e8]` scattered through the codebase means the design system extraction failed.
- One file per component, colocated with its story-like fixture.
- Fonts: bundle only self-hostable, permissively licensed fonts. For licensed webfonts, substitute a metric-compatible open alternative and record the swap in `GAPS.md`. Do not rehost licensed WOFF2 files.
- SVGs inlined as components; raster assets copied into `public/` under their content hash.

### Mock backend
- In-memory store implementing `snapshot(): State` and `restore(s: State): void`. Structured-clone based. Reset must be < 50ms — you will call it once per RL episode, and a slow reset silently caps your training throughput.
- Seeded from `seeds/<seed>.json`, generated from real captured responses after scrubbing.
- Implement every endpoint in `endpoints.json`. Mutations actually mutate the store. Auth is a real (if trivially simple) session check, because agents must be able to fail at logging in.
- **Implement the destructive endpoints too.** §6 skips `DELETE /api/account` because it is dangerous against the *target*; against a local mock it is free. A dead button is worse than a working one — it teaches an agent the control does nothing — and "delete your account" is a legitimate §10 task with a clean state-based validator. Where infer bound a skipped control to a URL (§7.6), implement it fully against the store; the response shape comes from the inferred data model and the gap records that it was **synthesized** rather than observed.
- **`requiresAuth: 'unknown'` resolves to required for mutations, and to not-required for reads.** Fail closed where it costs something. A clone that demands a login the original did not costs an agent one step; a clone that permits an anonymous mutation the original blocked makes every §10 auth task trivially bypassable and every trajectory through it worthless. Use `resolveAuthForCodegen`; never read the field as a boolean.
- No outbound network. Enforce with an undici agent that throws on any non-loopback host — do not rely on convention.

### Determinism harness
Non-negotiable for RL. Ship as `lib/determinism.ts`, imported in the root layout:
- `Date` and `Math.random` seeded from the env seed.
- IDs from a seeded counter, never `crypto.randomUUID()`.
- CSS animations and transitions disabled when `SITEFORGE_MODE=eval`.
- No lazy-loading jitter: `loading="eager"` on all images in eval mode.
- Fixed viewport enforced by the env launcher.

**Acceptance test for this section:** same seed + same action sequence → byte-identical state hash and ≤ 0.1% pixel diff, across two separate runs. If that test does not pass, the environment is not an RL environment; it is a slot machine.

---

## 9. Stage 4 — Verify (the repair loop)

Three gates. Each loops with a hard iteration cap; on cap, write a gap and continue rather than spinning.

### Visual gate (cap 5 iterations/route)
Render clone route at the captured viewport, screenshot, compare with `odiff`. On failure: crop the top-3 worst diff regions and pass Claude **both** the image crops **and** the computed-style delta for the nodes in those regions. Image-only feedback produces vague guesses; the style delta produces precise fixes. Threshold: 2% of pixels, 5% for routes containing captured video or third-party embeds.

### Behavioral gate (cap 3 iterations/flow)
Replay every `flows/*.trace.json` against the clone with Playwright. Compare **a11y-tree deltas**, not pixels — the question is whether the same semantic transition occurred. Assert the same network calls fired against the mock API.

### Determinism gate (no repair loop — hard fail)
Run the harness in §8 twice. Any divergence fails the build. Do not paper over this one.

Between iterations, keep a `verify/history.jsonl` of what was tried. If two consecutive attempts produce the same diff, stop — you are in a loop, and the third attempt will not help either. Write the gap.

---

## 10. Stage 5 — RL environment interface

The point of the whole exercise.

### Control plane — Fastify on `:9000`, separate from the app
```
POST /reset        {seed, taskId?}  → {observation, taskSpec}
GET  /state                         → full backend state (reward computation)
GET  /tasks                         → task list
POST /validate     {taskId}         → {success: bool, partial: float, detail}
GET  /health
```

### Observation
```ts
type Observation = {
  url: string;
  screenshot: string;        // base64 png
  a11yTree: A11yNode[];      // primary modality — most agents use this
  dom: string;               // sanitized outerHTML
  focusedRef: string | null;
  actionSpace: ElementRef[];  // enumerated interactive elements w/ stable refs
};
```

Enumerate `actionSpace` from the live DOM using the same discovery logic as capture (§6) — the *discovery* is shared, not the id scheme. Strip `data-sf-entity` from both `dom` and `a11yTree` before they reach the agent (decision 0007): the agent gets an opaque ref, the env holds the map. An agent that can read entity identity off the DOM learns a policy that cannot survive contact with the real site.

### Action space
`click(ref)`, `type(ref, text)`, `select(ref, option)`, `scroll(dx, dy)`, `key(k)`, `goto(url)`, `back()`, `done()`.

Refs are `elementRef`s, not CSS selectors and **not** capture-time `nodeId`s (decision 0007) — selectors break the moment the agent causes a re-render, and `nodeId` is positional within a homogeneous collection, so it would silently retarget rather than break. Resolution order:

1. **Entity anchor** — `data-sf-entity="product:MUG-BLUE"`, emitted by codegen from the mock backend's own ids. `ref = hash(role | entityKey)`.
2. **Accessible name + role**, where no entity backs the element.
3. **Position** — last resort; the observation marks the ref `positional: true` so fragility is visible rather than assumed away.

Refs are episode-scoped: re-enumerated every observation, never persisted across `reset`. An action against a ref whose element identity signature has changed returns a typed `StaleRefError`. **Never silently retarget** — a rejected action costs one step, a retargeted click writes a corrupted trajectory that reads as success.

### Adapters
Ship a Gymnasium-compatible Python wrapper in `envkit/python/` and a TS client. Keep them thin: the HTTP control plane is the real interface, and adapters are conveniences.

### Tasks
Generate candidates from observed flows, then have Claude write natural-language instructions for each. Every task needs a **validator that reads backend state**, not the DOM:

```ts
{
  id: "checkout-two-items",
  instruction: "Add a blue mug and a notebook to your cart and complete checkout.",
  seed: 42,
  validator: (s: State) => {
    const o = s.orders.find(o => o.status === "placed");
    return !!o && o.items.length === 2 && o.items.some(i => i.sku === "MUG-BLUE");
  },
  partialCredit: [
    { label: "items in cart", check: (s) => s.cart.items.length === 2 },
    { label: "reached checkout", check: (s) => s.session.visited.includes("/checkout") },
  ],
}
```

DOM-based validators are how agents learn to fake success. State-based validators are how they learn to do the task.

---

## 11. Known-hard cases and required fallbacks

| Case | Required handling |
|---|---|
| CSS-in-JS hashed classnames | Normalize by computed style value, never by class name |
| Shadow DOM | Pierce with `page.$$('*')` + `shadowRoot` walk; flatten with a marker attribute |
| iframes (same-origin) | Recurse capture; embed as nested route |
| iframes (third-party) | Static screenshot placeholder + gap |
| WebSocket-driven UI | Record frames; replay as scripted timeline; gap if interactive |
| Infinite scroll | Capture 3 pages of data; mock paginates over the seed |
| OAuth / third-party login | Replace with local username/password against the mock store; gap |
| Payment forms | Local stub accepting a fixed test card; never proxy to a real processor |
| Bot protection | Abort with clear message; do not attempt bypass |
| Licensed webfonts | Metric-compatible open substitute; gap |
| A/B tested content | Pin one variant, record that you did |

---

## 12. Definition of done

Milestone gates. Do not start a milestone before the previous one's gate is green.

- **M1 — Capture.** `siteforge capture <url>` produces a schema-valid `capture/` for 3 test sites of increasing complexity. Recrawl is idempotent modulo timestamps.
- **M2 — Static clone.** Visual gate passes on all routes of a static marketing site. No backend yet.
- **M3 — Functional clone.** Mock backend live; behavioral gate passes on a CRUD app (a todo app or forum is the right test target).
- **M4 — Deterministic.** Determinism gate green. Reset < 50ms.
- **M5 — RL env.** Control plane live, 10 tasks with state-based validators, Gymnasium adapter passes a random-policy smoke test for 100 episodes without crashing.
- **M6 — Authenticated.** `--auth` path works end to end; login/logout/session-expiry all reproduce.

---

## 13. Working conventions

- Write the zod schema before the code that produces or consumes it. Schema drift between stages is the failure mode that will cost you the most time.
- Every stage writes a `stage-report.json`: inputs, outputs, duration, warnings, gaps. The CLI prints a digest.
- Prefer deterministic code over LLM calls. Every LLM call in the pipeline needs a comment justifying why a deterministic approach cannot do the job. Inference (§7) is legitimately LLM work; asset rewriting is not.
- Cache LLM calls by input hash in `.siteforge-cache/`. You will re-run `infer` many times against an unchanged capture.
- Never `--force` past a failing gate. Add the gap and let the gate fail visibly.
- **The definition of green is `pnpm verify:clean`**: a fresh clone of the committed HEAD, installed, built, tested, and both measurement rungs run in a temp directory. No milestone gate in §12 counts unless it passed there. A gate that runs where the code already is cannot tell you the code is committed — `packages/capture/` was ignored by an unanchored `.gitignore` pattern and had never been committed at all, while every local check passed.
- **Every `.gitignore` pattern is explicitly anchored**: `/x` for root-only, `**/x` where any-depth is intended. An unanchored pattern matches at any depth by accident, which is how a source package disappeared. A test asserts it, and asserts that every workspace package has tracked files.
- **§3.4 is a gate, not a note.** Every file written under `capture/` is scanned for cookies, `Authorization` headers, bearer and JWT shapes, and the literal values of `SITEFORGE_USER`/`SITEFORGE_PASS`. A hit fails the run. `auth/storage-state.json` is the one exemption and is checked for mode `0600` instead — the single artifact allowed to hold a credential has to prove it is protected.
- **No invariant lands without a sabotage test** that reintroduces the bug and proves the invariant fails. Two invariants written to catch a specific silent drop were checked by hand against that drop and stayed green — twice. Neither was visible by reading the invariant; both were visible in ten seconds by breaking the extractor and watching nothing happen. An invariant that never fires is indistinguishable from one that passes.
- **An invariant's observed side must be derived independently of the thing it checks.** Counting inputs with the same parser the extractor uses means a bug in that parser moves both sides and the check goes vacuous. Use raw text and a cruder detector; over-counting there is safe, sharing a code path is not.
- **Counts must be disaggregated to the granularity of the failure.** An aggregate lets a partial loss hide inside a surviving total: with attribute-state extraction fully broken, nine surviving pseudo-class entries kept `statesCssom` non-zero and the check held. Prefer an equality over a non-emptiness assertion wherever the data allows one.
- **Narrowing a type must be justified; widening is free.** `string` admits every value the real API can produce. An enum makes valid states of the real system unrepresentable in the clone, and §5 turns response schemas into the mock backend's data model — so a wrong one is silent and corrupts every trajectory touching that field. Any inference that narrows records its evidence in the model and lands in `GAPS.md` as review-required.
- **A derived field carries the evidence it was derived from, and the schema rejects a value that evidence does not support.** Observed fields are exempt; derived ones are not. `NarrowingRecord` is the pattern: it holds the counts the narrowing was drawn from, so an unjustified enum does not parse. Where recomputation is possible, recompute (`endpointId`, `contentHash`, `requiresAuth`); where only a one-directional implication is sound, enforce that and say so rather than pinning both ways — over-constraining is how a legitimate observation becomes unrepresentable.
- **Deduplicate by entity identity before any frequency heuristic.** A list endpoint polled six times is not six times the evidence. This applies to every count inference draws a conclusion from, not only enums.
- Test targets, in order: a static site, then a Jekyll/Hugo blog, then a self-hosted open-source app you control (Gitea, Wagtail, or similar) for M3+. Do not develop against production sites you do not own.
- Commit format: `<stage>: <what changed>`. One stage per commit.

---

## 14. Start here

Do not begin at capture. Begin at `packages/schema` — define the full `CaptureModel` in zod, with example fixtures for each type. Then build `packages/capture` against those fixtures. Everything else follows from a schema that is right.

If the schema feels wrong while writing a later stage, stop and fix the schema. Do not work around it.
