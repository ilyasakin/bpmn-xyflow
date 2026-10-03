/** Registered-handler replay of calibrated hosted Event paths. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(async () => dom.cleanup());
for (const slug of ['start-calibrated-low', 'start-calibrated-normal', 'boundary-calibrated']) {
  test(`${slug}: actual Event approach, reversal and context-pad fallback preserve fresh ring choice`, async () => {
    const data = JSON.parse(await readFile(`test/fixtures/anchor-motion/${slug}.json`, 'utf8'));
    const container = dom.createContainer(1800, 1152);
    container.getBoundingClientRect = () => ({ left: 0, top: 48, right: 1800, bottom: 1200, width: 1800, height: 1152 });
    window.innerWidth = 1800; window.innerHeight = 1200;
    const m = new Modeler({ container, fitViewOnInit: false, palette: false, editorActions: false });
    try {
      await m.importXML(await readFile(`test/fixtures/anchor-motion/${slug}.bpmn`, 'utf8'));
      const { shape, viewport: v } = data.geometry;
      m.getSvg().getBoundingClientRect = container.getBoundingClientRect; await m.setViewport(v);
      const source = m.getElement(shape.id), gfx = container.querySelector(`[data-element-id="${shape.id}"]`), body = gfx.querySelector('.bpmn-xyflow-shape-hit');
      // Happy DOM has no layout. Supply the rendered shape bounds and declared
      // stock two-column 24px button grid (4px gap/padding, 1px border).
      // These are explicit structural layout inputs, not measured native paint.
      gfx.getBoundingClientRect = () => ({ left: v.x + shape.x * v.zoom, top: 48 + v.y + shape.y * v.zoom,
        right: v.x + (shape.x + shape.width) * v.zoom, bottom: 48 + v.y + (shape.y + shape.height) * v.zoom,
        width: shape.width * v.zoom, height: shape.height * v.zoom });
      m.select(shape.id);
      const pad = container.querySelector('.bpmn-xyflow-context-pad'), left = Number.parseFloat(pad.style.left), top = 48 + Number.parseFloat(pad.style.top),
        width = 62, height = Math.ceil(pad.children.length / 2) * 28 + 6;
      pad.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height });
      const read = selector => { const element = container.querySelector(selector); assert.ok(element); return { x: Number(element.getAttribute('cx')), y: Number(element.getAttribute('cy')) }; };
      const move = (point, receiver) => {
        receiver.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: point.x, clientY: point.y, pointerType: 'mouse' }));
        receiver.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: point.x, clientY: point.y }));
        return read('.bpmn-xyflow-connect-docking-point');
      };
      // The low case's earlier preparation is truncated in the native evidence.
      // This minimal adjacent input exactly creates its recorded initial marker;
      // it is expressly not represented as a retained native preparation event.
      move(data.initialInput, body);
      const before = await m.getXML(), history = m.commandStack.size(), selection = m.getSelection(), viewport = m.getViewport(),
        businessObject = source.businessObject, di = source.di, bounds = source.di.bounds;
      for (const point of data.points) {
        const receiver = point.connectOwner ? container.querySelector('.bpmn-xyflow-connect-hit') : body;
        assert.ok(receiver, 'recorded control/body receiver exists');
        if (point.connectOwner) assert.equal(point.connectOwner, source.id);
        const marker = move(point, receiver), cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2,
          dx = (point.x - v.x) / v.zoom - cx, dy = (point.y - 48 - v.y) / v.zoom - cy, length = Math.hypot(dx, dy),
          expected = { x: cx + dx / length * shape.width / 2, y: cy + dy / length * shape.width / 2 };
        assert.ok(Math.hypot(marker.x - expected.x, marker.y - expected.y) < 1e-7,
          `fresh origin seq${point.sequence}: ${JSON.stringify({ marker, expected })}`);
      }
      assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), history);
      assert.deepEqual(m.getSelection(), selection); assert.deepEqual(m.getViewport(), viewport);
      assert.equal(source.businessObject, businessObject); assert.equal(source.di, di); assert.equal(source.di.bounds, bounds);
    } finally { m.destroy(); container.remove(); }
  });
}
