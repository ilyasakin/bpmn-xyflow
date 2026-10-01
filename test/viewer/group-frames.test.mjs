import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {setupDOM} from '../helpers/dom.mjs';
const dom=await setupDOM(),{default:Viewer}=await dom.loadModule('/lib/Viewer.js'),{default:Modeler}=await dom.loadModule('/lib/Modeler.js'),{default:Upstream}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js');
after(()=>dom.cleanup());
const fixture=()=>readFile('test/fixtures/group-native/overlap.bpmn','utf8');
const order=(container,ids)=>[...container.querySelectorAll('[data-element-id]')].filter(g=>ids.includes(g.getAttribute('data-element-id'))&&!g.classList.contains('djs-bendpoints')).map(g=>g.getAttribute('data-element-id'));
test('actual pinned Group creation places frame above flow; imported ordering is an explicit difference',async()=>{
 const m=new Upstream({container:dom.createContainer()});
 try{
  await m.importXML(await fixture());assert.deepEqual(order(m.get('canvas').getContainer(),['Source','Target','Frame','Flow']),['Source','Target','Frame','Flow']);
  const group=m.get('modeling').createShape({type:'bpmn:Group'},{x:1000,y:700},m.get('canvas').getRootElement());
  const ids=['Source','Target','Frame','Flow',group.id];assert.equal(order(m.get('canvas').getContainer(),ids).at(-1),group.id,'normal-modeling level10 is foreground');
 }finally{m.destroy();}
});
test('local frame layer remains above routes through import/redraw/restore and preserves border-only hits and SVG order',async()=>{
 const m=new Viewer({container:dom.createContainer(),fitViewOnInit:false});
 try{
  await m.importXML(await fixture());const frame=m.getElement('Frame');
  function verify(){const svg=m.getSvg(),frames=svg.querySelector('.bpmn-xyflow-frames'),connections=svg.querySelector('.bpmn-xyflow-connections'),labels=svg.querySelector('.bpmn-xyflow-labels');
   assert.ok(connections.compareDocumentPosition(frames)&4);assert.ok(frames.compareDocumentPosition(labels)&4);
   assert.equal(m._internals.elementGfx('Frame').parentNode,frames);assert.equal(m._internals.elementGfx('Frame').querySelector('[data-bpmn-hit]').getAttribute('pointer-events'),'stroke');
   assert.equal(svg.querySelectorAll('[data-element-id="Frame"]').length,1);
  }
  verify();m._internals.redrawShape(frame);verify();m._internals.removeElementGfx('Frame');m._internals.redrawShape(frame);verify();
  const xml=(await m.getModdle().toXML(m.getDefinitions())).xml;await m.importXML(xml);verify();
  const exported=(await m.saveSVG()).svg;assert.ok(exported.indexOf('bpmn-xyflow-connections')<exported.indexOf('bpmn-xyflow-frames'));assert.ok(exported.indexOf('bpmn-xyflow-frames')<exported.indexOf('bpmn-xyflow-labels'));assert.ok(!exported.includes('data-bpmn-hit'));
  m.clear();assert.equal(m.getSvg().querySelector('.bpmn-xyflow-frames').children.length,0);
 }finally{m.destroy();}
});
test('authored Group creation, undo/redo and reopened frame use the same foreground layer',async()=>{
 const m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false});
 try{
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));const node=m.addShape('bpmn:Group',{x:500,y:500}),id=node.id;
  const check=()=>{assert.equal(m.viewer._internals.elementGfx(id).parentNode,m.viewer._internals.frameLayer);assert.equal(m.viewer._internals.elementGfx(id).querySelector('[data-bpmn-hit]').getAttribute('pointer-events'),'stroke');};
  check();const xml=await m.getXML();m.undo();assert.equal(m.viewer._internals.elementGfx(id),null);m.redo();check();await m.importXML(xml);check();
 }finally{m.destroy();}
});
