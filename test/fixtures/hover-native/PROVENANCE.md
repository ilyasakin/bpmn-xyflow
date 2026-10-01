# Native hover fixtures

`orthogonal.bpmn` and `diagonal.bpmn` are authored fixtures with integral geometry,
two independent connections, spare endpoints, and retained semantic/DI metadata.
They isolate native hover activation from labels, pools and unrelated controls.

`booking.bpmn` derives from the retained booking-timeout-compensation scenario
using official bpmn-moddle 10.3.1. It places FlightTimeout on ReserveHotel at
(462,242,36,36), with label bounds (435,278,90,20), and routes TimeoutFlow through
(498,260), (790,260), (790,405). This is the real post-reattach overlap previously
measured in native hit diagnostics: ReservationFlow2 starts at (480,260).

All three retain the normal static hit policy. Approach history (fresh versus
hovering the route first) is exercised through native mouse input, never by
setting a hover class or invoking a gesture handler.

The authored tasks include their incoming/outgoing inverse flow references.
Actual pinned reconnect adds these references during Undo when they were absent,
so explicit fixture membership keeps the native exact-history check meaningful.
Full-service reference measurements additionally show that an activated net-zero
bend edit leaves XML unchanged but records `connection.updateWaypoints` and
`group.updateRefs` (stack index -1 to 1). Prior selection of FlowA is restored
after reconnecting hovered FlowB. These service measurements do not substitute
for native browser execution.
