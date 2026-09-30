import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM();
const { default: Viewer } = await dom.loadModule('/lib/Viewer.js');
const basic = await readFile(new URL('../fixtures/bpmn/basic.bpmn', import.meta.url), 'utf8');
const fixture = name => readFile(new URL(`../fixtures/bpmn/${ name }.bpmn`, import.meta.url), 'utf8');
const viewers = [];
function create(options = {}) {
  const container = dom.createContainer();
  const viewer = new Viewer({ container, fitViewOnInit: false, ...options });
  viewers.push(viewer);
  return viewer;
}
after(async () => { for (const viewer of viewers) viewer.destroy(); await dom.cleanup(); });

test('undefined wrapper zoom options retain finite defaults and readable fitting', async () => {
  const viewer = create({ minZoom: undefined, maxZoom: undefined, fitPadding: undefined });
  await viewer.importXML(basic);
  viewer.fitView();
  assert.equal(viewer.getViewport().zoom, 4);
  assert.equal(viewer.getContainer().querySelectorAll('.bjs-powered-by').length, 1);
  assert.equal(viewer.getContainer().querySelector('.bjs-powered-by').getAttribute('title'), 'Powered by bpmn.io');
});

test('parse, render and completion lifecycle is ordered and selections reset on reimport', async () => {
  const viewer = create();
  const events = [];
  for (const event of [ 'import.parse.start', 'import.parse.complete', 'import.render.start', 'import.render.complete', 'import.done' ]) viewer.on(event, () => events.push(event));
  await viewer.importXML(basic);
  assert.deepEqual(events, [ 'import.parse.start', 'import.parse.complete', 'import.render.start', 'import.render.complete', 'import.done' ]);
  viewer.select('Task_1');
  await viewer.importXML(basic);
  assert.deepEqual(viewer.getSelection(), []);
});

test('malformed imports report an error without replacing the active graph', async () => {
  const viewer = create();
  await viewer.importXML(basic);
  const graph = viewer.getGraph();
  let done;
  viewer.on('import.done', event => { done = event; });
  await assert.rejects(viewer.importXML('<broken>'));
  assert.equal(viewer.getGraph(), graph);
  assert.ok(done.error);
  assert.ok(Array.isArray(done.warnings));
});

test('a slower superseded import never overwrites a newer diagram', async () => {
  const viewer = create();
  const moddle = viewer.getModdle();
  const parse = moddle.fromXML.bind(moddle);
  let release;
  moddle.fromXML = async xml => {
    if (xml.includes('Slow_Task')) await new Promise(resolve => { release = resolve; });
    return parse(xml);
  };
  const stale = viewer.importXML(basic.replaceAll('Task_1', 'Slow_Task'));
  const rejection = assert.rejects(stale, { name: 'AbortError' });
  await viewer.importXML(basic);
  release();
  await rejection;
  assert.ok(viewer.getElement('Task_1'));
  assert.equal(viewer.getElement('Slow_Task'), null);
});

test('destroy and clear cancel pending imports and destroy is repeatable', async () => {
  for (const action of [ 'clear', 'destroy' ]) {
    const viewer = create({ fitViewOnInit: true });
    const pending = viewer.importXML(basic);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    viewer[action]();
    await rejected;
    assert.equal(viewer.getGraph(), null);
    if (action === 'destroy') {
      viewer.destroy();
      assert.equal(viewer.getContainer().querySelectorAll('svg, .bjs-powered-by').length, 0);
      await assert.rejects(viewer.importXML(basic), { name: 'AbortError' });
    }
  }
});

test('render failures are returned as structured warnings, not silently swallowed', async () => {
  const viewer = create();
  viewer._internals.renderer.drawShape = () => { throw new Error('test render failure'); };
  const result = await viewer.importXML(basic);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0].message, /test render failure/);
  assert.ok(result.warnings[0].context.element);
});

test('retained renderer handles events, task types, pools, lanes and labels structurally', async () => {
  const viewer = create();
  for (const file of [ 'draw/task-types', 'draw/events', 'draw/gateways', 'collaboration', 'collaboration-vertical', 'boundary-events' ]) {
    const result = await viewer.importXML(await fixture(file));
    assert.deepEqual(result.warnings.map(w => w.message), [], file);
    assert.equal(viewer.getSvg().querySelectorAll('.bpmn-xyflow-shape').length, result.graph.nodes.filter(n => !n.hidden && n.type !== 'label').length, file);
  }
});

test('named connection labels appear exactly once and survive standalone SVG export', async () => {
  const viewer = create();
  const result = await viewer.importXML(await fixture('align-elements'));
  const labeled = result.graph.edges.find(edge => edge.label && edge.businessObject.name);
  assert.ok(labeled);
  assert.equal(viewer.getSvg().querySelectorAll(`[data-element-id="${ labeled.label.id }"]`).length, 1);
  assert.equal(viewer.getSvg().querySelector(`[data-element-id="${ labeled.id }"] .bpmn-xyflow-connection-label`), null);
  viewer.setViewport({ x: 200, y: 300, zoom: 2 });
  const { svg } = await viewer.saveSVG();
  const exported = new DOMParser().parseFromString(svg, 'image/svg+xml');
  assert.equal(exported.querySelector('.bpmn-xyflow-viewport').hasAttribute('transform'), false);
  assert.ok(exported.querySelector('desc').textContent.includes('bpmn.io'));
  // happy-dom drops unsupported marker-end CSS. Actual reference resolution is
  // asserted in the browser suite; here verify exported marker definitions.
  assert.ok(exported.querySelector('defs marker'));
});

