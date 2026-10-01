import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(() => dom.cleanup());
const xy = edge => edge.waypoints.map(({ x, y }) => ({ x, y }));

// These are registered-handler/lifecycle tests, not native hit-test evidence.
// The paired Chromium suite exercises the actual SVG hit and pointer stream.
async function harness() {
  const callbacks = new WeakMap(), restorers = [];
  for (const object of [ dom.window.HTMLElement.prototype, dom.window.SVGElement.prototype, window ]) {
    const add = object.addEventListener, remove = object.removeEventListener;
    object.addEventListener = function(type, callback, options) { const list = callbacks.get(this) || []; list.push({ type, callback, removed: false }); callbacks.set(this, list); return add.call(this, type, callback, options); };
    object.removeEventListener = function(type, callback, options) { for (const item of callbacks.get(this) || []) if (item.type === type && item.callback === callback) item.removed = true; return remove.call(this, type, callback, options); };
    restorers.push(() => { object.addEventListener = add; object.removeEventListener = remove; });
  }
  const oldHit = document.elementsFromPoint; let target = null;
  document.elementsFromPoint = () => target ? [ target ] : [];
  const modelers = [];
  async function create() {
    const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, editorActions: false, snap: false });
    modelers.push(m); await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'));
    const a = m.addShape('bpmn:Task', { x: 300, y: 300 }), b = m.addShape('bpmn:Task', { x: 700, y: 300 }), c = m.addShape('bpmn:Task', { x: 700, y: 550 });
    const edge = m.connect(a, b), other = m.connect(b, c); m.clearSelection(); m.setViewport({ x: 50, y: 75, zoom: .65 });
    const gfx = element => m.getContainer().querySelector(`[data-element-id="${element.id}"]`);
    const event = (node, p, extra = {}) => { const v = m.getViewport(), r = m.getSvg().getBoundingClientRect(); return { target: node, button: 0, clientX: r.left + v.x + p.x * v.zoom, clientY: r.top + v.y + p.y * v.zoom, preventDefault() {}, stopPropagation() {}, ...extra }; };
    const call = (element, type, ev, name) => { const entries = (callbacks.get(element) || []).filter(e => !e.removed && e.type === type && e.callback.name === name); assert.ok(entries.length, `${name} registered`); entries.forEach(e => e.callback.call(element, ev)); };
    return { m, a, b, c, edge, other, gfx, event,
      target(node) { target = node && gfx(node); },
      hover(node, p) { call(window, 'mousemove', event(gfx(node), p), 'onMouseMove'); },
      move(p, node = target) { call(window, 'mousemove', event(node, p), 'onMouseMove'); },
      moveEvent(p, overrides) { call(window, 'mousemove', event(target, p, overrides), 'onMouseMove'); },
      down(node, p, extra) { call(m.getSvg(), 'mousedown', event(node, p, extra), 'onMouseDown'); },
      up(p, node = target, extra) { call(window, 'mouseup', event(node, p, extra), 'onMouseUp'); },
      leave() { call(m.getSvg(), 'pointerleave', {}, 'onHoverLeave'); },
      blur() { call(window, 'blur', {}, 'onWindowBlur'); },
      escape() { call(window, 'keydown', { key: 'Escape', preventDefault() {} }, 'onWindowKeyDown'); },
      dblclick(node, p) { call(m.getSvg(), 'dblclick', event(node, p), 'onDblClick'); },
      enterShape(node,p) { call(m.getSvg(),'pointermove',event(gfx(node),p), ''); },
      group() { return m.getContainer().querySelector('.bpmn-xyflow-hover-controls'); },
      handle(index) { return m.getContainer().querySelector(`.bpmn-xyflow-hover-bendpoint[data-bend-index="${index}"] circle.bpmn-xyflow-hover-bendpoint-hit`); },
      detached() { return (callbacks.get(m.getSvg()) || []).filter(e => e.callback.name === 'onHoverLeave').every(e => e.removed); }
    };
  }
  return { create, close() { modelers.forEach(m => m.destroy()); document.elementsFromPoint = oldHit; restorers.reverse().forEach(fn => fn()); } };
}
async function exactHistory(m, before, after) { for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), after); } assert.deepEqual((await new BpmnModdle().fromXML(after)).warnings, []); }

