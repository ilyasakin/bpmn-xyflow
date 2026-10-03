import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

let dom, Modeler, Upstream, artifact = 0;
const xy = points => points.map(({ x, y }) => ({ x, y }));
const bounds = node => Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, node[key]]));
before(async () => {
  dom = await setupDOM();
  dom.window.SVGTransformList.prototype.createSVGTransformFromMatrix = function(matrix) {
    const transform = document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGTransform();
    transform.setMatrix(matrix); return transform;
  };
  ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js'));
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
});
after(async () => dom.cleanup());
async function save(m) {
  const xml = await m.getXML(), parsed = await new BpmnModdle().fromXML(xml);
  assert.deepEqual(parsed.warnings, []);
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `anchor-docking-${++artifact}.bpmn`), xml);
  }
  return xml;
}
async function editor(xml) {
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, snap: false, palette: false });
  assert.deepEqual((await m.importXML(xml)).warnings, []); return m;
}
async function onlyGeometry(before, after, movedIds, edgeIds) {
  const oracle = new BpmnModdle(), a = await oracle.fromXML(before), b = await oracle.fromXML(after);
  for (const id of movedIds) {
    const original = Object.values(a.elementsById).find(value => value.$type === 'bpmndi:BPMNShape' && value.bpmnElement?.id === id);
    const changed = b.elementsById[original.id];
    Object.assign(changed.bounds, bounds(original.bounds));
  }
  for (const id of edgeIds) {
    const original = Object.values(a.elementsById).find(value => value.$type === 'bpmndi:BPMNEdge' && value.bpmnElement?.id === id);
    b.elementsById[original.id].waypoint = original.waypoint;
  }
  assert.equal((await oracle.toXML(b.rootElement, { format: true })).xml, (await oracle.toXML(a.rootElement, { format: true })).xml,
    'all semantic objects, references, IDs, edge metadata and unrelated DI remain unchanged');
}
async function exactHistory(m, before, after, edge, originalPoints) {
  for (let i = 0; i < 3; i++) {
    assert.equal(m.undo(), true); assert.equal(await m.getXML(), before);
    if (originalPoints) assert.deepEqual(edge.di.waypoint, originalPoints);
    assert.equal(m.redo(), true); assert.equal(await m.getXML(), after);
  }
  const route = xy(edge.waypoints), edgeId = edge.id;
  await m.importXML(after); assert.deepEqual(xy(m.getElement(edgeId).waypoints), route);
  assert.equal(await m.getXML(), after);
}
function onOutline(point, shape) {
  const dx = point.x - shape.x - shape.width / 2, dy = point.y - shape.y - shape.height / 2;
  const distance = shape.type.endsWith('Event') ? Math.hypot(dx, dy) / (shape.width / 2)
    : Math.abs(dx) / (shape.width / 2) + Math.abs(dy) / (shape.height / 2);
  assert.ok(Math.abs(distance - 1) < 1e-8, JSON.stringify({ point, shape: bounds(shape), distance }));
}

