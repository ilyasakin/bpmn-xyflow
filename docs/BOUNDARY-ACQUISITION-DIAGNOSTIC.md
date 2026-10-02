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
origin. The observer is installed once before the workflow. The driver records
evaluation and screenshot boundaries in Node only: it inserts no diagnostic
browser evaluation, artifact dump or settling wait between the original calls.
It never patches product methods, dispatches input or retries an action.

One final browser read runs during owned cleanup, after the original workflow
and its normal success/failure evidence. Its JSON includes Node phase timestamps,
the browser time origin and installation timestamp, the checked-out Git head,
committed `lib` tree, modified production paths and SHA256 hashes of Modeler,
Viewer and the grab-placement helper. The Node installation envelope bounds
clock alignment without an additional browser synchronization call. Cleanup
still runs if that final read fails; a second cleanup does not repeat the dump.
The passive snapshots themselves still consume execution time, so even this
reduced capture cannot make passing repetitions prove the original race fixed.

Evidence is under `test-artifacts/boundary-acquisition-diagnostics`, including
one per-repeat final trace and the ordinary case screenshots/XML/results. The
trace reports any record-limit truncation. The original failing assertion
remains the gate. No new browser pass is claimed by the structural checks.

## First diagnostic run: six passes, cause unresolved

At `a0108a7`, all six original workflows passed with the first diagnostic driver.
Every acquired grab retained the same DOM identity until mousedown. There were
five genuine wheel-driven viewport notifications per case, all before the
critical acquisition interval; no unchanged-value notification was observed.
No blur, pointerleave or selection change occurred between final arrival at
`(1134,715)` and the subsequent press. Every source-control screenshot produced
a native window resize event while leaving the handle intact.

The arrival-to-press interval was 202–210 ms. The screenshot occupied 107–114 ms,
and the old diagnostic dump added 35–43 ms before the next original evaluation.
The old driver also inserted two awaited browser evaluations around each
original evaluation. Those round trips could mask a timing race. The original
failed input trace has no timestamps, so an exact timing comparison is not
available. This evidence motivated the reduced capture above, not a production
change or closure of F23-B.

Focused checks: `selected-boundary-acquisition.test.mjs` verifies the actual
registered geometry/history sequence; `boundary-acquisition-diagnostics.test.mjs`
checks the serialized observer, unchanged-transform/removal detection,
non-consuming input, lifecycle disposal, absence of intermediate diagnostic
browser calls, transparent operation values/errors, single final dump and owned
cleanup on diagnostic failure.
