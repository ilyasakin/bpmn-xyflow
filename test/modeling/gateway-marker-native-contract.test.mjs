import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { setupDOM } from '../helpers/dom.mjs';
import { collectGatewayMarker,assertDirectGatewayMarker,exposeGatewayMarker,GATEWAY_MARKER_ZOOMS } from '../helpers/gateway-marker-browser.mjs';
import { gatewayAnchorCases } from './browser-gateway-anchors.mjs';
import { FOLLOWUP_CASE_MAX_MS,FOLLOWUP_LIMITS } from '../helpers/anchor-followup-lifecycle.mjs';
const node={id:'Gateway',type:'bpmn:ExclusiveGateway',x:400,y:200,width:50,height:50};
test('all original eight workflows cover both marker zoom bands within the existing lifecycle and job ceilings',async()=>{
 assert.equal(gatewayAnchorCases.length,8);assert.equal(new Set(gatewayAnchorCases.map(c=>c.id)).size,8);assert.deepEqual(GATEWAY_MARKER_ZOOMS,[.25,1.4]);assert.equal(gatewayAnchorCases.length*GATEWAY_MARKER_ZOOMS.length,16);
 assert.equal(FOLLOWUP_LIMITS.workflow,90000);assert.ok(FOLLOWUP_CASE_MAX_MS*8<1810000);assert.ok(1810000<40*60*1000);
 const source=await readFile('test/modeling/browser-gateway-anchors.mjs','utf8');for(const retained of ['createIncoming(h,page','reconnect(h,page','move(h,page','replaceGateway(h,page','deliberateLoop(h,page','h.reopenThroughVisibleReference'])assert.ok(source.includes(retained));
});
test('marker acceptance requires the exact index, paint-sized control and literal displaced receiver',()=>{
 const good={id:'Gateway',index:0,anchor:{x:425,y:200},grab:{x:425,y:180},press:{x:425,y:200},zoom:.25,painted:true,paintContainsPress:true,pointerEvents:'visiblepainted',radius:8,strokeWidth:'4px',computedStrokeWidth:'4px',expectedStrokeWidth:'4px',actual:{marker:true,activePort:false,owner:'Gateway',index:'0'}};
 good.grab.y=140;assertDirectGatewayMarker(good,node,0,{displaced:true});
 for(const corrupt of [c=>c.index=1,c=>c.anchor.x++,c=>c.pointerEvents='all',c=>c.pointerEvents='none',c=>c.radius=32,c=>c.strokeWidth=8,c=>c.computedStrokeWidth='8px',c=>c.painted=false,c=>c.paintContainsPress=false,c=>c.actual.owner='Other',c=>c.actual.index='1',c=>c.actual.marker=false,c=>c.grab.y=180]){const bad=structuredClone(good);corrupt(bad);assert.throws(()=>assertDirectGatewayMarker(bad,node,0,{displaced:true}));}
 const coincident={...good,grab:{...good.anchor},actual:{marker:false,activePort:true,owner:'Gateway',index:null}};assertDirectGatewayMarker(coincident,node,0);assert.throws(()=>assertDirectGatewayMarker(coincident,node,0,{displaced:true}));
});
test('serialized marker collector checks actual paint membership, exact receiver and transform without lexical dependencies',()=>{
 const style={display:'block',visibility:'visible',opacity:'1',fill:'white',fillOpacity:'1',stroke:'blue',strokeOpacity:'1',strokeWidth:'0.5px',pointerEvents:'visiblePainted'};
 class DOMPoint{constructor(x,y){this.x=x;this.y=y;}matrixTransform(m){return new DOMPoint(this.x*m.a+this.y*m.c+m.e,this.x*m.b+this.y*m.d+m.f);}}
 const matrix={a:2,b:0,c:0,d:2,e:20,f:48,inverse(){return{a:.5,b:0,c:0,d:.5,e:-10,f:-24};}},parent={parentElement:null,style:{...style}};
 const marker={attrs:{cx:425,cy:200,r:1,'data-anchor-index':'0'},parentElement:parent,classList:{contains:()=>false},isConnected:true,style:{...style},getAttribute(k){return this.attrs[k];},getScreenCTM(){return matrix;},isPointInFill(p){assert.deepEqual({x:p.x,y:p.y},{x:425,y:200});return true;},isPointInStroke(){return false;},closest(selector){return selector==='.bpmn-xyflow-editor-actions'?null:root;}};
 const port={getAttribute:k=>({cx:425,cy:170})[k]},root={querySelector:s=>s.includes('fixed-anchor')?marker:port,contains:e=>e===marker||e===port,getAttribute:()=>node.id};
 const context={DOMPoint,document:{createElement:()=>({style:{}}),querySelector:()=>root,elementFromPoint:()=>marker},window:{modeler:{getViewport:()=>({zoom:2})},anchorInput:[{type:'mousemove',trusted:true,x:870,y:448}]},getComputedStyle:e=>e.style};
 const read=()=>JSON.parse(JSON.stringify(runInNewContext(`(${collectGatewayMarker.toString()})({id:'Gateway',index:0})`,context)));
 assertDirectGatewayMarker(read(),node,0,{displaced:true});
 const toolbar={getBoundingClientRect:()=>({left:850,top:430,right:1000,bottom:460})},button={tagName:'SELECT',getAttribute:()=>null,closest:selector=>selector==='.bpmn-xyflow-editor-actions'?toolbar:null};
 context.document.elementFromPoint=()=>button;const blocked=read();assert.deepEqual(blocked.obstruction,{kind:'editor-actions',receiver:{tag:'SELECT',class:null},bounds:{left:850,top:430,right:1000,bottom:460}});assert.throws(()=>assertDirectGatewayMarker(blocked,node,0,{displaced:true}));
 context.document.elementFromPoint=()=>({...button,closest:()=>null});assert.equal(read().obstruction,null);assert.throws(()=>assertDirectGatewayMarker(read(),node,0,{displaced:true}));
 context.document.elementFromPoint=()=>marker;
 parent.style.opacity='0';assert.equal(read().painted,false);parent.style.opacity='1';marker.style.fill='transparent';marker.style.stroke='rgba(0, 0, 255, 0)';assert.equal(read().painted,false);marker.style.stroke='blue';marker.style.visibility='hidden';assert.equal(read().painted,false);marker.style.visibility='visible';matrix.a=0;assert.throws(read,/transform/);
});


