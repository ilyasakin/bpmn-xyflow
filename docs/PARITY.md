# Core parity verification

This is an implementation and verification ledger, not a claim of full bpmn-js
compatibility. The XYFlow engine and direct API remain intentional. Passing a
round-trip through this project's own parser is insufficient evidence of validity.

## Current checkpoint — 2026-09-30

**Published library `2c9296645f88d039078537612e23d3677089dd8f` corresponds to reviewed
source checkpoint `6bec456f`. Its hosted rerun is not green.** All 19 core-control,
27 connection, nine contextual-action and ten touch-differential groups pass.
Three later assertions still fail: smoke double-click bendpoint deletion (three
points remain three), an outside-host boundary drop, and a same-pool message
reconnect in the advanced suite. These are under diagnosis, not three established
implementation defects: smoke setup had stale graph/DI/render geometry and hit
the wrong endpoint; the same-pool message operation permits an upstream-valid
connection-type change; boundary-center overlap awaits native upstream comparison.

The preceding published library `59cd24e5feb2d3af9506333db10abdd4bd523b12` passed the 27 connection,
nine contextual-action and ten touch-differential groups, plus the existing
smoke/framework/viewer/business-scenario gates. It nevertheless had **six failing
cases across the 19 core-control and 17 advanced-interaction groups**. Those
failures prevented treating that checkpoint as fully green. The current run
progresses beyond those six assertions but exposes the three failures above.

The current correction addresses process-only lane membership, boundary drop
snapping, absent label-DI restoration on replacement undo, and no-motion diagonal
connection selection. Reopen assertions now compare independently parsed
canonical models, exact DI and resolved references rather than redundant waypoint
`xsi:type` spelling; Undo and cancellation remain byte-exact. Independent focused
reproductions pass. Current tracked-source gates pass **248 unit tests and 115
XSD-valid generated exports**, lint and build. Unintegrated helper prototypes are
excluded from those counts and from the capability claims below.

Site `f94828d` pins `59cd24e` and passed its production browser CI. Published site
`d0b904a488172be26b142e62a28d08e6ce1a5653` pins `2c929664`; its production CI
(run 36788799750) and Ready preview passed. Manual preview QA already verified the requested source port, target drop Y, orthogonal
shape movement, fractional near-axis segment editing and exact Undo at library
`e925a51` / site `79b4643`. That evidence is revision-bound, not a substitute for
resolution of the current failures. See [VERIFICATION.md](VERIFICATION.md) for
history and reproduction commands.

## References and scope

- Retained upstream renderer/importer provenance: bpmn-js **18.16.1**, commit
  `86aa391d222228e442b11b81584a817a14becb13`
