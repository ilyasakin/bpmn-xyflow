import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';

const dom = await setupDOM();
const local = await dom.loadModule('/lib/modeling/ReplaceCatalog.js');
const { REPLACE_OPTIONS } = await dom.loadModule('/lib/modeling/ReplaceCatalogData.js');
const upstreamOptions = await dom.loadModule('/node_modules/bpmn-js/lib/features/replace/ReplaceOptions.js');
const { default: Provider } = await dom.loadModule('/node_modules/bpmn-js/lib/features/popup-menu/ReplaceMenuProvider.js');
const moddle = new BpmnModdle();
after(() => dom.cleanup());
let nextId = 0;
const bo = (type,attrs={}) => moddle.create(type,{id:`Element_${++nextId}`,...attrs});
const shape = (type,attrs={},parent,extra={}) => {
  const businessObject=bo(type,attrs);businessObject.$parent=parent;
  return {id:businessObject.id,type,businessObject,parent:parent?{type:parent.$type,businessObject:parent}:undefined,
    di:moddle.create('bpmndi:BPMNShape',{isExpanded:true}),...extra};
};
const make = (target,parent,host) => {
  const attrs={};
  for (const key of ['isInterrupting','cancelActivity','triggeredByEvent','instantiate','eventGatewayType']) if (target[key]!==undefined)attrs[key]=target[key];
  if (target.eventDefinitionType) attrs.eventDefinitions=[bo(target.eventDefinitionType,target.eventDefinitionAttrs)];
  if (target.type==='bpmn:Participant' && target.isExpanded!==false) attrs.processRef=bo('bpmn:Process');
  if (host)attrs.attachedToRef=host.businessObject;
  return shape(target.type,attrs,parent,{host,di:moddle.create('bpmndi:BPMNShape',{isExpanded:target.isExpanded!==false})});
};
const provider = new Provider({}, {registerProvider(){}}, {}, moddle, {}, {allowed:()=>true}, value=>value, {});
// Let the actual upstream provider perform its own context filtering and action
// de-duplication. Capture complete descriptors before actions mutate anything.
provider._createEntry=(option,element)=>({
  label:typeof option.label==='function'?option.label(element):option.label,
  actionName:option.actionName,className:option.className,
  ...(option.target?{target:JSON.parse(JSON.stringify(option.target))}:{})
});
const oracle = element => Object.values(provider.getPopupMenuEntries(element));
function expectedInScope(entries, kind) {
  // Deliberate semantic corrections to upstream typed-event shortcuts, tested
  // independently by exact rejected action names instead of the local validator.
  const forbidden = kind==='event' ? ['replace-with-none-start'] : kind==='process' ?
    ['replace-with-error-start','replace-with-escalation-start','replace-with-compensation-start'] :
    ['replace-with-message-start','replace-with-timer-start','replace-with-conditional-start','replace-with-signal-start',
      'replace-with-error-start','replace-with-escalation-start','replace-with-compensation-start'];
  return entries.filter(entry=>!forbidden.includes(entry.actionName));
}

test('vendored replacement descriptor data exactly matches pinned upstream 18.30.1',async()=>{
  assert.equal(JSON.parse(await readFile('node_modules/bpmn-js/package.json','utf8')).version,'18.30.1');
  const normalize=value=>JSON.parse(JSON.stringify(value,(key,item)=>typeof item==='function'?'dynamic-participant-label':item));
  assert.deepEqual(normalize(REPLACE_OPTIONS),normalize(upstreamOptions));
  const withChildren={children:[{}]},empty={children:[]};
  for(const target of [withChildren,empty]) assert.equal(REPLACE_OPTIONS.PARTICIPANT[1].label(target),upstreamOptions.PARTICIPANT[1].label(target));
});

