import assert from 'node:assert/strict';
import { test,before,after } from 'node:test';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom,Modeler,getAppendOptions,getExecutableAppendOptions,ContextPadProvider;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));({getAppendOptions,getExecutableAppendOptions}=await dom.loadModule('/lib/modeling/AppendOptions.js'));({default:ContextPadProvider}=await dom.loadModule('/node_modules/.pnpm/bpmn-js@18.30.1/node_modules/bpmn-js/lib/features/context-pad/ContextPadProvider.js'));});
after(async()=>dom.cleanup());
async function editor(file='test/fixtures/bpmn/basic.bpmn',options={}){
 const callbacks=new WeakMap(),restore=[];
 const trace=target=>{const add=target.addEventListener,remove=target.removeEventListener;target.addEventListener=function(type,callback,opts){const list=callbacks.get(this)||[];list.push({type,callback,opts});callbacks.set(this,list);return add.call(this,type,callback,opts);};target.removeEventListener=function(type,callback,opts){callbacks.set(this,(callbacks.get(this)||[]).filter(value=>value.type!==type||value.callback!==callback));return remove.call(this,type,callback,opts);};restore.push(()=>{target.addEventListener=add;target.removeEventListener=remove;});};
 trace(dom.window.HTMLElement.prototype);trace(window);
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,...options});trace(m.getSvg());m.getSvg().getBoundingClientRect=m.getContainer().getBoundingClientRect;
 await m.importXML(await readFile(file,'utf8'));
 const call=async(node,type,extra={})=>{const ev={target:node,button:0,detail:1,clientX:400,clientY:200,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...extra};for(const {callback}of [...callbacks.get(node)||[]].filter(item=>item.type===type&&(!extra.handler||item.callback.name===extra.handler)))await callback.call(node,ev);};
 return{m,call,button:action=>m.getContainer().querySelector(`[data-action="${action}"]`),close(){m.destroy();restore.reverse().forEach(fn=>fn());}};
}
let artifact=0;
async function valid(m){const xml=await m.getXML();if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`ui-policy-${++artifact}.bpmn`),xml);}const parsed=await new BpmnModdle().fromXML(xml);assert.deepEqual(parsed.warnings,[]);return parsed;}

test('shape append catalogue matches pinned upstream action IDs and typed targets',()=>{
 const moddle=new BpmnModdle(),oracle=Object.create(ContextPadProvider.prototype);let captured;
 Object.assign(oracle,{_contextPad:{},_modeling:{},_elementFactory:{createShape:target=>target},_connect:{},_create:{start:(_,shape)=>{captured=shape;}},_popupMenu:{isEmpty:()=>true},_rules:{allowed:()=>true},_translate:text=>text,_appendPreview:{}});
 const variants=['Task','UserTask','ReceiveTask','CallActivity','SubProcess','StartEvent','EndEvent','IntermediateCatchEvent','IntermediateThrowEvent','EventBasedGateway','ExclusiveGateway','ParallelGateway','BoundaryEvent','Participant','Lane','DataObjectReference','DataStoreReference','TextAnnotation','Group','SequenceFlow','MessageFlow'].map(type=>({type:'bpmn:'+type}));
 variants.push({type:'bpmn:Task',isForCompensation:true},{type:'bpmn:SubProcess',triggeredByEvent:true},{type:'bpmn:IntermediateThrowEvent',definition:'Link'},{type:'bpmn:BoundaryEvent',definition:'Compensate'});
 for(const variant of variants){const {type,definition,...attrs}=variant,bo=moddle.create(type,attrs);if(definition)bo.eventDefinitions=[moddle.create(`bpmn:${definition}EventDefinition`)];const node={id:type,type,businessObject:bo,children:[],di:{isExpanded:true},x:100,y:100,width:100,height:80};
  const expected=Object.entries(oracle.getContextPadEntries(node)).filter(([id])=>id.startsWith('append.')).map(([id,value])=>{captured=null;value.action.click({},node);return{actionName:id,target:captured};});
  assert.deepEqual(getAppendOptions(node).map(({actionName,target})=>({actionName,target})),expected,JSON.stringify(variant));
 }
});

