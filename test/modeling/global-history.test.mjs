import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle as Oracle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(async () => dom.cleanup());
async function create({ fitViewOnInit = false, file = 'test/fixtures/scenarios/order-payment-delivery.bpmn' } = {}) {
  const model = new Modeler({ container: dom.createContainer(), fitViewOnInit, palette: false });
  // Happy DOM cannot resolve the production SVG's percentage viewport lengths.
  model.getSvg().setAttribute('width', '1188'); model.getSvg().setAttribute('height', '762');
  const result = await model.importXML(await readFile(file, 'utf8'));
  assert.deepEqual(result.warnings, []);
  return model;
}
const root = m => m.getGraph().diagram.plane.bpmnElement.id;
async function visitChild(m) { assert.equal(await m.drillInto(m.getElement('Payment')), true); }
async function prepared(m) { await visitChild(m); await m.navigateBack(); return snapshot(m); }
async function oracle(m) { const result = await new Oracle().fromXML(await snapshot(m)); assert.deepEqual(result.warnings, []); return result; }
const geometry = node => ({ x: node.x, y: node.y, width: node.width, height: node.height });
let exportIndex = 0;
async function snapshot(model) {
  const xml = await model.getXML();
  if (process.env.BPMN_XML_ARTIFACT_DIR) {
    await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
    await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, `global-history-${++exportIndex}.bpmn`), xml);
  }
  return xml;
}

test('global chronological undo and redo activate the originating graph synchronously after Back', async () => {
  const m = await create();
  try {
    const baseline = await prepared(m), outerGraph = m.getGraph(), outer = m.getElement('ValidateOrder');
    m.updateLabel(outer, 'Outer one'); const one = await snapshot(m);
    assert.equal(one, baseline.replace('name="Validate order"', 'name="Outer one"'), 'unrelated model and raw metadata remain exact');
    await visitChild(m); const childGraph = m.getGraph(), child = m.getElement('CapturePayment');
    m.updateLabel(child, 'Child two'); const two = await snapshot(m);
    assert.equal(two, one.replace('name="Capture payment"', 'name="Child two"'));
    await m.navigateBack(); m.updateLabel(m.getElement('ValidateOrder'), 'Outer three'); const three = await snapshot(m);
    assert.equal(m.commandStack.size(), 3); m.select(outer.id);
    assert.equal(m.undo(), true); assert.equal(m.getGraph(), outerGraph); assert.deepEqual(m.getSelection(), [outer.id]); assert.equal(await snapshot(m), two);
    assert.equal(m.undo(), true); assert.equal(m.getGraph(), childGraph); assert.deepEqual(m.getSelection(), []); assert.equal(m.getElement(child.id), child); assert.equal(await snapshot(m), one); assert.equal(m.canNavigateBack(), true);
    assert.equal(m.undo(), true); assert.equal(m.getGraph(), outerGraph); assert.equal(await snapshot(m), baseline); assert.equal(m.canNavigateBack(), false); assert.equal(m.undo(), false);
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(m.redo(), true); assert.equal(m.getGraph(), outerGraph); assert.equal(await snapshot(m), one);
      assert.equal(m.redo(), true); assert.equal(m.getGraph(), childGraph); assert.equal(await snapshot(m), two);
      assert.equal(m.redo(), true); assert.equal(m.getGraph(), outerGraph); assert.equal(await snapshot(m), three);
      assert.equal(m.redo(), false);
      if (cycle < 2) { m.undo(); m.undo(); m.undo(); assert.equal(await snapshot(m), baseline); }
    }
    await oracle(m); await m.importXML(three); assert.equal(m.canUndo(), false); assert.equal(m.canRedo(), false); await visitChild(m); assert.equal(m.getElement('CapturePayment').businessObject.name, 'Child two');
  } finally { m.destroy(); }
});

test('navigation adds no command or redo invalidation; a new edit invalidates redo globally', async () => {
  const m = await create();
  try {
    const baseline = await prepared(m);
    await visitChild(m); m.updateLabel(m.getElement('CapturePayment'), 'First'); const edited = await snapshot(m);
    await m.navigateBack(); assert.equal(m.commandStack.size(), 1); assert.equal(m.undo(), true); assert.equal(await snapshot(m), baseline);
    await m.navigateBack(); await visitChild(m); await m.navigateBack(); assert.equal(m.canRedo(), true); assert.equal(m.redo(), true); assert.equal(await snapshot(m), edited);
    m.undo(); await m.navigateBack(); m.updateLabel(m.getElement('ValidateOrder'), 'New branch'); assert.equal(m.canRedo(), false);
    await visitChild(m); assert.equal(m.redo(), false); assert.equal(m.getElement('CapturePayment').businessObject.name, 'Capture payment');
    assert.equal(m.undo(), true); assert.equal(root(m), 'OrderCollaboration'); assert.equal(await snapshot(m), baseline);
  } finally { m.destroy(); }
});

