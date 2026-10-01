import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';

// This fixture is independent of the source modeling tests. The implementation
// under test is supplied by consumer-smoke from the extracted package bundle.
export const ioReplacementFixture = `<?xml version="1.0" encoding="UTF-8"?>
<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:di="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:dd="http://www.omg.org/spec/DD/20100524/DI" xmlns:v="urn:packed-consumer:metadata"
  id="Definitions_IO" targetNamespace="urn:packed-consumer:io">
  <b:process id="Process_IO" isExecutable="false">
    <b:task id="Owner" name="Keep owner metadata" v:flag="retained">
      <b:documentation>Retain documentation during conversion</b:documentation>
      <b:extensionElements><v:record>Before<!--owned metadata-->after<?audit keep?></v:record></b:extensionElements>
      <b:ioSpecification id="OwnedIO">
        <b:dataInput id="OwnedInput"/><b:dataOutput id="OwnedOutput"/>
        <b:inputSet id="OwnedInputSet"><b:dataInputRefs>OwnedInput</b:dataInputRefs></b:inputSet>
        <b:outputSet id="OwnedOutputSet"><b:dataOutputRefs>OwnedOutput</b:dataOutputRefs></b:outputSet>
      </b:ioSpecification>
      <b:property id="RetainedProperty" name="retained property"/>
      <b:dataInputAssociation id="InputAssociation"><b:sourceRef>ExternalData</b:sourceRef><b:targetRef>OwnedInput</b:targetRef></b:dataInputAssociation>
      <b:dataOutputAssociation id="OutputAssociation"><b:sourceRef>OwnedOutput</b:sourceRef><b:targetRef>ExternalData</b:targetRef></b:dataOutputAssociation>
    </b:task>
    <b:dataObject id="Data"/><b:dataObjectReference id="ExternalData" dataObjectRef="Data"/>
  </b:process>
  ${['Active', 'Other'].map(plane => `<di:BPMNDiagram id="${plane}Diagram"><di:BPMNPlane id="${plane}Plane" bpmnElement="Process_IO">
    <di:BPMNShape id="${plane}OwnerDI" bpmnElement="Owner"><dc:Bounds x="300" y="160" width="100" height="80"/></di:BPMNShape>
    <di:BPMNShape id="${plane}DataDI" bpmnElement="ExternalData"><dc:Bounds x="120" y="172" width="36" height="50"/></di:BPMNShape>
    <di:BPMNEdge id="${plane}InputDI" bpmnElement="InputAssociation"><dd:waypoint x="156" y="184"/><dd:waypoint x="300" y="184"/></di:BPMNEdge>
    <di:BPMNEdge id="${plane}OutputDI" bpmnElement="OutputAssociation"><dd:waypoint x="300" y="216"/><dd:waypoint x="156" y="216"/></di:BPMNEdge>
  </di:BPMNPlane></di:BPMNDiagram>`).join('\n')}
</b:definitions>`;

async function independentlyParse(xml) {
  const result = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(result.warnings, [], 'packed conversion must reopen without independent parser warnings');
  return result;
}

