import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {Window} from 'happy-dom';
import {stationaryBoundaryCases,stationaryPanCandidate,collectStationaryControl,performStationaryCondition,runStationaryBoundaryExit,STATIONARY_REGION} from './browser-boundary-stationary-exit.mjs';
import {installBoundaryAcquisitionDiagnostics,readBoundaryAcquisitionDiagnostics} from '../helpers/boundary-acquisition-diagnostics.mjs';

test('bounded cohort is exactly two one-shot captures and one genuine native exit',async()=>{
  assert.deepEqual(stationaryBoundaryCases.map(c=>c.name),['full-page','viewport-only','genuine-exit']);
  assert.ok(stationaryBoundaryCases.every(c=>c.engine==='local'&&c.sample==='Booking, timeout and compensation'));
  for(const mode of stationaryBoundaryCases.map(c=>c.name)){
    const calls=[],h={output:'evidence',markDiagnostic:(...args)=>calls.push(['mark',...args]),settle:async()=>calls.push(['settle'])};
    const page={screenshot:async options=>calls.push(['screenshot',options]),mouse:{move:async(...args)=>calls.push(['move',...args])}};
    const result=await performStationaryCondition(h,page,'case',mode,{point:STATIONARY_REGION},{container:{y:48}});
    const input=calls.filter(c=>['move','screenshot'].includes(c[0]));assert.equal(input.length,1,'no repetition or alternate fallback');
    if(mode==='genuine-exit'){assert.deepEqual(input[0],['move',1530,24]);assert.deepEqual(result,{x:1530,y:24});}
    else{assert.deepEqual(input[0],['screenshot',{path:'evidence/case-source-control.png',fullPage:mode==='full-page'}]);assert.equal(result,undefined);}
  }
  let moved=false;
  await assert.rejects(performStationaryCondition({markDiagnostic(){}},{mouse:{move:async()=>{moved=true;}}},'case','genuine-exit',{point:STATIONARY_REGION},{container:{y:0}}),/above the actual canvas/);
  assert.equal(moved,false,'impossible exit setup stops before input');
});

test('serialized native-pan setup requires real blank input and visible end, and refuses occlusion',async()=>{
  const window=new Window(),document=window.document,old=new Map();
  for(const[key,value]of Object.entries({window,document,innerWidth:1800,innerHeight:1200})){
    old.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{value,configurable:true});
  }
  try{
    document.body.innerHTML='<div id="viewer"><svg></svg><button class="bpmn-xyflow-palette">Task</button></div>';
    const root=document.querySelector('#viewer'),svg=document.querySelector('svg');
    root.getBoundingClientRect=()=>({left:0,top:48,right:1800,bottom:1200,width:1800,height:1152});
    window.modeler={getGraph:()=>({roots:[{id:'Process'}]})};document.elementFromPoint=()=>svg;
    const read=Function(`return (${stationaryPanCandidate.toString()})`)();
    assert.deepEqual(read({x:396,y:312}),{from:{x:270,y:221},to:{x:666,y:533}});
    assert.throws(()=>read({x:2000,y:0}),/Evidence limit/);
    document.elementFromPoint=()=>document.querySelector('button');assert.throws(()=>read({x:396,y:312}),/Evidence limit/);
    document.elementFromPoint=()=>{svg.setAttribute('data-element-id','Task');return svg;};assert.throws(()=>read({x:396,y:312}),/Evidence limit/);
    const control=Function(`return (${collectStationaryControl.toString()})`)();
    assert.deepEqual(control('FlightTimeout'),{present:false,connected:false,anchor:null,grab:null});
    root.insertAdjacentHTML('beforeend','<svg><g class="bpmn-xyflow-connect-handle" data-connect-source="FlightTimeout"><circle class="bpmn-xyflow-connect-port" cx="655.62" cy="350.88"/></g><g class="bpmn-xyflow-connect-docking" data-connect-source="FlightTimeout"><circle class="bpmn-xyflow-connect-docking-point" cx="678.337" cy="315.186"/></g></svg>');
    assert.deepEqual(control('FlightTimeout'),{present:true,connected:true,anchor:{x:678.337,y:315.186},grab:{x:655.62,y:350.88}});
  }finally{await window.happyDOM.abort();for(const[key,descriptor]of old)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
});

test('diagnostic lifecycle has one passive install/final dump and records wheel-age uncertainty and source',async()=>{
  const output=await mkdtemp(join(tmpdir(),'boundary-stationary-contract-'));const source={modelerSha256:'fixture',head:'frozen',sourceSha256:'fixture',servedSha256:'served'};
  let factories=0,stops=0;const evidenceCalls=[];
  try{
    await runStationaryBoundaryExit({output,readSourceIdentity:async()=>source,
      harnessFactory:options=>{
        factories++;assert.equal(options.serverEntry,'test/helpers/boundary-diagnostic-server.mjs');let closed=false,clock;
        const calls=[];evidenceCalls.push(calls);
        const page={isClosed:()=>closed,async evaluate(fn){calls.push(fn);
          if(fn===installBoundaryAcquisitionDiagnostics){clock={timeOrigin:performance.timeOrigin,installedAt:performance.now()};return clock;}
          if(fn===readBoundaryAcquisitionDiagnostics)return {callbackErrors:[],records:[{type:'native:wheel',time:clock.installedAt-100},{type:'modeler:destroyConnectHandle',details:{sourceSha256:'fixture'}}]};
          throw Error('unexpected browser call');
        },async screenshot(options){return options.path;}};
        return {open:async()=>({page}),stop:async()=>{closed=true;stops++;}};
      },runner:async(options,config)=>{
        assert.deepEqual(options,{batch:'b',engine:'local'});assert.equal((await config.registerCases()).length,3);
        for(let i=0;i<3;i++){
          const h=config.harnessFactory({});const {page}=await h.open();
          h.markDiagnostic('region-acquired',{mode:stationaryBoundaryCases[i].name});
          if(i<2)await page.screenshot({path:'source-control.png',fullPage:i===0});
          assert.deepEqual(evidenceCalls[i],[installBoundaryAcquisitionDiagnostics]);
          await h.stop();await h.stop();
          assert.deepEqual(evidenceCalls[i],[installBoundaryAcquisitionDiagnostics,readBoundaryAcquisitionDiagnostics]);
        }
      },
    });
    assert.equal(factories,3);assert.equal(stops,6);
    for(let n=1;n<=3;n++){
      const data=JSON.parse(await readFile(join(output,`case-${n}-final.json`),'utf8'));
      assert.deepEqual(data.source,source);assert.equal(data.mode,stationaryBoundaryCases[n-1].name);
      assert.ok(data.acquiredWheelAgeMsRange[1]>=data.acquiredWheelAgeMsRange[0]);assert.ok(data.acquiredWheelAgeMsRange[0]>95.4);
      assert.match(data.limitation,/may not match/);
    }
  }finally{await rm(output,{recursive:true,force:true});}
});
