import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, artifact = 0;
async function valid(m) {
  const xml = await m.getXML(); assert.deepEqual((await new BpmnModdle().fromXML(xml)).warnings, []);
  if (process.env.BPMN_XML_ARTIFACT_DIR) { await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true }); await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `connection-hit-${++artifact}.bpmn`), xml); }
  return xml;
}
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(() => dom.cleanup());
async function harness(file = 'test/fixtures/scenarios/order-payment-delivery.bpmn') {
  const callbacks = new WeakMap(), restore = [];
  for (const target of [ dom.window.HTMLElement.prototype, dom.window.SVGElement.prototype, window ]) {
    const add = target.addEventListener;
    target.addEventListener = function(type, callback, options) { const list = callbacks.get(this) || []; list.push({ type, callback }); callbacks.set(this, list); return add.call(this, type, callback, options); };
    restore.push(() => target.addEventListener = add);
  }
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, snap: false });
  await m.importXML(await readFile(file, 'utf8'));
  m.setViewport({ x: 120, y: 80, zoom: .9 });
  const gfx = element => m.getContainer().querySelector(`[data-element-id="${element.id}"]`);
  const oldHit = document.elementsFromPoint; let stack = [];
  document.elementsFromPoint = () => stack.map(gfx);
  const event = (target, point, extra = {}) => { const v = m.getViewport(), r = m.getContainer().getBoundingClientRect(); return { target, button: 0, clientX: r.left + v.x + point.x * v.zoom, clientY: r.top + v.y + point.y * v.zoom, preventDefault() {}, stopPropagation() {}, ...extra }; };
  const call = (target, type, value, name) => { const entries = (callbacks.get(target) || []).filter(entry => entry.type === type && entry.callback.name === name); assert.ok(entries.length); entries.forEach(entry => entry.callback(value)); };
  return { m, gfx, stack(elements) { stack = elements; },
    down(target, point, extra) { call(m.getSvg(), 'mousedown', event(target, point, extra), 'onMouseDown'); },
    move(point) { call(window, 'mousemove', event(stack[0] ? gfx(stack[0]) : null, point), 'onMouseMove'); },
    up(point) { call(window, 'mouseup', event(stack[0] ? gfx(stack[0]) : null, point), 'onMouseUp'); },
    close() { m.destroy(); document.elementsFromPoint = oldHit; restore.reverse().forEach(fn => fn()); }
  };
}
async function redock(h, edge, side, target, point, occluder) {
  const { m } = h, before = await m.getXML(), count = m.commandStack.size(), index = side === 'source' ? 0 : edge.waypoints.length - 1;
  m.select(edge.id); h.stack([ edge, occluder, target, target.parent ]);
  const handle = m.getContainer().querySelector(`[data-bend-index="${index}"]`); assert.ok(handle);
  h.down(handle, edge.waypoints[index]); h.move(point); const preview = edge.waypoints.map(({ x, y }) => ({ x, y })); h.up(point);
  assert.equal(edge[side]?.id, target.id); assert.equal(edge[side], target); assert.deepEqual(edge.waypoints.map(({ x, y }) => ({ x, y })), preview); assert.equal(m.commandStack.size(), count + 1);
  const after = await valid(m); for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), after); }
}

test('message endpoint can reach a valid task underneath its incoming sequence-flow hit path', async () => {
  const h = await harness(), { m } = h;
  try { await redock(h, m.getElement('OrderMessage'), 'target', m.getElement('ValidateOrder'), { x: 200, y: 430 }, m.getElement('SellerFlow1')); }
  finally { h.close(); }
});

test('data association owner can reach a valid activity beneath an unrelated incoming edge', async () => {
  const h = await harness(), { m } = h;
  try {
    const data = m.addShape('bpmn:DataObjectReference', { x: 1050, y: 630 }, { parent: m.getElement('SellerPool') });
    const edge = m.connect(data, m.getElement('ValidateOrder'));
    await redock(h, edge, 'target', m.getElement('ShipOrder'), { x: 1160, y: 430 }, m.getElement('SellerFlow8'));
    assert.equal(edge.businessObject.$parent, m.getElement('ShipOrder').businessObject);
    assert.ok(m.getElement('ShipOrder').businessObject.dataInputAssociations.includes(edge.businessObject));
  } finally { h.close(); }
});

