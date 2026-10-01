import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setupDOM } from '../helpers/dom.mjs';

const require = createRequire(import.meta.url), upstream = createRequire(require.resolve('bpmn-js/package.json'));
let dom, Upstream, Local, project;
const xy = point => ({ x: point.x, y: point.y });
let artifact = 0;
async function exportArtifact(xml) {
  if (!process.env.BPMN_XML_ARTIFACT_DIR) return;
  await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `flow-redock-snapping-${++artifact}.bpmn`), xml);
}
before(async () => {
  assert.equal(require('bpmn-js/package.json').version, '18.30.1');
  dom = await setupDOM();
  globalThis.MouseEvent = dom.window.MouseEvent;
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  ({ default: Local } = await dom.loadModule('/lib/Modeler.js'));
  ({ getClosestPointOnConnection: project } = await dom.loadModule(upstream.resolve('diagram-js/lib/features/bendpoints/BendpointUtil.js')));
});
after(async () => { delete globalThis.MouseEvent; await dom.cleanup(); });

// Structural registered-handler evidence, not native-input certification.
// Enter the installed element.mousedown listeners, then the real Dragging ->
// BendpointSnapping -> GridSnapping -> preview -> BendpointMove -> Modeling
// stack. This includes HandTool arbitration; forcing BendpointMove.start would
// incorrectly make Ctrl+mousedown appear to be a supported reconnect gesture.
for (const target of [ false, true ]) for (const mode of [ 'integral-grid', 'integral-control', 'fractional' ]) {
  test(`actual reference ${target ? 'target' : 'source'} redock ${mode} preserves the complete native snapping pipeline`, async () => {
    const xml = await readFile(`test/fixtures/flow-native/approval-${target ? 'target' : 'source'}.bpmn`, 'utf8');
    const m = new Upstream({ container: dom.createContainer() });
    try {
      await m.importXML(xml);
      const canvas = m.get('canvas'), container = canvas._container;
      Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1188 });
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 762 });
      container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1188, height: 762 });
      // Happy DOM omits this list factory; use its SVG element factory without
      // substituting Canvas, Dragging, snapping or matrix calculations.
      canvas._viewport.transform.baseVal.createSVGTransformFromMatrix = matrix => canvas._svg.createSVGTransformFromMatrix(matrix);
      canvas.viewbox({ x: 0, y: 0, width: 1188, height: 762 });
      const registry = m.get('elementRegistry'), edge = registry.get('PolicyAssociation'), owner = registry.get('ReviewFlow');
      const points = edge.waypoints.map(xy), index = target ? points.length - 1 : 0, side = target ? 'target' : 'source';
      const pointer = mode === 'fractional' ? { x: 360, y: 174 + 4 / 9 } : { x: 366, y: 187 };
      const rounded = { x: Math.round(pointer.x), y: Math.round(pointer.y) }, projected = project(rounded, owner);
      const expected = mode === 'integral-grid' ? { x: 370, y: 190 } : { x: Math.round(projected.x), y: Math.round(projected.y) };
      const grid = m.get('gridSnapping'); assert.equal(grid.isActive(), true); assert.equal(grid.getGridSpacing(), 10);
      const bus = m.get('eventBus'), observed = {};
      bus.on('bendpoint.move.move', 20000, e => { observed.raw = xy(e); });
      bus.on('bendpoint.move.end', 1400, e => { observed.preGrid = { ...xy(e), snapped: { x: !!e.snapped?.x, y: !!e.snapped?.y } }; });
      bus.on('bendpoint.move.end', 1150, e => { observed.postGrid = xy(e); });
      bus.on('commandStack.connection.reconnect.preExecute', 20000, e => { observed.command = { point: xy(e.context.dockingOrPoints), side: e.context.hints.docking }; });
      const event = (type, point, ctrlKey = mode === 'integral-control') => new dom.window.MouseEvent(type, { clientX: point.x, clientY: point.y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey, bubbles: true, cancelable: true });
      const before = (await m.saveXML({ format: true })).xml;
      bus.fire('element.mousedown', { element: edge, gfx: canvas.getGraphics(edge), originalEvent: event('mousedown', points[index], false) });
      const dragging = m.get('dragging');
      assert.equal(dragging.context()?.prefix, 'bendpoint.move', 'ordinary primary down reaches the installed Bendpoints listener');
      if (mode === 'integral-control') {
        const distance = Math.hypot(pointer.x - points[index].x, pointer.y - points[index].y);
        dragging.move(event('mousemove', { x: points[index].x + (pointer.x - points[index].x) * 12 / distance, y: points[index].y + (pointer.y - points[index].y) * 12 / distance }, false));
        assert.equal(dragging.context()?.active, true, 'activate the ordinary drag before applying the modifier');
      }
      dragging.move(event('mousemove', pointer));
      dragging.hover({ element: owner, gfx: canvas.getGraphics(owner) });
      dragging.move(event('mousemove', pointer));
      assert.ok(dragging.context()?.active, 'real drag services activated');
      dragging.end(event('mouseup', pointer));
      assert.deepEqual(observed.raw, rounded);
      assert.deepEqual(xy(observed.preGrid), xy(projected));
      assert.deepEqual(observed.preGrid.snapped, { x: mode === 'fractional', y: mode === 'fractional' });
      assert.deepEqual(observed.postGrid, mode === 'integral-grid' ? expected : xy(projected));
      assert.deepEqual(observed.command, { point: expected, side });
      assert.deepEqual(xy(edge.waypoints[index]), expected);
      assert.deepEqual(edge.waypoints.map(xy).filter((_, i) => i !== index), points.filter((_, i) => i !== index));
      assert.equal(edge[side], owner); assert.equal(edge.businessObject[`${side}Ref`], owner.businessObject);
      const after = (await m.saveXML({ format: true })).xml;
      await exportArtifact(after);
      for (let n = 0; n < 3; n++) { m.get('commandStack').undo(); assert.equal((await m.saveXML({ format: true })).xml, before); m.get('commandStack').redo(); assert.equal((await m.saveXML({ format: true })).xml, after); }
      if (mode === 'integral-grid') assert.notDeepEqual(expected, xy(projected), 'an omitted grid listener must fail this regression');
      else assert.notDeepEqual(expected, { x: 370, y: 190 }, 'unconditional grid rounding must fail modifier and fractional controls');
    } finally { m.destroy(); }
  });
}


