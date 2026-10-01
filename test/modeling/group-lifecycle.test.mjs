import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

let dom, Modeler, Upstream, basic, artifact = 0;
const audit = { name: 'Audit', uri: 'urn:group:audit', prefix: 'audit', types: [ { name: 'Tracking', extends: [ 'bpmn:BaseElement' ], properties: [
  { name: 'watchedRef', type: 'bpmn:BaseElement', isReference: true, isAttr: true },
  { name: 'ownerRef', type: 'bpmn:BaseElement', isReference: true, isAttr: true }
] } ] };
before(async () => {
  dom = await setupDOM();
  ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js'));
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  basic = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8');
});
after(async () => dom.cleanup());
const bounds = value => Object.fromEntries([ 'x', 'y', 'width', 'height' ].map(key => [ key, value[key] ]));
async function editor(xml = basic) {
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, snap: false, moddleExtensions: { audit } });
  await m.importXML(xml); return m;
}
async function valid(m) {
  const xml = await m.getXML();
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `group-lifecycle-${++artifact}.bpmn`), xml);
  }
  assert.deepEqual((await new BpmnModdle({ audit }).fromXML(xml)).warnings, []); return xml;
}
async function history(m, before, after, check = () => {}) {
  for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); check(); m.redo(); assert.equal(await m.getXML(), after); }
}
function fixture(mode = 'present', shared = false) {
  const label = mode === 'absent' ? '' : `<bpmndi:BPMNLabel id="GL" xmlns:v="urn:group:vendor" v:trace="label"><!-- LABEL -->${mode === 'empty' ? '' : '<dc:Bounds x="480.25" y="304.5" width="201.5" height="20.25"><!-- BOUNDS --><?bounds retain?></dc:Bounds>'}<?label retain?></bpmndi:BPMNLabel>`;
  return basic.replace('</bpmn:process>', '<bpmn:group id="G" categoryValueRef="V"/>' + (shared ? '<bpmn:group id="G2" categoryValueRef="V"/>' : '') + '</bpmn:process><bpmn:category id="C" xmlns:v="urn:group:vendor" xmlns:q="urn:group:q"><bpmn:extensionElements><v:meta ref="q:Category">before<!-- RAW -->after<?group keep?>last</v:meta></bpmn:extensionElements><bpmn:categoryValue id="V" value="Review category"><bpmn:extensionElements><v:meta ref="q:Value">before<!-- RAW -->after<?group keep?>last</v:meta></bpmn:extensionElements></bpmn:categoryValue></bpmn:category>')
    .replace('</bpmndi:BPMNPlane>', `<bpmndi:BPMNShape id="G_di" bpmnElement="G"><dc:Bounds x="400.125" y="300.25" width="300.5" height="220.75"/>${label}</bpmndi:BPMNShape>${shared ? '<bpmndi:BPMNShape id="G2_di" bpmnElement="G2"><dc:Bounds x="900" y="300" width="300" height="220"/></bpmndi:BPMNShape>' : ''}</bpmndi:BPMNPlane>`);
}

test('new Group creates standard category and top label with one exact command per action', async () => {
  const m = await editor(), up = new Upstream({ container: dom.createContainer() });
  try {
    await up.importXML(basic); const before = await m.getXML(), size = m.commandStack.size();
    const g = m.addShape('bpmn:Group', { x: 700, y: 500 }, { parent: m.getGraph().roots[0] });
    const ug = up.get('modeling').createShape({ type: 'bpmn:Group' }, { x: 700, y: 500 }, up.get('canvas').getRootElement());
    assert.deepEqual(bounds(g), bounds(ug)); assert.equal(g.width, 300); assert.equal(g.height, 300);
    const value = g.businessObject.categoryValueRef, category = value.$parent;
    assert.ok(m.getDefinitions().rootElements.includes(category)); assert.equal(value.$type, 'bpmn:CategoryValue');
    assert.equal(g.di.label, undefined); assert.equal(m.commandStack.size(), size + 1);
    const created = await valid(m); await history(m, before, created); m.undo(); m.redo();
    m.updateLabel(g, 'Review category'); up.get('modeling').updateLabel(ug, 'Review category');
    assert.equal(value.value, 'Review category'); assert.equal(g.businessObject.name, undefined);
    assert.equal(g.label.id, g.id + '_label'); assert.deepEqual(bounds(g.label), bounds(ug.label));
    const named = await valid(m); await history(m, created, named, () => assert.equal(g.di.label, undefined));
    m.delete(g.label); assert.equal(value.value, ''); assert.equal(g.label, null); assert.equal(m.getElement(g.id), g);
    const empty = await valid(m); await history(m, named, empty); m.undo();
  } finally { m.destroy(); up.destroy(); }
});