test('typed appends create exactly one valid connection and one atomic history entry',async()=>{
 const h=await editor(),{m}=h;
 try{
  const task=m.getElement('Task_1'),gateway=m.addShape('bpmn:EventBasedGateway',{x:600,y:400});
  const boundary=m.addShape('bpmn:BoundaryEvent',{x:task.x+task.width,y:task.y+task.height},{host:task,eventDefinitionType:'bpmn:CompensateEventDefinition'});
  for(const [source,action,type,definition]of [[task,'append.append-task','bpmn:Task'],[gateway,'append.receive-task','bpmn:ReceiveTask'],[gateway,'append.message-intermediate-event','bpmn:IntermediateCatchEvent','bpmn:MessageEventDefinition'],[gateway,'append.timer-intermediate-event','bpmn:IntermediateCatchEvent','bpmn:TimerEventDefinition'],[boundary,'append.compensation-activity','bpmn:Task']]){
   m.select(source.id);const before=await m.getXML(),size=m.commandStack.size(),ids=new Set(m.getGraph().nodes.map(node=>node.id));
   assert.ok(h.button(action));await h.call(h.button(action),'click');const created=m.getGraph().nodes.find(node=>!ids.has(node.id)&&node.type!=='label');assert.equal(created?.type,type);
   if(definition)assert.equal(created.businessObject.eventDefinitions[0].$type,definition);
   const edge=m.getGraph().edges.find(edge=>edge.source===source&&edge.target===created);assert.ok(edge);assert.equal(m.commandStack.size(),size+1);
   if(action==='append.compensation-activity'){assert.equal(created.businessObject.isForCompensation,true);assert.equal(edge.type,'bpmn:Association');assert.equal(edge.businessObject.associationDirection,'One');}
   const final=await m.getXML();await valid(m);m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),final);m.undo();
  }
 }finally{h.close();}
});

test('End, stale append controls, cancelled append and invalid cross-pool drop never create orphan shapes',async()=>{
 const h=await editor(),{m}=h;
 try{
  const source=m.addShape('bpmn:Task',{x:500,y:400});m.select(source.id);const stale=h.button('append.append-task');m.replace(source,'bpmn:EndEvent');m.select(source.id);assert.equal(h.button('append.append-task'),null);assert.ok(h.button('append.text-annotation'));assert.ok(m.getContainer().querySelector('button[title^="Connect"]'));
  let before=await m.getXML(),size=m.commandStack.size();await h.call(stale,'click');assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  m.replace(source,'bpmn:Task');m.select(source.id);let button=h.button('append.append-task');before=await m.getXML();size=m.commandStack.size();
  await h.call(button,'mousedown');await h.call(window,'mousemove',{clientX:600,clientY:400});m.cancel();await h.call(window,'mouseup',{target:button});await h.call(button,'click');assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.equal(document.querySelector('.bpmn-xyflow-append-ghost'),null);
  const p1=m.addShape('bpmn:Participant',{x:500,y:700}),p2=m.addShape('bpmn:Participant',{x:1200,y:700}),a=m.addShape('bpmn:Task',{x:500,y:700},{parent:p1});m.select(a.id);button=h.button('append.append-task');before=await m.getXML();size=m.commandStack.size();
  await h.call(button,'mousedown');await h.call(window,'mousemove',{clientX:p2.x+100,clientY:p2.y+100});await h.call(window,'mouseup',{clientX:p2.x+100,clientY:p2.y+100});assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 }finally{h.close();}
});

test('Back control survives failed import, switches independent histories, and cleans up on root import/destroy',async()=>{
 const h=await editor('test/fixtures/scenarios/order-payment-delivery.bpmn'),{m}=h;
 try{
  const back=h.button('navigate-back');assert.ok(back.hidden);m.updateLabel(m.getElement('ValidateOrder'),'Outer edit');await m.drillInto(m.getElement('Payment'));assert.equal(back.hidden,false);assert.equal(back.disabled,false);
  m.updateLabel(m.getElement('CapturePayment'),'Child edit');const child=await m.getXML(),history=m.commandStack.size();await assert.rejects(m.importXML('<invalid>'));assert.equal(back.hidden,false);assert.equal(back.disabled,false);assert.equal(await m.getXML(),child);assert.equal(m.commandStack.size(),history);
  const first=h.call(back,'click'),second=h.call(back,'click');await Promise.all([first,second]);assert.ok(back.hidden);assert.ok(m.getElement('Payment'));m.undo();assert.notEqual(m.getElement('ValidateOrder').businessObject.name,'Outer edit');
  await m.drillInto(m.getElement('Payment'));assert.equal(m.getElement('CapturePayment').businessObject.name,'Child edit');m.undo();assert.notEqual(m.getElement('CapturePayment').businessObject.name,'Child edit');m.redo();
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));assert.ok(back.hidden);assert.ok(back.disabled);await valid(m);
 }finally{h.close();assert.equal(document.querySelector('[data-action="navigate-back"]'),null);}
});

