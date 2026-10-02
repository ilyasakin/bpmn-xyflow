# Core parity verification

## Reopened anchor interaction review — 2026-10-02

Fresh user feedback and independent native exploration reopened acceptance on the
previously tested site `99e608a` / runtime `5a994b6`. The prior results below are
historical evidence for those cases, not proof that ordinary anchor workflows
were complete. The new [risk-based interaction matrix](ANCHOR-UX-CASES.md) defines
visible actions and expected geometry, semantics and history before assertions.

Confirmed blockers in the published preview:

- **D1 — Source choice:** hovering top, left or bottom still offers only the
  right-side source handle; selection exposes resize controls, not other origins
- **D2 — Accidental creation:** a stationary source-port click or 1px jitter
  creates a self-loop and an Undo entry. Deliberate valid BPMN loops are a
  separate, supported behavior; the reference drag activation threshold is 5px
- **D3 — Moving a connected task:** the unchanged circular target docking moves
  to its bounding rectangle, leaving a visible gap
- **D4 — Resizing a freshly connected task:** a small width change moves the
  right-side source to the top and leaves the circle target detached

The first reviewed correction prepares a perimeter-following grab control,
measured drag activation, logical outline docking, and atomic refusal rollback.
Local checks pass 528 unit tests, 417 generated-export XSD validations plus ten
native fixtures, lint (zero errors), build, workflow validation and the 85-file
packed-consumer gate. These are preflight results, not user-interaction acceptance.
The first 38 native cases are prepared but unrun; additional matrix rows remain
open. Independent reference gestures, exact-head CI and paired preview
exploration are required.
No newly prepared test is counted as executed, and existing green suites are
regressions rather than acceptance for these newly reported workflows.

This is an implementation and verification ledger, not a claim of full bpmn-js
compatibility. The XYFlow engine and direct API remain intentional. Passing a
round-trip through this project's own parser is insufficient evidence of validity.

## Historical reconstruction — 2026-10-01

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

Hosted follow-up `e209c17` restores every established native suite, including
smoke, 27 connection groups, all advanced cases, 27 flow groups and all 16 Group
cases. Build, packed consumers and CodeQL pass. Its local checkpoint `2f207d2e`
passed 453 units and 247 XSD exports plus ten native fixtures.

The hover follow-up is now verified at published library `2aef246`: all configured
hosted gates pass, including all 32 hover cases, in
[run 36854573667](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36854573667).
The test corrections use the real roots API, explicit ClickTrap evidence, exact
fixture-specific reference ordering and measured SVG numeric storage. Local
XML/history and semantic/DI assertions remain strict. See
[hover controls](HOVER-CONTROLS.md).

Manual arrow, hover and Group QA passed on site `ffb1` with library `e209`.
That session also exposed a document-history discrepancy across subprocess
navigation. Intermediate global-history revision `d484f24` passed all prior
gates and two of the three new history cases in
[run 36856440928](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36856440928).
The third case tried to zoom in from maximum zoom during setup; the corrected
case chooses a wheel direction with available zoom range.

Current published library `5a994b6` passes the complete configured hosted gate in
[run 36859641614](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36859641614):
all 22 core-control cases, including the three new global-history cases, all
retained native suites, build and packed consumers. CodeQL passes with no new
alerts. This revision includes independently reviewed import/navigation race fix
`381e1346`. Failed XML or missing-diagram preflight preserves an already committed
drill/Back operation, its camera, graph/DI identities, metadata and global
history. New valid imports supersede stale navigation and reset history only for
the committed document. See [document history](GLOBAL-HISTORY.md).

The corresponding local source checkpoint `8550b0f9` passed 489 units, 398
generated-export XSD validations plus ten native fixtures, lint (zero errors,
37 warnings), workflow validation and build. Packed consumers passed with 85
package files, Bundler/NodeNext/runtime checks and React/Vue/Svelte bundles.

The previously reported quadratic Text.js expression is replaced by equivalent
linear trailing-whitespace handling. Published security revision `2eb1f7c` and
combined `fae65847` passed hosted CodeQL with no new alerts. The upstream source,
local one-operation patch and retained license are recorded separately.

