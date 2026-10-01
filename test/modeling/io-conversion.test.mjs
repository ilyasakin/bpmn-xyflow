import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { connectAuthoredIO } from '../helpers/authored-io.mjs';
let dom, Modeler, planIOReplacement;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));({planIOReplacement}=await dom.loadModule('/lib/modeling/IOReplacement.js'));});
after(async()=>dom.cleanup());
const fixture=await readFile('test/fixtures/io-replacement/order-status.bpmn','utf8');
const target={type:'bpmn:IntermediateThrowEvent',eventDefinitionType:'bpmn:MessageEventDefinition'};
const audit={name:'Audit',uri:'urn:io:review',prefix:'audit',types:[{name:'Links',extends:['bpmn:BaseElement'],properties:[{name:'watchedItem',type:'bpmn:ItemAwareElement',isReference:true,isAttr:true},{name:'watchedOwner',type:'bpmn:BaseElement',isReference:true,isAttr:true}]}]};
let artifact=0;
async function valid(m,extensions={}){const xml=await m.getXML();if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`io-conversion-${++artifact}.bpmn`),xml);}const result=await new BpmnModdle(extensions).fromXML(xml);assert.deepEqual(result.warnings,[]);return result;}
async function editor(extensions={}){const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,moddleExtensions:extensions});await m.importXML(fixture);return m;}
function tree(root){const set=new Set();function walk(o){if(!o||typeof o!=='object'||set.has(o))return;set.add(o);for(const p of o.$descriptor?.properties||[])if(!p.isReference&&!p.isVirtual&&!p.isAttr){const v=o[p.name];(Array.isArray(v)?v:[v]).forEach(walk);}}walk(root);return set;}

