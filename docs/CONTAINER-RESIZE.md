# Container resize policy (D14)

Resizing an expanded SubProcess or Transaction changes the frame and its incident
routes. Children retain their absolute bounds, labels and internal routes. Moving
the container remains a distinct action that translates its contents. Attached
boundary events follow the pinned sticky-side attachment calculation rather than
scaling their tangential position along an unchanged side.

Interactive SubProcess resize uses the pinned 140×120 minimum and the contained
shape bounds with 20-unit padding. Participant and Lane handles use the dedicated
orientation, neighboring-lane and content constraints. Normal lane resizing
balances adjoining lane boxes without moving flow nodes. Ctrl/Meta (without Alt)
retains the reference SpaceTool resize mode, which can move neighboring contents.
The public `resizeShape` command remains a direct bounds operation; the interactive
constraints and lane balancing belong to the handle gesture. The existing Task
resize extension and ordinary Move behavior remain distinct.

`ContainerResize` constructs a detached graph view because local lanes own their
flow nodes, while the reference canvas keeps flow nodes under the lane root.
The adapter calls the unchanged pinned pure constraint and lane-box planners. The
Modeler applies previews from a single geometry snapshot and commits one command.
All affected lane boxes, shapes, labels and dependent connections share that
snapshot, including a routing-refusal rollback and exact Undo/Redo.

## Measured reference defect in modifier mode

In bpmn-js 18.30.1, `ResizeLaneHandler.resizeSpace` calls `makeSpace` without its
optional start coordinate. When both ends of a connection move, the installed
`SpaceToolHandler` compares waypoint coordinates to that missing value, leaving
those routes behind. In the approval fixture, Ctrl-resizing RequesterLane south
by 30 moves ReviewRequest and ApprovalDecision from center y348 to y378 while
DecisionFlow remains at y348. ApproveFlow has the same problem.

The local implementation deliberately keeps those routes connected and translates
manual flow-owned Associations when both effective endpoints move together.
This calculation validates the declared translation against old/new coordinates;
it does not subtract fractional positions or round them. A connection with only
one affected endpoint follows the normal layouter and label adjustment policy.

The paired structural tests use the actual reference Resize→Dragging→command
chain. They disable grid snapping for geometry comparison and move the structural
fixture's auto-scroll thresholds outside the canvas to avoid Happy DOM's unrelated
SVGMatrix limitation. Those tests are service/registered-handler evidence, not a
native browser certificate.

`test/modeling/browser-container-resize.mjs` adds two independent native cases,
one per engine, using visible lane selection and the south resize handle with
Ctrl held. It asserts the complete fixture-specific document, exact per-engine
routes and three history cycles. The reference-only oracle narrowly includes the
measured lane DI ordering, `isHorizontal=true`, and previously absent label DI;
local Undo stays byte-exact. The native pair is prepared and remains unrun until
hosted execution. Existing F29 independently covers normal Transaction NW resize.
