import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

// Measured pinned bundle behavior: owner-only GroupA deletion cascades through
// its label, and LabelBehavior clears the value shared by surviving GroupB.
// This exception applies only to this upstream fixture; local keeps the value.
export async function assertUpstreamSharedGroupDelete(beforeXML, afterXML) {
  const moddle = new BpmnModdle();
  const before = await moddle.fromXML(beforeXML), after = await moddle.fromXML(afterXML);
  assert.deepEqual(before.warnings, []); assert.deepEqual(after.warnings, []);
  assert.equal(before.rootElement.id, 'GroupDefinitions');
  const ids = before.elementsById, group = ids.GroupA, peer = ids.GroupB;
  assert.equal(group?.$type, 'bpmn:Group'); assert.equal(peer?.$type, 'bpmn:Group');
  assert.equal(group.$parent.id, 'Process_1');
  assert.equal(group.categoryValueRef, peer.categoryValueRef);
  assert.equal(group.categoryValueRef.id, 'ReviewValue');
  assert.equal(group.categoryValueRef.$parent.id, 'ReviewCategory');
  assert.equal(group.categoryValueRef.value, 'Renamed shared category');
  assert.equal(after.elementsById.GroupA, undefined);
  assert.equal(after.elementsById.GroupB?.categoryValueRef?.id, 'ReviewValue');
  assert.equal(after.elementsById.ReviewValue?.value, undefined);
  group.$parent.artifacts = group.$parent.artifacts.filter(element => element !== group);
  const entries = before.rootElement.diagrams.flatMap(diagram => diagram.plane.planeElement);
  assert.deepEqual(entries.filter(di => di.bpmnElement === group).map(di => di.id), [ 'GroupA_di' ]);
  for (const diagram of before.rootElement.diagrams) diagram.plane.planeElement = diagram.plane.planeElement.filter(di => di.bpmnElement !== group);
  delete group.categoryValueRef.value;
  assert.equal((await moddle.toXML(after.rootElement, { format: true })).xml,
    (await moddle.toXML(before.rootElement, { format: true })).xml,
    'upstream may remove only GroupA/its DI and clear the one measured shared value');
}
