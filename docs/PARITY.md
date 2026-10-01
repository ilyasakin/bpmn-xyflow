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
its commit, test counts and review do not certify these new bytes. Fresh source
and semantic review of IO/label/hit checkpoint `2832d9f9` is complete. That
snapshot passes 297 unit tests, 135 official XSD exports, XML/security checks,
lint, build, workflow validation and 73-file packed-consumer checks.

The IO/label/hit reconstruction was published as `e606d75`. The corrected native
baseline `4515` is green, including 27 hit comparisons, 23 external-label cases
and two IO conversion cases, together with the retained native suites. Those
results establish that baseline only; later source needs its own native run.

The reconstructed flow follow-up implements connection-owned annotations,
dependent routes, ownership/deletion/clipboard handling and minimal append pan.
Earlier hosted revisions `3fe41f8` and `063bac7647eca8335364d35c9828f66574b3d7a7`
exposed targeting, containment-order, IO allocation and native-reference gaps.
The later exact `a5f89fbb` checkpoint passes 415 units, 242 official XSD mutation
exports plus seven native fixtures, build and 85-file packed-consumer checks.
Hosted revision `20fb` passes all 23 existing flow groups, including eight
explicit precision/grid differences. Its two new Ctrl-bypass cases fail before
reference drag activation. The reviewed native-input correction passes ten
installed-event tests and retains all 25 cases, adding two Ctrl-start pan
controls. The resulting 27-group native gate has not run. See [flow annotations](FLOW-ANNOTATIONS.md).

The Group checkpoint `96fa1cbf` introduced reviewed category/lifecycle, frame
layering, owner-label geometry and pinned text-fit corrections. Hosted Group
revision `f1b912d` passes 12 of 16 cases. Four failures exposed reference palette
activation, re-selection after canceled resize, an incomplete paint-fixture
setup and shared-title clearing during upstream Group deletion. The reviewed
test-only correction has six fresh reference/setup tests and five XSD-valid
exports; its native rerun and combined-source aggregate remain pending. Local
shared-title preservation and exact history stay strict. See
[Group labels](GROUP-LABELS.md).

Exact hover checkpoint `768762` passes 433 units, 242 official XSD mutation
exports plus ten native fixtures, build and 85-file packed-consumer checks. Its
reviewed paired native harness (32 engine cases) has not run. The reviewed
renderer-security correction `740ee`, published as `2eb1f7c`, passes hosted
CodeQL with no new alerts. It must be included in the next combined Group/Ctrl
checkpoint. These results certify their stated revisions only; the combined
tree requires fresh verification.

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

Evidence is bound to the exact revisions above. Every area affected by later
changes requires fresh local and hosted results. Prepared tests are not passed
evidence.

| Core area | Current evidence and remaining gate |
| --- | --- |
| XML/DI/extensions/security | Exact `768762` passes 242 XSD mutation exports plus ten fixtures; security revision `2eb1f7c` passes hosted CodeQL with no new alerts; combined-tree verification remains required |
| Renderer/viewport/hit selection | Baseline `4515` passes all 27 hit comparisons; Group frames and later interaction changes require their own native acceptance |
| Creation/replacement | Baseline `4515` passes both native IO cleanup cases; preserve API, semantic and packed-consumer checks on later source |
| Move/resize/containment | Existing core/advanced and original connection gates pass at baseline; retain them on new source |
| Connection gestures | Original 27 native groups and manual source/drop/route evidence are regression requirements, not a full interaction guarantee |
| Undo/redo/delete/copy | Existing flow native history/deletion/copy checks pass at `20fb`; Group corrections retain strict local XML/history, with their new combined native gate pending |
| External labels | Baseline `4515` passes all 23 native width/grid/modifier/reopen cases; Group text-fit and owner-label changes require fresh execution |
| Pools/lanes/subprocesses | Existing core/advanced gates pass at baseline and remain required |
| Keyboard/search/align/space | Existing native/core gates remain required; no new capability claim |
| Touch | Ten baseline differential groups pass within measured reference behavior; retain exact streams |
| Export/frameworks/package | Reopen, SVG, framework lifecycle and packed Bundler/NodeNext/runtime gates remain required on new source |
| Attribution | Retained upstream license and visible bpmn.io attribution must remain unchanged and tested |
| Site | Current site pins the older baseline; update only after reviewed library publication and rerun served-production/native preview checks |
| Flow annotations | Hosted `20fb`: 23 existing groups pass, including eight explicit differences; two Ctrl-bypass failures have a reviewed activation correction with ten focused tests. All original cases remain in the prepared native27 gate, including two new Ctrl-start pan controls |
| Group lifecycle | Hosted `f1b912d`: 12/16 pass; reviewed test-only fixes pass six focused tests/five XSD exports; corrected native16 remains open |
| Hover-only connection controls | Exact `768762` passes 433 units, 242 XSD exports plus ten fixtures and package85; paired native32 has not run |

## Remaining acceptance gates

1. Include security correction `740ee` (hosted as CodeQL-green `2eb1f7c`) in the combined Group/Ctrl tree,
   then verify that exact tree with independent review, semantic/XSD tests,
   build, packed consumers and hosted CodeQL
2. Publish only the exact approved tree to the existing draft PR and run every
   native suite, retaining the green hit/label/IO baseline assertions
3. Diagnose failures without weakening meaningful gesture or semantic assertions;
   update the paired site only with a verified library revision
4. Complete the corrected flow native27 and Group native16 gates; keep explicit
   reference precision, rendering and shared-title differences separate from
   matching behavior
5. Execute the prepared hover native32 gate, preserving selection, cancellation
   and exact model history without widening static hits

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
