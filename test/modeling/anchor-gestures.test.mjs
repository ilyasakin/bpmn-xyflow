/** Registered-handler coverage for AX-01/02/04/05/06/08/20/24/25/28.
 * Native discoverability and browser hit testing are covered separately. */
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { projectRoundedTask } from '../helpers/anchor-ownership-browser.mjs';
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
async function unchanged(m, before, count) { assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), count); }
async function history(m, before, after) { for (let i = 0; i < 3; i++) { assert.equal(m.undo(), true); assert.equal(await m.getXML(), before); assert.equal(m.redo(), true); assert.equal(await m.getXML(), after); } }

test('D20: the advertised resize-corner grab is reachable directly without visiting its rounded marker', async () => {
  const h=await fixture(),{m}=h;
  try {
    // Captured manual geometry in canvas-local coordinates (native canvas top78).
    // Happy DOM has no context-pad layout; only measured attribution/minimap
    // boxes are supplied, never inferred context-pad geometry.
    window.innerWidth=1180;window.innerHeight=679;
    const box=(element,left,top,right,bottom)=>element.getBoundingClientRect=()=>({left,top,right,bottom,width:right-left,height:bottom-top});
    box(m.getContainer(),0,0,1180,679);box(m.getSvg(),0,0,1180,679);
    const source=m.getElement('Task_1');m.moveShape(source,{x:1076-source.x,y:595-source.y});
    const target=m.addShape('bpmn:Task',{x:650,y:302});await m.setViewport({x:0,y:0,zoom:1});m.select(source.id);
    box(m.getContainer().querySelector('.bjs-powered-by'),1112,641.90625,1165,664);
    const minimap=document.createElement('div');minimap.className='bpmn-xyflow-minimap';m.getContainer().appendChild(minimap);box(minimap,970,483,1170,633);
    const resize=m.getContainer().querySelector('[data-resize-dir="se"]'),start={x:1176,y:675};
    h.hover(start,resize);h.move(start,resize);
    const handle=h.port(),anchor=markerPoint(h),grab=portPoint(h),before=await m.getXML(),count=m.commandStack.size();
    assert.ok(Math.hypot(anchor.x-1173.0710678118655,anchor.y-672.0710678118654)<1e-9);
    assert.ok(Math.hypot(grab.x-1101.99999325,grab.y-672.071067811866)<1e-9, JSON.stringify({anchor,grab}));
    for(let i=1;i<=37;i++){
      const point={x:1176-2*i,y:Math.round(675-3*i/37)};
      const receiver=i<=2?resize:i>=35?handle.querySelector('.bpmn-xyflow-connect-hit'):source;
      h.hover(point,receiver);h.move(point,receiver);
      assert.equal(h.port(),handle);assert.deepEqual(markerPoint(h),anchor,'advertised corner origin stays fixed at delivered step '+i);assert.deepEqual(portPoint(h),grab);
    }
    await unchanged(m,before,count);assert.deepEqual(m.getSelection(),[source.id]);
    h.press(grab);h.up(grab,source);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);await unchanged(m,before,count);
    h.press(grab);const end={x:target.x+25,y:target.y};h.move(end,target);assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));h.up(end,target);
    assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);await history(m,before,await m.getXML());
  }finally{h.close();}
});