test('shared category rename refreshes both labels and preserves imported raw DI, identities and empty-label undo', async () => {
  const m = await editor(fixture('present', true));
  try {
    const g = m.getElement('G'), peer = m.getElement('G2'), value = g.businessObject.categoryValueRef;
    const label = g.di.label, labelBounds = label.bounds, graphLabel = g.label, alias = graphLabel.di, rootArray = m.getDefinitions().rootElements, before = await m.getXML();
    m.updateLabel(g, 'Shared renamed'); assert.equal(peer.label.text, 'Shared renamed'); assert.equal(value.value, 'Shared renamed');
    const changed = await valid(m); assert.ok(changed.includes('<!-- BOUNDS --><?bounds retain?>')); assert.ok(changed.includes('before<!-- RAW -->after<?group keep?>last'));
    await history(m, before, changed, () => { assert.equal(g.di.label, label); assert.equal(label.bounds, labelBounds); assert.equal(g.label, graphLabel); assert.equal(graphLabel.di, alias); assert.equal(m.getDefinitions().rootElements, rootArray); });
    m.updateLabel(peer, ''); assert.equal(g.label, null); assert.equal(peer.label, null); const empty = await valid(m);
    await history(m, changed, empty); m.undo(); m.undo(); assert.equal(await m.getXML(), before);
  } finally { m.destroy(); }
});

test('copy freezes category metadata and gives each pasted Group independent bindings', async () => {
  const m = await editor(fixture('present', true));
  try {
    const a = m.getElement('G'), b = m.getElement('G2'), original = a.businessObject.categoryValueRef;
    m.copy([ a, b ]); m.updateLabel(a, 'Changed after copy'); const before = await m.getXML();
    const copies = m.paste({ x: 1800, y: 900 }), values = copies.map(copy => copy.businessObject.categoryValueRef);
    assert.equal(copies.length, 2); assert.notEqual(values[0], values[1]);
    for (const value of values) { assert.notEqual(value, original); assert.equal(value.value, 'Review category'); assert.ok(m.getDefinitions().rootElements.includes(value.$parent)); }
    const after = await valid(m); assert.equal(after.split('before<!-- RAW -->after<?group keep?>last').length - 1, 6);
    await history(m, before, after); m.updateLabel(copies[0], 'Only this copy'); assert.equal(values[1].value, 'Review category'); assert.equal(original.value, 'Changed after copy');
  } finally { m.destroy(); }
});

test('create, move, resize and delete update targeted membership like the actual reference', async () => {
  const m = await editor(), up = new Upstream({ container: dom.createContainer() });
  try {
    await up.importXML(basic); const task = m.getElement('Task_1'), ut = up.get('elementRegistry').get('Task_1');
    const position = { x: task.x + task.width / 2, y: task.y + task.height / 2 };
    const before = await m.getXML(), group = m.addShape('bpmn:Group', position, { parent: m.getGraph().roots[0] }), value = group.businessObject.categoryValueRef;
    const ug = up.get('modeling').createShape({ type: 'bpmn:Group' }, position, up.get('canvas').getRootElement()), uv = ug.businessObject.categoryValueRef;
    const compare = () => assert.equal((task.businessObject.categoryValueRef || []).includes(value), (ut.businessObject.categoryValueRef || []).includes(uv));
    compare(); assert.ok(task.businessObject.categoryValueRef.includes(value)); const created = await valid(m); await history(m, before, created);
    const memberArray = task.businessObject.categoryValueRef;
    m.moveShape(group, { x: 600, y: 0 }); up.get('modeling').moveShape(ug, { x: 600, y: 0 }); compare(); assert.ok(!memberArray.includes(value));
    const moved = await valid(m); await history(m, created, moved, () => assert.equal(task.businessObject.categoryValueRef, memberArray));
    const next = { x: task.x - 20, y: task.y - 20, width: 160, height: 140 };
    m.resizeShape(group, next); up.get('modeling').resizeShape(ug, next); compare(); assert.ok(memberArray.includes(value));
    const resized = await valid(m); m.delete(group); up.get('modeling').removeShape(ug); compare(); assert.ok(!m.getDefinitions().rootElements.includes(value.$parent));
    const deleted = await valid(m); await history(m, resized, deleted);
  } finally { m.destroy(); up.destroy(); }
});