test('hover controls are graph-sized, selection-free and independent from selected controls', async () => {
  const root = await harness(), h = await root.create(), { m, edge, other } = h;
  try {
    const xml = await m.getXML(), size = m.commandStack.size();
    for (const zoom of [.2, .65, 1, 2.5]) {
      m.setViewport({ x: 50, y: 75, zoom }); h.hover(edge, { x: 480, y: 300 });
      assert.equal(h.group().getAttribute('data-element-id'), edge.id); assert.equal(h.handle(0).getAttribute('r'), '10'); assert.deepEqual(m.getSelection(), []);
      const hit = h.group().querySelector('.bpmn-xyflow-hover-segment-hit'); assert.equal(Number(hit.getAttribute('width')), Math.round(300 * 2 / 3)); assert.equal(hit.getAttribute('height'), '17');
      h.leave(); assert.equal(h.group(), null);
    }
    m.select(other.id); const selected = m.getContainer().querySelector('.bpmn-xyflow-bendpoint');
    h.hover(edge, { x: 480, y: 300 }); assert.ok(h.group()); assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoint'), selected); assert.deepEqual(m.getSelection(), [ other.id ]);
    h.hover(other, { x: 700, y: 430 }); assert.equal(h.group(), null); assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoint'), selected);
    m.select([ edge.id, other.id ]); h.hover(edge, { x: 480, y: 300 }); assert.equal(h.group(), null);
    assert.equal(await m.getXML(), xml); assert.equal(m.commandStack.size(), size);
  } finally { root.close(); }
});

test('unselected control click and up-to-five CSS-pixel jitter cannot alter route or history', async () => {
  const root = await harness(), h = await root.create(), { m, edge } = h;
  try {
    for (const pixels of [0, 1, 4, 5]) {
      m.clearSelection(); const before = await m.getXML(), size = m.commandStack.size(), start = { ...edge.waypoints[0] };
      h.hover(edge, start); const handle = h.handle(0); h.down(handle, start); h.move({ x: start.x, y: start.y + pixels / m.getViewport().zoom }, handle);
      assert.equal(await m.getXML(), before); h.up({ x: start.x, y: start.y + pixels / m.getViewport().zoom }, handle);
      assert.deepEqual(m.getSelection(), [ edge.id ]); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size);
    }
  } finally { root.close(); }
});

for (const side of ['source', 'target']) test(`unselected ${side} hover reconnect uses existing geometry, cancel and exact history`, async () => {
  const root = await harness(), h = await root.create(), { m, edge, c } = h;
  try {
    const index = side === 'source' ? 0 : edge.waypoints.length - 1, start = { ...edge.waypoints[index] }, destination = { x: c.x, y: c.y + 24.5 };
    const before = await m.getXML(), size = m.commandStack.size(), opposite = xy(edge)[side === 'source' ? edge.waypoints.length - 1 : 0];
    for (const cancel of [true, false]) {
      m.clearSelection(); h.hover(edge, start); h.down(h.handle(index), start); h.target(c); h.move(destination);
      assert.notEqual(await m.getXML(), before, 'real geometry preview activated'); assert.equal(h.group(), null); assert.deepEqual(m.getSelection(), []);
      if (cancel) { assert.equal(m.cancel(), true); h.up(destination); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size); }
      else h.up(destination);
    }
    assert.equal(edge[side], c); assert.deepEqual(xy(edge)[side === 'source' ? edge.waypoints.length - 1 : 0], opposite);
    assert.equal(m.commandStack.size(), size + 1); await exactHistory(m, before, await m.getXML());
  } finally { root.close(); }
});

test('hover classification preserves endpoint priority, middle segment move and outer or diagonal insertion', async () => {
  const root = await harness(), h = await root.create(), { m, edge } = h;
  try {
    const before = await m.getXML(), size = m.commandStack.size();
    for (const [start, kind] of [[{x:500,y:300},'segment'],[{x:370,y:300},'insert']]) {
      h.hover(edge, start); h.down(h.gfx(edge), start); h.target(null); h.move({x:start.x,y:390});
      assert.equal(edge.waypoints.length, kind === 'segment' ? 4 : 3); assert.notEqual(await m.getXML(), before);
      m.cancel(); h.up({x:start.x,y:390}); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), size);
    }
    m.updateWaypoints(edge, [{x:350,y:300},{x:650,y:420}]); const diagonal = await m.getXML(); m.clearSelection();
    h.hover(edge,{x:500,y:360}); assert.equal(h.group().querySelectorAll('.bpmn-xyflow-hover-segment').length,0);
    assert.equal(h.group().querySelector('.bpmn-xyflow-hover-floating').getAttribute('visibility'),'visible');
    h.down(h.gfx(edge),{x:500,y:360}); h.move({x:510,y:410}); assert.equal(edge.waypoints.length,3); m.cancel(); assert.equal(await m.getXML(),diagonal);
  } finally { root.close(); }
});