test('D20: advertised corners keep directional grab travel distinct from resize, perimeter choice and departure across zooms', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1');m.getSvg().getBoundingClientRect=()=>m.getContainer().getBoundingClientRect();
    for(const zoom of [.2,.5,1,2,4])for(const [dir,right,bottom]of [['nw',false,false],['ne',true,false],['sw',false,true],['se',true,true]]){
      const corner={x:source.x+(right?source.width:0),y:source.y+(bottom?source.height:0)};
      const camera={x:(right?1184:4)-corner.x*zoom,y:(bottom?758:4)-corner.y*zoom,zoom};await m.setViewport(camera);m.select([]);m.select(source.id);
      const resize=m.getContainer().querySelector(`[data-resize-dir="${dir}"]`),before=await m.getXML(),count=m.commandStack.size();
      h.hover(corner,resize);h.move(corner,resize);const handle=h.port(),anchor=markerPoint(h),grab=portPoint(h);
      assert.ok(Math.hypot(anchor.x-projectRoundedTask(source,10,corner).x,anchor.y-projectRoundedTask(source,10,corner).y)<1e-8);
      const start={x:camera.x+corner.x*zoom,y:camera.y+corner.y*zoom},end={x:Math.round(camera.x+grab.x*zoom),y:Math.round(camera.y+grab.y*zoom)};
      const steps=Math.ceil(Math.hypot(end.x-start.x,end.y-start.y));
      for(let i=1;i<=steps;i++){
        const css={x:Math.round(start.x+(end.x-start.x)*i/steps),y:Math.round(start.y+(end.y-start.y)*i/steps)};
        const point={x:(css.x-camera.x)/zoom,y:(css.y-camera.y)/zoom};
        const receiver=Math.hypot(point.x-grab.x,point.y-grab.y)*zoom<=5.75?handle.querySelector('.bpmn-xyflow-connect-hit'):
          Math.abs(point.x-corner.x)<=4&&Math.abs(point.y-corner.y)<=4?resize:source;
        h.hover(point,receiver);h.move(point,receiver);assert.equal(h.port(),handle);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
      }
      await unchanged(m,before,count);assert.deepEqual(m.getSelection(),[source.id]);
      // A genuine blank-canvas departure releases the advertised control.
      const blank={x:(594-camera.x)/zoom,y:(381-camera.y)/zoom};h.hover(blank,m.getSvg());h.move(blank,null);assert.equal(h.port(),null);
      h.hover(corner,resize);h.move(corner,resize);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
      // The original square still starts Resize, never Connect.
      h.hover(corner,resize);h.move(corner,resize);h.controlPress(corner,resize);
      h.move({x:corner.x+(right?20:-20)/zoom,y:corner.y+(bottom?20:-20)/zoom},null);
      assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),null);assert.notEqual(source.width,100);
      h.key('Escape');assert.equal(source.width,100);await unchanged(m,before,count);
    }
  }finally{h.close();}
});

test('viewport native southeast: actual small-step approach survives attribution HTML without changing origin', async () => {
  const h=await fixture(),{m}=h;
  try {
    window.innerWidth=1800;window.innerHeight=1200;
    m.getContainer().getBoundingClientRect=()=>({left:0,top:0,right:1800,bottom:1200,width:1800,height:1200});
    const source=m.getElement('Task_1');m.moveShape(source,{x:2-source.x,y:31-source.y});
    const target=m.addShape('bpmn:Task',{x:-151,y:-68});m.select(source.id);
    const viewport={x:1574.8131229346604,y:954.8194608634067,zoom:2.2345742761444396};await m.setViewport(viewport);
    const setBox=(element,left,top,right,bottom)=>element.getBoundingClientRect=()=>({left,top,right,bottom,width:right-left,height:bottom-top});
    const attribution=m.getContainer().querySelector('.bjs-powered-by');assert.ok(attribution);setBox(attribution,1732,1164,1785,1185);
    const child=document.createElement('span');attribution.appendChild(child);
    const minimap=document.createElement('div');minimap.className='bpmn-xyflow-minimap';m.getContainer().appendChild(minimap);setBox(minimap,1588,1002,1790,1154);
    setBox(m.getContainer().querySelector('.bpmn-xyflow-context-pad'),1511.28125,1018.078125,1573.28125,1164.078125);
    const graph=([x,y])=>({x:(x-viewport.x)/viewport.zoom,y:(y-viewport.y)/viewport.zoom});
    const resize=m.getContainer().querySelector('[data-resize-dir="se"]');h.hover(graph([1796,1196]),resize);h.move(graph([1796,1196]),resize);
    const handle=h.port(),anchor=markerPoint(h),grab=portPoint(h),before=await m.getXML(),count=m.commandStack.size();
    assert.ok(Math.abs(anchor.x-99.09773869483796)<1e-9&&Math.abs(anchor.y-108.04429594919179)<1e-9,'exact hosted initial outline');
    assert.deepEqual({x:Math.round(grab.x*viewport.zoom+viewport.x),y:Math.round(grab.y*viewport.zoom+viewport.y)},{x:1722,y:1166},'same hosted integer grab destination');
    // Delivered positions retained in the hosted947 southeast failure artifact.
    const delivered=[[1794,1195,false],[1793,1195,false],[1792,1194,false],[1791,1194,false],[1790,1194,false],[1789,1193,false],[1788,1193,false],[1787,1192,false],[1787,1192,false],[1786,1192,false],[1785,1191,false],[1784,1191,false],[1783,1191,false],[1782,1190,false],[1781,1190,false],[1780,1189,false],[1779,1189,false],[1778,1189,false],[1777,1188,false],[1776,1188,false],[1776,1188,false],[1775,1187,false],[1774,1187,false],[1773,1186,false],[1772,1186,false],[1771,1186,false],[1770,1185,false],[1769,1185,false],[1768,1185,false],[1767,1184,true],[1766,1184,true],[1765,1183,true],[1765,1183,true],[1764,1183,true],[1763,1182,true],[1762,1182,true],[1761,1182,true],[1760,1181,true],[1759,1181,true],[1758,1180,true],[1757,1180,true],[1756,1180,true],[1755,1179,true],[1754,1179,true],[1754,1179,true],[1753,1178,true],[1752,1178,true],[1751,1177,true],[1750,1177,true],[1749,1177,true],[1748,1176,true],[1747,1176,true],[1746,1176,true],[1745,1175,true],[1744,1175,true],[1743,1174,true],[1743,1174,true],[1742,1174,true],[1741,1173,true],[1740,1173,true],[1739,1173,true],[1738,1172,true],[1737,1172,true],[1736,1171,true],[1735,1171,true],[1734,1171,true],[1733,1170,true],[1732,1170,true],[1732,1170,true],[1731,1169,true],[1730,1169,false],[1729,1168,false],[1728,1168,false],[1727,1168,false],[1726,1167,false],[1725,1167,false],[1724,1167,false],[1723,1166,false],[1722,1166,false],[1722,1166,false]];
    let crossed=false;
    for(const [x,y,overAttribution]of delivered){
      const point=graph([x,y]);
      if(overAttribution&&!crossed){h.leave(point,child);crossed=true;}
      const receiver=overAttribution?child:Math.hypot(x-(grab.x*viewport.zoom+viewport.x),y-(grab.y*viewport.zoom+viewport.y))<=5.75?handle.querySelector('.bpmn-xyflow-connect-hit'):source;
      if(!overAttribution)h.hover(point,receiver);h.move(point,receiver);
      assert.ok(h.port()===handle,'same source control survives native approach at '+x+','+y);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
    }
    assert.equal(crossed,true);assert.deepEqual(m.getSelection(),[source.id]);assert.deepEqual(m.getViewport(),viewport);await unchanged(m,before,count);
    h.press(grab);const end={x:target.x+30,y:target.y};h.move(end,target);h.up(end,target);assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);await history(m,before,await m.getXML());
  }finally{h.close();}
});