for (const operation of ['move', 'resize']) test(`reported native circle ${operation} fixture preserves precise docking and complete XML history`, async () => {
  let xml = await readFile(`test/fixtures/anchor-ux/native-circle-before-${operation}.bpmn`, 'utf8');
  const edgeId = operation === 'move' ? 'SequenceFlow_muqa30xw_8' : 'SequenceFlow_muqa8jd9_9';
  xml = xml.replace(`bpmnElement="${edgeId}">`, `bpmnElement="${edgeId}" xmlns:v="urn:anchor-docking" v:note="retain edge">`);
  const start = xml.indexOf(`bpmnElement="${edgeId}" xmlns:v=`), end = xml.indexOf('</bpmndi:BPMNEdge>', start);
  assert.ok(start > 0 && end > start);
  const segment = xml.slice(start, end).replace(/(<di:waypoint[^>]*)( \/>|\/>)/g, '$1><!--waypoint content--><?retain exact?></di:waypoint>');
  xml = xml.slice(0, start) + segment + xml.slice(end);
  const m = await editor(xml);
  try {
    const source = m.getElement('Task_muqa1yix_5'), target = m.getElement('EndEvent_muqa25gc_6'), edge = m.getElement(edgeId);
    const before = await m.getXML(), points = edge.di.waypoint.slice(), targetBounds = bounds(target), old = xy(edge.waypoints), count = m.commandStack.size();
    if (operation === 'move') m.moveShape(source, { x: -1, y: 17 });
    else assert.equal(m.resizeShape(source, { ...bounds(source), width: 104, height: 84 }), source);
    assert.equal(m.commandStack.size(), count + 1); assert.deepEqual(bounds(target), targetBounds);
    assert.deepEqual(xy([edge.waypoints.at(-1)]), [old.at(-1)]); onOutline(edge.waypoints.at(-1), target);
    assert.equal(edge.waypoints[0].x, source.x + source.width, 'Task keeps its chosen right side for the documented resize extension');
    if (operation === 'resize') assert.equal(edge.waypoints[0].y, source.y + 42);
    assert.equal(edge.di.waypoint[0], points[0]); assert.equal(edge.di.waypoint.at(-1), points.at(-1));
    const changed = await save(m);
    assert.ok(changed.includes('v:note="retain edge"')); assert.ok(changed.includes('<!--waypoint content--><?retain exact?>'));
    await onlyGeometry(before, changed, [source.id], m.getGraph().edges.filter(item => item.source === source || item.target === source).map(item => item.id));
    await exactHistory(m, before, changed, edge, points);
  } finally { m.destroy(); }
});

test('actual pinned move repairs opposite circle docking with interior originals and local keeps unrounded outline coordinates', async () => {
  const xml = await readFile('test/fixtures/anchor-ux/native-circle-before-move.bpmn', 'utf8');
  const upstream = new Upstream({ container: dom.createContainer() });
  try {
    await upstream.importXML(xml);
    const registry = upstream.get('elementRegistry'), edge = registry.get('SequenceFlow_muqa30xw_8'), source = registry.get('Task_muqa1yix_5');
    assert.deepEqual(edge.waypoints.at(-1).original, { x: 277, y: 109 });
    const before = (await upstream.saveXML({ format: true })).xml;
    upstream.get('modeling').moveShape(source, { x: -1, y: 17 });
    assert.deepEqual(xy(edge.waypoints), [{ x: 235, y: 137 }, { x: 247, y: 137 }, { x: 247, y: 109 }, { x: 262, y: 109 }]);
    upstream.get('commandStack').undo(); assert.equal((await upstream.saveXML({ format: true })).xml, before);
  } finally { upstream.destroy(); }
});

test('fresh/reopened circle-perimeter and gateway-vertex routes retain their per-type policy and waypoint metadata', async () => {
  for (const kind of ['bpmn:IntermediateThrowEvent', 'bpmn:ExclusiveGateway']) for (const reverse of [false, true]) {
    const m = await editor(await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'));
    try {
      const task = m.addShape('bpmn:Task', { x: 450, y: 400 }), endpoint = m.addShape(kind, { x: 650, y: 400 });
      const offset = -9.62781199085381, r = endpoint.width / 2, dock = { x: 650 - (kind.endsWith('Event') ? Math.sqrt(r * r - offset * offset) : r - Math.abs(offset)), y: 400 + offset };
      const source = reverse ? endpoint : task, target = reverse ? task : endpoint;
      const start = reverse ? dock : { x: 500, y: 400 + offset }, end = reverse ? { x: 500, y: 400 + offset } : dock;
      const edge = m.connect(source, target, { connectionStart: start, connectionEnd: end }); assert.ok(edge);
      const chosen = kind.endsWith('Gateway') ? { x: endpoint.x, y: endpoint.y + endpoint.height / 2 } : dock;
      assert.deepEqual(xy([edge.waypoints[0], edge.waypoints.at(-1)]), reverse ? [chosen,end] : [start,chosen]);
      edge.waypoints[reverse ? 0 : edge.waypoints.length - 1].original.note = 'logical metadata';
      edge.waypoints[reverse ? edge.waypoints.length - 1 : 0].original.note = 'moved logical metadata';
      const before = await m.getXML(), original = structuredClone(edge.waypoints), id = edge.id, taskId = task.id;
      m.moveShape(task, { x: 400, y: 0 });
      const after = await save(m), fixed = edge.waypoints[reverse ? 0 : edge.waypoints.length - 1];
      onOutline(fixed, endpoint); assert.ok(fixed.x > 650, 'opposite endpoint changes to its right outline');
      if(kind.endsWith('Gateway')) assert.deepEqual({x:fixed.x,y:fixed.y},{x:endpoint.x+endpoint.width,y:endpoint.y+endpoint.height/2});
      assert.equal(fixed.original.note, 'logical metadata');
      assert.equal(edge.waypoints[reverse ? edge.waypoints.length - 1 : 0].original.note, 'moved logical metadata');
      assert.ok(edge.waypoints[reverse ? edge.waypoints.length - 1 : 0].x < task.x + task.width, 'Task exits on its left facing side');
      for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); assert.deepEqual(edge.waypoints, original); m.redo(); assert.equal(await m.getXML(), after); }
      await m.importXML(before); const importedEdge = m.getElement(id), importedTask = m.getElement(taskId);
      m.moveShape(importedTask, { x: 400, y: 0 }); assert.deepEqual(xy(importedEdge.waypoints), xy(edge.waypoints));
      await save(m);
    } finally { m.destroy(); }
  }
});

