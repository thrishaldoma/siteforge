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
**Two auth modes, and they change what probing is possible.** `manifest.crawl.sessionProbePolicy` records which one ran, derived from `credentialSource`:

- **credentialed** — credentials from env or keychain (§3.3), so re-auth is non-interactive. Session-destructive probes run freely, each on a session acquired for the purpose and thrown away after.
- **interactive** — a headful human login that cannot be repeated. There is one session to spend: session-destructive probes run **last**, once, and the crawl terminates after.

A coverage invariant must not hold an interactive capture to a credentialed one's standard, so `coverage.observed.sessionProbePolicy` carries the mode and the session-destructive invariant is vacuous under `interactive`.

Phase ordering is enforced by the scheduler (`planProbeSchedule`) and asserted by a test, not left as a convention — ordinary probes, then session-destructive, then target-destructive.

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

### The crawl boundary
Same-origin is enforced at a **chokepoint**, not by declining to follow links. A control that calls `window.open` or assigns `location` reaches another origin without any link being followed, and §6's behaviour probing clicks controls — so "do not follow off-origin links" left the boundary open to exactly the thing probing does.

In `context.route('**/*')`, before anything else: **abort a main-frame navigation whose origin is not in `manifest.crawl.allowedOrigins`.** That set derives from the crawl scope, in one place; a literal list at each call site is how one boundary ends up enforced three ways, two of them stale.

**Subresources to any origin are allowed and recorded.** Fonts, images, scripts and XHR from CDNs are how real sites render, and §8 localizes them later. A guard that blocks them breaks capture on every site worth cloning, so the rule is narrow on purpose. A request whose frame cannot be resolved is a subresource *unless it is a navigation* — Playwright throws on `request.frame()` for a popup's first navigation, and treating that as safe let a `window.open` to another origin complete. A navigation is never a font.

Close the escapes that never become a routable request: `page.on('popup')` records and closes immediately and never crawls; `target="_blank"` produces the same; a `download` event is recorded and cancelled.

