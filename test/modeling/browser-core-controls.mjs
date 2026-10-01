/**
 * Native Chrome coverage for navigation, append, lanes, insertion and clipboard.
 * Authoritative business fixtures are read unchanged; two explicitly derived
 * fixtures remove lane containers or add one disconnected audit task for setup.
 * Every action being tested uses actual browser mouse/keyboard input. Public
 * APIs are limited to import/setup and read-only observations. No local browser
 * fallback or sandbox-disabling launch flags are used.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const port=Number(process.env.BPMN_CORE_CONTROLS_PORT||5237),base=`http://localhost:${port}`;
const oracle=new BpmnModdle(),results=[];let browser,child,serverOutput='';
const order=await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8');
const approval=await readFile('test/fixtures/scenarios/approval-rejection-rework.bpmn','utf8');
const back='[data-action="navigate-back"]';
const semanticElements=model=>Object.values(model.byId).filter(element=>element.$instanceOf?.('bpmn:BaseElement'));
const flows=model=>semanticElements(model).filter(element=>element.$type==='bpmn:SequenceFlow');
const docs=element=>(element.documentation||[]).map(doc=>({text:doc.text,textFormat:doc.textFormat}));
const xy=bounds=>({x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height});

async function derivedApproval({withoutLanes=false,auditTask=false}={}) {
  const {rootElement, elementsById, warnings}=await oracle.fromXML(approval);assert.deepEqual(warnings,[]);
  const process=elementsById.ApprovalProcess,plane=rootElement.diagrams[0].plane;
  if(withoutLanes){process.laneSets=[];plane.planeElement=plane.planeElement.filter(di=>di.bpmnElement.$type!=='bpmn:Lane');}
  if(auditTask){
    const task=oracle.create('bpmn:Task',{id:'AuditInsertion',name:'Record approval audit',documentation:[oracle.create('bpmn:Documentation',{text:'Keep the approval decision and its original expression attached to the incoming branch.'})]});
    task.$parent=process;task.documentation[0].$parent=task;process.flowElements.push(task);
    const di=oracle.create('bpmndi:BPMNShape',{id:'AuditInsertion_di',bpmnElement:task,bounds:oracle.create('dc:Bounds',{x:280,y:570,width:120,height:80})});
    di.$parent=plane;di.bounds.$parent=di;plane.planeElement.push(di);
  }
  return (await oracle.toXML(rootElement,{format:true})).xml;
}
async function readModel(page) {
  const xml=await page.evaluate(()=>window.modeler.getXML()),parsed=await oracle.fromXML(xml);
  assert.deepEqual(parsed.warnings,[],'independent bpmn-moddle parses the exported model without warnings');
  const byId=parsed.elementsById,allDi=parsed.rootElement.diagrams.flatMap(diagram=>diagram.plane.planeElement||[]);
  for(const element of Object.values(byId)) {
    if(element.$type==='bpmn:SequenceFlow'){
      assert.equal(element.sourceRef,byId[element.sourceRef?.id],'flow source resolves in the exported document');
      assert.equal(element.targetRef,byId[element.targetRef?.id],'flow target resolves in the exported document');
      assert.ok(element.sourceRef&&element.targetRef,'no dangling sequence flow');
      assert.notEqual(element.sourceRef.$type,'bpmn:EndEvent');assert.notEqual(element.targetRef.$type,'bpmn:StartEvent');
      assert.ok(allDi.some(di=>di.bpmnElement===element&&di.waypoint?.length>=2),'semantic flow has DI');
    }
    for(const ref of [...(element.incoming||[]),...(element.outgoing||[]),...(element.flowNodeRef||[])])assert.equal(byId[ref.id],ref,'inverse/lane reference resolves');
    if(element.default)assert.equal(byId[element.default.id],element.default,'default reference resolves');
  }
  return{xml,parsed,byId,di:id=>allDi.find(di=>di.bpmnElement?.id===id),dis:id=>allDi.filter(di=>di.bpmnElement?.id===id)};
}
async function history(page){return page.evaluate(()=>({size:window.modeler.commandStack.size(),undo:window.modeler.canUndo(),redo:window.modeler.canRedo()}));}
async function graphPoint(page,x,y){return page.evaluate(({x,y})=>{const m=window.modeler,v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{x:r.left+v.x+x*v.zoom,y:r.top+v.y+y*v.zoom};},{x,y});}
async function expectHit(page,point,id){assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-element-id]')?.getAttribute('data-element-id')??null,point),id,`native pointer must hit ${id??'background'} at ${JSON.stringify(point)}`);}
async function shapePoint(page,id,relative){const n=await page.evaluate(id=>{const n=window.modeler.getElement(id);if(!n)throw new Error(`Missing visible shape ${id}`);return{x:n.x,y:n.y,width:n.width,height:n.height};},id);return graphPoint(page,n.x+(relative?.x??n.width/2),n.y+(relative?.y??n.height/2));}
async function clickShape(page,id,relative,{add=false}={}) {
  const p=await shapePoint(page,id,relative);await expectHit(page,p,id);
  if(add)await page.keyboard.down('Control');
  try{await page.mouse.click(p.x,p.y);}finally{if(add)await page.keyboard.up('Control');}
  if(!add)assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[id]);
  return p;
}
async function elementWithText(page,selector,text){await page.waitForSelector(selector);for(const element of await page.$$(selector))if((await element.evaluate(node=>node.textContent)).trim()===text)return element;throw new Error(`Missing native control ${selector} with text ${text}`);}
async function clickText(page,selector,text){await (await elementWithText(page,selector,text)).click();}
async function context(page,id,relative){const p=await shapePoint(page,id,relative);await expectHit(page,p,id);await page.mouse.click(p.x,p.y,{button:'right'});await page.waitForSelector('.bpmn-xyflow-context-menu');}
async function shortcut(page,key,{shift=false}={}){await page.keyboard.down('Control');if(shift)await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');await page.keyboard.up('Control');}}
async function rename(page,id,name){const p=await shapePoint(page,id);await expectHit(page,p,id);await page.mouse.click(p.x,p.y,{count:2,delay:50});await page.waitForSelector('[contenteditable="plaintext-only"], [contenteditable="true"]');await shortcut(page,'a');await page.keyboard.type(name);await page.keyboard.press('Enter');await page.waitForSelector('[contenteditable="plaintext-only"], [contenteditable="true"]',{hidden:true});assert.equal((await readModel(page)).byId[id].name,name);}
async function undo(page,xml){assert.equal(await page.$eval('#undo-btn',button=>button.disabled),false);await page.click('#undo-btn');if(xml!==undefined)assert.equal((await readModel(page)).xml,xml,'native Undo restores exact XML and DI');}
async function redo(page,xml){assert.equal(await page.$eval('#redo-btn',button=>button.disabled),false);await page.click('#redo-btn');if(xml!==undefined)assert.equal((await readModel(page)).xml,xml,'native Redo restores exact XML and DI');}
async function drag(page,start,end,{shift=false,cancel=false}={}){if(shift)await page.keyboard.down('Shift');try{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});if(shift)await page.keyboard.up('Shift');}}
async function currentRoot(page,id){await page.waitForFunction(id=>window.modeler.getGraph()?.diagram?.plane?.bpmnElement?.id===id,{},id);}
async function drill(page){await context(page,'Payment',{x:20,y:35});await clickText(page,'.bpmn-xyflow-context-menu > div','Drill into sub-process');await currentRoot(page,'Payment');await page.waitForSelector(back,{visible:true});assert.equal(await page.$eval(back,button=>button.disabled),false);}
async function returnToParent(page){await page.click(back);await currentRoot(page,'OrderCollaboration');await page.waitForSelector(back,{hidden:true});}
async function edgeMidpoint(page,id){const points=await page.evaluate(id=>window.modeler.getElement(id).waypoints.map(p=>({x:p.x,y:p.y})),id);const a=points[0],b=points[1];return graphPoint(page,(a.x+b.x)/2,(a.y+b.y)/2);}
async function paletteTaskDrag(page,end,options){const button=await elementWithText(page,'.bpmn-xyflow-palette button','+ Task'),box=await button.boundingBox();assert.ok(box,'Task palette button is visible');await drag(page,{x:box.x+box.width/2,y:box.y+box.height/2},end,options);}
function condition(flow){const expression=flow.conditionExpression;return expression?{type:expression.$type,body:expression.body,language:expression.language}:null;}
function assertApprovalMetadata(before,after){assert.equal(after.byId.ApprovalDecision.default.id,before.byId.ApprovalDecision.default.id);assert.deepEqual(condition(after.byId.ApproveFlow),condition(before.byId.ApproveFlow));assert.equal(after.byId.ApproveFlow.name,before.byId.ApproveFlow.name);assert.equal(after.byId.RejectFlow.name,before.byId.RejectFlow.name);}
async function runCase(name,xml,run,{zoom=.85}={}){
  const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1800,height:1200});
  try{
    await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
    const warnings=await page.evaluate(async({xml,zoom})=>{const modeler=window.modeler,result=await modeler.importXML(xml);await modeler.setViewport({x:160,y:120,zoom},{duration:0});return result.warnings.map(warning=>warning.message);},{xml,zoom});assert.deepEqual(warnings,[],'fixture import');
    await run(page);assert.deepEqual(errors,[],'no browser errors');const after=await readModel(page);
    await writeFile(`test-artifacts/browser-core-controls-${name}.bpmn`,after.xml);await page.screenshot({path:`test-artifacts/browser-core-controls-${name}-pass.png`,fullPage:true});
    results.push({name,status:'passed'});console.log(`PASS native core controls ${name}`);
  }catch(error){const result={name,status:'failed',error:error.stack||String(error),browserErrors:errors};results.push(result);console.error(`FAIL native core controls ${name}: ${result.error}`);
    await page.screenshot({path:`test-artifacts/browser-core-controls-${name}-failure.png`,fullPage:true}).catch(()=>{});const xml=await page.evaluate(()=>window.modeler?.getXML()).catch(()=>null);if(xml)await writeFile(`test-artifacts/browser-core-controls-${name}-failure.bpmn`,xml);
  }finally{await page.close();}
}

try{
  child=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});child.stdout.on('data',chunk=>{serverOutput+=String(chunk);});
  const deadline=Date.now()+60000;while(true){const actual=serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);if(actual&&Number(actual[1])!==port)throw Error(`Core controls server bound unexpected port ${actual[1]}`);try{if(actual&&(await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(child.exitCode!==null||Date.now()>deadline)throw new Error('Core controls demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});await mkdir('test-artifacts',{recursive:true});

  await runCase('order-drill-child-edit-back-history',order,async page=>{
    const original=await readModel(page),documentation=docs(original.byId.CapturePayment);
    assert.ok(documentation[0].text.includes('failed charge'),'real payment metadata is present');
    assert.equal(await page.$eval(back,button=>button.hidden),true,'Back is hidden at root');
    await rename(page,'ValidateOrder','Validate order and address');
    await drill(page);
    assert.equal(await page.evaluate(()=>!!window.modeler.getGraph().nodes.find(node=>node.id==='SellerPool')),false,'child view excludes outer collaborators');
    await rename(page,'CapturePayment','Capture reviewed payment');
    await returnToParent(page);
    let model=await readModel(page);assert.equal(model.byId.CapturePayment.name,'Capture reviewed payment');assert.deepEqual(docs(model.byId.CapturePayment),documentation);
    const bothEdits=model.xml;
    await undo(page);await currentRoot(page,'Payment');model=await readModel(page);assert.equal(model.byId.CapturePayment.name,original.byId.CapturePayment.name);assert.equal(model.byId.ValidateOrder.name,'Validate order and address','Undo follows global chronology');
    assert.equal(await page.$eval(back,button=>button.hidden),false,'history root switch restores Back');
    const outerEdit=model.xml;
    await undo(page);await currentRoot(page,'OrderCollaboration');model=await readModel(page);assert.equal(model.byId.ValidateOrder.name,original.byId.ValidateOrder.name);assert.equal(model.byId.CapturePayment.name,original.byId.CapturePayment.name);
    await redo(page,outerEdit);await currentRoot(page,'OrderCollaboration');
    await redo(page,bothEdits);await currentRoot(page,'Payment');await returnToParent(page);assert.equal((await readModel(page)).xml,bothEdits);
    await drill(page);await returnToParent(page);await undo(page);await currentRoot(page,'Payment');assert.equal((await readModel(page)).xml,outerEdit,'navigation adds no history entry');
    await redo(page,bothEdits);await returnToParent(page);assert.equal((await readModel(page)).xml,bothEdits);
  });

  // Materialize this fork's expanded-subprocess drill plane before taking the
  // exact history baseline. Existing-plane navigation itself must be a no-op.
  async function prepareHistory(page){await drill(page);await returnToParent(page);const before=await readModel(page);assert.deepEqual(await history(page),{size:0,undo:false,redo:false});return before;}
  async function reopenHistory(page,expected){
    const view=await page.evaluate(()=>({diagramId:window.modeler.getGraph().diagram.id,viewport:window.modeler.getViewport()}));
    const warnings=await page.evaluate(async({xml,view})=>{const result=await window.modeler.importXML(xml,view.diagramId);await window.modeler.setViewport(view.viewport,{duration:0});return result.warnings.map(w=>w.message);},{xml:expected.xml,view});
    assert.deepEqual(warnings,[]);assert.equal((await readModel(page)).xml,expected.xml,'edited export reimports with exact semantic/DI/raw XML');assert.deepEqual(await history(page),{size:0,undo:false,redo:false});
  }
  await runCase('global-history-delete-parent-and-child-replay',order,async page=>{
    const baseline=await prepareHistory(page);await drill(page);await rename(page,'CapturePayment','Reviewed charge');const edited=await readModel(page);
    assert.equal(edited.xml,baseline.xml.replace('name="Capture payment"','name="Reviewed charge"'),'only the selected semantic title changed');
    await returnToParent(page);await clickShape(page,'Payment',{x:20,y:35});await page.click('.bpmn-xyflow-context-pad button[title="Delete"]');
    const deleted=await readModel(page);assert.equal(deleted.byId.Payment,undefined);assert.equal(deleted.byId.CapturePayment,undefined);assert.equal((await history(page)).size,2,'cascaded parent deletion is one compound history entry');
    for(let cycle=0;cycle<3;cycle++){
      await undo(page,edited.xml);await currentRoot(page,'OrderCollaboration');
      await undo(page,baseline.xml);await currentRoot(page,'Payment');assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[]);
      await redo(page,edited.xml);await currentRoot(page,'Payment');
      await redo(page,deleted.xml);await currentRoot(page,'OrderCollaboration');
    }
    await undo(page,edited.xml);await drill(page);assert.equal((await readModel(page)).xml,edited.xml);await reopenHistory(page,edited);
  });
  await runCase('global-history-collapse-and-new-branch',order,async page=>{
    const baseline=await prepareHistory(page);await drill(page);await rename(page,'CapturePayment','Captured and audited');const edited=await readModel(page);await returnToParent(page);
    await context(page,'Payment',{x:20,y:35});await clickText(page,'.bpmn-xyflow-context-menu > div','Toggle expanded / collapsed');const collapsed=await readModel(page);assert.equal(collapsed.di('Payment').isExpanded,false);assert.equal((await history(page)).size,2);
    await undo(page,edited.xml);await currentRoot(page,'OrderCollaboration');await undo(page,baseline.xml);await currentRoot(page,'Payment');
    await redo(page,edited.xml);await redo(page,collapsed.xml);await currentRoot(page,'OrderCollaboration');
    await undo(page,edited.xml);await undo(page,baseline.xml);await currentRoot(page,'Payment');await returnToParent(page);
    await rename(page,'ValidateOrder','Revised outer branch');assert.equal((await history(page)).redo,false,'a new outer edit invalidates both child and collapse redo');
    const branched=await readModel(page);assert.equal(branched.xml,baseline.xml.replace('name="Validate order"','name="Revised outer branch"'));
    await drill(page);assert.equal((await history(page)).redo,false);await undo(page,baseline.xml);await currentRoot(page,'OrderCollaboration');await redo(page,branched.xml);await reopenHistory(page,branched);
  });
  await runCase('global-history-viewport-and-active-drag-interruption',order,async page=>{
    const baseline=await prepareHistory(page);await rename(page,'ValidateOrder','Outer before charge');const outerEdit=await readModel(page);await drill(page);await rename(page,'CapturePayment','Child before cancellation');const both=await readModel(page);
    async function wheelZoom(id){const before=await page.evaluate(()=>window.modeler.getViewport()),p=await shapePoint(page,id);await expectHit(page,p,id);await page.mouse.move(p.x,p.y);await page.keyboard.down('Control');try{await page.mouse.wheel({deltaY:-180});}finally{await page.keyboard.up('Control');}await page.waitForFunction(before=>Math.abs(window.modeler.getViewport().zoom-before.zoom)>1e-6,{},before);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.evaluate(()=>window.modeler.getViewport());}
    const childCamera=await wheelZoom('CapturePayment');assert.equal((await readModel(page)).xml,both.xml);assert.equal((await history(page)).size,2);
    await returnToParent(page);const outerCamera=await wheelZoom('ValidateOrder');assert.equal((await readModel(page)).xml,both.xml);
    const beforeBounds=await page.evaluate(()=>{const n=window.modeler.getElement('ValidateOrder');return{x:n.x,y:n.y};}),start=await shapePoint(page,'ValidateOrder');await expectHit(page,start,'ValidateOrder');
    await page.mouse.move(start.x,start.y);await page.mouse.down();try{
      await page.mouse.move(start.x+55,start.y+35,{steps:12});assert.notDeepEqual(await page.evaluate(()=>{const n=window.modeler.getElement('ValidateOrder');return{x:n.x,y:n.y};}),beforeBounds,'the interrupted shape gesture had a nonzero preview');
      await shortcut(page,'z');await currentRoot(page,'Payment');assert.equal((await readModel(page)).xml,outerEdit.xml);assert.deepEqual(await page.evaluate(()=>window.modeler.getViewport()),childCamera);
    }finally{await page.mouse.up().catch(()=>{});}
    assert.equal((await readModel(page)).xml,outerEdit.xml);assert.equal((await history(page)).size,1,'releasing the interrupted drag adds no entry');
    await undo(page,baseline.xml);await currentRoot(page,'OrderCollaboration');assert.deepEqual(await page.evaluate(()=>window.modeler.getViewport()),outerCamera);
    await redo(page,outerEdit.xml);await redo(page,both.xml);await currentRoot(page,'Payment');assert.deepEqual(await page.evaluate(()=>window.modeler.getViewport()),childCamera);await reopenHistory(page,both);
  });

  for(const mode of ['context-pad','context-drag','right-click'])await runCase(`valid-append-${mode}`,approval,async page=>{
    const before=await readModel(page);
    if(mode.startsWith('context-')){
      await clickShape(page,'SubmitRequest');const selector='.bpmn-xyflow-context-pad [data-action="append.append-task"]';
      if(mode==='context-pad')await page.click(selector);
      else{const button=await page.waitForSelector(selector),box=await button.boundingBox(),drop=await graphPoint(page,500,100);assert.ok(box);await expectHit(page,drop,'RequesterLane');await drag(page,{x:box.x+box.width/2,y:box.y+box.height/2},drop);}
    }
    else{await context(page,'SubmitRequest');await clickText(page,'.bpmn-xyflow-context-menu > div','Append Task');}
    const after=await readModel(page),added=semanticElements(after).filter(element=>!before.byId[element.id]),task=added.find(element=>element.$type==='bpmn:Task'),flow=added.find(element=>element.$type==='bpmn:SequenceFlow');
    assert.ok(task&&flow,'native append creates a connected task');assert.equal(added.filter(element=>element.$type==='bpmn:Task').length,1);assert.equal(flows(after).length,flows(before).length+1);
    assert.equal(flow.sourceRef.id,'SubmitRequest');assert.equal(flow.targetRef,task);assert.equal(task.$parent,after.byId.ApprovalProcess);assert.ok(after.di(task.id)?.bounds);assert.ok(after.di(flow.id)?.waypoint);
    if(mode==='context-drag'){const bounds=after.di(task.id).bounds;assert.ok(Math.abs(bounds.x+bounds.width/2-500)<=2&&Math.abs(bounds.y+bounds.height/2-100)<=2,'native Append drag creates at the chosen point');}
    assertApprovalMetadata(before,after);await undo(page,before.xml);await redo(page,after.xml);
  });
  await runCase('end-event-append-unavailable-no-dangling-task',approval,async page=>{
    const before=await readModel(page),initialHistory=await history(page);await clickShape(page,'ApprovedEnd');
    assert.equal((await page.$$('.bpmn-xyflow-context-pad [data-action="append.append-task"], .bpmn-xyflow-context-pad button[title="Append Task"]')).length,0,'EndEvent must not offer Task append');
    await context(page,'ApprovedEnd');const labels=await page.$$eval('.bpmn-xyflow-context-menu > div',rows=>rows.map(row=>row.textContent.trim()));assert.equal(labels.includes('Append Task'),false,'EndEvent right-click menu must not offer Task append');
    await page.keyboard.press('Escape');assert.equal((await readModel(page)).xml,before.xml);assert.deepEqual(await history(page),initialHistory);
  });

  for(const [suffix,title] of [['before','Add lane before'],['after','Add lane after']])await runCase(`approval-lane-add-${suffix}`,approval,async page=>{
    const before=await readModel(page),oldLane=xy(before.di('ReviewerLane').bounds);await clickShape(page,'ReviewerLane',{x:12,y:105});await page.click(`.bpmn-xyflow-context-pad button[title="${title}"]`);
    const after=await readModel(page),added=semanticElements(after).filter(element=>element.$type==='bpmn:Lane'&&!before.byId[element.id]);assert.equal(added.length,1);
    const bounds=xy(after.di(added[0].id).bounds);assert.equal(bounds.height,120);assert.equal(bounds.x,oldLane.x);assert.equal(bounds.width,oldLane.width);
    assert.equal(bounds.y,suffix==='before'?oldLane.y-120:oldLane.y+oldLane.height);
    const lanes=after.byId.ApprovalLanes.lanes;assert.equal(lanes.indexOf(added[0]),lanes.indexOf(after.byId.ReviewerLane)+(suffix==='before'?-1:1));
    assertApprovalMetadata(before,after);await undo(page,before.xml);await redo(page,after.xml);
  });
  await runCase('approval-lane-split-nested-membership',approval,async page=>{
    const before=await readModel(page);await clickShape(page,'ReviewerLane',{x:12,y:105});await page.click('.bpmn-xyflow-context-pad button[title="Split into two lanes"]');
    const after=await readModel(page),lane=after.byId.ReviewerLane,children=lane.childLaneSet?.lanes;assert.equal(children?.length,2);
    const original=xy(before.di(lane.id).bounds),bounds=children.map(child=>xy(after.di(child.id).bounds));assert.equal(bounds.reduce((sum,b)=>sum+b.height,0),original.height);
    assert.ok(bounds.every(b=>b.x===original.x+30&&b.width===original.width-30));assert.equal(bounds[0].y+bounds[0].height,bounds[1].y);
    for(const id of ['ReviewRequest','ApprovalDecision','ApprovedEnd'])assert.equal(children.filter(child=>(child.flowNodeRef||[]).some(ref=>ref.id===id)).length,1,`${id} belongs to one child lane`);
    assertApprovalMetadata(before,after);await undo(page,before.xml);await redo(page,after.xml);
  });
  await runCase('approval-lane-delete-undo-repeat',approval,async page=>{
    const before=await readModel(page);await clickShape(page,'RequesterLane',{x:12,y:105});await page.click('.bpmn-xyflow-context-pad button[title="Delete"]');
    const deleted=await readModel(page);assert.equal(deleted.byId.RequesterLane,undefined);assert.equal(deleted.di('RequesterLane'),undefined);assert.ok(deleted.byId.ReviewerLane);
    for(let i=0;i<3;i++){await undo(page,before.xml);await redo(page,deleted.xml);}await undo(page,before.xml);
    const counts=await page.evaluate(()=>{const ids=[...window.modeler.getContainer().querySelectorAll('[data-element-id]')].filter(node=>node.classList.contains('bpmn-xyflow-shape')).map(node=>node.getAttribute('data-element-id'));return{all:ids.length,unique:new Set(ids).size};});assert.equal(counts.all,counts.unique,'repeated lane undo leaves no duplicate shape graphics');
  });

  const insertionFixture=await derivedApproval({auditTask:true});
  for(const mode of ['palette','existing-shape'])for(const id of ['ApproveFlow','RejectFlow'])await runCase(`${mode}-insert-${id}`,mode==='palette'?approval:insertionFixture,async page=>{
    const before=await readModel(page),original=before.byId[id],drop=await edgeMidpoint(page,id);await expectHit(page,drop,id);
    if(mode==='palette')await paletteTaskDrag(page,drop);
    else{const start=await clickShape(page,'AuditInsertion');await drag(page,start,drop);}
    const after=await readModel(page),incoming=after.byId[id],inserted=incoming.targetRef,outgoing=flows(after).find(flow=>flow.sourceRef===inserted&&flow.targetRef.id===original.targetRef.id);
    assert.notEqual(inserted.id,original.targetRef.id,'native drop inserted a task into the existing flow');assert.equal(inserted.$type,'bpmn:Task');assert.ok(outgoing,'inserted task reconnects the original target');assert.equal(incoming.sourceRef.id,original.sourceRef.id);
    assert.equal(flows(after).length,flows(before).length+1);assert.deepEqual(condition(incoming),condition(original));assert.equal(condition(outgoing),null);assert.equal(incoming.name,original.name);
    if(mode==='existing-shape'){assert.equal(inserted.id,'AuditInsertion');assert.deepEqual(docs(inserted),docs(before.byId.AuditInsertion));}
    else assert.equal(semanticElements(after).filter(element=>element.$type==='bpmn:Task'&&!before.byId[element.id]).length,1);
    assertApprovalMetadata(before,after);assert.ok(after.di(inserted.id)?.bounds);assert.ok(after.di(outgoing.id)?.waypoint);await undo(page,before.xml);await redo(page,after.xml);
  });
  await runCase('palette-insertion-escape-no-mutation',approval,async page=>{
    const before=await readModel(page),initialHistory=await history(page),drop=await edgeMidpoint(page,'ApproveFlow');await expectHit(page,drop,'ApproveFlow');await paletteTaskDrag(page,drop,{cancel:true});
    assert.equal((await readModel(page)).xml,before.xml);assert.deepEqual(await history(page),initialHistory);assert.equal((await page.$$('.bpmn-xyflow-palette-ghost')).length,0);
  });

  const flatApproval=await derivedApproval({withoutLanes:true});
  await runCase('clipboard-native-copy-paste-duplicate-delete-history',flatApproval,async page=>{
    const before=await readModel(page);await clickShape(page,'ApprovalDecision');await clickShape(page,'ReworkRequest',undefined,{add:true});await clickShape(page,'ApprovedEnd',undefined,{add:true});
    assert.deepEqual((await page.evaluate(()=>window.modeler.getSelection())).sort(),['ApprovalDecision','ApprovedEnd','ReworkRequest'].sort());
    await shortcut(page,'c');assert.equal((await readModel(page)).xml,before.xml,'Copy does not mutate');await shortcut(page,'v');
    const pasted=await readModel(page),newNodes=semanticElements(pasted).filter(element=>!before.byId[element.id]&&element.$instanceOf('bpmn:FlowNode'));assert.equal(newNodes.length,3);
    const copiedGateway=newNodes.find(node=>node.$type==='bpmn:ExclusiveGateway'),copiedEnd=newNodes.find(node=>node.$type==='bpmn:EndEvent'),copiedTask=newNodes.find(node=>node.$type==='bpmn:UserTask');
    assert.ok(copiedGateway&&copiedEnd&&copiedTask);assert.equal(copiedGateway.name,before.byId.ApprovalDecision.name);assert.equal(copiedTask.name,before.byId.ReworkRequest.name);
    const newFlows=flows(pasted).filter(flow=>!before.byId[flow.id]);assert.equal(newFlows.length,2);
    const conditional=newFlows.find(flow=>flow.targetRef===copiedEnd),fallback=newFlows.find(flow=>flow.targetRef===copiedTask);assert.deepEqual(condition(conditional),condition(before.byId.ApproveFlow));assert.equal(copiedGateway.default,fallback);assert.ok(newFlows.every(flow=>flow.sourceRef===copiedGateway));
    assertApprovalMetadata(before,pasted);assert.ok(newNodes.every(node=>pasted.di(node.id)?.bounds));
    await shortcut(page,'d');const duplicated=await readModel(page);assert.equal(semanticElements(duplicated).filter(element=>!pasted.byId[element.id]&&element.$instanceOf('bpmn:FlowNode')).length,3);assert.equal(flows(duplicated).length,flows(pasted).length+2);
    await page.keyboard.press('Delete');assert.equal((await readModel(page)).xml,pasted.xml,'Delete removes the duplicated selection and its internal connections only');
    await shortcut(page,'z');assert.equal((await readModel(page)).xml,duplicated.xml);await shortcut(page,'z',{shift:true});assert.equal((await readModel(page)).xml,pasted.xml);
    await shortcut(page,'z');await shortcut(page,'z');assert.equal((await readModel(page)).xml,pasted.xml,'second Undo removes only Duplicate');await shortcut(page,'z');assert.equal((await readModel(page)).xml,before.xml,'third Undo removes Paste');
  });
  await runCase('lasso-native-selection-delete-undo',flatApproval,async page=>{
    const before=await readModel(page),start=await graphPoint(page,620,285),end=await graphPoint(page,1160,395);await expectHit(page,start,null);
    await drag(page,start,end,{shift:true});assert.deepEqual((await page.evaluate(()=>window.modeler.getSelection())).sort(),['ApprovalDecision','ApprovedEnd'].sort());
    assert.equal((await page.$$('.bpmn-xyflow-lasso')).length,0);assert.equal((await readModel(page)).xml,before.xml,'lasso only selects');
    await page.keyboard.press('Delete');const deleted=await readModel(page);assert.equal(deleted.byId.ApprovalDecision,undefined);assert.equal(deleted.byId.ApprovedEnd,undefined);assert.ok(deleted.byId.ReworkRequest);
    await shortcut(page,'z');assert.equal((await readModel(page)).xml,before.xml);await shortcut(page,'z',{shift:true});assert.equal((await readModel(page)).xml,deleted.xml);await shortcut(page,'z');assert.equal((await readModel(page)).xml,before.xml);
  });

  await runCase('keyboard-nudge-shift-speed-and-history',flatApproval,async page=>{
    // Pinned bpmn-js 18.30.1 resolves diagram-js 15.27.1:
    // KeyboardMoveSelection defaults to 1px, Shift=10px, Ctrl/Cmd=ignored.
    for(const [key,shift,dx,dy] of [['ArrowRight',false,1,0],['ArrowDown',true,0,10],['ArrowLeft',false,-1,0],['ArrowUp',true,0,-10]]){
      await clickShape(page,'ReviewRequest');const before=await readModel(page),bounds=xy(before.di('ReviewRequest').bounds);
      if(shift)await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');}
      const after=await readModel(page);assert.deepEqual(xy(after.di('ReviewRequest').bounds),{...bounds,x:bounds.x+dx,y:bounds.y+dy},`${shift?'Shift+':''}${key} uses upstream graph-space movement`);
      assertApprovalMetadata(before,after);await undo(page,before.xml);await redo(page,after.xml);
    }
    await clickShape(page,'ReviewRequest');const before=await readModel(page),initialHistory=await history(page);
    await shortcut(page,'ArrowRight');assert.equal((await readModel(page)).xml,before.xml,'Ctrl+Arrow must not nudge the diagram');assert.deepEqual(await history(page),initialHistory);
  });
  await runCase('keyboard-tab-shift-tab-selection-cycle',flatApproval,async page=>{
    const before=await readModel(page),initialHistory=await history(page);
    // These are the authored business fixture's shape/DI order, independently
    // listed rather than computed with Modeler's selection implementation.
    const ids=['RequestStart','SubmitRequest','ReviewRequest','ApprovalDecision','ReworkRequest','ApprovedEnd'];
    await clickShape(page,ids[0]);
    for(let index=1;index<=ids.length;index++){
      await page.keyboard.press('Tab');assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[ids[index%ids.length]],'Tab advances and wraps through shapes');
    }
    await page.keyboard.down('Shift');try{
      for(let index=1;index<=ids.length;index++){
        await page.keyboard.press('Tab');assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[ids[(ids.length-index)%ids.length]],'Shift+Tab reverses and wraps through shapes');
      }
    }finally{await page.keyboard.up('Shift');}
    assert.equal((await readModel(page)).xml,before.xml);assert.deepEqual(await history(page),initialHistory);
  });
  await runCase('keyboard-outside-and-label-focus-guards',flatApproval,async page=>{
    await clickShape(page,'ReviewRequest');await page.keyboard.press('ArrowRight');
    const before=await readModel(page),initialHistory=await history(page);assert.ok(initialHistory.undo,'guard test has a real prior command to protect');
    // The demo's Export button is a real focusable control outside the canvas.
    // Its read-only export also avoids synthetic DOM focus().
    await page.click('#export-btn');assert.equal(await page.evaluate(()=>window.modeler.getContainer().contains(document.activeElement)),false,'keyboard focus is outside the modeler');
    await page.keyboard.press('ArrowRight');await page.keyboard.down('Shift');try{await page.keyboard.press('ArrowDown');}finally{await page.keyboard.up('Shift');}
    await page.keyboard.press('Delete');await shortcut(page,'z');
    assert.equal((await readModel(page)).xml,before.xml,'outside-canvas keys neither move, delete nor undo the selected diagram shape');assert.deepEqual(await history(page),initialHistory);
    const p=await shapePoint(page,'ReviewRequest');await expectHit(page,p,'ReviewRequest');await page.mouse.click(p.x,p.y,{count:2,delay:50});
    const editor='[contenteditable="plaintext-only"], [contenteditable="true"]';await page.waitForSelector(editor);assert.equal(await page.evaluate(()=>document.activeElement.isContentEditable),true);
    await shortcut(page,'a');await page.keyboard.type('Temporary approval text');await page.keyboard.press('ArrowLeft');await page.keyboard.press('Delete');
    assert.equal((await readModel(page)).xml,before.xml,'editing text does not move or delete its BPMN element before commit');assert.deepEqual(await history(page),initialHistory);
    await page.keyboard.press('Escape');await page.waitForSelector(editor,{hidden:true});assert.equal((await readModel(page)).xml,before.xml,'Escape cancels text without changing the protected command history');assert.deepEqual(await history(page),initialHistory);
  });

  await writeFile('test-artifacts/browser-core-controls-results.json',JSON.stringify(results,null,2));const failed=results.filter(result=>result.status==='failed');assert.equal(failed.length,0,failed.map(result=>`${result.name}: ${result.error}`).join('\n'));console.log(`PASS ${results.length} native core-control groups`);
}finally{await browser?.close();child?.kill('SIGTERM');}
