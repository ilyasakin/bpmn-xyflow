import assert from 'node:assert/strict';
import { test,before,after } from 'node:test';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom,Modeler,externalLabelResizeBounds,layoutExternalLabelBounds;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));({externalLabelResizeBounds,layoutExternalLabelBounds}=await dom.loadModule('/lib/modeling/ExternalLabelResize.js'));});
after(async()=>dom.cleanup());
const bounds=node=>({x:node.x,y:node.y,width:node.width,height:node.height});
let artifact=0;
async function valid(m){const xml=await m.getXML();if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`label-resize-${++artifact}.bpmn`),xml);}const parsed=await new BpmnModdle().fromXML(xml);assert.deepEqual(parsed.warnings,[]);return parsed;}
async function editor(id='ApproveFlow',{explicit=true,authored=false}={}){
 const callbacks=new WeakMap(),restore=[];
 for(const target of [dom.window.HTMLElement.prototype,dom.window.SVGElement.prototype,window]){const add=target.addEventListener,remove=target.removeEventListener;target.addEventListener=function(type,callback,options){const all=callbacks.get(this)||[];all.push({type,callback});callbacks.set(this,all);return add.call(this,type,callback,options);};target.removeEventListener=function(type,callback,options){callbacks.set(this,(callbacks.get(this)||[]).filter(entry=>entry.type!==type||entry.callback!==callback));return remove.call(this,type,callback,options);};restore.push(()=>{target.addEventListener=add;target.removeEventListener=remove;});}
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false});m.getSvg().getBoundingClientRect=m.getContainer().getBoundingClientRect;
 let xml=await readFile('test/fixtures/scenarios/approval-rejection-rework.bpmn','utf8');
 if(explicit){const re=new RegExp(`(<bpmndi:BPMN(?:Shape|Edge)\\b[^>]*bpmnElement="${id}"[^>]*>)([\\s\\S]*?)(</bpmndi:BPMN(?:Shape|Edge)>)`);assert.ok(re.test(xml));xml=xml.replace(re,(_,open,inside,close)=>`${open}${inside}<bpmndi:BPMNLabel xmlns:v="urn:label-resize-test" id="ResizeLabelDI" v:note="keep"><dc:Bounds x="500.25" y="500.5" width="170.5" height="20.25"><!--precise bounds--></dc:Bounds></bpmndi:BPMNLabel>${close}`);}
 await m.importXML(xml);const owner=m.getElement(id);
 if(authored)m.updateLabel(owner,'Authored external label with several words that need wrapping');
 const call=(node,type,event={},name)=>{const ev={target:node,button:0,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...event};const entries=(callbacks.get(node)||[]).filter(entry=>entry.type===type&&(!name||entry.callback.name===name));assert.ok(entries.length,`${type} ${name||''}`);for(const {callback}of entries)callback.call(node,ev);};
 const screen=point=>{const v=m.getViewport(),r=m.getContainer().getBoundingClientRect();return{clientX:r.left+v.x+point.x*v.zoom,clientY:r.top+v.y+point.y*v.zoom};};
 let start;
 return{m,owner,call,begin(dir){m.select(owner.label.id);const label=owner.label;start={x:label.x+(dir==='e'?label.width:0),y:label.y+label.height/2};const handle=m.getContainer().querySelector(`[data-resize-dir="${dir}"]`);assert.ok(handle);call(m.getSvg(),'mousedown',{target:handle,...screen(start)},'onMouseDown');},move(delta){call(window,'mousemove',screen({x:start.x+delta,y:start.y}),'onMouseMove');},end(){call(window,'mouseup',{},'onMouseUp');},close(){m.destroy();restore.reverse().forEach(fn=>fn());}};
}

