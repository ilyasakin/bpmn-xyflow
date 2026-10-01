# Global diagram history

The Modeler has one chronological command stack for the imported document.
Drill-in and Back retain graph identities and the last visited viewport for each
diagram; they never clear history, replace it with a per-diagram snapshot, or add a
navigation command. A new edit invalidates redo across every diagram.

Undo and Redo activate the originating diagram before applying its command.
Their public return values remain synchronous booleans. Root changes clear
selection and update the Back path; a same-root command keeps applicable
selection. Replayed compound edits remain a single history step. The active drag,
resize, connection preview or uncommitted label editor is cancelled before history
replay, including calls through the exposed command stack and keyboard shortcuts.

The implementation follows the pinned `bpmn-js` 18.30.1 dependency's
`diagram-js/lib/features/root-elements/RootElementsBehavior.js` and
`bpmn-js/lib/features/drilldown/DrilldownCentering.js`: commands retain their root,
and root views retain the most recently visited camera rather than a camera
snapshot from each edit. The Viewer has a private synchronous render entry point
for replay. It does not schedule the import fit animation frame, so an old fit
cannot overwrite the restored viewport after Undo returns. The public asynchronous
import/switch APIs are unchanged.

## Existing expanded-diagram behavior

A separate child plane already present in the document is navigated without any
XML changes. This fork also permits drilling into an expanded subprocess whose
children are represented only on the parent plane. Its existing first-drill path
materializes a child DI plane, without a command-stack entry. The reference does
not offer that expanded-root drill until collapse creates a separate plane. This
change retains that pre-existing behavior; it does not claim navigation-only XML
identity for that extra path. Tests take the exact history baseline after plane
materialization and separately assert that existing-plane navigation is XML-exact.

## Verification

Ten focused structural groups cover mixed outer/child chronology, root and graph
identity, metadata/DI and independent `bpmn-moddle` reopen, repeated compound
creation/deletion, declared cyclic references and ordered opaque metadata, parent collapse, global redo invalidation, active-gesture
interruption, latest per-root camera restoration, instance/import lifecycle, and pending drill/Back
versus Undo or a superseding import.
Matching-route reconciliation also retains transient waypoint.original docking
hints only while the edge/DI, endpoints, endpoint geometry and exact XY route
are unchanged. Edited geometry must not revive cached docking hints.

These run in Happy DOM; absolute SVG width/height are supplied because that test
DOM cannot resolve the production SVG's percentage viewport lengths.

The native core-control suite now has 22 groups: its existing history case uses
actual rename, Back, Undo and Redo buttons to require global chronology, and three
new cases cover parent deletion, collapse/new-branch redo invalidation, and real
wheel camera changes followed by Undo during an active drag. These retain exact
XML/history, independent exported metadata, and actual import/reopen checks. The
changed browser cases are prepared and not locally executed. Hosted browser acceptance remains required before claiming
the manual navigation-history finding resolved in the preview.

## Import and navigation concurrency

Import requests and committed diagram renders have separate generations. Parsing,
requested-diagram lookup and graph preparation must succeed before an import
supersedes the current render. A malformed document or missing requested diagram
therefore leaves an already pending drill/Back operation able to finish normally,
with its existing XML, history and cached target camera.

Before commit, the latest request wins: an older delayed parse cannot later
replace the document, even if the newer request fails. After a valid import has
committed its graph and is waiting for fit, a newer failed preflight does not
cancel that valid render or its Modeler bookkeeping. A newer valid replacement,
clear, or destroy still cancels older rendering. Stale awaited navigation cannot
apply its Back path or viewport to the newer graph.

Undo/Redo remain synchronous booleans. They return false while navigation or the
current import is pending, and cannot replay old document commands into a newly
committed graph before its successful import clears history. Failed preflight
preserves existing commands and permits replay once the pending operation settles.
The navigation pending event covers import as well as drill/Back transitions.

Thirteen deterministic structural groups exercise queued fit frames, delayed
concurrent parses, both pending drill/Back directions, malformed/missing-diagram
failures, valid replacement, same-graph supersession, clear/destroy, and an active
positive drag cancelled by failed import. These complement the existing native
core navigation/history and site import gates; they do not constitute new manual
or native-browser execution evidence.
