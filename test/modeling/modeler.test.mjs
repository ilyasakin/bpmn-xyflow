import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setupDOM } from '../helpers/dom.mjs';
import { connectAuthoredIO } from '../helpers/authored-io.mjs';
import { assertScenario } from '../helpers/assert-scenarios.mjs';
import { BpmnModdle as Oracle } from 'bpmn-moddle';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(async () => { await dom.cleanup(); });
async function model(file = 'test/fixtures/bpmn/basic.bpmn') {
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false });
  await m.importXML(await readFile(file, 'utf8'));
  return m;
}
let artifactIndex = 0;
async function oracle(m) {
  const xml = await m.getXML();
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `modeler-${++artifactIndex}.bpmn`), xml);
  }
  const parsed = await new Oracle().fromXML(xml);
  assert.equal(parsed.warnings.length, 0, parsed.warnings.map(w => w.message).join('\n'));
  return parsed;
}
function geometry(m) { return m.getGraph().nodes.filter(n => n.type !== 'label').map(n => [n.id,n.x,n.y,n.width,n.height]); }
test('creation links, undo selection cleanup, redo and export', async () => {
  const m = await model();
  const node = m.addShape('bpmn:Task', {x:450,y:250});
  assert.ok(node.parent.children.includes(node));
  m.select(node.id);
  assert.ok(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'));
  m.undo();
  assert.deepEqual(m.getSelection(), []);
  assert.equal(m.getContainer().querySelector('.bpmn-xyflow-context-pad'), null);
  assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'), null);
  m.redo();
  assert.equal(m.getElement(node.id), node);
  await oracle(m); m.destroy();
});
test('container movement, internal bends, resize, undo and repeated redo are exact', async () => {
  const m = await model();
  const parent = m.addShape('bpmn:SubProcess', {x:600,y:500});
  const a = m.addShape('bpmn:Task', {x:530,y:500}, {parent});
  const b = m.addShape('bpmn:Task', {x:680,y:500}, {parent});
  const edge = m.connect(a,b);
  m.updateWaypoints(edge,[{x:580,y:500},{x:600,y:450},{x:630,y:500}]);
  const before = geometry(m), points = edge.waypoints.map(p=>({...p}));
  m.moveShapes([parent,a],{x:70,y:30});
  assert.equal(a.x,480+70);
  assert.deepEqual(edge.waypoints, points.map(p=>({x:p.x+70,y:p.y+30})));
  for(let i=0;i<3;i++){ m.undo(); assert.deepEqual(geometry(m),before); assert.deepEqual(edge.waypoints,points); m.redo(); }
  const moved = geometry(m);
  m.resizeShape(parent,{x:parent.x-25,y:parent.y-20,width:parent.width+80,height:parent.height+40});
  m.undo(); assert.deepEqual(geometry(m),moved); m.redo();
  await oracle(m); m.destroy();
});
test('semantic hierarchy, task metadata, labels and custom bends survive copy/paste', async () => {
  const m = await model();
  const sub = m.addShape('bpmn:SubProcess',{x:700,y:500});
  const a = m.addShape('bpmn:ScriptTask',{x:640,y:500},{parent:sub});
  const b = m.addShape('bpmn:EndEvent',{x:810,y:500},{parent:sub});
  a.businessObject.script='performPayment()'; a.businessObject.scriptFormat='javascript';
  m.toggleMarker(a,'sequentialMI'); m.updateLabel(b,'Done');
  const edge=m.connect(a,b); m.updateLabel(edge,'paid');
  m.updateWaypoints(edge,[{x:690,y:500},{x:740,y:470},{x:792,y:500}]);
  const before=m.getGraph().nodes.length;
  m.copy([sub]); const pasted=m.paste({x:1100,y:800});
  const sub2=pasted.find(n=>n.type==='bpmn:SubProcess');
  const a2=pasted.find(n=>n.type==='bpmn:ScriptTask');
  const b2=pasted.find(n=>n.type==='bpmn:EndEvent');
  assert.equal(a2.parent,sub2); assert.equal(a2.businessObject.$parent,sub2.businessObject);
  assert.equal(a2.businessObject.script,'performPayment()');
  assert.equal(a2.businessObject.loopCharacteristics.isSequential,true);
  assert.equal(b2.businessObject.name,'Done'); assert.ok(b2.label);
  const edge2=m.getGraph().edges.find(e=>e.source===a2);
  assert.equal(edge2.waypoints.length,3); assert.equal(edge2.businessObject.name,'paid');
  assert.notEqual(a2.id,a.id);
  m.undo(); assert.equal(m.getGraph().nodes.length,before);
  m.redo(); assert.equal(m.getElement(a2.id),a2);
  const parsed=await oracle(m); assert.ok(parsed.elementsById[a2.id]); m.destroy();
});
test('pools, lanes, data associations, deletion and undo maintain semantic ownership', async () => {
  const m=await model();
  const pool=m.addShape('bpmn:Participant',{x:600,y:400});
  const lane=m.addShape('bpmn:Lane',{x:600,y:400},{parent:pool});
  const task=m.addShape('bpmn:Task',{x:600,y:400},{parent:lane});
  const data=m.addShape('bpmn:DataObjectReference',{x:740,y:400},{parent:lane});
  assert.ok(lane.businessObject.flowNodeRef.includes(task.businessObject));
  const input=m.connect(data,task), output=m.connect(task,data);
  assert.equal(input.businessObject.$parent,task.businessObject);
  assert.equal(input.businessObject.targetRef.$type,'bpmn:Property');
  assert.equal(input.businessObject.targetRef.name,'__targetRef_placeholder');
  assert.ok(task.businessObject.properties.includes(input.businessObject.targetRef));
  assert.equal(output.businessObject.sourceRef,undefined);
  assert.equal(task.businessObject.ioSpecification,undefined);
  await oracle(m);
  m.delete(pool); assert.equal(m.getElement(task.id),null); assert.equal(pool.businessObject.$parent.participants.includes(pool.businessObject),false);
  m.undo(); assert.equal(m.getElement(task.id),task); assert.ok(lane.businessObject.flowNodeRef.includes(task.businessObject));
  await oracle(m); m.destroy();
});
test('reconnect morphs the actual semantic object and owner, undo restores default refs', async()=>{
  const m=await model();
  const p1=m.addShape('bpmn:Participant',{x:500,y:400});
  const p2=m.addShape('bpmn:Participant',{x:1200,y:400});
  const a=m.addShape('bpmn:Task',{x:400,y:400},{parent:p1});
  const b=m.addShape('bpmn:Task',{x:600,y:400},{parent:p1});
  const c=m.addShape('bpmn:Task',{x:1200,y:400},{parent:p2});
  const edge=m.connect(a,b); const original=edge.businessObject; a.businessObject.default=original;
  m.reconnect(edge,'target',c);
  assert.equal(edge.businessObject.$type,'bpmn:MessageFlow');
  assert.ok(edge.businessObject.$parent.messageFlows.includes(edge.businessObject));
  assert.equal(a.businessObject.outgoing.includes(original),false);
  await oracle(m); m.undo();
  assert.equal(edge.businessObject,original); assert.equal(a.businessObject.default,original);
  assert.equal(edge.target,b); m.redo(); await oracle(m); m.destroy();
});
test('import clears selection, gestures and navigation history', async()=>{
  const m=await model(); const a=m.addShape('bpmn:Task',{x:300,y:400});m.select(a.id);
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  assert.deepEqual(m.getSelection(),[]);assert.equal(m.canUndo(),false);assert.equal(m.canNavigateBack(),false);
  assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null);m.destroy();
});

test('copying an individual task omits external topology and rejects orphan boundary copy', async()=>{
  const m=await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn');
  const task=m.getElement('ReserveFlight'), boundary=m.getElement('FlightTimeout');
  m.copy([task]); const nodes=m.paste({x:1800,y:600},task.parent);
  const copied=nodes.find(n=>n.type===task.type);
  assert.deepEqual(copied.businessObject.incoming,[]);assert.deepEqual(copied.businessObject.outgoing,[]);
  assert.ok(nodes.some(n=>n.host===copied));
  m.copy([boundary]);assert.deepEqual(m.paste({x:2200,y:600}),[]);
  await oracle(m);m.destroy();
});

test('replace retains execution metadata, lane refs, host refs, DI labels and exact undo',async()=>{
  const m=await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn');
  const task=m.getElement('ReserveFlight'), old=task.businessObject;
  m.toggleMarker(task,'sequentialMI');
  m.updateProperties(task,{'vendor:priority':'high'});
  m.replace(task,'bpmn:ServiceTask');
  assert.equal(task.businessObject.loopCharacteristics.isSequential,true);
  assert.equal(task.businessObject.get('vendor:priority'),'high');
  assert.equal(m.getElement('FlightTimeout').businessObject.attachedToRef,task.businessObject);
  m.undo(); assert.equal(task.businessObject,old);
  assert.equal(m.getElement('FlightTimeout').businessObject.attachedToRef,old);
  // Unknown prefix intentionally is not serializable without a declared namespace.
  m.updateProperties(task,{'vendor:priority':undefined});
  await oracle(m);m.destroy();
});

