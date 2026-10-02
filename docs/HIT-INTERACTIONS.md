# Hit regions and the reference baseline

The October 2 source-grab correction builds on published `1d3fe967`. Its
structural and oracle checks pass locally; the 29-group native hit gate on this
new correction remains pending. Earlier published native results are revision-
specific and do not certify the changed controls.

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
difference, never equal parity. Other paired probes require equality in both
directions except the precisely identified visible source-tool presses below.
Shared route-over-boundary center collisions remain shared behavior.

## Explicit visible source-tool difference

A source Connect grab owns a press only within its visible painted disc: a
5 CSS-pixel radius plus half of its 1.5 CSS-pixel stroke, giving a 5.75 CSS-pixel
outer radius. Its transparent hit circle is exactly coextensive with that paint.
The separate 8 CSS-pixel approach/collision corridor stabilizes pointer travel;
it does not enlarge the press area. Displaced grabs retain at least 12 CSS pixels
of separation from the exact outline marker.

The pinned reference has no equivalent local source tool at these positions.
Twelve measured probes therefore explicitly require upstream shape selection
and local empty selection after a stationary press on the visible Connect grab:

- `target-endpoint-interior-0.65`: offsets −6, +6, −10, +10, −6.5 and +6.5 CSS pixels
- `target-endpoint-interior-1.4`: offsets +6, −10, +10, −14 and +14 CSS pixels
- `booking-attached-boundary`: the separate ring probe

These three groups report an intentional difference. Each exceptional probe
requires a trusted delivered press on the exact named source control, matching
native SVG paint membership, a stationary trusted release, restoration of the
same displayed grab, unchanged selection/history, and unchanged complete XML.
No other source-control hit is automatically accepted as a difference.

The event-crossing ±10 and booking −10/−9 probes lie outside visible grab paint
and must select their shapes exactly as the reference does. Two additional
native controls put a neighboring shape and an exposed connection inside the
former invisible halo, 7 CSS pixels from the displayed grab. The neighbor must
remain selectable while the grab stays fixed; actual edge hover removes the
obsolete source tool and the subsequent click must select that edge. Both retain
exact XML and history. These assertions await the hosted run of this correction.

## Prepared native gate

`pnpm test:browser:hits` contains 29 independent groups: twenty task/event/gateway/
subprocess crossing comparisons at zoom 0.2, 0.65, 1, 1.4 and 3; two endpoint
interior comparisons and overlapping endpoint interiors; booking boundary; overlapping and unobstructed external
labels; selected endpoint versus create-port interaction; and the two invisible-
halo pass-through controls. Native pointer
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
paint order or the endpoint corridor. All 16 Group cases passed on `1d3fe967`;
they remain required regressions for subsequent source changes.
