import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
import { collectHoverBackground } from '../helpers/hover-background.mjs';
// Puppeteer serializes page.evaluate functions; execute that exact standalone
// form here so no accidental module closure dependency can pass locally.
const collect = new Function('return (' + collectHoverBackground.toString() + ')')();
let dom, Local, Upstream, xml;
before(async () => {
  dom = await setupDOM();
  ({ default: Local } = await dom.loadModule('/lib/Modeler.js'));
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  xml = await readFile('test/fixtures/hover-native/orthogonal.bpmn', 'utf8');
});
after(() => dom.cleanup());
for (const engine of ['local', 'upstream']) test(`background collector uses the actual ${engine} editor roots and rejects chrome, elements and off-canvas hits`, async () => {
  const container = dom.createContainer(800, 600), m = new (engine === 'local' ? Local : Upstream)({ container });
  const hitAt = document.elementFromPoint;
  try {
    window.hoverTest = { engine, m, container };
    assert.throws(() => collect(), /no valid canvas roots/, 'a real editor before import is deliberately refused');
    await m.importXML(xml);
    const before = engine === 'local' ? await m.getXML() : (await m.saveXML({ format: true })).xml;
    window.hoverTest = { engine, m, container };
    if (engine === 'local') { assert.equal(m.getGraph().root, undefined); assert.equal(m.getGraph().rootElement, undefined); assert.equal(m.getGraph().roots[0].id, 'HoverProcess'); }
    const svg = engine === 'local' ? m.getSvg() : m.get('canvas')._svg;
    const chrome = document.createElementNS('http://www.w3.org/2000/svg', 'g'); chrome.setAttribute('class', 'bpmn-xyflow-minimap'); svg.appendChild(chrome);
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'g'); shape.setAttribute('data-element-id', 'FlowA'); svg.appendChild(shape);
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'g'); root.setAttribute('data-element-id', 'HoverProcess'); svg.appendChild(root);
    const outside = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); document.body.appendChild(outside);
    let index = 0; const candidates = [chrome, shape, outside, root]; document.elementFromPoint = () => candidates[index++] || null;
    assert.deepEqual(collect(), { point: { x: 400, y: 540 }, rootIds: ['HoverProcess'], owner: 'HoverProcess', tag: 'g' });
    document.elementFromPoint = () => svg; assert.equal(collect().owner, engine === 'local' ? null : 'HoverProcess', 'plain canvas SVG respects each actual renderer root attribute');
    for (const invalid of [chrome, shape, outside, null]) { document.elementFromPoint = () => invalid; assert.throws(() => collect(), /No unobstructed/); }
    for (const selector of ['button', 'input', 'select', 'contenteditable', 'bpmn-xyflow-palette', 'bpmn-xyflow-editor-actions', 'bpmn-xyflow-context-pad', 'djs-palette', 'djs-context-pad', 'bjs-powered-by']) {
      const wrapper = document.createElement(['button','input','select'].includes(selector) ? selector : 'div');
      if (selector === 'contenteditable') wrapper.setAttribute('contenteditable', 'true'); else wrapper.className = selector;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); wrapper.appendChild(icon); container.appendChild(wrapper); document.elementFromPoint = () => icon;
      assert.throws(() => collect(), /No unobstructed/, selector + ' SVG icon must not count as canvas background'); wrapper.remove();
    }
    const html = document.createElement('div'); container.appendChild(html); document.elementFromPoint = () => html; assert.throws(() => collect(), /No unobstructed/); html.remove();
    document.elementFromPoint = () => svg;
    if (engine === 'local') {
      const getGraph = m.getGraph;
      for (const graph of [null, {}, { roots: [] }, { roots: [null] }, { roots: [{}] }]) { m.getGraph = () => graph; assert.throws(() => collect(), /no valid canvas roots/); }
      m.getGraph = getGraph;
    } else {
      const canvas = m.get('canvas'), getRoot = canvas.getRootElement;
      for (const value of [undefined, null, {}]) { canvas.getRootElement = () => value; assert.throws(() => collect(), /no valid canvas roots/); }
      canvas.getRootElement = getRoot;
    }
    const bounds = container.getBoundingClientRect; container.getBoundingClientRect = () => ({ left: window.innerWidth + 10, top: 0, width: 800, height: 600 }); document.elementFromPoint = () => root;
    assert.throws(() => collect(), /No unobstructed/); container.getBoundingClientRect = bounds;
    assert.equal(engine === 'local' ? await m.getXML() : (await m.saveXML({ format: true })).xml, before, 'read-only collection cannot alter the model');
    chrome.remove(); shape.remove(); root.remove(); outside.remove();
  } finally { document.elementFromPoint = hitAt; delete window.hoverTest; m.destroy(); container.remove(); }
});