- Pinned comparison reference: bpmn-js **18.30.1**
  (<https://github.com/bpmn-io/bpmn-js/releases/tag/v18.30.1>)
- Independent semantic oracle: development-only bpmn-moddle **10.3.1**
- No bpmn-js engine substitution or runtime bpmn-moddle dependency; saxen
  **11.2.0** supplies inert XML tokenization
- API/plugin compatibility, properties panels, engine-specific execution,
  external auto-layout and third-party extension UI are outside core equivalence
  claims. Unknown extension XML must nevertheless survive editing

## Acceptance ledger

“Prior native pass” below means evidence at `59cd24e` unless otherwise stated.
“Current local pass” means the reviewed `6bec456f` source for published `2c929664`.
Current native results are identified explicitly. No hosted result silently
transfers to a later revision.

| Core area | Evidence and current status |
| --- | --- |
| BPMN/DI parse/write | Independent upstream oracle covers 100 corpus fixtures, an alternate descriptor and three business scenarios. Current XML/security checks and 115 generated-export XSD validations pass |
| Opaque extensions/namespaces | QName scope, unknown xsi subtypes, mixed content, script whitespace, timer expressions, vendor elements/attributes and ordered property edits have independent regressions; current local pass |
| Identity/references | Declared IDs versus opaque vendor data, copy/replacement/reconnect ownership and semantic/DI references have oracle/XSD regressions; current local pass |
| Hostile/malformed input | DTD/entity/network/DOM rejection and prior-diagram recovery have 40 security cases; prior native inert-markup/recovery gate passed |
| Renderer and viewport | Type corpus, theme overrides, safe-area fit, large diagrams, phone layout, pan/zoom and attribution have prior native passes. No general renderer-equivalence claim follows from semantic tests |
| Creation/append/replacement | Pinned catalog covers 348 action/target comparisons. Nine contextual native groups passed. Atomic append, disabled unsafe replacement rows and explicit populated-subprocess cleanup have current local coverage; current core 19 pass; advanced has two remaining failures |
| Move/resize/containment | Prior connection native gate and manual QA verify orthogonal end-leg repair and exact fractional DI history. Current lane-membership/boundary-position corrections pass focused repros; core lane controls now pass; advanced boundary-drop assertion remains under upstream comparison |
| Connection/reconnection | 110,500 upstream differential inference comparisons plus 27 prior native groups cover preview, explicit ports, reconnects, near-axis segments, route repair, metadata/history and creation reopen. Current connection gate passes; advanced same-pool assertion needs to account for upstream-valid connection morphing |
| Delete | Cross-plane/subtree/lane/pool/label/reference cleanup has local exact-recovery coverage. Six external-label Delete/Backspace paths are in the advanced native suite; its current full gate still has two failures |
| Undo/redo/navigation | Atomic rollback, branching history, independent drill/back histories and interrupted gestures have local coverage. Current replacement-label identity/DI undo correction passes independent repros; current core navigation passes; advanced gate still has two failures |
| Copy/paste | Deep semantics, namespaces, IDs, references, hierarchy and DI have local coverage. Native clipboard/duplicate/group-delete paths are in the core-control suite; current core 19 pass |
| Labels/bendpoints | Rename/move/delete, endpoint/segment editing and exact cancellation have local and prior connection-native evidence. Current smoke double-click assertion fails with stale fixture geometry/wrong hit; external-label width resize is still a capability gap |
| Pools/lanes/subprocesses | Nested/vertical lanes, active planes, child-view hydration and exact history have local coverage. Current process-only lane split correction passes; current native core lane/control group passes |
| Selection/keyboard/lasso | Core suite uses native multi-select, lasso, clipboard, 1px/Shift-10px arrows, Tab traversal and focus guards. Current full 19-group gate passes; no-motion edge selection has a new exact XML/history guard |
| Touch/pinch | Ten differential groups pass at the current published revision against actual pinned upstream: includes tap, pan, pinch, context-connect, partial release and mouse recovery. Shared non-activation of ordinary touch shape drag/resize is recorded as a limitation, not certified support |
| Align/distribute/search/space | Geometry, toolbar, focus, space expansion/compression and cancellation have local coverage; prior contextual controls passed. The advanced suite still has two failures on the current revision |
| Auto-place/snapping/insertion | Atomic append, palette/existing-shape insertion and condition/default preservation have local coverage and native core assertions. Current full core 19-group gate passes |
| Export SVG/XML | Standalone marker/label export, removal of interaction hit overlays, independent semantic reopen and notices have local/prior native coverage. Reopen canonical equivalence does not replace byte-exact Undo/cancel |
| Lifecycle/frameworks | Latest-import wins, failed-import recovery, destroy, StrictMode and wrappers have local/prior native passes. Packed root/React/Vue/Svelte Bundler/NodeNext types, Vite bundles and runtime pass in the current hosted package gate |
| Attribution | Original LICENSE/source retained; prior Chrome tests verify visible, unobscured bpmn.io link including phone layout |
| Site | Production native CI passed at site `f94828d` / library `59cd24e`; site `d0b904a` pins `2c929664`, with production CI and Ready preview passed |
| Packaging/CI | Current tracked units 248 and XSD exports 115 pass; hosted source, build and packed consumers also pass. Hosted CI runs each browser suite independently and retains failures/artifacts; `2c929664` has three remaining native failures despite the core/connection/context/touch passes |

## Remaining capabilities and acceptance gates

1. **External-label width resize.** Upstream supports east/west label resizing;
   current label handles/API do not yet provide it. Label rename, movement and
   deletion do not close this gap.
2. **IO-bearing cross-family replacement.** Unsupported Activity/Event and
   catch/throw conversions safely refuse mutation; disabled menu rows explain
   this. Explicit, undoable IO cleanup/migration remains open. Compatible
   Activity-to-Activity replacements preserve owned IO/association identities.
3. **Flow-owned annotation append and dependent routing.** The raw pinned
   catalogue includes annotation append from SequenceFlow/MessageFlow, but the
   executable controls/private append preflight defer it. Changing an owner
   route must propagate docking to its dependent association through
   move/resize/waypoint/reconnect edits, preserving metadata and exact undo.
   Node annotation append remains enabled. Imported flow-owned associations do
   not establish complete editing support.
4. **Current native acceptance.** Correct the stale smoke fixture and same-pool
   expectation using the upstream-valid connection behavior; compare the boundary
   overlap gesture with actual upstream before deciding whether production code
   needs a change. Retain the 19 core, 27 connection, nine contextual and ten touch
   passes and rerun the affected exact revision. Site `d0b904a` is green within its
   own production assertions. Reviewed source/DOM tests are not native passes.

Touch shape dragging/resizing did not activate in either pinned engine in the
recorded baseline. The differential pass establishes the measured behavior only;
it does not imply general touch modeling support or successful rollback of a
resize gesture that never activated. Modeler handlers still use mouse events.

## Intentional API and safety behavior

This is a direct XYFlow API, not an upstream API/plugin clone. Populated
subprocess-to-noncontainer replacement is refused by default. The fourth argument
`{ removeContents: true }` or **Replace and remove contents** confirmation enables
atomic, undoable removal, including disclosed incompatible boundaries/edges.
Unsafe compensation changes similarly require explicit cleanup confirmation.
Task resizing is an intentional fork extension, enabled by default;
`taskResize: false` uses the pinned upstream resize policy.

Framework constructor options are mount-time settings; XML and callbacks have
their documented update behavior. Scenario tests mix native gestures with API
semantic setup/checks and an independent upstream browser reopen; each evidence
kind is identified rather than treated as interchangeable. See
[contextual usage](CONTEXTUAL_MODELING.md), [business corpus](SCENARIOS.md) and
[XML security design](XML_SECURITY.md).

## Environment and completion rule

Local Chromium launch is blocked (`socket() failed: Operation not permitted`),
including a reviewed execution escalation. Browser security settings must not be
disabled to bypass this. Hosted suites use the runner's installed official Google
Chrome with its sandbox enabled. Newly prepared assertions count only after that
supported environment executes them.

A gate is complete only at its verified revision and within its asserted scope.
Remaining capabilities stay visible even if every configured suite becomes green.
Hosted CI and preview QA are required before any end-to-end completion statement.
Historical results are retained in [VERIFICATION.md](VERIFICATION.md).

### Shared reference limitation: atypical event dimensions

For a non-square imported event (for example, 80×40), the retained upstream
renderer paints a circle using `round((width + height) / 4)` while its docking
path uses `width / 2`. This visible-outline mismatch also exists in the pinned
reference. Standard square events are covered by routing gates; a separate
renderer/path consistency change is not implied by those results.