test('compound child creation and dependent deletion remain atomic across roots with exact metadata and DI', async () => {
  const m = await create();
  try {
    await prepared(m); m.updateLabel(m.getElement('ValidateOrder'), 'Outer');
    await visitChild(m); const baseline = await snapshot(m); let node, edge;
    m.commandStack.compound('child pair', () => {
      node = m.addShape('bpmn:ScriptTask', { x: 900, y: 500 });
      m.updateProperties(node, { script: 'preserve <opaque> & script', scriptFormat: 'javascript' });
      edge = m.connect(m.getElement('CapturePayment'), node);
      m.updateLabel(edge, 'payment condition');
    });
    const edited = await snapshot(m), child = m.getGraph(); assert.equal(m.commandStack.size(), 2);
    await m.navigateBack(); assert.equal(m.undo(), true); assert.equal(m.getGraph(), child); assert.equal(await snapshot(m), baseline); assert.equal(m.getElement(node.id), null);
    assert.equal(m.redo(), true); assert.equal(await snapshot(m), edited); assert.equal(m.getElement(node.id), node); assert.equal(m.getElement(edge.id), edge);
    await m.navigateBack(); const beforeDelete = await snapshot(m); m.delete(m.getElement('Payment')); const deleted = await snapshot(m);
    assert.equal(m.undo(), true); assert.equal(root(m), 'OrderCollaboration'); assert.equal(await snapshot(m), beforeDelete);
    assert.equal(m.undo(), true); assert.equal(m.getGraph(), child); assert.equal(await snapshot(m), baseline);
    m.redo(); assert.equal(await snapshot(m), edited); m.redo(); assert.equal(root(m), 'OrderCollaboration'); assert.equal(await snapshot(m), deleted);
    m.undo(); await oracle(m);
  } finally { m.destroy(); }
});

test('collapse and child edits retain global chronology and original graph aliases through repeated history', async () => {
  const m = await create();
  try {
    const baseline = await prepared(m); await visitChild(m); const child = m.getElement('CapturePayment'), graph = m.getGraph(), before = geometry(child);
    m.moveShape(child, { x: 25, y: 20 }); const moved = await snapshot(m);
    await m.navigateBack(); const sub = m.getElement('Payment'); m.toggleExpanded(sub); const collapsed = await snapshot(m);
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(m.undo(), true); assert.equal(root(m), 'OrderCollaboration'); assert.equal(await snapshot(m), moved);
      assert.equal(m.undo(), true); assert.equal(m.getGraph(), graph); assert.equal(m.getElement(child.id), child); assert.deepEqual(geometry(child), before); assert.equal(await snapshot(m), baseline);
      assert.equal(m.redo(), true); assert.equal(await snapshot(m), moved);
      assert.equal(m.redo(), true); assert.equal(root(m), 'OrderCollaboration'); assert.equal(await snapshot(m), collapsed);
    }
    await oracle(m);
  } finally { m.destroy(); }
});

test('history restores latest per-root viewport and clears foreign selection without deferred fitting', async () => {
  const m = await create({ fitViewOnInit: true });
  try {
    await prepared(m); await m.setViewport({ x: 20, y: 30, zoom: .7 });
    m.updateLabel(m.getElement('ValidateOrder'), 'Outer');
    await visitChild(m); m.updateLabel(m.getElement('CapturePayment'), 'Child');
    const camera = { x: 77.25, y: -22.5, zoom: 1.3 }; await m.setViewport(camera); m.select('CapturePayment');
    await m.navigateBack(); const outerCamera = { x: -18.5, y: 100.25, zoom: .4 }; await m.setViewport(outerCamera); m.select('ValidateOrder');
    m.undo(); assert.equal(root(m), 'Payment'); assert.deepEqual(m.getViewport(), camera); assert.deepEqual(m.getSelection(), []);
    await new Promise(resolve => setTimeout(resolve, 25)); assert.deepEqual(m.getViewport(), camera);
    m.undo(); assert.equal(root(m), 'OrderCollaboration'); assert.deepEqual(m.getViewport(), outerCamera);
    m.redo(); m.redo(); assert.equal(root(m), 'Payment'); assert.deepEqual(m.getViewport(), camera);
    await m.navigateBack(); assert.deepEqual(m.getViewport(), outerCamera);
  } finally { m.destroy(); }
});