export async function checkIOReplacement(api, dom) {
  const target = { type: 'bpmn:IntermediateCatchEvent', eventDefinitionType: 'bpmn:MessageEventDefinition' };
  const modeler = new api.Modeler({ container: dom.createContainer(), palette: false, fitViewOnInit: false });
  const viewer = new api.Viewer({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    await independentlyParse(ioReplacementFixture);
    await modeler.importXML(ioReplacementFixture);
    const owner = modeler.getElement('Owner');
    const original = owner.businessObject, io = original.ioSpecification;
    const property = original.properties[0];
    const originalEdges = ['InputAssociation', 'OutputAssociation'].map(id => modeler.getElement(id));
    assert.ok(originalEdges.every(Boolean), 'both owned associations must be rendered before conversion');
    const before = await modeler.getXML(), history = modeler.commandStack.size();
    for (const options of [{}, { removeIncompatibleData: false }, { removeIncompatibleData: 'yes' }, { removeIncompatibleData: null }]) {
      assert.equal(modeler.replace(owner, target, {}, options), null);
      assert.equal(await modeler.getXML(), before, 'refusal must preserve exact XML');
      assert.equal(modeler.commandStack.size(), history, 'refusal must not add a command');
      assert.equal(owner.businessObject, original);
    }
    assert.equal(modeler.replace(owner, target, {}, { removeIncompatibleData: true }), owner);
    const converted = owner.businessObject;
    assert.equal(converted.$type, 'bpmn:IntermediateCatchEvent');
    assert.equal(converted.eventDefinitions[0].$type, 'bpmn:MessageEventDefinition');
    assert.equal(converted.id, original.id);
    assert.equal(converted.name, original.name);
    assert.equal(converted.$attrs['v:flag'], 'retained');
    assert.equal(converted.documentation[0].text, original.documentation[0].text);
    assert.equal(converted.properties[0], property, 'compatible Property ownership preserves identity');
    assert.equal(property.$parent, converted);
    assert.equal(converted.ioSpecification, undefined);
    assert.equal(modeler.commandStack.size(), history + 1, 'cleanup and conversion are one command');
    for (const edge of originalEdges) assert.equal(modeler.getElement(edge.id), null);
    const after = await modeler.getXML();
    assert.match(after, /Before<!--owned metadata-->after<\?audit keep\?>/);
    const parsed = await independentlyParse(after);
    for (const id of ['OwnedIO', 'OwnedInput', 'OwnedOutput', 'OwnedInputSet', 'OwnedOutputSet', 'InputAssociation', 'OutputAssociation']) {
      assert.equal(parsed.elementsById[id], undefined, `removed IO identity ${id} must not survive export`);
    }
    assert.ok(parsed.elementsById.ExternalData);
    for (const diagram of parsed.rootElement.diagrams) {
      assert.deepEqual(diagram.plane.planeElement.map(item => item.bpmnElement.id), ['Owner', 'ExternalData']);
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      modeler.undo();
      assert.equal(await modeler.getXML(), before, 'undo restores exact source XML');
      assert.equal(owner.businessObject, original);
      assert.equal(original.ioSpecification, io);
      assert.equal(original.properties[0], property);
      assert.equal(property.$parent, original);
      for (const edge of originalEdges) assert.equal(modeler.getElement(edge.id), edge);
      modeler.redo();
      assert.equal(await modeler.getXML(), after, 'redo restores exact converted XML');
      assert.equal(owner.businessObject, converted);
    }
    await viewer.importXML(after);
    assert.equal(viewer.getElement('Owner').type, 'bpmn:IntermediateCatchEvent');
    assert.equal(viewer.getGraph().edges.length, 0);

    // Removing subprocess content and removing owned IO are independent choices.
    await modeler.importXML(ioReplacementFixture);
    const sub = modeler.addShape('bpmn:SubProcess', { x: 650, y: 400 });
    const child = modeler.addShape('bpmn:Task', { x: 650, y: 400 }, { parent: sub });
    const association = modeler.connect(modeler.getElement('ExternalData'), sub);
    assert.ok(sub && child && association);
    const compoundBefore = await modeler.getXML(), compoundHistory = modeler.commandStack.size();
    for (const options of [{ removeContents: true }, { removeIncompatibleData: true }]) {
      assert.equal(modeler.replace(sub, target, {}, options), null);
      assert.equal(await modeler.getXML(), compoundBefore);
      assert.equal(modeler.commandStack.size(), compoundHistory);
    }
    assert.equal(modeler.replace(sub, target, {}, { removeContents: true, removeIncompatibleData: true }), sub);
    assert.equal(modeler.getElement(child.id), null);
    assert.equal(modeler.getElement(association.id), null);
    assert.equal(modeler.commandStack.size(), compoundHistory + 1);
    await independentlyParse(await modeler.getXML());
    modeler.undo();
    assert.equal(await modeler.getXML(), compoundBefore);
    assert.equal(modeler.getElement(child.id), child);
    assert.equal(modeler.getElement(association.id), association);
    console.log('PASS packed consumer IO replacement: refusal, explicit cleanup, two-plane DI, metadata, owned identities, combined options, exact undo/redo and reopen');
  } finally {
    viewer.destroy();
    modeler.destroy();
  }
}
