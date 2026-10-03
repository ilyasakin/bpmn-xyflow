import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { setupDOM } from '../helpers/dom.mjs';
import { gatewayAnchorCases, gatewayClipboardCases, gatewayVertices, expectedGatewayVertex, collectGatewayControl, assertGatewayControl, gatewayReferenceReopenState, assertGatewayMoveGeometry, assertGatewayRouteOutside, gatewayReplacementExpectation } from './browser-gateway-anchors.mjs';
const node={id:'Gateway',type:'bpmn:ExclusiveGateway',x:400,y:200,width:50,height:50};

test('eight core native workflows cover vertices/selection while the strict clipboard defect remains separately open',()=>{
 assert.equal(gatewayAnchorCases.length,8);assert.equal(new Set(gatewayAnchorCases.map(c=>c.id)).size,8);
 for(const selected of ['plain','selected'])for(let i=0;i<4;i++)assert.equal(gatewayAnchorCases.filter(c=>c.id===`GV-${selected}-${i}`).length,1);
 assert.equal(gatewayClipboardCases.length,1);assert.equal(gatewayClipboardCases[0].sample,'Conditional flows');assert.equal(gatewayClipboardCases[0].id,'GV-authored-copy');assert.ok(gatewayClipboardCases[0].knownIssue.includes('half a unit'));assert.ok(gatewayAnchorCases.every(c=>c.engine==='local'&&typeof c.run==='function'));
});

test('Gateway control acceptance requires four exact painted candidates, painted-only hit policy and the exact selected vertex',()=>{
 const expected=gatewayVertices(node),good={id:node.id,zoom:2,visible:true,hit:true,anchor:expected[1],markers:expected.map((point,index)=>({point,index,visible:true,pointerEvents:'visiblepainted',radius:1,strokeWidth:'0.5px',computedStrokeWidth:'0.5px',expectedStrokeWidth:'0.5px'}))};
 assertGatewayControl(good,node,expected[1]);
 for(const corrupt of [c=>c.markers.pop(),c=>c.markers[2].point.y-=1e-10,c=>c.markers[0].index=2,c=>c.markers[1].visible=false,c=>c.markers[3].pointerEvents='all',c=>c.markers[0].computedStrokeWidth='2px',c=>c.anchor={x:437.5,y:212.5},c=>c.visible=false,c=>c.hit=false,c=>c.id='Other']){const c=structuredClone(good);corrupt(c);assert.throws(()=>assertGatewayControl(c,node,expected[1]));}
 assert.deepEqual(expectedGatewayVertex(node,{x:437.5,y:212.5}),expected[0]);
});

test('serialized native collector reads geometry and actual paint without module lexical dependencies',()=>{
 const style=()=>({display:'block',visibility:'visible',opacity:'1',fill:'none',fillOpacity:'1',stroke:'rgb(12, 40, 220)',strokeOpacity:'1',strokeWidth:'0.5px',pointerEvents:'visiblepainted'});
 const circle=(point,index,r=2)=>({style:style(),isConnected:true,parentElement:null,attrs:{cx:point.x,cy:point.y,'data-anchor-index':index,r},getAttribute(k){return this.attrs[k];},getScreenCTM(){return {a:2,b:0,c:0,d:2,e:20,f:48};}});
 const markers=gatewayVertices(node).map((p,i)=>circle(p,i,1)),port=circle({x:465,y:225},null,5),dock=circle(gatewayVertices(node)[1]);
 const root={querySelector:()=>port,querySelectorAll:()=>markers,contains:e=>e===port};
 class DOMPoint{constructor(x,y){this.x=x;this.y=y;}matrixTransform(m){return {x:this.x*m.a+this.y*m.c+m.e,y:this.x*m.b+this.y*m.d+m.f};}}
 const context={DOMPoint,getComputedStyle:e=>e.style,document:{createElement:()=>({style:{}}),querySelector:s=>s.includes('connect-handle')?root:dock,elementFromPoint:()=>port},window:{modeler:{getViewport:()=>({zoom:2})},anchorInput:[{type:'mousemove',trusted:true,x:950,y:498}]}};
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


test('Gateway movement permits exactly its translated external label and rejects other semantic or DI changes',async()=>{
 const dom=await setupDOM();let m;
 try{const {default:Modeler}=await dom.loadModule('/lib/Modeler.js'),oracle=new BpmnModdle();m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,snap:false});
  await m.importXML(await readFile('test/fixtures/gateway-native-repair/crossing-retained-route.bpmn','utf8'));
  const gateway=m.getGraph().nodes.find(n=>n.type==='bpmn:ExclusiveGateway'&&n.id.endsWith('_1')),other=m.getGraph().nodes.find(n=>n.type==='bpmn:ExclusiveGateway'&&n!==gateway),incident=m.getGraph().edges.filter(e=>e.source===gateway||e.target===gateway).map(e=>e.id),before=await m.getXML();
  assert.ok(m.moveShape(gateway,{x:31,y:29}));const after=await m.getXML();await assertGatewayMoveGeometry(oracle,before,after,gateway.id,incident);
  const diagram=p=>p.rootElement.diagrams[0].plane.planeElement,own=p=>diagram(p).find(di=>di.bpmnElement.id===gateway.id),unrelated=p=>diagram(p).find(di=>di.bpmnElement.id===other.id);
  for(const corrupt of [p=>own(p).label.bounds.x++,p=>own(p).label.bounds.width++,p=>unrelated(p).label.bounds.y++,p=>{p.elementsById[gateway.id].name='unexpected';},p=>diagram(p).reverse(),p=>{const edge=diagram(p).find(di=>di.waypoint&&!incident.includes(di.bpmnElement.id));edge.waypoint[1].x++;}]){
   const p=await oracle.fromXML(after);corrupt(p);await assert.rejects(assertGatewayMoveGeometry(oracle,before,(await oracle.toXML(p.rootElement,{format:true})).xml,gateway.id,incident));
  }
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
 }finally{m?.destroy();await dom.cleanup();}
});

