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
truncation is explicit. Hosted results for the reviewed diagnostic are recorded
below; passing captures do not resolve the original failure.

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

## Teardown-trace result and the final bounded experiment

The `a4f27411` teardown checkpoint completed all six diagnostic cases with no
cleanup remainder: three full-page source screenshots and three viewport-only
controls. Its verified artifact archive SHA256 is
`e2f01c20f7fe95d1ee75ac76ab5660a15947561b754c958d91e41c9f2cc29b80`.
The caller/event evidence is in
`boundary-acquisition-diagnostics/repeat-{1..6}-final.json`.

All three full-page source captures emitted a window resize; none of the three
viewport-only source captures did. Recorded dimensions were unchanged before,
at and after the event: window inner1800×1200, outer780×580, document1800×1200,
canvas1800×1152. Neither cohort lost its acquired handle. Each case recorded the
same three kinds of teardown: an earlier selection mousedown, crossing the label
during approach, and finally `startConnect` after the real port mousedown.
The first two removed older handles, not the final acquired control. No final
control disappeared before its press.

The current Modeler source hash is `12c623f18a60d6a7d5e3ef4191a1f3ea44fd9b2d101ec0f45a7de0be85866da1`.
The historical201214 source and unchanged-product70edde use
`eb25d90839897339029fe4be9d44b0343d6bb2c67660d38fc261431afb293d64`.
They are not byte-identical: D20 adds advertised-corner origin tracking. Its
separate native8 and manual replay passed; that scoped validation does not
explain F23. Unchanged-product70edde also passed its six diagnostic cases.
The original201214 PR pass versus PUSH failure remains the historical result.

A registered-event probe replayed the acquired Boundary control and delivered
unchanged-size window/Viewer ResizeObserver notifications through three queued
frame cycles. No later viewport notification appeared; the handle, marker,
grab, XML, history, selection and camera stayed exact. The subsequent connection
and three Undo/Redo cycles passed. This is a structural negative for the proposed
resize-to-late-fit path after a touched viewport, not a native browser-capture
reproduction.

There is one narrower unresolved clue: during the earlier, pre-acquisition
full-page `before.png`, unchanged-product70edde recorded a native SVG
pointerleave with `relatedTarget:null` at stationary client(1530,1027.2), inside
the viewport. It followed screenshot start by1.6–2.4ms, without a new pointer
move or selection. However, the previous wheel event was only55.8–95.4ms earlier.
That pending/recent-wheel lifecycle is a material confound. No live grab existed
there, and this does not establish capture-only causality or explain the later
source-control disappearance.

The final separate entrypoint is
`node test/modeling/browser-boundary-stationary-exit.mjs`. It has exactly three
fresh Booking lifecycles, with no retry loop or repeated capture: one full-page
capture, one viewport-only capture, and one real pointer move above the canvas
as a genuine-exit control. Ordinary middle-button pan and the visible Boundary
source control must acquire a live grab at integer client(1530,1027). This is a
deliberately repositioned setup, not an exact replay of the original lifecycle.
Its wheel-age interval is recorded and may differ substantially from55.8–95.4ms.
No forced pointer event, model mutation or camera setter is used.

If visible setup cannot reach that region, the case fails as an explicit evidence
limit. Stationary captures must preserve the exact displayed marker/grab,
selection/camera and complete XML/history, then connect from that same control
and preserve full-model/history invariants. Genuine exit must clear the control
without a model/history change. Caller traces use the existing diagnostic-only
served transform; shipped product and original uninstrumented F23 acceptance
remain unchanged. Evidence is saved under
`test-artifacts/boundary-stationary-exit`, including `case-{1..3}-final.json`.

Stopping rule: classify only an actually observed native exit/removal and its
caller. If this bounded cohort does not reproduce the historical lifecycle,
record the negative result and its wheel-age limit; do not launch undirected
repeats or infer a product fix from passing cases. Preserve the original failure
and the smallest diagnostic companion for any recurrence. The original
screenshots/state did not record the event that removed the grab, so they cannot
uniquely identify a destroy branch or stale notification.


## Final three-case outcome and retained risk