test('D19: retained chrome corridors preserve ordinary HTML input and release on departure or editor exit', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1'),origin={x:source.x+50,y:source.y};
    for(const className of ['bjs-powered-by','bpmn-xyflow-palette','bpmn-xyflow-editor-actions','bpmn-xyflow-minimap']){
      m.select([]);m.select(source.id);h.move(origin,source);const handle=h.port(),grab=portPoint(h),anchor=markerPoint(h);
      const middle={x:(anchor.x+grab.x)/2,y:(anchor.y+grab.y)/2};h.move(middle,source);
      const overlay=document.createElement('div');overlay.className=className;m.getContainer().appendChild(overlay);
      const control=document.createElement(className==='bjs-powered-by'?'a':'button');overlay.appendChild(control);
      const before=await m.getXML(),count=m.commandStack.size();h.leave(middle,control);h.move(middle,control);
      assert.ok(h.port()===handle);assert.deepEqual(markerPoint(h),anchor);
      let presses=0;control.addEventListener('mousedown',()=>presses++);
      const event=new window.MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0});control.dispatchEvent(event);
      assert.equal(presses,1);assert.equal(event.defaultPrevented,false,'HTML control still owns its ordinary input');
      h.move({x:middle.x+20,y:middle.y},control);assert.ok(!h.port(),'departing the measured corridor releases source');await unchanged(m,before,count);overlay.remove();
    }
    for(const outsideEditor of [false,true]){
      m.select([]);m.select(source.id);h.move(origin,source);const grab=portPoint(h),middle={x:(origin.x+grab.x)/2,y:(origin.y+grab.y)/2};h.move(middle,source);
      const overlay=document.createElement('div');overlay.className=outsideEditor?'bjs-powered-by':'unrelated-overlay';(outsideEditor?document.body:m.getContainer()).appendChild(overlay);
      const before=await m.getXML(),count=m.commandStack.size();h.leave(middle,overlay);h.move(middle,overlay);
      assert.ok(!h.port(),'arbitrary HTML overlay or editor exit cannot retain source ownership');await unchanged(m,before,count);overlay.remove();
    }
  }finally{h.close();}
});

