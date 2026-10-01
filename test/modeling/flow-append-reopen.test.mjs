import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { assertUpstreamFlowAppendReopen } from '../helpers/flow-append-reopen-oracle.mjs';

const dom = await setupDOM();
after(() => dom.cleanup());
const { default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
const moddle = new BpmnModdle();
const records = new Map();
const parse = async xml => { const result = await moddle.fromXML(xml); assert.deepEqual(result.warnings, []); return result; };
const serialize = async parsed => (await moddle.toXML(parsed.rootElement, { format: true })).xml;

async function fixture(ownerId) {
  const parsed = await parse(await readFile(`test/fixtures/flow-native/${ownerId === 'ApproveFlow' ? 'approval-source' : 'message-source'}.bpmn`, 'utf8'));
  if (ownerId === 'ApproveFlow') {
    const edge = parsed.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === ownerId);
    edge.waypoint = [ { x: 700, y: 348 }, { x: 1100, y: 348 } ].map(point => moddle.create('dc:Point', point));
  }
  for (const root of parsed.rootElement.rootElements) if (root.artifacts) root.artifacts = root.artifacts.filter(element => ![ 'PolicyNote', 'PolicyAssociation' ].includes(element.id));
  for (const diagram of parsed.rootElement.diagrams) diagram.plane.planeElement = diagram.plane.planeElement.filter(di => ![ 'PolicyNote', 'PolicyAssociation' ].includes(di.bpmnElement.id));
  return serialize(parsed);
}

for (const ownerId of [ 'ApproveFlow', 'OrderMessage' ]) {
  test(`${ownerId}: actual pinned click and append command reimport change only the measured DI order`, async () => {
    const modeler = new Upstream({ container: dom.createContainer() });
    try {
      for (const mode of [ 'click', 'append-command' ]) {
        assert.deepEqual((await modeler.importXML(await fixture(ownerId))).warnings, []);
        modeler.get('canvas').scrollToElement = () => {};
        const registry = modeler.get('elementRegistry'), flow = registry.get(ownerId), previous = new Set(registry.getAll());
        if (mode === 'click') modeler.get('contextPad').getEntries(flow)['append.text-annotation'].action.click({}, flow);
        else modeler.get('modeling').appendShape(flow, { type: 'bpmn:TextAnnotation' }, { x: 1030, y: 740 }, modeler.get('canvas').getRootElement());
        const note = registry.getAll().find(element => !previous.has(element) && element.type === 'bpmn:TextAnnotation');
        const association = registry.getAll().find(element => !previous.has(element) && element.type === 'bpmn:Association');
        const context = { ownerId, noteId: note.id, associationId: association.id };
        const before = (await modeler.saveXML({ format: true })).xml;
        assert.deepEqual((await modeler.importXML(before)).warnings, []);
        const after = (await modeler.saveXML({ format: true })).xml;
        const evidence = await assertUpstreamFlowAppendReopen(before, after, context);
        assert.notDeepEqual(evidence.inputOrder, evidence.outputOrder);
        records.set(`${ownerId}-${mode}`, { before, after, context });
      }
    } finally { modeler.destroy(); }
  });
}

test('fixture-scoped reopen check rejects every unmeasured model or DI mutation', async () => {
  const record = records.get('ApproveFlow-click');
  assert.ok(record, 'actual upstream evidence is available');
  const mutate = async (side, edit) => {
    const parsed = await parse(record[side]);
    edit(parsed);
    const changed = await serialize(parsed);
    await assert.rejects(assertUpstreamFlowAppendReopen(side === 'before' ? changed : record.before, side === 'after' ? changed : record.after, record.context));
  };
  await mutate('before', p => p.rootElement.diagrams[0].plane.planeElement.reverse());
  await mutate('after', p => p.rootElement.diagrams[0].plane.planeElement.reverse());
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement[0].id = 'UnknownDiagramEntry'; });
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement.push(moddle.create('bpmndi:BPMNShape', {
    id: 'UnexpectedExtraDI', bpmnElement: p.elementsById[record.context.noteId],
    bounds: moddle.create('dc:Bounds', { x: 10, y: 20, width: 100, height: 40 })
  })); });
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement.pop(); });
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement[0].bounds.x += .125; });
  await mutate('after', p => { p.elementsById[record.context.associationId].sourceRef = p.elementsById.ReviewFlow; });
  await mutate('after', p => { p.elementsById[record.context.noteId].text = 'Unexpected semantic edit'; });
  await mutate('after', p => { p.elementsById.ApproveFlow.conditionExpression.body = '${unexpected}'; });
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === 'ApproveFlow').waypoint[0].x += .125; });
  await mutate('after', p => { p.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === 'ApproveFlow').$attrs['qa:trace'] = 'changed'; });
  await mutate('after', p => { p.elementsById.ApprovalProcess.flowElements.reverse(); });
  await assert.rejects(assertUpstreamFlowAppendReopen(record.before, record.after, { ...record.context, ownerId: 'UnknownFlow' }));
});