test('cancelled move and resize restore all descendants, labels and routes without history entries',async()=>{
  const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
  const node=m.getElement('Payment'); const before=geometry(m), xml=await m.getXML();
  const history=m.commandStack.size();
  const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
  const gfx=m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
  gfx.dispatchEvent(mouse('mousedown',node.x+20,node.y+20));
  window.dispatchEvent(mouse('mousemove',node.x+80,node.y+65));
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
  window.dispatchEvent(mouse('mouseup',node.x+80,node.y+65));
  assert.deepEqual(geometry(m),before);assert.equal(m.commandStack.size(),history);assert.equal(await m.getXML(),xml);
  m.select(node.id);
  const handle=m.getContainer().querySelector('[data-resize-dir="nw"]');
  handle.dispatchEvent(mouse('mousedown',node.x,node.y));
  window.dispatchEvent(mouse('mousemove',node.x-30,node.y-35));
  m.cancel();window.dispatchEvent(mouse('mouseup',node.x-30,node.y-35));
  assert.deepEqual(geometry(m),before);assert.equal(m.commandStack.size(),history);assert.equal(await m.getXML(),xml);
  m.destroy();
});

test('pool/lane deletion leaves no duplicate ghosts across repeated undo/redo',async()=>{
  const m=await model('test/fixtures/scenarios/approval-rejection-rework.bpmn');
  const lane=m.getElement('ReviewerLane'), before=await m.getXML(), count=m.getGraph().nodes.length;
  m.delete(lane);
  for(let i=0;i<3;i++){m.undo();assert.equal(m.getGraph().nodes.length,count);assert.equal(await m.getXML(),before);m.redo();}
  m.undo();await oracle(m);m.destroy();
});

