/**
 * Native advanced modeling regression gate. Business fixtures / initial setup
 * use public APIs; every action under test is Puppeteer mouse/keyboard input.
 * No synthetic event dispatch, evaluated DOM clicks, or modeling API actions.
 * Run in the existing browser-permitted CI environment without sandbox bypasses.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const port=Number(process.env.BPMN_ADVANCED_PORT||5239),base=`http://localhost:${port}`;
const server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
server.stdout.on('data',()=>{});
const oracle=new BpmnModdle(),results=[];let browser;
const cases={};
for(const name of ['order-payment-delivery','approval-rejection-rework','booking-timeout-compensation']) cases[name]=await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8');
const coords=point=>({x:point.x,y:point.y});
const bounds=value=>({x:value.x,y:value.y,width:value.width,height:value.height});
const near=(a,b,tolerance=1.5)=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<=tolerance,`${JSON.stringify(a)} differs from ${JSON.stringify(b)}`);

async function state(page) {
  const xml=await page.evaluate(()=>window.modeler.getXML());
  const parsed=await oracle.fromXML(xml);assert.deepEqual(parsed.warnings,[],'independent upstream XML reopen');
  const di=parsed.rootElement.diagrams.flatMap(diagram=>diagram.plane.planeElement||[]);
  return {xml,byId:parsed.elementsById,definitions:parsed.rootElement,di:id=>di.find(item=>item.bpmnElement?.id===id),
    history:await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()}))};
}
async function screen(page,p) {return page.evaluate(p=>{const m=window.modeler,v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{x:r.left+v.x+p.x*v.zoom,y:r.top+v.y+p.y*v.zoom};},p);}
async function shapePoint(page,id,relative) {
  const p=await page.evaluate(({id,relative})=>{const n=window.modeler.getElement(id);if(!n)throw Error(`Missing ${id}`);return{x:n.x+(relative?.x??n.width/2),y:n.y+(relative?.y??n.height/2)};},{id,relative});
  return screen(page,p);
}
async function hit(page,p,id,selector) {
  const actual=await page.evaluate(({p,selector})=>{const e=document.elementFromPoint(p.x,p.y);return{id:e?.closest('[data-element-id]')?.getAttribute('data-element-id'),matched:selector?!!e?.closest(selector):false,tag:e?.tagName,classes:e?.getAttribute('class')};},{p,selector});
  if(selector)assert.ok(actual.matched,`pointer target ${selector}: ${JSON.stringify(actual)}`);else assert.equal(actual.id,id,`pointer target ${id}: ${JSON.stringify(actual)}`);
}
async function selectShape(page,id,relative) {const p=await shapePoint(page,id,relative);await hit(page,p,id);await page.mouse.click(p.x,p.y);assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[id]);return p;}
async function control(page,selector) {const element=await page.waitForSelector(selector),box=await element.boundingBox();assert.ok(box,selector);const p={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,p,null,selector);return p;}
async function drag(page,from,to,{cancel=false,shift=false}={}) {
  if(shift)await page.keyboard.down('Shift');
  try {await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}
  finally {if(shift)await page.keyboard.up('Shift');}
}
async function undo(page,xml) {assert.equal(await page.$eval('#undo-btn',e=>e.disabled),false);await page.click('#undo-btn');assert.equal((await state(page)).xml,xml,'native Undo restores exact XML and DI');}
async function redo(page,xml) {assert.equal(await page.$eval('#redo-btn',e=>e.disabled),false);await page.click('#redo-btn');assert.equal((await state(page)).xml,xml,'native Redo restores exact XML and DI');}
async function historyCycle(page,before,after) {for(let i=0;i<2;i++){await undo(page,before.xml);await redo(page,after.xml);}}
async function unchanged(page,before,label) {const after=await state(page);assert.equal(after.xml,before.xml,label);assert.deepEqual(after.history,before.history,label+' history');}
async function selectEdge(page,id) {
  const before=await state(page);
  const candidate=await page.evaluate(id=>{
    const m=window.modeler,e=m.getElement(id),v=m.getViewport(),r=m.getContainer().getBoundingClientRect();
    if(!e?.waypoints)throw Error(`Missing connection ${id}`);
    for(let i=1;i<e.waypoints.length;i++)for(const t of [.5,.25,.75,.125,.875]) {
      const a=e.waypoints[i-1],b=e.waypoints[i],x=r.left+v.x+(a.x+(b.x-a.x)*t)*v.zoom,y=r.top+v.y+(a.y+(b.y-a.y)*t)*v.zoom;
      if(document.elementFromPoint(x,y)?.closest('[data-element-id]')?.getAttribute('data-element-id')===id)return{x,y};
    }
    throw Error(`No unobstructed native segment hit for ${id}`);
  },id);
  await page.mouse.click(candidate.x,candidate.y);assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[id]);
  await unchanged(page,before,'plain connection selection changes no XML, DI or history');
}
async function labelTarget(page,id) {
  return page.evaluate(id=>{const m=window.modeler,node=m.getElement(id),label=node.label;if(label)return{selector:`[data-element-id="${label.id}"]`,id:label.id};return{selector:`[data-element-id="${id}"] [data-connection-label]`,id};},id);
}
async function labelPoint(page,id) {
  const target=await labelTarget(page,id),element=await page.waitForSelector(target.selector+' text'),box=await element.boundingBox();
  assert.ok(box?.width&&box.height,`visible label ${id}`);const p={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,p,target.id);return{...target,p,box};
}
async function editLabel(page,id,text,commit='Enter') {
  const target=await labelPoint(page,id);await page.mouse.click(target.p.x,target.p.y,{count:2,delay:50});
  const editor=await page.waitForSelector('[contenteditable]'),editorBox=await editor.boundingBox();
  near({x:editorBox.x,y:editorBox.y},{x:target.box.x,y:target.box.y},2);
  const hidden=await page.$eval(target.selector,element=>getComputedStyle(element).display==='none'||getComputedStyle(element).visibility==='hidden');
  assert.ok(hidden,'rendered label is hidden while its text editor is active');
  await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');await page.keyboard.type(text);
  if(commit==='blur'){const blank=await screen(page,{x:1400,y:850});await page.mouse.click(blank.x,blank.y);}else await page.keyboard.press(commit);
  await page.waitForSelector('[contenteditable]',{hidden:true});
}
async function noVisibleLabel(page,id,previousSelector) {
  const visible=await page.evaluate(({id,previousSelector})=>{
    const owner=window.modeler.getElement(id);if(!owner)throw Error(`Deleted label owner ${id}`);
    const selectors=[previousSelector,`[data-element-id="${id}"] [data-connection-label]`];
    if(owner.label)selectors.push(`[data-element-id="${owner.label.id}"]`);
    return selectors.some(selector=>[...document.querySelectorAll(selector+' text')].some(text=>{
      if(!text.textContent.trim()||!text.getBoundingClientRect().width)return false;
      for(let element=text;element instanceof Element;element=element.parentElement){const style=getComputedStyle(element);if(style.display==='none'||style.visibility==='hidden'||style.opacity==='0')return false;}
      return true;
    }));
  },{id,previousSelector});
  assert.equal(visible,false,'cleared external label leaves no visible stale text');
}
async function resize(page,id,dir,delta,relative={x:20,y:25},cancel=false) {
  await selectShape(page,id,relative);const from=await control(page,`.bpmn-xyflow-resize-handle[data-resize-dir="${dir}"]`);
  const zoom=await page.evaluate(()=>window.modeler.getViewport().zoom);
  await drag(page,from,{x:from.x+delta.x*zoom,y:from.y+delta.y*zoom},{cancel});
}
async function reopen(page,expected) {
  const viewport=await page.evaluate(()=>window.modeler.getViewport());
  const warnings=await page.evaluate(async({xml,viewport})=>{const r=await window.modeler.importXML(xml);window.modeler.setViewport(viewport);return r.warnings.map(w=>w.message);},{xml:expected.xml,viewport});
  assert.deepEqual(warnings,[]);const actual=await state(page);
  const diSnapshot=definitions=>(definitions.diagrams||[]).map(diagram=>({id:diagram.id,plane:diagram.plane.id,root:diagram.plane.bpmnElement?.id,
    entries:(diagram.plane.planeElement||[]).map(entry=>({id:entry.id,type:entry.$type,element:entry.bpmnElement?.id,
      ...(entry.bounds?{bounds:bounds(entry.bounds)}:{}),...(entry.waypoint?{waypoints:entry.waypoint.map(coords)}:{}),
      ...(entry.label?{label:{id:entry.label.id,...(entry.label.bounds?{bounds:bounds(entry.label.bounds)}:{})}}:{})}))}));
  const references=byId=>Object.values(byId).flatMap(object=>(object.$descriptor?.properties||[]).filter(property=>property.isReference&&!property.isVirtual)
    .map(property=>({id:object.id,key:property.name,values:(Array.isArray(object[property.name])?object[property.name]:[object[property.name]]).filter(Boolean).map(value=>value.id||value.$type)})));
  assert.deepEqual(diSnapshot(actual.definitions),diSnapshot(expected.definitions),'actual reopen retains exact DI geometry and label bounds');
  assert.deepEqual(references(actual.byId),references(expected.byId),'actual reopen retains every resolved semantic reference');
  // Newly authored dc:Point waypoints may gain redundant xsi:type/namespace
  // declarations on first reopen. Independent upstream serialization removes
  // that lexical distinction while retaining all semantics and extensions.
  assert.equal((await oracle.toXML(actual.definitions)).xml,(await oracle.toXML(expected.definitions)).xml,'actual import/save retains the complete independent semantic/DI model and extension values');
}
async function run(name,fixture,fn) {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1800,height:1250});
  try {
    await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
    const warnings=await page.evaluate(async xml=>{const r=await window.modeler.importXML(xml);window.modeler.setViewport({x:150,y:100,zoom:.9});return r.warnings.map(w=>w.message);},fixture);assert.deepEqual(warnings,[]);
    await fn(page);assert.deepEqual(errors,[],'no native browser runtime errors');const final=await state(page);
    await writeFile(`test-artifacts/browser-advanced-${name}.bpmn`,final.xml);await page.screenshot({path:`test-artifacts/browser-advanced-${name}-pass.png`,fullPage:true});
    results.push({name,status:'passed'});console.log(`PASS native advanced ${name}`);
  } catch(error) {
    const detail={name,status:'failed',error:error.stack||String(error),browserErrors:errors};results.push(detail);console.error(`FAIL native advanced ${name}: ${detail.error}`);
    await page.screenshot({path:`test-artifacts/browser-advanced-${name}-failure.png`,fullPage:true}).catch(()=>{});
    const xml=await page.evaluate(()=>window.modeler?.getXML()).catch(()=>null);if(xml)await writeFile(`test-artifacts/browser-advanced-${name}-failure.bpmn`,xml);
  } finally {await page.close();}
}

try {
  const deadline=Date.now()+60000;while(true){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw Error('Advanced demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await puppeteer.launch({headless:'shell'});await mkdir('test-artifacts',{recursive:true});

  for(const [id,name] of [['RequestStart','external-event-label'],['ApproveFlow','connection-label']]) {
    await run(name,cases['approval-rejection-rework'],async page=>{
      const original=await state(page),shapeBefore=original.di(id).bounds&&bounds(original.di(id).bounds),routeBefore=original.di(id).waypoint?.map(coords);
      await editLabel(page,id,'Ready for review','Enter');const entered=await state(page);assert.equal(entered.byId[id].name,'Ready for review');await historyCycle(page,original,entered);
      await editLabel(page,id,'Confirmed by reviewer','blur');const blurred=await state(page);assert.equal(blurred.byId[id].name,'Confirmed by reviewer');await historyCycle(page,entered,blurred);
      await editLabel(page,id,'Discard this change','Escape');await unchanged(page,blurred,'Escape discards label text');
      const {p}=await labelPoint(page,id),zoom=await page.evaluate(()=>window.modeler.getViewport().zoom),to={x:p.x+60*zoom,y:p.y+35*zoom};
      await drag(page,p,to,{cancel:true});await unchanged(page,blurred,'Escape discards independent label drag');
      const start=await labelPoint(page,id);await drag(page,start.p,{x:start.p.x+60*zoom,y:start.p.y+35*zoom});const moved=await state(page);
      near(moved.di(id).label.bounds,{x:blurred.di(id).label.bounds.x+60,y:blurred.di(id).label.bounds.y+35});
      if(shapeBefore)assert.deepEqual(bounds(moved.di(id).bounds),shapeBefore,'label move leaves host untouched');
      if(routeBefore)assert.deepEqual(moved.di(id).waypoint.map(coords),routeBefore,'label move leaves connection route untouched');
      await historyCycle(page,blurred,moved);
      await editLabel(page,id,'Moved label confirmed','Enter');const renamedAfterMove=await state(page);assert.equal(renamedAfterMove.byId[id].name,'Moved label confirmed');
      await historyCycle(page,moved,renamedAfterMove);await reopen(page,renamedAfterMove);
    });
  }

  for(const id of ['ApprovedEnd','ApprovalDecision','ApproveFlow']) for(const key of ['Delete','Backspace']) {
    await run(`external-label-${id}-${key.toLowerCase()}`,cases['approval-rejection-rework'],async page=>{
      const before=await state(page),target=await labelPoint(page,id),originalName=before.byId[id].name;
      assert.ok(originalName);assert.notEqual(target.id,id,'click selects the independent external label');
      await page.mouse.click(target.p.x,target.p.y);assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[target.id]);
      await page.keyboard.press(key);const after=await state(page),owner=after.byId[id];
      assert.ok(owner,'label deletion retains the semantic owner');assert.ok(!owner.name,'label deletion clears the semantic name');
      assert.equal(owner.$type,before.byId[id].$type);assert.equal(owner.$parent.id,before.byId[id].$parent.id);
      assert.equal(after.history.size,before.history.size+1,'one label deletion creates one undo step');
      assert.deepEqual(Object.keys(after.byId).sort(),Object.keys(before.byId).sort(),'all semantic and DI IDs remain');
      assert.equal(after.byId.ApproveFlow.sourceRef,after.byId.ApprovalDecision);assert.equal(after.byId.ApproveFlow.targetRef,after.byId.ApprovedEnd);
      assert.equal(after.byId.ApprovalDecision.default,after.byId.RejectFlow);
      // Compare the complete independently parsed document after restoring only
      // its label name. Dormant BPMNLabel DI is valid and must stay unchanged.
      const clearedName=owner.name;owner.name=originalName;
      try {assert.equal((await oracle.toXML(after.definitions)).xml,(await oracle.toXML(before.definitions)).xml,'only the selected semantic name changes; geometry, refs and all DI remain');}
      finally {owner.name=clearedName;}
      await noVisibleLabel(page,id,target.selector);
      for(let cycle=0;cycle<2;cycle++) {
        await undo(page,before.xml);await labelPoint(page,id);
        await redo(page,after.xml);await noVisibleLabel(page,id,target.selector);
      }
      await reopen(page,after);await noVisibleLabel(page,id,target.selector);
    });
  }

  await run('populated-payment-nw-resize',cases['order-payment-delivery'],async page=>{
    const before=await state(page);
    await resize(page,'Payment','nw',{x:-55,y:-45},{x:20,y:25},true);await unchanged(page,before,'cancel restores subprocess and all child DI');
    await resize(page,'Payment','nw',{x:-55,y:-45});const after=await state(page),old=bounds(before.di('Payment').bounds),current=bounds(after.di('Payment').bounds),dx=current.x-old.x,dy=current.y-old.y;
    assert.ok(dx<0&&dy<0);near({x:current.x+current.width,y:current.y+current.height},{x:old.x+old.width,y:old.y+old.height},1e-8);
    for(const id of ['PaymentStart','CapturePayment','PaymentEnd']) {near(after.di(id).bounds,{x:before.di(id).bounds.x+dx,y:before.di(id).bounds.y+dy},1e-8);assert.equal(after.byId[id].$parent.id,'Payment');}
    for(const id of ['PaymentFlow1','PaymentFlow2']) assert.deepEqual(after.di(id).waypoint.map(coords),before.di(id).waypoint.map(p=>({x:p.x+dx,y:p.y+dy})),'internal child route translates exactly once');
    await historyCycle(page,before,after);await reopen(page,after);
  });

  await run('host-resize-boundary-follows',cases['booking-timeout-compensation'],async page=>{
    const before=await state(page),host=before.di('ReserveFlight').bounds,boundary=before.di('FlightTimeout').bounds,rx=(boundary.x+boundary.width/2-host.x)/host.width,ry=(boundary.y+boundary.height/2-host.y)/host.height;
    await resize(page,'ReserveFlight','se',{x:60,y:40},{x:35,y:25},true);await unchanged(page,before,'cancel restores host and attached boundary');
    await resize(page,'ReserveFlight','se',{x:60,y:40},{x:35,y:25});const after=await state(page),h=after.di('ReserveFlight').bounds,b=after.di('FlightTimeout').bounds;
    assert.ok(h.width>host.width&&h.height>host.height);near({x:b.x+b.width/2,y:b.y+b.height/2},{x:h.x+rx*h.width,y:h.y+ry*h.height});
    assert.equal(after.byId.FlightTimeout.attachedToRef,after.byId.ReserveFlight);assert.equal(after.byId.FlightTimeout.eventDefinitions[0].timeDuration.body,'PT1H');
    assert.equal(after.byId.TimeoutFlow.sourceRef,after.byId.FlightTimeout);await historyCycle(page,before,after);await reopen(page,after);
  });

  await run('boundary-reattach-valid-invalid-cancel',cases['booking-timeout-compensation'],async page=>{
    const before=await state(page),from=await shapePoint(page,'FlightTimeout'),to=await screen(page,{x:480,y:260});await hit(page,from,'FlightTimeout');
    await drag(page,from,to,{cancel:true});await unchanged(page,before,'cancel restores boundary attachment and routes');
    await drag(page,await shapePoint(page,'FlightTimeout'),to);const after=await state(page);
    assert.equal(after.byId.FlightTimeout.attachedToRef,after.byId.ReserveHotel);assert.equal(after.byId.FlightTimeout.$parent,after.byId.BookingTransaction);assert.equal(after.byId.FlightTimeout.eventDefinitions[0].timeDuration.body,'PT1H');
    near({x:after.di('FlightTimeout').bounds.x+18,y:after.di('FlightTimeout').bounds.y+18},{x:480,y:260});
    // The attached event overlaps ReservationFlow2 at its centre. Use its
    // unobstructed visible ring; separate differential tests cover overlap
    // priority instead of assuming a different z-order from pinned bpmn-js.
    await hit(page,await shapePoint(page,'FlightTimeout',{x:18,y:6}),'FlightTimeout');
    const hosts=await page.evaluate(()=>({old:window.modeler.getElement('ReserveFlight').attachers.map(n=>n.id),next:window.modeler.getElement('ReserveHotel').attachers.map(n=>n.id)}));
    assert.ok(!hosts.old.includes('FlightTimeout'));assert.ok(hosts.next.includes('FlightTimeout'));await historyCycle(page,before,after);
    const invalid=await screen(page,{x:1300,y:800}),invalidFrom=await shapePoint(page,'FlightTimeout',{x:18,y:6});await hit(page,invalidFrom,'FlightTimeout');await drag(page,invalidFrom,invalid);await unchanged(page,after,'outside-host boundary drop does not detach');
    await reopen(page,after);
  });

  await run('cross-lane-owner-membership',cases['approval-rejection-rework'],async page=>{
    const before=await state(page),from=await shapePoint(page,'SubmitRequest'),to=await screen(page,{x:280,y:360});
    await drag(page,from,to,{cancel:true});await unchanged(page,before,'cancel restores lane membership and bounds');
    await drag(page,await shapePoint(page,'SubmitRequest'),to);const after=await state(page);
    assert.ok(!after.byId.RequesterLane.flowNodeRef.includes(after.byId.SubmitRequest));assert.ok(after.byId.ReviewerLane.flowNodeRef.includes(after.byId.SubmitRequest));
    assert.equal(after.byId.SubmitRequest.$parent,after.byId.ApprovalProcess);assert.equal(after.byId.ReviewFlow.sourceRef,after.byId.SubmitRequest);assert.equal(after.byId.ReviewFlow.targetRef,after.byId.ReviewRequest);
    assert.equal(await page.evaluate(()=>window.modeler.getElement('SubmitRequest').parent.id),'ReviewerLane');await historyCycle(page,before,after);await reopen(page,after);
  });

  await run('cross-pool-reparent-owner',cases['order-payment-delivery'],async page=>{
    // An unconnected activity isolates ownership transfer from edge-pruning rules.
    const id=await page.evaluate(()=>{const m=window.modeler,node=m.addShape('bpmn:Task',{x:730,y:125},{parent:m.getElement('BuyerPool')});if(!node)throw Error('Transfer activity setup failed');return node.id;});
    const before=await state(page),to=await screen(page,{x:1050,y:620});
    assert.equal(before.byId[id].$parent,before.byId.BuyerProcess);
    await drag(page,await shapePoint(page,id),to,{cancel:true});await unchanged(page,before,'cancel restores semantic process ownership');
    await drag(page,await shapePoint(page,id),to);const after=await state(page);
    assert.equal(after.byId[id].$parent,after.byId.SellerProcess);assert.ok(after.byId.SellerProcess.flowElements.includes(after.byId[id]));assert.ok(!after.byId.BuyerProcess.flowElements.includes(after.byId[id]));
    assert.equal(await page.evaluate(id=>window.modeler.getElement(id).parent.id,id),'SellerPool');await historyCycle(page,before,after);await reopen(page,after);
  });

  await run('invalid-drop-into-empty-participant',cases['order-payment-delivery'],async page=>{
    // API setup only: a black-box participant supplies the prohibited drop target.
    await page.evaluate(()=>{const m=window.modeler,pool=m.addShape('bpmn:Participant',{x:750,y:825},{isExpanded:false});if(!pool)throw Error('Black-box setup failed');m.resizeShape(pool,{x:30,y:735,width:1450,height:180});window.advancedEmptyPool=pool.id;});
    const before=await state(page),to=await screen(page,{x:250,y:805});await drag(page,await shapePoint(page,'SubmitOrder'),to);await unchanged(page,before,'flow node cannot be reparented into a black-box participant');
    assert.equal(before.byId[await page.evaluate(()=>window.advancedEmptyPool)].processRef,undefined);
  });

  await run('space-expand-compress-container',cases['order-payment-delivery'],async page=>{
    const before=await state(page),selector='.bpmn-xyflow-editor-actions button[aria-pressed]',from=await screen(page,{x:720,y:730}),to=await screen(page,{x:800,y:730});
    await page.click(selector);await drag(page,from,to,{cancel:true});await unchanged(page,before,'cancelled space tool does not change containers');
    await page.click(selector);await drag(page,from,to);const expanded=await state(page);
    for(const id of ['BuyerPool','SellerPool']) assert.equal(expanded.di(id).bounds.width,before.di(id).bounds.width+80);
    assert.equal(expanded.di('Payment').bounds.width,before.di('Payment').bounds.width);assert.equal(expanded.di('Payment').bounds.x,before.di('Payment').bounds.x);
    for(const id of ['FulfillmentFork','CreateInvoice','PackOrder','FulfillmentJoin','ShipOrder','SellerEnd']) assert.equal(expanded.di(id).bounds.x,before.di(id).bounds.x+80);
    await historyCycle(page,before,expanded);
    const compressionBefore=await state(page);await page.click(selector);await drag(page,from,await screen(page,{x:680,y:730}),{shift:true});const compressed=await state(page);
    for(const id of ['BuyerPool','SellerPool']) assert.equal(compressed.di(id).bounds.width,compressionBefore.di(id).bounds.width-40);
    assert.equal(compressed.di('ShipOrder').bounds.x,compressionBefore.di('ShipOrder').bounds.x-40);await historyCycle(page,compressionBefore,compressed);await reopen(page,compressed);
  });

  await run('message-target-reconnect',cases['order-payment-delivery'],async page=>{
    const before=await state(page);await selectEdge(page,'OrderMessage');
    const count=await page.evaluate(()=>window.modeler.getElement('OrderMessage').waypoints.length),from=await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${count-1}"]`),to=await screen(page,{x:200,y:430});
    await drag(page,from,to);const after=await state(page);assert.equal(after.byId.OrderMessage.$type,'bpmn:MessageFlow');assert.equal(after.byId.OrderMessage.$parent,after.byId.OrderCollaboration);assert.equal(after.byId.OrderMessage.sourceRef,after.byId.SubmitOrder);assert.equal(after.byId.OrderMessage.targetRef,after.byId.ValidateOrder);near(after.di('OrderMessage').waypoint.at(-1),{x:200,y:430},2);await historyCycle(page,before,after);
    // Pinned bpmn-js reconnect rules reject a cross-pool gateway, but convert
    // a same-pool activity target from MessageFlow into SequenceFlow.
    await selectEdge(page,'OrderMessage');let last=await page.evaluate(()=>window.modeler.getElement('OrderMessage').waypoints.length-1);
    const invalid=await shapePoint(page,'FulfillmentFork');await hit(page,invalid,'FulfillmentFork');
    await drag(page,await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${last}"]`),invalid);await unchanged(page,after,'message reconnect to a cross-pool gateway is rejected');
    await selectEdge(page,'OrderMessage');last=await page.evaluate(()=>window.modeler.getElement('OrderMessage').waypoints.length-1);
    const samePool=await shapePoint(page,'ReceiveDelivery',{x:0,y:20});await hit(page,samePool,'ReceiveDelivery');
    await drag(page,await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${last}"]`),samePool);
    const converted=await state(page),flow=converted.byId.OrderMessage;
    assert.equal(flow.$type,'bpmn:SequenceFlow');assert.equal(flow.$parent,converted.byId.BuyerProcess);
    assert.equal(flow.sourceRef,converted.byId.SubmitOrder);assert.equal(flow.targetRef,converted.byId.ReceiveDelivery);assert.equal(flow.name,after.byId.OrderMessage.name);
    assert.ok(converted.byId.BuyerProcess.flowElements.includes(flow));assert.ok(!converted.byId.OrderCollaboration.messageFlows.includes(flow));
    assert.ok(converted.byId.SubmitOrder.outgoing.includes(flow));assert.ok(converted.byId.ReceiveDelivery.incoming.includes(flow));
    assert.equal(converted.di('OrderMessage').id,after.di('OrderMessage').id);near(converted.di('OrderMessage').waypoint[0],after.di('OrderMessage').waypoint[0],1e-8);
    near(converted.di('OrderMessage').waypoint.at(-1),{x:1160,y:95},1.5);
    assert.equal(converted.history.size,after.history.size+1,'message-to-sequence conversion is one undoable command');
    await historyCycle(page,after,converted);await reopen(page,converted);
  });

  await run('data-association-source-and-owner-reconnect',cases['order-payment-delivery'],async page=>{
    // Public API prepares a data input association; both reconnects are native.
    const ids=await page.evaluate(()=>{const m=window.modeler,parent=m.getElement('SellerPool'),a=m.addShape('bpmn:DataObjectReference',{x:1050,y:630},{parent}),b=m.addShape('bpmn:DataStoreReference',{x:1180,y:630},{parent}),flow=m.connect(a,m.getElement('ValidateOrder'));if(!flow)throw Error('Data association setup failed');return{a:a.id,b:b.id,flow:flow.id};});
    const before=await state(page);await selectEdge(page,ids.flow);const target=await shapePoint(page,ids.b,{x:0,y:20});await drag(page,await control(page,'.bpmn-xyflow-bendpoint[data-bend-index="0"]'),target);
    const sourceChanged=await state(page),association=sourceChanged.byId[ids.flow];assert.equal(association.$type,'bpmn:DataInputAssociation');assert.equal(association.sourceRef[0],sourceChanged.byId[ids.b]);assert.equal(association.$parent,sourceChanged.byId.ValidateOrder);await historyCycle(page,before,sourceChanged);
    await selectEdge(page,ids.flow);const last=await page.evaluate(id=>window.modeler.getElement(id).waypoints.length-1,ids.flow);await drag(page,await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${last}"]`),await screen(page,{x:1160,y:430}));
    const ownerChanged=await state(page),moved=ownerChanged.byId[ids.flow];assert.equal(moved.$parent,ownerChanged.byId.ShipOrder);assert.ok(ownerChanged.byId.ShipOrder.dataInputAssociations.includes(moved));assert.ok(!(ownerChanged.byId.ValidateOrder.dataInputAssociations||[]).includes(moved));assert.ok(ownerChanged.byId.ShipOrder.ioSpecification.dataInputs.includes(moved.targetRef));assert.equal(moved.sourceRef[0],ownerChanged.byId[ids.b]);await historyCycle(page,sourceChanged,ownerChanged);await reopen(page,ownerChanged);
  });

  await writeFile('test-artifacts/browser-advanced-results.json',JSON.stringify(results,null,2));const failed=results.filter(result=>result.status==='failed');assert.equal(failed.length,0,failed.map(result=>`${result.name}: ${result.error}`).join('\n'));console.log(`PASS ${results.length} native advanced interaction groups`);
} finally {await browser?.close();server.kill('SIGTERM');}
