# External label width resize

This bounded reconstruction retains the published e/w resize behavior and adds
the default snapping behavior of pinned bpmn-js 18.30.1 / diagram-js 15.27.1.
It is a new reviewed revision, not certified recovery of the lost local tree.

Label gestures first use
[ResizeSnapping](https://github.com/bpmn-io/diagram-js/blob/v15.27.1/lib/features/snapping/ResizeSnapping.js):
visible, non-label, non-connection siblings contribute right and left borders in
parent child order, followed by the original dragged edge. The first border
within seven graph units wins. Otherwise
[GridSnapping](https://github.com/bpmn-io/diagram-js/blob/v15.27.1/lib/features/grid-snapping/GridSnapping.js)
uses a ten-unit grid, including directional minimum-size constraints. For a label
at x547 with width48, an eastward reduction to the minimum can therefore produce
width13, and a westward reduction width15. Ctrl or Meta bypasses snapping unless
Alt is held. `snap: false` also disables gesture snapping. Direct `resizeShape`
API bounds remain unsnapped; minimum width is ten.

Only the label is resized. The chosen width is retained, text determines height,
and owner bounds, routes and anchors remain unchanged. Imported display fitting
uses the retained TextRenderer while preserving saved DI. Cancel, zero movement,
out-and-back and history interruption restore the original label graph/DI aliases
and metadata. Standalone SVG excludes transient hit regions and resize controls.

The pure geometry tests compare the real pinned ResizeSnapping/GridSnapping event
pipeline, Resize constraints and LabelBehavior height fitting. The native suite
uses actual e/w pointer gestures and independent exported semantic/DI assertions,
including modifier bypass, positive activation before cancel, exact history,
metadata and same-XML reopen comparison in both engines. Native execution of the
reconstructed files remains pending; syntax or structural success is not browser
certification.
