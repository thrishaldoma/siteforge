# 0014 — Identifier grammars, executed sabotage, and auth failing closed

Status: accepted

Four rulings. Two of them correct earlier decisions of this project's own.

## 1. `unknown` auth resolves to required — reads included

Supersedes 0010's asymmetry. `resolveAuthForCodegen` no longer takes
`isMutation`.

The original argument was that the costs differ: a wrongly-gated GET costs an
agent a login step, while a wrongly-open mutation makes every §10 auth task
bypassable. What that comparison missed is that the costs are the same *shape*
at different volumes, and only one of them is visible. A wrongly-gated read
shows up in the trajectory as a login the original did not need. A
wrongly-public gated read shows up as nothing at all: the task reads as success
and proves nothing. Failing open is the option whose damage cannot be seen.

The worry that killed the general rule in 0010 — that gating every public read
would break the anonymous crawl the clone also reproduces — rested on `unknown`
being common for reads. It is not. §6 re-issues every distinct GET anonymously,
so a genuinely public read carries `anonymous-success` evidence, resolves to
`not-required` on that evidence, and never reaches the resolver. `unknown` means
never-seen-anonymously **and** no 401 observed. A read that shallow is one
nobody has grounds to publish.

Measured on the fixtures: the only endpoint resolved on absence of evidence is
`post-api-checkout`, a mutation. The blast radius of the change is nil today,
which is the evidence that `unknown` is narrow. A test names that set, because
§8's stage report has to report it — a large `unknown` set is a shallow
anonymous crawl, and the operator wants to see it rather than have a permissive
default hide it.

## 2. Identifier grammars are one bug, not four

`includes()` on a selector and `endsWith()` on a path are the same mistake: a
string operation against a grammar with delimiters, where the operation cannot
see the delimiters or where the value is anchored. In order, it has cost:

| # | site | grammar | consequence |
|---|---|---|---|
| 1 | `.btn:focus-visible` → `.btn-visible`; every `[aria-expanded]` rule dropped | selector | decision 0008 |
| 2 | `IGNORED_DIRS` held the bare name `capture` | path | 8 of 21 catch blocks unlinted |
| 3 | `endsWith('auth/storage-state.json')` | path | any file at any depth exempt from §3.4's content scan |
| 4 | `href.startsWith(ORIGIN)` | URL | a foreign link classified same-origin |
| 5 | `cssomText.includes(c)` | selector | a probed state dropped on **every** rung-3 run |

Three of the five were found by deliberately looking. That does not scale, which
is the argument for a module and a linter rather than five fixes.

### The origin one had teeth

Two URLs pass `href.startsWith(ORIGIN)` and are not same-origin:

```
http://127.0.0.1:8789@evil.example/x   → origin http://evil.example   (userinfo)
https://example.com.evil.net/x         → origin https://example.com.evil.net
```

The second needs no port on the legitimate origin, which is every real target.

It was contained: the router chokepoint already compared parsed origins via
`originOf` and an exact `Set.has`, so the navigation would still have been
blocked. The *classifier* was the layer that was wrong — a foreign link was
called same-origin, so no out-of-scope gap was recorded and the control was
fired rather than declined. Defence in depth held and the outer layer was
broken, which is exactly the case where nothing tells you.

### The selector one was shipping a silent drop

`cssomText.includes(className)` asked whether the joined text of every state
rule contained a class the probe had just observed. It matched attribute
*names*: `.todo[data-flagged="true"]` "explains" a new class `flag`. A second
substring test beside it, `before.classes.includes(c)`, made a genuinely new
class look old for the same reason.

The rung-3 fixture now inflicts that collision — a Flag button sets
`data-flagged` (styled) and adds a bookkeeping class `flag` (styled by nothing).
Only the class makes it a probed state, since the probe's attribute tracking
covers inline styles alone. Measured: **statesProbed 2 → 3**, and back to 2 when
the substring detector is restored.

### What landed

`packages/shared/src/identifiers.ts` holds paths (`PathPattern` + `matchPath`,
anchored spellings only — a bare name throws at parse), MIME types
(`parseMime`/`assetKind` on parsed components), schemes and hosts. Origins stay
in `crawl-scope.ts` (`sameOrigin`, `isUnder`) because the crawl boundary owns
them; selectors keep `postcss-selector-parser`. `parseRouteId` is the fifth
grammar — `routeId.includes('--anon-desktop--')` is also satisfied by a pattern
slug containing those characters.

