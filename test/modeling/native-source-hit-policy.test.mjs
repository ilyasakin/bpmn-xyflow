import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { assertVisibleSourceProbe, installNativeSourceHitCapture, visibleSourceProbe } from '../helpers/native-source-hit-policy.mjs';

function pair(name,offset,ring=false) {
  const owner=name==='booking-attached-boundary'?'FlightTimeout':'Target',zoom=name.includes('0.65')?.65:name.includes('1.4')?1.4:.9;
  const control={owner,zoom,center:{x:30,y:40},hitCenter:{x:30,y:40},localPoint:{x:30,y:40},radius:5/zoom,strokeWidth:1.5/zoom,strokeWidthCSS:String(1.5/zoom),expectedStrokeWidthCSS:String(1.5/zoom),hitRadius:5.75/zoom,hitPointerEvents:'all',visible:true,paintedAtPoint:true,fill:'rgb(0, 80, 255)',stroke:'rgb(255, 255, 255)',inFill:true,inStroke:false};
  const target={owner,id:null,classes:'bpmn-xyflow-connect-hit'},point={x:370,y:334},history={size:0,undo:false,redo:false};
  return {name,upstream:{offset,ring,selection:[owner],target:{id:owner}},local:{selection:[],selectionBefore:[],historyBefore:history,historyAfter:{...history},input:[{type:'mousedown',trusted:true,point,target,queried:{...target},control},{type:'mouseup',trusted:true,point,target:{id:owner,owner:null,classes:'bpmn-xyflow-shape-hit'}}],restoredControl:structuredClone(control)}};
}

test('existing displaced-grab exceptions retain their twelve measured probe locations',()=>{
  let count=0;
  for(const [name,offsets]of [['target-endpoint-interior-0.65',[-6,6,-10,10,-6.5,6.5]],['target-endpoint-interior-1.4',[6,-10,10,-14,14]],['booking-attached-boundary',[0]]])for(const offset of offsets){
    const value=pair(name,offset,name==='booking-attached-boundary');assertVisibleSourceProbe(value.name,value.upstream,value.local);count++;
  }
  assert.equal(count,12);
  for(const [name,probe]of [['intermediateCatchEvent-crossing-1',{offset:-10}],['intermediateCatchEvent-crossing-1',{offset:10}],['booking-attached-boundary',{offset:-10}],['booking-attached-boundary',{offset:-9}],['booking-attached-boundary',{offset:0}],['target-endpoint-interior-0.65',{offset:0}],['target-endpoint-interior-1.4',{offset:-6}],['unknown',{offset:6}]])assert.equal(visibleSourceProbe(name,probe),null);
});

test('visible-tool evidence rejects halo-only, hidden, wrong-owner, synthetic, moved, or mutating presses',()=>{
  const value=pair('target-endpoint-interior-0.65',-6);
  const mutations=[
    v=>{v.local.input[0].control.hitRadius=8/v.local.input[0].control.zoom;},
    v=>{v.local.input[0].control.localPoint.x+=7/v.local.input[0].control.zoom;},
    v=>{v.local.input[0].control.inFill=false;},
    v=>{v.local.input[0].control.visible=false;},
    v=>{v.local.input[0].control.paintedAtPoint=false;},
    v=>{v.local.input[0].control.strokeWidthCSS='9px';},
    v=>{v.local.input[0].control.owner='Other';},
    v=>{v.local.input[0].target.owner='Other';},
    v=>{v.local.input[0].target.classes='bpmn-xyflow-shape-hit';},
    v=>{v.local.input[0].queried.id='Other';},
    v=>{v.local.input[0].trusted=false;},
    v=>{v.local.input[1].trusted=false;},
    v=>{v.local.input[1].point={x:371,y:334};},
    v=>{v.local.input.push(structuredClone(v.local.input[0]));},
    v=>{v.local.selection=['Target'];},
    v=>{v.local.selectionBefore=['Target'];},
    v=>{v.local.historyAfter.size=1;},
    v=>{v.local.restoredControl=null;},
    v=>{v.local.restoredControl.center.x++;},
    v=>{v.local.input[0].control.localPoint.x=NaN;},
    v=>{v.upstream.selection=['Flow'];},
  ];
  for(const mutate of mutations){const bad=structuredClone(value);mutate(bad);assert.throws(()=>assertVisibleSourceProbe(bad.name,bad.upstream,bad.local));}
  const stroke=structuredClone(value);Object.assign(stroke.local.input[0].control,{localPoint:{x:30+5.5/.65,y:40},inFill:false,inStroke:true});assertVisibleSourceProbe(stroke.name,stroke.upstream,stroke.local);
});

