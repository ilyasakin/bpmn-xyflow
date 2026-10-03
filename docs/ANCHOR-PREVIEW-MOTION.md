# Anchor preview motion baseline

This diagnostic addresses T05, T06 and T10 of the October 3 per-type review.
It is designed before optimizing production code. The first hosted baseline ran on `cbd1a0af` (Actions run `37082800733`).
The setup correction below is prepared and has not yet run natively.

## Questions and cases

Does the marker reflect the latest delivered pointer, and do the grab and tether
agree with that marker? Is a perceived delay an input scheduling delay, a later
DOM update, a frame opportunity, a CSS transition, or a spatial placement jump?

Thirteen fresh local cases use visible sample/palette controls. Task, StartEvent
and ExclusiveGateway each cover four representative combinations of selection,
zoom, DPR and reduced-motion preference. A selected FlightTimeout in the Booking
sample adds the reported abrupt grab movement. Each case performs slow and fast
outline paths and reverses direction. Browser DPR/media emulation configures the
test environment; model and camera setup use native UI actions only.

The continuous diamond baseline is explicitly different from the newly requested
four-vertex Gateway policy. The runner accepts an explicit `continuous` or
`vertices` policy setting and records it; it never derives an expected anchor
from the committed marker or silently changes the selected policy.

## Measurements and limits

- Trusted pointer/mouse events retain their native timestamp, delivered integer
  coordinates, coalesced-event metadata and actual target identity
- Passive listeners installed after the application record attribute-only DOM
  snapshots. The current Modeler mousemove handler is an earlier window capture
  listener; its completed-handler sample is identified separately from the
  earlier pointer event and subsequent requestAnimationFrame opportunity
- Each RAF snapshot is associated with the latest delivered mouse event at that
  instant. Intermediate input superseded before RAF is reported as superseded,
  not a missed paint or a stale frame
- Marker/grab/tether consistency and independent delivered-input projection are
  checked separately from timing. Input, marker and grab displacement are kept
  separately so a placement jump is never described as animation latency
- Event-to-observation, event-to-next-RAF, frame interval and observer read costs
  are reported as distributions, with long tasks and browser layout/style/script
  metric deltas. No universal average CPU or millisecond performance gate exists
- Computed transitions/animations and active animation state are read before and
  after each motion run, outside its event loop. No per-event layout call is added
  by this observer. The unchanged green shared factory already reads SVG CTM on
  every mousemove. That overhead and CDP delivery limit generalization to a real
  physical mouse; total layout metrics cannot be attributed to a single handler
- RAF is a pre-paint opportunity, not a compositor presentation timestamp. A
  screenshot after observation and exact DOM agreement do not establish when a
  user actually saw every intermediate frame. A native pass only establishes
  valid execution, observation and declared geometry/history invariants

Setup failures, missing controls, untrusted input, observer errors, stale latest
markers and model/history/selection/camera mutations are failures. Measured
timing and spatial jumps remain evidence to interpret, even when those guards
pass. Screenshots and XML are captured only after motion observation is stopped.
The existing isolated whole-case lifecycle bounds setup, action, evidence and
owned cleanup; failed cases cannot hide later independent cases.

## First hosted observations and setup correction

The 13 cases produced six successful executions, one strict marker-freshness
failure, and six setup failures. All seven completed motion traces, including the
failed StartEvent case, retain their original timing, style and spatial evidence.

At DPR 2, a requested native wheel delta of 60 was delivered as a trusted
`deltaY: 30`, with the camera changing by exactly `2 ** -.06` per tick. The
shared helper's DPR-1 budget therefore exhausted before the target zoom. The
diagnostic now owns its wheel setup: one real calibration tick records input and
camera response, subsequent input magnitude and finite remaining budget use that
observed gain, and every step preserves exact XML/history/selection. Setup
evidence is saved even on failure. No shared factory or production code changes.
The zoom band is now within .001 in log ratio. Booking targets .82737 and requires
a visibly displaced grab; the original .955 run remained coincident and did not
exercise the reported placement discontinuity.

The selected StartEvent at zoom .543367 held its marker for seven staircase
positions in each reversal. At delivered `(894,643) → (894,642)`, the existing
acquisition rule sees .76837 CSSpx progress toward the displaced grab versus
.64001 CSSpx tangential movement. The pointer remains within the 1.5 CSSpx outline
band. The exact registered-handler replay reproduces the hold and its unchanged
model/history. This explains the behavior but does not approve it as perimeter
UX: the strict freshness failure remains. True outward travel, explicit resize
origins and direct grab acquisition must be distinguished before changing that
source policy.

All recorded computed transition durations were `0s`, animation names `none`,
and active animations and long tasks were absent. Across these seven traces,
event-timestamp-to-DOM medians were about 8.4–8.7ms for paced input and
16.0–16.2ms for fast CDP input. These include native scheduling and do not isolate
handler cost or prove presentation latency. Spatial jumps were deterministic in
both phases: a 1 CSSpx input produced maximum grab movements of 17.56 CSSpx for
selected StartEvent, 12.22 CSSpx for selected Task, and 12.02 CSSpx for unselected
Gateway. These observations support investigating placement continuity separately
from animation or delayed DOM. No universal performance pass is claimed.

## Explicit visual-outline check outside the timing loop

The same 13 cases now collect the actual outer Task rectangle, Event circle or
Gateway polygon after setup, together with computed stroke, the preview path,
native SVG bounding box, marker, hit radius and fixed indicators. This is outside
the motion sampling loop. `BPMN_MOTION_OUTLINE_POLICY=baseline` records and checks
the original centerline outline; `outward` requires the new 2.5 CSSpx clear gap
outside the main painted stroke, including half the preview's own stroke.
The policy is explicit and never inferred from the running implementation.

Expected path geometry comes from the actual outer paint attributes and the
specified margin. Native `getBBox()` has a separate bound derived from Float32
operand storage, cumulative coordinate operations and extrema subtraction. The
raw path operands remain tightly checked; the bound does not permit a pixel-level
geometry change. Selected 3-unit borders are distinguished from normal 2-unit
borders. Docking stays on the original perimeter, the press radius stays 5.75
CSSpx, and the expanded outline is pointer-inert. With explicit Gateway `vertices`
policy, four passive indicators must sit at the original four vertices. Outline
and relevant source hashes are saved before validation, including failed cases.

The calibrated baseline at `7dcc2a9` reached every requested zoom. It recorded
8/13 successful executions and five strict freshness failures: two selected Task,
two selected StartEvent and one selected Booking Boundary case. Task traces
revealed a coincident port retaining a prior resize-pointer offset. Event traces
revealed along-ring choice being treated as displaced-grab travel. Registered
source regressions explain these findings; they do not replace the next exact
source native run or weaken the existing freshness assertions.
