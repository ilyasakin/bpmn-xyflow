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

## Diagnostic gate: teardown caller and screenshot control

Run `node test/modeling/browser-boundary-acquisition.mjs` through the existing
owned browser-suite runner. It executes six fresh whole-case lifecycles of F23-B
`selected-boundary-lower-origin`, alternating three original full-page source
screenshots and three viewport-only source screenshots. Only the latter cohort's
`-source-control.png` capture has `fullPage:false`; every other capture, gesture,
assertion and original error remains unchanged. The actual requested/effective
options and cohort are recorded. These are diagnostic comparisons. The original
uninstrumented F23 workflow remains the acceptance control.

The dedicated test server has the same routes, plugins, root and startup behavior
as the normal demo server, with one added Vite transform. That transform matches
the unique three-removal statement in `destroyConnectHandle`. Immediately after
those original removals and before the original variable resets, served code
records the actual caller stack, removed DOM identity, former owner, anchor, grab
and acquisition flags. It introduces no await, hit/layout query, modeling command
or changed product decision. A callback failure is caught so the original resets
still execute; its error is retained, dumped, and fails the diagnostic gate.
Missing trace activation also fails rather than producing a vacuous success.
No file under `lib` is edited, and the original and transformed source hashes
are recorded dynamically, including when the test is applied to a newer product.

There is one explicit extracted-factory exception: `anchor-ux-browser.mjs` now
accepts a server entry restricted to its existing default or the diagnostic
server. The retained ownership startup check normalizes only that server-entry token.
A separate byte-normalization contract verifies that its remaining startup,
cleanup, gesture and assertion code is unchanged. The original native39 file is
byte-identical. The ownership24 and F11 workflows are unaffected.

## Observation and timing limits

The browser observer is installed once. During the workflow it records native
event targets, DOM attributes/identity, selection/history and public viewport
notifications. It reuses the matrix already recorded by the original capture-
phase input observer. It performs no additional `getScreenCTM`,
`getBoundingClientRect`, `elementFromPoint` or computed-style reads in critical
event/microtask/mutation callbacks. Fresh CTM and hit observations are reserved
for the final dump. The original factory's pre-handler CTM reads are unchanged.

Initial window dimensions are sampled at installation. Native resize callbacks
record window inner/outer dimensions; a passive ResizeObserver retains the
provided document/container content and border-box sizes without querying
layout. Other snapshots use the latest recorded dimensions, explicitly allowing
observer delivery to lag a native resize. This can reveal a dimension transition;
a resize event alone does not prove that a dimension changed.

The driver records phase timestamps in Node only. It inserts no diagnostic
browser evaluation, artifact dump or settling wait between original calls.
One final browser read runs during owned cleanup after normal workflow evidence.
Its JSON contains the Node phases, browser time origin/installation timestamp,
Git head, committed `lib` tree, modified source paths and hashes. The installation
envelope bounds clock alignment without another synchronization call. Cleanup
runs on dump failure; repeat cleanup does not repeat the dump. Passive callbacks
and the post-removal stack trace still cost time, so passing repeats cannot prove
the original race fixed.

Evidence is under `test-artifacts/boundary-acquisition-diagnostics`, including
one final trace per repeat and the ordinary screenshots/XML/results. Record-limit
truncation is explicit. No hosted result is claimed for this new diagnostic.

## Earlier diagnostic evidence: cause still unresolved

At `a0108a7`, all six workflows passed with the first driver. Every acquired grab
retained its DOM identity through mousedown. No same-value viewport notification,
blur, pointerleave or selection change occurred during acquisition-to-press.
Every source screenshot coincided with a native window resize while the handle
remained intact. Arrival-to-press took 202–210 ms; the old JSON dump added 35–43 ms
before the next original evaluation. Additional awaited browser phase calls
could also mask a race, motivating the reduced driver.

On unchanged product `70edde9`, all six reduced-driver cases passed. Arrival-to-
press was 116.6–133.8 ms. A window resize occurred 8.8–11.8 ms after each source
screenshot began, without a handle removal or other critical lifecycle change.
The output PNGs are 1800×1200 and the surrounding canvas is 1800×1152 at y48,
but event-time window dimensions were not recorded. Installed Puppeteer24.43
uses `captureBeyondViewport:true` for these full-page captures and does not call
`setViewport` in that branch. Thus neither the event nor the PNG proves a
transient size change. The separate D20 `def0baf` cohort also passed six cases
with intact handles. It does not explain the older Boundary failure.

Those reduced snapshots still read CTM and hit geometry after product handlers.
The present capture removes those extra critical reads and records the actual
teardown caller, with the declared screenshot control. The original201214
failure remains open until evidence establishes its cause.

Focused checks: `selected-boundary-acquisition.test.mjs` retains the actual
registered geometry/history replay. `boundary-acquisition-diagnostics.test.mjs`
checks passive ownership, cached geometry, dimensions, driver transparency,
cohorts, final dump and failure visibility. `boundary-teardown-transform.test.mjs`
checks the exact insertion boundary, original reset semantics despite callback
failure, route/plugin parity, restricted server entry and unchanged acceptance
workflow bytes.
