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
(`10 / zoom` in graph coordinates). Existing selected controls and handlers
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

Known local behavior is asserted separately from upstream: double-click can
remove an interior bendpoint, whereas pinned upstream opens label editing;
local blur cancellation is also stronger than the upstream dragging listener
lifecycle. Local exact no-op/history guarantees are not weakened to match an
upstream command that may be recorded after an activated out-and-back drag.

## Verification status

`test/modeling/hover-controls.test.mjs` adds 11 structural groups covering
ownership, geometry, threshold, lifecycle, promotion, double-click, history,
create-port transitions and export isolation. They pass together with the 22
retained connection/routing/targeting groups. These invoke registered handlers
and do not certify native SVG hit behavior.

`test/modeling/browser-hover-connections.mjs` prepares 16 paired groups
(32 engine cases), using real Chromium pointer/keyboard input against each
engine. It includes the previously measured booking boundary approach-path
case and explicit known differences. Hosted native execution remains pending.
The original 27 native arrow groups remain unchanged and required.