test('D15: clipped selected midpoint/corner grabs stay reachable through fine choice, click/retry, cancel and history', async () => {
  const h = await fixture(), { m } = h;
  try {
    const source = m.getElement('Task_1'), svg = m.getSvg(), container = m.getContainer();
    const target=m.addShape('bpmn:EndEvent',{x:750,y:350});
    svg.getBoundingClientRect = () => container.getBoundingClientRect();
    const positions = [
      [{x:source.x,y:source.y+40},{x:4,y:350},{x:0,y:1}],
      [{x:source.x+source.width,y:source.y+40},{x:1184,y:350},{x:0,y:1}],
      [{x:source.x+50,y:source.y},{x:590,y:4},{x:1,y:0}],
      [{x:source.x+50,y:source.y+source.height},{x:590,y:758},{x:1,y:0}],
      ...[[0,0,4,4],[1,0,1184,4],[0,1,4,758],[1,1,1184,758]].map(([right,bottom,x,y]) => [
        projectRoundedTask(source,10,{x:source.x+(right?source.width:0),y:source.y+(bottom?source.height:0)}),{x,y},null])
    ];
    for (const selected of [false,true]) for (const zoom of [.2,.5,1,2,4]) for (const [anchor,screen,tangent] of positions) {
      const viewport = {x:screen.x-anchor.x*zoom,y:screen.y-anchor.y*zoom,zoom};
      await m.setViewport(viewport); m.select(selected?source.id:[]);
      const before = await m.getXML(), count = m.commandStack.size();
      h.move(anchor,source); const chosen=markerPoint(h);
      assert.ok(Math.hypot(chosen.x-anchor.x,chosen.y-anchor.y)<1e-8,'projected point differs only by affine floating-point precision');
      const handle = h.port(), grab = portPoint(h);
      const at = {x:viewport.x+grab.x*zoom,y:viewport.y+grab.y*zoom};
      assert.ok(at.x>=6.75-1e-8&&at.x<=1188-6.75+1e-8&&at.y>=6.75-1e-8&&at.y<=762-6.75+1e-8,'whole painted grab has a visible margin');
      assert.ok(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)*zoom>=12-1e-8);
      assert.equal(Number(handle.querySelector('.bpmn-xyflow-connect-hit').getAttribute('r'))*zoom,5.75);
      if(tangent){
        const next={x:anchor.x+tangent.x/zoom,y:anchor.y+tangent.y/zoom};
        h.move(next,source);const fine=markerPoint(h);assert.ok(Math.hypot(fine.x-next.x,fine.y-next.y)<1e-8,'one CSSpx perimeter change still chooses a fresh origin');
        h.move(anchor,source);assert.deepEqual(markerPoint(h),chosen);
      }
      const steps=Math.ceil(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)*zoom);
      for(let step=1;step<=steps;step++){
        const fraction=step/steps;
        const point={x:anchor.x+(grab.x-anchor.x)*fraction,y:anchor.y+(grab.y-anchor.y)*fraction};
        h.hover(point,fraction===1?handle.querySelector('.bpmn-xyflow-connect-hit'):source);
        h.move(point,fraction===1?handle.querySelector('.bpmn-xyflow-connect-hit'):source);
        assert.equal(h.port(),handle);assert.deepEqual(markerPoint(h),chosen);assert.deepEqual(portPoint(h),grab);
      }
      h.press(grab);h.up(grab,source);await unchanged(m,before,count);
      assert.deepEqual(markerPoint(h),chosen);assert.deepEqual(portPoint(h),grab);
      h.press(grab);h.move({x:grab.x+30/zoom,y:grab.y+30/zoom},source);h.key('Escape');h.up(grab,source);
      await unchanged(m,before,count);
      h.move(anchor,source);const retry=portPoint(h);h.press(retry);
      const end={x:target.x,y:target.y+target.height/2};
      h.move(end,target);h.up(end,target);
      const edge=m.getGraph().edges.at(-1);assert.equal(edge.source,source);assert.deepEqual(xy(edge.waypoints[0]),chosen);
      const after=await m.getXML();await history(m,before,after);assert.equal(m.undo(),true);
    }
  }finally{h.close();}
});

test('D15: real chrome rectangles constrain placement; full occlusion creates no hidden press target', async () => {
  const h=await fixture(),{m}=h;
  try{
    const source=m.getElement('Task_1'),anchor={x:source.x+source.width,y:source.y+40};
    const before=await m.getXML(),count=m.commandStack.size();m.select(source.id);
    const overlay=document.createElement('div');overlay.className='bpmn-xyflow-minimap';m.getContainer().appendChild(overlay);
    overlay.getBoundingClientRect=()=>({left:anchor.x+8,top:anchor.y-80,right:anchor.x+200,bottom:anchor.y+80,width:192,height:160});
    h.move(anchor,source);const grab=portPoint(h);assert.ok(grab.x+5.75<anchor.x+8||grab.y+5.75<anchor.y-80||grab.y-5.75>anchor.y+80);
    overlay.getBoundingClientRect=()=>m.getContainer().getBoundingClientRect();h.move(anchor,source);
    assert.equal(h.port(),null);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-hit'),null);
    overlay.remove();h.move(anchor,source);assert.ok(h.port());await unchanged(m,before,count);
  }finally{h.close();}
});

