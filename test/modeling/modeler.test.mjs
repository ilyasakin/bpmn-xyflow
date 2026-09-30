import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setupDOM } from '../helpers/dom.mjs';
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
  assert.equal(input.businessObject.targetRef.$type,'bpmn:DataInput');
  assert.equal(output.businessObject.sourceRef[0].$type,'bpmn:DataOutput');
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

const {assertScenario}=await import('../helpers/assert-scenarios.mjs');
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
