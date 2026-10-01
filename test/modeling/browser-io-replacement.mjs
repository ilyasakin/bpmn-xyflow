/**
 * Native IO conversion acceptance. Import and the blocked-reference fixture
 * are setup only; selection, replacement, Cancel, confirmation and history
 * use real Chromium mouse/keyboard input. No synthetic dispatch or API edits
 * stand in for the actions under test. Run through the bounded CI supervisor.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const require=createRequire(import.meta.url);
assert.equal(require('bpmn-js/package.json').version,'18.30.1');
const port=Number(process.env.BPMN_IO_PORT||5245),base=`http://localhost:${port}`;
const oracle=new BpmnModdle(),results=[],eventId='WarehouseStatusReceived';
const fixture=await readFile('test/fixtures/io-replacement/order-status.bpmn','utf8');
const rowSelector='[role="menuitem"][data-action="replace-with-message-intermediate-throw"]';
const dialogSelector='.bpmn-xyflow-replace-menu[role="dialog"][aria-label="Replace and remove incompatible data"]';
let browser,server,serverOutput='';

// Independent moddle graph, including all owned extension/DI nodes. Declared
// references are represented by IDs instead of following cycles. Generic
// descriptors need not have a properties array.
function tree(value) {
  if(value==null||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(tree);
  const result={};
  if(value.$type)result.$type=value.$type;
  for(const key of [...new Set([...Object.keys(value),...(value.$descriptor?.properties||[]).filter(property=>Object.hasOwn(value,property.name)).map(property=>property.name)])].sort()) {
    if(key.startsWith('$')&&!['$body','$children'].includes(key))continue;
    if(key.startsWith('xmlns'))continue;
    const property=value.$descriptor?.properties?.find(prop=>prop.name===key||prop.ns?.localName===key);
    if(property?.isVirtual)continue;
    const data=value[key];
    const ref=item=>({$ref:typeof item==='object'?item.id:item});
    result[key]=property?.isReference?(Array.isArray(data)?data.map(ref):ref(data)):tree(data);
  }
  const attrs=Object.fromEntries(Object.entries(value.$attrs||{}).filter(([key])=>!key.startsWith('xmlns')&&key!=='xsi:type').sort(([a],[b])=>a.localeCompare(b)));
  if(Object.keys(attrs).length)result.$attrs=attrs;
  return result;
}
function rawMetadata(xml) {
  const owner=xml.match(/<status:record\b[^>]*\bcode="event"[^>]*>([\s\S]*?)<\/status:record>/)?.[1];
  const lineage=xml.match(/<bpmndi:BPMNShape\b[^>]*\bid="WarehouseStatusReceived_lineage_di"[^>]*>[\s\S]*?<dc:Bounds\b[^>]*>([\s\S]*?)<\/dc:Bounds>/)?.[1];
  assert.equal(owner,'Preserve <!-- io-owner-marker -->event<?io-owner preserve?>','owner mixed text/comment/PI order');
  assert.equal(lineage,'<!-- io-lineage-marker --><?io-lineage preserve?>','inactive Bounds comment/PI order');
  return{owner,lineage};
}
async function state(page) {
  const xml=await page.evaluate(()=>window.modeler.getXML()),parsed=await oracle.fromXML(xml);
  assert.deepEqual(parsed.warnings,[],'independent upstream XML parse has no warnings');
  return{xml,model:tree(parsed.rootElement),byId:parsed.elementsById,raw:rawMetadata(xml),
    history:await page.evaluate(()=>({size:window.modeler.commandStack.size(),undo:window.modeler.canUndo(),redo:window.modeler.canRedo()}))};
}
async function unchanged(page,before,reason) {
  const actual=await state(page);assert.equal(actual.xml,before.xml,reason+' exact XML/DI');
  assert.deepEqual(actual.model,before.model,reason+' complete semantics');assert.deepEqual(actual.history,before.history,reason+' history');return actual;
}
async function pointForControl(page,selector,text) {
  await page.waitForSelector(selector);
  const point=await page.evaluate(({selector,text})=>{
    const element=[...document.querySelectorAll(selector)].find(node=>text==null||node.textContent.trim()===text);
    if(!element)throw Error(`Missing named control ${selector}: ${text}`);
    const r=element.getBoundingClientRect(),p={x:r.left+r.width/2,y:r.top+r.height/2},hit=document.elementFromPoint(p.x,p.y)?.closest(selector);
    return{...p,visible:r.width>0&&r.height>0&&p.x>=0&&p.y>=0&&p.x<innerWidth&&p.y<innerHeight,
      exact:hit===element,text:hit?.textContent.trim(),disabled:element.getAttribute('aria-disabled')};
  },{selector,text});
  assert.ok(point.visible&&point.exact,`native named-control hit ${selector}: ${JSON.stringify(point)}`);
  if(text!=null)assert.equal(point.text,text,'hit is the requested button, not merely the dialog');return point;
}
async function clickControl(page,selector,text) {const p=await pointForControl(page,selector,text);await page.mouse.click(p.x,p.y);return p;}
async function selectEvent(page) {
  const p=await page.evaluate(id=>{const m=window.modeler,n=m.getElement(id),v=m.getViewport(),r=m.getContainer().getBoundingClientRect();
    const p={x:r.left+v.x+(n.x+n.width/2)*v.zoom,y:r.top+v.y+(n.y+n.height/2)*v.zoom};return{...p,id:document.elementFromPoint(p.x,p.y)?.closest('[data-element-id]')?.getAttribute('data-element-id')};},eventId);
  assert.equal(p.id,eventId,'event center is the actual native pointer target');await page.mouse.click(p.x,p.y);
  assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[eventId]);
}
async function openMenu(page) {
  await selectEvent(page);await clickControl(page,'.bpmn-xyflow-context-pad button[title^="Change type"]');await page.waitForSelector(rowSelector);
}
async function openDialog(page) {
  await openMenu(page);const row=await pointForControl(page,rowSelector);assert.notEqual(row.disabled,'true','explicit IO cleanup is available');
  await page.mouse.click(row.x,row.y);await page.waitForSelector(dialogSelector);
  const message=await page.$eval(dialogSelector,element=>element.textContent);assert.match(message,/incompatible data/i);assert.match(message,/Undo/i);
  return message;
}
async function history(page,before,after) {
  const cycles=[];
  for(let i=0;i<3;i++){
    await clickControl(page,'#undo-btn');const reverted=await state(page);assert.equal(reverted.xml,before.xml,'Undo restores byte-exact metadata, refs and both DI planes');assert.deepEqual(reverted.model,before.model);assert.equal(reverted.history.size,before.history.size);
    await clickControl(page,'#redo-btn');const redone=await state(page);assert.equal(redone.xml,after.xml,'Redo restores byte-exact converted model');assert.deepEqual(redone.model,after.model);assert.deepEqual(redone.history,after.history);cycles.push({cycle:i+1,undoXMLExact:true,redoXMLExact:true});
  }
  return cycles;
}
function conversionExpectation(before) {
  const expected=structuredClone(before.model),removed=new Set(),owner=before.byId[eventId];
  const collect=node=>{if(!node||typeof node!=='object')return;if(node.id)removed.add(node.id);for(const [name,value]of Object.entries(node)){if(name.startsWith('$'))continue;const prop=node.$descriptor?.properties?.find(p=>p.name===name);if(!prop?.isReference)(Array.isArray(value)?value:[value]).forEach(collect);}};
  for(const key of ['dataOutputs','outputSet','dataOutputAssociations'])(Array.isArray(owner[key])?owner[key]:[owner[key]]).forEach(collect);
  // The inactive association is owned by another task, but consumes the
  // removed output. Its semantic entry and all DI mirrors must be removed.
  for(const object of Object.values(before.byId))if(object.$instanceOf?.('bpmn:DataAssociation')&&
    [...(object.sourceRef||[]),object.targetRef].some(ref=>removed.has(ref?.id)))collect(object);
  assert.ok(removed.has('StatusToPayload')&&removed.has('StatusToArchive'),'fixture covers two distinct IO associations');
  function edit(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(edit);return;}
    if(node.id===eventId){node.$type='bpmn:IntermediateThrowEvent';for(const key of ['dataOutputs','outputSet','dataOutputAssociations','parallelMultiple'])delete node[key];}
    if(Array.isArray(node.planeElement))node.planeElement=node.planeElement.filter(di=>!removed.has(di.bpmnElement?.$ref));
    for(const key of ['dataInputAssociations','dataOutputAssociations'])if(Array.isArray(node[key])){node[key]=node[key].filter(association=>!removed.has(association.id));if(!node[key].length)delete node[key];}
    Object.values(node).forEach(edit);
  }
  edit(expected);return{expected,removed:[...removed]};
}
async function reopen(page,expected) {
  const warnings=await page.evaluate(async xml=>{const result=await window.modeler.importXML(xml);window.modeler.setViewport({x:100,y:70,zoom:.9});return result.warnings.map(w=>w.message);},expected.xml);
  assert.deepEqual(warnings,[]);const reopened=await state(page);assert.deepEqual(reopened.model,expected.model,'actual reopen retains all independent semantics, DI and extension values');assert.deepEqual(reopened.raw,expected.raw);
}
async function setup(page,{blocked=false}={}) {
  await page.setViewport({width:1800,height:1200});await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
  const warnings=await page.evaluate(async({xml,blocked,id})=>{
    const m=window.modeler,result=await m.importXML(xml);m.setViewport({x:100,y:70,zoom:.9});
    if(blocked){const defs=m.getDefinitions(),event=m.getElement(id).businessObject,output=event.dataOutputs[0];
      const relationship=m.getModdle().create('bpmn:Relationship',{id:'NativeRetainedOutputReference',type:'retained-output-audit',source:[output],target:[event]});relationship.$parent=defs;(defs.relationships||=([])).push(relationship);}
    return result.warnings.map(w=>w.message);
  },{xml:fixture,blocked,id:eventId});assert.deepEqual(warnings,[]);
}
async function run(name,options,action) {
  let page;const errors=[];
  console.log(`START native IO ${name}`);
  try{
    page=await browser.newPage();page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
    await setup(page,options);const details=await action(page);assert.deepEqual(errors,[],'no browser errors');
    const final=await state(page);await writeFile(`test-artifacts/browser-io-${name}.bpmn`,final.xml);await page.screenshot({path:`test-artifacts/browser-io-${name}-pass.png`,fullPage:true});
    results.push({name,status:'passed',details});console.log(`PASS native IO ${name}`);
  }catch(error){const failure={name,status:'failed',error:error.stack||String(error),browserErrors:errors};results.push(failure);console.error(`FAIL native IO ${name}: ${failure.error}`);
    if(page){await page.screenshot({path:`test-artifacts/browser-io-${name}-failure.png`,fullPage:true}).catch(()=>{});const xml=await page.evaluate(()=>window.modeler?.getXML()).catch(()=>null);if(xml)await writeFile(`test-artifacts/browser-io-${name}-failure.bpmn`,xml);}}
  finally{await writeFile('test-artifacts/browser-io-results.json',JSON.stringify({results},null,2));await page?.close().catch(()=>{});}
}

try{
  await mkdir('test-artifacts',{recursive:true});rawMetadata(fixture);assert.deepEqual((await oracle.fromXML(fixture)).warnings,[]);
  server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});server.stdout.on('data',chunk=>{serverOutput+=String(chunk);});
  const deadline=Date.now()+60000;while(true){const actual=serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);if(actual&&Number(actual[1])!==port)throw Error(`IO server bound unexpected port ${actual[1]}`);
    if(actual){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}}
    if(server.exitCode!==null||Date.now()>deadline)throw Error('IO demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});
  await run('catch-to-throw-confirmation',{},async page=>{
    const before=await state(page);assert.equal(before.byId[eventId].$type,'bpmn:IntermediateCatchEvent');assert.equal(before.model.diagrams.length,2,'fixture has active and inactive DI planes');
    const dialog=await openDialog(page);await unchanged(page,before,'opening cleanup confirmation');await clickControl(page,dialogSelector+' button','Cancel');await page.waitForSelector(dialogSelector,{hidden:true});await unchanged(page,before,'Cancel');
    await openDialog(page);await clickControl(page,dialogSelector+' button','Replace and remove incompatible data');await page.waitForSelector(dialogSelector,{hidden:true});
    const after=await state(page),{expected,removed}=conversionExpectation(before);assert.equal(after.history.size,before.history.size+1,'cleanup and replacement form one command');assert.deepEqual(after.model,expected,'only type and explicitly incompatible owned IO/DI may change');assert.deepEqual(after.raw,before.raw);
    for(const id of removed)assert.equal(after.byId[id],undefined,`removed semantic ID ${id} is absent`);
    assert.equal(after.byId[eventId].$parent.id,before.byId[eventId].$parent.id,'semantic owner is retained');assert.deepEqual((after.byId[eventId].incoming||[]).map(e=>e.id),(before.byId[eventId].incoming||[]).map(e=>e.id));assert.deepEqual((after.byId[eventId].outgoing||[]).map(e=>e.id),(before.byId[eventId].outgoing||[]).map(e=>e.id));
    const cycles=await history(page,before,after);await reopen(page,after);return{dialog,removed,cycles,reopened:true};
  });
  await run('retained-reference-refusal',{blocked:true},async page=>{
    const before=await state(page);assert.equal(before.byId.NativeRetainedOutputReference.source[0],before.byId[eventId].dataOutputs[0]);
    await openMenu(page);const row=await pointForControl(page,rowSelector);assert.equal(row.disabled,'true','retained external reference disables incompatible cleanup');await page.mouse.click(row.x,row.y);
    assert.equal(await page.$(dialogSelector),null,'disabled target never opens destructive confirmation');await unchanged(page,before,'native disabled-row activation');await page.keyboard.press('Escape');await unchanged(page,before,'dismiss disabled replacement menu');return{disabled:true,reference:before.byId.NativeRetainedOutputReference.source[0].id};
  });
  const failures=results.filter(result=>result.status!=='passed');if(failures.length)throw Error(`${failures.length}/${results.length} native IO cases failed`);console.log(`PASS all ${results.length} native IO cases`);
}finally{
  await browser?.close().catch(()=>{});
  if(server&&server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);}
}