test('native Gateway route guard rejects interior crossings despite correct terminal vertices',()=>{
 const g={type:'bpmn:ExclusiveGateway',x:400,y:100,width:50,height:50};
 assertGatewayRouteOutside([{x:350,y:125},{x:400,y:125}],g);
 assertGatewayRouteOutside([{x:425,y:100},{x:425,y:80},{x:470,y:80},{x:470,y:125},{x:450,y:125}],g);
 for(const points of [[{x:350,y:125},{x:475,y:125},{x:475,y:80},{x:425,y:80},{x:425,y:100}],[{x:425,y:50},{x:425,y:175},{x:470,y:175},{x:470,y:125},{x:450,y:125}]])assert.throws(()=>assertGatewayRouteOutside(points,g));
});

test('Gateway replacement expectation preserves non-enumerable incoming refs from the exact hosted export',async()=>{
 const dom=await setupDOM();let m;
 try{const {default:Modeler}=await dom.loadModule('/lib/Modeler.js'),oracle=new BpmnModdle();m=new Modeler({container:dom.createContainer(),fitViewOnInit:false,palette:false,snap:false});
  await m.importXML(await readFile('test/fixtures/gateway-native-repair/replacement-incoming-refs.bpmn','utf8'));
  const gateway=m.getGraph().nodes.find(n=>n.type==='bpmn:ExclusiveGateway'&&n.id.endsWith('_1')),before=await m.getXML(),parsed=await oracle.fromXML(before),old=parsed.elementsById[gateway.id];
  assert.equal(old.incoming.length,2);assert.equal(Object.prototype.propertyIsEnumerable.call(old,'incoming'),false);assert.ok(!Object.entries(old).some(([key])=>key==='incoming'));
  const expected=await gatewayReplacementExpectation(oracle,before,gateway.id);assert.ok(m.replace(gateway,'bpmn:ParallelGateway')===gateway);const after=await m.getXML();
  assert.equal((await oracle.toXML((await oracle.fromXML(after)).rootElement,{format:true})).xml,expected);
  for(const corrupt of [p=>p.elementsById[gateway.id].incoming.pop(),p=>{const edge=p.elementsById[gateway.id].incoming[0];edge.targetRef=edge.sourceRef;},p=>{p.elementsById[gateway.id].name='unrelated';},p=>{const di=p.rootElement.diagrams[0].plane.planeElement.find(di=>di.bpmnElement.id===gateway.id);di.bounds.x++;}]){const p=await oracle.fromXML(after);corrupt(p);assert.notEqual((await oracle.toXML(p.rootElement,{format:true})).xml,expected);}
  for(let i=0;i<3;i++){m.undo();assert.equal(await m.getXML(),before);m.redo();assert.equal(await m.getXML(),after);}
 }finally{m?.destroy();await dom.cleanup();}
});
