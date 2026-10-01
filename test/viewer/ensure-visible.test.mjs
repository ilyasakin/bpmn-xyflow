import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setupDOM} from '../helpers/dom.mjs';
const dom=await setupDOM(),require=createRequire(import.meta.url),up=createRequire(require.resolve('bpmn-js/package.json'));
const {default:Canvas}=await dom.loadModule(up.resolve('diagram-js/lib/core/Canvas.js'));
const {ensureVisibleViewport}=await dom.loadModule('/lib/util/ViewportUtil.js');
const {default:Modeler}=await dom.loadModule('/lib/Modeler.js');
after(()=>dom.cleanup());
function oracle(bounds,width,height,viewport){
 const root={},canvas=Object.create(Canvas.prototype);let delta={dx:0,dy:0};
 Object.assign(canvas,{_resolveElements:()=>[bounds],findRoot:()=>root,getRootElement:()=>root,
  viewbox:()=>({x:-viewport.x/viewport.zoom,y:-viewport.y/viewport.zoom,width:width/viewport.zoom,height:height/viewport.zoom}),
  zoom:()=>viewport.zoom,scroll:value=>{delta=value;}});
 canvas.scrollToElement(bounds);
 return{x:viewport.x+delta.dx,y:viewport.y+delta.dy,zoom:viewport.zoom};
}
function near(a,b){for(const key of ['x','y','zoom'])assert.ok(Math.abs(a[key]-b[key])<1e-8,`${key}: ${a[key]} vs ${b[key]}`);}
test('minimal pan matches actual pinned Canvas.scrollToElement across scale, corners and oversized elements',()=>{
 for(const zoom of [.2,.65,1,3])for(const [x,y,w,h] of [[0,0,100,40],[300,250,100,40],[1500,900,100,40],[-500,900,100,40],[1500,-400,100,40],[-500,-400,100,40],[100,100,1400,1200],[100,100,1000,600]]){
  const bounds={x,y,width:w,height:h},v={x:121.25,y:-46.75,zoom};
  near(ensureVisibleViewport(bounds,1200,800,v),oracle(bounds,1200,800,v));
 }
});
test('chrome safe area is equivalent to shrinking the reference canvas and preserves an already visible transform',()=>{
 const insets={left:140,top:45,right:12,bottom:196},v={x:100,y:50,zoom:.8},b={x:1300,y:900,width:100,height:40};
 const expected=oracle(b,1200-insets.left-insets.right,800-insets.top-insets.bottom,{...v,x:v.x-insets.left,y:v.y-insets.top});
 expected.x+=insets.left;expected.y+=insets.top;
 const next=ensureVisibleViewport(b,1200,800,v,insets);near(next,expected);near(ensureVisibleViewport(b,1200,800,next,insets),next);
 assert.equal(ensureVisibleViewport(b,100,100,v,{left:101}),null);assert.equal(ensureVisibleViewport({...b,x:NaN},1200,800,v),null);
});
const bounds=(x,y,width,height)=>({x,y,left:x,top:y,width,height,right:x+width,bottom:y+height});
test('private Viewer reveal respects measured chrome, changes only viewport and is isolated/idempotent',async()=>{
 const m=new Modeler({container:dom.createContainer(1188,762),fitViewOnInit:false,palette:true,minimap:true}),other=new Modeler({container:dom.createContainer(),fitViewOnInit:false});
 try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));await other.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  m.getContainer().querySelector('.bpmn-xyflow-palette').getBoundingClientRect=()=>bounds(10,10,118,420);
  const toolbar=m.getContainer().querySelector('.bpmn-xyflow-editor-actions');if(toolbar)toolbar.getBoundingClientRect=()=>bounds(150,10,400,34);
  m.setViewport({x:-600,y:-300,zoom:.8});m.select('Task_1');
  const before=await m.getXML(),history=m.commandStack.size(),selection=m.getSelection(),otherView=other.getViewport();
  const node=m.getElement('Task_1');assert.equal(m.viewer._internals.ensureElementVisible(node),true);
  const next=m.getViewport();assert.equal(next.zoom,.8);assert.notEqual(next.x,-600);
  assert.ok(node.x*.8+next.x>=228-1e-8);assert.ok(node.y*.8+next.y>=144-1e-8);
  assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),history);assert.deepEqual(m.getSelection(),selection);assert.deepEqual(other.getViewport(),otherView);
  m.viewer._internals.ensureElementVisible(node);assert.deepEqual(m.getViewport(),next);
  assert.equal(m.viewer._internals.ensureElementVisible('missing'),false);node.hidden=true;assert.equal(m.viewer._internals.ensureElementVisible(node),false);node.hidden=false;
  m.destroy();assert.equal(m.viewer._internals.ensureElementVisible(node),false);
 }finally{m.destroy();other.destroy();}
});
test('successful automatic append reveals its result with one command and exact XML history',async()=>{
 const m=new Modeler({container:dom.createContainer(1188,762),fitViewOnInit:false,palette:false});
 try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));m.setViewport({x:700,y:200,zoom:1});m.select('Task_1');
  const before=await m.getXML(),size=m.commandStack.size();
  const button=m.getContainer().querySelector('[data-action="append.append-task"]');assert.ok(button);button.click();
  const selected=m.getElement(m.getSelection()[0]);assert.notEqual(selected.id,'Task_1');
  assert.ok(selected.x+m.getViewport().x+selected.width<=1188-100+1e-8);assert.equal(m.getViewport().zoom,1);
  assert.equal(m.commandStack.size(),size+1);const edited=await m.getXML();m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),edited);
 }finally{m.destroy();}
});
