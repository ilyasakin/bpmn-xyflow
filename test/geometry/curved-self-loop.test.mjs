import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuleModule } from '../helpers/upstream-rules.mjs';
import { BpmnModdle } from '../../lib/bpmn/moddle.js';
const { layoutConnection, projectDocking } = await loadRuleModule('lib/modeling/ConnectionRouting.js');
const { default: Renderer } = await loadRuleModule('lib/draw/BpmnRenderer.js');
const renderer = { getShapePath: Renderer.prototype.getShapePath };
const moddle = new BpmnModdle();
function shape(type, x, y, width, height) { return { type: 'bpmn:' + type, x, y, width, height, businessObject: moddle.create('bpmn:' + type), di: {} }; }
function route(node, start, end) {
  return layoutConnection({ type: 'bpmn:SequenceFlow', businessObject: moddle.create('bpmn:SequenceFlow'), source: node, target: node, waypoints: [] }, { connectionStart: start, connectionEnd: end, preserveDocking: 'both' }, renderer);
}
const xy = p => ({ x: p.x, y: p.y });
test('native gateway loop retains distinct right and lower-left diamond anchors', () => {
  const node = shape('ExclusiveGateway', -288, -142, 50, 50);
  const drop = { x: -271.05030850274386, y: -100.13468929992416 };
  const result = route(node, { x: -238, y: -117 }, drop);
  const projectedX = (drop.x + drop.y - 171) / 2;
  assert.deepEqual(xy(result[0]), { x: -238, y: -117 });
  assert.ok(Math.hypot(result.at(-1).x - projectedX, result.at(-1).y - projectedX - 171) < 1e-7);
  assert.ok(result.length >= 4);
  assert.ok(result.some(p => p.x > -238 || p.y > -92));
});

for (const type of ['ExclusiveGateway', 'IntermediateCatchEvent', 'Task']) {
  test(`explicit ${type} self-loops keep curved dockings and never cross painted interior`, () => {
    const node = shape(type, 100, 100, type === 'Task' ? 100 : 50, type === 'Task' ? 80 : 50);
    const cx = node.x + node.width / 2, cy = node.y + node.height / 2;
    const candidates = [[node.x + node.width, cy], [node.x + node.width, cy + 10], [cx + 12, node.y + node.height], [node.x, cy - 10], [cx - 12, node.y]].map(([x, y]) => projectDocking(node, { x, y }, renderer));
    const inside = p => {
      const dx = Math.abs(p.x - cx), dy = Math.abs(p.y - cy);
      if (type === 'ExclusiveGateway') return dx + dy < 25 - 1e-7;
      if (type === 'IntermediateCatchEvent') return dx * dx + dy * dy < 625 - 1e-7;
      if (dx >= 50 - 1e-7 || dy >= 40 - 1e-7) return false;
      return Math.hypot(Math.max(0, dx - 40), Math.max(0, dy - 30)) < 10 - 1e-7;
    };
    for (const start of candidates) for (const end of candidates) {
      const result = route(node, start, end);
      assert.deepEqual(xy(result[0]), xy(start)); assert.deepEqual(xy(result.at(-1)), xy(end));
      for (let i = 1; i < result.length; i++) {
        const a = result[i - 1], b = result[i];
        assert.ok(a.x === b.x || a.y === b.y, 'every loop leg is orthogonal');
        for (let j = 1; j < 100; j++) assert.equal(inside({ x: a.x + (b.x - a.x) * j / 100, y: a.y + (b.y - a.y) * j / 100 }), false, 'loop has no painted-interior chord');
      }
    }
  });
}
