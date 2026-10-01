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
navigation. The resulting global-history change is a later capability correction,
not evidence covered by the preceding green revision. Published `d484f24` passes
all prior gates and two of the three new history cases in
[run 36856440928](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36856440928).
The remaining case tries to zoom in from the maximum zoom during setup; its
reviewed correction chooses a wheel direction with available zoom range.

Current local checkpoint `c424e41c` combines that test-only wheel correction with
independently reviewed import/navigation race fix `381e1346`. Failed XML or
missing-diagram preflight must preserve an already committed drill/Back operation,
its camera, graph/DI identities, metadata and global history. New valid imports
supersede stale navigation and reset history only for the committed document.
The exact checkpoint passes 489 units, 398 generated-export XSD validations plus
ten native fixtures, lint (zero errors, 37 warnings), workflow validation and
build. Packed consumers pass with 85 package files, Bundler/NodeNext/runtime
checks and React/Vue/Svelte bundles. It has no hosted native result yet. See [document history](GLOBAL-HISTORY.md).

The previously reported quadratic Text.js expression is replaced by equivalent
linear trailing-whitespace handling. Published security revision `2eb1f7c` and
combined `fae65847` passed hosted CodeQL with no new alerts. The upstream source,
local one-operation patch and retained license are recorded separately.

Current published site `c3501f3` includes the paste/file Import XML UI. Six of its
eight new native import cases pass. The remaining cases exposed a raw fixture
baseline missing an `xmlns:xsi` declaration and the real bubbling file-cancel
path. Both corrections are independently reviewed in site `fc402b5`; all 12 local
tests, lint, types and the production build pass. The native rerun is pending. Import failure/cancel must retain the prior diagram, selection, camera
and history; successful replacement and dirty-document confirmation remain
explicit acceptance requirements. The earlier site `65bf8846`/library `7bc8a3a`
served-production pass is historical evidence only.

The original 27 native connection groups remain required on every new revision.
A green configured run does not establish full core equivalence; the ongoing
history/import changes and their paired site acceptance keep this task open.

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
| XML/DI/extensions/security | Hosted `2aef246` is green; the import/navigation race correction at local `c424e41c` passes all local gates; its hosted run remains pending |
| Renderer/viewport/hit selection | Established native hit, Group frame and hover cases pass at `2aef246`; retain strict geometry and input evidence after later changes |
| Creation/replacement | Native IO cleanup and existing creation/replacement gates pass at `2aef246`; preserve semantic, metadata and packed-consumer checks |
| Move/resize/containment | Established core/advanced and original connection gates pass at `2aef246` and remain required |
| Connection gestures | All original 27 native groups pass at `2aef246`; manual source/drop/route evidence remains a regression requirement |
| Undo/redo/delete/copy | Established local history/copy/deletion gates pass; cross-root chronological history at `d484f24` has two new native cases passing and one setup failure corrected locally |
| External labels | All 23 native width/grid/modifier/reopen cases and Group label gates pass at `2aef246` |
| Pools/lanes/subprocesses | Established core/advanced gates pass; global history and pending drill/Back/import timing require acceptance at the current checkpoint |
| Keyboard/search/align/space | Established native/core gates pass at `2aef246`; retain them on new source |
| Touch | Ten differential groups pass within the measured reference behavior; this does not establish general touch modeling support |
| Export/frameworks/package | Established reopen, SVG, framework and packed-consumer gates pass at `2aef246`; the current local checkpoint also passes build/package; its hosted result remains pending |
| Attribution | Retained upstream license and visible bpmn.io attribution remain required and tested |
| Site | Published `c3501f3` includes Import XML; six of eight new native cases pass, with two reviewed local corrections at `fc402b5` passing local tests/build and awaiting native rerun |
| Flow annotations | All 27 native groups pass at `2aef246`, including separately asserted reference input-policy differences |
| Group lifecycle | All 16 native cases pass: eight matching and eight precisely asserted reference differences; retain strict local metadata/history |
| Hover-only connection controls | All 32 native cases pass at `2aef246`; manual hover QA also passed on the earlier `ffb1`/`e209` pair |

Consistent foreground external labels and Group frames include approved
import-order differences from the pinned reference. Group frames follow the
reference's normal creation level rather than its import-order quirk. These
intentional differences, and measured precision/shared-title differences, remain
separate from equal-behavior assertions.

## Remaining acceptance gates

1. Obtain hosted evidence for the locally verified `c424e41c` checkpoint covering
   global chronological history, the wheel setup correction and import/navigation
   races while retaining every established native suite
2. Finish the site Import XML native rerun for the two corrected cases,
   preserving dirty-document confirmation, failure/cancel rollback and inert XML
3. Verify the paired site against the reviewed library revision, including global
   history across drill/Back and successful/failed document replacement
4. Diagnose any new failure from concrete native input, model and DI evidence;
   keep precise reference differences explicit and avoid broad normalization

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