test('page collector is self-contained and records actual trusted target and SVG paint geometry synchronously',()=>{
  const listeners=new Map(),attrs={cx:'30',cy:'40',r:'5'},hitAttrs={...attrs,r:'5.75'};
  const handle={getAttribute:()=> 'Target',querySelector:selector=>selector.endsWith('connect-port')?port:hit};
  const target={closest:selector=>selector==='.bpmn-xyflow-connect-handle'?handle:null,getAttribute:()=> 'bpmn-xyflow-connect-hit'};
  const port={closest:()=>handle,getAttribute:key=>attrs[key],style:{strokeWidth:'1.5px'},getScreenCTM:()=>({inverse:()=>({})}),getBoundingClientRect:()=>({width:10,height:10}),isPointInFill:()=>true,isPointInStroke:()=>false};
  const hit={getAttribute:key=>hitAttrs[key]};
  const context={window:{hitEngine:{container:{contains:()=>true},viewport:()=>({zoom:1})}},document:{createElementNS:()=>({style:{}}),addEventListener:(name,fn)=>{listeners.set(name,fn);},elementFromPoint:()=>target},getComputedStyle:el=>el===hit?{pointerEvents:'all'}:{display:'inline',visibility:'visible',opacity:'1',fill:'blue',stroke:'white',fillOpacity:'1',strokeOpacity:'1'},DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return this;}}};
  vm.runInNewContext(`(${installNativeSourceHitCapture.toString()})()`,context);
  for(const type of ['mousemove','mousedown','mouseup'])assert.equal(listeners.get(type)({target,clientX:30,clientY:40,isTrusted:true}),undefined,'passive observer returns void');
  const events=JSON.parse(JSON.stringify(context.window.nativeHitCapture.events));assert.equal(events.length,3);
  assert.deepEqual(events[1].point,{x:30,y:40});assert.equal(events[1].trusted,true);assert.equal(events[1].target.owner,'Target');assert.deepEqual(events[1].target,events[1].queried);assert.equal(events[1].control.hitRadius,5.75);assert.equal(events[1].control.inFill,true);assert.equal(events[1].control.paintedAtPoint,true);
  assert.equal(events[1].control.strokeWidthCSS,'1.5px');assert.equal(events[1].control.expectedStrokeWidthCSS,events[1].control.strokeWidthCSS,'detached style uses the same px length as tiny-svg, including its unit');
  context.getComputedStyle=el=>el===hit?{pointerEvents:'all'}:{display:'inline',visibility:'visible',opacity:'1',fill:'rgb(0 80 255 / 0%)',stroke:'rgba(255,255,255,0)',fillOpacity:'1',strokeOpacity:'1'};
  listeners.get('mousedown')({target,clientX:30,clientY:40,isTrusted:true});assert.equal(context.window.nativeHitCapture.events.at(-1).control.paintedAtPoint,false);
});

function fixedPair(offset) {
  const value=pair('exclusiveGateway-crossing-0.2',offset),index=offset===-6?0:2,center={x:430,y:index===0?215:265},point={x:226,y:196+offset};
  const control={kind:'fixed-marker',tag:'circle',owner:'Crossing',zoom:.2,index,
    ownerShape:{id:'Crossing',type:'bpmn:ExclusiveGateway',x:405,y:215,width:50,height:50},
    center,hitCenter:{...center},localPoint:{x:430,y:(point.y-148)/.2},screenMatrix:{a:.2,b:0,c:0,d:.2,e:140,f:148},
    radius:10,hitRadius:10,strokeWidth:5,strokeWidthCSS:'5px',expectedStrokeWidthCSS:'5px',hitPointerEvents:'visiblepainted',
    visible:true,paintedAtPoint:true,fill:'white',stroke:'blue',inFill:true,inStroke:false};
  const target={owner:'Crossing',id:null,classes:'bpmn-xyflow-connect-fixed-anchor'};
  value.upstream.selection=['Crossing'];value.upstream.target.id='Crossing';
  Object.assign(value.local.input[0],{point,target,queried:{...target},control});
  Object.assign(value.local.input[1],{point:{...point},target:{id:'Crossing',owner:null,classes:'bpmn-xyflow-shape-hit'}});
  value.local.restoredControl=structuredClone(control);return value;
}

test('only the two measured low-zoom Gateway fixed-marker presses have explicit per-engine outcomes',()=>{
  for(const offset of [-6,6]){const value=fixedPair(offset);assertVisibleSourceProbe(value.name,value.upstream,value.local);}
  for(const offset of [0,-2,2,-10,10,-5,5])assert.equal(visibleSourceProbe('exclusiveGateway-crossing-0.2',{offset}),null);
  for(const name of ['exclusiveGateway-crossing-0.65','parallelGateway-crossing-0.2','unknown'])for(const offset of [-6,6])assert.equal(visibleSourceProbe(name,{offset}),null);
});