test('actual installed tiny-svg stroke CSS survives the serialized collector without a raw attribute',async()=>{
 const dom=await setupDOM();try{const {create}=await import('tiny-svg');
  for(const zoom of [.25,.6417129487814519,1.474269217291101,2]){
   const svg=create('svg'),root=create('g',{'class':'bpmn-xyflow-connect-handle','data-connect-source':'Gateway'}),marker=create('circle',{'class':'bpmn-xyflow-connect-fixed-anchor','data-anchor-index':0,cx:425,cy:200,r:2/zoom,fill:'white',stroke:'blue','stroke-width':1/zoom,'pointer-events':'visiblePainted'}),port=create('circle',{'class':'bpmn-xyflow-connect-port',cx:425,cy:200-20/zoom});svg.appendChild(root);root.append(marker,port);document.body.appendChild(svg);
   assert.equal(marker.getAttribute('stroke-width'),null);assert.equal(marker.style['stroke-width'],String(1/zoom)+'px');
   // Happy DOM does not alias tiny-svg's bracket-style property assignment to
   // the camel-case CSSOM getter. Reflect that exact installed value through
   // setProperty; Chrome performs this reflection itself.
   marker.style.setProperty('stroke-width',marker.style['stroke-width']);marker.style.setProperty('pointer-events',marker.style['pointer-events']);
   const matrix={a:zoom,b:0,c:0,d:zoom,e:0,f:0,inverse(){return{a:1/zoom,b:0,c:0,d:1/zoom,e:0,f:0};}};
   class DOMPoint{constructor(x,y){this.x=x;this.y=y;}matrixTransform(m){return new DOMPoint(this.x*m.a+this.y*m.c+m.e,this.x*m.b+this.y*m.d+m.f);}}
   // Structural DOM does not implement SVG paint membership/transforms. These
   // affine/circle shims isolate the actual installed CSS serialization seam.
   marker.getScreenCTM=()=>matrix;marker.isPointInFill=p=>Math.hypot(p.x-425,p.y-200)<=2/zoom;marker.isPointInStroke=p=>Math.hypot(p.x-425,p.y-200)<=2.5/zoom;
   const context={DOMPoint,document:{querySelector:s=>document.querySelector(s),createElement:t=>document.createElement(t),elementFromPoint:()=>marker},window:{modeler:{getViewport:()=>({zoom})},anchorInput:[]},getComputedStyle:e=>({display:'block',visibility:'visible',opacity:'1',fill:e.style.fill||'none',fillOpacity:'1',stroke:e.style.stroke||'none',strokeOpacity:'1',strokeWidth:e.style.strokeWidth||'0px',pointerEvents:e.style.pointerEvents||'auto'})};
   const value=JSON.parse(JSON.stringify(runInNewContext(`(${collectGatewayMarker.toString()})({id:'Gateway',index:0})`,context)));assertDirectGatewayMarker(value,node,0,{displaced:true});assert.equal(value.strokeWidth,marker.style.strokeWidth);svg.remove();
  }
 }finally{await dom.cleanup();}
});


