import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));});
after(async()=>dom.cleanup());
const audit={name:'Audit',uri:'urn:audit',prefix:'audit',types:[{name:'Tracking',extends:['bpmn:BaseElement'],properties:[{name:'watchedRef',type:'bpmn:BaseElement',isReference:true,isAttr:true},{name:'ownerRef',type:'bpmn:BaseElement',isReference:true,isAttr:true}]}]};
const clone=points=>points.map(p=>({...p,...(p.original?{original:{...p.original}}:{})}));
const coords=points=>points.map(({x,y})=>({x,y}));
let artifact=0;
async function valid(m){const xml=await m.getXML();if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`flow-dependencies-${++artifact}.bpmn`),xml);}const result=await new BpmnModdle({audit}).fromXML(xml);assert.deepEqual(result.warnings,[]);return result;}
async function editor(file='test/fixtures/flow-annotations/visible-dependencies.bpmn'){const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,snap:false,moddleExtensions:{audit}});await m.importXML(await readFile(file,'utf8'));return m;}
async function history(m,before,after,times=3){for(let i=0;i<times;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}}
function all(root){const result=new Set();function visit(o){if(!o||typeof o!=='object'||result.has(o))return;result.add(o);for(const p of o.$descriptor?.properties||[])if(!p.isReference&&!p.isVirtual&&!p.isAttr)(Array.isArray(o[p.name])?o[p.name]:[o[p.name]]).forEach(visit);}visit(root);return result;}

test('native-facing automatic append works for flow and ordinary node with one exact history command',async()=>{
 const m=await editor('test/fixtures/scenarios/approval-rejection-rework.bpmn');try{
  for(const id of ['ApproveFlow','ReviewRequest']){const source=m.getElement(id),before=await m.getXML(),size=m.commandStack.size(),old=new Set(m.getGraph().nodes);m.select(id);const button=m.getContainer().querySelector('[data-action="append.text-annotation"]');assert.ok(button);button.click();const note=m.getGraph().nodes.find(n=>!old.has(n)&&n.type==='bpmn:TextAnnotation');assert.ok(note);assert.equal(note.width,100);assert.equal(note.height,40);assert.equal(note.parent,m.getGraph().roots[0]);const edge=m.getGraph().edges.find(e=>e.source===source&&e.target===note);assert.ok(edge);assert.equal(edge.businessObject.sourceRef,source.businessObject);assert.equal(edge.businessObject.$parent,note.businessObject.$parent);assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);await history(m,before,after);m.undo();}
 }finally{m.destroy();}
});

test('explicit flow endpoints on both association sides preserve chosen docking, opposite points and metadata',async()=>{
 const m=await editor();try{
  const owner=m.getElement('F'),note=m.getElement('N2');
  for(const reverse of [false,true]){const before=await m.getXML(),size=m.commandStack.size();const edge=m.connect(reverse?note:owner,reverse?owner:note,{[reverse?'connectionEnd':'connectionStart']:{x:620.25,y:340.5}});assert.ok(edge);const index=reverse?edge.waypoints.length-1:0;assert.deepEqual(coords([edge.waypoints[index]]),[{x:620.25,y:340.5}]);assert.equal(edge.businessObject[reverse?'targetRef':'sourceRef'],owner.businessObject);assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);await history(m,before,after);m.undo();}
 }finally{m.destroy();}
});

test('owner route translation propagates through transitive annotations with exact fractional DI and history',async()=>{
 const m=await editor();try{
  const flow=m.getElement('F'),dep=m.getElement('D'),deep=m.getElement('E'),old=[flow,dep,deep].map(edge=>({edge,points:clone(edge.waypoints),di:edge.di.waypoint.slice(),bo:edge.businessObject})),before=await m.getXML(),size=m.commandStack.size();
  m.updateWaypoints(flow,flow.waypoints.map(p=>({...p,x:p.x+33.125,y:p.y+47.25})));assert.equal(dep.waypoints[0].x,old[1].points[0].x+33.125);assert.equal(dep.waypoints[0].y,old[1].points[0].y+47.25);assert.deepEqual(coords(dep.waypoints.slice(1)),coords(old[1].points.slice(1)));assert.notDeepEqual(coords(deep.waypoints),coords(old[2].points));assert.deepEqual(coords(deep.waypoints.slice(1)),coords(old[2].points.slice(1)));assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);for(const entry of old){assert.equal(entry.edge.businessObject,entry.bo);assert.deepEqual(entry.edge.di.waypoint,entry.di);assert.deepEqual(entry.edge.waypoints,entry.points);}m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});

