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
- No bpmn-js engine substitution or runtime bpmn-moddle dependency
- API/plugin compatibility, properties panels, engine-specific execution,
  external auto-layout and third-party extension UI are not core equivalence
  claims. Unknown extension XML must nevertheless survive editing.

## Gates

| Core area | Required evidence | Current status |
| --- | --- | --- |
| BPMN/DI parse/write | Upstream oracle accepts exported XML and equivalent typed semantics | 100 corpus fixtures + alternate descriptor + 3 business scenarios pass; independent adversarial review passed; official XSD export validation passes |
| Opaque extensions and namespaces | Script whitespace, xsi:type, timer expressions, Camunda elements/attributes retained | Oracle regression pass including QName collisions, unknown xsi subtype and mixed-content ordering |
| Identity/references | No duplicate IDs, missing source/target refs or dangling semantic/DI refs after edits | Implementation/test in progress |
| Malformed/hostile input | No DTD/entity fetch, actionable error, prior graph preserved | XML rejection + viewer recovery DOM tests pass; real browser pending |
| Renderer BPMN types | Events/tasks/gateways/data/artifacts/subprocess/pool/lane fixture coverage | Existing retained renderer; browser coverage pending |
| Fit/pan/zoom/resize | Pixel padding, default options, repeated resize and diagrams with zero/large bounds | Node geometry/default-option regressions pass; browser interaction pending |
| Creation/append/replacement | Parent ownership, references, markers, event definitions, cancellation | Implementation/test in progress |
| Move/resize/containment | Descendants, attached boundaries, external labels, edges follow; undo restores | Implementation/test in progress |
| Connection/reconnection | Same-flow-scope sequence flow, message participants, event semantics, invalid drop rollback | 110,500 upstream differential inference comparisons pass with both custom/upstream semantic models; mutation/browser gate pending |
| Delete | Semantic/DI/reference cleanup including descendants/lanes/pools, undo | Implementation/test in progress |
| Undo/redo/transactions | Atomic rollback, branching history, selected deleted element cleanup, navigation | Implementation/test in progress |
| Copy/paste | Deep semantics, hierarchy, namespace extensions, ID/reference remap, DI bounds/waypoints | Implementation/test in progress |
| Labels/bendpoints | Edit/move labels, endpoint docking, bend editing/cancellation, no duplicate labels | Implementation/test in progress |
| Pools/lanes/subprocesses | Creation, move, resize, containment, collaboration ownership, expand/drill/back | Implementation/test in progress |
| Selection/keyboard/lasso | Single/multi/select-all, focus restrictions, delete, escape and repeated flows | Audit/test pending |
| Align/distribute | Standard multi-element commands and undo | Pure geometry tested and public commands implemented; UI/browser pending |
| Search/space tool | Locate elements and expand/compress diagram space | Search/focus tested; side-move space command exists; container-expansion space behavior missing |
| Auto-place/snapping | Append placement, snapping and container bounds | Audit/test pending |
| Export SVG | Standalone diagram export with all markers/labels and required notices | Structural export tests pass; actual marker/font/browser output pending |
| Lifecycle/frameworks | Latest import wins, destroy during import, failed import recovery, React/Vue/Svelte | Implementation/test in progress |
| Attribution | Original upstream license/source retained, visible unobscured bpmn.io link | Source restored; browser gate pending |
| Site integration | Matching tested library revision, contrast and all core user flows | Local exact-base build/lint/typecheck pass with QA library copy; published gitlink/browser gates pending |
| Packaging/CI | Frozen pnpm install, lint, semantic/unit/browser gates, library build | Frozen install and multi-entry library build pass; lint 0 errors; final aggregate/hosted CI pending |

## Execution environment limits

Local Chromium launch is blocked by the environment (`socket() failed: Operation
not permitted`), including a reviewed execution escalation. Browser security
settings must not be disabled to work around this. Browser suites remain
**not run** until an authorized CI/preview environment executes them. DOM-only
and semantic tests do not count as real-browser passes.

## Completion rule

A gate is complete only when its exact final revision has passed the listed
checks. Any remaining core gap stays visible here. Hosted CI and preview QA are
required before describing end-to-end parity as verified. Upstream's 18.30 theme
token changes are distinct from the older retained renderer implementation and
must not be implied merely by passing semantic tests.

## Explicit remaining structural gaps at the first WIP checkpoint

- Space command does not yet expand intersected containers
- Dedicated lane split/rebalance and insert-on-flow interaction are not yet implemented
- Subprocess drill plane generation and persistent history on child reentry need coverage and fixes
- Replacing a populated subprocess with a noncontainer is safely refused rather than destructively dropping children
- Complete browser pointer/keyboard/cancel/repeat matrix and hosted site QA remain unrun
- Constructor options in framework wrappers are mount-time settings; XML and event callbacks have their documented update behavior

Browser scenario tests combine native task drag/undo with API-driven semantic
commands and a separate upstream viewer open/save. Neither type of check
substitutes for the other. See [business corpus](SCENARIOS.md).