for(const scenario of ['order-payment-delivery','approval-rejection-rework','booking-timeout-compensation']){
  test(`real BPMN scenario ${scenario}: edit, undo/redo, independent export and reopen`,async()=>{
    const m=await model(`test/fixtures/scenarios/${scenario}.bpmn`);
    assertScenario(scenario,m.getDefinitions());
    const task=m.getGraph().nodes.find(node=>node.businessObject.$instanceOf('bpmn:Task')&&!node.hidden);
    const oldName=task.businessObject.name, original=geometry(m);
    m.moveShape(task,{x:20,y:15});m.updateLabel(task,oldName+' checked');
    m.undo();m.undo();assert.deepEqual(geometry(m),original);assert.equal(task.businessObject.name,oldName);
    m.redo();m.redo();
    const parsed=await oracle(m);assertScenario(scenario,parsed.rootElement);
    const exported=await m.getXML();await m.importXML(exported);assertScenario(scenario,m.getDefinitions());
    assert.equal(m.getElement(task.id).businessObject.name,oldName+' checked');
    m.destroy();
  });
}
test('retained real HR recruitment model imports, edits and independently reopens',async()=>{
  const m=await model('test/fixtures/bpmn/complex.bpmn');
  const task=m.getGraph().nodes.find(n=>n.businessObject.$instanceOf('bpmn:Task')&&!n.hidden);
  assert.ok(task);const original=task.businessObject.name;
  m.updateLabel(task,original+' reviewed');m.undo();assert.equal(task.businessObject.name,original);m.redo();
  const baseline=await new Oracle().fromXML(await readFile('test/fixtures/bpmn/complex.bpmn','utf8'));
  const xml=await m.getXML();const parsed=await new Oracle().fromXML(xml);
  assert.deepEqual(parsed.warnings.map(w=>w.message),baseline.warnings.map(w=>w.message));
  await m.importXML(xml);
  assert.equal(m.getElement(task.id).businessObject.name,original+' reviewed');m.destroy();
});
test('deleting a named imported connection removes and restores its external label atomically',async()=>{
 const m=await model('test/fixtures/bpmn/align-elements.bpmn');
 const edge=m.getGraph().edges.find(e=>e.label),label=edge.label;
 assert.ok(label);const count=m.commandStack.size();m.delete(edge);
 assert.equal(m.getElement(edge.id),null);assert.equal(m.getElement(label.id),null);
 assert.equal(m.getContainer().querySelector(`[data-element-id="${label.id}"]`),null);
 assert.equal(m.commandStack.size(),count+1);
 m.undo();assert.equal(m.getElement(edge.id),edge);assert.equal(m.getElement(label.id),label);assert.equal(edge.label,label);
 m.redo();assert.equal(m.getElement(label.id),null);m.undo();await oracle(m);m.destroy();
});
test('modeling rejects stale objects, duplicate IDs, invalid bounds and foreign default flows',async()=>{
 const m=await model();const a=m.addShape('bpmn:Task',{x:300,y:200}),b=m.addShape('bpmn:Task',{x:450,y:200});
 const edge=m.connect(a,b),count=m.commandStack.size();
 assert.equal(m.addShape('bpmn:Task',{x:1,y:1},{businessObject:m.getModdle().create('bpmn:Task',{id:a.id})}),null);
 assert.equal(m.addShape('bpmn:Task',{x:NaN,y:1}),null);assert.equal(m.resizeShape(a,{x:1,y:1,width:-1,height:10}),false);
 assert.equal(m.updateProperties(a,{id:'Renamed'}),false);assert.equal(m.updateProperties(b,{default:edge}),false);
 assert.equal(m.replace(a,'bpmn:UserTask',{id:'Renamed'}),null);assert.equal(m.commandStack.size(),count);
 await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
 assert.equal(m.moveShape(a,{x:1,y:1}),false);assert.equal(m.connect(a,b),null);assert.equal(m.updateProperties(a,{name:'stale'}),false);
 assert.equal(m.canUndo(),false);m.destroy();
});
test('imported connection label rename/reconnect/undo keeps visible text and semantic identity',async()=>{
 const m=await model('test/fixtures/bpmn/align-elements.bpmn');
 const edge=m.getGraph().edges.find(e=>e.label), label=edge.label,oldName=edge.businessObject.name;
 m.updateLabel(edge,'New connection name');
 assert.equal(edge.label,label);assert.equal(label.businessObject,edge.businessObject);
 assert.match(m.getContainer().querySelector(`[data-element-id="${label.id}"]`).textContent,/New connection name/);
 m.undo();assert.equal(edge.businessObject.name,oldName);assert.equal(label.text,oldName);
 const node=m.addShape('bpmn:Task',{x:800,y:300},{parent:edge.target.parent});
 m.reconnect(edge,'target',node);assert.equal(edge.label.businessObject,edge.businessObject);
 m.undo();assert.equal(edge.label.businessObject,edge.businessObject);
 await oracle(m);m.destroy();
});
test('subprocess drill-in displays existing contents and preserves independent history on back/reentry',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
 const outer=m.getElement('ValidateOrder'),sub=m.getElement('Payment');
 m.updateLabel(outer,'Validated outside');
 const originalOuter=m.getGraph();
 assert.equal(await m.drillInto(sub),true);
 const child=m.getElement('CapturePayment');assert.ok(child);assert.equal(child.hidden,false);
 assert.ok(!m.getElement('BuyerPool'));assert.ok(!m.getElement('ValidateOrder'));
 const oldName=child.businessObject.name,original={x:child.x,y:child.y};
 m.updateLabel(child,'Captured inside');m.moveShape(child,{x:25,y:20});m.undo();
 assert.equal(m.canRedo(),true);
 assert.equal(await m.navigateBack(),true);assert.equal(m.getGraph(),originalOuter);
 assert.equal(m.getElement('CapturePayment').businessObject.name,'Captured inside');
 m.undo();assert.equal(outer.businessObject.name,'Validate order');m.redo();
 await m.drillInto(m.getElement('Payment'));
 assert.equal(m.getElement('CapturePayment'),child);assert.equal(m.canRedo(),true);
 m.redo();assert.equal(child.x,original.x+25);m.undo();m.undo();assert.equal(child.businessObject.name,oldName);
 m.redo();m.redo();
 await m.navigateBack();
 const xml=await m.getXML();await oracle(m);await m.importXML(xml);
 await m.drillInto(m.getElement('Payment'));assert.equal(m.getElement('CapturePayment').businessObject.name,'Captured inside');
 assert.equal(m.getElement('CapturePayment').x,original.x+25);m.destroy();
});
test('horizontal lanes split, add before/after and delete/rebalance with exact undo',async()=>{
 const m=await model('test/fixtures/scenarios/approval-rejection-rework.bpmn');
 const pool=m.addShape('bpmn:Participant',{x:500,y:350},{width:1000,height:600}), before=await m.getXML();
 const lanes=m.splitLane(pool,3);assert.equal(lanes.length,3);
 assert.equal(lanes.reduce((sum,lane)=>sum+lane.height,0),pool.height);
 assert.ok(lanes.every(lane=>lane.x===pool.x+30&&lane.width===pool.width-30));
 for(const lane of lanes) for(const child of lane.children.filter(n=>n.businessObject.$instanceOf('bpmn:FlowNode'))) assert.ok(lane.businessObject.flowNodeRef.includes(child.businessObject));
 m.undo();assert.equal(await m.getXML(),before);m.redo();
 const middle=lanes[1],originY=middle.y,poolHeight=pool.height;
 const added=m.addLane(middle,'before');assert.equal(added.y,originY-120);assert.equal(added.height,120);assert.equal(middle.y,originY);assert.equal(pool.height,poolHeight+120);
 const state=await m.getXML();m.deleteLane(added);assert.equal(pool.height,poolHeight+120);
 assert.equal(lanes[0].y+lanes[0].height,middle.y);
 m.undo();assert.equal(await m.getXML(),state);m.undo();assert.equal(pool.height,poolHeight);m.redo();
 const after=m.addLane(middle,'after');assert.equal(after.y,middle.y+middle.height);
 await oracle(m);m.destroy();
});
test('vertical and nested lane membership survives split/add/rebalance and reopening',async()=>{
 const m=await model('test/fixtures/bpmn/collaboration-vertical.bpmn');
 const pool=m.getGraph().nodes.find(n=>n.type==='bpmn:Participant'&&n.businessObject.processRef);
 assert.ok(pool);const base=await m.getXML();
 const existing=(pool.children||[]).filter(n=>n.type==='bpmn:Lane').length;
 const lanes=m.splitLane(pool,Math.max(2,existing));assert.ok(lanes);
 assert.ok(lanes.every(lane=>lane.di.isHorizontal===false));
 assert.equal(lanes.reduce((sum,lane)=>sum+lane.width,0),pool.width);
 const nested=m.splitLane(lanes[0],2);assert.ok(nested.every(lane=>lane.businessObject.$parent===lanes[0].businessObject.childLaneSet));
 m.undo();m.undo();assert.equal(await m.getXML(),base);m.redo();m.redo();
 const sibling=m.addLane(nested[0],'after');assert.equal(sibling.x,nested[0].x+nested[0].width);
 await oracle(m);const xml=await m.getXML();await m.importXML(xml);assert.ok(m.getElement(sibling.id));m.destroy();
});
test('space expands intersected containers and moves each descendant/label/waypoint once with exact undo',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
 const pool=m.getElement('SellerPool'),task=m.getElement('ShipOrder'),sub=m.getElement('Payment');
 const original=await m.getXML(),taskX=task.x,poolW=pool.width,subW=sub.width;
 const plan=m.createSpace(null,'horizontal',500,100);assert.ok(plan.resizingShapes.includes(pool));assert.ok(plan.resizingShapes.includes(sub));
 assert.equal(pool.width,poolW+100);assert.equal(sub.width,subW+100);assert.equal(task.x,taskX+100);
 m.undo();assert.equal(await m.getXML(),original);m.redo();await oracle(m);m.destroy();
});
test('inserting a new or existing task preserves source default/condition and restores exact topology',async()=>{
 const m=await model('test/fixtures/scenarios/approval-rejection-rework.bpmn');
 const edge=m.getElement('ApproveFlow'),target=edge.target,condition=edge.businessObject.conditionExpression.body;
 const start=await m.getXML();
 const inserted=m.insertShape('bpmn:Task',edge);assert.ok(inserted);
 assert.equal(edge.target,inserted);assert.equal(edge.businessObject.conditionExpression.body,condition);
 const continuation=m.getGraph().edges.find(e=>e.source===inserted&&e.target===target);assert.ok(continuation);assert.equal(continuation.businessObject.conditionExpression,undefined);
 m.undo();assert.equal(await m.getXML(),start);m.redo();await oracle(m);
 const reject=m.getElement('RejectFlow'),gateway=reject.source;
 const existing=m.addShape('bpmn:UserTask',{x:800,y:100},{parent:reject.target.parent});
 m.insertShape(existing,reject,{x:650,y:300});
 assert.equal(gateway.businessObject.default,reject.businessObject);assert.equal(reject.target,existing);
 m.undo();assert.equal(gateway.businessObject.default,reject.businessObject);assert.notEqual(reject.target,existing);
 m.redo();await oracle(m);assert.equal(m.insertShape('bpmn:StartEvent',edge),null);m.destroy();
});
test('copying cross-pool tasks omits message flows; copying both participants preserves them',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
 const send=m.getElement('SubmitOrder'),receive=m.getElement('OrderReceived'),buyer=m.getElement('BuyerPool'),seller=m.getElement('SellerPool');
 m.copy([send,receive]);const tasks=m.paste({x:800,y:120},buyer);assert.equal(tasks.length,2);
 const copiedIds=new Set(tasks.map(n=>n.id));assert.ok(!m.getGraph().edges.some(e=>e.type==='bpmn:MessageFlow'&&(copiedIds.has(e.source.id)||copiedIds.has(e.target.id))));
 m.undo();m.copy([buyer,seller]);const copied=m.paste({x:2500,y:500});
 const pools=copied.filter(n=>n.type==='bpmn:Participant');assert.equal(pools.length,2);
 const processIds=new Set(pools.map(n=>n.businessObject.processRef.id));
 const messages=m.getGraph().edges.filter(e=>e.type==='bpmn:MessageFlow'&&processIds.has(e.source.businessObject.$parent.id));
 assert.equal(messages.length,2);await oracle(m);m.destroy();
});
test('deleting a drilled child cleans all referencing DI and invisible edges across sibling planes',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
 await m.drillInto(m.getElement('Payment'));const child=m.getElement('CapturePayment');
 const before=await m.getXML();m.delete(child);
 assert.ok(m.getDefinitions().diagrams.every(diagram=>!diagram.plane.planeElement.some(di=>di.bpmnElement.id==='CapturePayment'||di.bpmnElement.id==='PaymentFlow1'||di.bpmnElement.id==='PaymentFlow2')));
 await oracle(m);m.undo();assert.equal(await m.getXML(),before);
 await m.navigateBack();m.delete(m.getElement('Payment'));
 assert.ok(!m.getDefinitions().diagrams.some(diagram=>diagram.plane.bpmnElement.id==='Payment'));
 await oracle(m);m.undo();await m.drillInto(m.getElement('Payment'));assert.ok(m.getElement('CapturePayment'));m.destroy();
});
test('palette/shape flow-insertion gestures are undoable, repeatable and cancel cleanly',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:true});
 await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
 const a=m.addShape('bpmn:Task',{x:250,y:300}),b=m.addShape('bpmn:Task',{x:700,y:300}),edge=m.connect(a,b);
 const original=m.getGraph().nodes.length,history=m.commandStack.size();
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 const taskButton=[...m.getContainer().querySelectorAll('.bpmn-xyflow-palette button')].find(button=>button.textContent==='+ Task');
 taskButton.dispatchEvent(mouse('mousedown',10,10));window.dispatchEvent(mouse('mousemove',400,300));
 window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));window.dispatchEvent(mouse('mouseup',400,300));
 assert.equal(m.getGraph().nodes.length,original);assert.equal(m.commandStack.size(),history);assert.equal(document.querySelector('.bpmn-xyflow-palette-ghost'),null);
 const oldHitTest=document.elementsFromPoint;
 document.elementsFromPoint=()=>[m.getContainer().querySelector(`[data-element-id="${edge.id}"]`)];
 try{
  taskButton.dispatchEvent(mouse('mousedown',10,10));window.dispatchEvent(mouse('mousemove',400,300));window.dispatchEvent(mouse('mouseup',400,300));
  assert.equal(m.getGraph().nodes.length,original+1);assert.equal(m.commandStack.size(),history+1);assert.notEqual(edge.target,b);
  m.undo();assert.equal(edge.target,b);assert.equal(m.getGraph().nodes.length,original);
  const existing=m.addShape('bpmn:Task',{x:400,y:550});const oldY=existing.y;
  m.getContainer().querySelector(`[data-element-id="${existing.id}"]`).dispatchEvent(mouse('mousedown',400,550));
  window.dispatchEvent(mouse('mousemove',400,300));window.dispatchEvent(mouse('mouseup',400,300));
  assert.equal(edge.target,existing);m.undo();assert.equal(edge.target,b);assert.equal(existing.y,oldY);
 }finally{document.elementsFromPoint=oldHitTest;}
 await oracle(m);m.destroy();
});
test('invalid endpoint reconnect cancels without an undocked route or extra undo entry',async()=>{
 const m=await model();const a=m.addShape('bpmn:Task',{x:250,y:300}),b=m.addShape('bpmn:Task',{x:650,y:300});
 const end=m.addShape('bpmn:EndEvent',{x:400,y:550}),edge=m.connect(a,b);m.select(edge.id);
 const before=await m.getXML(),history=m.commandStack.size(),oldHitTest=document.elementsFromPoint;
 document.elementsFromPoint=()=>[m.getContainer().querySelector(`[data-element-id="${end.id}"]`)];
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 try{
  m.getContainer().querySelector('[data-bend-index="0"]').dispatchEvent(mouse('mousedown',edge.waypoints[0].x,edge.waypoints[0].y));
  window.dispatchEvent(mouse('mousemove',400,550));window.dispatchEvent(mouse('mouseup',400,550));
  assert.equal(edge.source,a);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),history);
 }finally{document.elementsFromPoint=oldHitTest;}
 m.destroy();
});
test('rename initially unnamed connection then delete/undo renders exactly one label',async()=>{
 const m=await model();const a=m.addShape('bpmn:Task',{x:250,y:300}),b=m.addShape('bpmn:Task',{x:650,y:300}),edge=m.connect(a,b);
 const count=()=>[...m.getContainer().querySelectorAll('text')].filter(text=>text.textContent==='Conditional flow').length;
 m.updateLabel(edge,'Conditional flow');assert.equal(count(),1);
 for(let i=0;i<3;i++){m.delete(edge);assert.equal(count(),0);m.undo();assert.equal(count(),1);}
 m.destroy();
});
test('dragging imported external labels preserves host bounds and exactly restores label DI on undo/cancel',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');const node=m.getElement('PaymentEnd'),label=node.label;
 const before=await m.getXML(),hostBounds={...node.di.bounds};
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 const drag=()=>{const gfx=m.getContainer().querySelector(`[data-element-id="${label.id}"]`);gfx.dispatchEvent(mouse('mousedown',label.x+5,label.y+5));window.dispatchEvent(mouse('mousemove',label.x+45,label.y+35));};
 drag();m.cancel();assert.equal(await m.getXML(),before);assert.deepEqual({...node.di.bounds},hostBounds);
 drag();window.dispatchEvent(mouse('mouseup',label.x+45,label.y+35));assert.deepEqual({...node.di.bounds},hostBounds);assert.ok(node.di.label.bounds);
 m.undo();assert.equal(await m.getXML(),before);m.redo();await oracle(m);m.destroy();
});
test('child additions mirror into expanded parent while existing view coordinates stay independent',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn');
 const originalOuterX=m.getElement('CapturePayment').x;
 await m.drillInto(m.getElement('Payment'));const child=m.getElement('CapturePayment');
 m.moveShape(child,{x:40,y:20});const childX=child.x;
 const added=m.addShape('bpmn:Task',{x:590,y:520});const edge=m.connect(child,added);
 assert.ok(added&&edge);await m.navigateBack();
 assert.ok(m.getElement(added.id));assert.ok(m.getElement(edge.id));assert.equal(m.getElement('CapturePayment').x,originalOuterX);
 m.updateLabel(m.getElement(added.id),'New child visible');m.undo();m.redo();
 await m.drillInto(m.getElement('Payment'));assert.equal(m.getElement('CapturePayment').x,childX);
 assert.equal(m.getElement(added.id).businessObject.name,'New child visible');
 m.undo();assert.ok(!m.getElement(edge.id));m.undo();assert.ok(!m.getElement(added.id));
 await m.navigateBack();assert.ok(!m.getElement(added.id));
 await m.drillInto(m.getElement('Payment'));m.redo();m.redo();await m.navigateBack();await oracle(m);
 const xml=await m.getXML();await m.importXML(xml);assert.ok(m.getElement(added.id));await m.drillInto(m.getElement('Payment'));assert.equal(m.getElement('CapturePayment').x,childX);m.destroy();
});
test('expanding imported separate-plane subprocess hydrates children and preserves independent source DI',async()=>{
 const m=await model('test/fixtures/bpmn/collapsed-sub-process.bpmn');
 const sub=m.getElement('collapsedProcess'), childId='sid-9E3BA75C-29DD-4DAC-8283-8FDE4E9A6724';
 assert.ok(sub);assert.ok(!m.getElement(childId));
 const diagram=m.getDefinitions().diagrams.find(d=>d.plane.bpmnElement===sub.businessObject);
 const childDi=diagram.plane.planeElement.find(di=>di.bpmnElement.id===childId), originalBounds={...childDi.bounds};
 const before=await m.getXML();m.toggleExpanded(sub);const child=m.getElement(childId);assert.ok(child&&!child.hidden);
 assert.equal(sub.di.isExpanded,true);assert.deepEqual({...childDi.bounds},originalBounds);
 m.moveShape(child,{x:20,y:10});m.undo();m.undo();assert.equal(await m.getXML(),before);assert.ok(!m.getElement(childId));
 m.redo();assert.ok(m.getElement(childId));m.redo();
 await m.drillInto(sub);assert.equal(m.getElement(childId).x,originalBounds.x);await m.navigateBack();
 m.toggleExpanded(m.getElement(sub.id));assert.equal(m.getElement(childId).hidden,true);m.undo();assert.equal(m.getElement(childId).hidden,false);
 const xml=await m.getXML();await oracle(m);
 await m.importXML(xml);assert.ok(m.getElement(childId)&&!m.getElement(childId).hidden);m.destroy();
});

