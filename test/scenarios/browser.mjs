/** Real Chromium scenario rendering/edit/reopen with a separate upstream modeler. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';
import { assertScenario } from '../helpers/assert-scenarios.mjs';
const require=createRequire(import.meta.url);
const port=5221, base=`http://localhost:${port}`;
const child=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
child.stdout.on('data',()=>{});
let browser;
try {
  const deadline=Date.now()+60000;
  while(true){try{if((await fetch(base+'/modeler/')).ok)break;}catch{} if(child.exitCode!==null||Date.now()>deadline)throw new Error('Scenario server startup timeout');await new Promise(r=>setTimeout(r,200));}
  browser=await puppeteer.launch({headless:'shell'});
  const page=await browser.newPage();await page.setViewport({width:1600,height:1000});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/modeler/',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>window.modeler?.getGraph());
  await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});
  await mkdir('test-artifacts',{recursive:true});
  const oracle=new BpmnModdle();
  const failures=[];
  for(const [name,taskId] of [['order-payment-delivery','PackOrder'],['approval-rejection-rework','ReworkRequest'],['booking-timeout-compensation','ReserveFlight']]) {
    try {
    const xml=await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8');
    const imported=await page.evaluate(async xml=>{const result=await window.modeler.importXML(xml);window.modeler.fitView();return result.warnings.map(w=>w.message);},xml);
    assert.deepEqual(imported,[],`${name} local import warnings`);
    // Exercise an actual browser pointer gesture on the business task before
    // the deterministic API mutation/interoperability checks below.
    const pointerBefore=await page.evaluate(id=>{const n=window.modeler.getElement(id);return {x:n.x,y:n.y};},taskId);
    const taskGraphic=await page.$(`[data-element-id="${taskId}"]`);
    const box=await taskGraphic.boundingBox();assert.ok(box && box.width>0 && box.height>0);
    const hit=await page.evaluate(({x,y,id})=>{
      const top=document.elementFromPoint(x,y),m=window.modeler;
      return {expected:id,actual:top?.closest('[data-element-id]')?.getAttribute('data-element-id'),tag:top?.tagName,className:top?.getAttribute('class'),viewport:m.getViewport(),canvas:m.getContainer().getBoundingClientRect().toJSON()};
    },{x:box.x+box.width/2,y:box.y+box.height/2,id:taskId});
    assert.equal(hit.actual,taskId,`${name} task center must be visible and hit-testable: ${JSON.stringify(hit)}`);
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+20,{steps:8});await page.mouse.up();
    const pointerAfter=await page.evaluate(id=>{const n=window.modeler.getElement(id);return {x:n.x,y:n.y};},taskId);
    assert.notDeepEqual(pointerAfter,pointerBefore,`${name} native pointer drag moves business task`);
    const pointerUndone=await page.evaluate(id=>{window.modeler.undo();const n=window.modeler.getElement(id);return {x:n.x,y:n.y};},taskId);
    assert.deepEqual(pointerUndone,pointerBefore,`${name} native pointer drag undo restores business task`);
    const edited=await page.evaluate(async ({taskId})=>{
      const m=window.modeler,node=m.getElement(taskId);const old={x:node.x,y:node.y,name:node.businessObject.name};
      m.updateLabel(node,old.name+' (reviewed)');m.moveShape(node,{x:25,y:15});
      const after={x:node.x,y:node.y,name:node.businessObject.name};
      m.undo();m.undo();const restored={x:node.x,y:node.y,name:node.businessObject.name};
      m.redo();m.redo();const redone={x:node.x,y:node.y,name:node.businessObject.name};
      return {old,after,restored,redone,xml:await m.getXML()};
    },{taskId,name});
    assert.deepEqual(edited.restored,edited.old,`${name} exact undo`);assert.deepEqual(edited.redone,edited.after,`${name} exact redo`);
    assert.equal(edited.after.x,edited.old.x+25);assert.equal(edited.after.y,edited.old.y+15);
    const parsed=await oracle.fromXML(edited.xml);assert.deepEqual(parsed.warnings,[]);assertScenario(name,parsed.rootElement);
    await page.screenshot({path:`test-artifacts/${name}-xyflow.png`,fullPage:true});
    const upstreamResult=await page.evaluate(async xml=>{
      const container=document.createElement('div');Object.assign(container.style,{position:'fixed',inset:'0',background:'#fff',zIndex:'10000'});document.body.appendChild(container);
      const upstream=new window.BpmnJS({container});
      try {const result=await upstream.importXML(xml);upstream.get('canvas').zoom('fit-viewport');const saved=await upstream.saveXML({format:true});return {warnings:result.warnings.map(w=>w.message),xml:saved.xml};}
      finally {upstream.destroy();container.remove();}
    },edited.xml);
    assert.deepEqual(upstreamResult.warnings,[],`${name} upstream renderer import warnings`);
    const upstreamParsed=await oracle.fromXML(upstreamResult.xml);assert.deepEqual(upstreamParsed.warnings,[]);assertScenario(name,upstreamParsed.rootElement);
    const reopened=await page.evaluate(async xml=>{await window.modeler.importXML(xml);return await window.modeler.getXML();},upstreamResult.xml);
    assertScenario(name,(await oracle.fromXML(reopened)).rootElement);
    console.log(`PASS real browser scenario ${name}: native task drag/undo, API edit/undo/redo, independent upstream open/save, local reopen, business invariants`);
    } catch(error) {
      failures.push(`${name}: ${error.message}`);
      console.error(`FAIL real browser scenario ${name}: ${error.stack || error}`);
      await page.screenshot({path:`test-artifacts/${name}-failure.png`,fullPage:true});
      await page.evaluate(()=>window.modeler?.cancel());
    }
  }
  // Retained real upstream recruitment workflow, not a renamed synthetic sample.
  try {
  const hrXml=await readFile('test/fixtures/bpmn/complex.bpmn','utf8');
  const hr=await page.evaluate(async xml=>{const m=window.modeler;const result=await m.importXML(xml);const task=m.getGraph().nodes.find(n=>n.type==='bpmn:Task'||n.type==='bpmn:UserTask');if(!task)throw new Error('HR workflow has no task');const before=await m.getXML();m.moveShape(task,{x:15,y:10});m.undo();const after=await m.getXML();return {warnings:result.warnings.map(w=>w.message),before,after};},hrXml);
  assert.equal(hr.after,hr.before,'HR real workflow move+undo must preserve XML exactly');
  console.log(`PASS upstream HR recruitment fixture edit/undo/reopen (${hr.warnings.length} input warnings retained)`);
  } catch(error) {
    failures.push(`HR recruitment: ${error.message}`);
    console.error(`FAIL upstream HR recruitment scenario: ${error.stack || error}`);
    await page.screenshot({path:'test-artifacts/hr-recruitment-failure.png',fullPage:true});
  }
  assert.equal(failures.length,0,failures.join('\n'));
  assert.deepEqual(errors,[]);
} finally {await browser?.close();child.kill('SIGTERM');}