test('common-type controls hide empty replacement and impossible lane actions; Task resize stays explicit extension',async()=>{
 const h=await editor(),{m}=h;
 try{
  for(const type of ['bpmn:StartEvent','bpmn:EndEvent','bpmn:ExclusiveGateway','bpmn:DataObjectReference']){const node=m.addShape(type,{x:700,y:500});m.select(node.id);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null,type);}
  const task=m.getElement('Task_1');m.select(task.id);assert.equal(m.getContainer().querySelectorAll('.bpmn-xyflow-resize-handle').length,8);
  for(const type of ['bpmn:TextAnnotation','bpmn:Group']){const node=m.addShape(type,{x:900,y:500});m.select(node.id);assert.equal(m.getContainer().querySelector('button[title^="Change type"]'),null,type);if(type==='bpmn:TextAnnotation')assert.deepEqual([...m.getContainer().querySelectorAll('[data-resize-dir]')].map(node=>node.dataset.resizeDir),['e','w']);}
  const pool=m.addShape('bpmn:Participant',{x:500,y:800});m.resizeShape(pool,{x:pool.x,y:pool.y,width:40,height:35});m.select(pool.id);const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.getContainer().querySelector('button[title="Add lane before"]'),null);assert.equal(m.getContainer().querySelector('button[title="Split into two lanes"]'),null);assert.equal(m.addLane(pool),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  m.resizeShape(pool,{x:pool.x,y:pool.y,width:600,height:240});m.select(pool.id);assert.ok(m.getContainer().querySelector('button[title="Split into two lanes"]'));m.splitLane(pool,2);m.select(pool.id);assert.equal(m.getContainer().querySelector('button[title="Split into two lanes"]'),null);assert.equal(m.getContainer().querySelector('button[title="Split into three lanes"]'),null);
 }finally{h.close();}
});

test('flow annotation append is deferred in executable controls while node annotation remains atomic',async()=>{
 const h=await editor(),{m}=h;
 try{
  const task=m.getElement('Task_1'),edge=m.connect(task,m.addShape('bpmn:Task',{x:600,y:300}));
  const pool1=m.addShape('bpmn:Participant',{x:500,y:700}),pool2=m.addShape('bpmn:Participant',{x:1200,y:700}),message=m.connect(pool1,pool2);
  for(const flow of [edge,message]){
   assert.ok(getAppendOptions(flow).some(entry=>entry.actionName==='append.text-annotation'));
   assert.deepEqual(getExecutableAppendOptions(flow),[]);m.select(flow.id);
   const before=await m.getXML(),size=m.commandStack.size();assert.equal(h.button('append.text-annotation'),null);
   await h.call(m.getSvg(),'contextmenu',{target:m.getContainer().querySelector(`[data-element-id="${flow.id}"]`)});
   assert.equal([...m.getContainer().querySelectorAll('.bpmn-xyflow-context-menu > div')].some(row=>row.textContent==='Add text annotation'),false);
   m.cancel();assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  }
  m.select(task.id);const before=await m.getXML(),size=m.commandStack.size();assert.ok(h.button('append.text-annotation'));await h.call(h.button('append.text-annotation'),'click');
  const annotation=m.getGraph().nodes.find(node=>node.type==='bpmn:TextAnnotation'),association=m.getGraph().edges.find(value=>value.source===task&&value.target===annotation);assert.ok(association);assert.equal(association.type,'bpmn:Association');assert.equal(m.commandStack.size(),size+1);const appended=await m.getXML();await valid(m);
  m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),appended);
 }finally{h.close();}
});

