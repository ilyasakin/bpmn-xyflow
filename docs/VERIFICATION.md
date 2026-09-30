# Verification checkpoints — 2026-09-30

This records revision-bound evidence. It is **not a full core-parity completion
claim**. [PARITY.md](PARITY.md) is the current acceptance ledger;
[SCENARIOS.md](SCENARIOS.md) describes workflows and sources.

## Current: three hosted assertions remain under diagnosis

- Published library: **`2c9296645f88d039078537612e23d3677089dd8f`**
- Reviewed source snapshot: **`6bec456f`**
- Current hosted result: **not green**; core 19, connections 27, contextual
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
does not erase the library failures. The new run progresses beyond the original
six failing assertions; the three later failures above still block a green result.
Their current diagnosis must not be restated as three confirmed fork defects:

- Smoke prepared inconsistent graph/DI/render geometry and hit the wrong endpoint
- Executing pinned upstream replacement/modeling confirms same-pool MessageFlow
  reconnection converts to a SequenceFlow owned by the target process; a cross-pool
  gateway target is rejected. The blanket same-pool no-op expectation is incorrect.
  The revised test checks both cases plus exact undo/redo/reopen, but still needs
  hosted execution
- Boundary-center overlap is awaiting an actual upstream native comparison before
  any change to default layering or interaction behavior

### What changed for the six failures

| Correction | Verification retained |
| --- | --- |
| Process-only lanes collect semantic members even when graph children are initially empty | Every member is assigned once, sibling memberships stay unchanged, one history entry and exact repeated undo/redo |
| Boundary drag skips unrelated sibling/grid snapping | Grabbed drop position and local invalid-drop/cancel probes pass; the later native outside-host-drop assertion still fails |
| Replacement undo preserves absent original BPMNLabel and graph-DI alias | Independent boundary/event/gateway probes restore original label object, DI absence, alias and geometry through three cycles |
| A plain or zero-net diagonal-edge gesture removes its provisional bend before completion | Selection alone changes no XML/DI/history; subsequent reconnect creates exactly one undoable command |
| Reopen checks semantic/DI equivalence rather than redundant waypoint xsi spelling | Both snapshots parse with independent upstream moddle without warnings; complete canonical XML, exact DI and resolved refs must match. Undo/cancel remain raw byte-exact |

These are narrow corrections and assertion clarification, not integration of the
remaining label-width/IO-conversion capabilities.

### Current local evidence

- **248 tracked-source unit tests passed**, run serially
- **115 generated BPMN exports passed official XSD validation**, including actual
  Modeler/UI/connection mutations; XML corpus and security checks also passed
- Lint, library build and diff checks passed
- Independent review reran three focused failure regressions and additional
  original-label identity/DI and sibling-lane membership probes
- The 261-test whole-working-tree development result includes 13 unintegrated
  helper tests; it is deliberately **not** the current checkpoint count
- Packed root/framework consumers passed at the preceding UI source checkpoint:
  strict Bundler and NodeNext TypeScript, isolated root before optional framework
  peers, all four Vite bundles and actual tarball runtime. The current published
  checkpoint also passed hosted source, build and packed-consumer gates

All 19 core-control groups now pass at `2c929664`. The 17-group advanced suite
still has two failing assertions, and smoke has the bendpoint-deletion assertion
failure. Resolve their fixture/expectation/baseline diagnoses and perform a fresh
exact-revision rerun alongside the other suites. Local DOM
callbacks prove state transitions and exports; they do not prove native hit testing, browser geometry or input delivery.

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
- `pnpm test`: native smoke, React/multi, viewer, scenarios, contextual actions,
  connections, touch, core controls and advanced interactions
- `pnpm check`: complete local sequence, requiring a supported browser environment

The CI workflow runs every browser suite independently, retaining an overall
failure if any suite fails, then saves `test-artifacts/` evidence. Inspect individual
results and touch `sharedLimitation` records rather than only group totals.
For authorized deployed-site checks, run
`SITE_BASE_URL=<verified-preview-url> node test/viewer/site-browser-parity.mjs`.
The site repository also runs its own `test/bpmn-browser.mjs` against a served
production Next build.

Local Chromium launch is blocked in this workspace. No browser security settings
were disabled to work around that restriction. Use the supported hosted result
for native acceptance.

## Historical evidence (superseded status, retained provenance)

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
final DI, export and actual viewer reimport for 12 variants. The current native
failures remain separate acceptance blockers; old green results are not forward
certification.

### Rule-aligned controls and native touch baseline

The UI source checkpoint (`04a1dd6a`, published as `59cd24e`) added shared append
eligibility, Back navigation, lane controls, resize policy, compensation cleanup,
truthful disabled replacement rows, keyboard fixes and label deletion safeguards.
The independently reviewed source stage passed 244 units and 112 XSD exports
before the final narrow lost-capture/annotation-deferral updates; packed consumers
passed again after those updates. Hosted execution then identified the six
failures summarized in the current section, despite the local passes.

All ten touch differential groups passed at `59cd24e` using actual native input
against pinned upstream and local engines. Tap selection, background pan/pinch,
context-connect, partial release, cancellation/no-mutation and mouse recovery are
measured independently. Ordinary shape touch-drag and resize did not activate in
either engine in this baseline. A successful differential result for those cases
is a shared limitation; it does not certify modeling support or rollback of an
unactivated gesture. Per-viewer pointer tracking prevents a second contact from
becoming an accidental click, including lost-capture/release ordering.

## Open acceptance and capability limits

- Resolve the three current native assertion diagnoses and rerun the corrected
  exact revision; paired site `d0b904a` production CI/Ready preview already passed
- External-label width resize is not yet integrated
- IO-bearing cross-family replacement still needs explicit, undoable cleanup or
  migration; safe refusal/disabled rows do not complete that capability
- Flow-owned annotation append is deferred until dependent route propagation is
  correct; node-owned annotation append remains supported
- Task resize is an intentional configurable extension, not upstream behavior
- Touch group totals and the shared non-square event renderer/path limitation do
  not establish broader behavior than their recorded assertions

Keep these limits visible even after the currently configured suites become green.

### Reviewed follow-up awaiting hosted execution

The next source checkpoint corrects native smoke setup through public
`updateWaypoints`, tests upstream-valid MessageFlow-to-SequenceFlow reconnect
conversion, and targets a verified unobstructed boundary ring for invalid-drop
rollback. It also preserves selected endpoint editing priority over an overlapping
hover create port and applies the shared source eligibility rule to hover ports.
No Viewer paint-order change is included.

Tracked source passes 249 unit tests, 115 generated-export XSD validations,
lint, build and workflow validation. The new hit-priority suite contains ten
paired native upstream/local groups plus one local endpoint/create-port group.
It compares actual center and off-route hits instead of inferring interaction
priority from source ordering alone. Its hosted results are pending.