test('a rule-invalid visible shape stops lookup instead of falling through to a valid participant', async () => {
  const h = await harness(), { m } = h;
  try {
    const edge = m.getElement('OrderMessage'), gateway = m.getElement('FulfillmentFork'), point = { x: gateway.x + gateway.width / 2, y: gateway.y + gateway.height / 2 }, before = await m.getXML(), count = m.commandStack.size();
    m.select(edge.id); h.stack([ edge, m.getElement('SellerFlow3'), gateway, m.getElement('SellerPool') ]);
    h.down(m.getContainer().querySelector(`[data-bend-index="${edge.waypoints.length - 1}"]`), edge.waypoints.at(-1)); h.move(point); h.up(point);
    assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), count);
  } finally { h.close(); }
});

test('compatible owner-flow candidates remain reachable for annotation creation and redocking', async () => {
  const h = await harness(), { m } = h;
  try {
    const note = m.addShape('bpmn:TextAnnotation', { x: 800, y: 750 }), flow = m.getElement('OrderMessage'), other = m.getElement('BuyerFlow2');
    const edge = m.connect(note, flow), point = other.waypoints[0];
    await redock(h, edge, 'target', other, point, other);
  } finally { h.close(); }
});

test('new connection preview and commit skip incompatible edge hits but retain eligible owner flows', async () => {
  const h = await harness(), { m } = h;
  try {
    const source = m.getElement('SubmitOrder'), target = m.getElement('ValidateOrder'), point = { x: 200, y: 430 }, start = { x: source.x + source.width, y: source.y + 20 };
    const before = await m.getXML(), count = m.commandStack.size(), previous = new Set(m.getGraph().edges);
    h.stack([ m.getElement('SellerFlow1'), target, target.parent ]); h.down(h.gfx(source), start, { shiftKey: true }); h.move(point); h.up(point);
    const added = m.getGraph().edges.find(edge => !previous.has(edge)); assert.ok(added); assert.equal(added.target.id, target.id); assert.equal(added.type, 'bpmn:MessageFlow');
    assert.deepEqual({ x: added.waypoints.at(-1).x, y: added.waypoints.at(-1).y }, point); assert.equal(m.commandStack.size(), count + 1);
    const after = await valid(m); m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), after);
    const note = m.addShape('bpmn:TextAnnotation', { x: 750, y: 750 }), owner = m.getElement('BuyerFlow2'), old = new Set(m.getGraph().edges);
    h.stack([ owner, m.getElement('BuyerPool') ]); h.down(h.gfx(note), { x: note.x, y: note.y + 20 }, { shiftKey: true }); h.move(owner.waypoints[0]); h.up(owner.waypoints[0]);
    const link = m.getGraph().edges.find(edge => !old.has(edge)); assert.ok(link); assert.equal(link.target.id, owner.id); assert.equal(link.type, 'bpmn:Association'); await valid(m);
  } finally { h.close(); }
});

test('same-type target reconnect preserves semantic containment order and every unrelated field', async () => {
  const h = await harness('test/fixtures/flow-native/approval-source.bpmn'), { m } = h;
  try {
    const edge = m.getElement('ApproveFlow'), target = m.getElement('ReworkRequest'), owner = edge.businessObject.$parent, array = owner.flowElements, order = array.map(element => element.id);
    const before = await m.getXML(), count = m.commandStack.size(), oracle = new BpmnModdle(), prior = await oracle.fromXML(before), canonical = (await oracle.toXML(prior.rootElement, { format: true })).xml;
    assert.deepEqual(prior.warnings, []); m.reconnect(edge, 'target', target, [ ...edge.waypoints.slice(0, -1), { x: 940, y: 130 } ]);
    assert.equal(owner.flowElements, array); assert.deepEqual(array.map(element => element.id), order); assert.equal(m.commandStack.size(), count + 1);
    const after = await valid(m), parsed = await oracle.fromXML(after); assert.deepEqual(parsed.warnings, []);
    for (const id of [ 'ApproveFlow', 'PolicyAssociation' ]) {
      const current = parsed.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === id), original = prior.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === id);
      current.waypoint = original.waypoint;
    }
    const originalTarget = prior.elementsById.ApproveFlow.targetRef.id;
    parsed.elementsById.ApproveFlow.targetRef = parsed.elementsById[originalTarget];
    for (const id of [ originalTarget, target.id ]) {
      const original = prior.elementsById[id];
      if (Object.hasOwn(original, 'incoming')) parsed.elementsById[id].incoming = original.incoming.map(flow => parsed.elementsById[flow.id]); else delete parsed.elementsById[id].incoming;
    }
    assert.equal((await oracle.toXML(parsed.rootElement, { format: true })).xml, canonical);
    for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); assert.equal(owner.flowElements, array); m.redo(); assert.equal(await m.getXML(), after); assert.deepEqual(array.map(element => element.id), order); }
  } finally { h.close(); }
});
