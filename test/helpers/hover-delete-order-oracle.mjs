import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

const tasks = ['SourceA', 'TargetA', 'SourceB', 'TargetB', 'SpareSource', 'SpareTarget'];
const beforeOrder = [...tasks, 'FlowA', 'FlowB'];
const restoredOrder = [...tasks, 'FlowB', 'FlowA'];
const diOrder = beforeOrder.map(id => id + '_di');
const reopenedDiOrder = restoredOrder.map(id => id + '_di');

function assertFixture(parsed, expectedDiOrder = diOrder) {
  assert.deepEqual(parsed.warnings, [], 'independent restored-fixture parse');
  const defs = parsed.rootElement, process = parsed.elementsById.HoverProcess;
  assert.equal(defs.id, 'HoverDefinitions'); assert.equal(defs.targetNamespace, 'urn:bpmn-xyflow:hover-test');
  assert.deepEqual(defs.rootElements.map(root => root.id), ['HoverProcess']); assert.equal(process.$type, 'bpmn:Process');
  assert.equal(defs.diagrams.length, 1); assert.equal(defs.diagrams[0].id, 'HoverDiagram');
  const plane = defs.diagrams[0].plane;
  assert.equal(plane.id, 'HoverPlane'); assert.equal(plane.bpmnElement, process);
  assert.deepEqual(plane.planeElement.map(di => di.id), expectedDiOrder, 'exact operation-specific DI order');
  for (const [id, source, target] of [['FlowA', 'SourceA', 'TargetA'], ['FlowB', 'SourceB', 'TargetB']]) {
    const flow = parsed.elementsById[id];
    assert.equal(flow.$type, 'bpmn:SequenceFlow');
    assert.equal(flow.$parent, process); assert.equal(flow.sourceRef, parsed.elementsById[source]); assert.equal(flow.targetRef, parsed.elementsById[target]);
  }
}

// bpmn-js 18.30.1 BpmnUpdater.updateSemanticParent appends a restored flow to
// flowElements, while DeleteConnectionHandler restores its graph child index.
// Actual editorActions.removeSelection -> Undo keeps the saved DI order intact.
// This oracle is limited to that exact authored fixture and that one operation.
export async function assertUpstreamHoverDeleteUndo(beforeXML, restoredXML) {
  const moddle = new BpmnModdle();
  const before = await moddle.fromXML(beforeXML), restored = await moddle.fromXML(restoredXML);
  for (const parsed of [before, restored]) assertFixture(parsed);
  const owner = before.elementsById.HoverProcess;
  assert.deepEqual(owner.flowElements.map(bo => bo.id), beforeOrder, 'exact authored pre-delete containment order');
  assert.deepEqual(restored.elementsById.HoverProcess.flowElements.map(bo => bo.id), restoredOrder, 'only restored FlowA moves to the end');
  owner.flowElements = restoredOrder.map(id => before.elementsById[id]);
  assert.equal((await moddle.toXML(restored.rootElement, { format: true })).xml,
    (await moddle.toXML(before.rootElement, { format: true })).xml,
    'Undo changes only the measured FlowA containment position; all other semantics, refs, metadata and DI remain exact');
  return { beforeOrder, restoredOrder, diOrder };
}

// A subsequent actual upstream import reconstructs the canvas in semantic
// order; BpmnDiOrdering then serializes FlowB_di before FlowA_di. This is a
// separate measured operation, never an allowance for local reopen/history.
export async function assertUpstreamHoverDeleteReopen(restoredXML, reopenedXML) {
  const moddle = new BpmnModdle();
  const restored = await moddle.fromXML(restoredXML), reopened = await moddle.fromXML(reopenedXML);
  assertFixture(restored); assertFixture(reopened, reopenedDiOrder);
  for (const parsed of [restored, reopened]) {
    assert.deepEqual(parsed.elementsById.HoverProcess.flowElements.map(bo => bo.id), restoredOrder,
      'reimport preserves the exact post-Undo semantic order');
  }
  const plane = restored.elementsById.HoverPlane, byId = new Map(plane.planeElement.map(di => [di.id, di]));
  plane.planeElement = reopenedDiOrder.map(id => byId.get(id));
  assert.equal((await moddle.toXML(reopened.rootElement, { format: true })).xml,
    (await moddle.toXML(restored.rootElement, { format: true })).xml,
    'reference reopen changes only FlowA_di/FlowB_di order; all other semantics, refs, metadata and geometry remain exact');
  return { semanticOrder: restoredOrder, beforeDiOrder: diOrder, reopenedDiOrder };
}