test('HR fractional imported DI survives API and pointer movement undo/cancel exactly',async()=>{
 const m=await model('test/fixtures/bpmn/complex.bpmn');
 const node=m.getGraph().nodes.find(n=>n.type==='bpmn:Task'||n.type==='bpmn:UserTask');
 assert.equal(node.id,'sid-B104C31F-A70F-4206-AF8E-442C5C2EEE49');
 const before=await m.getXML(),bounds={...node.di.bounds},origin={x:node.x,y:node.y};
 m.moveShape(node,{x:15,y:10});assert.deepEqual({x:node.x,y:node.y},{x:origin.x+15,y:origin.y+10});
 const after=await m.getXML();
 for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.deepEqual({...node.di.bounds},bounds);m.redo();assert.equal(await m.getXML(),after);}m.undo();
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 const drag=()=>{m.getContainer().querySelector(`[data-element-id="${node.id}"]`).dispatchEvent(mouse('mousedown',node.x+10,node.y+10));window.dispatchEvent(mouse('mousemove',node.x+45,node.y+30));};
 drag();m.cancel();assert.equal(await m.getXML(),before);
 drag();window.dispatchEvent(mouse('mouseup',node.x+45,node.y+30));m.undo();assert.equal(await m.getXML(),before);
 m.destroy();
});

for(const collapsed of [false,true]) test(`explicit ${collapsed?'collapsed':'expanded'} subprocess replacement removes all contents and restores exact multi-view metadata`,async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),sub=m.getElement('Payment'),moddle=m.getModdle();
 const child=m.getElement('CapturePayment');
 const enrich=node=>{const extension=moddle.create('bpmn:ExtensionElements');const payload=moddle.createAny('vendor:payload','urn:replacement-test',{value:'keep me'});payload.$parent=extension;extension.values=[payload];extension.$parent=node.businessObject;node.businessObject.extensionElements=extension;node.businessObject.$attrs['vendor:flag']='retained';node.businessObject.$xml.attrNames['vendor:flag']={uri:'urn:replacement-test'};};
 enrich(sub);enrich(child);
 const timer=host=>{const node=m.addShape('bpmn:BoundaryEvent',{x:host.x+host.width,y:host.y+host.height},{host,parent:host.parent});const def=moddle.create('bpmn:TimerEventDefinition'),duration=moddle.create('bpmn:FormalExpression',{body:'PT1H'});duration.$parent=def;def.timeDuration=duration;def.$parent=node.businessObject;node.businessObject.eventDefinitions=[def];return node;};
 const inside=timer(child),outside=timer(sub);m.connect(inside,m.getElement('PaymentEnd'));const outerEdge=m.connect(outside,m.getElement('ShipOrder'));assert.ok(outerEdge);
 const outerBo=outside.businessObject,outerId=outside.id;
 await m.drillInto(sub);const nested=m.addShape('bpmn:SubProcess',{x:700,y:650});const nestedChild=m.addShape('bpmn:Task',{x:700,y:650},{parent:nested});await m.drillInto(nested);await m.navigateBack();await m.navigateBack();
 if(collapsed)m.toggleExpanded(sub);
 const contents=new Set([child.id,inside.id,nested.id,nestedChild.id,'PaymentStart','PaymentEnd','PaymentFlow1','PaymentFlow2']);
 const before=await m.getXML(),size=m.commandStack.size();
 for(const args of [...['',null,0,undefined,'duplicate'].map(id=>[sub,'bpmn:Task',{id},{removeContents:true}]),[sub,'bpmn:Task'],[sub,'bpmn:Task',{},{}],[sub,'bpmn:Unknown',{}, {removeContents:true}],[sub,'bpmn:Task',{flowElements:[]},{removeContents:true}],[sub,'bpmn:Task',{__eventDefinition:'bpmn:Task'},{removeContents:true}]]) {assert.equal(m.replace(...args),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
 assert.equal(m.replace(sub,'bpmn:Task',{}, {removeContents:true}),sub);assert.equal(m.commandStack.size(),size+1);
 assert.equal(sub.type,'bpmn:Task');assert.equal(sub.collapsed,false);assert.equal(outside.businessObject,outerBo);assert.equal(outside.businessObject.attachedToRef,sub.businessObject);assert.equal(m.getElement(outerEdge.id),outerEdge);
 assert.equal(sub.businessObject.extensionElements.values[0].value,'keep me');
 assert.ok(!m.getDefinitions().diagrams.some(diagram=>diagram.plane.bpmnElement.id===sub.id||contents.has(diagram.plane.bpmnElement.id)));
 assert.ok(m.getDefinitions().diagrams.every(diagram=>diagram.plane.planeElement.every(di=>!contents.has(di.bpmnElement.id))));
 const replaced=await m.getXML();const parsed=await oracle(m);contents.forEach(id=>assert.equal(parsed.elementsById[id],undefined));assert.equal(parsed.elementsById[outerId].attachedToRef,parsed.elementsById[sub.id]);
 for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(m.getElement(sub.id),sub);assert.equal(child.businessObject.extensionElements.values[0].value,'keep me');m.redo();assert.equal(await m.getXML(),replaced);}
 m.undo();await oracle(m);await m.drillInto(sub);assert.ok(m.getElement(child.id));assert.ok(m.getElement(nested.id));await m.navigateBack();m.redo();assert.equal(await m.getXML(),replaced);
 await m.importXML(replaced);assert.equal(m.getElement(sub.id).type,'bpmn:Task');assert.equal(m.getElement(outerId).businessObject.attachedToRef,m.getElement(sub.id).businessObject);m.destroy();
});

test('replace contents UI requires explicit confirmation and cancel/Escape leave XML and history unchanged',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),sub=m.getElement('Payment');m.select(sub.id);
 const before=await m.getXML(),size=m.commandStack.size();
 const open=()=>{m.select(sub.id);m.getContainer().querySelector('button[title="Replace and remove contents"]').click();[...m.getContainer().querySelectorAll('[role="menuitem"]')].find(item=>item.textContent==='Task').click();assert.ok(m.getContainer().querySelector('[role="dialog"][aria-label="Replace and remove contents"]'));};
 open();[...m.getContainer().querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Cancel').click();assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 open();window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(m.getContainer().querySelector('[role="dialog"]'),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 open();[...m.getContainer().querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='Replace and remove contents').click();assert.equal(sub.type,'bpmn:Task');assert.equal(m.commandStack.size(),size+1);m.undo();assert.equal(await m.getXML(),before);m.destroy();
});

