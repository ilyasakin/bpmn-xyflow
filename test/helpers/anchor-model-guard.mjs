/** Independent export guards for the UI-only anchor cases. No production model APIs. */
import assert from "node:assert/strict";
import { BpmnModdle } from "bpmn-moddle";

const oracle = new BpmnModdle();
async function parse(xml) {
  const parsed = await oracle.fromXML(xml);
  assert.deepEqual(parsed.warnings, [], "complete export resolves independently");
  return parsed;
}
async function canonical(root) {
  return (await oracle.toXML(root, { format: true })).xml;
}
function drawing(parsed, id) {
  const entries = parsed.rootElement.diagrams
    .flatMap((d) => d.plane.planeElement || [])
    .filter((di) => di.bpmnElement?.id === id);
  assert.equal(entries.length, 1, `one explicitly tested DI entry for ${id}`);
  return entries[0];
}
function coordinates(expected, actual, keys) {
  assert.ok(expected && actual, "existing coordinate-bearing DI objects remain present");
  for (const key of keys) {
    assert.equal(Number.isFinite(actual[key]), true, `finite ${key}`);
    expected[key] = actual[key];
  }
}

/** Permit only named coordinate changes, retaining every other semantic/DI field. */
export async function assertOnlyAnchorGeometry(
  beforeXML,
  afterXML,
  { shapeIds = [], edgeIds = [], labelIds = [] } = {},
) {
  const before = await parse(beforeXML),
    after = await parse(afterXML);
  for (const id of shapeIds)
    coordinates(drawing(before, id).bounds, drawing(after, id).bounds, [
      "x",
      "y",
      "width",
      "height",
    ]);
  for (const id of labelIds)
    coordinates(drawing(before, id).label?.bounds, drawing(after, id).label?.bounds, [
      "x",
      "y",
      "width",
      "height",
    ]);
  for (const id of edgeIds) {
    const expected = drawing(before, id),
      actual = drawing(after, id);
    assert.ok(expected.waypoint?.length >= 2 && actual.waypoint?.length >= 2);
    // These native cases have coordinate-only waypoints. Refuse a topology
    // exception for richer point metadata instead of silently dropping it.
    for (const point of expected.waypoint)
      assert.deepEqual(
        Object.keys(point)
          .filter((key) => key !== "$type")
          .sort(),
        ["x", "y"],
      );
    expected.waypoint = actual.waypoint.map((point) => {
      const result = oracle.create("dc:Point");
      coordinates(result, point, ["x", "y"]);
      return result;
    });
  }
  assert.equal(
    await canonical(after.rootElement),
    await canonical(before.rootElement),
    "only the explicitly named bounds/route coordinates may change",
  );
}

/** Remove one newly authored SequenceFlow, its two inverse refs and its DI. */
export async function assertOnlyAnchorDeletion(beforeXML, afterXML, id) {
  const before = await parse(beforeXML),
    after = await parse(afterXML),
    edge = before.elementsById[id];
  assert.equal(edge?.$type, "bpmn:SequenceFlow");
  const owner = edge.$parent;
  assert.ok(owner.flowElements?.includes(edge));
  assert.equal(edge.sourceRef.outgoing.filter((ref) => ref === edge).length, 1);
  assert.equal(edge.targetRef.incoming.filter((ref) => ref === edge).length, 1);
  owner.flowElements = owner.flowElements.filter((ref) => ref !== edge);
  edge.sourceRef.outgoing = edge.sourceRef.outgoing.filter((ref) => ref !== edge);
  edge.targetRef.incoming = edge.targetRef.incoming.filter((ref) => ref !== edge);
  assert.ok(
    before.rootElement.diagrams.some((d) =>
      d.plane.planeElement.some((di) => di.bpmnElement === edge),
    ),
  );
  for (const diagram of before.rootElement.diagrams)
    diagram.plane.planeElement = diagram.plane.planeElement.filter((di) => di.bpmnElement !== edge);
  assert.equal(
    await canonical(after.rootElement),
    await canonical(before.rootElement),
    "Delete removes only the chosen flow, its inverse refs and its DI",
  );
}
