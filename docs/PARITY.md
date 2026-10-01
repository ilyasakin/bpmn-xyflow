# Core parity verification

This is an implementation and verification ledger, not a claim of full bpmn-js
compatibility. The XYFlow engine and direct API remain intentional. Passing a
round-trip through this project's own parser is insufficient evidence of validity.

## Current reconstruction — 2026-10-01

The recovered branch starts from library
`7bc8a3a2610267a11d18556720b8744e93924e3d`. That historical native gate was red:
four hit comparisons and nine label assertions failed in
[run 36793352184](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36793352184).
The remaining earlier smoke/core/advanced/connection/touch/contextual/framework/
viewer/business suites passed at that revision.

This is a **new reconstruction** of the bounded IO conversion, label snapping and
hit-policy correction. The previous unpublished local snapshot is unavailable;
its commit, test counts and review do not certify these new bytes. Fresh source and semantic review of IO/label/hit checkpoint `2832d9f9` is complete. That snapshot passes
297 unit tests, 135 official XSD exports, XML/security checks, lint, build, workflow
validation and 73-file packed-consumer checks. Native verification remains
required before acceptance.

The current scope is:
- Default external-label snapping, modifier bypass and accurate native expectations
- Generic shape/label hit regions, with the existing explicit imported-label
  layering difference documented separately from equivalence
- Explicit undoable cleanup for IO-bearing catch/throw family conversion,
  preserving compatible properties, references, extensions and exact history

The IO/label/hit reconstruction was published as `e606d75`. Its native IO cases,
original arrow groups and earlier core suites passed; one boundary-hover hit and
upstream-only label reopen normalization remain under investigation. Test-only
follow-up `a7d407c` records exact reference normalization and hover diagnostics;
its hosted results are pending.

The separate local flow follow-up now implements connection-owned annotations,
dependent routes, ownership/deletion/clipboard handling and minimal append pan.
It has independent source review and fresh structural evidence, described in
[flow annotations](FLOW-ANNOTATIONS.md); its native 19-case acceptance is pending.
Group category/lifecycle and foreground ordering remain a separate recovery stage.

Published site `65bf8846d1e8f32c3ec09e22706ea939bcac870d` pins `7bc8a3a` and passed
its served-production gate. Manual preview QA previously verified the reported
source-port, target-drop-Y, orthogonal-move and fractional-segment regressions at
`e925a51` / `79b4643`. The original 27 native connection groups remain required
on every new revision. No full-core completion claim follows from those cases.

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

Historical hosted evidence is bound to `7bc8a3a`. Every row affected by this
reconstruction requires fresh local and hosted results. Prepared tests are not
passed evidence.

| Core area | Current evidence and remaining gate |
| --- | --- |
| XML/DI/extensions/security | Independent moddle oracle, corpus/business fixtures, hostile-input tests and official XSD remain mandatory; rerun against reconstructed edits |
| Renderer/viewport/hit selection | Existing hosted theme/fit/export coverage passes; four native hit differences need corrected reference comparisons and rerun |
| Creation/replacement | Existing catalog/context/core gates pass; explicit IO cleanup needs fresh API, native and packed-consumer verification |
| Move/resize/containment | Existing core/advanced and original connection gates pass at baseline; retain them on new source |
| Connection gestures | Original 27 native groups and manual source/drop/route evidence are regression requirements, not a full interaction guarantee |
| Undo/redo/delete/copy | Baseline exact-history and subtree/label/reference regressions remain; IO refusal/cleanup/history needs new semantic assertions |
| External labels | Width resize exists; default grid/modifier behavior and 23-case native expectations require fresh execution |
| Pools/lanes/subprocesses | Existing core/advanced gates pass at baseline and remain required |
| Keyboard/search/align/space | Existing native/core gates remain required; no new capability claim |
| Touch | Ten baseline differential groups pass within measured reference behavior; retain exact streams |
| Export/frameworks/package | Reopen, SVG, framework lifecycle and packed Bundler/NodeNext/runtime gates remain required on new source |
| Attribution | Retained upstream license and visible bpmn.io attribution must remain unchanged and tested |
| Site | Current site pins the older baseline; update only after reviewed library publication and rerun served-production/native preview checks |
| Flow annotations | Reconstructed local source is independently reviewed; fresh aggregate and native19 acceptance remain required |
| Group lifecycle | Separate later recovery stage; overall core parity remains open |

## Remaining acceptance gates

1. Local implementation, independent review, semantic/XSD tests, build and packed
   consumers pass for this bounded reconstruction; retain those gates on updates
2. Publish its exact reviewed tree to the existing draft PR and run every native
   suite, including corrected hit/label cases and the new IO cases
3. Diagnose failures without weakening meaningful gesture or semantic assertions;
   update the paired site only with a verified library revision
4. Complete the separate reconstructed flow aggregate/native gates; recover and
   review Group scope separately before any overall parity statement

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
IO-bearing cross-family conversion also refuses implicit cleanup. The fourth
argument `{ removeIncompatibleData: true }` or the corresponding confirmation
action enables atomic removal of disclosed incompatible IO. Compatible properties
and metadata remain; retained references into removed data block the operation.
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
