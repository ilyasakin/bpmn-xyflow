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
Hosted `20fb` passed the original 23 flow groups, including eight explicit
precision/grid differences. Its Ctrl-start activation checks were corrected to
exercise the real HandTool/Bendpoints listener ordering, retaining those cases
and adding two reference pan controls for 27 groups.

Combined revision `fae65847` has the reviewed hover capability, Group corrections
and linear text-measurement security fix. Its exact local checkpoint `fa584c35`
passed 441 units, 247 official XSD exports plus ten native fixtures, build and
85-file packed-consumer checks. Hosted CodeQL reports no new alerts. All 16 Group
cases pass: eight matching cases and eight explicitly asserted reference
behavior differences. Local shared-title preservation and exact history remain
required. See [Group labels](GROUP-LABELS.md).

The same hosted revision is not accepted: global Window mousemove events exposed
a hover lookup exception in smoke, and 18 earlier native cases stopped at
control-target guards that rejected promoted hit circles before exercising their
gestures. Several of the 32 new hover cases exposed incorrect harness assumptions
about segment visibility, preview marker paths and minimap background clicks.
The scoped follow-up fixes the event-target guard and promoted style/zoom
lifecycle; the three earlier native suites now verify exact selected owner,
waypoint index, visible marker, geometry and viewport bounds. Their original drag,
anchor, semantic and history assertions remain unchanged. Corrected hover cases
retain actual native input and all 32 engine cases. Independent review and focused
checks are recorded in [hover controls](HOVER-CONTROLS.md); the exact combined
follow-up still requires its full local gate and hosted native rerun.

The previously reported quadratic Text.js expression is replaced by equivalent
linear trailing-whitespace handling. Published security revision `2eb1f7c` and
combined `fae65847` pass hosted CodeQL with no new alerts. The upstream source,
local one-operation patch and retained license are recorded separately.

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
| XML/DI/extensions/security | Exact `fae65847` passes source/schema checks and CodeQL with no new alerts; the scoped follow-up requires fresh verification |
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
| Flow annotations | Hosted `20fb` passes 23 existing groups; combined `fae65847` reaches corrected Ctrl activation but ten cases stop at promoted-control guards. All 27 groups must pass the follow-up |
| Group lifecycle | Hosted `fae65847` passes all 16 cases: eight matching and eight precisely asserted reference differences; retain this gate after later edits |
| Hover-only connection controls | Hosted `fae65847` exposed event-target/control-lifecycle and harness failures; scoped fixes are reviewed, and native32 rerun remains required |

## Remaining acceptance gates

1. Verify the exact scoped hover follow-up with independent review, semantic/XSD
   tests, build, packed consumers and hosted CodeQL; retain the cleared security fix
2. Publish only the exact approved tree to the existing draft PR and run every
   native suite, retaining the green hit/label/IO baseline assertions
3. Diagnose failures without weakening meaningful gesture or semantic assertions;
   update the paired site only with a verified library revision
4. Complete the corrected flow native27 and retain passing Group native16; keep explicit
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