test('unsafe compensation changes require explicit cleanup confirmation and undo exact affected topology',async()=>{
 const h=await editor(),{m}=h;
 try{
  const task=m.getElement('Task_1'),other=m.addShape('bpmn:Task',{x:650,y:400}),boundary=m.addShape('bpmn:BoundaryEvent',{x:task.x+task.width,y:task.y+task.height},{host:task,eventDefinitionType:'bpmn:TimerEventDefinition'});m.connect(boundary,other);
  const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.toggleMarker(task,'compensation'),false);assert.equal(m.updateProperties(task,{name:'Must not apply',isForCompensation:true}),false);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  const open=async()=>{await h.call(m.getSvg(),'contextmenu',{target:m.getContainer().querySelector(`[data-element-id="${task.id}"]`)});const row=[...m.getContainer().querySelectorAll('.bpmn-xyflow-context-menu > div')].find(node=>node.textContent==='Toggle compensation');assert.ok(row);await h.call(row,'click');};
  await open();let dialog=m.getContainer().querySelector('[role="dialog"][aria-label="Change compensation"]');assert.ok(dialog);await h.call([...dialog.querySelectorAll('button')].find(button=>button.textContent==='Cancel'),'click');assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  await open();dialog=m.getContainer().querySelector('[role="dialog"][aria-label="Change compensation"]');await h.call([...dialog.querySelectorAll('button')].find(button=>button.textContent.startsWith('Change compensation')),'click');
  assert.equal(task.businessObject.isForCompensation,true);assert.equal(m.getElement(boundary.id),null);assert.equal(m.getGraph().edges.filter(edge=>edge.source===task||edge.target===task).length,0);assert.equal(m.commandStack.size(),size+1);const changed=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),changed);}m.undo();
  const eventSub=m.addShape('bpmn:SubProcess',{x:800,y:600},{triggeredByEvent:true});const original=await m.getXML(),history=m.commandStack.size();assert.equal(m.toggleMarker(eventSub,'compensation'),false);assert.equal(m.toggleExpanded(eventSub),false);assert.equal(await m.getXML(),original);assert.equal(m.commandStack.size(),history);
 }finally{h.close();}
});

test('replacement entries use the real command preflight instead of silently closing on safety refusal',async()=>{
 const h=await editor(),{m}=h;
 try{
  const sub=m.addShape('bpmn:SubProcess',{x:650,y:500});m.addShape('bpmn:StartEvent',{x:560,y:500},{parent:sub});
  const event=m.addShape('bpmn:IntermediateCatchEvent',{x:900,y:300},{eventDefinitionType:'bpmn:MessageEventDefinition'}),data=m.addShape('bpmn:DataObjectReference',{x:1000,y:300});m.connect(event,data);
  for(const [node,action]of [[sub,'replace-with-event-subprocess'],[event,'replace-with-message-intermediate-throw']]){
   m.select(node.id);const before=await m.getXML(),size=m.commandStack.size();await h.call(m.getContainer().querySelector('button[title^="Change type"]'),'click');const row=h.button(action);assert.ok(row);
   if(node===sub){assert.equal(row.getAttribute('aria-disabled'),'true');assert.ok(row.title.includes('cannot be preserved'));await h.call(row,'click');assert.ok(row.isConnected);}
   else{assert.notEqual(row.getAttribute('aria-disabled'),'true');await h.call(row,'click');const dialog=m.getContainer().querySelector('[role="dialog"][aria-label="Replace and remove incompatible data"]');assert.ok(dialog);const cancel=[...dialog.querySelectorAll('button')].find(button=>button.textContent==='Cancel');assert.ok(cancel);await h.call(cancel,'click');assert.equal(dialog.isConnected,false);}
   assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  }
 }finally{h.close();}
});

