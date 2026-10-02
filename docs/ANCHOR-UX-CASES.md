# Anchor interaction acceptance matrix

Prepared 2026-10-02, before new implementation assertions. This review is reopened
by user feedback about right-only origins and returning a connection to its own
anchor. Earlier green suites establish only their recorded cases; they do not
close these newly identified interaction risks.

The reviewed repository is `0a3ff2ec66bc1a0edba35b20fd1fae720d80bd00`. Current
exploration uses site `99e608a` with runtime library `5a994b6`. The comparison
reference is pinned bpmn-js 18.30.1. A reference result must come from its actual
interactive path; a rules return value alone does not establish what a user sees.

## First hosted execution: 2026-10-02

Revision `57fa5a80f70da7b621a0263a074a96afa6d9129c` executed the first 38
native cases in [run 36956495907](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/36956495907).
Six cases passed and 32 failed. This is an incomplete, failing acceptance run;
it does not establish that the reopened defects are fixed.

- Passed: AX-11/12 business-shape cases, AX-14 fresh circle target resize,
  AX-15/16 source/target redocking, and AX-24 at the higher zoom setting
- Many cases stopped during native zoom setup, and the reference cases stopped
  on the blank-diagram history premise. Their intended workflows were not reached
- Separate failures require diagnosis: AX-04 chosen marker position, AX-09/10
  target hit, AX-13 boundary source-control availability, AX-14 circle docking
  after task movement, and AX-19 fractional segment editing
- The recorded failure remains authoritative until its cause is demonstrated
  from input traces, actual DOM/geometry and independent reference behavior.
  A failed setup is not evidence that its intended product behavior passed
- Follow-up workflow modules are prepared separately and have not run. The
  shared site preview still uses the earlier runtime at this checkpoint

Initial diagnosis (not a successful rerun): the 12-event setup limit cannot
reach the requested zoom from the initial zoom 4; 21 cases stop there. Five
reference cases encounter pending native click traps during blank-canvas
selection clearing. AX-19 produced a valid three-point orthogonal route because
the delivered drag row remains within the task's rounded lower corner; requiring
four points was incorrect. The AX-14 movement reduces the facing gap from 23 to 9;
a full-service reference probe yields the same top/top reroute with endpoints on
the actual outlines. A separate wider-gap movement check must retain coverage of
the previously observed off-circle docking defect. Two additional product defects are independently reproduced from the hosted
input traces and registered-handler replay:

| Defect | Visible failure | Cause and acceptance requirement | Status |
| --- | --- | --- | --- |
| D5 / AX-04 | After jitter, returning along the outline leaves the marker at the earlier point; fine movement advances in roughly 8 px jumps | Unpressed coincident ports are held by their own transparent hit disc. They must keep following the outline; displaced grabs and active drags must remain stable | Confirmed; correction pending native rerun |
| D6 / AX-13 | A named timer boundary event loses its connection affordance along part of its ring | Its external label's invisible padded hit rectangle covers the ring and is treated as an ineligible source. Preserve actual label text editing and provide a reachable ring origin | Confirmed; correction pending native rerun |

The retained browser suites also failed eight connection-creation variants and
one hover-control case on this revision. The backward-source cases still
approached the shape center while expecting a fixed right port; their setup must
choose the now-visible intended perimeter point. The Shift-create failures identify an input arbitration regression: capture
handling treats the new source hit circle as empty canvas and starts lasso
before its connection handler receives the press. This requires a source fix
and a native rerun; the separate hover case remains under diagnosis. Other retained suites, source/schema checks,
build, packed consumers and the actual CodeQL alert check passed. These passes
do not override the failing native acceptance.

The follow-up correction is independently reviewed at source and handler level:
fine unpressed coincident-port movement tracks each delivered point, the
boundary owner's outline is accessible through invisible label padding while
label dragging remains intact, and plain/Shift source-control presses both
activate Connect without lasso. Exact Cancel XML is preserved. The corrected
matrix contains 39 cases, retaining all 38 and adding the wider-gap movement
regression. At that freeze, hosted native execution and paired-preview exploratory review
were still pending.

### Second hosted execution

Revision `edc9a168949b76d517368c72932db3ebdff56c34` completes 30 of 39 cases.
The remaining failures are not acceptance passes:

- Five local checks wrongly apply tethered-grab immobility to ordinary
  coincident ports. The recorded native pointer changes from 899 to 898 CSS px;
  at zoom 1.057018 the corresponding marker change is exactly 0.94605765 graph
  units. The revised expectation must follow actual delivered input for a
  coincident port, while retaining exact immobility for a displaced grab
- AX-13 identifies a further source defect: its displaced boundary grab's
  approach crosses its label and enclosing transaction. Owner resolution replaces
  the boundary's affordance before the pointer reaches the grab. An existing
  tether's approach must remain stable without intercepting normal label/body
  presses
- Three upstream context cases require exact reference activation/snapping
  expectations. Zero-motion mousedown does not start Connect; click/native
  dragstart does. Its measured target snapping must be kept separate from local
  explicit pointer docking

The boundary-tether correction is independently verified through every delivered
artifact coordinate, using pointermove followed by mousemove with exact owner,
marker, grab and XML checks. The other eight failed cases now have reviewed
input/reference expectations; their native rerun remains pending.

The WIP paired site `da87e1ce34e4b709ddb93810c1df44e3f3195e71` pins this
`edc9a168` runtime. Its production browser/import checks pass and its deployment
is Ready. Independent manual exploration has verified off-center task origins on
all four sides, selected/unselected examples, immediate continuation from a
just-used destination, stationary/1px-jitter no-op behavior, deliberate visible
loops, and the original clean-process circle movement/resize reproductions.
This is bounded evidence on that exact WIP revision, not broad acceptance; it
does not include the subsequent tether correction. The wider 62 variants across
22 follow-up workflows remain prepared/unrun.

The baseline observations and unexecuted scope below are retained as the original
case specification. Per-case execution evidence is in the run artifact
`bpmn-anchor-ux-evidence`, including `anchor-ux/results.json`, screenshots and
exported XML/DOM captures.

## Additional manual findings and immediate-repeat cases

The independent exploratory pass on site `da87e1ce` / runtime `edc9a168`
identified two ordinary usability defects after the native39 corrections:

- **D9, displaced-origin clarity:** the Booking timer boundary's docking marker
  `(674.7910042188045, 287.77206352435707)` exactly matches its committed
  waypoint. Its separate grab is only 2.563684 CSS px away, so the 5.75 px painted
  grab radius covers the 3 px painted origin-marker radius and short tether.
  This is an obscured indication, not a docking-coordinate error
- **D10, source-click operation takeover:** a stationary click on ReserveFlight's
  top-midpoint source port selects the underlying Task and replaces the same
  pointer position with a resize square. Immediate drag from that position to
  ReserveHotel resizes the Task from 120×80 at (620,220) to 120×22 at (620,278),
  creates no connection, and adds resize history. Off-center immediate retry
  passed, so checking only off-center positions would miss this defect

The bounded ownership regression schedule is defined before its implementation:

| Variant group | Actual input path | Required outcome | Reference/contract | Status |
| --- | --- | --- | --- | --- |
| AX-04-R, eight positions × two states | Build two Tasks through the palette. Start unselected or select the source through the UI. At each side midpoint and each painted rounded corner, approach the visible source grab, stationary-click it, then press again at the current pointer without an intervening move/helper re-entry and drag to the target | The visible source-control intent remains available; no unexpected shape selection, resize or movement takes over. Exact marked origin agrees with preview/DI, target/refs are correct, source bounds unchanged, one connection command, exact Undo/Redo | These perimeter controls are a fork UX extension; test their stated purpose and exclusive tool ownership, not a nonexistent identical upstream control | Prepared, unrun |
| AX-04-R cancellation/selection | Cancel an activated source gesture and immediately retry; separately toggle ordinary body selection before choosing the source control | Cancellation leaves XML/history intact; the next source action remains usable. Ordinary body/Shift selection is preserved | Existing modeler selection and cancellation contract | Prepared, unrun |
| AX-04-R explicit resize | Select the source and deliberately grab its visibly distinct resize control | Resize remains available and changes only intended bounds/routes, with exact Undo | Existing intentional Task-resize extension | Prepared, unrun |
| AX-13-V displaced indication | Hover small events/gateways and source points near labels/selected controls; inspect the origin marker, tether and grab at native scale before connecting | Both origin and grab remain distinguishable; minimum painted separation, unchanged exact origin, stable approach and correct preview/commit | Fork affordance clarity; no change to BPMN docking semantics | Confirmed manual failure; correction in progress |

### Current correction checkpoint