test('hover pending and active gestures clear on blur, history, import and destroy without stale instance state', async () => {
  const root = await harness(), h = await root.create(), { m, edge } = h;
  try {
    const before = await m.getXML(), start = { ...edge.waypoints[0] }, size = m.commandStack.size();
    h.hover(edge,start); h.down(h.handle(0),start); h.blur(); h.up(start,h.gfx(edge)); assert.equal(h.group(),null); assert.equal(await m.getXML(),before); assert.equal(m.commandStack.size(),size);
    h.hover(edge,start); h.down(h.handle(0),start); h.target(h.c); h.move({x:h.c.x,y:h.c.y+20}); h.blur(); assert.equal(await m.getXML(),before); assert.equal(m.commandStack.size(),size);
    h.hover(edge,start); h.down(h.handle(0),start); h.escape(); h.up(start,h.gfx(edge)); assert.equal(await m.getXML(),before); assert.equal(m.commandStack.size(),size);
    h.hover(edge,start); h.down(h.handle(0),start); h.target(h.c); h.move({x:h.c.x,y:h.c.y+20}); m.commandStack.undo(); assert.equal(h.group(),null); m.redo(); assert.equal(await m.getXML(),before);
    h.hover(edge,start); await m.importXML(before); assert.equal(h.group(),null); const imported=m.getElement(edge.id); h.hover(imported,start); assert.ok(h.group());
    const second=await root.create(); second.hover(second.edge,{x:500,y:300}); assert.ok(second.group()); h.leave(); assert.ok(second.group());
    m.destroy(); assert.equal(h.group(),null); assert.equal(h.detached(),true); assert.ok(second.group());
  } finally { root.close(); }
});

test('hovering a second edge preserves selected controls through activation and cancellation', async () => {
  const root=await harness(),h=await root.create(),{m,edge,other}=h;
  try {
    m.select(other.id);const before=await m.getXML(),selection=m.getSelection(),selected=m.getContainer().querySelector('.bpmn-xyflow-bendpoints');
    const start={...edge.waypoints[0]};h.hover(edge,start);h.down(h.handle(0),start);h.target(h.c);h.move({x:h.c.x,y:h.c.y+20});
    assert.equal(selected.style.display,'none');assert.deepEqual(m.getSelection(),selection);h.escape();h.up({x:h.c.x,y:h.c.y+20});
    assert.equal(selected.style.display,'');assert.deepEqual(m.getSelection(),selection);assert.equal(await m.getXML(),before);
    h.hover(edge,start);h.down(h.handle(0),start);m.select(h.a.id);h.up(start,h.gfx(edge));assert.deepEqual(m.getSelection(),[h.a.id]);assert.equal(await m.getXML(),before);
  }finally{root.close();}
});

test('hover promotion retains native hit identity and selected sizing at zoom extremes', async () => {
  const root=await harness(),h=await root.create(),{m,edge}=h;
  try {
    const before=await m.getXML();
    for(const zoom of [.2,1,3]){
      m.clearSelection();m.setViewport({x:50,y:75,zoom});const start={...edge.waypoints[0]};h.hover(edge,start);
      const hit=h.handle(0);h.down(hit,start);h.up(start,hit);
      assert.equal(hit.isConnected,true);assert.equal(hit.getAttribute('class'),'bpmn-xyflow-bendpoint-hit');assert.equal(Number(hit.getAttribute('r')),10/zoom);
      assert.equal(hit.getAttribute('data-element-id'),edge.id);assert.equal(hit.getAttribute('data-bend-index'),'0');
      assert.equal(Number(hit.getAttribute('cx')),start.x);assert.equal(Number(hit.getAttribute('cy')),start.y);
      assert.equal(hit.style['pointer-events'],'all');assert.equal(hit.parentNode.getAttribute('transform'),null);
      const visible=hit.parentNode.querySelector('.bpmn-xyflow-bendpoint');
      assert.equal(Number(visible.getAttribute('r')),4);assert.equal(visible.getAttribute('data-element-id'),edge.id);
      assert.equal(visible.getAttribute('data-bend-index'),'0');assert.equal(Number(visible.getAttribute('cx')),start.x);assert.equal(Number(visible.getAttribute('cy')),start.y);
      assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoints').getAttribute('pointer-events'),null);
      assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoints').style['pointer-events'],'');
      assert.equal(visible.style['pointer-events'],'');
      const segmentHit=m.getContainer().querySelector('.bpmn-xyflow-segment-handle rect');
      assert.ok(segmentHit);assert.equal(segmentHit.closest('[style*="pointer-events: none"]'),null,'selected segment target cannot inherit disabled hover-root pointer events');
      assert.equal(visible.style['stroke-width'],'1.5px');assert.equal(h.group(),null);assert.equal(await m.getXML(),before);
    }
  }finally{root.close();}
});

