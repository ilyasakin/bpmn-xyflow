import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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

test('diagnostic driver records phases only in Node and dumps once after unchanged operations',async()=>{
  const {runBoundaryAcquisitionDiagnostics}=await import('./browser-boundary-acquisition.mjs');
  const output=await mkdtemp(join(tmpdir(),'boundary-diagnostic-contract-'));
  const originalRun=async()=>({original:true}),browserCalls=[],screenshotCalls=[];
  const originalCase={id:'F23-B',name:'selected-boundary-lower-origin',engine:'local',batch:'b',sample:'Booking, timeout and compensation',run:originalRun};
  let closed=false,stops=0;
  const expectedError=new Error('original evaluation failure'),image=Buffer.from('unchanged screenshot');
  const clock={timeOrigin:1234,installedAt:56};
  const sourceSha256=createHash('sha256').update(await readFile(new URL('../../lib/Modeler.js',import.meta.url))).digest('hex');
  const records=[{sequence:1,type:'modeler:destroyConnectHandle',details:{sourceSha256}}];
  const page={isClosed:()=>closed,
    async evaluate(fn,...args){
      assert.equal(this,page);browserCalls.push({fn,args});
      if(fn===installBoundaryAcquisitionDiagnostics)return clock;
      if(fn===markBoundaryAcquisitionPhase)throw Error('no browser phase evaluations permitted');
      if(fn===readBoundaryAcquisitionDiagnostics)return {records,dropped:0,callbackErrors:[]};
      return fn(...args);
    },async screenshot(...args){assert.equal(this,page);screenshotCalls.push(args);if(args[0].path==='rejected.png')throw expectedError;return image;}};
  try{
    await runBoundaryAcquisitionDiagnostics({output,
      registerCases:async()=>[originalCase],
      harnessFactory:()=>({open:async()=>({page,errors:[]}),stop:async()=>{closed=true;stops++;}}),
      runner:async(options,configuration)=>{
        assert.deepEqual(options,{batch:'b',engine:'local'});
        const cases=await configuration.registerCases();assert.equal(cases.length,6);
        for(const c of cases){assert.equal(c.run,originalRun);assert.equal(c.sample,originalCase.sample);assert.equal(c.id,originalCase.id);}
        const h=configuration.harnessFactory({});await h.open('local',originalCase.sample);
        const add=(a,b)=>({sum:a+b});
        assert.deepEqual(await page.evaluate(add,2,3),{sum:5});
        assert.deepEqual(browserCalls.map(c=>c.fn),[installBoundaryAcquisitionDiagnostics,add]);
        assert.deepEqual(browserCalls[1].args,[2,3]);
        const reject=()=>{throw expectedError;};
        await assert.rejects(page.evaluate(reject),error=>error===expectedError);
        await assert.rejects(page.screenshot({path:'rejected.png',fullPage:true}),error=>error===expectedError);
        assert.equal(await page.screenshot({path:'unchanged.png',fullPage:true}),image);
        assert.deepEqual(browserCalls.map(c=>c.fn),[installBoundaryAcquisitionDiagnostics,add,reject],
          'no diagnostic evaluation or dump between original operations');
        assert.deepEqual(screenshotCalls,[[{path:'rejected.png',fullPage:true}],[{path:'unchanged.png',fullPage:true}]]);
        await h.stop();await h.stop();assert.equal(stops,2,'owned cleanup remains repeatable');
        assert.equal(browserCalls.filter(c=>c.fn===readBoundaryAcquisitionDiagnostics).length,1,'one final dump only');
      },
    });
    const evidence=JSON.parse(await readFile(join(output,'repeat-1-final.json'),'utf8'));
    assert.deepEqual(evidence.browserClock,clock);assert.deepEqual(evidence.records,records);
    assert.match(evidence.source.head,/^[0-9a-f]{40}$/);assert.match(evidence.source.committedLibTree,/^[0-9a-f]{40}$/);
    for(const [path,hash] of Object.entries(evidence.source.sha256))assert.equal(hash,createHash('sha256').update(await readFile(new URL(`../../${path}`,import.meta.url))).digest('hex'));
    const labels=evidence.driverPhases.map(p=>p.label);
    assert.ok(labels.some(label=>label.startsWith('evaluate:')&&label.endsWith(':rejected')));
    assert.ok(labels.includes('screenshot:rejected.png:rejected'));assert.ok(labels.includes('screenshot:unchanged.png:after'));
    assert.deepEqual(labels.slice(-2),['final-dump:before','final-dump:after']);
    for(const phase of evidence.driverPhases){assert.ok(Number.isFinite(phase.monotonicMs));assert.equal(phase.epochMs,evidence.nodeTimeOrigin+phase.monotonicMs);}
  }finally{await rm(output,{recursive:true,force:true});}
});

