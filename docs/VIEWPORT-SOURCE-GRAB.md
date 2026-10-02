# Viewport-aware source grabs (D15)

Manual QA on site `a3c4e50d45bdc9de99e371d3f178dfbfb96fb07e`,
runtime `e05b7088be0b8ec7e8b59bfc510bfcb69ec2bf66`, found a selected
task's visible right midpoint at x1171.75 in a 1180px canvas while its grab
occupied x1180.33–1190.33. Dragging the remaining resize square resized the
task. An explicit pan exposed the grab and preserved the intended origin, but
that recovery did not make the clipped control usable.

The bounded correction preserves the chosen outline point and existing usable
grab locations. If the grab would be clipped or covered by editor chrome, a
pure placement helper chooses a clear position inside the intersection of the
canvas, container and browser/visual viewport. Custom fit insets and the actual
palette, minimap, toolbar, attribution and context-pad boxes remain reserved.
Existing selected and hovered edge controls, resize handles, owner-label bounds
and the central body drag region also constrain fallback placement.

Fallback grabs may sit inward or diagonally from the chosen outline point. The
marker remains exact, the circles retain at least 12 CSSpx center separation,
and the pointer-inert tether shows their relationship. Candidate directions
avoid purely tangential travel so fine along-border origin choice remains
separate from approaching the displayed grab. Only the grab's painted disc
owns presses; no wider invisible hit area or automatic viewport pan is added.
If no candidate clears the visible bounds and occupied regions (including a
completely occluded or too-small canvas), no source press target is created.

The same approach lifecycle is checked when an existing route lies between the
marker and a grab beyond the context pad (F23-T). A previously acquired source
approach must survive passive route hover. The underlying line remains clickable
outside the grab, and explicit edge editing retains its existing handlers.

Focused validation covers all four edges and corners at zoom 0.2, 0.5, 1, 2 and 4;
selected and unselected tasks; one-CSS-pixel perimeter changes and tether travel;
inactive click and immediate retry; activated Escape; exact source/history;
browser/visual-viewport clipping; editor chrome; and full occlusion. These are
pure geometry and registered-handler structural tests. The strict native F27
reachability assertion and native F23-T approach remain required hosted gates.
Local structural results do not certify native hit testing or overall parity.
