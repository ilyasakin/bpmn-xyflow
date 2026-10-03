/** Full pinned service baselines for the native hover harness, not native-input
 * certification. Event-shaped values call Dragging/BendpointMove directly; no
 * synthetic DOM events or replacement rule/layout/grid listeners are installed.
 */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { observeReferenceBackgroundClicks } from '../helpers/hover-background.mjs';
let dom, Upstream, xml, originalMouseEvent;
before(async () => {
  dom = await setupDOM(); originalMouseEvent = Object.getOwnPropertyDescriptor(globalThis, 'MouseEvent');
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: dom.window.MouseEvent });
  // Supply only the missing structural DOM SVG factory. Production canvas,
  // Dragging, BendpointMove, snapping, command handlers and updater stay active.
  dom.window.SVGTransformList.prototype.createSVGTransformFromMatrix = function(matrix) {
    const transform = document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGTransform(); transform.setMatrix(matrix); return transform;
  };
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  xml = await readFile('test/fixtures/hover-native/orthogonal.bpmn', 'utf8');
});
after(async () => { await dom.cleanup(); if (originalMouseEvent) Object.defineProperty(globalThis, 'MouseEvent', originalMouseEvent); else delete globalThis.MouseEvent; });
async function editor(input = xml) {
  const m = new Upstream({ container: dom.createContainer() }); const result = await m.importXML(input); assert.deepEqual(result.warnings, []);
  const canvas = m.get('canvas'); Object.defineProperties(canvas._container, { clientWidth: { configurable: true, value: 1188 }, clientHeight: { configurable: true, value: 762 } });
  canvas._container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1188, height: 762, right: 1188, bottom: 762 });
  canvas.viewbox({ x: 0, y: 0, width: 1188, height: 762 }); return m;
}
const save = async m => (await m.saveXML({ format: true })).xml;
const input = (m, x, y, id) => ({ clientX: x, clientY: y, button: 0, target: m.get('elementRegistry').getGraphics(id), preventDefault() {}, stopPropagation() {} });

test('all native hover fixtures have explicit valid inverse flow membership and namespace', async () => {
  for (const name of ['orthogonal', 'diagonal', 'booking']) {
    const parsed = await new BpmnModdle().fromXML(await readFile('test/fixtures/hover-native/' + name + '.bpmn', 'utf8'));
    assert.deepEqual(parsed.warnings, []); assert.ok(parsed.rootElement.targetNamespace);
    for (const flow of Object.values(parsed.elementsById).filter(e => e.$type === 'bpmn:SequenceFlow')) {
      assert.ok(flow.sourceRef.outgoing.includes(flow), name + ': ' + flow.id + ' outgoing');
      assert.ok(flow.targetRef.incoming.includes(flow), name + ': ' + flow.id + ' incoming');
    }
  }
});
test('pinned reconnect Undo is exact with authored inverse refs; omission reproduces normalization', async () => {
  for (const explicit of [false, true]) {
    const m = await editor(explicit ? xml : xml.replace(/<bpmn:(?:incoming|outgoing)>FlowA<\/bpmn:(?:incoming|outgoing)>/g, ''));
    try {
      const get = id => m.get('elementRegistry').get(id), before = await save(m);
      m.get('modeling').reconnectEnd(get('FlowA'), get('SpareTarget'), { x: 940, y: 400 }); m.get('commandStack').undo();
      assert.equal(before === await save(m), explicit);
    } finally { m.destroy(); }
  }
});
test('pinned full-chain out-and-back retains exact XML but creates the measured two-command history', async () => {
  const m = await editor();
  try {
    const edge = m.get('elementRegistry').get('FlowA'), dragging = m.get('dragging'), stack = m.get('commandStack'), before = await save(m);
    assert.equal(stack._stackIdx, -1); m.get('bendpointMove').start(input(m, 430, 380, 'FlowA'), edge, 2, false);
    dragging.move(input(m, 470, 410, 'FlowA')); assert.equal(dragging.context().active, true);
    assert.ok(dragging.context().data.context.connectionPreviewGfx.isConnected);
    dragging.move(input(m, 430, 380, 'FlowA')); dragging.end(input(m, 430, 380, 'FlowA'));
    assert.equal(await save(m), before); assert.equal(stack._stackIdx, 1); assert.equal(stack.canUndo(), true); assert.equal(stack.canRedo(), false);
    assert.deepEqual(stack._stack.map(e => e.command), ['connection.updateWaypoints', 'group.updateRefs']);
  } finally { m.destroy(); }
});
test('pinned dragging restores selected A after reconnecting hovered B', async () => {
  const m = await editor();
  try {
    const get = id => m.get('elementRegistry').get(id), dragging = m.get('dragging'), selection = m.get('selection'), edge = get('FlowB');
    selection.select(get('FlowA')); m.get('bendpointMove').start(input(m, 280, 560, 'FlowB'), edge, 0, false);
    dragging.move(input(m, 300, 500, 'FlowB')); dragging.hover({ element: get('SpareSource'), gfx: m.get('elementRegistry').getGraphics('SpareSource') });
    dragging.move(input(m, 280, 80, 'SpareSource')); dragging.end(input(m, 280, 80, 'SpareSource'));
    assert.equal(edge.source.id, 'SpareSource'); assert.deepEqual(selection.get().map(e => e.id), ['FlowA']);
  } finally { m.destroy(); }
});

