import test from 'node:test';
import assert from 'node:assert/strict';
import { fixedConnectionAnchors, projectFixedConnectionAnchor } from '../../lib/modeling/ConnectionAnchors.js';
import { loadRuleModule } from '../helpers/upstream-rules.mjs';
const { layoutConnection, normalizeConnectionAnchors, projectDocking, cropConnection, planSegmentMove } = await loadRuleModule('lib/modeling/ConnectionRouting.js');
const { default: Renderer } = await loadRuleModule('lib/draw/BpmnRenderer.js');
const renderer = { getShapePath: Renderer.prototype.getShapePath };
const shape = (type, x=400, y=200, width=50, height=50) => ({type:'bpmn:'+type,x,y,width,height});
const gateway = shape('ExclusiveGateway'), task=shape('Task',100,100,100,80);
const edge = (source,target,waypoints=[]) => ({type:'bpmn:SequenceFlow',source,target,waypoints});
const xy = p => ({x:p.x,y:p.y});
const vertices = n => [{x:n.x+n.width/2,y:n.y},{x:n.x+n.width,y:n.y+n.height/2},{x:n.x+n.width/2,y:n.y+n.height},{x:n.x,y:n.y+n.height/2}];
function fixed(n,p) { assert.ok(vertices(n).some(v=>v.x===p.x&&v.y===p.y),JSON.stringify(p)+' must be a diamond vertex'); }
function orthogonal(route){assert.ok(route.slice(1).every((p,i)=>p.x===route[i].x||p.y===route[i].y));}

test('every Gateway subtype selects only four vertices with deterministic nearest-point ties',()=>{
  for(const type of ['ExclusiveGateway','InclusiveGateway','ParallelGateway','ComplexGateway','EventBasedGateway']){
    const n=shape(type,100,200,60,40),expected=vertices(n);
    assert.deepEqual(fixedConnectionAnchors(n),expected);
    for(const [pointer,index]of [[{x:135,y:202},0],[{x:156,y:217},1],[{x:135,y:238},2],[{x:104,y:217},3]])
      assert.deepEqual(projectDocking(n,pointer),expected[index]);
  }
  assert.deepEqual(projectDocking(gateway,{x:412.5,y:212.5}),{x:425,y:200},'equal top/left distance prefers top');
  assert.deepEqual(projectDocking(gateway,{x:425,y:225}),{x:425,y:200},'center ties prefer top');
});

test('fixed policy is absent for other families and rejects malformed gateway inputs without mutation',()=>{
  for(const type of ['Task','StartEvent','SubProcess','Participant','DataObjectReference','DataStoreReference','TextAnnotation'])assert.equal(fixedConnectionAnchors(shape(type)),null);
  const snapshot=structuredClone(gateway);for(const value of [NaN,Infinity])assert.throws(()=>projectFixedConnectionAnchor(gateway,{x:value,y:0}),{code:'UNROUTABLE_DOCKING'});
  assert.throws(()=>fixedConnectionAnchors({...gateway,width:0}),{code:'UNROUTABLE_DOCKING'});assert.deepEqual(gateway,snapshot);
  assert.equal(fixedConnectionAnchors({...gateway,waypoints:[]}),null);
});

test('explicit create and reconnect route endpoints follow the same vertex selection and preserve opposite shape docking',()=>{
  const pointers=[{x:420,y:203},{x:446,y:218},{x:431,y:247},{x:403,y:232}],expected=vertices(gateway);
  for(const [i,pointer]of pointers.entries())for(const reverse of [false,true]){
    const fixedTask={x:200,y:137.25},source=reverse?gateway:task,target=reverse?task:gateway;
    const route=layoutConnection(edge(source,target),{connectionStart:reverse?pointer:fixedTask,connectionEnd:reverse?fixedTask:pointer,preserveDocking:'both'},renderer);
    assert.deepEqual(xy(reverse?route[0]:route.at(-1)),expected[i]);assert.deepEqual(xy(reverse?route.at(-1):route[0]),fixedTask);orthogonal(route);
  }
});