test('imported separate connection labels hide at the editor location and restore on cancel',async()=>{
 const h=await editor('test/fixtures/bpmn/align-elements.bpmn'),{m}=h;
 try{
  const edge=m.getGraph().edges.find(edge=>edge.label),label=m.getContainer().querySelector(`[data-element-id="${edge.label.id}"]`),before=await m.getXML();
  label.getBoundingClientRect=()=>({left:700,top:600,right:790,bottom:630,width:90,height:30});
  await h.call(m.getSvg(),'dblclick',{handler:'onDblClick',target:m.getContainer().querySelector(`[data-element-id="${edge.id}"]`)});
  const editor=[...document.body.querySelectorAll('div')].find(node=>node.contentEditable==='plaintext-only');assert.ok(editor);assert.equal(label.style.display,'none');assert.equal(editor.style.left,'700px');assert.equal(editor.style.top,'600px');m.undo();assert.equal(editor.isConnected,false);assert.equal(label.style.display,'');assert.equal(await m.getXML(),before);
 }finally{h.close();}
});

test('keyboard moves use upstream1/10-unit modifiers and ignore Ctrl/Cmd and editable fields',async()=>{
 const h=await editor(),{m}=h;
 try{
  const task=m.getElement('Task_1'),start=task.x;m.select(task.id);
  await h.call(m.getContainer(),'keydown',{key:'ArrowRight',target:m.getSvg()});assert.equal(task.x,start+1);
  await h.call(m.getContainer(),'keydown',{key:'ArrowRight',shiftKey:true,target:m.getSvg()});assert.equal(task.x,start+11);
  const before=await m.getXML(),size=m.commandStack.size();
  for(const modifier of [{ctrlKey:true},{metaKey:true}])await h.call(m.getContainer(),'keydown',{key:'ArrowRight',target:m.getSvg(),...modifier});
  for(const tag of ['input','textarea','select']){const field=document.createElement(tag);m.getContainer().append(field);await h.call(m.getContainer(),'keydown',{key:'ArrowRight',target:field});field.remove();}
  await h.call(window,'keydown',{key:'ArrowRight',target:document.body});assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);m.undo();m.undo();assert.equal(task.x,start);
 }finally{h.close();}
});

test('compensation confirmation also removes hidden-plane boundaries and flow references with exact undo',async()=>{
 const h=await editor(),{m}=h;
 try{
  let task=m.getElement('Task_1');const other=m.addShape('bpmn:Task',{x:700,y:300}),boundary=m.addShape('bpmn:BoundaryEvent',{x:task.x+task.width,y:task.y+task.height},{host:task,eventDefinitionType:'bpmn:TimerEventDefinition'}),out=m.connect(boundary,other),incoming=m.connect(other,task),ids=[boundary.id,out.id,incoming.id];
  const defs=m.getDefinitions(),moddle=m.getModdle(),main=defs.diagrams[0].plane,plane=moddle.create('bpmndi:BPMNPlane',{id:'HiddenReviewPlane',bpmnElement:main.bpmnElement,planeElement:[]}),diagram=moddle.create('bpmndi:BPMNDiagram',{id:'HiddenReviewDiagram',plane});plane.$parent=diagram;diagram.$parent=defs;defs.diagrams.push(diagram);
  for(const id of ids){const di=main.planeElement.find(di=>di.bpmnElement.id===id);main.planeElement.splice(main.planeElement.indexOf(di),1);plane.planeElement.push(di);di.$parent=plane;}
  await m.importXML(await m.getXML());task=m.getElement('Task_1');assert.equal(m.getElement(boundary.id),null);const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.toggleMarker(task,'compensation'),false);assert.equal(await m.getXML(),before);
  await h.call(m.getSvg(),'contextmenu',{target:m.getContainer().querySelector(`[data-element-id="${task.id}"]`)});await h.call([...m.getContainer().querySelectorAll('.bpmn-xyflow-context-menu > div')].find(node=>node.textContent==='Toggle compensation'),'click');
  const dialog=m.getContainer().querySelector('[aria-label="Change compensation"]');await h.call([...dialog.querySelectorAll('button')].find(button=>button.textContent.startsWith('Change compensation')),'click');
  const parsed=await valid(m);for(const id of ids)assert.equal(parsed.elementsById[id],undefined);assert.equal(m.commandStack.size(),size+1);m.undo();assert.equal(await m.getXML(),before);
 }finally{h.close();}
});