test('search matches name or ID, focuses matches, and hides hidden descendants', async () => {
  const viewer = create();
  await viewer.importXML(basic.replace('<bpmn:task id="Task_1"', '<bpmn:task name="Approve Invoice" id="Task_1"'));
  assert.deepEqual(viewer.findElements('invoice').map(e => e.id), [ 'Task_1' ]);
  assert.deepEqual(viewer.findElements('task_1').map(e => e.id), [ 'Task_1' ]);
  assert.ok(viewer.focusElement('Task_1'));
  assert.deepEqual(viewer.getSelection(), [ 'Task_1' ]);
  assert.equal(viewer.focusElement('missing'), false);
});

test('redrawing a pool preserves its stacking order and selection', async () => {
  const viewer = create();
  await viewer.importXML(await fixture('collaboration'));
  const pool = viewer.getGraph().nodes.find(n => n.type === 'bpmn:Participant');
  const layer = viewer._internals.shapeLayer;
  const before = [ ...layer.children ].map(g => g.dataset.elementId);
  viewer.select(pool.id);
  viewer._internals.redrawShape(pool);
  assert.deepEqual([ ...layer.children ].map(g => g.dataset.elementId), before);
  assert.ok(viewer._internals.elementGfx(pool.id).classList.contains('is-selected'));
});

test('viewer uses its configured moddle extensions and external label color', async () => {
  const viewer = create({
    moddleExtensions: { qa: { name: 'QA', uri: 'urn:qa', prefix: 'qa', types: [ {
      name: 'TaskDetails', extends: [ 'bpmn:Task' ], properties: [ { name: 'priority', type: 'String', isAttr: true } ]
    } ] } },
    config: { bpmnRenderer: { defaultLabelColor: '#ef1234' } }
  });
  const xml = basic.replace('xmlns:bpmn=', 'xmlns:qa="urn:qa" xmlns:bpmn=').replace('<bpmn:task id="Task_1"', '<bpmn:task qa:priority="urgent" id="Task_1"').replace('<bpmn:startEvent id="StartEvent_1"', '<bpmn:startEvent name="Begin" id="StartEvent_1"');
  const result = await viewer.importXML(xml);
  assert.deepEqual(result.warnings, []);
  assert.equal(viewer.getElement('Task_1').businessObject.get('qa:priority'), 'urgent');
  const labelText = viewer.getSvg().querySelector('[data-element-id="StartEvent_1_label"] text');
  assert.equal(labelText.style.fill, '#ef1234');
});

test('resize refits until the user sets a viewport, then preserves their view', async () => {
  const original = globalThis.ResizeObserver;
  let resize;
  globalThis.ResizeObserver = class {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() {}
  };
  try {
    const viewer = create();
    let width = 1188;
    viewer.getContainer().getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width, height: 762 });
    await viewer.importXML(basic);
    viewer.fitView();
    width = 600;
    resize();
    assert.equal(viewer.getViewport().zoom, 2);
    await viewer.setViewport({ x: 100, y: 100, zoom: 1 });
    width = 900;
    resize();
    assert.equal(viewer.getViewport().zoom, 1);
  } finally { globalThis.ResizeObserver = original; }
});

test('fit reads palette and minimap geometry and keeps shapes in the usable canvas', async () => {
  const viewer = create({ minimap: true });
  const palette = document.createElement('div');
  palette.className = 'bpmn-xyflow-palette';
  palette.getBoundingClientRect = () => ({ left: 10, right: 128, top: 10, bottom: 240, width: 118, height: 230 });
  viewer.getContainer().appendChild(palette);
  const actions = document.createElement('div');
  actions.className = 'bpmn-xyflow-editor-actions';
  actions.getBoundingClientRect = () => ({ left: 150, right: 600, top: 10, bottom: 44, width: 450, height: 34 });
  viewer.getContainer().appendChild(actions);
  await viewer.importXML(basic);
  viewer.fitView();
  const viewport = viewer.getViewport();
  for (const node of viewer.getGraph().nodes.filter(node => !node.hidden)) {
    assert.ok(node.x * viewport.zoom + viewport.x >= 148 - 0.01, `${node.id} clears palette`);
    assert.ok((node.x + node.width) * viewport.zoom + viewport.x <= 1168 + 0.01, `${node.id} clears right edge`);
    assert.ok(node.y * viewport.zoom + viewport.y >= 64 - 0.01, `${node.id} clears editor toolbar`);
    assert.ok((node.y + node.height) * viewport.zoom + viewport.y <= 762 - 196 - 20 + 0.01, `${node.id} clears minimap and logo`);
  }
});
