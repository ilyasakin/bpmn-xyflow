# Contextual modeling controls

The editor uses the existing direct XYFlow API. Its menus use pinned bpmn-js
18.30.1 target descriptors, with separate create/drop/attachment checks. The
retained pure predicates and their provenance are in `lib/upstream/`; no upstream
Modeler, Canvas, command stack or dependency injector is instantiated.

## User controls

- Select a shape and choose **Change type** for the variants valid in its current
  process, subprocess, event-subprocess or transaction context
- Select an activity and choose **Attach boundary event**, or click **+ Boundary**
  in the palette; dragging that palette item onto an eligible activity border
  also attaches a timer boundary
- The replacement menu exposes applicable loop, parallel/sequential multi-instance,
  collection, participant multiplicity and interrupting-state controls
- Right-click a sequence flow and choose **Change type…** to make it normal,
  conditional or the source element's default flow
- Use **Replace and remove contents** for a populated container conversion that
  explicitly removes content; **Cancel** and Escape leave document/history intact
- Select multiple shapes to use **Align selection** or **Distribute selection**;
  **Space tool** supports dragging, Shift compression and Escape cancellation

## Direct API examples

```js
const timer = modeler.addShape('bpmn:BoundaryEvent', borderPoint, {
  host: activity,
  eventDefinitionType: 'bpmn:TimerEventDefinition',
  cancelActivity: false
});

modeler.replace(event, {
  type: 'bpmn:IntermediateCatchEvent',
  eventDefinitionType: 'bpmn:SignalEventDefinition'
});

modeler.setSequenceFlowType(flow, 'conditional', 'approved = true');
modeler.setSequenceFlowType(flow, 'default');
modeler.toggleMarker(activity, 'parallelMI');
modeler.toggleCollection(dataReference);
modeler.toggleParticipantMultiplicity(participant);
modeler.undo();
```

Use exported TypeScript declarations for exact arguments and return types.
Invalid contextual requests return the documented null/false result without
adding history. Event-definition attributes cannot overwrite identity/type/parent
metadata. Collection changes apply to the referenced DataObject, including its
other visible references. Defaults belong to the sequence flow's source element.

Replacement is atomic across semantic references, active and sibling diagrams,
labels, attached boundaries and the editor's undo history. A populated
container-to-noncontainer conversion requires the explicit API fourth argument
`{ removeContents: true }` or the UI confirmation. Unsupported IO-bearing
Activity/Event cross-family conversions are deliberately refused; compatible
Activity replacements retain IO identities. See [PARITY.md](PARITY.md) for the
current verification state and remaining gates.

An empty pool may be created inside a Collaboration, but not on a lone Process
root. An ordinary subprocess with an untyped start is not converted into an event
subprocess until a valid typed start configuration exists; the editor does not
guess a trigger. Reconnection and type replacement normalize condition/default
properties when the resulting source type cannot own them. Unedited import/export
still preserves the original XML payload.

## Connection anchor intent

A drag from the visible shape-edge port or an explicit Shift-drag from a shape
perimeter supplies a chosen source anchor. The drop position supplies the target
anchor, projected onto the actual outline. Preview and committed routing use the
same anchors; a target on the other side of the diagram must not silently reverse
the chosen source side. A context-pad Connect action and an API call without
anchor hints may instead use automatic source docking.

The direct `connect` options accept `connectionStart` and `connectionEnd` points
in diagram coordinates when the caller has explicit docking intent. Screen
coordinates must be converted using the current viewport and canvas bounds.
Invalid or inaccessible explicit docking is rejected without a half-created
semantic connection. Manually edited interior bends are retained where possible
when repairing routes after shape movement or resizing.

Native pointer tests verify these behaviors separately from connection-rule
inference. See the current acceptance state in PARITY.md before interpreting
these commands as fully verified.

## External-label width resize

Select the external label text itself, rather than its owning event, gateway or
connection. Drag the east/west (right/left) handle to change its width. The other
horizontal edge stays fixed, width is clamped to 10 diagram units, and text height
is fitted automatically. This does not resize the owner or reroute its connections.

The existing `resizeShape` API also accepts a live external-label `GraphNode`:

```js
const label = modeler.getElement('ApproveFlow')?.label;
if (label) {
  modeler.resizeShape(label, {
    x: label.x,
    y: label.y,
    width: 160,
    height: label.height // text layout computes the committed height
  });
}
```

API requests with nonfinite bounds, width below 10 or a stale label return false
without a command. Each completed resize is one undo step. Undo/redo restores the
label's DI metadata and bounds; Escape, window blur and public `cancel()` discard
an active preview. Zero movement and dragging out and back add no history. Undo
during a drag first cancels that preview, then undoes the previous command.

The chosen width is saved in `owner.di.label.bounds`. On import/reopen, the viewer
uses the pinned upstream label measurement and positioning policy for display;
rendered graph bounds may therefore differ from saved DI. This normalization does
not rewrite the saved label DI. Read the current label node for displayed bounds.

Structural, independent-oracle and XML-schema checks cover this implementation.
The paired 19-group native-browser acceptance suite is still pending; this is not
a full-core parity completion claim.

## Rule-aligned controls and explicit differences

The context pad, menus and command preflight share executable action policy.
Append variants retain the pinned upstream target types, including event-based
and compensation-specific choices; invalid appends do not create orphan tasks.
Back navigation is available in the editor toolbar and exposes `navigation.change`
for hosts. Undo/redo follows one global chronological stack across diagrams.
Replaying a command in another diagram activates that root synchronously, clears
foreign selection, and restores its latest visited viewport. Navigation itself
adds no command and does not invalidate redo. Failed imports preserve the previous
navigation/history state. See [global history](GLOBAL-HISTORY.md) for verification
scope and the existing expanded-subprocess drill behavior.

Ordinary Task resizing is an intentional fork extension, enabled by default for
compatibility. `taskResize: false` uses upstream resize eligibility. Event/gateway,
collapsed-subprocess and data-reference resize is not advertised accidentally;
annotation resizing is horizontal. External-label width resize is implemented
with its native acceptance gate still pending, as described above.

Two replacement/append capabilities remain explicitly open in this checkpoint:
IO-bearing catch/throw conversions safely refuse incompatible data migration,
and annotation append from a connection is withheld until dependent association
routing follows owner-flow edits. Node annotation append remains available. These
are not marked complete merely because their unsafe controls are absent/disabled.
