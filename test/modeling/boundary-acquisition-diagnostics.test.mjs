import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import { installBoundaryAcquisitionDiagnostics, markBoundaryAcquisitionPhase, readBoundaryAcquisitionDiagnostics } from '../helpers/boundary-acquisition-diagnostics.mjs';

function fixture(){
  const window=new Window(), document=window.document, callbacks=new Map();
  const originals=new Map();
  for(const [key,value]of Object.entries({window,document,MutationObserver:window.MutationObserver})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});
  }
  document.body.innerHTML='<div id="viewer"><svg class="bpmn-xyflow-canvas"><g class="bpmn-xyflow-viewport"></g></svg></div>';
  let viewport={x:557.6760518360127,y:358.229033698398,zoom:0.8788735989262744};
  let selection=['FlightTimeout'];const calls=[];
  window.modeler={getViewport:()=>({...viewport}),getSelection:()=>[...selection],commandStack:{size:()=>0},canUndo:()=>false,canRedo:()=>false,
    viewer:{on:(type,callback)=>{const set=callbacks.get(type)||new Set();set.add(callback);callbacks.set(type,set);return()=>set.delete(callback);}}};
  const view=document.querySelector('.bpmn-xyflow-viewport');
  view.getScreenCTM=()=>({a:viewport.zoom,b:0,c:0,d:viewport.zoom,e:viewport.x,f:viewport.y+48});
  document.querySelector('svg').getScreenCTM=()=>({a:1,b:0,c:0,d:1,e:0,f:48});
  document.elementFromPoint=()=>view.querySelector('.bpmn-xyflow-connect-hit')||view;
  const serialized=Function(`return (${installBoundaryAcquisitionDiagnostics.toString()})`)();serialized();
  return{window,document,view,calls,emit(type,event){for(const callback of callbacks.get(type)||[])callback(event);},
    async close(){window.boundaryAcquisitionDiagnostics.stop();await window.happyDOM.abort();for(const[key,descriptor]of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}};
}

test('passive serialized observer records exact unchanged-value viewport notifications and removal',async()=>{
  const h=fixture();try{
    h.view.innerHTML='<g class="bpmn-xyflow-connect-docking" data-connect-source="FlightTimeout"><circle class="bpmn-xyflow-connect-docking-point" cx="678.3370087109132" cy="315.18639520580945"/></g><g class="bpmn-xyflow-connect-handle" data-connect-source="FlightTimeout"><circle class="bpmn-xyflow-connect-port" cx="655.6204680086178" cy="350.88780013241137" r="5.689100395"/><circle class="bpmn-xyflow-connect-hit"/></g>';
    await h.window.happyDOM.whenAsyncComplete();
    const hit=h.view.querySelector('.bpmn-xyflow-connect-hit');
    hit.dispatchEvent(new h.window.MouseEvent('mousemove',{bubbles:true,clientX:1134,clientY:715}));
    await Promise.resolve();
    const before=readBoundaryAcquisitionDiagnostics().current;
    markBoundaryAcquisitionPhase('screenshot:before');
    const viewport=h.window.modeler.getViewport();
    h.emit('viewport.change',{viewport});
    h.view.querySelector('.bpmn-xyflow-connect-handle').remove();
    await h.window.happyDOM.whenAsyncComplete();
    markBoundaryAcquisitionPhase('screenshot:after');
    const result=readBoundaryAcquisitionDiagnostics(),notification=result.records.find(x=>x.type==='viewer:viewport.change');
    assert.deepEqual(notification.details.previousViewport,viewport);assert.deepEqual(notification.details.viewport,viewport);
    assert.deepEqual(notification.state.viewport,viewport);assert.match(notification.details.stack,/passive notification trace/);
    const removal=result.records.find(x=>x.type==='mutation'&&x.details.changes.some(c=>c.removed.length));
    assert.equal(removal.details.changes.find(c=>c.removed.length).removed[0].identity,before.handle.identity);
    assert.equal(removal.state.handle,null);assert.deepEqual(removal.state.selection,['FlightTimeout']);assert.equal(removal.state.history.size,0);
    assert.deepEqual(result.current.point,{x:1134,y:715});assert.equal(result.dropped,0);
    assert.ok(result.records.find(x=>x.type==='native:mousemove'));assert.ok(result.records.find(x=>x.type==='after:mousemove'));
  }finally{await h.close();}
});

