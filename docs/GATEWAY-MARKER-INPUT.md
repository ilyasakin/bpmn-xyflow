# Direct Gateway vertex controls

The October3 native review found two distinct conditions. The selected Gateway
at bounds565,237,50×50 had its right grab displaced by the context pad. Pressing
its small right-vertex indicator at client615,340 moved the Gateway185px instead
of connecting. The separately reviewed pad spacing corrects that geometry in a
registered replay, but it does not solve an unselected Gateway at zoom.578704:
all four grabs can be displaced to preserve access to the shape body.

Each already visible fixed-vertex circle is now an explicit mouse Connect
control. Its existing2 CSSpx radius and1 CSSpx stroke are unchanged, and
`visiblePainted` owns only that painted disc. No transparent halo, shape hit
region, docking coordinate, context-pad position or model geometry is expanded.
The per-marker title and accessible label identify its top/right/bottom/left
origin. The separate grab remains available.

A press resolves the marker's own index to the current Gateway vertex, even if
another displaced grab was active before the press. Moving onto another fixed
marker chooses that vertex rather than retaining the previous grab's origin.
The existing Connect lifecycle requires more than5 CSSpx of actual movement;
stationary presses and3/5px motion preserve selection, geometry and history.
Preview, commit and Undo/Redo retain the exact pressed vertex.

The shape body still moves the Gateway. Source controls stay below actual resize
and selected/hovered connection controls in SVG order. The enlarged visual outline
and tether remain pointer-inert. The existing HTML context-pad keyboard/touch
entry is preserved; this patch does not introduce a new touch-drag or keyboard
architecture for the small SVG circles.

Registered-handler tests cover all four vertices, selected/unselected states,
zooms.2/.578704/1/2/4, immediate retry, cancellation, exact source/route/history,
all five Gateway families, body movement and actual resize/endpoint precedence.
Their structural DOM input is separate from native hit testing. The existing
Gateway native job must retain its original displaced-grab workflows and add
literal direct visible-marker presses, plus existing context-pad keyboard/touch
regressions. Native acceptance is pending. The low-zoom marker defect must not be
closed using the earlier pad-only replay.
