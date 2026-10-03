import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { setupDOM } from '../helpers/dom.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
let dom, Modeler;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));});
after(async()=>dom.cleanup());
const xml=`<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:v="urn:gateway-test" id="Defs" targetNamespace="urn:test"><bpmn:process id="Process" v:keep="original"><bpmn:task id="Task"><bpmn:outgoing>Flow</bpmn:outgoing></bpmn:task><bpmn:exclusiveGateway id="Gateway"><bpmn:incoming>Flow</bpmn:incoming></bpmn:exclusiveGateway><bpmn:sequenceFlow id="Flow" sourceRef="Task" targetRef="Gateway"><bpmn:extensionElements><v:record>before<!--keep--><?audit keep?>after</v:record></bpmn:extensionElements></bpmn:sequenceFlow></bpmn:process><bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process"><bpmndi:BPMNShape id="Task_di" bpmnElement="Task"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape><bpmndi:BPMNShape id="Gateway_di" bpmnElement="Gateway"><dc:Bounds x="400" y="100" width="50" height="50"/></bpmndi:BPMNShape><bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow" v:keep="route"><di:waypoint x="200" y="140"/><di:waypoint x="300" y="140"/><di:waypoint x="300" y="112.5"/><di:waypoint x="412.5" y="112.5"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
const vertices=n=>[{x:n.x+n.width/2,y:n.y},{x:n.x+n.width,y:n.y+n.height/2},{x:n.x+n.width/2,y:n.y+n.height},{x:n.x,y:n.y+n.height/2}];
const xy=p=>({x:p.x,y:p.y});
const fixed=(n,p)=>assert.ok(vertices(n).some(v=>v.x===p.x&&v.y===p.y),JSON.stringify(p));
async function fixture(){const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,editorActions:false,snap:false});await m.importXML(xml);return m;}
let artifact=0;
async function cycles(m,before,after){if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});for(const xml of [before,after])await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`gateway-policy-${++artifact}.bpmn`),xml);}for(let i=0;i<3;i++){assert.equal(m.undo(),true);assert.equal(await m.getXML(),before);assert.equal(m.redo(),true);assert.equal(await m.getXML(),after);}const parsed=await new BpmnModdle().fromXML(after);assert.deepEqual(parsed.warnings,[]);}

test('open/export/reopen preserve authored nonvertex gateway DI; a real move adopts fixed anchors and Undo is exact',async()=>{
 const m=await fixture();try{const before=await m.getXML(),edge=m.getElement('Flow');
  assert.deepEqual(xy(edge.waypoints.at(-1)),{x:412.5,y:112.5});await m.importXML(before);assert.equal(await m.getXML(),before);
  const current=m.getElement('Gateway'),flow=m.getElement('Flow'),count=m.commandStack.size(),bo=flow.businessObject,di=flow.di,diPoints=flow.di.waypoint,points=[...diPoints];
  assert.equal(m.resizeShape(current,{x:400,y:100,width:80,height:80}),false,'Gateway resize remains unavailable');assert.equal(await m.getXML(),before);
  assert.ok(m.moveShape(current,{x:37.25,y:19.5}));fixed(current,flow.waypoints.at(-1));assert.equal(m.commandStack.size(),count+1);const after=await m.getXML();await cycles(m,before,after);
  m.undo();assert.equal(flow.businessObject,bo);assert.equal(flow.di,di);assert.equal(flow.di.waypoint.length,points.length);flow.di.waypoint.forEach((point,i)=>assert.equal(point,points[i]));assert.equal(await m.getXML(),before);
 }finally{m.destroy();}
});

test('explicit supplied waypoint creation, update and reconnect follow editing policy without changing caller arrays',async()=>{
 const m=await fixture();try{const a=m.getElement('Task'),g=m.getElement('Gateway'),target=m.addShape('bpmn:Task',{x:700,y:300});
  const route=[{x:200,y:140,tag:'source'},{x:310,y:140,tag:'middle'},{x:310,y:112.5},{x:412.5,y:112.5,tag:'target'}],snapshot=structuredClone(route),before=await m.getXML();
  const edge=m.connect(a,g,{waypoints:route});assert.ok(edge);fixed(g,edge.waypoints.at(-1));assert.deepEqual(route,snapshot);assert.equal(edge.waypoints.at(-1).tag,'target');await cycles(m,before,await m.getXML());
  const update=edge.waypoints.map(p=>structuredClone(p));update.at(-1).x=437.5;update.at(-1).y=137.5;const old=await m.getXML();assert.ok(m.updateWaypoints(edge,update));fixed(g,edge.waypoints.at(-1));await cycles(m,old,await m.getXML());
  const cross=m.connect(a,target),original=await m.getXML(),requested=[{x:437.5,y:112.5},{x:570,y:112.5},{x:570,y:300},{x:650,y:300}];assert.ok(m.reconnect(cross,'source',g,requested));fixed(g,cross.waypoints[0]);assert.equal(cross.target,target);await cycles(m,original,await m.getXML());
  const second=await m.getXML();assert.ok(m.reconnect(cross,'target',g));fixed(g,cross.waypoints[0]);fixed(g,cross.waypoints.at(-1));assert.equal(cross.source,g);assert.equal(cross.target,g);await cycles(m,second,await m.getXML());
 }finally{m.destroy();}
});

test('replacement into each valid Gateway variant repairs incoming/outgoing routes atomically with full original restoration',async()=>{
 for(const type of ['ExclusiveGateway','ParallelGateway','InclusiveGateway','ComplexGateway']){const m=await fixture();try{
  const task=m.getElement('Task'),g=m.getElement('Gateway'),incoming=m.connect(g,task),before=await m.getXML(),count=m.commandStack.size(),oldBo=task.businessObject,oldDi=task.di;
  assert.equal(m.replace(task,'bpmn:'+type),task);assert.equal(m.commandStack.size(),count+1);for(const edge of [m.getElement('Flow'),incoming]){fixed(task,edge.source===task?edge.waypoints[0]:edge.waypoints.at(-1));fixed(g,edge.source===g?edge.waypoints[0]:edge.waypoints.at(-1));}
  const after=await m.getXML();await cycles(m,before,after);m.undo();assert.equal(task.businessObject,oldBo);assert.equal(task.di,oldDi);assert.equal(await m.getXML(),before);
 }finally{m.destroy();}}
});

test('Gateway whole-selection movement retains vertices and unsupported supplied routes are atomic no-ops',async()=>{
 const m=await fixture();try{const a=m.getElement('Task'),g=m.getElement('Gateway'),edge=m.getElement('Flow');const before=await m.getXML(),count=m.commandStack.size();
  assert.ok(m.moveShapes([a,g],{x:30.125,y:-9.75}));fixed(g,edge.waypoints.at(-1));await cycles(m,before,await m.getXML());m.undo();assert.equal(await m.getXML(),before);
  const snapshot=m.commandStack.snapshot(),bad=[{x:200,y:140},{x:Infinity,y:125}];assert.equal(m.connect(a,g,{waypoints:bad}),null);assert.equal(m.updateWaypoints(edge,bad),false);assert.equal(m.reconnect(edge,'target',g,bad),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),count);assert.deepEqual(m.commandStack.snapshot(),snapshot);
 }finally{m.destroy();}
});


test('copy/paste retains authored sloped route translation until an explicit reconnect adopts the new vertex policy',async()=>{
 const m=await fixture();try{const a=m.getElement('Task'),g=m.getElement('Gateway'),old=m.getElement('Flow'),route=old.waypoints.map(xy),before=await m.getXML();
  assert.ok(m.copy([a,g]));const pasted=m.paste({x:850,y:450}),copyGateway=pasted.find(n=>n.type==='bpmn:ExclusiveGateway'),copyTask=pasted.find(n=>n.type==='bpmn:Task');assert.ok(copyGateway&&copyTask);
  const edge=m.getGraph().edges.find(e=>e.source===copyTask&&e.target===copyGateway),delta={x:copyTask.x-a.x,y:copyTask.y-a.y};assert.ok(edge);
  assert.deepEqual(edge.waypoints.map(xy),route.map(p=>({x:p.x+delta.x,y:p.y+delta.y})));assert.ok(!vertices(copyGateway).some(p=>p.x===edge.waypoints.at(-1).x&&p.y===edge.waypoints.at(-1).y));
  const copied=await m.getXML();await cycles(m,before,copied);const count=m.commandStack.size();assert.ok(m.reconnect(edge,'target',copyGateway));fixed(copyGateway,edge.waypoints.at(-1));assert.equal(m.commandStack.size(),count+1);await cycles(m,copied,await m.getXML());
 }finally{m.destroy();}
});

test('Space repairs a changed imported Gateway route with fixed anchors and exact Undo',async()=>{
 const m=await fixture();try{const a=m.getElement('Task'),g=m.getElement('Gateway'),edge=m.getElement('Flow'),before=await m.getXML(),count=m.commandStack.size();
  assert.ok(m.createSpace([a,g],'horizontal',0,35.25));fixed(g,edge.waypoints.at(-1));assert.equal(m.commandStack.size(),count+1);await cycles(m,before,await m.getXML());
 }finally{m.destroy();}
});


test('real Shift-body event propagation starts neutral Gateway preview at a fixed vertex while Task origin stays exact',async()=>{
 const m=await fixture(),oldHit=document.elementsFromPoint;try{
  await m.setViewport({x:0,y:0,zoom:1});document.elementsFromPoint=()=>[];
  for(const id of ['Gateway','Task']){const n=m.getElement(id),point={x:n.x+n.width/2,y:n.y+n.height/2},before=await m.getXML(),count=m.commandStack.size(),gfx=m.getContainer().querySelector(`[data-element-id="${id}"] .bpmn-xyflow-shape-hit`);assert.ok(gfx);
   gfx.dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0,buttons:1,shiftKey:true,clientX:point.x,clientY:point.y}));
   m.getSvg().dispatchEvent(new window.MouseEvent('mousemove',{bubbles:true,buttons:1,shiftKey:true,clientX:point.x+80,clientY:point.y-60}));
   const path=m.getContainer().querySelector('.bpmn-xyflow-connect-preview path');assert.ok(path);const numbers=path.getAttribute('d').match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number);
   assert.deepEqual({x:numbers[0],y:numbers[1]},id==='Gateway'?{x:425,y:100}:point);
   m.getSvg().dispatchEvent(new window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,key:'Escape'}));assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),count);
  }
 }finally{document.elementsFromPoint=oldHit;m.destroy();}
});


test('registered multi-frame bend drag keeps original bend provenance when Gateway endpoint repair changes topology',async()=>{
 const callbacks=new WeakMap(),restores=[];for(const target of [window,window.SVGElement.prototype]){const add=target.addEventListener;target.addEventListener=function(type,callback,options){const list=callbacks.get(this)||[];list.push({type,callback});callbacks.set(this,list);return add.call(this,type,callback,options);};restores.push(()=>target.addEventListener=add);}
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,editorActions:false,snap:false});
 const invoke=(target,type,event,name)=>{const list=(callbacks.get(target)||[]).filter(v=>v.type===type&&(!name||v.callback.name===name));assert.ok(list.length);list.forEach(v=>v.callback.call(target,event));};
 const event=(target,p)=>({target,button:0,clientX:p.x,clientY:p.y,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
 try{const route=[[200,140],[250,140],[250,50],[350,50],[350,112.5],[400,112.5],[412.5,112.5]];
  await m.importXML(xml.replace(/<di:waypoint x="200" y="140"\/>[\s\S]*?<di:waypoint x="412.5" y="112.5"\/>/,route.map(([x,y],i)=>`<di:waypoint x="${x}" y="${y}"><!--POINT_${i}--><?audit keep${i}?></di:waypoint>`).join('')));
  const edge=m.getElement('Flow'),gateway=m.getElement('Gateway');edge.waypoints[5].tag='dragged metadata';const before=await m.getXML(),original=structuredClone(edge.waypoints),diOriginal=edge.di.waypoint.slice(),count=m.commandStack.size();
  const down=()=>{m.select(edge.id);const circle=m.getContainer().querySelector('.bpmn-xyflow-bendpoint-hit[data-bend-index="5"]');assert.ok(circle);invoke(m.getSvg(),'mousedown',event(circle,original[5]),'onMouseDown');};
  for(const cancel of [true,false]){down();for(const point of [{x:400,y:114},{x:398,y:116},{x:396,y:118}]){invoke(window,'mousemove',event(m.getSvg(),point),'onMouseMove');fixed(gateway,edge.waypoints.at(-1));assert.deepEqual(edge.waypoints.slice(1,5),original.slice(1,5));assert.deepEqual(edge.waypoints[5],{...original[5],...point});assert.ok(edge.waypoints.length>original.length);assert.equal(edge.di.waypoint[5],diOriginal[5],'moved bend retains its exact DI object and opaque payload');assert.ok(edge.waypoints.every(p=>Object.getOwnPropertySymbols(p).length===0),'temporary provenance never leaks into graph waypoints');}
   if(cancel){m.cancel();assert.equal(await m.getXML(),before);assert.deepEqual(edge.waypoints,original);assert.equal(m.commandStack.size(),count);}else{invoke(window,'mouseup',event(m.getSvg(),{x:396,y:118}),'onMouseUp');assert.equal(m.commandStack.size(),count+1);assert.equal(edge.di.waypoint[5],diOriginal[5]);const after=await m.getXML();assert.match(after,/<di:waypoint\b[^>]* x="396" y="118"><!--POINT_5--><\?audit keep5\?>/);await cycles(m,before,after);}
  }
 }finally{m.destroy();restores.reverse().forEach(f=>f());}
});


test('registered segment previews retain both moved DI identities when gateway repair inserts a terminal bridge',async()=>{
 const callbacks=new WeakMap(),restores=[];for(const target of [window,window.SVGElement.prototype]){const add=target.addEventListener;target.addEventListener=function(type,callback,options){const list=callbacks.get(this)||[];list.push({type,callback});callbacks.set(this,list);return add.call(this,type,callback,options);};restores.push(()=>target.addEventListener=add);}
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,editorActions:false,snap:false});
 const invoke=(target,type,event,name)=>{const list=(callbacks.get(target)||[]).filter(v=>v.type===type&&(!name||v.callback.name===name));assert.ok(list.length);list.forEach(v=>v.callback.call(target,event));};
 const event=(target,p)=>({target,button:0,clientX:p.x,clientY:p.y,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){}});
 try{const route=[[200,140],[250,140],[250,50],[350,50],[350,90],[390,112.5],[412.5,112.5]];
  await m.importXML(xml.replace(/<di:waypoint x="200" y="140"\/>[\s\S]*?<di:waypoint x="412.5" y="112.5"\/>/,route.map(([x,y],i)=>`<di:waypoint x="${x}" y="${y}"><!--POINT_${i}--><?audit keep${i}?></di:waypoint>`).join('')));
  const edge=m.getElement('Flow'),gateway=m.getElement('Gateway'),before=await m.getXML(),original=structuredClone(edge.waypoints),diOriginal=edge.di.waypoint.slice(),count=m.commandStack.size();
  for(const cancel of [true,false]){m.select(edge.id);const handle=m.getContainer().querySelector('.bpmn-xyflow-segment-handle[data-segment-index="2"]');assert.ok(handle);invoke(m.getSvg(),'mousedown',event(handle,{x:300,y:50}),'onMouseDown');
   for(const y of [55,60]){invoke(window,'mousemove',event(m.getSvg(),{x:300,y}),'onMouseMove');fixed(gateway,edge.waypoints.at(-1));for(const index of [2,3]){assert.equal(edge.di.waypoint[index],diOriginal[index]);assert.deepEqual(xy(edge.waypoints[index]),{x:route[index][0],y});}assert.ok(edge.waypoints.length>original.length);assert.ok(edge.waypoints.every(p=>!Object.getOwnPropertySymbols(p).length&&(!p.original||!Object.getOwnPropertySymbols(p.original).length)));}
   if(cancel){m.cancel();assert.equal(await m.getXML(),before);assert.deepEqual(edge.waypoints,original);assert.equal(m.commandStack.size(),count);}else{invoke(window,'mouseup',event(m.getSvg(),{x:300,y:60}),'onMouseUp');assert.equal(m.commandStack.size(),count+1);for(const index of [2,3])assert.equal(edge.di.waypoint[index],diOriginal[index]);await cycles(m,before,await m.getXML());}
  }
 }finally{m.destroy();restores.reverse().forEach(f=>f());}
});

test('public waypoint update and supplied reconnect preserve pre-policy DI matching for moved bends',async()=>{
 const route=[[200,140],[250,140],[250,50],[350,50],[350,90],[390,112.5],[412.5,112.5]],m=await fixture();
 try{await m.importXML(xml.replace(/<di:waypoint x="200" y="140"\/>[\s\S]*?<di:waypoint x="412.5" y="112.5"\/>/,route.map(([x,y],i)=>`<di:waypoint x="${x}" y="${y}"><!--POINT_${i}--><?audit keep${i}?></di:waypoint>`).join('')));
  const edge=m.getElement('Flow'),g=m.getElement('Gateway'),before=await m.getXML(),oldPoints=edge.di.waypoint.slice();
  for(const action of ['update','reconnect']){const requested=edge.waypoints.map(p=>structuredClone(p));requested[2].y=60;requested[3].y=60;const untouched=structuredClone(requested);
   assert.ok(action==='update'?m.updateWaypoints(edge,requested):m.reconnect(edge,'target',g,requested));assert.deepEqual(requested,untouched);fixed(g,edge.waypoints.at(-1));assert.ok(edge.waypoints.length>route.length);
   for(const index of [2,3]){assert.equal(edge.di.waypoint[index],oldPoints[index]);assert.equal(edge.di.waypoint[index].y,60);}
   assert.ok(edge.waypoints.every(p=>!Object.getOwnPropertySymbols(p).length&&(!p.original||!Object.getOwnPropertySymbols(p.original).length)));
   await cycles(m,before,await m.getXML());m.undo();assert.equal(await m.getXML(),before);edge.di.waypoint.forEach((point,i)=>assert.equal(point,oldPoints[i]));
  }
 }finally{m.destroy();}
});