test('passive observer leaves input ownership intact and records focus/leave lifecycle',async()=>{
  const h=fixture();try{
    let received=0;h.view.addEventListener('mousedown',()=>received++);
    const event=new h.window.MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:1134,clientY:715});
    h.view.dispatchEvent(event);assert.equal(received,1);assert.equal(event.defaultPrevented,false);
    h.window.dispatchEvent(new h.window.Event('blur'));
    h.view.dispatchEvent(new h.window.PointerEvent('pointerleave',{bubbles:false,clientX:1134,clientY:715,relatedTarget:h.document.body}));
    await Promise.resolve();
    const result=readBoundaryAcquisitionDiagnostics();
    assert.ok(result.records.some(x=>x.type==='native:blur'));assert.ok(result.records.some(x=>x.type==='native:pointerleave'));
    assert.deepEqual(result.current.selection,['FlightTimeout']);assert.equal(result.current.history.size,0);
    h.window.boundaryAcquisitionDiagnostics.stop();const count=result.records.length;
    h.window.dispatchEvent(new h.window.Event('blur'));await Promise.resolve();
    assert.equal(readBoundaryAcquisitionDiagnostics().records.length,count+1,'only explicit stop mark is added');
  }finally{await h.close();}
});

test('diagnostic driver keeps six original cases, callback values and original rejection identities',async()=>{
  const {runBoundaryAcquisitionDiagnostics}=await import('./browser-boundary-acquisition.mjs');
  const originalRun=async()=>({original:true}),markerCalls=[],operationCalls=[];
  const originalCase={id:'F23-B',name:'selected-boundary-lower-origin',engine:'local',batch:'b',sample:'Booking, timeout and compensation',run:originalRun};
  let closed=false,stops=0;
  const expectedError=new Error('original evaluation failure');
  const page={isClosed:()=>closed,
    async evaluate(fn,...args){
      if(fn===installBoundaryAcquisitionDiagnostics)return;
      if(fn===markBoundaryAcquisitionPhase){markerCalls.push(args[0]);if(args[0].includes(':rejected:'))throw Error('secondary observer failure');return;}
      if(fn===readBoundaryAcquisitionDiagnostics)return {records:[],dropped:0};
      operationCalls.push({fn,args});return fn(...args);
    },async screenshot(){throw expectedError;}};
  await runBoundaryAcquisitionDiagnostics({
    registerCases:async()=>[originalCase],
    harnessFactory:()=>({open:async()=>({page,errors:[]}),stop:async()=>{closed=true;stops++;}}),
    runner:async(options,configuration)=>{
      assert.deepEqual(options,{batch:'b',engine:'local'});
      const cases=await configuration.registerCases();assert.equal(cases.length,6);
      for(const c of cases){assert.equal(c.run,originalRun);assert.equal(c.sample,originalCase.sample);assert.equal(c.id,originalCase.id);}
      const h=configuration.harnessFactory({});await h.open('local',originalCase.sample);
      const value=await page.evaluate((a,b)=>({sum:a+b}),2,3);assert.deepEqual(value,{sum:5});assert.equal(operationCalls.length,1);
      await assert.rejects(page.evaluate(()=>{throw expectedError;}),error=>error===expectedError);
      await assert.rejects(page.screenshot({path:'unchanged.png',fullPage:true}),error=>error===expectedError);
      closed=true;await h.stop();assert.equal(stops,1);
    },
  });
  assert.ok(markerCalls.some(label=>label.startsWith('evaluate:')));
  assert.ok(markerCalls.some(label=>label.startsWith('screenshot:unchanged.png')));
});
