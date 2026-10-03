import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { gatewayAnchorCases, gatewayClipboardCases, gatewayVertices, expectedGatewayVertex, collectGatewayControl, assertGatewayControl, gatewayReferenceReopenState } from './browser-gateway-anchors.mjs';
const node={id:'Gateway',type:'bpmn:ExclusiveGateway',x:400,y:200,width:50,height:50};

test('eight core native workflows cover vertices/selection while the strict clipboard defect remains separately open',()=>{
 assert.equal(gatewayAnchorCases.length,8);assert.equal(new Set(gatewayAnchorCases.map(c=>c.id)).size,8);
 for(const selected of ['plain','selected'])for(let i=0;i<4;i++)assert.equal(gatewayAnchorCases.filter(c=>c.id===`GV-${selected}-${i}`).length,1);
 assert.equal(gatewayClipboardCases.length,1);assert.equal(gatewayClipboardCases[0].sample,'Conditional flows');assert.equal(gatewayClipboardCases[0].id,'GV-authored-copy');assert.ok(gatewayClipboardCases[0].knownIssue.includes('half a unit'));assert.ok(gatewayAnchorCases.every(c=>c.engine==='local'&&typeof c.run==='function'));
});

test('Gateway control acceptance requires four exact painted candidates, inert hit policy and the exact selected vertex',()=>{
 const expected=gatewayVertices(node),good={id:node.id,visible:true,hit:true,anchor:expected[1],markers:expected.map((point,index)=>({point,index,visible:true,pointerEvents:'none'}))};
 assertGatewayControl(good,node,expected[1]);
 for(const corrupt of [c=>c.markers.pop(),c=>c.markers[2].point.y-=1e-10,c=>c.markers[0].index=2,c=>c.markers[1].visible=false,c=>c.markers[3].pointerEvents='all',c=>c.anchor={x:437.5,y:212.5},c=>c.visible=false,c=>c.hit=false,c=>c.id='Other']){const c=structuredClone(good);corrupt(c);assert.throws(()=>assertGatewayControl(c,node,expected[1]));}
 assert.deepEqual(expectedGatewayVertex(node,{x:437.5,y:212.5}),expected[0]);
});

test('serialized native collector reads geometry and actual paint without module lexical dependencies',()=>{
 const style=()=>({display:'block',visibility:'visible',opacity:'1',fill:'none',fillOpacity:'1',stroke:'rgb(12, 40, 220)',strokeOpacity:'1',strokeWidth:'1',pointerEvents:'none'});
 const circle=(point,index,r=2)=>({style:style(),isConnected:true,parentElement:null,attrs:{cx:point.x,cy:point.y,'data-anchor-index':index,r},getAttribute(k){return this.attrs[k];},getScreenCTM(){return {a:2,b:0,c:0,d:2,e:20,f:48};}});
 const markers=gatewayVertices(node).map((p,i)=>circle(p,i)),port=circle({x:465,y:225},null,5),dock=circle(gatewayVertices(node)[1]);
 const root={querySelector:()=>port,querySelectorAll:()=>markers,contains:e=>e===port};
 class DOMPoint{constructor(x,y){this.x=x;this.y=y;}matrixTransform(m){return {x:this.x*m.a+this.y*m.c+m.e,y:this.x*m.b+this.y*m.d+m.f};}}
 const context={DOMPoint,getComputedStyle:e=>e.style,document:{querySelector:s=>s.includes('connect-handle')?root:dock,elementFromPoint:()=>port},window:{anchorInput:[{type:'mousemove',trusted:true,x:950,y:498}]}};
 const read=()=>JSON.parse(JSON.stringify(runInNewContext(`(${collectGatewayControl.toString()})('Gateway')`,context)));
 assertGatewayControl(read(),node,gatewayVertices(node)[1]);assert.deepEqual(read().press,{x:950,y:498});
 for(const transparent of ['transparent','none','rgba(0, 10, 30, 0)','rgb(0 10 30 / 0%)','color(srgb 0 0 1 / 0)']){markers[0].style.stroke=transparent;assert.equal(read().markers[0].visible,false);}
 markers[0].style.stroke='rgb(12,40,220)';markers[0].style.opacity='0';assert.equal(read().markers[0].visible,false);markers[0].style.opacity='1';markers[0].attrs.r=0;assert.equal(read().markers[0].visible,false);
});


test('actual pinned reopen adds only the known absent ExclusiveGateway marker defaults',async()=>{
 const dom=await setupDOM();try{const {default:Local}=await dom.loadModule('/lib/Modeler.js'),{default:Reference}=await dom.loadModule('/node_modules/bpmn-js/lib/Modeler.js'),oracle=new BpmnModdle();
  for(const replace of [false,true]){const m=new Local({container:dom.createContainer(),fitViewOnInit:false}),reference=new Reference({container:dom.createContainer()});try{
   await m.importXML(await readFile('test/fixtures/bpmn/basic.bpmn','utf8'));const a=m.addShape('bpmn:ExclusiveGateway',{x:600,y:400}),b=m.addShape('bpmn:ExclusiveGateway',{x:900,y:500});assert.ok(m.connect(a,m.getElement('Task_1')));if(replace)assert.ok(m.replace(a,'bpmn:ParallelGateway'));
   const xml=await m.getXML(),state={xml,canonical:(await oracle.toXML((await oracle.fromXML(xml)).rootElement,{format:true})).xml},ids=[a,b].filter(n=>n.type==='bpmn:ExclusiveGateway').map(n=>n.id),expected=await gatewayReferenceReopenState({oracle},state,ids);assert.equal(expected.xml,xml);assert.notEqual(expected.canonical,state.canonical);
   await reference.importXML(xml);const reopened=(await reference.saveXML({format:true})).xml,canonical=async text=>(await oracle.toXML((await oracle.fromXML(text)).rootElement,{format:true})).xml;assert.equal(await canonical(reopened),expected.canonical);
   await assert.rejects(gatewayReferenceReopenState({oracle},state,['Unknown']));await assert.rejects(gatewayReferenceReopenState({oracle},state,['Task_1']));await assert.rejects(gatewayReferenceReopenState({oracle},state,[ids[0],ids[0]]));
   const explicit=await oracle.fromXML(xml),entry=explicit.rootElement.diagrams[0].plane.planeElement.find(di=>di.bpmnElement.id===ids[0]);entry.isMarkerVisible=false;await assert.rejects(gatewayReferenceReopenState({oracle},{xml:(await oracle.toXML(explicit.rootElement,{format:true})).xml},ids));
   for(const corrupt of [p=>{p.elementsById.Task_1_di.bounds.x++;},p=>{p.elementsById.Task_1.name='changed';},p=>{p.rootElement.targetNamespace='urn:wrong';},p=>{p.rootElement.diagrams[0].plane.planeElement.reverse();}]){const p=await oracle.fromXML(reopened);corrupt(p);assert.notEqual((await oracle.toXML(p.rootElement,{format:true})).xml,expected.canonical,'unrelated DI/semantic/namespace/order changes remain rejected');}
   assert.equal(await m.getXML(),xml);
  }finally{m.destroy();reference.destroy();}}
 }finally{await dom.cleanup();}
});
