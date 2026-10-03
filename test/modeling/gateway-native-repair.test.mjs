import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { assertOnlyAnchorGeometry } from '../helpers/anchor-model-guard.mjs';

// Exact exports immediately before the failed target reconnect in hosted
// 849b34d0. The native trace delivered these positions on the target Gateway.
const cases=[
 {file:'crossing-retained-route.bpmn',drop:{x:-746.441707323248,y:-619.1393832394974},anchor:{x:-751,y:-613}},
 {file:'blocked-terminal-bridge.bpmn',drop:{x:-721.5084413491404,y:-633.164345349933},anchor:{x:-726,y:-638}},
];
const xy=p=>({x:p.x,y:p.y});
function avoidsDiamond(points,n){
 // Linear diamond half-planes give an independent exact interval test.
 for(let i=1;i<points.length;i++){
  const a=points[i-1],b=points[i];assert.ok(a.x===b.x||a.y===b.y,'route is orthogonal');
  const center={x:n.x+n.width/2,y:n.y+n.height/2};
  if(a.x===b.x){const inset=1-Math.abs(a.x-center.x)/(n.width/2);if(inset<=0)continue;const top=center.y-inset*n.height/2,bottom=center.y+inset*n.height/2;assert.ok(Math.min(a.y,b.y)>=bottom||Math.max(a.y,b.y)<=top,'vertical leg must not enter the endpoint diamond');}
  else{const inset=1-Math.abs(a.y-center.y)/(n.height/2);if(inset<=0)continue;const left=center.x-inset*n.width/2,right=center.x+inset*n.width/2;assert.ok(Math.min(a.x,b.x)>=right||Math.max(a.x,b.x)<=left,'horizontal leg must not enter the endpoint diamond');}
 }
}
for(const c of cases)test('actual registered target reconnect repairs '+c.file,async()=>{
 const dom=await setupDOM(),listeners=new WeakMap(),restores=[];
 for(const target of [window,window.SVGElement.prototype]){const add=target.addEventListener;target.addEventListener=function(type,callback,options){const list=listeners.get(this)||[];list.push({type,callback});listeners.set(this,list);return add.call(this,type,callback,options);};restores.push(()=>target.addEventListener=add);}
 let m;const oldHit=document.elementsFromPoint;
 try{const {default:Modeler}=await dom.loadModule('/lib/Modeler.js');m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,snap:false});let pointIndex=0;const captured=await readFile('test/fixtures/gateway-native-repair/'+c.file,'utf8');await m.importXML(captured.replace(/<di:waypoint([^>]*)\/>/g,(_whole,attrs)=>`<di:waypoint${attrs}><!--POINT_${pointIndex++}--></di:waypoint>`));
 const edge=m.getGraph().edges.find(e=>e.id.endsWith('_4')),target=m.getGraph().nodes.find(n=>n.type==='bpmn:ExclusiveGateway'&&n.id.endsWith('_1')),source=edge.source;
 edge.waypoints[0].original={x:source.x+source.width/2,y:source.y+source.height/2,tag:'retained opposite'};
 const baseline=await m.getXML(),waypoints=structuredClone(edge.waypoints),diPoints=edge.di.waypoint.slice(),count=m.commandStack.size();
 const call=(receiver,type,event,name)=>{const list=(listeners.get(receiver)||[]).filter(item=>item.type===type&&(!name||item.callback.name===name));assert.ok(list.length);list.forEach(item=>item.callback.call(receiver,event));};
 const event=(p,node)=>({target:node,button:0,clientX:p.x,clientY:p.y,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
 const targetGfx=m.getContainer().querySelector(`[data-element-id="${target.id}"] .bpmn-xyflow-shape-hit`);assert.ok(targetGfx);document.elementsFromPoint=()=>[targetGfx];
 for(const cancel of [true,false]){
  m.select(edge.id);const press=m.getContainer().querySelector(`.bpmn-xyflow-bendpoint-hit[data-element-id="${edge.id}"][data-bend-index="${waypoints.length-1}"]`);assert.ok(press);
  call(m.getSvg(),'mousedown',event(waypoints.at(-1),press),'onMouseDown');
  for(const p of [{x:c.drop.x+1,y:c.drop.y+1},c.drop]){call(window,'mousemove',event(p,targetGfx),'onMouseMove');assert.notDeepEqual(edge.waypoints.map(xy),waypoints.map(xy),'positive reconnect preview');assert.deepEqual(xy(edge.waypoints.at(-1)),c.anchor);assert.deepEqual(edge.waypoints[0],waypoints[0],'opposite docking and logical metadata remain exact');avoidsDiamond(edge.waypoints,source);avoidsDiamond(edge.waypoints,target);assert.equal(edge.di.waypoint[0],diPoints[0]);assert.equal(edge.di.waypoint.at(-1),diPoints.at(-1));}
  const preview=edge.waypoints.map(xy);
  if(cancel){m.cancel();assert.equal(await m.getXML(),baseline);assert.deepEqual(edge.waypoints,waypoints);assert.equal(m.commandStack.size(),count);assert.deepEqual(edge.di.waypoint,diPoints);}
  else{call(window,'mouseup',event(c.drop,targetGfx),'onMouseUp');assert.equal(edge.source,source);assert.equal(edge.target,target);assert.deepEqual(edge.waypoints.map(xy),preview);assert.equal(m.commandStack.size(),count+1);assert.equal(edge.di.waypoint[0],diPoints[0]);assert.equal(edge.di.waypoint.at(-1),diPoints.at(-1));const committed=await m.getXML();assert.ok(committed.includes('<!--POINT_0-->'));assert.ok(committed.includes(`<!--POINT_${diPoints.length-1}-->`));const guard=createAnchorHarness({port:5480,output:'/tmp/unused-gateway-guard'});await guard.reconnectOnly({xml:baseline},{xml:committed,canonical:(await guard.oracle.toXML((await guard.oracle.fromXML(committed)).rootElement,{format:true})).xml},edge.id,'target',target.id);if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});for(const [phase,xml]of [['before',baseline],['after',committed]])await writeFile(process.env.BPMN_XML_ARTIFACT_DIR+'/gateway-native-'+c.file.replace('.bpmn','')+'-'+phase+'.bpmn',xml);}for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),baseline);edge.di.waypoint.forEach((p,j)=>assert.equal(p,diPoints[j]));m.redo();assert.equal(await m.getXML(),committed);}}
 }
 }finally{m?.destroy();document.elementsFromPoint=oldHit;restores.reverse().forEach(f=>f());await dom.cleanup();}
});


