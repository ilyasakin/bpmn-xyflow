# Expanded native interaction run: 2026-10-02

Exact library revision: `7ed11cfe93a1077ec244d5ac36da0574a232c735`.
[Hosted CI evidence](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36968562027)
contains nine separately uploaded native workflow artifacts. Every one of the
62 variants was attempted: 38 passed, 24 failed, none was blocked. The retained
39 anchor, 24 ownership, 29 hit and earlier regression gates passed separately.
Those smaller green gates do not certify the newly failing workflows.

## Findings and current disposition

- D14, confirmed source defect: northwest expansion of a transaction translates
  child shapes/internal routes. Pinned reference preserves their absolute
  coordinates. F29 deliberately asserts the stricter measured behavior
- D15, confirmed by independent manual preview QA: a source outline remains
  visible while its displaced grab clips outside the canvas. Dragging the
  visible midpoint can resize instead. F27 first stopped on a fractional-pan
  setup error; its corrected setup must still reach this real acceptance check
- D16, confirmed source event-order defect: an acquired source grab disappears
  while approaching it across an existing route, because edge-hover controls
  claim input first. Both F23-T variants exposed the repeated approach
- D17, confirmed source geometry defect: a valid gateway loop with chosen
  right/lower-left diamond anchors is rejected by rectangular self-obstruction
  checks. The narrow actual-outline repair is independently reviewed locally;
  its native F05 gate remains pending on the corrected revision
- Harness corrections must remain separate from source fixes. Recorded setup
  problems include repeated reference edge clicks toggling selection off, a
  source midpoint occupied by an incoming edge, a task-center click occupied by
  a message flow, and fractional residual pan quantized to zero movement
- Seven reference paint comparisons used the rounded public viewbox transform
  instead of the actual SVG CTM. The correction retains tight endpoint checks
  using the measured transform; it does not increase geometry tolerances
- Other reference history, popup and invalid-target preview expectations remain
  under exact-input/XML investigation. No broad normalization or alternate
  success outcome is accepted solely to make a test pass
- F23-B's preliminary overlap receiver inspection is explicitly diagnostic and
  remains unbaselined. Passing its later boundary-source operation does not
  certify that separate hit-policy question

## Reviewed corrections awaiting native rerun

The next checkpoint keeps tight paint/DI checks using the actual SVG CTM and
operation-specific reference ordering expectations. It also corrects native
selection/setup and captures F10's reference drag context before its strict
creation assertion. The recorded F23-B overlap hover receiver is now explicitly
asserted as `TimeoutFlow` in both engines, using delivered pointer coordinates;
this is a hover ownership check, not an unperformed selection claim. Source
repairs D15/D16/D17 have passed independent local review. None of these local
results changes the historical outcomes below or certifies the next native run.

## Per-variant outcome

These are the first-run results, not results of later corrections. A failed
setup is recorded as failed, even when the intended product operation did not
run. The linked artifacts retain screenshots, trusted input, XML and per-phase
results for diagnosis.

| Case | Engine | Visible workflow | First run |
| --- | --- | --- | --- |
| F02-03 | local | below-target-bottom-to-top-exterior-route | passed |
| F02-03 | local | rounded-painted-corner-to-nonmidpoint | passed |
| F02-03 | upstream | rounded-painted-corner-to-nonmidpoint | passed |
| F05 | local | end-self-connection-policy | passed |
| F05 | upstream | end-self-connection-policy | passed |
| F05 | local | gateway-self-connection-policy | failed |
| F05 | upstream | gateway-self-connection-policy | passed |
| F05 | local | participant-self-connection-policy | failed |
| F05 | upstream | participant-self-connection-policy | failed |
| F05 | local | start-self-connection-policy | passed |
| F05 | upstream | start-self-connection-policy | passed |
| F05 | local | task-self-connection-policy | passed |
| F05 | upstream | task-self-connection-policy | failed |
| F09 | local | deselected-start-top | passed |
| F09 | upstream | deselected-start-top | failed |
| F09 | local | selected-task-to-end | passed |
| F09 | upstream | selected-task-to-end | failed |
| F10 | local | selected-gateway-left | passed |
| F10 | upstream | selected-gateway-left | failed |
| F10 | local | task-to-gateway-bottom | passed |
| F10 | upstream | task-to-gateway-bottom | failed |
| F11 | local | collapsed-left-source | passed |
| F11 | upstream | collapsed-left-source | failed |
| F11 | local | expanded-outline-target | passed |
| F11 | upstream | expanded-outline-target | failed |
| F12 | local | pool-nonmidpoint-source | passed |
| F12 | upstream | pool-nonmidpoint-source | failed |
| F12 | local | selected-task-to-pool | failed |
| F12 | upstream | selected-task-to-pool | failed |
| F15-16 | local | activated-escape | passed |
| F15-16 | upstream | activated-escape | passed |
| F15-16 | local | background-rejection | passed |
| F15-16 | upstream | background-rejection | failed |
| F15-16 | local | hovered-source-other-selection | passed |
| F15-16 | upstream | hovered-source-other-selection | passed |
| F15-16 | local | target-to-source-loop | passed |
| F15-16 | upstream | target-to-source-loop | passed |
| F17-D | local | data-source-and-owner-reconnect | passed |
| F17-M | local | message-conversion-and-rejection | passed |
| F17-M | upstream | message-conversion-and-rejection | failed |
| F18-B | local | bend-other-selected-hover | passed |
| F18-B | local | bend-selected | passed |
| F18-S | local | segment-other-selected-hover | passed |
| F18-S | local | segment-selected | passed |
| F21-E | local | delete-edge-with-label | passed |
| F21-N | local | delete-node-with-label | passed |
| F22 | local | immediate-next-source-and-repeat | passed |
| F23-B | local | boundary-host-flow-hit-and-reachable-origin | passed |
| F23-B | upstream | boundary-host-flow-hit-and-reachable-origin | failed |
| F23-B | local | selected-boundary-lower-origin | passed |
| F23-B | upstream | selected-boundary-lower-origin | failed |
| F23-T | local | moved-task-exact-midpoint-endpoint-priority | failed |
| F23-T | local | moved-task-exact-midpoint-resize-priority | failed |
| F25 | local | viewport-refresh-endpoint | passed |
| F25 | local | viewport-refresh-source | failed |
| F26-O | local | activated-release-outside-canvas | passed |
| F26-R | local | sample-switch-after-click-to-arm | failed |
| F27 | local | selected-source-at-canvas-edge-and-pan-recovery | failed |
| F28 | local | two-editors-cancel-create-and-independent-history | passed |
| F29 | local | connected-task-northwest-resize | passed |
| F29 | local | expanded-transaction-resize-attached-boundary | failed |
| F29 | upstream | expanded-transaction-resize-attached-boundary | failed |
