import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BpmnModdle } from 'bpmn-moddle';
import { loadRuleModule, loadUpstreamRules } from '../helpers/upstream-rules.mjs';
const [adapter,oracle]=await Promise.all([loadRuleModule('lib/modeling/ContextRules.js'),loadUpstreamRules()]);
const m=new BpmnModdle();let next=0;
function node(type,parent,attrs={}) {
 const bo=m.create('bpmn:'+type,{id:`${type}_${++next}`,...attrs});bo.$parent=parent?.businessObject.processRef||parent?.businessObject;
 return {id:bo.id,type:bo.$type,businessObject:bo,parent,children:[],incoming:[],outgoing:[],attachers:[],x:100,y:100,width:120,height:80,di:m.create('bpmndi:BPMNShape',{isExpanded:true})};
}
const process=node('Process'),collaboration=node('Collaboration');
const pool=node('Participant',collaboration,{processRef:process.businessObject});
const emptyPool=node('Participant',collaboration),sub=node('SubProcess',pool),collapsed=node('SubProcess',pool);collapsed.di.isExpanded=false;
const transaction=node('Transaction',pool),eventSub=node('SubProcess',pool,{triggeredByEvent:true}),adhoc=node('AdHocSubProcess',pool),lane=node('Lane',pool);
const targets=[process,collaboration,pool,emptyPool,sub,collapsed,transaction,eventSub,adhoc,lane,node('Task',pool)];
const shapes=['Task','UserTask','ReceiveTask','SubProcess','StartEvent','EndEvent','IntermediateCatchEvent','IntermediateThrowEvent','BoundaryEvent','ExclusiveGateway','Participant','Lane','TextAnnotation','Group','DataObjectReference','DataStoreReference','DataInput','DataOutput'].map(type=>node(type,process));
for(const type of ['StartEvent','EndEvent','IntermediateCatchEvent','IntermediateThrowEvent','BoundaryEvent'])for(const def of ['Message','Timer','Error','Cancel','Signal','Conditional','Compensate','Escalation','Link'])shapes.push(node(type,process,{eventDefinitions:[m.create('bpmn:'+def+'EventDefinition')]}));
shapes.push(node('StartEvent',process,{isInterrupting:false,eventDefinitions:[m.create('bpmn:MessageEventDefinition')]}));
test('vendored upstream rule files remain byte-identical to their pinned source',async()=>{
 const manifest=JSON.parse(await readFile('lib/upstream/PROVENANCE.json','utf8'));assert.equal(manifest.version,'18.30.1');
 for(const [file,sha]of Object.entries(manifest.files)) {
  const local=await readFile('lib/upstream/'+file),source=await readFile('node_modules/bpmn-js/lib/features/'+file);
  assert.deepEqual(local,source);assert.equal(createHash('sha256').update(local).digest('hex'),sha);
 }
});
for(const method of ['canCreate','canDrop','canMove','dropReplacements'])test(`context adapter ${method} matches pinned rule predicate across scopes`,()=>{
 for(const shape of shapes)for(const target of targets){
  const expected=method==='canMove'?oracle.canMove([shape],target):method==='dropReplacements'?oracle.canReplace([shape],target):oracle[method](shape,target);
  const actual=adapter[method](method==='canMove'||method==='dropReplacements'?[shape]:shape,target);
  assert.deepEqual(actual,method==='dropReplacements'?expected:!!expected,`${method}: ${shape.type} -> ${target.type}`);
 }
});
test('attachment adapter checks candidate types and actual boundary positions',()=>{
 for(const shape of shapes)for(const target of targets)for(const position of [undefined,{x:100,y:140},{x:160,y:140}]) {
  assert.equal(adapter.canAttach(shape,target,position),!!oracle.canAttach(shape,target,null,position));
 }
});
test('insertion/copy adapters retain connection and organizational constraints',()=>{
 const a=node('Task',pool),b=node('Task',pool);
 for(const type of ['SequenceFlow','MessageFlow','Association']) {
  const edge={...node(type,pool),source:a,target:b,waypoints:[{x:220,y:140},{x:300,y:140}]};
  for(const shape of shapes)assert.equal(adapter.canInsert(shape,edge),!!oracle.canInsert(shape,edge));
 }
 for(const shape of shapes)for(const selected of [[],[shape],[shape,shape.parent]])assert.equal(adapter.canCopy(selected,shape),!!oracle.canCopy(selected,shape));
 assert.equal(adapter.canCreate(null,pool),false);assert.equal(adapter.canDrop(a,null),false);assert.equal(adapter.canMove([a],null),false);
});

test('resize adapter matches pinned type, expansion, bounds and direction policy',()=>{
 const label={...node('Task',process),type:'label',labelTarget:shapes[0]};
 const candidates=[...shapes,...targets,label];
 const bounds=[undefined,{x:100,y:100,width:99,height:80},{x:100,y:100,width:100,height:79},{x:100,y:100,width:100,height:80},{x:90,y:80,width:400,height:300}];
 for(const shape of candidates)for(const next of bounds)for(const direction of [undefined,'n','s','e','w','ne','nw','se','sw']) {
  assert.equal(adapter.canResize(shape,next,direction),!!oracle.canResize(shape,next,direction),`${shape.type}/${shape.di?.isExpanded}/${JSON.stringify(next)}/${direction}`);
 }
 assert.equal(adapter.canResize(null),false);
 assert.equal(adapter.canResize(node('Task',process)),false,'ordinary task resize is an extra, not an upstream rule');
 assert.equal(adapter.canResize(node('TextAnnotation',process),undefined,'e'),true);
 assert.equal(adapter.canResize(node('TextAnnotation',process),undefined,'se'),false);
});