test('collapsed subprocess root transitions preserve inner groups and remove outer membership with exact undo', async () => {
  const xml = await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn', 'utf8'), results = {};
  for (const [ name, Class ] of [ [ 'local', Modeler ], [ 'reference', Upstream ] ]) {
    const m = new Class({ container: dom.createContainer(), fitViewOnInit: false, palette: false, snap: false });
    try {
      await m.importXML(xml); const local = name === 'local', get = id => local ? m.getElement(id) : m.get('elementRegistry').get(id), root = local ? m.getGraph().roots[0] : m.get('canvas').getRootElement();
      const create = (position, parent, size) => local ? m.addShape('bpmn:Group', position, { parent, ...size }) : m.get('modeling').createShape({ type: 'bpmn:Group', ...size }, position, parent);
      const inner = create({ x: 520, y: 435 }, get('Payment'), { width: 190, height: 180 }), outer = create({ x: 700, y: 400 }, root, { width: 2000, height: 1100 });
      const child = get('CapturePayment').businessObject, snap = () => [ inner, outer ].map(group => (child.categoryValueRef || []).includes(group.businessObject.categoryValueRef));
      results[name] = [ snap() ]; const before = local ? await m.getXML() : null;
      if (local) m.toggleExpanded(get('Payment')); else m.get('bpmnReplace').replaceElement(get('Payment'), { type: 'bpmn:SubProcess', isExpanded: false });
      results[name].push(snap()); const collapsed = local ? await valid(m) : null;
      if (local) m.toggleExpanded(get('Payment')); else m.get('bpmnReplace').replaceElement(get('Payment'), { type: 'bpmn:SubProcess', isExpanded: true });
      results[name].push(snap());
      if (local) { const expanded = await valid(m); await history(m, collapsed, expanded); m.undo(); await history(m, before, collapsed); }
    } finally { m.destroy(); }
  }
  assert.deepEqual(results.local, results.reference); assert.deepEqual(results.local, [ [ true, true ], [ true, false ], [ true, true ] ]);
});

