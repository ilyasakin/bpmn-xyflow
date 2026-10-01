import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();after(()=>dom.cleanup());
const routing=await dom.loadModule('/lib/modeling/ConnectionRouting.js');
const {default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
const {getClosestPointOnConnection}=await dom.loadModule('/node_modules/.pnpm/bpmn-js@18.30.1/node_modules/diagram-js/lib/features/bendpoints/BendpointUtil.js');
const xy=p=>({x:p.x,y:p.y}),bounds=p=>({...xy(p),width:p.width,height:p.height});
const asymmetric=[{x:700,y:348},{x:780,y:348},{x:780,y:500},{x:1100,y:500},{x:1100,y:348}];
async function editor(){const m=new Upstream({container:dom.createContainer()});await m.importXML(await readFile('test/fixtures/scenarios/approval-rejection-rework.bpmn','utf8'));return m;}
const bo=(m,type)=>m.get('moddle').create(type);
function options(m){const graphics=m.get('graphicsFactory');return{elements:m.get('elementRegistry').getAll(),getShapePath:graphics.getShapePath.bind(graphics),getConnectionPath:graphics.getConnectionPath.bind(graphics)};}

test('actual context-pad auto append uses half total path and full annotation cropping',async()=>{
 const m=await editor();try{
  const registry=m.get('elementRegistry'),flow=registry.get('ApproveFlow');m.get('modeling').updateWaypoints(flow,asymmetric.map(xy));
  const proposed={width:100,height:40},before=JSON.stringify(flow.waypoints),position=routing.annotationAppendPosition(flow,proposed,{elements:registry.getAll()});
  assert.deepEqual(routing.connectionMidpoint(flow),{x:900,y:500});assert.notEqual(routing.connectionMidpoint(flow).x,940,'uneven route distinguishes half total length from longest segment midpoint');
  const old=new Set(registry.getAll());m.get('canvas').scrollToElement=()=>{};m.get('contextPad').getEntries(flow)['append.text-annotation'].action.click({},flow);
  const created=registry.getAll().filter(value=>!old.has(value)),note=created.find(value=>value.type==='bpmn:TextAnnotation'),association=created.find(value=>value.type==='bpmn:Association');
  assert.deepEqual(bounds(note),{x:950,y:430,width:100,height:40});assert.deepEqual(position,{x:note.x+50,y:note.y+20});
  const actual=routing.layoutConnection({type:'bpmn:Association',source:flow,target:note}, {},options(m));
  assert.deepEqual(actual,association.waypoints);assert.deepEqual(actual.map(xy),[{x:900,y:500},{x:960,y:470}]);assert.equal(JSON.stringify(flow.waypoints),before);
 }finally{m.destroy();}
});

test('orientation, connected collisions and fractional grid placement match actual autoPlace events',async()=>{
 const m=await editor();try{
  for(const horizontal of[true,false])for(const offset of[0,0.375,-550.25])for(const dimensions of[{width:100,height:40},{width:123.5,height:45.25}])for(const connected of[false,true]){
   const parent={type:'bpmn:Participant',businessObject:bo(m,'bpmn:Participant'),di:{isHorizontal:horizontal}},source={id:'Owner',type:'bpmn:SequenceFlow',businessObject:bo(m,'bpmn:SequenceFlow'),parent,waypoints:asymmetric.map(p=>({x:p.x+offset,y:p.y+offset})),incoming:[],outgoing:[]};
   const annotation={id:'Candidate',type:'bpmn:TextAnnotation',businessObject:bo(m,'bpmn:TextAnnotation'),...dimensions};
   if(connected){const c=routing.connectionMidpoint(source),peer={id:'Existing',x:c.x+100-dimensions.width/2,y:c.y+(horizontal?-50:50)-dimensions.height/2,...dimensions};source.outgoing.push({source,target:peer});}
   const original=JSON.stringify(source.waypoints),expected=m.get('eventBus').fire('autoPlace',{source,shape:annotation});
   assert.deepEqual(routing.annotationAppendPosition(source,annotation),expected,JSON.stringify({horizontal,offset,dimensions,connected}));assert.equal(JSON.stringify(source.waypoints),original);
   assert.deepEqual(routing.annotationAppendPosition({...source,incoming:undefined,outgoing:undefined},annotation,{edges:[]}),m.get('eventBus').fire('autoPlace',{source:{...source,incoming:[],outgoing:[]},shape:annotation}));
  }
 }finally{m.destroy();}
});

test('explicit owner pointers match actual native snapping and docking on either endpoint',async()=>{
 const m=await editor();try{
  const registry=m.get('elementRegistry'),flow=registry.get('ApproveFlow'),modeling=m.get('modeling');modeling.updateWaypoints(flow,asymmetric.map(xy));
  const note=modeling.createShape({type:'bpmn:TextAnnotation'},{x:1230,y:250},m.get('canvas').getRootElement());
  for(const pointer of[{x:778,y:352},{x:800.125,y:496.75},{x:780,y:338},{x:1120,y:349}])for(const atStart of[true,false]){
   const snapped=m.get('eventBus').createEvent({x:pointer.x,y:pointer.y,dx:0,dy:0,context:{hover:flow,source:note,start:note}});m.get('eventBus').fire('connect.move',snapped);
   const expected=xy(snapped);assert.deepEqual(routing.projectDocking(flow,pointer),expected);assert.deepEqual(expected,getClosestPointOnConnection(pointer,flow));
   const source=atStart?flow:note,target=atStart?note:flow,hints=atStart?{connectionStart:expected}:{connectionEnd:expected};
   const actual=modeling.connect(source,target,{type:'bpmn:Association'},hints);
   const planned=routing.layoutConnection({type:'bpmn:Association',source,target},atStart?{connectionStart:pointer}:{connectionEnd:pointer},options(m));
   assert.deepEqual(xy(planned[atStart?0:planned.length-1]),xy(actual.waypoints[atStart?0:actual.waypoints.length-1]));
   // Upstream crops shape ends to integer pixels; the retained core preserves
   // fractional shape cropping. Both use the same rectangle intersection.
   const index=atStart?planned.length-1:0;assert.ok(Math.hypot(planned[index].x-actual.waypoints[index].x,planned[index].y-actual.waypoints[index].y)<=Math.SQRT2/2+1e-9);
   modeling.removeConnection(actual);
  }
 }finally{m.destroy();}
});

test('sharp infinite-line attachment matches the reference despite rounded paint and zero-axis guards',async()=>{
 const m=await editor();try{
  const flow=m.get('elementRegistry').get('ApproveFlow');m.get('modeling').updateWaypoints(flow,asymmetric.map(xy));
  assert.deepEqual(routing.projectDocking(flow,{x:780,y:340}),{x:780,y:340},'infinite line intentionally extends beyond its finite segment');
  const painted=[...m.get('elementRegistry').getGraphics(flow).querySelectorAll('.djs-visual path')].map(path=>path.getAttribute('d'));assert.ok(painted.some(path=>path.includes('C')),'actual painted route contains rounded corners');
  assert.deepEqual(routing.projectDocking(flow,{x:780,y:348}),{x:780,y:348});
  const zero={...flow,waypoints:[{x:10,y:0},{x:110,y:0}]},pointer={x:40,y:3};assert.deepEqual(routing.projectDocking(zero,pointer),{x:40,y:0});
  const native=m.get('eventBus').createEvent({...pointer,dx:0,dy:0,context:{hover:zero,source:{},start:{}}});m.get('eventBus').fire('connect.move',native);assert.deepEqual(xy(native),routing.projectDocking(zero,pointer),'full native pipeline still snaps this on-screen zero-axis hit after the bendpoint guard');
 }finally{m.destroy();}
});

test('fractional anchor metadata, manual interiors and unchanged opposite endpoints are detached',()=>{
 const owner={waypoints:[{x:100.25,y:200.5},{x:400.75,y:200.5}]},note={type:'bpmn:TextAnnotation',x:450,y:250,width:100,height:40};
 const points=[{x:250.125,y:200.5,original:{x:250.125,y:200.5,tag:'source'},tag:'dock'},{x:420.5,y:225.75,tag:'manual'},{x:450,y:267.5,original:{x:500,y:270,tag:'target'}}];
 const edge={type:'bpmn:Association',source:owner,target:note,waypoints:points},saved=JSON.stringify(points);
 const result=routing.layoutConnection(edge,{connectionStart:{x:280.875,y:204.25},preserveDocking:'both'});
 assert.deepEqual(xy(result[0]),{x:280.875,y:200.5});assert.deepEqual(result[0].original,{x:280.875,y:200.5,tag:'source'});assert.deepEqual(result[1],points[1]);assert.deepEqual(result.at(-1),points.at(-1));assert.notEqual(result[1],points[1]);assert.notEqual(result.at(-1).original,points.at(-1).original);assert.equal(JSON.stringify(points),saved);
 assert.deepEqual(routing.layoutConnection(edge),points);
});

test('recropping retains existing owner anchors and never passes a connection to a shape renderer',()=>{
 const owner={waypoints:asymmetric.map(xy)},note={type:'bpmn:TextAnnotation',x:900,y:250,width:100,height:40};
 const points=[{x:779.5,y:440.125,original:{x:780,y:440.125,tag:'retain'}},{x:910,y:290}];let calls=0;
 const result=routing.cropConnection(points,owner,note,{getShapePath:shape=>{assert.equal(shape,note);calls++;return'M900,250h100v40h-100Z';}});
 assert.deepEqual(result[0],points[0]);assert.notEqual(result[0].original,points[0].original);assert.equal(calls,1);
});

test('connection-owned segment plans remain finite without mutating original route metadata',()=>{
 const owner={waypoints:[{x:100,y:200},{x:400,y:200}]},note={type:'bpmn:TextAnnotation',x:450,y:250,width:100,height:40};
 const edge={type:'bpmn:Association',source:owner,target:note,waypoints:[{x:250.125,y:200,original:{x:250.125,y:200,extra:'source'}},{x:450,y:200},{x:450,y:270}]},saved=JSON.stringify(edge);
 const result=routing.planSegmentMove(edge,0,{x:0,y:25.75});assert.ok(result.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));assert.deepEqual(xy(result[0]),xy(edge.waypoints[0]));assert.equal(JSON.stringify(edge),saved);
});