test('replacing an imported collapsed subprocess removes off-canvas child planes and restores child edit history',async()=>{
 const m=await model('test/fixtures/bpmn/collapsed-sub-process.bpmn'),sub=m.getElement('collapsedProcess');
 const childId='sid-9E3BA75C-29DD-4DAC-8283-8FDE4E9A6724';
 await m.drillInto(sub);const child=m.getElement(childId),oldName=child.businessObject.name;m.updateLabel(child,'Edited inside');await m.navigateBack();
 assert.ok(!m.getElement(childId));const before=await m.getXML(),size=m.commandStack.size();
 const remainingDiagrams=m.getDefinitions().diagrams.filter(diagram=>{let root=diagram.plane.bpmnElement;while(root){if(root===sub.businessObject)return false;root=root.$parent;}return true;}).map(diagram=>diagram.id);
 for(const type of ['bpmn:BoundaryEvent','bpmn:TextAnnotation']) {assert.equal(m.replace(sub,type,{}, {removeContents:true}),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
 m.replace(sub,'bpmn:ServiceTask',{}, {removeContents:true});assert.deepEqual(m.getDefinitions().diagrams.map(diagram=>diagram.id),remainingDiagrams);await oracle(m);
 m.undo();assert.equal(await m.getXML(),before);await m.drillInto(sub);assert.equal(m.getElement(childId),child);m.undo();assert.equal(child.businessObject.name,oldName);m.redo();assert.equal(child.businessObject.name,'Edited inside');await m.navigateBack();
 m.redo();assert.equal(m.getElement(sub.id).type,'bpmn:ServiceTask');await oracle(m);m.destroy();
});

test('explicit subprocess-to-gateway replacement removes incompatible attached boundaries and edges in one undo step',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),sub=m.getElement('Payment');
 const boundary=m.addShape('bpmn:BoundaryEvent',{x:sub.x+sub.width,y:sub.y+sub.height},{host:sub,parent:sub.parent});
 const edge=m.connect(boundary,m.getElement('ShipOrder')),before=await m.getXML(),count=m.commandStack.size();
 assert.equal(m.replace(sub,'bpmn:ExclusiveGateway',{}, {removeContents:true}),sub);assert.equal(m.getElement(boundary.id),null);assert.equal(m.getElement(edge.id),null);assert.equal(m.commandStack.size(),count+1);
 const changed=await m.getXML();await oracle(m);
 for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(m.getElement(boundary.id),boundary);assert.equal(boundary.businessObject.attachedToRef,sub.businessObject);m.redo();assert.equal(await m.getXML(),changed);}m.destroy();
});

test('transaction cancel boundaries and attrs-incompatible boundaries are removed only with explicit replacement opt-in',async()=>{
 const m=await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn'),transaction=m.getElement('BookingTransaction'),boundary=m.getElement('BookingCancelled');
 const edges=m.getGraph().edges.filter(edge=>edge.source===boundary||edge.target===boundary),before=await m.getXML(),size=m.commandStack.size();
 assert.equal(m.replace(transaction,'bpmn:Task'),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 m.replace(transaction,'bpmn:Task',{}, {removeContents:true});assert.equal(m.getElement(boundary.id),null);edges.forEach(edge=>assert.equal(m.getElement(edge.id),null));assert.equal(m.commandStack.size(),size+1);await oracle(m);
 for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);assert.equal(boundary.businessObject.attachedToRef,transaction.businessObject);assert.equal(boundary.businessObject.eventDefinitions[0].$type,'bpmn:CancelEventDefinition');m.redo();}m.undo();
 m.replace(transaction,'bpmn:Task',{isForCompensation:true},{removeContents:true});assert.equal(m.getElement(boundary.id),null);assert.equal(transaction.businessObject.isForCompensation,true);await oracle(m);m.undo();assert.equal(await m.getXML(),before);m.destroy();
});

test('replacing a populated activity preserves owned data associations and IO item identities without duplicate IDs',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),sub=m.getElement('Payment');
 const data=m.addShape('bpmn:DataObjectReference',{x:900,y:350},{parent:sub.parent}),other=m.addShape('bpmn:DataStoreReference',{x:1050,y:350},{parent:sub.parent}),input=connectAuthoredIO(m,data,sub),output=connectAuthoredIO(m,sub,data,false);
 const io=sub.businessObject.ioSpecification,oldBo=sub.businessObject,before=await m.getXML(),size=m.commandStack.size();
 const check=()=>{assert.equal(sub.businessObject.ioSpecification,io);assert.equal(input.businessObject.$parent,sub.businessObject);assert.equal(output.businessObject.$parent,sub.businessObject);assert.deepEqual(sub.businessObject.dataInputAssociations,[input.businessObject]);assert.deepEqual(sub.businessObject.dataOutputAssociations,[output.businessObject]);assert.ok(io.dataInputs.includes(input.businessObject.targetRef));assert.ok(io.dataOutputs.includes(output.businessObject.sourceRef[0]));};
 m.replace(sub,'bpmn:Task',{}, {removeContents:true});assert.equal(m.commandStack.size(),size+1);check();await oracle(m);
 const changed=await m.getXML();m.delete(input);assert.equal(sub.businessObject.dataInputAssociations.length,0);assert.equal((await oracle(m)).elementsById[input.id],undefined);m.undo();check();assert.equal(await m.getXML(),changed);
 m.reconnect(output,'target',other);check();await oracle(m);m.undo();check();assert.equal(await m.getXML(),changed);
 for(let i=0;i<3;i++){m.undo();assert.equal(sub.businessObject,oldBo);check();assert.equal(await m.getXML(),before);m.redo();check();assert.equal(await m.getXML(),changed);}m.destroy();
});

test('non-destructive subprocess variant replacement retains artifact and lane-set identities',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),sub=m.getElement('Payment'),moddle=m.getModdle();
 // Explicit retained BO models an imported nested artifact; new notes belong to the active canvas root.
 const annotation=m.addShape('bpmn:TextAnnotation',{x:680,y:640},{parent:sub,businessObject:moddle.create('bpmn:TextAnnotation',{id:'ImportedPaymentNote'})});m.updateLabel(annotation,'Keep this subprocess note');
 const laneSet=moddle.create('bpmn:LaneSet',{id:'PaymentLaneSet'}),lane=moddle.create('bpmn:Lane',{id:'PaymentLane'});lane.$parent=laneSet;lane.flowNodeRef=[m.getElement('CapturePayment').businessObject];laneSet.lanes=[lane];laneSet.$parent=sub.businessObject;sub.businessObject.laneSets=[laneSet];
 const before=await m.getXML();m.replace(sub,'bpmn:Transaction');assert.ok(sub.businessObject.artifacts.includes(annotation.businessObject));assert.equal(annotation.businessObject.$parent,sub.businessObject);assert.equal(sub.businessObject.laneSets[0],laneSet);assert.equal(laneSet.$parent,sub.businessObject);await oracle(m);m.undo();assert.equal(await m.getXML(),before);m.destroy();
});

test('IO-bearing activity/event cross-family replacement is a safe exact no-op until IO migration is supported',async()=>{
 const m=await model();
 for(const [sourceType,targetType,input] of [['bpmn:Task','bpmn:EndEvent',true],['bpmn:Task','bpmn:IntermediateCatchEvent',false],['bpmn:IntermediateThrowEvent','bpmn:Task',true],['bpmn:IntermediateCatchEvent','bpmn:Task',false]]) {
  const node=m.addShape(sourceType,{x:400,y:300}),data=m.addShape('bpmn:DataObjectReference',{x:650,y:300});const edge=input?m.connect(data,node):m.connect(node,data);assert.ok(edge);
  const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.replace(node,targetType,{}, {removeContents:true}),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.equal(m.getElement(edge.id),edge);await oracle(m);
 }m.destroy();
});

test('catalog descriptors enforce contextual event variants and persist expanded flags only on DI',async()=>{
 const m=await model(),start=m.getGraph().nodes.find(node=>node.type==='bpmn:StartEvent');
 const before=await m.getXML();for(const target of [{type:'bpmn:StartEvent',eventDefinitionType:'bpmn:ErrorEventDefinition'},{type:'bpmn:EndEvent',eventDefinitionType:'bpmn:TimerEventDefinition'},{type:'bpmn:EndEvent',eventDefinitionType:'bpmn:CancelEventDefinition'},{type:'bpmn:StartEvent',eventDefinitionType:'bpmn:MessageEventDefinition',isInterrupting:false}]){assert.equal(m.replace(start,target),null);assert.equal(await m.getXML(),before);}
 assert.ok(m.replace(start,{type:'bpmn:StartEvent',eventDefinitionType:'bpmn:TimerEventDefinition'}));assert.equal(start.businessObject.eventDefinitions[0].$type,'bpmn:TimerEventDefinition');m.undo();assert.equal(await m.getXML(),before);
 const task=m.addShape('bpmn:Task',{x:700,y:400}),old=await m.getXML();m.replace(task,{type:'bpmn:SubProcess',isExpanded:true});assert.equal(task.di.isExpanded,true);assert.equal(Object.hasOwn(task.businessObject,'isExpanded'),false);assert.ok(task.width>=350);m.undo();assert.equal(await m.getXML(),old);m.redo();
 const child=m.addShape('bpmn:Task',{x:700,y:400},{parent:task});assert.ok(child);const expanded=await m.getXML();m.replace(task,{type:'bpmn:SubProcess',isExpanded:false});assert.equal(task.di.isExpanded,false);assert.equal(child.hidden,true);m.undo();assert.equal(await m.getXML(),expanded);
 const sub=m.addShape('bpmn:SubProcess',{x:1100,y:700},{triggeredByEvent:true,isExpanded:true});assert.equal(m.addShape('bpmn:StartEvent',{x:1100,y:700},{parent:sub}),null);
 const typed=m.addShape('bpmn:StartEvent',{x:1100,y:700},{parent:sub,eventDefinitionType:'bpmn:ErrorEventDefinition'});assert.ok(typed);assert.equal(m.toggleEventInterrupting(typed),false);
 await oracle(m);m.destroy();
});

