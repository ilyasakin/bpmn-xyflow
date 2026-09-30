import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { getShapePaintOrder } from '../../lib/util/PaintOrder.js';
import { setupDOM } from '../helpers/dom.mjs';
const dom = await setupDOM();
const { default: Viewer } = await dom.loadModule('/lib/Viewer.js');
after(() => dom.cleanup());

function assertBackgroundsBehindMembers(viewer) {
  const order = [...viewer.getSvg().querySelector('.bpmn-xyflow-shapes').children].map(g => g.dataset.elementId);
  const before = (a,b) => {
    if (order.includes(a) && order.includes(b)) assert.ok(order.indexOf(a) < order.indexOf(b), `${a} must paint before ${b}`);
  };
  for (const node of viewer.getGraph().nodes) {
    if (node.type === 'label') continue;
    if (node.parent) before(node.parent.id, node.id);
    if (node.host) before(node.host.id, node.id);
    if (node.type === 'bpmn:Lane') for (const member of node.businessObject.flowNodeRef || []) before(node.id,member.id);
  }
  return order;
}

test('stable paint order honors lane membership, nested containers, host and frame dependencies', () => {
  const root={id:'root'}, pool={id:'pool',type:'bpmn:Participant',parent:root};
  const task={id:'task',type:'bpmn:Task',parent:pool};
  const lane={id:'lane',type:'bpmn:Lane',parent:pool,businessObject:{flowNodeRef:[{id:'task'}]}};
  const frame={id:'frame',isFrame:true,parent:pool};
  const boundary={id:'boundary',host:task,parent:pool};
  const peer={id:'peer',parent:pool};
  const input=[boundary,task,peer,lane,frame,pool], snapshot=[...input];
  const ordered=getShapePaintOrder(input).map(n=>n.id);
  assert.deepEqual(ordered,['pool','frame','lane','task','boundary','peer']);
  assert.deepEqual(input,snapshot);
});

for (const name of ['approval-rejection-rework','order-payment-delivery','booking-timeout-compensation']) {
  test(`${name}: initial render and repeated container redraw keep children above backgrounds`, async () => {
    const viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:false});
    try {
      await viewer.importXML(await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8'));
      const originalNodes=[...viewer.getGraph().nodes];
      const before=assertBackgroundsBehindMembers(viewer);
      const containers=viewer.getGraph().nodes.filter(n=>n.type==='bpmn:Lane'||n.type==='bpmn:Participant'||n.businessObject.$instanceOf('bpmn:SubProcess'));
      for (const container of containers) {
        viewer.select(container.id);viewer._internals.redrawShape(container);
        assert.deepEqual(assertBackgroundsBehindMembers(viewer),before);
        assert.ok(viewer._internals.elementGfx(container.id).classList.contains('is-selected'));
        assert.notEqual(viewer._internals.elementGfx(container.id).style.pointerEvents,'none');
        // Undo/restoration can recreate a missing container graphic too.
        viewer._internals.removeElementGfx(container.id);viewer._internals.redrawShape(container);
        assert.deepEqual(assertBackgroundsBehindMembers(viewer),before);
      }
      assert.deepEqual(viewer.getGraph().nodes,originalNodes);
    } finally {viewer.destroy();}
  });
}