for(const id of ['ApprovedEnd','ApprovalDecision','ApproveFlow'])test(`imported ${id} label exposes e/w and resizes only its bounds with exact metadata/undo`,async()=>{
 const h=await editor(id),{m,owner}=h;
 try{
  m.setViewport({x:120,y:75,zoom:.65});m.select(owner.label.id);assert.deepEqual([...m.getContainer().querySelectorAll('[data-resize-dir]')].map(node=>node.dataset.resizeDir),['e','w']);
  const label=owner.label,oldDi=owner.di.label,oldNodeDi=label.di,oldBounds=oldDi.bounds,original=await m.getXML(),count=m.commandStack.size(),originalGraph=bounds(label);
  const ownerBounds=owner.waypoints?owner.waypoints.map(p=>({x:p.x,y:p.y})):bounds(owner);
  h.begin('e');h.move(-90);h.end();const expected=layoutExternalLabelBounds({...label,...originalGraph},externalLabelResizeBounds(originalGraph,'e',-90),m.viewer._internals.renderer.textRenderer);
  assert.deepEqual(bounds(label),expected);assert.deepEqual(bounds(owner.di.label.bounds),expected);assert.equal(owner.di.label.$attrs['v:note'],'keep');assert.ok((await m.getXML()).includes('<!--precise bounds-->'));
  assert.deepEqual(owner.waypoints?owner.waypoints.map(p=>({x:p.x,y:p.y})):bounds(owner),ownerBounds);assert.equal(m.commandStack.size(),count+1);
  const edited=await m.getXML(),parsed=await valid(m);assert.ok(parsed.elementsById.ResizeLabelDI);
  const oracle=new BpmnModdle(),baseline=await oracle.fromXML(original);Object.assign(baseline.elementsById.ResizeLabelDI.bounds,expected);
  assert.equal((await oracle.toXML(parsed.rootElement,{format:true})).xml,(await oracle.toXML(baseline.rootElement,{format:true})).xml,'the entire document changes only selected label bounds');
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),original);assert.equal(owner.di.label,oldDi);assert.equal(owner.di.label.bounds,oldBounds);assert.equal(label.di,oldNodeDi);assert.deepEqual(bounds(label),originalGraph);m.redo();assert.equal(await m.getXML(),edited);}
  await m.importXML(edited);assert.deepEqual(bounds(m.getElement(id).di.label.bounds),expected);await valid(m);
 }finally{h.close();}
});

test('label resize cancellation, zero movement and out/back preserve absent imported DI and history',async()=>{
 const h=await editor('ApprovalDecision',{explicit:false}),{m,owner}=h;
 try{
  const label=owner.label,oldNodeDi=label.di,original=await m.getXML(),count=m.commandStack.size(),oldBounds=bounds(label);assert.equal(owner.di.label,undefined);
  for(const mode of ['zero','back','cancel','escape','blur']){h.begin('w');if(mode!=='zero')h.move(75.25);if(mode==='back')h.move(0);if(mode==='cancel')m.cancel();if(mode==='escape')h.call(window,'keydown',{key:'Escape'},'onWindowKeyDown');if(mode==='blur')h.call(window,'blur',{},'onWindowBlur');h.end();assert.equal(await m.getXML(),original,mode);assert.equal(m.commandStack.size(),count);assert.deepEqual(bounds(label),oldBounds);assert.equal(label.di,oldNodeDi);}
  h.begin('w');h.move(1000);h.end();assert.equal(label.width,10);assert.ok(label.height>=0);assert.equal(owner.di.label.bounds.width,10);const edited=await m.getXML();m.undo();assert.equal(await m.getXML(),original);m.redo();assert.equal(await m.getXML(),edited);await valid(m);
 }finally{h.close();}
});

test('authored label DI, API resize, command interruption, invalid bounds and owner geometry stay isolated',async()=>{
 const h=await editor('ApprovedEnd',{explicit:false,authored:true}),{m,owner}=h;
 try{
  const label=owner.label;assert.equal(label.di,owner.di.label);const original=await m.getXML(),count=m.commandStack.size(),ownerBounds=bounds(owner),graph=bounds(label);
  assert.equal(m.resizeShape(label,{...graph,width:NaN}),false);assert.equal(m.resizeShape(label,{...graph,width:0}),false);assert.equal(await m.getXML(),original);assert.equal(m.commandStack.size(),count);
  m.resizeShape(label,{...graph,width:graph.width+70.4});const after=await m.getXML();assert.equal(label.width,Math.round(graph.width+70.4));assert.deepEqual(bounds(owner),ownerBounds);m.undo();assert.equal(await m.getXML(),original);m.redo();assert.equal(await m.getXML(),after);
  h.begin('e');h.move(-40);m.undo();h.end();assert.equal(await m.getXML(),original,'Undo cancels preview then undoes the committed resize');m.redo();assert.equal(await m.getXML(),after);await valid(m);
  m.clearSelection();assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null);m.select(owner.id);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null,'event owner remains nonresizable');
  h.begin('w');h.move(45);await m.importXML(original);h.end();assert.equal(m.getContainer().querySelector('.bpmn-xyflow-resize-handles'),null);assert.equal(m.commandStack.size(),0);assert.deepEqual(m.getSelection(),[]);assert.equal(m.resizeShape(label,{...graph,width:110}),false,'old label object is stale after import');
 }finally{h.close();}
});
