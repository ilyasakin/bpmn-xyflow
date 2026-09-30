/** Native pointer regressions for chosen connection anchors and route editing. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';
const port=Number(process.env.BPMN_CONNECTIONS_PORT||5235),base=`http://localhost:${port}`;
const child=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});child.stdout.on('data',()=>{});
const oracle=new BpmnModdle(),results=[];let browser;
const shape=(id,type,x,y,width=100,height=80)=>({id,type,x,y,width,height});
const a=shape('Source','task',180,200),b=shape('Target','task',660,320),c=shape('Other','task',660,440);
const straight=[{x:280,y:240},{x:660,y:240}],dogleg=[{x:280,y:240},{x:430,y:240},{x:430,y:360},{x:660,y:360}];
function fixture(nodes,waypoints) {
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Anchor_Definitions" targetNamespace="https://bpmn.io/schema/bpmn"><bpmn:process id="Process_1">${nodes.map(n=>`<bpmn:${n.type} id="${n.id}"/>`).join('')}${waypoints?'<bpmn:sequenceFlow id="Flow" sourceRef="Source" targetRef="Target"/>':''}</bpmn:process><bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">${nodes.map(n=>`<bpmndi:BPMNShape id="${n.id}_di" bpmnElement="${n.id}"${n.type==='subProcess'?' isExpanded="true"':''}><dc:Bounds x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}"/></bpmndi:BPMNShape>`).join('')}${waypoints?`<bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow">${waypoints.map(p=>`<di:waypoint x="${p.x}" y="${p.y}"/>`).join('')}</bpmndi:BPMNEdge>`:''}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
async function state(page) {
  const xml=await page.evaluate(()=>window.modeler.getXML()),parsed=await oracle.fromXML(xml);assert.deepEqual(parsed.warnings,[],'independent BPMN reopen');
  const di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]),shapes=Object.fromEntries(di.filter(d=>d.bounds).map(d=>[d.bpmnElement.id,{x:d.bounds.x,y:d.bounds.y,width:d.bounds.width,height:d.bounds.height}]));
  const flows=Object.values(parsed.elementsById).filter(bo=>bo.$type==='bpmn:SequenceFlow').map(bo=>({id:bo.id,source:bo.sourceRef.id,target:bo.targetRef.id,points:di.find(d=>d.bpmnElement===bo).waypoint.map(p=>({x:p.x,y:p.y}))}));
  return{xml,shapes,flows,history:await page.evaluate(()=>({size:window.modeler.commandStack.size(),redo:window.modeler.canRedo()})),viewport:await page.evaluate(()=>window.modeler.getViewport())};
}
async function point(page,p) {return page.evaluate(p=>{const m=window.modeler,v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{x:r.left+v.x+p.x*v.zoom,y:r.top+v.y+p.y*v.zoom};},p);}
async function hit(page,p,id,control) {
  const result=await page.evaluate(({x,y,control})=>{const e=document.elementFromPoint(x,y);return{id:e?.closest('[data-element-id]')?.getAttribute('data-element-id'),control:control?!!e?.closest(control):undefined,tag:e?.tagName,className:e?.getAttribute('class')};},{...p,control});
  if(control)assert.ok(result.control,`pointer target ${control}: ${JSON.stringify(result)}`);else assert.equal(result.id,id,`pointer target ${id}: ${JSON.stringify(result)}`);
}
async function selectShape(page,id,offset={x:50,y:40}) {
  const n=await page.evaluate(id=>{const n=window.modeler.getElement(id);return{x:n.x,y:n.y};},id),p=await point(page,{x:n.x+offset.x,y:n.y+offset.y});await hit(page,p,id);await page.mouse.click(p.x,p.y);
}
async function selectEdge(page,id='Flow') {
  const data=await page.evaluate(id=>{const e=window.modeler.getElement(id);let best;for(let i=1;i<e.waypoints.length;i++){const a=e.waypoints[i-1],b=e.waypoints[i],length=Math.hypot(b.x-a.x,b.y-a.y);if(!best||length>best.length)best={length,x:(a.x+b.x)/2,y:(a.y+b.y)/2};}return best;},id);
  const p=await point(page,data);await hit(page,p,id);await page.mouse.click(p.x,p.y);assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),[id]);
}
async function drag(page,from,to,{cancel=false,alt=false,shift=false}={}) {
  if(alt)await page.keyboard.down('Alt');if(shift)await page.keyboard.down('Shift');
  try {await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:10});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}
  finally {if(alt)await page.keyboard.up('Alt');if(shift)await page.keyboard.up('Shift');}
}
async function handlePoint(page,index) {
  const selector=`.bpmn-xyflow-bendpoint[data-bend-index="${index}"]`,el=await page.waitForSelector(selector),box=await el.boundingBox();const p={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,p,null,selector);return p;
}
async function undo(page,xml) {assert.equal(await page.$eval('#undo-btn',e=>e.disabled),false);await page.click('#undo-btn');assert.equal((await state(page)).xml,xml,'native undo restores exact XML/DI');}
async function redo(page,xml) {assert.equal(await page.$eval('#redo-btn',e=>e.disabled),false);await page.click('#redo-btn');assert.equal((await state(page)).xml,xml,'native redo restores exact XML/DI');}
function orthogonal(points) {assert.ok(points.every((p,i)=>!i||Math.abs(p.x-points[i-1].x)<0.01||Math.abs(p.y-points[i-1].y)<0.01),`route stays orthogonal: ${JSON.stringify(points)}`);}
function docked(p,n) {const inside=p.x>=n.x-1&&p.x<=n.x+n.width+1&&p.y>=n.y-1&&p.y<=n.y+n.height+1;const edge=Math.min(Math.abs(p.x-n.x),Math.abs(p.x-n.x-n.width),Math.abs(p.y-n.y),Math.abs(p.y-n.y-n.height));assert.ok(inside&&edge<=1,`anchor ${JSON.stringify(p)} lies on ${JSON.stringify(n)}`);}
function near(actual,expected,tolerance,label) {assert.ok(actual&&Math.hypot(actual.x-expected.x,actual.y-expected.y)<=tolerance,`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}, tolerance ${tolerance}`);}
async function preview(page) {
  return page.evaluate(()=>{const path=document.querySelector('.bpmn-xyflow-connect-preview')?.querySelector('path,line,polyline');if(!path)return null;const start=path.getPointAtLength(0),end=path.getPointAtLength(path.getTotalLength());return{start:{x:start.x,y:start.y},end:{x:end.x,y:end.y}};});
}
async function renderedEndpoints(page,id) {
  return page.evaluate(id=>{
    const path=window.modeler.getContainer().querySelector(`[data-element-id="${CSS.escape(id)}"] .bpmn-xyflow-connection-visual`);
    if(!path)throw new Error(`Missing rendered connection ${id}`);
    const matrix=path.getScreenCTM();
    if(!matrix)throw new Error(`Missing screen transform for ${id}`);
    const start=path.getPointAtLength(0).matrixTransform(matrix),end=path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
    return{start:{x:start.x,y:start.y},end:{x:end.x,y:end.y}};
  },id);
}
async function reopenCreatedConnection(page,name,expected,id) {
  const viewport=await page.evaluate(()=>window.modeler.getViewport()),renderedBefore=await renderedEndpoints(page,id);
  const warnings=await page.evaluate(async({xml,viewport})=>{
    const modeler=window.modeler,result=await modeler.importXML(xml);
    await modeler.setViewport(viewport,{duration:0});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    return result.warnings.map(warning=>warning.message);
  },{xml:expected.xml,viewport});
  assert.deepEqual(warnings,[],'actual viewer reimport adds no warnings');
  const reopened=await state(page),renderedAfter=await renderedEndpoints(page,id);
  assert.deepEqual(reopened.flows,expected.flows,'actual viewer reimport preserves semantic references and exact DI waypoints');
  assert.deepEqual(reopened.shapes,expected.shapes,'actual viewer reimport preserves shape DI bounds');
  assert.deepEqual(reopened.viewport,viewport,'reimport restores the edited view transform');
  near(renderedAfter.start,renderedBefore.start,0.01,'reimport leaves rendered source endpoint unchanged on screen');
  near(renderedAfter.end,renderedBefore.end,0.01,'reimport leaves rendered target endpoint unchanged on screen');
  await writeFile(`test-artifacts/browser-connections-${name}-reopen.json`,JSON.stringify({id,viewport,renderedBefore,renderedAfter,flows:reopened.flows,warnings},null,2));
  await page.screenshot({path:`test-artifacts/browser-connections-${name}-reopen.png`,fullPage:true});
}
async function fractionalSegmentDrag(page,name,id,delta) {
  const before=await state(page),original=before.flows.find(flow=>flow.id===id);
  assert.equal(original.points.length,2,'fractional regression starts with the imported two-point route');
  assert.notEqual(original.points[0].x,original.points[1].x);
  assert.notEqual(original.points[0].y,original.points[1].y);
  await selectEdge(page,id);
  const start=await point(page,{x:(original.points[0].x+original.points[1].x)/2,y:(original.points[0].y+original.points[1].y)/2}),end={x:start.x+delta.x,y:start.y+delta.y};
  await hit(page,start,id);await markPoints(page,[{...start,label:'Imported fractional segment midpoint'},{...end,label:'Chosen segment position'}]);
  await drag(page,start,end,{cancel:true});
  const cancelled=await state(page);assert.equal(cancelled.xml,before.xml,'Escape restores exact imported fractional route');assert.deepEqual(cancelled.history,before.history);
  await selectEdge(page,id);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x+1,start.y+1);await page.mouse.move(start.x,start.y);await page.mouse.up();
  const jitter=await state(page);assert.equal(jitter.xml,before.xml,'out-and-back near-axis drag preserves exact imported fractional route');assert.deepEqual(jitter.history,before.history);
  await selectEdge(page,id);
  await drag(page,start,end);
  const after=await state(page),edited=after.flows.find(flow=>flow.id===id);
  assert.ok(edited.points.length>=4,'near-axis plain drag creates an orthogonal dogleg');
  orthogonal(edited.points);
  const axis=delta.x?'x':'y',chosen=(original.points[0][axis]+original.points[1][axis])/2+delta[axis]/before.viewport.zoom;
  assert.ok(edited.points.slice(1,-1).some((point,index,inner)=>index&&Math.abs(point[axis]-chosen)<=1.5/before.viewport.zoom&&Math.abs(inner[index-1][axis]-chosen)<=1.5/before.viewport.zoom),'new parallel segment follows the native chosen position');
  // Whole-segment movement may redock on different source/target sides, as in
  // upstream. Only cancellation and undo must recover the original anchors.
  assert.equal(edited.source,original.source);assert.equal(edited.target,original.target);
  await page.screenshot({path:`test-artifacts/browser-connections-${name}-edited.png`,fullPage:true});
  await undo(page,before.xml);await redo(page,after.xml);
  await reopenCreatedConnection(page,name,after,id);
}
async function run(name,xml,zoom,fn) {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.setViewport({width:1800,height:1250});
  try {
    await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
    const warnings=await page.evaluate(async({xml,zoom})=>{const m=window.modeler,r=await m.importXML(xml);m.setViewport({x:140,y:100,zoom});return r.warnings.map(w=>w.message);},{xml,zoom});assert.deepEqual(warnings,[]);
    await fn(page);assert.deepEqual(errors,[]);const after=await state(page);await writeFile(`test-artifacts/browser-connections-${name}.bpmn`,after.xml);
    await page.screenshot({path:`test-artifacts/browser-connections-${name}-pass.png`,fullPage:true});results.push({name,status:'passed'});console.log(`PASS native connections ${name}`);
  } catch(error) {
    const detail={name,status:'failed',error:error.stack||String(error),browserErrors:errors};results.push(detail);console.error(`FAIL native connections ${name}: ${detail.error}`);
    await page.screenshot({path:`test-artifacts/browser-connections-${name}-failure.png`,fullPage:true}).catch(()=>{});
    const xml=await page.evaluate(()=>window.modeler?.getXML()).catch(()=>null);if(xml)await writeFile(`test-artifacts/browser-connections-${name}-failure.bpmn`,xml);
  } finally {await page.close();}
}
async function markPoints(page,points) {
  // Evidence only: transparent to input, never changes model geometry.
  await page.evaluate(points=>{
    document.querySelectorAll('.test-anchor-points').forEach(element=>element.remove());
    const overlay=document.createElement('div');overlay.className='test-anchor-points';Object.assign(overlay.style,{position:'fixed',inset:'0',pointerEvents:'none',zIndex:100000});
    points.forEach((point,index)=>{const dot=document.createElement('div'),label=document.createElement('span');Object.assign(dot.style,{position:'absolute',left:(point.x-4)+'px',top:(point.y-4)+'px',width:'8px',height:'8px',border:'2px solid #d00000',borderRadius:'50%',boxSizing:'border-box'});label.textContent=`${point.label} (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`;Object.assign(label.style,{position:'absolute',left:(point.x+9)+'px',top:(point.y+9+index*14)+'px',font:'12px monospace',color:'#900',background:'rgba(255,255,255,.9)'});overlay.append(dot,label);});document.body.appendChild(overlay);
  },points);
}
async function createByGesture(page,name,source,target,sourcePort,targetPort,mode) {
  let shiftHeld=false;
  try {
  const before=await state(page),end=await point(page,targetPort);await hit(page,end,target.id);
  let start;
  if(mode==='hover') {
    const center=await point(page,{x:source.x+source.width/2,y:source.y+source.height/2});await page.mouse.move(center.x,center.y);
    const handle=await page.waitForSelector('.bpmn-xyflow-connect-handle'),box=await handle.boundingBox();start={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,start,null,'.bpmn-xyflow-connect-handle');
  } else if(mode==='context-drag'||mode==='context-click') {
    await selectShape(page,source.id,{x:source.width/2,y:source.height/2});
    const button=await page.waitForSelector('.bpmn-xyflow-context-pad button[title="Connect — drag to a target shape"]'),box=await button.boundingBox();start={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,start,null,'.bpmn-xyflow-context-pad button');
  } else {start=await point(page,sourcePort);await hit(page,start,source.id);await page.keyboard.down('Shift');shiftHeld=true;}
  await page.mouse.move(start.x,start.y);
  if(mode==='context-click')await page.mouse.click(start.x,start.y);else await page.mouse.down();
  await page.mouse.move(end.x,end.y,{steps:12});
  const live=await preview(page),sourceScreen=await point(page,mode.startsWith('context-')&&live?live.start:sourcePort);
  await markPoints(page,[{...sourceScreen,label:mode.startsWith('context-')?'Preview source anchor':'Chosen source port'},{...end,label:'Chosen drop port'},{...start,label:'Native gesture start'}]);
  await page.screenshot({path:`test-artifacts/browser-connections-${name}-preview.png`,fullPage:true});
  if(mode==='context-click')await page.mouse.click(end.x,end.y);else await page.mouse.up();
  if(shiftHeld){await page.keyboard.up('Shift');shiftHeld=false;}
  const after=await state(page),edge=after.flows.find(edge=>edge.source===source.id&&edge.target===target.id);
  assert.ok(edge,`native ${mode} creates edge; preview=${JSON.stringify(live)}`);assert.ok(live,'live connection preview is present during native drag');
  await writeFile(`test-artifacts/browser-connections-${name}-anchors.json`,JSON.stringify({nativeStart:start,chosenSource:sourcePort,chosenTarget:targetPort,preview:live,finalDI:edge.points,viewport:after.viewport},null,2));
  const tolerance=1.5/after.viewport.zoom;
  if(mode.startsWith('context-')) {
    docked(live.start,after.shapes[source.id]);
    near(edge.points[0],live.start,tolerance,'automatic context-pad source anchor stays consistent from preview to commit');
  } else {
    near(live.start,sourcePort,tolerance,'live preview source follows chosen source port');
    near(edge.points[0],sourcePort,tolerance,'final DI preserves chosen source side/port');
  }
  near(live.end,targetPort,tolerance,'live preview endpoint follows pointer');
  near(edge.points.at(-1),targetPort,tolerance,'final DI preserves chosen target side/port');
  await undo(page,before.xml);await redo(page,after.xml);
  await reopenCreatedConnection(page,name,after,edge.id);
  } finally {
    if(shiftHeld)await page.keyboard.up('Shift').catch(()=>{});
    await page.mouse.up().catch(()=>{});
  }
}

try {
  const deadline=Date.now()+60000;while(true){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}if(child.exitCode!==null||Date.now()>deadline)throw new Error('Connection demo server startup timeout');await new Promise(r=>setTimeout(r,150));}
  browser=await puppeteer.launch({headless:'shell'});await mkdir('test-artifacts',{recursive:true});
  const cases=[
    {name:'right-to-right-backward',source:shape('Source','task',700,200),target:shape('Target','task',250,360),start:{x:800,y:240},end:{x:350,y:390},mode:'hover'},
    {name:'context-pad-press-drag',source:shape('Source','task',700,200),target:shape('Target','task',250,360),start:{x:800,y:240},end:{x:350,y:390},mode:'context-drag'},
    {name:'context-pad-click-arm',source:shape('Source','task',700,200),target:shape('Target','task',250,360),start:{x:800,y:240},end:{x:350,y:390},mode:'context-click'},
    {name:'circle-bottom-to-task-top',source:shape('Source','startEvent',700,200,36,36),target:shape('Target','task',250,360),start:{x:718,y:236},end:{x:275,y:360},mode:'shift'},
    {name:'diamond-top-to-circle-left',source:shape('Source','exclusiveGateway',700,200,50,50),target:shape('Target','endEvent',300,360,36,36),start:{x:725,y:200},end:{x:300,y:378},mode:'shift'},
    {name:'task-near-corner-to-diamond-right',source:shape('Source','task',700,200),target:shape('Target','exclusiveGateway',250,360,50,50),start:{x:790,y:200},end:{x:300,y:385},mode:'shift'}
  ];
  for(const zoom of [0.6,1.4])for(const c of cases) {
    const name=`create-${c.name}-z${zoom}`;
    await run(name,fixture([c.source,c.target]),zoom,page=>createByGesture(page,name,c.source,c.target,c.start,c.end,c.mode));
  }
  await run('low-zoom-hit-corridor',fixture([a,{...b,y:200}],straight),0.5,async page=>{
    for(const zoom of [0.5,1,1.6]) {
      await page.evaluate(zoom=>window.modeler.setViewport({x:140,y:100,zoom}),zoom);
      const p=await point(page,{x:470,y:240});p.y+=4;await hit(page,p,'Flow');await page.mouse.click(p.x,p.y);
      assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),['Flow']);
      const blank=await point(page,{x:900,y:600});await page.mouse.click(blank.x,blank.y);
      const inside=await point(page,{x:a.x+a.width-4/zoom,y:240});await hit(page,inside,'Source');
    }
  });
  await run('overlapping-endpoint-hit-exclusion',fixture([a,{...b,x:230,y:200}],[{x:280,y:240},{x:230,y:240}]),1,async page=>{
    const p=await point(page,{x:255,y:244});await hit(page,p,'Target');await page.mouse.click(p.x,p.y);
    assert.deepEqual(await page.evaluate(()=>window.modeler.getSelection()),['Target'],'overlap of endpoint interiors remains a shape hit, never the wide edge corridor');
  });
  await run('plain-two-point-segment',fixture([a,{...b,y:200}],straight),1,async page=>{
    const before=await state(page);await selectEdge(page);const p=await point(page,{x:470,y:240});await drag(page,p,{x:p.x,y:p.y+70});const after=await state(page),edge=after.flows[0];
    assert.ok(edge.points.length>=4,'plain drag creates an editable dogleg without a hidden modifier');assert.notDeepEqual(edge.points,before.flows[0].points);orthogonal(edge.points);
    docked(edge.points[0],after.shapes.Source);docked(edge.points.at(-1),after.shapes.Target);await undo(page,before.xml);await redo(page,after.xml);
  });
  await run('middle-segment-repeat-history',fixture([a,b],dogleg),0.7,async page=>{
    const original=await state(page);let prior=original;
    for(const dx of [65,-35,20]) {
      await selectEdge(page);const route=prior.flows[0].points,start={x:route[1].x,y:(route[1].y+route[2].y)/2};const p=await point(page,start),end=await point(page,{x:start.x+dx,y:start.y});await drag(page,p,end);
      const after=await state(page);orthogonal(after.flows[0].points);near(after.flows[0].points[1],{x:start.x+dx,y:route[1].y},1.5,'segment model delta respects zoom');
      await undo(page,prior.xml);await redo(page,after.xml);prior=after;
    }
    for(let i=0;i<3;i++)await page.click('#undo-btn');assert.equal((await state(page)).xml,original.xml);
  });
  await run('endpoint-chosen-drop-y',fixture([a,b,c],dogleg),0.9,async page=>{
    const before=await state(page),ends=[];
    for(const y of [c.y+25,c.y+60]) {
      await selectEdge(page);const start=await handlePoint(page,3),end=await point(page,{x:c.x,y});await hit(page,end,'Other');await markPoints(page,[{...start,label:'Old anchor'},{...end,label:'Chosen drop port'}]);await drag(page,start,end);
      const after=await state(page),edge=after.flows[0];assert.equal(edge.target,'Other');assert.deepEqual(edge.points[0],before.flows[0].points[0],'target reconnect keeps opposite source anchor fixed');near(edge.points.at(-1),{x:c.x,y},2,'reconnect preserves requested side and drop Y');ends.push(edge.points.at(-1));await undo(page,before.xml);
    }
    assert.ok(Math.abs(ends[0].y-ends[1].y)>25,'different user drop points cannot collapse to the same target-center anchor');
  });
  await run('source-end-chosen-port',fixture([a,b,c],dogleg),1.3,async page=>{
    const before=await state(page);
    for(const y of [c.y+20,c.y+60]) {
      await selectEdge(page);const start=await handlePoint(page,0),chosen={x:c.x+c.width,y},end=await point(page,chosen);await hit(page,end,'Other');await markPoints(page,[{...start,label:'Old anchor'},{...end,label:'Chosen drop port'}]);await drag(page,start,end);
      const after=await state(page),edge=after.flows[0];assert.equal(edge.source,'Other');assert.equal(edge.target,'Target');
      near(edge.points[0],chosen,2,'source reconnect preserves requested right-side anchor');
      assert.deepEqual(edge.points.at(-1),before.flows[0].points.at(-1),'source reconnect keeps opposite target anchor fixed');
      await undo(page,before.xml);await redo(page,after.xml);await undo(page,before.xml);
    }
  });
  await run('same-target-anchor-reposition',fixture([a,b],dogleg),1.2,async page=>{
    const before=await state(page),ends=[];
    for(const y of [b.y+15,b.y+65]) {
      await selectEdge(page);const start=await handlePoint(page,3),chosen={x:b.x,y},end=await point(page,chosen);await markPoints(page,[{...start,label:'Old anchor'},{...end,label:'Chosen same-target port'}]);await drag(page,start,end);
      const after=await state(page),edge=after.flows[0];assert.equal(edge.target,'Target');assert.equal(edge.source,'Source');
      near(edge.points.at(-1),chosen,2,'same-target redocking preserves exact requested Y');ends.push(edge.points.at(-1));
      assert.deepEqual(edge.points[0],before.flows[0].points[0],'same-target redocking leaves source anchor fixed');
      await undo(page,before.xml);await redo(page,after.xml);await undo(page,before.xml);
    }
    assert.ok(Math.abs(ends[0].y-ends[1].y)>40);
  });
  await run('invalid-cancel-and-outside',fixture([a,b,shape('Start','startEvent',420,470,36,36),shape('End','endEvent',420,90,36,36)],dogleg),1.2,async page=>{
    const before=await state(page);
    for(const [index,to,cancel] of [[3,{x:438,y:488},false],[0,{x:438,y:108},false],[3,{x:1000,y:700},false],[1,{x:470,y:280},true]]) {
      await selectEdge(page);const start=await handlePoint(page,index),end=await point(page,to);await drag(page,start,end,{cancel});
      const after=await state(page);assert.equal(after.xml,before.xml,'invalid drop/Escape rolls back full DI');assert.deepEqual(after.history,before.history);
    }
    await selectEdge(page);const start=await handlePoint(page,3);await drag(page,start,{x:1790,y:20});const outside=await state(page);assert.equal(outside.xml,before.xml);assert.deepEqual(outside.history,before.history);
    await selectEdge(page);const jitter=await handlePoint(page,1);await page.mouse.move(jitter.x,jitter.y);await page.mouse.down();await page.mouse.move(jitter.x+1,jitter.y+1);await page.mouse.move(jitter.x,jitter.y);await page.mouse.up();const unchanged=await state(page);assert.equal(unchanged.xml,before.xml,'out-and-back jitter leaves route unchanged');assert.deepEqual(unchanged.history,before.history,'out-and-back jitter adds no history');
  });
  await run('bendpoint-and-alt-insert',fixture([a,b],dogleg),1,async page=>{
    const before=await state(page);await selectEdge(page);const p=await handlePoint(page,1);await drag(page,p,{x:p.x+30,y:p.y+35});const bent=await state(page);
    assert.notDeepEqual(bent.flows[0].points,before.flows[0].points);docked(bent.flows[0].points[0],bent.shapes.Source);docked(bent.flows[0].points.at(-1),bent.shapes.Target);await undo(page,before.xml);
    await selectEdge(page);const q=await point(page,{x:315,y:240});await drag(page,q,{x:q.x,y:q.y+50},{alt:true});const inserted=await state(page);assert.ok(inserted.flows[0].points.length>before.flows[0].points.length);await undo(page,before.xml);
  });
  await run('shape-move-keeps-dogleg',fixture([a,b],dogleg),1.4,async page=>{
    const before=await state(page);await selectShape(page,'Source');const p=await point(page,{x:230,y:240});await drag(page,p,{x:p.x+42,y:p.y+56});const after=await state(page);assert.notDeepEqual(after.shapes.Source,before.shapes.Source);
    orthogonal(after.flows[0].points);docked(after.flows[0].points[0],after.shapes.Source);docked(after.flows[0].points.at(-1),after.shapes.Target);await undo(page,before.xml);await redo(page,after.xml);
  });
  const sub=shape('Source','subProcess',180,180,260,160),subTarget=shape('Target','task',760,320),subRoute=[{x:440,y:260},{x:520,y:260},{x:520,y:360},{x:760,y:360}];
  await run('resize-keeps-dogleg',fixture([sub,subTarget],subRoute),1,async page=>{
    const before=await state(page);await selectShape(page,'Source',{x:40,y:35});const selector='.bpmn-xyflow-resize-handle[data-resize-dir="se"]',handle=await page.waitForSelector(selector),box=await handle.boundingBox(),p={x:box.x+box.width/2,y:box.y+box.height/2};await hit(page,p,null,selector);await drag(page,p,{x:p.x+80,y:p.y+60});
    const after=await state(page);assert.ok(after.shapes.Source.width>before.shapes.Source.width);orthogonal(after.flows[0].points);docked(after.flows[0].points[0],after.shapes.Source);docked(after.flows[0].points.at(-1),after.shapes.Target);await undo(page,before.xml);
  });
  await run('native-pan-zoom-then-edit',fixture([a,b],dogleg),1,async page=>{
    const before=await state(page),blank=await point(page,{x:900,y:650});await page.mouse.move(blank.x,blank.y);await page.mouse.wheel({deltaY:-240});await new Promise(r=>setTimeout(r,200));
    const panStart=await point(page,{x:900,y:600});await drag(page,panStart,{x:panStart.x-80,y:panStart.y-45});const transformed=await state(page);assert.equal(transformed.xml,before.xml);assert.notDeepEqual(transformed.viewport,before.viewport);
    await selectEdge(page);const start=await point(page,{x:430,y:300}),end=await point(page,{x:480,y:300});await drag(page,start,end);const after=await state(page);orthogonal(after.flows[0].points);near(after.flows[0].points[1],{x:480,y:240},2,'transformed pointer converts to model space');await undo(page,before.xml);
  });
  // Keep the actual reported Conditional workflow in the regression corpus too.
  const conditional=await readFile('test/fixtures/bpmn/draw/conditional-flow.bpmn','utf8');
  await run('conditional-fractional-horizontal-segment',conditional,0.899250875,page=>fractionalSegmentDrag(page,'conditional-fractional-horizontal-segment','sid-262FECFE-432B-42B6-AAF7-040A6B6D1880',{x:0,y:55}));
  const fractionalVertical=[{x:260.199203187251,y:280},{x:260.4183266932271,y:400}];
  await run('fractional-vertical-segment',fixture([a,{...b,x:180,y:400}],fractionalVertical),1.3,page=>fractionalSegmentDrag(page,'fractional-vertical-segment','Flow',{x:55,y:0}));
  await run('conditional-fixture-reconnect',conditional,0.899250875,async page=>{
    const id='sid-82C30D2C-10BC-4035-8A14-B50298F120E9';
    const found=await page.evaluate(id=>{const m=window.modeler,e=m.getElement(id),target=m.getGraph().nodes.find(n=>n.businessObject?.name==='T2.0');return e&&target?{targetId:target.id,x:target.x,y:target.y,height:target.height,index:e.waypoints.length-1}:null;},id);
    assert.ok(found,'reported conditional flow and T2.0 exist');const before=await state(page);await selectEdge(page,id);const start=await handlePoint(page,found.index),end=await point(page,{x:found.x,y:found.y+found.height*0.8});await drag(page,start,end);const after=await state(page),edge=after.flows.find(edge=>edge.id===id);assert.equal(edge.target,found.targetId);near(edge.points.at(-1),{x:found.x,y:found.y+found.height*0.8},2,'reported T2.0 chosen drop point survives');await undo(page,before.xml);
  });
  await writeFile('test-artifacts/browser-connections-results.json',JSON.stringify(results,null,2));const failures=results.filter(r=>r.status==='failed');assert.equal(failures.length,0,failures.map(r=>`${r.name}: ${r.error}`).join('\n'));console.log(`PASS ${results.length} native connection groups`);
}finally{await browser?.close();child.kill('SIGTERM');}
