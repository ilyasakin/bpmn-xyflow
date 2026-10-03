# Native aligned-node wrinkle

`aligned-wrinkle.bpmn` is the unchanged export from the independent visible-UI
reproduction on 2026-10-03, using preview site `ad787` / runtime `def0baf`.
Gateway bounds `(565,207,50,50)` and target Task `(780,192,100,80)` both have
center y232. A native drag delivered source `(615,310)` and target `(780,311)`
at zoom1 with canvas top78, producing exact diagram endpoints `(615,232)` and
`(780,233)`. The four authored DI waypoints are retained. The prior renderer
curved down to y233, then painted back to y232 before the next curve.

The endpoint offset is intentional evidence of delivered input; the paint
correction must not flatten it, change its anchors or alter imported XML.

`gateway-one-pixel-reconnected.bpmn` is the unchanged local export saved by the
hosted PAINT-3 failure at revision `7dcc2a9`. Its source artifact is
`bpmn-connection-paint-evidence/connection-paint/PAINT-3-local-gateway-horizontal-one-pixel-failure.bpmn`
from the verified run archive. Creation, reconnect and raw-exact history had
already passed. The failure is the later independent upstream import adding
the absent `isMarkerVisible=true` property on `ExclusiveGateway_murosu17_1_di`.
The full installed upstream service test reproduces only that model difference;
the local reimport preserves the model and only adds existing explicit Point
type declarations. No fixture geometry or serialized bytes were corrected.
