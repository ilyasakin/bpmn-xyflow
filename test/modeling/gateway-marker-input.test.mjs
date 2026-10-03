/** Registered full DOM propagation; native hit testing is a separate gate. */
import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {setupDOM} from '../helpers/dom.mjs';
let dom,Modeler,xml;
before(async()=>{dom=await setupDOM();
 // Happy DOM lacks these browser CSS named-property aliases used by tiny-svg.
 for(const name of ['pointer-events','stroke-width'])Object.defineProperty(window.CSSStyleDeclaration.prototype,name,{configurable:true,get(){return this.getPropertyValue(name);},set(value){this.setProperty(name,value);}});
 ({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));xml=await readFile('test/fixtures/bpmn/basic.bpmn','utf8');});
after(()=>dom.cleanup());
const xy=p=>({x:p.x,y:p.y});
const vertices=n=>[{x:n.x+n.width/2,y:n.y},{x:n.x+n.width,y:n.y+n.height/2},{x:n.x+n.width/2,y:n.y+n.height},{x:n.x,y:n.y+n.height/2}];
async function fixture(zoom,selected,type='ExclusiveGateway'){
 const c=dom.createContainer(1200,900),m=new Modeler({container:c,fitViewOnInit:false,palette:false,editorActions:false,snap:false});await m.importXML(xml);
 const source=m.addShape('bpmn:'+type,{x:450,y:250}),targets=[m.addShape('bpmn:Task',{x:450,y:50}),m.addShape('bpmn:Task',{x:700,y:250}),m.addShape('bpmn:Task',{x:450,y:450}),m.addShape('bpmn:Task',{x:200,y:250})];
 m.getSvg().getBoundingClientRect=()=>c.getBoundingClientRect();window.innerWidth=1200;window.innerHeight=900;
 await m.setViewport({x:600-450*zoom,y:450-250*zoom,zoom});m.select(selected?source.id:[]);
 const gfx=n=>m.viewer._internals.elementGfx(n.id),oldHits=document.elementsFromPoint;let hit=null;document.elementsFromPoint=()=>hit?[hit]:[];
 const screen=p=>{const v=m.getViewport();return{x:v.x+p.x*v.zoom,y:v.y+p.y*v.zoom};};
 const event=(kind,node,p,buttons=0,client)=>{const at=client||screen(p);node.dispatchEvent(new window.PointerEvent('pointer'+kind,{bubbles:true,cancelable:true,pointerType:'mouse',pointerId:1,button:0,buttons,clientX:at.x,clientY:at.y}));node.dispatchEvent(new window.MouseEvent('mouse'+kind,{bubbles:true,cancelable:true,button:0,buttons,clientX:at.x,clientY:at.y}));};
 const readPoint=selector=>{const e=c.querySelector(selector);return e?{x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))}:null;};
 let lastPress;
 const prime=()=>event('move',gfx(source),{x:source.x+source.width/2,y:source.y+source.height/2});
 const marker=index=>c.querySelector(`.bpmn-xyflow-connect-fixed-anchor[data-anchor-index="${index}"]`);
 const snapshot=async()=>({xml:await m.getXML(),history:m.commandStack.snapshot(),selection:m.getSelection(),viewport:m.getViewport(),bounds:{x:source.x,y:source.y,width:source.width,height:source.height}});
 const unchanged=async before=>assert.deepEqual(await snapshot(),before);
 return{m,c,source,targets,gfx,event,prime,marker,readPoint,snapshot,unchanged,
  move(p,node=m.getSvg(),buttons=1){hit=node;event('move',node,p,buttons);},
  press(index){const at=vertices(source)[index],e=marker(index);assert.ok(e);lastPress=screen(at);event('down',e,at,1,lastPress);},
  moveCss(delta){hit=m.getSvg();event('move',hit,null,1,{x:lastPress.x+delta,y:lastPress.y});},
  release(p,node=m.getSvg()){hit=node;event('up',node,p);},
  cancel(){m.getSvg().dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));},
  close(){document.elementsFromPoint=oldHits;m.destroy();c.remove();}
 };
}

