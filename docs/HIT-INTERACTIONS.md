# Hit regions and the reference baseline

This is a freshly reconstructed change based on published `7bc8a3a`, not a
byte-for-byte restoration of the lost reviewed local tree. Structural tests have
been rerun on these bytes. Hosted native verification remains pending.

The independent reference is bpmn-js 18.30.1 and its diagram-js 15.27.1
[InteractionEvents](https://github.com/bpmn-io/diagram-js/blob/v15.27.1/lib/features/interaction-events/InteractionEvents.js).
Shapes and external labels have transparent rectangular hit surfaces with a
15 graph-unit stroke. The box, rather than the visible circle/diamond/text
outline, determines the padded hit area. Groups accept border hits only. A
current semantic Group type determines this for imported, created and restored
graphics; importer convenience flags cannot make a new Group consume its
interior. Ordinary shapes keep the existing shape/connection paint order. Group frames
now use a dedicated foreground layer, described below.

Connections also use a 15 graph-unit corridor. It scales with the diagram and
is not clipped against endpoint interiors, matching the reference. Fixed-screen
bendpoints, resize handles and create ports are separate modeling controls.
Selected endpoint controls remain usable when a hover create port would overlap.
All hit surfaces are transient, carry `data-bpmn-hit`, and are removed from
standalone SVG export. Visible strokes, markers, labels and attribution remain.

## Explicit imported-label difference

Imported external labels remain above routes consistently in this implementation.
The pinned reference can place a subsequently imported route above a label; its
[BpmnOrderingProvider](https://github.com/bpmn-io/bpmn-js/blob/v18.30.1/lib/features/ordering/BpmnOrderingProvider.js)
explicitly comments that labels are imported in the wrong order, while normal
modeling puts them on top. We retain the consistent visible-label policy.

The native suite asserts the exact two outcomes at the overlap fixture: upstream
selects Flow at the route's center/corridor and the label outside it; local selects
the label at those visible label probes. The case is reported as an intentional
difference, never equal parity. Every other paired probe requires equality in
both directions, including boundary overlaps and endpoint interiors. Shared
route-over-boundary center collisions remain shared behavior; an unobstructed
boundary ring remains selectable.

## Prepared native gate

`pnpm test:browser:hits` contains 27 independent groups: twenty task/event/gateway/
subprocess crossing comparisons at zoom 0.2, 0.65, 1, 1.4 and 3; two endpoint
interior comparisons and overlapping endpoint interiors; booking boundary; overlapping and unobstructed external
labels; and selected endpoint versus create-port interaction. Native pointer
input follows verified visible coordinates, records actual hit/selection after
two animation frames, and checks selection has not changed XML. The owned server
must report the requested port. Per-case screenshots, XML, SVG and incremental
results are saved under `test-artifacts`.

Prepared native tests are not a claim that this reconstructed revision has run in
Chrome. Retain the full native connection suite as the independent regression
gate for chosen docking points, live previews, exact history and reopen behavior.

## Group frame ordering

The Group follow-up puts frames above connections, matching pinned
BpmnOrderingProvider normal-creation level10. Transparent Group interiors remain
noninteractive; only the border accepts input. Imported/reopened Groups use the
same consistent order locally. The pinned reference imports a Group before some
connections, so its overlapping border can select the Flow after reopen even
though normal creation selects the Group. Group16 asserts both exact lifecycle
outcomes and reports the import difference explicitly; it is not counted as
equal parity. The frame layer is retained in standalone SVG and kept below
external labels and editor controls. This does not change ordinary leaf-shape
paint order or the endpoint corridor. Native execution of the new Group cases
remains required.
