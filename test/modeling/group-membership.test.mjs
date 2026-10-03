import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BpmnModdle as Official } from 'bpmn-moddle';
import { BpmnModdle as Local } from '../../lib/bpmn/moddle.js';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();after(()=>dom.cleanup());
const {planGroupMembership}=await dom.loadModule('/lib/modeling/GroupCategory.js');
function fixture(Model){const m=new Model();let id=0;const make=(type,name,parent,x=0,y=0,w=100,h=80)=>({id:name,type:'bpmn:'+type,businessObject:m.create('bpmn:'+type,{id:name}),parent,x,y,width:w,height:h});const root=make('Process','P'),group=make('Group','G',root,0,0,600,500),task=make('Task','T',root,100,100);const value=m.create('bpmn:CategoryValue',{id:'V'});group.businessObject.categoryValueRef=value;return{m,make,root,group,task,value,next:t=>t+'_'+(++id)};}
for(const [name,Model]of[['official',Official],['local',Local]]){
 test(`membership and legacy healing plans never mutate live references: ${name}`,()=>{
  const f=fixture(Model),{m,root,group,task,value,next}=f;const unmanaged=m.create('bpmn:CategoryValue',{id:'Unmanaged'});task.businessObject.categoryValueRef=[unmanaged];const array=task.businessObject.categoryValueRef;
  let plan=planGroupMembership([task],[],[root,group,task],m,next);assert.deepEqual(plan.flowElements[0].categoryValuesToAdd,[value]);assert.equal(task.businessObject.categoryValueRef,array);assert.deepEqual(array,[unmanaged]);
  delete group.businessObject.categoryValueRef;delete task.businessObject.categoryValueRef;plan=planGroupMembership([task],[],[root,group,task],m,next);assert.equal(plan.groups.length,1);assert.equal(plan.groups[0].groupShape,group);assert.equal(plan.flowElements[0].businessObject,task.businessObject);assert.equal(Object.hasOwn(group.businessObject,'categoryValueRef'),false);assert.equal(Object.hasOwn(task.businessObject,'categoryValueRef'),false);
 });
 test(`collapsed roots remove outer membership but retain inner categories: ${name}`,()=>{
  const {m,make,root,group,task,value,next}=fixture(Model),sub=make('SubProcess','Sub',root,50,50,400,350),inner=make('Group','Inner',sub,80,80,250,200),inside=m.create('bpmn:CategoryValue',{id:'InnerValue'});inner.businessObject.categoryValueRef=inside;task.parent=sub;task.businessObject.categoryValueRef=[value,inside];sub.collapsed=true;task.hidden=true;inner.hidden=true;
  const plan=planGroupMembership([task],[{groupShape:group,categoryValue:value},{groupShape:inner,categoryValue:inside}],[root,group,sub,inner,task],m,next);const change=plan.flowElements.find(c=>c.businessObject===task.businessObject);assert.deepEqual(change.categoryValuesToRemove,[value]);assert.deepEqual(change.categoryValuesToAdd,[]);assert.deepEqual(task.businessObject.categoryValueRef,[value,inside]);
  task.businessObject.categoryValueRef=[inside];sub.collapsed=false;task.hidden=false;inner.hidden=false;const expanded=planGroupMembership([task],[],[root,group,sub,inner,task],m,next).flowElements.find(c=>c.businessObject===task.businessObject);assert.deepEqual(expanded.categoryValuesToAdd,[value]);
 });
 test(`removed groups, unknown bindings, non-flow morphs and unscoped hidden elements remain bounded: ${name}`,()=>{
  const {m,root,group,task,value,next}=fixture(Model);task.businessObject.categoryValueRef=[value];let p=planGroupMembership([],[{groupShape:group,categoryValue:value}],[root,task],m,next);assert.deepEqual(p.flowElements[0].categoryValuesToRemove,[value]);
  for(const bad of ['unresolved:v',false,[],m.create('bpmn:Task')]){group.businessObject.categoryValueRef=bad;p=planGroupMembership([task],[],[root,task,group],m,next);assert.ok(p.flowElements.every(c=>c.categoryValuesToAdd.length===0));assert.equal(group.businessObject.categoryValueRef,bad);}
  group.businessObject.categoryValueRef=value;task.hidden=true;delete task.businessObject.categoryValueRef;assert.equal(planGroupMembership([task],[],[root,group,task],m,next).flowElements.length,0);
  task.hidden=false;task.type='bpmn:MessageFlow';task.businessObject=m.create('bpmn:MessageFlow');assert.equal(planGroupMembership([task],[],[root,group,task],m,next).flowElements.length,0);
 });
}
test('category planning sources are byte-identical to the pinned reference',async()=>{
 const manifest=JSON.parse(await readFile('lib/upstream/PROVENANCE.json','utf8'));
 for(const key of ['modeling/cmd/UpdateCategoryValueRefsHandler.js','modeling/behavior/util/CategoryUtil.js']){const data=await readFile('lib/upstream/'+key),record=manifest.additionalSources[key];assert.deepEqual(data,await readFile('node_modules/bpmn-js/'+record.source));assert.equal(createHash('sha256').update(data).digest('hex'),record.sha256);}
});

test('present unscoped hidden groups are ignored but removed groups still clean managed refs',()=>{
 const {m,root,group,task,value,next}=fixture(Local);task.businessObject.categoryValueRef=[value];group.hidden=true;
 const entry={groupShape:group,categoryValue:value};
 assert.equal(planGroupMembership([], [entry], [root,group,task],m,next).flowElements.length,0);
 const removed=planGroupMembership([], [entry], [root,task],m,next);
 assert.deepEqual(removed.flowElements[0].categoryValuesToRemove,[value]);
 assert.deepEqual(task.businessObject.categoryValueRef,[value]);
});
