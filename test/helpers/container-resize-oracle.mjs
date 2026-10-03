/** Fixture-scoped full-document guard for the native Ctrl-lane resize pair. */
import assert from "node:assert/strict";
import { BpmnModdle } from "bpmn-moddle";
const oracle = new BpmnModdle();
const moving = ["ReviewRequest", "ApprovalDecision", "ApprovedEnd"];
const labelOwners = ["ApprovalDecision", "ApprovedEnd", "ApproveFlow", "RejectFlow", "ReworkFlow"];
const bounds = (n) => Object.fromEntries(["x", "y", "width", "height"].map((k) => [k, n[k]]));
async function parse(xml) {
  const p = await oracle.fromXML(xml);
  assert.deepEqual(p.warnings, []);
  assert.equal(p.rootElement.diagrams[0].plane.bpmnElement.id, "ApprovalProcess");
  return p;
}
const di = (p, id) => {
  const a = p.rootElement.diagrams
    .flatMap((d) => d.plane.planeElement || [])
    .filter((d) => d.bpmnElement?.id === id);
  assert.equal(a.length, 1, `one DI entry for ${id}`);
  return a[0];
};
const node = (s, id) => {
  const n = s.nodes.find((n) => n.id === id);
  assert.ok(n, id);
  return n;
};
const canonical = async (p) => (await oracle.toXML(p.rootElement, { format: true })).xml;
function label(p, state, id) {
  const drawing = di(p, id),
    display = node(state, `${id}_label`),
    b = bounds(display);
  for (const value of Object.values(b)) assert.ok(Number.isFinite(value));
  drawing.label ||= oracle.create("bpmndi:BPMNLabel");
  drawing.label.bounds ||= oracle.create("dc:Bounds");
  Object.assign(drawing.label.bounds, b);
}
export async function assertLaneSpaceResult(before, after, { undo = false, delta = 30 } = {}) {
  assert.equal(delta, 30, "this measured native fixture uses exactly30 graph units");
  const expected = await parse(before.xml),
    actual = await parse(after.xml),
    upstream = before.engine === "upstream";
  assert.equal(di(expected, "RequesterLane").bounds.height, 220);
  assert.equal(di(expected, "ReviewerLane").bounds.y, 240);
  if (!undo) {
    di(expected, "RequesterLane").bounds.height += delta;
    di(expected, "ReviewerLane").bounds.y += delta;
    for (const id of moving) di(expected, id).bounds.y += delta;
    for (const id of ["DecisionFlow", "ApproveFlow"]) {
      if (!upstream) for (const p of di(expected, id).waypoint) p.y += delta;
      // The full pinned service omits SpaceTool's start and leaves both-end
      // routes behind. This is an explicitly tested upstream defect.
    }
    const review = di(expected, "ReviewFlow"),
      start = review.waypoint[0],
      end = review.waypoint.at(-1),
      mid = (start.x + end.x) / 2;
    review.waypoint = [
      start,
      oracle.create("dc:Point", { x: mid, y: start.y }),
      oracle.create("dc:Point", { x: mid, y: end.y + delta }),
      oracle.create("dc:Point", { x: end.x, y: end.y + delta }),
    ];
    di(expected, "ReworkFlow").waypoint.at(-1).y += delta;
    const reject = di(expected, "RejectFlow"),
      first = reject.waypoint[0],
      last = reject.waypoint.at(-1);
    reject.waypoint = [
      oracle.create("dc:Point", { x: first.x, y: first.y + delta }),
      oracle.create("dc:Point", { x: first.x, y: last.y }),
      last,
    ];
  }
  if (upstream) {
    if (!undo) {
      // Installed MoveShape/DI updater appends the moved lane/flow-node DI.
      // Require its exact measured order, never sort arbitrary documents.
      const plane = expected.rootElement.diagrams[0].plane;
      assert.deepEqual(
        plane.planeElement.map((e) => e.bpmnElement.id),
        [
          "ReviewerLane",
          "RequesterLane",
          "RequestStart",
          "SubmitRequest",
          "ReviewRequest",
          "ApprovalDecision",
          "ReworkRequest",
          "ApprovedEnd",
          "SubmitFlow",
          "ReviewFlow",
          "DecisionFlow",
          "ApproveFlow",
          "RejectFlow",
          "ReworkFlow",
        ],
      );
      plane.planeElement = [
        "RequesterLane",
        "ReviewerLane",
        "RequestStart",
        "SubmitRequest",
        "ReworkRequest",
        "ReviewRequest",
        "ApprovalDecision",
        "ApprovedEnd",
        "SubmitFlow",
        "ReviewFlow",
        "DecisionFlow",
        "ApproveFlow",
        "RejectFlow",
        "ReworkFlow",
      ].map((id) => di(expected, id));
    }
    for (const id of ["RequesterLane", "ReviewerLane"]) di(expected, id).isHorizontal = true;
    for (const id of labelOwners) label(expected, undo ? before : after, id);
  } else if (!undo) {
    // Only the two relaid routes may materialize/move saved label bounds;
    // exact label placement is independently paired in the service suite.
    for (const id of ["RejectFlow", "ReworkFlow"])
      if (di(actual, id).label) label(expected, after, id);
  }
  assert.equal(
    await canonical(actual),
    await canonical(expected),
    "all unrelated semantic, DI, label and extension content remains exact",
  );
  for (const n of before.nodes.filter(
    (n) => !n.points && !n.label && Number.isFinite(n.width) && n.width > 0 && n.height > 0,
  )) {
    if (n.id === "ApprovalProcess") {
      assert.deepEqual(bounds(node(after, n.id)), bounds(n), "reference canvas root is unchanged");
      continue;
    }
    const e = di(expected, n.id);
    assert.deepEqual(bounds(node(after, n.id)), bounds(e.bounds), `displayed shape ${n.id}`);
  }
  if (!undo) {
    for (const id of ["DecisionFlow", "ApproveFlow"]) {
      const route = node(after, id).points,
        old = node(before, id).points;
      assert.deepEqual(
        route,
        old.map((p) => ({ x: p.x, y: p.y + (upstream ? 0 : delta) })),
        `${id} exact per-engine route policy`,
      );
    }
  }
}
