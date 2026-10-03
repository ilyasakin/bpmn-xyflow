import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { collectPreviewOutline, validatePreviewOutline } from '../helpers/anchor-preview-outline.mjs';
function fixture(kind, zoom=1, outward=true, vertices=false, border=2) {
  const shape={id:'A',type:`bpmn:${kind}`,x:-347.25,y:-178.125,width:kind==='Task'?100:kind==='ExclusiveGateway'?50:36,height:kind==='Task'?80:kind==='ExclusiveGateway'?50:36};
  const pad=outward?border/2+3/zoom:0, x=shape.x-pad,y=shape.y-pad,w=shape.width+2*pad,h=shape.height+2*pad;
  const visual={tag:kind==='Task'?'rect':kind==='ExclusiveGateway'?'polygon':'circle',visible:true,strokeWidth:`${border}px`,strokeOpacity:'1',stroke:'rgb(0, 0, 0)',vectorEffect:'none',attrs:{}};
  let d,box={x,y,width:w,height:h};
  if(kind==='Task') {const r=10+pad;visual.attrs={x:'0',y:'0',width:'100',height:'80',rx:'10'};d=`M${x+r},${y}l${w-2*r},0a${r},${r},0,0,1,${r},${r}l0,${h-2*r}a${r},${r},0,0,1,${-r},${r}l${-w+2*r},0a${r},${r},0,0,1,${-r},${-r}l0,${-h+2*r}a${r},${r},0,0,1,${r},${-r}z`;}
  else if(kind==='ExclusiveGateway'){visual.attrs={points:'25,0 50,25 25,50 0,25'};const p=pad*Math.SQRT2;box={x:shape.x-p,y:shape.y-p,width:50+2*p,height:50+2*p};const a=box;d=`M${a.x+a.width/2},${a.y}l${a.width/2},${a.height/2}l${-a.width/2},${a.height/2}l${-a.width/2},${-a.height/2}z`;}
  else {visual.attrs={cx:'18',cy:'18',r:'18'};const r=18+pad;d=`M${shape.x+18},${shape.y+18}m0,${-r}a${r},${r},0,1,1,0,${2*r}a${r},${r},0,1,1,0,${-2*r}z`;}
  const fixed=vertices?[{x:shape.x+25,y:shape.y},{x:shape.x+50,y:shape.y+25},{x:shape.x+25,y:shape.y+50},{x:shape.x,y:shape.y+25}].map((p,i)=>({visible:true,stroke:'rgb(0,0,0)',strokeOpacity:'1',pointerEvents:'none',strokeWidth:`${1/zoom}px`,attrs:{cx:String(p.x),cy:String(p.y),r:String(2/zoom),'pointer-events':'none','data-anchor-index':String(i)}})):[];
  const e={owner:'A',gfxOwner:'A',handleOwner:'A',outlineCount:1,visual,outline:{visible:true,stroke:'rgb(0,0,0)',strokeOpacity:'1',pointerEvents:'none',strokeWidth:`${1/zoom}px`,inlineStrokeWidth:`${1/zoom}px`,attrs:{d,'stroke-width':String(1/zoom),'pointer-events':'none'},bbox:box},
    nativeExpectation:{d,bbox:{...box}},marker:{cx:String(shape.x+shape.width/2),cy:String(shape.y)},hit:{r:String(5.75/zoom)},fixed,expectedPreviewStroke:`${1/zoom}px`,expectedFixedStroke:`${1/zoom}px`};
  return {e,shape,zoom,policy:{outlinePolicy:outward?'outward':'baseline',gatewayPolicy:vertices?'vertices':'continuous'}};
}

test('actual paint geometry defines exact outward circle/Task/diamond margins at low/high zoom',()=>{
  for(const zoom of [.2,.5,1,2,4]) for(const kind of ['Task','StartEvent','ExclusiveGateway']) for(const outward of [false,true]) for(const border of [2,3]){
    const f=fixture(kind,zoom,outward,kind==='ExclusiveGateway'&&outward,border),r=validatePreviewOutline(f.e,f.shape,zoom,f.policy);
    assert.ok(Math.abs(r.projectedGapCss-(outward?2.5:-border*zoom/2-.5))<1e-12);
    assert.deepEqual(r.nativeBBox,r.nativeExpectation.bbox,'native geometry matches the independently constructed path exactly');
  }
});