test('retained Payment NW resize keeps child geometry and adopts only the edited Gateway endpoint policy',async()=>{
 const dom=await setupDOM();let m;
 try{const {default:Modeler}=await dom.loadModule('/lib/Modeler.js');m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,snap:false});await m.importXML(await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8'));
  const before=await m.getXML(),ids=['PaymentStart','CapturePayment','PaymentEnd','FulfillmentFork'],bounds=n=>({x:n.x,y:n.y,width:n.width,height:n.height}),oldBounds=ids.map(id=>bounds(m.getElement(id))),routes=['PaymentFlow1','PaymentFlow2'].map(id=>structuredClone(m.getElement(id).waypoints)),count=m.commandStack.size();
  assert.ok(m.resizeShape(m.getElement('Payment'),{x:300,y:275,width:390,height:295})===m.getElement('Payment'));
  ids.forEach((id,i)=>assert.deepEqual(bounds(m.getElement(id)),oldBounds[i]));['PaymentFlow1','PaymentFlow2'].forEach((id,i)=>assert.deepEqual(m.getElement(id).waypoints,routes[i]));
  assert.deepEqual(m.getElement('SellerFlow2').waypoints.map(xy),[{x:300,y:415},{x:300,y:415}]);
  assert.deepEqual(m.getElement('SellerFlow3').waypoints.map(xy),[{x:690,y:422.5},{x:715,y:422.5},{x:715,y:430},{x:740,y:430}]);
  const after=await m.getXML();await assertOnlyAnchorGeometry(before,after,{shapeIds:['Payment'],edgeIds:['SellerFlow2','SellerFlow3']});assert.equal(m.commandStack.size(),count+1);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
  if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});for(const [phase,xml]of [['before',before],['after',after]])await writeFile(process.env.BPMN_XML_ARTIFACT_DIR+'/gateway-native-payment-'+phase+'.bpmn',xml);}
 }finally{m?.destroy();await dom.cleanup();}
});
