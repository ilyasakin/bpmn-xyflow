# Anchor interaction review: verified results and one unresolved finding

Updated 2026-10-02. This is the current result of the reopened interaction review.
The original [case matrix](ANCHOR-UX-CASES.md), [22-workflow plan](ANCHOR-UX-FOLLOWUP.md)
and [first expanded run](ANCHOR-UX-FIRST-EXPANDED-RUN.md) retain their historical
failures and unrun labels. Those historical checkpoints are not the current status.

## Exact delivered preview

- [Modeler preview](https://ilyasakin-github-io-git-parity-bpmn-620865-ilyasakins-projects.vercel.app/demo/bpmn/modeler)
- Site revision `ad787b92f51deb70d666368ac831351114b0ba8b` pins runtime
  `def0baf376fc6ed9653d806f2d206a1e2d65e38c`
- [Runtime CI](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/37009226311)
  and [site production/import CI](https://github.com/ilyasakin/ilyasakin.github.io/actions/runs/37009677861) passed
- Later library revisions contain diagnostic tests and documentation only;
  the preview product is unchanged. The diagnostic report records the final
  experiment and its limits. Diagnostic revision `56538c9` passed all 38 exact-head
  checks in [run 37017726421](https://github.com/ilyasakin/bpmn-xyflow/actions/runs/37017726421)
- [Library PR1](https://github.com/ilyasakin/bpmn-xyflow/pull/1) and
  [site PR15](https://github.com/ilyasakin/ilyasakin.github.io/pull/15) remain reviewable drafts

## Confirmed changes

| User-visible issue | Verified outcome | Evidence scope |
| --- | --- | --- |
| Only the right source position was discoverable | Visible perimeter affordance follows the selected outline point on all sides; the marker, preview and saved endpoint agree | Native anchor39, ownership24, real business workflows; independent off-midpoint left/top manual creation |
| A click or tiny movement could create an accidental self-connection | Stationary input adds no connection/history. An activated deliberate legal loop remains visible and editable | Native threshold/reference cases and independent manual loop/history inspection |
| Clicking the source then retrying could resize the selected shape | Source and resize ownership stay distinct, including all side midpoints and rounded corners | Ownership24; immediate manual click/retry and separate resize checks |
| Circle/diamond docking or an untouched opposite endpoint moved incorrectly | Endpoint geometry follows the actual outline and preserves the chosen opposite anchor where the routing contract allows | Native move/resize/reconnect cases and manual circle/gateway inspection |
| D11: immediate Back then wheel used stale viewport dispatch | Navigation keeps consistent public and actual viewport state without a wait/retry workaround | Registered lifecycle regression and native cross-root history/zoom cases |
| D14: northwest container resize translated children/internal routes | Ordinary frame resize preserves absolute child geometry; modifier space movement remains explicit | Expanded workflow/container2, retained smoke/advanced tests, manual Transaction resize with unrelated DI unchanged |
| D15/D19: visible anchor had an offscreen grab or changed while crossing editor chrome | Viewport-aware grab placement and acquired-tether retention preserve the selected outline origin | Viewport12, overlap/hit gates and manual clipped-source checks |
| D16: route overlap stole source acquisition or left stale controls | Acquisition and departure have distinct behavior with painted-control input ownership | Hit29, ownership24 and native edge pass-through checks |
| D17: legal curved-shape self-loop rejected | Same-owner routing uses the stock shape outline; illegal targets and inactive jitter remain rejected | Native gateway-loop and invalid-target cases |
| D18: Escape cancelled a preview but cleared prior selection | Active gesture cancellation preserves selection/XML/history; ordinary idle Escape still deselects | Native viewport/cancel cases; independent manual click-armed cancellation |
| D20: direct approach from the advertised corner resize square moved the grab | The original corner-to-grab path now preserves exact marker/grab and remains connectable, without first moving to the painted marker | Eight native corner cases plus exact independent manual replay, precise XML and Undo/Redo |

## What was actually exercised

The native schedules include 39 anchor cases, 24 source/resize ownership cases,
62 variants across 22 editing workflows, 29 hit-priority cases, 12 viewport cases,
two container comparison cases and eight advertised-corner cases. These are
separate overlapping schedules, not a sum of distinct product capabilities.
The full retained renderer/modeling/XML/framework/package suites also pass on the
runtime checkpoint. Actual production-site import/export tests cover three
business diagrams, file cancellation, unsaved changes, parse failure/history,
inert embedded content and the phone dialog.

The new user-workflow schedules and independent manual QA use visible
sample/import/palette/keyboard/pointer paths. Retained fixture-driven, API and
reference-service checks are separate evidence. Read-only DOM, exported XML and model observations check geometry,
references, ownership and exact local history. Independent exploratory manual
work discovered additional defects after earlier suites were already green.
The comparison reference is pinned bpmn-js18.30.1; differences are explicit.

Manual checks include clean palette construction, off-midpoint source choice,
selected click/retry, deliberate loops, fixed-opposite reconnect, circle/diamond
move/resize, sample cancellation and replacement, populated Transaction resize,
repeated Boundary source acquisition, and the original D20 corner reproduction.
Held-drag Escape, touch streams and file-picker paths use their hosted native
checks; the manual report does not substitute unsupported gestures for them.

## Unresolved historical F23 finding

On one push run of historical revision `201214b6`, an acquired FlightTimeout
source grab disappeared before press. The same-coordinate press hit the underlying
Transaction and the drag moved it by `(135,65)` instead of connecting. The PR run
of that exact revision passed. The original artifact does not record the event
or caller that removed the grab.

Later uninstrumented runs, unchanged-product diagnostic runs, independent manual
repetitions and the final controlled experiment did not reproduce that loss.
Current runtime differs from the historical one by the independently verified
D20 origin-tracking correction; that change is not presented as an F23 fix.
The [diagnostic report](BOUNDARY-ACQUISITION-DIAGNOSTIC.md) records the native traces,
negative hypotheses, capture perturbations and limits. F23 remains an unresolved
known finding. Its residual risk is an occasional source-control disappearance
that could start a container drag; its frequency and production cause are unknown.

The bounded investigation stops here rather than inventing a cause or running
indefinite repeats. The original uninstrumented acceptance case and isolated
traced companion remain available to capture a recurrence. A future observed
recurrence should preserve its exact head, native event/removal trace and before/
after XML for a targeted repair. No broad claim that every interaction is fixed
or that this particular finding is closed is supported.

## Deliberate scope and reference differences

Valid intentional BPMN loops remain supported. Task resize is a configurable
extension. Exact fractional pointer docking, selected source-control hit ownership,
visible-label/Group ordering and modifier lane routing have measured intentional
differences from the reference; their separate assertions remain documented in
the case files. Precise local docking and attached routes are retained instead of
copying observed reference rounding or detached-route defects.

The engine remains XYFlow with its documented direct API. This report does not
claim bpmn-js plugin/API compatibility, execution-engine behavior, or universal
BPMN parity beyond the recorded core viewer/modeler workflows.