test('pinned route previews differ outside marker definitions for insertion, existing bends and reconnect', async () => {
  const cases = [
    { fixture: 'orthogonal', id: 'FlowB', index: 1, insert: true, from: { x: 320, y: 560 }, to: { x: 320, y: 630 } },
    { fixture: 'diagonal', id: 'FlowA', index: 1, insert: true, from: { x: 490, y: 400 }, to: { x: 490, y: 470 } },
    { fixture: 'orthogonal', id: 'FlowA', index: 2, insert: false, from: { x: 430, y: 380 }, to: { x: 470, y: 410 } },
    { fixture: 'orthogonal', id: 'FlowA', index: 0, insert: false, from: { x: 280, y: 240 }, to: { x: 280, y: 80 }, hover: 'SpareSource' }
  ];
  for (const entry of cases) {
    const m = await editor(await readFile('test/fixtures/hover-native/' + entry.fixture + '.bpmn', 'utf8'));
    try {
      const registry = m.get('elementRegistry'), edge = registry.get(entry.id), visual = registry.getGraphics(edge).querySelector('.djs-visual'), dragging = m.get('dragging');
      const original = visual.querySelector(':scope > path,:scope > polyline').getAttribute('d');
      const before = await save(m), beforeHistory = m.get('commandStack')._stackIdx;
      m.get('bendpointMove').start(input(m, entry.from.x, entry.from.y, entry.id), edge, entry.index, entry.insert);
      dragging.move(input(m, entry.to.x, entry.to.y, entry.id));
      if (entry.hover) { dragging.hover({ element: registry.get(entry.hover), gfx: registry.getGraphics(entry.hover) }); dragging.move(input(m, entry.to.x, entry.to.y, entry.hover)); }
      const context = dragging.context().data.context, preview = context.connectionPreviewGfx;
      assert.ok(preview.isConnected); assert.ok(context.draggerGfx.isConnected);
      assert.equal(preview.querySelector('path').getAttribute('d'), visual.querySelector('path').getAttribute('d'), 'a broad path selector compares identical arrowhead definitions');
      assert.ok(preview.querySelector('path').closest('defs'), 'the misleading first path belongs to marker definitions');
      const changed = preview.querySelector(':scope > path,:scope > polyline'); assert.ok(changed && !changed.closest('defs'));
      assert.notEqual(changed.getAttribute('d'), original, 'actual visible route preview changes');
      assert.equal(visual.querySelector(':scope > path,:scope > polyline').getAttribute('d'), original, 'original visible route remains unchanged during preview');
      dragging.cancel(); assert.equal(await save(m), before); assert.equal(m.get('commandStack')._stackIdx, beforeHistory);
    } finally { m.destroy(); }
  }
});


test('pinned completed native-handler drag traps exactly one background click before normal deselection', async () => {
  const m = await editor(), originalAdd = document.addEventListener; let endHandler;
  try {
    const registry = m.get('elementRegistry'), edge = registry.get('FlowB'), canvas = m.get('canvas'), dragging = m.get('dragging'), selection = m.get('selection'), bus = m.get('eventBus');
    const trace = observeReferenceBackgroundClicks(bus); selection.select(registry.get('FlowA'));
    document.addEventListener = function(type, callback, options) { if (type === 'mouseup' && callback.name === 'trapClickAndEnd') endHandler = callback; return originalAdd.call(this, type, callback, options); };
    bus.fire('element.mousedown', { element: edge, gfx: registry.getGraphics(edge), originalEvent: input(m, 280, 560, 'FlowB') });
    document.addEventListener = originalAdd; assert.equal(typeof endHandler, 'function', 'actual Dragging registers its ghost-click-aware mouseup handler');
    dragging.move(input(m, 300, 500, 'FlowB')); dragging.hover({ element: registry.get('SpareSource'), gfx: registry.getGraphics('SpareSource') });
    dragging.move(input(m, 280, 80, 'SpareSource')); endHandler(input(m, 280, 80, 'SpareSource'));
    assert.equal(edge.source.id, 'SpareSource'); assert.deepEqual(selection.get().map(e => e.id), ['FlowA']);
    const before = await save(m), history = m.get('commandStack')._stackIdx, root = canvas.getRootElement();
    const click = () => bus.fire('element.click', { element: root, gfx: registry.getGraphics(root), originalEvent: input(m, 1000, 700, root.id) });
    assert.equal(click(), false); assert.deepEqual(trace[0], { id: root.id, trusted: false, trap: true, afterTrap: false }); assert.deepEqual(selection.get().map(e => e.id), ['FlowA']);
    click(); assert.deepEqual(trace[1], { id: root.id, trusted: false, trap: false, afterTrap: true }); assert.deepEqual(selection.get(), []);
    assert.equal(await save(m), before); assert.equal(m.get('commandStack')._stackIdx, history);
  } finally { document.addEventListener = originalAdd; m.destroy(); }
});
