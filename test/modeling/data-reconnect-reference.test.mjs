import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

const require = createRequire(import.meta.url);
assert.equal(require('bpmn-js/package.json').version, '18.30.1');
let dom, Local, Upstream, artifact = 0;
before(async () => {
  dom = await setupDOM();
  ({ default: Local } = await dom.loadModule('/lib/Modeler.js'));
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
});
after(() => dom.cleanup());

function fixture(authored) {
  const io = authored ? `
    <bpmn:ioSpecification id="A_IO" qa:trace="io">
      <bpmn:dataInput id="A_Input" name="Authored input" qa:trace="input"><bpmn:documentation>Keep input documentation</bpmn:documentation></bpmn:dataInput>
      <bpmn:dataOutput id="A_Output" name="Authored output" qa:trace="output"><bpmn:documentation>Keep output documentation</bpmn:documentation></bpmn:dataOutput>
      <bpmn:inputSet id="A_InputSet" qa:trace="input-set"><bpmn:dataInputRefs>A_Input</bpmn:dataInputRefs></bpmn:inputSet>
      <bpmn:outputSet id="A_OutputSet" qa:trace="output-set"><bpmn:dataOutputRefs>A_Output</bpmn:dataOutputRefs></bpmn:outputSet>
    </bpmn:ioSpecification>
    <bpmn:dataInputAssociation id="InputAssociation" qa:trace="input-association"><bpmn:documentation>Keep association documentation</bpmn:documentation><bpmn:sourceRef>D1</bpmn:sourceRef><bpmn:targetRef>A_Input</bpmn:targetRef><bpmn:transformation>preserve(input)</bpmn:transformation></bpmn:dataInputAssociation>
    <bpmn:dataOutputAssociation id="OutputAssociation" qa:trace="output-association"><bpmn:documentation>Keep output association</bpmn:documentation><bpmn:sourceRef>A_Output</bpmn:sourceRef><bpmn:targetRef>D1</bpmn:targetRef></bpmn:dataOutputAssociation>` : '';
  const shapes = [ [ 'A', 400, 200, 100, 80 ], [ 'B', 700, 200, 100, 80 ], [ 'D1', 100, 200, 36, 50 ], [ 'D2', 100, 400, 36, 50 ] ]
    .map(([ id, x, y, width, height ]) => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}"/></bpmndi:BPMNShape>`).join('');
  const edges = authored ? '<bpmndi:BPMNEdge id="InputAssociation_di" bpmnElement="InputAssociation"><di:waypoint x="136" y="225"/><di:waypoint x="400" y="240"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="OutputAssociation_di" bpmnElement="OutputAssociation"><di:waypoint x="400" y="260"/><di:waypoint x="136" y="245"/></bpmndi:BPMNEdge>' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:qa="urn:data-reconnect-review" id="Definitions" targetNamespace="urn:data-reconnect-review">
  <bpmn:process id="Process" isExecutable="false"><bpmn:task id="A" name="Owner A">${io}</bpmn:task><bpmn:task id="B" name="Owner B"/><bpmn:dataObject id="Data1"/><bpmn:dataObject id="Data2"/><bpmn:dataObjectReference id="D1" dataObjectRef="Data1"/><bpmn:dataObjectReference id="D2" dataObjectRef="Data2"/></bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process">${shapes}${edges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}

// Include descriptor-owned references, which official moddle may make
// non-enumerable, as well as opaque attributes and owned documentation.
function tree(object) {
  if (!object || typeof object !== 'object') return object;
  const result = { $type: object.$type };
  for (const property of object.$descriptor?.properties || []) {
    if (property.isVirtual || !Object.hasOwn(object, property.name)) continue;
    const value = object[property.name];
    result[property.name] = property.isReference
      ? Array.isArray(value) ? value.map(entry => entry?.id) : value?.id
      : Array.isArray(value) ? value.map(tree) : typeof value === 'object' ? tree(value) : value;
  }
  if (Object.keys(object.$attrs || {}).length) result.$attrs = { ...object.$attrs };
  return result;
}
function metadata(association) {
  const result = tree(association);
  delete result.sourceRef; delete result.targetRef;
  return result;
}
async function editor(engine, authored = false) {
  const modeler = new (engine === 'local' ? Local : Upstream)({ container: dom.createContainer(), fitViewOnInit: false, palette: false });
  assert.deepEqual((await modeler.importXML(fixture(authored))).warnings, []);
  const get = id => engine === 'local' ? modeler.getElement(id) : modeler.get('elementRegistry').get(id);
  const modeling = engine === 'local' ? modeler : modeler.get('modeling');
  const xml = async () => engine === 'local' ? modeler.getXML() : (await modeler.saveXML({ format: true })).xml;
  const reconnect = (edge, side, id) => {
    if (engine === 'local') assert.ok(modeler.reconnect(edge, side, get(id)));
    else modeling[side === 'source' ? 'reconnectStart' : 'reconnectEnd'](edge, get(id), id === 'B' ? { x: 700, y: 240 } : { x: 136, y: id === 'D1' ? 225 : 425 });
  };
  return { modeler, get, modeling, xml, reconnect };
}
async function valid(xml) {
  assert.deepEqual((await new BpmnModdle().fromXML(xml)).warnings, []);
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `data-reconnect-${++artifact}.bpmn`), xml);
  }
}
async function action(context, callback) {
  const { modeler, xml } = context;
  const beforeXML = await xml(), count = modeler.commandStack?.size();
  callback();
  const afterXML = await xml();
  if (modeler.commandStack) {
    assert.equal(modeler.commandStack.size(), count + 1);
    for (let i = 0; i < 3; i++) {
      modeler.undo(); assert.equal(await xml(), beforeXML, 'local Undo restores complete exact XML');
      modeler.redo(); assert.equal(await xml(), afterXML, 'local Redo restores complete exact XML');
    }
  }
  return afterXML;
}

