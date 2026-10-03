import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { prepareGroupPaintFixture } from '../helpers/group-paint-fixture.mjs';
import { assertUpstreamSharedGroupDelete } from '../helpers/group-delete-oracle.mjs';

const dom = await setupDOM();
after(() => dom.cleanup());
const { default: Local } = await dom.loadModule('/lib/Modeler.js');
// Use the exact official bundle loaded by the native suite, not just the
// package source and its independently resolved diagram-js dependency.
const bundled = { exports: {} };
new Function('module', 'exports', await readFile('node_modules/bpmn-js/dist/bpmn-modeler.development.js', 'utf8'))(bundled, bundled.exports);
const Upstream = bundled.exports, oracle = new BpmnModdle();
const parse = async xml => { const result = await oracle.fromXML(xml); assert.deepEqual(result.warnings, []); return result; };
const canonical = async parsed => (await oracle.toXML(parsed.rootElement, { format: true })).xml;
async function artifact(name, xml) {
  if (!process.env.BPMN_XML_ARTIFACT_DIR) return;
  await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
  await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `group-native-setup-${name}.bpmn`), xml);
}

test('prepared paint fixture changes only known setup omissions and reopens exactly', async () => {
  const original = await readFile('test/fixtures/group-native/overlap.bpmn', 'utf8');
  const input = await prepareGroupPaintFixture(original), parsed = await parse(input), expected = await parse(original);
  const frame = expected.elementsById.Frame;
  expected.elementsById.Process_1.artifacts = expected.elementsById.Process_1.artifacts.filter(e => e !== frame);
  expected.rootElement.diagrams[0].plane.planeElement = expected.rootElement.diagrams[0].plane.planeElement.filter(di => di.bpmnElement !== frame);
  expected.elementsById.Source.outgoing = [ expected.elementsById.Flow ];
  expected.elementsById.Target.incoming = [ expected.elementsById.Flow ];
  expected.rootElement.$attrs['xmlns:xsi'] = 'http://www.w3.org/2001/XMLSchema-instance';
  assert.equal(await canonical(parsed), await canonical(expected));
  const m = new Local({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    await m.importXML(input); const saved = await m.getXML();
    assert.equal(await canonical(await parse(saved)), await canonical(parsed), 'initial prepared setup preserves the whole independent model');
    await m.importXML(saved); assert.equal(await m.getXML(), saved, 'actual exported XML reopens byte-exact');
    await artifact('paint', saved);
  } finally { m.destroy(); }
  assert.equal(await readFile('test/fixtures/group-native/overlap.bpmn', 'utf8'), original, 'source fixture remains unchanged');
});

test('paint preparation rejects unknown identities or preexisting inverse-reference changes', async () => {
  const xml = await readFile('test/fixtures/group-native/overlap.bpmn', 'utf8');
  for (const change of [
    s => s.replace('id="GroupDefinitions"', 'id="Unknown"'),
    s => s.replace('targetRef="Target"', 'targetRef="Source"'),
    s => s.replace('<bpmn:task id="Source"/>', '<bpmn:task id="Source"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:task>')
  ]) await assert.rejects(prepareGroupPaintFixture(change(xml)));
});

const deleteRecords = [];
for (const trace of [ false, true ]) test(`actual bundled owner-only Delete clears only the shared title; observation ${trace ? 'enabled' : 'absent'}`, async () => {
  const m = new Upstream({ container: dom.createContainer() });
  try {
    await m.importXML(await readFile('test/fixtures/group-native/shared.bpmn', 'utf8'));
    m.get('modeling').updateLabel(m.get('elementRegistry').get('GroupA'), 'Renamed shared category');
    await m.importXML((await m.saveXML({ format: true })).xml);
    const registry = m.get('elementRegistry'), group = registry.get('GroupA');
    m.get('selection').select(group);
    assert.deepEqual(m.get('selection').get().map(e => e.id), [ 'GroupA' ]);
    assert.equal(m.get('directEditing').isActive(), false);
    const before = (await m.saveXML({ format: true })).xml, events = [];
    if (trace) m.get('eventBus').on('commandStack.shape.delete.postExecute', 20000, event => {
      // A non-void EventBus observer would stop subsequent handlers. This
      // callback is intentionally void, like the native diagnostic observer.
      events.push({ shape: event.context.shape.id, labelTarget: event.context.labelTarget?.id });
    });
    m.get('editorActions').trigger('removeSelection');
    const after = (await m.saveXML({ format: true })).xml, actual = await parse(after), expected = await parse(before);
    const old = expected.elementsById.GroupA;
    old.$parent.artifacts = old.$parent.artifacts.filter(e => e !== old);
    for (const diagram of expected.rootElement.diagrams) diagram.plane.planeElement = diagram.plane.planeElement.filter(di => di.bpmnElement !== old);
    assert.equal(actual.elementsById.GroupA, undefined);
    assert.equal(actual.elementsById.GroupB.categoryValueRef.value, undefined);
    delete expected.elementsById.ReviewValue.value;
    assert.equal(await canonical(actual), await canonical(expected), 'all other semantics, references, metadata and DI stay exact');
    await assertUpstreamSharedGroupDelete(before, after);
    if (trace) assert.deepEqual(events.map(event => event.shape), [ 'GroupA_label', 'GroupA' ]);
    deleteRecords.push({ before, after });
    if (trace) assert.deepEqual(deleteRecords[1], deleteRecords[0], 'read-only tracing must not change any command outcome');
    await artifact(`shared-${trace ? 'trace' : 'plain'}-before`, before); await artifact(`shared-${trace ? 'trace' : 'plain'}-after`, after);
  } finally { m.destroy(); }
});

test('shared-delete oracle rejects unrelated title, reference, documentation, geometry and order changes', async () => {
  const { before, after } = deleteRecords[0];
  for (const edit of [
    p => { p.elementsById.ReviewValue.value = 'Unexpected'; },
    p => { delete p.elementsById.GroupB.categoryValueRef; },
    p => { p.elementsById.ReviewValue.documentation[0].text = 'Changed'; },
    p => { p.elementsById.ReviewCategory.$attrs['qa:trace'] = 'Changed'; },
    p => { p.rootElement.diagrams[0].plane.planeElement[0].bounds.x += .001; },
    p => { p.rootElement.diagrams[0].plane.planeElement.reverse(); }
  ]) { const p = await parse(after); edit(p); await assert.rejects(assertUpstreamSharedGroupDelete(before, await canonical(p))); }
});

test('negative control detects a non-void observer suppressing lower-priority command handlers', async () => {
  const before = deleteRecords[0].before, m = new Upstream({ container: dom.createContainer() });
  try {
    await m.importXML(before); m.get('selection').select(m.get('elementRegistry').get('GroupA'));
    // Deliberately reproduce the faulty observer; returning a value stops the
    // lower-priority LabelBehavior callback, so the strict oracle must fail.
    m.get('eventBus').on('commandStack.shape.delete.postExecute', 20000, () => 1);
    m.get('editorActions').trigger('removeSelection');
    const after = (await m.saveXML({ format: true })).xml, parsed = await parse(after);
    assert.equal(parsed.elementsById.GroupB.categoryValueRef.value, 'Renamed shared category');
    await assert.rejects(assertUpstreamSharedGroupDelete(before, after));
  } finally { m.destroy(); }
});
