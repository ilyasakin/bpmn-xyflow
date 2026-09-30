import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setupDOM } from '../helpers/dom.mjs';
import { BpmnModdle } from 'bpmn-moddle';
let dom, Modeler;
before(async () => { dom = await setupDOM(); ({ default: Modeler } = await dom.loadModule('/lib/Modeler.js')); });
after(async () => dom.cleanup());

// Structural transition tests invoke registered callbacks directly. Native
// hit-testing, browser coordinates and mouse input are covered separately by
// browser-connections.mjs; no synthetic DOM dispatch is used here.
async function fixture() {
  const callbacks = new WeakMap(), restore = [];
  function trace(target) {
    const add = target.addEventListener;
    target.addEventListener = function(type, callback, options) {
      const events = callbacks.get(this) || []; events.push({ type, callback, options }); callbacks.set(this, events);
      return add.call(this, type, callback, options);
    };
    restore.push(() => { target.addEventListener = add; });
  }
  trace(dom.window.HTMLElement.prototype);
  const m = new Modeler({ container: dom.createContainer(), fitViewOnInit: false, palette: false, editorActions: false, snap: false });
  trace(m.getSvg()); trace(window);
  await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn', 'utf8'));
  const hit = document.elementsFromPoint;
  let target = null;
  document.elementsFromPoint = () => target ? [ target ] : [];
  const gfx = node => m.getContainer().querySelector(`[data-element-id="${node.id}"]`);
  const event = (node, point, extra = {}) => {
    const v = m.getViewport(), r = m.getContainer().getBoundingClientRect();
    return { target: node, button: 0, clientX: r.left + v.x + point.x * v.zoom, clientY: r.top + v.y + point.y * v.zoom,
      preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra };
  };
  const invoke = (node, type, ev, name) => {
    const listeners = (callbacks.get(node) || []).filter(entry => entry.type === type && (!name || entry.callback.name === name));
    assert.ok(listeners.length, `registered ${type} ${name || ''}`);
    for (const entry of listeners) entry.callback.call(node, ev);
  };
  return { m, gfx, event, invoke, target(node) { target = node && gfx(node); },
    down(node, point, extra) { invoke(m.getSvg(), 'mousedown', event(node, point, extra), 'onMouseDown'); },
    move(point) { invoke(window, 'mousemove', event(target, point), 'onMouseMove'); },
    up(point, node = target) { invoke(window, 'mouseup', event(node, point), 'onMouseUp'); },
    close() { m.destroy(); restore.reverse().forEach(fn => fn()); document.elementsFromPoint = hit; }
  };
}
const xy = points => points.map(({ x, y }) => ({ x, y }));
const orthogonal = points => points.slice(1).every((p, i) => Math.abs(p.x - points[i].x) < 1e-8 || Math.abs(p.y - points[i].y) < 1e-8);
let artifact=0;
async function valid(m) {
  const xml=await m.getXML();
  if(process.env.BPMN_XML_ARTIFACT_DIR){await mkdir(process.env.BPMN_XML_ARTIFACT_DIR,{recursive:true});await writeFile(path.join(process.env.BPMN_XML_ARTIFACT_DIR,`connections-${++artifact}.bpmn`),xml);}
  const result=await new BpmnModdle().fromXML(xml);assert.deepEqual(result.warnings,[]);return result;
}

for (const zoom of [0.55, 1, 1.8]) test(`explicit create docking and preview agree at zoom ${zoom}, including backward right ports`, async () => {
  const h = await fixture(), { m } = h;
  try {
    m.setViewport({ x: 120, y: -75, zoom });
    const source = m.addShape('bpmn:Task', { x: 850, y: 300 }), target = m.addShape('bpmn:Task', { x: 350, y: 420 });
    const start = { x: source.x + source.width, y: source.y + 24.5 }, end = { x: target.x + target.width, y: target.y + 61.25 };
    const before = await m.getXML(), count = m.commandStack.size();
    h.target(target); h.down(h.gfx(source), start, { shiftKey: true }); h.move(end);
    const preview = m.getContainer().querySelector('.bpmn-xyflow-connect-preview path').getAttribute('d');
    h.up(end);
    const edge = m.getGraph().edges.at(-1);
    assert.deepEqual(xy([edge.waypoints[0], edge.waypoints.at(-1)]), [start, end]);
    assert.ok(orthogonal(edge.waypoints));
    const rendered = m.getContainer().querySelector(`[data-element-id="${edge.id}"] > path:not(.bpmn-xyflow-connection-hit)`).getAttribute('d');
    assert.equal(rendered.replaceAll(' ', ''), preview.replaceAll(' ', ''));
    assert.equal(m.commandStack.size(), count + 1); const final = await m.getXML();
    for (let i = 0; i < 3; i++) { m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), final); }
    await valid(m);
  } finally { h.close(); }
});

