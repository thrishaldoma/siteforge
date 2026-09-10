# GAPS

Aggregated record of everything `siteforge` could not clone, across all runs.

Each run appends its per-run gaps here. A gap is a thing that was **explicitly
stubbed** rather than silently faked (CLAUDE.md §1, §7). An empty section means
the stage ran clean, not that the stage was skipped.

<!-- siteforge:gaps:begin -->
### rung-three · capture · run_2c4fc4d3f1d59858

*2026-09-10T11:51:36.003Z — 5 gap(s).*

| severity | category | subject | stub | summary |
|---|---|---|---|---|
| info | inferred-type-narrowed | url=http://127.0.0.1:8789/api | none | <a id="gap_0c9b36d49a4a"></a>`status` narrowed to an enum of 3 on ui-constraint evidence. |
| degraded | destructive-action-skipped | routeId=root--auth-desktop--i0 nodeId=n_71316ec30c1c9da6 flowId=probe-5bfc6cd7e3 | omitted | <a id="gap_0ebfeedfeda2"></a>button "Delete account" was not fired (target-destructive, matched "delete"). |
| info | out-of-scope-control | routeId=root--auth-desktop--i0 nodeId=n_abd1be2dafb4b28e flowId=probe-2c502033b8 | none | <a id="gap_3fb7135e174b"></a>link "Email support" leaves the site (mailto:); not exercised. |
| info | out-of-scope-control | url=https://example.net/partner | none | <a id="gap_899c11676cbc"></a>A main-frame navigation to https://example.net was blocked. |
| info | out-of-scope-control | routeId=root--auth-desktop--i0 nodeId=n_d907224de5a2501a flowId=probe-09dcd186f9 | none | <a id="gap_f8413e3af126"></a>link "Help (external)" leaves the site (https://example.net); not exercised. |

### spike-target · capture · run_798552d3924a30ba

*2026-09-08T17:19:04.526Z — 2 gap(s).*

| severity | category | subject | stub | summary |
|---|---|---|---|---|
| info | out-of-scope-control | url=http://localhost:8788/download/report.csv routeId=root--anon-desktop--i0 | omitted | <a id="gap_85035ad5ea9f"></a>A download of http://localhost:8788/download/report.csv was cancelled. |
| info | out-of-scope-control | url=https://example.net/partner routeId=root--anon-desktop--i0 | none | <a id="gap_899c11676cbc"></a>A main-frame navigation to https://example.net was blocked. |

### vikunja · capture · run_0576efe36a57b5ee

*1970-01-01T00:00:00.000Z — 43 gap(s).*

| severity | category | subject | stub | summary |
|---|---|---|---|---|
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_a0f3d08b494c1763 | omitted | <a id="gap_08f46d837b45"></a>button "MOVE" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_ab554198b2e19de0 | omitted | <a id="gap_0c083fe09db9"></a>button "SET PROGRESS" was fired and did not resolve (locate/not-found). |
| info | out-of-scope-control | routeId=root--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-15e7d0e8c2 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=projects--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-026c99e48a | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=projects-id--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-dbc6de3ec6 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=labels--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-7e925bc520 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=teams--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-d94bbc9aa5 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=tasks-id--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-e648d957b4 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| info | out-of-scope-control | routeId=user-settings-general--auth-desktop--i0 nodeId=n_b6ca1ce265c2c72f flowId=probe-04038c05e3 | none | <a id="gap_0c7d543a7aa5"></a>link "Powered by Vikunja" leaves the site (https://vikunja.io); not exercised. |
| degraded | interaction-not-reproducible | routeId=root--auth-desktop--i0 nodeId=n_77b0d5955d59cdc5 | omitted | <a id="gap_1a82c75f6dc2"></a>button "Add" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_75560a658b02a54a | omitted | <a id="gap_242a960b52f1"></a>button "ADD TO FAVORITES" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_eb18d94cc6e36fc1 | omitted | <a id="gap_24448d6906c2"></a>button "SUBSCRIBE" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_4dce8a78bc7c1698 | omitted | <a id="gap_2b0695e90fdf"></a>button "COMMENT" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects-id--auth-desktop--i0 nodeId=n_61446929ff30f1ac | omitted | <a id="gap_307870c8f966"></a>button "FILTERS" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=teams--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_3362b2e95a67"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects--auth-desktop--i0 nodeId=n_86d3fdf83a3508b7 | omitted | <a id="gap_37294562368f"></a>link "NEW SAVED FILTER" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_8061269e43017329 | omitted | <a id="gap_3ac42f827a35"></a>option "First View" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_e918ccf5a94173e0 | omitted | <a id="gap_4f2217ccb9c2"></a>option "List" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_b49c2f78639e0f39 | omitted | <a id="gap_53c375be9432"></a>button "SAVE" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_561830127574"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects--auth-desktop--i0 nodeId=n_71371c57a1cc7660 | omitted | <a id="gap_5a2cde0dda86"></a>link "NEW PROJECT" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=labels--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_5d0767500042"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects--auth-desktop--i0 nodeId=n_a64767f72a13a4b5 | omitted | <a id="gap_5e1af4c37c98"></a>checkbox "Show Archived" was fired and did not resolve (click/timeout). |
| degraded | auth-required-not-captured | url=http://127.0.0.1:3803/ | none | <a id="gap_683d1108dea2"></a>7 route(s) have no anonymous auth evidence: the server answers 200 for every path and the redirect to /login happens in the browser. |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_92927de93b818f6c | omitted | <a id="gap_6a9780b47b3c"></a>button "MARK TASK DONE!" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=root--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_71041565b49d"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_5ac71e0a9b333e59 | omitted | <a id="gap_72dcea521982"></a>button "SET COLOR" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=labels--auth-desktop--i0 nodeId=n_27f54366c5800810 | omitted | <a id="gap_76b98bf6e7fd"></a>link "NEW LABEL" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_3d0b03cda8ba5dcb | omitted | <a id="gap_83f0b52e3d0a"></a>button "ADD RELATION" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_286be804c35d5518 | omitted | <a id="gap_83fc4ba03fc4"></a>button "ASSIGN TO USER" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_beb383a2a6713b7b | omitted | <a id="gap_89c4103c5dc7"></a>option "Table" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_8b845cd27338"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_8ddf69bda92e"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=projects-id--auth-desktop--i0 nodeId=n_84846e3a684e33b6 | omitted | <a id="gap_9042cd84e152"></a>banner "main navigation" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_fab89a6a7a340531 | omitted | <a id="gap_a087de6f1699"></a>button "ADD LABELS" was fired and did not resolve (locate/not-found). |
| degraded | destructive-action-skipped | routeId=user-settings-general--auth-desktop--i0 nodeId=n_0ec9da8e3da83668 flowId=probe-a0b957323e | omitted | <a id="gap_a261edfe4369"></a>link "Delete your Vikunja Account" was not fired (target-destructive, matched "delete"). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_c1899ac9203e465c | omitted | <a id="gap_a3a7d4dbfad9"></a>option "Kanban" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=teams--auth-desktop--i0 nodeId=n_27f54366c5800810 | omitted | <a id="gap_abcd5e619f57"></a>link "CREATE A TEAM" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_e251b0ac4c1cd882 | omitted | <a id="gap_b0af4e1b2497"></a>button "ADD ATTACHMENTS" was fired and did not resolve (locate/not-found). |
| degraded | interaction-not-reproducible | routeId=user-settings-general--auth-desktop--i0 nodeId=n_865cea17f6f717d2 | omitted | <a id="gap_b168dc3cb10f"></a>option "Gantt" was fired and did not resolve (click/timeout). |
| degraded | interaction-not-reproducible | routeId=tasks-id--auth-desktop--i0 nodeId=n_01c4ea503548f8e2 | omitted | <a id="gap_cbffa52017ff"></a>button "SET PRIORITY" was fired and did not resolve (locate/not-found). |
| degraded | destructive-action-skipped | routeId=tasks-id--auth-desktop--i0 nodeId=n_493715098436e26f flowId=probe-451be5e297 | omitted | <a id="gap_cf10a8a6d4f1"></a>button "DELETE" was not fired (target-destructive, matched "delete"). |
| degraded | interaction-not-reproducible | routeId=projects-id--auth-desktop--i0 nodeId=n_67ec974327a2b23f | omitted | <a id="gap_e7bce7cc27b8"></a>button "Add" was fired and did not resolve (click/timeout). |

<!-- siteforge:gaps:end -->
