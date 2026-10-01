# Verification checkpoints — 2026-10-01

This records revision-bound core acceptance. It does not establish upstream
API/plugin compatibility or exhaustive behavioral equivalence.
[PARITY.md](PARITY.md) is the current acceptance ledger;
[SCENARIOS.md](SCENARIOS.md) describes workflows and sources.

## Completed bounded acceptance

- Current fully green configured library revision: **`5a994b6`**, in
  [run 36859641614](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36859641614).
  All 22 core-control cases, including three global-history cases, and all
  retained native suites pass. Build, packed consumers and CodeQL also pass;
  CodeQL reports no new alerts
- Corresponding local source checkpoint: **`8550b0f9`**, combining the reviewed
  wheel-setup correction with import/navigation race fix **`381e1346`**. Checks
  pass 489 units, 398 generated-export XSD validations plus ten native fixtures,
  lint (zero errors, 37 warnings), workflow validation and build. Packed consumers
  pass with 85 package files, Bundler/NodeNext/runtime checks and React/Vue/Svelte
  bundles
- Current paired site: **`99e608a`**, pinning **`5a994b6`**. Full CI and all eight
  native Import XML cases pass in
  [run 36862006191](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/36862006191).
  CodeQL reports no new alerts and the deployment is Ready
- Final manual QA passed on the exact **`99e608a` / `5a994b6`** site/library pair.
  No defect was found in the exercised paths. Earlier arrow, hover and Group QA
  on **`ffb1` / `e209`** exposed the global-history discrepancy; the final pass
  includes the corrected history and import behavior

The preceding hover checkpoint `2aef246` was fully green, including all 32 hover
cases, in [run 36854573667](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36854573667).
Intermediate global-history revision `d484f24` passed all prior gates and two new
history cases in [run 36856440928](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36856440928);
its third case attempted to zoom in at maximum zoom. Site `c3501f3` passed six of
eight import cases; the other two exposed a raw fixture namespace baseline and
bubbling file-cancel issue. The current green runs supersede those failure statuses.

The import/navigation fix separates parse-request cancellation from committed
rendering. Independent review reran the original failure, eight additional
preservation/supersession cases and all 13 race tests. Malformed, DTD and
missing-diagram failures preserve active navigation, exact XML, graph/DI-array
identities, selection, camera and opaque metadata. Valid replacement cancels
stale work, with history and navigation bookkeeping committed only for the
current document. The final readiness event uses the same definition/history
check as Undo/Back. Hosted core-history and site-import acceptance now pass at
the revisions above; the queued-operation structural matrix remains a distinct
evidence type from native browser input.

### Final manual observations

- Global Undo/Redo switched between outer and subprocess roots and restored the
  exact observed cameras
- Edited Order workflow export → paste import → reopen produced a byte-identical
  15,064-byte re-export, zero warnings and reset history. Malformed input and
  cancellation preserved XML, Undo availability and camera
- Original Conditional checks passed for the chosen right-side source, target
  drop Y, opposite-anchor preservation, fractional U-shaped segment editing,
  exact Undo and orthogonal routes after node movement
- Unselected hover controls appeared and disappeared correctly; source and target
  reconnect and background cancellation passed without unwanted history entries
- Group creation, rename, resize, Undo and CategoryValue export passed; the
  attribution overlay and viewer navigation passed, with zero navigation warnings

The final manual pass exercised paste import. File-chooser behavior, mid-drag
Escape and touch retain hosted-only evidence; they were not repeated manually.
The bounded core acceptance gates are complete at the stated revisions. A result
belongs only to its exact source and asserted scope. This is not blanket upstream
API/plugin compatibility: reference precision, import ordering, shared-title
behavior and the documented capability limits remain explicit. Local Undo/cancel
and metadata invariants remain regression requirements.

## How to reproduce

Use Node 24 and the pinned pnpm 10.0.0. Install with
`pnpm install --frozen-lockfile --ignore-scripts`, and install Python
`lxml==6.1.1`. For browser gates, use a supported sandbox-capable Chrome and set
`PUPPETEER_EXECUTABLE_PATH` to its executable. CI selects the runner's installed
official Google Chrome and records its path/version without disabling the sandbox.

- `pnpm run lint`
- `pnpm run test:schema`: corpus, security, actual mutation exports and XSD
- `pnpm run test:unit`: modeling/geometry/rules/viewer tests, concurrency 1
- `pnpm run test:xml` and `pnpm run test:xml-modeler`: individual oracle gates
- `pnpm run build` and `pnpm run test:package`: built entrypoints and packed consumers
- `pnpm test`: configured native suites, including smoke, frameworks, viewer,
  scenarios, contextual actions, connections, touch, core/advanced controls,
  label resize, IO conversion, flow annotations, Group labels and hover controls
- `pnpm check`: complete local sequence, requiring a supported browser environment

