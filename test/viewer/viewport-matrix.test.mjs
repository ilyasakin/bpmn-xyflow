import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {setupDOM} from '../helpers/dom.mjs';
const dom=await setupDOM(),require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json'));
const {default:Viewer}=await dom.loadModule('/lib/Viewer.js');
const {default:Canvas}=await dom.loadModule(up.resolve('diagram-js/lib/core/Canvas.js'));
after(()=>dom.cleanup());
const keys=['a','b','c','d','e','f'];
function matrix(g){const t=g.transform.baseVal.consolidate();assert.ok(t);return Object.fromEntries(keys.map(k=>[k,t.matrix[k]]));}
test('programmatic viewport uses actual pinned Canvas numeric matrix construction and preserves public coordinates',async()=>{
 const viewer=new Viewer({container:dom.createContainer(1200,800),fitViewOnInit:false});
 try{
  await viewer.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  const before=(await viewer.getModdle().toXML(viewer.getDefinitions(),{format:true})).xml;
  for(const zoom of [.2,.65,.9,1,1.4,3])for(const offset of [{x:140,y:100},{x:-127.25,y:53.75}]){
   const viewport={...offset,zoom};await viewer.setViewport(viewport,{duration:0});
   const g=document.createElementNS('http://www.w3.org/2000/svg','g'),reference=Object.create(Canvas.prototype);
   // happy-dom lacks this SVGTransformList factory; delegate to its equivalent
   // native SVGSVGElement factory without replacing matrix calculations.
   g.transform.baseVal.createSVGTransformFromMatrix=value=>viewer.getSvg().createSVGTransformFromMatrix(value);
   Object.assign(reference,{_svg:viewer.getSvg(),_viewport:g,getSize:()=>({width:1200,height:800}),_changeViewbox:fn=>fn.call(reference)});
   reference.viewbox({x:-offset.x/zoom,y:-offset.y/zoom,width:1200/zoom,height:800/zoom});
   const actual=matrix(viewer._internals.viewport),expected=matrix(g);
   for(const key of keys)assert.ok(Math.abs(actual[key]-expected[key])<1e-12,`${zoom} ${key}: ${actual[key]} vs ${expected[key]}`);
   assert.equal(viewer._internals.viewport.transform.baseVal.numberOfItems,1,'one native matrix, not a reparsed translate/scale list');
   assert.deepEqual(viewer.getViewport(),viewport);
  }
  assert.equal((await viewer.getModdle().toXML(viewer.getDefinitions(),{format:true})).xml,before,'view changes do not mutate XML');
 }finally{viewer.destroy();}
});
test('fit, repeated import and standalone export keep matrix changes confined to the viewport',async()=>{
 const viewer=new Viewer({container:dom.createContainer(),fitViewOnInit:true});
 try{
  const xml=await readFile('test/fixtures/bpmn/basic.bpmn','utf8');
  for(let i=0;i<2;i++){await viewer.importXML(xml);viewer.fitView();assert.equal(viewer._internals.viewport.transform.baseVal.numberOfItems,1);assert.ok(keys.every(k=>Number.isFinite(matrix(viewer._internals.viewport)[k])));}
  const exported=(await viewer.saveSVG()).svg;assert.ok(!exported.includes('data-bpmn-hit'));
  const doc=new DOMParser().parseFromString(exported,'image/svg+xml'),viewport=doc.querySelector('.bpmn-xyflow-viewport');assert.equal(viewport.getAttribute('transform'),null);
 }finally{viewer.destroy();}
});
