import test from 'node:test';
import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test">
<bpmn:process id="Process"><bpmn:exclusiveGateway id="Gateway"/></bpmn:process>
<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process"><bpmndi:BPMNShape id="Gateway_di" bpmnElement="Gateway"><dc:Bounds x="-288" y="-142" width="50" height="50"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

test('precise gateway loop has one reversible command and independently resolves on reopen', async () => {
  const dom = await setupDOM();
  try {
    const { default: Modeler } = await dom.loadModule('/lib/Modeler.js');
    const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, editorActions: false, snap: false });
    try {
      await m.importXML(xml);
      const before = await m.getXML(), gateway = m.getElement('Gateway'), size = m.commandStack.size();
      const edge = m.connect(gateway, gateway, { connectionStart: { x: -238, y: -117 }, connectionEnd: { x: -271.05030850274386, y: -100.13468929992416 } });
      assert.ok(edge, 'valid native-reported chosen anchors must create a loop');
      assert.equal(edge.source, gateway); assert.equal(edge.target, gateway);
      assert.equal(m.commandStack.size(), size + 1);
      const after = await m.getXML(), points = edge.waypoints.map(p => ({ x: p.x, y: p.y }));
      const parsed = await new BpmnModdle().fromXML(after);
      assert.deepEqual(parsed.warnings, []);
      const bo = parsed.elementsById[edge.id];
      assert.equal(bo.sourceRef, parsed.elementsById.Gateway); assert.equal(bo.targetRef, parsed.elementsById.Gateway);
      m.undo(); assert.equal(await m.getXML(), before);
      m.redo(); assert.equal(await m.getXML(), after);
      await m.importXML(after);
      assert.deepEqual(m.getElement(edge.id).waypoints.map(p => ({ x: p.x, y: p.y })), points);
    } finally { m.destroy(); }
  } finally { await dom.cleanup(); }
});