test('global non-Node and outside-SVG move targets preserve active shape and selected endpoint gestures', async () => {
  const root=await harness(),h=await root.create(),{m,a,c,edge}=h;
  const svg=m.getSvg(),contains=svg.contains;
  // Happy DOM accepts Window here; native Element.contains rejects it. Make
  // that native precondition explicit so this regression runs without Chrome.
  svg.contains=function(node){if(node != null && !node.nodeType)throw new TypeError('parameter 1 is not of type Node');return contains.call(this,node);};
  try {
    const detached=document.createElement('div'), outside=document.createElement('div');document.body.appendChild(outside);
    try {
      for(const target of [window,null,undefined,detached,outside]){
        const before=await m.getXML(),size=m.commandStack.size(),start={x:a.x+25,y:a.y+25};
        m.clearSelection();h.down(h.gfx(a),start);h.moveEvent({x:start.x+45,y:start.y+30},{target});
        assert.equal(a.x+25,start.x+45,'global event still reaches shape-move handler');assert.notEqual(await m.getXML(),before);
        h.escape();h.up(start,target);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
      }
      const before=await m.getXML(),size=m.commandStack.size(),start={...edge.waypoints.at(-1)};
      m.select(edge.id);const hit=m.getContainer().querySelector(`.bpmn-xyflow-bendpoint-hit[data-element-id="${edge.id}"][data-bend-index="${edge.waypoints.length-1}"]`);
      h.down(hit,start);h.target(c);h.move({x:c.x,y:c.y+24.5},window);assert.notEqual(await m.getXML(),before,'global move still reaches endpoint preview');
      h.up({x:c.x,y:c.y+24.5},window);assert.equal(edge.target,c);assert.equal(m.commandStack.size(),size+1);
      await exactHistory(m,before,await m.getXML());
      m.undo();m.clearSelection();h.hover(edge,{x:500,y:300});assert.ok(h.group());h.move({x:-200,y:-100},outside);
      assert.equal(h.group(),null,'leaving this SVG removes only the hover overlay');assert.equal(await m.getXML(),before);
    }finally{outside.remove();}
  }finally{svg.contains=contains;root.close();}
});

test('ordinary and promoted selected controls retain screen size across later viewport changes', async () => {
  const root=await harness(),h=await root.create(),{m,edge}=h;
  try {
    // D3 reads SVG width/height.baseVal for its extent. Happy DOM cannot
    // resolve the production 100% lengths, so supply this fixture's pixels.
    m.getSvg().setAttribute('width','1188');m.getSvg().setAttribute('height','762');
    const before=await m.getXML(),size=m.commandStack.size();
    const events=[];m.on('viewport.change',({viewport})=>events.push({...viewport}));
    for(const promoted of [false,true]){
      m.clearSelection();m.setViewport({x:50,y:75,zoom:1});
      if(promoted){const start={...edge.waypoints[0]};h.hover(edge,start);const hit=h.handle(0);h.down(hit,start);h.up(start,hit);}
      else m.select(edge.id);
      const hit=m.getContainer().querySelector('.bpmn-xyflow-bendpoint-hit');
      for(const zoom of [.2,3,.65,1]){
        const count=events.length,result=await m.setViewport({x:73,y:96,zoom});
        assert.equal(result.k,zoom,'setViewport retains the XYPanZoom completion result');
        assert.equal(events.length,count+1);assert.deepEqual(events.at(-1),m.getViewport());
        assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoint-hit'),hit,'zoom preserves endpoint target identity');
        assert.equal(Number(hit.getAttribute('r'))*zoom,10);
        const segment=m.getContainer().querySelector('.bpmn-xyflow-segment-handle rect');
        assert.equal(Number(segment.getAttribute('width'))*zoom,20);assert.equal(Number(segment.getAttribute('height'))*zoom,20);
        assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.deepEqual(m.getSelection(),[edge.id]);
      }
      const count=events.length,fit=m.fitView();assert.deepEqual(m.getViewport(),fit);assert.equal(events.length,count+1);
      assert.equal(m.getContainer().querySelector('.bpmn-xyflow-bendpoint-hit'),hit);assert.equal(Number(hit.getAttribute('r'))*fit.zoom,10);
      assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
      assert.throws(()=>m.setViewport({x:0,y:0,zoom:NaN}),/finite/);assert.equal(events.length,count+1,'invalid viewport emits no change');
    }
  }finally{root.close();}
});