test('deleting imported labels preserves absent or dormant label DI instead of fitting empty text',async()=>{
 const h=await editor('test/fixtures/scenarios/approval-rejection-rework.bpmn'),{m}=h;
 try{
  for(const id of ['ApprovedEnd','ApprovalDecision','ApproveFlow']){
   const node=m.getElement(id),label=node.label,oldDi=node.di.label,oldName=node.businessObject.name,before=await m.getXML();assert.ok(label);node.businessObject.name='';const expected=await m.getXML();node.businessObject.name=oldName;
   m.delete(label);assert.equal(node.di.label,oldDi);assert.equal(await m.getXML(),expected);m.undo();assert.equal(await m.getXML(),before);assert.ok(node.label);await valid(m);
  }
 }finally{h.close();}
});

test('native-transition drop into an empty participant is an exact cancellation',async()=>{
 const h=await editor('test/fixtures/scenarios/order-payment-delivery.bpmn'),{m}=h;
 try{
  const task=m.getElement('SubmitOrder'),empty=m.addShape('bpmn:Participant',{x:1450,y:1300},{isExpanded:false});assert.ok(empty);m.setViewport({x:0,y:0,zoom:1});const before=await m.getXML(),size=m.commandStack.size();
  await h.call(m.getSvg(),'mousedown',{handler:'onMouseDown',target:m.getContainer().querySelector(`[data-element-id="${task.id}"]`),clientX:task.x+task.width/2,clientY:task.y+task.height/2});
  await h.call(window,'mousemove',{handler:'onMouseMove',clientX:1450,clientY:1300});await h.call(window,'mouseup',{handler:'onMouseUp',clientX:1450,clientY:1300});
  assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 }finally{h.close();}
});

test('splitting a process-only lane assigns semantic members even without initial graph containment',async()=>{
 const h=await editor('test/fixtures/scenarios/approval-rejection-rework.bpmn'),{m}=h;
 try{
  const lane=m.getElement('ReviewerLane'),before=await m.getXML(),size=m.commandStack.size(),ids=['ReviewRequest','ApprovalDecision','ApprovedEnd'];
  assert.equal(lane.children.length,0);const children=m.splitLane(lane,2);assert.equal(children.length,2);
  for(const id of ids){const node=m.getElement(id);assert.equal(children.filter(child=>child.businessObject.flowNodeRef.includes(node.businessObject)).length,1);assert.ok(children.includes(node.parent));assert.equal(node.businessObject.$parent.id,'ApprovalProcess');}
  assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
 }finally{h.close();}
});

test('boundary reattachment keeps the grabbed drop point instead of unrelated alignment snapping',async()=>{
 const h=await editor('test/fixtures/scenarios/booking-timeout-compensation.bpmn'),{m}=h;const oldHit=document.elementsFromPoint;
 try{
  m.setViewport({x:150,y:100,zoom:.9});const node=m.getElement('FlightTimeout'),host=m.getElement('ReserveHotel'),before=await m.getXML(),size=m.commandStack.size();
  const screen=p=>({clientX:150+p.x*.9,clientY:100+p.y*.9}),drop=screen({x:480,y:260});
  document.elementsFromPoint=()=>[m.getContainer().querySelector(`[data-element-id="${host.id}"]`)];
  const start=()=>h.call(m.getSvg(),'mousedown',{handler:'onMouseDown',target:m.getContainer().querySelector(`[data-element-id="${node.id}"]`),...screen({x:node.x+18,y:node.y+18})});
  await start();await h.call(window,'mousemove',{handler:'onMouseMove',...drop});m.cancel();assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  await start();await h.call(window,'mousemove',{handler:'onMouseMove',...drop});await h.call(window,'mouseup',{handler:'onMouseUp',...drop});
  assert.equal(node.host,host);assert.deepEqual({x:node.x+18,y:node.y+18},{x:480,y:260});assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
  document.elementsFromPoint=()=>[];await start();const outside=screen({x:1300,y:800});await h.call(window,'mousemove',{handler:'onMouseMove',...outside});await h.call(window,'mouseup',{handler:'onMouseUp',...outside});assert.equal(await m.getXML(),after);assert.equal(m.commandStack.size(),size+1);
 }finally{document.elementsFromPoint=oldHit;h.close();}
});
