import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, Viewer, order, basic;
before(async () => {
  dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js'));
  ({ default: Viewer } = await dom.loadModule('/lib/Viewer.js'));
  [order, basic] = await Promise.all(['order-payment-delivery.bpmn', 'basic.bpmn'].map((file, index) => readFile(`test/fixtures/${index ? 'bpmn' : 'scenarios'}/${file}`, 'utf8')));
});
after(async () => dom.cleanup());
const turn = () => new Promise(resolve => setImmediate(resolve));
const track = promise => { const state = { settled: false }; state.done = promise.then(value => { state.settled = true; return { value }; }, error => { state.settled = true; return { error }; }); return state; };
async function success(state) { const result = await state.done; if (result.error) throw result.error; return result.value; }
async function aborted(state) { assert.equal((await state.done).error?.name, 'AbortError'); }
function holdFrames() {
  const previous = requestAnimationFrame, previousCancel = cancelAnimationFrame, queue = new Map(); let id = 0;
  globalThis.requestAnimationFrame = callback => { queue.set(++id, callback); return id; };
  globalThis.cancelAnimationFrame = key => queue.delete(key);
  return {
    get size() { return queue.size; },
    async flush() { const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(Date.now())); await turn(); },
    async settle(state) { for (let i = 0; !state.settled && i < 10; i++) await this.flush(); assert.ok(state.settled, 'operation completes without a stranded fit frame'); return state.done; },
    async dispose() { globalThis.requestAnimationFrame = previous; globalThis.cancelAnimationFrame = previousCancel; const callbacks = [...queue.values()]; queue.clear(); callbacks.forEach(callback => callback(Date.now())); await turn(); }
  };
}
async function make(Type = Modeler) {
  const m = new Type({ container: dom.createContainer(), fitViewOnInit: true, palette: false });
  // Structural DOM setup: Happy DOM cannot resolve the live 100% SVG lengths.
  m.getSvg().setAttribute('width', '1188'); m.getSvg().setAttribute('height', '762');
  assert.deepEqual((await m.importXML(order)).warnings, []); return m;
}
const root = m => m.getGraph().diagram.plane.bpmnElement.id;
let exportIndex = 0;
async function snapshot(model) {
  const xml = await model.getXML();
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `import-navigation-${++exportIndex}.bpmn`), xml);
  }
  return xml;
}
const history = m => ({ size: m.commandStack.size(), undo: m.canUndo(), redo: m.canRedo() });
async function prepare(m) {
  await m.drillInto(m.getElement('Payment'));
  const child = m.getGraph(), childView = { x: 50, y: -10, zoom: 1.25 }; await m.setViewport(childView);
  await m.navigateBack(); const outer = m.getGraph(), outerView = { x: -25, y: 60, zoom: .65 }; await m.setViewport(outerView);
  return { child, outer, childView, outerView, baseline: await snapshot(m) };
}

for (const direction of ['drill', 'back']) for (const failure of ['malformed', 'missing-diagram']) test(`${failure} import preserves an in-flight ${direction}, history, XML and cached camera`, async () => {
  const m = await make(); let frames;
  try {
    const state = await prepare(m); m.updateLabel(m.getElement('ValidateOrder'), 'Outer edit');
    if (direction === 'back') { await m.drillInto(m.getElement('Payment')); m.updateLabel(m.getElement('CapturePayment'), 'Child edit'); }
    const xml = await snapshot(m), previousHistory = history(m); frames = holdFrames();
    const navigation = track(direction === 'drill' ? m.drillInto(m.getElement('Payment')) : m.navigateBack());
    assert.ok(frames.size > 0); assert.equal(m.undo(), false);
    await assert.rejects(m.importXML(failure === 'malformed' ? '<invalid>' : basic, failure === 'missing-diagram' ? 'Missing' : undefined));
    assert.equal(navigation.settled, false, 'failed preflight does not complete or abort navigation');
    assert.equal(await snapshot(m), xml); assert.deepEqual(history(m), previousHistory); assert.equal(m.undo(), false);
    await frames.settle(navigation); assert.equal(await success(navigation), true);
    assert.equal(m.getGraph(), state[direction === 'drill' ? 'child' : 'outer']); assert.equal(m.canNavigateBack(), direction === 'drill');
    assert.deepEqual(m.getViewport(), state[direction === 'drill' ? 'childView' : 'outerView']); assert.equal(await snapshot(m), xml); assert.deepEqual(history(m), previousHistory);
    assert.equal(m.undo(), true); assert.equal(root(m), direction === 'drill' ? 'OrderCollaboration' : 'Payment');
    assert.equal(m.redo(), true); assert.equal(await snapshot(m), xml);
    await frames.flush(); assert.equal(root(m), direction === 'drill' ? 'OrderCollaboration' : 'Payment');
  } finally { m.destroy(); await frames?.dispose(); }
});