test('promoted selected hit circles edit their exact source, target and interior owner at every zoom', async () => {
  const root=await harness();
  try {
    for(const zoom of [.2,1,3])for(const kind of ['source','target','interior']){
      const h=await root.create(),{m,edge,other,c}=h;
      m.updateWaypoints(edge,[{x:350,y:300},{x:500,y:390},{x:650,y:300}]);m.clearSelection();m.setViewport({x:50,y:75,zoom});
      const index=kind==='source'?0:kind==='target'?2:1,start={...edge.waypoints[index]};
      const before=await m.getXML(),size=m.commandStack.size(),otherPoints=xy(other),opposite={...edge.waypoints[kind==='source'?2:0]};
      h.hover(edge,start);const hit=h.handle(index);h.down(hit,start);h.up(start,hit);
      assert.deepEqual(m.getSelection(),[edge.id]);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
      const destination=kind==='interior'?{x:535,y:425}:{x:c.x,y:c.y+24.5};
      h.down(hit,start);h.target(kind==='interior'?null:c);h.move(destination);assert.notEqual(await m.getXML(),before,'selected promoted control activates actual route preview');
      h.up(destination);assert.deepEqual(xy(other),otherPoints);assert.equal(m.commandStack.size(),size+1);
      if(kind==='interior')assert.deepEqual(xy(edge)[index],destination);
      else {assert.equal(edge[kind],c);assert.deepEqual(xy(edge)[kind==='source'?edge.waypoints.length-1:0],opposite);}
      await exactHistory(m,before,await m.getXML());m.destroy();
    }
  }finally{root.close();}
});

test('hovered B double-click resolves B even while A is selected; selected removal remains exact', async () => {
  const root=await harness(),h=await root.create(),{m,edge,other}=h;
  try {
    m.updateWaypoints(edge,[{x:350,y:300},{x:500,y:390},{x:650,y:300}]);m.updateWaypoints(other,[{x:700,y:340},{x:800,y:430},{x:700,y:510}]);
    m.select(other.id);const before=await m.getXML(),otherPoints=xy(other);h.hover(edge,{x:500,y:390});const hit=h.handle(1);
    h.dblclick(hit,{x:500,y:390});assert.equal(edge.waypoints.length,2);assert.deepEqual(xy(other),otherPoints);await exactHistory(m,before,await m.getXML());
    m.undo();m.clearSelection();h.hover(edge,{x:500,y:390});const retained=h.handle(1);h.down(retained,{x:500,y:390});h.up({x:500,y:390},retained);assert.equal(retained.isConnected,true);
    h.dblclick(retained,{x:500,y:390});assert.equal(edge.waypoints.length,2);assert.deepEqual(xy(other),otherPoints);m.undo();assert.equal(await m.getXML(),before);
  }finally{root.close();}
});

test('activated hover out-and-back is exact and leaving for a shape restores its create port', async () => {
  const root=await harness(),h=await root.create(),{m,edge,a}=h;
  try {
    const before=await m.getXML(),size=m.commandStack.size(),start={...edge.waypoints[0]};
    h.hover(edge,start);h.down(h.handle(0),start);h.target(h.c);h.move({x:h.c.x,y:h.c.y+25});assert.notEqual(await m.getXML(),before);
    h.move(start);h.up(start,h.gfx(edge));assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    m.clearSelection();const port={x:a.x+a.width,y:a.y+a.height/2};h.enterShape(a,port);assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-handle'));
    h.hover(edge,{x:480,y:300});assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-handle'),null);
    h.enterShape(h.c,{x:h.c.x+h.c.width,y:h.c.y+h.c.height/2});h.hover(h.c,{x:h.c.x+h.c.width,y:h.c.y+h.c.height/2});assert.equal(h.group(),null);assert.ok(m.getContainer().querySelector('.bpmn-xyflow-connect-handle'));
    assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  }finally{root.close();}
});

test('hover controls are excluded from standalone SVG and clear after deletion/undo', async () => {
  const root=await harness(),h=await root.create(),{m,edge}=h;
  try {
    const before=await m.getXML();h.hover(edge,{x:500,y:300});const exported=await m.saveSVG();assert.ok(!exported.svg.includes('bpmn-xyflow-hover-'));assert.ok(exported.svg.includes(edge.id));assert.equal(await m.getXML(),before);
    m.delete(edge);assert.equal(h.group(),null);m.undo();assert.equal(await m.getXML(),before);h.hover(m.getElement(edge.id),{x:500,y:300});assert.ok(h.group());
  }finally{root.close();}
});