The subsequent library revision `ba29db764a6601531eadb94012c4a01d893c8add`
passes all 39 anchor cases and CodeQL. Its retained run still found two issues:

- **D11, rapid navigation/zoom lifecycle:** child wheel → Back → immediate
  parent wheel reaches the diagram, but the public camera stays at zoom 0.85
  while d3's internal camera changes to 0.6622898927. Recreating the controller on
  the same SVG leaves a live wheel gesture using its old dispatch. Independent
  replay reproduces this within 22 ms. The reviewed correction keeps one
  controller for the lifetime of that SVG; a 19 ms replay now updates the public
  camera exactly around the delivered pointer, without sleeping or retrying
- The retained Booking hover assertion queried a fractional reprojected point
  at an edge's round-cap boundary, while Chromium delivered the neighboring
  integer pixel over the event. Its reviewed correction queries the recorded
  trusted input for both paths and retains exact event-versus-edge-control
  ownership; no target, geometry or tolerance changes

D9's reviewed fix separates an already-displaced grab by at least 12 CSS px,
leaving 3.25 px between the painted circles while retaining collision avoidance
and the exact origin. D10's reviewed fix gives actual source-control presses
ownership of the pointer click and restores the same affordance after an
inactive release. Ordinary Shift-body selection remains unchanged until a
connection actually activates. The separate 24-case native ownership suite
contains 16 current-pointer retry cases and 8 deliberately selected resize-control
cases. They are prepared and independently reviewed, but still unrun at this
checkpoint; the green 39 script is byte-identical.

## Decision and evidence rules

- P0: ordinary creation, chosen endpoints, accidental mutation or unusable history
- P1: common editing, different BPMN shapes, realistic surroundings and repetition
- P2: bounded interruption and less frequent combinations
- **Observed** means the exact native action was executed, with the limited result
  stated. **Partial** means only part of a case was exercised. **Unrun** means no
  result is claimed. **Reported** preserves the user's finding without upgrading
  it to a reproduced defect
- A case passes only after its visible action, geometry, semantic and history
  checks pass. A path that could not be activated is not a pass
- Separate visible source controls, target docking choices, resize handles,
  context-pad Connect, bendpoints and segment controls. A resize square is not a
  source-anchor affordance
- Test a deliberate self-loop separately from releasing on the starting control.
  Do not classify all self-loops as invalid. Resolve the exact pinned behavior,
  semantic connection family and intended product policy first
- For a supported connection, a discoverable pointer action must provide the
  requested origin side/perimeter point. The preview and committed route must
  agree with the choice communicated by the visible control. Where a selected
  resize/edge control occupies the desired point, an outward
  grab handle must visibly tether to the exact on-outline docking marker; the
  original editing control stays usable. Discrete anchors and free-perimeter
  picking have different contracts; record which one the UI actually offers. Do not silently replace this check with an API-created route
- The new anchor UX suite must set up and operate diagrams through visible demo
  selection, palette/create/edit or import controls, using native pointer and
  keyboard input. API access is read-only for evidence; no model mutation or
  synthetic gesture setup. Record input unavailable on a QA surface instead of
  substituting another action

## Capture once per executed case

Record revision, fixture, source/target IDs, selection, zoom/pan, the exact visible
control and input sequence. Capture the visible control before pressing, positive
preview after activation, chosen drop and final result. Record client and graph
coordinates separately when available; compare against the delivered browser
input rather than an ideal coordinate that was never delivered.

For a positive mutation, check the exported connection type, sourceRef/targetRef,
semantic owner, DI endpoints and route, and unrelated content. One completed
operation should create one local history step. Undo restores the original local
XML, coordinates, refs and control state; Redo restores the edited result. A
rejected or cancelled action leaves local XML/history unchanged and the next
ordinary action usable. Hover and selection alone must not mutate either.

For P0 creation and representative event/gateway, pool and subprocess edits,
export and actually reopen the result, checking independent semantic/DI evidence.
A correct-looking line with wrong refs, a zero-length hidden edge or a no-op that
adds history fails. Capture unexplained changes rather than normalizing them
away. Record any measured upstream rounding/history difference separately from
local precision and cancellation requirements.

## First pass: ordinary creation before edge-editing

Each ID is a stable regression ID. The new browser-anchor-ux suite is prepared
from these cases; its syntax check is not native acceptance. `U` means unrun for this reopened matrix. Reference questions R1–R6 are
listed below. H1 is previous hosted evidence, which is not fresh execution here.