The CI workflow runs every browser suite independently, retaining an overall
failure if any suite fails, then saves `test-artifacts/` evidence. Inspect individual
results and touch `sharedLimitation` records rather than only group totals.
For authorized deployed-site checks, run
`SITE_BASE_URL=<verified-preview-url> node test/viewer/site-browser-parity.mjs`.
The site repository also runs its own `test/bpmn-browser.mjs` and Import XML
native gate against a served production Next build.

Local Chromium launch is blocked in this workspace. No browser security settings
were disabled to work around that restriction. Use the supported hosted result
for native acceptance.

## Historical evidence (superseded status, retained provenance)

### Historical September 30 native interaction checkpoint

- Then-published library: **`2c9296645f88d039078537612e23d3677089dd8f`**
- Reviewed source snapshot: **`6bec456f`**
- Hosted result at that revision: **not green**; core 19, connections 27, contextual
  actions nine and touch ten pass
- Remaining failing assertions: smoke double-click bendpoint deletion (three points remain
  three), advanced outside-host boundary-drop assertion, and advanced same-pool
  message reconnect
- Published paired site: **`d0b904a488172be26b142e62a28d08e6ce1a5653`**, pinning
  `2c929664`; production CI [36788799750](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/36788799750)
  and Ready preview passed

The previous published library `59cd24e5feb2d3af9506333db10abdd4bd523b12`
passed 27 native connection groups, nine contextual-action groups, ten touch
comparison groups and existing smoke/framework/viewer/business-scenario gates.
**Six cases failed across the 19 core-control and 17 advanced-interaction groups.**
The combined checkpoint was therefore not fully green. Site `f94828d` pins that
library and passed its separate served-production browser CI; its narrower gate
does not erase the library failures. That run progressed beyond the original
six failing assertions; the three later failures above still blocked a green
result at that revision.
Their diagnosis at the time must not be restated as three confirmed fork defects:

- Smoke prepared inconsistent graph/DI/render geometry and hit the wrong endpoint
- Executing pinned upstream replacement/modeling confirms same-pool MessageFlow
  reconnection converts to a SequenceFlow owned by the target process; a cross-pool
  gateway target is rejected. The blanket same-pool no-op expectation is incorrect.
  The revised test checks both cases plus exact undo/redo/reopen, but still needed
  hosted execution at that checkpoint
- Boundary-center overlap was awaiting an actual upstream native comparison before
  any change to default layering or interaction behavior

### What changed for the six failures

| Correction | Verification retained |
| --- | --- |
| Process-only lanes collect semantic members even when graph children are initially empty | Every member is assigned once, sibling memberships stay unchanged, one history entry and exact repeated undo/redo |
| Boundary drag skips unrelated sibling/grid snapping | Grabbed drop position and local invalid-drop/cancel probes pass; the later native outside-host-drop assertion still fails |
| Replacement undo preserves absent original BPMNLabel and graph-DI alias | Independent boundary/event/gateway probes restore original label object, DI absence, alias and geometry through three cycles |
| A plain or zero-net diagonal-edge gesture removes its provisional bend before completion | Selection alone changes no XML/DI/history; subsequent reconnect creates exactly one undoable command |
| Reopen checks semantic/DI equivalence rather than redundant waypoint xsi spelling | Both snapshots parse with independent upstream moddle without warnings; complete canonical XML, exact DI and resolved refs must match. Undo/cancel remain raw byte-exact |

Those were narrow corrections and assertion clarification. Label-width and IO
conversion capabilities were integrated and verified at later checkpoints.

### Local evidence at that checkpoint

- **248 tracked-source unit tests passed**, run serially
- **115 generated BPMN exports passed official XSD validation**, including actual
  Modeler/UI/connection mutations; XML corpus and security checks also passed
- Lint, library build and diff checks passed
- Independent review reran three focused failure regressions and additional
  original-label identity/DI and sibling-lane membership probes
- The 261-test whole-working-tree development result includes 13 unintegrated
  helper tests; it is deliberately **not** that checkpoint count
- Packed root/framework consumers passed at the preceding UI source checkpoint:
  strict Bundler and NodeNext TypeScript, isolated root before optional framework
  peers, all four Vite bundles and actual tarball runtime. The then-published
  checkpoint also passed hosted source, build and packed-consumer gates

All 19 core-control groups passed at `2c929664`. The 17-group advanced suite
then had two failing assertions, and smoke had the bendpoint-deletion assertion
failure. Later fixture/reference corrections and exact-revision reruns resolved
these failures. Local DOM callbacks establish state transitions and exports;
native hit testing, browser geometry and input delivery require browser evidence.

### Initial local checkpoints

The first source checkpoint passed 67 Node tests, 33 generated XSD-valid exports,
frozen install, build, package-content checks and isolated-site lint/types/build.
Its connection inference comparison covered 110,500 pairs against actual bpmn-js
18.30.1 using both custom and upstream moddle models. Real-browser and strict
package-consumer gates were still pending then.

A later local checkpoint passed 139 Node tests and 66 XSD-valid exports after
SAX/XML fidelity, fractional DI, paint order, lane/space/insertion, explicit
subtree replacement and typed exports were added. Earlier hosted approval-lane
paint order and HR undo failures were subsequently resolved at the green
checkpoint below. These historical counts do not describe the current source.