test('final diagnostic read failure still runs owned cleanup without retrying or replacing original errors',async()=>{
  const {runBoundaryAcquisitionDiagnostics}=await import('./browser-boundary-acquisition.mjs');
  const originalError=new Error('original operation rejected'),dumpError=new Error('diagnostic read rejected');
  let stopped=0,dumps=0,closed=false;
  const page={isClosed:()=>closed,async evaluate(fn){
    if(fn===installBoundaryAcquisitionDiagnostics)return {timeOrigin:1,installedAt:2};
    if(fn===readBoundaryAcquisitionDiagnostics){dumps++;throw dumpError;}
    throw originalError;
  },async screenshot(){throw originalError;}};
  await runBoundaryAcquisitionDiagnostics({readSourceIdentity:async()=>({head:'fixture'}),
    harnessFactory:()=>({open:async()=>({page}),stop:async()=>{stopped++;closed=true;}}),
    runner:async(_options,configuration)=>{
      const h=configuration.harnessFactory({});await h.open();
      await assert.rejects(page.evaluate(()=>{}),e=>e===originalError);
      await assert.rejects(h.stop(),e=>e===dumpError);assert.equal(stopped,1);
      await h.stop();assert.equal(dumps,1);assert.equal(stopped,2);
    },
  });
});


test('critical observer uses cached native geometry and attribute state, reserving hit/layout reads for final dump',async()=>{
  const h=fixture();try{
    let reads=0;
    const oldMatrix=h.view.getScreenCTM, root=h.document.querySelector('svg'),oldRoot=root.getScreenCTM,oldHit=h.document.elementFromPoint;
    h.view.getScreenCTM=()=>{reads++;return oldMatrix();};root.getScreenCTM=()=>{reads++;return oldRoot();};
    h.document.elementFromPoint=(...args)=>{reads++;return oldHit(...args);};
    const cached={a:.8,b:0,c:0,d:.8,e:500,f:400};
    h.window.anchorInput=[{type:'mousemove',x:1134,y:715,screenMatrix:cached}];
    h.view.innerHTML='<g class="bpmn-xyflow-connect-handle" data-connect-source="FlightTimeout"><circle class="bpmn-xyflow-connect-port" cx="1" cy="2" r="5"/></g>';
    h.view.dispatchEvent(new h.window.MouseEvent('mousemove',{bubbles:true,clientX:1134,clientY:715}));
    h.emit('viewport.change',{viewport:h.window.modeler.getViewport()});
    Object.defineProperty(h.window,'innerWidth',{value:1800,configurable:true});
    Object.defineProperty(h.window,'innerHeight',{value:1200,configurable:true});
    h.window.dispatchEvent(new h.window.Event('resize'));
    const handle=h.view.querySelector('g');handle.remove();
    h.window.__bpmnBoundaryTeardownRecord({handle,owner:'FlightTimeout',stack:'actual caller',sourceSha256:'fixture',anchor:{x:1,y:2}});
    await h.window.happyDOM.whenAsyncComplete();await Promise.resolve();
    assert.equal(reads,0,'events, notifications, teardown and mutation perform no extra layout/hit reads');
    h.window.__bpmnBoundaryTeardownErrors.push({message:'recorded callback failure'});
    const result=readBoundaryAcquisitionDiagnostics();assert.equal(reads,3,'fresh CTMs and hit read occur only at dump');
    assert.deepEqual(result.current.matrix,cached);assert.deepEqual(result.callbackErrors,[{message:'recorded callback failure'}]);
    const resize=result.records.find(r=>r.type==='native:resize');
    assert.equal(resize.state.dimensions.window.innerWidth,1800);assert.equal(resize.state.dimensions.window.innerHeight,1200);
    assert.ok(resize.details.previousDimensions.window);assert.ok(result.records.some(r=>r.type==='modeler:destroyConnectHandle'&&r.details.handle.connected===false));
  }finally{await h.close();}
});