test('message to sequence morph registers the new FlowElement for category membership', async () => {
  const m = await editor(await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn', 'utf8'));
  try {
    const group = m.addShape('bpmn:Group', { x: 700, y: 400 }, { parent: m.getGraph().roots[0], width: 2000, height: 1100 });
    const value = group.businessObject.categoryValueRef, edge = m.getElement('OrderMessage'), before = await m.getXML();
    assert.equal(edge.businessObject.categoryValueRef, undefined); m.reconnect(edge, 'target', m.getElement('ReceiveDelivery'));
    assert.equal(edge.type, 'bpmn:SequenceFlow'); assert.ok(edge.businessObject.categoryValueRef.includes(value));
    const after = await valid(m); await history(m, before, after);
  } finally { m.destroy(); }
});

test('orphan cleanup retains inactive Group and declared custom references but removes truly orphan categories', async () => {
  for (const retaining of [ 'inactive-group', 'declared-ref', 'none' ]) {
    const m = await editor(fixture('present'));
    try {
      const group = m.getElement('G'), value = group.businessObject.categoryValueRef, category = value.$parent, defs = m.getDefinitions(), process = group.businessObject.$parent;
      if (retaining === 'inactive-group') { const hidden = m.getModdle().create('bpmn:Group', { id: 'HiddenGroup', categoryValueRef: value }); hidden.$parent = process; process.artifacts.push(hidden); }
      if (retaining === 'declared-ref') process.watchedRef = value;
      const roots = defs.rootElements, values = category.categoryValue, before = await m.getXML();
      m.delete(group); assert.equal(roots.includes(category), retaining !== 'none'); assert.equal(values.includes(value), retaining !== 'none');
      const after = await valid(m); await history(m, before, after, () => { assert.equal(defs.rootElements, roots); assert.equal(category.categoryValue, values); assert.equal(value.$parent, category); assert.equal(group.businessObject.categoryValueRef, value); });
    } finally { m.destroy(); }
  }
});

test('malformed category and unsupported association names refuse without graph, XML or history mutation', async () => {
  const m = await editor(fixture('present'));
  try {
    const group = m.getElement('G'), task = m.getElement('Task_1'), note = m.addShape('bpmn:TextAnnotation', { x: 800, y: 800 });
    const association = m.connect(task, note), data = m.addShape('bpmn:DataObjectReference', { x: 900, y: 800 }), input = m.connect(data, task), output = m.connect(task, data);
    for (const edge of [ association, input, output ]) { const before = await m.getXML(), size = m.commandStack.size(); assert.equal(m.updateLabel(edge, 'Unsupported'), false); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size); }
    for (const bad of [ 'unresolved:missing', false, 17, {} ]) { group.businessObject.categoryValueRef = bad; const before = await m.getXML(), size = m.commandStack.size(); assert.equal(m.updateLabel(group, 'Refused'), false); assert.equal(m.copy([ group ]), null); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size); }
  } finally { m.destroy(); }
});

for (const mode of [ 'present', 'absent', 'empty' ]) test(`Group owner resize preserves ${mode} label DI, raw tokens and exact history against pinned service`, async () => {
  const xml = fixture(mode), m = await editor(xml), up = new Upstream({ container: dom.createContainer() });
  try {
    await up.importXML(xml); const group = m.getElement('G'), reference = up.get('elementRegistry').get('G'), label = group.label;
    const oldLabel = group.di.label, oldBounds = oldLabel?.bounds, oldAlias = label.di, before = await m.getXML();
    const next = { x: group.x - 23.5, y: group.y - 37.25, width: group.width + 81.125, height: group.height + 57.75 };
    m.resizeShape(group, next); up.get('modeling').resizeShape(reference, next);
    assert.deepEqual(bounds(label), bounds(reference.label)); assert.deepEqual(bounds(group.di.label.bounds), bounds(label));
    if (oldLabel) assert.equal(group.di.label, oldLabel); if (oldBounds) assert.equal(group.di.label.bounds, oldBounds);
    const after = await valid(m); if (mode !== 'absent') assert.ok(after.includes('<!-- LABEL -->')); if (mode === 'present') assert.ok(after.includes('<!-- BOUNDS --><?bounds retain?>'));
    await history(m, before, after, () => { assert.equal(group.di.label, oldLabel); assert.equal(group.di.label?.bounds, oldBounds); assert.equal(label.di, oldAlias); if (mode === 'empty') assert.equal(Object.hasOwn(oldLabel, 'bounds'), false); });
  } finally { m.destroy(); up.destroy(); }
});

test('renaming an existing Group label does not recategorize unrelated imported FlowElements', async () => {
  const xml = fixture().replace('x="400.125" y="300.25" width="300.5" height="220.75"', 'x="0" y="0" width="2000" height="2000"');
  const m = await editor(xml), up = new Upstream({ container: dom.createContainer() });
  try {
    await up.importXML(xml); const task = m.getElement('Task_1').businessObject, reference = up.get('elementRegistry').get('Task_1').businessObject;
    assert.equal(Object.hasOwn(task, 'categoryValueRef'), false); const before = await m.getXML();
    m.updateLabel(m.getElement('G'), 'Only text changes'); up.get('modeling').updateLabel(up.get('elementRegistry').get('G'), 'Only text changes');
    assert.equal(Object.hasOwn(task, 'categoryValueRef'), Object.hasOwn(reference, 'categoryValueRef')); assert.equal(Object.hasOwn(task, 'categoryValueRef'), false);
    const after = await valid(m); await history(m, before, after);
  } finally { m.destroy(); up.destroy(); }
});