test('D15: a partially visible canvas intersects browser and visual viewport limits without pan or history', async () => {
  const h=await fixture(),{m}=h,descriptor=Object.getOwnPropertyDescriptor(window,'visualViewport');
  try{
    const source=m.getElement('Task_1'),anchor={x:source.x+source.width,y:source.y+40};
    const before=await m.getXML(),count=m.commandStack.size();m.select(source.id);
    window.innerWidth=900;window.innerHeight=500;
    for(const visual of [null,{offsetLeft:70,offsetTop:20,width:700,height:350}]){
      Object.defineProperty(window,'visualViewport',{configurable:true,value:visual});
      const right=visual?770:900,bottom=visual?370:500;
      const viewport={x:right-4-anchor.x,y:bottom-4-anchor.y,zoom:1};await m.setViewport(viewport);
      h.move(anchor,source);const grab=portPoint(h);
      assert.ok(grab.x+viewport.x+6.75<=right&&grab.y+viewport.y+6.75<=bottom);
      assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(m.getViewport(),viewport);await unchanged(m,before,count);
    }
  }finally{
    if(descriptor)Object.defineProperty(window,'visualViewport',descriptor);else delete window.visualViewport;
    h.close();
  }
});

test('F23-T: acquired source tether survives context-pad exit over an existing route and remains reusable', async () => {
  const h=await fixture(),{m}=h;
  try{
    window.innerWidth=1800;window.innerHeight=1200;
    m.getContainer().getBoundingClientRect=()=>({left:0,top:0,right:1800,bottom:1200,width:1800,height:1200});
    const source=m.getElement('Task_1');m.moveShape(source,{x:-315-source.x,y:-100-source.y});
    const target=m.addShape('bpmn:Task',{x:9,y:-157});
    const edge=m.connect(source,target);m.updateWaypoints(edge,[{x:-215,y:-60.163732815549736},{x:-103,y:-60.163732815549736},{x:-103,y:-117.16373281554974},{x:9,y:-117.16373281554974}]);
    const viewport={x:1177.5051283563844,y:773.8441792855494,zoom:1.05701804056138};await m.setViewport(viewport);m.select(source.id);
    const pad=m.getContainer().querySelector('.bpmn-xyflow-context-pad');
    pad.getBoundingClientRect=()=>({left:956.2443127669906,top:668,right:1018.2443127669906,bottom:842,width:62,height:174});
    const graph=x=>({x:(x-viewport.x)/viewport.zoom,y:(710-viewport.y)/viewport.zoom});
    const resize=m.getContainer().querySelector('[data-resize-dir="e"]'),line=h.gfx(edge).querySelector('.bpmn-xyflow-connection-visual');
    const before=await m.getXML(),count=m.commandStack.size();
    h.hover(graph(950),resize);h.move(graph(950),resize);
    const handle=h.port(),anchor=markerPoint(h),grab=portPoint(h);
    for(const x of [959,969,979,989,998,1008,1018,1028]){
      const hit=x<1018?pad:x===1018?line:handle.querySelector('.bpmn-xyflow-connect-hit');
      h.hover(graph(x),hit);h.move(graph(x),hit);
      assert.ok(h.port()===handle,'crossing the old edge must not replace the already-displayed source control at x='+x);
      assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
    }
    h.press(grab);h.up(grab,source);await unchanged(m,before,count);
    h.press(grab);const end={x:target.x,y:target.y+30};h.move(end,target);h.up(end,target);
    assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);
    assert.deepEqual(edge.waypoints.map(xy),[{x:-215,y:-60.163732815549736},{x:-103,y:-60.163732815549736},{x:-103,y:-117.16373281554974},{x:9,y:-117.16373281554974}]);
    await history(m,before,await m.getXML());
  }finally{h.close();}
});