At published `56538c92389df54f42f80eeead1e91613a34c2ae`, all three declared
stationary/exit cases passed. Verified artifact 11230582076 has archive SHA256
`ac42b3bb0c7e2263166939b6af9f3d531d2017cb9414258e095a1a6daca523cb`.
The final traces are `boundary-stationary-exit/case-{1..3}-final.json`.
No records were dropped and no diagnostic callback error was recorded. Their
Modeler source hash matches the D20 source above; served diagnostic hash is
`59f41af825323634024a6835113ed77062ea601e8b38ea459dc2ad0169817422`.
The artifact records CI checkout head `21b60a604427025388eecf63477076db282f8db2`;
that checkout identity is distinct from the published checkpoint SHA.

All three setups delivered the actual native pan from `(270,221)` to `(666,533)`
and reacquired the visible selected Boundary grab at `(1530,1027)`. The resulting
viewport was `{x:953.6760518360127,y:670.229033698398,zoom:0.8788735989262744}`.
The exact marker remained `(678.3370087109132,315.18639520580945)` and the exact
painted grab remained `(655.6204680086178,350.88780013241137)`. The deliberately
added pan changes the camera from the original failure; the native input and
recorded camera match the declared diagnostic setup.

- Full-page source capture emitted one trusted window resize at unchanged
  inner 1800×1200, outer 780×580, document 1800×1200 and canvas 1800×1152. Handle 44
  retained its identity, marker and grab until the actual source press. Its
  removal caller was `startConnect`, after mousedown at `(1530,1027)`
- Viewport-only source capture emitted no resize. It retained the same acquired
  handle, marker and grab; `startConnect` removed it after the actual source press
- Genuine exit delivered `(1530,24)` above the canvas. Native SVG pointerleave
  named the toolbar as related target, then `onHoverLeave` removed handle 44.
  Complete model/history, selection and camera stayed unchanged

Neither critical source capture produced a pointerleave, blur, selection or
viewport notification. Setup removals belonged to older handles 6, 18, 27 and 34;
they occurred during selection, label crossing, moving to the pan start and
reacquisition. They do not represent loss of the final acquired handle 44.

The actual wheel ages at acquisition were 1163.55–1166.11ms for full-page,
1176.62–1178.66ms for viewport-only and1141.27–1143.43ms for genuine exit.
These bounds are materially later than the earlier 55.8–95.4ms pre-acquisition
capture/leave clue. Thus this result does not test that recent-wheel lifecycle
with a live handle, and it does not establish capture-only causality.

Two later-phase limitations must remain explicit. First, final-evidence
full-page screenshots in the two connection cases temporarily recorded window
inner 1×1, then 1800×1200, after the successful source gesture and history checks.
The acquired control was already absent. Browser captures can therefore perturb
dimensions; the unchanged-dimensions finding above applies only to the critical
source captures. The later resize is not evidence of the historical missing
handle's cause.

Second, the deliberate pan placed CancelBooking beneath the minimap. The later
drag crossed onto its rectangle at approximately `(1588.99,1058.50)` and delivered
mouseup on that rectangle at `(1647,1089)`. The intended FlightTimeout→CancelBooking
flow, exact source anchor, full-model checks and Undo/Redo passed. This validates
the diagnostic's source activation and semantic/history checks; it does not
certify an unobstructed visible-target drop. That overlap happens after the
critical source capture and press, so it does not invalidate their comparison.

The historical 201214 pre-down disappearance was not reproduced. Its removal
caller remains unknown, and the original evidence cannot distinguish a stale
notification, capture-related lifecycle or another event. The practical residual
risk is the observed loss of the source affordance followed by unintended
transaction movement at the same pointer coordinate. Its frequency and current
reproducibility are unknown. F23 remains an unresolved known finding, not a
completed defect or an active speculative source repair.

The agreed stopping rule now applies: stop isolated repetitions and speculative
changes. Keep the original strict, uninstrumented F23 case in normal acceptance
and preserve the optional test-only teardown companion for a future observed
recurrence. The companion can identify a caller only if that recurrence happens
inside its instrumented run; its timing cost cannot be ignored. No additional
experiment or product patch is justified by these negative results.

The current manually checked preview is site `ad787`, running library `def0baf`.
The later `56538c9` changes are diagnostic tests and evidence documentation; they
do not add a production fix for F23. Exact-head CI is tracked separately. Neither
these diagnostic passes nor the preview's other checks imply general BPMN
interaction completion or resolution of the historical finding.
