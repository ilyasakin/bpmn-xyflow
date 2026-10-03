import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, order, basic;
before(async()=>{
  dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));
  [order,basic]=await Promise.all(['test/fixtures/scenarios/order-payment-delivery.bpmn','test/fixtures/bpmn/basic.bpmn'].map(file=>readFile(file,'utf8')));
});
after(()=>dom.cleanup());
async function create(minimap=false) {
  const m=new Modeler({container:dom.createContainer(1800,1152),fitViewOnInit:false,palette:false,editorActions:false,minimap});
  const svg=m.getSvg();svg.setAttribute('width','1800');svg.setAttribute('height','1152');
  // Happy DOM has no CSS/SVG viewport layout. Supply only the known root box
  // and its translation; leave installed d3 wheel/transform math unchanged.
  svg.getBoundingClientRect=()=>({x:0,y:48,left:0,top:48,width:1800,height:1152,right:1800,bottom:1200});
  svg.getScreenCTM=()=>svg.createSVGMatrix().translate(0,48);
  // Happy DOM's SVGPoint omits matrixTransform; supply the standard affine
  // point operation needed by d3.pointer, using all six matrix coefficients.
  svg.createSVGPoint=()=>({x:0,y:0,matrixTransform(matrix){return {x:matrix.a*this.x+matrix.c*this.y+matrix.e,y:matrix.b*this.x+matrix.d*this.y+matrix.f};}});
  await m.importXML(order);return m;
}
const near=(a,b,message)=>{for(const key of ['x','y','zoom'])assert.ok(Math.abs(a[key]-b[key])<1e-8,`${message} ${key}: ${a[key]} vs ${b[key]}`);};
const history=m=>({size:m.commandStack.size(),undo:m.canUndo(),redo:m.canRedo()});
function wheel(m,point,deltaY=180) {
  const svg=m.getSvg(),before=m.getViewport(),events=[];
  const unbind=m.on('viewport.change',({viewport})=>events.push(viewport));
  // Invoke the actual installed wheel entry, not a replacement handler.
  // Happy DOM's WheelEvent dispatch does not implement Chrome's wheel path.
  const event=new window.MouseEvent('wheel',{bubbles:true,cancelable:true,clientX:point.x,clientY:point.y,ctrlKey:true,button:0,view:window});
  Object.defineProperties(event,{deltaY:{value:deltaY},deltaMode:{value:0},target:{value:svg},currentTarget:{value:svg}});
  const entry=svg.__on.find(item=>item.type==='wheel');assert.ok(entry);
  try{entry.value.call(svg,event);}finally{unbind();}
  const zoom=before.zoom*2**(-deltaY*.002),px=point.x,py=point.y-48;
  const expected={x:px-(px-before.x)*zoom/before.zoom,y:py-(py-before.y)*zoom/before.zoom,zoom};
  assert.equal(events.length,1,'the immediate wheel invokes its live Viewer callback exactly once');
  near(m.getViewport(),expected,'wheel remains centered at its delivered pointer');
  near(m.viewer._internals.panZoom.getViewport(),expected,'controller and public viewport agree');
  return m.getViewport();
}

test('immediate child-to-parent wheel retains live callbacks and pointer centering across Back',async()=>{
  const m=await create(true);
  try {
    await m.setViewport({x:160,y:120,zoom:.85});await m.drillInto(m.getElement('Payment'));
    await m.setViewport({x:-1165.921875,y:-1239,zoom:4});
    const controller=m.viewer._internals.panZoom,xml=await m.getXML(),stack=history(m);
    const child=wheel(m,{x:914,y:549}),gesture=m.getSvg().__zooming;assert.ok(gesture?.wheel,'the first wheel gesture is still pending');
    assert.equal(await m.navigateBack(),true);assert.equal(m.getGraph().diagram.plane.bpmnElement.id,'OrderCollaboration');
    assert.equal(m.getSvg().__zooming,gesture,'this test reaches the same unfinished wheel stream without an idle wait');
    near(m.getViewport(),{x:160,y:120,zoom:.85},'Back restores parent camera');
    const outer=wheel(m,{x:372,y:533});
    assert.equal(m.viewer._internals.panZoom,controller,'one controller belongs to the unchanged SVG');
    await m.drillInto(m.getElement('Payment'));near(m.getViewport(),child,'child camera retains its earlier wheel');
    wheel(m,{x:914,y:549},-60);await m.navigateBack();near(m.getViewport(),outer,'parent camera retains its earlier wheel');
    assert.equal(await m.getXML(),xml);assert.deepEqual(history(m),stack);
    assert.equal(m.getContainer().querySelectorAll('.bpmn-xyflow-minimap').length,1);
  }finally{m.destroy();}
});

test('history root activation during a live wheel preserves exact commands, graph identities and latest cameras',async()=>{
  const m=await create();
  try {
    await m.drillInto(m.getElement('Payment'));await m.navigateBack();const baseline=await m.getXML();
    const outer=m.getGraph();m.updateLabel(m.getElement('ValidateOrder'),'Outer wheel history');const one=await m.getXML();
    await m.drillInto(m.getElement('Payment'));const child=m.getGraph();m.updateLabel(m.getElement('CapturePayment'),'Child wheel history');const two=await m.getXML();
    await m.setViewport({x:33,y:-55,zoom:1.1});const childCamera=wheel(m,{x:680,y:490});
    assert.equal(m.undo(),true);assert.equal(m.getGraph(),child);assert.equal(await m.getXML(),one);
    assert.equal(m.undo(),true);assert.equal(m.getGraph(),outer);assert.equal(await m.getXML(),baseline);
    const parentCamera=wheel(m,{x:450,y:450});
    assert.equal(m.redo(),true);assert.equal(m.getGraph(),outer);assert.equal(await m.getXML(),one);
    assert.equal(m.redo(),true);assert.equal(m.getGraph(),child);assert.equal(await m.getXML(),two);
    near(m.getViewport(),childCamera,'history restores latest child camera');
    wheel(m,{x:600,y:520});await m.navigateBack();near(m.getViewport(),parentCamera,'history retains latest outer camera');
    assert.equal(m.commandStack.size(),2);
  }finally{m.destroy();}
});

test('reimport and clear reuse only their own SVG controller while minimap and destroy stay scoped',async()=>{
  const m=await create(true),other=await create(true);
  try {
    const controller=m.viewer._internals.panZoom,otherController=other.viewer._internals.panZoom,otherXml=await other.getXML();
    await m.setViewport({x:80,y:70,zoom:1});wheel(m,{x:600,y:400});
    await m.importXML(basic);assert.equal(m.viewer._internals.panZoom,controller);
    const xml=await m.getXML();wheel(m,{x:650,y:430});assert.equal(await m.getXML(),xml);
    assert.equal(m.commandStack.size(),0);assert.equal(m.canNavigateBack(),false);
    m.viewer.clear();assert.equal(m.getGraph(),null);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-minimap'),null);
    await m.importXML(basic);assert.equal(m.viewer._internals.panZoom,controller);assert.equal(m.getContainer().querySelectorAll('.bpmn-xyflow-minimap').length,1);
    wheel(m,{x:650,y:430});
    assert.equal(other.viewer._internals.panZoom,otherController);assert.equal(await other.getXML(),otherXml);
    const svg=m.getSvg();m.destroy();assert.equal(svg.isConnected,false);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-minimap'),null);
    await other.setViewport({x:0,y:0,zoom:1});wheel(other,{x:700,y:420});assert.equal(await other.getXML(),otherXml);
  }finally{m.destroy();other.destroy();}
});
