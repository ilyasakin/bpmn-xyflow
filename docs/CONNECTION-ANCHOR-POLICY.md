# Connection anchor policy

This editor uses a type-specific interaction policy. The fixed gateway anchors
are an explicit user-requested UX rule, not a universal BPMN specification rule.

## Shape families

| Family | New or actively edited docking |
| --- | --- |
| Every Gateway subtype | Four diamond vertices: top, right, bottom, left |
| Events, including Boundary Events | Actual circular outline |
| Tasks and other activities | Rounded rectangle outline |
| Expanded subprocesses and transactions | Rounded activity outline and existing scope rules |
| Pools and lanes | Rectangle frame and existing eligibility rules |
| Data objects, stores and annotations | Existing rectangular docking path, which differs from their folded/cylindrical/bracket artwork |
| Connections owning an annotation | Existing sharp waypoint-line projection |

A gateway pointer chooses the closest vertex in diagram coordinates. Exact ties
use top, right, bottom, left order. Preview, source marker, target marker and
committed DI must agree. Automatic routing may choose a different vertex to suit
its terminal routing direction; it must never crop the final endpoint to a
sloping diamond side. Viewport zoom does not alter vertex locations.

Gateway create, reconnect on either end, segment/bend editing and geometry repair
apply this policy. Moving or replacing a gateway must leave every changed route
on vertices. Existing resize eligibility remains unchanged: gateways have no
ordinary resize handles. A rigid translation of a conforming route translates
its vertices exactly. Valid self-loops remain supported, including a deliberate
activated return to the same vertex; they must not collapse or cross the gateway.

## Import and programmatic editing

Importing, rendering, exporting and reopening an existing document do not rewrite
authored waypoints. A sloped-side endpoint can therefore remain visible in an
untouched imported diagram. Undo of an editing command restores that exact
authored route and its metadata. A pure clipboard copy/paste also preserves that
authored geometry under rigid translation; it is not a newly chosen docking.
The first later endpoint/route repair adopts vertices and remains undoable.

`connect`, `reconnect` and `updateWaypoints` are editing operations. Newly supplied
routes are subject to the gateway policy, including explicit waypoint arrays.
Their endpoint coordinates may snap to vertices. Interior bends and metadata are
retained when they can be repaired without an invalid route. A refused route
must leave model, selection and command history unchanged. This policy is never
implemented as serializer normalization or by modifying import snapshots.

Low-level outline cropping remains geometric. It is distinct from the editing
anchor policy, so it can still represent or inspect historical authored routes.

## Acceptance

Pure geometry and registered-handler tests supplement visible native input.
Native cases must prove source and target creation, both reconnect directions,
preview/commit agreement, move/replace, cancellation, exact history and reopen.
The historical F23 investigation remains separate and unresolved until its own
acceptance evidence closes it.


### Open clipboard precision finding

The separate `GV-authored-copy` native case is retained with its strict relative
geometry checks and excluded from the eight core Gateway acceptance workflows.
The current clipboard path rounds copied shape origins while translating route
coordinates exactly. With the real Conditional-flows Task/Gateway selection
(width195), a canvas-center paste yields a half-unit mismatch: a copied Task's
right edge is903 while its copied endpoint is902.5. This violates the desired
rigid relative-geometry contract and remains open for a separate paste fix.
The case can be run explicitly with `browser-gateway-anchors.mjs --legacy-copy`;
it is not counted as a passed or waived Gateway case.
