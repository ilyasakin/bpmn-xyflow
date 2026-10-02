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

A separate native gate, `pnpm test:browser:viewport-source`, contains 12 visible-UI
cases for four edges, four safe-area corners, and palette/minimap adjacency at
low/high zoom. Each case approaches the actual grab in small pointer steps and
cancels and commits a connection from the constrained source before any pan
recovery. Exact source position, painted visibility, selection, full XML/DI and
history are asserted. These cases are prepared and independently reviewed;
hosted execution is pending at this checkpoint.

## Releasing a reached source grab (D16)

The hosted `source-halo-edge-pass-through` case at runtime `0c33c80` exposed
an approach-lifecycle regression. The pointer reached a grab painted at
(230,185.99), with delivered input (230,186), then moved tangentially to
(237,186). That point already hit the underlying `HaloFlow` and lay outside
the 5.75 CSSpx painted radius. The wider 8 CSSpx acquisition corridor still
suppressed the line's normal hover controls.

The modeler now remembers actual arrival on the displayed grab. Once the
pointer leaves its painted disc onto an edge, the obsolete source tool yields
to ordinary edge hover. Duplicate pointer/mouse events at the grab remain
stable. Small-step travel toward a displaced grab across a route still keeps
the chosen source (F23-T); neighboring shape clicks and painted-only press
ownership retain their existing behavior. No hit region is enlarged.

Registered-handler coverage reproduces the exact delivered coordinates, both
tangential departures at four zooms, inside-paint motion, duplicate arrival
and departure events, ordinary edge selection, and unchanged XML/history,
selection and viewport before the click. The retained hosted negative is
unchanged and remains the native acceptance gate.

## Traversing editor chrome (D19) and native pan observations

The `947a360` southeast case initially displayed its chosen marker at
(1796.254,1196.252) and its reachable grab near (1722,1166). Small native
steps along that inward tether crossed the HTML attribution box at
x1732–1785/y1164–1185. SVG pointer leave destroyed the acquired control,
so re-entering the task recreated an unrelated, offscreen outline origin.
This was an approach-lifecycle defect, despite valid final grab placement.

An already acquired source corridor now survives pointer leave and mouse move
across attribution, palette, toolbar and minimap surfaces. This new retention
requires the measured tether corridor and ends on departure, unrelated HTML,
or editor exit. The prior context-pad exception remains: its existing early
return retains the source while the pointer is over that pad. Chrome retains
its own mouse input and link/button hit ownership. The tether remains inert;
no navigation is activated by the tests. This is corridor lifecycle preservation,
not geometric path avoidance.

The registered regression replays the retained native southeast positions,
checks the exact original marker throughout, commits before any pan recovery,
and verifies exact Undo/Redo. Further controls cover ordinary HTML input,
leaving the corridor/editor, F23 route crossing and D16 post-arrival release.
The same12 native cases retain their strict selection, source, model and
history checks. Their southeast path additionally observes attribution hit
ownership without clicking its link.

Five failures in the same hosted run were only a numeric observer error:
d3-zoom computes each camera coordinate as `p1 - ((p0 - x) / zoom) * zoom`,
which can differ from `x + (p1 - p0)` by one or two floating-point steps.
The test now captures the unchanged root SVG matrix and actual delivered
SVG-local down/final-move points, then checks the installed operation order
exactly. It introduces no coordinate tolerance. Four retained numeric examples
and a serialized inverse-transform observer are structural regressions.
The six active-Escape selection failures are a separate D18 product issue.
Hosted execution of all12 remains required after the repairs are combined.
