import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from '../../lib/bpmn/moddle.js';
import { BpmnModdle as ReferenceModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

let dom, Modeler, xml;
before(async () => {
  dom = await setupDOM();
  ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js'));
  xml = await readFile('test/fixtures/connection-paint/aligned-wrinkle.bpmn', 'utf8');
});
after(() => dom.cleanup());
const sourceId = 'ExclusiveGateway_murn87m2_2', targetId = 'Task_murn87qh_3';
const edgeId = 'SequenceFlow_murna3bk_5';
const exactPath = 'M615,232L697.5,232C697.75,232,698,232.25,698,232.5L698,232.5C698,232.75,698.25,233,698.5,233L780,233';
const xy = points => points.map(({ x, y }) => ({ x, y }));
async function canonicalXml(value) {
  const oracle = new ReferenceModdle(), { rootElement, warnings } = await oracle.fromXML(value);
  assert.deepEqual(warnings, []);
  return (await oracle.toXML(rootElement)).xml;
}
const pathFor = (m, id) => m.getContainer().querySelector(`[data-element-id="${id}"] > .bpmn-xyflow-connection-visual`);
async function fixture() {
  const callbacks = new WeakMap(), restore = [];
  for (const target of [dom.window.SVGElement.prototype, window]) {
    const original = target.addEventListener;
    target.addEventListener = function(type, callback, options) {
      const list = callbacks.get(this) || [];
      list.push({ type, callback }); callbacks.set(this, list);
      return original.call(this, type, callback, options);
    };
    restore.push(() => { target.addEventListener = original; });
  }
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false,
    palette: false, editorActions: false, snap: false });
  await m.importXML(xml);
  const elementsFromPoint = document.elementsFromPoint;
  let hit;
  document.elementsFromPoint = () => hit ? [hit] : [];
  const gfx = node => m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
  function event(node, point, extra = {}) {
    const v = m.getViewport();
    return { target: node, button: 0, clientX: v.x + point.x * v.zoom,
      clientY: v.y + point.y * v.zoom, preventDefault() {}, stopPropagation() {}, ...extra };
  }
  function invoke(target, name, ev) {
    const entry = callbacks.get(target)?.find(entry => entry.callback.name === name);
    assert.ok(entry, `actual registered ${name}`);
    entry.callback.call(target, ev);
  }
  return { m, gfx, start(point) { invoke(m.getSvg(), 'onMouseDown', event(gfx(m.getElement(sourceId)), point, { shiftKey: true })); },
    move(point) { hit = gfx(m.getElement(targetId)); invoke(window, 'onMouseMove', event(hit, point)); },
    up(point) { invoke(window, 'onMouseUp', event(hit, point)); },
    escape() { invoke(window, 'onWindowKeyDown', { key: 'Escape', preventDefault() {} }); },
    close() { m.destroy(); restore.reverse().forEach(fn => fn()); document.elementsFromPoint = elementsFromPoint; } };
}

test('native exported DI remains exact through import, zoom, selection and SVG export while paint no longer backs up', async () => {
  const h = await fixture(), { m } = h;
  try {
    const before = await m.getXML(), edge = m.getElement(edgeId), route = structuredClone(edge.waypoints);
    assert.deepEqual(xy(route), [{ x: 615, y: 232 }, { x: 698, y: 232 }, { x: 698, y: 233 }, { x: 780, y: 233 }]);
    for (const zoom of [.2, .65, 1, 2, 4]) {
      await m.setViewport({ x: 35.125, y: -19.625, zoom }); m.select(edgeId);
      assert.equal(pathFor(m, edgeId).getAttribute('d'), exactPath);
      assert.equal(m.getContainer().querySelector(`[data-element-id="${edgeId}"] > .bpmn-xyflow-connection-hit`).getAttribute('d'), exactPath);
      assert.deepEqual(edge.waypoints, route);
      assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), 0);
      const { svg } = await m.saveSVG(); assert.ok(svg.includes(exactPath));
      assert.ok(!svg.includes('bpmn-xyflow-connection-hit'));
    }
    await m.importXML(before); assert.equal(await m.getXML(), before);
    assert.equal(pathFor(m, edgeId).getAttribute('d'), exactPath);
  } finally { h.close(); }
});

for (const zoom of [.5, 1, 2]) test(`actual registered preview/cancel/commit and history share corrected paint at zoom ${zoom}`, async () => {
  const h = await fixture(), { m } = h;
  try {
    await m.setViewport({ x: 12, y: 21, zoom });
    const before = await m.getXML(), size = m.commandStack.size();
    const start = { x: 615, y: 232 }, end = { x: 780, y: 233 };
    h.start(start); h.move(end);
    assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-preview path').getAttribute('d'), exactPath);
    h.escape(); h.up(end); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size);
    h.start(start); h.move(end); h.up(end);
    const edge = m.getGraph().edges.at(-1), after = await m.getXML();
    assert.deepEqual(xy([edge.waypoints[0], edge.waypoints.at(-1)]), [start, end]);
    assert.equal(pathFor(m, edge.id).getAttribute('d'), exactPath);
    assert.equal(m.commandStack.size(), size + 1);
    for (let i = 0; i < 3; i++) {
      assert.equal(m.undo(), true); assert.equal(await m.getXML(), before);
      assert.equal(m.redo(), true); assert.equal(await m.getXML(), after);
      assert.equal(pathFor(m, edge.id).getAttribute('d'), exactPath);
    }
    await m.importXML(after);
    // Reimport adds an explicit xsi:type to newly authored dc:Point instances.
    // Compare the complete independently parsed model; history above stays raw-exact.
    assert.equal(await canonicalXml(await m.getXML()), await canonicalXml(after));
    assert.equal(pathFor(m, edge.id).getAttribute('d'), exactPath);
  } finally { h.close(); }
});

for (const type of ['SequenceFlow', 'MessageFlow', 'Association', 'DataInputAssociation', 'DataOutputAssociation'])
  test(`${type} retains its semantic marker/dash styling and exact waypoint data`, async () => {
    const h = await fixture(), { m } = h;
    try {
      const model = new BpmnModdle(), businessObject = model.create(`bpmn:${type}`), points = structuredClone(m.getElement(edgeId).waypoints);
      const edge = { id: `Paint_${type}`, type: businessObject.$type, businessObject,
        source: m.getElement(sourceId), target: m.getElement(targetId), waypoints: points,
        di: model.create('bpmndi:BPMNEdge', { bpmnElement: businessObject }) };
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); m.getSvg().appendChild(g);
      const before = structuredClone(points), shapeBefore = await m.getXML();
      const visual = m.viewer._internals.renderer.drawConnection(g, edge);
      assert.equal(visual.getAttribute('d'), exactPath); assert.deepEqual(points, before);
      assert.equal(await m.getXML(), shapeBefore);
      const style = name => visual.style[name] || visual.getAttribute(name);
      if (type === 'SequenceFlow' || type === 'MessageFlow' || type.startsWith('Data')) assert.ok(style('marker-end'));
      if (type !== 'SequenceFlow') assert.ok(style('stroke-dasharray'));
      if (type === 'MessageFlow') assert.ok(style('marker-start'));
    } finally { h.close(); }
  });
