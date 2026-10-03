/**
 * Real-touch differential baseline: bpmn-xyflow vs pinned bpmn-js 18.30.1.
 * Inputs use one public CDP session matching Puppeteer touch payloads,
 * never DOM dispatchEvent. Per-contact end follows installed Puppeteer 24.43.0
 * CdpTouchHandle.end(), which sends the released point, not the remaining set.
 * Docs: https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchTouchEvent
 *       https://pptr.dev/api/puppeteer.touchscreen
 * No local browser permission workaround or security-disabling launch flags.
 * Shared unsupported modeling gestures are explicitly recorded, not certified.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';
const require=createRequire(import.meta.url);
const port=Number(process.env.BPMN_TOUCH_PORT||5233),base=`http://localhost:${port}`;
const child=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});
child.stdout.on('data',()=>{});
const oracle=new BpmnModdle(),results=[];
let browser;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Touch_Definitions" targetNamespace="https://bpmn.io/schema/bpmn">
<bpmn:process id="Process_1"><bpmn:task id="Task_A"/><bpmn:task id="Task_B"/><bpmn:subProcess id="Sub"/></bpmn:process>
<bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
<bpmndi:BPMNShape id="Task_A_di" bpmnElement="Task_A"><dc:Bounds x="300" y="180" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="Task_B_di" bpmnElement="Task_B"><dc:Bounds x="650" y="180" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="true"><dc:Bounds x="250" y="400" width="500" height="250"/></bpmndi:BPMNShape>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;

async function setup(engine) {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setViewport({width:1600,height:1100,hasTouch:true,isMobile:false,deviceScaleFactor:1});
  const cdp=await page.createCDPSession();
  await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>!!window.modeler?.getGraph());
  if(engine==='upstream') {
    await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});
    for(const file of ['diagram-js.css','bpmn-js.css'])await page.addStyleTag({path:require.resolve(`bpmn-js/dist/assets/${file}`)});
  }
  const warnings=await page.evaluate(async({engine,xml})=>{
    const container=document.querySelector('#viewer');
    if(engine==='upstream') {
      window.modeler.destroy();container.replaceChildren();
      const modeler=new window.BpmnJS({container});window.upstream=modeler;
      window.touchResizeMoves=0;modeler.get('eventBus').on('resize.move',()=>{window.touchResizeMoves++;});
      const imported=await modeler.importXML(xml),canvas=modeler.get('canvas');
      canvas.viewbox({x:-150,y:-140,width:container.clientWidth,height:container.clientHeight});
      window.touchEngine={
        xml:async()=> (await modeler.saveXML({format:true})).xml,
        node:id=>modeler.get('elementRegistry').get(id),
        selection:()=>modeler.get('selection').get().map(element=>element.id),
        viewport:()=>{const v=canvas.viewbox();return{x:-v.x*v.scale,y:-v.y*v.scale,zoom:v.scale};},
        history:()=>({undo:modeler.get('commandStack').canUndo(),redo:modeler.get('commandStack').canRedo()}),container
      };
      return imported.warnings.map(w=>w.message);
    }
    const m=window.modeler,imported=await m.importXML(xml);m.setViewport({x:150,y:140,zoom:1});
    window.touchEngine={xml:()=>m.getXML(),node:id=>m.getElement(id),selection:()=>m.getSelection(),viewport:()=>m.getViewport(),
      history:()=>({undo:m.canUndo(),redo:m.canRedo()}),container};
    return imported.warnings.map(w=>w.message);
  },{engine,xml});
  assert.deepEqual(warnings,[],`${engine} fixture warnings`);
  await page.evaluate(()=>{
    window.touchEvidence=[];window.activeTouchPointers=new Set();
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel']) {
      window.addEventListener(type,event=>{
        if(event.pointerType==='touch') {
          if(type==='pointerdown')window.activeTouchPointers.add(event.pointerId);
          if(type==='pointerup'||type==='pointercancel')window.activeTouchPointers.delete(event.pointerId);
        }
        window.touchEvidence.push({type,isTrusted:event.isTrusted,pointerType:event.pointerType,
          pointerId:event.pointerId,touches:event.touches?.length,activePointerIds:[...window.activeTouchPointers]});
      },{capture:true});
    }
  });
  // Touch state belongs to the CDP session's InputHandler. Keep start, move,
  // per-contact end and cancel on this one public session; mixing page.touchscreen
  // with a separate CDPSession leaves cancel with no active TouchStart.
  // Per-contact payloads match installed Puppeteer 24.43 CdpTouchHandle.
  const contacts=new Map();
  const send=async(type,points=[])=>{
    if(type==='touchCancel') {
      await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[]});contacts.clear();
    } else if(type==='touchEnd') {
      const ids=points.length?points.map(point=>point.id):[...contacts.keys()];
      for(const id of ids) {
        assert.ok(contacts.has(id),`ending active contact ${id}`);
        await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:[contacts.get(id)]});contacts.delete(id);
      }
    } else {
      for(const [index,point] of points.entries()) {
        const id=point.id??index+1,contact={id,x:Math.round(point.x),y:Math.round(point.y),radiusX:0.5,radiusY:0.5,force:0.5};
        if(type==='touchStart'&&!contacts.has(id)) {
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[contact]});
        } else {
          assert.ok(contacts.has(id),`moving active contact ${id}`);
          await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[contact]});
        }
        contacts.set(id,contact);
      }
    }
    await pause(35); // allow Chromium's native touch coalescing and paint
  };
  return {engine,page,cdp,errors,send,
    async point(id,offset) {
      const point=await page.evaluate(({id,offset})=>{
        const e=window.touchEngine,n=e.node(id),v=e.viewport(),r=e.container.getBoundingClientRect();
        const x=r.left+v.x+(n.x+(offset?.x??n.width/2))*v.zoom,y=r.top+v.y+(n.y+(offset?.y??n.height/2))*v.zoom;
        const top=document.elementFromPoint(x,y);
        return{x,y,hit:top?.closest('[data-element-id]')?.getAttribute('data-element-id'),tag:top?.tagName,className:top?.getAttribute('class')};
      },{id,offset});
      assert.equal(point.hit,id,`${engine} actual touch point must hit ${id}: ${JSON.stringify(point)}`);
      return point;
    },
    async blank(x=1000,y=120) {
      const point=await page.evaluate(({x,y})=>{
        const e=window.touchEngine,v=e.viewport(),r=e.container.getBoundingClientRect();
        x=r.left+v.x+x*v.zoom;y=r.top+v.y+y*v.zoom;
        const top=document.elementFromPoint(x,y),hit=top?.closest('[data-element-id]')?.getAttribute('data-element-id');
        return{x,y,hit,inside:e.container.contains(top),blocked:!!top?.closest('.bpmn-xyflow-palette,.bpmn-xyflow-context-pad,.bpmn-xyflow-editor-actions,.bpmn-xyflow-minimap,.djs-palette,.djs-context-pad,.bjs-powered-by')};
      },{x,y});
      assert.ok(point.inside&&!point.blocked&&(!point.hit||point.hit==='Process_1'),`${engine} blank gesture point must hit unobstructed canvas: ${JSON.stringify(point)}`);
      return point;
    },
    async control(selector) {
      const handle=await page.waitForSelector(selector),box=await handle.boundingBox();assert.ok(box,`visible ${selector}`);
      const point={x:box.x+box.width/2,y:box.y+box.height/2};
      const hit=await page.evaluate(({selector,x,y})=>{
        const target=document.querySelector(selector),top=document.elementFromPoint(x,y);
        return{matches:target===top||target.contains(top),tag:top?.tagName,className:top?.getAttribute('class')};
      },{selector,...point});
      assert.ok(hit.matches,`${engine} control touch must hit ${selector}: ${JSON.stringify(hit)}`);
      return point;
    },
    async tap(point) {await send('touchStart',[point]);await send('touchEnd');},
    async drag(start,dx,dy,{cancel=false}={}) {
      await send('touchStart',[start]);
      for(let step=1;step<=8;step++)await send('touchMove',[{x:start.x+dx*step/8,y:start.y+dy*step/8,id:1}]);
      await send(cancel?'touchCancel':'touchEnd');
    },
    async state() {
      const state=await page.evaluate(async()=>{const e=window.touchEngine;return{xml:await e.xml(),selection:e.selection(),viewport:e.viewport(),history:e.history(),evidence:window.touchEvidence,visualScale:window.visualViewport?.scale};});
      const parsed=await oracle.fromXML(state.xml);assert.deepEqual(parsed.warnings,[],`${engine} independent XML warnings`);
      state.geometry=Object.fromEntries(parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement).filter(di=>di.bounds)
        .map(di=>[di.bpmnElement.id,{x:di.bounds.x,y:di.bounds.y,width:di.bounds.width,height:di.bounds.height}]));
      state.flows=Object.values(parsed.elementsById).filter(bo=>bo.$type==='bpmn:SequenceFlow').map(bo=>({id:bo.id,source:bo.sourceRef.id,target:bo.targetRef.id}));
      return state;
    },
    async resizePoint() {
      const selector=engine==='upstream'?'.djs-resizer-se':'.bpmn-xyflow-resize-handle[data-resize-dir="se"]';
      return this.control(selector);
    }
  };
}

async function resizeActivity(session) {
  return session.page.evaluate(()=>{
    const n=window.touchEngine.node('Sub');
    return{bounds:{x:n.x,y:n.y,width:n.width,height:n.height},resizeMoves:window.touchResizeMoves||0};
  });
}
function geometryChanged(before,after,id) {return JSON.stringify(before.geometry[id])!==JSON.stringify(after.geometry[id]);}
function viewportChanged(before,after) {return ['x','y','zoom'].some(key=>Math.abs(before.viewport[key]-after.viewport[key])>0.01);}
function assertNative(state) {
  assert.ok(state.evidence.some(event=>event.type==='touchstart'&&event.isTrusted),'real trusted touchstart recorded');
  assert.ok(state.evidence.some(event=>event.pointerType==='touch'&&event.isTrusted),'real trusted touch PointerEvent recorded');
  assert.ok(state.evidence.every(event=>event.isTrusted),'no synthetic DOM input in evidence');
}
function supportedParity(upstream,local,operation) {
  if(upstream.activated)assert.equal(local.activated,true,`${operation}: local must support the same native gesture as upstream`);
  return !upstream.activated&&!local.activated ? `${operation} did not activate in either pinned native engine; shared limitation, not certified support` : null;
}
function cancellationParity(upstream,local,operation) {
  const normal=results.find(result=>result.name==='resize-touch-drag');
  if(normal?.status==='passed'&&!normal.upstream.activated&&!normal.local.activated) {
    return `${operation}: neither engine completed the ordinary native resize gesture; cancellation/no-mutation is checked, but resize support is not certified`;
  }
  return supportedParity(upstream,local,operation);
}
async function differential(name,run,compare) {
  const outcomes={};
  for(const engine of ['upstream','local']) {
    let session;
    try {
      session=await setup(engine);outcomes[engine]=await run(session);
      const final=await session.state();assertNative(final);assert.deepEqual(session.errors,[],'no runtime errors');
      await session.page.screenshot({path:`test-artifacts/browser-touch-${name}-${engine}.png`,fullPage:true});
      await writeFile(`test-artifacts/browser-touch-${name}-${engine}.bpmn`,final.xml);
      await writeFile(`test-artifacts/browser-touch-${name}-${engine}-events.json`,JSON.stringify(final.evidence,null,2));
    } catch(error) {
      outcomes[engine]={error:error.stack||String(error)};
      if(session)await session.page.screenshot({path:`test-artifacts/browser-touch-${name}-${engine}-failure.png`,fullPage:true}).catch(()=>{});
    } finally {await session?.page.close();}
  }
  try {
    for(const engine of ['upstream','local'])assert.equal(outcomes[engine]?.error,undefined,`${name}/${engine}: ${outcomes[engine]?.error}`);
    const limitation=compare(outcomes.upstream,outcomes.local);
    results.push({name,status:'passed',...outcomes,...(limitation?{sharedLimitation:limitation}:{})});
    console.log(`PASS touch differential ${name}${limitation?`: ${limitation}`:''}`);
  } catch(error) {
    results.push({name,status:'failed',...outcomes,error:error.stack||String(error)});
    console.error(`FAIL touch differential ${name}: ${error.stack||error}`);
  }
}

try {
  assert.equal(JSON.parse(await readFile('node_modules/bpmn-js/package.json','utf8')).version,'18.30.1');
  const deadline=Date.now()+60000;
  while(true){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(child.exitCode!==null||Date.now()>deadline)throw new Error('Touch demo server startup timeout');await pause(150);}
  browser=await puppeteer.launch({headless:'shell'});await mkdir('test-artifacts',{recursive:true});

  await differential('tap-select',async s=>{
    const before=await s.state();await s.tap(await s.point('Task_A'));const after=await s.state();
    assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);
    assert.deepEqual(after.selection,['Task_A'],'tap selects only the intended task');
    return{activated:after.selection.includes('Task_A'),selection:after.selection};
  },(u,l)=>{assert.equal(u.activated,true,'upstream native tap selects');assert.equal(l.activated,true,'local native tap selects');});

  await differential('background-pan',async s=>{
    const before=await s.state();await s.drag(await s.blank(),70,45);const after=await s.state();
    assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);
    return{activated:viewportChanged(before,after),before:before.viewport,after:after.viewport};
  },(u,l)=>{assert.equal(l.activated,true,'XYFlow promises touch canvas pan');return supportedParity(u,l,'canvas pan');});

  await differential('background-pinch',async s=>{
    const before=await s.state(),center=await s.blank(950,100);
    await s.send('touchStart',[{x:center.x-70,y:center.y,id:1},{x:center.x+70,y:center.y,id:2}]);
    for(let step=1;step<=8;step++)await s.send('touchMove',[{x:center.x-70-step*8,y:center.y,id:1},{x:center.x+70+step*8,y:center.y,id:2}]);
    await s.send('touchEnd');const after=await s.state();assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);
    return{activated:Math.abs(after.viewport.zoom-before.viewport.zoom)>0.05,before:before.viewport,after:after.viewport,visualScale:after.visualScale};
  },(u,l)=>{assert.equal(l.activated,true,'XYFlow promises native two-finger diagram pinch');assert.equal(l.visualScale,1,'gesture zooms diagram, not browser page');return supportedParity(u,l,'diagram pinch');});

  await differential('shape-touch-drag',async s=>{
    const before=await s.state();await s.drag(await s.point('Task_A'),60,40);const after=await s.state();
    const activated=geometryChanged(before,after,'Task_A');
    if(!activated){assert.equal(after.xml,before.xml,'unsupported shape gesture changes no XML');assert.deepEqual(after.history,before.history);}
    return{activated,before:before.geometry.Task_A,after:after.geometry.Task_A,viewportMoved:viewportChanged(before,after),history:after.history};
  },(u,l)=>supportedParity(u,l,'direct shape touch-drag'));

  await differential('resize-touch-drag',async s=>{
    await s.tap(await s.point('Sub',{x:30,y:30}));const before=await s.state();
    await s.drag(await s.resizePoint(),65,45);const after=await s.state();
    const activated=geometryChanged(before,after,'Sub');
    if(!activated){assert.equal(after.xml,before.xml,'unsupported resize gesture changes no XML');assert.deepEqual(after.history,before.history);}
    return{activated,before:before.geometry.Sub,after:after.geometry.Sub,viewportMoved:viewportChanged(before,after),history:after.history};
  },(u,l)=>supportedParity(u,l,'resize-handle touch-drag'));

  await differential('context-connect-taps',async s=>{
    const before=await s.state();
    await s.tap(await s.point('Task_A'));
    const selector=s.engine==='upstream'?'.djs-context-pad [data-action="connect"]':'.bpmn-xyflow-context-pad button[title="Connect — drag to a target shape"]';
    await s.tap(await s.control(selector));await s.tap(await s.point('Task_B'));
    const after=await s.state(),activated=after.flows.some(flow=>flow.source==='Task_A'&&flow.target==='Task_B');
    if(!activated){assert.equal(after.xml,before.xml,'unsupported connect gesture changes no XML');assert.deepEqual(after.history,before.history);}
    return{activated,flows:after.flows};
  },(u,l)=>supportedParity(u,l,'context-connect touch taps'));

  await differential('touchcancel-model-rollback',async s=>{
    await s.tap(await s.point('Sub',{x:30,y:30}));const before=await s.state(),first=await s.resizePoint();
    await s.send('touchStart',[first]);
    for(let step=1;step<=8;step++)await s.send('touchMove',[{x:first.x+50*step/8,y:first.y+35*step/8,id:1}]);
    const during=await resizeActivity(s);
    const activated=during.resizeMoves>0||JSON.stringify(during.bounds)!==JSON.stringify(before.geometry.Sub);
    await s.send('touchCancel');const after=await s.state();
    assert.ok(after.evidence.some(event=>event.type==='touchcancel'&&event.isTrusted));
    assert.equal(after.xml,before.xml,'touchcancel rolls back semantic geometry');assert.deepEqual(after.history,before.history,'touchcancel adds no command');
    return{activated,rolledBack:activated?true:null,during,viewportMoved:viewportChanged(before,after),selection:after.selection};
  },(u,l)=>cancellationParity(u,l,'activated resize cancellation'));

  await differential('second-pointer-interruption',async s=>{
    await s.tap(await s.point('Sub',{x:30,y:30}));const before=await s.state(),first=await s.resizePoint(),second=await s.blank(1000,600);
    await s.send('touchStart',[{...first,id:1}]);await s.send('touchMove',[{x:first.x+30,y:first.y+20,id:1}]);
    const during=await resizeActivity(s);
    const activated=during.resizeMoves>0||JSON.stringify(during.bounds)!==JSON.stringify(before.geometry.Sub);
    await s.send('touchStart',[{x:first.x+30,y:first.y+20,id:1},{...second,id:2}]);
    await s.send('touchMove',[{x:first.x+45,y:first.y+25,id:1},{x:second.x+25,y:second.y,id:2}]);
    await s.send('touchCancel');const after=await s.state();
    assert.equal(after.xml,before.xml,'multi-pointer interruption must not commit half a modeling gesture');assert.deepEqual(after.history,before.history);
    return{activated,rolledBack:activated?true:null,during,viewportMoved:viewportChanged(before,after)};
  },(u,l)=>cancellationParity(u,l,'activated resize second-pointer interruption'));

  await differential('multi-pointer-no-accidental-selection',async s=>{
    await s.tap(await s.point('Task_A'));const before=await s.state(),a=await s.point('Task_A'),b=await s.point('Task_B');
    await s.send('touchStart',[{...a,id:1}]);await s.send('touchStart',[{...a,id:1},{...b,id:2}]);
    const ids=await s.page.evaluate(()=>window.touchEvidence.filter(event=>event.type==='pointerdown'&&event.pointerType==='touch').slice(-2).map(event=>event.pointerId));
    assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
    // End only B on the same CDP stream while A remains physically active.
    await s.send('touchEnd',[{id:2}]);
    const releasedB=await s.page.evaluate(id=>window.touchEvidence.findLast(event=>event.type==='pointerup'&&event.pointerId===id),ids[1]);
    assert.ok(releasedB?.isTrusted,'native pointerup for B was observed');
    assert.ok(releasedB.activePointerIds.includes(ids[0]),'A remains down when B is released');
    assert.ok(!releasedB.activePointerIds.includes(ids[1]),'B is no longer active');
    await s.send('touchEnd',[{id:1}]);const after=await s.state();
    assert.ok(after.evidence.some(event=>event.type==='pointerup'&&event.pointerId===ids[0]&&event.activePointerIds.length===0),'A then releases natively');
    assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);
    return{selectionStable:JSON.stringify(after.selection)===JSON.stringify(before.selection),before:before.selection,after:after.selection};
  },(u,l)=>{if(u.selectionStable)assert.equal(l.selectionStable,true,'multi-touch must not become an accidental second-finger click');});

  await differential('mouse-after-touchcancel',async s=>{
    const point=await s.point('Task_A');await s.drag(point,35,25,{cancel:true});
    const before=await s.state(),mouse=await s.point('Task_A');
    await s.page.mouse.move(mouse.x,mouse.y);await s.page.mouse.down();await s.page.mouse.move(mouse.x+50,mouse.y+30,{steps:8});await s.page.mouse.up();
    const after=await s.state();return{activated:geometryChanged(before,after,'Task_A'),before:before.geometry.Task_A,after:after.geometry.Task_A,history:after.history};
  },(u,l)=>{assert.equal(u.activated,true,'upstream mouse still moves after touch');assert.equal(l.activated,true,'local mouse still moves after touch');assert.equal(l.history.undo,true);});

  await writeFile('test-artifacts/browser-touch-results.json',JSON.stringify({upstreamVersion:'18.30.1',input:'native Chromium CDP touch',results},null,2));
  const failures=results.filter(result=>result.status==='failed');
  assert.equal(failures.length,0,failures.map(result=>`${result.name}: ${result.error}`).join('\n'));
  console.log(`PASS ${results.length} touch differential groups; inspect sharedLimitation records before claiming gesture support`);
} finally {await browser?.close();child.kill('SIGTERM');}