for (const engine of [ 'upstream', 'local' ]) for (const authored of [ false, true ]) for (const input of [ true, false ]) {
  test(`${engine}: ${authored ? 'authored' : 'fresh'} ${input ? 'input' : 'output'} reconnect preserves IO through repeated external changes`, async () => {
    const context = await editor(engine, authored), { modeler, get, modeling, xml, reconnect } = context;
    try {
      const ownerA = get('A').businessObject, ownerB = get('B').businessObject;
      const edge = authored ? get(input ? 'InputAssociation' : 'OutputAssociation')
        : modeling.connect(input ? get('D1') : get('A'), input ? get('A') : get('D1'), { type: input ? 'bpmn:DataInputAssociation' : 'bpmn:DataOutputAssociation' });
      assert.ok(edge);
      const originalIO = ownerA.ioSpecification, originalIOData = tree(originalIO), originalMetadata = metadata(edge.businessObject);
      const originalItem = input ? edge.businessObject.targetRef : edge.businessObject.sourceRef?.[0];
      const originalOutputRefs = (edge.businessObject.sourceRef || []).slice();
      const ioMembers = authored ? [ ...originalIO.dataInputs, ...originalIO.dataOutputs, ...originalIO.inputSets, ...originalIO.outputSets ] : [];
      if (!authored) {
        assert.equal(originalIO, undefined, 'fresh association does not allocate an IO specification');
        if (input) {
          assert.equal(originalItem.$type, 'bpmn:Property'); assert.equal(originalItem.name, '__targetRef_placeholder');
          assert.deepEqual(ownerA.properties, [ originalItem ]);
        } else assert.equal((edge.businessObject.sourceRef || []).length, 0, 'fresh output needs no generated source item');
      }
      let reusedInput;
      for (const source of [ 'D2', 'D1', 'D2' ]) {
        await action(context, () => reconnect(edge, input ? 'source' : 'target', source));
        const association = edge.businessObject;
        assert.equal(association.$parent, ownerA);
        assert.equal(input ? association.sourceRef[0] : association.targetRef, get(source).businessObject);
        assert.equal(ownerA.ioSpecification, originalIO); assert.deepEqual(tree(originalIO), originalIOData, 'all original IO IDs, sets, refs and metadata remain unchanged');
        assert.deepEqual(metadata(association), originalMetadata);
        if (input) {
          if (authored && engine === 'upstream') {
            // Measured upstream normalization, deliberately not copied locally:
            // it replaces the authored input ref with its Property placeholder.
            assert.equal(association.targetRef.$type, 'bpmn:Property');
            assert.equal(association.targetRef.name, '__targetRef_placeholder');
            assert.notEqual(association.targetRef, originalItem);
          } else assert.equal(association.targetRef, originalItem, 'external-only edit retains the existing owner endpoint');
          reusedInput ||= association.targetRef; assert.equal(association.targetRef, reusedInput);
        } else assert.deepEqual(association.sourceRef || [], originalOutputRefs, 'external output reconnect retains all authored sources');
      }
      await valid(await xml());
      await action(context, () => reconnect(edge, input ? 'target' : 'source', 'B'));
      const association = edge.businessObject, key = input ? 'dataInputAssociations' : 'dataOutputAssociations';
      assert.equal(association.$parent, ownerB); assert.ok(ownerB[key].includes(association)); assert.ok(!(ownerA[key] || []).includes(association));
      assert.equal(ownerB.ioSpecification, undefined); assert.equal(ownerA.ioSpecification, originalIO); assert.deepEqual(tree(originalIO), originalIOData);
      if (authored) assert.deepEqual([ ...originalIO.dataInputs, ...originalIO.dataOutputs, ...originalIO.inputSets, ...originalIO.outputSets ], ioMembers);
      assert.deepEqual(metadata(association), originalMetadata);
      if (input) {
        assert.equal(association.targetRef.$type, 'bpmn:Property'); assert.equal(association.targetRef.name, '__targetRef_placeholder');
        assert.ok(ownerB.properties.includes(association.targetRef)); assert.notEqual(association.targetRef, reusedInput);
        assert.equal((ownerA.properties || []).filter(property => property.name === '__targetRef_placeholder').length, 0, 'unused plain old placeholder is removed');
      } else assert.deepEqual(association.sourceRef || [], originalOutputRefs, 'output owner change preserves authored source refs, as pinned upstream does');
      await valid(await xml());
    } finally { modeler.destroy(); }
  });
}

