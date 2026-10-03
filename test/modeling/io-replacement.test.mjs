import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle as Oracle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, planIOReplacement, LocalModdle;
before(async()=>{dom=await setupDOM();({planIOReplacement}=await dom.loadModule('/lib/modeling/IOReplacement.js'));({BpmnModdle:LocalModdle}=await dom.loadModule('/lib/bpmn/moddle.js'));});
after(async()=>dom.cleanup());
const audit={name:'Audit',prefix:'audit',uri:'urn:io:planner',types:[{name:'Links',extends:['bpmn:BaseElement'],properties:[{name:'item',type:'bpmn:ItemAwareElement',isReference:true,isAttr:true}]}]};
const fixture=await readFile('test/fixtures/io-replacement/order-status.bpmn','utf8');
for(const engine of ['upstream','retained'])test(`${engine} planner includes externally owned associations and does not mutate the source`,async()=>{
 const moddle=engine==='upstream'?new Oracle({audit}):LocalModdle({audit}),parsed=await moddle.fromXML(fixture),defs=parsed.rootElement,event=parsed.elementsById.WarehouseStatusReceived,output=parsed.elementsById.ReceivedStatus;
 const before=(await moddle.toXML(defs,{format:true})).xml,oldParents=[output,event.outputSet].map(o=>o.$parent),oldKeys=Object.keys(event);
 const plan=planIOReplacement(event,moddle.create('bpmn:IntermediateThrowEvent'),defs);
 assert.equal(plan.required,true);assert.deepEqual(plan.keys,['dataOutputs','outputSet','dataOutputAssociations']);assert.deepEqual([...plan.associations].map(o=>o.id).sort(),['StatusToArchive','StatusToPayload']);assert.ok(plan.removed.has(output));assert.equal(plan.blockedReferences.length,0);
 assert.deepEqual(Object.keys(event),oldKeys);assert.deepEqual([output,event.outputSet].map(o=>o.$parent),oldParents);assert.equal((await moddle.toXML(defs,{format:true})).xml,before);
 const watcher=parsed.elementsById.UpdateOrderStatus;watcher.set('item',output);assert.ok(planIOReplacement(event,moddle.create('bpmn:IntermediateThrowEvent'),defs).blockedReferences.some(entry=>entry.object===watcher&&entry.key==='item'));
});

test('IO family and Property ownership decisions preserve compatible data and refuse unresolved retained references',()=>{
 const moddle=new Oracle({audit});
 for(const [sourceType,targetType,removed]of [['bpmn:Task','bpmn:ServiceTask',false],['bpmn:IntermediateCatchEvent','bpmn:BoundaryEvent',false],['bpmn:IntermediateThrowEvent','bpmn:EndEvent',false],['bpmn:Task','bpmn:StartEvent',true],['bpmn:IntermediateCatchEvent','bpmn:IntermediateThrowEvent',true]]){
  const source=moddle.create(sourceType),target=moddle.create(targetType);const key=source.$instanceOf('bpmn:Activity')?'ioSpecification':source.$instanceOf('bpmn:CatchEvent')?'dataOutputs':'dataInputs';const item=moddle.create(key==='ioSpecification'?'bpmn:InputOutputSpecification':key==='dataOutputs'?'bpmn:DataOutput':'bpmn:DataInput');item.$parent=source;source[key]=key==='ioSpecification'?item:[item];
  const p=moddle.create('bpmn:Property');p.$parent=source;source.properties=[p];assert.equal(planIOReplacement(source,target).required,removed);assert.ok(!planIOReplacement(source,target).removed.has(p));
 }
 const task=moddle.create('bpmn:Task'),property=moddle.create('bpmn:Property');task.properties=[property];property.$parent=task;const plan=planIOReplacement(task,moddle.create('bpmn:ExclusiveGateway'));assert.deepEqual(plan.keys,['properties']);assert.ok(plan.removed.has(property));
});

test('actual pinned replacement removes catch IO and preserves retained control-flow and message references',async()=>{
 const {default:Modeler}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
 const m=new Modeler({container:dom.createContainer()});try{
  await m.importXML(fixture);const registry=m.get('elementRegistry'),old=registry.get('WarehouseStatusReceived'),output=old.businessObject.dataOutputs[0],message=old.businessObject.eventDefinitions[0].messageRef;
  const next=m.get('bpmnReplace').replaceElement(old,{type:'bpmn:IntermediateThrowEvent',eventDefinitionType:'bpmn:MessageEventDefinition'});
  assert.equal(next.businessObject.dataOutputs,undefined);assert.equal(next.businessObject.outputSet,undefined);assert.equal(registry.get('StatusToPayload'),undefined);assert.equal(registry.get('RequestToStatus').businessObject.targetRef,next.businessObject);assert.equal(registry.get('StatusToUpdate').businessObject.sourceRef,next.businessObject);assert.equal(next.businessObject.eventDefinitions[0].messageRef,message);
  m.get('commandStack').undo();assert.equal(registry.get('WarehouseStatusReceived').businessObject.dataOutputs[0],output);
 }finally{m.destroy();}
});
