/** User-requested Gateway vertex UX. Native input only; APIs collect evidence. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createAnchorHarness } from '../helpers/anchor-ux-browser.mjs';
import { paintReferenceExpectation } from '../helpers/connection-paint-oracles.mjs';
import { endpoint, revealNative } from '../helpers/anchor-followup-controls.mjs';
import { assertOnlyAnchorGeometry } from '../helpers/anchor-model-guard.mjs';
import { runFollowupCases, assertFollowupPortClosed } from '../helpers/anchor-followup-lifecycle.mjs';

import { gatewayVertices, nearestGatewayVertex as expectedGatewayVertex } from '../helpers/gateway-native-oracle.mjs';
export { gatewayVertices, expectedGatewayVertex };
const slope=(n,index)=>[
  {x:n.x+n.width*.62,y:n.y+n.height*.12},{x:n.x+n.width*.88,y:n.y+n.height*.62},
  {x:n.x+n.width*.38,y:n.y+n.height*.88},{x:n.x+n.width*.12,y:n.y+n.height*.38}
][index];
function fixed(n,p){assert.ok(gatewayVertices(n).some(v=>v.x===p.x&&v.y===p.y),'endpoint must equal one exact Gateway vertex: '+JSON.stringify(p));}
function orthogonal(points){assert.ok(points.length>=2&&points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));assert.ok(points.slice(1).every((p,i)=>p.x===points[i].x||p.y===points[i].y));}

// Self-contained passive page collector; no editor mutations or dispatches.
export function collectGatewayControl(id){
 const root=document.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`),dock=document.querySelector(`.bpmn-xyflow-connect-docking[data-connect-source="${id}"] circle`);
 if(!root||!dock)return null;
 const point=e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))});
 const visible=e=>{for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0)return false;}return e.isConnected;};
 const ink=value=>{const color=String(value||'').trim().toLowerCase();if(!color||color==='none'||color==='transparent')return false;const slash=color.lastIndexOf('/');if(slash>=0)return parseFloat(color.slice(slash+1))>0;if(color.startsWith('rgba(')||color.startsWith('hsla('))return parseFloat(color.slice(color.lastIndexOf(',')+1))>0;return true;};
 const painted=e=>{const style=getComputedStyle(e);return visible(e)&&Number(e.getAttribute('r'))>0&&((ink(style.fill)&&Number(style.fillOpacity)>0)||(ink(style.stroke)&&Number(style.strokeOpacity)>0&&parseFloat(style.strokeWidth)>0));};
 const markers=[...root.querySelectorAll('.bpmn-xyflow-connect-fixed-anchor')].map(e=>({index:Number(e.getAttribute('data-anchor-index')),point:point(e),visible:painted(e),pointerEvents:getComputedStyle(e).pointerEvents}));
 const port=root.querySelector('.bpmn-xyflow-connect-port'),p=point(port),screen=new DOMPoint(p.x,p.y).matrixTransform(port.getScreenCTM()),press={x:Math.round(screen.x),y:Math.round(screen.y)};
 return {id,markers,anchor:point(dock),grab:p,press,visible:painted(port),hit:root.contains(document.elementFromPoint(press.x,press.y)),delivered:window.anchorInput.findLast(e=>e.type==='mousemove')};
}
export function assertGatewayControl(control,node,expected){
 assert.ok(control);assert.equal(control.id,node.id);assert.equal(control.visible,true);assert.equal(control.hit,true);
 assert.deepEqual(control.markers.map(m=>m.index),[0,1,2,3]);assert.deepEqual(control.markers.map(m=>m.point),gatewayVertices(node));
 assert.ok(control.markers.every(m=>m.visible&&m.pointerEvents==='none'),'all four fixed candidates are visible but pointer-inert');
 assert.deepEqual(control.anchor,expected);
}
async function acquire(h,page,id,index,selected,key){
 await h.blank(page,{click:true});if(selected)await h.selectNode(page,id);
 const before=await h.state(page),n=h.node(before,id),request=h.screen(before,slope(n,index));
 await page.mouse.move(request.x,request.y,{steps:10});await h.settle(page);
 const first=await page.evaluate(collectGatewayControl,id);assert.equal(first?.delivered?.trusted,true);
 const expected=expectedGatewayVertex(n,h.graph(before,first.delivered));assertGatewayControl(first,n,expected);
 assert.deepEqual(expected,gatewayVertices(n)[index],'independent delivered point chooses the requested vertex');
 await h.save(page,key+'-advertised',{request,first});
 await page.mouse.move(first.press.x,first.press.y,{steps:Math.max(1,Math.ceil(Math.hypot(first.press.x-first.delivered.x,first.press.y-first.delivered.y)))});await h.settle(page);
 const reached=await page.evaluate(collectGatewayControl,id);assertGatewayControl(reached,n,expected);assert.deepEqual(reached.grab,first.grab);
 await h.noChange(page,before,'gateway vertex acquisition is passive');return reached;
}
async function create(h,page,key,source,target,index,selected,{cancel=false}={}){
 const control=await acquire(h,page,source,index,selected,key),before=await h.state(page),targetNode=h.node(before,target);
 const to=h.screen(before,{x:targetNode.x,y:targetNode.y+targetNode.height*.37});let preview;
 assert.ok((await h.hit(page,to)).owners.includes(target));
 await h.drag(page,control.press,to,{cancel,capture:async()=>{preview=await h.preview(page);assert.ok(preview?.length>5);h.near(preview.screenStart,h.screen(before,control.anchor),.05);await h.save(page,key+'-preview',{preview,control});}});
 const after=await h.state(page);
 if(cancel){await h.noChange(page,before,'Escape keeps gateway document/history exact');assert.deepEqual(after.selection,before.selection);return;}
 const added=Object.values(after.edges).filter(e=>!before.edges[e.id]);assert.equal(added.length,1);const e=added[0];assert.equal(e.source,source);assert.equal(e.target,target);assert.equal(e.type,'bpmn:SequenceFlow');assert.deepEqual(e.points[0],control.anchor);orthogonal(e.points);
 const release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);h.near(e.points.at(-1),h.projected(targetNode,release.graphPoint),.05/after.viewport.zoom);
 const paint=await h.renderEnds(page,e.id);h.near(paint.start,preview.screenStart,.05);h.near(paint.end,preview.screenEnd,.05);await h.creationOnly(before,after,e);await h.history(page,before,after);await h.save(page,key+'-commit',{e,preview,control,release});return e.id;
}
async function createIncoming(h,page,key,source,target,index){
 const control=await h.sourcePort(page,source,'left',.74),before=await h.state(page),n=h.node(before,target),to=h.screen(before,slope(n,index));let preview;
 assert.ok((await h.hit(page,to)).owners.includes(target));
 await h.drag(page,control.point,to,{capture:async()=>{preview=await h.preview(page);assert.ok(preview?.length>5);const state=await h.raw(page),input=state.input.findLast(e=>e.type==='mousemove');assert.equal(input?.trusted,true);h.near(preview.screenEnd,h.screen(before,expectedGatewayVertex(n,input.graphPoint)),.05);await h.save(page,key+'-preview',{control,preview,input});}});
 const after=await h.state(page),added=Object.values(after.edges).filter(e=>!before.edges[e.id]);assert.equal(added.length,1);const edge=added[0],release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);assert.equal(edge.source,source);assert.equal(edge.target,target);assert.equal(edge.type,'bpmn:SequenceFlow');assert.deepEqual(edge.points[0],control.anchor);assert.deepEqual(edge.points.at(-1),expectedGatewayVertex(n,release.graphPoint));orthogonal(edge.points);
 const paint=await h.renderEnds(page,edge.id);h.near(paint.start,preview.screenStart,.05);h.near(paint.end,preview.screenEnd,.05);await h.creationOnly(before,after,edge);await h.history(page,before,after);await h.save(page,key+'-commit',{edge,release});return edge.id;
}
async function deliberateLoop(h,page,key,id){
 const control=await acquire(h,page,id,1,true,key),before=await h.state(page),node=h.node(before,id),to=h.screen(before,slope(node,3));let preview;
 await h.drag(page,control.press,to,{capture:async()=>{preview=await h.preview(page);assert.ok(preview?.length>20);await h.save(page,key+'-preview',{preview,control});}});
 const after=await h.state(page),added=Object.values(after.edges).filter(e=>!before.edges[e.id]);assert.equal(added.length,1);const edge=added[0],release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);assert.equal(edge.source,id);assert.equal(edge.target,id);assert.equal(edge.type,'bpmn:SequenceFlow');assert.deepEqual(edge.points[0],control.anchor);assert.deepEqual(edge.points.at(-1),expectedGatewayVertex(node,release.graphPoint));orthogonal(edge.points);assert.ok(edge.points.length>=4);
 await h.creationOnly(before,after,edge);await h.history(page,before,after);await h.save(page,key+'-commit',{edge});
}
async function reconnect(h,page,key,id,side,target,index,{cancel=false}={}){
 const initial=await h.state(page),n=h.node(initial,target);await revealNative(h,page,[...initial.edges[id].points,slope(n,index)]);
 const from=await endpoint(h,page,id,side),before=await h.state(page),to=h.screen(before,slope(h.node(before,target),index));let live,paint;
 assert.ok((await h.hit(page,to)).owners.includes(target));
 await h.drag(page,from,to,{cancel,capture:async()=>{live=await h.state(page);const points=live.edges[id]?.points;orthogonal(points);assert.notDeepEqual(points,before.edges[id].points);const input=live.input.findLast(e=>e.type==='mousemove');assert.equal(input?.trusted,true);assert.deepEqual(side==='source'?points[0]:points.at(-1),expectedGatewayVertex(h.node(before,target),input.graphPoint));paint=await h.renderEnds(page,id);await h.save(page,key+'-preview',{side,target,points,paint,input});}});
 const after=await h.state(page);
 if(cancel){await h.noChange(page,before,'reconnect Escape preserves exact model/history');assert.deepEqual(after.selection,before.selection);return;}
 const e=after.edges[id],release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);assert.equal(e[side],target);assert.deepEqual(side==='source'?e.points[0]:e.points.at(-1),expectedGatewayVertex(h.node(before,target),release.graphPoint));assert.deepEqual(e.points,live.edges[id].points);
 const opposite=side==='source'?'target':'source',old=before.edges[id];assert.equal(e[opposite],old[opposite]);assert.deepEqual(side==='source'?e.points.at(-1):e.points[0],side==='source'?old.points.at(-1):old.points[0]);
 const committed=await h.renderEnds(page,id);h.near(committed.start,paint.start,.05);h.near(committed.end,paint.end,.05);
 if(old[side]===target)await assertOnlyAnchorGeometry(before.xml,after.xml,{edgeIds:[id]});else await h.reconnectOnly(before,after,id,side,target);
 await h.history(page,before,after);await h.save(page,key+'-commit',{e,release,paint});
}
async function move(h,page,id,key){
 await h.selectNode(page,id);const before=await h.state(page),n=h.node(before,id),from=h.screen(before,{x:n.x+n.width/2,y:n.y+n.height/2});assert.equal((await h.hit(page,from)).id,id);
 await h.drag(page,from,{x:from.x+45,y:from.y+30});const after=await h.state(page),changed=h.node(after,id);assert.notDeepEqual({x:changed.x,y:changed.y},{x:n.x,y:n.y});const incident=Object.values(after.edges).filter(e=>e.source===id||e.target===id);
 for(const e of incident){fixed(changed,e.source===id?e.points[0]:e.points.at(-1));orthogonal(e.points);await h.renderEnds(page,e.id);}
 await assertOnlyAnchorGeometry(before.xml,after.xml,{shapeIds:[id],edgeIds:incident.map(e=>e.id)});await h.history(page,before,after);await h.save(page,key,{incident,changed});
}
async function replaceGateway(h,page,id,key){
 await h.selectNode(page,id);const before=await h.state(page);assert.equal(h.node(before,id).type,'bpmn:ExclusiveGateway');
 await h.clickButton(page,'.bpmn-xyflow-context-pad button[title^="Change type"]');
 const selector='.bpmn-xyflow-replace-menu [data-action="replace-with-parallel-gateway"]';
 assert.equal(await page.$eval(selector,e=>e.textContent),'Parallel gateway');await h.clickButton(page,selector);await h.settle(page);
 const after=await h.state(page);assert.equal(h.node(after,id).type,'bpmn:ParallelGateway');
 const expected=await h.oracle.fromXML(before.xml),old=expected.elementsById[id],next=h.oracle.create('bpmn:ParallelGateway');
 for(const [k,v]of Object.entries(old))if(k!=='$type')next[k]=v;next.$parent=old.$parent;
 const list=old.$parent.flowElements;list[list.indexOf(old)]=next;
 for(const object of Object.values(expected.elementsById))for(const property of object.$descriptor?.properties||[]){if(!property.isReference||property.isVirtual)continue;const value=object[property.name];if(Array.isArray(value))object[property.name]=value.map(v=>v===old?next:v);else if(value===old)object[property.name]=next;}
 assert.equal((await h.oracle.toXML(expected.rootElement,{format:true})).xml,after.canonical,'replace changes only the Gateway type and its corresponding object references');
 for(const e of Object.values(after.edges).filter(e=>e.source===id||e.target===id))fixed(h.node(after,id),e.source===id?e.points[0]:e.points.at(-1));
 await h.history(page,before,after);await h.save(page,key,{id});
}
async function copyLegacy(h,page,key){
 const taskId='sid-88D4DFBF-A30A-4A01-958F-81D460034146',gatewayId='sid-386727C5-9FC7-4C8A-B2BA-D491C9B440AC',flowId='sid-262FECFE-432B-42B6-AAF7-040A6B6D1880';
 await h.blank(page,{click:true});await page.keyboard.press('0');await h.settle(page);
 const initial=await h.state(page);assert.deepEqual(initial.viewport,{x:0,y:0,zoom:1});const legacy=initial.edges[flowId],gateway=h.node(initial,gatewayId);assert.ok(legacy);assert.ok(!gatewayVertices(gateway).some(v=>v.x===legacy.points.at(-1).x&&v.y===legacy.points.at(-1).y),'fixture positively contains historical nonvertex DI');
 await h.selectNode(page,taskId);let state=await h.state(page);const g=h.node(state,gatewayId),center=h.screen(state,{x:g.x+g.width/2,y:g.y+g.height/2});assert.equal((await h.hit(page,center)).id,gatewayId);
 await page.keyboard.down('Shift');try{await page.mouse.click(center.x,center.y);}finally{await page.keyboard.up('Shift');}await h.settle(page);assert.deepEqual((await h.raw(page)).selection.sort(),[taskId,gatewayId].sort());
 await h.noChange(page,initial,'selection of legacy nodes never changes docking');
 const shortcut=async key=>{await page.keyboard.down('Control');try{await page.keyboard.press(key);}finally{await page.keyboard.up('Control');}await h.settle(page);};
 await shortcut('c');await shortcut('v');const copied=await h.state(page),newNodes=copied.nodes.filter(n=>!n.label&&!initial.nodes.some(old=>old.id===n.id)),newEdges=Object.values(copied.edges).filter(e=>!initial.edges[e.id]);
 assert.equal(newNodes.length,2);assert.equal(newEdges.length,1);const copyG=newNodes.find(n=>n.type==='bpmn:ExclusiveGateway'),copyTask=newNodes.find(n=>n.type==='bpmn:Task'),e=newEdges[0];assert.ok(copyG&&copyTask);assert.equal(e.source,copyTask.id);assert.equal(e.target,copyG.id);
 const originalTask=h.node(initial,taskId),dx=copyTask.x-originalTask.x,dy=copyTask.y-originalTask.y;assert.deepEqual(e.points,legacy.points.map(p=>({x:p.x+dx,y:p.y+dy})));assert.equal(copyG.x-g.x,dx);assert.equal(copyG.y-g.y,dy);
 const expected=await h.oracle.fromXML(copied.xml),remove=new Set([...newNodes.map(n=>n.id),e.id]);
 for(const id of remove){const bo=expected.elementsById[id];assert.ok(bo?.$parent?.flowElements);const list=bo.$parent.flowElements;list.splice(list.indexOf(bo),1);}
 for(const diagram of expected.rootElement.diagrams)diagram.plane.planeElement=diagram.plane.planeElement.filter(di=>!remove.has(di.bpmnElement.id));
 assert.equal((await h.oracle.toXML(expected.rootElement,{format:true})).xml,initial.canonical,'clipboard leaves the whole original document unchanged');
 await h.history(page,initial,copied);await h.save(page,key+'-legacy-copy',{legacy,copied:e,dx,dy});
 await reconnect(h,page,key+'-adopt',e.id,'target',copyG.id,1);return{original:flowId,copied:e.id};
}
// Pinned reference import materializes this one default on fresh Exclusive
// Gateway DI. This adapter changes only the independently expected document;
// the visible export/paste still uses the exact local XML unchanged.
export async function gatewayReferenceReopenState(_h,state,ids){
 assert.equal(new Set(ids).size,ids.length);let canonical=state.canonical;const referenceAdjustments=[];
 for(const id of ids){const expected=await paintReferenceExpectation(canonical||state.xml,id);canonical=expected.canonical;referenceAdjustments.push(expected.adjustment);}
 return {...state,canonical,referenceAdjustments};
}

async function workflow(h,page,key,{index,selected}){
 await h.zoom(page,selected?1.4:.6);
 const source=await h.palette(page,'Gateway',{x:850,y:480}),other=await h.palette(page,'Gateway',{x:550,y:760}),target=await h.palette(page,'Task',{x:1250,y:760});
 await create(h,page,key+'-cancel',source,target,index,selected,{cancel:true});const id=await create(h,page,key+'-create',source,target,index,selected);
 await createIncoming(h,page,key+'-incoming',target,source,(index+1)%4);
 await reconnect(h,page,key+'-source-cancel',id,'source',other,index,{cancel:true});await reconnect(h,page,key+'-source',id,'source',other,index);
 await reconnect(h,page,key+'-target',id,'target',source,(index+2)%4);await move(h,page,source,key+'-move');
 if(index===0&&selected)await replaceGateway(h,page,source,key+'-replace');
 if(index===1&&selected)await deliberateLoop(h,page,key+'-loop',source);
 const after=await h.state(page),exclusiveIds=[source,other].filter(id=>h.node(after,id).type==='bpmn:ExclusiveGateway'),expected=await gatewayReferenceReopenState(h,after,exclusiveIds);await h.save(page,key+'-reference-defaults',{adjustments:expected.referenceAdjustments});await h.reopenThroughVisibleReference(page,expected,key+'-reopen');return{source,other,target,id,index,selected,edge:after.edges[id],referenceAdjustments:expected.referenceAdjustments};
}
export const gatewayAnchorCases=[false,true].flatMap(selected=>[0,1,2,3].map(index=>({id:`GV-${selected?'selected':'plain'}-${index}`,name:`${['top','right','bottom','left'][index]} vertex ${selected?'selected':'plain'}`,engine:'local',sample:'Empty diagram',run:(h,page,key)=>workflow(h,page,key,{index,selected})})));
// Known separate clipboard precision defect: odd selection extents round copied
// shape origins without rounding route translation. Retain the strict case; it
// is not counted as accepted Gateway coverage or silently weakened.
export const gatewayClipboardCases=[{id:'GV-authored-copy',name:'authored nonvertex copy then explicit reconnect',engine:'local',sample:'Conditional flows',knownIssue:'copied relative geometry drifts by half a unit',run:copyLegacy}];
export async function runGatewayAnchorCases(cases=gatewayAnchorCases,output='test-artifacts/gateway-anchors'){
 const basePort=Number(process.env.BPMN_GATEWAY_ANCHOR_PORT||5480);await mkdir(output,{recursive:true});
 const persist=(name,value,signal)=>writeFile(`${output}/${name}`,JSON.stringify(value,null,2),{signal});
 const results=await runFollowupCases(cases,{createHarness:(_c,i)=>createAnchorHarness({port:basePort+i,output}),verifyStopped:(_h,_c,i)=>assertFollowupPortClosed(basePort+i),
  captureFailure:async(h,page,key,error,signal)=>{await page.screenshot({path:`${output}/${key}-failure.png`,fullPage:true});signal.throwIfAborted();const state=await h.raw(page);await writeFile(`${output}/${key}-failure.bpmn`,state.xml,{signal});await persist(`${key}-failure.json`,{error:String(error),state},signal);},
  persistProgress:(value,i,signal)=>persist(`results-progress-${i+1}.json`,value,signal),persistAggregate:(value,signal)=>persist('results.json',value,signal)});
 assert.equal(results.length,cases.length);assert.equal(results.filter(r=>r.status!=='passed').length,0,`Gateway native failures; see ${output}`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const legacy=process.argv.includes('--legacy-copy'),cases=legacy?gatewayClipboardCases:gatewayAnchorCases;if(process.argv.includes('--list'))console.log(JSON.stringify(cases.map(({run:_run,...c})=>({...c,status:legacy?'open-known-defect':'prepared-unrun'})),null,2));else await runGatewayAnchorCases(cases,legacy?'test-artifacts/gateway-clipboard':'test-artifacts/gateway-anchors');}
