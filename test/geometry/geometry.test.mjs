import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentMoves, distributionMoves, spaceMoves } from '../../lib/modeling/Geometry.js';
const node = (id,x,y,width=100,height=80) => ({ id,x,y,width,height });
test('alignment preserves widths and skips descendants of selected containers', () => {
  const a=node('a',0,0), b=node('b',200,100,50), child={...node('c',220,120),parent:b};
  assert.deepEqual(alignmentMoves([a,b,child], 'right').map(m=>[m.node.id,m.dx,m.dy]), [['a',150,0]]);
  assert.equal(child.x,220);
});
test('distribution creates equal edge gaps with unequal sizes and fixed endpoints', () => {
  const a=node('a',0,0), b=node('b',110,0,50), c=node('c',400,0,100);
  assert.deepEqual(distributionMoves([c,b,a],'horizontal').map(m=>[m.node.id,m.dx]), [['b',115]]);
});
test('space moves only shapes on the selected side and does not double-move children', () => {
  const a=node('a',0,0), b=node('b',100,0), child={...node('c',120,0),parent:b};
  assert.deepEqual(spaceMoves([a,b,child],'horizontal',100,40).map(m=>[m.node.id,m.dx]), [['b',40]]);
});
test('invalid commands reject and degenerate selections are harmless', () => {
  assert.throws(()=>alignmentMoves([],'diagonal'));
  assert.throws(()=>spaceMoves([],'horizontal',Infinity,1));
  assert.deepEqual(distributionMoves([node('a',0,0)],'vertical'),[]);
});
