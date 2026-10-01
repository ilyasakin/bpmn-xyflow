/** Native Group/category acceptance against pinned bpmn-js18.30.1. Fresh rebuild.
 * Imports and observations are setup; tested edits use Chromium input only.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer';
import {BpmnModdle} from 'bpmn-moddle';
import {prepareGroupPaintFixture} from '../helpers/group-paint-fixture.mjs';
import {assertUpstreamSharedGroupDelete} from '../helpers/group-delete-oracle.mjs';
const require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json')),oracle=new BpmnModdle();assert.equal(require('bpmn-js/package.json').version,'18.30.1');
const fixtureRoot='test/fixtures/group-native';
if(process.env.BPMN_GROUP_FIXTURE_DIR){await mkdir(process.env.BPMN_GROUP_FIXTURE_DIR,{recursive:true});for(const name of ['shared','single','overlap'])await copyFile(`${fixtureRoot}/${name}.bpmn`,path.join(process.env.BPMN_GROUP_FIXTURE_DIR,`${name}.bpmn`));console.log('Wrote Group native fixtures');process.exit(0);}
const port=Number(process.env.BPMN_GROUP_LABELS_PORT||5247),base=`http://localhost:${port}`,results=[];let server,browser,serverOutput='';
const rect=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
const fixture=name=>readFile(`${fixtureRoot}/${name}.bpmn`,'utf8');
async function canonical(parsed,sort=false){if(sort)for(const o of Object.values(parsed.elementsById))for(const k of ['rootElements','artifacts','planeElement'])if(Array.isArray(o[k]))o[k].sort((a,b)=>String(a.id).localeCompare(String(b.id)));return(await oracle.toXML(parsed.rootElement,{format:true})).xml;}
async function setup(engine,xml){
 const page=await browser.newPage(),errors=[];page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 try{await page.setViewport({width:1900,height:1350});await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
  if(engine==='upstream'){await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});for(const f of ['diagram-js.css','bpmn-js.css','bpmn-font/css/bpmn-embedded.css'])await page.addStyleTag({path:require.resolve('bpmn-js/dist/assets/'+f)});}
  const warnings=await page.evaluate(async({engine,xml,labelUrl,layoutUrl})=>{
   const labelUtil=await import(labelUrl),layout=await import(layoutUrl),container=document.querySelector('#viewer');let m,result;
   if(engine==='upstream'){window.modeler.destroy();container.replaceChildren();m=new window.BpmnJS({container});window.groupReference=m;result=await m.importXML(xml);const canvas=m.get('canvas');canvas.viewbox({x:-160/.9,y:-110/.9,width:container.clientWidth/.9,height:container.clientHeight/.9});
    window.groupTest={engine,m,container,node:id=>m.get('elementRegistry').get(id),xml:async()=>(await m.saveXML({format:true})).xml,selection:()=>m.get('selection').get().map(o=>o.id),history:()=>({index:m.get('commandStack')._stackIdx,undo:m.get('commandStack').canUndo(),redo:m.get('commandStack').canRedo()}),viewport:()=>{const v=canvas.viewbox();return{x:-v.x*v.scale,y:-v.y*v.scale,zoom:v.scale};}};
    window.groupCreateEvidence={starts:0,moves:0};
    for(const phase of ['start','move'])m.get('eventBus').on('create.'+phase,500,e=>{const evidence=window.groupCreateEvidence;evidence[phase==='start'?'starts':'moves']++;evidence.last={type:e.context.shape.type,x:e.x,y:e.y,allowed:e.context.canExecute,target:e.context.target?.id,trusted:e.originalEvent?.isTrusted};});
    m.get('eventBus').on('resize.move',e=>{window.groupResizeEvidence={id:e.context.shape.id,bounds:{...e.context.newBounds},count:(window.groupResizeEvidence?.count||0)+1};});
   }else{m=window.modeler;result=await m.importXML(xml);await m.setViewport({x:160,y:110,zoom:.9},{duration:0});window.groupTest={engine,m,container,node:id=>m.getElement(id),xml:()=>m.getXML(),selection:()=>m.getSelection(),history:()=>({size:m.commandStack.size(),undo:m.canUndo(),redo:m.canRedo()}),viewport:()=>m.getViewport()};}
   Object.assign(window.groupTest,{labelUtil,layout,deleteTrace:[]});
   if(engine==='upstream')for(const phase of ['preExecute','executed'])m.get('eventBus').on('commandStack.'+phase,20000,event=>{
    const t=window.groupTest;if(!t.traceDelete)return;const c=event.context||{},value=t.node('GroupB')?.businessObject.categoryValueRef;
    t.deleteTrace.push({phase,command:event.command,shape:c.shape?.id,element:c.element?.id,labelTarget:c.labelTarget?.id,elements:c.elements?.map(e=>e.id),newLabel:c.newLabel,hints:{unsetLabel:c.hints?.unsetLabel,removeShape:c.hints?.removeShape},selection:t.selection(),directEditing:m.get('directEditing').isActive(),sharedValue:{id:value?.id,value:value?.value??null}});
   });
   return result.warnings.map(w=>w.message);
  },{engine,xml,labelUrl:'/@fs/'+require.resolve('bpmn-js/lib/features/modeling/behavior/LabelBehavior.js'),layoutUrl:'/@fs/'+up.resolve('diagram-js/lib/layout/LayoutUtil.js')});assert.deepEqual(warnings,[]);return{page,errors,engine};
 }catch(e){await page.close().catch(()=>{});throw e;}
}
async function state(page){
 const raw=await page.evaluate(async()=>{const t=window.groupTest;const groups=t.engine==='local'?t.m.getGraph().nodes.filter(n=>n.type==='bpmn:Group'):t.m.get('elementRegistry').filter(n=>n.type==='bpmn:Group'&&!n.labelTarget);
  return{xml:await t.xml(),engine:t.engine,history:t.history(),viewport:t.viewport(),selection:t.selection(),deleteTrace:t.deleteTrace,deleteBefore:t.deleteBefore||null,display:Object.fromEntries(groups.map(g=>[g.id,g.label?{x:g.label.x,y:g.label.y,width:g.label.width,height:g.label.height}:null])),rendered:Object.fromEntries(groups.map(g=>[g.id,[...t.container.querySelectorAll(`[data-element-id="${g.id}_label"] text tspan`)].map(t=>t.textContent).join(' ')]))};});
 const parsed=await oracle.fromXML(raw.xml);assert.deepEqual(parsed.warnings,[]);const di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]);
 return{...raw,parsed,canonical:await canonical(await oracle.fromXML(raw.xml),raw.engine==='upstream'),groups:Object.fromEntries(Object.values(parsed.elementsById).filter(o=>o.$type==='bpmn:Group').map(g=>[g.id,{id:g.id,valueId:g.categoryValueRef?.id,categoryId:g.categoryValueRef?.$parent?.id,value:g.categoryValueRef?.value||'',attrs:{...g.$attrs}}])),di:Object.fromEntries(di.map(d=>[d.bpmnElement.id,{id:d.id,bounds:d.bounds?rect(d.bounds):null,label:d.label?.bounds?rect(d.label.bounds):null}]))};
}
const serial=s=>({xml:s.xml,history:s.history,selection:s.selection,groups:s.groups,di:s.di,display:s.display,rendered:s.rendered,deleteBefore:s.deleteBefore,deleteTrace:s.deleteTrace});
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function screen(page,p){return page.evaluate(p=>{const t=window.groupTest,r=t.container.getBoundingClientRect(),v=t.viewport();return{x:r.left+v.x+p.x*v.zoom,y:r.top+v.y+p.y*v.zoom};},p);}
async function target(page,p){return page.evaluate(p=>{const el=document.elementFromPoint(p.x,p.y),r=window.groupTest.container.getBoundingClientRect();return{id:el?.closest('[data-element-id]')?.getAttribute('data-element-id')||null,inside:p.x>=r.left&&p.x<Math.min(innerWidth,r.right)&&p.y>=r.top&&p.y<Math.min(innerHeight,r.bottom),dom:el?.outerHTML};},p);}
async function clickPoint(page,p,id,options){const s=await screen(page,p),hit=await target(page,s);assert.ok(hit.inside);if(id!==undefined)assert.equal(hit.id,id,JSON.stringify(hit));await page.mouse.click(s.x,s.y,options);await settle(page);return s;}
async function border(page,id,options){const b=(await state(page)).di[id].bounds;return clickPoint(page,{x:b.x,y:b.y+b.height*.6},id,options);}
async function labelPoint(page,id){const b=(await state(page)).display[id];assert.ok(b,'visible external label exists');return clickPoint(page,{x:b.x+b.width/2,y:b.y+b.height/2},id+'_label');}
async function editor(page){const handle=await page.waitForSelector('[contenteditable="true"],[contenteditable="plaintext-only"]');assert.equal(await handle.evaluate(e=>document.activeElement===e||e.contains(document.activeElement)),true);return handle;}
async function rename(page,id,text,{cancel=false}={}){await border(page,id,{count:2,delay:50});const el=await editor(page);await el.click();await page.keyboard.down('Control');await page.keyboard.press('a');await page.keyboard.up('Control');if(text)await page.keyboard.type(text);else await page.keyboard.press('Backspace');await page.keyboard.press(cancel?'Escape':'Enter');await page.waitForSelector('[contenteditable="true"],[contenteditable="plaintext-only"]',{hidden:true});await settle(page);}
async function key(page,key,{control=false,shift=false}={}){if(control)await page.keyboard.down('Control');if(shift)await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');if(control)await page.keyboard.up('Control');}await settle(page);}
async function undo(page,redo=false){if(await page.evaluate(()=>window.groupTest.engine)==='local')await page.click(redo?'#redo-btn':'#undo-btn');else{await clickPoint(page,{x:1550,y:1120});await key(page,'z',{control:true,shift:redo});}await settle(page);}
const cleanText=s=>String(s||'').replace(/\s/g,'');
function boundsInner(xml){const shape=xml.match(/<bpmndi:BPMNShape\b[^>]*id="GroupA_di"[^>]*>([\s\S]*?)<\/bpmndi:BPMNShape>/)?.[1];if(!shape)return null;const label=shape.match(/<bpmndi:BPMNLabel\b[^>]*id="GroupLabelDI"[^>]*>([\s\S]*?)<\/bpmndi:BPMNLabel>/)?.[1];if(!label)return null;return label.match(/<dc:Bounds\b[^>]*(?:\/>|>([\s\S]*?)<\/dc:Bounds>)/)?.[1]??'';}
async function labelChangeOnly(before,after,ids,{ownerResize=false}={}){
 const expected=await oracle.fromXML(before.xml),actual=await oracle.fromXML(after.xml);
 const oldDi=expected.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]),newDi=actual.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]);
 for(const id of ids){const old=expected.elementsById[id],next=actual.elementsById[id];assert.ok(old&&next);assert.equal(next.categoryValueRef?.id,old.categoryValueRef?.id);
  if(!ownerResize)next.categoryValueRef.value=old.categoryValueRef.value;
  const a=newDi.find(d=>d.bpmnElement.id===id),b=oldDi.find(d=>d.bpmnElement.id===id);
  if(ownerResize)Object.assign(a.bounds,rect(b.bounds));
  if(a.label&&b.label){assert.deepEqual(a.label.$attrs,b.label.$attrs);assert.equal(a.label.id,b.label.id);if(a.label.bounds&&b.label.bounds)Object.assign(a.label.bounds,rect(b.label.bounds));else if(!b.label.bounds)delete a.label.bounds;}
  else if(!b.label)delete a.label;
 }
 assert.equal(await canonical(actual,before.engine==='upstream'),await canonical(expected,before.engine==='upstream'),'label action changes only intended value and label DI; resize permits no title change');
 if(before.engine==='local'&&before.groups.GroupA&&after.groups.GroupA)assert.equal(boundsInner(after.xml),boundsInner(before.xml),'complete Bounds comment/PI content remains at its original Group label location');
}
async function history(page,before,after,{firstLabel=false,owners=[],repeats=2}={}){
 if(before.engine==='local')assert.equal(after.history.size,before.history.size+1);
 for(let i=0;i<repeats;i++){
  await undo(page);const restored=await state(page);
  if(before.engine==='local')assert.equal(restored.xml,before.xml,'local history restores exact imported XML/DI');
  else{
   const expected=await oracle.fromXML(before.xml),afterParsed=after.parsed;
   for(const id of owners){const di=expected.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]).find(d=>d.bpmnElement.id===id);if(di?.label?.bounds&&before.display[id])Object.assign(di.label.bounds,before.display[id]);}
   if(firstLabel){const id=owners[0],group=expected.elementsById[id],value=group.categoryValueRef,category=value.$parent;delete group.categoryValueRef;expected.rootElement.rootElements=expected.rootElement.rootElements.filter(o=>o!==category);const di=expected.rootElement.diagrams[0].plane.planeElement.find(d=>d.bpmnElement.id===id);di.label=afterParsed.rootElement.diagrams[0].plane.planeElement.find(d=>d.bpmnElement.id===id).label;assert.equal(restored.groups[id].valueId,undefined,'observed upstream first-label Undo drops the preexisting category binding');}
   assert.equal(restored.canonical,await canonical(expected,true),'upstream history is limited to its measured displayed-DI/first-binding quirk');
  }
  await undo(page,true);const redone=await state(page);
  if(before.engine==='local')assert.equal(redone.xml,after.xml,'local native Redo restores exact XML including comments and PI');
  else assert.equal(redone.canonical,after.canonical,'reference native Redo restores complete semantic/DI model');
 }
}
async function reopen(page,s){const warnings=await page.evaluate(async({xml,v})=>{const t=window.groupTest,r=await t.m.importXML(xml);if(t.engine==='local')await t.m.setViewport(v,{duration:0});else t.m.get('canvas').viewbox({x:-v.x/v.zoom,y:-v.y/v.zoom,width:t.container.clientWidth/v.zoom,height:t.container.clientHeight/v.zoom});return r.warnings.map(w=>w.message);},{xml:s.xml,v:s.viewport});assert.deepEqual(warnings,[]);const after=await state(page);assert.equal(after.canonical,s.canonical);if(s.engine==='local'&&s.groups.GroupA)assert.equal(boundsInner(after.xml),boundsInner(s.xml));return after;}
async function evidence(page,name,data){const observations=await page.evaluate(()=>({selection:window.groupTest.selection(),create:window.groupCreateEvidence||null,resize:window.groupResizeEvidence||null}));await writeFile(`test-artifacts/browser-group-${name}.json`,JSON.stringify({data,observations},null,2));await writeFile(`test-artifacts/browser-group-${name}.bpmn`,await page.evaluate(()=>window.groupTest.xml()));await page.screenshot({path:`test-artifacts/browser-group-${name}.png`,fullPage:true});}
async function run(engine,name,xml,fn,{difference=false}={}){let context;console.log(`START native Group ${engine} ${name}`);try{context=await setup(engine,xml);const details=await fn(context.page);assert.deepEqual(context.errors,[]);await evidence(context.page,`${engine}-${name}`,details);results.push({engine,name,status:difference?'intentional-difference':'passed',details});console.log(`PASS native Group ${engine} ${name}`);}catch(e){results.push({engine,name,status:'failed',error:e.stack||String(e)});console.error(`FAIL native Group ${engine} ${name}: ${e.stack||e}`);if(context)await evidence(context.page,`${engine}-${name}-failure`,{error:String(e),state:serial(await state(context.page))}).catch(()=>{});}finally{await writeFile('test-artifacts/browser-group-labels-results.json',JSON.stringify(results,null,2));await context?.page.close().catch(()=>{});}}
async function paletteGroup(page,position={x:800,y:500}){
 const before=await state(page),selector=before.engine==='upstream'?'.djs-palette [data-action="create.group"]':'.bpmn-xyflow-palette button';
 const handle=before.engine==='upstream'?await page.waitForSelector(selector):await page.evaluateHandle(()=>[...document.querySelectorAll('.bpmn-xyflow-palette button')].find(e=>e.textContent==='+ Group'));
 const box=await handle.asElement().boundingBox();assert.ok(box);const start={x:box.x+box.width/2,y:box.y+box.height/2},end=await screen(page,position);
 assert.equal(await handle.asElement().evaluate((element,p)=>element.contains(document.elementFromPoint(p.x,p.y)),start),true,'palette input targets the visible Group entry');
 assert.ok((await target(page,end)).inside,'chosen Group placement is inside the actual canvas');
 if(before.engine==='upstream'){
  // PaletteProvider starts on click or HTML dragstart, not mousedown. Use its
  // advertised native click-to-arm/place path and prove actual create preview.
  const counts=await page.evaluate(()=>({...window.groupCreateEvidence}));
  await page.mouse.click(start.x,start.y);await page.mouse.move(end.x,end.y,{steps:12});await settle(page);
  const preview=await page.evaluate(()=>{const d=window.groupTest.m.get('dragging').context(),g=document.querySelector('.djs-drag-group');return{evidence:window.groupCreateEvidence,active:d?.active,prefix:d?.prefix,type:d?.data?.context?.shape?.type,visible:!!g&&g.getBoundingClientRect().width>0};});
  assert.ok(preview.evidence.starts>counts.starts&&preview.evidence.moves>counts.moves,'fresh native Group create events');assert.equal(preview.evidence.last.trusted,true);assert.equal(preview.evidence.last.type,'bpmn:Group');assert.ok(preview.evidence.last.allowed,'reference accepts the selected canvas target');assert.equal(preview.active,true);assert.equal(preview.prefix,'create');assert.equal(preview.type,'bpmn:Group');assert.ok(preview.visible,'actual Group create preview is visible');
  await page.mouse.click(end.x,end.y);
 }else{
  try{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await settle(page);
   const preview=await page.evaluate(()=>{const g=document.querySelector('.bpmn-xyflow-palette-ghost');return{visible:!!g&&g.getBoundingClientRect().width>0,text:g?.textContent};});assert.ok(preview.visible);assert.equal(preview.text,'Group');
   await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});}
 }
 await settle(page);
 const after=await state(page),ids=Object.keys(after.groups).filter(id=>!before.groups[id]);assert.equal(ids.length,1);const id=ids[0];assert.deepEqual(after.di[id].bounds,{x:position.x-150,y:position.y-150,width:300,height:300},'native palette placement retains chosen center and reference default geometry');assert.ok(after.groups[id].valueId);assert.ok(after.groups[id].categoryId);
 const pruned=await oracle.fromXML(after.xml);await removeExpected(pruned,[id]);assert.equal(await canonical(pruned,before.engine==='upstream'),before.canonical,'palette creation changes only its new Group/category/DI in these non-enclosing fixtures');
 await history(page,before,after);return{id,before,after};
}
async function removeExpected(parsed,groupIds){
 const removed=new Set(groupIds),values=groupIds.map(id=>parsed.elementsById[id]?.categoryValueRef).filter(Boolean);
 for(const root of parsed.rootElement.rootElements)if(root.artifacts)root.artifacts=root.artifacts.filter(o=>!removed.has(o.id));
 for(const diagram of parsed.rootElement.diagrams)diagram.plane.planeElement=diagram.plane.planeElement.filter(d=>!removed.has(d.bpmnElement.id));
 const groups=Object.values(parsed.elementsById).filter(o=>o.$type==='bpmn:Group'&&!removed.has(o.id));
 for(const value of values)if(!groups.some(g=>g.categoryValueRef===value)){const category=value.$parent;category.categoryValue=category.categoryValue.filter(v=>v!==value);if(!category.categoryValue.length)parsed.rootElement.rootElements=parsed.rootElement.rootElements.filter(r=>r!==category);}
}
async function deleteOnly(before,after,ids){const expected=await oracle.fromXML(before.xml);await removeExpected(expected,ids);assert.equal(after.canonical,await canonical(expected,before.engine==='upstream'),'delete removes only requested Group, unused category binding and its DI');}
async function paintLifecycle(page){
 // Separate setup inside the palette lifecycle case: creation must match normal
 // reference layering; imported/reopened order is the approved explicit delta.
 const xml=await prepareGroupPaintFixture(await fixture('overlap'));
 await reopen(page,{xml,viewport:{x:160,y:110,zoom:.9},canonical:await canonical(await oracle.fromXML(xml),await page.evaluate(()=>window.groupTest.engine)==='upstream'),groups:{}});
 const {id,after}=await paletteGroup(page,{x:380,y:370}),b=after.di[id].bounds;
 await clickPoint(page,{x:b.x+b.width,y:240},id);assert.deepEqual(await page.evaluate(()=>window.groupTest.selection()),[id],'new Group border is above a crossing flow');
 await clickPoint(page,{x:250,y:260},'Source');await clickPoint(page,{x:400,y:240},'Flow');
 const exported=await page.evaluate(async()=>{const t=window.groupTest;return(await t.m.saveSVG()).svg;});const frameIndex=exported.indexOf(`data-element-id="${id}"`),flowIndex=exported.indexOf('data-element-id="Flow"');assert.ok(frameIndex>=0&&flowIndex>=0,'standalone SVG includes both the frame and crossing flow');assert.ok(frameIndex>flowIndex,'standalone SVG retains the normal creation frame order');
 const reopened=await reopen(page,await state(page)),expected=reopened.engine==='upstream'?'Flow':id;
 await clickPoint(page,{x:b.x+b.width,y:240},expected);assert.deepEqual(await page.evaluate(()=>window.groupTest.selection()),[expected],'exact imported Group/flow layer outcome');
 await clickPoint(page,{x:250,y:260},'Source');await clickPoint(page,{x:400,y:240},'Flow');return{createdBorder:id,reopenedBorder:expected};
}
async function freshLabels(page){
 const made=await paletteGroup(page),id=made.id;let before=await state(page);
 await rename(page,id,'Review completed');let after=await state(page);assert.equal(after.groups[id].value,'Review completed');assert.equal(cleanText(after.rendered[id]),'Reviewcompleted');assert.equal(after.parsed.elementsById[id].name,undefined,'Group name is CategoryValue.value, never unsupported Group.name');await labelChangeOnly(before,after,[id]);await history(page,before,after,{firstLabel:true,owners:[id]});
 before=await state(page);await rename(page,id,'Travel review');after=await state(page);await labelChangeOnly(before,after,[id]);await history(page,before,after,{owners:[id]});
 before=await state(page);await rename(page,id,'Cancelled text',{cancel:true});assert.equal((await state(page)).xml,before.xml);assert.deepEqual((await state(page)).history,before.history);
 await rename(page,id,'');after=await state(page);assert.equal(after.groups[id].value,'');assert.equal(cleanText(after.rendered[id]),'');await labelChangeOnly(before,after,[id]);await history(page,before,after,{owners:[id]});
 // Restore via a native rename, then test the advertised external-label Delete.
 await rename(page,id,'Label to remove');before=await state(page);await labelPoint(page,id);await key(page,'Delete');after=await state(page);assert.ok(after.groups[id]);assert.equal(after.groups[id].value,'');await labelChangeOnly(before,after,[id]);await history(page,before,after,{owners:[id]});await reopen(page,after);
 await evidence(page,`${after.engine}-palette-label-lifecycle`,{id,state:serial(after)});return{id,paint:await paintLifecycle(page)};
}
async function sharedLabels(page){
 const before=await state(page),old=before.groups.GroupB.value;await rename(page,'GroupA','Renamed shared category');const after=await state(page);
 assert.equal(after.groups.GroupA.valueId,after.groups.GroupB.valueId);assert.equal(after.groups.GroupB.value,'Renamed shared category');assert.equal(cleanText(after.rendered.GroupA),'Renamedsharedcategory');assert.equal(cleanText(after.rendered.GroupB),cleanText(after.engine==='upstream'?old:'Renamed shared category'),'exact shared-peer rendered outcome');
 await labelChangeOnly(before,after,after.engine==='upstream'?['GroupA']:['GroupA','GroupB']);await history(page,before,after,{owners:['GroupA']});
 const reopened=await reopen(page,after);assert.equal(cleanText(reopened.rendered.GroupA),'Renamedsharedcategory');assert.equal(cleanText(reopened.rendered.GroupB),'Renamedsharedcategory','both engines show shared semantic value after reopen');
 const baseline=await state(page);await border(page,'GroupA');
 const selected=await page.evaluate(()=>{const t=window.groupTest,active=t.engine==='upstream'?t.m.get('directEditing').isActive():!!document.querySelector('[contenteditable="true"],[contenteditable="plaintext-only"]');return t.deleteBefore={selection:t.selection(),directEditing:active,text:document.activeElement?.isContentEditable?document.activeElement.textContent:null,value:t.node('GroupB').businessObject.categoryValueRef.value};});
 assert.deepEqual(selected.selection,['GroupA'],'native Delete targets only GroupA, not its shared label');assert.equal(selected.directEditing,false,'native Delete cannot complete a pending label edit');
 await page.evaluate(()=>{window.groupTest.traceDelete=true;window.groupTest.deleteTrace=[];});
 await key(page,'Delete');const deleted=await state(page);assert.equal(deleted.groups.GroupA,undefined);assert.ok(deleted.groups.GroupB);assert.ok(deleted.parsed.elementsById.ReviewCategory);
 if(deleted.engine==='upstream'){assert.equal(deleted.groups.GroupB.value,'');await assertUpstreamSharedGroupDelete(baseline.xml,deleted.xml);}
 else{assert.equal(deleted.groups.GroupB.value,baseline.groups.GroupB.value);await deleteOnly(baseline,deleted,['GroupA']);}
 await history(page,baseline,deleted,{owners:['GroupA']});await undo(page);const restored=await state(page);if(restored.engine==='local')assert.equal(boundsInner(restored.xml),boundsInner(baseline.xml));return{renamed:serial(after),deleted:serial(deleted)};
}
async function lastDelete(page){const before=await state(page);await border(page,'GroupA');await key(page,'Delete');const after=await state(page);assert.equal(after.groups.GroupA,undefined);assert.equal(after.parsed.elementsById.ReviewCategory,undefined);assert.equal(after.parsed.elementsById.ReviewValue,undefined);await deleteOnly(before,after,['GroupA']);await history(page,before,after,{owners:['GroupA']});await undo(page);const restored=await state(page);if(restored.engine==='local')assert.equal(boundsInner(restored.xml),boundsInner(before.xml));await reopen(page,restored);return{before:serial(before),deleted:serial(after)};}
async function copyRename(page){
 await border(page,'GroupA');const before=await state(page);await key(page,'d',{control:true});
 if(before.engine==='upstream'){await page.waitForFunction(()=>!!window.groupReference.get('dragging').context());const drop=await screen(page,{x:800,y:950});await page.mouse.move(drop.x,drop.y,{steps:12});await page.mouse.click(drop.x,drop.y);await settle(page);}
 const copied=await state(page),ids=Object.keys(copied.groups).filter(id=>!before.groups[id]);assert.equal(ids.length,1);const id=ids[0];assert.notEqual(copied.groups[id].valueId,before.groups.GroupA.valueId);assert.notEqual(copied.groups[id].categoryId,before.groups.GroupA.categoryId);
 const pruned=await oracle.fromXML(copied.xml);await removeExpected(pruned,[id]);assert.equal(await canonical(pruned,before.engine==='upstream'),before.canonical,'copy does not alter original bindings/metadata/DI');
 const oldValue=before.parsed.elementsById.ReviewValue,newValue=copied.parsed.elementsById[copied.groups[id].valueId];const docs=o=>(o.documentation||[]).map(d=>d.text);
 assert.deepEqual(docs(newValue),docs(oldValue),'standard CategoryValue documentation copied');
 assert.deepEqual(docs(copied.parsed.elementsById[id]),docs(before.parsed.elementsById.GroupA),'standard Group documentation copied');
 assert.deepEqual(docs(copied.parsed.elementsById[copied.groups[id].categoryId]),docs(before.parsed.elementsById[before.groups.GroupA.categoryId]),'standard Category documentation copied');
 await history(page,before,copied);
 const baseline=await state(page);await rename(page,id,'Copy only');const after=await state(page);assert.equal(after.groups[id].value,'Copy only');assert.equal(after.groups.GroupA.value,before.groups.GroupA.value);assert.equal(after.groups.GroupB.value,before.groups.GroupB.value);await labelChangeOnly(baseline,after,[id]);await history(page,baseline,after,{owners:[id]});await reopen(page,after);return{copy:id,value:after.groups[id]};
}
async function resizeOwner(page){
 await border(page,'GroupA');const before=await state(page),selector=before.engine==='upstream'?'.djs-resizer-GroupA.djs-resizer-nw':'.bpmn-xyflow-resize-handle[data-resize-dir="nw"]';
 async function gesture(cancel){assert.deepEqual(await page.evaluate(()=>window.groupTest.selection()),['GroupA'],'the actual Group remains the sole resize target');const h=await page.waitForSelector(selector),b=await h.boundingBox(),from={x:b.x+b.width/2,y:b.y+b.height/2},to={x:from.x-36,y:from.y-27},count=await page.evaluate(()=>window.groupResizeEvidence?.count||0);assert.equal(await page.evaluate(({p,selector})=>!!document.elementFromPoint(p.x,p.y)?.closest(selector),{p:from,selector}),true,'native pointer targets the selected Group NW control');try{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await settle(page);
  if(before.engine==='upstream'){const active=await page.evaluate(()=>window.groupResizeEvidence);assert.ok(active?.count>count&&active.id==='GroupA');assert.ok(['x','y','width','height'].some(k=>active.bounds[k]!==before.di.GroupA.bounds[k]),'reference resize preview really changed selected Group bounds');}
  else assert.notDeepEqual((await state(page)).di.GroupA.bounds,before.di.GroupA.bounds,'local resize preview really activated');
  if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});}await settle(page);}
 await gesture(true);assert.equal((await state(page)).xml,before.xml);assert.deepEqual((await state(page)).history,before.history);const selectionAfterCancel=await page.evaluate(()=>window.groupTest.selection());if(selectionAfterCancel.length!==1||selectionAfterCancel[0]!=='GroupA')await border(page,'GroupA');assert.deepEqual(await page.evaluate(()=>window.groupTest.selection()),['GroupA']);await gesture(false);const after=await state(page);assert.notDeepEqual(after.di.GroupA.bounds,before.di.GroupA.bounds);
 const expected=await page.evaluate(({label,oldBounds,newBounds})=>{const t=window.groupTest,ref=t.labelUtil.getReferencePoint(t.layout.getMid(label),t.labelUtil.asEdges(oldBounds)),d=t.labelUtil.getReferencePointDelta(ref,oldBounds,newBounds);return{x:label.x+d.x,y:label.y+d.y,width:label.width,height:label.height};},{label:before.display.GroupA,oldBounds:before.di.GroupA.bounds,newBounds:after.di.GroupA.bounds});
 assert.deepEqual(after.display.GroupA,expected);assert.deepEqual(after.di.GroupA.label,expected);assert.equal(after.groups.GroupA.value,before.groups.GroupA.value);await labelChangeOnly(before,after,['GroupA'],{ownerResize:true});await history(page,before,after,{owners:['GroupA'],repeats:3});await reopen(page,after);return{before:serial(before),after:serial(after),expected};
}
async function unsupportedEditor(page,id){
 const before=await state(page),positions={Association:{x:570,y:590},DataIn:{x:270,y:582.6829268292682},DataOut:{x:540,y:745}};
 await clickPoint(page,positions[id],id,{count:2,delay:50});assert.equal(await page.$('[contenteditable="true"],[contenteditable="plaintext-only"]'),null,'unsupported semantic edge has no editor');
 const p=await screen(page,positions[id]);await page.mouse.click(p.x,p.y,{button:'right'});await settle(page);const options=await page.evaluate(()=>[...document.querySelectorAll('.bpmn-xyflow-context-menu,.djs-popup,.djs-context-pad')].map(el=>el.textContent).join(' '));assert.ok(!/Edit label|Rename/i.test(options),'unsupported edge does not advertise an editor');await page.keyboard.press('Escape');const after=await state(page);assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);return{id,options};
}
try{
 server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});server.stdout.on('data',c=>{serverOutput+=String(c);});const deadline=Date.now()+60000;while(true){const actual=serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);if(actual&&Number(actual[1])!==port)throw Error(`Owned Group server bound unexpected port ${actual[1]}`);if(actual)try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw Error('Group server startup timeout');await new Promise(r=>setTimeout(r,150));}
 browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});await mkdir('test-artifacts',{recursive:true});
 for(const engine of ['upstream','local']){
  await run(engine,'palette-title-empty-delete-and-frame-order',await readFile('test/fixtures/bpmn/basic.bpmn','utf8'),freshLabels,{difference:true});
  await run(engine,'shared-category-metadata-peer-and-delete',await fixture('shared'),sharedLabels,{difference:true});
  await run(engine,'last-group-category-cleanup',await fixture('single'),lastDelete,{difference:true});
  await run(engine,'owner-resize-nearest-border-label',await fixture('shared'),resizeOwner,{difference:true});
  await run(engine,'keyboard-copy-independent-category',await fixture('shared'),copyRename);
  for(const id of ['Association','DataIn','DataOut'])await run(engine,`unsupported-editor-${id}`,await fixture('shared'),page=>unsupportedEditor(page,id));
 }
 assert.equal(results.length,16);const failed=results.filter(r=>r.status==='failed');assert.equal(failed.length,0,failed.map(r=>`${r.engine} ${r.name}: ${r.error}`).join('\n'));console.log('PASS Group16 native groups (8 matching cases; 8 cases assert explicit reference differences)');
}finally{await browser?.close();server?.kill('SIGTERM');}