test('sequence-flow popup actions set real defaults and conditions and undo exact XML',async()=>{
 const m=await model('test/fixtures/scenarios/approval-rejection-rework.bpmn'),edge=m.getElement('ReworkFlow'),bo=edge.businessObject,source=edge.source;
 assert.ok(source.businessObject.$instanceOf('bpmn:Activity'));const before=await m.getXML(),count=m.commandStack.size();
 m.setSequenceFlowType(edge,'conditional','approved === true');assert.equal(bo.conditionExpression.body,'approved === true');assert.equal(bo.conditionExpression.$parent,bo);assert.equal(bo.$parent,source.businessObject.$parent);await oracle(m);m.undo();assert.equal(await m.getXML(),before);
 m.setSequenceFlowType(edge,'default');assert.equal(source.businessObject.default,bo);assert.equal(bo.$parent,source.businessObject.$parent);assert.equal(m.commandStack.size(),count+1);m.undo();assert.equal(await m.getXML(),before);m.redo();
 const defaultXML=await m.getXML();m.setSequenceFlowType(edge,'normal');assert.equal(source.businessObject.default,undefined);m.undo();assert.equal(await m.getXML(),defaultXML);
 const gatewayEdge=m.getElement('ApproveFlow');const same=await m.getXML();assert.equal(m.setSequenceFlowType(gatewayEdge,'conditional','x'),null);assert.equal(await m.getXML(),same);await oracle(m);m.destroy();
});

test('replacement headers retain multi-instance expressions and update collection/multiplicity owners',async()=>{
 const m=await model(),task=m.addShape('bpmn:Task',{x:500,y:300});m.toggleMarker(task,'parallelMI');const loop=task.businessObject.loopCharacteristics,moddle=m.getModdle();loop.loopCardinality=moddle.create('bpmn:FormalExpression',{body:'3'});loop.loopCardinality.$parent=loop;loop.completionCondition=moddle.create('bpmn:FormalExpression',{body:'nrOfCompletedInstances > 1'});loop.completionCondition.$parent=loop;
 const before=await m.getXML();m.toggleMarker(task,'sequentialMI');assert.equal(task.businessObject.loopCharacteristics,loop);assert.equal(loop.isSequential,true);assert.equal(loop.loopCardinality.body,'3');assert.equal(loop.completionCondition.body,'nrOfCompletedInstances > 1');m.undo();assert.equal(await m.getXML(),before);
 const data=m.addShape('bpmn:DataObjectReference',{x:750,y:300});assert.ok(data.businessObject.dataObjectRef);const old=await m.getXML();m.toggleCollection(data);assert.equal(data.businessObject.dataObjectRef.isCollection,true);assert.equal(Object.hasOwn(data.businessObject,'isCollection'),false);m.undo();assert.equal(await m.getXML(),old);m.redo();
 const pool=m.addShape('bpmn:Participant',{x:600,y:600}),beforePool=await m.getXML();m.toggleParticipantMultiplicity(pool);assert.equal(pool.businessObject.participantMultiplicity.$parent,pool.businessObject);m.undo();assert.equal(await m.getXML(),beforePool);m.redo();await oracle(m);m.destroy();
});

test('participant empty/expanded and data reference replacements are undoable semantic changes',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),pool=m.getElement('SellerPool'),process=pool.businessObject.processRef;
 await m.drillInto(m.getElement('Payment'));await m.navigateBack();const before=await m.getXML();assert.equal(m.replace(pool,{type:'bpmn:Participant',isExpanded:false}),null);assert.equal(await m.getXML(),before);
 assert.equal(m.replace(pool,{type:'bpmn:Participant',isExpanded:false},{},{removeContents:true}),pool);assert.equal(pool.businessObject.processRef,undefined);assert.ok(!m.getDefinitions().rootElements.includes(process));assert.ok(!m.getElement('CapturePayment'));await oracle(m);
 for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();}const empty=await m.getXML();m.replace(pool,{type:'bpmn:Participant',isExpanded:true});assert.ok(pool.businessObject.processRef);assert.notEqual(pool.businessObject.processRef,process);m.undo();assert.equal(await m.getXML(),empty);m.redo();
 const data=m.addShape('bpmn:DataObjectReference',{x:400,y:400},{parent:pool}),original=data.businessObject.dataObjectRef;const dataBefore=await m.getXML();m.replace(data,{type:'bpmn:DataStoreReference'});assert.equal(data.type,'bpmn:DataStoreReference');assert.ok(!pool.businessObject.processRef.flowElements.includes(original));await oracle(m);m.undo();assert.equal(await m.getXML(),dataBefore);m.redo();m.replace(data,{type:'bpmn:DataObjectReference'});assert.ok(data.businessObject.dataObjectRef);await oracle(m);m.destroy();
});

test('boundary creation and intermediate attach preserve host semantics, movement/deletion undo and invalid no-ops',async()=>{
 const m=await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn'),host=m.getElement('ReserveFlight'),moddle=m.getModdle();
 const old=await m.getXML(),count=m.commandStack.size();
 for(const eventDefinitionType of ['bpmn:CancelEventDefinition','bpmn:TerminateEventDefinition']) {assert.equal(m.addShape('bpmn:BoundaryEvent',{x:host.x+host.width,y:host.y+host.height},{host,eventDefinitionType}),null);assert.equal(await m.getXML(),old);assert.equal(m.commandStack.size(),count);}
 assert.equal(m.addShape('bpmn:BoundaryEvent',{x:host.x+host.width,y:host.y+host.height},{host,eventDefinitionType:'bpmn:ErrorEventDefinition',cancelActivity:false}),null);
 const typed=m.addShape('bpmn:BoundaryEvent',{x:host.x+host.width,y:host.y+host.height},{host,eventDefinitionType:'bpmn:TimerEventDefinition',cancelActivity:false});assert.ok(typed);assert.equal(typed.businessObject.cancelActivity,false);assert.equal(m.toggleEventInterrupting(typed),typed);m.undo();assert.equal(typed.businessObject.cancelActivity,false);
 const loose=m.addShape('bpmn:IntermediateThrowEvent',{x:1000,y:850},{parent:host.parent}),before=await m.getXML();assert.equal(m.attachBoundary(loose,host),loose);assert.equal(loose.type,'bpmn:BoundaryEvent');assert.equal(loose.businessObject.eventDefinitions.length,0);assert.equal(loose.host,host);assert.equal(loose.businessObject.attachedToRef,host.businessObject);assert.ok(host.attachers.includes(loose));m.undo();assert.equal(await m.getXML(),before);m.redo();
 m.replace(loose,{type:'bpmn:BoundaryEvent',eventDefinitionType:'bpmn:TimerEventDefinition',cancelActivity:true});const definition=loose.businessObject.eventDefinitions[0];definition.timeDuration=moddle.create('bpmn:FormalExpression',{body:'PT10M'});definition.timeDuration.$parent=definition;
 const complete=await m.getXML(),x=loose.x;m.moveShape(host,{x:50,y:20});assert.equal(loose.x,x+50);m.undo();assert.equal(await m.getXML(),complete);m.delete(host);assert.equal(m.getElement(loose.id),null);m.undo();assert.equal(await m.getXML(),complete);await oracle(m);
 const xml=await m.getXML();await m.importXML(xml);assert.equal(m.getElement(loose.id).host.id,host.id);m.destroy();
});

test('native DOM boundary palette, intermediate-on-host, menu variants and Escape are repeatable',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:true});await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
 const host=m.addShape('bpmn:Task',{x:500,y:300});m.select(host.id);const before=await m.getXML(),count=m.commandStack.size();
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});
 const boundaryButton=[...m.getContainer().querySelectorAll('.bpmn-xyflow-palette button')].find(button=>button.textContent==='+ Boundary');assert.ok(boundaryButton);boundaryButton.click();assert.ok(m.getContainer().querySelector('[data-action="replace-with-timer-boundary"]'));window.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),count);
 boundaryButton.click();m.getContainer().querySelector('[data-action="replace-with-non-interrupting-timer-boundary"]').click();const boundary=host.attachers.at(-1);assert.equal(boundary.type,'bpmn:BoundaryEvent');assert.equal(boundary.businessObject.cancelActivity,false);
 assert.deepEqual(m.getSelection(),[boundary.id]);
 const center={x:boundary.x+boundary.width/2,y:boundary.y+boundary.height/2};
 for(const handle of m.getContainer().querySelectorAll('.bpmn-xyflow-resize-handle')){
  const x=Number(handle.getAttribute('x')),y=Number(handle.getAttribute('y')),w=Number(handle.getAttribute('width')),h=Number(handle.getAttribute('height'));
  assert.ok(center.x<x||center.x>x+w||center.y<y||center.y>y+h,'boundary center is not covered by a stale host resize handle');
 }
 m.undo();assert.equal(await m.getXML(),before);assert.deepEqual(m.getSelection(),[]);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null);
 const loose=m.addShape('bpmn:IntermediateThrowEvent',{x:800,y:300}),looseBefore=await m.getXML(),oldHit=document.elementsFromPoint;document.elementsFromPoint=()=>[m.getContainer().querySelector(`[data-element-id="${host.id}"]`)];
 try{m.getContainer().querySelector(`[data-element-id="${loose.id}"]`).dispatchEvent(mouse('mousedown',loose.x+18,loose.y+18));window.dispatchEvent(mouse('mousemove',host.x+host.width,host.y+host.height));window.dispatchEvent(mouse('mouseup',host.x+host.width,host.y+host.height));assert.equal(loose.type,'bpmn:BoundaryEvent');assert.equal(loose.host,host);assert.equal(loose.businessObject.eventDefinitions.length,0);m.undo();assert.equal(await m.getXML(),looseBefore);m.redo();m.select(loose.id);m.getContainer().querySelector('button[title^="Change type"]').click();m.getContainer().querySelector('[data-action="replace-with-timer-boundary"]').click();assert.equal(loose.businessObject.eventDefinitions[0].$type,'bpmn:TimerEventDefinition');}
 finally{document.elementsFromPoint=oldHit;}await oracle(m);m.destroy();
});

