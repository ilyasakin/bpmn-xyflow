import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { assertFlowAppendGeometry } from '../helpers/flow-append-geometry-oracle.mjs';

const dom = await setupDOM();
after(() => dom.cleanup());
const { default: Upstream } = await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
const { default: Local } = await dom.loadModule('/lib/Modeler.js');
const { isDirectionHorizontal } = await dom.loadModule('/node_modules/bpmn-js/lib/features/modeling/util/ModelingUtil.js');
const { annotationAppendPosition } = await dom.loadModule('/lib/modeling/ConnectionRouting.js');
const moddle = new BpmnModdle(), records = new Map();
let artifact = 0;
const xy = ({ x, y }) => ({ x, y });
const bounds = ({ x, y, width, height }) => ({ x, y, width, height });
async function fixture(ownerId) {
  const parsed = await moddle.fromXML(await readFile(`test/fixtures/flow-native/${ownerId === 'ApproveFlow' ? 'approval-source' : 'message-source'}.bpmn`, 'utf8'));
  assert.deepEqual(parsed.warnings, []);
  if (ownerId === 'ApproveFlow') parsed.rootElement.diagrams[0].plane.planeElement.find(di => di.bpmnElement.id === ownerId).waypoint =
    [ { x: 700, y: 348 }, { x: 1100, y: 348 } ].map(p => moddle.create('dc:Point', p));
  for (const root of parsed.rootElement.rootElements) if (root.artifacts) root.artifacts = root.artifacts.filter(e => ![ 'PolicyNote', 'PolicyAssociation' ].includes(e.id));
  for (const diagram of parsed.rootElement.diagrams) diagram.plane.planeElement = diagram.plane.planeElement.filter(di => ![ 'PolicyNote', 'PolicyAssociation' ].includes(di.bpmnElement.id));
  return (await moddle.toXML(parsed.rootElement, { format: true })).xml;
}

for (const ownerId of [ 'ApproveFlow', 'OrderMessage' ]) test(`${ownerId}: full pinned append and local commands preserve exact placement with explicit crop precision`, async () => {
  const upstream = new Upstream({ container: dom.createContainer() });
  const local = new Local({ container: dom.createContainer(), fitViewOnInit: false });
  try {
    for (const mode of [ 'click', 'drag' ]) {
      const xml = await fixture(ownerId), outputs = {};
      await upstream.importXML(xml); await local.importXML(xml);
      const registry = upstream.get('elementRegistry'), source = registry.get(ownerId);
      assert.equal(isDirectionHorizontal(source, registry), ownerId === 'OrderMessage' ? undefined : true);
      const candidate = upstream.get('elementFactory').createShape({ type: 'bpmn:TextAnnotation' });
      const predicted = annotationAppendPosition(local.getElement(ownerId), candidate, { elements: local.getGraph().nodes, edges: local.getGraph().edges });
      assert.deepEqual(predicted, upstream.get('eventBus').fire('autoPlace', { source, shape: candidate }));
      for (const engine of [ 'upstream', 'local' ]) {
        const isLocal = engine === 'local', m = isLocal ? local : upstream;
        const flow = isLocal ? m.getElement(ownerId) : source;
        const elements = () => isLocal ? [ ...m.getGraph().nodes, ...m.getGraph().edges ] : registry.getAll();
        const old = new Set(elements()), before = isLocal ? await m.getXML() : (await m.saveXML({ format: true })).xml;
        if (isLocal) {
          if (mode === 'click') { m.select(ownerId); const button = m.getContainer().querySelector('[data-action="append.text-annotation"]'); assert.ok(button); button.click(); }
          else { const note = m.addShape('bpmn:TextAnnotation', { x: 1030, y: 740 }, { parent: m.getGraph().roots[0] }); assert.ok(m.connect(flow, note)); }
        } else {
          m.get('canvas').scrollToElement = () => {};
          if (mode === 'click') m.get('contextPad').getEntries(flow)['append.text-annotation'].action.click({}, flow);
          else m.get('modeling').appendShape(flow, { type: 'bpmn:TextAnnotation' }, { x: 1030, y: 740 }, m.get('canvas').getRootElement());
        }
        const added = elements().filter(e => !old.has(e)), note = added.find(e => e.type === 'bpmn:TextAnnotation'), edge = added.find(e => e.type === 'bpmn:Association');
        assert.ok(note && edge); assert.equal(edge.source, flow); assert.equal(edge.target, note);
        outputs[engine] = { bounds: bounds(note), points: edge.waypoints.map(xy), owner: edge.businessObject.$parent.id };
        const afterXML = isLocal ? await m.getXML() : (await m.saveXML({ format: true })).xml;
        assert.deepEqual((await moddle.fromXML(afterXML)).warnings, []);
        if (process.env.BPMN_XML_ARTIFACT_DIR) {
          await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
          await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `flow-append-geometry-${++artifact}.bpmn`), afterXML);
        }
        if (mode === 'click') for (let i = 0; i < 3; i++) {
          if (isLocal) m.undo(); else m.get('commandStack').undo();
          assert.equal(isLocal ? await m.getXML() : (await m.saveXML({ format: true })).xml, before);
          if (isLocal) m.redo(); else m.get('commandStack').redo();
          assert.equal(isLocal ? await m.getXML() : (await m.saveXML({ format: true })).xml, afterXML);
        }
      }
      assertFlowAppendGeometry(outputs, { ownerId, mode }); records.set(`${ownerId}-${mode}`, outputs);
    }
  } finally { upstream.destroy(); local.destroy(); }
});

test('append geometry oracle rejects unrelated placement, source, owner and precision changes', () => {
  for (const ownerId of [ 'ApproveFlow', 'OrderMessage' ]) for (const mode of [ 'click', 'drag' ]) {
    const outputs = records.get(`${ownerId}-${mode}`); assert.ok(outputs);
    for (const engine of [ 'local', 'upstream' ]) for (const edit of [
      o => { o.bounds.x += .0001; }, o => { o.bounds.y += .0001; }, o => { o.bounds.width += .0001; },
      o => { o.owner = 'WrongOwner'; }, o => { o.points[0].x += .0001; },
      o => { o.points[1].x += .0001; }, o => { o.points[1].y += .0001; },
      o => { o.points.push({ x: 1, y: 2 }); }, o => { o.points[1].x = NaN; }
    ]) { const changed = structuredClone(outputs); edit(changed[engine]); assert.throws(() => assertFlowAppendGeometry(changed, { ownerId, mode })); }
  }
  assert.throws(() => assertFlowAppendGeometry({}, { ownerId: 'Unknown', mode: 'click' }));
  assert.throws(() => assertFlowAppendGeometry({}, { ownerId: 'ApproveFlow', mode: 'unknown' }));
});