for (const target of [ false, true ]) test(`pinned ${target ? 'target' : 'source'} Ctrl mousedown selects HandTool before reconnect and preserves the model`, async () => {
  const m = new Upstream({ container: dom.createContainer() });
  try {
    await m.importXML(await readFile(`test/fixtures/flow-native/approval-${target ? 'target' : 'source'}.bpmn`, 'utf8'));
    const canvas = m.get('canvas'), container = canvas._container;
    Object.defineProperty(container, 'clientWidth', { configurable: true, value: 1188 });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 762 });
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1188, height: 762 });
    canvas._viewport.transform.baseVal.createSVGTransformFromMatrix = matrix => canvas._svg.createSVGTransformFromMatrix(matrix);
    // Happy DOM returns DOMMatrix here but its SVGMatrix.multiply requires an
    // SVGMatrix. Copy the exact six coefficients through the DOM factory; all
    // viewport arithmetic remains the installed Canvas implementation.
    const getCTM = canvas._viewport.getCTM.bind(canvas._viewport);
    canvas._viewport.getCTM = () => { const values = getCTM(), matrix = canvas._svg.createSVGMatrix(); for (const key of ['a', 'b', 'c', 'd', 'e', 'f']) matrix[key] = values[key]; return matrix; };
    canvas.viewbox({ x: 0, y: 0, width: 1188, height: 762 });
    const edge = m.get('elementRegistry').get('PolicyAssociation'), original = edge.waypoints.map(xy), from = original[target ? original.length - 1 : 0], to = { x: from.x + 48, y: from.y + 32 };
    const bus = m.get('eventBus'), dragging = m.get('dragging'), stack = m.get('commandStack');
    let bendStarts = 0; bus.on('bendpoint.move.start', () => { bendStarts++; });
    const event = (type, point) => new dom.window.MouseEvent(type, { clientX: point.x, clientY: point.y, button: 0, buttons: type === 'mouseup' ? 0 : 1, ctrlKey: true, bubbles: true, cancelable: true });
    const before = (await m.saveXML({ format: true })).xml, view = canvas.viewbox(), history = { index: stack._stackIdx, undo: stack.canUndo(), redo: stack.canRedo() };
    bus.fire('element.mousedown', { element: edge, gfx: canvas.getGraphics(edge), originalEvent: event('mousedown', from) });
    assert.equal(dragging.context()?.prefix, 'hand.move');assert.equal(dragging.context()?.active, true);
    dragging.move(event('mousemove', to));dragging.end(event('mouseup', to));
    assert.equal(bendStarts, 0);assert.deepEqual(edge.waypoints.map(xy), original);assert.equal((await m.saveXML({ format: true })).xml, before);
    assert.deepEqual({ index: stack._stackIdx, undo: stack.canUndo(), redo: stack.canRedo() }, history);
    const after = canvas.viewbox();assert.equal(after.x, view.x - 48);assert.equal(after.y, view.y - 32);assert.equal(after.scale, view.scale);
  } finally { m.destroy(); }
});

for (const target of [ false, true ]) test(`local ${target ? 'target' : 'source'} explicit docking keeps exact integral and fractional projections`, async () => {
  const m = new Local({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    await m.importXML(await readFile(`test/fixtures/flow-native/approval-${target ? 'target' : 'source'}.bpmn`, 'utf8'));
    const edge = m.getElement('PolicyAssociation'), owner = m.getElement('ReviewFlow'), index = target ? edge.waypoints.length - 1 : 0;
    for (const pointer of [ { x: 366, y: 187 }, { x: 360, y: 174 + 4 / 9 } ]) {
      const expected = xy(project(pointer, owner)), points = edge.waypoints.map(xy), before = await m.getXML();
      points[index] = expected;
      assert.equal(m.reconnect(edge, target ? 'target' : 'source', owner, points), edge);
      assert.deepEqual(xy(edge.waypoints[index]), expected, 'local docking never adopts the reference grid/rounding loss');
      assert.notDeepEqual(xy(edge.waypoints[index]), { x: 370, y: 190 });
      await exportArtifact(await m.getXML());
      m.undo(); assert.equal(await m.getXML(), before);
    }
  } finally { m.destroy(); }
});