test('D16: leaving a reached source grab gives the underlying edge hover ownership outside its paint', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1');m.moveShape(source,{x:180-source.x,y:200-source.y});
    const upper=m.addShape('bpmn:Task',{x:100,y:146}),target=m.addShape('bpmn:Task',{x:660,y:200});
    const edge=m.connect(upper,target);m.updateWaypoints(edge,[{x:200,y:186},{x:400,y:186},{x:400,y:240},{x:660,y:240}]);
    const line=h.gfx(edge).querySelector('.bpmn-xyflow-connection-visual');
    for(const zoom of [1,.5,2,4]) for(const direction of [1,-1]) {
      await m.setViewport({x:370-230*zoom,y:348-200*zoom,zoom});m.select([]);m.select(source.id);
      const before=await m.getXML(),count=m.commandStack.size(),selection=m.getSelection(),viewport=m.getViewport();
      const anchor={x:230,y:200};h.hover(anchor,source);h.move(anchor,source);
      const handle=h.port(),chosen=markerPoint(h),grab=portPoint(h),hit=handle.querySelector('.bpmn-xyflow-connect-hit');
      if(zoom===1)assert.deepEqual(grab,{x:230,y:185.99},'exact hosted grab geometry');
      const steps=Math.ceil(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)*zoom);
      for(let n=1;n<=steps;n++){
        const point={x:anchor.x+(grab.x-anchor.x)*n/steps,y:anchor.y+(grab.y-anchor.y)*n/steps};
        const receiver=n===steps?hit:source;h.hover(point,receiver);h.move(point,receiver);
        assert.equal(h.port(),handle,'small-step acquisition stays stable');assert.deepEqual(markerPoint(h),chosen);
      }
      const inside={x:grab.x+direction*5/zoom,y:grab.y};h.hover(inside,hit);h.move(inside,hit);assert.equal(h.port(),handle,'ordinary motion within painted grab stays acquired');
      const arrival=zoom===1?{x:230,y:186}:grab;
      for(let n=0;n<3;n++){h.hover(arrival,hit);h.move(arrival,hit);assert.equal(h.port(),handle,'duplicate pointer/mouse events at the painted grab are stable');}
      const outside={x:grab.x+direction*7/zoom,y:zoom===1?186:grab.y};
      assert.ok(Math.hypot(outside.x-grab.x,outside.y-grab.y)*zoom>5.75);
      assert.ok(Math.hypot(outside.x-grab.x,outside.y-grab.y)*zoom<8);
      h.hover(outside,line);h.move(outside,line);
      assert.ok(!h.port(),'arrival is over: leaving painted grab must release the obsolete source tool');
      const hover=m.getContainer().querySelector('.bpmn-xyflow-hover-controls');assert.equal(hover?.getAttribute('data-element-id'),edge.id,'the actual underlying edge receives its ordinary hover controls');
      h.hover(outside,line);h.move(outside,line);assert.ok(!h.port(),'duplicate departure events cannot reacquire source');
      await unchanged(m,before,count);assert.deepEqual(m.getSelection(),selection);assert.deepEqual(m.getViewport(),viewport);
      h.bodyPress(outside,edge);h.up(outside,edge);assert.deepEqual(m.getSelection(),[edge.id]);await unchanged(m,before,count);
    }
  }finally{h.close();}
});

