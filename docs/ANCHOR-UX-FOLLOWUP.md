# Remaining anchor interaction execution plan

Prepared 2026-10-02 in isolated `followup-current`. The reviewed cases will be
integrated onto the latest source before hosted execution; this working tree
was used to prepare the first native run. **All 62 variants across 22 workflow
IDs executed on `7ed11cfe`: 38 passed, 24 failed, none was blocked.** See the
[exact first-run report](ANCHOR-UX-FIRST-EXPANDED-RUN.md) for outcomes and confirmed
defects. This matrix describes intended acceptance, not a completion claim. This file
adds execution order and result slots to [ANCHOR-UX-CASES.md](ANCHOR-UX-CASES.md);
it does not claim that its open rows are covered.

## Execution gate and method

The first native runs have already corrected shared wheel setup, trapped
background clicks, target-stack attribution, integer delivered source points
and the reference context/snapping expectations. The existing 39-case anchor and 24-case ownership runners remain separate
regression gates.
The copied factory is protected by an exact extraction guard.

Execute nine independent jobs: A-local (11), A-reference (1), three disjoint
B-local shards (9/8/8), three B-reference shards (7/7/7), and C-local (4).
Each job has a distinct artifact directory. Setup, the 90-second action,
evidence capture and owned cleanup have explicit lifecycle bounds. A timeout
remains a failure even if the action finishes during cleanup. If safe teardown
cannot be established, remaining cases are recorded as blocked and the job
fails; they cannot be counted as executed or passed.

The passive reference adapter has nine actual installed-service probe groups;
this is structural evidence, not native acceptance. Its detached pre-command
route uses the complete BPMN snapping/grid/layout/cropping chain. Reference
Message→Sequence conversion creates a fresh unnamed flow, while the local
contract preserves the existing identity/metadata. Only explicitly measured
reference Undo effects may be allowed: the affected reference array's append
order and a previously absent label DI containing the original displayed label
bounds. All other semantics, references, metadata and plane order remain exact.

All starting states come from visible sample selection, palette creation,
ordinary editing or an actual visible import control. No test-side model API
mutation, injected XML, synthetic pointer events or viewport setters. Read-only
DOM, model and exported-XML observations are allowed. Use the existing local demo
and the pinned reference comparison page. Where the reference has a different
affordance, perform its visible equivalent and record the difference rather than
pretending that a local perimeter port exists there.

Each independent action starts from a fresh named state. Longer repeat/cancel
sequences intentionally retain state and record every intermediate checkpoint.
One failing group must not stop the rest. A setup or activation failure is a
failure or a stated blocker, never a successful no-op.

For every committed gesture, collect the shown control, trusted press/move/
release, delivered coordinates and current SVG transform, positive preview,
painted result, exported XML, independent refs/ownership/DI and history. Keep
the exact local Undo/Redo/cancel contract and a full unrelated-model guard.
Reference normalization exceptions require a separately measured, operation-
specific expectation. Never sort whole documents or discard refs/DI to compare.

## Batch A: ordinary editing and semantic ownership

These are the first follow-up cases. They extend common user sequences before
less frequent interruption combinations.