async function gestures(xml) {
  const callbacks = new WeakMap(), restore = [];
  for (const target of [ dom.window.HTMLElement.prototype, dom.window.SVGElement.prototype, window ]) {
    const add = target.addEventListener;
    target.addEventListener = function(type, callback, options) { const list = callbacks.get(this) || []; list.push({ type, callback }); callbacks.set(this, list); return add.call(this, type, callback, options); };
    restore.push(() => target.addEventListener = add);
  }
  const m = await editor(xml), gfx = node => m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
  const call = (target, type, extra, name) => {
    const list = (callbacks.get(target) || []).filter(entry => entry.type === type && (!name || entry.callback.name === name)); assert.ok(list.length, `${name || type} is registered`);
    const event = { target, button: 0, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra }; list.forEach(({ callback }) => callback(event));
  };
  return { m, gfx, call, close() { m.destroy(); restore.reverse().forEach(fn => fn()); } };
}

test('registered Group owner resize previews cancel and return exactly to fractional or bounds-less label DI', async () => {
  for (const mode of [ 'present', 'absent', 'empty' ]) {
    const h = await gestures(fixture(mode)), { m } = h;
    try {
      const group = m.getElement('G'), label = group.label, initial = bounds(group), original = await m.getXML(), size = m.commandStack.size(), alias = label.di;
      m.setViewport({ x: 0, y: 0, zoom: 1 });
      for (const action of [ 'cancel', 'out-and-back', 'commit' ]) {
        m.select(group.id); const handle = m.getContainer().querySelector('[data-resize-dir="nw"]'); assert.ok(handle);
        h.call(m.getSvg(), 'mousedown', { target: handle, clientX: group.x, clientY: group.y }, 'onMouseDown');
        h.call(window, 'mousemove', { clientX: initial.x - 40, clientY: initial.y - 30 }, 'onMouseMove'); assert.notDeepEqual(bounds(group), initial);
        if (action === 'cancel') m.cancel();
        if (action === 'out-and-back') h.call(window, 'mousemove', { clientX: initial.x, clientY: initial.y }, 'onMouseMove');
        h.call(window, 'mouseup', { clientX: initial.x, clientY: initial.y }, 'onMouseUp');
        if (action !== 'commit') { assert.equal(await m.getXML(), original); assert.equal(m.commandStack.size(), size); assert.equal(label.di, alias); }
        else { const changed = await valid(m); await history(m, original, changed, () => assert.equal(label.di, alias)); m.undo(); }
      }
    } finally { h.close(); }
  }
});

test('unsupported association direct editing has no editor while Group border editing commits and cancels exactly', async () => {
  const h = await gestures(fixture()), { m } = h;
  try {
    const group = m.getElement('G'), task = m.getElement('Task_1'), note = m.addShape('bpmn:TextAnnotation', { x: 900, y: 800 }), data = m.addShape('bpmn:DataObjectReference', { x: 950, y: 700 });
    const edges = [ m.connect(task, note), m.connect(data, task), m.connect(task, data) ];
    for (const edge of edges) { const before = await m.getXML(), size = m.commandStack.size(); h.call(m.getSvg(), 'dblclick', { target: h.gfx(edge) }, 'onDblClick'); assert.equal(document.querySelector('[contenteditable]'), null); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size); }
    const before = await m.getXML(); h.call(m.getSvg(), 'dblclick', { target: h.gfx(group) }, 'onDblClick'); let editor = document.querySelector('[contenteditable]'); assert.ok(editor); editor.textContent = 'Cancelled edit'; h.call(editor, 'keydown', { key: 'Escape' }); assert.equal(editor.isConnected, false); assert.equal(await m.getXML(), before);
    h.call(m.getSvg(), 'dblclick', { target: h.gfx(group) }, 'onDblClick'); editor = document.querySelector('[contenteditable]'); assert.ok(editor); editor.textContent = 'Committed edit'; h.call(editor, 'keydown', { key: 'Enter' }); assert.equal(editor.isConnected, false); assert.equal(group.businessObject.categoryValueRef.value, 'Committed edit'); const after = await valid(m); await history(m, before, after);
  } finally { h.close(); }
});

