import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Window } from 'happy-dom';
import { assertAffordance, collectViewportAffordance, collectViewportSurfaces, panSteps, viewportSourceCases } from './browser-viewport-source-grabs.mjs';

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


test('serialized viewport surfaces normalize actual HTML and SVG class values before obstacle filtering', async () => {
  const window=new Window(),document=window.document;
  try {
    const root=document.createElement('div');root.id='viewer';document.body.appendChild(root);
    const box={left:0,top:48,right:800,bottom:650,width:800,height:602};root.getBoundingClientRect=()=>box;
    const palette=document.createElement('div');palette.className='bpmn-xyflow-palette';root.appendChild(palette);
    palette.getBoundingClientRect=()=>({left:0,top:48,right:120,bottom:490,width:120,height:442});
    const minimap=document.createElementNS('http://www.w3.org/2000/svg','svg');minimap.setAttribute('class','bpmn-xyflow-minimap');root.appendChild(minimap);
    minimap.getBoundingClientRect=()=>({left:650,top:490,right:790,bottom:630,width:140,height:140});
    // Happy DOM currently inherits string className for SVG. Its genuine
    // SVGAnimatedString implementation reproduces Chrome's class property
    // without replacing the rendered class attribute used by this observer.
    const animated=document.createElementNS('http://www.w3.org/2000/svg','image').href;
    animated.baseVal=minimap.getAttribute('class');
    assert.ok(animated instanceof window.SVGAnimatedString);
    Object.defineProperty(minimap,'className',{configurable:true,get:()=>animated});
    assert.equal(typeof palette.className,'string');assert.equal(typeof minimap.className,'object');
    assert.equal(minimap.className.baseVal,'bpmn-xyflow-minimap');assert.equal(minimap.className.includes,undefined,'actual SVGAnimatedString reproduces the hosted premise');
    const hidden=document.createElementNS('http://www.w3.org/2000/svg','g');hidden.setAttribute('class','bpmn-xyflow-context-pad');hidden.style.display='none';hidden.getBoundingClientRect=()=>box;root.appendChild(hidden);
    const empty=document.createElementNS('http://www.w3.org/2000/svg','g');empty.setAttribute('class','bpmn-xyflow-editor-actions');empty.getBoundingClientRect=()=>({...box,width:0});root.appendChild(empty);
    const context={document,getComputedStyle:window.getComputedStyle.bind(window),innerWidth:800,innerHeight:600};
    const observed=runInNewContext(`(${collectViewportSurfaces.toString()})()`,context);
    assert.ok(observed.chrome.every(r=>typeof r.className==='string'),'all serialized obstacle class names are text');
    assert.equal(observed.chrome.length,2,'hidden and zero-area obstacles remain excluded');
    assert.equal(observed.chrome.find(r=>r.className.includes('palette')).right,120);
    assert.equal(observed.chrome.find(r=>r.className.includes('minimap')).left,650);
    assert.deepEqual(JSON.parse(JSON.stringify(observed.canvas)),box);
    assert.deepEqual([observed.width,observed.height],[800,600]);
  }finally{await window.happyDOM.close();}
});
