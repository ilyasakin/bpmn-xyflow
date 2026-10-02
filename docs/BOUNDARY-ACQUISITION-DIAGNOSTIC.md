# Selected boundary source acquisition: unresolved native intermittency

The same frozen product tree `f4f14a9b518da5f98efafde01ef14e7060d69a05`
passed F23-B in the PR run and failed it in the push run at published
`201214b69434b066abc98e3d43ff6b7dbac03268`. This diagnostic checkpoint does not
change production code or classify the trigger without evidence.

Both recordings use the same Booking fixture, selected FlightTimeout, lower
quarter-circle origin and delivered pointer path. The viewport is
`{x:557.6760518360127,y:358.229033698398,zoom:0.8788735989262744}` with SVG top48.
The passing evidence records marker `(678.3370087109132,315.18639520580945)`,
grab `(655.6204680086178,350.88780013241137)` and integer press `(1134,715)`.
The failed path also reaches the connection hit at `(1134,715)`, and its approach
assertions pass. The later source-control screenshot has no displaced control.
The next duplicate move and mousedown at the identical coordinate hit the
underlying transaction. Its subsequent drag moves the transaction and children
by `(135,65)` and commits one history entry. The expected connection preview is
absent. This is not established as an activation-distance or stale-coordinate
error.

A registered-handler replay of the exact approach, duplicate pointer/mouse
coordinates and intervening XML reads passes on the frozen source. It commits
from the exact marker, leaves the transaction fixed and preserves complete XML
through three Undo/Redo cycles. This narrows the cause but does not resolve the
native failure. In particular, the original artifacts do not record window
blur, pointerleave, selection notifications or unchanged-value viewport
notifications between acquisition and mousedown.

## Diagnostic gate

Run `node test/modeling/browser-boundary-acquisition.mjs` through the existing
owned browser-suite runner. It executes six fresh whole-case lifecycles of the
unchanged F23-B `selected-boundary-lower-origin` workflow. All original actions,
assertions, original errors and cleanup deadlines remain. Original39, its
shared factory, ownership24 and F11 source files are unchanged.

A passive observer records trusted native input and focus/leave events, the
public Viewer notifications, exact before/current viewport values, control DOM
identity/geometry/removal, hit ownership and selection/history. A stack is
recorded for public viewport/selection notifications to distinguish their
origin. The test driver marks evaluation and screenshot boundaries; it never
patches product methods, dispatches input, retries an action or adds settling
waits. These extra observation round trips can affect timing, so passing
repetitions alone cannot close the previously observed defect.

Evidence is under `test-artifacts/boundary-acquisition-diagnostics`, including
per-repeat latest/final traces and the ordinary case screenshots/XML/results.
The trace reports any record-limit truncation. The original failing assertion
remains the gate. No new browser pass is claimed by the structural checks.

Focused checks: `selected-boundary-acquisition.test.mjs` verifies the actual
registered geometry/history sequence; `boundary-acquisition-diagnostics.test.mjs`
checks the serialized observer, unchanged-transform/removal detection,
non-consuming input, lifecycle disposal and transparent driver error identity.
