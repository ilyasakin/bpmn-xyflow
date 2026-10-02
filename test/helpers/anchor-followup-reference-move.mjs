import assert from 'node:assert/strict';
import { assertOnlyAnchorGeometry } from './anchor-model-guard.mjs';

/** Measured pinned move ordering in the two freshly authored blank-diagram cases. */
export async function assertReferenceBodyMove(h, before, after, id) {
  const parsed = await h.oracle.fromXML(before.xml);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rootElement.diagrams.length, 1);
  const plane = parsed.rootElement.diagrams[0].plane, entries = plane.planeElement;
  const shapes = entries.filter(e => e.bounds), edges = entries.filter(e => e.waypoint);
  assert.equal(shapes.length, 2, 'this reference policy is scoped to the fresh two-shape fixture');
  assert.equal(entries.length, shapes.length + edges.length);
  assert.ok(edges.length <= 1);
  assert.deepEqual(entries, [...shapes, ...edges], 'fresh fixture puts both shapes before its optional self-loop');
  const types = shapes.map(e => e.bpmnElement.$type);
  if (edges.length) {
    assert.deepEqual(types, ['bpmn:Task','bpmn:Task'], 'fresh loop fixture contains two Tasks');
    assert.equal(shapes[0].bpmnElement.id, id, 'the fresh source Task is the first DI shape');
  } else if (types[0] === 'bpmn:StartEvent') {
    assert.deepEqual(types, ['bpmn:StartEvent','bpmn:Task']);
    assert.equal(shapes[0].bpmnElement.id, id, 'fresh StartEvent is the moved source');
  } else {
    assert.deepEqual(types, ['bpmn:Task','bpmn:EndEvent'], 'fresh target-event fixture has Task then EndEvent');
    assert.equal(shapes[1].bpmnElement.id, id, 'fresh EndEvent is the moved target');
  }
  const moved = shapes.find(e => e.bpmnElement.id === id);
  assert.ok(moved && ['bpmn:Task','bpmn:StartEvent','bpmn:EndEvent'].includes(moved.bpmnElement.$type));
  for (const edge of edges) {
    assert.equal(edge.bpmnElement.sourceRef, moved.bpmnElement);
    assert.equal(edge.bpmnElement.targetRef, moved.bpmnElement);
  }
  // Move brings that shape after its sole peer, while its own loop remains last.
  // Do not sort unrelated IDs, metadata, labels, or any other diagram.
  plane.planeElement = [...shapes.filter(e => e !== moved), moved, ...edges];
  const expected = (await h.oracle.toXML(parsed.rootElement, { format: true })).xml;
  await assertOnlyAnchorGeometry(expected, after.xml, { shapeIds: [id], edgeIds: edges.map(e => e.bpmnElement.id) });
}