for (const kind of ['process','subprocess','event','transaction']) {
  test(`${kind}: all event/task/gateway/subprocess action names and target attributes match the independent provider`,()=>{
    const parent=bo(kind==='process'?'bpmn:Process':kind==='transaction'?'bpmn:Transaction':'bpmn:SubProcess',{triggeredByEvent:kind==='event'});
    const groups=['START_EVENT','EVENT_SUB_PROCESS_START_EVENT','INTERMEDIATE_EVENT','END_EVENT','TASK','GATEWAY','SUBPROCESS_EXPANDED','AD_HOC_SUBPROCESS_EXPANDED','TRANSACTION','DATA_OBJECT_REFERENCE','DATA_STORE_REFERENCE'];
    let comparisons=0;
    for(const group of groups)for(const entry of upstreamOptions[group]) {
      const element=make(entry.target,parent);
      const expected=expectedInScope(oracle(element),kind);
      assert.deepEqual(local.getReplacementOptions(element),expected,`${kind}/${group}/${entry.actionName}`);
      comparisons++;
    }
    assert.ok(comparisons>70);
  });
}

for(const hostType of ['bpmn:Task','bpmn:SubProcess','bpmn:Transaction','bpmn:CallActivity']) {
  test(`${hostType}: every interrupting/non-interrupting boundary variant matches full upstream menu descriptors`,()=>{
    const parent=bo('bpmn:Process'),host=shape(hostType,{},parent);
    for(const entry of upstreamOptions.BOUNDARY_EVENT) {
      const boundary=make(entry.target,parent,host);
      assert.deepEqual(local.getReplacementOptions(boundary),oracle(boundary),entry.actionName);
    }
    // Creation shows every valid variant, including the current option that a
    // replacement menu omits. The cancel variant exists only on transactions.
    const expected=upstreamOptions.BOUNDARY_EVENT.filter(entry=>hostType==='bpmn:Transaction'||entry.actionName!=='replace-with-cancel-boundary');
    assert.deepEqual(local.getBoundaryEventOptions(host),expected);
  });
}

test('participant, collaboration data store, and conditional/default flow action catalogs match upstream',()=>{
  const process=bo('bpmn:Process'),collaboration=bo('bpmn:Collaboration');
  for(const expanded of [true,false]) {
    const element=make({type:'bpmn:Participant',isExpanded:expanded},collaboration);element.children=[{}];
    assert.deepEqual(local.getReplacementOptions(element),oracle(element));
  }
  for(const parent of [process,collaboration]) {
    const element=shape('bpmn:DataStoreReference',{},parent);
    assert.deepEqual(local.getReplacementOptions(element),oracle(element));
  }
  for(const type of ['bpmn:Task','bpmn:ExclusiveGateway','bpmn:InclusiveGateway','bpmn:ComplexGateway','bpmn:ParallelGateway']) {
    for(const mode of ['normal','conditional','default']) {
      const source=bo(type),flow=shape('bpmn:SequenceFlow',{sourceRef:source},process);
      if(mode==='conditional')flow.businessObject.conditionExpression=bo('bpmn:FormalExpression',{body:'x'});
      if(mode==='default')source.default=flow.businessObject;
      assert.deepEqual(local.getReplacementOptions(flow),oracle(flow),`${type}/${mode}`);
    }
  }
});

