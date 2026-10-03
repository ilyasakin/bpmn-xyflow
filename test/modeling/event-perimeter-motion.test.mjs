/** Actual registered-handler regressions. Native hit/paint/timing gates are separate. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, xml, captured;
before(async () => {
  dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js'));
  xml = await readFile('test/fixtures/anchor-motion/start-low-motion.bpmn', 'utf8');
  captured = JSON.parse(await readFile('test/fixtures/anchor-motion/start-low-motion.json', 'utf8'));
});
after(async () => dom.cleanup());
const near = (actual, expected, why) => assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7,
  `${why}: ${JSON.stringify({ actual, expected })}`);
const circle = (shape, point) => {
  const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2;
  const dx = point.x - cx, dy = point.y - cy, length = Math.hypot(dx, dy);
  assert.ok(length > 0); return { x: cx + dx / length * shape.width / 2, y: cy + dy / length * shape.width / 2 };
};
async function fixture(type = 'startEvent') {
  const container = dom.createContainer(1800, 1152); container.id = 'viewer';
  container.getBoundingClientRect = () => ({ x: 0, y: 48, left: 0, top: 48, width: 1800, height: 1152, right: 1800, bottom: 1200 });
  window.innerWidth = 1800; window.innerHeight = 1200;
  const m = new Modeler({ container, fitViewOnInit: false, palette: false, editorActions: false });
  await m.importXML(type === 'boundaryEvent'
    ? await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn', 'utf8')
    : xml.replace('bpmn:startEvent ', `bpmn:${type} `));
  m.getSvg().getBoundingClientRect = container.getBoundingClientRect;
  const source = m.getElement(type === 'boundaryEvent' ? 'FlightTimeout' : captured.geometry.shape.id);
  const target = container.querySelector(`[data-element-id="${source.id}"] .bpmn-xyflow-shape-hit`); assert.ok(target);
  const read = selector => { const element = container.querySelector(selector); assert.ok(element, selector);
    return { x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) }; };
  const graph = point => { const v = m.getViewport(); return { x: (point.x - v.x) / v.zoom, y: (point.y - 48 - v.y) / v.zoom }; };
  const screen = point => { const v = m.getViewport(); return { x: v.x + point.x * v.zoom, y: 48 + v.y + point.y * v.zoom }; };
  const move = (point, receiver = target) => {
    receiver.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: point.x, clientY: point.y, pointerType: 'mouse' }));
    receiver.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: point.x, clientY: point.y }));
    return read('.bpmn-xyflow-connect-docking-point');
  };
  const snapshot = async () => ({ xml: await m.getXML(), history: m.commandStack.size(), selection: m.getSelection(), viewport: m.getViewport(),
    businessObject: source.businessObject, di: source.di, bounds: source.di.bounds });
  const unchanged = async before => {
    assert.equal(await m.getXML(), before.xml); assert.equal(m.commandStack.size(), before.history);
    assert.deepEqual(m.getSelection(), before.selection); assert.deepEqual(m.getViewport(), before.viewport);
    assert.equal(source.businessObject, before.businessObject); assert.equal(source.di, before.di); assert.equal(source.di.bounds, before.bounds);
  };
  return { m, source, target, graph, screen, move, read, snapshot, unchanged,
    async setup(viewport, selected) { await m.setViewport(viewport); m.select([]); if (selected) m.select(source.id); },
    close() { m.destroy(); container.remove(); } };
}

for (const selected of [false, true]) {
  test(`captured 59-point circle path keeps each true perimeter origin fresh, selected=${selected}`, async () => {
    const h = await fixture();
    try {
      await h.setup(captured.geometry.viewport, selected); const before = await h.snapshot();
      for (const [index, point] of captured.points.entries()) {
        const expected = circle(h.source, h.graph(point));
        assert.ok(Math.hypot(expected.x - h.graph(point).x, expected.y - h.graph(point).y) * h.m.getViewport().zoom < .622,
          'captured integer path remains inside the measured true-outline band');
        near(h.move(point), expected, `captured point ${index}`);
      }
      await h.unchanged(before);
    } finally { h.close(); }
  });
  test(`genuine outward departure and direct grab retain exact acquired circle origin, selected=${selected}`, async () => {
    const h = await fixture();
    try {
      for (const kind of ['outward-return', 'direct-grab']) {
        await h.setup(captured.geometry.viewport, selected); const before = await h.snapshot(), start = { x: 894, y: 643 };
        const anchor = h.move(start); near(anchor, circle(h.source, h.graph(start)), 'independent initial projection');
        if (kind === 'outward-return') {
          for (const point of [{ x: 893, y: 642 }, { x: 892, y: 641 }]) {
            near(h.move(point), anchor, 'outward intent retains acquired origin');
            near(h.move(point), anchor, 'duplicate pointer/mouse delivery retains acquired origin');
          }
          near(h.move(start), circle(h.source, h.graph(start)), 'return restores perimeter choice');
          near(h.move({ x: 895, y: 643 }), circle(h.source, h.graph({ x: 895, y: 643 })), 'following tangent chooses another point');
        } else {
          const hit = h.m.getContainer().querySelector('.bpmn-xyflow-connect-hit'), at = h.screen(h.read('.bpmn-xyflow-connect-port'));
          const point = { x: Math.round(at.x), y: Math.round(at.y) };
          near(h.move(point, hit), anchor, 'actual owned grab target bypasses perimeter choosing');
          near(h.move(point, hit), anchor, 'duplicate at the owned grab remains stable');
        }
        await h.unchanged(before);
      }
    } finally { h.close(); }
  });
}

test('Event quadrants, zoom and reversal preserve pixel-rounded perimeter choice', async () => {
  for (const type of ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent', 'boundaryEvent']) {
    const h = await fixture(type);
    try {
      for (const selected of [false, true]) for (const zoom of [.2, .5433674312630289, 1, 2, 4]) {
        const cx = h.source.x + h.source.width / 2, cy = h.source.y + h.source.height / 2;
        await h.setup({ x: 800.25 - cx * zoom, y: 600.25 - cy * zoom, zoom }, selected);
        const before = await h.snapshot(), steps = Math.max(180, Math.ceil(2 * Math.PI * 18 * zoom * 2));
        const points = Array.from({ length: steps + 1 }, (_, index) => {
          const angle = 2 * Math.PI * index / steps, at = h.screen({ x: cx + Math.cos(angle) * 18, y: cy + Math.sin(angle) * 18 });
          return { x: Math.round(at.x), y: Math.round(at.y) };
        }).filter((point, index, all) => !index || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
        for (const [index, point] of [...points, ...points.slice(0, -1).reverse()].entries())
          near(h.move(point), circle(h.source, h.graph(point)), `${type}, selected=${selected}, zoom=${zoom}, point=${index}`);
        await h.unchanged(before);
      }
    } finally { h.close(); }
  }
});