test('explicit IO conversion removes visible and hidden associations while preserving identity, metadata and exact history',async()=>{
 const m=await editor({audit});try{
  const event=m.getElement('WarehouseStatusReceived'),old=event.businessObject,defs=m.getDefinitions();
  const p=m.getModdle().create('bpmn:Property',{id:'RetainedProperty'});p.$parent=old;old.properties=[p];old.watchedItem=p;old.watchedOwner=old;p.watchedOwner=old;m.getElement('UpdateOrderStatus').businessObject.watchedItem=p;
  const label=event.label,labelDi=label.di,ownerDi=event.di,output=old.dataOutputs[0],associations=[...tree(defs)].filter(o=>['StatusToPayload','StatusToArchive'].includes(o.id)),di=defs.diagrams.map(d=>({plane:d.plane,entries:d.plane.planeElement.slice(),array:d.plane.planeElement}));
  const before=await m.getXML(),size=m.commandStack.size();await valid(m,{audit});
  for(const options of [{},{removeIncompatibleData:false},{removeIncompatibleData:'yes'},{removeIncompatibleData:null}]){assert.equal(m.replace(event,target,{},options),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
  const plan=planIOReplacement(old,m.getModdle().create(target.type),defs);assert.deepEqual([...plan.associations].map(o=>o.id).sort(),['StatusToArchive','StatusToPayload']);assert.equal(plan.blockedReferences.length,0);
  assert.equal(m.replace(event,target,{}, {removeIncompatibleData:true}),event);assert.equal(m.commandStack.size(),size+1);assert.equal(event.businessObject.properties[0],p);assert.equal(p.$parent,event.businessObject);assert.equal(event.businessObject.watchedItem,p);assert.equal(event.businessObject.watchedOwner,event.businessObject);assert.equal(p.watchedOwner,event.businessObject);
  const current=tree(defs);for(const o of [output,...associations])assert.ok(!current.has(o));for(const d of defs.diagrams)assert.ok(d.plane.planeElement.every(item=>!associations.includes(item.bpmnElement)));
  assert.equal(event.businessObject.eventDefinitions[0].messageRef.id,'WarehouseStatusMessage');assert.equal(m.getElement('RequestToStatus').businessObject.targetRef,event.businessObject);assert.equal(m.getElement('StatusToUpdate').businessObject.sourceRef,event.businessObject);
  const after=await m.getXML();assert.ok(after.includes('Preserve <!-- io-owner-marker -->event<?io-owner preserve?>'));assert.ok(after.includes('<!-- io-lineage-marker --><?io-lineage preserve?>'));await valid(m,{audit});
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(event.businessObject,old);assert.equal(event.di,ownerDi);assert.equal(event.label,label);assert.equal(label.di,labelDi);assert.equal(p.$parent,old);for(const d of di){assert.equal(d.plane.planeElement,d.array);assert.deepEqual(d.plane.planeElement,d.entries);}m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});

test('declared references into removed IO block conversion; compatible activity IO retains original objects',async()=>{
 const m=await editor({audit});try{
  const event=m.getElement('WarehouseStatusReceived'),watcher=m.getElement('UpdateOrderStatus').businessObject;watcher.watchedItem=event.businessObject.dataOutputs[0];
  const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.replace(event,target,{}, {removeIncompatibleData:true}),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);delete watcher.watchedItem;
  const task=m.addShape('bpmn:Task',{x:750,y:350}),data=m.addShape('bpmn:DataObjectReference',{x:950,y:350}),edge=connectAuthoredIO(m,data,task),io=task.businessObject.ioSpecification,association=edge.businessObject;
  const prior=await m.getXML();assert.equal(m.replace(task,'bpmn:ServiceTask'),task);assert.equal(task.businessObject.ioSpecification,io);assert.equal(task.businessObject.dataInputAssociations[0],association);assert.equal(association.$parent,task.businessObject);m.delete(edge);assert.equal(task.businessObject.dataInputAssociations.length,0);m.undo();m.undo();assert.equal(await m.getXML(),prior);await valid(m,{audit});
 }finally{m.destroy();}
});

test('unsupported Property ownership requires explicit removal and preserves all objects on undo',async()=>{
 const m=await editor({audit});try{
  const node=m.addShape('bpmn:Task',{x:750,y:350}),old=node.businessObject,p=m.getModdle().create('bpmn:Property',{id:'TaskProperty'});p.$parent=old;old.properties=[p];
  const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.replace(node,'bpmn:ExclusiveGateway'),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.equal(m.replace(node,'bpmn:ExclusiveGateway',{}, {removeIncompatibleData:true}),node);assert.equal(node.businessObject.properties,undefined);await valid(m,{audit});m.undo();assert.equal(node.businessObject,old);assert.equal(old.properties[0],p);assert.equal(p.$parent,old);assert.equal(await m.getXML(),before);
 }finally{m.destroy();}
});

test('IO replacement menu enables explicit cleanup and cancellation leaves the complete graph and history unchanged',async()=>{
 const m=await editor();try{
  const event=m.getElement('WarehouseStatusReceived'),before=await m.getXML(),size=m.commandStack.size();
  const open=()=>{m.select(event.id);m.getContainer().querySelector('button[title^="Change type"]').click();const item=m.getContainer().querySelector('[data-action="replace-with-message-intermediate-throw"]');assert.ok(item);assert.notEqual(item.getAttribute('aria-disabled'),'true');item.click();return m.getContainer().querySelector('[role="dialog"][aria-label="Replace and remove incompatible data"]');};
  let dialog=open();assert.ok(dialog);[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Cancel').click();assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  dialog=open();[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Replace and remove incompatible data').click();assert.equal(event.type,target.type);assert.equal(m.commandStack.size(),size+1);assert.equal(m.getContainer().querySelector('[role="dialog"]'),null);await valid(m);m.undo();assert.equal(await m.getXML(),before);
 }finally{m.destroy();}
});

test('throw to catch cleanup removes owned input, set and association across inactive planes with exact history',async()=>{
 const m=await editor();try{
  const event=m.addShape('bpmn:IntermediateThrowEvent',{x:750,y:420},{eventDefinitionType:'bpmn:MessageEventDefinition'}),data=m.getElement('StatusPayload'),edge=connectAuthoredIO(m,data,event),old=event.businessObject;
  const input=old.dataInputs[0],set=m.getModdle().create('bpmn:InputSet',{id:'ThrowInputSet',dataInputRefs:[input]});set.$parent=old;old.inputSet=set;
  const plane=m.getDefinitions().diagrams[1].plane;
  const mirror=m.getModdle().create('bpmndi:BPMNEdge',{id:'InputAssociationMirror',bpmnElement:edge.businessObject,waypoint:[m.getModdle().create('dc:Point',{x:10,y:20}),m.getModdle().create('dc:Point',{x:50,y:20})]});mirror.$parent=plane;mirror.waypoint.forEach(p=>p.$parent=mirror);plane.planeElement.push(mirror);
  const inputDi=m.getModdle().create('bpmndi:BPMNShape',{id:'InputItemMirror',bpmnElement:input,bounds:m.getModdle().create('dc:Bounds',{x:40,y:80,width:36,height:50})});inputDi.$parent=plane;inputDi.bounds.$parent=inputDi;plane.planeElement.push(inputDi);
  const entries=plane.planeElement.slice(),array=plane.planeElement,before=await m.getXML(),count=m.commandStack.size();await valid(m);
  const next={type:'bpmn:IntermediateCatchEvent',eventDefinitionType:'bpmn:MessageEventDefinition'};
  assert.equal(m.replace(event,next),null);assert.equal(await m.getXML(),before);assert.equal(m.replace(event,next,{}, {removeIncompatibleData:true}),event);assert.equal(event.businessObject.dataInputs,undefined);assert.equal(event.businessObject.inputSet,undefined);assert.equal(m.getElement(edge.id),null);assert.ok(!plane.planeElement.includes(mirror));assert.ok(!plane.planeElement.includes(inputDi));assert.equal(m.commandStack.size(),count+1);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(event.businessObject,old);assert.equal(old.dataInputs[0],input);assert.equal(old.inputSet,set);assert.equal(m.getElement(edge.id),edge);assert.equal(plane.planeElement,array);assert.deepEqual(plane.planeElement,entries);m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});

test('same-family catch and throw replacements retain owned IO, custom references and association identities',async()=>{
 const m=await editor({audit});try{
  const catchEvent=m.getElement('WarehouseStatusReceived'),throwEvent=m.addShape('bpmn:IntermediateThrowEvent',{x:750,y:420},{eventDefinitionType:'bpmn:MessageEventDefinition'});
  connectAuthoredIO(m,m.getElement('StatusPayload'),throwEvent);
  for(const [event,targetType,itemKey,associationKey]of [[catchEvent,'bpmn:IntermediateCatchEvent','dataOutputs','dataOutputAssociations'],[throwEvent,'bpmn:EndEvent','dataInputs','dataInputAssociations']]){
   const old=event.businessObject,item=old[itemKey][0],association=old[associationKey][0];old.watchedItem=item;const before=await m.getXML();
   assert.equal(m.replace(event,{type:targetType,eventDefinitionType:'bpmn:MessageEventDefinition'}),event);assert.equal(event.businessObject[itemKey][0],item);assert.equal(event.businessObject[associationKey][0],association);assert.equal(event.businessObject.watchedItem,item);assert.equal(item.$parent,event.businessObject);assert.equal(association.$parent,event.businessObject);await valid(m,{audit});m.undo();assert.equal(await m.getXML(),before);assert.equal(event.businessObject,old);
  }
 }finally{m.destroy();}
});

test('explicit cleanup deletes a rendered activity IO item and restores its graph, DI and ownership exactly',async()=>{
 const m=await editor();try{
  const task=m.addShape('bpmn:Task',{x:750,y:420}),edge=connectAuthoredIO(m,m.getElement('StatusPayload'),task),item=task.businessObject.ioSpecification.dataInputs[0],itemId=item.id,taskId=task.id,edgeId=edge.id;
  const plane=m.getDefinitions().diagrams[0].plane,di=m.getModdle().create('bpmndi:BPMNShape',{id:'VisibleInputDI',bpmnElement:item,bounds:m.getModdle().create('dc:Bounds',{x:720,y:530,width:36,height:50})});di.$parent=plane;di.bounds.$parent=di;plane.planeElement.push(di);
  await m.importXML(await m.getXML());const current=m.getElement(taskId),inputNode=m.getElement(itemId),association=m.getElement(edgeId);assert.ok(inputNode,'retained importer renders activity inputs with explicit DI');const graph=m.getGraph(),nodes=graph.nodes.slice(),before=await m.getXML(),inputDi=inputNode.di;
  assert.equal(m.replace(current,{type:'bpmn:IntermediateCatchEvent',eventDefinitionType:'bpmn:MessageEventDefinition'},{},{removeIncompatibleData:true}),current);assert.equal(m.getElement(itemId),null);assert.equal(m.getElement(edgeId),null);await valid(m);const after=await m.getXML();
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(m.getElement(itemId),inputNode);assert.equal(inputNode.di,inputDi);assert.equal(m.getElement(edgeId),association);assert.deepEqual(graph.nodes,nodes);m.redo();assert.equal(await m.getXML(),after);}
 }finally{m.destroy();}
});