| Execution ID / matrix row | Visible starting state and sequence | Required result and reference decision | Result |
| --- | --- | --- | --- |
| F17-M / AX-17 | Select **Order, payment and delivery**. Select `OrderMessage`; grab its target endpoint and drop on the left non-midpoint of `ReceiveDelivery` in the source pool. Undo/Redo. In a fresh state, drop the target on `FulfillmentFork` across pools, then make a valid reconnect | Measure the native reference's MessageFlow→SequenceFlow conversion. Verify exact source/target, new `BuyerProcess` ownership, collaboration removal, inverse refs, marker and chosen docking. The cross-pool gateway is the proposed rejection case and must be confirmed on the actual reference. Rejection preserves XML, history and the next action | First run recorded in linked report |
| F17-D / AX-17 | In Order, use the visible **Data object** palette to place an item inside the Seller pool near `ValidateOrder`. Connect it to that activity. Reconnect the association's activity endpoint to `PackOrder`; separately reconnect its data endpoint to a second palette-created data object | Observe the complete `sourceRef` array, target item and owning activity. Match actual native reference ownership/placeholder policy, including one owned Property for a fresh activity input where applicable. Remove only obsolete fresh placeholders; preserve unrelated/authored IO. Verify both endpoint directions, inverse graph binding, exact Undo/Redo and independent reopen. Do not flatten an array into one ID | First run recorded in linked report; data control activation must be measured |
| F18-B / AX-18 | In Approval, select the existing multi-segment `ReworkFlow`. Hover its visible interior bend, drag it to a clear nearby point, then Undo. Repeat via unselected hover, with a different edge initially selected | The visible bend's owner/index identifies the actual edited route. Preview and final geometry agree; opposite endpoints, semantic refs and unrelated bends/content stay fixed unless measured reference docking requires a specific terminal adjustment. No new source connection or edit of the previously selected edge | First run recorded in linked report |
| F18-S / AX-18 | Reload Approval. Drag a visible interior segment of `ReworkFlow` perpendicular to itself, once selected and once via hover | Actual segment movement, coherent end legs and preserved manual route outside the edited neighborhood. Compare the actual reference segment command, not an expected result inferred from the local helper. Exact cancel/Undo retains original fractions | First run recorded in linked report |
| F21-E / AX-21 | In Approval, select the **line** of named `ApproveFlow`, press Delete, Undo/Redo twice; select and edit a different surviving edge | Remove the edge, its external label graphic, its DI and inverse refs. Preserve its condition and every metadata value on Undo. No stale hover handle or dangling semantic ref. Explicitly distinguish line deletion from selecting the label itself | First run recorded in linked report |
| F21-N / AX-21 | Reload Approval. Select the body of `ReworkRequest`, Delete, then Undo/Redo twice | The node and exactly its incident `RejectFlow`/`ReworkFlow` closure are removed; the gateway's default ref is cleaned appropriately. Unrelated branches survive. Whole-model guard, restored label/DI contents and exact local history; measure any reference ordering difference before permitting it | First run recorded in linked report |
| F22 / AX-22 | Blank: create Start, Task A, Task B and End through the palette. Connect Start→A, then approach A's next source point without leaving its body; connect A→B and B→End. Reconnect A's edge, Undo, select B and create from a different side | Each shown port, preview and committed source follows the current intended owner. Record whether the immediate target-to-source continuation works without a leave/re-enter workaround; this directly revisits observed E5. No duplicate history or remembered source from another node | First run recorded in linked report |
| F25 / AX-25 | In Conditional, expose a source control, wheel-zoom and pan natively, then approach the same graph-side choice and connect. Separately select an edge, zoom, then redock its target | Use 0.5 zoom for the source variant and 1.5 for the selected endpoint variant. Marker/grab/endpoint remain current, visible and hittable; radius reflects current zoom, and delivered input maps through the current transform. Viewport-only actions do not change XML/history | First run recorded in linked report |

## Batch B: overlap and remaining shape/selection pairs

Use these fixed pairs instead of every side × shape × selection × zoom
combination. Keep each independent action isolated so an early failure does not
hide later shape coverage.

| Execution ID / matrix row | Visible starting state and sequence | Required result and reference decision | Result |
| --- | --- | --- | --- |
| F23-B / AX-23, AX-13 | In Booking, select `FlightTimeout`, approach its unobstructed lower outline, and start toward `CancelBooking`. Reload, approach the boundary/host/flow overlap point and inspect the actual hit before acting | Preserve `attachedToRef`, PT1H timer and transaction ownership. Record the actual overlapping hit owner in both engines; do not assume the event wins over a flow. The intended visible control must remain reachable through an explained path. A wrong-owner action cannot count as successful docking | First run recorded in linked report |
| F23-T / AX-23, AX-29 | In a blank diagram, create two tasks and a connection. Use native task movement to place a task boundary near the existing endpoint/segment; select the task and approach the coincident side midpoint. Then use the original resize/edge control separately | Exact docking marker plus a reachable tethered grab where controls collide; the pre-existing editing control remains usable. Capture which element actually receives the press. A fallback to another origin side is not acceptable | First run recorded in linked report; overlap must be made through visible edits |
| F09 / AX-09 | Blank palette: selected Task into End at an off-center left arc; then Start top into a task after deselection | Circle contact equals the visible outline and chosen delivered position. Include offset grab at small zoom and ordinary event-body movement as a control. Reopen preserves the exact event/task refs and DI | First run recorded in linked report; complements first-run source-event cases |
| F10 / AX-10 | Approval: selected `ApprovalDecision` from its left side toward `ReworkRequest`; reload and connect an unselected task into the gateway's bottom side | Diamond contact and requested side remain clear. Preserve existing condition/default branch semantics. Measure actual reference legality before declaring a rejected branch a geometry failure | First run recorded in linked report |
| F11 / AX-11 | Order: select `Payment`, use its visible collapse control, then connect from its left side. Undo; expand through the visible control and target the subprocess outline near a visible child | Correct subprocess versus child hit, process ownership and hidden-plane preservation. Capture existing UI behavior if collapsing is unavailable. No synthetic collapse or drilled API setup | First run recorded in linked report |
| F12 / AX-12 | Order: selected `ShipOrder` into the opposite `BuyerPool` boundary; separately use the existing expanded pool as source at a non-midpoint | Verify MessageFlow, collaboration ownership, source/target semantics and marker. Black-box participant coverage remains pending unless an existing visible control can prepare that state | First run recorded in linked report |
| F02-03 / AX-02, AX-03 | Blank tasks: choose a rounded corner and target non-midpoint; reload with source below target, start bottom and drop top | Measure actual curved outline rather than a bounding-box corner. The backward-side path remains readable outside both shapes. Preserve exact intended origin and target in DI and reopen | First run recorded in linked report; corner oracle must be independent |
| F05 / AX-05, AX-06 | Use the visible Connect path for an activated Task loop; inspect it, move its owner and delete/Undo. In fresh states try self-connection on Start, End, Gateway and Participant | Preserve deliberate valid Task loops; no degenerate hidden edge. Structural reference evidence predicts rejection for Start/End/Participant and allows ExclusiveGateway, but each native path must confirm it. Invalid cases are exact no-ops and the next valid action works | First run recorded in linked report; exact gateway type recorded |
| F15-16 / AX-15, AX-16, AX-20 | Conditional: hover an unselected edge with another edge selected, reconnect its source. Separately reconnect target back to the source, then test background rejection and positively activated Escape | Correct edge ownership through selection changes; chosen edited endpoint, fixed opposite endpoint and full refs/DI. Deliberate self-reconnect is judged against measured rules. Invalid/cancelled actions preserve the exact original document/history | First run recorded in linked report |
| F29 / AX-29, AX-14 | Select a connected task and use a different resize corner; separately resize an expanded subprocess beside an attached boundary event | The intended resize control wins over the port. Record supported task-resize extension separately from upstream. Check affected route ends, unchanged remote docking, attached boundary/label geometry and exact local rollback | First run recorded in linked report |