test('wrong paint margin, shape, hit extent, docking and passive indicators cannot pass',()=>{
  const corruptions=[
    e=>e.owner='B', e=>e.gfxOwner='B', e=>e.handleOwner='B', e=>e.outlineCount=2,
    e=>e.outline.pointerEvents='all',e=>e.outline.strokeWidth='2px',e=>e.outline.visible=false,
    e=>e.visual.strokeWidth='4px',e=>e.visual.strokeOpacity='0',e=>e.visual.visible=false,e=>e.visual.tag='path',
    e=>e.hit.r='8',e=>e.marker.cy='-150',e=>e.outline.inlineStrokeWidth='2px',
    e=>e.outline.attrs.d=e.outline.attrs.d.replace(/^M(-?[\d.]+)/,(_s,n)=>`M${Number(n)+1}`),
    e=>e.visual.stroke='rgba(0, 0, 0, 0)',e=>e.outline.stroke='rgb(0 0 0 / 0%)',
    e=>e.outline.bbox.width+=.1,e=>e.outline.bbox.x-=.1,
    e=>e.nativeExpectation.d=e.nativeExpectation.d.replace('M','M1,1M'),
    e=>e.nativeExpectation.bbox.x+=1e-10,e=>e.nativeExpectation.bbox.width=0,
    e=>e.nativeExpectation.bbox.height=NaN,e=>delete e.nativeExpectation
  ];
  for(const corrupt of corruptions){const f=fixture('Task');corrupt(f.e);assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));}
  for(const corrupt of [e=>e.fixed.pop(),e=>e.fixed[1].attrs.cx='-270',e=>e.fixed[0].pointerEvents='all',e=>e.fixed[0].attrs.r='3',e=>e.fixed[0].stroke='none',e=>e.fixed[1].stroke='rgba(0,0,0,0)',e=>e.fixed[2].stroke='rgb(0 0 0 / 0%)',e=>e.fixed[3].strokeOpacity='0']){
    const f=fixture('ExclusiveGateway',1,true,true);corrupt(f.e);assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));
  }
});

test('native arc bbox differences do not relax exact analytic path or exact native equality',()=>{
  // 849b34d hosted StartEvent outline: every operand is exact, but Chromium's
  // arc bbox exceeds the previous Float32-storage-only bound. This fixture
  // models the same native result for the independently generated expected d;
  // hosted execution must still collect that reference from the real browser.
  const f=fixture('StartEvent',2),native={x:-2.5070784091949463,y:30.499996185302734,width:41.01416015625,height:41.000003814697266};
  Object.assign(f.shape,{x:0,y:33});
  const d='M18,51m0,-20.5a20.5,20.5,0,1,1,0,41a20.5,20.5,0,1,1,0,-41z';
  f.e.outline.attrs.d=d;f.e.outline.bbox={...native};f.e.nativeExpectation={d,bbox:{...native}};
  f.e.marker={cx:'18',cy:'33'};
  const result=validatePreviewOutline(f.e,f.shape,f.zoom,f.policy);
  assert.deepEqual(result.box,{x:-2.5,y:30.5,width:41,height:41});assert.deepEqual(result.nativeBBox,native);
  f.e.outline.bbox.x+=1e-10;assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));
  f.e.outline.bbox.x=native.x;f.e.outline.attrs.d=d.replace('20.5','20.5001');
  assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));
});