| ID / risk | Visible affordance and real action sequence | Expected visible result, semantics and history | Reference expectation | Actual outcome / evidence |
| --- | --- | --- | --- | --- |
| AX-01 / P0 | In a blank diagram with two tasks, hover the source at each of its four sides; select it and repeat. Try to start from the visible connection affordance at the requested side, then drop on the assigned target side below | A usable, discoverable source choice for each requested side; preview and final endpoint agree with that choice and target. No forced right origin or hidden modifier required without explanation. Selected midpoint collisions retain the exact docking marker with a separate tethered grab handle. SequenceFlow refs/owner correct; one step, exact Undo/Redo | R1: compare actual affordance and start route; distinguish an approved UX extension from matching upstream | **Partial mismatch observed E1:** Conditional B top/left/bottom hover exposed only right-midpoint blue control; selection exposed resize handles only. Blank diagram and eight complete variants U |
| AX-02 / P0 | From the chosen side, approach one quarter and three quarters along a task edge, then one rounded corner; release on a target's non-midpoint side | If free perimeter is offered, endpoint follows the chosen outline point; if fixed ports are offered, snapping is visibly indicated. No silent center reset, protruding end or path through the node. Export/reopen keeps the result | R1/R3: exact outline projection and advertised snap policy unresolved | U; user report motivates this case |
| AX-03 / P0 | Place target left of source. Start at source right; drop on target right. Repeat one bottom→top arrangement | Preserve chosen sides with a readable exterior route; no flip to nearer side, no zero-length route, no nonzero segment through either task. Correct refs; exact history | R3: compare complete native routing/docking, not only a layout helper | U; H1 covers earlier docking regressions only |
| AX-04 / P0 | Press then release the visible source control without activation; repeat with a small movement and return to the same control | No accidental invisible/zero-length connection or history entry. Record actual activation and whether return was before or after it; these are separate outcomes | R2: same-port click, threshold jitter and activated return may differ in reference | **Observed failure E2:** stationary port click and 1px diagonal jitter each create a same-node SequenceFlow and history entry. Activated leave-and-return U |
| AX-05 / P0 | Intentionally drag away from a task and return to a different side of the same task; separately repeat same-side return. Then inspect, move and delete any resulting loop | If allowed, visible nonzero loop with source and target refs both intentional, editable endpoints and exact history. If rejected by measured rule/policy, clear rejection and unchanged XML/history. Never call a deliberate valid loop a defect just because IDs match | R2: full reference service allows activated task loops; actual native comparison still required | **Partial E3:** same-node creation observed; distinct-side/reference/complete lifecycle not yet verified |
| AX-06 / P0 | Start a connection, hover blank canvas, then release. Repeat over a disallowed target identified by the reference, and finally make a valid connection | Preview communicates invalidity; no partial edge, orphan semantic item, stale port or history on rejection. Next valid action works on the intended source | R2: determine the invalid target for the chosen family first | U |
| AX-07 / P0 | Select a task and use its visible context-pad Connect action: click-to-arm if offered, and drag if advertised; drop at target top/left | Actual advertised activation works. Context-pad source default is explicit; target respects chosen drop. This is a separate entry path, not evidence of four-side source selection | R1: actual context-pad activation/source default unresolved | **Partial E1:** native context-pad drag B→T2 top succeeded but originated at B right midpoint. Exact Undo/export checks U |
| AX-08 / P0 | Use AX-01 once, Undo, Redo, delete the created edge and Undo; deselect and create another edge from a different side | Created edge remains selectable/editable; exact route and refs restore. No stale source from prior selection, duplicated edge or extra command from hover | Local exact-history contract; compare reference visibly without importing its unrelated serialization differences | U |

The bounded AX-01 side/selection schedule is below. It covers every source side
in both states and every target side twice without taking a Cartesian product.
Use a non-midpoint target for the selected-state rows; AX-02 investigates whether
source positions are fixed or continuous.

| Variant | Source state / side | Target side / placement |
| --- | --- | --- |
| AX-01a | Unselected / right | Left / target to right |
| AX-01b | Unselected / top | Bottom / target above |
| AX-01c | Unselected / left | Right / target to left |
| AX-01d | Unselected / bottom | Top / target below |
| AX-01e | Selected / right | Top / target diagonally below-right |
| AX-01f | Selected / top | Left / target diagonally above-left |
| AX-01g | Selected / left | Bottom / target diagonally below-left |
| AX-01h | Selected / bottom | Right / target diagonally above-right |