test('automatic layout and moved endpoint repair never install sloped diamond docking',()=>{
  for(const [x,y]of [[-200,200],[400,-200],[800,200],[400,600]])for(const reverse of [false,true]){
    const other=shape('Task',x+.125,y+.375,100,80),connection=edge(reverse?gateway:other,reverse?other:gateway);
    const route=layoutConnection(connection,{},renderer);fixed(gateway,reverse?route[0]:route.at(-1));orthogonal(route);
    const moved={...gateway,x:gateway.x+37.25,y:gateway.y+19.5};const hints=reverse?{source:moved,connectionStart:{x:moved.x+20,y:moved.y+12}}:{target:moved,connectionEnd:{x:moved.x+20,y:moved.y+12}};
    const next=layoutConnection({...connection,waypoints:route},hints,renderer);fixed(moved,reverse?next[0]:next.at(-1));orthogonal(next);
  }
});

test('pure outline cropping and unchanged imported layouts retain historical sloped endpoint metadata',()=>{
  const route=[{x:200,y:140,tag:'source'},{x:300,y:140,tag:'bend'},{x:300,y:212.5},{x:412.5,y:212.5,tag:'authored'}];
  const snapshot=structuredClone(route),connection=edge(task,gateway,route);
  assert.deepEqual(layoutConnection(connection,{},renderer),snapshot);
  assert.deepEqual(xy(cropConnection(route,task,gateway,renderer).at(-1)),xy(route.at(-1)));
  const edited=normalizeConnectionAnchors(connection,route,renderer);fixed(gateway,edited.at(-1));assert.equal(edited.at(-1).tag,'authored');assert.deepEqual(route,snapshot);
});

test('gateway adjacent segment edits keep vertex docking and exact source snapshots',()=>{
  const route=[{x:200,y:140},{x:300,y:140},{x:300,y:225},{x:400,y:225}],connection=edge(task,gateway,route),snapshot=structuredClone(route);
  const moved=planSegmentMove(connection,2,{x:0,y:8.25},renderer);fixed(gateway,moved.at(-1));orthogonal(moved);assert.deepEqual(route,snapshot);
});

test('all sixteen deliberate gateway vertex self-loops remain nondegenerate and outside the diamond',()=>{
  for(const start of vertices(gateway))for(const end of vertices(gateway)){
    const route=layoutConnection(edge(gateway,gateway),{connectionStart:start,connectionEnd:end,preserveDocking:'both'},renderer);
    assert.deepEqual(xy(route[0]),start);assert.deepEqual(xy(route.at(-1)),end);orthogonal(route);assert.ok(route.length>=4);
    for(let i=1;i<route.length;i++)for(let j=1;j<20;j++){
      const p={x:route[i-1].x+(route[i].x-route[i-1].x)*j/20,y:route[i-1].y+(route[i].y-route[i-1].y)*j/20};
      assert.ok(Math.abs(p.x-425)+Math.abs(p.y-225)>=25-1e-8,'no loop chord through gateway');
    }
  }
});


test('manual Gateway reconnect repairs only its terminal bridge and preserves all interior bend metadata',()=>{
 const route=[{x:200,y:140},{x:250,y:140,tag:'one'},{x:250,y:50,tag:'two'},{x:350,y:50,tag:'three'},{x:350,y:212.5},{x:400,y:214,tag:'moved'},{x:412.5,y:212.5,tag:'end'}],snapshot=structuredClone(route);
 const result=layoutConnection(edge(task,gateway,route),{connectionStart:route[0],connectionEnd:{x:421,y:202},preserveDocking:'both'},renderer);
 assert.deepEqual(xy(result.at(-1)),{x:425,y:200});assert.deepEqual(result.slice(1,6),route.slice(1,6));assert.equal(result.at(-1).tag,'end');assert.deepEqual(route,snapshot);
});
