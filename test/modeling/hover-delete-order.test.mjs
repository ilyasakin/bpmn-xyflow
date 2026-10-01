import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { assertUpstreamHoverDeleteUndo, assertUpstreamHoverDeleteReopen } from '../helpers/hover-delete-order-oracle.mjs';

let dom, Upstream, Local, fixture, baseline, restored, reopened;
let exported = 0;
const oracle = new BpmnModdle(), save = async m => (await m.saveXML({ format: true })).xml;
async function artifact(xml) {
  if (!process.env.BPMN_XML_ARTIFACT_DIR) return;
  await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `hover-delete-order-${++exported}.bpmn`), xml);
}
before(async () => {
  assert.equal(createRequire(import.meta.url)('bpmn-js/package.json').version, '18.30.1');
  dom = await setupDOM();
  ({ default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'));
  ({ default: Local } = await dom.loadModule('/lib/Modeler.js'));
  fixture = await readFile('test/fixtures/hover-native/orthogonal.bpmn', 'utf8');
});
after(async () => { await dom.cleanup(); });

test('actual pinned Delete/Undo restores only the measured semantic sibling order across three cycles', async () => {
  const m = new Upstream({ container: dom.createContainer() });
  try {
    assert.deepEqual((await m.importXML(fixture)).warnings, []);
    const get = id => m.get('elementRegistry').get(id), flow = get('FlowA'), bo = flow.businessObject, di = flow.di;
    const owner = bo.$parent, members = owner.flowElements, originalMembers = members.slice();
    const plane = m.getDefinitions().diagrams[0].plane, diMembers = plane.planeElement.slice();
    const source = bo.sourceRef, target = bo.targetRef, outgoing = source.outgoing, incoming = target.incoming;
    baseline = await save(m); await artifact(baseline);
    m.get('selection').select(flow); m.get('editorActions').trigger('removeSelection');
    assert.equal(get('FlowA'), undefined); assert.ok(!owner.flowElements.includes(bo));
    const deleted = await save(m); await artifact(deleted);
    for (let n = 0; n < 3; n++) {
      m.get('commandStack').undo(); restored = await save(m);
      await assertUpstreamHoverDeleteUndo(baseline, restored);
      assert.equal(get('FlowA'), flow); assert.equal(flow.businessObject, bo); assert.equal(flow.di, di);
      assert.equal(owner.flowElements, members); assert.equal(members.at(-1), bo);
      assert.deepEqual(members.slice(0, -1), originalMembers.filter(item => item !== bo));
      assert.deepEqual(plane.planeElement, diMembers); assert.equal(bo.sourceRef, source); assert.equal(bo.targetRef, target);
      assert.equal(source.outgoing, outgoing); assert.equal(target.incoming, incoming); assert.deepEqual(outgoing, [bo]); assert.deepEqual(incoming, [bo]);
      if (!n) await artifact(restored);
      m.get('commandStack').redo(); assert.equal(await save(m), deleted, 'Redo remains byte-exact');
    }
  } finally { m.destroy(); }
});

test('the fixture-scoped reference oracle rejects unknown order, IDs, geometry, refs and metadata changes', async () => {
  const mutate = async (xml, change) => { const parsed = await oracle.fromXML(xml); assert.deepEqual(parsed.warnings, []); change(parsed); return (await oracle.toXML(parsed.rootElement, { format: true })).xml; };
  const corruptions = [
    p => { p.rootElement.id = 'OtherDefinitions'; },
    p => { p.rootElement.targetNamespace = 'urn:other'; },
    p => { p.elementsById.HoverProcess.flowElements.reverse(); },
    p => { p.elementsById.HoverProcess.flowElements.push(oracle.create('bpmn:Task', { id: 'Unexpected' })); },
    p => { p.elementsById.HoverProcess.flowElements.pop(); },
    p => { p.elementsById.FlowA.sourceRef = p.elementsById.SourceB; },
    p => { p.elementsById.FlowA.targetRef = p.elementsById.TargetB; },
    p => { p.elementsById.SourceA.outgoing = []; },
    p => { p.elementsById.FlowA.$attrs['v:sentinel'] = 'LOST'; },
    p => { p.elementsById.FlowA_di.$attrs['v:sentinel'] = 'LOST'; },
    p => { p.elementsById.HoverProcess.extensionElements.values[0].$body = 'Altered'; },
    p => { p.elementsById.SourceA_di.bounds.x += 1; },
    p => { p.elementsById.FlowA_di.waypoint[2].y += .25; },
    p => { p.elementsById.FlowA_di.waypoint.reverse(); },
    p => { p.elementsById.HoverPlane.planeElement.reverse(); },
    p => { p.elementsById.HoverPlane.planeElement.pop(); }
  ];
  for (const change of corruptions) await assert.rejects(assertUpstreamHoverDeleteUndo(baseline, await mutate(restored, change)));
  await assert.rejects(assertUpstreamHoverDeleteUndo(restored, restored), 'the exception cannot accept an arbitrary starting order');
  await assert.rejects(assertUpstreamHoverDeleteUndo(baseline, baseline), 'the reference transform is exact, not global sorting');
});

test('local Delete/Undo still preserves original bytes, raw mixed metadata and exact containment', async () => {
  const m = new Local({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    assert.deepEqual((await m.importXML(fixture)).warnings, []);
    const beforeXML = await m.getXML(), flow = m.getElement('FlowA'), owner = flow.businessObject.$parent;
    const members = owner.flowElements, prior = members.slice();
    assert.ok(beforeXML.includes('Hover <!-- hover-owner-marker -->controls<?hover preserve?>'));
    m.delete(flow); const deleted = await m.getXML();
    await artifact(beforeXML); await artifact(deleted);
    for (let n = 0; n < 3; n++) {
      m.undo(); assert.equal(await m.getXML(), beforeXML); assert.equal(m.getElement('FlowA'), flow);
      assert.equal(owner.flowElements, members); assert.deepEqual(members, prior);
      m.redo(); assert.equal(await m.getXML(), deleted);
    }
  } finally { m.destroy(); }
});

test('actual pinned reopen after Delete/Undo changes only the two restored flow DI positions', async () => {
  const m = new Upstream({ container: dom.createContainer() });
  try {
    assert.deepEqual((await m.importXML(restored)).warnings, []); reopened = await save(m);
    await assertUpstreamHoverDeleteReopen(restored, reopened); await artifact(reopened);
    for (let n = 0; n < 2; n++) {
      assert.deepEqual((await m.importXML(reopened)).warnings, []);
      assert.equal(await save(m), reopened, 'the measured reorder stabilizes after the first import');
    }
  } finally { m.destroy(); }
});

test('reference reopen allowance rejects unrelated containment, DI, geometry, ref and metadata changes', async () => {
  const corruptions = [
    p => { p.rootElement.id = 'OtherDefinitions'; },
    p => { p.elementsById.HoverProcess.flowElements.reverse(); },
    p => { p.elementsById.HoverProcess.flowElements.push(oracle.create('bpmn:Task', { id: 'Unexpected' })); },
    p => { p.elementsById.FlowA.sourceRef = p.elementsById.SourceB; },
    p => { p.elementsById.TargetA.incoming = []; },
    p => { p.elementsById.FlowA.$attrs['v:sentinel'] = 'LOST'; },
    p => { p.elementsById.FlowA_di.$attrs['v:sentinel'] = 'LOST'; },
    p => { p.elementsById.HoverProcess.extensionElements.values[0].$body = 'Altered'; },
    p => { p.elementsById.SourceA_di.bounds.y += .5; },
    p => { p.elementsById.FlowA_di.waypoint[2].x += .25; },
    p => { p.elementsById.FlowA_di.waypoint.reverse(); },
    p => { p.elementsById.HoverPlane.planeElement.reverse(); },
    p => { p.elementsById.HoverPlane.planeElement.pop(); }
  ];
  for (const change of corruptions) {
    const parsed = await oracle.fromXML(reopened); change(parsed);
    await assert.rejects(assertUpstreamHoverDeleteReopen(restored, (await oracle.toXML(parsed.rootElement, { format: true })).xml));
  }
  await assert.rejects(assertUpstreamHoverDeleteReopen(restored, restored));
  await assert.rejects(assertUpstreamHoverDeleteReopen(baseline, reopened));
});