test('inaccessible resized Task anchors refuse atomically, retaining both incident routes and all history', async () => {
  const m = await editor(await readFile('test/fixtures/anchor-ux/native-circle-before-resize.bpmn', 'utf8'));
  try {
    const task = m.getElement('Task_muqa1yix_5'), before = await m.getXML(), snapshot = bounds(task), count = m.commandStack.size();
    const edges = m.getGraph().edges.map(edge => ({ edge, waypoints: structuredClone(edge.waypoints), points: edge.di.waypoint.slice() }));
    assert.equal(m.resizeShape(task, { ...snapshot, width: 145 }), false);
    assert.deepEqual(bounds(task), snapshot); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), count);
    for (const { edge, waypoints, points } of edges) { assert.deepEqual(edge.waypoints, waypoints); assert.deepEqual(edge.di.waypoint, points); }
  } finally { m.destroy(); }
});

test('shape-owned and flow-owned annotation moves crop the moved shape and preserve the other endpoint against actual reference', async () => {
  for (const owned of [false, true]) for (const reverse of [false, true]) {
    const m = await editor(await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'));
    let upstream;
    try {
      const a = m.addShape('bpmn:Task', { x: 350, y: 400 }), b = m.addShape('bpmn:Task', { x: 700, y: 400 }), note = m.addShape('bpmn:TextAnnotation', { x: 500, y: 150 });
      const owner = owned ? m.connect(a, b) : a, link = m.connect(reverse ? note : owner, reverse ? owner : note);
      assert.ok(link); const authored = await save(m), noteId = note.id, linkId = link.id;
      await m.importXML(authored); const before = await m.getXML(), importedNote = m.getElement(noteId), importedLink = m.getElement(linkId);
      const oldRoute = xy(importedLink.waypoints), edgeIds = [linkId];
      upstream = new Upstream({ container: dom.createContainer() }); assert.deepEqual((await upstream.importXML(before)).warnings, []);
      upstream.get('modeling').moveShape(upstream.get('elementRegistry').get(noteId), { x: 23, y: 37 });
      const expected = upstream.get('elementRegistry').get(linkId).waypoints;
      m.moveShape(importedNote, { x: 23, y: 37 });
      const actual = importedLink.waypoints, changed = await save(m);
      assert.notDeepEqual(xy(actual), oldRoute, 'the changed shape endpoint must actually move');
      assert.equal(actual.length, expected.length);
      for (let i = 0; i < actual.length; i++) for (const axis of ['x', 'y'])
        assert.ok(Math.abs(actual[i][axis] - expected[i][axis]) <= .51, JSON.stringify({ owned, reverse, actual, expected }));
      if (owned) assert.deepEqual(xy([actual[reverse ? actual.length - 1 : 0]]), [oldRoute[reverse ? oldRoute.length - 1 : 0]], 'the fixed owner anchor is exact');
      await onlyGeometry(before, changed, [noteId], edgeIds);
      await exactHistory(m, before, changed, importedLink);
    } finally { upstream?.destroy(); m.destroy(); }
  }
});