test('global history interruption rolls back an active outer gesture before replaying a child command', async () => {
  const m = await create();
  try {
    const baseline = await prepared(m); await visitChild(m); m.updateLabel(m.getElement('CapturePayment'), 'Child'); await m.navigateBack();
    const task = m.getElement('ValidateOrder'), before = geometry(task), view = m.getViewport();
    const p = { x: (task.x + 20) * view.zoom + view.x, y: (task.y + 20) * view.zoom + view.y };
    const mouse = (type, x, y) => new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    m.getContainer().querySelector(`[data-element-id="${task.id}"]`).dispatchEvent(mouse('mousedown', p.x, p.y));
    window.dispatchEvent(mouse('mousemove', p.x + 50, p.y + 30)); assert.notDeepEqual(geometry(task), before);
    assert.equal(m.commandStack.undo(), true); assert.deepEqual(geometry(task), before); assert.equal(root(m), 'Payment'); assert.equal(await snapshot(m), baseline);
    window.dispatchEvent(mouse('mouseup', p.x + 50, p.y + 30)); assert.equal(m.commandStack.size(), 0); assert.equal(await snapshot(m), baseline);
    m.redo(); await oracle(m);
  } finally { m.destroy(); }
});

test('existing collapsed planes have navigation-only exact XML and isolated instance/import lifecycles', async () => {
  const m = await create({ file: 'test/fixtures/bpmn/collapsed-sub-process.bpmn' }), other = await create();
  try {
    const before = await snapshot(m), diagrams = m.getDefinitions().diagrams.slice();
    await m.drillInto(m.getElement('collapsedProcess')); const child = m.getGraph().nodes.find(n => n.type === 'bpmn:Task');
    assert.ok(child); await m.navigateBack(); assert.equal(await snapshot(m), before); assert.deepEqual(m.getDefinitions().diagrams, diagrams); assert.equal(m.commandStack.size(), 0);
    await m.drillInto(m.getElement('collapsedProcess')); m.updateLabel(m.getElement(child.id), 'Child'); await m.navigateBack(); m.undo(); assert.equal(await snapshot(m), before);
    assert.equal(other.canUndo(), false); assert.equal(other.canNavigateBack(), false);
    await assert.rejects(m.importXML('<bad>')); assert.equal(m.canRedo(), true); assert.equal(m.canNavigateBack(), true);
    await m.importXML(before); assert.equal(m.canRedo(), false); assert.equal(m.canUndo(), false); assert.equal(m.canNavigateBack(), false);
    assert.equal(m.redo(), false); assert.equal(await snapshot(m), before);
  } finally { m.destroy(); other.destroy(); }
});

test('pending drill/Back fitting cannot pop history or overwrite a later synchronous history root', async () => {
  const m = await create({ fitViewOnInit: true });
  try {
    await prepared(m); m.updateLabel(m.getElement('ValidateOrder'), 'Outer before navigation'); const outerXML = await snapshot(m);
    const entering = m.drillInto(m.getElement('Payment'));
    assert.equal(m.undo(), false); assert.equal(m.commandStack.undo(), false); assert.equal(m.redo(), false); assert.equal(m.commandStack.size(), 1);
    assert.equal(await m.drillInto(m.getElement('CapturePayment')), false); assert.equal(await entering, true);
    const camera = { x: 23, y: 41, zoom: 1.7 }; await m.setViewport(camera);
    m.updateLabel(m.getElement('CapturePayment'), 'Child before Back'); const childXML = await snapshot(m);
    const leaving = m.navigateBack(); assert.equal(m.undo(), false); assert.equal(m.redo(), false); assert.equal(m.commandStack.size(), 2); assert.equal(await m.navigateBack(), false); assert.equal(await leaving, true);
    assert.equal(await snapshot(m), childXML); assert.equal(m.undo(), true); assert.equal(root(m), 'Payment'); assert.deepEqual(m.getViewport(), camera); assert.equal(await snapshot(m), outerXML);
    await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(root(m), 'Payment'); assert.deepEqual(m.getViewport(), camera); assert.equal(m.commandStack.size(), 1);
    const replacement = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8');
    const exiting = m.navigateBack(); const rejected = assert.rejects(exiting, { name: 'AbortError' }); const importing = m.importXML(replacement);
    await rejected; await importing;
    assert.equal(m.canUndo(), false); assert.equal(m.canRedo(), false); assert.equal(m.canNavigateBack(), false); assert.ok(m.getElement('Task_1'));
  } finally { m.destroy(); }
});

