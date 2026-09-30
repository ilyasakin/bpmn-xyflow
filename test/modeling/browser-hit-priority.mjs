/**
 * Native hit-order differential against pinned bpmn-js 18.30.1. Setup imports
 * identical XML; selection/drag actions use real Chromium mouse input only.
 * This records shared overlaps instead of assuming a different paint policy.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const require=createRequire(import.meta.url),oracle=new BpmnModdle();
assert.equal(require('bpmn-js/package.json').version,'18.30.1','native comparison uses the pinned upstream release');
const port=Number(process.env.BPMN_HIT_PRIORITY_PORT||5241),base=`http://localhost:${port}`;
const server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
server.stdout.on('data',()=>{});
const results=[];let browser;
const rect=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
const xy=p=>({x:p.x,y:p.y});
const shape=(id,type,x,y,width,height)=>({id,type,x,y,width,height});
function fixture(crossing) {
  const nodes=[shape('Source','task',180,200,100,80),shape('Target','task',660,200,100,80),crossing];
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="HitDefinitions" targetNamespace="https://bpmn.io/schema/bpmn"><bpmn:process id="Process_1">${nodes.map(n=>`<bpmn:${n.type} id="${n.id}"${n.name?` name="${n.name}"`:''}/>`).join('')}<bpmn:sequenceFlow id="Flow" sourceRef="Source" targetRef="Target"/></bpmn:process><bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">${nodes.map(n=>`<bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.type==='subProcess'?' isExpanded="true"':''}><dc:Bounds x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"/>${n.label?`<bpmndi:BPMNLabel><dc:Bounds x="${n.label.x}" y="${n.label.y}" width="${n.label.width}" height="${n.label.height}"/></bpmndi:BPMNLabel>`:''}</bpmndi:BPMNShape>`).join('')}<bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow"><di:waypoint x="280" y="240"/><di:waypoint x="660" y="240"/></bpmndi:BPMNEdge></bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
async function bookingOverlap() {
  // Reproduce the real post-reattach geometry without executing the action
  // under test through an API. Original business semantics stay in the fixture.
  const parsed=await oracle.fromXML(await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn','utf8'));
  assert.deepEqual(parsed.warnings,[]);
  const byId=parsed.elementsById,di=parsed.rootElement.diagrams[0].plane.planeElement;
  const event=byId.FlightTimeout,shape=di.find(d=>d.bpmnElement===event);
  event.attachedToRef=byId.ReserveHotel;Object.assign(shape.bounds,{x:462,y:242});
  shape.label=oracle.create('bpmndi:BPMNLabel',{bounds:oracle.create('dc:Bounds',{x:435,y:278,width:90,height:20})});
  const timeout=di.find(d=>d.bpmnElement===byId.TimeoutFlow);
  timeout.waypoint=[{x:498,y:260},{x:790,y:260},{x:790,y:405}].map(p=>oracle.create('dc:Point',p));
  return(await oracle.toXML(parsed.rootElement,{format:true})).xml;
}
async function setup(engine,xml,zoom) {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
  try {
  await page.setViewport({width:1800,height:1250});
  await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
  if(engine==='upstream') {
    await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});
    for(const name of ['diagram-js.css','bpmn-js.css'])await page.addStyleTag({path:require.resolve(`bpmn-js/dist/assets/${name}`)});
  }
  const warnings=await page.evaluate(async({engine,xml,zoom})=>{
    const container=document.querySelector('#viewer');let result;
    if(engine==='upstream') {
      window.modeler.destroy();container.replaceChildren();
      const m=new window.BpmnJS({container});window.upstream=m;result=await m.importXML(xml);
      const canvas=m.get('canvas');canvas.viewbox({x:-140/zoom,y:-100/zoom,width:container.clientWidth/zoom,height:container.clientHeight/zoom});
      window.hitEngine={container,node:id=>m.get('elementRegistry').get(id),selection:()=>m.get('selection').get().map(n=>n.id),
        xml:async()=>(await m.saveXML({format:true})).xml,svg:async()=>(await m.saveSVG()).svg,
        viewport:()=>{const v=canvas.viewbox();return{x:-v.x*v.scale,y:-v.y*v.scale,zoom:v.scale};}};
    } else {
      const m=window.modeler;result=await m.importXML(xml);m.setViewport({x:140,y:100,zoom});
      window.hitEngine={container,node:id=>m.getElement(id),selection:()=>m.getSelection(),xml:()=>m.getXML(),svg:async()=>(await m.saveSVG()).svg,viewport:()=>m.getViewport()};
    }
    return result.warnings.map(w=>w.message);
  },{engine,xml,zoom});assert.deepEqual(warnings,[],`${engine} setup warnings`);
  return{page,errors};
  }catch(error){await page.close().catch(()=>{});throw error;}
}
async function screen(page,p) {return page.evaluate(p=>{const e=window.hitEngine,v=e.viewport(),r=e.container.getBoundingClientRect();return{x:r.left+v.x+p.x*v.zoom,y:r.top+v.y+p.y*v.zoom};},p);}
async function hit(page,p) {return page.evaluate(p=>{const e=document.elementFromPoint(p.x,p.y),r=window.hitEngine.container.getBoundingClientRect();return{inside:p.x>=Math.max(0,r.left)&&p.x<Math.min(innerWidth,r.right)&&p.y>=Math.max(0,r.top)&&p.y<Math.min(innerHeight,r.bottom),id:e?.closest('[data-element-id]')?.getAttribute('data-element-id')||null,tag:e?.tagName,classes:e?.getAttribute('class'),bend:e?.closest('[data-bend-index]')?.getAttribute('data-bend-index'),port:!!e?.closest('.bpmn-xyflow-connect-handle')};},p);}
async function state(page) {
  const xml=await page.evaluate(()=>window.hitEngine.xml()),parsed=await oracle.fromXML(xml);assert.deepEqual(parsed.warnings,[],'independent XML oracle');
  const di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]);
  return{xml,di:Object.fromEntries(di.map(d=>[d.bpmnElement.id,{...(d.bounds?{bounds:rect(d.bounds)}:{}),...(d.waypoint?{points:d.waypoint.map(xy)}:{})}])),
    flows:Object.values(parsed.elementsById).filter(o=>o.$type==='bpmn:SequenceFlow').map(o=>({id:o.id,source:o.sourceRef.id,target:o.targetRef.id}))};
}
async function clearSelection(page) {
  const blank=await page.evaluate(()=>{const r=window.hitEngine.container.getBoundingClientRect();return{x:r.right-300,y:r.bottom-100};});
  await page.mouse.click(blank.x,blank.y);await settle(page);assert.deepEqual(await page.evaluate(()=>window.hitEngine.selection()),[],'native background click clears previous selection overlays');
}
async function settle(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
async function sample(page,center,offset,id) {
  // Remove selection handles through native input before every probe.
  await clearSelection(page);
  const p=await screen(page,center);p.y+=offset;
  await page.mouse.move(p.x,p.y);const target=await hit(page,p);
  assert.equal(target.inside,true,`native probe is inside the visible canvas: ${JSON.stringify(p)}`);
  await page.mouse.click(p.x,p.y);
  await settle(page);
  const selection=await page.evaluate(()=>window.hitEngine.selection());
  return{offset,point:p,target,selection,expectedShape:id};
}
async function evidence(page,name,engine,data) {
  await writeFile(`test-artifacts/browser-hit-${name}-${engine}.json`,JSON.stringify(data,null,2));
  await writeFile(`test-artifacts/browser-hit-${name}-${engine}.bpmn`,await page.evaluate(()=>window.hitEngine.xml()));
  await writeFile(`test-artifacts/browser-hit-${name}-${engine}.svg`,await page.evaluate(()=>window.hitEngine.svg()));
  await page.screenshot({path:`test-artifacts/browser-hit-${name}-${engine}.png`,fullPage:true});
}
async function paired(name,xml,zoom,center,id,{ring,label=false,connections=['Flow']}={}) {
  const pair={},pages=[];
  try {
    for(const engine of ['upstream','local']) {
      console.log(`START native hit priority ${name} ${engine}`);
      const context=await setup(engine,xml,zoom);pages.push({...context,engine});const {page,errors}=context,before=await state(page),probes=[];
      for(const offset of new Set([0,-6,6,-10,10,-10*zoom,10*zoom])){console.log(`PROBE native hit priority ${name} ${engine} offset ${offset}`);probes.push(await sample(page,center,offset,id));}
      if(ring)probes.push({...await sample(page,ring,0,id),ring:true});
      if(label) {
        await clearSelection(page);
        const glyph=await page.evaluate(id=>{
          const group=document.querySelector(`[data-element-id="${id}_label"]`),text=group?.querySelector('text'),r=text?.getBoundingClientRect();
          if(!r?.width)throw Error('Missing visible external label');
          const point={x:r.left+r.width/2,y:r.top+r.height/2};
          return{point,textRect:{x:r.x,y:r.y,width:r.width,height:r.height},group:group.outerHTML,
            stack:document.elementsFromPoint(point.x,point.y).map(e=>({id:e.closest('[data-element-id]')?.getAttribute('data-element-id')||null,tag:e.tagName,classes:e.getAttribute('class')}))};
        },id);
        const point=glyph.point;
        const target=await hit(page,point);await page.mouse.click(point.x,point.y);await settle(page);const selection=await page.evaluate(()=>window.hitEngine.selection());
        if(label==='select')assert.deepEqual(selection,[id+'_label'],'unobstructed external label is natively selectable');
        else{assert.equal(selection.length,1);assert.ok([id+'_label',...connections].includes(selection[0]),'overlapped visible glyph must select its label or crossing route');assert.equal(target.id,selection[0]);}
        probes.push({label:true,point,target,selection,glyph});
      }
      assert.equal((await state(page)).xml,before.xml,'native selection probes do not mutate semantic XML or DI');assert.deepEqual(errors,[]);
      pair[engine]=probes;await evidence(page,name,engine,{zoom,center,id,probes});
    }
    // Strict reference comparison where the request identified an actual hit;
    // corridor widths may differ, but local must not steal a visible shape
    // where the same upstream screen offset selected that shape.
    const candidates=[id,id+'_label',...connections];
    for(const engine of ['upstream','local']) {
      const probe=pair[engine][0];
      assert.equal(probe.selection.length,1,`${engine} center must select one real fixture element, not background`);
      assert.ok(candidates.includes(probe.selection[0]),`${engine} center selected an unrelated element: ${JSON.stringify(probe)}`);
      assert.equal(probe.target.id,probe.selection[0],`${engine} sampled center hit must be the element selected by native input`);
    }
    assert.deepEqual(pair.local[0].selection,pair.upstream[0].selection,'same native center click matches pinned upstream');
    for(let i=0;i<pair.upstream.length;i++) {
      const u=pair.upstream[i],l=pair.local[i];
      if(u.ring){assert.deepEqual(u.selection,[id],'upstream ring point actually selects boundary');assert.deepEqual(l.selection,[id],'local ring point actually selects boundary');}
      if(u.selection.includes(id)||u.selection.includes(id+'_label'))assert.deepEqual(l.selection,u.selection,`local hit corridor must not consume upstream-visible shape or label at offset ${u.offset}`);
    }
    results.push({name,status:'passed',upstream:pair.upstream,local:pair.local});console.log(`PASS native hit priority ${name}`);
  } catch(error) {
    results.push({name,status:'failed',error:error.stack||String(error),...pair});console.error(`FAIL native hit priority ${name}: ${error.stack||error}`);
    // Completed engine captures already contain the exact mismatch. Avoid a
    // redundant screenshot of its now-background tab (which can stall Chrome).
    for(const {page,engine}of pages)if(!pair[engine]){await page.bringToFront().catch(()=>{});await page.screenshot({path:`test-artifacts/browser-hit-${name}-${engine}-failure.png`,fullPage:true}).catch(()=>{});}
  } finally {await writeFile('test-artifacts/browser-hit-priority-results.json',JSON.stringify(results,null,2));for(const {page}of pages)await page.close().catch(()=>{});}
}
async function selectedEndpointPriority() {
  const name='selected-endpoint-versus-create-port';let page;
  try {
    console.log(`START native hit priority ${name}`);
    const context=await setup('local',fixture(shape('Other','task',450,450,100,80)),1);page=context.page;
    const p=await screen(page,{x:430,y:240});assert.equal((await hit(page,p)).id,'Flow');await page.mouse.click(p.x,p.y);
    const before=await state(page),source=await screen(page,{x:230,y:220});await page.mouse.move(source.x,source.y);
    const from=await screen(page,{x:280,y:240}),target=await hit(page,from);
    assert.equal(target.bend,'0','selected source endpoint remains above the coincident hover create port');assert.equal(target.port,false);
    const to=await screen(page,{x:280,y:263});
    try {await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});}
    const after=await state(page);assert.deepEqual(after.flows,before.flows,'redocking edits the same edge without creating another');
    assert.ok(Math.abs(after.di.Flow.points[0].x-280)<1.5&&Math.abs(after.di.Flow.points[0].y-263)<1.5,'chosen source redocking follows native pointer');
    assert.deepEqual(after.di.Flow.points.at(-1),before.di.Flow.points.at(-1),'opposite anchor stays fixed');
    await page.click('#undo-btn');assert.equal((await state(page)).xml,before.xml,'native Undo restores exact XML');
    // A selected route must not globally disable unrelated visible create ports.
    const other=await screen(page,{x:500,y:490});await page.mouse.move(other.x,other.y);
    const port=await screen(page,{x:550,y:490});assert.equal((await hit(page,port)).port,true,'nonoverlapping unrelated create port is still usable');
    const end=await screen(page,{x:660,y:270});assert.equal((await hit(page,end)).id,'Target');
    try{await page.mouse.move(port.x,port.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});}
    const created=await state(page);assert.equal(created.flows.length,before.flows.length+1);assert.ok(created.flows.some(f=>f.source==='Other'&&f.target==='Target'));
    await page.click('#undo-btn');assert.equal((await state(page)).xml,before.xml);assert.deepEqual(context.errors,[]);
    await evidence(page,name,'local',{before,after,created});results.push({name,status:'passed'});console.log(`PASS native hit priority ${name}`);
  }catch(error){results.push({name,status:'failed',error:error.stack||String(error)});console.error(`FAIL native hit priority ${name}: ${error.stack||error}`);if(page)await page.screenshot({path:`test-artifacts/browser-hit-${name}-failure.png`,fullPage:true}).catch(()=>{});}
  finally{await writeFile('test-artifacts/browser-hit-priority-results.json',JSON.stringify(results,null,2));await page?.close().catch(()=>{});}
}

try {
  const deadline=Date.now()+60000;while(true){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(server.exitCode!==null||Date.now()>deadline)throw Error('Hit-priority demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));}
  browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});await mkdir('test-artifacts',{recursive:true});
  for(const zoom of [.2,.65,1,1.4,3])for(const crossing of [shape('Crossing','task',380,200,100,80),shape('Crossing','intermediateCatchEvent',412,222,36,36),shape('Crossing','exclusiveGateway',405,215,50,50),shape('Crossing','subProcess',370,180,140,120)]) {
    await paired(`${crossing.type}-crossing-${zoom}`,fixture(crossing),zoom,{x:430,y:240},'Crossing');
  }
  const booking=await bookingOverlap();
  await paired('booking-attached-boundary',booking,.9,{x:480,y:260},'FlightTimeout',{ring:{x:480,y:246},connections:['ReservationFlow2','TimeoutFlow']});
  const labelled={...shape('Crossing','intermediateCatchEvent',412,380,36,36),name:'MMMMMMMM',label:{x:385,y:232,width:90,height:20}};
  await paired('external-label-over-route',fixture(labelled),1,{x:430,y:240},'Crossing',{label:'record'});
  await paired('external-label-unobstructed',fixture({...labelled,label:{...labelled.label,y:200}}),1,{x:430,y:210},'Crossing',{label:'select'});
  await selectedEndpointPriority();
  await writeFile('test-artifacts/browser-hit-priority-results.json',JSON.stringify(results,null,2));
  const failures=results.filter(r=>r.status==='failed');assert.equal(failures.length,0,failures.map(r=>`${r.name}: ${r.error}`).join('\n'));console.log(`PASS ${results.length} native hit-priority groups`);
}finally{await browser?.close();server.kill('SIGTERM');}
