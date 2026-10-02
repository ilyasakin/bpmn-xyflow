import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { assertAffordance, collectViewportAffordance, panSteps, viewportSourceCases } from './browser-viewport-source-grabs.mjs';

test('native viewport plan covers each boundary and chrome risk with independent case lifecycles', () => {
  assert.equal(viewportSourceCases.length, 12);
  assert.equal(new Set(viewportSourceCases.map(c => c.id)).size, 12);
  assert.deepEqual(viewportSourceCases.slice(0, 8).map(c => c.direction), ['w','e','n','s','nw','ne','sw','se']);
  for (const name of ['palette', 'minimap']) assert.deepEqual(viewportSourceCases.filter(c => c.name.startsWith(name)).map(c => c.zoom), [.5, 2]);
  assert.ok(viewportSourceCases.every(c => c.engine === 'local' && c.sample === 'Empty diagram' && typeof c.run === 'function'));
});

test('native pan uses complete finite integer movement, including small corrections', () => {
  for (const delta of [-1500.4,-101,-3,-1,-.5,-.4,0,.4,.5,1,2,3,4,90,91,1499.6]) {
    const steps = panSteps(delta);
    assert.equal(steps.reduce((a,b) => a+b,0), Math.round(delta) || 0);
    assert.ok(steps.every(step => Number.isInteger(step) && Math.abs(step) > 3 && Math.abs(step) <= 90));
  }
  for (const invalid of [NaN,Infinity,10001]) assert.throws(() => panSteps(invalid));
});

test('native affordance guard rejects clipping, chrome, missing marker, wrong source and invisible targets', () => {
  const layout = { canvas: { left: 0, top: 48, right: 800, bottom: 650 }, width: 800, height: 600,
    chrome: [{ className: 'palette', left: 0, right: 120, top: 48, bottom: 490 }] };
  const good = { owner: 'Task', anchor: {x:748,y:300}, grabGraph:{x:760,y:300}, markerScreen:{x:748,y:300}, grab:{x:760,y:300},
    radius:5.75,visible:true,markerVisible:true,tetherVisible:true,hit:true,tether:{x1:748,y1:300,x2:760,y2:300} };
  assertAffordance(good,layout,'Task');
  const corruptions = [
    e=>e.owner='Other', e=>e.visible=false, e=>e.markerVisible=false, e=>e.tetherVisible=false, e=>e.hit=false,
    e=>e.radius=8, e=>e.grab.x=796, e=>e.grab.y=599, e=>e.grab.x=100,
    e=>e.markerScreen.x=100, e=>e.markerScreen.y=45, e=>e.grab.x=755,
    e=>e.tether.x1++, e=>e.tether.x2++, e=>e.anchor.x++, e=>e.grabGraph.x++
  ];
  for (const corrupt of corruptions) { const next=structuredClone(good);corrupt(next);assert.throws(()=>assertAffordance(next,layout,'Task')); }
  assert.throws(()=>assertAffordance(null,layout,'Task'));
});

test('serialized native collector rejects transparent paint and inherited invisibility', () => {
  function fixture() {
    const style=()=>({display:'block',visibility:'visible',opacity:'1',fill:'rgb(0, 102, 204)',fillOpacity:'1',stroke:'rgb(255, 255, 255)',strokeOpacity:'1',strokeWidth:'1.5px'});
    const root={style:style(),parentElement:null};
    const element=attrs=>({attrs,style:style(),isConnected:true,parentElement:root,r:{baseVal:{value:5}},getAttribute(name){return String(this.attrs[name]);},getScreenCTM(){return {a:1,b:0,c:0,d:1,e:0,f:0};}});
    const port=element({cx:760,cy:300}),marker=element({cx:748,cy:300}),tether=element({x1:748,y1:300,x2:760,y2:300});
    const group={getAttribute:()=> 'Task',querySelector:()=>port,contains:e=>e===port};
    const docking={querySelector:selector=>selector==='circle'?marker:tether};
    const document={querySelector:selector=>selector.includes('connect-handle')?group:selector.includes('connect-docking')?docking:{rx:{baseVal:{value:10}}},elementFromPoint:()=>port};
    class DOMPoint{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return this;}}
    const context={document,DOMPoint,getComputedStyle:e=>e.style,window:{anchorInput:[{type:'mousemove',trusted:true,x:760,y:300}]}};
    return {root,port,marker,tether,read:()=>runInNewContext(`(${collectViewportAffordance.toString()})('Task')`,context)};
  }
  const good=fixture().read();assert.equal(good.visible,true);assert.equal(good.markerVisible,true);assert.equal(good.tetherVisible,true);
  for(const [mutate,key] of [
    [f=>f.port.style.fill='rgba(0, 102, 204, 0)','visible'],
    [f=>f.port.style.stroke='rgb(255 255 255 / 0)','visible'],
    [f=>f.port.style.fillOpacity='0','visible'],
    [f=>f.port.style.strokeOpacity='0','visible'],
    [f=>f.marker.style.fill='transparent','markerVisible'],
    [f=>f.marker.style.stroke='none','markerVisible'],
    [f=>f.marker.style.fillOpacity='0','markerVisible'],
    [f=>f.marker.style.strokeOpacity='0','markerVisible'],
    [f=>f.tether.style.stroke='color(srgb 0 0 1 / 0%)','tetherVisible'],
    [f=>f.tether.style.strokeOpacity='0','tetherVisible'],
    [f=>f.tether.style.strokeWidth='0px','tetherVisible'],
    [f=>f.root.style.opacity='0','visible'],
    [f=>f.root.style.display='none','markerVisible'],
    [f=>f.root.style.visibility='hidden','tetherVisible']
  ]){const f=fixture();mutate(f);assert.equal(f.read()[key],false);}
});
