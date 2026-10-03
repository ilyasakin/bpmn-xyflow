import assert from 'node:assert/strict';
import { after,test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { setupDOM } from '../helpers/dom.mjs';
const dom=await setupDOM(),{default:Viewer}=await dom.loadModule('/lib/Viewer.js'),{default:Modeler}=await dom.loadModule('/lib/Modeler.js');
const require=createRequire(import.meta.url),upstreamRequire=createRequire(require.resolve('bpmn-js/package.json'));
const {default:InteractionEvents}=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/features/interaction-events/InteractionEvents.js'));
const {default:EventBus}=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/core/EventBus.js'));
const {default:Styles}=await dom.loadModule(upstreamRequire.resolve('diagram-js/lib/draw/Styles.js'));
const {isFrameElement,getShapePaintOrder}=await dom.loadModule('/lib/util/PaintOrder.js');
const hitStyles=new Map(),styles=new Styles();
const events=new InteractionEvents(new EventBus(),{},{cls(names,traits,attrs){hitStyles.set(names,attrs);return styles.cls(names,traits,attrs);}});
const ns='http://www.w3.org/2000/svg';
after(()=>dom.cleanup());
test('shape and external-label hit geometry matches real pinned InteractionEvents boxes',async()=>{
 const viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:false});
 try{
  await viewer.importXML(await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn','utf8'));
  const before=(await viewer.getModdle().toXML(viewer.getDefinitions(),{format:true})).xml;
  for(const node of viewer.getGraph().nodes.filter(n=>!n.hidden&&n.width!==undefined)){
   const graphic=viewer._internals.elementGfx(node.id);if(!graphic)continue;
   const expected=events.createDefaultHit({...node,isFrame:isFrameElement(node)},document.createElementNS(ns,'g'));
   const hit=graphic.querySelector('.bpmn-xyflow-shape-hit');assert.ok(hit,node.id);
   for(const key of ['x','y','width','height'])assert.equal(hit.getAttribute(key),expected.getAttribute(key),`${node.id} ${key}`);
   assert.equal(Number(hit.getAttribute('stroke-width')),hitStyles.get(expected.getAttribute('class')).strokeWidth,'pinned default hit stroke (happy-dom does not preserve numeric SVG styles)');
   assert.equal(hit.getAttribute('pointer-events'),isFrameElement(node)?'stroke':'all');
   assert.equal(hit.getAttribute('vector-effect'),null);
   if(node.type!=='label'){viewer._internals.redrawShape(node);assert.equal(viewer._internals.elementGfx(node.id).querySelectorAll('.bpmn-xyflow-shape-hit').length,1);}
  }
  assert.equal((await viewer.getModdle().toXML(viewer.getDefinitions(),{format:true})).xml,before);assert.ok(!(await viewer.saveSVG()).svg.includes('data-bpmn-hit'));
 }finally{viewer.destroy();}
});
test('fresh Group, history and reopen use the same border-only semantic frame policy',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false});
 try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  const group=m.addShape('bpmn:Group',{x:250,y:250}),id=group.id;
  const assertHit=()=>{const g=m.viewer._internals.elementGfx(id),hit=g.querySelector('.bpmn-xyflow-shape-hit');assert.equal(hit.getAttribute('pointer-events'),'stroke');return hit.getAttribute('width');};
  const width=assertHit();const order=()=>getShapePaintOrder(m.getGraph().nodes).map(n=>n.id);
  const beforeOrder=order(),xml=await m.getXML();m.undo();assert.equal(m.getElement(id),null);m.redo();assert.equal(assertHit(),width);
  await m.importXML(xml);assert.equal(assertHit(),width);assert.deepEqual(order(),beforeOrder);
  m.viewer._internals.redrawShape(m.getElement(id));assert.equal(assertHit(),width);
 }finally{m.destroy();}
});
test('current semantic type overrides stale or absent frame hints with the normal-modeling foreground frame rank',()=>{
 const group={id:'g',type:'bpmn:Group'},task={id:'t',type:'bpmn:Task'},stale={id:'a',type:'bpmn:TextAnnotation',isFrame:true};
 assert.equal(isFrameElement(group),true);assert.equal(isFrameElement(stale),false);
 assert.equal(isFrameElement({type:'label',businessObject:{$type:'bpmn:Group'},isFrame:true}),false);
 assert.deepEqual(getShapePaintOrder([task,group,stale]).map(n=>n.id),['t','a','g']);
});