test('circle and diamond explicit docking preserves actual perimeter fractions', async () => {
  const h = await fixture(), { m } = h;
  try {
    const event = m.addShape('bpmn:IntermediateThrowEvent', { x: 400, y: 400 });
    const gateway = m.addShape('bpmn:ExclusiveGateway', { x: 800, y: 500 });
    const start = { x: 400 + 18 * Math.cos(Math.PI / 3), y: 400 + 18 * Math.sin(Math.PI / 3) };
    const end = { x: 787.5, y: 487.5 };
    const edge = m.connect(event, gateway, { connectionStart: start, connectionEnd: end });
    assert.ok(edge); assert.ok(Math.hypot(edge.waypoints[0].x - start.x, edge.waypoints[0].y - start.y) < 1e-9);
    assert.deepEqual(xy([edge.waypoints.at(-1)]), [end]); assert.ok(orthogonal(edge.waypoints)); await valid(m);
  } finally { h.close(); }
});

test('endpoint drag keeps exact dropped port for new target and same-shape redocking', async () => {
  const h = await fixture(), { m } = h;
  try {
    const a = m.addShape('bpmn:Task', { x: 300, y: 300 }), b = m.addShape('bpmn:Task', { x: 650, y: 300 }), c = m.addShape('bpmn:Task', { x: 900, y: 450 });
    const edge = m.connect(a, b), initial = await m.getXML();
    for (const [target, position] of [[c, {x:c.x,y:c.y+63.5}], [c, {x:c.x+c.width,y:c.y+20.25}]]) {
      m.select(edge.id); h.target(target);
      const before = await m.getXML(), start = edge.waypoints.at(-1);
      h.down(m.getContainer().querySelector(`[data-bend-index="${edge.waypoints.length-1}"]`), start); h.move(position);
      const preview = xy(edge.waypoints); h.up(position);
      assert.equal(edge.target, target); assert.deepEqual(xy(edge.waypoints), preview); assert.deepEqual(xy([edge.waypoints.at(-1)]), [position]);
      const final = await m.getXML(); m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), final);
    }
    m.undo(); m.undo(); assert.equal(await m.getXML(), initial); await valid(m);
  } finally { h.close(); }
});

test('plain two-point segment drag creates a dogleg, cancel restores exact route, midpoint handle is actionable', async () => {
  const h = await fixture(), { m } = h;
  try {
    const a = m.addShape('bpmn:Task', { x: 300, y: 300 }), b = m.addShape('bpmn:Task', { x: 700, y: 300 }), edge = m.connect(a, b);
    const before = await m.getXML(), history = m.commandStack.size(); m.select(edge.id);
    assert.ok(m.getContainer().querySelector('[data-segment-index="0"]'));
    for (const cancel of [true, false]) {
      h.down(h.gfx(edge), {x:500,y:300}); h.move({x:500,y:380});
      assert.ok(edge.waypoints.length > 2); assert.ok(orthogonal(edge.waypoints));
      if (cancel) { m.cancel(); h.up({x:500,y:380}); assert.equal(await m.getXML(), before); assert.equal(m.commandStack.size(), history); }
      else h.up({x:500,y:380});
    }
    const final = await m.getXML(); m.undo(); assert.equal(await m.getXML(), before); m.redo(); assert.equal(await m.getXML(), final); await valid(m);
  } finally { h.close(); }
});

test('shape move and resize repair orthogonal endpoint segments from snapshots', async () => {
  const h = await fixture(), { m } = h;
  try {
    const a = m.addShape('bpmn:Task', {x:350,y:300}), b = m.addShape('bpmn:Task', {x:750,y:380});
    const edge = m.connect(a,b,{waypoints:[{x:400,y:300},{x:500,y:300},{x:500,y:380},{x:700,y:380}]});
    const before = await m.getXML(); m.moveShapes([a],{x:0,y:50});
    assert.deepEqual(xy(edge.waypoints),[{x:400,y:350},{x:500,y:350},{x:500,y:380},{x:700,y:380}]);
    assert.ok(orthogonal(edge.waypoints)); m.undo(); assert.equal(await m.getXML(),before);
    m.resizeShape(a,{x:a.x,y:a.y,width:180,height:100});assert.ok(orthogonal(edge.waypoints)); m.undo();assert.equal(await m.getXML(),before); await valid(m);
  } finally { h.close(); }
});

