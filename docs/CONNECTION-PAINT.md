# Straight connections and short rounded bends

The visible-UI reproduction on 2026-10-03 created an aligned-center Gateway and
Task. A one-CSS-pixel difference in the delivered endpoint produced a legitimate
one-unit orthogonal offset. The old rounded renderer then exaggerated that
offset by drawing backwards between adjacent curves:

```
waypoints: (615,232) → (698,232) → (698,233) → (780,233)
old curve end: (698,233)
next line end: (698,232)
```

The independently captured export is preserved byte-for-byte in
`test/fixtures/connection-paint/aligned-wrinkle.bpmn`. A second native reproduction
with an eight-unit internal leg painted back by two units. This is independent
of whether a pair of nodes looks aligned: the delivered endpoints can differ,
but their rounded path must not invent a backward piece.

## Contract

- Facing, exactly aligned chosen endpoints on a clear route remain a two-point
  straight connection, including fractional diagram coordinates
- Explicit nonzero endpoint offsets remain exact. No pixel rounding or automatic
  bend deletion is used to make them appear aligned
- Each internal segment supplies a shared length budget to its two rounded
  corners. Their cutbacks must not overlap. Corners that do not compete retain
  their existing path coordinates
- Authored waypoints, manual reversals, endpoint metadata, semantics and DI are
  unchanged by drawing, selection, zoom or export. Undo/Redo restores the exact
  document after an actual edit
- SequenceFlow, MessageFlow, Association and input/output DataAssociation use
  the same paint helper while retaining their own markers and dash styling
- A connect preview and its committed connection use the same paint helper

## Bounded implementation difference from upstream

Pinned diagram-js 15.27.1 `util/RenderUtil.js` reproduces the same backward line.
Its independent corner radii are limited by each whole neighboring segment,
allowing both corners to consume that segment. `lib/draw/ConnectionPath.js`
allocates contested length proportionally, using the original radius demands
from both sides before applying any reduction. This keeps the result symmetric
under route reversal and leaves unchallenged corners unchanged.

The algorithm is adapted under the retained MIT notice. The root dependency is
unchanged. `BpmnRenderer.drawConnectionSegments` and the Modeler connect-preview
path are the only production call sites changed. Routing, projection, hit width
and waypoint commands are not modified. The hit path follows the corrected
visible path through the existing Viewer rendering lifecycle.

## Verification boundary

Focused geometry checks include the actual native one-pixel path, all directions
of short horizontal/vertical bends, fractional coordinates, frozen metadata,
unchanged ordinary paths and 14 representative element/connection combinations
with exact horizontal and vertical anchors. Structural Modeler checks cover the
native exported fixture, five connection styles, positive registered preview,
Escape, commit, three raw-exact Undo/Redo cycles, export and reopen at multiple
zooms. Reopen compares the complete independent semantic/DI model because the
existing parser adds explicit `xsi:type` declarations to newly authored Points.
History assertions remain byte-exact.

`node test/modeling/browser-connection-paint.mjs` prepares six separate native
whole-case lifecycles, using visible palette creation and real mouse/keyboard
input. They cover Task/Gateway/Event sources, horizontal and vertical alignment,
deliberate one/eight-CSS-pixel offsets, low/normal/high zoom, DPR 1/2, preview and
Escape, commit, target reconnect, history and visible export/reference reopen.
One case additionally moves and resizes the connected Task. An independent SVG
control-polygon assertion rejects the original backward segment; it does not
compare against the implementation's computed radius.

Native setup uses the separately reviewed `anchor-preview-zoom.mjs` calibration
before the retained factory's zoom check. It measures delivered wheel units and
camera gain, including DPR 2, instead of assuming requested and delivered deltas
are identical. Requested/delivered ticks and camera evidence are saved even if
setup fails. The original shared factory stays unchanged.

The native six-case suite is prepared and unrun locally. Structural DOM checks
do not certify browser rasterization or native gesture acceptance. Gateway
vertex selection and source-affordance motion are separate changes. Historical
F23 intermittency remains the unresolved finding documented in
`BOUNDARY-ACQUISITION-DIAGNOSTIC.md`.
