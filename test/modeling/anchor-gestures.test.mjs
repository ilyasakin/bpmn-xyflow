/** Registered-handler coverage for AX-01/02/04/05/06/08/20/24/25/28.
 * Native discoverability and browser hit testing are covered separately. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, xml;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); xml = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'); });
after(async () => dom.cleanup());
async function fixture() {
  const listeners = new WeakMap(), restores = [];
  for (const target of [window, window.SVGElement.prototype, window.HTMLElement.prototype]) {
    const original = target.addEventListener;
    target.addEventListener = function(type, callback, options) {
      const list = listeners.get(this) || []; list.push({ type, callback, options }); listeners.set(this, list);
      return original.call(this, type, callback, options);
    };
    restores.push(() => { target.addEventListener = original; });
  }
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, editorActions: false, snap: false });
  await m.importXML(xml);
  let hit = null; const originalHit = document.elementsFromPoint;
  document.elementsFromPoint = () => hit ? [hit] : [];
  const gfx = node => m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
  const input = (point, target, extra = {}) => {
    const v = m.getViewport(); return { clientX: v.x + point.x * v.zoom, clientY: v.y + point.y * v.zoom, target, button: 0,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra };
  };
  const call = (target, type, event, name) => {
    const found = (listeners.get(target) || []).filter(item => item.type === type && (!name || item.callback.name === name));
    assert.ok(found.length, `registered ${type} ${name || ''}`); for (const { callback } of found) callback.call(target, event);
  };
  const port = () => m.getContainer().querySelector('.bpmn-xyflow-connect-handle');
  return { m, gfx, port,
    move(point, node) { hit = node?.nodeType ? node : node ? gfx(node) : null; call(window, 'mousemove', input(point, hit || m.getSvg()), 'onMouseMove'); },
    hover(point, node) { const target=node?.nodeType?node:gfx(node); call(m.getSvg(),'pointermove',input(point,target,{pointerType:'mouse'})); },
    press(point, extra = {}) { const handle = port(); assert.ok(handle, 'visible connection port'); const target=handle.querySelector('.bpmn-xyflow-connect-hit'); call(window,'pointerdown',input(point,target,{pointerId:1,type:'pointerdown',...extra}),'pointerDown'); const event=input(point,target,extra); call(m.getSvg(),'mousedown',event,'onMouseDown'); call(handle, 'mousedown', event); },
    controlPress(point,target) { call(m.getSvg(),'mousedown',input(point,target),'onMouseDown'); },
    shiftPress(point,node) { const target=gfx(node),event=input(point,target,{shiftKey:true,pointerId:1,type:'pointerdown'}); call(window,'pointerdown',event,'pointerDown'); call(m.getSvg(),'mousedown',event,'onMouseDown'); },
    bodyPress(point,node,extra={}) { const target=gfx(node),event=input(point,target,extra);call(window,'pointerdown',input(point,target,{pointerId:1,type:'pointerdown',...extra}),'pointerDown');call(m.getSvg(),'mousedown',event,'onMouseDown'); },
    up(point, node, extra={}) { hit = node ? gfx(node) : null; const target=hit||m.getSvg(); call(window,'pointerup',input(point,target,{pointerId:1,type:'pointerup',...extra}),'pointerEnd'); call(window, 'mouseup', input(point,target,extra), 'onMouseUp'); },
    blur() { call(window, 'blur', {}, 'onWindowBlur'); },
    key(key) { call(window, 'keydown', { key, preventDefault() {}, defaultPrevented: false }, 'onWindowKeyDown'); },
    close() { m.destroy(); restores.reverse().forEach(restore => restore()); document.elementsFromPoint = originalHit; }
  };
}
const xy = point => ({ x: point.x, y: point.y });
const portPoint = h => { const circle = h.port()?.querySelector('.bpmn-xyflow-connect-port'); assert.ok(circle); return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }; };
async function unchanged(m, before, count) { assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), count); }
async function history(m, before, after) { for (let i = 0; i < 3; i++) { assert.equal(m.undo(), true); assert.equal(await m.getXML(), before); assert.equal(m.redo(), true); assert.equal(await m.getXML(), after); } }

for (const selected of [false, true]) test(`AX-01/02: all four perimeter sides remain continuous, selected=${selected}`, async () => {
  const h = await fixture(), { m } = h;
  try {
    const source = m.getElement('Task_1');
    const target = m.addShape('bpmn:Task', { x: 750, y: 350 });
    for (const point of [{x:source.x+25,y:source.y}, {x:source.x+source.width,y:source.y+20}, {x:source.x+75,y:source.y+source.height}, {x:source.x,y:source.y+60}]) {
      m.select(selected ? source.id : []); const before = await m.getXML(), count = m.commandStack.size();
      h.move(point, source); assert.deepEqual(portPoint(h), point);
      const cue = m.getContainer().querySelector('.bpmn-xyflow-connect-outline'); assert.ok(cue); assert.equal(cue.style['pointer-events'], 'none');
      const end = { x: target.x, y: target.y + 25 };
      h.press(point); assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
      h.move(end, target); const preview = m.getContainer().querySelector('.bpmn-xyflow-connect-preview path'); assert.ok(preview);
      const docking = m.getContainer().querySelector('.bpmn-xyflow-connect-target'); assert.equal(docking.getAttribute('visibility'),'visible'); assert.deepEqual({x:Number(docking.getAttribute('cx')),y:Number(docking.getAttribute('cy'))},end);
      const path = preview.getAttribute('d'); h.up(end, target);
      const edge = m.getGraph().edges.at(-1); assert.ok(edge.source === source, "correct source identity"); assert.ok(edge.target === target, "correct target identity");
      assert.deepEqual(xy(edge.waypoints[0]), point); assert.deepEqual(xy(edge.waypoints.at(-1)), end);
      assert.equal(m.commandStack.size(), count + 1);
      const route = h.gfx(edge).querySelector(':scope > path:not(.bpmn-xyflow-connection-hit)').getAttribute('d'); assert.equal(route.replaceAll(' ', ''), path.replaceAll(' ', ''));
      const after = await m.getXML(); await history(m, before, after); m.undo();
    }
  } finally { h.close(); }
});

for (const zoom of [.5, 1, 2]) test(`AX-04/24: click, jitter and exact five CSS pixels do not activate at zoom ${zoom}`, async () => {
  const h = await fixture(), { m } = h;
  try {
    await m.setViewport({ x: 37, y: -21, zoom }); const source = m.getElement('Task_1'), start = {x:source.x,y:source.y+20};
    const before = await m.getXML(), count = m.commandStack.size();
    for (const distance of [0, 1, 4, 5]) {
      h.move(start, source); assert.equal(Number(h.port().querySelector('.bpmn-xyflow-connect-hit').getAttribute('r')) * zoom, 8);
      h.press(start); h.move({x:start.x+distance/zoom,y:start.y},source); h.up(start,source);
      assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview')); await unchanged(m,before,count);
    }
  } finally { h.close(); }
});

test('AX-05: deliberate activated same-anchor loops remain visible, valid and undoable', async () => {
  const h = await fixture(), { m } = h;
  try {
    const source = m.getElement('Task_1'), start = {x:source.x+source.width,y:source.y+20};
    const before=await m.getXML(),count=m.commandStack.size(); h.move(start,source);h.press(start);h.move({x:start.x+30,y:start.y},null);h.move(start,source);
    const preview=m.getContainer().querySelector('.bpmn-xyflow-connect-preview path'); assert.ok(preview);const path=preview.getAttribute('d');
    assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-context-pad'),'activated loop is not obscured by the source context pad');h.up(start,source);
    const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===source,"loop source identity");assert.ok(edge.target===source,"loop target identity");assert.equal(edge.type,'bpmn:SequenceFlow');
    assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-context-pad'),'release does not cover the committed loop');assert.ok(edge.waypoints.length>=4);assert.ok(edge.waypoints.some(p=>Math.hypot(p.x-start.x,p.y-start.y)>20));assert.equal(m.commandStack.size(),count+1);
    assert.equal(h.gfx(edge).querySelector(':scope > path:not(.bpmn-xyflow-connection-hit)').getAttribute('d').replaceAll(' ',''),path.replaceAll(' ',''));
    const after=await m.getXML();assert.deepEqual((await new BpmnModdle().fromXML(after)).warnings,[]);await history(m,before,after);
  } finally { h.close(); }
});

test('AX-02/09/10: ports follow rounded corners, event circles and diamond sides', async () => {
  const h=await fixture(),{m}=h;
  try {
    const task=m.getElement('Task_1'),event=m.getElement('StartEvent_1'),gateway=m.addShape('bpmn:ExclusiveGateway',{x:700,y:350});
    h.move({x:task.x,y:task.y},task);const corner=portPoint(h);assert.ok(corner.x>task.x&&corner.y>task.y);assert.ok(Math.abs(Math.hypot(corner.x-task.x-10,corner.y-task.y-10)-10)<1e-8);
    h.move({x:event.x+3,y:event.y+3},event);const circle=portPoint(h);assert.ok(Math.abs(Math.hypot(circle.x-event.x-18,circle.y-event.y-18)-18)<1e-8);
    h.move({x:gateway.x+8,y:gateway.y+8},gateway);const diamondMarker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'),diamond={x:Number(diamondMarker.getAttribute('cx')),y:Number(diamondMarker.getAttribute('cy'))};assert.ok(diamond.x>gateway.x&&diamond.y>gateway.y);assert.ok(Math.abs(Math.abs(diamond.x-gateway.x-25)+Math.abs(diamond.y-gateway.y-25)-25)<1e-8);
  } finally { h.close(); }
});

test('AX-06/20/26: pending and active cancellation, rejected drops and import leave exact state and reusable ports',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),start={x:source.x+source.width,y:source.y+20},invalid=m.getElement('StartEvent_1');
    const before=await m.getXML(),count=m.commandStack.size();
    for(const action of ['pendingEscape','activeEscape','blur','blank','invalid']){
      h.move(start,source);h.press(start);if(action!=='pendingEscape')h.move({x:start.x+45,y:start.y+45},null);
      if(action.endsWith('Escape'))h.key('Escape');else if(action==='blur')h.blur();else if(action==='blank')h.up({x:800,y:650},null);else h.up({x:invalid.x+18,y:invalid.y},invalid);
      await unchanged(m,before,count);assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
      h.move(start,source);assert.ok(h.port(),'the next hover remains usable');
    }
    h.press(start);h.move({x:start.x+45,y:start.y+45},null);await m.importXML(xml);assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));assert.equal(m.commandStack.size(),0);
  }finally{h.close();}
});

test('AX-23/25: existing resize and selected edge controls take priority, ports refresh after zoom',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350});m.select(source.id);
    const middle={x:source.x+source.width,y:source.y+source.height/2};h.move(middle,source);assert.ok(portPoint(h).x>middle.x+4,'resize handle retains its own location while the grab is offset');
    const start={x:source.x,y:source.y+20};h.move(start,source);assert.ok(h.port());await m.setViewport({x:20,y:40,zoom:.5});h.move(start,source);assert.equal(Number(h.port().querySelector('.bpmn-xyflow-connect-hit').getAttribute('r')),16);
    const edge=m.connect(source,target,{connectionStart:middle});m.select(edge.id);h.move(edge.waypoints[0],source);assert.ok(Math.hypot(portPoint(h).x-edge.waypoints[0].x,portPoint(h).y-edge.waypoints[0].y)>28,'selected endpoint retains its screen hit area while the grab is offset');assert.ok(m.getContainer().querySelector('[data-bend-index="0"]'));
  }finally{h.close();}
});

test('AX-08/22: target remains usable without a forced hover leave/re-enter after creation',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350});const start={x:source.x+source.width,y:source.y+20},end={x:target.x,y:target.y+20};
    h.move(start,source);h.press(start);h.move(end,target);h.up(end,target);const count=m.commandStack.size();
    h.move({x:target.x+target.width,y:target.y+20},target);assert.equal(h.port().getAttribute('data-connect-source'),target.id);assert.equal(m.commandStack.size(),count);
  }finally{h.close();}
});


test('AX-02/25: unpressed tracking retains control identity and remains absent from standalone SVG',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),point={x:source.x+25,y:source.y},before=await m.getXML(),count=m.commandStack.size();
    h.move(point,source);const handle=h.port(),hit=handle.querySelector('.bpmn-xyflow-connect-hit');
    h.move({x:point.x+3,y:point.y+2},hit);assert.ok(h.port()===handle);assert.deepEqual(portPoint(h),{x:point.x+3,y:point.y});await unchanged(m,before,count);
    const exported=await m.saveSVG();assert.doesNotMatch(typeof exported==='string'?exported:exported.svg,/bpmn-xyflow-connect-(?:handle|outline)/);
    m.moveShape(source,{x:20,y:0});assert.ok(!h.port(),'model changes remove stale port geometry');m.undo();assert.equal(await m.getXML(),before);
  }finally{h.close();}
});

test('AX-28: cancelled creation and passive ports remain isolated across two editors',async()=>{
  const first=await fixture(),second=await fixture();
  try{
    const a=first.m.getElement('Task_1'),b=second.m.getElement('Task_1'),point={x:a.x+25,y:a.y};
    const beforeA=await first.m.getXML(),beforeB=await second.m.getXML();
    first.move(point,a);first.press(point);first.move({x:point.x+50,y:point.y-50},null);first.key('Escape');
    second.move(point,b);assert.equal(second.port().getAttribute('data-connect-source'),b.id);assert.ok(!first.port());
    second.press(point);second.up(point,b);await unchanged(first.m,beforeA,0);await unchanged(second.m,beforeB,0);
    assert.ok(!first.m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));assert.ok(!second.m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
  }finally{second.close();first.close();}
});


test('AX-04/07: Shift drag shares the activation threshold without changing context-pad click-to-arm',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350}),start={x:source.x+source.width,y:source.y+23};
    const before=await m.getXML(),count=m.commandStack.size();
    for(const distance of [0,1,5]){
      h.shiftPress(start,source);h.move({x:start.x+distance,y:start.y},source);h.up(start,source);await unchanged(m,before,count);assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
    }
    const end={x:target.x,y:target.y+17};h.shiftPress(start,source);h.move(end,target);assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));h.up(end,target);
    const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===source&&edge.target===target);assert.deepEqual(xy(edge.waypoints[0]),start);assert.deepEqual(xy(edge.waypoints.at(-1)),end);assert.equal(m.commandStack.size(),count+1);await history(m,before,await m.getXML());
  }finally{h.close();}
});


for(const zoom of [.5,1,2]) test(`AX-01/02/23: exact selected midpoints and rounded corners use a separate stable grab at zoom ${zoom}`,async()=>{
  const h=await fixture(),{m}=h;
  try{
    await m.setViewport({x:20,y:30,zoom});const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350});
    const corners=10-10/Math.sqrt(2);
    const cases=[['n',{x:source.x+50,y:source.y},{x:source.x+50,y:source.y}],['e',{x:source.x+100,y:source.y+40},{x:source.x+100,y:source.y+40}],
      ['s',{x:source.x+50,y:source.y+80},{x:source.x+50,y:source.y+80}],['w',{x:source.x,y:source.y+40},{x:source.x,y:source.y+40}],
      ['nw',{x:source.x,y:source.y},{x:source.x+corners,y:source.y+corners}],['ne',{x:source.x+100,y:source.y},{x:source.x+100-corners,y:source.y+corners}],
      ['se',{x:source.x+100,y:source.y+80},{x:source.x+100-corners,y:source.y+80-corners}],['sw',{x:source.x,y:source.y+80},{x:source.x+corners,y:source.y+80-corners}]];
    for(const [direction,pointer,expected] of cases){
      m.select(source.id);const resize=m.getContainer().querySelector(`[data-resize-dir="${direction}"]`);assert.ok(resize);
      h.move(pointer,resize);const grab=portPoint(h),marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point');
      const anchor={x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))};assert.ok(Math.hypot(anchor.x-expected.x,anchor.y-expected.y)<1e-8);
      assert.equal(marker.parentNode.getAttribute('visibility'),'visible');assert.ok(Math.hypot(grab.x-pointer.x,grab.y-pointer.y)*zoom>8);
      assert.ok([...h.port().parentNode.children].indexOf(h.port())<[...resize.parentNode.parentNode.children].indexOf(resize.parentNode),'resize layer remains above the grab');
      h.move(grab,h.port().querySelector('.bpmn-xyflow-connect-hit'));assert.deepEqual(portPoint(h),grab);
      const before=await m.getXML(),count=m.commandStack.size(),end={x:target.x,y:target.y+25};h.press(grab);h.move(end,target);h.up(end,target);
      const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===source&&edge.target===target);assert.ok(Math.hypot(edge.waypoints[0].x-expected.x,edge.waypoints[0].y-expected.y)<1e-8);assert.equal(m.commandStack.size(),count+1);
      m.undo();assert.equal(await m.getXML(),before);
    }
  }finally{h.close();}
});


test('AX-01/07/23: outward grab clears the context pad while its buttons and exact anchor remain available',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350});m.select(source.id);
    const pad=m.getContainer().querySelector('.bpmn-xyflow-context-pad');assert.ok(pad);pad.getBoundingClientRect=()=>({left:459,top:74,right:515,bottom:254,width:56,height:180});
    const anchor={x:source.x+100,y:source.y+40};h.move(anchor,source);const grab=portPoint(h);assert.ok(grab.x-8>515,'grab hit is outside the complete HTML pad');
    assert.ok(pad.querySelector('button[title="Connect — drag to a target shape"]'));h.move({x:480,y:120},pad);assert.deepEqual(portPoint(h),grab,'crossing the pad does not lose the chosen origin');
    const marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point');assert.deepEqual({x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))},anchor);
    h.move(grab,h.port().querySelector('.bpmn-xyflow-connect-hit'));h.press(grab);const end={x:target.x,y:target.y+25};h.move(end,target);h.up(end,target);assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);
  }finally{h.close();}
});

test('AX-14/23: outward creation controls do not consume body drag or the original resize handle',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1');m.select(source.id);const before=await m.getXML(),count=m.commandStack.size();
    const middle={x:source.x+100,y:source.y+40},resize=m.getContainer().querySelector('[data-resize-dir="e"]');h.move(middle,resize);assert.ok(h.port());
    h.controlPress(middle,resize);h.move({x:middle.x+30,y:middle.y},null);h.up({x:middle.x+30,y:middle.y},null);assert.equal(source.width,130);assert.equal(m.getGraph().edges.length,0);assert.equal(m.commandStack.size(),count+1);m.undo();assert.equal(await m.getXML(),before);
    const body={x:source.x+50,y:source.y+40};h.move(body,source);h.controlPress(body,h.gfx(source));h.move({x:body.x+30,y:body.y+20},source);h.up({x:body.x+30,y:body.y+20},source);
    assert.equal(source.x,383);assert.equal(source.y,100);assert.equal(m.getGraph().edges.length,0);m.undo();assert.equal(await m.getXML(),before);
  }finally{h.close();}
});


test('AX-09/10/24: low-zoom event and gateway ports preserve the ordinary body drag region',async()=>{
  const h=await fixture(),{m}=h;
  try{
    await m.setViewport({x:40,y:70,zoom:.5});const event=m.getElement('StartEvent_1'),gateway=m.addShape('bpmn:ExclusiveGateway',{x:700,y:350});
    for(const node of [event,gateway]){
      m.clearSelection();const center={x:node.x+node.width/2,y:node.y+node.height/2},pointer={x:node.x,y:center.y};
      h.move(pointer,node);const grab=portPoint(h),marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point');
      assert.deepEqual({x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))},pointer);
      assert.ok(Math.hypot(grab.x-center.x,grab.y-center.y)-16>Math.min(node.width,node.height)/4,'port hit remains outside the central body drag region');
      const before=await m.getXML(),x=node.x,y=node.y;h.controlPress(center,h.gfx(node));h.move({x:center.x+24,y:center.y+18},node);h.up({x:center.x+24,y:center.y+18},node);
      assert.equal(node.x,x+24);assert.equal(node.y,y+18);assert.equal(m.getGraph().edges.length,0);m.undo();assert.equal(await m.getXML(),before);
    }
  }finally{h.close();}
});

test('AX-06/20: refused routing cannot commit or reparent API/native moves or boundary attachment',async()=>{
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:750,y:350}),parent=m.addShape('bpmn:SubProcess',{x:1050,y:500},{isExpanded:true});
    const edge=m.connect(source,target),originalParent=source.parent;
    // A damaged in-memory logical docking is refused before it can alter
    // otherwise valid semantic XML. This exercises the normalization failure.
    edge.waypoints[0].original={x:Infinity,y:source.y};
    const before=await m.getXML(),count=m.commandStack.size(),bounds={x:source.x,y:source.y};
    assert.equal(m.moveShapes([source],{x:650,y:350},parent),false);await unchanged(m,before,count);assert.ok(source.parent===originalParent);
    assert.equal(source.x,bounds.x);assert.equal(source.y,bounds.y);
    const body={x:source.x+50,y:source.y+40};h.controlPress(body,h.gfx(source));h.move({x:1050,y:500},parent);h.up({x:1050,y:500},parent);await unchanged(m,before,count);assert.ok(source.parent===originalParent);
    delete edge.waypoints[0].original;
    const event=m.addShape('bpmn:IntermediateThrowEvent',{x:source.x+100,y:source.y+80});assert.ok(m.attachBoundary(event,source,{x:source.x+100,y:source.y+80}));
    const flow=m.connect(event,target);assert.ok(flow);flow.waypoints[0].original={x:Infinity,y:0};
    const boundaryBefore=await m.getXML(),boundaryCount=m.commandStack.size(),oldHost=event.host;
    assert.equal(m.attachBoundary(event,parent,{x:parent.x,y:parent.y+40}),null);await unchanged(m,boundaryBefore,boundaryCount);assert.ok(event.host===oldHost);assert.ok(event.businessObject.attachedToRef===oldHost.businessObject);
  }finally{h.close();}
});

test('lane routing refusal rolls back earlier sibling changes and deleted semantics without consuming history', async () => {
  const h = await fixture(), { m } = h;
  try {
    const pool = m.addShape('bpmn:Participant', { x: 1100, y: 900 }, { width: 600, height: 360 });
    const lanes = m.splitLane(pool, 3);
    const task = m.addShape('bpmn:Task', { x: 1100, y: 900 }, { parent: lanes[1] });
    const note = m.addShape('bpmn:TextAnnotation', { x: 1600, y: 1200 });
    const edge = m.connect(note, lanes[2]); assert.ok(edge);
    // Zero-width DI bounds are schema-valid input, but cannot support outline
    // routing. Import that real refusal instead of replacing a routing method.
    lanes[2].di.bounds.width = 0;
    await m.importXML(await m.getXML());
    const parent = m.getElement(pool.id), middle = m.getElement(lanes[1].id), child = m.getElement(task.id);
    const label = m.getElement(note.id);
    m.updateLabel(label, 'Retain pending redo'); m.undo();
    const before = await m.getXML(), stack = m.commandStack.snapshot();
    assert.deepEqual((await new BpmnModdle().fromXML(before)).warnings, []);
    if (process.env.BPMN_XML_ARTIFACT_DIR) {
      await mkdir(process.env.BPMN_XML_ARTIFACT_DIR, { recursive: true });
      await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR, 'anchor-lane-refusal.bpmn'), before);
    }
    const graph = m.getGraph(), nodes = graph.nodes.slice(), edges = graph.edges.slice();
    const state = nodes.map(node => ({ node, x: node.x, y: node.y, width: node.width, height: node.height, parent: node.parent, di: node.di, bo: node.businessObject }));
    const laneSet = middle.businessObject.$parent, laneArray = laneSet.lanes, laneValues = laneArray.slice();
    const refs = middle.businessObject.flowNodeRef, refValues = refs.slice();
    assert.ok(refs.includes(child.businessObject), 'the imported task retains its lane membership');
    const planeEntries = graph.diagram.plane.planeElement, originalEntries = planeEntries.slice();
    const execute = m.commandStack.execute, observed = [];
    m.commandStack.execute = command => {
      const result = execute(command);
      observed.push({ name: command.name, removedMiddle: !m.getElement(middle.id), removedMembership: !laneArray.includes(middle.businessObject) });
      return result;
    };
    for (const action of ['split', 'delete']) {
      observed.length = 0;
      assert.equal(action === 'split' ? m.splitLane(parent, 4) : m.deleteLane(middle), action === 'split' ? null : false);
      if (action === 'split') assert.ok(observed.filter(entry => entry.name === 'resize-lane').length >= 2, 'earlier sibling resize commands ran before refusal');
      else assert.ok(observed.some(entry => entry.removedMiddle && entry.removedMembership), 'the lane graph element and semantic membership were deleted before rebalance refused');
      assert.equal(await m.getXML(), before);
      assert.deepEqual(m.commandStack.snapshot(), stack, 'undo and pending redo entries are unchanged');
      assert.deepEqual(graph.nodes, nodes); assert.deepEqual(graph.edges, edges);
      assert.ok(laneSet.lanes === laneArray); assert.deepEqual(laneArray, laneValues);
      assert.ok(middle.businessObject.flowNodeRef === refs); assert.deepEqual(refs, refValues);
      assert.ok(graph.diagram.plane.planeElement === planeEntries); assert.deepEqual(planeEntries, originalEntries);
      for (const old of state) {
        assert.ok(m.getElement(old.node.id) === old.node && old.node.parent === old.parent && old.node.di === old.di && old.node.businessObject === old.bo);
        for (const key of ['x', 'y', 'width', 'height']) assert.equal(old.node[key], old[key]);
      }
    }
    assert.equal(m.redo(), true); assert.equal(label.businessObject.text, 'Retain pending redo');
    assert.equal(m.undo(), true); assert.equal(await m.getXML(), before);
  } finally { h.close(); }
});

test('coincident unpressed ports follow one-pixel perimeter motion while displaced grabs stay stable', async () => {
  const h=await fixture(),{m}=h;
  try {
    const node=m.getElement('Task_1');await m.setViewport({x:23,y:17,zoom:1.4});
    const start={x:node.x+node.width,y:node.y+20},before=await m.getXML(),count=m.commandStack.size();
    h.move(start,node);
    for(let pixel=1;pixel<=12;pixel++){
      const point={x:start.x,y:start.y+pixel/1.4};
      h.move(point,h.port().querySelector('.bpmn-xyflow-connect-hit'));
      const actual=portPoint(h);assert.ok(Math.hypot(actual.x-point.x,actual.y-point.y)<1e-8,'the coincident hit circle does not quantize origin motion');
    }
    m.select(node.id);const middle={x:node.x+node.width,y:node.y+node.height/2};h.move(middle,node);
    const grab=portPoint(h),marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'),anchor={x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))};
    assert.ok(grab.x>middle.x);assert.ok(Math.hypot(anchor.x-middle.x,anchor.y-middle.y)<1e-8);
    h.move({x:grab.x-1/1.4,y:grab.y},h.port().querySelector('.bpmn-xyflow-connect-hit'));
    assert.deepEqual(portPoint(h),grab);assert.deepEqual({x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))},anchor);
    await unchanged(m,before,count);
  }finally{h.close();}
});

test('boundary outline remains reachable through its own label padding without taking over label text or drag', async () => {
  const h=await fixture(),{m}=h;
  try {
    await m.importXML(await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn','utf8'));
    const boundary=m.getElement('FlightTimeout'),label=boundary.label;
    // Chrome's measured display rectangle from the failed AX-13 artifact;
    // structural text metrics are deliberately replaced only for this replay.
    Object.assign(label,{x:646,y:318,width:85,height:14});
    const labelGfx=h.gfx(label),labelHit=labelGfx.querySelector('.bpmn-xyflow-shape-hit');
    labelGfx.setAttribute('transform',`translate(${label.x},${label.y})`);labelHit.setAttribute('width',label.width);labelHit.setAttribute('height',label.height);
    const point={x:678.5093429732333,y:314.91555399972754},before=await m.getXML(),count=m.commandStack.size();
    const ownerBounds={x:boundary.x,y:boundary.y,width:boundary.width,height:boundary.height};
    h.move(point,labelHit);assert.equal(h.port()?.getAttribute('data-connect-source'),boundary.id);
    const marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'),anchor={x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))},grab=portPoint(h);
    assert.ok(Math.abs(Math.hypot(anchor.x-688,anchor.y-300)-18)<1e-8,'marker lies on actual event circle');
    const padding=Number(labelHit.getAttribute('stroke-width'))/2,hitRadius=Number(h.port().querySelector('.bpmn-xyflow-connect-hit').getAttribute('r'));
    assert.ok(grab.x+hitRadius<label.x-padding||grab.x-hitRadius>label.x+label.width+padding||grab.y+hitRadius<label.y-padding||grab.y-hitRadius>label.y+label.height+padding,'grab hit disc clears the complete label hit rectangle');
    const crossing={x:anchor.x+(grab.x-anchor.x)*.5,y:anchor.y+(grab.y-anchor.y)*.5};
    h.move(crossing,labelHit);assert.deepEqual(portPoint(h),grab,'crossing the label along the tether retains the grab');
    const frame=m.getElement('BookingTransaction'),frameHit=h.gfx(frame).querySelector('.bpmn-xyflow-shape-hit');
    // Native pointermove emits Viewer element.hover before window mousemove.
    // AX-13 crosses the label, then the enclosing transaction on its tether.
    for(const fraction of [.6,.75,.9,1]) {
      const at={x:anchor.x+(grab.x-anchor.x)*fraction,y:anchor.y+(grab.y-anchor.y)*fraction};
      h.hover(at,frameHit);assert.equal(h.port()?.getAttribute('data-connect-source'),boundary.id,'Viewer hover cannot replace the tether owner');
      h.move(at,frameHit);assert.equal(h.port()?.getAttribute('data-connect-source'),boundary.id,'window mousemove cannot replace the tether owner');
      assert.deepEqual(portPoint(h),grab,'complete native approach retains the exact displaced grab');
    }
    const outside={x:frame.x+50,y:frame.y+40};h.hover(outside,frameHit);h.move(outside,frameHit);assert.equal(h.port()?.getAttribute('data-connect-source'),frame.id,'leaving the corridor discovers the actual underlying owner');
    h.move(point,labelHit);assert.equal(h.port()?.getAttribute('data-connect-source'),boundary.id);
    const text={x:label.x+label.width*.8,y:label.y+label.height/2};h.move(text,labelHit);assert.ok(!h.port(),'genuine label text keeps its own hover target');
    await unchanged(m,before,count);
    h.controlPress(text,labelHit);h.move({x:text.x+25,y:text.y+18},label);h.up({x:text.x+25,y:text.y+18},label);
    assert.equal(label.x,671);assert.equal(label.y,336);assert.deepEqual({x:boundary.x,y:boundary.y,width:boundary.width,height:boundary.height},ownerBounds);
    assert.equal(boundary.businessObject.attachedToRef.id,'ReserveFlight');assert.equal(boundary.businessObject.eventDefinitions[0].timeDuration.body,'PT1H');
    const after=await m.getXML();assert.equal(m.commandStack.size(),count+1);await history(m,before,after);
  }finally{h.close();}
});

test('Shift on the visible port passes SVG capture to Connect and retains the pending activation threshold', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('StartEvent_1'),target=m.getElement('Task_1'),start={x:source.x+source.width/2,y:source.y+source.height};
    const before=await m.getXML(),count=m.commandStack.size();
    for(const delta of [0,1,5]){
      h.move(start,source);const grab=portPoint(h);h.press(grab,{shiftKey:true});
      assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-lasso'),'SVG capture does not steal a source port for lasso');
      h.move({x:grab.x+delta,y:grab.y},source);assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),'subthreshold Shift press stays pending');h.up(grab,source);await unchanged(m,before,count);
    }
    h.move(start,source);const grab=portPoint(h);h.press(grab,{shiftKey:true});
    const end={x:target.x+target.width*.3,y:target.y};h.move(end,target);
    assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),'activated Shift port drag shows Connect preview');assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-lasso'));
    h.up(end,target);const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===source&&edge.target===target);assert.deepEqual(xy(edge.waypoints[0]),start);assert.deepEqual(xy(edge.waypoints.at(-1)),end);
    const after=await m.getXML();assert.equal(m.commandStack.size(),count+1);await history(m,before,after);
  }finally{h.close();}
});


test('displaced Event/Gateway and selected Task grabs leave a visible marker and tether without moving the origin', async () => {
  const h=await fixture(),{m}=h;
  try {
    const event=m.getElement('StartEvent_1'),gateway=m.addShape('bpmn:ExclusiveGateway',{x:700,y:350}),task=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:1050,y:500});
    const cases=[[event,.5,false],[event,8/9.669211195928753,false],[gateway,.5,false],[task,.5,true],[task,1,true],[task,2,true]];
    for(const [node,zoom,selected] of cases) {
      await m.setViewport({x:37,y:53,zoom});m.select(selected?node.id:[]);
      const before=await m.getXML(),count=m.commandStack.size(),requested={x:node.x,y:node.y+node.height/2};
      h.move(requested,node);
      const handle=h.port(),marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'),port=handle.querySelector('.bpmn-xyflow-connect-port'),tether=m.getContainer().querySelector('.bpmn-xyflow-connect-tether'),grab=portPoint(h);
      const point=c=>({x:Number(c.getAttribute('cx')),y:Number(c.getAttribute('cy'))});
      const outer=c=>(Number(c.getAttribute('r'))+Number.parseFloat(c.style['stroke-width'])/2)*zoom;
      assert.equal(marker.parentNode.getAttribute('visibility'),'visible');
      const anchor=point(marker);assert.ok(Math.hypot(anchor.x-requested.x,anchor.y-requested.y)<1e-8,'the on-outline origin matches the requested point within arithmetic precision');
      const separation=Math.hypot(grab.x-anchor.x,grab.y-anchor.y)*zoom;
      assert.ok(separation>=12-1e-8,'displaced centers have a minimum screen-space separation');
      assert.ok(separation-outer(port)-outer(marker)>=3.24,'painted marker and grab leave at least3.24CSSpx of visible tether');
      assert.deepEqual({x:Number(tether.getAttribute('x1')),y:Number(tether.getAttribute('y1'))},anchor);
      assert.deepEqual({x:Number(tether.getAttribute('x2')),y:Number(tether.getAttribute('y2'))},grab);
      assert.equal(handle.querySelector('title').textContent,'Drag to connect from the marked outline point');
      for(const fraction of [.25,.5,.75,1,.5,1]) {
        const at={x:anchor.x+(grab.x-anchor.x)*fraction,y:anchor.y+(grab.y-anchor.y)*fraction};
        h.hover(at,node);h.move(at,node);assert.ok(h.port()===handle);assert.deepEqual(portPoint(h),grab);assert.deepEqual(point(marker),anchor);
      }
      await unchanged(m,before,count);
      h.press(grab);const end={x:target.x,y:target.y+20};h.move(end,target);
      const preview=m.getContainer().querySelector('.bpmn-xyflow-connect-preview path');assert.ok(preview);
      const previewPath=preview.getAttribute('d');h.up(end,target);
      const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===node&&edge.target===target);
      assert.deepEqual(xy(edge.waypoints[0]),anchor,'committed source remains the marker, never the outward grab');
      const painted=h.gfx(edge).querySelector(':scope > path:not(.bpmn-xyflow-connection-hit)');
      assert.equal(painted.getAttribute('d').replaceAll(' ',''),previewPath.replaceAll(' ',''),'activated preview and committed paint agree');
      const after=await m.getXML();assert.equal(m.commandStack.size(),count+1);await history(m,before,after);m.undo();assert.equal(await m.getXML(),before);
    }
    await m.setViewport({x:37,y:53,zoom:1});m.clearSelection();const point={x:task.x+task.width,y:task.y+20};
    h.move(point,task);assert.deepEqual(portPoint(h),point,'ordinary coincident ports do not move outward');
    assert.equal(h.port().querySelector('title').textContent,'Drag to connect from this point');
    assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-docking').getAttribute('visibility'),'hidden');
  } finally { h.close(); }
});

for (const selected of [false,true]) test(`inactive source-port click retains Connect intent at every midpoint/corner, selected=${selected}`,async()=>{
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1'),target=m.addShape('bpmn:Task',{x:900,y:400});
    const corners=10-10/Math.sqrt(2),x=source.x,y=source.y,w=source.width,height=source.height;
    const points=[{x:x+w/2,y},{x:x+w,y:y+height/2},{x:x+w/2,y:y+height},{x,y:y+height/2},
      {x:x+corners,y:y+corners},{x:x+w-corners,y:y+corners},{x:x+w-corners,y:y+height-corners},{x:x+corners,y:y+height-corners}];
    for (const point of points) {
      m.select(selected?source.id:[]);h.move(point,source);
      const marker=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'),anchor={x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))},grab=portPoint(h),selection=m.getSelection();
      const before=await m.getXML(),count=m.commandStack.size(),bounds={x:source.x,y:source.y,width:source.width,height:source.height};
      h.press(grab);h.up(grab,selected?null:source);
      assert.deepEqual(m.getSelection(),selection,'Connect owns its pointerup instead of selecting the shape beneath the removed handle');
      assert.ok(h.port(),'inactive release restores the immediately reusable control');
      assert.deepEqual(portPoint(h),grab,'same visible grab is restored without a leave/re-enter workaround');
      const restored=m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point');assert.deepEqual({x:Number(restored.getAttribute('cx')),y:Number(restored.getAttribute('cy'))},anchor);
      await unchanged(m,before,count);
      // A second down at the identical screen/graph point starts Connect, never
      // the north/south/east/west or corner resize control under the old port.
      h.press(grab);const end={x:target.x,y:target.y+25};h.move(end,target);
      assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
      assert.deepEqual({x:source.x,y:source.y,width:source.width,height:source.height},bounds);
      h.up(end,target);const edge=m.getGraph().edges.at(-1);assert.ok(edge.source===source&&edge.target===target);assert.deepEqual(xy(edge.waypoints[0]),anchor);
      assert.equal(m.commandStack.size(),count+1);const after=await m.getXML();await history(m,before,after);m.undo();assert.equal(await m.getXML(),before);
    }
  }finally{h.close();}
});


test('source-control ownership preserves ordinary modifier selection and suppresses activated Shift drag clicks',async()=>{
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1'),other=m.addShape('bpmn:Task',{x:850,y:400});
    const body={x:source.x+50,y:source.y+40},before=await m.getXML(),count=m.commandStack.size();
    for(const modifier of [null,'shiftKey','ctrlKey','metaKey']) {
      m.select(other.id);const extra=modifier?{[modifier]:true}:{};
      h.bodyPress(body,source,extra);h.up(body,source,extra);
      assert.deepEqual(m.getSelection().sort(),(modifier?[other.id,source.id]:[source.id]).sort(),'body click retains its normal selection behavior');
      await unchanged(m,before,count);
    }
    m.select(other.id);h.shiftPress(body,source);h.move({x:body.x+60,y:body.y-40},null);
    assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
    h.key('Escape');h.up(body,source,{shiftKey:true});
    assert.deepEqual(m.getSelection(),[other.id],'activated Shift cancellation cannot toggle the underlying shape on pointerup');
    await unchanged(m,before,count);
    // The next ordinary click must work after the owned pointer is released.
    h.bodyPress(body,source);h.up(body,source);assert.deepEqual(m.getSelection(),[source.id]);
  }finally{h.close();}
});

test('a claimed source-port pointer remains scoped to its own Viewer',async()=>{
  const a=await fixture(),b=await fixture();
  try {
    const na=a.m.getElement('Task_1'),nb=b.m.getElement('Task_1'),pa={x:na.x+50,y:na.y},pb={x:nb.x+50,y:nb.y+40};
    const xa=await a.m.getXML(),xb=await b.m.getXML();a.move(pa,na);a.press(pa);a.up(pa,na);
    assert.deepEqual(a.m.getSelection(),[]);assert.deepEqual(b.m.getSelection(),[]);assert.ok(a.port());
    b.bodyPress(pb,nb);b.up(pb,nb);assert.deepEqual(b.m.getSelection(),[nb.id]);assert.deepEqual(a.m.getSelection(),[]);
    assert.equal(await a.m.getXML(),xa);assert.equal(await b.m.getXML(),xb);
  }finally{b.close();a.close();}
});