test('moving both owner tasks and resizing one repairs dependent anchors without stale offsets',async()=>{
 const m=await editor();try{
  const a=m.getElement('A'),b=m.getElement('B'),flow=m.getElement('F'),dep=m.getElement('D'),old=clone(dep.waypoints),before=await m.getXML();m.moveShapes([a,b],{x:0,y:80});assert.equal(dep.waypoints[0].y,old[0].y+80);assert.equal(dep.waypoints[0].x,old[0].x);assert.deepEqual(coords(dep.waypoints.slice(1)),coords(old.slice(1)));let after=await m.getXML();await valid(m);await history(m,before,after);m.undo();
  m.resizeShape(a,{x:a.x-30,y:a.y,width:a.width+40,height:a.height+30});assert.notDeepEqual(coords(flow.waypoints),[{x:400.25,y:340.5},{x:800.25,y:340.5}]);assert.notDeepEqual(coords(dep.waypoints),coords(old));after=await m.getXML();await valid(m);await history(m,before,after);
 }finally{m.destroy();}
});

test('copied owner and transitive dependents get remapped IDs and translated original docking metadata',async()=>{
 const m=await editor();try{
  const original=[m.getElement('F'),m.getElement('D'),m.getElement('E')];original.forEach(edge=>edge.waypoints.forEach((p,i)=>p.original={x:p.x+.125,y:p.y+.25,mark:edge.id+'-'+i}));const snapshots=original.map(edge=>clone(edge.waypoints)),before=await m.getXML(),oldEdges=new Set(m.getGraph().edges);
  const clipboard=m.copy(['A','B','N','N2'].map(id=>m.getElement(id)));assert.deepEqual(clipboard.edges.map(e=>e.id),['F','D','E']);m.paste({x:1400.5,y:900.75});const copies=m.getGraph().edges.filter(e=>!oldEdges.has(e)),flow=copies.find(e=>e.type==='bpmn:SequenceFlow'),dep=copies.find(e=>e.source===flow),deep=copies.find(e=>e.source===dep);assert.ok(flow&&dep&&deep);assert.equal(dep.businessObject.sourceRef,flow.businessObject);assert.equal(deep.businessObject.sourceRef,dep.businessObject);assert.equal(flow.businessObject.ownerRef,flow.businessObject);
  [flow,dep,deep].forEach((edge,j)=>{const points=snapshots[j],dx=edge.waypoints[0].x-points[0].x,dy=edge.waypoints[0].y-points[0].y;edge.waypoints.forEach((p,i)=>assert.deepEqual(p.original,{...points[i].original,x:points[i].original.x+dx,y:points[i].original.y+dy}));});const after=await m.getXML();await valid(m);await history(m,before,after);
 }finally{m.destroy();}
});

