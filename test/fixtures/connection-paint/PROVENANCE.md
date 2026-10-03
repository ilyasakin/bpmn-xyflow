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