## Batch C: bounded interruption and reachability

| Execution ID / matrix row | Visible starting state and sequence | Required result and reference decision | Result |
| --- | --- | --- | --- |
| F26-O / AX-26 | Activate a connection preview, move out of the canvas into the page toolbar and release. Re-enter and make an ordinary valid connection | Actual activation is recorded before leaving. No stuck drag, edge, ghost control or history on the outside release; next action uses the intended owner. No operating-system blur or synthetic mouseup substitute | First run recorded in linked report |
| F26-R / AX-26 | Use an advertised click-to-arm Connect action, then choose another sample through the visible selector; afterward create normally in the new diagram | Record whether UI intentionally blocks the selector or cancels the preview. A successful load replaces the graph once and resets its history; the old preview cannot commit into it. If import interruption is not exposed by the local demo, retain that subcase as unrun rather than inject importXML | First run recorded in linked report |
| F27 / AX-27 | Pan natively until a selected source's desired outline point is close to a canvas edge; inspect marker/tether/grab, attempt the ordinary action, then repeat after a deliberate pan that brings it fully into view | Check clipping and actual hit reachability independently. An outward grab may leave the SVG; do not silently move the chosen anchor or treat the subsequent recovery as proof the initial control was usable. Record available pan/auto-pan behavior and exact camera-versus-DI changes. Compare reference where its visible affordance exists | First run recorded in linked report; explicit usability risk |
| F28 / AX-28 | In a small explicit comparison page with two normally mounted local editors and separate visible sample/Undo controls, create and cancel in A, connect in B, Undo in A, then continue in B | Both instances' XML, selection, preview, viewport and history remain independent. All fixture selection and edits use their visible UI. This requires test-page setup after the first runner stabilizes; two tabs alone do not establish same-document isolation | First run recorded in linked report; two-instance page prepared; native execution pending |

## Evidence slots and stop conditions

For each execution ID above, add a result record containing:

- Exact source/site revision, engine/version, sample and native group ID
- Setup completed, visible control hit, activation observed, chosen and delivered coordinates
- Before/preview/after screenshots; before/after XML; independent semantic/DI diff
- Expected scope of changed fields, exact Undo/Redo/cancel observations and next-action result
- Native reference result or a clearly named unresolved policy
- Outcome: passed, product defect, harness defect, blocked or not executed; artifact names and regression ID

A first-run helper failure pauses only the dependent follow-up cases. Unaffected
planning and independent manual exploration may continue. No local browser
launch workaround is part of this plan. Do not call a batch complete until all
its planned variants have an executed result or an explicit remaining blocker.
Do not infer full anchor acceptance from either the green39 cases or one of
these batches alone.

## Confirmed findings awaiting repair

- D14: resizing the Booking transaction from northwest translates its children
  and internal routes locally. The complete pinned reference preserves those
  absolute coordinates. F29 now requires the exact reference policy and will
  remain a failure until the source repair is verified
- D15: a selected node's chosen outline can remain visible while the displaced
  Connect grab lies outside the canvas. Manual preview QA reproduced a resize
  when trying to use that visible midpoint. F27 retains the reachability check;
  viewport-aware placement is a separate source repair
- The preliminary overlap inspection in F23-B records the actual trusted native
  receiver as diagnostic evidence. Its exact paired ownership baseline remains
  unresolved. Passing the subsequent strict boundary-source workflow does not
  close that overlap-policy question

The integration preserves the stronger published `1d3fe967` ownership24 tangent
checks byte-for-byte. These follow-ups do not replace the existing 39 anchor,
24 ownership, 29 hit or other regression gates. The first expanded hosted outcomes are recorded in the linked report; all
failed or diagnostic-only acceptance points remain open until reverified.