## Shape and business coverage

Run these after the ordinary task path is usable. Each selected/unselected pair
also changes shape family, side or surrounding process, rather than repeating all
four sides for every shape. Rule legality comes from the reference and semantic
context; a pool boundary is not interchangeable with an activity boundary.

| ID / risk | Visible affordance and real action sequence | Expected visible result, semantics and history | Reference expectation | Actual outcome / evidence |
| --- | --- | --- | --- | --- |
| AX-09 / P1 | Blank model: unselected start event from top to task; selected task into end event at left | Circle contact reaches the painted outline; eligible direction only. Correct event/task refs, no visual gap or event-center endpoint; exact Undo | R1/R3 for event contact; R2 for eligibility | U |
| AX-10 / P1 | Approval: selected decision gateway from left toward rework; unselected task into gateway at bottom | Diamond contact on outline and chosen branch. Existing condition/default remain intact; new branch has correct refs and owner; Undo does not change unrelated branch semantics | R2/R3; use actual ApprovalDecision and rework context | U |
| AX-11 / P1 | Order: source/target an expanded Payment subprocess from top, then repeat while collapsed from left | Dock to intended subprocess, not its child or hidden plane. Parent flow remains on correct process; child IO/flows/DI unchanged. Exact Undo and reopen | R3/R4: container vs child targeting and plane ownership | U |
| AX-12 / P1 | Order: unselected participant boundary to another participant's task; selected task toward other pool boundary | MessageFlow when permitted, appropriate circle/arrow styling and collaboration ownership. No accidental SequenceFlow across processes | R2/R4: black-box and expanded-pool eligibility; record exact endpoints | U |
| AX-13 / P1 | Booking: selected timer boundary event toward notification; unselected task toward host near its attached boundary | Outgoing boundary flow docks to event when chosen. Host/boundary hit distinction stays visible; attachedToRef and PT1H timer remain intact. Invalid incoming target is rejected if reference disallows it | R2/R4; use a visible unobstructed outline point and separately test overlap in AX-23 | U |
| AX-14 / P1 | Order/Approval: create a normal business path, move its connected task and resize it from the opposite corner | Route follows the chosen side/fraction where supported, end legs remain coherent, manual interior bends survive where viable. No diagonal accident or orphan refs; exact before/after DI and Undo | R3: measure actual move/resize policy; task resizing is already a documented local extension | **Observed E4:** fresh Task→End source move/resize displaces the untouched circle docking; pristine source-only reconnect is a positive control |

## Editing and recovery sequences

| ID / risk | Visible affordance and real action sequence | Expected visible result, semantics and history | Reference expectation | Actual outcome / evidence |
| --- | --- | --- | --- | --- |
| AX-15 / P0 | Hover an unselected edge, grab its source endpoint and reconnect to a task's left side; repeat after selecting the edge and with another edge selected | Correct edge/endpoint becomes active; opposite endpoint and unaffected bends stay fixed. Only intended source ref/owner changes. One command and exact Undo/Redo | R3/R4; reference input may snap, so record real command docking | U |
| AX-16 / P0 | Grab target endpoint, reconnect at task bottom; then attempt same-source return and an invalid background release | Target follows the chosen drop; intentional source endpoint stays fixed. Return/self-loop policy explicitly resolved; invalid drop restores all original points/refs/history | R2/R3, not blanket same-node rejection | **Partial E3:** A→T1 target returned to A creates sourceRef=targetRef A; Undo restores the original route and empty history. Background/other-side cases U |
| AX-17 / P1 | Reconnect a message edge within the same pool, then toward a genuinely disallowed cross-pool target; reconnect a data association to another owner | Type conversion, marker and semantic ownership match measured rules. Owned placeholder/IO cleanup is atomic and preserves authored metadata. Invalid case changes nothing | R4: previous reference evidence permits some MessageFlow→SequenceFlow conversions; do not assume all same-pool drops reject | U; H1 is background only |
| AX-18 / P1 | Select an orthogonal dogleg, drag one interior bend, then its segment; repeat from unselected hover | Chosen bend/segment moves without switching owner or grabbing a create port. Endpoints/manual unaffected bends preserved; edited geometry exports/reopens; exact Undo | R3; bend and segment may redock differently | U |
| AX-19 / P0 | Drag the middle of a straight connection; repeat on retained Conditional near-horizontal fractional route | Visible parallel segment or dogleg, not no-op or V-shaped diagonal. Classify from delivered geometry; no global rounding of unedited DI. Exact cancel/Undo restores fractions | R3: pinned near-axis classification, measured segment-redock policy | U; earlier Conditional QA is not a pass for this reopened case |
| AX-20 / P0 | Start a positively activated create/reconnect/bend, press Escape, then perform the same valid operation. Separately cancel by supported background action | Preview disappears, no stale handles/selection owner, no committed XML/history change; next action succeeds. Do not count unactivated movement as cancellation coverage | R5; local cancellation guarantees may be stronger than reference | U; held-drag modifier input may require hosted execution on the available QA surface |
| AX-21 / P1 | Select and delete an edge with a label and, separately, its endpoint shape; Undo/Redo twice | No stale line/label/control or dangling semantic refs. Dependent edges, DI, labels and metadata restore exactly locally; unrelated edges remain usable | R4/R5; independent reopen plus full-document comparison | U |
| AX-22 / P1 | In a business diagram, create from task A, then task B, reconnect A's edge, undo, select B and repeat | Every preview/control targets the current intended owner; no source memory leak or history duplication across repeated operations | R5; verify real click/hover selection sequence | **Partial E5:** post-connect target port appears only after leaving and re-entering; broader repeat sequence U |