test('invalid catch/throw/interrupting/cancel combinations reject consistently while valid Link and Cancel remain',()=>{
  const process=bo('bpmn:Process'),ordinary=bo('bpmn:SubProcess'),event=bo('bpmn:SubProcess',{triggeredByEvent:true}),transaction=bo('bpmn:Transaction');
  const host=shape('bpmn:Task'),transactionHost=shape('bpmn:Transaction');
  const target=(type,eventDefinitionType,attrs={})=>({type,...(eventDefinitionType?{eventDefinitionType}:{}),...attrs});
  const invalid=[
    [target('bpmn:EndEvent','bpmn:TimerEventDefinition'),{parent:process}],
    [target('bpmn:IntermediateThrowEvent','bpmn:TimerEventDefinition'),{parent:process}],
    [target('bpmn:IntermediateCatchEvent','bpmn:EscalationEventDefinition'),{parent:process}],
    [target('bpmn:IntermediateCatchEvent'),{parent:process}],
    [target('bpmn:StartEvent'),{parent:event}],
    [target('bpmn:StartEvent','bpmn:TimerEventDefinition'),{parent:ordinary}],
    [target('bpmn:StartEvent','bpmn:ErrorEventDefinition'),{parent:process}],
    [target('bpmn:StartEvent','bpmn:MessageEventDefinition',{isInterrupting:false}),{parent:process}],
    [target('bpmn:StartEvent','bpmn:ErrorEventDefinition',{isInterrupting:false}),{parent:event}],
    [target('bpmn:EndEvent','bpmn:CancelEventDefinition'),{parent:process}],
    [target('bpmn:BoundaryEvent','bpmn:CancelEventDefinition'),{host}],
    [target('bpmn:BoundaryEvent','bpmn:ErrorEventDefinition',{cancelActivity:false}),{host}],
    [target('bpmn:BoundaryEvent','bpmn:CompensateEventDefinition',{cancelActivity:false}),{host}],
    [target('bpmn:BoundaryEvent','bpmn:MessageEventDefinition'),{}],
    [target('bpmn:Task','bpmn:TimerEventDefinition'),{parent:process}],
    [target('bpmn:Task',undefined,{triggeredByEvent:false}),{parent:process}],
    [target('bpmn:EndEvent',undefined,{isInterrupting:true}),{parent:process}],
    [target('bpmn:SubProcess',undefined,{triggeredByEvent:true,isExpanded:false}),{parent:process}]
  ];
  for(const [entry,context] of invalid)assert.equal(local.isValidTarget(entry,context),false,JSON.stringify(entry));
  for(const type of ['bpmn:IntermediateCatchEvent','bpmn:IntermediateThrowEvent']) assert.equal(local.isValidTarget(target(type,'bpmn:LinkEventDefinition',{eventDefinitionAttrs:{name:''}}),{parent:process}),true);
  assert.equal(local.isValidTarget(target('bpmn:EndEvent','bpmn:CancelEventDefinition'),{parent:transaction}),true);
  assert.equal(local.isValidTarget(target('bpmn:BoundaryEvent','bpmn:CancelEventDefinition'),{host:transactionHost}),true);
  assert.equal(local.isValidTarget(target('bpmn:StartEvent','bpmn:EscalationEventDefinition',{isInterrupting:false}),{parent:event}),true);
  assert.equal(local.isValidReplacement(shape('bpmn:SubProcess',{},process),{type:'bpmn:ExclusiveGateway'}),true,'direct valid type changes are not constrained to popup family');
});

test('boundary hosts honor event-subprocess/compensation/activity and event-based receive restrictions',()=>{
  for(const host of [shape('bpmn:Task',{isForCompensation:true}),shape('bpmn:SubProcess',{triggeredByEvent:true}),shape('bpmn:Lane'),shape('bpmn:StartEvent')]) assert.deepEqual(local.getBoundaryEventOptions(host),[]);
  const receive=shape('bpmn:ReceiveTask');receive.incoming=[{source:shape('bpmn:EventBasedGateway')}];
  assert.deepEqual(local.getBoundaryEventOptions(receive),[]);
  assert.deepEqual(local.getBoundaryEventOptions(null),[]);
});

test('menu results do not leak mutable static data and include missing task/subprocess/call/link choices',()=>{
  const task=shape('bpmn:Task',{},bo('bpmn:Process'));
  const entries=local.getReplacementOptions(task),actions=entries.map(entry=>entry.actionName);
  for(const action of ['replace-with-call-activity','replace-with-expanded-subprocess','replace-with-collapsed-subprocess','replace-with-collapsed-ad-hoc-subprocess'])assert.ok(actions.includes(action));
  entries[0].target.type='bpmn:Unknown';entries[0].label='mutated';
  assert.notEqual(local.getReplacementOptions(task)[0].target.type,'bpmn:Unknown');
  const intermediate=shape('bpmn:IntermediateThrowEvent',{},bo('bpmn:Process'));
  const link=local.getReplacementOptions(intermediate).find(entry=>entry.actionName==='replace-with-link-intermediate-catch');
  assert.deepEqual(link.target.eventDefinitionAttrs,{name:''});link.target.eventDefinitionAttrs.name='mutated';
  assert.deepEqual(local.getReplacementOptions(intermediate).find(entry=>entry.actionName===link.actionName).target.eventDefinitionAttrs,{name:''});
  for(const element of [null,[],{...task,isRoot:true},{...task,type:'label'}])assert.deepEqual(local.getReplacementOptions(element),[]);
});