test('all four painted Gateway markers own direct presses independent of current grab at low/high zoom',async()=>{
 for(const zoom of [.2,.578704,1,2,4])for(const selected of [false,true]){
  const h=await fixture(zoom,selected),{m,source}=h;
  try{for(let index=0;index<4;index++){
   h.prime();const marker=h.marker(index),at=vertices(source)[index],before=await h.snapshot();
   assert.equal(marker.getAttribute('pointer-events'),'visiblePainted');assert.equal(marker.style.getPropertyValue('pointer-events'),'visiblePainted');
   assert.equal(Number(marker.getAttribute('r'))*zoom,2);assert.equal(parseFloat(marker.style.getPropertyValue('stroke-width'))*zoom,1);
   assert.match(marker.getAttribute('aria-label'),/Drag to connect from (top|right|bottom|left) Gateway vertex/);
   // Deliberately skip hover/move onto this marker: the current grab may name
   // another vertex. The pressed index alone must select the exact start.
   h.press(index);assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'),'no active connection preview');await h.unchanged(before);
   h.moveCss(3);assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'),'no active connection preview');await h.unchanged(before);
   h.moveCss(5);assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'),'no active connection preview');await h.unchanged(before);
   h.release(at,h.gfx(source));await h.unchanged(before);
   // Immediate retry from the same fixed marker keeps the intended origin.
   h.press(index);const target=h.targets[index],end={x:target.x+target.width/2,y:target.y+target.height/2};h.move(end,h.gfx(target));
   const preview=h.c.querySelector('.bpmn-xyflow-connect-preview path');assert.ok(preview);assert.ok(preview.getAttribute('d').startsWith(`M${at.x},${at.y}`));
   await h.unchanged(before);h.cancel();await h.unchanged(before);
   h.prime();h.press(index);h.move(end,h.gfx(target));const d=h.c.querySelector('.bpmn-xyflow-connect-preview path').getAttribute('d');h.release(end,h.gfx(target));
   const edge=m.getGraph().edges.at(-1);assert.equal(edge.type,'bpmn:SequenceFlow');assert.ok(edge.source===source,'created edge retains exact source identity');assert.ok(edge.target===target,'created edge retains exact target identity');assert.deepEqual(xy(edge.waypoints[0]),at);
   assert.deepEqual({x:source.x,y:source.y,width:source.width,height:source.height},before.bounds);
   assert.equal(h.c.querySelector(`[data-element-id="${edge.id}"] .bpmn-xyflow-connection-visual`).getAttribute('d'),d);
   const after=await m.getXML();assert.equal(m.undo(),true);assert.equal(await m.getXML(),before.xml);assert.equal(m.redo(),true);assert.equal(await m.getXML(),after);assert.equal(m.undo(),true);
  }}finally{h.close();}
 }
});

test('moving across a different fixed marker updates the exact marked vertex without retaining the old grab',async()=>{
 const h=await fixture(.578704,false);try{h.prime();const before=await h.snapshot();
  for(const index of [1,2,3,0,3,1]){const at=vertices(h.source)[index];h.event('move',h.marker(index),at);assert.deepEqual(h.readPoint('.bpmn-xyflow-connect-docking-point'),at);await h.unchanged(before);}
 }finally{h.close();}
});

test('marker ownership does not replace Gateway body movement or actual Task resize and edge controls',async()=>{
 const h=await fixture(1,true),{m,source}=h;try{
  h.prime();const before=await h.snapshot(),center={x:source.x+25,y:source.y+25};h.event('down',h.gfx(source),center,1);h.move({x:center.x+40,y:center.y},h.gfx(source));assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'),'no active connection preview');h.release({x:center.x+40,y:center.y},h.gfx(source));assert.equal(source.x,before.bounds.x+40);m.undo();assert.equal(await m.getXML(),before.xml);
  const task=h.targets[1];m.select(task.id);h.event('move',h.gfx(source),vertices(source)[1]);const handles=h.c.querySelector('.bpmn-xyflow-connect-handle'),resize=h.c.querySelector('.bpmn-xyflow-resize-handles');
  assert.ok(resize);assert.ok([...handles.parentElement.children].indexOf(handles)<[...resize.parentElement.children].indexOf(resize),'actual resize paints/hits above source controls');
  const square=h.c.querySelector('.bpmn-xyflow-resize-handle[data-resize-dir="se"]'),corner={x:task.x+task.width,y:task.y+task.height},width=task.width;
  h.event('down',square,corner,1);h.move({x:corner.x+30,y:corner.y+20},m.getSvg());assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'),'no active connection preview');assert.ok(task.width>width);h.cancel();assert.equal(task.width,width);
  const edge=m.connect(source,h.targets[1]);assert.ok(edge);m.select(edge.id);h.event('move',h.gfx(source),vertices(source)[1]);const group=h.c.querySelector('.bpmn-xyflow-bendpoints'),create=h.c.querySelector('.bpmn-xyflow-connect-handle');
  assert.ok(group);assert.ok([...group.parentElement.children].indexOf(create)<[...group.parentElement.children].indexOf(group));
  const original=await m.getXML(),route=edge.waypoints.map(xy),endpoint=group.querySelector('.bpmn-xyflow-bendpoint-hit[data-bend-index="0"]');assert.ok(endpoint);
  h.event('down',endpoint,route[0],1);h.move(vertices(source)[0],h.gfx(source));assert.ok(!h.c.querySelector('.bpmn-xyflow-connect-preview'));
  assert.notDeepEqual(edge.waypoints.map(xy),route,'actual overlapping endpoint keeps its reconnect operation');h.cancel();assert.equal(await m.getXML(),original);
 }finally{h.close();}
});

test('each supported Gateway family starts the pressed vertex preview without altering model or history',async()=>{
 for(const type of ['ExclusiveGateway','ParallelGateway','InclusiveGateway','ComplexGateway','EventBasedGateway']){
  const h=await fixture(.578704,false,type);try{for(let index=0;index<4;index++){
   h.prime();const before=await h.snapshot(),at=vertices(h.source)[index];h.press(index);h.moveCss(6);
   const preview=h.c.querySelector('.bpmn-xyflow-connect-preview path');assert.ok(preview);assert.ok(preview.getAttribute('d').startsWith(`M${at.x},${at.y}`));
   h.cancel();await h.unchanged(before);
  }}finally{h.close();}
 }
});
