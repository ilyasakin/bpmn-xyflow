# Group titles, category bindings and frame lifecycle

This is a fresh local Group follow-up after the reconstructed flow checkpoint.
The new structural/reference tests and native preparation apply to the current
bytes. The historical lost local tree is not their source of certification.
Native Group16 remains unexecuted until its exact checkpoint runs in hosted CI.

## Standard semantic binding

A Group title is `CategoryValue.value`, referenced by `Group.categoryValueRef`.
The Group has no supported `name` property. Creation supplies a Category and
CategoryValue, and its external title uses the standard top placement. The
palette default is 300×300, matching pinned bpmn-js18.30.1. Imported or explicitly
provided bounds are preserved. Editing, clearing and deleting the external label
keep the Group itself. Deleting the last referencing Group cleans unused category
objects; a shared binding remains while another Group uses it.

Existing shared CategoryValue references stay shared. Local rename refreshes all
active peer labels immediately. Copying a Group creates its own new Category and
CategoryValue; two copied Groups do not share a new binding even if their originals
did. Renaming a copy must leave the originals unchanged. Standard copied
CategoryValue documentation is asserted in both engines; upstream drops unknown
attributes on copied objects, so the shared native comparison requires original
metadata to remain intact rather than pretending copied unknown attributes match.

## Membership and exact local history

Committed create, move, resize, delete, copy and reconnect operations maintain
category membership for contained root-scoped FlowElements. Visible expanded-subprocess children participate when they share the active
diagram root; hidden collapsed children are excluded. A separately opened
subprocess diagram computes membership in its own root scope. Legacy Groups
without a binding are healed only by committed changes. Selection, canceled edits
and no-op gestures do not silently mutate the document. Malformed category
bindings refuse before changing semantic or graphical state.

Local undo/redo restores exact XML and original Group/category/DI relationships,
including optional Label/Bounds presence and comments or processing instructions
inside Bounds. Native positive-commit comparisons permit only the intended
CategoryValue text and affected label geometry. Owner resize permits owner and
label geometry only, and must preserve the semantic title. Full unrelated Task,
IO, association and DI content remains part of the independent comparison.

## Rendering and owner resize

Frames use the pinned normal-modeling foreground rank above connections. Only a
frame's border accepts input; its transparent interior leaves enclosed nodes and
flows selectable. Initial import, fresh creation, redraw, history, reopen and
standalone SVG use the same local frame layer. External labels and editing
controls remain above it.

A resized Group moves its external label by the nearest-border reference-point
delta from pinned LabelBehavior. The pure helper uses unchanged bpmn-js18.30.1
LineUtil plus AttachUtil mapping, applied from the original preview snapshot.
The text layout helper is unchanged diagram-js15.27.1 Text.js with its MIT notice
and separate provenance, ensuring exact-width text fits as in the current pinned
renderer. The runtime XYFlow controller and root diagram-js dependency are not
replaced.

## Exact reference differences

The native suite distinguishes these measured reference behaviors from local
preservation requirements:

- Upstream changes a shared CategoryValue immediately but leaves peer labels
  visually stale until reopen. Local peers redraw immediately; both render the
  shared value after reopen
- Undoing the first title on a newly created Group can remove upstream's prior
  category binding while retaining the newly authored label DI. Local history
  restores the exact pre-edit model
- Upstream imported-label edit/delete/resize Undo can write the pre-edit displayed
  label bounds back to DI. Local history retains the original saved bounds
- Upstream normal Group creation is above flows, but import can put the frame
  below a later route. Local frames keep consistent foreground order

These outcomes are asserted specifically. Upstream history canonicalization
normalizes only unordered root/artifact/DI collections plus the exact measured
label-bound or first-binding effects. Local history compares raw XML, including
Redo. No broad mismatch allowance is used.

Primary sources: pinned
[GroupBehavior](https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/features/modeling/behavior/GroupBehavior.js),
[BpmnOrderingProvider](https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/features/ordering/BpmnOrderingProvider.js),
[LabelBehavior](https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/features/modeling/behavior/LabelBehavior.js)
and the independently exercised actual Modeler services.

## Prepared native Group16 gate

Each engine runs eight independent cases: palette creation/title/rename/cancel/
empty/Delete-label plus frame lifecycle; shared category metadata and peer
rendering; last Group deletion; owner resize with an activated cancel preview;
Ctrl+D independent copy/rename; and unsupported Association, DataInputAssociation
and DataOutputAssociation editor refusal. The eight cases involving declared
reference differences have an explicit `intentional-difference` result. The
remaining eight engine cases require the common behavior.

Tested actions use actual Chromium pointer/keyboard input. Imports are setup and
read-only geometry/model inspection supplies assertions. The located GroupA
label Bounds inner XML is compared at its original shape/label location. Fixture
inputs under `test/fixtures/group-native/` retain the surviving authored shared,
single and overlap variants; all three validate against official BPMN20 XSD.
Owned server identity, bounded timeouts, independent aggregation and screenshots/
XML/results follow the other native gates. Syntax or DOM checks do not certify
native execution.