test('F05/D15: a selected pool beside its right context pad retains a reachable exact source after an invalid loop', async () => {
  const h=await fixture(),{m}=h;
  try{
    window.innerWidth=1800;window.innerHeight=1200;
    m.getContainer().getBoundingClientRect=()=>({left:0,top:0,right:1800,bottom:1200,width:1800,height:1200});
    await m.importXML(await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8'));
    const source=m.getElement('BuyerPool'),target=m.getElement('SellerPool');
    const viewport={x:420.6476373682847,y:346.1470149483662,zoom:.881178045639757};await m.setViewport(viewport);m.select(source.id);
    const right=viewport.x+(source.x+source.width)*viewport.zoom;
    const pad=m.getContainer().querySelector('.bpmn-xyflow-context-pad');
    pad.getBoundingClientRect=()=>({left:right+6,top:367,right:right+68,bottom:485,width:62,height:118});
    const point={x:(1724-viewport.x)/viewport.zoom,y:(447-viewport.y)/viewport.zoom};
    const before=await m.getXML(),count=m.commandStack.size();h.move(point,source);
    const anchor=markerPoint(h),grab=portPoint(h),radius=5.75/viewport.zoom;
    assert.equal(anchor.x,1480);assert.ok(grab.x*viewport.zoom+viewport.x+6.75<=1800);
    assert.ok(grab.x+radius<(right+6-viewport.x)/viewport.zoom,'grab clears the actual right context pad');
    h.press(grab);h.move({x:source.x+source.width,y:source.y+20},source);h.up({x:source.x+source.width,y:source.y+20},source);
    await unchanged(m,before,count);
    h.move(point,source);const retry=portPoint(h);h.press(retry);const end={x:target.x+target.width,y:target.y+50};h.move(end,target);h.up(end,target);
    const edge=m.getGraph().edges.at(-1);assert.equal(edge.type,'bpmn:MessageFlow');assert.equal(edge.source,source);assert.equal(edge.target,target);
    assert.deepEqual(xy(edge.waypoints[0]),anchor);await history(m,before,await m.getXML());
  }finally{h.close();}
});

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
      h.move(start, source); assert.equal(Number(h.port().querySelector('.bpmn-xyflow-connect-hit').getAttribute('r')) * zoom, 5.75);
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
    const start={x:source.x,y:source.y+20};h.move(start,source);assert.ok(h.port());await m.setViewport({x:20,y:40,zoom:.5});h.move(start,source);assert.equal(Number(h.port().querySelector('.bpmn-xyflow-connect-hit').getAttribute('r')),11.5);
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

test('selected SW native approach acquires the actual outline before retaining its outward grab', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.addShape('bpmn:Task',{x:-263,y:-117}), target=m.addShape('bpmn:Task',{x:59,y:-117});
    const viewport={x:1177.5051283563844,y:725.8441792855494,zoom:1.05701804056138};
    await m.setViewport(viewport);m.select(source.id);
    const before=await m.getXML(),count=m.commandStack.size();
    // The eight trusted positions from AO-repeat-local-selected-sw at5c0c5e4.
    // Its last point hits Resize, after the previous point remains inside Task.
    const positions=[[893,655],[887,659],[880,664],[874,669],[868,674],[862,679],[855,684],[849,689]];
    const graph=([x,y])=>({x:(x-viewport.x)/viewport.zoom,y:(y-48-viewport.y)/viewport.zoom});
    const shape=h.gfx(source).querySelector('.bpmn-xyflow-shape-hit'), resize=m.getContainer().querySelector('[data-resize-dir="sw"]');
    for(let index=0;index<positions.length;index++){
      const point=graph(positions[index]),hit=index===positions.length-1?resize:shape;
      h.hover(point,hit);h.move(point,hit);
    }
    const expected=projectRoundedTask(source,10,graph(positions.at(-1))),anchor=markerPoint(h),grab=portPoint(h);
    assert.ok(Math.hypot(anchor.x-expected.x,anchor.y-expected.y)<1e-8,'final marker follows final native outline choice, not the earlier body projection');
    const earlier=projectRoundedTask(source,10,graph(positions.at(-2)));
    assert.ok(Math.hypot(anchor.x-earlier.x,anchor.y-earlier.y)>.4,'the reproduced two outline choices are distinct');
    for(const fraction of [.2,.5,.8,1]){
      const at={x:anchor.x+(grab.x-anchor.x)*fraction,y:anchor.y+(grab.y-anchor.y)*fraction};
      const hit=fraction===1?h.port().querySelector('.bpmn-xyflow-connect-hit'):resize;
      h.hover(at,hit);h.move(at,hit);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
    }
    await unchanged(m,before,count);
    h.press(grab);h.up(grab,source);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);await unchanged(m,before,count);
    h.press(grab);const end={x:target.x,y:target.y+25};h.move(end,target);assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));h.up(end,target);
    assert.deepEqual(xy(m.getGraph().edges.at(-1).waypoints[0]),anchor);assert.equal(m.commandStack.size(),count+1);await history(m,before,await m.getXML());
  } finally {h.close();}
});

test('selected midpoint tangent tracking and direct body-to-grab acquisition retain distinct intent', async () => {
  const h=await fixture(),{m}=h;
  try {
    const source=m.getElement('Task_1');
    for(const dir of ['n','e','s','w']){
      m.select([]);m.select(source.id);const before=await m.getXML(),count=m.commandStack.size();
      const vertical=dir==='e'||dir==='w',mid={x:source.x+(dir==='w'?0:dir==='e'?source.width:source.width/2),y:source.y+(dir==='n'?0:dir==='s'?source.height:source.height/2)};
      const resize=m.getContainer().querySelector(`[data-resize-dir="${dir}"]`);
      h.move(mid,resize);assert.deepEqual(markerPoint(h),mid);
      for(const distance of [1,2,4]){
        const tangent={x:mid.x+(vertical?0:distance),y:mid.y+(vertical?distance:0)};
        h.hover(tangent,resize);h.move(tangent,resize);assert.deepEqual(markerPoint(h),tangent,'fine along-border motion chooses a new origin');
      }
      const body={x:source.x+source.width/2,y:source.y+source.height/2},opposite={x:vertical?source.x+source.width/2:source.x,y:vertical?source.y:source.y+source.height/2};
      h.hover(body,source);h.move(body,source);h.hover(opposite,source);h.move(opposite,source);assert.deepEqual(markerPoint(h),opposite,'body traversal releases the old acquired side');
      m.select([]);m.select(source.id);
      const center={x:source.x+source.width/2,y:source.y+source.height/2},inside={x:mid.x+(center.x-mid.x)*.25,y:mid.y+(center.y-mid.y)*.25};
      h.move(inside,source);const anchor=markerPoint(h),grab=portPoint(h),hit=h.port().querySelector('.bpmn-xyflow-connect-hit');
      assert.ok(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)>0);
      h.hover(grab,hit);h.move(grab,hit);assert.deepEqual(markerPoint(h),anchor,'hitting the displayed grab claims its displayed origin directly');assert.deepEqual(portPoint(h),grab);
      h.press(grab);h.up(grab,source);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);await unchanged(m,before,count);
    }
  } finally {h.close();}
});