## Viewport, overlap and interruption pairs

| ID / risk | Visible affordance and real action sequence | Expected visible result, semantics and history | Reference expectation | Actual outcome / evidence |
| --- | --- | --- | --- | --- |
| AX-23 / P1 | At a booking boundary/flow overlap and a task edge crossed by a connection, approach the visible source/endpoint via an unobstructed path; then try the overlapping point | Evidence identifies actual hit owner. A visible supported control remains reachable; rejected or intercepted action cannot masquerade as successful docking. Do not assume foreground priority without reference evidence | R6: exact pinned hit path; shared overlap limitation must be stated precisely | U |
| AX-24 / P0 | Repeat AX-01 right/left at 0.5 zoom with pan, and AX-15 at 1.5 zoom with opposite pan | Visible affordance reachable at normal CSS size; preview/drop tracks delivered pointer, not stale graph coordinates. Correct semantic refs and exact history | R3/R6; distinguish numeric SVG storage from model precision | U |
| AX-25 / P1 | Hover a control, change zoom/pan, return and use it; select an edge, zoom, then reconnect | Control follows current geometry and owner; no stale radius/position, accidental zoom-history entry or wrong endpoint. Hover-only action stays non-mutating | R6: actual viewport/hover lifecycle | U |
| AX-26 / P2 | Start a connection, leave canvas and release; re-enter and make a normal connection. Separately switch sample/import or navigate only through supported UI while a preview is active | No stuck drag, ghost edge or replay into a replaced graph. Prior/cancelled state and history follow the documented operation; subsequent interaction works | R5; record whether UI intentionally prevents navigation/import during interaction | U |
| AX-27 / P1 | Create a connection near a viewport edge, then make another; inspect preview, pan behavior and target visibility | Chosen anchors stay fixed as camera moves; no scroll masquerading as graph movement. Repeated creation stays reachable, one command per commit | R6; compare actual native auto-pan policy where offered | U |
| AX-28 / P2 | In two editor instances, hover/create in one, cancel, then connect in the other; repeat after Undo in the first | Independent preview, selection, diagram and history; no cross-instance source or control state | R5; separate instance lifecycle | U |
| AX-29 / P0 | Drag an ordinary task by its body near each side, then select it and use a visible resize square; repeat beside a connection endpoint | Body press moves the intended task, resize square resizes it, and endpoint edits the edge. A source affordance must not steal these common actions. Correct one-step history and exact Undo | R1/R6: visible control priority and body hit behavior; local task resize is an explicit extension | U |

## First hosted checkpoint: prepared coverage, not results

`test/modeling/browser-anchor-ux.mjs` currently prepares 38 native engine cases.
None has been executed in this workspace. Syntax/lint and page-build checks do
not count as gesture acceptance. The local cases use the existing demo UI; the
pinned comparison page has visible sample/palette/Connect/import controls and
normal model mounting. Test-side API access is read-only. Its import control
validates independent reopen, not the production site's import discoverability.