test('fixed-marker classification requires the actual typed, painted owned vertex, not old grab evidence',()=>{
  const mutations=[
    v=>v.local.input[0].control.kind='grab',v=>v.local.input[0].control.tag='rect',
    v=>v.local.input[0].control.index=2,v=>v.local.input[0].control.ownerShape.type='bpmn:Task',
    v=>v.local.input[0].control.ownerShape.y++,v=>v.local.input[0].control.center.y++,
    v=>v.local.input[0].control.radius=15,v=>v.local.input[0].control.hitRadius=40,
    v=>v.local.input[0].control.hitPointerEvents='all',v=>v.local.input[0].control.strokeWidth=6,
    v=>v.local.input[0].control.strokeWidthCSS='6px',v=>v.local.input[0].control.visible=false,
    v=>v.local.input[0].control.paintedAtPoint=false,v=>v.local.input[0].control.inFill=false,
    v=>v.local.input[0].control.localPoint.y-=20,v=>v.local.input[0].control.screenMatrix.e++,
    v=>v.local.input[0].control.screenMatrix.a=0,v=>v.local.input[0].target.classes='bpmn-xyflow-connect-hit',
    v=>v.local.input[0].target.owner='Other',v=>v.local.input[0].trusted=false,
    v=>v.local.input[1].point.y++,v=>v.local.selection=['Crossing'],
    v=>v.local.historyAfter.size++,v=>v.local.restoredControl.index=2,
    v=>v.local.restoredControl.hitRadius++,v=>v.upstream.selection=[],
  ];
  for(const mutate of mutations){const bad=fixedPair(-6);mutate(bad);assert.throws(()=>assertVisibleSourceProbe(bad.name,bad.upstream,bad.local));}
  const shifted=fixedPair(-6);
  for(const event of shifted.local.input)event.point={...event.point,y:event.point.y+1};
  shifted.local.input[0].control.localPoint.y+=5;shifted.local.restoredControl.localPoint.y+=5;
  assert.throws(()=>assertVisibleSourceProbe(shifted.name,shifted.upstream,shifted.local),/exact measured/,
    'another geometrically valid point within the same marker is not the measured probe');

});

test('serialized observer measures the dispatched fixed circle instead of its displaced grab',()=>{
  const listeners=new Map(),attrs={cx:'430',cy:'215',r:'10','data-anchor-index':'0'};
  const handle={getAttribute:()=> 'Crossing',querySelector:()=>{throw Error('fixed marker must not query the displaced grab');}};
  const marker={tagName:'circle',closest:selector=>selector==='.bpmn-xyflow-connect-handle'?handle:selector==='.bpmn-xyflow-connect-fixed-anchor'?marker:null,
    getAttribute:key=>key==='class'?'bpmn-xyflow-connect-fixed-anchor':attrs[key],style:{strokeWidth:'5px'},
    getScreenCTM:()=>({a:.2,b:0,c:0,d:.2,e:140,f:148,inverse:()=>({})}),getBoundingClientRect:()=>({width:4,height:4}),
    isPointInFill:()=>true,isPointInStroke:()=>false};
  const style={pointerEvents:'visiblepainted',display:'inline',visibility:'visible',opacity:'1',fill:'white',stroke:'blue',fillOpacity:'1',strokeOpacity:'1'};
  const context={window:{hitEngine:{container:{contains:()=>true},viewport:()=>({zoom:.2}),node:()=>({id:'Crossing',type:'bpmn:ExclusiveGateway',x:405,y:215,width:50,height:50})}},
    document:{createElementNS:()=>({style:{}}),addEventListener:(name,fn)=>listeners.set(name,fn),elementFromPoint:()=>marker},getComputedStyle:()=>style,
    DOMPoint:class{constructor(x,y){this.x=x;this.y=y;}matrixTransform(){return{x:(this.x-140)/.2,y:(this.y-148)/.2};}}};
  vm.runInNewContext(`(${installNativeSourceHitCapture.toString()})()`,context);
  const event={target:marker,clientX:226,clientY:190,isTrusted:true};assert.equal(listeners.get('mousedown')(event),undefined);
  const captured=JSON.parse(JSON.stringify(context.window.nativeHitCapture.events[0]));
  const value=fixedPair(-6);assert.deepEqual(captured.control,value.local.input[0].control);value.local.input[0]=captured;assertVisibleSourceProbe(value.name,value.upstream,value.local);
  style.fill='rgba(255,255,255,0)';style.stroke='rgb(0 0 255 / 0%)';listeners.get('mousedown')(event);assert.equal(context.window.nativeHitCapture.events.at(-1).control.paintedAtPoint,false);
  style.fill='white';style.stroke='blue';style.opacity='0';listeners.get('mousedown')(event);assert.equal(context.window.nativeHitCapture.events.at(-1).control.visible,false);
  const orphan={closest:()=>null};assert.equal(context.window.nativeHitCapture.control(orphan,event),null,'ordinary or orphaned targets are not source controls');
});
