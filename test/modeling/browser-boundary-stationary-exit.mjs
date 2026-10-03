/** Last bounded F23 experiment. A deliberately repositioned setup is not original acceptance. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAnchorHarness} from '../helpers/anchor-ux-browser.mjs';
import {installBoundaryAcquisitionDiagnostics,readBoundaryAcquisitionDiagnostics} from '../helpers/boundary-acquisition-diagnostics.mjs';
import {instrumentBoundaryTeardown} from '../helpers/boundary-teardown-transform.mjs';
import {nativePanViewport,collectPanGeometry} from './browser-viewport-source-grabs.mjs';
import {runAnchorFollowups} from './browser-anchor-followup.mjs';

export const STATIONARY_REGION=Object.freeze({x:1530,y:1027});
export function stationaryPanCandidate(delta){
  const root=document.querySelector('#viewer'),r=root.getBoundingClientRect();
  const ids=new Set(window.modeler.getGraph().roots.map(node=>node.id));
  for(const fy of [.15,.3,.5,.7])for(const fx of [.15,.3,.5,.7]){
    const from={x:Math.round(r.left+r.width*fx),y:Math.round(r.top+r.height*fy)},to={x:from.x+delta.x,y:from.y+delta.y};
    if(to.x<=r.left+10||to.x>=Math.min(innerWidth,r.right)-10||to.y<=r.top+10||to.y>=Math.min(innerHeight,r.bottom)-10)continue;
    const target=document.elementFromPoint(from.x,from.y),id=target?.closest('[data-element-id]')?.getAttribute('data-element-id');
    if(root.contains(target)&&(!id||ids.has(id))&&!target.closest('button,input,select,.bpmn-xyflow-minimap,.bpmn-xyflow-palette,.bpmn-xyflow-context-pad,.bjs-powered-by'))return {from,to};
  }
  throw Error('Evidence limit: no visible background pan can place the live grab in the recorded region');
}
export async function positionGrab(h,page,initial){
  const delta={x:STATIONARY_REGION.x-initial.point.x,y:STATIONARY_REGION.y-initial.point.y};
  const before=await h.raw(page),{from,to}=await page.evaluate(stationaryPanCandidate,delta);
  const originalGeometry=await page.evaluate(collectPanGeometry);
  await page.mouse.move(from.x,from.y);
  await page.mouse.down({button:'middle'});
  try{await page.mouse.move(to.x,to.y,{steps:12});}
  finally{await page.mouse.up({button:'middle'});}
  await h.settle(page);
  const after=await h.raw(page),up=after.input.findLast(e=>e.type==='mouseup'),down=after.input.findLast(e=>e.type==='mousedown'),moved=after.input.findLast(e=>e.type==='mousemove');
  assert.equal(down?.trusted,true);assert.equal(up?.trusted,true);assert.equal(moved?.trusted,true);
  assert.deepEqual([down.button,up.button],[1,1]);
  assert.deepEqual({x:down.x,y:down.y},from);assert.deepEqual({x:moved.x,y:moved.y},to);assert.deepEqual({x:up.x,y:up.y},to);
  const geometry=await page.evaluate(collectPanGeometry,[down,moved]);
  assert.deepEqual(geometry.matrix,originalGeometry.matrix);
  const expected=nativePanViewport(before.viewport,...geometry.points);
  assert.deepEqual(after.viewport,expected,'one normal pan follows exact delivered D3 arithmetic');
  assert.equal(after.xml,before.xml);assert.deepEqual(after.history,before.history);assert.deepEqual(after.selection,before.selection);
  return {delta,from,to,down,moved,up,expected,geometry};
}
export function collectStationaryControl(id){
  const handle=document.querySelector(`.bpmn-xyflow-connect-handle[data-connect-source="${id}"]`);
  const marker=document.querySelector(`.bpmn-xyflow-connect-docking[data-connect-source="${id}"] .bpmn-xyflow-connect-docking-point`);
  const grab=handle?.querySelector('.bpmn-xyflow-connect-port');
  return {present:!!handle,connected:!!handle?.isConnected,
    anchor:marker?{x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))}:null,
    grab:grab?{x:Number(grab.getAttribute('cx')),y:Number(grab.getAttribute('cy'))}:null};
}
export async function performStationaryCondition(h,page,key,mode,source,before){
  assert.ok(['full-page','viewport-only','genuine-exit'].includes(mode));
  let exit;
  if(mode==='genuine-exit'){
    exit={x:source.point.x,y:Math.max(1,Math.floor(before.container.y/2))};
    assert.ok(exit.y<before.container.y,'exit point is above the actual canvas');
    h.markDiagnostic('genuine-exit:before',{exit});
    await page.mouse.move(exit.x,exit.y);
    h.markDiagnostic('genuine-exit:after');
    await h.settle(page);
  }else{
    h.markDiagnostic('stationary-capture:before',{mode,requested:{path:`${h.output}/${key}-source-control.png`,fullPage:mode==='full-page'}});
    await page.screenshot({path:`${h.output}/${key}-source-control.png`,fullPage:mode==='full-page'});
    h.markDiagnostic('stationary-capture:after');
  }
  return exit;
}
export async function stationaryBoundaryWorkflow(h,page,key,mode){
  assert.ok(['full-page','viewport-only','genuine-exit'].includes(mode));
  await h.zoom(page,.8);
  const initial=await h.sourcePort(page,'FlightTimeout','bottom',.25,{selected:true});
  const pan=await positionGrab(h,page,initial);
  const before=await h.state(page),source=await h.sourcePort(page,'FlightTimeout','bottom',.25,{selected:true});
  assert.deepEqual(source.point,STATIONARY_REGION,'live visible grab is acquired in the observed stationary-exit region');
  assert.deepEqual(before.selection,['FlightTimeout']);
  h.markDiagnostic('region-acquired',{mode,source,pan});
  const exit=await performStationaryCondition(h,page,key,mode,source,before);
  const control=await page.evaluate(collectStationaryControl,'FlightTimeout');
  const unchanged=await h.state(page);
  assert.equal(unchanged.xml,before.xml);assert.deepEqual(unchanged.history,before.history);
  assert.deepEqual(unchanged.selection,before.selection);assert.deepEqual(unchanged.viewport,before.viewport);
  if(mode==='genuine-exit'){
    assert.equal(control.present,false,'a genuine canvas exit clears the acquired source affordance');
    const delivered=unchanged.input.findLast(e=>e.type==='mousemove');assert.equal(delivered?.trusted,true);
    assert.deepEqual({x:delivered.x,y:delivered.y},exit);
    return {mode,source,pan,control,exit,outcome:'normal native exit cleared the grab without any model/history change',wheelAge:'recorded in the final passive trace; recent-wheel lifecycle is not assumed'};
  }
  assert.equal(control.present,true,'stationary screenshot must not invalidate the acquired control');
  assert.equal(control.connected,true);assert.deepEqual(control.anchor,source.anchor);
  assert.deepEqual(control.grab,source.evidence.grab,'stationary capture preserves the exact displayed grab, not only its marker');
  const target=h.node(before,'CancelBooking'),to=h.screen(before,h.side(target,'left'));
  assert.ok((await h.hit(page,to)).owners.includes(target.id),'native destination remains visible after the deliberate pan');
  let preview;
  await h.drag(page,source.point,to,{capture:async()=>{preview=await h.preview(page);assert.ok(preview,'positive native connection preview from retained control');}});
  const after=await h.state(page),added=Object.values(after.edges).filter(edge=>!before.edges[edge.id]);
  assert.equal(added.length,1);const edge=added[0];
  assert.deepEqual([edge.type,edge.source,edge.target,edge.owner],['bpmn:SequenceFlow','FlightTimeout','CancelBooking','BookingTransaction']);
  h.near(edge.points[0],source.anchor,1e-7,'committed origin equals the acquired on-outline marker');
  h.near(preview.screenStart,h.screen(before,source.anchor),.1,'live preview starts at the acquired marker');
  const release=after.input.findLast(e=>e.type==='mouseup');assert.equal(release?.trusted,true);
  h.near(edge.points.at(-1),h.projected(target,h.graph(after,release)),1.5/after.viewport.zoom,'drop follows delivered native point on the target outline');
  await h.creationOnly(before,after,edge);await h.history(page,before,after);
  return {mode,source,pan,control,edge,preview,release,outcome:'stationary capture retained the source through real connect and exact history',wheelAge:'recorded in the final passive trace; recent-wheel lifecycle is not assumed'};
}
export const stationaryBoundaryCases=['full-page','viewport-only','genuine-exit'].map(mode=>({
  id:'F23-stationary',name:mode,engine:'local',batch:'b',sample:'Booking, timeout and compensation',
  run:(h,page,key)=>stationaryBoundaryWorkflow(h,page,key,mode),
}));
async function sourceIdentity(){
  const cwd=fileURLToPath(new URL('../../',import.meta.url)),code=await readFile(new URL('../../lib/Modeler.js',import.meta.url),'utf8');
  const {sourceSha256,servedSha256}=instrumentBoundaryTeardown(code);
  return {head:(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd})).stdout.trim(),
    modelerSha256:createHash('sha256').update(code).digest('hex'),sourceSha256,servedSha256};
}
export async function runStationaryBoundaryExit({harnessFactory=createAnchorHarness,runner=runAnchorFollowups,
  readSourceIdentity=sourceIdentity,output='test-artifacts/boundary-stationary-exit'}={}){
  const source=await readSourceIdentity();let index=0;
  return runner({batch:'b',engine:'local'},{artifactRoot:output,registerCases:async()=>stationaryBoundaryCases,
    harnessFactory:options=>{
      const number=++index,h=harnessFactory({...options,serverEntry:'test/helpers/boundary-diagnostic-server.mjs'}),phases=[];
      let page,evaluate,screenshot,clock,dumped=false;
      h.markDiagnostic=(label,details={})=>{const time=performance.now();phases.push({sequence:phases.length+1,label,monotonicMs:time,epochMs:performance.timeOrigin+time,...details});};
      const open=h.open;
      h.open=async(...args)=>{
        const result=await open(...args);page=result.page;evaluate=page.evaluate.bind(page);screenshot=page.screenshot.bind(page);
        h.markDiagnostic('install:before');clock=await evaluate(installBoundaryAcquisitionDiagnostics);h.markDiagnostic('install:after');
        page.screenshot=async(...args)=>{
          const label=`screenshot:${args[0]?.path}`;h.markDiagnostic(label+':before',{options:args[0]});
          try{const result=await screenshot(...args);h.markDiagnostic(label+':after');return result;}
          catch(error){h.markDiagnostic(label+':rejected',{error:String(error)});throw error;}
        };
        return result;
      };
      const stop=h.stop;
      h.stop=async()=>{
        try{
          if(!dumped&&page&&!page.isClosed()){
            dumped=true;const evidence=await evaluate(readBoundaryAcquisitionDiagnostics);
            const acquired=phases.find(p=>p.label==='region-acquired');
            const lastWheel=evidence.records.findLast(r=>r.type==='native:wheel');
            const lowerBound=phases.find(p=>p.label==='install:before'),upperBound=phases.find(p=>p.label==='install:after');
            const offset=[clock.installedAt-upperBound.epochMs,clock.installedAt-lowerBound.epochMs];
            const acquiredWheelAge=acquired&&lastWheel?offset.map(value=>acquired.epochMs+value-lastWheel.time):null;
            await mkdir(output,{recursive:true});await writeFile(`${output}/case-${number}-final.json`,JSON.stringify({
              ...evidence,source,browserClock:clock,driverPhases:phases,mode:stationaryBoundaryCases[number-1].name,
              acquiredWheelAgeMsRange:acquiredWheelAge,
              limitation:'Deliberate native pan to the observed lower-right region. It may not match the earlier 55.8–95.4ms wheel-age lifecycle. A pass cannot close original F23.',
            },null,2));
            assert.deepEqual(evidence.callbackErrors,[]);
            const traces=evidence.records.filter(r=>r.type==='modeler:destroyConnectHandle');
            assert.ok(traces.length&&traces.every(r=>r.details.sourceSha256===source.modelerSha256),'actual served teardown source is observed');
          }
        }finally{if(page)page.screenshot=screenshot;await stop();}
      };
      return h;
    },
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runStationaryBoundaryExit();
