# Anchor preview motion baseline

This diagnostic addresses T05, T06 and T10 of the October 3 per-type review.
It is designed before optimizing production code. Native execution is pending.

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