test('measured toolbar exposure uses one native background pan and preserves geometry, selection, history and zoom',async()=>{
 const before={xml:'exact',history:{size:9,undo:true,redo:false},selection:[],nodes:[node],edges:{Flow:{points:[{x:425,y:200},{x:425,y:160}]}},viewport:{x:1113.7061433973463,y:776.0248335380645,zoom:1.2483305489016092}};
 const after=structuredClone(before);after.viewport.y+=19;const actions=[],start={x:1530,y:1027};
 const h={state:async()=>structuredClone(before),blank:async()=>start,settle:async()=>{},noChange:async(_page,b)=>{assert.deepEqual(b,before);return structuredClone(after);}};
 const page={mouse:{move:async(...args)=>actions.push(['move',...args]),down:async(...args)=>actions.push(['down',...args]),up:async(...args)=>actions.push(['up',...args])}};
 // The hosted camera puts the exact top vertex at rounded client (296,88),
 // beneath the toolbar visible in its screenshot. The browser collector,
 // not this fixture, supplies the live obstruction box during native input.
 const vertex={x:-655,y:-590},matrix={a:1.2483305931091309,d:1.2483305931091309,e:1113.7061692846764,f:824.0248960672179};
 const press={x:Math.round(vertex.x*matrix.a+matrix.e),y:Math.round(vertex.y*matrix.d+matrix.f)};assert.deepEqual(press,{x:296,y:88});
 const evidence={press,obstruction:{kind:'editor-actions',receiver:{tag:'SELECT',class:null},bounds:{left:150,top:58,right:482,bottom:95}}};
 const result=await exposeGatewayMarker(h,page,evidence);assert.equal(result.pan.to.y,1046);assert.deepEqual(actions,[['move',1530,1027],['down',{button:'middle'}],['move',1530,1046,{steps:6}],['up',{button:'middle'}]]);assert.deepEqual(result.press,press);
 for(const change of [e=>e.obstruction.kind='unknown',e=>e.press.x=500,e=>e.obstruction.bounds.bottom=NaN]){const bad=structuredClone(evidence);change(bad);actions.length=0;await assert.rejects(exposeGatewayMarker(h,page,bad));assert.deepEqual(actions,[]);}
 after.nodes[0].x++;await assert.rejects(exposeGatewayMarker(h,page,evidence));after.nodes=structuredClone(before.nodes);after.edges.Flow.points[0].y++;await assert.rejects(exposeGatewayMarker(h,page,evidence));after.edges=structuredClone(before.edges);after.viewport.zoom=2;await assert.rejects(exposeGatewayMarker(h,page,evidence));
});
