import test from 'node:test';
import assert from 'node:assert/strict';
import { BpmnModdle } from 'bpmn-moddle';
import { BpmnModdle as CustomModdle } from '../../lib/bpmn/moddle.js';
import { getConnectionType, getConnectionAttributes, canReconnect, canAttachBoundary } from '../../lib/modeling/Rules.js';
import { loadUpstreamRules } from '../helpers/upstream-rules.mjs';
const oracle = await loadUpstreamRules();
for (const [modelName, Model] of [['upstream model', BpmnModdle], ['custom model', CustomModdle]]) {
const moddle = new Model();
let id = 0;
function shape(type, parent, attrs = {}) {
  const businessObject = moddle.create('bpmn:' + type, { id: `${type}_${++id}`, ...attrs });
  if (parent) businessObject.$parent = parent.businessObject.processRef || parent.businessObject;
  return { id: businessObject.id, type: businessObject.$type, businessObject, parent,
    x:0,y:0,width:100,height:80,incoming:[],outgoing:[],children:[],attachers:[],di:moddle.create('bpmndi:BPMNShape',{isExpanded:true}) };
}
const collaboration=shape('Collaboration');
const pool=shape('Participant',collaboration,{ processRef:moddle.create('bpmn:Process',{id:'Process_A'}) });
const otherPool=shape('Participant',collaboration,{ processRef:moddle.create('bpmn:Process',{id:'Process_B'}) });
const subprocess=shape('SubProcess',pool);
function nodes(parent) {
  const values=['Task','SendTask','ReceiveTask','SubProcess','StartEvent','EndEvent','IntermediateThrowEvent','IntermediateCatchEvent','BoundaryEvent','ExclusiveGateway','ParallelGateway','InclusiveGateway','EventBasedGateway','ComplexGateway','DataObjectReference','DataStoreReference','TextAnnotation','Group'].map(type=>shape(type,parent));
  for (const type of ['StartEvent','EndEvent','IntermediateThrowEvent','IntermediateCatchEvent','BoundaryEvent']) {
    for (const definition of ['Message','Timer','Signal','Error','Escalation','Link','Compensate','Conditional','Terminate']) {
      values.push(shape(type,parent,{eventDefinitions:[moddle.create('bpmn:'+definition+'EventDefinition')]}));
    }
  }
  values.push(shape('Task',parent,{isForCompensation:true}),shape('SubProcess',parent,{triggeredByEvent:true}));
  for (const value of values.filter(v=>v.type==='bpmn:BoundaryEvent')) { value.host=values[0]; values[0].attachers.push(value); }
  return values;
}
const a=nodes(pool), b=nodes(otherPool), inner=nodes(subprocess);
const label=node=>`${node.businessObject.$type}:${node.businessObject.eventDefinitions?.[0]?.$type||''}${node.businessObject.isForCompensation?':compensation':''}${node.businessObject.triggeredByEvent?':eventSubprocess':''}`;
for (const [name,sources,targets] of [['same pool',a,a],['cross pool',a,b],['nested scope',a,inner],['pools',[pool,otherPool],a.concat(b)],['child to ancestor',inner,[subprocess]]]) {
  test(`connection inference equals bpmn-js 18.30.1: ${modelName}, ${name}`,()=>{
    const mismatches=[];
    for (const source of sources) for (const target of targets) {
      const expected=oracle.canConnect(source,target)?.type || null;
      const actual=getConnectionType(source,target);
      assert.deepEqual(getConnectionAttributes(source,target),oracle.canConnect(source,target) || null);
      if (expected!==actual) mismatches.push(`${label(source)} -> ${label(target)}: expected ${expected}, actual ${actual}${source===target?' (self)':''}`);
    }
    assert.equal(mismatches.length,0,`${mismatches.length} differential failures:\n${mismatches.slice(0,100).join('\n')}`);
  });
}

for (const connectionType of ['SequenceFlow', 'MessageFlow', 'DataInputAssociation', 'DataOutputAssociation', 'Association']) {
  test(`reconnect inference preserves edge constraints: ${modelName}, ${connectionType}`, () => {
    const mismatches=[];
    for (const source of a) for (const target of b.concat(a)) {
      const connection={ source, target, businessObject: moddle.create('bpmn:'+connectionType) };
      const expected=oracle.canConnect(source,target,connection)?.type || null;
      const actual=canReconnect(connection,'target',target) || null;
      assert.deepEqual(getConnectionAttributes(source,target,connection),oracle.canConnect(source,target,connection) || null);
      if (actual!==expected) mismatches.push(`${label(source)} -> ${label(target)}: expected ${expected}, actual ${actual}`);
    }
    assert.equal(mismatches.length,0,`${mismatches.length} failures:\n${mismatches.slice(0,10).join('\n')}`);
  });
}

test(`boundary attachment matches upstream candidate hosts: ${modelName}`, () => {
  const boundary=shape('BoundaryEvent',pool);
  for (const host of a) assert.equal(canAttachBoundary(boundary,host),!!oracle.canAttach(boundary,host),label(host));
  const gateway=shape('EventBasedGateway',pool), receive=shape('ReceiveTask',pool);
  receive.incoming=[{source:gateway,businessObject:moddle.create('bpmn:SequenceFlow')}];
  assert.equal(canAttachBoundary(boundary,receive),false);
  assert.equal(!!oracle.canAttach(boundary,receive),false);
});

}