test('invalid owner routes reject cleanly, including sparse arrays; repeated points remain supported',()=>{
 const note={type:'bpmn:TextAnnotation',x:300,y:100,width:100,height:40};
 const leading=Array(2),middle=Array(3),trailing=Array(2);leading[1]={x:2,y:3};middle[0]={x:1,y:2};middle[2]={x:3,y:4};trailing[0]={x:1,y:2};
 for(const waypoints of[null,[],[{x:1,y:2}],[{x:1,y:2},{x:1,y:2}],[{x:1,y:2},{x:NaN,y:3}],[{x:-1e308,y:1e308},{x:1e308,y:-1e308}],leading,middle,trailing]){
  const owner={waypoints};for(const call of[()=>routing.connectionMidpoint(owner),()=>routing.projectDocking(owner,{x:2,y:3}),()=>routing.layoutConnection({type:'bpmn:Association',source:owner,target:note})])assert.throws(call,error=>error.code==='UNROUTABLE_DOCKING');
 }
 const owner={waypoints:[{x:100,y:200},{x:100,y:200},{x:400,y:200}]};assert.deepEqual(routing.connectionMidpoint(owner),{x:250,y:200});assert.deepEqual(routing.projectDocking(owner,{x:260.25,y:198}),{x:260.25,y:200});
});
