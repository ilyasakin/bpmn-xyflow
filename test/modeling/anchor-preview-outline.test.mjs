import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { collectPreviewOutline, validatePreviewOutline, outlineBBoxBounds } from '../helpers/anchor-preview-outline.mjs';
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
    marker:{cx:String(shape.x+shape.width/2),cy:String(shape.y)},hit:{r:String(5.75/zoom)},fixed,expectedPreviewStroke:`${1/zoom}px`,expectedFixedStroke:`${1/zoom}px`};
  return {e,shape,zoom,policy:{outlinePolicy:outward?'outward':'baseline',gatewayPolicy:vertices?'vertices':'continuous'}};
}

test('actual paint geometry defines exact outward circle/Task/diamond margins at low/high zoom',()=>{
  for(const zoom of [.2,.5,1,2,4]) for(const kind of ['Task','StartEvent','ExclusiveGateway']) for(const outward of [false,true]) for(const border of [2,3]){
    const f=fixture(kind,zoom,outward,kind==='ExclusiveGateway'&&outward,border),r=validatePreviewOutline(f.e,f.shape,zoom,f.policy);
    assert.ok(Math.abs(r.projectedGapCss-(outward?2.5:-border*zoom/2-.5))<1e-12);
    assert.ok(Object.values(r.bboxLimits).every(v=>v>0&&v*zoom<.03),'storage bound stays far below a CSS pixel for these actual coordinates');
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
    e=>e.outline.bbox.width+=.1,e=>e.outline.bbox.x-=.1
  ];
  for(const corrupt of corruptions){const f=fixture('Task');corrupt(f.e);assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));}
  for(const corrupt of [e=>e.fixed.pop(),e=>e.fixed[1].attrs.cx='-270',e=>e.fixed[0].pointerEvents='all',e=>e.fixed[0].attrs.r='3',e=>e.fixed[0].stroke='none',e=>e.fixed[1].stroke='rgba(0,0,0,0)',e=>e.fixed[2].stroke='rgb(0 0 0 / 0%)',e=>e.fixed[3].strokeOpacity='0']){
    const f=fixture('ExclusiveGateway',1,true,true);corrupt(f.e);assert.throws(()=>validatePreviewOutline(f.e,f.shape,f.zoom,f.policy));
  }
});

test('native bbox allowance is derived from path operands and Float32 storage, not a pixel tolerance',()=>{
  const small=outlineBBoxBounds([0,18,-18,36],{x:-18,y:-18,width:36,height:36}),large=outlineBBoxBounds([10000,18,-18,36],{x:9982,y:-18,width:36,height:36});
  assert.ok(large.x>small.x*100);assert.equal(small.x,21*2**-20);assert.ok(large.x<.01);
  const f=fixture('StartEvent');f.e.outline.bbox.x=Math.fround(f.e.outline.bbox.x);
  validatePreviewOutline(f.e,f.shape,f.zoom,f.policy);
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
    const collect=Function(`return (${collectPreviewOutline.toString()})`)(),e=collect({owner:'A',zoom:1});
    assert.equal(e.visual.visible,true);assert.equal(e.visual.attrs.r,'18');assert.equal(e.visual.tag,'circle');assert.equal(e.handleOwner,'A');assert.equal(e.hit.r,'5.75');assert.equal(e.expectedPreviewStroke,'1px');assert.equal(e.outline.inlineStrokeWidth,'1px');
    validatePreviewOutline(e,{id:'A',type:'bpmn:StartEvent',x:0,y:0,width:36,height:36},1,{outlinePolicy:'outward',gatewayPolicy:'continuous'});
    w.document.querySelector('[data-element-id="A"]').style.visibility='hidden';assert.equal(collect({owner:'A',zoom:1}).visual.visible,false);
  }finally{await w.happyDOM.abort();for(const [key,value]of cssAliases)if(value)Object.defineProperty(w.CSSStyleDeclaration.prototype,key,value);else delete w.CSSStyleDeclaration.prototype[key];for(const [key,value]of saved)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}
});