test('modeling shortcuts work from palette/toolbar buttons without stealing editable-field undo',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:true});await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
 const button=[...m.getContainer().querySelectorAll('.bpmn-xyflow-palette button')].find(button=>button.textContent==='+ Task'),before=m.getGraph().nodes.length;button.click();button.focus();assert.equal(m.getGraph().nodes.length,before+1);
 const undo=target=>{const event=new dom.window.KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});target.dispatchEvent(event);return event.defaultPrevented;};
 for(const tag of ['input','textarea','select']){const field=document.createElement(tag);m.getContainer().append(field);assert.equal(undo(field),false);assert.equal(m.getGraph().nodes.length,before+1);field.remove();}
 const edit=document.createElement('div');edit.contentEditable='true';m.getContainer().append(edit);assert.equal(undo(edit),false);edit.remove();assert.equal(undo(button),true);assert.equal(m.getGraph().nodes.length,before);m.destroy();
});

test('contextual move applies upstream event replacements, artifact ownership and lane-copy restrictions',async()=>{
 const m=await model(),sub=m.addShape('bpmn:SubProcess',{x:850,y:600});
 const start=m.addShape('bpmn:StartEvent',{x:500,y:400},{eventDefinitionType:'bpmn:TimerEventDefinition'}),before=await m.getXML();
 assert.equal(m.moveShape(start,{x:300,y:150},sub),true);assert.equal(start.businessObject.eventDefinitions.length,0);assert.equal(start.parent,sub);assert.equal(start.businessObject.$parent,sub.businessObject);m.undo();assert.equal(await m.getXML(),before);m.redo();await oracle(m);
 const created=m.addShape('bpmn:TextAnnotation',{x:1100,y:750},{parent:sub});assert.equal(created.parent,m.getGraph().roots[0]);assert.equal(created.businessObject.$parent,m.getGraph().roots[0].businessObject);m.undo();
 const annotation=m.addShape('bpmn:TextAnnotation',{x:1100,y:750},{parent:sub,businessObject:m.getModdle().create('bpmn:TextAnnotation',{id:'ImportedNestedNote'})}),oldOwner=annotation.businessObject.$parent,annotationBefore=await m.getXML();
 assert.ok(m.moveShape(annotation,{x:-500,y:-500},m.getGraph().roots[0]));assert.ok(!oldOwner.artifacts.includes(annotation.businessObject));assert.equal(annotation.businessObject.$parent,m.getGraph().roots[0].businessObject);m.undo();assert.equal(await m.getXML(),annotationBefore);
 const pool=m.addShape('bpmn:Participant',{x:1200,y:900}),lanes=m.splitLane(pool,2);assert.equal(m.copy([lanes[0]]),null);assert.equal(m.moveShape(lanes[0],{x:20,y:0}),false);await oracle(m);m.destroy();
});

test('collaboration-level data stores retain a process owner across create/move/export and exact undo',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),root=m.getGraph().roots[0],pool=m.getElement('SellerPool');
 const store=m.addShape('bpmn:DataStoreReference',{x:1600,y:300},{parent:root});assert.ok(store);assert.equal(store.parent,root);assert.ok(store.businessObject.$parent.$instanceOf('bpmn:Process'));await oracle(m);
 const before=await m.getXML();assert.ok(m.moveShape(store,{x:-400,y:0},pool));assert.equal(store.businessObject.$parent,pool.businessObject.processRef);m.undo();assert.equal(await m.getXML(),before);await oracle(m);m.destroy();
});

test('same IO event-family replacement and attachment preserve data item and association identities',async()=>{
 const m=await model(),host=m.addShape('bpmn:Task',{x:500,y:300}),event=m.addShape('bpmn:IntermediateCatchEvent',{x:800,y:300},{eventDefinitionType:'bpmn:MessageEventDefinition'}),data=m.addShape('bpmn:DataObjectReference',{x:1000,y:300});
 const edge=connectAuthoredIO(m,event,data,false),item=edge.businessObject.sourceRef[0],before=await m.getXML();assert.equal(m.attachBoundary(event,host),event);assert.ok(event.businessObject.dataOutputs.includes(item));assert.deepEqual(event.businessObject.dataOutputAssociations,[edge.businessObject]);assert.equal(edge.businessObject.$parent,event.businessObject);await oracle(m);m.undo();assert.equal(await m.getXML(),before);
 const unchanged=await m.getXML(),count=m.commandStack.size();assert.equal(m.replace(event,{type:'bpmn:IntermediateThrowEvent',eventDefinitionType:'bpmn:MessageEventDefinition'}),null);assert.equal(await m.getXML(),unchanged);assert.equal(m.commandStack.size(),count);m.destroy();
});

test('replacement popup exposes pinned context entries and real checkbox header actions',async()=>{
 const m=await model(),task=m.addShape('bpmn:Task',{x:500,y:300});
 const open=node=>{m.select(node.id);m.getContainer().querySelector('button[title^="Change type"]').click();};
 open(task);assert.ok(m.getContainer().querySelector('[data-action="replace-with-service-task"]'));const parallel=m.getContainer().querySelector('[data-action="toggle-parallel-mi"]');assert.equal(parallel.getAttribute('role'),'menuitemcheckbox');assert.equal(parallel.getAttribute('aria-checked'),'false');parallel.click();assert.equal(task.businessObject.loopCharacteristics.isSequential,false);open(task);assert.equal(m.getContainer().querySelector('[data-action="toggle-parallel-mi"]').getAttribute('aria-checked'),'true');m.getContainer().querySelector('[data-action="toggle-sequential-mi"]').click();assert.equal(task.businessObject.loopCharacteristics.isSequential,true);
 const data=m.addShape('bpmn:DataObjectReference',{x:750,y:300});open(data);m.getContainer().querySelector('[data-action="toggle-is-collection"]').click();assert.equal(data.businessObject.dataObjectRef.isCollection,true);
 const pool=m.addShape('bpmn:Participant',{x:1100,y:800});open(pool);m.getContainer().querySelector('[data-action="toggle-participant-multiplicity"]').click();assert.ok(pool.businessObject.participantMultiplicity);await oracle(m);m.destroy();
});

test('variant replacements normalize hidden child starts/cancel ends and preserve exact undo',async()=>{
 const m=await model('test/fixtures/scenarios/booking-timeout-compensation.bpmn'),transaction=m.getElement('BookingTransaction');
 await m.drillInto(transaction);await m.navigateBack();m.toggleExpanded(transaction);const before=await m.getXML();
 m.replace(transaction,{type:'bpmn:SubProcess',isExpanded:false});const lookup=id=>{const walk=bo=>{if(bo.id===id)return bo;for(const child of bo.flowElements||[]){const found=walk(child);if(found)return found;}};return walk(transaction.businessObject);};
 assert.equal(lookup('CancelBooking').eventDefinitions.length,0);assert.equal(m.getElement('BookingCancelled').businessObject.eventDefinitions.length,0);await oracle(m);m.undo();assert.equal(await m.getXML(),before);m.redo();m.undo();
 const eventSub=m.addShape('bpmn:SubProcess',{x:1600,y:700},{triggeredByEvent:true,isExpanded:true}),start=m.addShape('bpmn:StartEvent',{x:1600,y:700},{parent:eventSub,eventDefinitionType:'bpmn:TimerEventDefinition',isInterrupting:false});assert.ok(start);const old=await m.getXML();m.replace(eventSub,{type:'bpmn:SubProcess',isExpanded:true});assert.equal(start.businessObject.eventDefinitions.length,0);assert.equal(start.businessObject.isInterrupting,true);m.undo();assert.equal(await m.getXML(),old);
 const normal=m.addShape('bpmn:SubProcess',{x:1600,y:1000}),none=m.addShape('bpmn:StartEvent',{x:1600,y:1000},{parent:normal});assert.ok(none);const unchanged=await m.getXML(),size=m.commandStack.size();assert.equal(m.replace(normal,{type:'bpmn:SubProcess',triggeredByEvent:true,isExpanded:true}),null);assert.equal(await m.getXML(),unchanged);assert.equal(m.commandStack.size(),size);m.destroy();
});