test('context Connect supports press-drag and short-press then target without duplicate activation', async () => {
  const h = await fixture(), {m} = h;
  try {
    const a=m.addShape('bpmn:Task',{x:350,y:300}), b=m.addShape('bpmn:Task',{x:700,y:400}), start={x:a.x+a.width,y:a.y+a.height/2}, end={x:b.x,y:b.y+60};
    for(const short of [false,true]) {
      m.select(a.id);const button=m.getContainer().querySelector('button[title^="Connect"]'),buttonPoint={x:a.x+a.width+30,y:a.y};
      h.invoke(button,'mousedown',h.event(button,buttonPoint));
      if(short){h.up(buttonPoint,button);h.invoke(button,'click',h.event(button,buttonPoint));}
      h.target(b);h.move(end);h.up(end);const edge=m.getGraph().edges.at(-1);
      assert.deepEqual(xy([edge.waypoints[0],edge.waypoints.at(-1)]),[start,end]);assert.equal(m.getContainer().querySelector('.bpmn-xyflow-connect-preview'),null);
      const count=m.getGraph().edges.length;h.up(end);assert.equal(m.getGraph().edges.length,count);m.undo();m.clearSelection();
    }
    await valid(m);
  } finally {h.close();}
});

test('unroutable explicit ports and outside/invalid drops leave XML and history unchanged', async () => {
  const h=await fixture(),{m}=h;
  try {
    const a=m.addShape('bpmn:Task',{x:400,y:300}),b=m.addShape('bpmn:Task',{x:430,y:300});
    const before=await m.getXML(),size=m.commandStack.size(),start={x:a.x+a.width,y:300},end={x:b.x,y:300};
    assert.equal(m.connect(a,b,{connectionStart:start,connectionEnd:end}),null);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    h.target(b);h.down(h.gfx(a),start,{shiftKey:true});h.move(end);h.up(end);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    h.target(null);h.down(h.gfx(a),start,{shiftKey:true});h.move({x:1100,y:600});h.up({x:1100,y:600});assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
  } finally {h.close();}
});

test('retained DI waypoint identities and vendor data survive insert/remove, translation and exact undo', async () => {
  const h=await fixture(),{m}=h;
  try {
    let a=m.addShape('bpmn:Task',{x:350,y:300}),b=m.addShape('bpmn:Task',{x:750,y:380}),edge=m.connect(a,b,{waypoints:[{x:400,y:300},{x:500,y:300},{x:500,y:380},{x:700,y:380}]});
    const ids={a:a.id,b:b.id,edge:edge.id};
    let xml=await m.getXML();xml=xml.replace('<bpmn:definitions ','<bpmn:definitions xmlns:v="urn:waypoint-test" ');
    const start=xml.indexOf(`<bpmndi:BPMNEdge id="${edge.id}_di"`),end=xml.indexOf('</bpmndi:BPMNEdge>',start);
    assert.ok(start>=0&&end>start);let i=0;
    xml=xml.slice(0,start)+xml.slice(start,end).replace(/<di:waypoint /g,()=>`<di:waypoint v:note="POINT_${i++}" `)+xml.slice(end);
    await m.importXML(xml);a=m.getElement(ids.a);b=m.getElement(ids.b);edge=m.getElement(ids.edge);
    const original=edge.di.waypoint.slice(),points=xy(edge.waypoints),before=await m.getXML();
    const edits=[
      {points:[points[0],points[3]],retained:[[0,0],[1,3]]},
      {points:[points[0],{x:450,y:260},points[1],points[2],points[3]],retained:[[0,0],[2,1],[3,2],[4,3]],fresh:1},
      {points:[points[0],{x:450,y:260},points[1],points[3]],retained:[[0,0],[2,1],[3,3]],fresh:1},
      {points:[points[0],{x:510,y:310},points[2],points[3]],retained:[[0,0],[1,1],[2,2],[3,3]]}
    ];
    for(const edit of edits){
      m.updateWaypoints(edge,edit.points);
      for(const [current,previous] of edit.retained){assert.equal(edge.di.waypoint[current],original[previous]);assert.equal(edge.di.waypoint[current].$attrs['v:note'],`POINT_${previous}`);}
      if(edit.fresh!==undefined)assert.equal(edge.di.waypoint[edit.fresh].$attrs['v:note'],undefined);
      const final=await m.getXML();for(let repeat=0;repeat<3;repeat++){m.undo();assert.equal(await m.getXML(),before);assert.deepEqual(edge.di.waypoint,original);m.redo();assert.equal(await m.getXML(),final);}m.undo();
    }
    // The first old bend translates onto the second old bend's coordinate.
    // Known group translation must use original point provenance, not matching
    // the new coordinates against unrelated old interior-point coordinates.
    m.moveShapes([a,b],{x:0,y:80});assert.deepEqual(edge.di.waypoint,original);
    assert.equal(edge.di.waypoint[1].$attrs['v:note'],'POINT_1');m.undo();assert.equal(await m.getXML(),before);
    m.resizeShape(a,{x:a.x,y:a.y,width:180,height:130});m.undo();assert.equal(await m.getXML(),before);assert.deepEqual(edge.di.waypoint,original);
    const c=m.addShape('bpmn:Task',{x:1000,y:300}),withTarget=await m.getXML();
    m.reconnect(edge,'target',c,[points[0],{x:c.x,y:c.y+40}]);m.undo();assert.equal(await m.getXML(),withTarget);assert.deepEqual(edge.di.waypoint,original);
    m.redo();m.undo();assert.equal(await m.getXML(),withTarget);
  } finally {h.close();}
});

