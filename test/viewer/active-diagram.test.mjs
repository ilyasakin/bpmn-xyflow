import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM();
const { default: Viewer } = await dom.loadModule('/lib/Viewer.js');
const { parseBpmnXML, buildGraph } = await dom.loadModule('/lib/Importer.js');
const fixture = name => readFile(new URL(`../fixtures/bpmn/${name}.bpmn`, import.meta.url), 'utf8');
const viewers = [];
function create() {
  const viewer = new Viewer({ container: dom.createContainer(), fitViewOnInit: false });
  viewers.push(viewer);
  return viewer;
}
after(async () => { for (const viewer of viewers) viewer.destroy(); await dom.cleanup(); });

function assertActiveOnly(graph, diagram) {
  assert.equal(graph.diagram, diagram);
  assert.equal(graph.roots.length, 1);
  assert.equal(graph.roots[0].businessObject, diagram.plane.bpmnElement);
  const activeDI = new Set(diagram.plane.planeElement);
  for (const element of [...graph.nodes, ...graph.edges]) {
    assert.ok(activeDI.has(element.di), `${element.id} must use active-plane DI`);
    let root = element;
    while (root.parent) root = root.parent;
    assert.equal(root, graph.roots[0], `${element.id} must belong to active root`);
  }
}

for (const name of ['collapsed-sub-process', 'collapsed-sub-process-legacy', 'multiple-diagrams', 'multiple-diagrams-overlapping-di', 'multiple-nested-processes']) {
  test(`${name}: every selected diagram imports only its own plane`, async () => {
    const {rootElement: definitions} = await parseBpmnXML(await fixture(name));
    const diagrams = [...definitions.diagrams];
    const planeElements = diagrams.map(diagram => [...diagram.plane.planeElement]);
    for (const diagram of diagrams) assertActiveOnly(buildGraph(definitions, diagram), diagram);
    assert.deepEqual(definitions.diagrams, diagrams);
    diagrams.forEach((diagram, index) => assert.deepEqual(diagram.plane.planeElement, planeElements[index]));
  });
}

test('switching parent, child, back and reentry excludes all inactive SVG content', async () => {
  const viewer = create();
  await viewer.importXML(await fixture('collapsed-sub-process'));
  const definitions = viewer.getDefinitions();
  const parent = definitions.diagrams[0];
  const child = definitions.diagrams.find(diagram => diagram.plane.bpmnElement.id === 'collapsedProcess');
  const parentGraph = viewer.getGraph();
  const childOnly = child.plane.planeElement.find(di => di.bpmnElement.$type === 'bpmn:Task');
  const parentShape = parentGraph.elementsById.get('collapsedProcess');
  assert.ok(parentShape);
  assert.equal(parentGraph.elementsById.has(childOnly.bpmnElement.id), false);
  const beforePlanes = definitions.diagrams.map(diagram => diagram.plane.planeElement.map(di => di.id));
  for (let repeat = 0; repeat < 2; repeat++) {
    await viewer.switchDiagram(child.id);
    assertActiveOnly(viewer.getGraph(), child);
    assert.equal(viewer.getSvg().querySelector('[data-element-id="collapsedProcess"]'), null);
    assert.ok(viewer.getElement(childOnly.bpmnElement.id));
    await viewer.switchDiagram(parent.id, {reuseGraph: parentGraph});
    assert.equal(viewer.getGraph(), parentGraph);
    assert.equal(viewer.getElement('collapsedProcess'), parentShape);
    assert.equal(viewer.getElement(childOnly.bpmnElement.id), null);
    assert.equal(viewer.focusElement(childOnly.bpmnElement.id), false);
    const {svg} = await viewer.saveSVG();
    assert.equal(svg.includes(`data-element-id="${childOnly.bpmnElement.id}"`), false);
  }
  const {xml} = await viewer.getModdle().toXML(definitions);
  const {rootElement: exported} = await parseBpmnXML(xml);
  assert.deepEqual(exported.diagrams.map(diagram => diagram.plane.planeElement.map(di => di.id)), beforePlanes);
});

test('overlapping DI uses selected coordinates and retains sibling coordinates on export', async () => {
  const viewer = create();
  await viewer.importXML(await fixture('multiple-diagrams-overlapping-di'));
  const definitions = viewer.getDefinitions();
  const positions = definitions.diagrams.map(diagram => diagram.plane.planeElement.find(di => di.bpmnElement.id === 'Task_A').bounds.x);
  for (const index of [0,1,0,1]) {
    await viewer.switchDiagram(definitions.diagrams[index].id);
    assert.equal(viewer.getElement('Task_A').x, positions[index]);
    assert.equal(viewer.getSvg().querySelectorAll('[data-element-id="Task_A"]').length, 1);
    assertActiveOnly(viewer.getGraph(), definitions.diagrams[index]);
  }
  const {xml} = await viewer.getModdle().toXML(definitions);
  const {rootElement: exported} = await parseBpmnXML(xml);
  assert.deepEqual(exported.diagrams.map(diagram => diagram.plane.planeElement.find(di => di.bpmnElement.id === 'Task_A').bounds.x), positions);
});

test('a subprocess view does not display its outer collaboration or other pools', async () => {
  const viewer = create();
  const xml = `<?xml version="1.0"?>
  <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="test">
    <bpmn:process id="P"><bpmn:subProcess id="S"><bpmn:task id="Inner" name="Inner task"/></bpmn:subProcess></bpmn:process>
    <bpmn:process id="Other"><bpmn:task id="Outer" name="Outer task"/></bpmn:process>
    <bpmn:collaboration id="C"><bpmn:participant id="Pool1" processRef="P"/><bpmn:participant id="Pool2" processRef="Other"/></bpmn:collaboration>
    <bpmndi:BPMNDiagram id="Collaboration"><bpmndi:BPMNPlane id="CP" bpmnElement="C">
      <bpmndi:BPMNShape id="Pool1di" bpmnElement="Pool1"><dc:Bounds x="0" y="0" width="500" height="200"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Pool2di" bpmnElement="Pool2"><dc:Bounds x="0" y="300" width="500" height="200"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sdi" bpmnElement="S" isExpanded="false"><dc:Bounds x="100" y="50" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Outerdi" bpmnElement="Outer"><dc:Bounds x="100" y="350" width="100" height="80"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
    <bpmndi:BPMNDiagram id="Subprocess"><bpmndi:BPMNPlane id="SP" bpmnElement="S">
      <bpmndi:BPMNShape id="Innerdi" bpmnElement="Inner"><dc:Bounds x="50" y="50" width="100" height="80"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  </bpmn:definitions>`;
  await viewer.importXML(xml, 'Subprocess');
  assert.deepEqual(viewer.getGraph().nodes.map(node => node.id), ['Inner']);
  assert.equal(viewer.getSvg().querySelectorAll('.bpmn-xyflow-shape').length, 1);
  assert.deepEqual(viewer.findElements('Outer'), []);
  await viewer.switchDiagram('Collaboration');
  assert.ok(viewer.getElement('Pool2'));
  assert.ok(viewer.getElement('Outer'));
  assert.equal(viewer.getElement('Inner'), null);
});