test('deletion includes invisible transitive associations and declared refs, preserving valid Relationships and exact arrays',async()=>{
 const m=await editor('test/fixtures/flow-annotations/hidden-dependencies.bpmn');try{
  const flow=m.getElement('F'),defs=m.getDefinitions(),process=flow.businessObject.$parent,note=m.getElement('N').businessObject,other=m.getElement('A').businessObject,oldObjects=[...all(defs)],refs=oldObjects.filter(o=>['D','E'].includes(o.id));assert.equal(m.getElement('D'),null);const relationships=[m.getModdle().create('bpmn:Relationship',{id:'SoleSource',type:'trace',source:[flow.businessObject],target:[note]}),m.getModdle().create('bpmn:Relationship',{id:'SoleTarget',type:'trace',source:[note],target:[flow.businessObject]}),m.getModdle().create('bpmn:Relationship',{id:'StillValid',type:'trace',source:[other,flow.businessObject],target:[note]})];relationships.forEach(r=>r.$parent=defs);defs.relationships=relationships.slice();const relationArray=defs.relationships,sourceArray=relationships[2].source,before=await m.getXML(),size=m.commandStack.size();await valid(m);
  m.delete(flow);const remaining=all(defs);for(const object of [flow.businessObject,...refs])assert.ok(!remaining.has(object));assert.equal(process.watchedRef,undefined);assert.deepEqual(defs.relationships,[relationships[2]]);assert.equal(relationships[2].source,sourceArray);assert.deepEqual(sourceArray,[other]);assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(defs.relationships,relationArray);assert.deepEqual(defs.relationships,relationships);assert.equal(relationships[2].source,sourceArray);assert.equal(process.watchedRef,flow.businessObject);m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});

test('owner message/sequence morph rebinds visible and hidden associations and custom self refs across planes',async()=>{
 const m=await editor('test/fixtures/scenarios/order-payment-delivery.bpmn');try{
  const owner=m.getElement('OrderMessage'),note=m.addShape('bpmn:TextAnnotation',{x:1100,y:100}),link=m.connect(owner,note),old=owner.businessObject,defs=m.getDefinitions(),process=m.getElement('SubmitOrder').businessObject.$parent;old.ownerRef=old;process.watchedRef=old;
  const hidden=m.getModdle().create('bpmn:Association',{id:'HiddenOwnerRef',sourceRef:old,targetRef:note.businessObject});hidden.$parent=link.businessObject.$parent;hidden.$parent.artifacts.push(hidden);const mirror=m.getModdle().create('bpmndi:BPMNEdge',{id:'HiddenOwnerDI',bpmnElement:hidden,waypoint:[m.getModdle().create('dc:Point',{x:10,y:20}),m.getModdle().create('dc:Point',{x:100,y:20})]});const plane=m.getModdle().create('bpmndi:BPMNPlane',{id:'OwnerMirrorPlane',bpmnElement:defs.rootElements.find(e=>e.$type==='bpmn:Collaboration'),planeElement:[mirror]}),diagram=m.getModdle().create('bpmndi:BPMNDiagram',{id:'OwnerMirrorDiagram',plane});diagram.$parent=defs;plane.$parent=diagram;mirror.$parent=plane;mirror.waypoint.forEach(p=>p.$parent=mirror);defs.diagrams.push(diagram);
  const before=await m.getXML(),hiddenPoints=clone(mirror.waypoint);assert.ok(m.reconnect(owner,'target',m.getElement('ReceiveDelivery')));assert.equal(owner.type,'bpmn:SequenceFlow');assert.notEqual(owner.businessObject,old);assert.equal(link.businessObject.sourceRef,owner.businessObject);assert.equal(hidden.sourceRef,owner.businessObject);assert.equal(process.watchedRef,owner.businessObject);assert.equal(owner.businessObject.ownerRef,owner.businessObject);assert.deepEqual(coords(mirror.waypoint),coords(hiddenPoints));const after=await m.getXML();await valid(m);await history(m,before,after);m.undo();assert.equal(hidden.sourceRef,old);assert.equal(owner.businessObject,old);
 }finally{m.destroy();}
});

test('malformed waypoint overrides and degenerate imported owners cleanly refuse without history',async()=>{
 const m=await editor();try{
  const flow=m.getElement('F'),note=m.getElement('N'),link=m.getElement('D'),before=await m.getXML(),size=m.commandStack.size();
  for(const points of [[],[{x:1,y:2}],null,[null,{x:1,y:2}],[,{x:1,y:2}],[{x:1,y:2},,{x:2,y:2}],[{x:NaN,y:1},{x:2,y:2}]]){assert.equal(m.connect(flow,note,{waypoints:points}),null);assert.equal(m.reconnect(link,'source',flow,points),null);assert.equal(m.updateWaypoints(flow,points),false);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
  const previous=flow.waypoints;flow.waypoints=[{x:450,y:400},{x:450,y:400}];for(const options of [{},{waypoints:[{x:450,y:400},{x:600,y:100}]}])assert.equal(m.connect(flow,note,options),null);assert.equal(m.reconnect(link,'source',flow),null);flow.waypoints=previous;assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 }finally{m.destroy();}
});

test('nested imported annotation ownership matches pinned create, reconnect and move services',async()=>{
 let xml=await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn','utf8');xml=xml.replace('</bpmn:transaction>','<bpmn:textAnnotation id="NestedNote"><bpmn:text>Nested note</bpmn:text></bpmn:textAnnotation></bpmn:transaction>').replace('</bpmndi:BPMNPlane>','<bpmndi:BPMNShape id="NestedNote_di" bpmnElement="NestedNote"><dc:Bounds x="500" y="600" width="100" height="40"/></bpmndi:BPMNShape></bpmndi:BPMNPlane>');
 const {default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
 for(const reverse of [false,true]){const m=await editor('test/fixtures/scenarios/booking-timeout-compensation.bpmn'),up=new Upstream({container:dom.createContainer()});try{
  await m.importXML(xml);await up.importXML(xml);const registry=up.get('elementRegistry'),modeling=up.get('modeling'),note=m.getElement('NestedNote'),flow=m.getElement('ReservationFlow2');
  const link=m.connect(reverse?note:flow,reverse?flow:note),other=modeling.connect(registry.get(reverse?'NestedNote':'ReservationFlow2'),registry.get(reverse?'ReservationFlow2':'NestedNote'),{type:'bpmn:Association'});assert.ok(link);assert.equal(link.parent.id,other.parent.id);assert.equal(link.businessObject.$parent.id,other.businessObject.$parent.id);assert.equal(link.parent.id,'BookingTransaction');
  const before=await m.getXML();m.reconnect(link,reverse?'target':'source',m.getElement('BookingFlow1'));modeling[reverse?'reconnectEnd':'reconnectStart'](other,registry.get('BookingFlow1'),{x:100,y:100});assert.equal(link.parent.id,other.parent.id);assert.equal(link.businessObject.$parent.id,other.businessObject.$parent.id);const after=await m.getXML();await valid(m);await history(m,before,after);
  m.moveShape(note,{x:600,y:0},m.getGraph().roots[0]);modeling.moveShape(registry.get('NestedNote'),{x:600,y:0},up.get('canvas').getRootElement());assert.equal(link.parent.id,other.parent.id);assert.equal(link.businessObject.$parent.id,other.businessObject.$parent.id);await valid(m);m.undo();assert.equal(await m.getXML(),after);
 }finally{m.destroy();up.destroy();}}
});

test('subprocess-view flow annotation uses active root and global child/outer history',async()=>{
 const m=await editor('test/fixtures/scenarios/order-payment-delivery.bpmn');try{
  const sub=m.getElement('Payment'),outerBefore=await m.getXML();m.updateLabel(m.getElement('ValidateOrder'),'Outer reviewed');assert.equal(await m.drillInto(sub),true);const childBefore=await m.getXML();const root=m.getGraph().roots[0],flow=m.getGraph().edges.find(e=>e.type==='bpmn:SequenceFlow');assert.ok(flow);m.select(flow.id);m.getContainer().querySelector('[data-action="append.text-annotation"]').click();const note=m.getGraph().nodes.find(n=>n.type==='bpmn:TextAnnotation');assert.equal(note.parent,root);assert.equal(note.businessObject.$parent,root.businessObject);const link=m.getGraph().edges.find(e=>e.source===flow);assert.equal(link.businessObject.$parent,root.businessObject);const withNote=await m.getXML();await valid(m);assert.equal(await m.navigateBack(),true);assert.equal(m.undo(),true);assert.equal(m.getGraph().diagram.plane.bpmnElement.id,'Payment');assert.equal(await m.getXML(),childBefore);assert.ok(![...all(m.getDefinitions())].some(o=>o.id===note.id));assert.equal(m.undo(),true);assert.equal(m.getElement('ValidateOrder').businessObject.name,'Validate order');m.redo();assert.equal(await m.getXML(),childBefore);m.redo();assert.equal(await m.getXML(),withNote);await m.navigateBack();assert.equal(await m.drillInto(m.getElement('Payment')),true);m.undo();assert.equal(await m.getXML(),childBefore);m.redo();assert.equal(await m.getXML(),withNote);await m.importXML(withNote);await valid(m);assert.notEqual(await m.getXML(),outerBefore);
 }finally{m.destroy();}
});

async function gestureEditor(){
 const callbacks=new WeakMap(),restore=[];for(const target of [dom.window.HTMLElement.prototype,dom.window.SVGElement.prototype,window]){const add=target.addEventListener;target.addEventListener=function(type,callback,options){const list=callbacks.get(this)||[];list.push({type,callback});callbacks.set(this,list);return add.call(this,type,callback,options);};restore.push(()=>target.addEventListener=add);}
 const m=await editor(),oldHit=document.elementsFromPoint;let hit=null;document.elementsFromPoint=()=>hit?[hit]:[];
 const gfx=node=>m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
 const event=(target,p,extra={})=>{const v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{target,button:0,clientX:r.left+v.x+p.x*v.zoom,clientY:r.top+v.y+p.y*v.zoom,preventDefault(){},stopPropagation(){},...extra};};
 const call=(target,type,ev,name)=>{const entries=(callbacks.get(target)||[]).filter(entry=>entry.type===type&&entry.callback.name===name);assert.ok(entries.length,`${name} registered`);entries.forEach(entry=>entry.callback(ev));};
 return{m,gfx,target(node){hit=node?gfx(node):null;},down(target,p,extra){call(m.getSvg(),'mousedown',event(target,p,extra),'onMouseDown');},move(p){call(window,'mousemove',event(hit,p),'onMouseMove');},up(p){call(window,'mouseup',event(hit,p),'onMouseUp');},close(){m.destroy();restore.reverse().forEach(f=>f());document.elementsFromPoint=oldHit;}};
}

test('registered segment/bendpoint gestures propagate dependent previews and restore exact cancel, jitter and undo',async()=>{
 const h=await gestureEditor(),{m}=h;try{
  const flow=m.getElement('F'),dep=m.getElement('D');m.setViewport({x:125,y:60,zoom:.65});const old=clone(dep.waypoints),before=await m.getXML(),size=m.commandStack.size();const start={x:600.25,y:340.5},end={x:600.25,y:415.75};
  const begin=()=>{m.select(flow.id);const handle=m.getContainer().querySelector('[data-segment-index="0"]');assert.ok(handle);h.down(handle,start);};
  for(const mode of ['cancel','jitter','commit']){begin();h.move(end);assert.notDeepEqual(coords(dep.waypoints),coords(old),'dependent preview changes with owner');if(mode==='cancel')m.cancel();if(mode==='jitter')h.move(start);h.up(mode==='jitter'?start:end);if(mode!=='commit'){assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}else{assert.equal(m.commandStack.size(),size+1);const changed=await m.getXML();await valid(m);await history(m,before,changed);m.undo();}}
  m.updateWaypoints(flow,[{x:400.25,y:340.5},{x:500.25,y:340.5},{x:500.25,y:450.5},{x:800.25,y:450.5}]);const bendBefore=await m.getXML(),bendSize=m.commandStack.size();m.select(flow.id);const bend=m.getContainer().querySelector('[data-bend-index="1"]'),p={...flow.waypoints[1]};assert.ok(bend);h.down(bend,p);h.move({x:p.x+25,y:p.y+35});m.cancel();h.up(p);assert.equal(await m.getXML(),bendBefore);assert.equal(m.commandStack.size(),bendSize);
 }finally{h.close();}
});

test('dependent association endpoints redock onto the same or another flow through registered pointer handlers',async()=>{
 const h=await gestureEditor(),{m}=h;try{
  const owner=m.getElement('F'),note=m.getElement('N2'),a=m.addShape('bpmn:Task',{x:350,y:650}),b=m.addShape('bpmn:Task',{x:850,y:650}),other=m.connect(a,b);
  for(const reverse of [false,true]){const link=m.connect(reverse?note:owner,reverse?owner:note),index=reverse?link.waypoints.length-1:0;for(const [target,point]of [[owner,{x:650.25,y:340.5}],[other,{x:600,y:650}]]){m.select(link.id);const before=await m.getXML(),opposite={...link.waypoints[reverse?0:link.waypoints.length-1]};h.target(target);const handle=m.getContainer().querySelector(`[data-bend-index="${index}"]`);assert.ok(handle);h.down(handle,link.waypoints[index]);h.move(point);const preview=coords(link.waypoints);h.up(point);assert.equal(link[reverse?'target':'source'],target);assert.deepEqual(coords(link.waypoints),preview);assert.deepEqual(coords([link.waypoints[index]]),[point]);assert.deepEqual(coords([link.waypoints[reverse?0:link.waypoints.length-1]]),coords([opposite]));const after=await m.getXML();await valid(m);await history(m,before,after);}}
 }finally{h.close();}
});

test('space edits and pool clipboard preserve collaboration message dependencies and exact undo',async()=>{
 const m=await editor('test/fixtures/scenarios/order-payment-delivery.bpmn');try{
  const owner=m.getElement('OrderMessage'),note=m.addShape('bpmn:TextAnnotation',{x:800,y:720}),link=m.connect(owner,note),before=await m.getXML();
  const oldRoute=clone(owner.waypoints),oldLink=clone(link.waypoints);m.createSpace([...m.getGraph().nodes,...m.getGraph().edges],'horizontal',180,50,{direction:'e'});assert.notDeepEqual(coords(owner.waypoints),coords(oldRoute));assert.notDeepEqual(coords(link.waypoints),coords(oldLink));const spaced=await m.getXML();await valid(m);await history(m,before,spaced);m.undo();
  const oldEdges=new Set(m.getGraph().edges);const clipboard=m.copy([m.getElement('BuyerPool'),m.getElement('SellerPool'),note]);assert.ok(clipboard.edges.some(e=>e.id===owner.id));assert.ok(clipboard.edges.some(e=>e.id===link.id));m.paste({x:2600,y:1200});const newEdges=m.getGraph().edges.filter(e=>!oldEdges.has(e)),message=newEdges.find(e=>e.type==='bpmn:MessageFlow'&&e.businessObject.name===owner.businessObject.name),association=newEdges.find(e=>e.source===message);assert.ok(message&&association);assert.equal(message.businessObject.$parent.$type,'bpmn:Collaboration');assert.equal(association.businessObject.sourceRef,message.businessObject);const pasted=await m.getXML();await valid(m);await history(m,before,pasted);
 }finally{m.destroy();}
});

test('required Relationship cleanup reaches a fixed point regardless of dependency order',async()=>{
 const m=await editor();try{
  const flow=m.getElement('F'),note=m.getElement('N').businessObject,task=m.getElement('A').businessObject,defs=m.getDefinitions(),moddle=m.getModdle();
  const inner=moddle.create('bpmn:Relationship',{id:'InnerFlowRelation',type:'trace',source:[flow.businessObject],target:[note]}),outer=moddle.create('bpmn:Relationship',{id:'OuterRelation',type:'trace',source:[inner],target:[task]}),outermost=moddle.create('bpmn:Relationship',{id:'OutermostRelation',type:'trace',source:[note],target:[outer]}),validRelation=moddle.create('bpmn:Relationship',{id:'RetainedRelation',type:'trace',source:[task,outer],target:[note]});
  const originals=[outermost,outer,inner,validRelation];originals.forEach(o=>o.$parent=defs);defs.relationships=originals.slice();const array=defs.relationships,fields=originals.map(o=>({source:o.source,target:o.target,sourceEntries:o.source.slice(),targetEntries:o.target.slice()})),before=await m.getXML(),size=m.commandStack.size();await valid(m);
  m.delete(flow);assert.equal(m.commandStack.size(),size+1);assert.deepEqual(defs.relationships,[validRelation]);assert.deepEqual(validRelation.source,[task]);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(defs.relationships,array);assert.deepEqual(defs.relationships,originals);originals.forEach((o,j)=>{assert.equal(o.source,fields[j].source);assert.equal(o.target,fields[j].target);assert.deepEqual(o.source,fields[j].sourceEntries);assert.deepEqual(o.target,fields[j].targetEntries);});m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});
