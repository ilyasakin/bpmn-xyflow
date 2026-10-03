# Flow-owned annotations and automatic append visibility

This is a fresh local follow-up after reconstructed checkpoint `2832d9f9`.
Neither the old lost local tree nor historical test counts certify these bytes.
The native suite below is prepared and still requires hosted Chrome execution.
Group/category behavior and Group foreground ordering are a separate stage.

## Source ownership and geometry

A selected SequenceFlow or MessageFlow exposes the existing `Add text annotation`
context-pad action (`append.text-annotation`). Click performs automatic placement;
press-drag chooses the annotation's position. Automatic source anchoring uses the
pinned diagram-js half-total-route-length midpoint, not the midpoint of the
longest segment or the context-pad icon's position. The actual upstream
ContextPad/AutoPlace/Modeling pipeline supplies the reference placement,
connected-peer spacing and cropped Association endpoint.

For a Collaboration-owned MessageFlow without a Process ancestor, automatic
annotation placement also retains the pinned registry-direction fallback. That
fallback selects the vertical placement branch; the fixture's automatic note is
at `(180, 260)`, not `(180, 150)`. SequenceFlow placement is unchanged. The four
native append pairs require exact placement, semantic ownership and half-path
source anchoring. Their annotation endpoint is checked against an independent
rectangle intersection: local keeps the analytical fraction, while pinned
`CroppingConnectionDocking` rounds that intersection to integers. These measured
precision differences are reported separately, never counted as equal geometry.

A dependent Association can attach at either end to a connection. Subsequent
owner segment/bendpoint edits, reconnects and connected-shape movement/resize
adjust that endpoint using the pinned
[LayoutConnectionBehavior](https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/features/modeling/behavior/LayoutConnectionBehavior.js)
and ConnectionLayoutUtil policy. Its opposite anchor, manually authored interior
bends, metadata and semantic ownership must survive. Source and target redocking
are separate native cases. The fixture includes a non-midpoint attachment so a
blanket reset to the route's midpoint cannot pass.

The exported independent bpmn-moddle model validates semantic references,
root artifact ownership and DI. Positive previews precede cancellation checks.
Selection itself is checked against XML/history before any later edit baseline
is taken. Repeated undo/redo and actual viewer reopen retain exact edited data.

## Minimal automatic reveal

After a successful automatic append, a private Viewer helper pans only as far as
necessary to reveal the new shape. It follows pinned diagram-js 15.27.1
[Canvas.scrollToElement](https://github.com/bpmn-io/diagram-js/blob/v15.27.1/lib/core/Canvas.js)
with 100 CSS-pixel padding, inside the usable area after palette, toolbar,
minimap and attribution insets. Zoom is unchanged. An already visible result
does not pan; an oversized result aligns at the usable area's top-left. Explicit
pointer drop does not invoke this helper. Reveal creates no model command and
changes no semantic data, DI, selection or connection anchor.

The four new structural groups compare actual reference Canvas calculations,
measured chrome and multi-instance behavior, idempotence and actual automatic
append with one command and exact undo/redo. Together with the existing viewport
suite, 11 focused tests passed on the new helper.

## Prepared native coverage

`test/modeling/browser-flow-annotations.mjs` has 27 independently aggregated groups:

- Four native upstream/local click and press-drag append pairs for sequence and message flows
- Two asymmetric route midpoint/placement cases
- Two append cancellation/repetition cases
- Six repeated automatic appends within one visibility/history case
- Source- and target-owned dependency propagation during segment editing
- Owner bendpoint editing and target reconnect
- Dependent source and target redocking to the same and another flow, with Escape and invalid-drop rollback
- Six paired source/target controls for default integral grid, fractional projection and Ctrl pressed after native endpoint-drag activation
- Two upstream source/target Ctrl+mousedown controls that pan the canvas with exact model/history no-op
- Owner deletion, dependent cleanup and exact history
- Sequence/message source-shape movement and sequence source-shape resize

Fixture imports are setup. Tested actions use actual Chromium pointer/keyboard
input or visible product buttons, and expectations are independent reference
calculations or independently parsed exported XML. Owned-server startup checks
its reported port; failures aggregate, preserve screenshots/XML, and write
incremental results under `test-artifacts`. No local Chrome launch was performed.

The four XML files under `test/fixtures/flow-native/` are exact
surviving authored acceptance variants of this repository's approval and order
business scenarios. They add a note, a manually routed dependent Association,
valid foreign metadata attributes and asymmetric owner routes. They were copied
from retained test inputs, not reconstructed from a summary. All four validate
against the official BPMN20 XSD. Their source scenarios retain repository
provenance; they do not import third-party business process content.

## Reconnect precision and IO preservation

Native redocking is checked against the delivered MouseEvent and live viewport
matrix, not an ideal requested coordinate. Local explicit docking retains the
projected position. The pinned reference rounds input and projects it at
BendpointSnapping priority 1500. An axis whose projection changes is marked
snapped, suppressing its default 10-unit GridSnapping at priority 1200. An
unchanged integral on-line projection sets neither flag, so the grid still acts:
the measured `(366, 187)` pointer becomes `(370, 190)`. Native Ctrl controls in
both endpoint directions first activate an ordinary endpoint drag, then press
Ctrl to bypass this grid and require `(366, 187)` in both engines. Holding Ctrl
before mousedown instead invokes the pinned HandTool at priority 1500, before
Bendpoints at priority 1000. Separate reference controls assert the resulting
canvas pan and exact XML/history no-op; this path does not start a reconnect. The fractional cases separately assert input rounding, changed snap
flags, grid suppression and final integer rounding in the reference; local
preserves its delivered-pointer projection. Each measured difference is reported
separately, with exact command/DI, complete-model, history and reopen assertions.
Static hit regions are not widened.

Fresh input associations use a reusable Property placeholder; fresh outputs do
not allocate IO declarations. Reconnecting an external endpoint must not grow
input/output items or sets. Imported authored IO and metadata remain in their
original containers. For a same-owner input reconnect, local preserves the
authored input binding; upstream may replace it with its placeholder. Owner
changes use the new owner's binding, while authored output source references
remain preserved. Repeated edits, cleanup, exact history and reopen have separate
reference tests; no execution-engine behavior is claimed.
