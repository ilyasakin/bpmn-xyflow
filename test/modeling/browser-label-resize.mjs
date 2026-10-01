/**
 * Native external-label width-resize acceptance, including default snapping
 * and explicit modifier bypass against the pinned upstream implementation.
 * Each action uses real Chromium mouse/keyboard input. Fixture import and the
 * pinned upstream text-layout oracle are setup/read-only observations only.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer';
import { BpmnModdle } from 'bpmn-moddle';

const require=createRequire(import.meta.url),oracle=new BpmnModdle();
assert.equal(require('bpmn-js/package.json').version,'18.30.1');
const port=Number(process.env.BPMN_LABEL_RESIZE_PORT||5243),base=`http://localhost:${port}`;
const results=[];let browser,server,serverOutput='';
const bounds=b=>({x:b.x,y:b.y,width:b.width,height:b.height});
const longName='Approve corrected travel request after the manager has reviewed every reservation';
const canonical=async definitions=>(await oracle.toXML(definitions,{format:true})).xml;
function boundsOpaque(xml){
  const label=xml.match(/<bpmndi:BPMNLabel\b[^>]*\bid="ResizeLabelDI"[^>]*>([\s\S]*?)<\/bpmndi:BPMNLabel>/)?.[1];
  if(label===undefined)return null; // Authored labels have no selected imported DI.
  return label.match(/<dc:Bounds\b[^>]*>([\s\S]*?)<\/dc:Bounds>/)?.[1]||'';
}

async function fixture(name,id,{text=longName,width=240,authored=false}={}) {
  const parsed=await oracle.fromXML(await readFile(`test/fixtures/scenarios/${name}.bpmn`,'utf8'));assert.deepEqual(parsed.warnings,[]);
  const owner=parsed.elementsById[id],di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]).find(d=>d.bpmnElement===owner);
  owner.name=authored?'':text;
  if(authored)delete di.label;
  else {
    const labelStyle=oracle.create('bpmndi:BPMNLabelStyle',{id:'ResizeLabelStyle',font:oracle.create('dc:Font',{name:'Arial',size:11,isBold:false})});
    parsed.rootElement.diagrams[0].labelStyle=[labelStyle];
    di.label=oracle.create('bpmndi:BPMNLabel',{id:'ResizeLabelDI',labelStyle,bounds:oracle.create('dc:Bounds',{x:500.25,y:500.5,width,height:20.25})});
    parsed.rootElement.$attrs['xmlns:qa']='urn:bpmn-xyflow:label-resize:qa';
    di.label.$attrs['qa:trace']='retain-selected-label-metadata';
  }
  const xml=await canonical(parsed.rootElement);
  if(authored)return xml;
  // Foreign attributes are allowed on BPMNLabel, but not dc:Bounds. Comments
  // and PIs are valid XML metadata within Bounds and exercise local losslessness
  // without making the ordinary fixture fail official BPMN XSD validation.
  const result=xml.replace(/(<bpmndi:BPMNLabel\b[^>]*\bid="ResizeLabelDI"[^>]*>[\s\S]*?)(<dc:Bounds\b[^>]*?)\s*\/>/,'$1$2><!-- label resize bounds metadata --><?label-resize keep?></dc:Bounds>');
  assert.equal(boundsOpaque(result),'<!-- label resize bounds metadata --><?label-resize keep?>');return result;
}
async function setup(engine,xml,zoom) {
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(10000);page.setDefaultNavigationTimeout(30000);
  try {
    await page.setViewport({width:1800,height:1250});await page.goto(`${base}/modeler/`,{waitUntil:'networkidle0'});await page.waitForFunction(()=>!!window.modeler?.getGraph());
    await page.addScriptTag({path:require.resolve('bpmn-js/dist/bpmn-modeler.development.js')});
    if(engine==='upstream')for(const name of ['diagram-js.css','bpmn-js.css'])await page.addStyleTag({path:require.resolve(`bpmn-js/dist/assets/${name}`)});
    const warnings=await page.evaluate(async({engine,xml,zoom})=>{
      const container=document.querySelector('#viewer');let result,m,renderer,reference;
      const viewport={x:140,y:100,zoom};
      if(engine==='upstream') {
        window.modeler.destroy();container.replaceChildren();m=new window.BpmnJS({container});window.upstream=m;reference=m;renderer=m.get('textRenderer');
        window.labelResizeMoves=[];
        m.get('eventBus').on('resize.move',500,event=>{const c=event.context;window.labelResizeMoves.push({id:c.shape?.id,direction:c.direction,bounds:c.newBounds&&{x:c.newBounds.x,y:c.newBounds.y,width:c.newBounds.width,height:c.newBounds.height}});});
        const setViewport=v=>m.get('canvas').viewbox({x:-v.x/v.zoom,y:-v.y/v.zoom,width:container.clientWidth/v.zoom,height:container.clientHeight/v.zoom});
        window.labelEngine={container,node:id=>m.get('elementRegistry').get(id),selection:()=>m.get('selection').get().map(n=>n.id),
          xml:async()=>(await m.saveXML({format:true})).xml,import:xml=>m.importXML(xml),setViewport,
          viewport:()=>{const v=m.get('canvas').viewbox();return{x:-v.x*v.scale,y:-v.y*v.scale,zoom:v.scale};},history:()=>({undo:m.get('commandStack').canUndo(),redo:m.get('commandStack').canRedo()})};
      }else{
        m=window.modeler;
        // This instance is only a pinned text measurement oracle. It imports
        // no diagram, takes no modeling actions and never receives input.
        const hidden=document.createElement('div');Object.assign(hidden.style,{position:'fixed',left:'-20000px',top:'0',width:'1000px',height:'600px',pointerEvents:'none'});hidden.setAttribute('aria-hidden','true');document.body.append(hidden);
        window.labelOracle=new window.BpmnJS({container:hidden,keyboard:{bind:false}});reference=window.labelOracle;renderer=reference.get('textRenderer');
        window.labelEngine={container,node:id=>m.getElement(id),selection:()=>m.getSelection(),xml:()=>m.getXML(),import:xml=>m.importXML(xml),setViewport:v=>m.setViewport(v),viewport:()=>m.getViewport(),history:()=>({undo:m.canUndo(),redo:m.canRedo(),size:m.commandStack.size()})};
      }
      window.labelEngine.engine=engine;
      window.labelEngine.measure=(text,box)=>renderer.getDimensions(text,{box,style:renderer.getExternalStyle()});
      // Build immutable numeric snap candidates using the actual pinned
      // ResizeSnapping service. This is a read-only expectation calculation;
      // every tested resize still comes from native mouse/key input.
      window.labelEngine.prepareResizeReference=(id,direction)=>{
        const label=window.labelEngine.node(id)?.label||window.labelEngine.node(id+'_label');
        const box={x:label.x,y:label.y,width:label.width,height:label.height};
        const probe={...label,...box,id:label.id,parent:label.parent,labelTarget:label.labelTarget};
        const x=direction==='e'?box.x+box.width:box.x,context={shape:probe,direction};
        const resizeSnapping=reference.get('resizeSnapping');
        resizeSnapping.initSnap({context,x,y:box.y+box.height/2});
        const points=resizeSnapping.addSnapTargetPoints(context.snapContext.pointsForTarget(probe.parent),probe,probe.parent,direction);
        window.labelResizeReference={box,direction,x,points,grid:reference.get('gridSnapping')};
        window.labelPointerEvents=[];
      };
      window.labelEngine.expectedResize=()=>{
        const input=window.labelPointerEvents,down=input.find(event=>event.type==='mousedown'),last=input.filter(event=>event.type==='mousemove').at(-1);
        if(!down||!last)throw Error('Missing real native resize pointer evidence');
        const {box,direction,x,points,grid}=window.labelResizeReference;
        const delta=(last.clientX-down.clientX)/window.labelEngine.viewport().zoom;
        const bypass=!!((last.ctrlKey||last.metaKey)&&!last.altKey),proposed=x+delta;
        const aligned=bypass?undefined:points.snap({x:proposed,y:box.y},'corner','x',7);
        let edge=aligned===undefined?(bypass?proposed:grid.snapValue(proposed,direction==='e'?{min:box.x+10}:{max:box.x+box.width-10})):aligned;
        edge=direction==='e'?Math.max(box.x+10,edge):Math.min(box.x+box.width-10,edge);
        const expected={x:Math.round(direction==='e'?box.x:edge),width:Math.round(direction==='e'?edge-box.x:box.x+box.width-edge)};
        return {down,last,delta,bypass,proposed,aligned,gridSpacing:grid.getGridSpacing(),expected,original:box};
      };
      window.labelPointerEvents=[];
      for(const type of ['mousedown','mousemove','mouseup'])window.addEventListener(type,event=>{
        window.labelPointerEvents.push({type,clientX:event.clientX,clientY:event.clientY,ctrlKey:event.ctrlKey,metaKey:event.metaKey,altKey:event.altKey});
      },true);
      result=await window.labelEngine.import(xml);window.labelEngine.setViewport(viewport);return result.warnings.map(w=>w.message);
    },{engine,xml,zoom});assert.deepEqual(warnings,[]);
    if(engine==='local')assert.deepEqual(boundsOpaque(await page.evaluate(()=>window.labelEngine.xml())),boundsOpaque(xml),'local import retains selected Bounds comments/PI');
    return{page,errors};
  }catch(error){await page.close();throw error;}
}
async function state(page,id) {
  const xml=await page.evaluate(()=>window.labelEngine.xml()),parsed=await oracle.fromXML(xml);assert.deepEqual(parsed.warnings,[],'independent bpmn-moddle reopen');
  const di=parsed.rootElement.diagrams.flatMap(d=>d.plane.planeElement||[]),ownerDi=di.find(d=>d.bpmnElement.id===id);
  const visual=await page.evaluate(id=>{
    const e=window.labelEngine,label=e.node(id)?.label||e.node(id+'_label');
    if(!label)return null;
    const b={x:label.x,y:label.y,width:label.width,height:label.height},text=e.container.querySelector(`[data-element-id="${label.id}"] text`),r=text?.getBoundingClientRect();
    return{...b,id:label.id,text:text?.textContent,lines:text?.querySelectorAll('tspan').length||0,textRect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};
  },id);
  return{xml,opaque:boundsOpaque(xml),definitions:parsed.rootElement,owner:parsed.elementsById[id],ownerDi,label:ownerDi.label?.bounds?bounds(ownerDi.label.bounds):null,visual,
    history:await page.evaluate(()=>window.labelEngine.history()),viewport:await page.evaluate(()=>window.labelEngine.viewport())};
}
async function sameExceptLabelBounds(before,after) {
  // Restoring only the selected label bounds must make the entire independent
  // semantic/DI model identical, including owner geometry, every route/anchor,
  // timer/condition/default refs, documentation, style and other DI metadata.
  assert.deepEqual(after.opaque,before.opaque,'selected Bounds comments/PI survive; upstream canonicalization alone cannot prove this');
  const saved=bounds(after.ownerDi.label.bounds);Object.assign(after.ownerDi.label.bounds,bounds(before.ownerDi.label.bounds));
  try{assert.equal(await canonical(after.definitions),await canonical(before.definitions),'only selected external-label bounds may change');}
  finally{Object.assign(after.ownerDi.label.bounds,saved);}
}
async function hit(page,p,id,selector) {
  const actual=await page.evaluate(({p,selector})=>{const e=document.elementFromPoint(p.x,p.y),r=window.labelEngine.container.getBoundingClientRect();return{inside:p.x>=Math.max(0,r.left)&&p.x<Math.min(innerWidth,r.right)&&p.y>=Math.max(0,r.top)&&p.y<Math.min(innerHeight,r.bottom),id:e?.closest('[data-element-id]')?.getAttribute('data-element-id'),control:selector?!!e?.closest(selector):false};},{p,selector});
  assert.ok(actual.inside,`native point must be on-screen: ${JSON.stringify(p)}`);
  if(selector)assert.ok(actual.control,`actual native control hit ${selector}: ${JSON.stringify(actual)}`);else assert.equal(actual.id,id,`actual native shape/label hit ${id}`);
}
async function textPoint(page,id) {
  const p=await page.evaluate(id=>{
    const e=window.labelEngine,label=e.node(id)?.label||e.node(id+'_label'),text=e.container.querySelector(`[data-element-id="${label?.id}"] text`),r=text?.getBoundingClientRect();
    if(!r?.width)throw Error(`Missing visible label for ${id}`);
    for(const fy of [.35,.5,.65])for(const fx of [.5,.4,.6,.25,.75]){const p={x:r.left+r.width*fx,y:r.top+r.height*fy};if(document.elementFromPoint(p.x,p.y)?.closest('[data-element-id]')?.getAttribute('data-element-id')===label.id)return{...p,id:label.id};}
    throw Error(`No unobstructed text hit for ${id}`);
  },id);await hit(page,p,p.id);return p;
}
async function selectLabel(page,id,engine) {
  const blank=await page.evaluate(()=>{const r=window.labelEngine.container.getBoundingClientRect();return{x:r.right-300,y:r.bottom-60};});
  await page.mouse.click(blank.x,blank.y);assert.deepEqual(await page.evaluate(()=>window.labelEngine.selection()),[]);
  const p=await textPoint(page,id);await page.mouse.click(p.x,p.y);assert.deepEqual(await page.evaluate(()=>window.labelEngine.selection()),[p.id]);
  const directions=await page.evaluate(engine=>engine==='local'?[...document.querySelectorAll('#viewer .bpmn-xyflow-resize-handle')].map(n=>n.getAttribute('data-resize-dir')).sort():[...document.querySelectorAll('#viewer .djs-resizer')].map(n=>[...n.classList].find(c=>/^djs-resizer-(e|w|n|s|ne|nw|se|sw)$/.test(c))?.replace('djs-resizer-','')).sort(),engine);
  assert.deepEqual(directions,['e','w'],'an external label exposes exactly east/west handles, never owner shape handles');
}
async function handle(page,engine,dir) {
  const selector=engine==='local'?`.bpmn-xyflow-resize-handle[data-resize-dir="${dir}"]`:`.djs-resizer-${dir}`;
  const node=await page.waitForSelector('#viewer '+selector),r=await node.boundingBox();assert.ok(r);
  const p={x:r.x+r.width/2,y:r.y+r.height/2};await hit(page,p,null,selector);return p;
}
async function shortcut(page,key,{shift=false}={}) {
  await page.keyboard.down('Control');if(shift)await page.keyboard.down('Shift');
  try{await page.keyboard.press(key);}finally{if(shift)await page.keyboard.up('Shift');await page.keyboard.up('Control');}
}
async function gesture(page,from,to,{cancel=false,outAndBack=false,onMoved,control=false}={}) {
  if(control)await page.keyboard.down('Control');
  try{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:12});if(onMoved)await onMoved();if(outAndBack)await page.mouse.move(from.x,from.y,{steps:6});if(cancel)await page.keyboard.press('Escape');await page.mouse.up();}
  finally{await page.mouse.up().catch(()=>{});if(control)await page.keyboard.up('Control');}
}
async function activeResize(page,id,engine,before,previousMoves=0) {
  const evidence=await page.evaluate(({id,engine})=>{
    const e=window.labelEngine,label=e.node(id)?.label||e.node(id+'_label');
    if(engine==='local')return{id:label.id,bounds:{x:label.x,y:label.y,width:label.width,height:label.height}};
    return{count:window.labelResizeMoves.length,...window.labelResizeMoves.at(-1)};
  },{id,engine});
  assert.equal(evidence.id,before.visual.id,'the pending native resize belongs to the selected external label');
  if(engine==='upstream')assert.ok(evidence.count>previousMoves,'actual upstream resize.move fired for this gesture');
  assert.ok(['x','width'].some(key=>Math.abs(evidence.bounds[key]-before.visual[key])>.5),'resize preview actually changes before cancellation/interruption');
  return evidence;
}
async function resize(page,id,engine,dir,delta,{cancel=false,outAndBack=false,control=false}={}) {
  await selectLabel(page,id,engine);const before=await state(page,id),from=await handle(page,engine,dir),to={x:from.x+delta*before.viewport.zoom,y:from.y};
  const moves=await page.evaluate(()=>window.labelResizeMoves?.length||0);let preview;
  await page.evaluate(({id,dir})=>window.labelEngine.prepareResizeReference(id,dir),{id,dir});
  await gesture(page,from,to,{cancel,outAndBack,control,onMoved:delta?async()=>{preview=await activeResize(page,id,engine,before,moves);}:undefined});
  const expectation=delta?await page.evaluate(()=>window.labelEngine.expectedResize()):null;
  const after=await state(page,id);
  await page.evaluate(diagnostic=>{window.labelResizeDiagnostic=diagnostic;},{id,dir,delta,from,to,preview,expectation,before:{label:before.label,visual:before.visual},after:{label:after.label,visual:after.visual}});
  return{before,after,from,to,preview,expectation};
}
async function checkCommit(page,before,after,expectation) {
  const old=before.visual,newBounds=after.label;
  assert.ok(old&&newBounds&&expectation);assert.equal(expectation.gridSpacing,10);
  assert.deepEqual({x:newBounds.x,width:newBounds.width},expectation.expected,
    `real pointer + pinned border/grid/minimum policy determines committed horizontal bounds: ${JSON.stringify({expectation,actual:newBounds})}`);
  assert.ok(Number.isInteger(newBounds.x)&&Number.isInteger(newBounds.width),'committed horizontal bounds are rounded');
  assert.equal(newBounds.y,old.y,'horizontal resize keeps top position');
  const measured=await page.evaluate(({text,box})=>window.labelEngine.measure(text,box),{text:after.owner.name||'',box:newBounds});
  assert.equal(newBounds.height,Math.ceil(measured.height),'height is fitted by pinned upstream TextRenderer, preserving chosen width');
  assert.deepEqual(bounds(after.visual),newBounds,'rendered label rectangle agrees with committed DI before reopen');
  await sameExceptLabelBounds(before,after);
}
async function history(page,id,engine,before,after) {
  const traces=[];
  for(let i=0;i<3;i++) {
    await shortcut(page,'z');const undone=await state(page,id);
    assert.deepEqual(bounds(undone.visual),bounds(before.visual),'Undo restores the exact pre-drag display bounds');
    if(engine==='local')assert.equal(undone.xml,before.xml,'local Undo restores byte-exact original label DI/metadata');
    else await sameExceptLabelBounds(before,undone);
    traces.push({cycle:i,undoXMLExact:undone.xml===before.xml,undoLabelDI:undone.label});
    await shortcut(page,'z',{shift:true});const redone=await state(page,id);
    assert.equal(redone.xml,after.xml,'Redo restores exact edited XML/DI');assert.deepEqual(bounds(redone.visual),bounds(after.visual));
  }
  return traces;
}
async function reopen(page,id,expected) {
  const warnings=await page.evaluate(async({xml,viewport})=>{const e=window.labelEngine,r=await e.import(xml);e.setViewport(viewport);return r.warnings.map(w=>w.message);},{xml:expected.xml,viewport:expected.viewport});assert.deepEqual(warnings,[]);
  const actual=await state(page,id);assert.deepEqual(actual.label,expected.label,'reopen preserves saved label DI width/height/position');
  assert.deepEqual(actual.opaque,expected.opaque,'actual reopen preserves selected Bounds comments/PI');
  assert.equal(await canonical(actual.definitions),await canonical(expected.definitions),'reopen preserves complete independent semantics and DI');
  // Import the IDENTICAL edited XML into the other real engine. Comparing
  // separately authored outputs would conflate gesture rounding with import
  // layout and could falsely report a one-pixel renderer discrepancy.
  const engine=await page.evaluate(()=>window.labelEngine.engine),other=await setup(engine==='local'?'upstream':'local',expected.xml,expected.viewport.zoom);
  let reference;
  try{
    reference=await state(other.page,id);assert.deepEqual(other.errors,[]);
    assert.deepEqual(reference.label,actual.label,'both engines preserve the identical saved label DI');
    assert.deepEqual(bounds(reference.visual),bounds(actual.visual),'both engines reopening identical XML have exact display geometry');
    assert.equal(await canonical(reference.definitions),await canonical(actual.definitions),'both engines reopen identical semantics and DI');
  }finally{await other.page.close();await page.bringToFront();}
  return{savedDI:actual.label,committedDisplay:bounds(expected.visual),reopenedDisplay:bounds(actual.visual),referenceEngine:engine==='local'?'upstream':'local',referenceDisplay:bounds(reference.visual),linesBefore:expected.visual.lines,linesAfter:actual.visual.lines};
}
async function renameUnlabelled(page,id,text) {
  const p=await page.evaluate(id=>{const e=window.labelEngine,n=e.node(id),v=e.viewport(),r=e.container.getBoundingClientRect();return{x:r.left+v.x+(n.x+n.width/2)*v.zoom,y:r.top+v.y+(n.y+n.height/2)*v.zoom};},id);await hit(page,p,id);
  await page.mouse.click(p.x,p.y,{count:2,delay:50});await page.waitForSelector('[contenteditable]');
  assert.equal(await page.evaluate(()=>document.activeElement?.matches('[contenteditable]')),true,'native double-click focused the body-mounted editor');
  await shortcut(page,'a');await page.keyboard.type(text);await page.keyboard.press('Enter');await page.waitForSelector('[contenteditable]',{hidden:true});
  assert.equal((await state(page,id)).owner.name,text);
}
async function run(name,engine,xml,zoom,id,fn) {
  let context;
  try {
    console.log(`START native label resize ${name} ${engine}`);
    context=await setup(engine,xml,zoom);const details=await fn(context.page);assert.deepEqual(context.errors,[]);
    const final=await state(context.page,id);await writeFile(`test-artifacts/browser-label-${name}-${engine}.bpmn`,final.xml);await writeFile(`test-artifacts/browser-label-${name}-${engine}.json`,JSON.stringify(details,null,2));
    await context.page.screenshot({path:`test-artifacts/browser-label-${name}-${engine}-pass.png`,fullPage:true});
    results.push({name,engine,status:'passed',details});console.log(`PASS native label resize ${name} ${engine}`);
  }catch(error){const diagnostic=context?await context.page.evaluate(()=>window.labelResizeDiagnostic).catch(()=>null):null;results.push({name,engine,status:'failed',error:error.stack||String(error),diagnostic});console.error(`FAIL native label resize ${name} ${engine}: ${error.stack||error}`);if(context){await context.page.screenshot({path:`test-artifacts/browser-label-${name}-${engine}-failure.png`,fullPage:true}).catch(()=>{});const xml=await context.page.evaluate(()=>window.labelEngine.xml()).catch(()=>null);if(xml)await writeFile(`test-artifacts/browser-label-${name}-${engine}-failure.bpmn`,xml);}}
  finally{await writeFile('test-artifacts/browser-label-resize-results.json',JSON.stringify({results},null,2));await context?.page.close().catch(()=>{});}
}

try {
  server=spawn(process.execPath,['lib/demo/serve.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','inherit']});server.stdout.on('data',chunk=>{serverOutput+=String(chunk);});
  const deadline=Date.now()+60000;while(true){
    const actual=serverOutput.match(/demo listening on http:\/\/localhost:(\d+)/);
    if(actual&&Number(actual[1])!==port)throw Error(`Label server bound unexpected port ${actual[1]}`);
    if(actual){try{if((await fetch(`${base}/modeler/`,{signal:AbortSignal.timeout(5000)})).ok)break;}catch{}}
    if(server.exitCode!==null||Date.now()>deadline)throw Error('Label-resize demo server startup timeout');await new Promise(resolve=>setTimeout(resolve,150));
  }
  browser=await puppeteer.launch({headless:'shell',protocolTimeout:30000});await mkdir('test-artifacts',{recursive:true});
  const flow=await fixture('approval-rejection-rework','ApproveFlow'),timer=await fixture('booking-timeout-compensation','FlightTimeout'),short=await fixture('approval-rejection-rework','ApproveFlow',{text:'Approved',width:140});
  const specs=[];
  for(const zoom of [.65,1.4])for(const dir of ['e','w'])specs.push({name:`condition-${dir}-${zoom}`,xml:flow,id:'ApproveFlow',dir,zoom});
  for(const dir of ['e','w'])specs.push({name:`timer-${dir}`,xml:timer,id:'FlightTimeout',dir,zoom:.9});
  for(const dir of ['e','w'])specs.push({name:`minimum-${dir}`,xml:short,id:'ApproveFlow',dir,zoom:1,minimum:true});
  for(const dir of ['e','w'])specs.push({name:`minimum-control-${dir}`,xml:short,id:'ApproveFlow',dir,zoom:1,minimum:true,control:true});
  for(const spec of specs)for(const engine of ['upstream','local'])await run(spec.name,engine,spec.xml,spec.zoom,spec.id,async page=>{
    const first=await state(page,spec.id),amount=spec.minimum?first.visual.width+40:70,delta=spec.dir==='e'?-amount:amount;
    const cancelled=await resize(page,spec.id,engine,spec.dir,delta,{cancel:true,control:spec.control});assert.equal(cancelled.after.xml,cancelled.before.xml,'Escape restores exact XML/DI');assert.deepEqual(cancelled.after.history,cancelled.before.history,'Escape adds no command');
    const narrowed=await resize(page,spec.id,engine,spec.dir,delta,{control:spec.control});await checkCommit(page,narrowed.before,narrowed.after,narrowed.expectation);
    if(spec.minimum&&spec.control)assert.equal(narrowed.after.label.width,10,'Ctrl bypass gives the exact10px minimum without grid enlargement');
    else if(spec.minimum)assert.ok(narrowed.after.label.width>=10&&narrowed.after.label.width<20,'default minimum is constrained to the next10-unit grid edge');
    else assert.ok(narrowed.after.label.height>=narrowed.before.visual.height,'narrowing long text wraps into at least as much vertical space');
    const narrowHistory=await history(page,spec.id,engine,narrowed.before,narrowed.after),narrowReopen=await reopen(page,spec.id,narrowed.after);
    // A fresh actual import is allowed setup for the second independent edit.
    const widened=await resize(page,spec.id,engine,spec.dir,spec.dir==='e'?180:-180,{control:spec.control});await checkCommit(page,widened.before,widened.after,widened.expectation);
    assert.ok(widened.after.label.height<=widened.before.visual.height,'widening does not increase fitted text height');
    const wideHistory=await history(page,spec.id,engine,widened.before,widened.after),wideReopen=await reopen(page,spec.id,widened.after);
    return{cancelEvidence:cancelled.preview,narrowPreview:narrowed.preview,narrowExpectation:narrowed.expectation,narrowHistory,narrowReopen,wideExpectation:widened.expectation,wideHistory,wideReopen};
  });
  const authored=await fixture('approval-rejection-rework','ApprovedEnd',{authored:true});
  for(const engine of ['upstream','local'])await run('native-authored-label',engine,authored,.9,'ApprovedEnd',async page=>{
    await renameUnlabelled(page,'ApprovedEnd','Approved after travel review');const edited=await resize(page,'ApprovedEnd',engine,'e',80);await checkCommit(page,edited.before,edited.after,edited.expectation);
    return{expectation:edited.expectation,history:await history(page,'ApprovedEnd',engine,edited.before,edited.after),reopen:await reopen(page,'ApprovedEnd',edited.after)};
  });
  await run('no-op-and-history-interruption','local',flow,1,'ApproveFlow',async page=>{
    for(const dir of ['e','w']) {
      const click=await resize(page,'ApproveFlow','local',dir,0);assert.equal(click.after.xml,click.before.xml);assert.deepEqual(click.after.history,click.before.history,'stationary handle click adds no command');
      const back=await resize(page,'ApproveFlow','local',dir,55,{outAndBack:true});assert.equal(back.after.xml,back.before.xml);assert.deepEqual(back.after.history,back.before.history,'out-and-back adds no command or normalization');
    }
    const edited=await resize(page,'ApproveFlow','local','e',70);await checkCommit(page,edited.before,edited.after,edited.expectation);
    await selectLabel(page,'ApproveFlow','local');const from=await handle(page,'local','w');
    let interruptionEvidence;
    try{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(from.x+45,from.y,{steps:8});interruptionEvidence=await activeResize(page,'ApproveFlow','local',edited.after);await shortcut(page,'z');await page.mouse.up();}finally{await page.mouse.up().catch(()=>{});}
    const interrupted=await state(page,'ApproveFlow');assert.equal(interrupted.xml,edited.before.xml,'Undo during pending resize cancels preview then undoes the preceding command');
    await shortcut(page,'z',{shift:true});assert.equal((await state(page,'ApproveFlow')).xml,edited.after.xml,'mouse release after interruption adds no deferred command');
    return{before:edited.before.label,after:edited.after.label,interruptionEvidence};
  });
  await writeFile('test-artifacts/browser-label-resize-results.json',JSON.stringify({results},null,2));
  const failures=results.filter(r=>r.status==='failed');assert.equal(failures.length,0,failures.map(r=>`${r.name} ${r.engine}: ${r.error}`).join('\n'));console.log(`PASS ${results.length} native label-resize engine cases`);
}finally{await browser?.close();if(server&&server.exitCode===null){const exited=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([exited,new Promise(resolve=>setTimeout(resolve,5000))]);}}