| Matrix IDs | Prepared in this checkpoint | Remaining part / execution gap |
| --- | --- | --- |
| AX-01a–h, AX-02, AX-03 | Eight side/selection pairs, two off-midpoint origins, backward right/right route; one visible export→reference import | Corner projection and a broader target-perimeter sweep remain unimplemented; all prepared cases unrun |
| AX-04, AX-05 | Local click/1/4/5px no-op; actual reference context-pad 0/5px pending path followed by a valid connection; deliberate same/different-side local and reference task loops | Native self-rule coverage for Start/End/Participant/Gateway remains unimplemented; structural S1 is not a native pass |
| AX-06, AX-07, AX-08 | Background rejection followed by valid creation; local/reference advertised context drag; delete/Undo/Redo and creation from the other source | Additional click-to-arm and semantic-invalid target cases remain unimplemented |
| AX-09–AX-13 | Named business start event, gateway, expanded subprocess, participant and boundary sources | Selected variants, collapsed subprocess, reverse directions and overlapping target paths remain unimplemented |
| AX-14 | Fresh palette Task→offset-circle End with the measured 23-unit gap and −1 center-Y offset; source body move or exact +4-width east resize to a 19-unit gap; full unrelated model/DI guard | Other outlines, corner resize and manual interior bends during repair remain unimplemented |
| AX-15, AX-16, AX-19, AX-20 | Both endpoint reconnects, retained fractional segment, positively activated Escape then valid creation | Unselected reconnect, same-source reconnect, generic interior bend, invalid reconnect and other interrupted operations remain unimplemented |
| AX-24, AX-29 | Low/high zoom with native pan; normal task body drag; 0.5-zoom Start/Gateway body drag then creation from the source control | Additional zoomed shapes/selected resize-priority pairs remain unimplemented |
| AX-17, AX-18, AX-21–AX-23, AX-25–AX-28 | Matrix only | Conversions/data-owner reconnect, generic bend/segment, dependent deletion, repeated owners, overlap, hover-after-zoom, outside/import interruption, viewport-edge repetition and multiple instances require a later native or manual pass |

A green first job would establish only these executed cases. It must not close
full matrix acceptance or erase the remaining ordinary-path risks. Failure
artifacts include screenshots, full XML, delivered input, geometry and history;
cases aggregate independently instead of stopping after the first failure.

## Pairwise coverage and stopping rule

The first pass is AX-01 through AX-08 plus the ordinary fractional/zoom pairs
AX-19, AX-24 and AX-29. It is intentionally sufficient to expose an everyday origin or
docking problem before broadening the suite. The next pass covers the remaining
shape/business and editing rows. Use a blank two-task diagram for discoverability
and the named retained Order, Approval, Booking and Conditional examples for
real context. Do not replace these with convenient API-only diagrams.

Together, the rows pair all four sides with selection state; task/event/gateway/
subprocess/pool/boundary classes with creation or reconnect; create/reconnect/
move/resize/bend/segment/delete with history; and normal/zoomed/panned/overlapping
views with real operations. Interruption is paired with activated gestures and a
subsequent valid operation. This is risk-based pairwise coverage, not a proof of
every possible Cartesian combination.

Stop expansion when P0 findings are reproduced, reference/product expectations
are settled, fixes pass the same native actions, and the planned P1/P2 rows have
recorded results or explicit execution gaps. A discovered new failure gets the
smallest adjacent case needed to bound it. Do not generate broad tests merely to
raise counts, or mark acceptance complete while a user-reported ordinary path is
unresolved. Missing activation, unsupported input and unrun reference checks stay
visible in the report.

## Reference questions to settle before implementation assertions

| Question | Required evidence |
| --- | --- |
| R1: How can a user choose an origin? | Actual pinned hover/selection/context-pad path on a task, event and gateway; visible affordance, activation and preview origin. Decide explicitly where requested local multi-side UX extends the reference |
| R2: Which self/invalid directions are allowed? | Same-port click, activated return, intentional task loop, event/gateway case and reconnect; actual native result plus type/source/target/owner and history. Rule-only evidence is incomplete |
| R3: What geometry does the gesture preserve? | Complete native input → preview → commit → DI for backward sides, non-midpoints, shape outlines, near-axis segment movement and both reconnect directions |
| R4: What changes semantically? | Independent parse/reopen for self-loop or conversion, participant/subprocess ownership, boundary definitions, authored IO and related DI/refs |
| R5: What is recovery behavior? | Positively activated cancel/interruption, exact local Undo/Redo and a subsequent valid gesture. Any reference serialization/history difference must be specific and evidenced |
| R6: What is actually hittable? | Actual delivered input and hit owner at normal/changed zoom, overlap and viewport boundaries. Painted marker and transparent hit areas may differ but must refer to the same action/geometry |

