import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM();
after(() => dom.cleanup());
const { externalLabelOwnerResizeDelta } = await dom.loadModule('/lib/modeling/ExternalLabelResize.js');
const { default: LabelBehavior } = await dom.loadModule('/node_modules/bpmn-js/lib/features/modeling/behavior/LabelBehavior.js');
const { default: EventBus } = await dom.loadModule('/node_modules/diagram-js/lib/core/EventBus.js');
const { default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');

const bounds = object => Object.fromEntries([ 'x', 'y', 'width', 'height' ].map(key => [ key, object[key] ]));

// Exercise the actual LabelBehavior listener. The local geometry helper and
// vendored LineUtil are not used to construct the expected movement.
function referenceDelta(labelBounds, oldBounds, newBounds) {
  const bus = new EventBus(), moves = [];
  const shape = { id: 'Owner', type: 'bpmn:Group', ...oldBounds };
  const label = { id: 'Owner_label', type: 'label', labelTarget: shape, ...labelBounds };
  shape.label = label;
  new LabelBehavior(bus, { moveShape: (target, delta) => moves.push({ target, delta }) }, {}, {});
  bus.fire('commandStack.shape.resize.postExecute', { context: { shape, oldBounds, newBounds } });
  assert.equal(moves.length, 1);
  assert.equal(moves[0].target, label);
  return moves[0].delta;
}

test('owner resize follows actual pinned LabelBehavior at each border, corner and fractional position', () => {
  let cases = 0;
  for (const old of [
    { x: 100, y: 200, width: 300, height: 220 },
    { x: -113.25, y: 29.125, width: 301.5, height: 221.75 }
  ]) {
    const labelCenters = [
      [ .5, -.2 ], [ 1.2, .5 ], [ .5, 1.2 ], [ -.2, .5 ],
      [ -.2, -.2 ], [ 1.2, -.2 ], [ 1.2, 1.2 ], [ -.2, 1.2 ],
      [ .5, .5 ], [ 0, 0 ], [ 1, 1 ], [ .25, 0 ]
    ];
    const changed = [
      { ...old, width: old.width + 80 },
      { ...old, x: old.x - 35.5, width: old.width + 35.5 },
      { ...old, y: old.y - 27.25, height: old.height + 27.25 },
      { ...old, x: old.x - 23.5, y: old.y - 37.25, width: old.width + 81.125, height: old.height + 57.75 },
      { ...old, x: old.x + 10.125, y: old.y + 7.75, width: old.width / 2, height: old.height / 2 },
      { ...old, x: old.x + 17.5, y: old.y - 28.25 },
      { ...old }
    ];
    for (const [ rx, ry ] of labelCenters) for (const next of changed) {
      const label = { x: old.x + rx * old.width - 50.75, y: old.y + ry * old.height - 7.125, width: 101.5, height: 14.25 };
      assert.deepEqual(externalLabelOwnerResizeDelta(label, old, next), referenceDelta(label, old, next));
      cases++;
    }
  }
  assert.equal(cases, 168);
});

test('planning leaves original fractional bounds and opaque metadata untouched', () => {
  const metadata = Object.freeze({ token: 'preserved' });
  const label = Object.freeze({ x: 405.25, y: 302.125, width: 101.5, height: 14.25, metadata });
  const old = Object.freeze({ x: 400.125, y: 300.25, width: 300.5, height: 220.75, metadata });
  const next = Object.freeze({ x: 376.625, y: 263, width: 381.625, height: 278.5, metadata });
  assert.deepEqual(externalLabelOwnerResizeDelta(label, old, next), referenceDelta(label, old, next));
  assert.equal(label.metadata, metadata);
  const noOp = externalLabelOwnerResizeDelta(label, old, old);
  assert.deepEqual(noOp, referenceDelta(label, old, old));
  assert.equal(Math.abs(noOp.x) + Math.abs(noOp.y), 0);
});

test('invalid owner or label bounds fail without an invalid movement', () => {
  const label = { x: 405, y: 300, width: 90, height: 14 };
  const old = { x: 400, y: 300, width: 300, height: 200 };
  const next = { ...old, width: 350 };
  for (const invalid of [ null, {}, { ...old, x: NaN }, { ...old, y: Infinity }, { ...old, width: -1 } ]) {
    assert.equal(externalLabelOwnerResizeDelta(invalid, old, next), null);
    assert.equal(externalLabelOwnerResizeDelta(label, invalid, next), null);
    assert.equal(externalLabelOwnerResizeDelta(label, old, invalid), null);
  }
  assert.equal(externalLabelOwnerResizeDelta(label, { ...old, width: 0 }, next), null);
  assert.equal(externalLabelOwnerResizeDelta(label, { ...old, height: 0 }, next), null);
});

test('planned label movement matches the complete pinned Group resize service', async () => {
  const modeler = new Upstream({ container: dom.createContainer() });
  try {
    let xml = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8');
    xml = xml.replace('</bpmn:process>', '<bpmn:group id="G" categoryValueRef="V"/></bpmn:process><bpmn:category id="C"><bpmn:categoryValue id="V" value="Group review label"/></bpmn:category>');
    xml = xml.replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNShape id="G_di" bpmnElement="G"><dc:Bounds x="400.125" y="300.25" width="300.5" height="220.75"/><bpmndi:BPMNLabel><dc:Bounds x="490.25" y="302.125" width="101.5" height="14.25"/></bpmndi:BPMNLabel></bpmndi:BPMNShape></bpmndi:BPMNPlane>');
    for (const change of [
      { x: 376.625, y: 263, width: 381.625, height: 278.5 },
      { x: 400.125, y: 300.25, width: 380.5, height: 260.75 },
      { x: 425.125, y: 320.25, width: 250.5, height: 190.75 }
    ]) {
      await modeler.importXML(xml);
      const group = modeler.get('elementRegistry').get('G');
      const old = bounds(group), label = bounds(group.label), businessObject = group.businessObject;
      const delta = externalLabelOwnerResizeDelta(label, old, change);
      modeler.get('modeling').resizeShape(group, change);
      assert.deepEqual(bounds(group.label), { ...label, x: label.x + delta.x, y: label.y + delta.y });
      assert.equal(group.businessObject, businessObject);
      assert.equal(group.businessObject.categoryValueRef.value, 'Group review label');
      modeler.get('commandStack').undo();
      assert.deepEqual(bounds(group), old);
      assert.deepEqual(bounds(group.label), label);
    }
  } finally { modeler.destroy(); }
});

test('LineUtil is byte-identical to the pinned primary source with its recorded hash', async () => {
  const manifest = JSON.parse(await readFile('lib/upstream/PROVENANCE.json', 'utf8'));
  const record = manifest.additionalSources['LineUtil.js'];
  assert.equal(manifest.version, '18.30.1');
  const local = await readFile('lib/upstream/LineUtil.js');
  assert.deepEqual(local, await readFile('node_modules/bpmn-js/' + record.source));
  assert.equal(createHash('sha256').update(local).digest('hex'), record.sha256);
});
