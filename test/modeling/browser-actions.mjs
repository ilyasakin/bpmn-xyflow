/**
 * Native Chrome UI regressions for the modeling action menus.
 * Fixtures and a deterministic viewport are set through the public API. Every
 * action under test is a real Puppeteer mouse or keyboard input: no DOM event
 * dispatch, .click() evaluation, modeling API mutation, or page.select().
 * Run only in a browser-permitted environment; no sandbox-disabling flags.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const port = Number(process.env.BPMN_ACTIONS_PORT || 5231), base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['lib/demo/serve.mjs'], {
  env: {...process.env, PORT:String(port)}, stdio:['ignore','pipe','inherit']
});
child.stdout.on('data',()=>{});
const oracle = new BpmnModdle(), results = [];
let browser;
const shapeDI = (id,x,y,width=100,height=80,attrs='') => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" ${attrs}><dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}"/></bpmndi:BPMNShape>`;
const definitions = (roots,plane,graphics,extra='') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="UI_Definitions" targetNamespace="https://bpmn.io/schema/bpmn">
${roots}<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${plane}">${graphics}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>${extra}</bpmn:definitions>`;
const processFixture = (contents,graphics,extra='') => definitions(`<bpmn:process id="Process_1" isExecutable="false">${contents}</bpmn:process>`,'Process_1',graphics,extra);
const taskFixture = processFixture('<bpmn:task id="Task_1" name="Review order"/>',shapeDI('Task_1',300,180));
const flowFixture = processFixture('<bpmn:task id="Source"/><bpmn:task id="Target"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Source" targetRef="Target"/>',
  shapeDI('Source',250,220)+shapeDI('Target',650,220)+'<bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="350" y="260"/><di:waypoint x="650" y="260"/></bpmndi:BPMNEdge>');
const replacementFixture = processFixture('<bpmn:task id="Source"/><bpmn:intermediateThrowEvent id="Mid"/><bpmn:task id="Target"/><bpmn:sequenceFlow id="Incoming" sourceRef="Source" targetRef="Mid"/><bpmn:sequenceFlow id="Outgoing" sourceRef="Mid" targetRef="Target"/>',
  shapeDI('Source',250,220)+shapeDI('Mid',500,242,36,36)+shapeDI('Target',750,220)+
  '<bpmndi:BPMNEdge id="Incoming_di" bpmnElement="Incoming"><di:waypoint x="350" y="260"/><di:waypoint x="500" y="260"/></bpmndi:BPMNEdge><bpmndi:BPMNEdge id="Outgoing_di" bpmnElement="Outgoing"><di:waypoint x="536" y="260"/><di:waypoint x="750" y="260"/></bpmndi:BPMNEdge>');
const markersFixture = definitions('<bpmn:process id="Process_1"><bpmn:dataObject id="Data_1"/><bpmn:dataObjectReference id="DataRef" dataObjectRef="Data_1"/></bpmn:process><bpmn:collaboration id="Collaboration_1"><bpmn:participant id="Pool" processRef="Process_1"/></bpmn:collaboration>',
  'Collaboration_1',shapeDI('Pool',150,200,650,280)+shapeDI('DataRef',430,300,36,50));
const subprocessFixture = processFixture('<bpmn:subProcess id="Sub" name="Fulfil order"><bpmn:task id="Child" name="Pack order"/></bpmn:subProcess>',
  shapeDI('Sub',240,190,420,250,'isExpanded="true"')+shapeDI('Child',360,285),
  '<bpmndi:BPMNDiagram id="ChildDiagram"><bpmndi:BPMNPlane id="ChildPlane" bpmnElement="Sub"><bpmndi:BPMNShape id="Child_secondary_di" bpmnElement="Child"><dc:Bounds x="100" y="100" width="100" height="80"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>');
const geometryFixture = processFixture('<bpmn:task id="A"/><bpmn:task id="B"/><bpmn:task id="C"/>',
  shapeDI('A',250,250)+shapeDI('B',550,330)+shapeDI('C',1000,450));

async function readModel(page) {
  const xml = await page.evaluate(()=>window.modeler.getXML());
  const parsed = await oracle.fromXML(xml);
  assert.deepEqual(parsed.warnings,[],'independent bpmn-moddle must reopen exported XML without warnings');
  return {xml,parsed,byId:parsed.elementsById,di(id) {
    return parsed.rootElement.diagrams.flatMap(diagram=>diagram.plane.planeElement || []).find(element=>element.bpmnElement?.id===id);
  }};
}
async function graphPoint(page,x,y) {
  return page.evaluate(({x,y})=>{const m=window.modeler,v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{x:r.left+v.x+x*v.zoom,y:r.top+v.y+y*v.zoom};},{x,y});
}
async function clickShape(page,id,relative) {
  const point=await page.evaluate(({id,relative})=>{
    const m=window.modeler,n=m.getElement(id),v=m.getViewport(),r=m.getContainer().getBoundingClientRect();
    if(!n)throw new Error(`Missing shape ${id}`);
    const x=r.left+v.x+(n.x+(relative?.x??n.width/2))*v.zoom,y=r.top+v.y+(n.y+(relative?.y??n.height/2))*v.zoom;
    return{x,y,hit:document.elementFromPoint(x,y)?.closest('[data-element-id]')?.getAttribute('data-element-id')};
  },{id,relative});
  assert.equal(point.hit,id,`native click for ${id} must not be intercepted: ${JSON.stringify(point)}`);
  await page.mouse.click(point.x,point.y);
  assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[id]);
  return point;
}
async function clickText(page,selector,text) {
  await page.waitForSelector(selector);
  for(const element of await page.$$(selector)) {
    if((await element.evaluate(node=>node.textContent)).trim()===text){await element.click();return;}
  }
  throw new Error(`Missing visible ${selector} with text ${JSON.stringify(text)}`);
}
async function openShapeMenu(page,id,relative) {
  await clickShape(page,id,relative);
  await page.click('.bpmn-xyflow-context-pad button[title="Change type — opens a quick replace menu"]');
  await page.waitForSelector('.bpmn-xyflow-replace-menu [data-action]');
}
async function action(page,name) {
  await page.click(`.bpmn-xyflow-replace-menu [data-action="${name}"]`);
  await page.waitForSelector('.bpmn-xyflow-replace-menu',{hidden:true});
}
async function undo(page,expectedXML) {
  assert.equal(await page.$eval('#undo-btn',button=>button.disabled),false,'native Undo button is enabled');
  await page.click('#undo-btn');
  assert.equal((await readModel(page)).xml,expectedXML,'native undo restores exact semantic XML and DI');
}
async function redo(page,expectedXML) {
  assert.equal(await page.$eval('#redo-btn',button=>button.disabled),false,'native Redo button is enabled');
  await page.click('#redo-btn');
  assert.equal((await readModel(page)).xml,expectedXML,'native redo restores exact semantic XML and DI');
}
async function openFlowMenu(page) {
  const point=await graphPoint(page,500,260);
  const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-element-id]')?.getAttribute('data-element-id'),point);
  assert.equal(hit,'Flow_1','flow midpoint must be hit-testable');
  await page.mouse.click(point.x,point.y,{button:'right'});
  await clickText(page,'.bpmn-xyflow-context-menu > div','Change type…');
  await page.waitForSelector('.bpmn-xyflow-replace-menu [data-action]');
}
async function chooseSelectWithKeyboard(page,selector,index) {
  // Native select popup, then actual navigation keys. Avoid page.select(),
  // which synthesizes DOM change events instead of browser input.
  await page.click(selector);
  await page.keyboard.press('Home');
  for(let i=0;i<index;i++)await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
}
async function runCase(name,xml,run) {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:1600,height:1200});
  try {
    await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>!!window.modeler?.getGraph());
    const warnings=await page.evaluate(async xml=>{
      const m=window.modeler,result=await m.importXML(xml);
      m.setViewport({x:150,y:140,zoom:1});return result.warnings.map(warning=>warning.message);
    },xml);
    assert.deepEqual(warnings,[],'fixture import');
    await run(page);
    assert.deepEqual(errors,[],'no browser runtime errors');
    await page.screenshot({path:`test-artifacts/browser-actions-${name}-pass.png`,fullPage:true});
    await writeFile(`test-artifacts/browser-actions-${name}.bpmn`,(await readModel(page)).xml);
    results.push({name,status:'passed'});console.log(`PASS native UI actions: ${name}`);
  } catch(error) {
    results.push({name,status:'failed',error:error.stack||String(error),browserErrors:errors});
    console.error(`FAIL native UI actions ${name}: ${error.stack||error}`);
    await page.screenshot({path:`test-artifacts/browser-actions-${name}-failure.png`,fullPage:true}).catch(()=>{});
    const state=await page.evaluate(()=>window.modeler?.getXML()).catch(()=>null);
    if(state)await writeFile(`test-artifacts/browser-actions-${name}-failure.bpmn`,state);
  } finally {await page.close();}
}

try {
  const deadline=Date.now()+60000;
  while(true){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(child.exitCode!==null||Date.now()>deadline)throw new Error('UI action demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await puppeteer.launch({headless:'shell'});
  await mkdir('test-artifacts',{recursive:true});

  await runCase('boundary-palette-host-history',taskFixture,async page=>{
    await clickShape(page,'Task_1');
    await clickText(page,'.bpmn-xyflow-palette button','+ Boundary');
    await action(page,'replace-with-timer-boundary');
    const created=await readModel(page),boundary=Object.values(created.byId).find(element=>element.$type==='bpmn:BoundaryEvent');
    assert.ok(boundary,'palette created a boundary');
    assert.equal(boundary.attachedToRef.id,'Task_1');assert.equal(boundary.eventDefinitions[0].$type,'bpmn:TimerEventDefinition');
    assert.ok(created.di(boundary.id)?.bounds,'boundary DI persisted');
    await openShapeMenu(page,boundary.id);
    await action(page,'toggle-non-interrupting');
    const before=await readModel(page);assert.equal(before.byId[boundary.id].cancelActivity,false);
    const start=await clickShape(page,'Task_1');
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+60,start.y+40,{steps:8});await page.mouse.up();
    const moved=await readModel(page),oldHost=before.di('Task_1').bounds,newHost=moved.di('Task_1').bounds;
    const dx=newHost.x-oldHost.x,dy=newHost.y-oldHost.y;assert.ok(dx!==0||dy!==0,'native host drag moved');
    assert.equal(moved.di(boundary.id).bounds.x-before.di(boundary.id).bounds.x,dx);
    assert.equal(moved.di(boundary.id).bounds.y-before.di(boundary.id).bounds.y,dy);
    assert.equal(moved.byId[boundary.id].attachedToRef,moved.byId.Task_1);
    await undo(page,before.xml);await redo(page,moved.xml);
    await clickShape(page,'Task_1');await page.click('.bpmn-xyflow-context-pad button[title="Delete"]');
    const deleted=await readModel(page);assert.equal(deleted.byId.Task_1,undefined);assert.equal(deleted.byId[boundary.id],undefined);
    assert.equal(deleted.di(boundary.id),undefined);await undo(page,moved.xml);
  });

  await runCase('boundary-palette-drag-drop',taskFixture,async page=>{
    const before=await readModel(page);
    const drag=async(x,y)=>{
      const button=await page.$('.bpmn-xyflow-palette button[title="Select an activity and click to choose a boundary event, or drag onto its border"]');
      assert.ok(button);const box=await button.boundingBox(),point=await graphPoint(page,x,y);
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
      await page.mouse.move(point.x,point.y,{steps:10});await page.mouse.up();
    };
    await drag(400,220);
    const attached=await readModel(page),boundary=Object.values(attached.byId).find(element=>element.$type==='bpmn:BoundaryEvent');
    assert.ok(boundary,'native boundary palette drag attaches on host border');
    assert.equal(boundary.attachedToRef.id,'Task_1');assert.equal(boundary.eventDefinitions[0].$type,'bpmn:TimerEventDefinition');
    assert.equal(attached.di(boundary.id).bounds.x+18,400);assert.equal(attached.di(boundary.id).bounds.y+18,220);
    await undo(page,before.xml);
    const history=await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()}));
    await drag(350,220); // interior, not the activity border
    assert.equal((await readModel(page)).xml,before.xml,'invalid interior boundary drop is a no-op');
    assert.deepEqual(await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()})),history);
  });

  await runCase('boundary-context-menu',taskFixture,async page=>{
    const before=await readModel(page);await clickShape(page,'Task_1');
    await page.click('.bpmn-xyflow-context-pad button[title="Attach boundary event"]');
    await action(page,'replace-with-non-interrupting-timer-boundary');
    const state=await readModel(page),boundary=Object.values(state.byId).find(element=>element.$type==='bpmn:BoundaryEvent');
    assert.ok(boundary);assert.equal(boundary.cancelActivity,false);assert.equal(boundary.attachedToRef.id,'Task_1');
    assert.equal(boundary.eventDefinitions[0].$type,'bpmn:TimerEventDefinition');await undo(page,before.xml);
  });

  await runCase('flow-default-conditional-normal',flowFixture,async page=>{
    for(const type of ['default','conditional','normal']) {
      const before=await readModel(page);await openFlowMenu(page);
      await action(page,{'default':'replace-with-default-flow','conditional':'replace-with-conditional-flow','normal':'replace-with-sequence-flow'}[type]);
      const after=await readModel(page),source=after.byId.Source,flow=after.byId.Flow_1;
      assert.equal(source.default===flow,type==='default');
      assert.equal(!!flow.conditionExpression,type==='conditional');
      if(type==='conditional')assert.equal(flow.conditionExpression.$type,'bpmn:FormalExpression');
      assert.deepEqual(after.di('Flow_1').waypoint.map(p=>({x:p.x,y:p.y})),before.di('Flow_1').waypoint.map(p=>({x:p.x,y:p.y})));
      await undo(page,before.xml);await redo(page,after.xml);
    }
  });

  await runCase('event-replacement-prunes-invalid-edges',replacementFixture,async page=>{
    // The upstream menu does not offer Task -> Event. Use its actual supported
    // intermediate -> End/Start rows to exercise incoming/outgoing cleanup.
    const before=await readModel(page);
    for(const [actionName,type,kept,removed] of [
      ['replace-with-none-end','bpmn:EndEvent','Incoming','Outgoing'],
      ['replace-with-none-start','bpmn:StartEvent','Outgoing','Incoming']
    ]) {
      await openShapeMenu(page,'Mid');await action(page,actionName);
      const after=await readModel(page);assert.equal(after.byId.Mid.$type,type);
      assert.ok(after.byId[kept]);assert.ok(after.di(kept));
      assert.equal(after.byId[removed],undefined);assert.equal(after.di(removed),undefined);
      for(const element of Object.values(after.byId)) {
        if(element.$type==='bpmn:SequenceFlow') {
          assert.equal(element.sourceRef,after.byId[element.sourceRef.id]);
          assert.equal(element.targetRef,after.byId[element.targetRef.id]);
          assert.notEqual(element.sourceRef.$type,'bpmn:EndEvent','End event cannot retain outgoing sequence flow');
          assert.notEqual(element.targetRef.$type,'bpmn:StartEvent','Start event cannot retain incoming sequence flow');
        }
        for(const edge of [...(element.incoming||[]),...(element.outgoing||[])])assert.ok(after.byId[edge.id],'no stale inverse edge reference');
      }
      await undo(page,before.xml);await redo(page,after.xml);await undo(page,before.xml);
    }
  });

  await runCase('loop-multi-instance-headers',taskFixture,async page=>{
    for(const [name,type,sequential] of [
      ['toggle-loop','bpmn:StandardLoopCharacteristics'],
      ['toggle-parallel-mi','bpmn:MultiInstanceLoopCharacteristics',false],
      ['toggle-sequential-mi','bpmn:MultiInstanceLoopCharacteristics',true],
      ['toggle-sequential-mi',null]
    ]) {
      const before=await readModel(page);await openShapeMenu(page,'Task_1');
      assert.equal(await page.$eval(`[data-action="${name}"]`,node=>node.getAttribute('role')),'menuitemcheckbox');
      await action(page,name);const after=await readModel(page),loop=after.byId.Task_1.loopCharacteristics;
      assert.equal(loop?.$type||null,type);if(type==='bpmn:MultiInstanceLoopCharacteristics')assert.equal(loop.isSequential,sequential);
      assert.deepEqual(after.di('Task_1').bounds,before.di('Task_1').bounds);
      await undo(page,before.xml);await redo(page,after.xml);
    }
  });

  await runCase('collection-participant-multiplicity',markersFixture,async page=>{
    for(const [id,name,relative] of [['DataRef','toggle-is-collection'],['Pool','toggle-participant-multiplicity',{x:12,y:35}]]) {
      const before=await readModel(page);await openShapeMenu(page,id,relative);await action(page,name);
      const after=await readModel(page);
      if(id==='DataRef')assert.equal(after.byId.DataRef.dataObjectRef.isCollection,true);
      else assert.equal(after.byId.Pool.participantMultiplicity.$type,'bpmn:ParticipantMultiplicity');
      await undo(page,before.xml);await redo(page,after.xml);
      await openShapeMenu(page,id,relative);
      assert.equal(await page.$eval(`[data-action="${name}"]`,node=>node.getAttribute('aria-checked')),'true');
      await action(page,name);const toggled=await readModel(page);
      if(id==='DataRef')assert.equal(toggled.byId.DataRef.dataObjectRef.isCollection,false);
      else assert.equal(toggled.byId.Pool.participantMultiplicity,undefined);
      await undo(page,after.xml);
    }
  });

  await runCase('populated-replace-confirmation-history',subprocessFixture,async page=>{
    const before=await readModel(page);
    const open=async()=>{
      await clickShape(page,'Sub',{x:20,y:35});
      await page.click('.bpmn-xyflow-context-pad button[title="Replace and remove contents"]');
      await page.click('.bpmn-xyflow-replace-menu [data-action="replace-with-task"]');
      await page.waitForSelector('[role="dialog"][aria-label="Replace and remove contents"]');
    };
    await open();await clickText(page,'[role="dialog"] button','Cancel');
    assert.equal((await readModel(page)).xml,before.xml);assert.equal(await page.$eval('#undo-btn',node=>node.disabled),true);
    await open();await clickText(page,'[role="dialog"] button','Replace and remove contents');
    const replaced=await readModel(page);assert.equal(replaced.byId.Sub.$type,'bpmn:Task');assert.equal(replaced.byId.Child,undefined);
    assert.equal(replaced.parsed.rootElement.diagrams.length,1);assert.equal(replaced.di('Child'),undefined);
    await undo(page,before.xml);await redo(page,replaced.xml);await undo(page,before.xml);
  });

  await runCase('align-distribute-space-native',geometryFixture,async page=>{
    const before=await readModel(page);
    await clickShape(page,'A');await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');
    assert.deepEqual((await page.evaluate(()=>window.modeler.getSelection())).sort(),['A','B','C']);
    await chooseSelectWithKeyboard(page,'[aria-label="Align selection"]',4);
    const aligned=await readModel(page);assert.equal(aligned.di('A').bounds.y,aligned.di('B').bounds.y);assert.equal(aligned.di('B').bounds.y,aligned.di('C').bounds.y);
    await undo(page,before.xml);
    await chooseSelectWithKeyboard(page,'[aria-label="Distribute selection"]',1);
    const distributed=await readModel(page),[a,b,c]=['A','B','C'].map(id=>distributed.di(id).bounds);
    assert.equal(b.x-a.x-a.width,c.x-b.x-b.width);await undo(page,before.xml);
    const space='.bpmn-xyflow-editor-actions button[aria-pressed]';
    const history=await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()}));
    await page.click(space);assert.equal(await page.$eval(space,node=>node.getAttribute('aria-pressed')),'true');
    const start=await graphPoint(page,450,650);
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+80,start.y,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal((await readModel(page)).xml,before.xml);assert.equal(await page.$eval(space,node=>node.getAttribute('aria-pressed')),'false');
    assert.equal((await page.$$('.bpmn-xyflow-space-guide')).length,0);
    assert.deepEqual(await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()})),history);
    await page.click(space);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+80,start.y,{steps:6});await page.mouse.up();
    const spaced=await readModel(page);assert.equal(spaced.di('A').bounds.x,before.di('A').bounds.x);
    for(const id of ['B','C'])assert.equal(spaced.di(id).bounds.x,before.di(id).bounds.x+80);
    await undo(page,before.xml);
  });

  await writeFile('test-artifacts/browser-actions-results.json',JSON.stringify(results,null,2));
  const failed=results.filter(result=>result.status==='failed');
  assert.equal(failed.length,0,failed.map(result=>`${result.name}: ${result.error}`).join('\n'));
  console.log(`PASS all ${results.length} native browser action groups`);
} finally {
  await browser?.close();child.kill('SIGTERM');
}