## Observation log

| Evidence ID | Revision / provenance | Executed observation and limit |
| --- | --- | --- |
| E0 | User feedback reopening anchor QA, 2026-10-02 | Reports right-only origin and connecting an anchor back to itself. Repro shape, activation threshold, connection type and loop validity are not established by the report alone |
| E1 | Independent exploratory native QA, exact site `99e608a` / runtime `5a994b6` | Conditional B: top `(368,184)`, left `(330,202)` and bottom `(370,251)` hover each exposes only right-midpoint blue circle; reported circle graph coordinate `(370,130)`, radius 5. Selecting B exposes eight resize squares, no alternative source ports. Context-pad title advertises drag to target; native drag `(468,196)`→T2 top `(585,239)` creates B→T2 from B right midpoint to T2 top and enables Undo. Screenshots: `bottom-hover-right-only.jpg`, `selected-node-resize-controls.jpg`. This records affordance and one committed route, not a full XML/history pass |
| E2 | Independent exploratory native QA, exact site `99e608a` / runtime `5a994b6` | Stationary native click on B's blue source port creates a self-loop and enables Undo. After Undo, 1px diagonal jitter `(417,217)`→`(416,218)` also commits a same-node SequenceFlow. The stationary-click route is almost collapsed at the right border: starts `(370,130)`, ends `(370,129.60311015780601)`. Evidence: `stationary-port-click-creates-loop.jpg`, `stationary-port-click.bpmn`. This is accidental mutation evidence, independent of deliberate loop legality. Held leave-and-return is unrun on this exploratory surface |
| E3 | Independent exploratory native QA, exact site `99e608a` / runtime `5a994b6` | Deliberate same-node creation was observed. Separately, select Conditional A→T1 at `(280,338)`, drag target `(327,338)` to A bottom offset `(164,373)`: exported sourceRef and targetRef both become A, with an exterior route. Undo restores its original two-point route and disables Undo. Evidence: `same-node-reconnect.jpg`, `same-node-reconnect.bpmn`. Reference legality and full lifecycle remain unresolved |
| E4 | Independent exploratory native QA, exact site `99e608a` / runtime `5a994b6` | A clean palette-created Start→Task→End path succeeds. Moving the source changes an untouched offset circle target from `(261.7912776253634,109.37218800914619)` to bounding-box `(259,same Y)`. A separate fresh-edge east resize changes width 100→104 and flips source `(236,120)` to `(240,80)`, with target `(261.5076189470695,109.83560534946257)` moved to `(261.5076189470695,101)`, leaving a visible gap. Evidence: `fresh-edge-before-resize.bpmn`, `fresh-edge-after-resize.bpmn`, `fresh-edge-resize-circle-gap.jpg`. Pristine source-only reconnect preserves the opposite circle endpoint; invalid background drop preserves exact XML/Redo |
| E5 | Independent exploratory native QA, exact site `99e608a` / runtime `5a994b6` | Immediately after Start→Task creation, motion within the still-hovered Task showed no source port; leaving for background and re-entering revealed it. This is a repeat-action discoverability observation awaiting classification. Ordinary top-border drag moved B and Undo restored it; context-pad click-to-arm followed by Escape was a no-op. Those positive controls do not excuse the accidental click/jitter mutation |
| S1 | Independent full-service reference probe, bpmn-js 18.30.1 / diagram-js 15.27.1; structural, not native browser acceptance | Actual Connect→Dragging performs no mutation for no movement, 4px or exactly 5px. After >5px activation, identical-position return permits a task self-loop with five nondegenerate points; docking may move to different sides. Start/End/Participant self-connect rejects; ExclusiveGateway self-loop is rule-allowed. Both task endpoint reconnections can produce loops; cross-pool task MessageFlow can convert to a SequenceFlow loop. Native reference-page execution remains mandatory |
| H1 | Previous configured library/site gates, documented in [VERIFICATION.md](VERIFICATION.md) | Useful regression baseline for already executed arrow/hover/history cases. Does not establish multi-side source discoverability or settle this reopened same-anchor report |

Screenshots are retained by the exploratory reviewer. This ledger names them for
correlation without publishing workstation paths. Add new native outcomes here
and to the relevant row before deriving regression assertions from them.