for (const direction of ['drill', 'back']) test(`valid replacement supersedes an in-flight ${direction} without late Back/history or fitting`, async () => {
  const m = await make(); let frames;
  try {
    await prepare(m); m.updateLabel(m.getElement('ValidateOrder'), 'Discarded old edit');
    if (direction === 'back') await m.drillInto(m.getElement('Payment'));
    frames = holdFrames(); const navigation = track(direction === 'drill' ? m.drillInto(m.getElement('Payment')) : m.navigateBack());
    const replacement = track(m.importXML(basic)); await turn(); assert.ok(m.getElement('Task_1')); assert.equal(m.undo(), false); assert.equal(m.redo(), false);
    await frames.settle(replacement); await success(replacement); await aborted(navigation);
    assert.equal(m.canNavigateBack(), false); assert.deepEqual(history(m), { size: 0, undo: false, redo: false });
    const xml = await snapshot(m), camera = { x: 10.25, y: 99.75, zoom: .55 }; await m.setViewport(camera);
    await frames.flush(); assert.deepEqual(m.getViewport(), camera); assert.equal(await snapshot(m), xml); assert.ok(m.getElement('Task_1'));
  } finally { m.destroy(); await frames?.dispose(); }
});

test('latest parse request wins before commit, including a newer failed preflight', async () => {
  for (const failure of [false, true]) {
    const m = await make(); let release;
    try {
      m.updateLabel(m.getElement('ValidateOrder'), 'Preserved old history'); const before = await snapshot(m), old = history(m), graph = m.getGraph(), camera = m.getViewport();
      const moddle = m.getModdle(), parse = moddle.fromXML.bind(moddle);
      moddle.fromXML = async xml => { if (xml.includes('Slow_Task')) await new Promise(resolve => { release = resolve; }); return parse(xml); };
      const slow = track(m.importXML(basic.replaceAll('Task_1', 'Slow_Task'))); assert.equal(m.undo(), false);
      if (failure) await assert.rejects(m.importXML(basic, 'Missing'));
      else await m.importXML(basic);
      if (failure) { assert.equal(m.getGraph(), graph); assert.equal(await snapshot(m), before); assert.deepEqual(history(m), old); assert.deepEqual(m.getViewport(), camera); }
      else { m.updateLabel(m.getElement('Task_1'), 'Latest document edit'); assert.equal(m.undo(), true); assert.equal(m.redo(), true); }
      release(); await aborted(slow);
      if (failure) { assert.equal(await snapshot(m), before); assert.deepEqual(history(m), old); assert.equal(m.undo(), true); }
      else { assert.equal(m.getElement('Slow_Task'), null); assert.equal(m.getElement('Task_1').businessObject.name, 'Latest document edit'); assert.equal(m.commandStack.size(), 1); }
    } finally { release?.(); m.destroy(); }
  }
});

for (const failure of ['malformed', 'missing-diagram']) test(`committed import A finishes if newer B has ${failure} preflight failure`, async () => {
  const m = await make(); let frames;
  try {
    const navigation = []; m.on('navigation.change', state => navigation.push(state));
    m.updateLabel(m.getElement('ValidateOrder'), 'Old history'); frames = holdFrames(); const first = track(m.importXML(basic)); await turn();
    const committed = m.getGraph(); assert.ok(m.getElement('Task_1')); assert.equal(first.settled, false);
    await assert.rejects(m.importXML(failure === 'malformed' ? '<invalid>' : order, failure === 'missing-diagram' ? 'Missing' : undefined));
    assert.equal(m.getGraph(), committed); assert.equal(m.undo(), false, 'old commands cannot replay before committed import bookkeeping completes');
    assert.equal(navigation.at(-1).pending, true, 'Back remains disabled until the committed document has matching history bookkeeping');
    await frames.settle(first); assert.deepEqual((await success(first)).warnings, []); assert.equal(m.getGraph(), committed); assert.deepEqual(history(m), { size: 0, undo: false, redo: false });
    assert.equal(navigation.at(-1).pending, false);
    m.updateLabel(m.getElement('Task_1'), 'New edit'); const changed = await snapshot(m); assert.equal(m.undo(), true); assert.equal(m.redo(), true); assert.equal(await snapshot(m), changed);
  } finally { m.destroy(); await frames?.dispose(); }
});