test('six screenshot cohorts change only the three declared source-control captures',async()=>{
  const {runBoundaryAcquisitionDiagnostics}=await import('./browser-boundary-acquisition.mjs');
  const output=await mkdtemp(join(tmpdir(),'boundary-cohort-contract-')),requests=[];
  const original={id:'F23-B',name:'selected-boundary-lower-origin',engine:'local',batch:'b',sample:'Booking',run:async()=>{}};
  try{
    await runBoundaryAcquisitionDiagnostics({output,readSourceIdentity:async()=>({sha256:{'lib/Modeler.js':'fixture'}}),registerCases:async()=>[original],
      harnessFactory:options=>{
        assert.equal(options.serverEntry,'test/helpers/boundary-diagnostic-server.mjs');let closed=false;
        const page={isClosed:()=>closed,async evaluate(fn){
          if(fn===installBoundaryAcquisitionDiagnostics)return {timeOrigin:1,installedAt:2};
          if(fn===readBoundaryAcquisitionDiagnostics)return {records:[{type:'modeler:destroyConnectHandle',details:{sourceSha256:'fixture'}}],callbackErrors:[]};
          throw Error('unexpected browser evaluation');
        },async screenshot(options){requests.push({...options});return 'image';}};
        return {open:async()=>({page}),stop:async()=>{closed=true;}};
      },
      runner:async(_options,config)=>{
        const cases=await config.registerCases();assert.equal(cases.length,6);
        for(const [index,c]of cases.entries()){
          assert.equal(c.run,original.run);const h=config.harnessFactory({});const {page}=await h.open();
          const source={path:`${index}-source-control.png`,fullPage:true,type:'png'};
          await page.screenshot(source);assert.equal(source.fullPage,true,'requested options are not mutated');
          await page.screenshot({path:`${index}-preview.png`,fullPage:true});await h.stop();
        }
      },
    });
    assert.deepEqual(requests.filter(x=>x.path.endsWith('-source-control.png')).map(x=>x.fullPage),[true,false,true,false,true,false]);
    assert.ok(requests.filter(x=>x.path.endsWith('-preview.png')).every(x=>x.fullPage===true));
    for(let index=1;index<=6;index++){
      const evidence=JSON.parse(await readFile(join(output,`repeat-${index}-final.json`),'utf8'));
      assert.equal(evidence.screenshotCohort,index%2?'original-full-page':'viewport-only-source-control');
      const options=evidence.driverPhases.find(p=>p.label==='source-screenshot-options');
      assert.equal(options.requested.fullPage,true);assert.equal(options.effective.fullPage,index%2===1);
    }
  }finally{await rm(output,{recursive:true,force:true});}
});

test('callback errors and missing served traces fail visibly after evidence is saved and cleanup runs',async()=>{
  const {runBoundaryAcquisitionDiagnostics}=await import('./browser-boundary-acquisition.mjs');
  for(const callbackErrors of [[{message:'injected callback error'}],[]]){
    const output=await mkdtemp(join(tmpdir(),'boundary-trace-failure-'));let closed=false,stops=0;
    const page={isClosed:()=>closed,async evaluate(fn){
      if(fn===installBoundaryAcquisitionDiagnostics)return {timeOrigin:1,installedAt:2};
      if(fn===readBoundaryAcquisitionDiagnostics)return {records:[],callbackErrors};
      throw Error('unexpected evaluation');
    },async screenshot(){}};
    try{
      await runBoundaryAcquisitionDiagnostics({output,readSourceIdentity:async()=>({sha256:{'lib/Modeler.js':'fixture'}}),
        harnessFactory:()=>({open:async()=>({page}),stop:async()=>{stops++;closed=true;}}),
        runner:async(_options,config)=>{
          const h=config.harnessFactory({});await h.open();
          await assert.rejects(h.stop(),callbackErrors.length?/diagnostic callback failures/:/instrumentation was actually reached/);
          assert.equal(stops,1);
        },
      });
      const evidence=JSON.parse(await readFile(join(output,'repeat-1-final.json'),'utf8'));
      assert.deepEqual(evidence.callbackErrors,callbackErrors);
    }finally{await rm(output,{recursive:true,force:true});}
  }
});
