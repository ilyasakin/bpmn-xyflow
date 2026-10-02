/** Exact registered-event replay of the native F23-B acquisition sequence. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler, xml;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); xml = await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'); });
after(async () => dom.cleanup());
async function fixture() {
  const listeners = new WeakMap(), restores = [];
  const size = { width: window.innerWidth, height: window.innerHeight };
  window.innerWidth = 1188; window.innerHeight = 762;
  restores.push(() => { window.innerWidth = size.width; window.innerHeight = size.height; });
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
    leave(point,relatedTarget) { call(m.getSvg(),'pointerleave',input(point,m.getSvg(),{relatedTarget,pointerType:'mouse'})); },
    close() { m.destroy(); restores.reverse().forEach(restore => restore()); document.elementsFromPoint = originalHit; }
  };
}
const xy = point => ({ x: point.x, y: point.y });
const portPoint = h => { const circle = h.port()?.querySelector('.bpmn-xyflow-connect-port'); assert.ok(circle); return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }; };
const markerPoint = h => { const circle = h.m.getContainer().querySelector('.bpmn-xyflow-connect-docking-point'); assert.ok(circle); return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }; };
async function history(m, before, after) { for (let i = 0; i < 3; i++) { assert.equal(m.undo(), true); assert.equal(await m.getXML(), before); assert.equal(m.redo(), true); assert.equal(await m.getXML(), after); } }

test('F23-B: recorded lower BoundaryEvent approach survives duplicate input and read-only export', async () => {
  const h=await fixture(),{m}=h;
  try {
    window.innerWidth=1800;window.innerHeight=1200;
    m.getContainer().getBoundingClientRect=()=>({left:0,top:0,right:1800,bottom:1200,width:1800,height:1200});
    await m.importXML(await readFile('test/fixtures/scenarios/booking-timeout-compensation.bpmn','utf8'));
    const boundary=m.getElement('FlightTimeout'),label=boundary.label;
    Object.assign(label,{x:646,y:318,width:85,height:14});
    const labelGfx=h.gfx(label),labelHit=labelGfx.querySelector('.bpmn-xyflow-shape-hit');
    labelGfx.setAttribute('transform',`translate(${label.x},${label.y})`);labelHit.setAttribute('width',label.width);labelHit.setAttribute('height',label.height);
    m.select(boundary.id);
    const viewport={x:557.6760518360127,y:406.229033698398,zoom:0.8788735989262744};await m.setViewport(viewport);
    const pad=m.getContainer().querySelector('.bpmn-xyflow-context-pad');
    pad.getBoundingClientRect=()=>({left:1184,top:648,right:1246,bottom:766,width:62,height:118});
    const graph=([x,y])=>({x:(x-viewport.x)/viewport.zoom,y:(y-viewport.y)/viewport.zoom});
    const frame=m.getElement('BookingTransaction'),frameHit=h.gfx(frame).querySelector('.bpmn-xyflow-shape-hit');
    h.hover(graph([1154,683]),labelHit);h.move(graph([1154,683]),labelHit);
    const handle=h.port(),anchor=markerPoint(h),grab=portPoint(h),count=m.commandStack.size(),before=await m.getXML();
    assert.equal(handle.getAttribute('data-connect-source'),boundary.id);
    assert.deepEqual({x:Math.round(grab.x*viewport.zoom+viewport.x),y:Math.round(grab.y*viewport.zoom+viewport.y)},{x:1134,y:715});
    const positions=[[1151,687],[1149,691],[1146,695],[1144,699],[1141,703],[1139,707],[1136,711],[1134,715]];
    for(const client of positions){
      const at=graph(client),receiver=Math.hypot(client[0]-(grab.x*viewport.zoom+viewport.x),client[1]-(grab.y*viewport.zoom+viewport.y))<=5.75?handle.querySelector('.bpmn-xyflow-connect-hit'):frameHit;
      h.hover(at,receiver);h.move(at,receiver);assert.equal(h.port(),handle);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
    }
    for(let i=0;i<4;i++){
      assert.equal(await m.getXML(),before);assert.deepEqual(m.getSelection(),[boundary.id]);assert.deepEqual(m.getViewport(),viewport);assert.equal(m.commandStack.size(),count);
      const at=graph([1134,715]),hit=handle.querySelector('.bpmn-xyflow-connect-hit');h.hover(at,hit);h.move(at,hit);
      assert.equal(h.port(),handle,'same delivered pointer retains the acquired control');assert.deepEqual(markerPoint(h),anchor);
    }
    h.press(graph([1134,715]));const target=m.getElement('CancelBooking');h.move(graph([1251,777]),target);
    assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),'positive registered preview');
    h.up(graph([1251,777]),target);
    assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);
    assert.deepEqual({x:frame.x,y:frame.y},{x:220,y:110});await history(m,before,await m.getXML());
  }finally{h.close();}
});