test('a newer valid committed import cancels the older fit and completes bookkeeping only for the latest graph', async () => {
  const m = await make(); let frames;
  try {
    m.updateLabel(m.getElement('ValidateOrder'), 'Old history'); frames = holdFrames(); const events = [];
    m.on('import.done', event => events.push(event));
    const first = track(m.importXML(basic.replaceAll('Task_1', 'First_Task'))); await turn(); assert.ok(m.getElement('First_Task'));
    const second = track(m.importXML(basic.replaceAll('Task_1', 'Second_Task'))); await turn(); assert.ok(m.getElement('Second_Task'));
    assert.equal(m.undo(), false); await frames.settle(second); await success(second); await aborted(first);
    assert.equal(events.length, 1); assert.equal(events[0].graph, m.getGraph()); assert.equal(m.getElement('First_Task'), null); assert.deepEqual(history(m), { size: 0, undo: false, redo: false });
  } finally { m.destroy(); await frames?.dispose(); }
});

test('invalid direct diagram lookup does not cancel a valid pending switch; clear/destroy still cancel committed fitting', async () => {
  const viewer = await make(Viewer); let frames;
  try {
    const graph = viewer.getGraph(); frames = holdFrames(); const switching = track(viewer.switchDiagram(graph.diagram.id, { reuseGraph: graph }));
    await assert.rejects(viewer.switchDiagram('Missing')); assert.equal(switching.settled, false); await frames.settle(switching); assert.equal((await success(switching)).graph, graph);
    const first = track(viewer.switchDiagram(graph.diagram.id, { reuseGraph: graph })); const second = track(viewer.switchDiagram(graph.diagram.id, { reuseGraph: graph }));
    await frames.settle(second); assert.equal((await success(second)).graph, graph); await aborted(first);
  } finally { viewer.destroy(); await frames?.dispose(); }
  for (const method of ['clear', 'destroy']) {
    const v = await make(Viewer), held = holdFrames();
    try { const pending = track(v.importXML(basic)); await turn(); assert.ok(v.getElement('Task_1')); v[method](); await held.settle(pending); await aborted(pending); assert.equal(v.getGraph(), null); }
    finally { v.destroy(); await held.dispose(); }
  }
});

test('failed import cancels a positive gesture preview, preserves history and allows later global replay', async () => {
  const m = await make();
  try {
    const state = await prepare(m); await m.drillInto(m.getElement('Payment')); m.updateLabel(m.getElement('CapturePayment'), 'Child edit'); await m.navigateBack();
    const expected = await snapshot(m), oldHistory = history(m), node = m.getElement('ValidateOrder'), before = { x: node.x, y: node.y }, view = m.getViewport();
    const point = { x: (node.x + 20) * view.zoom + view.x, y: (node.y + 20) * view.zoom + view.y };
    const mouse = (type, x, y) => new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    m.getContainer().querySelector(`[data-element-id="${node.id}"]`).dispatchEvent(mouse('mousedown', point.x, point.y));
    window.dispatchEvent(mouse('mousemove', point.x + 60, point.y + 40)); assert.notDeepEqual({ x: node.x, y: node.y }, before);
    await assert.rejects(m.importXML('<invalid>')); window.dispatchEvent(mouse('mouseup', point.x + 60, point.y + 40));
    assert.equal(await snapshot(m), expected); assert.deepEqual(history(m), oldHistory); assert.deepEqual(m.getViewport(), state.outerView);
    assert.equal(m.undo(), true); assert.equal(root(m), 'Payment'); assert.equal(await snapshot(m), state.baseline); assert.equal(m.redo(), true); assert.equal(await snapshot(m), expected);
  } finally { m.destroy(); }
});


test('destroy cancels pending Modeler navigation and replacement without stale controls or replay', async () => {
  for (const operation of ['drill', 'back', 'replacement']) {
    const m = await make(); let frames;
    try {
      await prepare(m); m.updateLabel(m.getElement('ValidateOrder'), 'Old command');
      if (operation === 'back') await m.drillInto(m.getElement('Payment'));
      frames = holdFrames(); const pending = track(operation === 'replacement' ? m.importXML(basic) : operation === 'back' ? m.navigateBack() : m.drillInto(m.getElement('Payment')));
      await turn(); assert.equal(pending.settled, false); m.destroy(); await frames.settle(pending); await aborted(pending);
      assert.equal(m.getGraph(), null); assert.equal(m.undo(), false); assert.equal(m.redo(), false);
      assert.equal(m.getContainer().querySelector('svg, .bpmn-xyflow-context-pad, [data-action="navigate-back"]'), null);
    } finally { m.destroy(); await frames?.dispose(); }
  }
});