Current paired site `99e608a` pins library `5a994b6`. Its complete CI and all eight
native Import XML cases pass in
[run 36862006191](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/36862006191);
CodeQL reports no new alerts and the deployment is Ready. These results include
the reviewed corrections to the raw fixture namespace baseline and bubbling
file-cancel path that failed at site `c3501f3`. Paste/file import, dirty-document
confirmation, failed-import/cancel preservation and successful replacement now
have hosted evidence. The earlier site `65bf8846`/library `7bc8a3a`
served-production pass remains historical evidence only.

Final manual QA passed on the exact `99e608a` / `5a994b6` pair, with no defect
found in the exercised paths. Global Undo/Redo switched roots and restored the
observed cameras. An edited Order workflow exported, pasted into Import XML and
reopened with byte-identical 15,064-byte re-export, zero warnings and reset
history; malformed input and cancellation preserved XML, Undo and camera.
Original Conditional connection, hover, Group editing/export, attribution and
viewer-navigation checks also passed. The detailed evidence and distinction
between manual and hosted-only paths are in [VERIFICATION.md](VERIFICATION.md).

The bounded core acceptance gates recorded here are complete at these revisions.
The original 27 connection groups and all other regression gates remain required
on later source changes. This conclusion retains the explicit behavior limits
and differences below; it is not blanket upstream API/plugin compatibility.

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
| XML/DI/extensions/security | Library `5a994b6` passes the full hosted gate and CodeQL; local source `8550b0f9` passes units, XML/security and official schema checks |
| Renderer/viewport/hit selection | Established native hit, Group frame and hover cases pass at `5a994b6`; retain strict geometry and input evidence after later changes |
| Creation/replacement | Native IO cleanup and creation/replacement gates pass at `5a994b6`; semantic, metadata and packed-consumer checks remain required |
| Move/resize/containment | Core/advanced and original connection gates pass at `5a994b6` |
| Connection gestures | All original 27 native groups pass at `5a994b6`; final paired-site source/drop/route and exact Undo checks also pass |
| Undo/redo/delete/copy | Existing local history/copy/deletion and all three new global-history native cases pass at `5a994b6` |
| External labels | All 23 native width/grid/modifier/reopen cases and Group label gates pass at `5a994b6` |
| Pools/lanes/subprocesses | Core/advanced and global-history native gates pass; pending drill/Back/import timing also has deterministic structural coverage |
| Keyboard/search/align/space | Established native/core gates pass at `5a994b6` |
| Touch | Ten differential groups pass within the measured reference behavior; this does not establish general touch modeling support |
| Export/frameworks/package | Hosted reopen, SVG, framework and packed-consumer gates pass at `5a994b6` |
| Attribution | Retained upstream license and visible bpmn.io attribution remain required and tested |
| Site | `99e608a` pins `5a994b6`; full CI, all eight native Import XML cases and CodeQL pass, deployment Ready; final manual QA passes for the exercised paths |
| Flow annotations | All 27 native groups pass at `5a994b6`, including separately asserted reference input-policy differences |
| Group lifecycle | All 16 native cases pass: eight matching and eight precisely asserted reference differences; retain strict local metadata/history |
| Hover-only connection controls | All 32 native cases pass at `5a994b6`; final paired-site hover appearance, source/target reconnect and background cancellation checks also pass |

Consistent foreground external labels and Group frames include approved
import-order differences from the pinned reference. Group frames follow the
reference's normal creation level rather than its import-order quirk. These
intentional differences, and measured precision/shared-title differences, remain
separate from equal-behavior assertions.

## Historical acceptance and continuing regression requirements

The recorded automated and manual acceptance gates are complete for site
`99e608a` and library `5a994b6`. Manual testing used paste import; file-chooser
behavior, mid-drag Escape and touch retain hosted-only evidence from this final
acceptance pass. No manual execution is claimed for those paths.

Retain every green native, semantic, schema, security and package gate after any
later source change. Investigate new findings from concrete input, model and DI
evidence, keeping precise reference differences explicit. A docs-only update
does not broaden verified scope.

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