test('replacement validates every retained edge and cleans illegal conditions/defaults atomically',async()=>{
 const {getConnectionType}=await dom.loadModule('/lib/modeling/Rules.js');
 const m=await model(),a=m.addShape('bpmn:Task',{x:300,y:400}),b=m.addShape('bpmn:Task',{x:550,y:400}),c=m.addShape('bpmn:Task',{x:800,y:400}),incoming=m.connect(a,b),outgoing=m.connect(b,c);
 m.setSequenceFlowType(outgoing,'conditional','x > 0');const before=await m.getXML();m.replace(b,{type:'bpmn:StartEvent'});assert.equal(m.getElement(incoming.id),null);assert.equal(m.getElement(outgoing.id),outgoing);assert.equal(outgoing.businessObject.conditionExpression,undefined);
 for(const edge of m.getGraph().edges)assert.equal(getConnectionType(edge.source,edge.target,edge),edge.type);await oracle(m);m.undo();assert.equal(await m.getXML(),before);
 m.replace(b,{type:'bpmn:EndEvent'});assert.equal(m.getElement(outgoing.id),null);assert.equal(m.getElement(incoming.id),incoming);for(const edge of m.getGraph().edges)assert.equal(getConnectionType(edge.source,edge.target,edge),edge.type);m.undo();assert.equal(await m.getXML(),before);
 m.replace(b,{type:'bpmn:ExclusiveGateway'});assert.ok(outgoing.businessObject.conditionExpression);m.setSequenceFlowType(outgoing,'default');const gateway=await m.getXML();m.replace(b,{type:'bpmn:ParallelGateway'});assert.equal(b.businessObject.default,undefined);assert.equal(outgoing.businessObject.conditionExpression,undefined);for(const edge of m.getGraph().edges)assert.equal(getConnectionType(edge.source,edge.target,edge),edge.type);m.undo();assert.equal(await m.getXML(),gateway);await oracle(m);m.destroy();
});

test('catalog target identity, definition metadata and flags reject adversarial mutations before commands',async()=>{
 const m=await model('test/fixtures/scenarios/order-payment-delivery.bpmn'),pool=m.getElement('SellerPool'),start=m.getElement('OrderReceived');const before=await m.getXML(),size=m.commandStack.size();
 for(const eventDefinitionAttrs of [{id:pool.id},{$type:'bpmn:Task'},{$parent:pool.businessObject},JSON.parse('{"__proto__":"value"}'),{name:NaN},{messageRef:pool.businessObject}]){assert.equal(m.replace(start,{type:'bpmn:StartEvent',eventDefinitionType:'bpmn:MessageEventDefinition',eventDefinitionAttrs}),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
 assert.equal(m.replace(pool,{type:'bpmn:Participant',isExpanded:false},{id:''},{removeContents:true}),null);assert.equal(await m.getXML(),before);
 for(const options of [{cancelActivity:false},{isInterrupting:false},{triggeredByEvent:true},{eventDefinitionType:'bpmn:TimerEventDefinition'},{instantiate:true}]){assert.equal(m.addShape('bpmn:Task',{x:1000,y:600},options),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
 assert.equal(m.replace(start,{type:'bpmn:Task',cancelActivity:false}),null);assert.equal(await m.getXML(),before);m.destroy();
});

test('replacement cleans sibling-plane-only edges, conditions, defaults and DI with exact undo',async()=>{
 const m=await model(),a=m.addShape('bpmn:Task',{x:300,y:300}),b=m.addShape('bpmn:Task',{x:550,y:300}),c=m.addShape('bpmn:Task',{x:800,y:300}),incoming=m.connect(a,b),outgoing=m.connect(b,c);m.setSequenceFlowType(outgoing,'conditional','x');
 const original=await m.getXML(),moddle=m.getModdle(),parsed=await moddle.fromXML(original),defs=parsed.rootElement,plane=defs.diagrams[0].plane;
 const copied=moddle.create('bpmndi:BPMNDiagram',{id:'OtherDiagram',plane:moddle.create('bpmndi:BPMNPlane',{id:'OtherPlane',bpmnElement:plane.bpmnElement,planeElement:[]})});copied.$parent=defs;copied.plane.$parent=copied;defs.diagrams.push(copied);
 const edgeDi=plane.planeElement.find(di=>di.bpmnElement.id===outgoing.id);plane.planeElement.splice(plane.planeElement.indexOf(edgeDi),1);copied.plane.planeElement.push(edgeDi);edgeDi.$parent=copied.plane;
 await m.importXML((await moddle.toXML(defs)).xml);assert.equal(m.getElement(outgoing.id),null);const before=await m.getXML(),node=m.getElement(b.id);
 assert.equal(m.replace(node,{type:'bpmn:EndEvent'}),node);assert.ok(!m.getDefinitions().diagrams.some(diagram=>diagram.plane.planeElement.some(di=>di.bpmnElement.id===outgoing.id)));assert.equal((await oracle(m)).elementsById[outgoing.id],undefined);assert.ok(m.getElement(incoming.id));m.undo();assert.equal(await m.getXML(),before);
 m.replace(node,{type:'bpmn:StartEvent'});const result=await oracle(m);assert.equal(result.elementsById[incoming.id],undefined);assert.equal(result.elementsById[outgoing.id].conditionExpression,undefined);assert.ok(result.elementsById[b.id].outgoing.includes(result.elementsById[outgoing.id]));m.undo();assert.equal(await m.getXML(),before);m.destroy();
});

test('empty participant creation honors explicit state without hiding a lone process',async()=>{
 const m=await model(),before=await m.getXML();assert.equal(m.addShape('bpmn:Participant',{x:600,y:500},{isExpanded:false}),null);assert.equal(await m.getXML(),before);
 m.addShape('bpmn:Participant',{x:600,y:500});const expanded=await m.getXML();const empty=m.addShape('bpmn:Participant',{x:600,y:1000},{isExpanded:false});assert.ok(empty);assert.equal(empty.businessObject.processRef,undefined);assert.equal(m.addShape('bpmn:Task',{x:600,y:1000},{parent:empty}),null);await oracle(m);m.undo();assert.equal(await m.getXML(),expanded);m.destroy();
});

test('IO-bearing throw-event attachment is a pre-mutation no-op without an uncaught transaction error',async()=>{
 const m=await model(),host=m.addShape('bpmn:Task',{x:500,y:300}),event=m.addShape('bpmn:IntermediateThrowEvent',{x:800,y:300}),data=m.addShape('bpmn:DataObjectReference',{x:1000,y:300});assert.ok(m.connect(data,event));const before=await m.getXML(),size=m.commandStack.size();assert.equal(m.attachBoundary(event,host),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
 const mouse=(type,x,y)=>new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});m.getContainer().querySelector(`[data-element-id="${event.id}"]`).dispatchEvent(mouse('mousedown',event.x+18,event.y+18));window.dispatchEvent(mouse('mousemove',host.x+host.width,host.y+host.height));window.dispatchEvent(mouse('mouseup',host.x+host.width,host.y+host.height));assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);m.destroy();
});

test('label editor direct cancellation preserves repeated commit, Escape, import and undo behavior', async () => {
  // Call registered transitions directly: this is a structural state-machine
  // test, not synthetic DOM input or a claim about native browser gestures.
  const handlers = new WeakMap();
  const prototype = dom.window.HTMLElement.prototype;
  const register = prototype.addEventListener;
  prototype.addEventListener = function(type, callback, options) {
    if (this.contentEditable === 'plaintext-only' && ['blur', 'keydown'].includes(type)) {
      if (!handlers.has(this)) handlers.set(this, {});
      handlers.get(this)[type] = callback;
    }
    return register.call(this, type, callback, options);
  };
  let m;
  try {
    m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false });
    const svg = m.getSvg(), add = svg.addEventListener;
    let doubleClick;
    svg.addEventListener = function(type, callback, options) {
      if (type === 'dblclick' && options === true) doubleClick = callback;
      return add.call(this, type, callback, options);
    };
    const xml = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8');
    await m.importXML(xml);
    const task = m.getGraph().nodes.find(node => node.type === 'bpmn:Task');
    m.updateLabel(task, 'Saved name');
    const saved = await m.getXML(), size = m.commandStack.size();
    const open = () => {
      doubleClick({ target: m.getContainer().querySelector(`[data-element-id="${task.id}"]`), preventDefault() {}, stopPropagation() {} });
      return [...handlersForEditors()].at(-1);
    };
    function* handlersForEditors() {
      for (const node of document.body.querySelectorAll('div')) if (handlers.has(node)) yield node;
    }
    let editor = open(); editor.textContent = 'Cancelled';
    handlers.get(editor).keydown({ key: 'Escape', preventDefault() {} });
    assert.equal(editor.isConnected, false); assert.equal(await m.getXML(), saved); assert.equal(m.commandStack.size(), size);
    editor = open(); editor.textContent = 'Committed'; handlers.get(editor).blur();
    assert.equal(task.businessObject.name, 'Committed'); assert.equal(editor.isConnected, false);
    m.undo(); assert.equal(await m.getXML(), saved);
    editor = open(); editor.textContent = 'First';
    const next = open(); assert.equal(editor.isConnected, false); assert.equal(task.businessObject.name, 'First');
    next.textContent = 'Uncommitted'; m.undo();
    assert.equal(next.isConnected, false); assert.equal(await m.getXML(), saved);
    m.redo(); assert.equal(task.businessObject.name, 'First'); await oracle(m);
    editor = open(); editor.textContent = 'Never imported'; await m.importXML(xml);
    assert.equal(editor.isConnected, false); assert.equal(m.canUndo(), false);
    assert.equal([...handlersForEditors()].length, 0);
  } finally {
    m?.destroy(); prototype.addEventListener = register;
  }
});
