import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

// Complete only this authored setup fixture before testing creation/reopen.
// Importing its raw form derives the two inverse sequence-flow references and
// emits xsi; those initial setup changes are not a mutation/reopen baseline.
export async function prepareGroupPaintFixture(xml) {
  const moddle = new BpmnModdle(), parsed = await moddle.fromXML(xml);
  assert.deepEqual(parsed.warnings, []);
  const { rootElement: definitions, elementsById: ids } = parsed;
  assert.equal(definitions.id, 'GroupDefinitions');
  assert.equal(ids.Frame.$type, 'bpmn:Group');
  assert.equal(ids.Frame.categoryValueRef, undefined);
  assert.equal(ids.Frame.$parent, ids.Process_1);
  assert.equal(ids.Flow.$type, 'bpmn:SequenceFlow');
  assert.equal(ids.Flow.sourceRef, ids.Source); assert.equal(ids.Flow.targetRef, ids.Target);
  assert.equal(Object.hasOwn(ids.Source, 'outgoing'), false);
  assert.equal(Object.hasOwn(ids.Target, 'incoming'), false);
  assert.equal(definitions.$attrs['xmlns:xsi'], undefined);
  assert.equal(definitions.diagrams.length, 1);
  const plane = definitions.diagrams[0].plane;
  assert.equal(plane.id, 'Plane_1');
  assert.equal(plane.planeElement.filter(di => di.bpmnElement === ids.Frame).length, 1);
  ids.Process_1.artifacts = ids.Process_1.artifacts.filter(element => element !== ids.Frame);
  plane.planeElement = plane.planeElement.filter(di => di.bpmnElement !== ids.Frame);
  ids.Source.outgoing = [ ids.Flow ]; ids.Target.incoming = [ ids.Flow ];
  definitions.$attrs['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
  return (await moddle.toXML(definitions, { format: true })).xml;
}
