import assert from 'node:assert/strict';
import { gatewayVertices } from './gateway-native-oracle.mjs';
import { revealNative } from './anchor-followup-controls.mjs';

export const GATEWAY_MARKER_ZOOMS=Object.freeze([.25,1.4]);

/** Passive and serializable: observe the literal painted vertex and receiver. */
export function collectGatewayMarker({id,index}) {
 const root=document.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`);
 const marker=root?.querySelector(`.bpmn-xyflow-connect-fixed-anchor[data-anchor-index="${index}"]`),port=root?.querySelector('.bpmn-xyflow-connect-port');
 if(!marker||!port)return null;
 const point=e=>({x:Number(e.getAttribute('cx')),y:Number(e.getAttribute('cy'))});
 const anchor=point(marker),grab=point(port),matrix=marker.getScreenCTM();
 if(!matrix||![matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f].every(Number.isFinite)||matrix.a*matrix.d-matrix.b*matrix.c===0)throw Error('Invalid marker transform');
 const screen=new DOMPoint(anchor.x,anchor.y).matrixTransform(matrix),press={x:Math.round(screen.x),y:Math.round(screen.y)},local=new DOMPoint(press.x,press.y).matrixTransform(matrix.inverse());
 const hit=document.elementFromPoint(press.x,press.y),style=getComputedStyle(marker),zoom=window.modeler.getViewport().zoom,expectedStyle=document.createElement('span').style;expectedStyle.strokeWidth=String(1/zoom)+'px';
 let visible=marker.isConnected;for(let n=marker;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<=0)visible=false;}
 const toolbar=hit?.closest('.bpmn-xyflow-editor-actions'),box=toolbar?.getBoundingClientRect();
 const obstruction=box?{kind:'editor-actions',receiver:{tag:hit.tagName,class:hit.getAttribute('class')},bounds:{left:box.left,top:box.top,right:box.right,bottom:box.bottom}}:null;
 const ink=color=>color&&color!=='none'&&color!=='transparent'&&!/rgba\([^)]*,\s*0\s*\)/.test(color)&&!/[/]\s*0%?\s*\)/.test(color);
 const painted=visible&&((ink(style.fill)&&Number(style.fillOpacity)>0)||(ink(style.stroke)&&Number(style.strokeOpacity)>0&&parseFloat(style.strokeWidth)>0));
 return {id,index,anchor,grab,press,zoom,painted,obstruction,
  radius:Number(marker.getAttribute('r')),strokeWidth:marker.style.strokeWidth,computedStrokeWidth:style.strokeWidth,expectedStrokeWidth:expectedStyle.strokeWidth,
  pointerEvents:style.pointerEvents.toLowerCase(),paintContainsPress:marker.isPointInFill(local)||marker.isPointInStroke(local),
  actual:{marker:hit===marker,activePort:root.contains(hit)&&(hit===port||hit?.classList.contains('bpmn-xyflow-connect-hit')),owner:hit?.closest('.bpmn-xyflow-connect-handle')?.getAttribute('data-connect-source'),index:hit?.getAttribute('data-anchor-index')},
  delivered:window.anchorInput.findLast(e=>e.type==='mousemove')};
}
export function assertDirectGatewayMarker(evidence,node,index,{displaced=false}={}) {
 assert.ok(evidence);assert.equal(evidence.id,node.id);assert.equal(evidence.index,index);
 assert.deepEqual(evidence.anchor,gatewayVertices(node)[index]);assert.equal(evidence.painted,true);assert.equal(evidence.paintContainsPress,true);
 assert.equal(evidence.pointerEvents,'visiblepainted');assert.equal(evidence.radius,2/evidence.zoom);assert.ok(parseFloat(evidence.strokeWidth)>0);assert.equal(evidence.strokeWidth,evidence.expectedStrokeWidth);assert.equal(evidence.computedStrokeWidth,evidence.expectedStrokeWidth);
 assert.equal(evidence.actual.owner,node.id);
 if(evidence.actual.marker)assert.equal(evidence.actual.index,String(index));
 else{assert.equal(evidence.actual.activePort,true);assert.deepEqual(evidence.grab,evidence.anchor,'a coincident painted port is at the same literal vertex');}
 if(displaced){assert.equal(evidence.actual.marker,true,'low-zoom input reaches the vertex marker itself');assert.ok(Math.hypot(evidence.grab.x-evidence.anchor.x,evidence.grab.y-evidence.anchor.y)*evidence.zoom>=12-1e-8);}
}
export function observeGatewayMarkerInput() {
 window.gatewayMarkerInput=[];
 for(const type of ['mousedown','mouseup','keydown','touchstart','touchend','click'])window.addEventListener(type,event=>{
  const marker=event.target.closest?.('.bpmn-xyflow-connect-fixed-anchor'),handle=event.target.closest?.('.bpmn-xyflow-connect-handle');
  window.gatewayMarkerInput.push({type,trusted:event.isTrusted,x:event.clientX,y:event.clientY,key:event.key,
   owner:handle?.getAttribute('data-connect-source'),index:marker?.getAttribute('data-anchor-index'),target:event.target.getAttribute?.('class'),
   contextConnect:!!event.target.closest?.('.bpmn-xyflow-context-pad button[title^="Connect"]')});
 },true);
}
async function exactNoChange(h,page,before,label) {const after=await h.noChange(page,before,label);assert.deepEqual(after.selection,before.selection);assert.deepEqual(after.viewport,before.viewport);assert.deepEqual(after.nodes,before.nodes,'all live node and route geometry remains exact');assert.deepEqual(after.edges,before.edges,'all live edge references and routes remain exact');}
/** Expose the same vertex through one visible pan when the measured toolbar owns it. */
export async function exposeGatewayMarker(h,page,evidence) {
 const obstacle=evidence.obstruction;
 assert.equal(obstacle?.kind,'editor-actions');
 const {left,top,right,bottom}=obstacle.bounds,point=evidence.press;
 assert.ok([left,top,right,bottom,point.x,point.y].every(Number.isFinite));
 assert.ok(right>left&&bottom>top&&point.x>=left&&point.x<=right&&point.y>=top&&point.y<=bottom,'the actual toolbar covers this exact marker point');
 const before=await h.state(page),start=await h.blank(page),dy=Math.ceil(bottom+12-point.y);
 assert.ok(dy>0,'pan below the measured toolbar, retaining the vertex and zoom');
 await page.mouse.move(start.x,start.y);await page.mouse.down({button:'middle'});
 try{await page.mouse.move(start.x,start.y+dy,{steps:6});}finally{await page.mouse.up({button:'middle'});}
 await h.settle(page);
 const after=await h.noChange(page,before,'toolbar exposure changes only the camera');
 assert.deepEqual(after.selection,before.selection);assert.deepEqual(after.nodes,before.nodes);assert.deepEqual(after.edges,before.edges);assert.equal(after.viewport.zoom,before.viewport.zoom);assert.notDeepEqual(after.viewport,before.viewport);
 return {obstruction:obstacle,press:point,pan:{from:start,to:{x:start.x,y:start.y+dy}},before:before.viewport,after:after.viewport};
}
async function marker(h,page,id,index,selected,low) {
 let before,node,evidence;const exposure=[];
 for(let approach=0;approach<2;approach++){
  await h.blank(page,{click:true});if(selected)await h.selectNode(page,id);
  before=await h.state(page);node=h.node(before,id);const other=gatewayVertices(node)[(index+2)%4],center={x:node.x+node.width/2,y:node.y+node.height/2};
  // Advertise from the body, then press the chosen literal visible vertex.
  // A measured HTML toolbar obstruction is removed with native background pan;
  // no movement to the outward grab, model mutation or unknown-overlay waiver.
  const request=h.screen(before,{x:(other.x+center.x)/2,y:(other.y+center.y)/2});await page.mouse.move(Math.round(request.x),Math.round(request.y));await h.settle(page);
  evidence=await page.evaluate(collectGatewayMarker,{id,index});assert.ok(evidence?.painted);
  if(!evidence.obstruction)break;
  assert.equal(approach,0,'one measured native pan exposes the same chosen vertex');
  exposure.push(await exposeGatewayMarker(h,page,evidence));
 }
 assert.equal(evidence.obstruction,null,'the chosen vertex is outside the measured toolbar');
 await page.mouse.move(evidence.press.x,evidence.press.y);await h.settle(page);
 evidence=await page.evaluate(collectGatewayMarker,{id,index});assertDirectGatewayMarker(evidence,node,index,{displaced:low});
 assert.equal(evidence.delivered?.trusted,true);assert.equal(evidence.delivered.x,evidence.press.x);assert.equal(evidence.delivered.y,evidence.press.y);
 await exactNoChange(h,page,before,'direct marker acquisition keeps the complete model and selection');return {...evidence,exposure};
}
async function assertPress(page,evidence) {
 const press=await page.evaluate(()=>window.gatewayMarkerInput.findLast(e=>e.type==='mousedown'));
 assert.equal(press?.trusted,true);assert.equal(press.x,evidence.press.x);assert.equal(press.y,evidence.press.y);assert.equal(press.owner,evidence.id);
 if(evidence.actual.marker)assert.equal(press.index,String(evidence.index));else assert.ok(/bpmn-xyflow-connect-(port|hit)/.test(press.target));return press;
}
export async function directGatewayMarkerWorkflow(h,page,key,{source,target,index,selected,zoom}) {
 await h.zoom(page,zoom);let s=await h.state(page);await revealNative(h,page,[...gatewayVertices(h.node(s,source)),{x:h.node(s,target).x,y:h.node(s,target).y}]);
 s=await h.state(page);assert.ok(Math.abs(Math.log(s.viewport.zoom/zoom))<.15,'requested zoom band remains visible');
 const low=zoom<.5;let control=await marker(h,page,source,index,selected,low),before=await h.state(page);
 const exposure=control.exposure;if(exposure.length)await h.save(page,key+'-exposed',{control});
 const vector=[{x:0,y:-4},{x:4,y:0},{x:0,y:4},{x:-4,y:0}][index];
 await page.mouse.down();await assertPress(page,control);await exactNoChange(h,page,before,'marker press before activation');await page.mouse.move(control.press.x+vector.x,control.press.y+vector.y);await exactNoChange(h,page,before,'held four CSS pixel marker jitter');await page.mouse.up();await h.settle(page);
 assert.equal(await h.preview(page),null);await exactNoChange(h,page,before,'four CSS pixel marker jitter is a no-op');
 control=await marker(h,page,source,index,selected,low);before=await h.state(page);
 await page.mouse.down();await assertPress(page,control);await page.mouse.up();await h.settle(page);await exactNoChange(h,page,before,'stationary marker click is a no-op');
 const task=h.node(before,target),to={x:Math.round(h.screen(before,{x:task.x,y:task.y+task.height*.37}).x),y:Math.round(h.screen(before,{x:task.x,y:task.y+task.height*.37}).y)};
 // Immediate retry: the second press occurs at the unchanged pointer, with no
 // intervening movement or helper call to reacquire a different control.
 await page.mouse.down();await assertPress(page,control);await page.mouse.move(to.x,to.y,{steps:12});await h.settle(page);
 const cancelled=await h.preview(page);assert.ok(cancelled?.length>5);await exactNoChange(h,page,before,'active preview before Escape');h.near(cancelled.screenStart,h.screen(before,control.anchor),.05);
 await page.keyboard.press('Escape');await page.mouse.up();await h.settle(page);await exactNoChange(h,page,before,'activated marker Escape restores exact document/history/selection');
 control=await marker(h,page,source,index,selected,low);before=await h.state(page);let preview;
 await h.drag(page,control.press,to,{capture:async()=>{await assertPress(page,control);preview=await h.preview(page);assert.ok(preview?.length>5);h.near(preview.screenStart,h.screen(before,control.anchor),.05);await h.save(page,key+'-preview',{control,preview});}});
 const after=await h.state(page),added=Object.values(after.edges).filter(e=>!before.edges[e.id]);assert.equal(added.length,1);const edge=added[0],release=after.input.findLast(e=>e.type==='mouseup');
 assert.equal(release?.trusted,true);assert.deepEqual({x:release.x,y:release.y},to);assert.equal(edge.source,source);assert.equal(edge.target,target);assert.equal(edge.type,'bpmn:SequenceFlow');assert.deepEqual(edge.points[0],control.anchor);
 h.near(edge.points.at(-1),h.projected(task,release.graphPoint),.05/after.viewport.zoom);const paint=await h.renderEnds(page,edge.id);h.near(paint.start,preview.screenStart,.05);h.near(paint.end,preview.screenEnd,.05);
 assert.deepEqual(h.node(after,source),h.node(before,source),'direct marker gesture never moves its source');await h.creationOnly(before,after,edge);await h.history(page,before,after);await h.save(page,key+'-commit',{control,edge,release});return{zoom:after.viewport.zoom,index,selected,edge:edge.id,markerReceiver:control.actual,exposure};
}
export async function gatewayContextEntry(h,page,key,id,mode,target) {
 await h.blank(page,{click:true});await h.selectNode(page,id);
 if(mode==='keyboard'){
  const before=await h.state(page),shapes=before.nodes.filter(n=>!n.label&&!n.hidden&&Number.isFinite(n.x)&&Number.isFinite(n.y)),next=shapes[(shapes.findIndex(n=>n.id===id)+1)%shapes.length];
  // Existing Tab behavior cycles shapes; it is not a keyboard-only route into
  // the context pad. Preserve that behavior instead of inventing tab focus.
  await page.keyboard.press('Tab');await h.settle(page);const cycled=await h.noChange(page,before,'Tab changes only selection');assert.deepEqual(cycled.selection,[next.id]);assert.deepEqual(cycled.viewport,before.viewport);assert.deepEqual(cycled.nodes,before.nodes);await h.selectNode(page,id);
 }
 const before=await h.state(page),point=await h.contextConnect(page,id),selector='.bpmn-xyflow-context-pad button[title^="Connect"]';
 if(mode==='keyboard')await h.clickButton(page,selector);
 else{assert.equal(mode,'touch');const session=await page.createCDPSession();try{await session.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});await page.touchscreen.tap(point.x,point.y);}finally{await session.send('Emulation.setTouchEmulationEnabled',{enabled:false});await session.detach();}}
 await page.mouse.move(Math.round(point.x+50),Math.round(point.y+40));await h.settle(page);const preview=await h.preview(page);assert.ok(preview?.length>5);h.near(preview.screenStart,h.screen(before,gatewayVertices(h.node(before,id))[1]),.05);
 const inputs=await page.evaluate(()=>window.gatewayMarkerInput);assert.ok(inputs.some(e=>e.trusted&&(mode==='keyboard'?e.type==='keydown'&&e.key==='Tab':e.contextConnect&&e.type==='touchstart')));
 await page.keyboard.press('Escape');await h.settle(page);await exactNoChange(h,page,before,mode+' context-pad activation cancels without mutation');
 if(mode==='keyboard'){
  await h.blank(page,{click:true});await h.selectNode(page,id);const from=await h.contextConnect(page,id),baseline=await h.state(page),task=h.node(baseline,target),screen=h.screen(baseline,{x:task.x,y:task.y+task.height*.37}),to={x:Math.round(screen.x),y:Math.round(screen.y)};let live;
  await h.drag(page,from,to,{capture:async()=>{live=await h.preview(page);assert.ok(live?.length>5);h.near(live.screenStart,h.screen(baseline,gatewayVertices(h.node(baseline,id))[1]),.05);}});
  const after=await h.state(page),added=Object.values(after.edges).filter(e=>!baseline.edges[e.id]);assert.equal(added.length,1);const edge=added[0];assert.equal(edge.source,id);assert.equal(edge.target,target);assert.equal(edge.type,'bpmn:SequenceFlow');assert.deepEqual(edge.points[0],gatewayVertices(h.node(baseline,id))[1]);await h.creationOnly(baseline,after,edge);assert.equal(after.history.size,baseline.history.size+1);
  const release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);assert.deepEqual({x:release.x,y:release.y},to);h.near(edge.points.at(-1),h.projected(task,release.graphPoint),.05/after.viewport.zoom);const paint=await h.renderEnds(page,edge.id);h.near(paint.start,live.screenStart,.05);h.near(paint.end,live.screenEnd,.05);
  await h.blank(page,{click:true});
  for(const redo of [false,true]){await page.keyboard.down('Control');if(redo)await page.keyboard.down('Shift');try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Control');}await h.settle(page);assert.equal((await h.raw(page)).xml,redo?after.xml:baseline.xml,redo?'keyboard Redo restores exact committed XML':'keyboard Undo restores exact prior XML');}
  await h.noChange(page,after,'keyboard Undo/Redo preserves the committed history');
 }
 await h.save(page,key,{mode,keyboardOnlyConnectEntry:false,preview,inputs});
}
