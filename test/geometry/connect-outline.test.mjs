import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuleModule } from '../helpers/upstream-rules.mjs';
const { connectOutlineGeometry: geometry, connectOutlinePath: path } = await loadRuleModule('lib/modeling/ConnectOutline.js');
const node = (type, width = 100, height = 80) => ({ type:`bpmn:${type}`, x:13.25, y:27.125, width, height });
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
for (const zoom of [.2,.65,1,2,4]) test(`visual-only outward gap at zoom ${zoom}`,()=>{
  for (const [type,width,height,border] of [['Task',100,80,2],['CallActivity',100,80,5],['Transaction',300,180,2],['StartEvent',36,36,2],['EndEvent',36,36,4],['ExclusiveGateway',50,50,2],['InclusiveGateway',80,50,2],['Participant',500,180,1.5]]){
    const n=node(type,width,height),before=structuredClone(n),g=geometry(n,zoom,border);
    assert.ok(path(g));assert.deepEqual(n,before,'no model mutation');
    near((g.x+g.width/2),n.x+width/2);near(g.y+g.height/2,n.y+height/2);
    let outward;
    if (g.kind==='diamond'){
      // Compare parallel side lines using their distance to the unchanged center.
      const oldDistance=1/Math.hypot(2/width,2/height);
      const newDistance=1/Math.hypot(2/g.width,2/g.height);
      outward=newDistance-oldDistance;
    }else outward=n.x-g.x;
    near((outward-border/2)*zoom-.5,2.5);
    near(g.strokeWidth*zoom,1);
    if(g.kind==='rounded') near(g.radius-10,g.padding);
  }
});
test('invalid or absent geometry creates no misleading outline',()=>{
  assert.equal(geometry(node('Task'),0),null);
  assert.equal(geometry(node('Task'),1,-1),null);
  assert.equal(geometry({...node('Task'),width:NaN},1),null);
  assert.equal(path(null),null);
});

test('fractional and non-square events offset the painted circle rather than its DI width',()=>{
 for(const [width,height] of [[36,50],[36.5,36.5],[47.25,31.75]]) {
  const n=node('BoundaryEvent',width,height),paint={x:n.x+width/2,y:n.y+height/2,radius:Math.round((width+height)/4)};
  for(const zoom of [.25,1,3]) {
   const g=geometry(n,zoom,4,2.5,paint);
   near(g.x+g.width/2,paint.x);near(g.y+g.height/2,paint.y);
   near((g.width/2-paint.radius-2)*zoom-.5,2.5);
   assert.equal(g.width,g.height);
  }
 }
});
