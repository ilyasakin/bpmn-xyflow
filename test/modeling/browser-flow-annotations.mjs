/** Native flow-owned annotation acceptance. Fresh reconstruction after 2832d9f9.
 * Pointers and product UI perform every tested action; imports are fixture setup.
 * Geometry expectations use the pinned upstream service, never the local helper.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import puppeteer from 'puppeteer';
import {BpmnModdle} from 'bpmn-moddle';
const require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json'));
const oracle=new BpmnModdle();assert.equal(require('bpmn-js/package.json').version,'18.30.1');
const fixtureRoot='test/fixtures/flow-native';
const fixtureNames=['approval-source','approval-target','review-source','message-source'];
if(process.env.BPMN_FLOW_FIXTURE_DIR){await mkdir(process.env.BPMN_FLOW_FIXTURE_DIR,{recursive:true});for(const name of fixtureNames)await copyFile(`${fixtureRoot}/${name}.bpmn`,path.join(process.env.BPMN_FLOW_FIXTURE_DIR,`${name}.bpmn`));console.log('Wrote four flow annotation acceptance fixtures');process.exit(0);}
const port=Number(process.env.BPMN_FLOW_ANNOTATIONS_PORT||5245),base=`http://localhost:${port}`,results=[];
let browser,server,serverOutput='';
const point=p=>({x:p.x,y:p.y}),rect=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
async function fixture(name,{straight=false,withoutDependent=false}={}){
 const xml=await readFile(`${fixtureRoot}/${name}.bpmn`,'utf8');if(!straight&&!withoutDependent)return xml;
 const p=await oracle.fromXML(xml);assert.deepEqual(p.warnings,[]);
 if(straight){const di=p.rootElement.diagrams[0].plane.planeElement.find(d=>d.bpmnElement.id==='ApproveFlow');di.waypoint=[{x:700,y:348},{x:1100,y:348}].map(v=>oracle.create('dc:Point',v));}
 if(withoutDependent){for(const root of p.rootElement.rootElements)if(root.artifacts)root.artifacts=root.artifacts.filter(o=>!['PolicyNote','PolicyAssociation'].includes(o.id));for(const d of p.rootElement.diagrams)d.plane.planeElement=d.plane.planeElement.filter(o=>!['PolicyNote','PolicyAssociation'].includes(o.bpmnElement.id));}
 return(await oracle.toXML(p.rootElement,{format:true})).xml;
}
async function setup(xml,engine='local',{viewport={x:160,y:120,zoom:.9}}={}){
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
 try{
  await page.setViewport({width:1800,height:1250});await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
  if(engine==='upstream'){await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});for(const name of ['diagram-js.css','bpmn-js.css'])await page.addStyleTag({path:require.resolve(`bpmn-js/dist/assets/${name}`)});}
  const warnings=await page.evaluate(async({engine,xml,viewport,adjustUrl,canvasUrl,layoutUrl})=>{
   const {getConnectionAdjustment}=await import(adjustUrl),{default:Canvas}=await import(canvasUrl),{getConnectionMid}=await import(layoutUrl);
   const container=document.querySelector('#viewer');let m,result;
   if(engine==='upstream'){
    window.modeler.destroy();container.replaceChildren();m=new window.BpmnJS({container});result=await m.importXML(xml);window.reference=m;
    const canvas=m.get('canvas');canvas.viewbox({x:-viewport.x/viewport.zoom,y:-viewport.y/viewport.zoom,width:container.clientWidth/viewport.zoom,height:container.clientHeight/viewport.zoom});
    window.flowTest={engine,m,container,node:id=>m.get('elementRegistry').get(id),xml:async()=>(await m.saveXML({format:true})).xml,selection:()=>m.get('selection').get().map(e=>e.id),history:()=>({undo:m.get('commandStack').canUndo(),redo:m.get('commandStack').canRedo(),index:m.get('commandStack')._stackIdx}),viewport:()=>{const v=canvas.viewbox();return{x:-v.x*v.scale,y:-v.y*v.scale,zoom:v.scale};}};
   }else{
    m=window.modeler;result=await m.importXML(xml);await m.setViewport(viewport,{duration:0});
    window.flowTest={engine,m,container,node:id=>m.getElement(id),xml:()=>m.getXML(),selection:()=>m.getSelection(),history:()=>({undo:m.canUndo(),redo:m.canRedo(),size:m.commandStack.size()}),viewport:()=>m.getViewport()};
   }
   Object.assign(window.flowTest,{getConnectionAdjustment,Canvas,getConnectionMid});return result.warnings.map(w=>w.message);
  },{engine,xml,viewport,adjustUrl:'/@fs/'+require.resolve('bpmn-js/lib/features/modeling/behavior/util/ConnectionLayoutUtil.js'),canvasUrl:'/@fs/'+up.resolve('diagram-js/lib/core/Canvas.js'),layoutUrl:'/@fs/'+up.resolve('diagram-js/lib/layout/LayoutUtil.js')});
  assert.deepEqual(warnings,[],`${engine} import warnings`);return{page,errors,engine};
 }catch(e){await page.close().catch(()=>{});throw e;}
}
async function state(page){
 const raw=await page.evaluate(async()=>{const t=window.flowTest;return{xml:await t.xml(),history:t.history(),viewport:t.viewport(),selection:t.selection()};});
 const parsed=await oracle.fromXML(raw.xml);assert.deepEqual(parsed.warnings,[],'independent exported XML parse');
 const di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]);
 return{...raw,parsed,canonical:(await oracle.toXML(parsed.rootElement,{format:true})).xml,
  shapes:Object.fromEntries(di.filter(d=>d.bounds).map(d=>[d.bpmnElement.id,rect(d.bounds)])),
  edges:Object.fromEntries(di.filter(d=>d.waypoint).map(d=>[d.bpmnElement.id,{id:d.bpmnElement.id,type:d.bpmnElement.$type,source:d.bpmnElement.sourceRef?.id,target:d.bpmnElement.targetRef?.id,points:d.waypoint.map(point),owner:d.bpmnElement.$parent?.id,attrs:{...d.bpmnElement.$attrs},diAttrs:{...d.$attrs}}])),
  notes:Object.values(parsed.elementsById).filter(e=>e.$type==='bpmn:TextAnnotation').map(e=>({id:e.id,text:e.text,owner:e.$parent?.id}))};
}
const serial=s=>({xml:s.xml,history:s.history,viewport:s.viewport,selection:s.selection,shapes:s.shapes,edges:s.edges,notes:s.notes});
async function settle(page){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));}
async function screen(page,p){return page.evaluate(p=>{const t=window.flowTest,r=t.container.getBoundingClientRect(),v=t.viewport();return{x:r.left+v.x+p.x*v.zoom,y:r.top+v.y+p.y*v.zoom};},p);}
async function hit(page,p,id,selector){const target=await page.evaluate(({p,selector})=>{const el=document.elementFromPoint(p.x,p.y),r=window.flowTest.container.getBoundingClientRect();return{id:el?.closest('[data-element-id]')?.getAttribute('data-element-id')||null,selector:selector?!!el?.closest(selector):null,inside:p.x>=r.left&&p.x<Math.min(r.right,innerWidth)&&p.y>=r.top&&p.y<Math.min(r.bottom,innerHeight),tag:el?.tagName,cls:el?.getAttribute('class')};},{p,selector});assert.ok(target.inside,`visible native target ${JSON.stringify({p,target})}`);if(selector)assert.ok(target.selector,JSON.stringify(target));else assert.equal(target.id,id,JSON.stringify(target));return target;}
async function selectEdge(page,id,position){
 const before=await state(page);
 const p=await screen(page,position||await page.evaluate(id=>{const e=window.flowTest.node(id);let found;for(let i=1;i<e.waypoints.length;i++){const a=e.waypoints[i-1],b=e.waypoints[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!found||length>found.length)found={x:a.x+(b.x-a.x)*.75,y:a.y+(b.y-a.y)*.75,length};}return found;},id));
 await hit(page,p,id);await page.mouse.click(p.x,p.y);await settle(page);const after=await state(page);
 assert.deepEqual(after.selection,[id]);assert.equal(after.xml,before.xml,'selecting an edge must not hide a route mutation');assert.deepEqual(after.history,before.history,'selection adds no model history');return after;
}
async function selectShape(page,id){const b=(await state(page)).shapes[id],p=await screen(page,{x:b.x+b.width/2,y:b.y+b.height/2});await hit(page,p,id);await page.mouse.click(p.x,p.y);await settle(page);assert.deepEqual(await page.evaluate(()=>window.flowTest.selection()),[id]);}
async function control(page,selector){const h=await page.waitForSelector(selector),b=await h.boundingBox();assert.ok(b);const p={x:b.x+b.width/2,y:b.y+b.height/2};await hit(page,p,null,selector);return p;}
async function gesture(page,from,to,{cancel=false,preview,modifier}={}){
 if(modifier)await page.keyboard.down(modifier);
 try{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await settle(page);if(preview)await preview();if(cancel)await page.keyboard.press('Escape');await page.mouse.up();await settle(page);}
 finally{await page.mouse.up().catch(()=>{});if(modifier)await page.keyboard.up(modifier).catch(()=>{});}
}
async function history(page,before,after,repeats=2){
 if(await page.evaluate(()=>window.flowTest.engine)==='local')assert.equal(after.history.size,before.history.size+1,'one complete UI action is one command');
 for(let i=0;i<repeats;i++){
  if(await page.evaluate(()=>window.flowTest.engine)==='local')await page.click('#undo-btn');else{const blank=await screen(page,{x:1400,y:900});await page.mouse.click(blank.x,blank.y);await page.keyboard.down('Control');await page.keyboard.press('z');await page.keyboard.up('Control');}
  await settle(page);assert.equal((await state(page)).xml,before.xml,'native Undo restores exact XML/DI');
  if(await page.evaluate(()=>window.flowTest.engine)==='local')await page.click('#redo-btn');else{await page.keyboard.down('Control');await page.keyboard.down('Shift');await page.keyboard.press('z');await page.keyboard.up('Shift');await page.keyboard.up('Control');}
  await settle(page);assert.equal((await state(page)).xml,after.xml,'native Redo restores exact XML/DI');
 }
}
function near(actual,expected,message,tolerance=1.5){assert.ok(actual&&Math.hypot(actual.x-expected.x,actual.y-expected.y)<=tolerance,`${message}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);}
async function reopen(page,expected){
 const warnings=await page.evaluate(async({xml,viewport})=>{const t=window.flowTest,r=await t.m.importXML(xml);if(t.engine==='local')await t.m.setViewport(viewport,{duration:0});else{const c=t.m.get('canvas');c.viewbox({x:-viewport.x/viewport.zoom,y:-viewport.y/viewport.zoom,width:t.container.clientWidth/viewport.zoom,height:t.container.clientHeight/viewport.zoom});}return r.warnings.map(w=>w.message);},{xml:expected.xml,viewport:expected.viewport});
 assert.deepEqual(warnings,[]);await settle(page);const after=await state(page);assert.deepEqual(after.edges,expected.edges,'actual reopen retains endpoint references, owner, metadata and exact waypoints');assert.deepEqual(after.shapes,expected.shapes);assert.deepEqual(after.notes,expected.notes);assert.equal(after.canonical,expected.canonical);return after;
}
async function unchangedExceptGeometry(before,after,allowed,refChanges={}){
 const parsed=await oracle.fromXML(after.xml),prior=before.parsed,byId=parsed.elementsById;
 const oldDi=prior.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]),newDi=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]);
 for(const id of allowed){const a=newDi.find(d=>d.bpmnElement.id===id),b=oldDi.find(d=>d.bpmnElement.id===id);if(!a||!b)continue;
  if(a.bounds&&b.bounds)Object.assign(a.bounds,rect(b.bounds));
  if(a.waypoint&&b.waypoint){assert.deepEqual(a.$attrs,b.$attrs,`${id} DI metadata`);a.waypoint=b.waypoint;}
  if(a.label&&b.label){if(a.label.bounds&&b.label.bounds)Object.assign(a.label.bounds,rect(b.label.bounds));}else if(!b.label)delete a.label;
 }
 for(const [id,properties]of Object.entries(refChanges))for(const key of properties){
  const oldEndpoint=prior.elementsById[id][key],newEndpoint=byId[id][key];
  if(byId[id].$type==='bpmn:SequenceFlow'&&oldEndpoint.id!==newEndpoint.id){
   const list=key==='targetRef'?'incoming':'outgoing';
   assert.ok(!(byId[oldEndpoint.id][list]||[]).some(ref=>ref.id===id),'old endpoint reference removed');
   assert.ok((newEndpoint[list]||[]).some(ref=>ref.id===id),'new endpoint reference added');
   for(const endpoint of [oldEndpoint.id,newEndpoint.id]){const oldList=prior.elementsById[endpoint][list];if(oldList)byId[endpoint][list]=oldList.map(ref=>byId[ref.id]);else delete byId[endpoint][list];}
  }
  byId[id][key]=byId[oldEndpoint.id];
 }
 assert.equal((await oracle.toXML(parsed.rootElement,{format:true})).xml,before.canonical,'unrelated semantic fields, references, artifacts and DI stay unchanged');
}
function removeExpectedElements(parsed,ids,{flowReferences=false}={}){
 const removed=new Set(ids);
 for(const id of removed){
  const element=parsed.elementsById[id];assert.ok(element,`expected removable semantic element ${id}`);
  const parent=element.$parent,property=parent?.$descriptor.properties.find(p=>!p.isReference&&!p.isVirtual&&Array.isArray(parent[p.name])&&parent[p.name].includes(element));
  assert.ok(property,`expected owned containment for ${id}`);parent[property.name]=parent[property.name].filter(item=>item!==element);
 }
 for(const diagram of parsed.rootElement.diagrams||[])diagram.plane.planeElement=diagram.plane.planeElement.filter(di=>!removed.has(di.bpmnElement?.id));
 if(flowReferences)for(const element of Object.values(parsed.elementsById)){
  if(!element.$instanceOf?.('bpmn:FlowNode'))continue;
  for(const key of ['incoming','outgoing'])if(Object.hasOwn(element,key))element[key]=element[key].filter(edge=>!removed.has(edge.id));
  if(removed.has(element.default?.id))delete element.default;
 }
}
async function unchangedExceptAppend(before,after,noteId,associationId){
 assert.equal(before.parsed.elementsById[noteId],undefined);assert.equal(before.parsed.elementsById[associationId],undefined);
 const parsed=await oracle.fromXML(after.xml);assert.deepEqual(parsed.warnings,[]);
 assert.equal(parsed.elementsById[noteId]?.$type,'bpmn:TextAnnotation');assert.equal(parsed.elementsById[associationId]?.$type,'bpmn:Association');
 removeExpectedElements(parsed,[noteId,associationId]);
 assert.equal((await oracle.toXML(parsed.rootElement,{format:true})).xml,before.canonical,'append may add only its annotation, association and their DI; all existing metadata and semantics stay exact');
}
async function unchangedExceptOwnerDeletion(before,after,ownerId,associationId){
 const parsed=await oracle.fromXML(before.xml);assert.deepEqual(parsed.warnings,[]);
 removeExpectedElements(parsed,[associationId,ownerId],{flowReferences:true});
 assert.equal(after.canonical,(await oracle.toXML(parsed.rootElement,{format:true})).xml,'owner deletion removes only that flow, its dependent association, their DI and direct flow references');
}
async function evidence(page,name,data){await writeFile(`test-artifacts/browser-flow-${name}.json`,JSON.stringify(data,null,2));await writeFile(`test-artifacts/browser-flow-${name}.bpmn`,await page.evaluate(()=>window.flowTest.xml()));await page.screenshot({path:`test-artifacts/browser-flow-${name}.png`,fullPage:true});}
async function run(name,fn){const pages=[];console.log(`START native flow annotations ${name}`);try{const value=await fn(async(...args)=>{const c=await setup(...args);pages.push(c);return c.page;});for(const c of pages)assert.deepEqual(c.errors,[]);results.push({name,status:'passed',...value});console.log(`PASS native flow annotations ${name}`);}catch(e){results.push({name,status:'failed',error:e.stack||String(e)});console.error(`FAIL native flow annotations ${name}: ${e.stack||e}`);for(const [i,c]of pages.entries()){await c.page.bringToFront().catch(()=>{});await evidence(c.page,`${name}-${i}-failure`,{error:String(e),state:serial(await state(c.page))}).catch(()=>{});}}finally{await writeFile('test-artifacts/browser-flow-annotations-results.json',JSON.stringify(results,null,2));for(const c of pages)await c.page.close().catch(()=>{});}}
async function append(page,owner,mode,{cancel=false,drop={x:1030,y:740}}={}){
 const route=(await state(page)).edges[owner].points;
 const before=await selectEdge(page,owner,owner==='OrderMessage'?{x:118,y:365}:owner==='ApproveFlow'?{x:1020,y:route.some(p=>p.y===500)?500:348}:undefined);
 const engine=await page.evaluate(()=>window.flowTest.engine),selector=engine==='local'?'[data-action="append.text-annotation"]':'.djs-context-pad [data-action="append.text-annotation"]';
 const start=await control(page,selector);
 if(mode==='click'){await page.mouse.click(start.x,start.y);await settle(page);}else{
  const to=await screen(page,drop);await gesture(page,start,to,{cancel,modifier:'Control',preview:async()=>{
   const active=await page.evaluate(()=>window.flowTest.engine==='local'?!!document.querySelector('.bpmn-xyflow-append-ghost'):!!document.querySelector('.djs-drag-group,.djs-dragger'));
   assert.ok(active,'native append drag preview actually activated');
  }});
 }
 const after=await state(page);
 if(cancel){assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);return{before,after};}
 const added=after.notes.filter(n=>!before.notes.some(b=>b.id===n.id));assert.equal(added.length,1,'one discoverable append produces one annotation');const note=added[0],edge=Object.values(after.edges).find(e=>e.source===owner&&e.target===note.id);assert.ok(edge,'appended note has one owning-flow Association');assert.equal(edge.type,'bpmn:Association');
 const ownerScope=before.parsed.elementsById[owner].$type==='bpmn:MessageFlow'?'OrderCollaboration':'ApprovalProcess';assert.equal(note.owner,ownerScope);assert.equal(edge.owner,ownerScope);
 assert.deepEqual(after.edges[owner],before.edges[owner],'append cannot edit the owner route');
 await unchangedExceptAppend(before,after,note.id,edge.id);
 const midpoint=await page.evaluate(owner=>window.flowTest.getConnectionMid(window.flowTest.node(owner)),owner);near(edge.points[0],midpoint,'automatic source anchor follows actual pinned half-length midpoint',.01);
 if(mode==='drag')near({x:after.shapes[note.id].x+after.shapes[note.id].width/2,y:after.shapes[note.id].y+after.shapes[note.id].height/2},drop,'annotation follows native chosen drop');
 await history(page,before,after);await reopen(page,after);return{before,after,note,edge};
}
async function adjustment(page,point,oldPoints,newPoints,hints={}){return page.evaluate(({point,oldPoints,newPoints,hints})=>window.flowTest.getConnectionAdjustment(point,newPoints,oldPoints,hints),{point,oldPoints,newPoints,hints});}
async function assertDependent(page,before,after,owner,{hints={},target=false}={}){
 const prior=before.edges.PolicyAssociation,next=after.edges.PolicyAssociation,index=target?prior.points.length-1:0;
 const expected=await adjustment(page,prior.points[index],before.edges[owner].points,after.edges[owner].points,hints);near(next.points[index],expected,'dependent anchor follows independent pinned segment-relative adjustment',.01);
 assert.deepEqual(next.points.filter((_,i)=>i!==index),prior.points.filter((_,i)=>i!==index),'opposite and interior dependent points remain exact');assert.equal(next.source,prior.source);assert.equal(next.target,prior.target);assert.deepEqual(next.attrs,prior.attrs);assert.deepEqual(next.diAttrs,prior.diAttrs);assert.deepEqual(after.shapes.PolicyNote,before.shapes.PolicyNote);
}
async function routePreview(page,id,before){const points=await page.evaluate(id=>window.flowTest.node(id).waypoints.map(p=>({x:p.x,y:p.y})),id);assert.notDeepEqual(points,before,'real route preview changed before cancellation/commit');}
async function ownerEdit(page,kind,{target=false}={}){
 const owner='ApproveFlow',before=await selectEdge(page,owner,{x:1020,y:500});let from,to;
 if(kind==='segment'){from=await screen(page,{x:780,y:450});to=await screen(page,{x:820,y:450});await hit(page,from,owner);}
 else if(kind==='bend'){from=await control(page,'.bpmn-xyflow-bendpoint[data-bend-index="2"]');to={x:from.x+45,y:from.y+35};}
 else{from=await control(page,'.bpmn-xyflow-bendpoint[data-bend-index="4"]');to=await screen(page,{x:940,y:130});await hit(page,to,'ReworkRequest');}
 await gesture(page,from,to,{cancel:true,preview:()=>routePreview(page,owner,before.edges[owner].points)});assert.equal((await state(page)).xml,before.xml);assert.deepEqual((await state(page)).history,before.history);
 await selectEdge(page,owner,{x:1020,y:500});if(kind!=='segment')from=await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${kind==='bend'?2:4}"]`);
 await gesture(page,from,to,{preview:()=>routePreview(page,owner,before.edges[owner].points)});const after=await state(page);assert.notDeepEqual(after.edges[owner].points,before.edges[owner].points);
 if(kind==='segment'||kind==='bend'){
  assert.equal(before.edges[owner].points.length,5,'fixed asymmetric oracle starts with five points');
  assert.equal(after.edges[owner].points.length,5,'fixed gesture retains oracle segment/bendpoint indices');
  if(kind==='segment'){assert.equal(after.edges[owner].points[1].x,after.edges[owner].points[2].x);assert.notEqual(after.edges[owner].points[1].x,before.edges[owner].points[1].x);}
  else assert.notDeepEqual(after.edges[owner].points[2],before.edges[owner].points[2],'the declared bendpoint index is actually moved');
 }
 await assertDependent(page,before,after,owner,{target,hints:kind==='reconnect'?{connectionEnd:true}:kind==='segment'?{segmentMove:{segmentStartIndex:1,newSegmentStartIndex:1}}:{bendpointMove:{bendpointIndex:2,insert:false}}});
 if(kind==='reconnect'){assert.equal(after.edges[owner].target,'ReworkRequest');near(after.edges[owner].points.at(-1),{x:940,y:130},'chosen owner reconnect point');}
 await unchangedExceptGeometry(before,after,[owner,'PolicyAssociation'],kind==='reconnect'?{[owner]:['targetRef']}:{});await history(page,before,after,3);await reopen(page,after);return{before:serial(before),after:serial(after)};
}
async function dependentRedock(page,target){
 const initial=await state(page),index=target?initial.edges.PolicyAssociation.points.length-1:0;
 let prior=await selectEdge(page,'PolicyAssociation',{x:850,y:550});
 for(const [owner,position]of [['ApproveFlow',{x:780,y:460}],['ReviewFlow',{x:360,y:175.5}]]){
  const from=await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${index}"]`),to=await screen(page,position);await hit(page,to,owner);
  await gesture(page,from,to,{cancel:true,preview:()=>routePreview(page,'PolicyAssociation',prior.edges.PolicyAssociation.points)});
  const cancelled=await state(page);assert.equal(cancelled.xml,prior.xml);assert.deepEqual(cancelled.history,prior.history);
  await selectEdge(page,'PolicyAssociation',{x:850,y:550});let handle=await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${index}"]`);
  const invalid=await screen(page,{x:1400,y:850});await hit(page,invalid,null);
  await gesture(page,handle,invalid,{preview:()=>routePreview(page,'PolicyAssociation',prior.edges.PolicyAssociation.points)});assert.equal((await state(page)).xml,prior.xml,'invalid background redock is atomic');assert.deepEqual((await state(page)).history,prior.history);
  await selectEdge(page,'PolicyAssociation',{x:850,y:550});handle=await control(page,`.bpmn-xyflow-bendpoint[data-bend-index="${index}"]`);await gesture(page,handle,to,{preview:()=>routePreview(page,'PolicyAssociation',prior.edges.PolicyAssociation.points)});
  const after=await state(page),edge=after.edges.PolicyAssociation;near(edge.points[index],position,'dependent endpoint projects to chosen actual owner route',.1);
  assert.equal(edge[target?'target':'source'],owner);assert.equal(edge[target?'source':'target'],prior.edges.PolicyAssociation[target?'source':'target']);
  assert.deepEqual(edge.points.filter((_,i)=>i!==index),prior.edges.PolicyAssociation.points.filter((_,i)=>i!==index));
  for(const id of ['ApproveFlow','ReviewFlow'])assert.deepEqual(after.edges[id],prior.edges[id],'redocking a dependent cannot change either owner');
  await unchangedExceptGeometry(prior,after,['PolicyAssociation'],{PolicyAssociation:[target?'targetRef':'sourceRef']});
  await history(page,prior,after,2);prior=after;
 }
 await reopen(page,prior);return{before:serial(initial),after:serial(prior)};
}
async function shapeEdit(page,owner,resize=false){
 const first=await state(page),id=first.edges[owner].source;await selectShape(page,id);const before=await state(page),b=before.shapes[id];
 const from=resize?await control(page,'.bpmn-xyflow-resize-handle[data-resize-dir="se"]'):await screen(page,{x:b.x+b.width/2,y:b.y+b.height/2});
 const to={x:from.x+45,y:from.y+(resize?30:0)};
 await gesture(page,from,to,{cancel:true,preview:async()=>{assert.notDeepEqual((await state(page)).shapes[id],before.shapes[id],'owner shape preview actually activates');}});
 assert.equal((await state(page)).xml,before.xml);assert.deepEqual((await state(page)).history,before.history);
 await selectShape(page,id);const retry=resize?await control(page,'.bpmn-xyflow-resize-handle[data-resize-dir="se"]'):from;
 await gesture(page,retry,to);const after=await state(page);assert.notDeepEqual(after.shapes[id],before.shapes[id]);assert.notDeepEqual(after.edges[owner].points,before.edges[owner].points);
 await assertDependent(page,before,after,owner,{hints:{connectionStart:true}});
 const affected=Object.values(before.edges).filter(e=>e.source===id||e.target===id).map(e=>e.id);
 await unchangedExceptGeometry(before,after,[id,...affected,'PolicyAssociation']);await history(page,before,after,3);await reopen(page,after);return{before:serial(before),after:serial(after)};
}
async function repeatedVisible(page){
 const original=await state(page),created=[];let pans=0;
 // The initial viewport intentionally puts the right-hand append area near the
 // safe edge. Subsequent viewport changes must come from actual append itself.
 for(let i=0;i<6;i++){
  const before=await selectEdge(page,'ApproveFlow',{x:1020,y:500});
  const chrome=await page.evaluate(()=>{
   const t=window.flowTest,r=t.container.getBoundingClientRect(),insets={top:0,left:0,right:0,bottom:36};
   for(const [selector,side]of [['.bpmn-xyflow-palette','left'],['.bpmn-xyflow-editor-actions','top'],['.bpmn-xyflow-minimap','bottom'],['.bjs-powered-by','bottom']]){const el=t.container.querySelector(selector);if(!el||el.style.display==='none')continue;const b=el.getBoundingClientRect();if(!b.width||!b.height)continue;insets[side]=Math.max(insets[side],side==='left'?b.right-r.left:side==='top'?b.bottom-r.top:r.bottom-b.top);}
   return{width:r.width,height:r.height,insets};
  });
  const button=await control(page,'[data-action="append.text-annotation"]');await page.mouse.click(button.x,button.y);await settle(page);const after=await state(page);
  if(Math.abs(after.viewport.x-before.viewport.x)>1e-8||Math.abs(after.viewport.y-before.viewport.y)>1e-8)pans++;
  const note=after.notes.find(n=>!before.notes.some(o=>o.id===n.id));assert.ok(note);created.push(note.id);const b=after.shapes[note.id];assert.equal(after.history.size,before.history.size+1);assert.equal(after.viewport.zoom,before.viewport.zoom);assert.deepEqual(after.edges.ApproveFlow,before.edges.ApproveFlow);
  const association=Object.values(after.edges).find(edge=>edge.source==='ApproveFlow'&&edge.target===note.id);assert.ok(association);await unchangedExceptAppend(before,after,note.id,association.id);
  const expected=await page.evaluate(({b,chrome,viewport})=>{
   const {Canvas}=window.flowTest,root={},c=Object.create(Canvas.prototype),z=viewport.zoom;let delta={dx:0,dy:0};
   const x=viewport.x-chrome.insets.left,y=viewport.y-chrome.insets.top,w=chrome.width-chrome.insets.left-chrome.insets.right,h=chrome.height-chrome.insets.top-chrome.insets.bottom;
   Object.assign(c,{_resolveElements:()=>[b],findRoot:()=>root,getRootElement:()=>root,viewbox:()=>({x:-x/z,y:-y/z,width:w/z,height:h/z}),zoom:()=>z,scroll:d=>{delta=d;}});c.scrollToElement(b);return{x:viewport.x+delta.dx,y:viewport.y+delta.dy,zoom:z};
  },{b,chrome,viewport:before.viewport});near(after.viewport,expected,'automatic append uses minimal reference pan',.01);assert.equal(after.viewport.zoom,expected.zoom);
  const left=b.x*after.viewport.zoom+after.viewport.x,top=b.y*after.viewport.zoom+after.viewport.y;
  assert.ok(left>=chrome.insets.left+100-.01&&top>=chrome.insets.top+100-.01);assert.ok(left+b.width*after.viewport.zoom<=chrome.width-chrome.insets.right-100+.01);assert.ok(top+b.height*after.viewport.zoom<=chrome.height-chrome.insets.bottom-100+.01);
 }
 assert.ok(pans>0,'repeated append fixture must exercise actual viewport panning');
 const edited=await state(page);for(let i=0;i<6;i++)await page.click('#undo-btn');assert.equal((await state(page)).xml,original.xml);for(let i=0;i<6;i++)await page.click('#redo-btn');assert.equal((await state(page)).xml,edited.xml);await reopen(page,edited);return{created,pans,viewport:edited.viewport};
}
try{
 server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});server.stdout.on('data',c=>{serverOutput+=String(c);});
 const deadline=Date.now()+60000;while(true){const actual=serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);if(actual&&Number(actual[1])!==port)throw Error(`Owned flow server bound unexpected port ${actual[1]}`);if(actual)try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw Error('Flow annotation server startup timeout');await new Promise(r=>setTimeout(r,150));}
 browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});await mkdir('test-artifacts',{recursive:true});
 for(const [owner,name]of [['ApproveFlow','approval-source'],['OrderMessage','message-source']])for(const mode of ['click','drag'])await run(`${owner}-native-${mode}-append`,async create=>{
  const outputs={};for(const engine of ['upstream','local']){const page=await create(await fixture(name,{straight:owner==='ApproveFlow',withoutDependent:true}),engine);const result=await append(page,owner,mode);outputs[engine]={bounds:result.after.shapes[result.note.id],points:result.edge.points,owner:result.edge.owner};await evidence(page,`${owner}-${mode}-${engine}`,outputs[engine]);}
  assert.deepEqual(outputs.local,outputs.upstream,'same native append mode matches independent upstream placement, anchor and ownership');return outputs;
 });
 for(const mode of ['click','drag'])await run(`asymmetric-half-length-${mode}-append`,async create=>{
  const page=await create(await fixture('approval-source'));const result=await append(page,'ApproveFlow',mode);near(result.edge.points[0],{x:900,y:500},'asymmetric route uses half total length, not longest segment midpoint',.01);
  if(mode==='click'){assert.deepEqual(result.after.shapes[result.note.id],{x:950,y:430,width:100,height:40});near(result.edge.points.at(-1),{x:960,y:470},'actual reference annotation crop',.01);}return{note:result.note,edge:result.edge};
 });
 for(const [owner,name]of [['ApproveFlow','approval-source'],['OrderMessage','message-source']])await run(`${owner}-append-cancel-repeat`,async create=>{
  const page=await create(await fixture(name));const initial=await state(page);for(let i=0;i<3;i++)await append(page,owner,'drag',{cancel:true});assert.equal((await state(page)).xml,initial.xml);const result=await append(page,owner,'click');return{edge:result.edge};
 });
 await run('repeated-auto-append-minimal-safe-pan',async create=>repeatedVisible(await create(await fixture('approval-source'), 'local',{viewport:{x:500,y:470,zoom:1}})));
 for(const target of [false,true])await run(`dependent-${target?'target':'source'}-follows-segment`,async create=>ownerEdit(await create(await fixture(target?'approval-target':'approval-source')),'segment',{target}));
 await run('dependent-follows-owner-bendpoint',async create=>ownerEdit(await create(await fixture('approval-source')),'bend'));
 await run('dependent-follows-owner-target-reconnect',async create=>ownerEdit(await create(await fixture('approval-source')),'reconnect'));
 for(const target of [false,true])await run(`dependent-${target?'target':'source'}-redock-same-and-other-flow`,async create=>dependentRedock(await create(await fixture(target?'approval-target':'approval-source')),target));
 await run('owner-delete-dependent-cleanup-and-history',async create=>{
  const page=await create(await fixture('approval-source')),before=await selectEdge(page,'ApproveFlow',{x:1020,y:500});await page.keyboard.press('Delete');const after=await state(page);assert.equal(after.edges.ApproveFlow,undefined);assert.equal(after.edges.PolicyAssociation,undefined);assert.deepEqual(after.notes,before.notes);assert.deepEqual(after.shapes,before.shapes);
  for(const [id,edge]of Object.entries(before.edges))if(!['ApproveFlow','PolicyAssociation'].includes(id))assert.deepEqual(after.edges[id],edge);
  await unchangedExceptOwnerDeletion(before,after,'ApproveFlow','PolicyAssociation');
  await history(page,before,after,3);await reopen(page,after);return{remainingNotes:after.notes};
 });
 for(const [owner,name]of [['ReviewFlow','review-source'],['OrderMessage','message-source']])await run(`${owner}-source-shape-move-propagates`,async create=>shapeEdit(await create(await fixture(name)),owner));
 await run('ReviewFlow-source-shape-resize-propagates',async create=>shapeEdit(await create(await fixture('review-source')),'ReviewFlow',true));
 const failures=results.filter(r=>r.status==='failed');assert.equal(results.length,19);assert.equal(failures.length,0,failures.map(r=>`${r.name}: ${r.error}`).join('\n'));console.log(`PASS ${results.length} native flow annotation groups`);
}finally{await browser?.close();server?.kill('SIGTERM');}
