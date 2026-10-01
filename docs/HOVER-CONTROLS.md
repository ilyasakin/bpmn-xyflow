# Connection hover controls

This isolated follow-up adds controls for an unselected connection without
changing the Viewer’s static shape/connection hit regions or connection paint
order. Hovering does not select an element or change BPMN XML/history.

## Reference and activation

The reference is bpmn-js 18.30.1 with its diagram-js 15.27.1 dependency:

- `features/bendpoints/Bendpoints.js` and `BendpointUtil.js`: waypoint controls,
  a radius-10 graph-unit hit circle, and the central two-thirds of aligned
  segments with a 17 graph-unit hit height
- `util/LineIntersection.js`: existing waypoint priority within 10 graph units,
  otherwise approximate path intersection
- `features/dragging/Dragging.js`: activation only after more than five CSS
  pixels of pointer travel
- `assets/diagram-js.css`: transient hover controls coexist with selected
  controls; floating bendpoint indications do not intercept input

The installed runtime `LineIntersection.getApproxIntersection` has the same
algorithm as the pinned reference; its differences are import/type paths.
No second event engine or runtime bpmn-js dependency is introduced.

Unselected hover controls resolve their owner by `data-element-id`. Existing
waypoints start a bend/endpoint gesture; an aligned middle segment starts a
segment move; outer or diagonal spans insert a bend. After the activation
threshold, these actions use the existing route, dependent-connection and
command/history paths. Exact local pointer docking remains unchanged.

A click promotes the same SVG hit nodes into the selected set. This preserves
native double-click targeting, including when another edge was selected.
Promotion restores the existing selected hit radius of 10 CSS pixels
(`10 / zoom` in graph coordinates), including later zoom changes. The promoted
root and visible marker clear their transient pointer-event styles; the
retained transparent hit circle stays interactive. Its owner, waypoint index
and center match the visible radius-4 marker. It may be the topmost target at
that center, preserving the native click target across promotion. Existing selected controls and handlers
retain their established behavior; this work does not claim a new universal
selected-versus-hover geometry equivalence.

## Lifecycle and boundaries

- Route-to-control motion keeps the same hover owner; leaving for another shape
  or the background removes the transient set
- A different selected edge retains its controls and selection. Its controls
  are temporarily hidden while an unselected hover gesture is active, then
  restored. Multiple selection suppresses transient controls
- Clicks and motion through five CSS pixels do not mutate the model. Activated
  Escape, invalid drops and local out-and-back gestures restore exact snapshots
- Blur, selection changes, import/navigation reset, deletion, undo/redo and
  destruction clear pending controls. Two instances keep separate state
- Hovering a connection removes a competing shape-create port; leaving for an
  eligible shape allows that shape’s normal port to return
- Overlay graphics are excluded from standalone SVG export and never enter
  BPMN DI
- Global mousemove events with Window, missing, detached or outside-canvas
  targets clear transient hover as appropriate without interrupting an active
  move, resize or reconnect operation

Known local behavior is asserted separately from upstream: double-click can
remove an interior bendpoint, whereas pinned upstream opens label editing;
local blur cancellation is also stronger than the upstream dragging listener
lifecycle. Local exact no-op/history guarantees are not weakened to match an
upstream command that may be recorded after an activated out-and-back drag.

## Verification status

`test/modeling/hover-controls.test.mjs` contains 14 structural groups covering
ownership, geometry, threshold, lifecycle, promotion, double-click, history,
create-port transitions, global event targets and export isolation. They pass together with the 22
retained connection/routing/targeting groups. These invoke registered handlers
and do not certify native SVG hit behavior. The viewport callback test uses
absolute SVG dimensions because Happy DOM cannot resolve percentage SVG
lengths; it exercises the real XYPanZoom callback, event count and completion
result, including selected-target identity and size after fit/zoom.

`test/modeling/browser-hover-connections.mjs` prepares 16 paired groups
(32 engine cases), using real Chromium pointer/keyboard input against each
engine. It includes the previously measured booking boundary approach-path
case and explicit known differences. Initial hosted execution exposed both
the global event-target bug and native-harness assumptions: upstream can show
segment hit regions while fixed bendpoints are hidden, preview paths must be
read outside marker definitions, and a background click must exclude the
minimap and prove deselection. The corrected suite retains positive activation
and exact model/history assertions. Existing radius cases now also apply real
Ctrl+wheel after ordinary and promoted selection, then drag/cancel a selected
segment. Hosted verification of these corrections remains pending.

The original 27 native arrow groups remain required. Selected-waypoint guards
now accept only the exact matching visible marker or its promoted hit circle,
checking owner, index, shared selected group, center, radii and visibility;
the source/drop geometry and history assertions are unchanged.

The next hosted run passed the retained connection, flow, Group and advanced
suites but exposed a background-collector API mistake in this new harness.
The collector now uses the actual local `Graph.roots` array and is executed in
its serialized browser form against both real editor implementations before
CI. Tests reject absent/malformed roots, element hits, controls, minimaps and
points outside the visible canvas.

The pinned dragging listener installs a one-shot ghost-click trap. The harness
observes the actual priority-5000 trap consuming a background click, then uses
one additional native click and requires deselection. It never removes that
listener or replaces selection through an API. Each ordinary/promoted
selected-control zoom subcase starts from its own setup viewport, preventing a
second cumulative zoom from moving the tested endpoint off canvas.

One reference-only Delete/Undo difference is measured explicitly: restoring
FlowA reinserts it after FlowB in `HoverProcess.flowElements`. A fixture-scoped
oracle permits only that exact sibling-order change; DI order, metadata,
references, every other field and raw Redo remain checked. A subsequent pinned
import reconstructs the canvas in that semantic order, so its next export also
places `FlowB_di` before `FlowA_di`. A separate full-service oracle permits only
those two DI entries to change order in this exact fixture; geometry, references,
extension values and all other content remain equal. Local Undo and reopen keep
their original strict requirements.

Hosted `e3a3f1f` passes 29 of 32 hover engine cases and all retained native suites.
Its remaining failures are the reference DI reimport order above and two local
numeric checks that confused the public double-precision zoom with Chromium's
float32 SVG matrix scale. The corrected check requires the local radius to equal
`10 / modeler.getViewport().zoom` exactly, checks the actual numeric SVG matrix
factory against the screen CTM, and bounds their storage difference by half a
float32 ULP. Rendered width is checked separately using the SVG length value and
coordinate-derived rounding bounds. Wrong radius, stale target, hidden control,
unrelated DI/semantic edits and pixel-scale geometry drift still fail. All 32
cases remain required; this test-only correction awaits hosted execution.