test('bend insertion cancellation, route shrink cancellation and jitter create no history or DI drift', async () => {
  const h=await fixture(),{m}=h;
  try {
    const a=m.addShape('bpmn:Task',{x:350,y:300}),b=m.addShape('bpmn:Task',{x:750,y:380}),edge=m.connect(a,b,{waypoints:[{x:400,y:300},{x:500,y:300},{x:500,y:380},{x:700,y:380}]});
    const before=await m.getXML(),size=m.commandStack.size(),di=edge.di.waypoint.slice();m.select(edge.id);
    h.down(h.gfx(edge),{x:450,y:300},{altKey:true});h.move({x:450,y:260});m.cancel();h.up({x:450,y:260});assert.equal(await m.getXML(),before);assert.deepEqual(edge.di.waypoint,di);assert.equal(m.commandStack.size(),size);
    h.down(h.gfx(edge),{x:500,y:340});h.move({x:380,y:340});m.cancel();h.up({x:380,y:340});assert.equal(await m.getXML(),before);assert.deepEqual(edge.di.waypoint,di);
    h.down(h.gfx(edge),{x:500,y:340});h.move({x:550,y:340});h.move({x:500,y:340});h.up({x:500,y:340});assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    m.select(a.id);h.down(h.gfx(a),{x:350,y:300});h.move({x:350,y:350});h.move({x:350,y:300});h.up({x:350,y:300});assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    m.updateWaypoints(edge,xy(edge.waypoints));assert.equal(m.commandStack.size(),size);
  } finally {h.close();}
});

test('fractional imported DI and offset handle grabs survive out-and-back jitter before cropping', async () => {
  const h=await fixture(),{m}=h;
  try {
    let a=m.addShape('bpmn:Task',{x:150.25,y:140.5}),b=m.addShape('bpmn:Task',{x:550.25,y:240.5}),edge=m.connect(a,b,{waypoints:[{x:200.25,y:140.5},{x:300.25,y:140.5},{x:300.25,y:240.5},{x:500.25,y:240.5}]});
    const ids={a:a.id,b:b.id,edge:edge.id};await m.importXML(await m.getXML());a=m.getElement(ids.a);b=m.getElement(ids.b);edge=m.getElement(ids.edge);
    const before=await m.getXML(),size=m.commandStack.size(),di=edge.di.waypoint.slice();
    for(const index of [1,edge.waypoints.length-1]){
      m.select(edge.id);h.target(index===edge.waypoints.length-1?b:null);
      const point=edge.waypoints[index],grab={x:point.x+3,y:point.y+2};
      h.down(m.getContainer().querySelector(`[data-bend-index="${index}"]`),grab);
      h.move({x:grab.x+1,y:grab.y+1});h.move(grab);h.up(grab);
      assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.deepEqual(edge.di.waypoint,di);
    }
    await valid(m);
  }finally{h.close();}
});

