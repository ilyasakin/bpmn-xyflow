import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async()=>{dom=await setupDOM();({default:Modeler}=await dom.loadModule('/lib/Modeler.js'));});
after(async()=>dom.cleanup());
test('outside hover outline is visual-only and preserves exact docking, history and input regions',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,editorActions:false});
 try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));
  for(const [type,at] of [['bpmn:Task',{x:400,y:250}],['bpmn:EndEvent',{x:600,y:250}],['bpmn:ExclusiveGateway',{x:800,y:250}],['bpmn:ComplexGateway',{x:700,y:450}],['bpmn:ParallelGateway',{x:500,y:450}]]){
   const n=m.addShape(type,at),x=n.x+n.width,y=n.y+n.height/2;
   const gfx=m.getContainer().querySelector(`[data-element-id="${n.id}"]`);
   const polygon=gfx.querySelector(':scope > polygon');
   if(polygon) polygon.setAttribute('stroke-width','6');
   const before=await m.getXML(),history=m.commandStack.size(),v=m.getViewport();
   gfx.dispatchEvent(new window.PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:v.x+x*v.zoom,clientY:v.y+y*v.zoom}));
   const outline=m.getContainer().querySelector('.bpmn-xyflow-connect-outline');
   // EndEvent has no outgoing SequenceFlow, but can still originate an Association.
   assert.ok(outline,`eligible ${type} has visual feedback`);
   assert.equal(outline.getAttribute('pointer-events'),'none');
   assert.equal(Number(outline.getAttribute('data-preview-gap')),2.5);
   if(polygon) {
    const top=Number(outline.getAttribute('d').match(/^M[^,]+,([^lL]+)/)[1]);
    assert.ok(Math.abs(top-(n.y-(3+3/v.zoom)*Math.SQRT2))<1e-9,'marked gateway outline uses the outer polygon border, not its icon');
   }
   const marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point');
   assert.deepEqual([Number(marker.getAttribute('cx')),Number(marker.getAttribute('cy'))],[x,y]);
   const fixed=[...m.getContainer().querySelectorAll('.bpmn-xyflow-connect-fixed-anchor')];
   assert.equal(fixed.length,type.endsWith('Gateway')?4:0);
   if(fixed.length) assert.deepEqual(fixed.map(e=>[Number(e.getAttribute('cx')),Number(e.getAttribute('cy'))]),[[n.x+n.width/2,n.y],[n.x+n.width,n.y+n.height/2],[n.x+n.width/2,n.y+n.height],[n.x,n.y+n.height/2]]);
   for(const e of fixed) assert.equal(e.getAttribute('pointer-events'),'visiblePainted');
   const hit=m.getContainer().querySelector('.bpmn-xyflow-connect-hit');
   assert.equal(Number(hit.getAttribute('r')),5.75/v.zoom,'visual expansion does not enlarge hit region');
   assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),history);
   m.getSvg().dispatchEvent(new window.PointerEvent('pointerleave',{bubbles:false,pointerType:'mouse',clientX:-1,clientY:-1}));
   assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-outline'),null);
  }
 }finally{m.destroy();}
});
