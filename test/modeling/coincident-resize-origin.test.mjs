/** Captured native receiver transitions replayed through registered handlers.
 * Structural replay does not substitute for native hit/paint acceptance. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(async () => dom.cleanup());
const near = (a, b, label) => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 1e-7,
  `${label}: ${JSON.stringify({ actual: a, expected: b })}`);
async function fixture(slug) {
  const data = JSON.parse(await readFile(`test/fixtures/anchor-motion/${slug}.json`, 'utf8'));
  const container = dom.createContainer(1800, 1152);
  container.getBoundingClientRect = () => ({ x: 0, y: 48, left: 0, top: 48, right: 1800, bottom: 1200, width: 1800, height: 1152 });
  window.innerWidth = 1800; window.innerHeight = 1200;
  const m = new Modeler({ container, fitViewOnInit: false, palette: false, editorActions: false });
  await m.importXML(await readFile(`test/fixtures/anchor-motion/${slug}.bpmn`, 'utf8'));
  m.getSvg().getBoundingClientRect = container.getBoundingClientRect;
  await m.setViewport(data.geometry.viewport); m.select(data.geometry.shape.id);
  const source = m.getElement(data.geometry.shape.id), rect = container.querySelector('[data-resize-dir="n"]'); assert.ok(rect);
  const read = selector => { const e = container.querySelector(selector); assert.ok(e); return { x: Number(e.getAttribute('cx')), y: Number(e.getAttribute('cy')) }; };
  const move = (point, receiver) => {
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
  return { data, m, source, rect, move, read, snapshot, unchanged, close() { m.destroy(); container.remove(); } };
}
for (const slug of ['task-low', 'task-normal-retina']) {
  test(`${slug}: resize-stroke to coincident grab remains freely movable along the Task outline`, async () => {
    const h = await fixture(slug);
    try {
      const before = await h.snapshot(), v = h.m.getViewport(); let coincidentSeen = false;
      for (const point of h.data.points) {
        const receiver = point.targetClass === 'bpmn-xyflow-resize-handle' ? h.rect : h.m.getContainer().querySelector('.bpmn-xyflow-connect-hit');
        assert.ok(receiver, 'captured actual receiver exists');
        const expected = { x: (point.x - v.x) / v.zoom, y: h.source.y };
        const graphY = (point.y - 48 - v.y) / v.zoom;
        assert.ok(Math.abs(graphY - h.source.y) * v.zoom <= .500000001, 'delivered tangent stays within the captured outline pixel band');
        const marker = h.move(point, receiver); near(marker, expected, `fresh top origin at captured seq${point.sequence}`);
        const grab = h.read('.bpmn-xyflow-connect-port');
        if (Math.hypot(grab.x - marker.x, grab.y - marker.y) < 1e-8) coincidentSeen = true;
        if (point.targetClass === 'bpmn-xyflow-connect-hit') assert.equal(coincidentSeen, true, 'the actual grab has become coincident before tangent input');
        near(h.move(point, receiver), expected, 'duplicate delivery preserves the current exact origin');
      }
      assert.equal(coincidentSeen, true); await h.unchanged(before);
    } finally { h.close(); }
  });
  test(`${slug}: truly displaced resize-origin still supports normal outward acquisition`, async () => {
    const h = await fixture(slug);
    try {
      const before = await h.snapshot(), v = h.m.getViewport(), start = h.data.points[0];
      const marker = h.move(start, h.rect), grab = h.read('.bpmn-xyflow-connect-port');
      assert.ok(Math.hypot(grab.x - marker.x, grab.y - marker.y) * v.zoom >= 12 - 1e-7, 'positive control has an actually displaced grab');
      const destination = { x: Math.round(v.x + grab.x * v.zoom), y: Math.round(48 + v.y + grab.y * v.zoom) };
      for (let step = 1; step <= 12; step++) {
        const point = { x: start.x + (destination.x - start.x) * step / 12, y: start.y + (destination.y - start.y) * step / 12 };
        const receiver = step === 12 ? h.m.getContainer().querySelector('.bpmn-xyflow-connect-hit') : h.rect;
        near(h.move(point, receiver), marker, 'genuine outward travel retains the advertised marker');
        near(h.read('.bpmn-xyflow-connect-port'), grab, 'the actual displaced grab remains stable');
      }
      await h.unchanged(before);
    } finally { h.close(); }
  });
}
