# Core parity verification

This is an implementation and verification ledger, not a claim of full bpmn-js
compatibility. The XYFlow engine and direct API remain intentional. Passing a
round-trip through this project's own parser is insufficient evidence of validity.

## References and scope

- Retained upstream renderer/importer provenance: bpmn-js **18.16.1**,
  commit `86aa391d222228e442b11b81584a817a14becb13`
- Current upstream reference as checked 2026-09-30: bpmn-js **18.30.1**
  (<https://github.com/bpmn-io/bpmn-js/releases/tag/v18.30.1>)
- Independent semantic oracle: development-only bpmn-moddle **10.3.1**
- No bpmn-js engine substitution or runtime bpmn-moddle dependency; saxen 11.2.0 supplies inert XML tokenization
- API/plugin compatibility, properties panels, engine-specific execution,
  external auto-layout and third-party extension UI are not core equivalence
  claims. Unknown extension XML must nevertheless survive editing.

## Gates

| Core area | Required evidence | Current status |
| --- | --- | --- |
| BPMN/DI parse/write | Upstream oracle accepts exported XML and equivalent typed semantics | 100 corpus fixtures + alternate descriptor + 3 business scenarios pass; independent adversarial review passed; official XSD export validation passes |
| Opaque extensions and namespaces | Script whitespace, xsi:type, timer expressions, Camunda elements/attributes retained | Oracle regression pass including QName collisions, unknown xsi subtype and mixed-content ordering |
| Identity/references | No duplicate IDs, missing source/target refs or dangling semantic/DI refs after edits | Schema-declared IDs and opaque vendor IDs distinguished; copy/replacement/reconnect/reference regressions and XSD pass |
| Malformed/hostile input | No DTD/entity fetch, actionable error, prior graph preserved | XML rejection, inert markup/network browser checks and prior-diagram recovery pass at published checkpoint |
| Renderer BPMN types | Events/tasks/gateways/data/artifacts/subprocess/pool/lane fixture coverage | Retained renderer/helpers byte-match upstream 18.30.1; structural type corpus passes; Chrome gate passes at published checkpoint |
| Fit/pan/zoom/resize | Pixel padding, default options, repeated resize and diagrams with zero/large bounds | Usable-area fit avoids palette/toolbar/minimap; large-diagram/mobile tests pass; Chrome gate passes at published checkpoint |
| Creation/append/replacement | Parent ownership, references, markers, event definitions, cancellation | Explicit remove-contents replacement, metadata/IO ownership and exact recovery pass; contextual catalog/API and resulting-edge cleanup independently reviewed; native action suite pending |
| Move/resize/containment | Descendants, attached boundaries, external labels, edges follow; undo restores | Exact fractional HR DI restoration and native/API cancellation tests pass; Chrome HR gate passes with exact fractional DI undo |
| Connection/reconnection | Same-flow-scope sequence flow, message participants, event semantics, invalid drop rollback | 110,500 upstream differential inference comparisons pass with both custom/upstream semantic models; mutation and browser gates pass at published checkpoint |
| Delete | Semantic/DI/reference cleanup including descendants/lanes/pools, undo | Cross-plane/subtree/lane/pool/label/reference cleanup and exact recovery pass |
| Undo/redo/transactions | Atomic rollback, branching history, selected deleted element cleanup, navigation | Atomic rollback, history branching, multi-view histories and interrupted gestures tested |
| Copy/paste | Deep semantics, hierarchy, namespace extensions, ID/reference remap, DI bounds/waypoints | Hierarchy, metadata, declared-ID remap, opaque data preservation and collaboration copy rules tested |
| Labels/bendpoints | Edit/move labels, endpoint docking, bend editing/cancellation, no duplicate labels | Imported labels, exact movement, rename/delete/reconnect and undo duplication regressions pass; browser smoke passed prior head |
| Pools/lanes/subprocesses | Creation, move, resize, containment, collaboration ownership, expand/drill/back | Nested/vertical lane split/add/rebalance, active planes, child-view mirroring/hydration and exact history tested |
| Selection/keyboard/lasso | Single/multi/select-all, focus restrictions, delete, escape and repeated flows | Existing browser smoke and structural repeat/cancel tests pass; published interaction gate passes; new contextual controls remain pending |
| Touch and pinch gestures | Native touch selection/pan/pinch/modeling and cancellation | Phone layout and attribution pass only; touch modeling/pinch parity is not verified; Modeler gesture handlers currently use mouse events |
| Align/distribute | Standard multi-element commands and undo | Geometry and accessible toolbar controls tested; fresh real-browser control gate pending |
| Search/space tool | Locate elements and expand/compress diagram space | Search/focus and space toolbar with container expansion, compression constraints, cancel/undo tested |
| Auto-place/snapping | Append placement, snapping and container bounds | Append, drag/palette flow insertion, docking, condition/default preservation and snapping tested structurally |
| Export SVG | Standalone diagram export with all markers/labels and required notices | Standalone markers/labels/export tests pass; existing real-browser export gate passed |
| Lifecycle/frameworks | Latest import wins, destroy during import, failed import recovery, React/Vue/Svelte | Node lifecycle/StrictMode, full wrapper bundle/type consumers and prior hosted framework tests pass |
| Attribution | Original upstream license/source retained, visible unobscured bpmn.io link | Original LICENSE and unchanged attribution source retained; prior Chrome visibility gate passes |
| Site integration | Matching tested library revision, contrast and all core user flows | Site PR15 pins tested library 37e9ec0; production-site native Chrome CI and refreshed preview QA pass; next contextual revision pending |
| Packaging/CI | Frozen pnpm install, lint, semantic/unit/browser gates, library build | 177 Node tests, 87 XSD exports, strict packed root/framework consumers, build and actionlint pass locally; all configured hosted suites pass at 37e9ec0; new contextual suite pending |

## Execution environment limits

Local Chromium launch is blocked by the environment (`socket() failed: Operation
not permitted`), including a reviewed execution escalation. Browser security
settings must not be disabled to work around this. The configured browser suites have now passed in GitHub CI using the runner’s
preinstalled official Google Chrome, with its sandbox enabled. New tests remain
unverified until that supported environment executes them. DOM-only
and semantic tests do not count as real-browser passes.

## Completion rule

A gate is complete only when its exact final revision has passed the listed
checks. Any remaining core gap stays visible here. Hosted CI and preview QA are
required before describing end-to-end parity as verified. Upstream's 18.30 theme
token changes are distinct from the older retained renderer implementation and
must not be implied merely by passing semantic tests.

## Open core gates after the green hosted checkpoint

- Execute the newly reviewed contextual catalog/create/drop/attachment integration in real Chrome; 348 menu-descriptor comparisons and independent mutation probes pass locally
- Native touch/pinch and touch modeling remain unverified; desktop mouse/keyboard gates do not establish them
- Real-browser verification of new lane/space/flow-insertion/replacement-confirmation controls and current theme overrides
- Repeat the production-site browser gate on the next contextual library revision

See [contextual control and API usage](CONTEXTUAL_MODELING.md).

## Intentional API safety behavior

This is a direct XYFlow API, not an upstream API/plugin clone. A populated
subprocess-to-noncontainer replacement is refused by default. The explicit
fourth argument `{ removeContents: true }` or **Replace and remove contents** UI
confirmation enables an atomic, fully undoable operation. Incompatible attached
boundaries and their edges are included in that disclosed removal. Unsupported
IO-bearing Activity/Event-family conversions return without mutation; compatible
Activity-to-Activity replacement preserves owned IO/association identities.

Constructor options in framework wrappers are mount-time settings; XML and event
callbacks have their documented update behavior. Browser scenario tests combine
native task drag/undo with API-driven semantic commands and a separate upstream
viewer open/save; neither type of check substitutes for the other. See the
[business corpus](SCENARIOS.md) and [XML security design](XML_SECURITY.md).

## Published evidence checkpoint

Library PR1 head `37e9ec053190516c4c9fb52abe01c58650baac7a` passed all
configured source/schema/unit, smoke/framework/viewer/business-scenario, packed
consumer and build checks, plus CodeQL with no new alerts. In particular, native
approval-task hit-testing, exact HR move/undo, and live theme overrides now pass.
Site PR15 head `0c86270e3d70ea0f6d6a0b55fe975202efa855b3` pins that revision
and passed CI and its normal preview build. These are draft review checkpoints;
the open gates above still prevent a full-core completion claim.

Site follow-up `98be8faacf872554d458cc8ac14f0045cb795e55` adds a served-production
Next.js browser gate, passed in CI run 36775989922. It verifies native sample
switching, navigation/search/palette, repeated XML export, safe fit and phone
attribution. The ordinary preview refresh also passed.

## Contextual source checkpoint (awaiting hosted action execution)

The pinned catalog covers 348 full menu target/action comparisons; the separate
pure-rule adapter covers create/drop/move/attachment/insertion/copy scopes. Real
Modeler probes independently verify resulting-edge validity, sibling-plane edge
cleanup, event-subprocess normalization, loop expression identities, data-object
ownership, invalid target no-ops and exact XML/history undo. Local gates pass:
177 unit tests, 87 XSD-valid generated exports, packed consumers, lint and build.
The new native Chrome suite aggregates nine action groups independently. Touch
modeling/pan/pinch is active remaining work and is not covered by desktop tests.