Keep the post-click origin check as a **second layer that reports a bug in the first**. If it ever fires, the interceptor has a hole.

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
- **`requiresAuth: 'unknown'` resolves to required. Reads included.** `resolveAuthForCodegen` takes the requirement and nothing else; never read the field as a boolean, and never reintroduce a read/write split. A wrongly-gated read costs an agent one login step and is *visible* in the trajectory; a wrongly-public gated read is invisible and makes every §10 auth task that reads through it bypassable, so the trajectory reads as success while proving nothing. Failing open is the option whose damage cannot be seen. This is safe rather than merely cautious because `unknown` is narrow: §6 re-issues every distinct GET anonymously, so a genuinely public read carries `anonymous-success` evidence, resolves to `not-required` on that evidence, and never reaches the resolver. `unknown` means never-seen-anonymously **and** no 401 observed. **Codegen's stage report lists the endpoints it gated this way** — a large set is a shallow anonymous crawl, and the operator wants to see that rather than have a permissive default hide it.
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
- **A fixture app must be able to inflict the hazard it exists to test.** The sabotage rule, one level up. The rung-3 logout handler returned 204 without touching the session map, so "session-destructive" was a hazard the fixture could not actually cause — and a probe that cannot break anything proves nothing about the mechanism guarding it. The details panel toggled a class the stylesheet then styled, while claiming to be invisible to the CSSOM pass; worse, it handed the detector exactly the class diff it keys on. Audit every rung fixture for hazards it only pretends to have, and never engineer the signal the detector happens to look for.
- **A sabotage must be executed in its sabotaged state, not authored.** Every gate carries its sabotage as a committed patch under `sabotage/`; `pnpm sabotage` applies it, asserts the gate fails **for the stated reason**, reverts, and asserts the tree came back byte for byte. It runs last in `verify:clean`. Three hard failures, never skips: a patch that no longer applies (code moves, patches rot, and "3 skipped" tells you nothing about those 3); a gate that fails for the *wrong* reason (a syntax error also exits non-zero and would satisfy a harness that read only the exit code); and a revert that leaves residue. A sabotage that was never run while sabotaged is an assertion about a counterfactual nobody checked — this practice has been bitten by that twice from inside itself, both times found by hand and by luck.
- **A sabotage assertion must target the discriminating property** — the thing that differs between correct and broken, not merely something the broken version also produces. The §3.4 test asserted the nested file *appeared* in the findings; under the bug it appeared too, reported for its mode instead of its contents, so the assertion could not tell the two states apart. Asserting the **rule** that reported it (`cookie-header`) fails under `endsWith` and passes under `===`. Ask what the broken version outputs, and make sure the assertion excludes it.
- **Every mutation harness carries at least one perturbation that must _not_ move the thing it names.** A table made only of drops proves nothing about isolation: a gate that fires on *any* change satisfies every row of it. That is the mirror image of the vacuous invariant — one never fires, the other always does, and neither discriminates; both read as green. The negative case must be a change the gate could plausibly have keyed on and should not: renaming a path parameter moves `path-param-naming` and must leave `endpoint-identity` exactly where it was; a differently-spelled but still correctly-anchored §3.4 exemption must leave the secret gate green. A whitespace or rename-a-local control is the vacuous spelling of this rule — it demonstrates only that the gate is not deranged. Where the harness has a table, put the assertion on the table: at least one entry declared as a control, and the harness refuses to run when there are none.
- **A sabotage must produce a state a real run or a real edit can reach.** Third vacuity mode, alongside never-fires and fires-on-everything: a gate behaving correctly on input nothing can produce proves nothing about the input it will see, and reads exactly like a gate that works. Found in the coverage table — a sabotage setting `endpoints: 0` while leaving three of them carrying auth evidence, a capture no run can produce, green since the day it was written. The audit that followed found two more: a patch parsing a selector, discarding the parse and adding the raw text, and one iterating `[] as readonly string[]` instead of deleting the check. Nobody writes either. Every entry in `sabotage/` states its `reachable` note and the harness refuses to run without one; ask what edit or what run gets here, and if the answer is "none", the patch is testing a counterfactual twice over.
- **A gate takes its inputs as parameters, and something other than the real run has to be able to call it.** This is the root the three vacuity modes share: a gate that can only be run against the input it passes on is a gate nobody can prove fires. Never-fires, fires-on-everything and unreachable-input are three ways of not knowing, and the fix for all three is the same — separate the judgement from the wiring, so the judgement can be handed an input that breaks it. The staleness gate was the worst case found: its comparison sat downstream of a Docker boot inside `main()`, so it had never once run, let alone failed, and an inverted comparison in it would have read exactly like a working one. The rule is not satisfied by a signature change. **The audit is done when a test drives each gate to a *failing* verdict on synthetic input**; a converted gate with no such test is a refactor recorded as a gate.
- **Fourth vacuity mode: the sabotage cannot be written.** Alongside never-fires, fires-on-everything and unreachable-state, a gate whose subject file the tooling cannot read is one nobody can prove fires — and this one is a step earlier than the other three, because the machinery for proving it does not exist rather than failing to discriminate. A stray NUL byte inside a template literal compiled, typechecked, tested and committed without a murmur; `git diff` then printed "Binary files differ" and the generated patch carried no hunks. `assessToolingHostileSource` gates every source file the repo-wide walker reaches, on the ways a text file stops behaving like one — a NUL byte or invalid UTF-8 (git calls it binary), mixed line endings (a hunk generated against one convention will not apply against the other, so a committed patch rots silently), a lone carriage return (every scanner here counts lines by `\n`, so reported line numbers point elsewhere). Each rule names the tool it breaks; a rule with no motivating instance and no tool it breaks is padding, and padding is what makes the next reader stop believing the list.
- **The sabotage must reproduce the actual defect**, not a weaker one nearby. The first selector sabotage patched the parsed token set rather than the raw selector text, so it tested a bug that was never shipped and passed.
- **No invariant lands without a sabotage test** that reintroduces the bug and proves the invariant fails. Two invariants written to catch a specific silent drop were checked by hand against that drop and stayed green — twice. Neither was visible by reading the invariant; both were visible in ten seconds by breaking the extractor and watching nothing happen. An invariant that never fires is indistinguishable from one that passes.
- **Two error classes, and only one may be caught.** *Operational* — a timeout, an aborted navigation, a detached element, a refused connection: expected, recoverable, becomes a gap. *Everything else* is a defect and must propagate. No bare `catch`, no `catch (e) {}` that swallows by default: call `rethrowIfDefect(err)` first, or justify the swallow with `// operational: <reason>`. `pnpm lint` enforces it. A catch that cannot tell them apart converts a bug into missing data, which is strictly worse than a crash — a crash stops the run, missing data reports success and poisons everything downstream.
- **When a classifier cannot decide, the default is the safe one _for that category_ — never a single global fallback.** A default is chosen against the common case and then applied to every case, including the one where it is dangerous. `request.frame()` throws for a popup's first navigation, and "a request I cannot classify is a subresource" was right for subresources and let a `window.open` to another origin complete; the fix was to split the default by category — an unclassifiable *navigation* is blocked, an unclassifiable *subresource* is allowed. The same shape, found by auditing for it: `.catch(() => {})` on the anonymous auth probe left the endpoint `unknown`, and §8 resolves `unknown` to *not-required* for reads, so one swallowed rejection would publish a gated endpoint in the clone; §3.4's exemption matched `endsWith('auth/storage-state.json')`, so any file at any depth ending that way skipped the content scan; and a credential shorter than the scannable floor was skipped in silence while the gate still reported clean. Three tests: what is the category, what does failing closed mean *for it*, and does the run say so when the classifier could not decide. `pnpm lint` covers `.catch(fn)` as well as `catch {}`, because the same swallow in different syntax was invisible for nine call sites.
- **Every page the crawler opens carries the escape guards, and `pnpm lint` says so.** The context router blocks off-origin *requests*; it cannot see a popup, a `target="_blank"`, or a download, which are page-level events. A page-level guard is one you can forget at the next `newPage()`. Related: **a known gap recorded only in prose is not tracked** — decision 0012 listed an unguarded page as open, the claim was false when written, and nothing in the repository could contradict it. Either the gap is a failing gate, a skipped test naming it, or it is not being tracked at all.
- **Test a structural property structurally, never through a numeric proxy.** The rule that a claim on the model must be specific enough was first written as "at least two segments", which reads like a structural check and is not: two segments is a fact about a string, and `entities.fields` has two while covering twelve leaves. Replaced by "the claim must terminate at a schema leaf", which is the property itself. This is not another entry in 0014's table — those are all string operations against a grammar — but it shares their root: **a stand-in that correlates with the property you mean, until the day it does not.** Substring-for-token and segment-count-for-shape are two species of it. Whenever a threshold on a count is standing in for a shape, ask what the shape is and assert that instead.
- **A freeze is asserted as a complete set, never as the absence of a known-bad member.** `expect(imports).toEqual(['node:crypto', 'zod'])` covers every edge there could be; `expect(imports).not.toContain('site-model')` covers the one someone thought of, and the difference only shows up on the edge nobody predicted. The weak form was in three places, each blind in a different direction: a rung key asserted absent from one bucket could sit in two of them or in none; a walk option asserted ignored could have dropped something else instead; three hand-typed volatile field names could not see the fourth. Where the set is genuinely open, **derive its members from the schema that defines them** rather than typing them out — a field added to `ProvenanceSchema` is covered the day it lands, not the day someone remembers.
- **An invariant's observed side must be derived independently of the thing it checks.** Counting inputs with the same parser the extractor uses means a bug in that parser moves both sides and the check goes vacuous. Use raw text and a cruder detector; over-counting there is safe, sharing a code path is not.
- **Counts must be disaggregated to the granularity of the failure.** An aggregate lets a partial loss hide inside a surviving total: with attribute-state extraction fully broken, nine surviving pseudo-class entries kept `statesCssom` non-zero and the check held. Prefer an equality over a non-emptiness assertion wherever the data allows one.
- **Narrowing a type must be justified; widening is free.** `string` admits every value the real API can produce. An enum makes valid states of the real system unrepresentable in the clone, and §5 turns response schemas into the mock backend's data model — so a wrong one is silent and corrupts every trajectory touching that field. Any inference that narrows records its evidence in the model and lands in `GAPS.md` as review-required.
- **A derived field carries the evidence it was derived from, and the schema rejects a value that evidence does not support.** Observed fields are exempt; derived ones are not. `NarrowingRecord` is the pattern: it holds the counts the narrowing was drawn from, so an unjustified enum does not parse. Where recomputation is possible, recompute (`endpointId`, `contentHash`, `requiresAuth`); where only a one-directional implication is sound, enforce that and say so rather than pinning both ways — over-constraining is how a legitimate observation becomes unrepresentable.
- **Deduplicate by entity identity before any frequency heuristic.** A list endpoint polled six times is not six times the evidence. This applies to every count inference draws a conclusion from, not only enums.
- **A ground truth is measured for browser/document overlap before it is adopted.** A document can only ground a claim about a surface the crawl actually reaches. Infer's input is a capture, so if the site's pages never call the documented API, every endpoint infer emits is out-of-universe, every scored category has an empty model side, and the grade reports vacuous across the board — not a bad score, no score. **Measured: Gitea's browser and Gitea's OpenAPI document are disjoint.** Twelve pages of a seeded instance issue one XHR, to a non-API path, and five form actions, none of them naming `/api/v1`; the document declares 480 operations and the browser reaches none of them. Directus, measured with the same script, reaches 17 of 24. The criterion is `packages/verify/scripts/browser-surface.mjs` and the comparison is the strong one — does the document declare an operation of this *shape*, which is what the grader will try to match — not merely whether the path sits under the base path. Run it on a candidate before transcribing a baseline or writing a capture driver for it.
- **And the graded universe must be a path prefix the UI's own traffic falls outside of.** The second criterion, written down only because Directus failed it after passing the first. `inUniverse` compares leading segments, so a universe of `/` has an empty base and admits every path in existence — the filter does not become permissive, it stops existing, and `endpoint-identity.precision` absorbs every SPA navigation the crawler made. Expressing the universe as "paths the document declares" is worse than useless: the model's predictions would be filtered by the document they are scored against, so a hallucinated endpoint is excluded from the denominator for being hallucinated. **Measured: Vikunja passes both** — 16 of 18 observed paths declared, `/api/v1` a real prefix with the SPA shell outside it, Swagger 2.0 that the existing truth loader reads.
- **A measurement harness fails loudly when its own preconditions did not hold.** `browser-surface.mjs` crawled eight login screens and printed `disjoint` — the same verdict as the real Gitea finding, and false. Vikunja's form ignores Playwright's `fill`, and typing revealed that the SPA hydrates over the field it has already painted and eats the first characters, so `sfadmin` arrived as `in`. Nothing was broken; the harness simply measured something else and said nothing. Every precondition a measurement rests on — the seed applied, the session established, the page reached — is checked and throws, because a tool that reports a confident wrong number is worse than one that crashes.
- Test targets, in order: a static site, then a Jekyll/Hugo blog, then a self-hosted open-source app you control (Gitea, Wagtail, or similar) for M3+. Do not develop against production sites you do not own.
- Commit format: `<stage>: <what changed>`. One stage per commit.

---

## 14. Start here

Do not begin at capture. Begin at `packages/schema` — define the full `CaptureModel` in zod, with example fixtures for each type. Then build `packages/capture` against those fixtures. Everything else follows from a schema that is right.

If the schema feels wrong while writing a later stage, stop and fix the schema. Do not work around it.