The asset-kind chain is the clearest case for consolidation: written twice as an
ordered `includes()` over the raw header, the two spellings had already drifted,
and both matched `application/x-not-css` as a stylesheet.

`pnpm lint` gains `lint:identifiers`. It fires only on receivers an audit
actually found, because a rule that flagged every `.includes()` in the repo
would collect sixty exemptions and every exemption is a place someone stopped
thinking. Array membership (`['GET'].includes(method)`) is a different thing and
is not flagged. An exemption must name the grammar and the reason.

## 3. Sabotage is executed, not authored

Eight gates carry their sabotage as a committed patch under `sabotage/`.
`pnpm sabotage` applies it, asserts the gate fails **for the stated reason**,
reverts, and asserts the tree came back byte for byte. It runs last in
`verify:clean`, because it mutates the working tree.

Three hard failures, never skips:

1. **A patch that no longer applies.** Code moves and patches rot; "3 skipped"
   tells you nothing about those 3, which is the vacuous-check shape one level
   up.
2. **A gate that fails for the wrong reason.** A patch introducing a syntax
   error also exits non-zero and would satisfy a harness that read only the exit
   code. Each entry names the string that must appear in the failing output.
3. **A revert that leaves residue**, which would turn every later result into
   noise.

The practice needed this because it had been bitten twice from inside itself,
both times found by hand and by luck:

- the §3.4 storage-state test asserted the nested file *appeared* in the
  findings. Under the bug it appeared too — reported for its **mode** rather
  than its contents — so the assertion could not distinguish the two states.
  Asserting the **rule** (`cookie-header`) fails under `endsWith` and passes
  under `===`.
- the first selector sabotage patched the parsed token set rather than the raw
  selector text, reproducing a weaker bug than the one that shipped, and passed.

Hence the two §13 rules that came with the harness: **assert on the
discriminating property**, and **reproduce the actual defect**.

The harness was itself sabotaged before being trusted: a bogus `expect` string
produces "failed, but not for the stated reason", and a patch that cannot apply
produces "patch no longer applies". Both were run.

**And the rule caught the harness a third time, on review.** The selector
sabotage had been generated by editing `selectorClassNames` to return raw text —
self-consistent with its unit-test gate, but applied against rung 3 it still
reported `statesProbed 3`. It reproduced half the defect. The one that shipped
was in the *caller*, so it is now a separate entry, `probe-detector-substring`,
gated on rung 3 where the drop reads 3 → 2. That gate did not previously exist:
`statesProbed` was checked for non-emptiness, and 2 is not empty. Rung specs
gained `expectExactly` for it, which is §13's existing preference for equality
over non-emptiness finally applied where the data allows one.

## 4. Popup origin — closed

The operator's hypothesis (that the popup event carries the intended URL before
the block resolves) was withdrawn against the measurement. Router-owned URL with
the popup's rival record removed stands. The n=2 pairing observation stays in
0013's Open list rather than becoming a gate.

## Also

`manifest.counts.gaps` was a derived count stored in two artifacts. The runtime
assertions added in 0013 stay, but the model schema now recomputes it against
`stageReport.gaps`, which is §13's rule for derived fields. That is the real fix
the operator asked for when convenient.

The crud fixture's own router no longer treats `/api-docs` as `/api`. A target
whose router is sloppy teaches the crawler the wrong shape.

## Open

- The identifier linter's receiver list is a closed audit-derived list, not a
  type. Branding `Origin`, `RelPath` and `MimeType` would make the dangerous
  call sites unrepresentable in the TypeScript packages; the `.mjs` crawler
  scripts would still need the linter.
- `pathSegments` tolerates `\\` as a separator, which is right for filesystem
  paths and wrong for URL paths, where a backslash is a legal character. No
  caller currently mixes them.
- `treeSignature()` compares `git status --porcelain` output, which detects
  content changes and untracked files but not a mode-only change. No sabotage
  patch touches a file mode.