test('reported Conditional near-horizontal segment uses ordinary segment drag without a V bend', async () => {
  const h=await fixture(),{m}=h;
  try {
    await m.importXML(await readFile('test/fixtures/bpmn/draw/conditional-flow.bpmn','utf8'));
    // Upstream source fixture omits the XSD-required targetNamespace. Normalize
    // only this derived mutation case before its baseline; retain the fixture.
    m.getDefinitions().targetNamespace = 'urn:bpmn-xyflow:test:conditional-routing';
    m.setViewport({x:90,y:40,zoom:0.8});
    const edge=m.getGraph().edges.find(edge=>edge.waypoints.length===2&&edge.waypoints[0].x===370&&edge.waypoints[1].x===425);
    assert.ok(edge);assert.equal(edge.waypoints[0].y,265.199203187251);assert.equal(edge.waypoints[1].y,265.4183266932271);
    const original=xy(edge.waypoints),di=edge.di.waypoint.slice(),before=await m.getXML(),size=m.commandStack.size();
    m.select(edge.id);assert.ok(m.getContainer().querySelector('[data-segment-index="0"]'));
    const start={x:(original[0].x+original[1].x)/2,y:(original[0].y+original[1].y)/2},end={x:start.x,y:start.y+55/0.8};
    h.down(h.gfx(edge),start);h.move(end);h.move(start);h.up(start);
    assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);assert.deepEqual(edge.di.waypoint,di);
    h.down(h.gfx(edge),start);h.move(end);m.cancel();h.up(end);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);
    h.down(h.gfx(edge),start);h.move(end);h.up(end);assert.ok(orthogonal(edge.waypoints));assert.ok(edge.waypoints.length>=4,'near-axis plain drag creates an orthogonal dogleg');
    assert.equal(m.commandStack.size(),size+1);const final=await m.getXML();
    for(let repeat=0;repeat<3;repeat++){m.undo();assert.equal(await m.getXML(),before);assert.deepEqual(edge.di.waypoint,di);m.redo();assert.equal(await m.getXML(),final);}
    await valid(m);
  }finally{h.close();}
});

test('near-vertical fractional segment shares the same drag classification and exact undo', async () => {
  const h=await fixture(),{m}=h;
  try {
    const a=m.addShape('bpmn:Task',{x:350,y:300}),b=m.addShape('bpmn:Task',{x:350,y:800}),edge=m.connect(a,b,{waypoints:[{x:350.25,y:340},{x:350.5,y:760}]});
    const before=await m.getXML(),size=m.commandStack.size();m.select(edge.id);
    assert.ok(m.getContainer().querySelector('[data-segment-index="0"]'));
    h.down(h.gfx(edge),{x:350.375,y:550});h.move({x:430.375,y:550});h.up({x:430.375,y:550});
    assert.ok(orthogonal(edge.waypoints));assert.ok(edge.waypoints.length>=4);assert.equal(m.commandStack.size(),size+1);
    m.undo();assert.equal(await m.getXML(),before);await valid(m);
  }finally{h.close();}
});

test('fractional native selection of diagonal message/data edges is a no-op before reconnect history', async () => {
  const h=await fixture(),{m}=h;
  try{
    await m.importXML(await readFile('test/fixtures/scenarios/order-payment-delivery.bpmn','utf8'));m.setViewport({x:150,y:100,zoom:.9});
    const parent=m.getElement('SellerPool'),a=m.addShape('bpmn:DataObjectReference',{x:1050,y:630},{parent}),b=m.addShape('bpmn:DataStoreReference',{x:1180,y:630},{parent}),data=m.connect(a,m.getElement('ValidateOrder'));
    for(const [edge,side,target,drop]of [[m.getElement('OrderMessage'),'target',m.getElement('ValidateOrder'),{x:200,y:430}],[data,'source',b,{x:b.x,y:b.y+20}]]){
      const before=await m.getXML(),size=m.commandStack.size(),v=m.getViewport(),r=m.getContainer().getBoundingClientRect(),p=edge.waypoints[0],q=edge.waypoints[1];
      const point={x:(Math.round(r.left+v.x+(p.x+q.x)/2*v.zoom)-r.left-v.x)/v.zoom,y:(Math.round(r.top+v.y+(p.y+q.y)/2*v.zoom)-r.top-v.y)/v.zoom};
      for(const jitter of [false,true]){h.target(null);h.down(h.gfx(edge),point);if(jitter){h.move({x:point.x+1,y:point.y+1});h.move(point);}h.up(point);assert.equal(await m.getXML(),before);assert.equal(m.commandStack.size(),size);}
      const index=side==='source'?0:edge.waypoints.length-1,handle=m.getContainer().querySelector(`[data-bend-index="${index}"]`),start={...edge.waypoints[index]};assert.ok(handle);
      h.target(target);h.down(handle,start);h.move(drop);h.up(drop);assert.equal(edge[side],target);assert.equal(m.commandStack.size(),size+1);const after=await m.getXML();await valid(m);
      for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
    }
  }finally{h.close();}
});