test('serialized collector binds actual outer SVG paint, owner and native attributes',async()=>{
  const w=new Window(),saved=new Map(),cssAliases=new Map();for(const [key,value]of Object.entries({window:w,document:w.document,getComputedStyle:w.getComputedStyle.bind(w)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  try{
    w.document.body.innerHTML='<div id="viewer"><svg><g data-element-id="A"><circle cx="18" cy="18" r="18"/><circle class="inner" cx="18" cy="18" r="15"/></g><path class="bpmn-xyflow-connect-outline" pointer-events="none"/><g class="bpmn-xyflow-connect-handle" data-connect-source="A"><circle class="bpmn-xyflow-connect-hit" r="5.75"/></g><g class="bpmn-xyflow-connect-docking" data-connect-source="A"><circle class="bpmn-xyflow-connect-docking-point" cx="18" cy="0"/></g></svg></div>';
    // Happy DOM omits CSSStyleDeclaration's browser named-property setters
    // for hyphenated SVG CSS names. Emulate those standard aliases only.
    for(const name of ['stroke-width','stroke-opacity','pointer-events']){
      cssAliases.set(name,Object.getOwnPropertyDescriptor(w.CSSStyleDeclaration.prototype,name));
      Object.defineProperty(w.CSSStyleDeclaration.prototype,name,{configurable:true,get(){return this.getPropertyValue(name);},set(value){this.setProperty(name,value);}});
    }
    const {create}=await import('tiny-svg');
    const outer=create('circle',{cx:18,cy:18,r:18,stroke:'black','stroke-width':2,'stroke-opacity':1});
    w.document.querySelector('[data-element-id="A"] > circle').replaceWith(outer);
    const outline=create('path',{'class':'bpmn-xyflow-connect-outline',d:'M18,18m0,-22a22,22,0,1,1,0,44a22,22,0,1,1,0,-44z',stroke:'blue','stroke-width':1,'stroke-opacity':1,'pointer-events':'none'});
    w.document.querySelector('.bpmn-xyflow-connect-outline').replaceWith(outline);
    assert.equal(outline.getAttribute('stroke-width'),null,'actual tiny-svg writes the length into CSS');
    assert.equal(outline.getAttribute('pointer-events'),null,'actual tiny-svg writes inertness into CSS');
    // Happy DOM omits the browser's initial SVG opacity; declare it explicitly.
    for(const e of w.document.querySelectorAll('*')) e.style.opacity='1';
    for(const e of w.document.querySelectorAll('svg *')) e.getBBox=()=>({x:0,y:0,width:36,height:36});
    outline.getBBox=()=>({x:-4,y:-4,width:44,height:44});
    const parent=outline.parentElement,children=[...parent.children],nativeBBox={x:-4,y:-4,width:44,height:44};
    let references=0,throwReference=false;
    w.SVGPathElement.prototype.getBBox=function(){
      assert.equal(this.tagName.toLowerCase(),'path');assert.equal(this.parentElement,parent);assert.equal(this.isConnected,true);
      assert.equal(this.style.visibility,'hidden');assert.equal(this.style.pointerEvents,'none');
      assert.equal(this.getAttribute('d'),'M18,18m0,-22a22,22,0,1,1,0,44a22,22,0,1,1,0,-44z');
      references++;if(throwReference)throw Error('native bbox failure');return {...nativeBBox};
    };
    const collect=Function(`return (${collectPreviewOutline.toString()})`)(),options={owner:'A',zoom:1,shape:{id:'A',type:'bpmn:StartEvent',x:0,y:0,width:36,height:36},outlinePolicy:'outward'},e=collect(options);
    assert.equal(references,1);assert.deepEqual([...parent.children],children,'temporary expected path is removed');
    assert.deepEqual(e.nativeExpectation,{d:'M18,18m0,-22a22,22,0,1,1,0,44a22,22,0,1,1,0,-44z',bbox:nativeBBox});
    assert.equal(e.visual.visible,true);assert.equal(e.visual.attrs.r,'18');assert.equal(e.visual.tag,'circle');assert.equal(e.handleOwner,'A');assert.equal(e.hit.r,'5.75');assert.equal(e.expectedPreviewStroke,'1px');assert.equal(e.outline.inlineStrokeWidth,'1px');
    validatePreviewOutline(e,{id:'A',type:'bpmn:StartEvent',x:0,y:0,width:36,height:36},1,{outlinePolicy:'outward',gatewayPolicy:'continuous'});
    outline.setAttribute('d','M0,0L1,1');const corrupt=collect(options);
    assert.equal(corrupt.nativeExpectation.d,e.nativeExpectation.d,'expected geometry never copies the actual preview d');
    assert.throws(()=>validatePreviewOutline(corrupt,options.shape,1,{outlinePolicy:'outward',gatewayPolicy:'continuous'}));
    throwReference=true;assert.throws(()=>collect(options),/native bbox failure/);assert.deepEqual([...parent.children],children,'failed measurement also removes only its own path');throwReference=false;
    w.document.querySelector('[data-element-id="A"]').style.visibility='hidden';assert.equal(collect(options).visual.visible,false);
  }finally{await w.happyDOM.abort();for(const [key,value]of cssAliases)if(value)Object.defineProperty(w.CSSStyleDeclaration.prototype,key,value);else delete w.CSSStyleDeclaration.prototype[key];for(const [key,value]of saved)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
});

test('serialized native reference independently constructs each supported shape and policy',()=>{
  const w=new Window(),saved=new Map();for(const [key,value]of Object.entries({window:w,document:w.document,getComputedStyle:w.getComputedStyle.bind(w)})){saved.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});}
  try{
    const collect=Function(`return (${collectPreviewOutline.toString()})`)();
    for(const kind of ['Task','StartEvent','ExclusiveGateway'])for(const zoom of [.5,2])for(const outward of [false,true]){
      const f=fixture(kind,zoom,outward),svg=w.document.createElementNS('http://www.w3.org/2000/svg','svg'),root=w.document.createElement('div');root.id='viewer';root.appendChild(svg);w.document.body.replaceChildren(root);
      const make=(tag,attrs={})=>{const e=w.document.createElementNS(svg.namespaceURI,tag);for(const [key,value]of Object.entries(attrs))e.setAttribute(key,value);return e;};
      const gfx=make('g',{'data-element-id':'A'}),main=make(f.e.visual.tag,f.e.visual.attrs);main.style.setProperty('stroke-width','2px');main.style.stroke='black';gfx.appendChild(main);svg.appendChild(gfx);
      // An intentionally wrong actual d proves the expected path is not copied.
      const outline=make('path',{class:'bpmn-xyflow-connect-outline',d:'M0,0L1,1'});svg.appendChild(outline);main.getBBox=()=>({x:0,y:0,width:36,height:36});outline.getBBox=()=>({x:0,y:0,width:1,height:1});
      let measured=0;w.SVGPathElement.prototype.getBBox=function(){assert.equal(this.isConnected,true);assert.equal(this.style.pointerEvents,'none');assert.equal(this.style.visibility,'hidden');assert.equal(this.getAttribute('d'),f.e.nativeExpectation.d);measured++;return {...f.e.nativeExpectation.bbox};};
      const actual=collect({owner:'A',zoom,shape:f.shape,outlinePolicy:f.policy.outlinePolicy});
      assert.equal(measured,1);assert.deepEqual(actual.nativeExpectation,f.e.nativeExpectation);assert.equal(svg.children.length,2);
    }
  }finally{for(const [key,value]of saved)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
});