### Earlier fully green configured checkpoint

Library `37e9ec053190516c4c9fb52abe01c58650baac7a` passed
[CI run 36773803293](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36773803293):
source/XSD/units/build/packed consumers, smoke, wrappers, viewer/theme/security,
three business scenarios, HR DI undo and independent upstream browser reopen.
CodeQL reported no new alerts. That configuration did not yet include all later
connection, touch, core-control and advanced assertions.

Site `0c86270e3d70ea0f6d6a0b55fe975202efa855b3` pinned it and passed CI/preview.
Site-only follow-up `98be8faacf872554d458cc8ac14f0045cb795e55` passed
[run 36775989922](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/36775989922),
adding native served-production sample switching, navigation/search/palette,
XML export, safe fit and phone attribution checks. These were draft review
checkpoints, not complete core parity.

### Contextual controls and pointer-accurate connections

The contextual source stage passed 177 unit tests and 87 XSD exports. Its pinned
catalog compares 348 complete action/target entries; pure adapters cover
create/drop/move/attachment/insertion/copy scopes. Actual mutation tests check
edge validity, hidden-plane cleanup, event normalization, expression identities,
IO ownership and exact history. The nine native action groups subsequently
passed, including at `59cd24e`.

User QA then exposed discarded source/drop anchors and insufficient connection
editing assertions. The pointer correction at source `200e9721` passed 216 units,
88 XSD exports, 1,008 independent anchor/shape/placement probes and packed
consumers locally. It preserved explicit docking through preview/create/reconnect,
repaired end legs, retained remote bends and waypoint metadata, and added wide
screen-sized hit areas. The first 25 native connection groups subsequently passed.

Manual replay still found an imported Conditional segment with ordinates
265.199203187251 and 265.4183266932271 being treated as a free bend. The near-axis
correction uses the pinned upstream inclusive two-diagram-unit classification
through handles, gesture selection and segment planning. It normalizes only the
edited row/column and preserves original fractional DI on cancel/undo. That stage
passed 222 local units and 99 XSD exports; the expanded 27 native groups passed.

Manual preview QA at library **`e925a51` / site `79b4643`** verified chosen source
port, target drop Y, orthogonal route behavior during shape movement, the exact
fractional near-axis case and exact Undo. Creation coverage includes preview,
final DI, export and actual viewer reimport for 12 variants. Later source changes
require separate acceptance; old green results are not forward certification.

### Rule-aligned controls and native touch baseline

The UI source checkpoint (`04a1dd6a`, published as `59cd24e`) added shared append
eligibility, Back navigation, lane controls, resize policy, compensation cleanup,
truthful disabled replacement rows, keyboard fixes and label deletion safeguards.
The independently reviewed source stage passed 244 units and 112 XSD exports
before the final narrow lost-capture/annotation-deferral updates; packed consumers
passed again after those updates. Hosted execution then identified the six
failures summarized in the historical September 30 checkpoint, despite the local
passes.

All ten touch differential groups passed at `59cd24e` using actual native input
against pinned upstream and local engines. Tap selection, background pan/pinch,
context-connect, partial release, cancellation/no-mutation and mouse recovery are
measured independently. Ordinary shape touch-drag and resize did not activate in
either engine in this baseline. A successful differential result for those cases
is a shared limitation; it does not certify modeling support or rollback of an
unactivated gesture. Per-viewer pointer tracking prevents a second contact from
becoming an accidental click, including lost-capture/release ordering.

## Continuing regression requirements and capability limits

- Final manual and configured automated acceptance is complete for `99e608a` /
  `5a994b6`; later source changes require their own verification
- Preserve the green global-history, import/navigation and all retained gates on
  later source revisions
- External-label resizing, explicit IO cleanup and flow-owned annotations are
  implemented and passed their native gates at the green revision; they remain
  regression requirements, rather than outstanding implementation gaps
- Consistent foreground external labels and Group frames intentionally differ
  from reference import ordering; keep those cases separate from equal parity
- Task resize is an intentional configurable extension, not upstream behavior
- Touch group totals and the shared non-square event renderer/path limitation do
  not establish broader behavior than their recorded assertions

Keep these limits visible even after configured suites become green.

### Historical follow-up prepared after `2c929664`

That follow-up corrected native smoke setup through public
`updateWaypoints`, tested upstream-valid MessageFlow-to-SequenceFlow reconnect
conversion, and targeted a verified unobstructed boundary ring for invalid-drop
rollback. It also preserved selected endpoint editing priority over an overlapping
hover create port and applied the shared source eligibility rule to hover ports.
No Viewer paint-order change was included.

That tracked source passed 249 unit tests, 115 generated-export XSD validations,
lint, build and workflow validation. The new hit-priority suite contains ten
paired native upstream/local groups plus one local endpoint/create-port group.
It compares actual center and off-route hits instead of inferring interaction
priority from source ordering alone. Those hosted results were pending at that
milestone; later green revisions above supersede that status.
