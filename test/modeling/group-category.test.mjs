import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle as Official } from 'bpmn-moddle';
import { BpmnModdle as Local } from '../../lib/bpmn/moddle.js';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM();after(()=>dom.cleanup());
const {planGroupCategory}=await dom.loadModule('/lib/modeling/GroupCategory.js');
const {default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
for(const [name,Model] of [['official',Official],['local',Local]]){
 test(`category binding plans preserve existing identities without mutation: ${name}`,()=>{
  for(const mode of ['new','orphan-value','orphan-category','normal','array-only','wrong-parent']){
   const m=new Model(),defs=m.create('bpmn:Definitions'),group=m.create('bpmn:Group'),value=mode==='new'?null:m.create('bpmn:CategoryValue',{id:'V',value:'Review'}),category=m.create('bpmn:Category',{id:'C'});let i=0;
   if(value)group.categoryValueRef=value;
   if(['normal','orphan-category','wrong-parent'].includes(mode))value.$parent=category;
   if(['normal','array-only','wrong-parent'].includes(mode)){defs.rootElements=[category];category.categoryValue=[value];category.$parent=defs;}
   if(mode==='wrong-parent')value.$parent=group;
   const before={ref:group.categoryValueRef,roots:defs.rootElements,values:category.categoryValue,vParent:value?.$parent,cParent:category.$parent};
   const plan=planGroupCategory(group,defs,m,type=>type+'_'+(++i));assert.ok(plan);assert.equal(plan.createdValue,mode==='new');assert.equal(plan.createdCategory,['new','orphan-value'].includes(mode));
   if(value)assert.equal(plan.value,value);if(!plan.createdCategory)assert.equal(plan.category,category);
   assert.equal(group.categoryValueRef,before.ref);assert.equal(defs.rootElements,before.roots);assert.equal(category.categoryValue,before.values);assert.equal(value?.$parent,before.vParent);assert.equal(category.$parent,before.cParent);
  }
 });
 test(`malformed Group binding is refused without consuming IDs: ${name}`,()=>{
  const m=new Model(),defs=m.create('bpmn:Definitions'),group=m.create('bpmn:Group');let id=0;
  for(const value of ['external:missing',false,0,[],m.create('bpmn:Task')]){group.categoryValueRef=value;assert.equal(planGroupCategory(group,defs,m,()=>++id),null);assert.equal(group.categoryValueRef,value);}
  assert.equal(id,0);
 });
}
test('actual pinned Group creation and copying establish independent category bindings',async()=>{
 const m=new Upstream({container:dom.createContainer()});try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));m.get('canvas').scrollToElement=()=>{};
  const modeling=m.get('modeling'),root=m.get('canvas').getRootElement();const group=modeling.createShape({type:'bpmn:Group'},{x:700,y:400},root);
  assert.equal(group.width,300);assert.equal(group.height,300);const value=group.businessObject.categoryValueRef;assert.ok(value.$instanceOf('bpmn:CategoryValue'));assert.ok(value.$parent.$instanceOf('bpmn:Category'));
  modeling.updateLabel(group,'Review');assert.equal(value.value,'Review');assert.ok(group.label);const tree=m.get('copyPaste').copy([group]);const copies=m.get('copyPaste').paste({tree,element:root,point:{x:900,y:700}}).filter(e=>e.type==='bpmn:Group'&&!e.labelTarget);
  assert.equal(copies.length,1);assert.notEqual(copies[0].businessObject.categoryValueRef,value);assert.notEqual(copies[0].businessObject.categoryValueRef.$parent,value.$parent);assert.equal(copies[0].businessObject.categoryValueRef.value,'Review');
 }finally{m.destroy();}
});
