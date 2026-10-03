# Gateway reconnect regression exports

These are unchanged exports captured immediately before target reconnects in
Gateway8 on published commit `849b34d05dcde1e5642d0c3e97cdafc905555baa`
(local source checkpoint `b5fc6416`). The evidence bundle is
`bpmn-gateway-anchors-evidence`, under `gateway-anchors`.

- `crossing-retained-route.bpmn`: `GV-plain-1`, source-commit export. The old
  interior horizontal leg crosses the new Gateway when reconnecting the target
  to its left vertex. Native input reaches graph
  `(-746.441707323248, -619.1393832394974)`.
- `blocked-terminal-bridge.bpmn`: `GV-plain-2`, source-commit export. A short
  terminal bridge cannot reach the new top vertex without crossing the Gateway,
  while a larger detour is valid. Native input reaches graph
  `(-721.5084413491404, -633.164345349933)`.

The registered-handler tests preserve these authored coordinates, independently
check diamond interiors, retain the opposite endpoint, and require exact Cancel
and three Undo/Redo cycles. The original eight native workflows remain the
browser acceptance gate.

- `replacement-incoming-refs.bpmn`: unchanged `GV-selected-0` move export
  from the next native run at `cc247c944e10884277492bc67367c0f74091ee84`.
  The two incoming references belong to a non-enumerable own moddle property; the
  expected ParallelGateway must retain them when checking the complete document.