test('local multiple input associations share one placeholder and clean it only after its last use', async () => {
  const context = await editor('local'), { modeler, get, modeling, reconnect, xml } = context;
  try {
    const first = modeling.connect(get('D1'), get('A')), second = modeling.connect(get('D2'), get('A'));
    const old = first.businessObject.targetRef;
    assert.equal(second.businessObject.targetRef, old); assert.deepEqual(get('A').businessObject.properties, [ old ]);
    await action(context, () => reconnect(first, 'target', 'B'));
    assert.deepEqual(get('A').businessObject.properties, [ old ]);
    const next = first.businessObject.targetRef;
    await action(context, () => reconnect(second, 'target', 'B'));
    assert.equal(second.businessObject.targetRef, next); assert.deepEqual(get('B').businessObject.properties, [ next ]);
    assert.equal((get('A').businessObject.properties || []).length, 0);
    assert.equal(get('A').businessObject.ioSpecification, undefined); assert.equal(get('B').businessObject.ioSpecification, undefined);
    await valid(await xml());
  } finally { modeler.destroy(); }
});

test('local owner changes retain metadata-bearing or externally referenced old placeholders', async () => {
  for (const protection of [ 'metadata', 'reference' ]) {
    const context = await editor('local'), { modeler, get, modeling, reconnect, xml } = context;
    try {
      const edge = modeling.connect(get('D1'), get('A')), old = edge.businessObject.targetRef;
      if (protection === 'metadata') old.$attrs['qa:trace'] = 'retained-placeholder-metadata';
      else {
        const definitions = modeler.getDefinitions();
        const relation = modeler.getModdle().create('bpmn:Relationship', { id: 'WatchPlaceholder', type: 'trace', source: [ old ], target: [ get('A').businessObject ] });
        relation.$parent = definitions; definitions.relationships = [ relation ];
      }
      const snapshot = tree(old);
      await action(context, () => reconnect(edge, 'target', 'B'));
      assert.ok(get('A').businessObject.properties.includes(old)); assert.deepEqual(tree(old), snapshot);
      if (protection === 'reference') assert.equal(modeler.getDefinitions().relationships[0].source[0], old);
      await valid(await xml());
    } finally { modeler.destroy(); }
  }
});

test('local deleting input associations cleans only the last plain placeholder and restores original identities', async () => {
  for (const protection of [ 'plain', 'shared', 'metadata', 'reference' ]) {
    const context = await editor('local'), { modeler, get, modeling, xml } = context;
    try {
      const owner = get('A').businessObject, edge = modeling.connect(get('D1'), get('A'));
      const property = edge.businessObject.targetRef, properties = owner.properties;
      let peer;
      if (protection === 'shared') peer = modeling.connect(get('D2'), get('A'));
      if (protection === 'metadata') property.$attrs['qa:trace'] = 'retained';
      if (protection === 'reference') {
        const definitions = modeler.getDefinitions();
        const relation = modeler.getModdle().create('bpmn:Relationship', { id: 'DeleteWatch', type: 'trace', source: [ property ], target: [ owner ] });
        relation.$parent = definitions; definitions.relationships = [ relation ];
      }
      await action(context, () => modeler.delete(edge));
      assert.equal(properties.includes(property), protection !== 'plain');
      if (peer) {
        assert.equal(peer.businessObject.targetRef, property);
        await action(context, () => modeler.delete(peer));
        assert.equal(properties.includes(property), false);
      }
      const after = await xml();
      modeler.undo();
      assert.equal(owner.properties, properties, 'Undo restores the original properties array');
      assert.ok(properties.includes(property), 'Undo restores the original Property object');
      assert.equal(property.$parent, owner);
      modeler.redo(); assert.equal(await xml(), after);
      await valid(after);
    } finally { modeler.destroy(); }
  }
});

test('a saved plain placeholder is reused after reimport and cleaned when its owner changes', async () => {
  const context = await editor('local'), { modeler, get, modeling, xml, reconnect } = context;
  try {
    const created = modeling.connect(get('D1'), get('A')), id = created.id;
    const placeholderId = created.businessObject.targetRef.id;
    assert.deepEqual((await modeler.importXML(await xml())).warnings, []);
    const edge = get(id), owner = get('A').businessObject, property = edge.businessObject.targetRef, properties = owner.properties;
    assert.equal(property.id, placeholderId); assert.deepEqual(properties, [ property ]);
    await action(context, () => reconnect(edge, 'source', 'D2'));
    assert.equal(edge.businessObject.targetRef, property); assert.equal(owner.properties, properties);
    await action(context, () => reconnect(edge, 'target', 'B'));
    assert.equal(properties.length, 0); assert.equal(get('B').businessObject.properties.length, 1);
    modeler.undo(); assert.equal(owner.properties, properties); assert.deepEqual(properties, [ property ]); assert.equal(property.$parent, owner);
    modeler.redo(); await valid(await xml());
  } finally { modeler.destroy(); }
});
