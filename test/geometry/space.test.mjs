import test from 'node:test';
import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';
import { loadUpstreamRules } from '../helpers/upstream-rules.mjs';
import { spaceAdjustments } from '../../lib/modeling/Geometry.js';
const [rules,space]=await Promise.all([loadUpstreamRules(),loadUpstreamRules('node_modules/bpmn-js/lib/features/space-tool/BpmnSpaceTool.js')]);
const m=new BpmnModdle();
function shape(id,type,parent,x,y,width,height,attrs={}) {
  const businessObject=m.create('bpmn:'+type,{id,...attrs});
  const node={id,type:businessObject.$type,businessObject,parent,x,y,width,height,children:[],attachers:[],di:m.create('bpmndi:BPMNShape',{isExpanded:true,isHorizontal:true})};
  parent?.children.push(node);return node;
}
const root=shape('Root','Collaboration',null,0,0,0,0);
const pool=shape('Pool','Participant',root,0,0,1000,500,{processRef:m.create('bpmn:Process')});
const sub=shape('Sub','SubProcess',pool,100,100,500,250);
const a=shape('A','Task',sub,150,150,100,80),b=shape('B','Task',sub,450,150,100,80),c=shape('C','Task',pool,750,150,100,80);
const boundary=shape('Boundary','BoundaryEvent',pool,550,280,36,36);boundary.host=sub;sub.attachers.push(boundary);
const annotation=shape('Note','TextAnnotation',root,300,30,400,50);
const blackbox=shape('External','Participant',root,0,600,1000,100);
const edge={id:'Flow',type:'bpmn:SequenceFlow',parent:sub,businessObject:m.create('bpmn:SequenceFlow'),source:a,target:b,waypoints:[{x:250,y:190},{x:450,y:190}]};
const label={id:'Flow_label',type:'label',businessObject:edge.businessObject,parent:sub,labelTarget:edge,x:300,y:170,width:90,height:20};edge.label=label;
const elements=[root,pool,sub,a,b,c,boundary,annotation,blackbox,edge,label];
const context={_rules:{allowed:(_action,{shape})=>rules.canResize(shape)},_canvas:{getRootElement:()=>root}};
const ids=nodes=>nodes.map(n=>n.id).sort();
for (const axis of ['x','y']) for(const delta of [-100,100]) for(const coordinate of [50,200,400,700]) {
  test(`space planner matches upstream ${axis} at ${coordinate} delta ${delta}`,()=>{
    const expected=space.calculateAdjustments.call(context,elements,axis,delta,coordinate);
    const actual=spaceAdjustments(elements,axis==='x'?'horizontal':'vertical',coordinate,delta);
    assert.deepEqual(ids(actual.movingShapes),ids(expected.movingShapes));
    assert.deepEqual(ids(actual.resizingShapes),ids(expected.resizingShapes));
  });
}
test('expands intersected pool/subprocess while preserving independent child movements',()=>{
  const plan=spaceAdjustments(elements,'horizontal',400,100);
  assert.ok(plan.resizingShapes.includes(pool));assert.ok(plan.resizingShapes.includes(sub));
  assert.ok(plan.movingShapes.includes(b));assert.ok(!plan.movingShapes.includes(a));
  assert.equal(plan.resizes.find(r=>r.node===pool).bounds.width,1100);
  assert.equal(plan.resizes.find(r=>r.node===sub).bounds.width,600);
});
test('compression clamps before shrinking past stationary or moved children',()=>{
  const plan=spaceAdjustments(elements,'horizontal',400,-1000,{direction:'e'});
  assert.ok(plan.delta.x>-1000);
  for(const resize of plan.resizes) assert.ok(resize.bounds.width>=100);
  assert.ok(b.x+plan.delta.x>=sub.x+20);
});

test('invalid public space constraints reject before producing invalid geometry',()=>{
  for(const options of [{minWidth:NaN},{minWidth:-100,padding:-100},{minHeight:Infinity},{minHeight:0},{padding:-1},{padding:'20'},null]) {
    assert.throws(()=>spaceAdjustments(elements,'horizontal',400,-1000,options),/Space option/);
  }
});