test('copied category siblings and descriptor references stay inside each independent category graph', async () => {
  const m = await editor(fixture('present', true));
  try {
    const a = m.getElement('G'), b = m.getElement('G2'), value = a.businessObject.categoryValueRef, category = value.$parent;
    const sibling = m.getModdle().create('bpmn:CategoryValue', { id: 'SiblingValue', value: 'Retained sibling' }); sibling.$parent = category; category.categoryValue.push(sibling);
    category.watchedRef = value; value.watchedRef = sibling; sibling.watchedRef = category; category.ownerRef = a.businessObject; value.ownerRef = b.businessObject; a.businessObject.watchedRef = value; b.businessObject.watchedRef = category;
    m.copy([ a, b ]); m.updateLabel(a, 'Original changed after copy'); const before = await m.getXML(), copies = m.paste({ x: 1700, y: 1000 });
    for (const [ index, copy ] of copies.entries()) {
      const cv = copy.businessObject.categoryValueRef, cat = cv.$parent;
      assert.equal(cat.categoryValue.length, 2); assert.equal(cat.watchedRef, cv); assert.equal(cv.watchedRef.$parent, cat); assert.equal(cv.watchedRef.watchedRef, cat);
      assert.equal(cat.ownerRef, copies[0].businessObject); assert.equal(cv.ownerRef, copies[1].businessObject);
      assert.equal(copy.businessObject.watchedRef, index ? cat : cv); assert.equal(cv.value, 'Review category'); assert.notEqual(cat, category);
    }
    assert.notEqual(copies[0].businessObject.categoryValueRef.$parent, copies[1].businessObject.categoryValueRef.$parent);
    const after = await valid(m); await history(m, before, after);
  } finally { m.destroy(); }
});

test('copied displayed Group labels and Space-owner resize match actual services across all optional DI states', async () => {
  for (const mode of [ 'present', 'absent', 'empty' ]) {
    const xml = fixture(mode).replace('value="Review category"', 'value="This very long category label wraps across several lines"');
    const m = await editor(xml), up = new Upstream({ container: dom.createContainer() });
    try {
      await up.importXML(xml); up.get('canvas').scrollToElement = () => {};
      const group = m.getElement('G'), reference = up.get('elementRegistry').get('G'), before = await m.getXML(), count = m.commandStack.size();
      m.copy([ group ]); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), count);
      const [ copy ] = m.paste({ x: 1300, y: 900 }), tree = up.get('copyPaste').copy([ reference ]);
      const referenceCopy = up.get('copyPaste').paste({ tree, element: up.get('canvas').getRootElement(), point: { x: 1300, y: 900 } }).find(element => element.type === 'bpmn:Group' && !element.labelTarget);
      const relative = node => ({ x: node.label.x - node.x, y: node.label.y - node.y, width: node.label.width, height: node.label.height });
      assert.deepEqual(relative(copy), relative(referenceCopy)); assert.deepEqual(bounds(copy.di.label.bounds), bounds(copy.label));
      const copied = await valid(m); if (mode === 'present') assert.equal(copied.split('<!-- BOUNDS --><?bounds retain?>').length - 1, 2);
      await history(m, before, copied); m.undo(); await up.importXML(xml);
      const plan = up.get('spaceTool').calculateAdjustments(up.get('elementRegistry').getAll(), 'x', 80, 550);
      assert.ok(plan.resizingShapes.includes(up.get('elementRegistry').get('G')));
      up.get('modeling').createSpace(plan.movingShapes, plan.resizingShapes, { x: 80, y: 0 }, 'e', 550);
      m.createSpace(null, 'horizontal', 550, 80, { direction: 'e' });
      assert.deepEqual(bounds(group), bounds(up.get('elementRegistry').get('G'))); assert.deepEqual(bounds(group.label), bounds(up.get('elementRegistry').get('G').label));
      assert.deepEqual(bounds(group.di.label.bounds), bounds(group.label)); const spaced = await valid(m); await history(m, before, spaced);
    } finally { m.destroy(); up.destroy(); }
  }
});