test('source press area equals visible grab paint across shape families and zooms without narrowing the approach corridor', async () => {
  const h=await fixture(),{m}=h;
  try {
    const shapes=[m.getElement('Task_1'),m.getElement('StartEvent_1'),m.addShape('bpmn:ExclusiveGateway',{x:700,y:350})];
    for(const zoom of [.5,.65,1,1.4,2]){
      await m.setViewport({x:140,y:100,zoom});
      for(const source of shapes){
        m.select([]);const point={x:source.x+source.width/2,y:source.y};h.move(point,source);
        const before=await m.getXML(),count=m.commandStack.size(),handle=h.port(),port=handle.querySelector('.bpmn-xyflow-connect-port'),hit=handle.querySelector('.bpmn-xyflow-connect-hit');
        const paint=(Number(port.getAttribute('r'))+parseFloat(port.style['stroke-width'])/2)*zoom,press=Number(hit.getAttribute('r'))*zoom;
        assert.ok(Math.abs(paint-5.75)<1e-12);assert.ok(Math.abs(press-paint)<1e-12,'transparent control has no clickable padding outside visible paint');
        assert.equal(port.style['pointer-events'],'visiblePainted');assert.equal(hit.style['pointer-events'],'all');
        const anchor=markerPoint(h),grab=portPoint(h);
        if(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)>1e-8){
          assert.ok(Math.hypot(grab.x-anchor.x,grab.y-anchor.y)*zoom>=12-1e-8);
          const nx=(grab.x-anchor.x)/Math.hypot(grab.x-anchor.x,grab.y-anchor.y),ny=(grab.y-anchor.y)/Math.hypot(grab.x-anchor.x,grab.y-anchor.y);
          const near={x:(anchor.x+grab.x)/2-ny*6/zoom,y:(anchor.y+grab.y)/2+nx*6/zoom};
          // An already acquired outward approach retains the old eight-pixel
          // travel tolerance even at points outside the new painted press disc.
          const halfway={x:(anchor.x+grab.x)/2,y:(anchor.y+grab.y)/2};h.move(halfway,source);h.move(near,source);assert.deepEqual(markerPoint(h),anchor);assert.deepEqual(portPoint(h),grab);
        }
        h.press(grab);h.up(grab,source);assert.deepEqual(markerPoint(h),anchor);await unchanged(m,before,count);
        assert.doesNotMatch((await m.saveSVG()).svg,/bpmn-xyflow-connect-(?:handle|port|hit)/);
      }
    }
  } finally {h.close();}
});

test('registered ordinary owner, neighboring-shape and crossing-edge clicks remain available outside visible port paint', async () => {
  for(const kind of ['owner','neighbor','edge']){
    const h=await fixture(),{m}=h;
    try {
      const source=m.getElement('Task_1'),zoom=1.4;await m.setViewport({x:140,y:100,zoom});
      const anchor={x:source.x+source.width,y:source.y+20},delta=7/zoom;
      let recipient=source,point={x:anchor.x-delta,y:anchor.y};
      if(kind==='neighbor'){
        recipient=m.addShape('bpmn:Task',{x:anchor.x+6.5/zoom+50,y:anchor.y});point={x:anchor.x+delta,y:anchor.y};
      } else if(kind==='edge'){
        point={x:anchor.x+delta,y:anchor.y};
        const upper=m.addShape('bpmn:Task',{x:point.x,y:source.y-130}),lower=m.addShape('bpmn:Task',{x:point.x,y:source.y+150});
        recipient=m.connect(upper,lower,{waypoints:[{x:point.x,y:upper.y+upper.height},{x:point.x,y:lower.y}]});assert.ok(recipient);
      }
      m.select([]);h.move(anchor,source);const grab=portPoint(h),hit=h.port().querySelector('.bpmn-xyflow-connect-hit');
      assert.deepEqual(grab,anchor);assert.ok(Math.hypot(point.x-grab.x,point.y-grab.y)*zoom>Number(hit.getAttribute('r'))*zoom);
      assert.ok(Math.hypot(point.x-grab.x,point.y-grab.y)*zoom<8,'point lies in the old invisible halo');
      const before=await m.getXML(),count=m.commandStack.size();
      // These registered-handler assertions do not substitute for browser hit
      // testing: the native hit suite independently checks the actual receiver.
      h.bodyPress(point,recipient);h.up(point,recipient);assert.deepEqual(m.getSelection(),[recipient.id]);await unchanged(m,before,count);
      assert.ok(!m.getContainer().querySelector('.bpmn-xyflow-connect-preview'));
    } finally {h.close();}
  }
});
