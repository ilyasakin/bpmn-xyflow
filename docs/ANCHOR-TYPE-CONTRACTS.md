# Per-type anchor, route and motion review (2026-10-03)

This matrix is written before new implementation assertions. It follows fresh
user feedback, including an explicit exception to the earlier freely chosen
source position: Gateways must use their four diamond vertices. This is the
requested interaction policy, not a universal BPMN specification requirement.

Baseline: library PR1 `2e10a880`, preview site PR15 `ad787b92`, runtime `def0baf`.
Both PRs were independently verified open drafts with unchanged default branches
at 2026-10-03 00:16 UTC. The original F23 finding remains historical and unresolved;
it is not part of a new speculative investigation.

## Contracts by element family

| Family | Interactive anchors | Eligibility / ownership | Import and edit boundary |
| --- | --- | --- | --- |
| All Gateway subtypes | Exactly top/right/bottom/left diamond vertices; deterministic nearest-vertex selection and stable tie policy | Same chosen vertex in visible marker, active preview, create and source/target reconnect; existing connection rules remain | Open/save preserve authored nonvertex DI; an actual routing/geometry command installs the policy atomically and Undo restores original DI |
| Start/intermediate/end Events | Continuous actual circular outline, without applying gateway vertex policy | Start/end incoming/outgoing and catch/throw constraints remain; preview only where operation is allowed | Original imported geometry stays unchanged; edited docking uses actual rendered outline |
| Boundary Events | Continuous actual event ring; attachment to host is a separate operation | Connect control, label text, host resize and boundary reattachment have distinct ownership | Host move/resize and edge edits preserve attachment, references, unaffected anchors and exact history |
| Task / CallActivity / SubProcess / Transaction | Actual rounded activity outline, including supported corner regions | Expanded/collapsed scope and boundary-host rules remain; intentional Task resize extension stays distinct | Frame resize does not translate contents; edited endpoints and authored bends are preserved under their documented rules |
| Participant / Lane | Participant rectangle for eligible MessageFlow; Lane is not a standalone flow endpoint | Sequence flows remain process-scoped; neither lane nor pool frame should advertise an illegal operation | Preserve collaboration/process/lane membership and DI through edits |
| Data object/store / TextAnnotation | Actual renderer outline for eligible associations | Association/DataAssociation rules and ownership apply; do not force SequenceFlow routing onto them | Preserve authored route and metadata; only relevant edit changes geometry |
| Group / label / connection-owned annotation | No arbitrary sequence/message source on Group or label; annotation attachment follows its eligible owner | Body/label editing and route editing are separate visible operations | Shared category labels and annotation ownership remain intact |

## Cross-cutting geometry and presentation contracts

- Exactly aligned, facing SequenceFlow/MessageFlow endpoints with a clear route
  produce a straight horizontal/vertical segment. Fractional model coordinates,
  zoom and DPR must not introduce an artificial bend
- A genuinely offset explicit source/drop point stays exact. A required small
  orthogonal offset is not silently erased by rounding. Its rendered corners
  must never overshoot or reverse on a short interior leg
- Authored manual bends and imported DI are not normalized merely on opening a
  document. Relevant editing commands are undoable and keep unrelated geometry
- Source marker, visible grab, tether and committed docking are synchronized.
  Measure actual native event-to-DOM/frame behavior before assigning a latency
  cause; distinguish tweening, event scheduling, geometry cost and repaint
- The hover outline should be modestly outside the visible shape stroke, in
  screen-space and type-aware. This visual margin must not move real docking
  points, alter XML, enlarge invisible hit areas or steal resize/body/edge input
- Reduced motion must not introduce a different docking or delayed interaction
  contract. Selection, pan/zoom, clipping, chrome and repeated/cancelled gestures
  must retain their established ownership and exact history behavior

## Predeclared native risk matrix

| ID | Visible user path | Required observation / assertion | Coverage priority |
| --- | --- | --- | --- |
| T01 | Blank palette Gateway plus Task; approach four slopes/vertices selected and unselected, create on each side | Marker/preview/committed endpoint is one exact vertex; source origin agrees; no nonvertex source | P0 |
| T02 | Reconnect either end to/from Gateway from four quadrants, cancel and repeat | Both endpoint policies, untouched opposite anchor, valid/invalid feedback and exact Undo/Redo | P0 |
| T03 | Create visually aligned Task pairs horizontally/vertically; exact and one-pixel offset drops | Straight exact alignment; no rendered corner backtrack for true offset; precise DI | P0 |
| T04 | Move to visible alignment, resize and reconnect at fractional zooms/DPR | Model route and SVG path stay consistent, no numerical micro-bends or endpoint drift | P0 |
| T05 | Slow and fast native outline motion on Task, Event and Gateway | Latest delivered point/vertex is reflected without tween lag; marker/grab/tether agree at event and frame checkpoints | P0 |
| T06 | Inspect enlarged hover outline at low/normal/high zoom on circle, diamond and rounded Task | Modest outward screen margin, true docking unchanged, no invisible hit expansion | P0 |
| T07 | Real business diagrams with Boundary, expanded/collapsed subprocess, pools/lanes | Legal per-type controls only; unchanged attachment/scope/ownership and repeat/cancel/history | P1 |
| T08 | Data/annotation and deliberate self-loops/manual route edits | No accidental Manhattan or gateway policy generalization; exact intended manual geometry | P1 |
| T09 | Import authored fractional/nonvertex/bent DI, export without edit, then relevant edit/Undo/reopen | Lossless untouched input; explicit edit policy and original restoration | P0 |
| T10 | Clipped/chrome-adjacent and selected resize overlap, fast direction reversal, reduced motion | Preview remains reachable and synchronized; original ownership/viewport regressions stay covered | P1 |

Actual runs must record starting UI state, trusted pointer/key sequence, exact
head, source/drop/route coordinates, visible result, exported semantics/DI,
Undo/Redo and cancellation. Reference observations are separate from the explicit
user policy. Independent exploration precedes implementation assertions. Failed
setup is reported, never counted as a successful operation. The schedule uses
risk-based representative pairs, not an unbounded Cartesian product.

## Initial independent findings (before fixes)

- T01: Gateway diamond vertices `(590,207)/(615,232)/(590,257)/(565,232)`
  currently advertise sloped marker `(603,244)`, violating the new policy
- T03: exactly aligned control is straight, but a normal one-pixel offset creates
  a small elbow whose SVG cubic overshoots and backtracks. This is actual path
  geometry, not only antialiasing; source investigation is ongoing
- T05: sampled eight-pixel native Task-side movements track delivered positions;
  input-to-paint latency has not yet been measured. Do not assert a cause
- T06: current outline follows the renderer's exact shape path with no outward
  margin. True docking remains on the outline and must stay there

Status: implementation and native validation pending. Earlier green suites remain
regression evidence, not acceptance of these fresh requirements.