test('cross-root history retains unchanged edge docking metadata beyond serialized DI', async () => {
  const m = await create();
  try {
    await prepared(m); const outer = m.getGraph(), edge = m.getElement('SellerFlow1');
    m.updateWaypoints(edge, edge.waypoints.map((p, i) => ({ x: p.x, y: p.y + 1, original: { x: p.x, y: p.y + 1, tag: `docking-${i}` } })));
    const points = structuredClone(edge.waypoints), baseline = await snapshot(m); m.updateLabel(m.getElement('ValidateOrder'), 'Outer metadata check'); const one = await snapshot(m);
    await visitChild(m); m.updateLabel(m.getElement('CapturePayment'), 'Child metadata check'); const two = await snapshot(m);
    for (let cycle = 0; cycle < 3; cycle++) {
      m.undo(); assert.equal(await snapshot(m), one); m.undo(); assert.equal(m.getGraph(), outer); assert.equal(await snapshot(m), baseline); assert.deepEqual(edge.waypoints, points);
      m.redo(); assert.deepEqual(edge.waypoints, points); m.redo(); assert.equal(await snapshot(m), two);
    }
    await m.navigateBack(); assert.deepEqual(edge.waypoints, points); await oracle(m);
  } finally { m.destroy(); }
});


test('mixed-root replacement/delete preserves declared references, opaque metadata and DI array identities', async () => {
 const audit={name:'Audit',uri:'urn:global:audit',prefix:'audit',types:[{name:'Links',extends:['bpmn:BaseElement'],properties:[{name:'watch',type:'bpmn:BaseElement',isReference:true,isAttr:true}]}]};
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,moddleExtensions:{audit}});
 try{
  let input=await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8');
  input=input.replace('targetNamespace=', 'xmlns:v="urn:global:opaque" targetNamespace=')
    .replace(/(<bpmn:subProcess\b[^>]*id="Payment"[^>]*>)/,'$1<bpmn:extensionElements><v:record>before<!--global-token-->after<?global retain?></v:record></bpmn:extensionElements>');
  await m.importXML(input);const outer=m.getElement('ValidateOrder'),outerBo=outer.businessObject;
  await m.drillInto(m.getElement('Payment'));const child=m.getElement('CapturePayment'),oldChildBo=child.businessObject,childGraph=m.getGraph();
  const property=m.getModdle().create('bpmn:Property',{id:'GlobalProperty'});property.$parent=oldChildBo;oldChildBo.properties=[property];
  outerBo.watch=oldChildBo;oldChildBo.watch=property;property.watch=oldChildBo;
  await m.navigateBack();const rootGraph=m.getGraph(),defs=m.getDefinitions(),diagramArray=defs.diagrams,diagrams=diagramArray.slice();
  const planeArrays=diagrams.map(d=>({plane:d.plane,array:d.plane.planeElement,entries:d.plane.planeElement.slice()}));
  const baseline=await snapshot(m);m.updateLabel(outer,'Outer');const one=await snapshot(m);
  await m.drillInto(m.getElement('Payment'));m.commandStack.compound('rich child',()=>{assert.equal(m.replace(child,'bpmn:ServiceTask'),child);m.updateLabel(child,'Child');});
  const changedBo=child.businessObject,two=await snapshot(m);assert.equal(outerBo.watch,changedBo);assert.equal(changedBo.watch,property);assert.equal(property.watch,changedBo);
  await m.navigateBack();m.delete(m.getElement('Payment'));const three=await snapshot(m);assert.equal(outerBo.watch,undefined);
  for(let i=0;i<3;i++){
   m.undo();assert.equal(m.getGraph(),rootGraph);assert.equal(await snapshot(m),two);assert.equal(outerBo.watch,changedBo);
   m.undo();assert.equal(m.getGraph(),childGraph);assert.equal(await snapshot(m),one);assert.equal(child.businessObject,oldChildBo);assert.equal(property.$parent,oldChildBo);assert.equal(property.watch,oldChildBo);assert.equal(outerBo.watch,oldChildBo);
   m.undo();assert.equal(m.getGraph(),rootGraph);assert.equal(await snapshot(m),baseline);assert.equal(defs.diagrams,diagramArray);assert.deepEqual(diagramArray,diagrams);
   for(const d of planeArrays){assert.equal(d.plane.planeElement,d.array);assert.deepEqual(d.array,d.entries);}
   m.redo();assert.equal(await snapshot(m),one);m.redo();assert.equal(await snapshot(m),two);m.redo();assert.equal(await snapshot(m),three);
  }
  m.undo();const exported=await snapshot(m);assert.ok(exported.includes('before<!--global-token-->after<?global retain?>'));
  const oracle=await new Oracle({audit}).fromXML(exported);assert.deepEqual(oracle.warnings,[]);assert.equal(oracle.elementsById.ValidateOrder.watch,oracle.elementsById.CapturePayment);assert.equal(oracle.elementsById.GlobalProperty.watch,oracle.elementsById.CapturePayment);
 } finally { m.destroy(); }
});
